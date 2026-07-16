import { describe, expect, it } from "vitest";
import { formatMemorySuggestionResult, formatReviewGenerationResult } from "./reviewGenerationResult";

describe("review generation result", () => {
  it("distinguishes a pending memory suggestion from written long-term memory", () => {
    expect(formatReviewGenerationResult({ patchDraft: { id: "patch-1" }, memorySuggestionStatus: "created" })).toBe(
      "回顾已生成。1 条长期记忆建议已保存到“记忆审核”，尚未写入长期记忆。",
    );
  });

  it("reports replacement drafts together with their suggestion outcome", () => {
    expect(formatReviewGenerationResult({ replacementDraft: true, memorySuggestionStatus: "created" })).toBe(
      "新版本已生成，等待确认替换。当前回顾保持不变。1 条长期记忆建议已保存到“记忆审核”，尚未写入长期记忆。",
    );
    expect(formatReviewGenerationResult({ memorySuggestionStatus: "none" })).toBe(
      "回顾已生成。本次未发现需要长期保留的新信息。",
    );
    expect(formatReviewGenerationResult({ memorySuggestionStatus: "failed" })).toBe(
      "回顾已生成。长期记忆建议未生成，可稍后重试。",
    );
  });

  it("formats standalone suggestion outcomes", () => {
    expect(formatMemorySuggestionResult({ status: "created", patchDraft: { id: "patch-1" } as never })).toBe(
      "1 条长期记忆建议已保存到“记忆审核”，尚未写入长期记忆。",
    );
    expect(formatMemorySuggestionResult({ status: "cancelled" })).toBe(
      "长期记忆建议生成已取消，可稍后重试。",
    );
  });
});
