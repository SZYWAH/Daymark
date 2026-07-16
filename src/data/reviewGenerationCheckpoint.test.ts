import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createInitialReviewCheckpoint } from "../lib/reviewGenerationTask";
import { deleteConversationGenerationDraft, getConversationGenerationDrafts, upsertConversationGenerationDraft } from "./itemStore";

describe("review generation checkpoint persistence", () => {
  it("persists all 113 completed segment summaries without raw conversation content", async () => {
    const checkpoint = {
      ...createInitialReviewCheckpoint({
        taskFingerprint: "task-113",
        settingsFingerprint: "settings-113",
        activityDateFrom: "2026-07-15",
        activityDateTo: "2026-07-15",
      }),
      stage: "summarizing" as const,
      chunkCount: 113,
      completedChunkCount: 113,
      chunkSummaries: Array.from({ length: 113 }, (_, index) => ({
        id: `segment-hash-${index}`,
        originalIndex: index,
        originalTotal: 113,
        summary: `第 ${index + 1} 段摘要`,
      })),
    };
    const draft = await upsertConversationGenerationDraft({
      reviewKey: "checkpoint-test-113",
      date: "2026-07-15",
      reviewKind: "source",
      sourceKind: "codex",
      sourceLabel: "Codex",
      partialContent: "",
      selectedSessionIds: ["session-id-only"],
      stage: "summarizing",
      message: "已保存分段摘要。",
      status: "paused",
      checkpoint,
    });

    const restored = (await getConversationGenerationDrafts()).find((item) => item.id === draft.id);
    expect(restored?.checkpoint?.chunkSummaries).toHaveLength(113);
    expect(restored?.checkpoint?.completedChunkCount).toBe(113);
    const serialized = JSON.stringify(restored);
    expect(serialized).not.toContain("原始对话正文");
    expect(serialized).not.toContain("apiKey");

    await deleteConversationGenerationDraft(draft.id);
  });
});
