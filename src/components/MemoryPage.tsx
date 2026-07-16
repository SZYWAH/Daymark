import {
  Archive,
  BookOpenText,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  History,
  Maximize2,
  PanelRightOpen,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  SquareCheck,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getEffectiveAiSettings, streamSummarizeConversationReview, type CodexReviewProgress } from "../ai/deepseek";
import { ConversationSessionPreviewOverlay } from "./ConversationSessionPreviewOverlay";
import { ConfirmDialog } from "./ConfirmDialog";
import { DatePickerPopover } from "./DatePickerPopover";
import { FocusOverlay } from "./FocusOverlay";
import { MetricItem, PageMetricColumn, PageWorkspace } from "./PageWorkspace";
import { BoundedPreview, ResultRow, ScrollableResultPanel } from "./ResultPanels";
import type { ReviewGenerationRuntime } from "./ReviewGenerationWorkspace";
import { SelectMenu } from "./SelectMenu";
import { toDateKey } from "../lib/date";
import { toConversationReadProgressView } from "../lib/conversationReadProgress";
import {
  createConversationReviewFingerprint,
  shouldWarnLargeNoDateReview,
} from "../lib/conversationReviewWarning";
import { getMemoryPatchSelectionAfterRemoval, resolveMemoryPatchSelection } from "../lib/memoryPatchSelection";
import { getSafeErrorMessage } from "../lib/redaction";
import { formatMemorySuggestionResult, formatReviewGenerationResult } from "../lib/reviewGenerationResult";
import { isMemorySuggestionSourceOutdated } from "../lib/memorySuggestion";
import {
  createConversationScanKey,
  isConversationScanActive,
  type ConversationScanQuery,
  type ConversationScanRuntime,
} from "../lib/conversationScanTask";
import {
  isConversationSourceLocked,
  resolveConversationReviewPrimaryAction,
} from "../lib/conversationReviewWorkbench";
import {
  cancelConversationReviewJob,
  isDesktopRuntime,
  readSelectedConversationSessions,
} from "../lib/desktop";
import type {
  AiSettings,
  CodexDailyReview,
  CodexSessionIndex,
  ConversationGenerationDraft,
  ConversationReviewGenerationRequest,
  ConversationSourceKind,
  DailyReviewReplacementDraft,
  MemoryCard,
  MemoryDocument,
  MemoryPatchDraft,
  MemorySuggestionCheckpointStatus,
  MemorySuggestionGenerationResult,
  MemorySuggestionStatus,
  MemorySubView,
  ReviewMemorySuggestionSource,
  RollingWorkReview,
  SummaryReport,
} from "../types";

type GenerateCodexReviewResult = {
  review: CodexDailyReview;
  patchDraft?: MemoryPatchDraft;
  replacementDraft?: boolean;
  replacementDraftId?: string;
  memorySuggestionStatus: MemorySuggestionStatus;
};

const MEMORY_DOCUMENT_DRAFT_KEY = "personal-knowledge-base:memory-document-draft:v1";
const MEMORY_PATCH_EDIT_DRAFT_KEY = "personal-knowledge-base:memory-patch-edit-drafts:v1";

type MemoryDocumentDraftSnapshot = {
  content: string;
  dirty: boolean;
  baselineContent: string;
  baselineUpdatedAt?: string;
};

type MemoryDocumentSaveOptions = {
  baselineContent: string;
  baselineUpdatedAt?: string;
};

type MemoryPageProps = {
  memories: MemoryCard[];
  memoryDocument: MemoryDocument | null;
  memoryPatchDrafts: MemoryPatchDraft[];
  reports: SummaryReport[];
  codexReviews: CodexDailyReview[];
  rollingWorkReviews: RollingWorkReview[];
  codexSessionIndex: CodexSessionIndex[];
  dailyReviewDrafts: DailyReviewReplacementDraft[];
  conversationGenerationDrafts: ConversationGenerationDraft[];
  reviewGenerationTask: ReviewGenerationRuntime | null;
  conversationScanQuery: ConversationScanQuery;
  conversationScanTask: ConversationScanRuntime | null;
  lastCompletedConversationScanKey: string;
  settings: AiSettings | null;
  initialSubView?: MemorySubView;
  onSubViewChange?: (subView: MemorySubView) => void;
  initialMemoryId?: string;
  initialReviewId?: string;
  initialReviewDraftId?: string;
  initialSummaryId?: string;
  mainWindowMaximized: boolean;
  onUpdateMemory: (id: string, patch: Partial<MemoryCard>) => Promise<void>;
  onGenerateCombinedReview: (
    reviews: CodexDailyReview[],
    onProgress?: (progress: CodexReviewProgress) => void,
    signal?: AbortSignal,
  ) => Promise<GenerateCodexReviewResult>;
  onStartReviewGeneration: (request: ConversationReviewGenerationRequest) => Promise<void>;
  onOpenReviewGeneration: () => void;
  onConversationScanQueryChange: (query: ConversationScanQuery) => void;
  onStartConversationScan: (query: ConversationScanQuery) => Promise<void>;
  onOpenConversationScan: () => void;
  onOpenSettings: () => void;
  onResumeReviewGeneration: (draftId: string) => Promise<void>;
  onRestartReviewGeneration: (draftId: string) => Promise<void>;
  onDeleteReviewGeneration: (draftId: string) => Promise<void>;
  onUpdateCodexReview: (id: string, patch: Partial<CodexDailyReview>) => Promise<void>;
  onUpdateDailyReviewDraft: (id: string, patch: Partial<DailyReviewReplacementDraft>) => Promise<DailyReviewReplacementDraft>;
  onGenerateMemorySuggestion: (
    source: ReviewMemorySuggestionSource,
    onProgress?: (progress: CodexReviewProgress) => void,
    signal?: AbortSignal,
  ) => Promise<MemorySuggestionGenerationResult>;
  onApplyDailyReviewDraft: (id: string) => Promise<void>;
  onIgnoreDailyReviewDraft: (id: string) => Promise<void>;
  onArchiveRollingWorkReview: (date: string) => Promise<unknown>;
  onSaveMemoryDocument: (content: string, options: MemoryDocumentSaveOptions) => Promise<MemoryDocument>;
  onApplyMemoryPatch: (
    id: string,
    editedContent: string,
    options?: { allowStale?: boolean; confirmedDocumentUpdatedAt?: string; confirmedDocumentContent?: string },
  ) => Promise<void>;
  onIgnoreMemoryPatch: (id: string) => Promise<void>;
};

export function MemoryPage({
  memories,
  memoryDocument,
  memoryPatchDrafts,
  reports,
  codexReviews,
  rollingWorkReviews,
  codexSessionIndex,
  dailyReviewDrafts,
  conversationGenerationDrafts,
  reviewGenerationTask,
  conversationScanQuery,
  conversationScanTask,
  lastCompletedConversationScanKey,
  settings,
  initialSubView,
  onSubViewChange,
  initialMemoryId,
  initialReviewId,
  initialReviewDraftId,
  initialSummaryId,
  mainWindowMaximized,
  onUpdateMemory,
  onGenerateCombinedReview,
  onStartReviewGeneration,
  onOpenReviewGeneration,
  onConversationScanQueryChange,
  onStartConversationScan,
  onOpenConversationScan,
  onOpenSettings,
  onResumeReviewGeneration,
  onRestartReviewGeneration,
  onDeleteReviewGeneration,
  onUpdateCodexReview,
  onUpdateDailyReviewDraft,
  onGenerateMemorySuggestion,
  onApplyDailyReviewDraft,
  onIgnoreDailyReviewDraft,
  onArchiveRollingWorkReview,
  onSaveMemoryDocument,
  onApplyMemoryPatch,
  onIgnoreMemoryPatch,
}: MemoryPageProps) {
  const [activeReview, setActiveReview] = useState<CodexDailyReview | null>(null);
  const [activeReport, setActiveReport] = useState<SummaryReport | null>(null);
  const pendingPatchDrafts = memoryPatchDrafts.filter((draft) => draft.status === "pending");

  const [subView, setSubView] = useState<MemorySubView>(initialSubView ?? "document");
  const todayKey = toDateKey(new Date());
  const todayReviews = codexReviews.filter((review) => review.date === todayKey);
  const todayReviewIds = new Set(todayReviews.map((review) => review.id));
  const todayReviewDraftIds = new Set(
    dailyReviewDrafts.filter((draft) => draft.date === todayKey).map((draft) => draft.id),
  );
  const todayPatchCount = pendingPatchDrafts.filter(
    (draft) =>
      (draft.sourceReviewId && todayReviewIds.has(draft.sourceReviewId))
      || (draft.sourceReviewDraftId && todayReviewDraftIds.has(draft.sourceReviewDraftId)),
  ).length;

  useEffect(() => {
    setSubView(initialSubView ?? "document");
  }, [initialSubView]);

  useEffect(() => {
    if (initialMemoryId) {
      setSubView("legacy");
      return;
    }
    if (initialReviewId || initialReviewDraftId || initialSummaryId) {
      setSubView("archive");
    }
  }, [initialMemoryId, initialReviewDraftId, initialReviewId, initialSummaryId]);

  return (
    <PageWorkspace
      eyebrow="Memory"
      title="记忆"
      description="长期记忆文档优先；回顾、审核和 AI 回顾进入各自子页面。"
      meta={`${pendingPatchDrafts.length} 条待审核`}
      compactHeader
    >
      <div className="flex h-full min-h-0 flex-col px-6 pb-24 pt-4 lg:pb-4">
        <MemorySubViewNav
          active={subView}
          onChange={(nextSubView) => {
            setSubView(nextSubView);
            onSubViewChange?.(nextSubView);
          }}
          archiveCount={codexReviews.filter((review) => review.reviewKind !== "auto-work").length + reports.length + rollingWorkReviews.length}
          patchCount={pendingPatchDrafts.length}
          legacyCount={memories.filter((memory) => memory.status !== "ignored").length}
        />

        <div className="mt-4 min-h-0 flex-1 overflow-hidden">
          {subView === "document" && (
            <MemoryDocumentPanel
              document={memoryDocument}
              pendingCount={pendingPatchDrafts.length}
              onSave={onSaveMemoryDocument}
            />
          )}

          {subView === "archive" && (
            <div className="h-full min-h-0 overflow-y-auto scrollbar-thin">
              <ReviewArchivePanel
                reports={reports}
                codexReviews={codexReviews}
                rollingWorkReviews={rollingWorkReviews}
                dailyReviewDrafts={dailyReviewDrafts}
                memoryPatchDrafts={pendingPatchDrafts}
                targetReviewId={initialReviewId}
                targetReviewDraftId={initialReviewDraftId}
                targetSummaryId={initialSummaryId}
                onOpenCodexReview={setActiveReview}
                onOpenSummaryReport={setActiveReport}
                onGenerateCombinedReview={onGenerateCombinedReview}
                onUpdateDailyReviewDraft={onUpdateDailyReviewDraft}
                onGenerateMemorySuggestion={onGenerateMemorySuggestion}
                onApplyDailyReviewDraft={onApplyDailyReviewDraft}
                onIgnoreDailyReviewDraft={onIgnoreDailyReviewDraft}
                onArchiveRollingWorkReview={onArchiveRollingWorkReview}
              />
            </div>
          )}

          {subView === "patches" && (
            <div className="h-full min-h-0 overflow-hidden">
              <MemoryPatchDraftsPanel
                drafts={pendingPatchDrafts}
                memoryDocument={memoryDocument}
                reviews={codexReviews}
                reviewDrafts={dailyReviewDrafts}
                onGenerateMemorySuggestion={onGenerateMemorySuggestion}
                onApply={onApplyMemoryPatch}
                onIgnore={onIgnoreMemoryPatch}
              />
            </div>
          )}

          {subView === "ai-review" && (
            <div className={`grid h-full min-h-0 gap-4 overflow-y-auto ${mainWindowMaximized ? "xl:grid-cols-[minmax(0,1fr)_240px] xl:overflow-hidden" : ""}`}>
              <div className={`min-h-0 overflow-y-auto pr-0 scrollbar-thin ${mainWindowMaximized ? "xl:pr-6" : ""}`}>
                <CodexReviewWorkbench
                  settings={settings}
                  reviews={codexReviews}
                  indexedSessions={codexSessionIndex}
                  generationDrafts={conversationGenerationDrafts}
                  reviewGenerationTask={reviewGenerationTask}
                  scanQuery={conversationScanQuery}
                  scanTask={conversationScanTask}
                  lastCompletedScanKey={lastCompletedConversationScanKey}
                  onStartReviewGeneration={onStartReviewGeneration}
                  onOpenReviewGeneration={onOpenReviewGeneration}
                  onScanQueryChange={onConversationScanQueryChange}
                  onStartScan={onStartConversationScan}
                  onOpenScan={onOpenConversationScan}
                  onOpenSettings={onOpenSettings}
                  onResumeReviewGeneration={onResumeReviewGeneration}
                  onRestartReviewGeneration={onRestartReviewGeneration}
                  onDeleteReviewGeneration={onDeleteReviewGeneration}
                />
              </div>
              {mainWindowMaximized ? (
                <div className="min-h-0 overflow-y-auto scrollbar-thin">
                  <MemoryReviewMetrics
                    todayKey={todayKey}
                    todayReviews={todayReviews.length}
                    todayPatchCount={todayPatchCount}
                    indexedSessions={codexSessionIndex.length}
                    memoryDocument={memoryDocument}
                  />
                </div>
              ) : null}
            </div>
          )}

          {subView === "legacy" && (
            <div className="h-full min-h-0 overflow-y-auto scrollbar-thin">
              <LegacyMemorySection memories={memories} targetMemoryId={initialMemoryId} onUpdateMemory={onUpdateMemory} />
            </div>
          )}
        </div>
      </div>

      {activeReview && (
        <ReviewReaderOverlay
          review={activeReview}
          settings={settings}
          memoryPatchDraft={pendingPatchDrafts.find((draft) => draft.sourceReviewId === activeReview.id)}
          onGenerateMemorySuggestion={onGenerateMemorySuggestion}
          onClose={() => setActiveReview(null)}
          onSave={onUpdateCodexReview}
        />
      )}
      {activeReport && <SummaryReportReaderOverlay report={activeReport} onClose={() => setActiveReport(null)} />}
    </PageWorkspace>
  );
}
function MemorySubViewNav({
  active,
  onChange,
  archiveCount,
  patchCount,
  legacyCount,
}: {
  active: MemorySubView;
  onChange: (view: MemorySubView) => void;
  archiveCount: number;
  patchCount: number;
  legacyCount: number;
}) {
  const items: Array<{ id: MemorySubView; label: string; count?: number; icon: typeof BookOpenText }> = [
    { id: "document", label: "长期记忆", icon: BookOpenText },
    { id: "ai-review", label: "AI 回顾台", icon: Search },
    { id: "archive", label: "回顾档案", count: archiveCount, icon: History },
    { id: "patches", label: "记忆审核", count: patchCount, icon: Sparkles },
    { id: "legacy", label: "旧版片段", count: legacyCount, icon: Archive },
  ];

  return (
    <nav className="flex shrink-0 gap-5 overflow-x-auto border-b border-line pb-2 scrollbar-thin">
      {items.map(({ id, label, count, icon: Icon }) => {
        const selected = active === id;
        return (
          <button
            key={id}
            className={`flex h-8 shrink-0 items-center gap-2 border-b text-sm transition ${
              selected
                ? "border-accent text-ink"
                : "border-transparent text-ink/55 hover:border-line hover:text-ink"
            }`}
            onClick={() => onChange(id)}
          >
            <Icon size={15} />
            <span>{label}</span>
            {count !== undefined && (
              <span className="text-[11px] text-ink/40">{count}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

function MemoryDocumentPanel({
  document,
  pendingCount,
  onSave,
}: {
  document: MemoryDocument | null;
  pendingCount: number;
  onSave: (content: string, options: MemoryDocumentSaveOptions) => Promise<MemoryDocument>;
}) {
  const documentKey = `${document?.updatedAt ?? ""}:${document?.content ?? ""}`;
  const initialDraftRef = useRef<MemoryDocumentDraftSnapshot | null>(null);
  if (!initialDraftRef.current) {
    initialDraftRef.current = readMemoryDocumentDraft(
      documentKey,
      document?.content ?? "",
      document?.updatedAt,
    );
  }
  const [draft, setDraft] = useState(initialDraftRef.current.content);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(initialDraftRef.current.dirty);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(initialDraftRef.current.dirty ? "已恢复上次未保存的长期记忆草稿。" : "");
  const [zoomOpen, setZoomOpen] = useState(false);
  const savingRef = useRef(false);
  const lastDocumentKeyRef = useRef(documentKey);
  const draftBaselineRef = useRef({
    content: initialDraftRef.current.baselineContent,
    updatedAt: initialDraftRef.current.baselineUpdatedAt,
  });

  useEffect(() => {
    const nextKey = documentKey;
    if (nextKey === lastDocumentKeyRef.current) return;
    lastDocumentKeyRef.current = nextKey;

    if (dirty) {
      setMessage("长期记忆文档已在别处更新，当前未保存草稿没有被覆盖。保存前请确认内容。");
      return;
    }

    setDraft(document?.content ?? "");
    draftBaselineRef.current = {
      content: document?.content ?? "",
      updatedAt: document?.updatedAt,
    };
    setDirty(false);
    clearMemoryDocumentDraft();
  }, [documentKey, document?.content, dirty]);

  const updateDraft = (value: string) => {
    setDraft(value);
    setDirty(true);
    writeMemoryDocumentDraft(
      documentKey,
      value,
      draftBaselineRef.current.content,
      draftBaselineRef.current.updatedAt,
    );
  };

  const save = async () => {
    if (!dirty) return;
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setMessage("");
    try {
      const saved = await onSave(draft, {
        baselineContent: draftBaselineRef.current.content,
        baselineUpdatedAt: draftBaselineRef.current.updatedAt,
      });
      draftBaselineRef.current = {
        content: saved.content,
        updatedAt: saved.updatedAt,
      };
      setMessage("已保存为长期记忆文档。");
      setDirty(false);
      setEditing(false);
      clearMemoryDocumentDraft();
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "保存失败。"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <section className="memory-document-shell mx-auto flex h-full min-h-0 w-full max-w-[1080px] flex-col">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-copper">Long Memory</p>
          <div className="mt-1 flex min-w-0 flex-wrap items-end gap-3">
            <h3 className="truncate text-2xl font-semibold text-ink">长期记忆文档</h3>
            <div className="flex flex-wrap gap-3 text-xs text-ink/42">
              <span>待审核建议 {pendingCount}</span>
              <span>更新于 {document?.updatedAt ?? "尚未保存"}</span>
            </div>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-ink/48">
            这里只保留长期稳定的信息：偏好、项目方向、工具习惯、设计原则和长期约束。临时报错、路径碎片、密钥和一次性命令不进入长期记忆。
          </p>
        </div>
        <div className="flex gap-2">
          <button className="soft-button action-standard text-xs" onClick={() => setEditing((value) => !value)}>
            {editing ? "阅读" : "编辑"}
          </button>
          <button className="soft-button action-standard text-xs" onClick={() => setZoomOpen(true)}>
            <Maximize2 size={14} />
            放大
          </button>
          <button
            className="primary-button action-standard text-xs disabled:cursor-not-allowed disabled:opacity-60"
            disabled={saving || !dirty}
            onClick={save}
          >
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? "保存中" : "保存文档"}
          </button>
        </div>
      </div>

      {editing ? (
        <textarea
          value={draft}
          onChange={(event) => {
            updateDraft(event.target.value);
          }}
          spellCheck={false}
          className="fullscreen-editor-input min-h-0 flex-1 resize-none px-4 py-3 font-mono text-[13px] leading-7 text-ink/75"
          placeholder="这里适合写下长期稳定的信息。每一次写入都应经过你的确认。"
        />
      ) : (
        <MemoryDocumentReadView content={draft} />
      )}
      {message && <p className="mt-2 text-xs text-ink/45">{message}</p>}
      {zoomOpen && (
        <FocusOverlay title="长期记忆文档" onClose={() => setZoomOpen(false)}>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="rounded-[8px] border border-line bg-panel/70 p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-copper">Read</div>
              <MemoryDocumentReadView content={draft} compact={false} />
            </div>
            <textarea
              value={draft}
              onChange={(event) => {
                updateDraft(event.target.value);
              }}
              spellCheck={false}
              className="fullscreen-editor-input max-h-[70vh] min-h-[60vh] w-full resize-none overflow-y-auto px-5 py-4 font-mono text-sm leading-7 text-ink/78 scrollbar-thin"
            />
          </div>
          <div className="mt-3 flex justify-end">
            <button
              className="primary-button action-standard text-xs disabled:cursor-not-allowed disabled:opacity-60"
              disabled={saving || !dirty}
              onClick={() => void save()}
            >
              <Save size={14} />
              保存文档
            </button>
          </div>
        </FocusOverlay>
      )}
    </section>
  );
}

function MemoryReviewMetrics({
  todayKey,
  todayReviews,
  todayPatchCount,
  indexedSessions,
  memoryDocument,
}: {
  todayKey: string;
  todayReviews: number;
  todayPatchCount: number;
  indexedSessions: number;
  memoryDocument: MemoryDocument | null;
}) {
  const memoryChars = memoryDocument?.content.trim().length ?? 0;

  return (
    <PageMetricColumn title="今日状态" className="px-4 py-5 xl:w-full [&_.metric-item]:pb-4 [&_.metric-item-detail]:text-xs [&_.metric-item-value]:text-2xl [&_.metric-stack]:space-y-4">
      <MetricItem label="日期" value={todayKey} detail="只在用户点击后扫描或读取会话。" />
      <MetricItem label="已索引会话" value={indexedSessions} detail="扫描阶段只保存元信息。" />
      <MetricItem label="今日回顾" value={todayReviews} detail="Codex、Claude Code 与综合回顾分开统计。" />
      <MetricItem label="待审建议" value={todayPatchCount} detail="确认后才写入长期记忆文档。" />
      <MetricItem label="长期记忆" value={memoryChars} detail="当前文档字符数。" />
    </PageMetricColumn>
  );
}

function MemoryDocumentReadView({ content, compact = true }: { content: string; compact?: boolean }) {
  const blocks = parseMemoryMarkdown(content);

  if (blocks.length === 0) {
    return (
      <div className="flex min-h-[220px] items-center justify-center border-y border-dashed border-line py-10 text-center text-sm leading-6 text-ink/45">
        还没有长期记忆文档。确认记忆建议后，这里会逐渐成为稳定的个人背景。
      </div>
    );
  }

  return (
    <div className={`reader-canvas memory-document-canvas w-full max-w-none overflow-y-auto whitespace-normal text-anywhere ${compact ? "min-h-0 flex-1 max-h-none" : "max-h-[70vh]"} scrollbar-thin`}>
      <div className="space-y-3">
        {blocks.map((block, index) => {
          if (block.kind === "heading") {
            return (
              <h4 key={`${block.text}-${index}`} className={`${block.level <= 2 ? "text-base" : "text-sm"} font-semibold text-ink`}>
                {block.text}
              </h4>
            );
          }
          if (block.kind === "bullet") {
            return (
              <div key={`${block.text}-${index}`} className="flex gap-2 text-sm leading-7 text-ink/66">
                <span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-ink/50" />
                <span>{block.text}</span>
              </div>
            );
          }
          return (
            <p key={`${block.text}-${index}`} className="text-sm leading-7 text-ink/70">
              {block.text}
            </p>
          );
        })}
      </div>
    </div>
  );
}

function parseMemoryMarkdown(content: string) {
  return content
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const heading = /^(#{1,6})\s+(.+)$/.exec(line);
      if (heading) {
        return { kind: "heading" as const, level: heading[1].length, text: heading[2].trim() };
      }
      const bullet = /^[-*]\s+(.+)$/.exec(line);
      if (bullet) {
        return { kind: "bullet" as const, text: bullet[1].trim() };
      }
      return { kind: "paragraph" as const, text: line.replace(/^#+\s*/, "") };
    });
}

function MemoryPatchDraftsPanel({
  drafts,
  reviews,
  reviewDrafts,
  memoryDocument,
  onApply,
  onIgnore,
  onGenerateMemorySuggestion,
}: {
  drafts: MemoryPatchDraft[];
  reviews: CodexDailyReview[];
  reviewDrafts: DailyReviewReplacementDraft[];
  memoryDocument: MemoryDocument | null;
  onApply: (
    id: string,
    editedContent: string,
    options?: { allowStale?: boolean; confirmedDocumentUpdatedAt?: string; confirmedDocumentContent?: string },
  ) => Promise<void>;
  onIgnore: (id: string) => Promise<void>;
  onGenerateMemorySuggestion: (
    source: ReviewMemorySuggestionSource,
    onProgress?: (progress: CodexReviewProgress) => void,
    signal?: AbortSignal,
  ) => Promise<MemorySuggestionGenerationResult>;
}) {
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [busyId, setBusyId] = useState("");
  const [pendingAction, setPendingAction] = useState<{ draft: MemoryPatchDraft; kind: "apply" | "ignore" } | null>(null);
  const [message, setMessage] = useState("");
  const [suggestionBusyId, setSuggestionBusyId] = useState("");
  const [principlesOpen, setPrinciplesOpen] = useState(false);
  const busyRef = useRef("");

  useEffect(() => {
    setEditing(readMemoryPatchEditDrafts());
  }, []);

  useEffect(() => {
    const validIds = new Set(drafts.map((draft) => draft.id));
    setEditing((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([id]) => validIds.has(id)));
      writeMemoryPatchEditDrafts(next);
      return next;
    });
    setSelectedDraftId((current) => resolveMemoryPatchSelection(drafts.map((draft) => draft.id), current));
  }, [drafts]);

  const selectedDraftIndex = Math.max(0, drafts.findIndex((draft) => draft.id === selectedDraftId));
  const selectedDraft = drafts[selectedDraftIndex];
  const selectedSource = useMemo<ReviewMemorySuggestionSource | null>(() => {
    if (!selectedDraft) return null;
    if (selectedDraft.sourceReviewDraftId) {
      const reviewDraft = reviewDrafts.find((draft) => draft.id === selectedDraft.sourceReviewDraftId);
      return reviewDraft ? { kind: "replacement", draft: reviewDraft } : null;
    }
    if (selectedDraft.sourceReviewId) {
      const review = reviews.find((item) => item.id === selectedDraft.sourceReviewId);
      return review ? { kind: "review", review } : null;
    }
    return null;
  }, [reviewDrafts, reviews, selectedDraft]);
  const selectedSourceTitle = selectedSource?.kind === "review" ? selectedSource.review.title : selectedSource?.draft.title;
  const selectedSourceContent = selectedSource?.kind === "review" ? selectedSource.review.content : selectedSource?.draft.content;
  const selectedSourceDate = selectedSource?.kind === "review" ? selectedSource.review.date : selectedSource?.draft.date;
  const selectedSourceLabel = selectedSource?.kind === "review" ? selectedSource.review.sourceLabel : selectedSource?.draft.sourceLabel;
  const selectedSourceOutdated = Boolean(
    selectedDraft
      && selectedSourceTitle !== undefined
      && selectedSourceContent !== undefined
      && isMemorySuggestionSourceOutdated(
        selectedDraft.sourceReviewContentVersion,
        selectedSourceTitle,
        selectedSourceContent,
      ),
  );

  useEffect(() => {
    if (!principlesOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPrinciplesOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [principlesOpen]);

  const updateDraft = (draft: MemoryPatchDraft, value: string) => {
    setEditing((current) => {
      const next = { ...current, [draft.id]: value };
      writeMemoryPatchEditDrafts(next);
      return next;
    });
  };

  const applyDraft = async (draft: MemoryPatchDraft) => {
    if (busyRef.current) return;
    const nextSelectedId = getMemoryPatchSelectionAfterRemoval(drafts.map((item) => item.id), draft.id);
    const documentUpdatedAt = memoryDocument?.updatedAt ?? "";
    const draftBaselineAt = draft.createdAt || draft.updatedAt;
    const isStaleAgainstDocument = Boolean(documentUpdatedAt && draftBaselineAt && documentUpdatedAt > draftBaselineAt);
    busyRef.current = draft.id;
    setBusyId(draft.id);
    setMessage("");
    try {
      await onApply(draft.id, editing[draft.id] ?? draft.proposedContent, {
        allowStale: isStaleAgainstDocument,
        confirmedDocumentUpdatedAt: documentUpdatedAt,
        confirmedDocumentContent: memoryDocument?.content ?? "",
      });
      setEditing((current) => {
        const { [draft.id]: _removed, ...next } = current;
        writeMemoryPatchEditDrafts(next);
        return next;
      });
      setSelectedDraftId(nextSelectedId);
      setMessage("长期记忆已更新。");
      setPendingAction(null);
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "写入长期记忆失败。"));
    } finally {
      busyRef.current = "";
      setBusyId("");
    }
  };

  const ignoreDraft = async (draft: MemoryPatchDraft) => {
    if (busyRef.current) return;
    const nextSelectedId = getMemoryPatchSelectionAfterRemoval(drafts.map((item) => item.id), draft.id);
    busyRef.current = draft.id;
    setBusyId(draft.id);
    setMessage("");
    try {
      await onIgnore(draft.id);
      setEditing((current) => {
        const { [draft.id]: _removed, ...next } = current;
        writeMemoryPatchEditDrafts(next);
        return next;
      });
      setSelectedDraftId(nextSelectedId);
      setMessage("已舍弃这条建议。");
      setPendingAction(null);
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "舍弃建议失败。"));
    } finally {
      busyRef.current = "";
      setBusyId("");
    }
  };

  const regenerateSuggestion = async () => {
    if (!selectedDraft || !selectedSource || suggestionBusyId) return;
    setSuggestionBusyId(selectedDraft.id);
    setMessage("正在重新生成长期记忆建议。");
    try {
      const result = await onGenerateMemorySuggestion(selectedSource);
      setMessage(formatMemorySuggestionResult(result));
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "长期记忆建议未生成，可稍后重试。"));
    } finally {
      setSuggestionBusyId("");
    }
  };

  return (
    <section className="relative flex h-full min-h-[520px] flex-col overflow-hidden bg-paper xl:min-h-0">
      <header className="flex shrink-0 items-end justify-between gap-4 border-b border-line px-5 pb-4 pt-2 pr-16">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-copper">Memory Review</p>
          <h3 className="mt-1 text-lg font-semibold text-ink">记忆审核</h3>
          <p className="mt-1 text-xs leading-5 text-ink/45">审阅并确认真正值得长期保留的信息。</p>
        </div>
        {drafts.length > 0 && (
          <div className="flex shrink-0 items-center gap-2" aria-label="待审核建议切换">
            <button
              type="button"
              className="soft-button action-compact size-8 p-0 disabled:opacity-35"
              aria-label="上一条建议"
              title="上一条建议"
              disabled={selectedDraftIndex <= 0 || Boolean(busyId)}
              onClick={() => setSelectedDraftId(drafts[selectedDraftIndex - 1]?.id ?? selectedDraftId)}
            >
              <ChevronLeft size={15} />
            </button>
            <span className="min-w-14 text-center text-xs tabular-nums text-ink/55">
              {selectedDraftIndex + 1} / {drafts.length}
            </span>
            <button
              type="button"
              className="soft-button action-compact size-8 p-0 disabled:opacity-35"
              aria-label="下一条建议"
              title="下一条建议"
              disabled={selectedDraftIndex >= drafts.length - 1 || Boolean(busyId)}
              onClick={() => setSelectedDraftId(drafts[selectedDraftIndex + 1]?.id ?? selectedDraftId)}
            >
              <ChevronRight size={15} />
            </button>
          </div>
        )}
      </header>

      {drafts.length === 0 || !selectedDraft ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-8 pb-16 pr-20 text-center">
          <div className="max-w-md">
            <BookOpenText size={24} className="mx-auto text-ink/35" />
            <h4 className="mt-4 text-base font-semibold text-ink">没有待审核建议</h4>
            <p className="mt-2 text-sm leading-7 text-ink/45">生成工作回顾后，值得长期保留的信息会在这里等待确认。</p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 px-5 py-5 pr-16">
          <article className="mx-auto flex min-h-[360px] w-full max-w-[920px] flex-1 flex-col overflow-hidden border border-line bg-surface shadow-card">
            <div className="flex shrink-0 flex-wrap items-start justify-between gap-4 border-b border-line px-7 py-5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink/42">
                  <span>{selectedSourceDate || "来源日期未知"}</span>
                  <span aria-hidden="true">·</span>
                  <span>{selectedSourceLabel || (selectedDraft.sourceReviewDraftId ? "待确认回顾" : "工作回顾")}</span>
                </div>
                <h4 className="mt-2 text-xl font-semibold text-ink">{selectedDraft.title}</h4>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-ink/52">{selectedDraft.rationale}</p>
                {selectedSourceOutdated && (
                  <p className="mt-3 text-xs font-medium text-copper">来源回顾已修改，这条建议仍基于修改前的内容。</p>
                )}
                {!selectedSource && selectedDraft.sourceReviewDraftId && (
                  <p className="mt-3 text-xs text-ink/45">来源版本已舍弃，这条建议仍可独立审核。</p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {selectedSourceOutdated && (
                  <button
                    type="button"
                    className="soft-button action-compact disabled:opacity-55"
                    disabled={Boolean(busyId || suggestionBusyId)}
                    onClick={() => void regenerateSuggestion()}
                  >
                    {suggestionBusyId ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    重新生成建议
                  </button>
                )}
                <span className="rounded-full border border-copper/30 bg-copper/10 px-2.5 py-1 text-[11px] font-medium text-copper">
                  待确认
                </span>
              </div>
            </div>
            <textarea
              value={editing[selectedDraft.id] ?? selectedDraft.proposedContent}
              onChange={(event) => updateDraft(selectedDraft, event.target.value)}
              className="min-h-0 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-7 py-6 font-sans text-[15px] leading-[1.8] text-ink/78 outline-none scrollbar-thin focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/55"
              aria-label={`编辑长期记忆建议：${selectedDraft.title}`}
            />
            <div className="flex min-h-[64px] shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line px-6 py-3">
              <div className="min-h-9 min-w-0 flex-1 text-xs leading-5 text-ink/45" aria-live="polite">
                {message || (selectedSourceOutdated ? "来源已修改，可重新生成建议。" : "编辑内容会自动保存在本机；确认后才会写入长期记忆。")}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className="primary-button action-standard disabled:opacity-60"
                  disabled={Boolean(busyId || suggestionBusyId)}
                  onClick={() => setPendingAction({ draft: selectedDraft, kind: "apply" })}
                >
                  <Check size={14} />
                  写入长期记忆
                </button>
                <button
                  className="danger-action action-standard disabled:opacity-60"
                  disabled={Boolean(busyId || suggestionBusyId)}
                  onClick={() => setPendingAction({ draft: selectedDraft, kind: "ignore" })}
                >
                  <X size={14} />
                  舍弃
                </button>
              </div>
            </div>
          </article>
        </div>
      )}

      <aside className="absolute inset-y-0 right-0 z-20 flex w-12 flex-col items-center border-l border-line bg-paper pt-4">
        <button
          type="button"
          className="ghost-action icon-action-compact"
          aria-label="查看审核原则"
          title="审核原则"
          aria-expanded={principlesOpen}
          onClick={() => setPrinciplesOpen((value) => !value)}
        >
          <PanelRightOpen size={16} />
        </button>
      </aside>
      {principlesOpen && (
        <aside className="absolute inset-y-0 right-0 z-30 flex w-[280px] flex-col border-l border-line bg-paper shadow-[-18px_0_44px_rgba(0,0,0,0.18)]">
          <div className="flex h-14 items-center justify-between border-b border-line px-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <BookOpenText size={16} />
              审核原则
            </div>
            <button type="button" className="ghost-action icon-action-compact" onClick={() => setPrinciplesOpen(false)} aria-label="收起审核原则" title="收起">
              <X size={16} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3 scrollbar-thin">
            <MemoryPrinciples />
          </div>
        </aside>
      )}
      <ConfirmDialog
        open={Boolean(pendingAction)}
        title={pendingAction?.kind === "apply" ? "写入长期记忆？" : "舍弃这条建议？"}
        message={pendingAction?.kind === "apply"
          ? memoryDocument?.updatedAt && (pendingAction.draft.createdAt || pendingAction.draft.updatedAt) && memoryDocument.updatedAt > (pendingAction.draft.createdAt || pendingAction.draft.updatedAt)
              ? "长期记忆在这条建议生成后更新过。确认后将以当前建议替换对应内容。"
              : "确认后会更新长期记忆文档。"
          : "这条待审核建议将被删除，长期记忆保持不变。"}
        confirmLabel={pendingAction?.kind === "apply" ? "确认写入" : "舍弃建议"}
        danger={pendingAction?.kind === "ignore"}
        onCancel={() => setPendingAction(null)}
        onConfirm={async () => {
          if (!pendingAction) return;
          if (pendingAction.kind === "apply") {
            await applyDraft(pendingAction.draft);
            return;
          }
          await ignoreDraft(pendingAction.draft);
        }}
      />
    </section>
  );
}

function CodexReviewWorkbench({
  settings,
  reviews,
  indexedSessions,
  generationDrafts,
  reviewGenerationTask,
  scanQuery,
  scanTask,
  lastCompletedScanKey,
  onStartReviewGeneration,
  onOpenReviewGeneration,
  onScanQueryChange,
  onStartScan,
  onOpenScan,
  onOpenSettings,
  onResumeReviewGeneration,
  onRestartReviewGeneration,
  onDeleteReviewGeneration,
}: {
  settings: AiSettings | null;
  reviews: CodexDailyReview[];
  indexedSessions: CodexSessionIndex[];
  generationDrafts: ConversationGenerationDraft[];
  reviewGenerationTask: ReviewGenerationRuntime | null;
  scanQuery: ConversationScanQuery;
  scanTask: ConversationScanRuntime | null;
  lastCompletedScanKey: string;
  onStartReviewGeneration: (request: ConversationReviewGenerationRequest) => Promise<void>;
  onOpenReviewGeneration: () => void;
  onScanQueryChange: (query: ConversationScanQuery) => void;
  onStartScan: (query: ConversationScanQuery) => Promise<void>;
  onOpenScan: () => void;
  onOpenSettings: () => void;
  onResumeReviewGeneration: (draftId: string) => Promise<void>;
  onRestartReviewGeneration: (draftId: string) => Promise<void>;
  onDeleteReviewGeneration: (draftId: string) => Promise<void>;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [validationMessage, setValidationMessage] = useState("");
  const [sessionOverlayOpen, setSessionOverlayOpen] = useState(false);
  const [previewingId, setPreviewingId] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [previewMeta, setPreviewMeta] = useState("");
  const [previewMessage, setPreviewMessage] = useState("");
  const [previewSessionId, setPreviewSessionId] = useState("");
  const [generationConfirmation, setGenerationConfirmation] = useState<{
    fingerprint: string;
    selectedCount: number;
    selectedBytes: number;
    sourceLabel: string;
    highRisk: boolean;
  } | null>(null);
  const [startDateOpenRequestKey, setStartDateOpenRequestKey] = useState(0);
  const previewRequestSeqRef = useRef(0);
  const handledScanJobIdRef = useRef("");
  const desktop = isDesktopRuntime();
  const todayKey = toDateKey(new Date());
  const { sourceFilter, dateFrom, dateTo, cwdQuery, keyword } = scanQuery;
  const aiReady = settings ? getEffectiveAiSettings(settings).keySource !== "missing" : false;

  const reviewBySessionId = useMemo(() => {
    const map = new Set<string>();
    reviews.forEach((review) => review.sessionIds?.forEach((id) => map.add(id)));
    return map;
  }, [reviews]);

  const selectedSessions = useMemo(
    () => indexedSessions.filter((session) => selectedIds.has(session.id)),
    [indexedSessions, selectedIds],
  );
  const selectedBytes = selectedSessions.reduce((sum, session) => sum + session.sizeBytes, 0);
  const selectedSources = Array.from(new Set(selectedSessions.map((session) => session.sourceKind)));
  const selectedSource = selectedSources[0];
  const resultSources = Array.from(new Set(indexedSessions.map((session) => session.sourceKind)));
  const hasMixedResultSources = resultSources.length > 1;
  const generationFingerprint = createConversationReviewFingerprint({
    selectedIds,
    selectedCount: selectedIds.size,
    selectedBytes,
    dateFrom,
    dateTo,
  });
  const latestInterruptedDraft = [...generationDrafts]
    .filter((draft) => draft.checkpoint && (draft.status === "cancelled" || draft.status === "failed" || draft.status === "paused"))
    .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt))[0];
  const currentScanKey = createConversationScanKey(scanQuery);
  const scanIsCurrent = Boolean(lastCompletedScanKey) && lastCompletedScanKey === currentScanKey;
  const scanFiltersChanged = indexedSessions.length > 0 && !scanIsCurrent;
  const scanActive = isConversationScanActive(scanTask);

  useEffect(() => {
    setSelectedIds(new Set());
    setGenerationConfirmation(null);
    setValidationMessage("");
  }, [lastCompletedScanKey]);

  useEffect(() => {
    if (scanTask?.status !== "completed" || handledScanJobIdRef.current === scanTask.jobId) return;
    handledScanJobIdRef.current = scanTask.jobId;
    setSelectedIds(new Set());
    setGenerationConfirmation(null);
    setValidationMessage("");
  }, [scanTask]);

  useEffect(() => {
    if (!generationConfirmation || generationConfirmation.fingerprint === generationFingerprint) return;
    setGenerationConfirmation(null);
    setValidationMessage("选择或筛选条件已变化，请重新确认生成。");
  }, [generationConfirmation, generationFingerprint]);

  const updateScanQuery = (patch: Partial<ConversationScanQuery>) => {
    onScanQueryChange({ ...scanQuery, ...patch });
    setGenerationConfirmation(null);
    setValidationMessage("");
  };

  const scan = () => {
    setGenerationConfirmation(null);
    setValidationMessage("");
    void onStartScan(scanQuery);
  };

  const filterToday = () => {
    updateScanQuery({ dateFrom: todayKey, dateTo: todayKey });
    setValidationMessage("已筛选今天，请扫描会话。");
  };

  const updateDateFrom = (value: string) => {
    updateScanQuery({ dateFrom: value });
  };

  const updateDateTo = (value: string) => {
    updateScanQuery({ dateTo: value });
  };

  const toggleSession = (id: string) => {
    if (scanFiltersChanged) {
      setValidationMessage("筛选条件已经改变，请先重新扫描会话。");
      return;
    }
    const session = indexedSessions.find((item) => item.id === id);
    if (!session) return;
    if (!selectedIds.has(id) && isConversationSourceLocked(selectedSource, session.sourceKind)) {
      setValidationMessage(`本次已选择 ${getSourceLabel(selectedSource)} 会话。请先取消当前选择，再切换来源。`);
      return;
    }
    setGenerationConfirmation(null);
    setValidationMessage("");
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleVisible = () => {
    if (scanFiltersChanged) {
      setValidationMessage("筛选条件已经改变，请先重新扫描会话。");
      return;
    }
    if (!selectedSource && hasMixedResultSources) {
      setValidationMessage("请先勾选一个会话确定来源，再全选同来源会话。");
      return;
    }
    const targetSource = selectedSource ?? resultSources[0];
    const eligibleSessions = targetSource
      ? indexedSessions.filter((session) => session.sourceKind === targetSource)
      : indexedSessions;
    setGenerationConfirmation(null);
    setValidationMessage("");
    setSelectedIds((current) => {
      const allSelected = eligibleSessions.length > 0 && eligibleSessions.every((session) => current.has(session.id));
      return allSelected ? new Set() : new Set(eligibleSessions.map((session) => session.id));
    });
  };

  const openSessionPreview = async (session: CodexSessionIndex) => {
    if (!desktop) {
      setPreviewMessage("会话正文预览需要在桌面端使用。");
      return;
    }
    const requestSeq = previewRequestSeqRef.current + 1;
    previewRequestSeqRef.current = requestSeq;
    setPreviewSessionId(session.id);
    setPreviewingId(session.id);
    setPreviewText("");
    setPreviewMeta("");
    setPreviewMessage("");
    try {
      const input = await readSelectedConversationSessions([session.id], createClientJobId());
      if (previewRequestSeqRef.current !== requestSeq) return;
      setPreviewText(input.transcriptChunks.join("\n\n"));
      setPreviewMeta(
        `${session.sourceLabel} · 最后活动 ${session.lastActiveDate ?? session.date} · ${input.totalChars.toLocaleString("zh-CN")} 字符${
          input.redacted ? " · 已脱敏" : ""
        }${input.truncated ? " · 已截断" : ""}`,
      );
    } catch (error) {
      if (previewRequestSeqRef.current !== requestSeq) return;
      setPreviewMessage(getSafeErrorMessage(error, "读取会话预览失败。"));
    } finally {
      if (previewRequestSeqRef.current === requestSeq) setPreviewingId("");
    }
  };

  const copyPreviewText = async () => {
    if (!previewText) return;
    setPreviewMessage("");
    try {
      await navigator.clipboard?.writeText(previewText);
      setPreviewMessage("已复制会话正文预览。");
    } catch (error) {
      setPreviewMessage(getSafeErrorMessage(error, "复制失败，请稍后再试。"));
    }
  };

  const startGeneration = async () => {
    setGenerationConfirmation(null);
    const sourceKind = selectedSources[0];
    const generationDate = dateFrom === dateTo && dateFrom
      ? dateFrom
      : dateTo || dateFrom || selectedSessions[0]?.lastActiveDate || selectedSessions[0]?.date || todayKey;
    try {
      await onStartReviewGeneration({
        reviewKey: `${generationDate}:source:${sourceKind}`,
        date: generationDate,
        reviewKind: "source",
        sourceKind,
        sourceLabel: getSourceLabel(sourceKind),
        selectedSessionIds: Array.from(selectedIds),
        activityDateFrom: dateFrom || undefined,
        activityDateTo: dateTo || undefined,
      });
      setValidationMessage("");
    } catch (error) {
      setValidationMessage(getSafeErrorMessage(error, "无法开始回顾生成任务。"));
    }
  };

  const generate = () => {
    if (!desktop) {
      setValidationMessage("AI 对话回顾需要在桌面端使用。");
      return;
    }
    if (scanActive) {
      onOpenScan();
      return;
    }
    if (taskRunning) {
      onOpenReviewGeneration();
      return;
    }
    if (!aiReady) {
      onOpenSettings();
      return;
    }
    if (selectedIds.size === 0) {
      setValidationMessage("请先勾选要回顾的会话。");
      return;
    }
    if (!scanIsCurrent) {
      setValidationMessage("筛选条件尚未扫描或已经改变，请先扫描会话。");
      return;
    }
    if (selectedSources.length > 1) {
      setValidationMessage("一次只能为一个来源生成回顾。");
      return;
    }

    const highRisk = shouldWarnLargeNoDateReview({
      selectedCount: selectedIds.size,
      selectedBytes,
      dateFrom,
      dateTo,
    });
    setValidationMessage("");
    setGenerationConfirmation({
      fingerprint: generationFingerprint,
      selectedCount: selectedIds.size,
      selectedBytes,
      sourceLabel: selectedSessions[0]?.sourceLabel || getSourceLabel(selectedSessions[0]?.sourceKind ?? "codex"),
      highRisk,
    });
  };

  const taskRunning = reviewGenerationTask?.status === "running";
  const eligibleSelectedSessions = selectedSource
    ? indexedSessions.filter((session) => session.sourceKind === selectedSource)
    : indexedSessions;
  const allEligibleSelected = eligibleSelectedSessions.length > 0
    && eligibleSelectedSessions.every((session) => selectedIds.has(session.id));
  const selectAllDisabled = scanActive || scanFiltersChanged || (!selectedSource && hasMixedResultSources);
  const primaryActionState = resolveConversationReviewPrimaryAction({
    desktop,
    reviewRunning: taskRunning,
    scanActive,
    scanCancelling: scanTask?.status === "cancelling",
    scanIsCurrent,
    hasSavedSessions: indexedSessions.length > 0,
    selectedCount: selectedIds.size,
    aiReady,
  });
  const primaryAction = {
    ...primaryActionState,
    icon: primaryActionState.id === "scan" || primaryActionState.id === "open-scan-progress"
      ? "scan" as const
      : primaryActionState.id === "configure-ai" ? "settings" as const : "review" as const,
    run: primaryActionState.id === "open-review-progress"
      ? onOpenReviewGeneration
      : primaryActionState.id === "open-scan-progress"
        ? onOpenScan
        : primaryActionState.id === "scan"
          ? scan
          : primaryActionState.id === "configure-ai" ? onOpenSettings : generate,
  };

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="mb-1.5 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line/70 pb-1.5">
        <div>
          <h3 className="text-lg font-semibold text-ink">AI 对话回顾台</h3>
          <p className="mt-0.5 max-w-3xl truncate text-xs text-ink/45">
            扫描会在本地核对消息时间戳和类型，不保存正文，也不会调用 AI；确认生成后才会读取、脱敏并分段发送正文。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="soft-button action-compact"
            disabled={indexedSessions.length === 0}
            onClick={() => setSessionOverlayOpen(true)}
          >
            <Maximize2 size={13} />
            放大会话
          </button>
          {scanIsCurrent && !taskRunning && !scanActive && (
            <button
              className="soft-button action-compact"
              disabled={!desktop}
              onClick={scan}
            >
              <RefreshCw size={13} />
              重新扫描
            </button>
          )}
        </div>
      </div>

      {!desktop && (
        <div className="mb-2 shrink-0 rounded-[8px] border border-line bg-panel px-3 py-2 text-sm leading-6 text-ink/70">
          AI 对话回顾需要桌面端。本页面在浏览器模式下不会读取本机路径。
        </div>
      )}

      {!taskRunning && latestInterruptedDraft && (
        <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-[8px] border border-line bg-surface px-3 py-2 text-xs leading-5 text-ink/60">
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-ink/80">有一项未完成的回顾生成任务</div>
            <p className="truncate">{latestInterruptedDraft.message || "已保存检查点，可继续生成。"}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button className="primary-button action-compact" onClick={() => void onResumeReviewGeneration(latestInterruptedDraft.id)}>继续生成</button>
            <button className="secondary-action action-compact" onClick={() => void onRestartReviewGeneration(latestInterruptedDraft.id)}>重新开始</button>
            <button className="ghost-action action-compact" onClick={() => void onDeleteReviewGeneration(latestInterruptedDraft.id)}>删除任务</button>
          </div>
        </div>
      )}

      <div className="mb-1.5 grid shrink-0 gap-1.5 md:grid-cols-[150px_150px_150px_72px_minmax(0,1fr)_minmax(0,1fr)]">
        <label className="space-y-0.5 text-[11px] text-ink/50">
          来源
          <SelectMenu
            value={sourceFilter}
            options={[
              { value: "all", label: "全部来源" },
              { value: "codex", label: "Codex" },
              { value: "claude", label: "Claude Code" },
            ]}
            onChange={(value) => updateScanQuery({ sourceFilter: value as "all" | ConversationSourceKind })}
            triggerClassName="field-standard px-2.5 text-xs"
            disabled={scanActive}
          />
        </label>
        <label className="space-y-0.5 text-[11px] text-ink/50">
          活动起日
          <DatePickerPopover
            value={dateFrom}
            onChange={updateDateFrom}
            onClear={() => updateDateFrom("")}
            placeholder="活动起日"
            buttonLabel="选择活动起日"
            openRequestKey={startDateOpenRequestKey}
            disabled={scanActive}
          />
        </label>
        <label className="space-y-0.5 text-[11px] text-ink/50">
          活动止日
          <DatePickerPopover
            value={dateTo}
            onChange={updateDateTo}
            onClear={() => updateDateTo("")}
            placeholder="活动止日"
            buttonLabel="选择活动止日"
            disabled={scanActive}
          />
        </label>
        <label className="space-y-0.5 text-[11px] text-ink/50">
          快捷
          <button
            type="button"
            className={`soft-button action-standard w-full text-xs ${dateFrom === todayKey && dateTo === todayKey ? "active-toggle" : ""}`}
            onClick={filterToday}
            disabled={scanActive}
          >
            今日
          </button>
        </label>
        <label className="space-y-0.5 text-[11px] text-ink/50">
          路径筛选
          <input value={cwdQuery} onChange={(event) => updateScanQuery({ cwdQuery: event.target.value })} className="field-control field-standard w-full px-2 text-xs" placeholder="例如 个人知识库" disabled={scanActive} />
        </label>
        <label className="space-y-0.5 text-[11px] text-ink/50">
          关键词
          <input value={keyword} onChange={(event) => updateScanQuery({ keyword: event.target.value })} className="field-control field-standard w-full px-2 text-xs" placeholder="标题、意图、路径" disabled={scanActive} />
        </label>
      </div>

      <div className="mb-1.5 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-[8px] border border-line bg-panel/55 px-3 py-1.5">
        <div className="text-xs leading-5 text-ink/52">
          已选 {selectedIds.size} 个会话 · {formatBytes(selectedBytes)} · 生成时才读取正文
        </div>
        <div className="flex gap-2">
          <button
            className="soft-button action-compact disabled:cursor-not-allowed disabled:opacity-50"
            disabled={selectAllDisabled}
            onClick={toggleVisible}
            title={scanActive ? "扫描进行中" : selectAllDisabled && hasMixedResultSources ? "请先勾选一个会话确定来源" : undefined}
          >
            {allEligibleSelected ? "取消全选" : selectedSource ? "全选同来源" : "全选当前"}
          </button>
          <button
            className="primary-button action-compact disabled:cursor-not-allowed disabled:opacity-60"
            disabled={primaryAction.disabled}
            onClick={primaryAction.run}
          >
            {primaryAction.icon === "scan"
              ? <Search size={14} />
              : primaryAction.icon === "settings"
                ? <Settings2 size={14} />
                : taskRunning
                  ? <RefreshCw size={14} className="animate-spin" />
                  : <Sparkles size={14} />}
            {primaryAction.label}
          </button>
        </div>
      </div>

      {indexedSessions.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-[8px] border border-dashed border-line bg-panel/70 p-5 text-center text-sm leading-6 text-ink/45">
          点击“扫描会话”后，会在这里显示可勾选的 AI 对话会话。
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 overflow-hidden gap-3 xl:grid-cols-[minmax(360px,0.9fr)_minmax(0,1.1fr)]">
          <div className="min-h-0 overflow-y-auto rounded-[8px] border border-line bg-surface scrollbar-thin">
            {indexedSessions.map((session) => {
              const selected = selectedIds.has(session.id);
              const activePreview = previewSessionId === session.id;
              const sourceLocked = isConversationSourceLocked(selectedSource, session.sourceKind);
              const selectionDisabled = scanActive || scanFiltersChanged || sourceLocked;
              return (
                <article
                  key={`${session.id}-${session.path}`}
                  className={`grid grid-cols-[28px_minmax(0,1fr)_auto] gap-3 border-b border-line/70 px-3 py-3 text-left transition last:border-b-0 ${
                    activePreview ? "bg-panel" : selected ? "bg-moss/10" : "bg-surface hover:bg-panel/70"
                  }`}
                >
                  <button
                    type="button"
                    className="mt-0.5 text-moss disabled:cursor-not-allowed disabled:text-ink/20"
                    aria-pressed={selected}
                    disabled={selectionDisabled}
                    title={sourceLocked ? `本次已选择 ${getSourceLabel(selectedSource)} 来源` : selected ? "取消勾选" : "勾选生成"}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleSession(session.id);
                    }}
                  >
                    {selected ? <SquareCheck size={17} /> : <Square size={17} />}
                  </button>
                  <button
                    type="button"
                    className="min-w-0 text-left"
                    onClick={() => void openSessionPreview(session)}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-ink">{session.title}</span>
                      <span className="quiet-chip py-0.5 text-[11px] text-ink/45">{session.sourceLabel}</span>
                      {reviewBySessionId.has(session.id) && (
                        <span className="quiet-chip py-0.5 text-[11px] text-ink/45">已回顾</span>
                      )}
                    </span>
                    <span className="mt-1 block truncate text-xs text-ink/45">{session.cwd || session.path}</span>
                    <span className="mt-1 line-clamp-3 text-xs leading-5 text-ink/54">{session.preview || "扫描阶段只读取元信息；点击后可在右侧只读预览正文。"}</span>
                  </button>
                  <span className="text-right text-[11px] leading-5 text-ink/42">
                    <span className="block text-ink/58">最后活动 {session.lastActiveDate ?? session.date}</span>
                    {(session.startedDate ?? session.date) !== (session.lastActiveDate ?? session.date) && (
                      <span className="block">开始于 {session.startedDate ?? session.date}</span>
                    )}
                    <span className="block">{formatBytes(session.sizeBytes)}</span>
                    {previewingId === session.id && <span className="block text-copper">读取中</span>}
                  </span>
                </article>
              );
            })}
          </div>

          <div className="flex min-h-0 flex-col rounded-[8px] border border-line bg-panel/70 p-4">
            <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-ink">会话正文预览</div>
                <div className="mt-1 text-xs text-ink/45">{previewMeta || "点击左侧会话后，本地读取并脱敏显示正文。"}</div>
              </div>
              {previewText && (
                <button className="soft-button action-compact" onClick={() => void copyPreviewText()}>
                  复制
                </button>
              )}
            </div>
            {previewMessage && <div className="mb-3 shrink-0 rounded-[8px] border border-line bg-surface p-3 text-xs leading-5 text-ink/70">{previewMessage}</div>}
            <pre className="conversation-code-surface min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded-[8px] bg-surface p-4 text-anywhere text-xs leading-6 text-ink/66 scrollbar-thin">
              {previewText || "还没有打开任何会话正文。"}
            </pre>
          </div>
        </div>
      )}

      {(reviewGenerationTask || scanTask || validationMessage) && (
        <div className="mt-2 shrink-0 rounded-[8px] border border-line bg-panel px-3 py-2 text-sm leading-6 text-ink/62" aria-live="polite">
          <div className="min-w-0">
            {reviewGenerationTask && (
              <div className="flex items-center gap-2 text-xs font-medium text-ink">
                {taskRunning && <RefreshCw size={14} className="animate-spin text-moss" />}
                <span>{reviewGenerationTask.progress?.stage ?? "回顾生成"}</span>
                <span className="truncate font-normal text-ink/45">{reviewGenerationTask.message}</span>
              </div>
            )}
            {scanTask && (
              <div className={`${reviewGenerationTask ? "mt-1" : ""} flex items-center gap-2 text-xs text-ink/48`}>
                {scanActive && <RefreshCw size={13} className="animate-spin text-moss" />}
                <span>{scanTask.message}</span>
              </div>
            )}
            {validationMessage && <p className="mt-1 text-xs font-medium text-copper">{validationMessage}</p>}
          </div>
        </div>
      )}

      {sessionOverlayOpen && (
        <ConversationSessionPreviewOverlay
          sessions={indexedSessions}
          selectedIds={selectedIds}
          lockedSourceKind={selectedSource}
          selectionDisabled={scanActive || scanFiltersChanged}
          onToggleSession={toggleSession}
          onClose={() => setSessionOverlayOpen(false)}
        />
      )}
      <ConfirmDialog
        open={Boolean(generationConfirmation)}
        title={generationConfirmation?.highRisk ? "确认按当前范围生成" : "确认生成回顾"}
        message={generationConfirmation
          ? (
              <div className="space-y-3">
                <section>
                  <div className="text-xs font-semibold text-ink/72">当前选择</div>
                  <div className="mt-1.5 grid gap-1 text-xs leading-5 text-ink/58">
                    <span>{generationConfirmation.sourceLabel}</span>
                    <span>{generationConfirmation.selectedCount} 个会话，原始文件约 {formatBytes(generationConfirmation.selectedBytes)}</span>
                    <span>{dateFrom || dateTo ? `${dateFrom || "最早"} 至 ${dateTo || "现在"}` : "未限定活动日期"}</span>
                  </div>
                </section>

                {generationConfirmation.highRisk && (
                  <section className="border-t border-line/70 pt-3">
                    <div className="text-xs font-semibold text-copper">当前范围较大</div>
                    <p className="mt-1.5 text-xs leading-5 text-ink/52">
                      {!dateFrom && !dateTo
                        ? "未设置活动日期可能延长处理时间。受本地读取上限影响，结果也可能无法覆盖全部内容。"
                        : "所选会话文件体积较大，处理时间可能更长。受本地读取上限影响，结果也可能无法覆盖全部内容。"}
                    </p>
                  </section>
                )}

                <section className="border-t border-line/70 pt-3">
                  <div className="text-xs font-semibold text-ink/72">数据如何处理</div>
                  <p className="mt-1.5 text-xs leading-5 text-ink/52">
                    Daymark 会在本地读取和脱敏所选会话，只把整理后的分段文本发送给当前 AI 服务。未选择的会话不会读取。
                  </p>
                </section>
              </div>
            )
          : ""}
        confirmLabel={generationConfirmation?.highRisk ? "仍然生成" : "确认生成"}
        secondaryLabel={generationConfirmation?.highRisk ? "选择日期" : undefined}
        cancelLabel="取消"
        showCloseButton={false}
        onCancel={() => setGenerationConfirmation(null)}
        onConfirm={async () => {
          if (!generationConfirmation) return;
          if (generationConfirmation.fingerprint !== generationFingerprint) {
            setGenerationConfirmation(null);
            setValidationMessage("选择或筛选条件已变化，请重新确认生成。");
            return;
          }
          await startGeneration();
        }}
        onSecondary={async () => {
          setGenerationConfirmation(null);
          setValidationMessage("请设置活动日期并重新扫描会话。");
          setStartDateOpenRequestKey((current) => current + 1);
        }}
      />
    </section>
  );
}

function ReviewArchivePanel({
  reports,
  codexReviews,
  rollingWorkReviews,
  dailyReviewDrafts,
  memoryPatchDrafts,
  targetReviewId,
  targetReviewDraftId,
  targetSummaryId,
  onOpenCodexReview,
  onOpenSummaryReport,
  onGenerateCombinedReview,
  onUpdateDailyReviewDraft,
  onGenerateMemorySuggestion,
  onApplyDailyReviewDraft,
  onIgnoreDailyReviewDraft,
  onArchiveRollingWorkReview,
}: {
  reports: SummaryReport[];
  codexReviews: CodexDailyReview[];
  rollingWorkReviews: RollingWorkReview[];
  dailyReviewDrafts: DailyReviewReplacementDraft[];
  memoryPatchDrafts: MemoryPatchDraft[];
  targetReviewId?: string;
  targetReviewDraftId?: string;
  targetSummaryId?: string;
  onOpenCodexReview: (review: CodexDailyReview) => void;
  onOpenSummaryReport: (report: SummaryReport) => void;
  onGenerateCombinedReview: (
    reviews: CodexDailyReview[],
    onProgress?: (progress: CodexReviewProgress) => void,
    signal?: AbortSignal,
  ) => Promise<GenerateCodexReviewResult>;
  onUpdateDailyReviewDraft: (
    id: string,
    patch: Partial<DailyReviewReplacementDraft>,
  ) => Promise<DailyReviewReplacementDraft>;
  onGenerateMemorySuggestion: (
    source: ReviewMemorySuggestionSource,
    onProgress?: (progress: CodexReviewProgress) => void,
    signal?: AbortSignal,
  ) => Promise<MemorySuggestionGenerationResult>;
  onApplyDailyReviewDraft: (id: string) => Promise<void>;
  onIgnoreDailyReviewDraft: (id: string) => Promise<void>;
  onArchiveRollingWorkReview: (date: string) => Promise<unknown>;
}) {
  const [combiningDate, setCombiningDate] = useState("");
  const [message, setMessage] = useState("");
  const [pendingCombineDate, setPendingCombineDate] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "codex" | "claude" | "combined" | "journal" | "auto">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateSearchOpen, setDateSearchOpen] = useState(false);
  const [draftAction, setDraftAction] = useState<{ id: string; kind: "apply" | "ignore" } | null>(null);
  const [selectedDraft, setSelectedDraft] = useState<DailyReviewReplacementDraft | null>(null);
  const [pendingDraftAction, setPendingDraftAction] = useState<{ draft: DailyReviewReplacementDraft; kind: "apply" | "ignore" } | null>(null);
  const [activeRollingReview, setActiveRollingReview] = useState<RollingWorkReview | null>(null);
  const [rollingArchiveDate, setRollingArchiveDate] = useState("");

  useEffect(() => {
    const targetId = targetReviewDraftId
      ? `review-draft-${targetReviewDraftId}`
      : targetReviewId
        ? `archive-review-${targetReviewId}`
        : targetSummaryId
          ? `archive-report-${targetSummaryId}`
          : "";
    if (!targetId) return undefined;

    const timeout = window.setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 180);

    return () => window.clearTimeout(timeout);
  }, [targetReviewDraftId, targetReviewId, targetSummaryId]);

  useEffect(() => {
    if (!activeRollingReview) return;
    const latest = rollingWorkReviews.find((review) => review.date === activeRollingReview.date);
    if (latest && latest !== activeRollingReview) setActiveRollingReview(latest);
  }, [activeRollingReview, rollingWorkReviews]);

  const sourceGroups = useMemo(() => {
    const map = new Map<string, CodexDailyReview[]>();
    codexReviews
      .filter((review) => review.reviewKind === "source")
      .forEach((review) => {
        const group = map.get(review.date) ?? [];
        group.push(review);
        map.set(review.date, group);
      });
    return map;
  }, [codexReviews]);
  const combinedKeys = new Set(
    codexReviews.filter((review) => review.reviewKind === "combined").map((review) => review.date),
  );
  const pendingReviewDrafts = useMemo(
    () => dailyReviewDrafts.filter((draft) => draft.status === "pending"),
    [dailyReviewDrafts],
  );
  const archiveEntries = useMemo(() => {
    const rangeStart = dateFrom && dateTo && dateFrom > dateTo ? dateTo : dateFrom;
    const rangeEnd = dateFrom && dateTo && dateFrom > dateTo ? dateFrom : dateTo;
    const conversationEntries = codexReviews
      .filter((review) => review.reviewKind !== "auto-work")
      .map((review) => ({
      id: `review-${review.id}`,
      category: (review.reviewKind === "combined" ? "combined" : (review.sourceKind ?? "codex")) as
        | "codex"
        | "claude"
        | "combined",
      date: review.date,
      title: review.title,
      subtitle: `${review.sourceLabel} · ${review.sessionCount} 个会话`,
      content: review.content,
      reviewId: review.id,
      reportId: "",
      review,
      report: null,
    }));
    const autoEntries = rollingWorkReviews
      .filter((review) => review.content.trim())
      .map((review) => ({
        id: `auto-${review.id}`,
        category: "auto" as const,
        date: review.date,
        title: review.title,
        subtitle: `${review.archiveReviewId ? "已归档" : "自动草稿"} · ${review.processedSessionCount} 次会话增量`,
        content: review.content,
        reviewId: "",
        reportId: "",
        rollingReview: review,
        review: null,
        report: null,
      }));
    const reportEntries = reports.map((report) => ({
      id: `report-${report.id}`,
      category: "journal" as const,
      date: report.periodEnd,
      title: report.title,
      subtitle: `${getSummaryReportLabel(report.periodType)} · ${report.periodStart} 至 ${report.periodEnd}`,
      content: report.content,
      reviewId: "",
      reportId: report.id,
      review: null,
      report,
    }));
    return [...conversationEntries, ...autoEntries, ...reportEntries]
      .filter((entry) => sourceFilter === "all" || entry.category === sourceFilter)
      .filter((entry) => (!rangeStart || entry.date >= rangeStart) && (!rangeEnd || entry.date <= rangeEnd))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [codexReviews, dateFrom, dateTo, reports, rollingWorkReviews, sourceFilter]);

  const combine = async (date: string, reviews: CodexDailyReview[]) => {
    if (combiningDate && combiningDate !== date) {
      setMessage("已有一个 AI 回顾正在合成，完成后再开始新的合成。");
      return;
    }
    if (combiningDate === date) return;

    if (pendingCombineDate !== date) {
      setPendingCombineDate(date);
      setMessage(`将读取 ${date} 的 ${reviews.length} 份来源回顾并调用 AI 合并为今日回顾。确认生成后才会开始。`);
      return;
    }
    setCombiningDate(date);
    setPendingCombineDate("");
    setMessage("");
    try {
      const result = await onGenerateCombinedReview(reviews);
      setMessage(formatReviewGenerationResult(result));
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "合成今日总回顾失败。"));
    } finally {
      setCombiningDate("");
    }
  };

  const applyDraft = async (draft: DailyReviewReplacementDraft) => {
    if (draftAction) return;
    setDraftAction({ id: draft.id, kind: "apply" });
    setMessage("");
    try {
      await onApplyDailyReviewDraft(draft.id);
      setMessage(`已替换为“${draft.title}”。`);
      setSelectedDraft(null);
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "替换当前回顾失败。"));
    } finally {
      setPendingDraftAction(null);
      setDraftAction(null);
    }
  };

  const ignoreDraft = async (draft: DailyReviewReplacementDraft) => {
    if (draftAction) return;
    setDraftAction({ id: draft.id, kind: "ignore" });
    setMessage("");
    try {
      await onIgnoreDailyReviewDraft(draft.id);
      setMessage(`已舍弃“${draft.title}”，当前回顾保持不变。`);
      setSelectedDraft(null);
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "舍弃待确认更新失败。"));
    } finally {
      setPendingDraftAction(null);
      setDraftAction(null);
    }
  };

  const archiveRollingReview = async (review: RollingWorkReview) => {
    if (rollingArchiveDate) return;
    setRollingArchiveDate(review.date);
    setMessage("");
    try {
      await onArchiveRollingWorkReview(review.date);
      setMessage(`已将「${review.title}」保存到回顾档案。`);
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "保存自动工作回顾失败。"));
    } finally {
      setRollingArchiveDate("");
    }
  };

  return (
    <aside className="section-surface flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            <History size={16} />
            回顾档案
          </div>
          <p className="mt-1 text-xs leading-5 text-ink/45">按来源与日期筛选；需要时打开阅读页。</p>
        </div>
        <button className="soft-button action-compact" onClick={() => setDateSearchOpen((value) => !value)}>
          日期
        </button>
      </div>

      <div className="flex shrink-0 flex-wrap gap-1.5">
        {[
          ["all", "全部"],
          ["codex", "Codex"],
          ["claude", "Claude"],
          ["combined", "综合"],
          ["auto", "自动"],
          ["journal", "日志"],
        ].map(([value, label]) => (
          <button
            key={value}
            className={`action-micro rounded-[8px] border transition ${
              sourceFilter === value
                ? "border-moss/35 bg-moss/15 text-moss"
                : "border-line bg-panel/70 text-ink/50 hover:text-ink"
            }`}
            onClick={() => setSourceFilter(value as typeof sourceFilter)}
          >
            {label}
          </button>
        ))}
      </div>

      {dateSearchOpen && (
        <div className="grid shrink-0 gap-2 sm:grid-cols-2">
          <label className="space-y-0.5 text-[11px] text-ink/50">
            起始日期
            <DatePickerPopover
              value={dateFrom}
              onChange={setDateFrom}
              onClear={() => setDateFrom("")}
              placeholder="起始日期"
              buttonLabel="选择档案起始日期"
            />
          </label>
          <label className="space-y-0.5 text-[11px] text-ink/50">
            结束日期
            <DatePickerPopover
              value={dateTo}
              onChange={setDateTo}
              onClear={() => setDateTo("")}
              placeholder="结束日期"
              buttonLabel="选择档案结束日期"
            />
          </label>
        </div>
      )}

      {pendingReviewDrafts.length > 0 && (
        <ScrollableResultPanel
          title="待确认更新"
          count={`${pendingReviewDrafts.length} 项待确认`}
          status="确认后才会替换当前回顾。"
          maxHeightClass="max-h-[260px]"
          bodyClassName="space-y-2"
        >
          {pendingReviewDrafts.map((draft) => {
            const applying = draftAction?.id === draft.id && draftAction.kind === "apply";
            const ignoring = draftAction?.id === draft.id && draftAction.kind === "ignore";

            return (
              <ResultRow key={draft.id} id={`review-draft-${draft.id}`} className="border-copper/20 bg-copper/5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-ink/45">
                      <span>{draft.date}</span>
                      <span>{draft.sourceLabel}</span>
                      <span>{draft.sessionCount} 个会话</span>
                    </div>
                    <h3 className="line-clamp-2 text-anywhere text-sm font-semibold text-ink">{draft.title}</h3>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button className="soft-button action-micro" onClick={() => setSelectedDraft(draft)}>
                      查看
                    </button>
                    <button
                      className="soft-button action-micro"
                      disabled={Boolean(draftAction)}
                      onClick={() => setPendingDraftAction({ draft, kind: "ignore" })}
                    >
                      {ignoring ? "舍弃中" : "舍弃"}
                    </button>
                    <button
                      className="primary-button action-micro"
                      disabled={Boolean(draftAction)}
                      onClick={() => setPendingDraftAction({ draft, kind: "apply" })}
                    >
                      {applying ? "替换中" : "替换当前回顾"}
                    </button>
                  </div>
                </div>
                <BoundedPreview maxLinesClass="line-clamp-2" className="mt-2 text-sm leading-6 text-ink/58">
                  {draft.content}
                </BoundedPreview>
              </ResultRow>
            );
          })}
        </ScrollableResultPanel>
      )}

      {codexReviews.length > 0 && (
        <div className="max-h-[160px] shrink-0 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
          {Array.from(sourceGroups.entries()).map(([date, reviews]) =>
            reviews.length >= 2 && !combinedKeys.has(date) ? (
              <div key={`combine-${date}`} className="rounded-[8px] border border-copper/25 bg-copper/10 p-3">
                <div className="text-xs font-semibold text-copper">{date} 可合成今日总回顾</div>
                <p className="mt-1 text-xs leading-5 text-ink/50">已有 {reviews.map((review) => review.sourceLabel).join("、")} 回顾，可合并为一份今日回顾。</p>
                <button
                  className="soft-button action-compact mt-2"
                  disabled={Boolean(combiningDate)}
                  onClick={() => void combine(date, reviews)}
                >
                  {combiningDate === date ? "合成中" : pendingCombineDate === date ? "确认合成" : "合成今日总回顾"}
                </button>
              </div>
            ) : null,
          )}
        </div>
      )}

      {archiveEntries.length > 0 && (
        <ScrollableResultPanel
          fill
          title="档案列表"
          count={`${archiveEntries.length} 条`}
          bodyClassName="space-y-2"
        >
          {archiveEntries.map((entry) => {
            const clickable = Boolean(entry.review || entry.report);
            const content = (
              <>
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-ink/45">
                  <span>{entry.date}</span>
                  <span className="quiet-chip py-0.5 text-[11px] text-ink/45">{getArchiveCategoryLabel(entry.category)}</span>
                </div>
                <h3 className="line-clamp-2 text-anywhere text-sm font-semibold text-ink">{entry.title}</h3>
                <p className="mt-1 text-anywhere text-xs text-ink/42">{entry.subtitle}</p>
                <BoundedPreview maxLinesClass="line-clamp-3" className="mt-2 text-sm leading-6 text-ink/62">
                  {entry.content}
                </BoundedPreview>
              </>
            );

            if ("rollingReview" in entry && entry.rollingReview) {
              return (
                <ResultRow
                  key={entry.id}
                  id={`archive-auto-${entry.rollingReview.id}`}
                  selected={activeRollingReview?.date === entry.rollingReview.date}
                  onClick={() => setActiveRollingReview(entry.rollingReview)}
                >
                  {content}
                </ResultRow>
              );
            }

            return clickable && entry.review ? (
              <ResultRow
                key={entry.id}
                id={`archive-review-${entry.reviewId}`}
                selected={targetReviewId === entry.reviewId}
                onClick={() => onOpenCodexReview(entry.review!)}
              >
                {content}
              </ResultRow>
            ) : (
              <ResultRow
                key={entry.id}
                id={`archive-report-${entry.reportId}`}
                selected={targetSummaryId === entry.reportId}
                onClick={entry.report ? () => onOpenSummaryReport(entry.report) : undefined}
              >
                {content}
              </ResultRow>
            );
          })}
        </ScrollableResultPanel>
      )}

      {message && <p className="shrink-0 text-xs text-anywhere text-ink/45">{message}</p>}

      {archiveEntries.length === 0 && <p className="text-sm leading-6 text-ink/45">回顾写好后，会在这里安静留档。</p>}

      {activeRollingReview && (
        <RollingWorkReviewArchiveOverlay
          review={activeRollingReview}
          archiving={rollingArchiveDate === activeRollingReview.date}
          onArchive={() => void archiveRollingReview(activeRollingReview)}
          onClose={() => setActiveRollingReview(null)}
        />
      )}
      {selectedDraft && (
        <ReviewReplacementDraftOverlay
          draft={selectedDraft}
          memoryPatchDraft={memoryPatchDrafts.find(
            (patchDraft) => patchDraft.sourceReviewDraftId === selectedDraft.id,
          )}
          onSave={onUpdateDailyReviewDraft}
          onSaved={setSelectedDraft}
          onGenerateMemorySuggestion={onGenerateMemorySuggestion}
          onRequestApply={(draft) => setPendingDraftAction({ draft, kind: "apply" })}
          onRequestIgnore={(draft) => setPendingDraftAction({ draft, kind: "ignore" })}
          onClose={() => setSelectedDraft(null)}
        />
      )}
      <ConfirmDialog
        open={Boolean(pendingDraftAction)}
        title={pendingDraftAction?.kind === "apply" ? "替换当前回顾？" : "舍弃这份更新？"}
        message={pendingDraftAction?.kind === "apply"
          ? `确认后将用“${pendingDraftAction.draft.title}”替换 ${pendingDraftAction.draft.date} 的当前回顾。`
          : "这份待确认更新将被删除，当前回顾保持不变。"}
        confirmLabel={pendingDraftAction?.kind === "apply" ? "确认替换" : "舍弃更新"}
        danger={pendingDraftAction?.kind === "ignore"}
        onCancel={() => setPendingDraftAction(null)}
        onConfirm={async () => {
          if (!pendingDraftAction) return;
          if (pendingDraftAction.kind === "apply") {
            await applyDraft(pendingDraftAction.draft);
            return;
          }
          await ignoreDraft(pendingDraftAction.draft);
        }}
      />
    </aside>
  );
}

function ReviewReplacementDraftOverlay({
  draft,
  memoryPatchDraft,
  onSave,
  onSaved,
  onGenerateMemorySuggestion,
  onRequestApply,
  onRequestIgnore,
  onClose,
}: {
  draft: DailyReviewReplacementDraft;
  memoryPatchDraft?: MemoryPatchDraft;
  onSave: (
    id: string,
    patch: Partial<DailyReviewReplacementDraft>,
  ) => Promise<DailyReviewReplacementDraft>;
  onSaved: (draft: DailyReviewReplacementDraft) => void;
  onGenerateMemorySuggestion: (
    source: ReviewMemorySuggestionSource,
    onProgress?: (progress: CodexReviewProgress) => void,
    signal?: AbortSignal,
  ) => Promise<MemorySuggestionGenerationResult>;
  onRequestApply: (draft: DailyReviewReplacementDraft) => void;
  onRequestIgnore: (draft: DailyReviewReplacementDraft) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(draft.title);
  const [content, setContent] = useState(draft.content);
  const [savedTitle, setSavedTitle] = useState(draft.title);
  const [savedContent, setSavedContent] = useState(draft.content);
  const [saving, setSaving] = useState(false);
  const [suggestionRunning, setSuggestionRunning] = useState(false);
  const [message, setMessage] = useState("");
  const saveTimerRef = useRef<number | null>(null);
  const savePromiseRef = useRef<Promise<DailyReviewReplacementDraft | null> | null>(null);
  const latestValuesRef = useRef({ title: draft.title, content: draft.content });
  const savedValuesRef = useRef({ title: draft.title, content: draft.content });
  const draftRef = useRef(draft);
  const dirty = title !== savedTitle || content !== savedContent;
  const suggestionContentVersion = memoryPatchDraft?.sourceReviewContentVersion
    ?? draft.memorySuggestionCheckpoint?.sourceContentVersion;
  const suggestionSourceOutdated = isMemorySuggestionSourceOutdated(
    suggestionContentVersion,
    title,
    content,
  );
  const suggestionAlreadyResolved = draft.memorySuggestionStatus === "created"
    || draft.memorySuggestionStatus === "none";
  const canGenerateSuggestion = suggestionSourceOutdated
    || (!memoryPatchDraft && !suggestionAlreadyResolved);

  useEffect(() => {
    setTitle(draft.title);
    setContent(draft.content);
    setSavedTitle(draft.title);
    setSavedContent(draft.content);
    setMessage("");
    latestValuesRef.current = { title: draft.title, content: draft.content };
    savedValuesRef.current = { title: draft.title, content: draft.content };
    draftRef.current = draft;
  }, [draft.id]);

  useEffect(() => {
    latestValuesRef.current = { title, content };
  }, [content, title]);

  const persistDraft = async () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (savePromiseRef.current) {
      await savePromiseRef.current;
    }

    const values = latestValuesRef.current;
    const savedValues = savedValuesRef.current;
    if (values.title === savedValues.title && values.content === savedValues.content) {
      return { ...draftRef.current, ...values };
    }

    setSaving(true);
    setMessage("正在保存修改。");
    const request = onSave(draftRef.current.id, values)
      .then((updated) => {
        draftRef.current = updated;
        savedValuesRef.current = { title: updated.title, content: updated.content };
        setSavedTitle(updated.title);
        setSavedContent(updated.content);
        onSaved(updated);
        setMessage("修改已自动保存。");
        return updated;
      })
      .catch((error) => {
        setMessage(getSafeErrorMessage(error, "自动保存失败，当前内容仍保留在编辑区。"));
        return null;
      });
    savePromiseRef.current = request;
    const result = await request;
    if (savePromiseRef.current === request) {
      savePromiseRef.current = null;
      setSaving(false);
    }
    return result;
  };

  useEffect(() => {
    if (!dirty || suggestionRunning) return undefined;
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void persistDraft();
    }, 500);
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [content, dirty, suggestionRunning, title]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const flushThen = async (action: (savedDraft: DailyReviewReplacementDraft) => void) => {
    if (suggestionRunning) {
      setMessage("长期记忆建议正在生成，请稍候。");
      return;
    }
    const savedDraft = await persistDraft();
    if (savedDraft) action(savedDraft);
  };

  const generateSuggestion = async () => {
    if (suggestionRunning) return;
    const savedDraft = await persistDraft();
    if (!savedDraft) return;
    setSuggestionRunning(true);
    setMessage("正在生成长期记忆建议。");
    try {
      const result = await onGenerateMemorySuggestion({ kind: "replacement", draft: savedDraft });
      setMessage(formatMemorySuggestionResult(result));
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "长期记忆建议未生成，可稍后重试。"));
    } finally {
      setSuggestionRunning(false);
    }
  };

  const requestClose = () => {
    void flushThen(() => onClose());
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [suggestionRunning]);

  return (
    <div className="modal-backdrop">
      <section
        aria-label="编辑待确认更新"
        aria-modal="true"
        className="modal-surface flex max-h-[92vh] w-full max-w-5xl flex-col"
        role="dialog"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line bg-panel/70 px-5 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-copper">Pending Review</p>
            <h3 className="mt-1 text-lg font-semibold text-ink">待确认更新</h3>
            <p className="mt-1 text-xs text-ink/45">
              {draft.date} · {draft.sourceLabel} · {draft.sessionCount} 个会话
            </p>
          </div>
          <button
            type="button"
            className="ghost-action icon-action-compact disabled:opacity-45"
            disabled={saving || suggestionRunning}
            onClick={requestClose}
            title="关闭"
            aria-label="关闭待确认更新"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 p-5">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="field-control field-prominent w-full text-base font-semibold"
            aria-label="待确认回顾标题"
          />
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            className="field-control h-[min(64vh,680px)] min-h-[360px] w-full flex-1 resize-none overflow-y-auto px-4 py-3 text-sm leading-7 text-ink/76 scrollbar-thin"
            aria-label="待确认回顾正文"
          />
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line bg-panel/70 px-5 py-3">
          <div className="min-w-0 text-anywhere text-xs leading-5 text-ink/45" aria-live="polite">
            <p>{message || (saving ? "正在保存修改。" : "停止输入约半秒后自动保存。")}</p>
            {memoryPatchDraft && suggestionSourceOutdated && (
              <p className="mt-1 font-medium text-copper">来源回顾已修改，现有长期记忆建议仍基于修改前的内容。</p>
            )}
            {memoryPatchDraft && !suggestionSourceOutdated && (
              <p className="mt-1">长期记忆建议已保存到“记忆审核”，尚未写入长期记忆。</p>
            )}
            {!memoryPatchDraft && draft.memorySuggestionStatus && (
              <p className="mt-1">{getMemorySuggestionStatusNote(draft.memorySuggestionStatus)}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {canGenerateSuggestion && (
              <button
                type="button"
                className="soft-button action-standard disabled:opacity-55"
                disabled={saving || suggestionRunning}
                onClick={() => void generateSuggestion()}
              >
                {suggestionRunning ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {memoryPatchDraft ? "重新生成长期记忆建议" : "生成长期记忆建议"}
              </button>
            )}
            <button
              type="button"
              className="danger-action action-standard disabled:opacity-55"
              disabled={saving || suggestionRunning}
              onClick={() => void flushThen(onRequestIgnore)}
            >
              舍弃
            </button>
            <button
              type="button"
              className="primary-button action-standard disabled:opacity-55"
              disabled={saving || suggestionRunning}
              onClick={() => void flushThen(onRequestApply)}
            >
              替换当前回顾
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function RollingWorkReviewArchiveOverlay({
  review,
  archiving,
  onArchive,
  onClose,
}: {
  review: RollingWorkReview;
  archiving: boolean;
  onArchive: () => void;
  onClose: () => void;
}) {
  const archived = Boolean(review.archiveReviewId);

  return (
    <FocusOverlay title={review.title} onClose={onClose}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 text-xs leading-5 text-ink/45">
          {review.date}
          {review.lastRunAt ? ` · 更新于 ${review.lastRunAt}` : ""}
          {` · ${review.processedSessionCount} 次会话增量 · ${review.processedChars.toLocaleString("zh-CN")} 字符`}
        </div>
        <button
          className="primary-button action-compact disabled:cursor-not-allowed disabled:opacity-60"
          disabled={archived || archiving}
          onClick={onArchive}
        >
          <Save size={13} />
          {archived ? "已归档" : archiving ? "归档中" : "保存到回顾档案"}
        </button>
      </div>
      <article className="whitespace-pre-wrap text-anywhere text-sm leading-7 text-ink/72">
        {review.content}
      </article>
    </FocusOverlay>
  );
}

function getArchiveCategoryLabel(category: "codex" | "claude" | "combined" | "journal" | "auto") {
  if (category === "auto") return "自动工作回顾";
  if (category === "claude") return "Claude Code";
  if (category === "combined") return "综合";
  if (category === "journal") return "日志";
  return "Codex";
}

function SummaryReportReaderOverlay({ report, onClose }: { report: SummaryReport; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop">
      <section aria-label="细读日志回顾" aria-modal="true" className="modal-surface flex max-h-[92vh] w-full max-w-5xl flex-col" role="dialog">
        <header className="flex items-start justify-between gap-3 border-b border-line bg-panel/70 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-copper">Journal Review</p>
            <h3 className="mt-1 truncate text-lg font-semibold text-ink">{report.title}</h3>
            <p className="mt-1 text-xs text-ink/45">
              {getSummaryReportLabel(report.periodType)} · {report.periodStart} 至 {report.periodEnd}
            </p>
          </div>
          <button className="soft-button icon-action-compact" onClick={onClose} aria-label="关闭日志回顾" title="关闭">
            <X size={16} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 scrollbar-thin">
          <article className="mx-auto max-w-3xl whitespace-pre-wrap text-anywhere text-[15px] leading-8 text-ink/76">
            {report.content}
          </article>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-panel/70 px-5 py-3">
          <p className="text-xs text-ink/45">此处仅供阅读；需要重新生成时，请回到对应的回顾入口。</p>
          <button className="secondary-action action-standard" onClick={onClose}>关闭</button>
        </footer>
      </section>
    </div>
  );
}

function ReviewReaderOverlay({
  review,
  settings,
  memoryPatchDraft,
  onGenerateMemorySuggestion,
  onClose,
  onSave,
}: {
  review: CodexDailyReview;
  settings: AiSettings | null;
  memoryPatchDraft?: MemoryPatchDraft;
  onGenerateMemorySuggestion: (
    source: ReviewMemorySuggestionSource,
    onProgress?: (progress: CodexReviewProgress) => void,
    signal?: AbortSignal,
  ) => Promise<MemorySuggestionGenerationResult>;
  onClose: () => void;
  onSave: (id: string, patch: Partial<CodexDailyReview>) => Promise<void>;
}) {
  const [title, setTitle] = useState(review.title);
  const [content, setContent] = useState(review.content);
  const [savedTitle, setSavedTitle] = useState(review.title);
  const [savedContent, setSavedContent] = useState(review.content);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [suggestionRunning, setSuggestionRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [comparison, setComparison] = useState<CodexDailyReview | null>(null);
  const [pendingRegenerate, setPendingRegenerate] = useState(false);
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const savingRef = useRef(false);
  const regeneratingRef = useRef(false);
  const regenerateAbortRef = useRef<AbortController | null>(null);
  const regenerateJobIdRef = useRef("");
  const closeAfterRegenerateCancelRef = useRef(false);
  const aiReady = settings ? getEffectiveAiSettings(settings).keySource !== "missing" : false;
  const dirty = title.trim() !== savedTitle.trim() || content.trim() !== savedContent.trim();
  const suggestionContentVersion = memoryPatchDraft?.sourceReviewContentVersion
    ?? review.memorySuggestionCheckpoint?.sourceContentVersion;
  const suggestionSourceOutdated = isMemorySuggestionSourceOutdated(
    suggestionContentVersion,
    title,
    content,
  );
  const suggestionAlreadyResolved = review.memorySuggestionStatus === "created"
    || review.memorySuggestionStatus === "none";
  const canGenerateSuggestion = suggestionSourceOutdated
    || (!memoryPatchDraft && !suggestionAlreadyResolved);

  const cancelRegenerate = (closeAfterCancel = false) => {
    if (!regeneratingRef.current) return;
    closeAfterRegenerateCancelRef.current = closeAfterCancel;
    regenerateAbortRef.current?.abort();
    if (regenerateJobIdRef.current) {
      void cancelConversationReviewJob(regenerateJobIdRef.current);
    }
    setMessage(closeAfterCancel ? "正在取消生成，随后关闭。" : "正在取消生成，请稍候。");
  };

  useEffect(() => {
    setTitle(review.title);
    setContent(review.content);
    setSavedTitle(review.title);
    setSavedContent(review.content);
    setMessage("");
    setComparison(null);
    setPendingRegenerate(false);
    closeAfterRegenerateCancelRef.current = false;
  }, [review.id, review.title, review.content]);

  const requestClose = () => {
    if (suggestionRunning) {
      setMessage("长期记忆建议正在生成，请稍候。");
      return;
    }
    if (regeneratingRef.current) {
      cancelRegenerate(true);
      return;
    }
    if (savingRef.current) {
      setMessage("正在保存，完成后再关闭。");
      return;
    }
    if (dirty) {
      setDiscardConfirmOpen(true);
      return;
    }
    onClose();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dirty, onClose]);

  useEffect(() => {
    return () => {
      regenerateAbortRef.current?.abort();
      if (regenerateJobIdRef.current) {
        void cancelConversationReviewJob(regenerateJobIdRef.current);
      }
    };
  }, []);

  const saveCurrentReview = async () => {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    setMessage("");
    try {
      await onSave(review.id, { title, content });
      setSavedTitle(title);
      setSavedContent(content);
      setMessage("当前回顾已更新。");
      return true;
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "保存失败。"));
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const generateMemorySuggestion = async () => {
    if (suggestionRunning) return;
    if (dirty) {
      const saved = await saveCurrentReview();
      if (!saved) return;
    }
    setSuggestionRunning(true);
    setMessage("正在生成长期记忆建议。");
    try {
      const result = await onGenerateMemorySuggestion({
        kind: "review",
        review: { ...review, title, content },
      });
      setMessage(formatMemorySuggestionResult(result));
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "长期记忆建议未生成，可稍后重试。"));
    } finally {
      setSuggestionRunning(false);
    }
  };

  const regenerate = async () => {
    if (regeneratingRef.current) return;
    if (!review.sessionIds?.length) {
      setMessage("这份回顾没有记录会话选择，暂时无法重新生成。");
      return;
    }
    if (!aiReady) {
      setPendingRegenerate(false);
      setMessage("还没有配置 AI API Key。");
      return;
    }
    if (!pendingRegenerate) {
      setPendingRegenerate(true);
      setMessage(`将重新读取 ${review.sessionIds.length} 个原始会话正文并生成新版本。当前回顾保持不变；确认生成后才会开始。`);
      return;
    }

    setPendingRegenerate(false);
    regeneratingRef.current = true;
    setRegenerating(true);
    setMessage("正在生成新版本，当前回顾保持不变。");
    const controller = new AbortController();
    const jobId = createClientJobId();
    regenerateAbortRef.current = controller;
    regenerateJobIdRef.current = jobId;
    closeAfterRegenerateCancelRef.current = false;
    try {
      const input = await readSelectedConversationSessions(
        review.sessionIds,
        jobId,
        review.activityDateFrom || review.activityDateTo
          ? {
              activityDateFrom: review.activityDateFrom,
              activityDateTo: review.activityDateTo,
            }
          : undefined,
        (event) => setMessage(toConversationReadProgressView(event).message),
      );
      if (controller.signal.aborted) throw new DOMException("已取消生成。", "AbortError");
      const summary = await streamSummarizeConversationReview(input, settings!, () => undefined, controller.signal);
      if (controller.signal.aborted) throw new DOMException("已取消生成。", "AbortError");
      setComparison({
        id: `draft-${Date.now()}`,
        reviewKey: review.reviewKey,
        date: input.date,
        reviewKind: review.reviewKind,
        sourceKind: review.sourceKind,
        sourceLabel: review.sourceLabel,
        title: summary.title || `${input.date} ${review.sourceLabel}回顾`,
        content: summary.content,
        sessionCount: input.sessions.length,
        sessionIds: input.sessions.map((session) => session.id),
        activityDateFrom: input.activityDateFrom,
        activityDateTo: input.activityDateTo,
        sourceReviewIds: review.sourceReviewIds ?? [],
        createdAt: "",
        updatedAt: "",
      });
      setMessage(
        input.activityDateWarning
          ? `新版本已生成，可在下方查看。当前回顾保持不变。 ${input.activityDateWarning}`
          : "新版本已生成，可在下方查看。当前回顾保持不变。",
      );
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        setMessage("已停止生成，当前回顾保持不变。");
      } else {
        setMessage(getSafeErrorMessage(error, "重新生成失败。"));
      }
    } finally {
      regeneratingRef.current = false;
      regenerateAbortRef.current = null;
      regenerateJobIdRef.current = "";
      setRegenerating(false);
      if (closeAfterRegenerateCancelRef.current) {
        closeAfterRegenerateCancelRef.current = false;
        onClose();
      }
    }
  };

  return (
    <div className="modal-backdrop">
      <section aria-label="细读回顾" aria-modal="true" className="modal-surface flex max-h-[92vh] w-full max-w-5xl flex-col" role="dialog">
        <header className="flex items-start justify-between gap-3 border-b border-line bg-panel/70 px-5 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-copper">Review Archive</p>
            <h3 className="mt-1 text-lg font-semibold text-ink">细读回顾</h3>
            <p className="mt-1 text-xs text-ink/45">{review.date} · {review.sessionCount} 个会话</p>
          </div>
          <button className="ghost-action icon-action-compact disabled:cursor-not-allowed disabled:opacity-45" disabled={saving || suggestionRunning} onClick={requestClose} title="关闭" aria-label="关闭回顾阅读层">
            <X size={16} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 scrollbar-thin">
            <input
              value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setPendingRegenerate(false);
            }}
            className="field-control field-prominent mb-3 w-full text-base font-semibold"
          />
          <textarea
            value={content}
            onChange={(event) => {
              setContent(event.target.value);
              setPendingRegenerate(false);
            }}
            className="field-control h-[min(52vh,520px)] min-h-[320px] w-full resize-none overflow-y-auto px-4 py-3 text-sm leading-7 text-ink/76 scrollbar-thin"
          />

          {comparison && (
            <div className="mt-4 rounded-[8px] border border-copper/30 bg-copper/10 p-3">
              <div className="mb-2 text-xs font-semibold text-copper">待确认更新</div>
              <h4 className="text-sm font-semibold text-ink">{comparison.title}</h4>
              <p className="mt-2 max-h-[240px] overflow-y-auto whitespace-pre-wrap text-anywhere pr-1 text-sm leading-7 text-ink/64 scrollbar-thin">{comparison.content}</p>
              <button
                className="soft-button action-compact mt-3"
                onClick={() => {
                  setTitle(comparison.title);
                  setContent(comparison.content);
                  setMessage("新版本已载入编辑区，保存后将替换当前回顾。");
                }}
              >
                使用此版本
              </button>
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-panel/70 px-5 py-3">
          <div className="min-w-0 text-anywhere text-xs leading-5 text-ink/45" aria-live="polite">
            <p>{message || "可直接编辑标题和正文；保存后将替换当前回顾。"}</p>
            {memoryPatchDraft && suggestionSourceOutdated && (
              <p className="mt-1 font-medium text-copper">来源回顾已修改，现有长期记忆建议仍基于修改前的内容。</p>
            )}
            {memoryPatchDraft && !suggestionSourceOutdated && (
              <p className="mt-1">长期记忆建议已保存到“记忆审核”，尚未写入长期记忆。</p>
            )}
            {!memoryPatchDraft && review.memorySuggestionStatus && (
              <p className="mt-1">{getMemorySuggestionStatusNote(review.memorySuggestionStatus)}</p>
            )}
          </div>
          <div className="flex gap-2">
            {dirty && (
              <button
                className="soft-button action-standard text-xs"
                disabled={saving || regenerating}
                onClick={() => {
                  setTitle(review.title);
                  setContent(review.content);
                  setMessage("");
                }}
              >
                恢复
              </button>
            )}
            {regenerating && (
              <button className="secondary-action action-standard text-xs" onClick={() => cancelRegenerate(false)}>
                停止
              </button>
            )}
            {canGenerateSuggestion && (
              <button
                className="soft-button action-standard text-xs font-medium disabled:opacity-60"
                disabled={saving || regenerating || suggestionRunning}
                onClick={() => void generateMemorySuggestion()}
              >
                {suggestionRunning ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {memoryPatchDraft ? "重新生成长期记忆建议" : "生成长期记忆建议"}
              </button>
            )}
            <button
              className="soft-button action-standard text-xs font-medium disabled:opacity-60"
              disabled={regenerating || suggestionRunning}
              onClick={regenerate}
            >
              {regenerating ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {pendingRegenerate ? "确认生成" : "生成新版本"}
            </button>
            <button
              className="primary-button action-standard text-xs disabled:opacity-60"
              disabled={saving || suggestionRunning}
              onClick={() => setSaveConfirmOpen(true)}
            >
              {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
              替换当前回顾
            </button>
          </div>
        </footer>
      </section>
      <ConfirmDialog
        open={saveConfirmOpen}
        title="替换当前回顾？"
        message="确认后将以当前编辑内容替换这份回顾。"
        confirmLabel="确认替换"
        onCancel={() => setSaveConfirmOpen(false)}
        onConfirm={async () => {
          await saveCurrentReview();
          setSaveConfirmOpen(false);
        }}
      />
      <ConfirmDialog
        open={discardConfirmOpen}
        title="放弃未保存的修改？"
        message="放弃后，当前编辑内容将无法恢复。"
        confirmLabel="放弃修改"
        danger
        onCancel={() => setDiscardConfirmOpen(false)}
        onConfirm={() => {
          setDiscardConfirmOpen(false);
          onClose();
        }}
      />
    </div>
  );
}

function createClientJobId() {
  if ("randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `codex-review-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getSourceLabel(sourceKind?: ConversationSourceKind) {
  return sourceKind === "claude" ? "Claude Code" : "Codex";
}

function getSummaryReportLabel(periodType: SummaryReport["periodType"]) {
  if (periodType === "day") return "日总结";
  if (periodType === "week") return "周回顾";
  return "月回顾";
}

function LegacyMemorySection({
  memories,
  targetMemoryId,
  onUpdateMemory,
}: {
  memories: MemoryCard[];
  targetMemoryId?: string;
  onUpdateMemory: (id: string, patch: Partial<MemoryCard>) => Promise<void>;
}) {
  const [open, setOpen] = useState(Boolean(targetMemoryId));
  const legacy = memories.filter((memory) => memory.status !== "ignored");

  useEffect(() => {
    if (!targetMemoryId) return undefined;
    setOpen(true);

    const timeout = window.setTimeout(() => {
      document.getElementById(`memory-card-${targetMemoryId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 180);

    return () => window.clearTimeout(timeout);
  }, [targetMemoryId]);

  return (
    <section className="section-surface">
      <button className="flex w-full items-center justify-between gap-3 text-left" onClick={() => setOpen((value) => !value)}>
        <span>
          <span className="text-sm font-semibold text-ink">旧版记忆片段</span>
          <span className="ml-2 rounded-full bg-panel px-2 py-0.5 text-[11px] text-ink/45">{legacy.length}</span>
          <span className="mt-1 block text-xs text-ink/45">旧卡片不会丢失，但之后长期记忆以完整文档为主。</span>
        </span>
        {open ? <ChevronDown size={16} className="text-ink/45" /> : <ChevronRight size={16} className="text-ink/45" />}
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          {legacy.length === 0 ? (
            <div className="rounded-[8px] border border-dashed border-line bg-panel/70 p-4 text-sm text-ink/45">
              暂时没有旧版记忆片段。
            </div>
          ) : (
            legacy.map((memory) => (
              <article
                key={memory.id}
                id={`memory-card-${memory.id}`}
                className={`rounded-[8px] border border-line bg-panel/70 p-3 ${targetMemoryId === memory.id ? "ring-1 ring-copper/35" : ""}`}
              >
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="quiet-chip py-0.5 text-[11px] text-ink/45">{memory.category}</span>
                    <h4 className="mt-1 text-sm font-semibold text-ink">{memory.title}</h4>
                  </div>
                  <div className="flex gap-1.5">
                    {memory.status === "candidate" && (
                      <button
                        className="primary-button action-micro"
                        onClick={() => onUpdateMemory(memory.id, { status: "active" })}
                      >
                        确认
                      </button>
                    )}
                    {memory.status === "active" && (
                      <button
                        className="soft-button action-micro"
                        onClick={() => onUpdateMemory(memory.id, { status: "archived" })}
                      >
                        <Archive size={12} />
                        归档
                      </button>
                    )}
                  </div>
                </div>
                <p className="max-h-[220px] overflow-y-auto whitespace-pre-wrap text-anywhere pr-1 text-sm leading-6 text-ink/62 scrollbar-thin">{memory.content}</p>
              </article>
            ))
          )}
        </div>
      )}
    </section>
  );
}

function MemoryPrinciples() {
  return (
    <div className="divide-y divide-line">
      <CodexGuard title="稳定" text="偏好、长期约束、项目方向和反复出现的原则。" />
      <CodexGuard title="克制" text="少写，写准；宁可留下背景，不留下噪声。" />
      <CodexGuard title="安全" text="密钥、临时路径、命令输出和报错碎片不进入长期记忆。" />
    </div>
  );
}

function CodexGuard({ title, text }: { title: string; text: string }) {
  return (
    <div className="py-5 first:pt-2">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-ink">
        <ShieldCheck size={14} className="text-moss" />
        {title}
      </div>
      <p className="text-xs leading-6 text-ink/48">{text}</p>
    </div>
  );
}

function getMemorySuggestionStatusNote(status: MemorySuggestionCheckpointStatus) {
  if (status === "created") return "长期记忆建议已生成，等待审核。";
  if (status === "none") return "本次未发现需要长期保留的新信息。";
  if (status === "failed") return "长期记忆建议未生成，可单独重试。";
  if (status === "cancelled") return "长期记忆建议生成已取消，可单独重试。";
  if (status === "running") return "正在分析长期记忆建议。";
  return "长期记忆建议等待处理。";
}

function readMemoryDocumentDraft(
  documentKey: string,
  fallback: string,
  fallbackUpdatedAt?: string,
): MemoryDocumentDraftSnapshot {
  const fallbackSnapshot = {
    content: fallback,
    dirty: false,
    baselineContent: fallback,
    baselineUpdatedAt: fallbackUpdatedAt,
  };
  if (typeof window === "undefined") return fallbackSnapshot;
  try {
    const raw = window.localStorage.getItem(MEMORY_DOCUMENT_DRAFT_KEY);
    if (!raw) return fallbackSnapshot;
    const parsed = JSON.parse(raw) as {
      documentKey?: string;
      content?: string;
      baselineContent?: string;
      baselineUpdatedAt?: string;
    };
    if (parsed.documentKey !== documentKey || typeof parsed.content !== "string") {
      return fallbackSnapshot;
    }
    return {
      content: parsed.content,
      dirty: parsed.content !== fallback,
      baselineContent: typeof parsed.baselineContent === "string" ? parsed.baselineContent : fallback,
      baselineUpdatedAt: parsed.baselineUpdatedAt || fallbackUpdatedAt,
    };
  } catch {
    return fallbackSnapshot;
  }
}

function writeMemoryDocumentDraft(
  documentKey: string,
  content: string,
  baselineContent: string,
  baselineUpdatedAt?: string,
) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      MEMORY_DOCUMENT_DRAFT_KEY,
      JSON.stringify({ documentKey, content, baselineContent, baselineUpdatedAt }),
    );
  } catch {
    // 草稿保护是辅助能力，写入失败不应阻断正文编辑。
  }
}

function clearMemoryDocumentDraft() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(MEMORY_DOCUMENT_DRAFT_KEY);
  } catch {
    // 忽略浏览器存储异常。
  }
}

function readMemoryPatchEditDrafts(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(MEMORY_PATCH_EDIT_DRAFT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

function writeMemoryPatchEditDrafts(value: Record<string, string>) {
  if (typeof window === "undefined") return;
  try {
    if (Object.keys(value).length === 0) {
      window.localStorage.removeItem(MEMORY_PATCH_EDIT_DRAFT_KEY);
      return;
    }
    window.localStorage.setItem(MEMORY_PATCH_EDIT_DRAFT_KEY, JSON.stringify(value));
  } catch {
    // 草稿保护不阻断审核流程。
  }
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}
