import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import type { AiProtocol, AiReasoningEffort, AnthropicAuthMode } from "../types";

export type AiInputContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: string; data: string };

export type AiInputMessage = {
  role: "user" | "assistant";
  content: AiInputContentBlock[];
};

export type DesktopAiGenerateRequest = {
  protocol: AiProtocol;
  endpoint: string;
  apiKey: string;
  authMode?: AnthropicAuthMode;
  model: string;
  system?: string;
  messages: AiInputMessage[];
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: Exclude<AiReasoningEffort, "default">;
  timeoutMs: number;
};

export type AiModelOption = {
  id: string;
  supportedReasoningEfforts?: Exclude<AiReasoningEffort, "default">[];
};

export type DesktopAiModelListRequest = {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
};

type AiStreamEvent = {
  type: "token";
  token: string;
  fullText: string;
};

export function hasDesktopAiTransport() {
  return isTauri();
}

export async function requestDesktopAiGeneration(request: DesktopAiGenerateRequest, signal?: AbortSignal) {
  const requestId = createRequestId();
  const cancel = bindCancellation(requestId, signal);
  try {
    return await invoke<string>("ai_generate", {
      request: { requestId, ...request },
    });
  } finally {
    cancel();
  }
}

export async function streamDesktopAiGeneration(
  request: DesktopAiGenerateRequest,
  onToken: (token: string, fullText: string) => void,
  signal?: AbortSignal,
) {
  const requestId = createRequestId();
  const channel = new Channel<AiStreamEvent>();
  channel.onmessage = (event) => {
    if (event.type === "token") onToken(event.token, event.fullText);
  };
  const cancel = bindCancellation(requestId, signal);
  try {
    return await invoke<string>("ai_generate_stream", {
      request: { requestId, ...request },
      onEvent: channel,
    });
  } finally {
    cancel();
  }
}

export async function requestDesktopAiModels(request: DesktopAiModelListRequest) {
  return invoke<AiModelOption[]>("list_ai_models", { request });
}

function bindCancellation(requestId: string, signal?: AbortSignal) {
  const abort = () => {
    void invoke("cancel_ai_request", { requestId }).catch(() => undefined);
  };
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  return () => signal?.removeEventListener("abort", abort);
}

function createRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
