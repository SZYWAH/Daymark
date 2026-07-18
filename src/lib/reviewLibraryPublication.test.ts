import { describe, expect, it } from "vitest";

import type { DailyConversationReview, Item } from "../types";
import { createReviewContentVersion } from "./memorySuggestion";
import {
  createReviewLibraryDraft,
  getDefaultReviewLibraryTags,
  getDailyReviewLibraryHead,
  getDailyReviewLibraryLineage,
  getDailyReviewLibraryRevision,
  getDailyReviewLibraryRevisionKind,
  getPublishedReviewItemId,
  getVisibleDailyReviewLibraryItems,
  resolveDailyReviewLibraryState,
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

  it("treats legacy origins as source revision 1 and selects a stable lineage head", () => {
    const review = makeReview();
    const legacy = makeItem(review);
    const earlierDuplicate = makeItem(review, {
      id: "item-revision-2-a",
      createdAt: "2026-07-17 11:00:00",
      origin: { ...legacy.origin!, revision: 2 },
    });
    const stableHead = makeItem(review, {
      id: "item-revision-2-b",
      createdAt: "2026-07-17 12:00:00",
      updatedAt: "2026-07-17 09:00:00",
      origin: { ...legacy.origin!, revision: 2, revisionKind: "restore", derivedFromRevision: 1 },
    });
    const idTieBreakerHead = makeItem(review, {
      id: "item-revision-2-z",
      createdAt: stableHead.createdAt,
      updatedAt: "2026-07-17 08:00:00",
      origin: { ...legacy.origin!, revision: 2 },
    });
    const lineage = getDailyReviewLibraryLineage(
      [legacy, earlierDuplicate, stableHead, idTieBreakerHead],
      review.reviewKey,
    );

    expect(getDailyReviewLibraryRevision(legacy)).toBe(1);
    expect(getDailyReviewLibraryRevisionKind(legacy)).toBe("source");
    expect(lineage?.head.id).toBe(idTieBreakerHead.id);
    expect(lineage?.history.map((item) => item.id)).toEqual([stableHead.id, earlierDuplicate.id, legacy.id]);
    expect(getDailyReviewLibraryHead([stableHead, legacy], review.reviewKey)?.id).toBe(stableHead.id);
  });

  it("keeps only lineage heads visible while retaining ordinary items", () => {
    const review = makeReview();
    const first = makeItem(review);
    const head = makeItem(review, {
      id: "item-2",
      origin: { ...first.origin!, revision: 2 },
    });
    const ordinary = { ...makeItem(review), id: "ordinary", origin: undefined };

    expect(getVisibleDailyReviewLibraryItems([first, ordinary, head]).map((item) => item.id))
      .toEqual([ordinary.id, head.id]);
  });

  it("resolves changed, missing, fallback sources and post-sync item edits independently", () => {
    const review = makeReview();
    const sourceVersion = createReviewContentVersion(review.title, review.content);
    const item = makeItem(review, {
      title: "用户确认标题",
      content: "用户确认正文",
      origin: {
        ...makeItem(review).origin!,
        sourceId: "stale-source-id",
        contentVersion: sourceVersion,
        syncedItemContentVersion: createReviewContentVersion("用户确认标题", "用户确认正文"),
      },
    });

    expect(resolveDailyReviewLibraryState([item], [review], review.reviewKey)).toMatchObject({
      source: { id: review.id },
      status: "current",
      itemEditedSinceSync: false,
    });
    expect(resolveDailyReviewLibraryState(
      [{ ...item, content: "资料被手动编辑" }],
      [{ ...review, content: "来源也更新" }],
      review.reviewKey,
    )).toMatchObject({ status: "source-changed", itemEditedSinceSync: true });
    expect(resolveDailyReviewLibraryState([item], [], review.reviewKey)).toMatchObject({
      status: "source-missing",
      itemEditedSinceSync: false,
    });
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

function makeItem(review: DailyConversationReview, patch: Partial<Item> = {}): Item {
  const item: Item = {
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
  return {
    ...item,
    ...patch,
    origin: patch.origin === undefined ? item.origin : patch.origin,
  };
}
