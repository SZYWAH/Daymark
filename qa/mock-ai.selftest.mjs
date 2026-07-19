const base = process.env.DAYMARK_QA_MOCK_URL || "http://127.0.0.1:18888";
const results = [];

await check("models", async () => {
  const response = await fetch(`${base}/v1/models`);
  const body = await response.json();
  if (!response.ok || body.data.length < 7) throw new Error("model list incomplete");
});
await check("chat", async () => {
  const response = await post("/v1/chat/completions", { model: "qa-success", messages: [{ role: "user", content: "qa-sensitive-body" }] });
  const body = await response.json();
  if (body.choices?.[0]?.message?.content !== "Synthetic Daymark QA response.") throw new Error("chat shape mismatch");
});
await check("responses-stream", async () => {
  const response = await post("/v1/responses", { model: "qa-success", input: "qa-sensitive-body", stream: true });
  const body = await response.text();
  if (!body.includes("response.output_text.delta") || !body.includes("[DONE]")) throw new Error("responses stream mismatch");
});
await check("anthropic", async () => {
  const response = await post("/v1/messages", { model: "qa-success", messages: [{ role: "user", content: "qa-sensitive-body" }] });
  const body = await response.json();
  if (body.content?.[0]?.text !== "Synthetic Daymark QA response.") throw new Error("anthropic shape mismatch");
});
await check("401", async () => {
  const response = await post("/v1/chat/completions", { model: "qa-401", messages: [] });
  if (response.status !== 401) throw new Error(`expected 401, got ${response.status}`);
});
for (const status of [429, 500]) {
  await check(String(status), async () => {
    const response = await post("/v1/chat/completions", { model: `qa-${status}`, messages: [] });
    if (response.status !== status) throw new Error(`expected ${status}, got ${response.status}`);
  });
}
await check("empty", async () => {
  const response = await post("/v1/chat/completions", { model: "qa-empty", messages: [] });
  const body = await response.json();
  if (body.choices?.[0]?.message?.content !== "") throw new Error("empty response mismatch");
});
await check("slow-stream", async () => {
  const started = performance.now();
  const response = await post("/v1/chat/completions", { model: "qa-slow-stream", messages: [], stream: true });
  const body = await response.text();
  if (!body.includes("[DONE]") || performance.now() - started < 1_400) throw new Error("slow stream did not stream slowly");
});
await check("cancel", async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 100);
  try {
    await post("/v1/chat/completions", { model: "qa-slow", messages: [] }, controller.signal);
    throw new Error("slow request was not cancelled");
  } catch (error) {
    if (error instanceof Error && error.message === "slow request was not cancelled") throw error;
  } finally {
    clearTimeout(timer);
  }
});
await check("stream-drop", async () => {
  try {
    const response = await post("/v1/chat/completions", { model: "qa-drop", messages: [], stream: true });
    await response.text();
    throw new Error("dropped stream completed normally");
  } catch (error) {
    if (error instanceof Error && error.message === "dropped stream completed normally") throw error;
  }
});

process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
if (results.some((result) => result.status !== "pass")) process.exitCode = 1;

async function check(name, action) {
  try {
    await action();
    results.push({ name, status: "pass" });
  } catch (error) {
    results.push({ name, status: "fail", error: error instanceof Error ? error.message : String(error) });
  }
}

function post(path, body, signal) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer qa-synthetic-key" },
    body: JSON.stringify(body),
    signal,
  });
}
