import { BookOpenText, Bot, Loader2, Save, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { CodexReviewProgress } from "../ai/deepseek";
import { getSafeErrorMessage } from "../lib/redaction";
import type { AutoWorkReviewSettings, RollingWorkReview } from "../types";

export function AutoWorkReviewStatusRow({
  settings,
  review,
  running,
  progress,
  onRun,
  onOpen,
  onOpenSettings,
}: {
  settings: AutoWorkReviewSettings | null;
  review: RollingWorkReview | null;
  running: boolean;
  progress: CodexReviewProgress | null;
  onRun: () => Promise<unknown>;
  onOpen: () => void;
  onOpenSettings: () => void;
}) {
  const enabled = Boolean(settings?.enabled);
  const content = review?.content.trim();
  const sourceText = settings?.sourceKinds.includes("codex") && settings.sourceKinds.includes("claude")
    ? "Codex, Claude Code"
    : settings?.sourceKinds.includes("claude")
      ? "Claude Code"
      : "Codex";
  const statusText = running
    ? progress?.message || "正在更新今日工作内容。"
    : enabled
      ? settings?.lastMessage || "已开启，Daymark 运行期间每 30 分钟自动更新。"
      : "未开启；可在设置页启用自动工作回顾。";

  return (
    <div className="rounded-[8px] border border-line bg-panel/70 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-ink/70">
            <Bot size={14} className="text-copper" />
            <span>自动工作回顾</span>
            <span className={`quiet-chip py-0.5 text-[11px] ${enabled ? "text-moss" : "text-ink/42"}`}>
              {running ? "更新中" : enabled ? content ? "已生成" : "待更新" : "未开启"}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink/45">{statusText}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {content && (
            <button className="soft-button action-compact" onClick={onOpen}>
              查看
            </button>
          )}
          <button
            className="soft-button action-compact disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!enabled || running}
            onClick={() => void onRun()}
          >
            {running ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {running ? "更新中" : "立即更新"}
          </button>
          {!enabled && (
            <button className="soft-button action-compact" onClick={onOpenSettings}>
              去设置
            </button>
          )}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-ink/38">
        <span>{sourceText}</span>
        {review?.lastRunAt && <span>更新于 {review.lastRunAt}</span>}
        {review && <span>{review.processedSessionCount} 次会话增量</span>}
        {review && <span>{review.processedChars.toLocaleString("zh-CN")} 字符</span>}
        {review?.archiveReviewId && <span>已归档</span>}
      </div>
    </div>
  );
}
export function RollingWorkReviewReaderOverlay({
  review,
  running,
  progress,
  publishedItemId,
  onClose,
  onRun,
  onArchive,
  onPublishDailyReview,
}: {
  review: RollingWorkReview;
  running: boolean;
  progress: CodexReviewProgress | null;
  publishedItemId?: string;
  onClose: () => void;
  onRun: () => Promise<unknown>;
  onArchive: (date: string) => Promise<unknown>;
  onPublishDailyReview: (reviewId: string) => Promise<void> | void;
}) {
  const [archiving, setArchiving] = useState(false);
  const [message, setMessage] = useState("");
  const archived = Boolean(review.archiveReviewId);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const archive = async () => {
    if (archiving || archived) return;
    setArchiving(true);
    setMessage("");
    try {
      await onArchive(review.date);
      setMessage("已保存到回顾档案。");
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "保存到回顾档案失败。"));
    } finally {
      setArchiving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 px-6 py-8 backdrop-blur-sm" role="presentation">
      <section
        aria-label="自动工作回顾"
        aria-modal="true"
        className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-[8px] border border-line bg-paper shadow-panel"
        role="dialog"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-copper">Auto Review</div>
            <h2 className="mt-1 truncate text-xl font-semibold text-ink">{review.title}</h2>
            <p className="mt-1 text-xs leading-5 text-ink/45">
              {review.date}
              {review.lastRunAt ? ` · 更新于 ${review.lastRunAt}` : ""}
              {` · ${review.processedSessionCount} 次会话增量 · ${review.processedChars.toLocaleString("zh-CN")} 字符`}
            </p>
          </div>
          <button className="soft-button icon-action-compact" onClick={onClose} title="关闭" aria-label="关闭">
            <X size={15} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">
          <article className="whitespace-pre-wrap text-anywhere text-sm leading-7 text-ink/72">
            {review.content}
          </article>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
          <div className="text-xs text-ink/45">
            {message || progress?.message || (archived ? "已保存到回顾档案。" : "自动草稿已在本机保存，可按需归档。")}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {review.archiveReviewId && (
              <button
                className="soft-button action-compact"
                onClick={() => void onPublishDailyReview(review.archiveReviewId!)}
              >
                <BookOpenText size={13} />
                {publishedItemId ? "查看资料" : "保存到资料库"}
              </button>
            )}
            <button
              className="soft-button action-compact disabled:cursor-not-allowed disabled:opacity-50"
              disabled={running}
              onClick={() => void onRun()}
            >
              {running ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {running ? "更新中" : "立即更新"}
            </button>
            <button
              className="primary-action action-compact disabled:cursor-not-allowed disabled:opacity-60"
              disabled={archived || archiving}
              onClick={() => void archive()}
            >
              <Save size={13} />
              {archived ? "已归档" : archiving ? "归档中" : "保存到回顾档案"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
