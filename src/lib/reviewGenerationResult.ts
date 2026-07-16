import type { MemorySuggestionGenerationResult, MemorySuggestionStatus } from "../types";

export type ReviewGenerationResultState = {
  patchDraft?: unknown;
  replacementDraft?: boolean;
  memorySuggestionStatus?: MemorySuggestionStatus;
};

export function formatReviewGenerationResult(result: ReviewGenerationResultState) {
  const prefix = result.replacementDraft
    ? "新版本已生成，等待确认替换。当前回顾保持不变。"
    : "回顾已生成。";
  return `${prefix}${formatMemorySuggestionResult({
    status: result.memorySuggestionStatus ?? (result.patchDraft ? "created" : "failed"),
    patchDraft: result.patchDraft as MemorySuggestionGenerationResult["patchDraft"],
  })}`;
}

export function formatMemorySuggestionResult(result: MemorySuggestionGenerationResult) {
  switch (result.status) {
    case "created":
      return "1 条长期记忆建议已保存到“记忆审核”，尚未写入长期记忆。";
    case "none":
      return "本次未发现需要长期保留的新信息。";
    case "cancelled":
      return "长期记忆建议生成已取消，可稍后重试。";
    case "failed":
    default:
      return "长期记忆建议未生成，可稍后重试。";
  }
}
