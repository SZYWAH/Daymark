import type { DailyConversationReview, Item } from "../types";

export type ReviewLibraryDraft = {
  reviewId: string;
  expectedSourceVersion: string;
  title: string;
  content: string;
  tags: string[];
  folderId?: string;
};

export function createReviewLibraryDraft(
  review: DailyConversationReview,
  contentVersion: string,
): ReviewLibraryDraft {
  return {
    reviewId: review.id,
    expectedSourceVersion: contentVersion,
    title: review.title,
    content: review.content,
    tags: getDefaultReviewLibraryTags(review),
  };
}

export function getDefaultReviewLibraryTags(review: DailyConversationReview) {
  const typeLabel = review.reviewKind === "combined"
    ? "综合回顾"
    : review.reviewKind === "auto-work"
      ? "自动工作回顾"
      : review.sourceLabel;
  return Array.from(new Set(["AI 回顾", typeLabel].filter(Boolean)));
}

export function getPublishedReviewItemId(items: Item[], review: DailyConversationReview) {
  return items.find(
    (item) => item.origin?.kind === "daily-review" && item.origin.sourceKey === review.reviewKey,
  )?.id;
}
