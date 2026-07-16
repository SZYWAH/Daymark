import type {
  MemorySuggestionCheckpointV1,
  MemorySuggestionCheckpointStatus,
} from "../types";

export const MEMORY_SUGGESTION_PROMPT_VERSION = "memory-suggestion-v2";

export function createReviewContentVersion(title: string, content: string) {
  const value = `${title.trim()}\n${content.trim()}`;
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `${value.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

export function createMemoryContentVersion(content: string) {
  return createReviewContentVersion("memory", content);
}

export function createMemorySuggestionCheckpoint(input: {
  sourceReviewId?: string;
  sourceReviewDraftId?: string;
  sourceContentVersion: string;
  memoryContentVersion: string;
  status?: MemorySuggestionCheckpointStatus;
}): MemorySuggestionCheckpointV1 {
  return {
    schemaVersion: 1,
    promptVersion: MEMORY_SUGGESTION_PROMPT_VERSION,
    status: input.status ?? "pending",
    sourceReviewId: input.sourceReviewId,
    sourceReviewDraftId: input.sourceReviewDraftId,
    sourceContentVersion: input.sourceContentVersion,
    memoryContentVersion: input.memoryContentVersion,
    attemptCount: 0,
    retryCount: 0,
    updatedAt: new Date().toISOString(),
  };
}

export function isMemorySuggestionCheckpointCurrent(
  checkpoint: MemorySuggestionCheckpointV1 | undefined,
  input: {
    sourceReviewId?: string;
    sourceReviewDraftId?: string;
    sourceContentVersion: string;
    memoryContentVersion: string;
  },
) {
  return Boolean(
    checkpoint
      && checkpoint.schemaVersion === 1
      && checkpoint.promptVersion === MEMORY_SUGGESTION_PROMPT_VERSION
      && checkpoint.sourceReviewId === input.sourceReviewId
      && checkpoint.sourceReviewDraftId === input.sourceReviewDraftId
      && checkpoint.sourceContentVersion === input.sourceContentVersion
      && checkpoint.memoryContentVersion === input.memoryContentVersion,
  );
}

export function updateMemorySuggestionCheckpoint(
  checkpoint: MemorySuggestionCheckpointV1,
  patch: Partial<MemorySuggestionCheckpointV1>,
): MemorySuggestionCheckpointV1 {
  return {
    ...checkpoint,
    ...patch,
    schemaVersion: 1,
    promptVersion: MEMORY_SUGGESTION_PROMPT_VERSION,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeMemoryDocument(value: string) {
  return value.replace(/\r\n/g, "\n").trim();
}

export function shouldCreateMemorySuggestion(
  action: unknown,
  proposedContent: string,
  currentMemory: string,
) {
  if (String(action ?? "").trim().toLowerCase() === "none") return false;
  return normalizeMemoryDocument(proposedContent) !== normalizeMemoryDocument(currentMemory);
}

export function isMemorySuggestionSourceOutdated(
  sourceVersion: string | undefined,
  title: string,
  content: string,
) {
  return Boolean(sourceVersion && sourceVersion !== createReviewContentVersion(title, content));
}
