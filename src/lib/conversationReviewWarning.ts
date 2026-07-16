export const LARGE_NO_DATE_REVIEW_THRESHOLD_BYTES = 300 * 1024 * 1024;

type LargeNoDateReviewInput = {
  selectedCount: number;
  selectedBytes: number;
  dateFrom: string;
  dateTo: string;
};

type ConversationReviewFingerprintInput = LargeNoDateReviewInput & {
  selectedIds: Iterable<string>;
};

export function shouldWarnLargeNoDateReview({
  selectedCount,
  selectedBytes,
  dateFrom,
  dateTo,
}: LargeNoDateReviewInput) {
  return selectedCount > 0
    && (
      selectedBytes >= LARGE_NO_DATE_REVIEW_THRESHOLD_BYTES
      || (!dateFrom.trim() && !dateTo.trim())
    );
}

export function createConversationReviewFingerprint({
  selectedIds,
  selectedCount,
  selectedBytes,
  dateFrom,
  dateTo,
}: ConversationReviewFingerprintInput) {
  return JSON.stringify({
    selectedIds: Array.from(selectedIds).sort(),
    selectedCount,
    selectedBytes,
    dateFrom: dateFrom.trim(),
    dateTo: dateTo.trim(),
  });
}
