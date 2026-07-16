import { describe, expect, it } from "vitest";
import {
  LARGE_NO_DATE_REVIEW_THRESHOLD_BYTES,
  createConversationReviewFingerprint,
  shouldWarnLargeNoDateReview,
} from "./conversationReviewWarning";

describe("large conversation review warning", () => {
  it("warns when no date is set or the aggregate size reaches 300 MiB", () => {
    expect(shouldWarnLargeNoDateReview({
      selectedCount: 2,
      selectedBytes: 1024,
      dateFrom: "",
      dateTo: "",
    })).toBe(true);
    expect(shouldWarnLargeNoDateReview({
      selectedCount: 2,
      selectedBytes: LARGE_NO_DATE_REVIEW_THRESHOLD_BYTES,
      dateFrom: "2026-07-15",
      dateTo: "2026-07-16",
    })).toBe(true);
  });

  it("does not warn for a bounded range below the threshold", () => {
    expect(shouldWarnLargeNoDateReview({
      selectedCount: 2,
      selectedBytes: LARGE_NO_DATE_REVIEW_THRESHOLD_BYTES - 1,
      dateFrom: "2026-07-15",
      dateTo: "2026-07-16",
    })).toBe(false);
    expect(shouldWarnLargeNoDateReview({
      selectedCount: 0,
      selectedBytes: 0,
      dateFrom: "",
      dateTo: "",
    })).toBe(false);
  });

  it("changes the confirmation fingerprint with selection, dates, or size", () => {
    const base = createConversationReviewFingerprint({
      selectedIds: ["b", "a"],
      selectedCount: 2,
      selectedBytes: LARGE_NO_DATE_REVIEW_THRESHOLD_BYTES,
      dateFrom: "",
      dateTo: "",
    });
    expect(createConversationReviewFingerprint({
      selectedIds: ["a", "b"],
      selectedCount: 2,
      selectedBytes: LARGE_NO_DATE_REVIEW_THRESHOLD_BYTES,
      dateFrom: "",
      dateTo: "",
    })).toBe(base);
    expect(createConversationReviewFingerprint({
      selectedIds: ["a", "c"],
      selectedCount: 2,
      selectedBytes: LARGE_NO_DATE_REVIEW_THRESHOLD_BYTES,
      dateFrom: "",
      dateTo: "",
    })).not.toBe(base);
  });
});
