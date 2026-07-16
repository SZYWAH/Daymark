import { describe, expect, it } from "vitest";
import { formatConversationScanProgress } from "./conversationScanProgress";

describe("conversation scan progress", () => {
  it("formats candidate discovery without exposing local paths", () => {
    const text = formatConversationScanProgress(
      {
        stage: "discovering",
        candidateCount: 12,
        sessionIndex: 20,
        sessionCount: 40,
        processedBytes: 0,
        cacheHitCount: 0,
        matchedCount: 0,
        excludedCount: 0,
      },
      "活动日期",
    );

    expect(text).toContain("20/40");
    expect(text).toContain("12 个");
    expect(text).not.toContain("C:\\Users");
  });

  it("describes candidate discovery without exposing content", () => {
    const text = formatConversationScanProgress(
      {
        stage: "candidates",
        candidateCount: 42,
        sessionIndex: 0,
        sessionCount: 42,
        processedBytes: 0,
        cacheHitCount: 0,
        matchedCount: 0,
        excludedCount: 0,
      },
      "活动日期",
    );
    expect(text).toBe("找到 42 个候选会话，正在本地核对活动日期。");
  });

  it("reports aggregate verification and cache metrics", () => {
    const text = formatConversationScanProgress(
      {
        stage: "verifying",
        candidateCount: 42,
        sessionIndex: 12,
        sessionCount: 42,
        processedBytes: 64 * 1024 * 1024,
        cacheHitCount: 7,
        matchedCount: 9,
        excludedCount: 3,
      },
      "活动日期",
    );
    expect(text).toContain("正在核对活动日期 12/42");
    expect(text).toContain("已检查 64.0 MB");
    expect(text).toContain("缓存命中 7");
    expect(text).toContain("精确命中 9 · 排除 3");
    expect(text).not.toContain("path");
    expect(text).not.toContain("正文");
  });
});
