import { describe, expect, it } from "vitest";
import {
  createConversationScanKey,
  DEFAULT_CONVERSATION_SCAN_QUERY,
  normalizeConversationScanQuery,
  shouldShowConversationScanEntry,
  toConversationScanOptions,
  type ConversationScanRuntime,
} from "./conversationScanTask";

const task: ConversationScanRuntime = {
  jobId: "scan-1",
  status: "running",
  query: DEFAULT_CONVERSATION_SCAN_QUERY,
  scanKey: createConversationScanKey(DEFAULT_CONVERSATION_SCAN_QUERY),
  startedAt: "2026-07-16T10:00:00.000Z",
  message: "正在查找候选会话。",
};

describe("conversation scan task", () => {
  it("normalizes query values before creating the stable key", () => {
    const query = { ...DEFAULT_CONVERSATION_SCAN_QUERY, dateFrom: " 2026-07-16 ", keyword: " 日报 " };
    expect(normalizeConversationScanQuery(query)).toEqual({
      ...DEFAULT_CONVERSATION_SCAN_QUERY,
      dateFrom: "2026-07-16",
      keyword: "日报",
    });
    expect(createConversationScanKey(query)).toBe(createConversationScanKey(normalizeConversationScanQuery(query)));
  });

  it("maps the all-source query to both supported sources", () => {
    expect(toConversationScanOptions(DEFAULT_CONVERSATION_SCAN_QUERY)).toMatchObject({
      sourceKinds: ["codex", "claude"],
      limit: 800,
    });
  });

  it("shows the collapsed entry outside the AI review console only", () => {
    expect(shouldShowConversationScanEntry({ kind: "today" }, task, false)).toBe(true);
    expect(shouldShowConversationScanEntry({ kind: "memory", subView: "archive" }, task, false)).toBe(true);
    expect(shouldShowConversationScanEntry({ kind: "memory", subView: "ai-review" }, task, false)).toBe(false);
    expect(shouldShowConversationScanEntry({ kind: "today" }, task, true)).toBe(false);
    expect(shouldShowConversationScanEntry({ kind: "today" }, null, false)).toBe(false);
  });
});
