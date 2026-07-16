import { describe, expect, it } from "vitest";
import {
  buildAnthropicMessagesEndpoint,
  buildBrowserAiRequest,
  buildChatCompletionsEndpoint,
  buildOpenAiModelEndpoints,
  buildOpenAiResponsesEndpoint,
  extractResponsesContent,
  extractBrowserStreamToken,
  isRetryableReviewChunkTimeout,
  normalizeAiPrompt,
  parseModelListResponse,
  splitReviewChunkForRetry,
  summarizeReviewChunksWithTimeoutFallback,
} from "./deepseek";

describe("buildChatCompletionsEndpoint", () => {
  it("appends the OpenAI chat path to service roots", () => {
    expect(buildChatCompletionsEndpoint("https://api.example.com/v1"))
      .toBe("https://api.example.com/v1/chat/completions");
  });

  it("keeps complete chat completion addresses unchanged", () => {
    const endpoint = "https://opencode.ai/zen/go/v1/chat/completions";
    expect(buildChatCompletionsEndpoint(endpoint)).toBe(endpoint);
    expect(buildChatCompletionsEndpoint(`${endpoint}/`)).toBe(endpoint);
  });
});

describe("OpenAI Responses adapter", () => {
  it("builds root, v1, and complete response endpoints", () => {
    expect(buildOpenAiResponsesEndpoint("https://mdkj.lol")).toBe("https://mdkj.lol/responses");
    expect(buildOpenAiResponsesEndpoint("https://api.example.com/v1/")).toBe("https://api.example.com/v1/responses");
    expect(buildOpenAiResponsesEndpoint("https://api.example.com/v1/responses/")).toBe("https://api.example.com/v1/responses");
  });

  it("sends store false, instructions, images, and optional reasoning only", () => {
    const request = buildBrowserAiRequest({
      protocol: "openai-responses",
      endpoint: "https://mdkj.lol/responses",
      apiKey: "secret",
      model: "gpt-5.5",
      system: "system",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "read" },
          { type: "image", mediaType: "image/png", data: "aGVsbG8=" },
        ],
      }],
      reasoningEffort: "xhigh",
      maxTokens: 999,
      temperature: 0.9,
      timeoutMs: 10_000,
    }, false);
    expect(request.headers.Authorization).toBe("Bearer secret");
    expect(request.body).toMatchObject({
      instructions: "system",
      store: false,
      reasoning: { effort: "xhigh" },
      input: [{ content: [
        { type: "input_text", text: "read" },
        { type: "input_image", image_url: "data:image/png;base64,aGVsbG8=", detail: "auto" },
      ] }],
    });
    expect(request.body).not.toHaveProperty("temperature");
    expect(request.body).not.toHaveProperty("max_tokens");
    expect(request.body).not.toHaveProperty("max_output_tokens");
  });

  it("extracts non-stream and stream text while ignoring unknown events", () => {
    expect(extractResponsesContent({ output: [{ content: [
      { type: "output_text", text: "hello " },
      { type: "refusal" },
      { type: "output_text", text: "world" },
    ] }] })).toBe("hello world");
    expect(extractResponsesContent({ output_text: " gateway text " })).toBe("gateway text");
    expect(extractBrowserStreamToken("openai-responses", {
      type: "response.output_text.delta",
      delta: "hello",
    })).toBe("hello");
    expect(extractBrowserStreamToken("openai-responses", {
      type: "response.output_text.done",
      text: "gateway text",
    })).toBe("gateway text");
    expect(extractBrowserStreamToken("openai-responses", {
      type: "response.output_item.done",
      item: { content: [{ type: "output_text", text: "item text" }] },
    })).toBe("item text");
    expect(extractBrowserStreamToken("openai-responses", {
      choices: [{ delta: { content: "chat-shaped gateway text" } }],
    })).toBe("chat-shaped gateway text");
    expect(extractBrowserStreamToken("openai-responses", { type: "response.created" })).toBe("");
    expect(() => extractBrowserStreamToken("openai-responses", {
      type: "response.incomplete",
      response: { incomplete_details: { reason: "max_output_tokens" } },
    })).toThrow("max_output_tokens");
  });
});

describe("OpenAI model discovery", () => {
  it("restores model endpoints from service and response URLs", () => {
    expect(buildOpenAiModelEndpoints("https://mdkj.lol")).toEqual([
      "https://mdkj.lol/v1/models",
      "https://mdkj.lol/models",
    ]);
    expect(buildOpenAiModelEndpoints("https://mdkj.lol/v1/responses")).toEqual([
      "https://mdkj.lol/v1/models",
      "https://mdkj.lol/models",
    ]);
  });

  it("deduplicates and sorts models while preserving explicit capabilities", () => {
    expect(parseModelListResponse({ data: [
      { id: "gpt-z" },
      { id: "gpt-a", supported_reasoning_efforts: ["low", "xhigh", "invalid"] },
      { id: "gpt-z" },
    ] })).toEqual([
      { id: "gpt-a", supportedReasoningEfforts: ["low", "xhigh"] },
      { id: "gpt-z" },
    ]);
  });
});

describe("Anthropic Messages adapter", () => {
  it("builds roots, v1 roots, and complete message endpoints", () => {
    expect(buildAnthropicMessagesEndpoint("https://api.anthropic.com"))
      .toBe("https://api.anthropic.com/v1/messages");
    expect(buildAnthropicMessagesEndpoint("https://gateway.test/anthropic/v1/"))
      .toBe("https://gateway.test/anthropic/v1/messages");
    expect(buildAnthropicMessagesEndpoint("https://gateway.test/anthropic/v1/messages/"))
      .toBe("https://gateway.test/anthropic/v1/messages");
  });

  it("moves system prompts and normalizes local image data", () => {
    const prompt = normalizeAiPrompt([
      { role: "system", content: "Keep it concise." },
      {
        role: "user",
        content: [
          { type: "text", text: "Read this image." },
          { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } },
        ],
      },
    ]);

    expect(prompt.system).toBe("Keep it concise.");
    expect(prompt.messages).toEqual([{
      role: "user",
      content: [
        { type: "text", text: "Read this image." },
        { type: "image", mediaType: "image/png", data: "aGVsbG8=" },
      ],
    }]);
  });

  it("uses only the selected auth header and omits temperature", () => {
    const base = {
      protocol: "anthropic-messages" as const,
      endpoint: "https://api.anthropic.com/v1/messages",
      apiKey: "secret",
      model: "claude-sonnet-4-6",
      system: "system",
      messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "hello" }] }],
      maxTokens: 100,
      timeoutMs: 10_000,
    };
    const xKey = buildBrowserAiRequest({ ...base, authMode: "x-api-key" }, false);
    expect(xKey.headers["x-api-key"]).toBe("secret");
    expect(xKey.headers.Authorization).toBeUndefined();
    expect(xKey.headers["anthropic-version"]).toBe("2023-06-01");
    expect(xKey.body).not.toHaveProperty("temperature");

    const bearer = buildBrowserAiRequest({ ...base, authMode: "bearer" }, true);
    expect(bearer.headers.Authorization).toBe("Bearer secret");
    expect(bearer.headers["x-api-key"]).toBeUndefined();
  });

  it("extracts text deltas and ignores non-text events", () => {
    expect(extractBrowserStreamToken("anthropic-messages", {
      type: "content_block_delta",
      delta: { type: "text_delta", text: "hello" },
    })).toBe("hello");
    expect(extractBrowserStreamToken("anthropic-messages", { type: "ping" })).toBe("");
    expect(extractBrowserStreamToken("anthropic-messages", { type: "future_event" })).toBe("");
  });
});

describe("conversation review chunk fallback", () => {
  it("splits an eight-thousand-character timeout segment into two equal retries", () => {
    const chunks = splitReviewChunkForRetry("x".repeat(8_000));
    expect(chunks).toHaveLength(2);
    expect(chunks.map((chunk) => Array.from(chunk).length)).toEqual([4_000, 4_000]);
  });

  it("retries only the timed-out segment and keeps completed summaries", async () => {
    const calls: string[] = [];
    const progress: string[] = [];
    const summaries = await summarizeReviewChunksWithTimeoutFallback(
      ["first", "x".repeat(8_000), "third"],
      async (attempt) => {
        const label = `${attempt.originalIndex + 1}${attempt.retryPart ?? ""}`;
        calls.push(label);
        if (attempt.originalIndex === 1 && !attempt.retryPart) {
          throw new Error("AI 请求超时。");
        }
        return `summary-${label}`;
      },
      {
        onProgress: (event) => progress.push(`${event.kind}:${event.attempt.originalIndex + 1}${event.attempt.retryPart ?? ""}`),
      },
    );

    expect(calls).toEqual(["1", "2", "2a", "2b", "3"]);
    expect(summaries).toEqual(["summary-1", "summary-2a", "summary-2b", "summary-3"]);
    expect(progress).toContain("retry:2");
    expect(calls.filter((label) => label === "1")).toHaveLength(1);
  });

  it("does not retry authentication errors or cancelled requests", async () => {
    await expect(summarizeReviewChunksWithTimeoutFallback(
      ["only"],
      async () => {
        throw new Error("HTTP 401：鉴权失败。");
      },
    )).rejects.toThrow("HTTP 401");

    const controller = new AbortController();
    let calls = 0;
    await expect(summarizeReviewChunksWithTimeoutFallback(
      ["only"],
      async () => {
        calls += 1;
        controller.abort();
        throw new Error("AI 请求超时。");
      },
      { signal: controller.signal },
    )).rejects.toThrow("AI 请求超时");
    expect(calls).toBe(1);
    expect(isRetryableReviewChunkTimeout(new Error("HTTP 401：鉴权失败。"))).toBe(false);
    expect(isRetryableReviewChunkTimeout(new Error("AI 请求超时。"))).toBe(true);
  });
});
