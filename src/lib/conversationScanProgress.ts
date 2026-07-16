import type { ConversationSessionScanProgressEvent } from "./desktop";

export function formatConversationScanProgress(
  event: ConversationSessionScanProgressEvent,
  scopeLabel: string,
) {
  if (event.stage === "discovering") {
    const totalText = event.sessionCount > 0 ? ` ${event.sessionIndex}/${event.sessionCount}` : "";
    return `正在查找候选会话${totalText} · 当前符合 ${event.candidateCount} 个`;
  }
  if (event.stage === "candidates") {
    return `找到 ${event.candidateCount} 个候选会话，正在本地核对${scopeLabel}。`;
  }
  if (event.stage === "verifying") {
    const cacheText = event.cacheHitCount > 0 ? ` · 缓存命中 ${event.cacheHitCount}` : "";
    return `正在核对${scopeLabel} ${event.sessionIndex}/${event.sessionCount} · 已检查 ${formatScanBytes(event.processedBytes)}${cacheText} · 精确命中 ${event.matchedCount} · 排除 ${event.excludedCount}`;
  }
  if (event.stage === "background") {
    return `正在空闲补全会话日期索引 ${event.sessionIndex}/${event.sessionCount} · 已检查 ${formatScanBytes(event.processedBytes)}`;
  }
  return `${scopeLabel}核对完成 · 精确命中 ${event.matchedCount} · 排除 ${event.excludedCount}`;
}

function formatScanBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
