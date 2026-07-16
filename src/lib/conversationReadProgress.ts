import type { ConversationReadProgressEvent } from "./desktop";

export type ConversationReadProgressView = {
  stage: "读取会话";
  message: string;
  indicator: {
    mode: "indeterminate" | "determinate" | "completed";
    percent?: number;
  };
};

function progressPercent(processedBytes: number, totalBytes: number) {
  if (totalBytes <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((processedBytes / totalBytes) * 100)));
}

function formatProcessedBytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const digits = size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
}

export function toConversationReadProgressView(
  event: ConversationReadProgressEvent,
): ConversationReadProgressView {
  const position = `第 ${event.sessionIndex}/${event.sessionCount} 个会话`;
  const percent = progressPercent(event.processedBytes, event.totalBytes);

  if (event.stage === "locating") {
    return {
      stage: "读取会话",
      message: `正在查找${position}的日期边界 · 已检查 ${formatProcessedBytes(event.processedBytes)}`,
      indicator: { mode: "indeterminate" },
    };
  }
  if (event.stage === "reading") {
    return {
      stage: "读取会话",
      message: `正在读取${position} · ${percent}% · 已提取 ${event.messageCount} 条消息`,
      indicator: { mode: "determinate", percent },
    };
  }
  return {
    stage: "读取会话",
    message: `已读取${position} · ${event.messageCount} 条消息`,
    indicator: { mode: "completed", percent: 100 },
  };
}
