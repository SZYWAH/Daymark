import type { ConversationSourceKind } from "../types";

export type ConversationReviewPrimaryActionId =
  | "open-review-progress"
  | "open-scan-progress"
  | "scan"
  | "configure-ai"
  | "generate";

export function resolveConversationReviewPrimaryAction(input: {
  desktop: boolean;
  reviewRunning: boolean;
  scanActive: boolean;
  scanCancelling: boolean;
  scanIsCurrent: boolean;
  hasSavedSessions: boolean;
  selectedCount: number;
  aiReady: boolean;
}) {
  if (input.reviewRunning) {
    return { id: "open-review-progress" as const, label: "查看生成进度", disabled: false };
  }
  if (input.scanActive) {
    return {
      id: "open-scan-progress" as const,
      label: input.scanCancelling ? "查看取消进度" : "查看扫描进度",
      disabled: false,
    };
  }
  if (!input.scanIsCurrent) {
    return {
      id: "scan" as const,
      label: input.hasSavedSessions ? "重新扫描会话" : "扫描会话",
      disabled: !input.desktop,
    };
  }
  if (input.selectedCount === 0) {
    return { id: "generate" as const, label: "生成所选回顾", disabled: true };
  }
  if (!input.aiReady) {
    return { id: "configure-ai" as const, label: "前往 AI 设置", disabled: false };
  }
  return { id: "generate" as const, label: "生成所选回顾", disabled: !input.desktop };
}

export function isConversationSourceLocked(
  selectedSource: ConversationSourceKind | undefined,
  candidateSource: ConversationSourceKind,
) {
  return Boolean(selectedSource && selectedSource !== candidateSource);
}

export function resolveCollapsedConversationTaskEntry(input: {
  reviewEntryVisible: boolean;
  reviewRunning: boolean;
  scanEntryVisible: boolean;
}) {
  if (input.reviewEntryVisible && input.reviewRunning) return "review" as const;
  if (input.scanEntryVisible) return "scan" as const;
  if (input.reviewEntryVisible) return "review" as const;
  return null;
}
