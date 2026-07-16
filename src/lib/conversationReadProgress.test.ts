import { describe, expect, it } from "vitest";
import { toConversationReadProgressView } from "./conversationReadProgress";

describe("conversation read progress", () => {
  it("maps locating progress without exposing local content", () => {
    expect(
      toConversationReadProgressView({
        stage: "locating",
        sessionIndex: 2,
        sessionCount: 3,
        processedBytes: 25,
        totalBytes: 100,
        messageCount: 0,
        extractedChars: 0,
      }),
    ).toEqual({
      stage: "读取会话",
      message: "正在查找第 2/3 个会话的日期边界 · 已检查 25 B",
      indicator: { mode: "indeterminate" },
    });
  });

  it("maps reading and completed progress to stable status text", () => {
    expect(
      toConversationReadProgressView({
        stage: "reading",
        sessionIndex: 1,
        sessionCount: 1,
        processedBytes: 80,
        totalBytes: 100,
        messageCount: 12,
        extractedChars: 4800,
      }),
    ).toMatchObject({
      message: "正在读取第 1/1 个会话 · 80% · 已提取 12 条消息",
      indicator: { mode: "determinate", percent: 80 },
    });
    expect(
      toConversationReadProgressView({
        stage: "completed",
        sessionIndex: 1,
        sessionCount: 1,
        processedBytes: 100,
        totalBytes: 100,
        messageCount: 12,
        extractedChars: 4800,
      }),
    ).toMatchObject({
      message: "已读取第 1/1 个会话 · 12 条消息",
      indicator: { mode: "completed", percent: 100 },
    });
  });
});
