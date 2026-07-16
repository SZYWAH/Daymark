import {
  Check,
  ChevronRight,
  Clock3,
  Database,
  FileSearch,
  FolderSearch,
  Pause,
  RefreshCw,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ConversationScanRuntime } from "../lib/conversationScanTask";
import type { ConversationSessionScanProgressEvent } from "../lib/desktop";

type ConversationScanWorkspaceProps = {
  task: ConversationScanRuntime;
  onCollapse: () => void;
  onCancel: () => void;
  onViewResults: () => void;
  onRetry: () => void;
};

const STAGES = [
  { id: "discovering", label: "查找候选" },
  { id: "verifying", label: "核对日期" },
  { id: "completed", label: "保存结果" },
] as const;

export function ConversationScanWorkspace({
  task,
  onCollapse,
  onCancel,
  onViewResults,
  onRetry,
}: ConversationScanWorkspaceProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (task.status !== "running" && task.status !== "cancelling") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [task.status]);

  const progress = task.progress;
  const activeIndex = getActiveStageIndex(progress?.stage, task.status);
  const elapsed = Math.max(0, now - new Date(task.startedAt).getTime());
  const querySummary = formatQuerySummary(task);
  const stageLabel = getStageLabel(progress?.stage, task.status);

  return (
    <section
      className="review-generation-workspace absolute inset-0 z-40 isolate flex min-h-0 flex-col bg-paper"
      aria-label="会话扫描进度"
    >
      <header className="grid min-h-[116px] shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-line px-6 py-4">
        <div className="min-w-0 overflow-hidden">
          <p className="text-xs font-medium text-copper">本地会话扫描</p>
          <h2 className="mt-1 truncate text-xl font-semibold text-ink">AI 对话会话扫描</h2>
          <p className="mt-1 truncate text-sm text-ink/50" title={querySummary}>{querySummary}</p>
        </div>
        <div className="flex max-w-[520px] shrink-0 flex-wrap items-center justify-end gap-2">
          {task.status === "running" ? (
            <>
              <button className="secondary-action action-standard" onClick={onCollapse}>
                <Pause size={15} />
                收起并继续
              </button>
              <button className="danger-action action-standard" onClick={onCancel}>
                <X size={15} />
                取消扫描
              </button>
            </>
          ) : task.status === "cancelling" ? (
            <button className="secondary-action action-standard" disabled>
              <RefreshCw size={15} className="animate-spin" />
              正在取消
            </button>
          ) : task.status === "completed" ? (
            <button className="primary-button action-standard" onClick={onViewResults}>
              <ChevronRight size={15} />
              查看会话结果
            </button>
          ) : (
            <>
              <button className="secondary-action action-standard" onClick={onViewResults}>返回筛选</button>
              <button className="primary-button action-standard" onClick={onRetry}>
                <RefreshCw size={15} />
                重新扫描
              </button>
            </>
          )}
        </div>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-[1100px] flex-1 flex-col overflow-y-auto px-6 py-7 scrollbar-thin">
        <div className="shrink-0 border-y border-line py-7">
          <div className="mx-auto w-full max-w-[760px] text-center" aria-live="polite">
            <div className="text-xs font-medium text-ink/38">当前阶段</div>
            <div className="mt-2 flex min-h-[44px] items-center justify-center text-2xl font-semibold text-ink">
              {stageLabel}
            </div>
            <p className="mx-auto mt-2 min-h-[56px] max-w-2xl text-sm leading-7 text-ink/54">
              {task.message}
            </p>
            <div className="review-working-lines mx-auto mt-3 flex h-[30px] items-end justify-center gap-1" aria-hidden="true">
              {(task.status === "running" || task.status === "cancelling") && Array.from(
                { length: 12 },
                (_, index) => <span key={index} style={{ animationDelay: `${index * 70}ms` }} />,
              )}
            </div>
          </div>
        </div>

        <div className="review-trace-grid mt-6 grid shrink-0 grid-cols-3 gap-3">
          {STAGES.map((stage, index) => {
            const complete = task.status === "completed" || index < activeIndex;
            const active = task.status !== "completed" && index === activeIndex;
            return (
              <div key={stage.id} className={`review-trace-node ${complete ? "is-complete" : ""} ${active ? "is-active" : ""}`}>
                <span className="review-trace-dot" aria-hidden="true">{complete ? <Check size={13} /> : index + 1}</span>
                <span className="text-sm font-medium text-ink/72">{stage.label}</span>
              </div>
            );
          })}
        </div>

        <div className="mt-6 grid shrink-0 gap-3 border-t border-line pt-6 sm:grid-cols-2 xl:grid-cols-4">
          <ScanMetric
            icon={FolderSearch}
            label="会话进度"
            value={progress?.sessionCount ? `${progress.sessionIndex}/${progress.sessionCount}` : "正在统计"}
          />
          <ScanMetric
            icon={FileSearch}
            label="已检查数据"
            value={progress ? formatBytes(progress.processedBytes) : "等待读取"}
          />
          <ScanMetric
            icon={Database}
            label="核对结果"
            value={progress ? `命中 ${progress.matchedCount} / 排除 ${progress.excludedCount}` : "等待核对"}
          />
          <ScanMetric icon={Clock3} label="运行时间" value={formatElapsed(elapsed)} />
        </div>

        <div className="mt-4 grid shrink-0 gap-3 sm:grid-cols-2">
          <ScanMetric
            icon={Database}
            label="候选会话"
            value={`${progress?.candidateCount ?? task.result?.candidateCount ?? 0} 个`}
          />
          <ScanMetric
            icon={Check}
            label="索引缓存"
            value={`${progress?.cacheHitCount ?? task.result?.cacheHitCount ?? 0} 次命中`}
          />
        </div>
      </div>
    </section>
  );
}

function ScanMetric({ icon: Icon, label, value }: { icon: typeof Clock3; label: string; value: string }) {
  return (
    <div className="flex min-h-16 items-center gap-3 border border-line bg-panel/50 px-4 py-3">
      <Icon size={17} className="shrink-0 text-accent" />
      <div className="min-w-0">
        <div className="text-xs text-ink/42">{label}</div>
        <div className="mt-1 truncate text-sm font-semibold text-ink">{value}</div>
      </div>
    </div>
  );
}

function getActiveStageIndex(stage: ConversationSessionScanProgressEvent["stage"] | undefined, status: ConversationScanRuntime["status"]) {
  if (status === "completed" || stage === "completed") return 2;
  if (stage === "verifying" || stage === "background") return 1;
  return 0;
}

function getStageLabel(stage: ConversationSessionScanProgressEvent["stage"] | undefined, status: ConversationScanRuntime["status"]) {
  if (status === "cancelling") return "正在安全停止";
  if (status === "cancelled") return "扫描已取消";
  if (status === "failed") return "扫描遇到问题";
  if (status === "completed" || stage === "completed") return "扫描完成";
  if (stage === "verifying") return "核对消息活动日期";
  if (stage === "background") return "补全日期索引";
  if (stage === "candidates") return "准备精确核对";
  return "查找候选会话";
}

function formatQuerySummary(task: ConversationScanRuntime) {
  const source = task.query.sourceFilter === "all"
    ? "Codex 和 Claude Code"
    : task.query.sourceFilter === "claude" ? "Claude Code" : "Codex";
  const date = task.query.dateFrom || task.query.dateTo
    ? `${task.query.dateFrom || "最早"} 至 ${task.query.dateTo || "现在"}`
    : "全部活动日期";
  const filters = [task.query.cwdQuery && `路径 ${task.query.cwdQuery}`, task.query.keyword && `关键词 ${task.query.keyword}`].filter(Boolean);
  return [source, date, ...filters].join(" / ");
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatElapsed(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1_000);
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  return minutes > 0 ? `${minutes}分 ${restSeconds}秒` : `${restSeconds}秒`;
}
