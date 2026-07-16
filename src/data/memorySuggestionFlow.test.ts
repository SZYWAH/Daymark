import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  createDailyReviewReplacementDraft,
  createMemoryPatchDraft,
  getDailyReviewReplacementDrafts,
  getMemoryPatchDrafts,
  updateDailyReviewReplacementDraft,
  upsertDailyConversationReview,
} from "./itemStore";

describe("memory suggestion source flow", () => {
  it("updates one pending suggestion per formal review source", async () => {
    const review = await upsertDailyConversationReview({
      reviewKey: "2026-07-15:source:codex",
      date: "2026-07-15",
      reviewKind: "source",
      sourceKind: "codex",
      sourceLabel: "Codex",
      title: "今日回顾",
      content: "完成了第一轮实现。",
      sessionCount: 1,
      sessionIds: ["session-formal"],
      sourceReviewIds: [],
    });

    const first = await createMemoryPatchDraft({
      title: "项目方向",
      rationale: "值得长期保留。",
      proposedContent: "第一版建议",
      sourceReviewId: review.id,
      sourceReviewContentVersion: "v1",
      status: "pending",
    });
    const second = await createMemoryPatchDraft({
      title: "项目方向更新",
      rationale: "来源回顾已经更新。",
      proposedContent: "第二版建议",
      sourceReviewId: review.id,
      sourceReviewContentVersion: "v2",
      status: "pending",
    });

    expect(second.id).toBe(first.id);
    const matches = (await getMemoryPatchDrafts()).filter(
      (draft) => draft.status === "pending" && draft.sourceReviewId === review.id,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      title: "项目方向更新",
      proposedContent: "第二版建议",
      sourceReviewContentVersion: "v2",
    });
  });

  it("persists replacement edits and updates one suggestion for the draft source", async () => {
    const draft = await createDailyReviewReplacementDraft({
      reviewKey: "2026-07-15:combined:combined",
      date: "2026-07-15",
      reviewKind: "combined",
      sourceLabel: "综合",
      title: "待确认回顾",
      content: "原始内容",
      sessionCount: 2,
      sessionIds: ["session-a", "session-b"],
      sourceReviewIds: [],
      status: "pending",
    });
    const updatedDraft = await updateDailyReviewReplacementDraft(draft.id, {
      title: "编辑后的回顾",
      content: "编辑后的正文",
    });

    const first = await createMemoryPatchDraft({
      title: "长期方向",
      rationale: "第一版来源。",
      proposedContent: "建议一",
      sourceReviewDraftId: draft.id,
      sourceReviewContentVersion: "draft-v1",
      status: "pending",
    });
    const second = await createMemoryPatchDraft({
      title: "长期方向",
      rationale: "编辑后的来源。",
      proposedContent: "建议二",
      sourceReviewDraftId: draft.id,
      sourceReviewContentVersion: "draft-v2",
      status: "pending",
    });

    expect(second.id).toBe(first.id);
    expect(updatedDraft).toMatchObject({
      title: "编辑后的回顾",
      content: "编辑后的正文",
    });
    expect((await getDailyReviewReplacementDrafts()).find((item) => item.id === draft.id)).toMatchObject({
      title: "编辑后的回顾",
      content: "编辑后的正文",
    });
    const matches = (await getMemoryPatchDrafts()).filter(
      (item) => item.status === "pending" && item.sourceReviewDraftId === draft.id,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].proposedContent).toBe("建议二");
  });
});
