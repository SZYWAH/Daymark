import {
  Check,
  ChevronRight,
  Clock3,
  FileStack,
  Pause,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CodexReviewProgress } from "../ai/deepseek";
import type {
  ConversationReviewGenerationRequest,
  GenerationDraftStatus,
  ReviewGenerationTaskCheckpointV1,
} from "../types";

export type ReviewGenerationRuntime = {
  draftId: string;
  request: ConversationReviewGenerationRequest;
  status: GenerationDraftStatus;
  checkpoint: ReviewGenerationTaskCheckpointV1;
  progress?: CodexReviewProgress;
  message: string;
  startedAt: string;
  sessionCount: number;
  messageCount: number;
  extractedChars: number;
  retryCount: number;
  resultReviewId?: string;
  resultReviewDraftId?: string;
};

type ReviewGenerationWorkspaceProps = {
  task: ReviewGenerationRuntime;
  onCollapse: () => void;
  onCancel: () => void;
  onResume: () => void;
  onRestart: () => void;
  onDelete: () => void;
  onOpenResult: () => void;
  onRetryMemorySuggestion: () => void;
};

type WorkspaceStageId = "locating" | ReviewGenerationTaskCheckpointV1["stage"];

const STAGES: Array<{
  id: WorkspaceStageId;
  label: string;
}> = [
  { id: "locating", label: "定位日期" },
  { id: "reading", label: "读取会话" },
  { id: "summarizing", label: "整理分段" },
  { id: "compacting", label: "压缩摘要" },
  { id: "synthesizing", label: "合成回顾" },
  { id: "memory-suggestion", label: "分析长期记忆" },
  { id: "completed", label: "完成" },
];

const STAGE_INDEX = new Map(STAGES.map((stage, index) => [stage.id, index]));

export function ReviewGenerationWorkspace({
  task,
  onCollapse,
  onCancel,
  onResume,
  onRestart,
  onDelete,
  onOpenResult,
  onRetryMemorySuggestion,
}: ReviewGenerationWorkspaceProps) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (task.status !== "running") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [task.status]);

  const elapsed = Math.max(0, now - new Date(task.startedAt).getTime());
  const workspaceStage: WorkspaceStageId = task.checkpoint.stage === "reading" && task.progress?.indicator?.mode === "indeterminate"
    ? "locating"
    : task.checkpoint.stage;
  const activeIndex = STAGE_INDEX.get(workspaceStage) ?? 0;
  const completedSegments = task.checkpoint.completedChunkCount;
  const totalSegments = task.checkpoint.chunkCount;
  const memorySuggestion = task.checkpoint.memorySuggestion;
  const memorySuggestionStatus = memorySuggestion?.status ?? task.checkpoint.memorySuggestionStatus;
  const memorySuggestionNeedsAttention =
    task.status === "completed" &&
    (memorySuggestionStatus === "failed" || memorySuggestionStatus === "cancelled");
  const totalRetryCount = Math.max(
    task.retryCount,
    task.checkpoint.retryCount + (memorySuggestion?.retryCount ?? 0),
  );
  const stagePercent = totalSegments > 0
    ? Math.min(100, Math.round((completedSegments / totalSegments) * 100))
    : 0;
  const statusLabel = useMemo(() => {
    if (task.status === "failed") return "任务暂停在错误处";
    if (task.status === "cancelled") return "任务已取消，可从检查点继续";
    if (task.status === "paused") return "任务已暂停";
    if (memorySuggestionNeedsAttention) return "回顾已保存，长期记忆建议未生成";
    if (task.status === "completed") return "回顾已生成";
    return "正在处理";
  }, [memorySuggestionNeedsAttention, task.status]);

  return (
    <section className="review-generation-workspace absolute inset-0 z-40 isolate flex min-h-0 flex-col bg-paper" aria-label="回顾生成进度">
      <header className="grid min-h-[116px] shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-line px-6 py-4">
        <div className="min-w-0 overflow-hidden">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-copper">Review Process</p>
          <h2 className="mt-1 truncate text-xl font-semibold text-ink">正在整理 {task.request.date} 的工作回顾</h2>
          <p className="mt-1 truncate text-sm text-ink/50" title={`${statusLabel} · ${task.message}`}>
            {statusLabel} · {task.message}
          </p>
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
                取消任务
              </button>
            </>
          ) : memorySuggestionNeedsAttention ? (
            <>
              <button className="secondary-action action-standard" onClick={onOpenResult}>
                <ChevronRight size={15} />
                查看回顾
              </button>
              <button className="primary-button action-standard" onClick={onRetryMemorySuggestion}>
                <RefreshCw size={15} />
                重试长期记忆建议
              </button>
              <button className="secondary-action action-standard" onClick={onCollapse}>稍后处理</button>
            </>
          ) : task.status === "completed" ? (
            <>
              <button className="primary-button action-standard" onClick={onOpenResult}>
                <ChevronRight size={15} />
                查看结果
              </button>
              <button className="secondary-action action-standard" onClick={onCollapse}>关闭</button>
            </>
          ) : (
            <>
              <button className="primary-button action-standard" onClick={onResume}>
                <RefreshCw size={15} />
                继续生成
              </button>
              <button className="secondary-action action-standard" onClick={onRestart}>
                <RotateCcw size={15} />
                重新开始
              </button>
              <button className="ghost-action action-standard" onClick={onDelete} title="删除任务">
                <Trash2 size={15} />
              </button>
            </>
          )}
        </div>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-[1180px] flex-1 flex-col overflow-y-auto px-6 py-7 scrollbar-thin">
        <div className="shrink-0 border-y border-line py-6">
          <div className="mx-auto w-full max-w-[780px] text-center">
            <div className="mx-auto w-full max-w-[780px]">
              <div className="flex h-[18px] items-center justify-center text-xs font-medium uppercase tracking-[0.16em] text-ink/38">
                当前阶段
              </div>
              <div className="flex h-[44px] items-center justify-center text-2xl font-semibold text-ink">
                <span className="line-clamp-1">{task.progress?.stage ?? STAGES[activeIndex]?.label}</span>
              </div>
              <div className="flex h-[56px] items-start justify-center overflow-hidden px-4 pt-1">
                <p className="line-clamp-2 max-w-2xl text-sm leading-7 text-ink/54">
                  {task.progress?.message ?? task.message}
                </p>
              </div>
              <div className="h-[58px]">
                {task.checkpoint.stage === "summarizing" && totalSegments > 0 && (
                  <div className="mx-auto w-full max-w-[560px] pt-3">
                    <div className="h-1 overflow-hidden bg-line/70">
                      <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${stagePercent}%` }} />
                    </div>
                    <div className="mt-2 flex justify-between text-xs text-ink/40">
                      <span>{completedSegments} 段已保存</span>
                      <span>{stagePercent}%</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="review-working-lines mx-auto flex h-[30px] items-end justify-center gap-1" aria-hidden="true">
                {task.status === "running" && Array.from(
                  { length: 12 },
                  (_, index) => <span key={index} style={{ animationDelay: `${index * 70}ms` }} />,
                )}
              </div>
              <div className="flex h-[32px] items-end justify-center">
                <p className={`text-xs text-ink/40 ${totalRetryCount > 0 ? "visible" : "invisible"}`}>
                  已自动重试 {totalRetryCount} 次；已完成分段不会重复发送。
                </p>
              </div>
            </div>
            {memorySuggestionNeedsAttention && (
              <div className="mx-auto mt-5 w-full max-w-[620px] border-t border-line pt-5 text-left">
                <p className="text-sm font-medium text-ink">回顾已经保存，可以先查看或稍后继续。</p>
                <p className="mt-1 text-sm leading-6 text-ink/52">
                  重新生成长期记忆建议只会读取已保存的回顾，不会重新读取会话或重新整理分段。
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="review-trace-grid mt-6 grid shrink-0 grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          {STAGES.map((stage, index) => {
            const complete = task.status === "completed" || index < activeIndex;
            const active = task.status === "running" && index === activeIndex;
            return (
              <div key={stage.id} className={`review-trace-node ${complete ? "is-complete" : ""} ${active ? "is-active" : ""}`}>
                <span className="review-trace-dot" aria-hidden="true">{complete ? <Check size={13} /> : index + 1}</span>
                <span className="text-sm font-medium text-ink/72">{stage.label}</span>
              </div>
            );
          })}
        </div>

        <div className="mt-6 grid shrink-0 gap-3 border-t border-line pt-6 sm:grid-cols-2 xl:grid-cols-6">
          <TaskMetric icon={FileStack} label="所选会话" value={`${task.sessionCount} 个`} />
          <TaskMetric icon={Sparkles} label="目标日期消息" value={task.messageCount > 0 ? task.messageCount.toLocaleString("zh-CN") : "读取中"} />
          <TaskMetric icon={FileStack} label="提取字符" value={task.extractedChars > 0 ? task.extractedChars.toLocaleString("zh-CN") : "读取中"} />
          <TaskMetric icon={Check} label="完成分段" value={totalSegments > 0 ? `${completedSegments}/${totalSegments}` : "等待读取"} />
          <TaskMetric icon={Clock3} label="运行时间" value={formatElapsed(elapsed)} />
          <TaskMetric icon={RefreshCw} label="自动重试" value={`${totalRetryCount} 次`} />
        </div>
      </div>
    </section>
  );
}

function TaskMetric({ icon: Icon, label, value }: { icon: typeof Clock3; label: string; value: string }) {
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

function formatElapsed(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1_000);
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  return minutes > 0 ? `${minutes}分 ${restSeconds}秒` : `${restSeconds}秒`;
}
