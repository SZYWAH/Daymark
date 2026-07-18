import { describe, expect, it } from "vitest";

import type { DailyConversationReview, Item } from "../types";
import {
  createReviewLibraryDraft,
  getDefaultReviewLibraryTags,
  getPublishedReviewItemId,
} from "./reviewLibraryPublication";

describe("review library publication", () => {
  it("creates editable drafts with stable default tags", () => {
    const review = makeReview({ reviewKind: "combined", sourceLabel: "综合" });
    expect(createReviewLibraryDraft(review, "source-v1")).toEqual({
      reviewId: review.id,
      expectedSourceVersion: "source-v1",
      title: review.title,
      content: review.content,
      tags: ["AI 回顾", "综合回顾"],
    });
    expect(getDefaultReviewLibraryTags(makeReview({
      id: "auto-review",
      reviewKey: "2026-07-17:auto-work:auto-work",
      reviewKind: "auto-work",
      sourceLabel: "自动工作回顾",
    }))).toEqual(["AI 回顾", "自动工作回顾"]);
  });

  it("finds a published item by the stable review key", () => {
    const review = makeReview();
    const item = makeItem(review);
    expect(getPublishedReviewItemId([item], review)).toBe(item.id);
    expect(getPublishedReviewItemId([], review)).toBeUndefined();
  });
});

function makeReview(patch: Partial<DailyConversationReview> = {}): DailyConversationReview {
  return {
    id: "review-1",
    reviewKey: "2026-07-17:source:codex",
    date: "2026-07-17",
    reviewKind: "source",
    sourceKind: "codex",
    sourceLabel: "Codex",
    title: "今日回顾",
    content: "完成了资料库沉淀功能。",
    sessionCount: 2,
    sessionIds: ["session-1", "session-2"],
    createdAt: "2026-07-17 10:00:00",
    updatedAt: "2026-07-17 10:00:00",
    ...patch,
  };
}

function makeItem(review: DailyConversationReview): Item {
  return {
    id: "item-1",
    title: review.title,
    type: "note",
    processStatus: "收件箱",
    readingStatus: "不需要",
    tags: ["AI 回顾"],
    content: review.content,
    aiSummary: "来自 AI 回顾。",
    createdAt: "2026-07-17 10:00:00",
    updatedAt: "2026-07-17 10:00:00",
    favorite: false,
    origin: {
      kind: "daily-review",
      sourceId: review.id,
      sourceKey: review.reviewKey,
      sourceDate: review.date,
      sourceLabel: review.sourceLabel,
      contentVersion: "source-v1",
    },
  };
}
