import { describe, expect, it, vi } from "vitest";
import { runReliableReviewTextRequest } from "../ai/deepseek";
import type { ConversationReviewGenerationRequest } from "../types";
import {
  classifyReviewRequestFailure,
  createInitialReviewCheckpoint,
  createReviewSegmentId,
  createReviewTaskFingerprint,
  getReviewCheckpointExpiry,
  sha256Text,
  shouldShowReviewGenerationEntry,
} from "./reviewGenerationTask";

const request: ConversationReviewGenerationRequest = {
  reviewKey: "2026-07-15:codex:codex",
  date: "2026-07-15",
  reviewKind: "source",
  sourceKind: "codex",
  sourceLabel: "Codex",
  selectedSessionIds: ["session-b", "session-a"],
  activityDateFrom: "2026-07-15",
  activityDateTo: "2026-07-15",
};

describe("review generation task checkpoints", () => {
  it("shows the global task entry only outside the AI review console", () => {
    expect(shouldShowReviewGenerationEntry({ kind: "today" }, true, false)).toBe(true);
    expect(shouldShowReviewGenerationEntry({ kind: "memory", subView: "archive" }, true, false)).toBe(true);
    expect(shouldShowReviewGenerationEntry({ kind: "memory", subView: "ai-review" }, true, false)).toBe(false);
    expect(shouldShowReviewGenerationEntry({ kind: "today" }, true, true)).toBe(false);
    expect(shouldShowReviewGenerationEntry({ kind: "today" }, false, false)).toBe(false);
  });

  it("creates stable task and segment identifiers for resumable work", async () => {
    const settingsFingerprint = await sha256Text("deepseek-settings");
    const firstTask = await createReviewTaskFingerprint(request, settingsFingerprint);
    const secondTask = await createReviewTaskFingerprint(
      { ...request, selectedSessionIds: [...request.selectedSessionIds].reverse() },
      settingsFingerprint,
    );
    expect(secondTask).toBe(firstTask);

    const chunks = Array.from({ length: 113 }, (_, index) => `segment-${index}-${"x".repeat(48)}`);
    const firstIds = await Promise.all(chunks.map((chunk) => createReviewSegmentId("chunk", chunk, settingsFingerprint)));
    const resumedIds = await Promise.all(chunks.map((chunk) => createReviewSegmentId("chunk", chunk, settingsFingerprint)));
    expect(new Set(firstIds).size).toBe(113);
    expect(resumedIds).toEqual(firstIds);
    expect(await createReviewSegmentId("chunk", `${chunks[56]}-changed`, settingsFingerprint)).not.toBe(firstIds[56]);
  });

  it("keeps only safe checkpoint metadata and expires unfinished work after seven days", async () => {
    const checkpoint = createInitialReviewCheckpoint({
      taskFingerprint: "task-hash",
      settingsFingerprint: "settings-hash",
      activityDateFrom: "2026-07-15",
      activityDateTo: "2026-07-15",
      startedAt: "2026-07-15T00:00:00.000Z",
    });
    const serialized = JSON.stringify(checkpoint);
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("transcript");
    expect(serialized).not.toContain("filePath");
    expect(getReviewCheckpointExpiry(new Date("2026-07-15T00:00:00.000Z"))).toBe("2026-07-22T00:00:00.000Z");
  });
});

describe("reliable review requests", () => {
  it("retries transient failures twice without repeating successful work", async () => {
    const retry = vi.fn();
    const execute = vi.fn()
      .mockRejectedValueOnce(new Error("HTTP 500"))
      .mockRejectedValueOnce(new Error("HTTP 429"))
      .mockResolvedValue("summary");

    await expect(runReliableReviewTextRequest(execute, {
      retryDelaysMs: [0, 0],
      onRetry: retry,
    })).resolves.toBe("summary");
    expect(execute).toHaveBeenCalledTimes(3);
    expect(retry).toHaveBeenNthCalledWith(1, "transient", 1);
    expect(retry).toHaveBeenNthCalledWith(2, "transient", 2);
  });

  it("retries an empty response once and stops immediately on configuration errors", async () => {
    const emptyThenContent = vi.fn().mockResolvedValueOnce("").mockResolvedValueOnce("recovered");
    await expect(runReliableReviewTextRequest(emptyThenContent, { retryDelaysMs: [0, 0] })).resolves.toBe("recovered");
    expect(emptyThenContent).toHaveBeenCalledTimes(2);

    const invalidConfig = vi.fn().mockRejectedValue(new Error("HTTP 401"));
    await expect(runReliableReviewTextRequest(invalidConfig, { retryDelaysMs: [0, 0] })).rejects.toThrow("HTTP 401");
    expect(invalidConfig).toHaveBeenCalledTimes(1);
    expect(classifyReviewRequestFailure(new Error("HTTP 401"))).toBe("configuration");
  });
});
