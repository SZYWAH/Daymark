import {
  Archive,
  BookOpenText,
  Check,
  ChevronDown,
  ChevronRight,
  History,
  Maximize2,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Square,
  SquareCheck,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getEffectiveAiSettings, streamSummarizeConversationReview, type CodexReviewProgress } from "../ai/deepseek";
import { ConversationSessionPreviewOverlay } from "./ConversationSessionPreviewOverlay";
import { DatePickerPopover } from "./DatePickerPopover";
import { FocusOverlay } from "./FocusOverlay";
import { MetricItem, PageMetricColumn, PageWorkspace } from "./PageWorkspace";
import { BoundedPreview, ResultRow, ScrollableResultPanel } from "./ResultPanels";
import { SelectMenu } from "./SelectMenu";
import { toDateKey } from "../lib/date";
import { getSafeErrorMessage } from "../lib/redaction";
import {
  cancelConversationReviewJob,
  indexConversationSessions,
  isDesktopRuntime,
  readSelectedConversationSessions,
} from "../lib/desktop";
import type {
  AiSettings,
  CodexDailyReview,
  CodexReviewInput,
  CodexSessionIndex,
  ConversationGenerationDraft,
  ConversationSourceKind,
  DailyReviewReplacementDraft,
  MemoryCard,
  MemoryDocument,
  MemoryPatchDraft,
  MemorySubView,
  RollingWorkReview,
  SummaryReport,
} from "../types";

type GenerateCodexReviewResult = {
  review: CodexDailyReview;
  patchDraft?: MemoryPatchDraft;
  replacementDraft?: boolean;
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
  settings: AiSettings | null;
  initialSubView?: MemorySubView;
  initialMemoryId?: string;
  initialReviewId?: string;
  initialReviewDraftId?: string;
  initialSummaryId?: string;
  onUpdateMemory: (id: string, patch: Partial<MemoryCard>) => Promise<void>;
  onGenerateCodexReview: (
    input: CodexReviewInput,
    onProgress?: (progress: CodexReviewProgress) => void,
    signal?: AbortSignal,
  ) => Promise<GenerateCodexReviewResult>;
  onGenerateCombinedReview: (
    reviews: CodexDailyReview[],
    onProgress?: (progress: CodexReviewProgress) => void,
    signal?: AbortSignal,
  ) => Promise<GenerateCodexReviewResult>;
  onSaveGenerationDraft: (
    draft: Omit<ConversationGenerationDraft, "id" | "createdAt" | "updatedAt">,
  ) => Promise<void>;
  onReplaceCodexSessionIndex: (records: CodexSessionIndex[]) => Promise<void>;
  onUpdateCodexReview: (id: string, patch: Partial<CodexDailyReview>) => Promise<void>;
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
  settings,
  initialSubView,
  initialMemoryId,
  initialReviewId,
  initialReviewDraftId,
  initialSummaryId,
  onUpdateMemory,
  onGenerateCodexReview,
  onGenerateCombinedReview,
  onSaveGenerationDraft,
  onReplaceCodexSessionIndex,
  onUpdateCodexReview,
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
  const todayPatchCount = pendingPatchDrafts.filter(
    (draft) => draft.sourceReviewId && todayReviewIds.has(draft.sourceReviewId),
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
          onChange={setSubView}
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
                targetReviewId={initialReviewId}
                targetReviewDraftId={initialReviewDraftId}
                targetSummaryId={initialSummaryId}
                onOpenCodexReview={setActiveReview}
                onOpenSummaryReport={setActiveReport}
                onGenerateCombinedReview={onGenerateCombinedReview}
                onApplyDailyReviewDraft={onApplyDailyReviewDraft}
                onIgnoreDailyReviewDraft={onIgnoreDailyReviewDraft}
                onArchiveRollingWorkReview={onArchiveRollingWorkReview}
              />
            </div>
          )}

          {subView === "patches" && (
            <div className="grid h-full min-h-0 gap-4 overflow-y-auto scrollbar-thin xl:grid-cols-[minmax(0,1fr)_320px]">
              <MemoryPatchDraftsPanel
                drafts={pendingPatchDrafts}
                memoryDocument={memoryDocument}
                onApply={onApplyMemoryPatch}
                onIgnore={onIgnoreMemoryPatch}
              />
              <MemoryPrinciples />
            </div>
          )}

          {subView === "ai-review" && (
            <div className="grid h-full min-h-0 gap-4 overflow-y-auto xl:grid-cols-[minmax(0,1fr)_240px] xl:overflow-hidden">
              <div className="min-h-0 overflow-y-auto pr-0 scrollbar-thin xl:pr-6">
                <CodexReviewWorkbench
                  settings={settings}
                  reviews={codexReviews}
                  indexedSessions={codexSessionIndex}
                  generationDrafts={conversationGenerationDrafts}
                  onReplaceIndex={onReplaceCodexSessionIndex}
                  onGenerateCodexReview={onGenerateCodexReview}
                  onSaveGenerationDraft={onSaveGenerationDraft}
                />
              </div>
              <div className="min-h-0 overflow-y-auto scrollbar-thin">
                <MemoryReviewMetrics
                  todayKey={todayKey}
                  todayReviews={todayReviews.length}
                  todayPatchCount={todayPatchCount}
                  indexedSessions={codexSessionIndex.length}
                  memoryDocument={memoryDocument}
                />
              </div>
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
                ? "border-copper text-ink"
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
  memoryDocument,
  onApply,
  onIgnore,
}: {
  drafts: MemoryPatchDraft[];
  memoryDocument: MemoryDocument | null;
  onApply: (
    id: string,
    editedContent: string,
    options?: { allowStale?: boolean; confirmedDocumentUpdatedAt?: string; confirmedDocumentContent?: string },
  ) => Promise<void>;
  onIgnore: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");
  const [pendingApplyId, setPendingApplyId] = useState("");
  const [pendingStaleApplyId, setPendingStaleApplyId] = useState("");
  const [message, setMessage] = useState("");
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
  }, [drafts]);

  const updateDraft = (draft: MemoryPatchDraft, value: string) => {
    setEditing((current) => {
      const next = { ...current, [draft.id]: value };
      writeMemoryPatchEditDrafts(next);
      return next;
    });
  };

  const applyDraft = async (draft: MemoryPatchDraft) => {
    if (busyRef.current) return;
    const documentUpdatedAt = memoryDocument?.updatedAt ?? "";
    const draftBaselineAt = draft.createdAt || draft.updatedAt;
    const isStaleAgainstDocument = Boolean(documentUpdatedAt && draftBaselineAt && documentUpdatedAt > draftBaselineAt);
    if (pendingApplyId !== draft.id) {
      setPendingApplyId(draft.id);
      setPendingStaleApplyId("");
      setMessage("这会改写长期记忆文档。请确认内容无误后，再次点击“确认写入”。");
      return;
    }
    if (isStaleAgainstDocument && pendingStaleApplyId !== draft.id) {
      setPendingStaleApplyId(draft.id);
      setMessage("长期记忆文档在这条建议生成后更新过。确认要覆盖当前文档后，再点击一次。");
      return;
    }
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
      setMessage("记忆文档已按你的确认更新。");
      setPendingApplyId("");
      setPendingStaleApplyId("");
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "应用建议失败。"));
    } finally {
      busyRef.current = "";
      setBusyId("");
    }
  };

  const ignoreDraft = async (draft: MemoryPatchDraft) => {
    if (busyRef.current) return;
    busyRef.current = draft.id;
    setBusyId(draft.id);
    setPendingApplyId("");
    setPendingStaleApplyId("");
    setMessage("");
    try {
      await onIgnore(draft.id);
      setEditing((current) => {
        const { [draft.id]: _removed, ...next } = current;
        writeMemoryPatchEditDrafts(next);
        return next;
      });
      setMessage("已忽略这条建议。");
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "忽略建议失败。"));
    } finally {
      busyRef.current = "";
      setBusyId("");
    }
  };

  return (
    <section className="section-surface border-copper/25 bg-copper/5">
      <div className="mb-3">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-copper">Memory Patch</p>
        <h3 className="mt-1 text-base font-semibold text-ink">待审核的记忆修改</h3>
        <p className="mt-1 text-xs leading-5 text-ink/45">AI 只提出修改建议，真正写入长期记忆前仍由你审一遍。</p>
      </div>

      {drafts.length === 0 ? (
        <div className="rounded-[8px] border border-dashed border-line bg-panel/70 p-4 text-sm leading-6 text-ink/45">
          暂时没有待审核的修改建议。生成 Codex 回顾后，这里会出现可编辑的合并草稿。
        </div>
      ) : (
        <div className="space-y-3">
          {drafts.map((draft) => (
            <article key={draft.id} className="rounded-[8px] border border-line bg-surface p-3 shadow-card">
              <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-ink">{draft.title}</h4>
                  <p className="mt-1 text-xs leading-5 text-ink/48">{draft.rationale}</p>
                </div>
                <span className="rounded-full border border-copper/30 bg-copper/10 px-2.5 py-1 text-[11px] font-medium text-copper">
                  待确认
                </span>
              </div>
              <textarea
                value={editing[draft.id] ?? draft.proposedContent}
                onChange={(event) => updateDraft(draft, event.target.value)}
                className="field-control h-32 w-full resize-none overflow-y-auto px-3 py-2 font-mono text-xs leading-6 scrollbar-thin focus:h-[220px]"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="primary-button action-compact disabled:opacity-60"
                  disabled={Boolean(busyId)}
                  onClick={() => void applyDraft(draft)}
                >
                  <Check size={14} />
                  {pendingApplyId === draft.id ? "再次确认" : "确认写入"}
                </button>
                <button
                  className="danger-action action-compact disabled:opacity-60"
                  disabled={Boolean(busyId)}
                  onClick={() => void ignoreDraft(draft)}
                >
                  <X size={14} />
                  不采用
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {message && <p className="mt-2 text-xs text-ink/45">{message}</p>}
    </section>
  );
}

function CodexReviewWorkbench({
  settings,
  reviews,
  indexedSessions,
  generationDrafts,
  onReplaceIndex,
  onGenerateCodexReview,
  onSaveGenerationDraft,
}: {
  settings: AiSettings | null;
  reviews: CodexDailyReview[];
  indexedSessions: CodexSessionIndex[];
  generationDrafts: ConversationGenerationDraft[];
  onReplaceIndex: (records: CodexSessionIndex[]) => Promise<void>;
  onGenerateCodexReview: (
    input: CodexReviewInput,
    onProgress?: (progress: CodexReviewProgress) => void,
    signal?: AbortSignal,
  ) => Promise<GenerateCodexReviewResult>;
  onSaveGenerationDraft: (
    draft: Omit<ConversationGenerationDraft, "id" | "createdAt" | "updatedAt">,
  ) => Promise<void>;
}) {
  const [sourceFilter, setSourceFilter] = useState<"all" | ConversationSourceKind>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [cwdQuery, setCwdQuery] = useState("");
  const [keyword, setKeyword] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<CodexReviewProgress | null>(null);
  const [partialContent, setPartialContent] = useState("");
  const [sessionOverlayOpen, setSessionOverlayOpen] = useState(false);
  const [previewingId, setPreviewingId] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [previewMeta, setPreviewMeta] = useState("");
  const [previewMessage, setPreviewMessage] = useState("");
  const [previewSessionId, setPreviewSessionId] = useState("");
  const [pendingGenerateKey, setPendingGenerateKey] = useState("");
  const [lastScanKey, setLastScanKey] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const jobIdRef = useRef("");
  const previewRequestSeqRef = useRef(0);
  const partialContentRef = useRef("");
  const progressRef = useRef<CodexReviewProgress | null>(null);
  const desktop = isDesktopRuntime();
  const todayKey = toDateKey(new Date());
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
  const latestCancelledDraft = [...generationDrafts]
    .filter((draft) => draft.status === "cancelled")
    .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt))[0];
  const scanSourceKinds: ConversationSourceKind[] = sourceFilter === "all" ? ["codex", "claude"] : [sourceFilter];
  const currentScanKey = JSON.stringify({
    sourceFilter,
    dateFrom: dateFrom.trim(),
    dateTo: dateTo.trim(),
    cwdQuery: cwdQuery.trim(),
    keyword: keyword.trim(),
  });
  const scanFiltersChanged = indexedSessions.length > 0 && lastScanKey !== currentScanKey;

  const scan = async () => {
    const scanKey = currentScanKey;
    setScanning(true);
    setMessage("");
    setPendingGenerateKey("");
    setProgress(null);
    try {
      const result = await indexConversationSessions({
        sourceKinds: scanSourceKinds,
        dateFrom,
        dateTo,
        cwdQuery,
        keyword,
        limit: 800,
      });
      await onReplaceIndex(result);
      setLastScanKey(scanKey);
      setSelectedIds(new Set());
      setMessage(result.length > 0 ? `找到 ${result.length} 个会话。扫描只读取文件元信息，请手动勾选要生成回顾的会话。` : "没有找到符合条件的会话。");
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "扫描 Codex 会话失败。"));
    } finally {
      setScanning(false);
    }
  };

  const filterToday = () => {
    setDateFrom(todayKey);
    setDateTo(todayKey);
    setPendingGenerateKey("");
    setMessage("已筛选今天，请点击扫描会话。");
  };

  const toggleSession = (id: string) => {
    if (scanFiltersChanged) {
      setMessage("筛选条件已经改变，请先重新扫描会话。");
      return;
    }
    setPendingGenerateKey("");
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
      setMessage("筛选条件已经改变，请先重新扫描会话。");
      return;
    }
    setPendingGenerateKey("");
    setSelectedIds((current) => {
      const allSelected = indexedSessions.length > 0 && indexedSessions.every((session) => current.has(session.id));
      return allSelected ? new Set() : new Set(indexedSessions.map((session) => session.id));
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
        `${session.sourceLabel} · ${session.date} · ${input.totalChars.toLocaleString("zh-CN")} 字符${
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

  const generate = async () => {
    if (!desktop) {
      setMessage("Codex 回顾需要在桌面端使用。");
      return;
    }
    if (!aiReady) {
      setMessage("还没有配置 AI API Key。当前不会读取或上传对话正文。");
      return;
    }
    if (selectedIds.size === 0) {
      setMessage("请先勾选要回顾的会话。");
      return;
    }
    if (scanFiltersChanged) {
      setMessage("筛选条件已经改变，请先重新扫描会话。");
      return;
    }
    if (selectedSources.length > 1) {
      setMessage("请先只勾选一个来源生成来源回顾；Codex 和 Claude Code 都生成后，再合成今日总回顾。");
      return;
    }

    const generateKey = Array.from(selectedIds).sort().join("|");
    if (pendingGenerateKey !== generateKey) {
      setPendingGenerateKey(generateKey);
      const sourceLabel = selectedSessions[0]?.sourceLabel || getSourceLabel(selectedSessions[0]?.sourceKind ?? "codex");
      setMessage(`将读取 ${selectedIds.size} 个 ${sourceLabel} 会话正文（约 ${formatBytes(selectedBytes)}）并调用 AI 生成回顾；随后会再调用一次 AI，结合本次回顾和长期记忆文档生成待审核记忆建议。未勾选会话不会读取。请再次点击“生成所选回顾”确认。`);
      return;
    }

    const controller = new AbortController();
    const jobId = createClientJobId();
    abortRef.current = controller;
    jobIdRef.current = jobId;
    setGenerating(true);
    setPendingGenerateKey("");
    setMessage("");
    setPartialContent("");
    partialContentRef.current = "";
    progressRef.current = {
      stage: "读取会话",
      message: `将读取 ${selectedIds.size} 个已勾选会话，未勾选的不会读取正文。`,
    };
    setProgress({
      stage: "读取会话",
      message: `将读取 ${selectedIds.size} 个已勾选会话，未勾选的不会读取正文。`,
    });

    try {
      const input = await readSelectedConversationSessions(Array.from(selectedIds), jobId);
      if (controller.signal.aborted) throw new DOMException("已取消生成。", "AbortError");
      const result = await onGenerateCodexReview(
        input,
        (nextProgress) => {
          progressRef.current = nextProgress;
          setProgress(nextProgress);
          if (nextProgress.partialContent) {
            partialContentRef.current = nextProgress.partialContent;
            setPartialContent(nextProgress.partialContent);
          }
        },
        controller.signal,
      );
      setMessage(
        result.replacementDraft
          ? `已生成“${result.review.title}”的新版本，并保存为替换草稿；原回顾没有被覆盖。`
          : result.patchDraft
          ? `已生成“${result.review.title}”，并写下 1 条待审核的记忆修改建议。`
          : `已生成“${result.review.title}”。记忆修改建议未生成，可稍后重新生成。`,
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        const savedPartialContent = partialContentRef.current;
        if (savedPartialContent.trim()) {
          await onSaveGenerationDraft({
            reviewKey: createReviewKeyFromSelection(selectedSessions),
            date: selectedSessions[0]?.date,
            reviewKind: "source",
            sourceKind: selectedSources.length === 1 ? selectedSources[0] : undefined,
            sourceLabel: selectedSources.length === 1 ? getSourceLabel(selectedSources[0]) : "AI 对话",
            title: "未完成的回顾草稿",
            partialContent: savedPartialContent,
            selectedSessionIds: Array.from(selectedIds),
            stage: progressRef.current?.stage ?? "合成每日回顾",
            message: "用户取消后保留的临时草稿。",
            status: "cancelled",
          });
        }
        setMessage(savedPartialContent.trim() ? "已取消本次生成，临时草稿已保留。" : "已取消本次生成。");
      } else {
        setMessage(getSafeErrorMessage(error, "生成 Codex 回顾失败。"));
      }
    } finally {
      setGenerating(false);
      abortRef.current = null;
      jobIdRef.current = "";
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    if (jobIdRef.current) {
      void cancelConversationReviewJob(jobIdRef.current);
    }
    setProgress((current) => ({
      stage: current?.stage ?? "合成每日回顾",
      message: "正在取消，请稍候。",
      partialContent: current?.partialContent,
    }));
  };

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="mb-1.5 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line/70 pb-1.5">
        <div>
          <h3 className="text-lg font-semibold text-ink">AI 对话回顾台</h3>
          <p className="mt-0.5 max-w-3xl truncate text-xs text-ink/45">
            手动触发 · 扫描只读元信息 · 点击单条会话才本地预览正文 · 生成时只读取已勾选会话。
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
          {generating && (
            <button
              className="danger-action action-compact"
              onClick={cancel}
            >
              <X size={13} />
              取消
            </button>
          )}
          <button
            className="secondary-action action-compact"
            disabled={!desktop || scanning}
            onClick={scan}
          >
            {scanning ? <RefreshCw size={13} className="animate-spin" /> : <Search size={13} />}
            {scanning ? "扫描中" : "扫描会话"}
          </button>
        </div>
      </div>

      {!desktop && (
        <div className="mb-2 shrink-0 rounded-[8px] border border-line bg-panel px-3 py-2 text-sm leading-6 text-ink/70">
          AI 对话回顾需要桌面端。本页面在浏览器模式下不会读取本机路径。
        </div>
      )}

      {latestCancelledDraft && (
        <div className="mb-2 shrink-0 rounded-[8px] border border-line bg-surface px-3 py-2 text-xs leading-5 text-ink/60">
          <div className="mb-1 font-semibold text-ink/80">有一份取消后保留的临时草稿</div>
          <p className="line-clamp-3 whitespace-pre-wrap text-anywhere">{latestCancelledDraft.partialContent}</p>
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
            onChange={(value) => setSourceFilter(value as "all" | ConversationSourceKind)}
            triggerClassName="field-standard px-2.5 text-xs"
          />
        </label>
        <label className="space-y-0.5 text-[11px] text-ink/50">
          起始日期
          <DatePickerPopover
            value={dateFrom}
            onChange={setDateFrom}
            onClear={() => setDateFrom("")}
            placeholder="起始日期"
            buttonLabel="选择起始日期"
          />
        </label>
        <label className="space-y-0.5 text-[11px] text-ink/50">
          结束日期
          <DatePickerPopover
            value={dateTo}
            onChange={setDateTo}
            onClear={() => setDateTo("")}
            placeholder="结束日期"
            buttonLabel="选择结束日期"
          />
        </label>
        <label className="space-y-0.5 text-[11px] text-ink/50">
          快捷
          <button
            type="button"
            className={`soft-button action-standard w-full text-xs ${dateFrom === todayKey && dateTo === todayKey ? "active-toggle" : ""}`}
            onClick={filterToday}
          >
            今日
          </button>
        </label>
        <label className="space-y-0.5 text-[11px] text-ink/50">
          路径筛选
          <input value={cwdQuery} onChange={(event) => setCwdQuery(event.target.value)} className="field-control field-standard w-full px-2 text-xs" placeholder="例如 个人知识库" />
        </label>
        <label className="space-y-0.5 text-[11px] text-ink/50">
          关键词
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} className="field-control field-standard w-full px-2 text-xs" placeholder="标题、意图、路径" />
        </label>
      </div>

      <div className="mb-1.5 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-[8px] border border-line bg-panel/55 px-3 py-1.5">
        <div className="text-xs leading-5 text-ink/52">
          已选 {selectedIds.size} 个会话 · {formatBytes(selectedBytes)} · 生成时才读取正文
        </div>
        <div className="flex gap-2">
          <button className="soft-button action-compact disabled:cursor-not-allowed disabled:opacity-50" disabled={scanFiltersChanged} onClick={toggleVisible}>
            {indexedSessions.length > 0 && indexedSessions.every((session) => selectedIds.has(session.id)) ? "取消全选" : "全选当前"}
          </button>
          <button
            className="primary-button action-compact disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!desktop || generating || selectedIds.size === 0 || scanFiltersChanged}
            onClick={generate}
          >
            {generating ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {generating ? "生成中" : "生成所选回顾"}
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
              return (
                <article
                  key={`${session.id}-${session.path}`}
                  className={`grid grid-cols-[28px_minmax(0,1fr)_auto] gap-3 border-b border-line/70 px-3 py-3 text-left transition last:border-b-0 ${
                    activePreview ? "bg-panel" : selected ? "bg-moss/10" : "bg-surface hover:bg-panel/70"
                  }`}
                >
                  <button
                    type="button"
                    className="mt-0.5 text-moss"
                    aria-pressed={selected}
                    title={selected ? "取消勾选" : "勾选生成"}
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
                    <span className="block text-ink/58">{session.date}</span>
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
            <pre className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded-[8px] bg-surface p-4 text-anywhere text-xs leading-6 text-ink/66 scrollbar-thin">
              {previewText || "还没有打开任何会话正文。"}
            </pre>
          </div>
        </div>
      )}

      {(progress || partialContent || message) && (
        <div className="mt-2 max-h-[168px] shrink-0 overflow-y-auto rounded-[8px] border border-line bg-panel px-3 py-2 text-sm leading-6 text-ink/62 scrollbar-thin">
          {progress && (
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-ink">
              {generating && <RefreshCw size={14} className="animate-spin text-moss" />}
              <span>{progress.stage}</span>
              <span className="font-normal text-ink/45">{progress.message}</span>
            </div>
          )}
          {partialContent && (
            <pre className="max-h-[220px] overflow-y-auto whitespace-pre-wrap rounded-[8px] bg-surface px-3 py-2 text-anywhere text-xs leading-6 text-ink/62 scrollbar-thin">
              {partialContent}
            </pre>
          )}
          {message && <p className="mt-1 text-xs text-ink/48">{message}</p>}
        </div>
      )}

      {sessionOverlayOpen && (
        <ConversationSessionPreviewOverlay
          sessions={indexedSessions}
          selectedIds={selectedIds}
          onToggleSession={toggleSession}
          onClose={() => setSessionOverlayOpen(false)}
        />
      )}
    </section>
  );
}

function ReviewArchivePanel({
  reports,
  codexReviews,
  rollingWorkReviews,
  dailyReviewDrafts,
  targetReviewId,
  targetReviewDraftId,
  targetSummaryId,
  onOpenCodexReview,
  onOpenSummaryReport,
  onGenerateCombinedReview,
  onApplyDailyReviewDraft,
  onIgnoreDailyReviewDraft,
  onArchiveRollingWorkReview,
}: {
  reports: SummaryReport[];
  codexReviews: CodexDailyReview[];
  rollingWorkReviews: RollingWorkReview[];
  dailyReviewDrafts: DailyReviewReplacementDraft[];
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
  const [expandedDraftId, setExpandedDraftId] = useState("");
  const [draftAction, setDraftAction] = useState<{ id: string; kind: "apply" | "ignore" } | null>(null);
  const [pendingDraftApplyId, setPendingDraftApplyId] = useState("");
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
      setMessage(`将读取 ${date} 的 ${reviews.length} 份来源回顾并调用 AI 合成总回顾，可能生成待审核的记忆建议。再次点击“确认合成”才会开始。`);
      return;
    }
    setCombiningDate(date);
    setPendingCombineDate("");
    setMessage("");
    try {
      const result = await onGenerateCombinedReview(reviews);
      setMessage(
        result.replacementDraft
          ? `已合成“${result.review.title}”的新版本，并保存为替换草稿；原综合回顾没有被覆盖。`
          : result.patchDraft
          ? `已合成“${result.review.title}”，并写下 1 条待审核的记忆修改建议。`
          : `已合成“${result.review.title}”。记忆修改建议未生成，可稍后重新生成。`,
      );
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "合成今日总回顾失败。"));
    } finally {
      setCombiningDate("");
    }
  };

  const applyDraft = async (draft: DailyReviewReplacementDraft) => {
    if (draftAction) return;
    if (pendingDraftApplyId !== draft.id) {
      setPendingDraftApplyId(draft.id);
      setExpandedDraftId(draft.id);
      setMessage("应用后会覆盖同日正式回顾。请先预览草稿内容，确认无误后再次点击“应用”。");
      return;
    }
    setDraftAction({ id: draft.id, kind: "apply" });
    setMessage("");
    try {
      await onApplyDailyReviewDraft(draft.id);
      setMessage(`已应用“${draft.title}”，原回顾已被这份草稿替换。`);
      setPendingDraftApplyId("");
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "应用替换草稿失败。"));
    } finally {
      setDraftAction(null);
    }
  };

  const ignoreDraft = async (draft: DailyReviewReplacementDraft) => {
    if (draftAction) return;
    setDraftAction({ id: draft.id, kind: "ignore" });
    setPendingDraftApplyId("");
    setMessage("");
    try {
      await onIgnoreDailyReviewDraft(draft.id);
      setMessage(`已忽略“${draft.title}”，现有回顾保持不变。`);
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "忽略替换草稿失败。"));
    } finally {
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
          <p className="mt-1 text-xs leading-5 text-ink/45">按来源与日期轻量筛选，细读时再打开大层。</p>
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
          title="替换草稿"
          count={`${pendingReviewDrafts.length} 份待处理`}
          status="只在你确认后覆盖原回顾。"
          maxHeightClass="max-h-[260px]"
          bodyClassName="space-y-2"
        >
          {pendingReviewDrafts.map((draft) => {
            const expanded = expandedDraftId === draft.id;
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
                    <button className="soft-button action-micro" onClick={() => setExpandedDraftId(expanded ? "" : draft.id)}>
                      {expanded ? "收起" : "预览"}
                    </button>
                    <button
                      className="soft-button action-micro"
                      disabled={Boolean(draftAction)}
                      onClick={() => void ignoreDraft(draft)}
                    >
                      {ignoring ? "忽略中" : "忽略"}
                    </button>
                    <button
                      className="primary-button action-micro"
                      disabled={Boolean(draftAction)}
                      onClick={() => void applyDraft(draft)}
                    >
                      {applying ? "应用中" : pendingDraftApplyId === draft.id ? "再次应用" : "应用"}
                    </button>
                  </div>
                </div>
                <BoundedPreview
                  expanded={expanded}
                  maxLinesClass="line-clamp-2"
                  className="mt-2 text-sm leading-6 text-ink/58"
                >
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
                <p className="mt-1 text-xs leading-5 text-ink/50">
                  已有 {reviews.map((review) => review.sourceLabel).join("、")} 回顾，可由你手动合成一份总档案。
                </p>
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
    </aside>
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
          <p className="text-xs text-ink/45">只读档案；如需重新生成，请回到日志页对应日期。</p>
          <button className="secondary-action action-standard" onClick={onClose}>关闭</button>
        </footer>
      </section>
    </div>
  );
}

function ReviewReaderOverlay({
  review,
  settings,
  onClose,
  onSave,
}: {
  review: CodexDailyReview;
  settings: AiSettings | null;
  onClose: () => void;
  onSave: (id: string, patch: Partial<CodexDailyReview>) => Promise<void>;
}) {
  const [title, setTitle] = useState(review.title);
  const [content, setContent] = useState(review.content);
  const [savedTitle, setSavedTitle] = useState(review.title);
  const [savedContent, setSavedContent] = useState(review.content);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [message, setMessage] = useState("");
  const [comparison, setComparison] = useState<CodexDailyReview | null>(null);
  const [pendingRegenerate, setPendingRegenerate] = useState(false);
  const savingRef = useRef(false);
  const regeneratingRef = useRef(false);
  const regenerateAbortRef = useRef<AbortController | null>(null);
  const regenerateJobIdRef = useRef("");
  const closeAfterRegenerateCancelRef = useRef(false);
  const aiReady = settings ? getEffectiveAiSettings(settings).keySource !== "missing" : false;
  const dirty = title.trim() !== savedTitle.trim() || content.trim() !== savedContent.trim();

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
    if (regeneratingRef.current) {
      cancelRegenerate(true);
      return;
    }
    if (savingRef.current) {
      setMessage("正在保存，完成后再关闭。");
      return;
    }
    if (dirty) {
      setMessage("有未保存的修改，请先保存或恢复后再关闭。");
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

  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setMessage("");
    try {
      await onSave(review.id, { title, content });
      setSavedTitle(title);
      setSavedContent(content);
      setMessage("已保存这份回顾。");
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "保存失败。"));
    } finally {
      savingRef.current = false;
      setSaving(false);
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
      setMessage(`将重新读取 ${review.sessionIds.length} 个原始会话正文并调用 AI 生成新草稿；当前回顾不会被覆盖。再次点击“确认生成草稿”才会开始。`);
      return;
    }

    setPendingRegenerate(false);
    regeneratingRef.current = true;
    setRegenerating(true);
    setMessage("正在生成一份新草稿，不会覆盖当前回顾。");
    const controller = new AbortController();
    const jobId = createClientJobId();
    regenerateAbortRef.current = controller;
    regenerateJobIdRef.current = jobId;
    closeAfterRegenerateCancelRef.current = false;
    try {
      const input = await readSelectedConversationSessions(review.sessionIds, jobId);
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
        sourceReviewIds: review.sourceReviewIds ?? [],
        createdAt: "",
        updatedAt: "",
      });
      setMessage("新草稿已生成，可在下方对比。当前回顾没有被覆盖。");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setMessage("已取消本次草稿生成。");
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
          <button className="ghost-action icon-action-compact disabled:cursor-not-allowed disabled:opacity-45" disabled={saving} onClick={requestClose} title="关闭" aria-label="关闭回顾阅读层">
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
              <div className="mb-2 text-xs font-semibold text-copper">新生成草稿（未覆盖当前）</div>
              <h4 className="text-sm font-semibold text-ink">{comparison.title}</h4>
              <p className="mt-2 max-h-[240px] overflow-y-auto whitespace-pre-wrap text-anywhere pr-1 text-sm leading-7 text-ink/64 scrollbar-thin">{comparison.content}</p>
              <button
                className="soft-button action-compact mt-3"
                onClick={() => {
                  setTitle(comparison.title);
                  setContent(comparison.content);
                  setMessage("草稿已放入编辑区，确认无误后保存即可替换正式回顾。");
                }}
              >
                采用这份草稿
              </button>
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-panel/70 px-5 py-3">
          <p className="min-w-0 text-anywhere text-xs text-ink/45">{message || "可以直接编辑标题和正文，再保存为你的版本。"}</p>
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
            <button
              className="soft-button action-standard text-xs font-medium disabled:opacity-60"
              disabled={regenerating}
              onClick={regenerate}
            >
              {regenerating ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {pendingRegenerate ? "确认生成草稿" : "生成新草稿"}
            </button>
            <button
              className="primary-button action-standard text-xs disabled:opacity-60"
              disabled={saving}
              onClick={save}
            >
              {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
              保存
            </button>
          </div>
        </footer>
      </section>
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

function createReviewKeyFromSelection(sessions: CodexSessionIndex[]) {
  const first = sessions[0];
  const sourceKinds = Array.from(new Set(sessions.map((session) => session.sourceKind)));
  const sourceKey = sourceKinds.length === 1 ? sourceKinds[0] : "mixed";
  return `${first?.date ?? "selected"}:source:${sourceKey}`;
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
    <section className="section-surface space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-ink">
        <BookOpenText size={16} />
        留下什么
      </div>
      <CodexGuard title="稳定" text="偏好、长期约束、项目方向和反复出现的原则。" />
      <CodexGuard title="克制" text="少写，写准；宁可留下背景，不留下噪声。" />
      <CodexGuard title="安全" text="密钥、临时路径、命令输出和报错碎片不进入长期记忆。" />
    </section>
  );
}

function CodexGuard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-[8px] border border-line bg-panel/70 p-3">
      <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-ink">
        <ShieldCheck size={14} className="text-moss" />
        {title}
      </div>
      <p className="text-xs leading-5 text-ink/45">{text}</p>
    </div>
  );
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
