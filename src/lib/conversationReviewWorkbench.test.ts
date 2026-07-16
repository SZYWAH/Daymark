import { describe, expect, it } from "vitest";
import {
  isConversationSourceLocked,
  resolveCollapsedConversationTaskEntry,
  resolveConversationReviewPrimaryAction,
} from "./conversationReviewWorkbench";

const base = {
  desktop: true,
  reviewRunning: false,
  scanActive: false,
  scanCancelling: false,
  scanIsCurrent: true,
  hasSavedSessions: true,
  selectedCount: 1,
  aiReady: true,
};

describe("conversation review workbench", () => {
  it("keeps one primary action for every task state", () => {
    expect(resolveConversationReviewPrimaryAction({ ...base, reviewRunning: true }).id).toBe("open-review-progress");
    expect(resolveConversationReviewPrimaryAction({ ...base, scanActive: true }).id).toBe("open-scan-progress");
    expect(resolveConversationReviewPrimaryAction({ ...base, scanIsCurrent: false }).id).toBe("scan");
    expect(resolveConversationReviewPrimaryAction({ ...base, selectedCount: 0 }).disabled).toBe(true);
    expect(resolveConversationReviewPrimaryAction({ ...base, aiReady: false }).id).toBe("configure-ai");
    expect(resolveConversationReviewPrimaryAction(base).id).toBe("generate");
  });

  it("changes the scan label when saved results need refreshing", () => {
    expect(resolveConversationReviewPrimaryAction({ ...base, scanIsCurrent: false, hasSavedSessions: true }).label).toBe("重新扫描会话");
    expect(resolveConversationReviewPrimaryAction({ ...base, scanIsCurrent: false, hasSavedSessions: false }).label).toBe("扫描会话");
  });

  it("locks only the source different from the current selection", () => {
    expect(isConversationSourceLocked(undefined, "claude")).toBe(false);
    expect(isConversationSourceLocked("codex", "codex")).toBe(false);
    expect(isConversationSourceLocked("codex", "claude")).toBe(true);
  });

  it("shows only one collapsed task entry and prioritizes an active generation", () => {
    expect(resolveCollapsedConversationTaskEntry({
      reviewEntryVisible: true,
      reviewRunning: true,
      scanEntryVisible: true,
    })).toBe("review");
    expect(resolveCollapsedConversationTaskEntry({
      reviewEntryVisible: true,
      reviewRunning: false,
      scanEntryVisible: true,
    })).toBe("scan");
    expect(resolveCollapsedConversationTaskEntry({
      reviewEntryVisible: true,
      reviewRunning: false,
      scanEntryVisible: false,
    })).toBe("review");
    expect(resolveCollapsedConversationTaskEntry({
      reviewEntryVisible: false,
      reviewRunning: false,
      scanEntryVisible: false,
    })).toBeNull();
  });
});
