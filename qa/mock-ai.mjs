import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const host = "127.0.0.1";
const port = Number.parseInt(process.env.DAYMARK_QA_MOCK_PORT || "18888", 10);
const runDir = path.resolve(process.env.DAYMARK_QA_RUN_DIR || "work/qa/mock-ai-latest");
const logPath = path.join(runDir, "mock-ai-requests.jsonl");
await mkdir(runDir, { recursive: true });

const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  let payload = {};
  try { payload = body.length ? JSON.parse(body.toString("utf8")) : {}; } catch { payload = {}; }

  const model = typeof payload.model === "string" ? payload.model : "qa-success";
  const scenario = model.startsWith("qa-") ? model.slice(3) : "success";
  await recordRequest(request, body, scenario);

  if (request.method === "GET" && /\/models\/?$/.test(request.url || "")) {
    return json(response, 200, {
      object: "list",
      data: ["qa-success", "qa-slow", "qa-empty", "qa-401", "qa-429", "qa-500", "qa-drop"]
        .map((id) => ({ id, object: "model" })),
    });
  }

  if (scenario === "401" || scenario === "429" || scenario === "500") {
    const status = Number(scenario);
    return json(response, status, { error: { message: `Synthetic QA HTTP ${status}` } });
  }

  if (scenario === "slow") await delay(2_000);
  const stream = payload.stream === true;
  if (stream) return streamResponse(request.url || "", response, scenario);
  if (scenario === "empty") return json(response, 200, responseBody(request.url || "", ""));
  return json(response, 200, responseBody(request.url || "", "Synthetic Daymark QA response."));
});

server.listen(port, host, () => {
  process.stdout.write(`Daymark QA mock AI listening on http://${host}:${port}\n`);
  process.stdout.write(`Request metadata log: ${logPath}\n`);
});

process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));

async function recordRequest(request, body, scenario) {
  const authorization = request.headers.authorization;
  const record = {
    at: new Date().toISOString(),
    method: request.method,
    path: request.url,
    scenario,
    contentLength: body.length,
    bodySha256: createHash("sha256").update(body).digest("hex"),
    authorizationPresent: Boolean(authorization || request.headers["x-api-key"]),
    authorizationKind: authorization?.split(" ", 1)[0] || (request.headers["x-api-key"] ? "x-api-key" : null),
  };
  await appendFile(logPath, `${JSON.stringify(record)}\n`, "utf8");
}

function json(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  response.end(JSON.stringify(body));
}

function responseBody(url, text) {
  if (url.includes("/messages")) {
    return { id: "msg_qa", type: "message", role: "assistant", content: text ? [{ type: "text", text }] : [] };
  }
  if (url.includes("/responses")) {
    return { id: "resp_qa", status: "completed", output_text: text, output: [] };
  }
  return { id: "chatcmpl_qa", choices: [{ message: { role: "assistant", content: text } }] };
}

async function streamResponse(url, response, scenario) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    "connection": "keep-alive",
    "access-control-allow-origin": "*",
  });
  if (scenario === "empty") return response.end("data: [DONE]\n\n");

  const tokens = ["Synthetic ", "Daymark ", "QA response."];
  for (const [index, token] of tokens.entries()) {
    const event = url.includes("/messages")
      ? { type: "content_block_delta", delta: { type: "text_delta", text: token } }
      : url.includes("/responses")
        ? { type: "response.output_text.delta", delta: token }
        : { choices: [{ delta: { content: token } }] };
    response.write(`data: ${JSON.stringify(event)}\n\n`);
    if (scenario === "drop" && index === 0) return response.destroy();
    await delay(scenario === "slow-stream" ? 750 : 40);
  }
  response.end("data: [DONE]\n\n");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
