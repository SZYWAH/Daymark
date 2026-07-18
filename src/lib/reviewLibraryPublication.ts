import type { DailyConversationReview, Item } from "../types";
import { createReviewContentVersion } from "./memorySuggestion";

export type DailyReviewLibraryRevisionKind = "source" | "restore" | "reactivation";
export type DailyReviewLibrarySourceStatus = "current" | "source-changed" | "source-missing";

export type DailyReviewLibraryLineage = {
  sourceKey: string;
  head: Item;
  versions: Item[];
  history: Item[];
};

export type DailyReviewLibraryState = DailyReviewLibraryLineage & {
  source?: DailyConversationReview;
  status: DailyReviewLibrarySourceStatus;
  itemEditedSinceSync: boolean;
};

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
  return getDailyReviewLibraryHead(items, review.reviewKey)?.id;
}

export function getDailyReviewLibraryRevision(item: Item) {
  const revision = item.origin?.kind === "daily-review" ? item.origin.revision : undefined;
  return typeof revision === "number" && Number.isSafeInteger(revision) && revision > 0 ? revision : 1;
}

export function getDailyReviewLibraryRevisionKind(item: Item): DailyReviewLibraryRevisionKind {
  const kind = item.origin?.kind === "daily-review" ? item.origin.revisionKind : undefined;
  return kind === "restore" || kind === "reactivation" ? kind : "source";
}

export function compareDailyReviewLibraryVersions(left: Item, right: Item) {
  const revisionOrder = getDailyReviewLibraryRevision(right) - getDailyReviewLibraryRevision(left);
  if (revisionOrder !== 0) return revisionOrder;
  const createdOrder = right.createdAt.localeCompare(left.createdAt);
  if (createdOrder !== 0) return createdOrder;
  return right.id.localeCompare(left.id);
}

export function getDailyReviewLibraryLineage(items: Item[], sourceKey: string): DailyReviewLibraryLineage | undefined {
  const normalizedSourceKey = sourceKey.trim();
  if (!normalizedSourceKey) return undefined;
  const versions = items
    .filter((item) => item.origin?.kind === "daily-review" && item.origin.sourceKey === normalizedSourceKey)
    .sort(compareDailyReviewLibraryVersions);
  const head = versions[0];
  if (!head) return undefined;
  return { sourceKey: normalizedSourceKey, head, versions, history: versions.slice(1) };
}

export function getDailyReviewLibraryHead(items: Item[], sourceKey: string) {
  return getDailyReviewLibraryLineage(items, sourceKey)?.head;
}

export function getVisibleDailyReviewLibraryItems(items: Item[]) {
  const headIds = new Set<string>();
  const sourceKeys = new Set(items.flatMap(
    (item) => item.origin?.kind === "daily-review" ? [item.origin.sourceKey] : [],
  ));
  sourceKeys.forEach((sourceKey) => {
    const head = getDailyReviewLibraryHead(items, sourceKey);
    if (head) headIds.add(head.id);
  });
  return items.filter((item) => item.origin?.kind !== "daily-review" || headIds.has(item.id));
}

export function resolveDailyReviewLibrarySource(item: Item, reviews: DailyConversationReview[]) {
  const origin = item.origin;
  if (origin?.kind !== "daily-review") return undefined;
  return reviews.find((review) => review.id === origin.sourceId && review.reviewKey === origin.sourceKey)
    ?? reviews.find((review) => review.reviewKey === origin.sourceKey);
}

export function isDailyReviewLibraryItemEdited(item: Item) {
  const syncedVersion = item.origin?.kind === "daily-review" ? item.origin.syncedItemContentVersion?.trim() : undefined;
  if (!syncedVersion) return false;
  return createReviewContentVersion(item.title, item.content) !== syncedVersion;
}

export function resolveDailyReviewLibraryState(
  items: Item[],
  reviews: DailyConversationReview[],
  sourceKey: string,
): DailyReviewLibraryState | undefined {
  const lineage = getDailyReviewLibraryLineage(items, sourceKey);
  if (!lineage) return undefined;
  const source = resolveDailyReviewLibrarySource(lineage.head, reviews);
  const status: DailyReviewLibrarySourceStatus = !source
    ? "source-missing"
    : createReviewContentVersion(source.title, source.content) === lineage.head.origin?.contentVersion
      ? "current"
      : "source-changed";
  return { ...lineage, source, status, itemEditedSinceSync: isDailyReviewLibraryItemEdited(lineage.head) };
}
