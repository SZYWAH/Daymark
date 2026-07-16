import { getEffectiveAiSettings, streamUpdateRollingWorkReview, type CodexReviewProgress } from "../ai/deepseek";
import {
  formatTimestamp,
  getAutoWorkReviewCursorsBySessionIds,
  getRollingWorkReviewByDate,
  saveAutoWorkReviewSettings,
  upsertAutoWorkReviewCursors,
  upsertRollingWorkReview,
} from "../data/itemStore";
import type {
  AiSettings,
  AutoWorkReviewCursor,
  AutoWorkReviewSettings,
  CodexSessionIndex,
  ConversationSessionDelta,
  ConversationSourceKind,
  RollingWorkReview,
} from "../types";
import {
  cancelConversationReviewJob,
  isDesktopRuntime,
  readConversationSessionDeltas,
  scanConversationSessionsExact,
} from "./desktop";
import { getSafeErrorMessage } from "./redaction";

export type AutoWorkReviewRunResult = {
  status: "skipped" | "success" | "empty" | "error";
  message: string;
  review?: RollingWorkReview;
  deltas?: ConversationSessionDelta[];
};

type RunAutoWorkReviewOptions = {
  settings: AiSettings | null;
  autoSettings: AutoWorkReviewSettings;
  date?: string;
  signal?: AbortSignal;
  onProgress?: (progress: CodexReviewProgress) => void;
};

export async function runAutoWorkReviewOnce(options: RunAutoWorkReviewOptions): Promise<AutoWorkReviewRunResult> {
  const date = options.date ?? toDateKey(new Date());
  if (!options.autoSettings.enabled) {
    return { status: "skipped", message: "自动工作回顾未开启。" };
  }
  if (!isDesktopRuntime()) {
    await saveAutoWorkReviewSettings({ lastStatus: "paused", lastMessage: "自动工作回顾需要桌面端运行。" });
    return { status: "skipped", message: "自动工作回顾需要桌面端运行。" };
  }
  if (!options.settings || getEffectiveAiSettings(options.settings).keySource === "missing") {
    await saveAutoWorkReviewSettings({ lastStatus: "paused", lastMessage: "未配置 API Key，自动工作回顾暂停。" });
    return { status: "skipped", message: "未配置 API Key，自动工作回顾暂停。" };
  }

  await saveAutoWorkReviewSettings({ lastStatus: "running", lastMessage: "正在检查今日 AI 对话增量。" });
  try {
    const sourceKinds = normalizeSourceKinds(options.autoSettings.sourceKinds);
    const scanJobId = createJobId();
    const cancelScan = () => void cancelConversationReviewJob(scanJobId);
    options.signal?.addEventListener("abort", cancelScan, { once: true });
    let sessions: CodexSessionIndex[];
    try {
      const scanResult = await scanConversationSessionsExact(
        {
          sourceKinds,
          dateFrom: date,
          dateTo: date,
          limit: 800,
        },
        scanJobId,
      );
      sessions = scanResult.sessions;
    } finally {
      options.signal?.removeEventListener("abort", cancelScan);
    }
    if (sessions.length === 0) {
      const message = "今天还没有发现可用于自动回顾的 AI 对话。";
      await saveAutoWorkReviewSettings({ lastRunAt: formatTimestamp(), lastStatus: "success", lastMessage: message });
      return { status: "empty", message };
    }

    const cursors = await getAutoWorkReviewCursorsBySessionIds(sessions.map((session) => session.id));
    const cursorMap = new Map(cursors.map((cursor) => [cursor.sessionId, cursor]));
    const readJobId = createJobId();
    const cancelRead = () => void cancelConversationReviewJob(readJobId);
    options.signal?.addEventListener("abort", cancelRead, { once: true });
    let deltas: ConversationSessionDelta[];
    try {
      deltas = await readConversationSessionDeltas(
        sessions.map((session) => session.id),
        sessions.map((session) => ({
          sessionId: session.id,
          readOffset: cursorMap.get(session.id)?.readOffset ?? 0,
        })),
        readJobId,
        { activityDateFrom: date, activityDateTo: date },
      );
    } finally {
      options.signal?.removeEventListener("abort", cancelRead);
    }
    const skippedOversizedRecords = deltas.reduce(
      (sum, delta) => sum + (delta.skippedOversizedRecordCount ?? 0),
      0,
    );
    const oversizedWarning = skippedOversizedRecords > 0
      ? `有 ${skippedOversizedRecords} 条超过 32 MB 的单条会话记录未纳入回顾。`
      : "";
    const usefulDeltas = deltas.filter((delta) => delta.transcript.trim() && delta.messageCount > 0);

    if (usefulDeltas.length === 0) {
      await upsertAutoWorkReviewCursors(buildCursorUpdates(deltas));
      const message = oversizedWarning || "今天的 AI 对话暂无新增正文。";
      await saveAutoWorkReviewSettings({ lastRunAt: formatTimestamp(), lastStatus: "success", lastMessage: message });
      return { status: "empty", message, deltas };
    }

    const currentReview = await getRollingWorkReviewByDate(date);
    const addedChars = usefulDeltas.reduce((sum, delta) => sum + delta.charCount, 0);
    const nextProcessedSessionCount =
      (currentReview?.processedSessionCount ?? 0) + new Set(usefulDeltas.map((delta) => delta.sessionId)).size;
    const nextProcessedChars = (currentReview?.processedChars ?? 0) + addedChars;
    const summary = await streamUpdateRollingWorkReview(
      {
        date,
        currentContent: currentReview?.content ?? "",
        sourceKinds,
        deltas: usefulDeltas,
        processedSessionCount: nextProcessedSessionCount,
        processedChars: nextProcessedChars,
        redacted: usefulDeltas.some((delta) => delta.redacted),
        truncated: usefulDeltas.some((delta) => delta.truncated),
      },
      options.settings,
      (progress) => options.onProgress?.(progress),
      options.signal,
    );
    const review = await upsertRollingWorkReview({
      date,
      title: summary.title,
      content: summary.content,
      sourceKinds,
      processedSessionCount: nextProcessedSessionCount,
      processedChars: nextProcessedChars,
      lastRunAt: formatTimestamp(),
      status: "ready",
      message: `已合并 ${usefulDeltas.length} 个会话增量。`,
    });
    await upsertAutoWorkReviewCursors(buildCursorUpdates(deltas));
    const message = `已更新今日工作内容，合并 ${usefulDeltas.length} 个会话增量。${oversizedWarning ? ` ${oversizedWarning}` : ""}`;
    await saveAutoWorkReviewSettings({ lastRunAt: formatTimestamp(), lastStatus: "success", lastMessage: message });
    return { status: "success", message, review, deltas };
  } catch (error) {
    if (options.signal?.aborted) {
      const message = "自动工作回顾已取消。";
      await saveAutoWorkReviewSettings({ lastStatus: "paused", lastMessage: message });
      return { status: "skipped", message };
    }
    const message = getSafeErrorMessage(error, "自动工作回顾失败。");
    await saveAutoWorkReviewSettings({ lastRunAt: formatTimestamp(), lastStatus: "error", lastMessage: message });
    const currentReview = await getRollingWorkReviewByDate(date);
    if (currentReview) {
      await upsertRollingWorkReview({ ...currentReview, status: "error", message });
    }
    return { status: "error", message };
  }
}

export function toDateKey(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function normalizeSourceKinds(sourceKinds: ConversationSourceKind[]) {
  const normalized = Array.from(
    new Set(sourceKinds.filter((source): source is ConversationSourceKind => source === "codex" || source === "claude")),
  );
  return normalized.length > 0 ? normalized : (["codex", "claude"] as ConversationSourceKind[]);
}

function buildCursorUpdates(deltas: ConversationSessionDelta[]): AutoWorkReviewCursor[] {
  const now = formatTimestamp();
  return deltas.map((delta) => ({
    sessionId: delta.sessionId,
    path: delta.path,
    sourceKind: delta.sourceKind,
    date: delta.date,
    readOffset: delta.nextReadOffset,
    modifiedAt: delta.modifiedAt,
    lastProcessedAt: now,
    error: "",
    updatedAt: now,
  }));
}

function createJobId() {
  return `auto-work-review-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
