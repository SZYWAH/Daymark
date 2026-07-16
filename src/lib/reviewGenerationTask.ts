import type {
  ActiveView,
  AiSettings,
  ConversationReviewGenerationRequest,
  ConversationReviewInput,
  ReviewGenerationTaskCheckpointV1,
} from "../types";

export const REVIEW_GENERATION_PROMPT_VERSION = "conversation-review-v3";
export const REVIEW_GENERATION_CHECKPOINT_RETENTION_DAYS = 7;

export function shouldShowReviewGenerationEntry(
  activeView: ActiveView,
  hasTask: boolean,
  workspaceOpen: boolean,
) {
  if (!hasTask || workspaceOpen) return false;
  return !(activeView.kind === "memory" && activeView.subView === "ai-review");
}

export type ReviewRequestFailureKind =
  | "cancelled"
  | "configuration"
  | "transient"
  | "split-worthy"
  | "fatal";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function sha256Text(value: string) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createReviewSettingsFingerprint(settings: AiSettings) {
  return sha256Text(stableJson({
    provider: settings.provider,
    protocol: settings.protocol,
    baseUrl: settings.baseUrl.trim().replace(/\/+$/, ""),
    model: settings.model.trim(),
    reasoningEffort: settings.reasoningEffort ?? "default",
    stream: settings.stream,
  }));
}

export async function createReviewTaskFingerprint(
  request: ConversationReviewGenerationRequest,
  settingsFingerprint: string,
) {
  return sha256Text(stableJson({
    promptVersion: REVIEW_GENERATION_PROMPT_VERSION,
    settingsFingerprint,
    reviewKey: request.reviewKey,
    reviewKind: request.reviewKind,
    sourceKind: request.sourceKind,
    selectedSessionIds: [...request.selectedSessionIds].sort(),
    activityDateFrom: request.activityDateFrom,
    activityDateTo: request.activityDateTo,
  }));
}

export async function createReviewInputFingerprint(
  input: ConversationReviewInput,
  settingsFingerprint: string,
) {
  return sha256Text(stableJson({
    promptVersion: REVIEW_GENERATION_PROMPT_VERSION,
    settingsFingerprint,
    reviewKind: input.reviewKind,
    sessionIds: input.sessions.map((session) => session.id).sort(),
    activityDateFrom: input.activityDateFrom,
    activityDateTo: input.activityDateTo,
  }));
}

export async function createReviewSegmentId(
  kind: "chunk" | "compaction",
  content: string,
  settingsFingerprint: string,
) {
  return sha256Text(`${REVIEW_GENERATION_PROMPT_VERSION}\n${settingsFingerprint}\n${kind}\n${content}`);
}

export function createInitialReviewCheckpoint(input: {
  taskFingerprint: string;
  settingsFingerprint: string;
  activityDateFrom?: string;
  activityDateTo?: string;
  startedAt?: string;
}): ReviewGenerationTaskCheckpointV1 {
  return {
    schemaVersion: 1,
    promptVersion: REVIEW_GENERATION_PROMPT_VERSION,
    taskFingerprint: input.taskFingerprint,
    settingsFingerprint: input.settingsFingerprint,
    stage: "reading",
    activityDateFrom: input.activityDateFrom,
    activityDateTo: input.activityDateTo,
    totalChars: 0,
    messageCount: 0,
    chunkCount: 0,
    completedChunkCount: 0,
    chunkSummaries: [],
    compactionSummaries: [],
    compactionLevel: 0,
    compactionGroupIndex: 0,
    retryCount: 0,
    startedAt: input.startedAt ?? new Date().toISOString(),
  };
}

export function getReviewCheckpointExpiry(now = new Date()) {
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + REVIEW_GENERATION_CHECKPOINT_RETENTION_DAYS);
  return expiresAt.toISOString();
}

export function classifyReviewRequestFailure(error: unknown): ReviewRequestFailureKind {
  if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/AbortError|已取消|取消生成/i.test(message)) return "cancelled";
  if (/HTTP\s*(?:400|401|403|404)\b|鉴权|API Key|接口或模型不存在|模型名称|协议不兼容/i.test(message)) {
    return "configuration";
  }
  if (/AI 返回内容为空|格式不兼容|流式返回为空|请求超时|请求超过\s*\d+\s*秒|TimeoutError/i.test(message)) {
    return "split-worthy";
  }
  if (/HTTP\s*429\b|HTTP\s*5\d\d\b|网络|连接|fetch|ECONN|temporar|rate.?limit|服务繁忙/i.test(message)) {
    return "transient";
  }
  return "fatal";
}

export async function waitForReviewRetry(delayMs: number, signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("已取消生成。", "AbortError");
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    };
    const timer = globalThis.setTimeout(finish, delayMs);
    const cancel = () => {
      globalThis.clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      reject(new DOMException("已取消生成。", "AbortError"));
    };
    signal?.addEventListener("abort", cancel, { once: true });
  });
}
