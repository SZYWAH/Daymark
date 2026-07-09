import {
  ArrowRight,
  BookOpen,
  Bot,
  Brain,
  CheckCircle2,
  FileText,
  Inbox,
  Loader2,
  Maximize2,
  MessagesSquare,
  Plus,
  Save,
  Search,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { animate } from "animejs";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getEffectiveAiSettings, type CodexReviewProgress } from "../ai/deepseek";
import { PageWorkspace } from "./PageWorkspace";
import {
  cancelConversationReviewJob,
  indexConversationSessions,
  isDesktopRuntime,
  readSelectedConversationSessions,
} from "../lib/desktop";
import { toDateKey } from "../lib/date";
import { getSafeErrorMessage } from "../lib/redaction";
import type {
  AiSettings,
  CodexDailyReview,
  CodexReviewInput,
  CodexSessionIndex,
  ConversationGenerationDraft,
  ConversationSourceKind,
  EntityKind,
  MemorySubView,
  MemoryPatchDraft,
  SmartView,
  TodayDashboardData,
} from "../types";

type GenerateReviewResult = {
  review: CodexDailyReview;
  patchDraft?: MemoryPatchDraft;
  replacementDraft?: boolean;
};

type TodayPageProps = {
  data: TodayDashboardData | null;
  loading: boolean;
  settings: AiSettings | null;
  codexReviews: CodexDailyReview[];
  memoryPatchDrafts: MemoryPatchDraft[];
  conversationGenerationDrafts: ConversationGenerationDraft[];
  onCreateJournalEntry: (input: { content: string; tags: string[]; todos: string[]; entryDate?: string }) => Promise<void>;
  onOpenEntity: (kind: EntityKind, id: string) => void;
  onOpenSearch: () => void;
  onOpenLibraryView: (view: SmartView) => void;
  onOpenJournalPage: () => void;
  onOpenMemoryPage: (subView?: MemorySubView) => void;
  onReplaceCodexSessionIndex: (records: CodexSessionIndex[]) => Promise<void>;
  onGenerateCodexReview: (
    input: CodexReviewInput,
    onProgress?: (progress: CodexReviewProgress) => void,
    signal?: AbortSignal,
  ) => Promise<GenerateReviewResult>;
  onGenerateCombinedReview: (
    reviews: CodexDailyReview[],
    onProgress?: (progress: CodexReviewProgress) => void,
    signal?: AbortSignal,
  ) => Promise<GenerateReviewResult>;
};

type Accent = "blue" | "amber" | "indigo" | "violet" | "emerald" | "copper";
type TodayDetailsPanel = "written" | "review" | "pending" | "todos" | null;

const MAX_TODAY_ROWS = 3;
const TODAY_COMPOSER_DRAFT_KEY = "personal-knowledge-base:today-composer-draft:v1";

const statusBadgeClass: Record<Accent, string> = {
  blue: "bg-lake/10 text-lake",
  amber: "bg-copper/10 text-copper",
  indigo: "bg-panel text-ink/70",
  violet: "bg-panel text-ink/70",
  emerald: "bg-panel text-ink/70",
  copper: "bg-copper/10 text-copper",
};

const accentClass: Record<Accent, string> = {
  blue: "accent-blue",
  amber: "accent-amber",
  indigo: "accent-indigo",
  violet: "accent-violet",
  emerald: "accent-emerald",
  copper: "accent-amber",
};

const sourceLabels: Record<ConversationSourceKind, string> = {
  codex: "Codex",
  claude: "Claude Code",
};

export function TodayPage({
  data,
  loading,
  settings,
  codexReviews,
  memoryPatchDrafts,
  conversationGenerationDrafts,
  onCreateJournalEntry,
  onOpenEntity,
  onOpenSearch,
  onOpenLibraryView,
  onOpenJournalPage,
  onOpenMemoryPage,
  onReplaceCodexSessionIndex,
  onGenerateCodexReview,
  onGenerateCombinedReview,
}: TodayPageProps) {
  const [content, setContent] = useState(() => readTextDraft(TODAY_COMPOSER_DRAFT_KEY));
  const [saving, setSaving] = useState(false);
  const [composerMessage, setComposerMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [detailsPanel, setDetailsPanel] = useState<TodayDetailsPanel>(null);
  const modulesRef = useRef<HTMLDivElement | null>(null);
  const savingRef = useRef(false);
  const todayKey = toDateKey(new Date());

  useEffect(() => {
    const modules = modulesRef.current?.querySelectorAll(".today-module");
    if (!modules?.length) return;

    Array.from(modules)
      .slice(0, 8)
      .forEach((module, index) => {
        animate(module, {
          opacity: [0, 1],
          translateY: [8, 0],
          duration: 220,
          delay: index * 28,
          easing: "outQuad",
        });
      });
  }, [data, loading, codexReviews.length, memoryPatchDrafts.length]);

  useEffect(() => {
    writeTextDraft(TODAY_COMPOSER_DRAFT_KEY, content);
  }, [content]);

  const submit = async () => {
    const submittedContent = content;
    const trimmedContent = submittedContent.trim();
    if (!trimmedContent || savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    setComposerMessage(null);
    try {
      await onCreateJournalEntry({ content: trimmedContent, tags: [], todos: [] });
      setContent((current) => {
        if (current !== submittedContent) return current;
        clearTextDraft(TODAY_COMPOSER_DRAFT_KEY);
        return "";
      });
      setComposerMessage({ kind: "success", text: "已留下这一刻。" });
      return true;
    } catch (error) {
      setComposerMessage({
        kind: "error",
        text: getSafeErrorMessage(error, "保存失败，请稍后再试。"),
      });
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const todayReviewsForShortcut = codexReviews.filter((review) => review.date === todayKey);
  const todayReviewIdsForShortcut = new Set(todayReviewsForShortcut.map((review) => review.id));
  const todayPatchCountForShortcut = memoryPatchDrafts.filter(
    (draft) => draft.status === "pending" && draft.sourceReviewId && todayReviewIdsForShortcut.has(draft.sourceReviewId),
  ).length;
  const quietToday =
    data &&
    data.todayJournalEntryCount === 0 &&
    todayReviewsForShortcut.length === 0 &&
    todayPatchCountForShortcut === 0 &&
    data.pendingItemCount === 0 &&
    data.journalTodoCount === 0;

  return (
    <PageWorkspace
      eyebrow="Today"
      title="此刻记录"
      description="先写下这一刻，其他内容需要时再轻轻展开。"
      meta={data ? `${data.todayJournalEntryCount} 段文字` : "正在整理"}
      homeHeader
      actions={
        <button className="ghost-action flex h-9 items-center gap-2" aria-label="打开搜索页" onClick={onOpenSearch}>
          <Search size={16} />
          搜索
        </button>
      }
    >
      <div className="flex h-full min-h-0 overflow-y-auto px-5 pb-20 pt-10 scrollbar-thin sm:pb-10 lg:pt-[6.25rem]">
        <div className="mx-auto flex min-h-full w-full max-w-[660px] flex-col justify-start">
          <TodayComposer value={content} saving={saving} onChange={setContent} onSubmit={submit} />
          {composerMessage && (
            <p
              className={`mt-3 text-center text-xs ${
                composerMessage.kind === "error" ? "text-red-400" : "text-ink/48"
              }`}
            >
              {composerMessage.text}
            </p>
          )}

          {loading || !data ? (
            <div className="mt-4">
              <EmptyToday text="正在整理今日内容。" />
            </div>
          ) : (
            <>
              <TodayInlineShortcuts
                active={detailsPanel}
                writtenCount={data.todayJournalEntryCount}
                reviewCount={todayReviewsForShortcut.length}
                patchCount={todayPatchCountForShortcut}
                pendingCount={data.pendingItemCount}
                todoCount={data.journalTodoCount}
                onOpenReview={() => setDetailsPanel((current) => (current === "review" ? null : "review"))}
                onSelect={(panel) => setDetailsPanel((current) => (current === panel ? null : panel))}
              />

              {quietToday && !detailsPanel && <TodayQuietState />}

              {detailsPanel && (
                <div ref={modulesRef} className="mt-4">
                  {detailsPanel === "review" && (
                    <TodayReviewPanel
                      todayKey={todayKey}
                      settings={settings}
                      codexReviews={codexReviews}
                      memoryPatchDrafts={memoryPatchDrafts}
                      conversationGenerationDrafts={conversationGenerationDrafts}
                      onOpenMemoryPage={onOpenMemoryPage}
                      onReplaceCodexSessionIndex={onReplaceCodexSessionIndex}
                      onGenerateCodexReview={onGenerateCodexReview}
                      onGenerateCombinedReview={onGenerateCombinedReview}
                    />
                  )}

                  {detailsPanel === "written" && (
                    <TodayModule
                      accent="blue"
                      icon={FileText}
                      title="今天留下的字句"
                      count={data.todayJournalEntryCount}
                      actionLabel={data.todayJournalEntryCount > MAX_TODAY_ROWS ? "查看全部" : undefined}
                      onAction={onOpenJournalPage}
                    >
                      <TodayRows
                        emptyText="今天还没有留下字句。"
                        items={data.todayJournalEntries.slice(0, MAX_TODAY_ROWS).map((entry) => ({
                          id: entry.id,
                          title: entry.content,
                          meta: entry.entryDate,
                          onClick: () => onOpenEntity("journal", entry.id),
                        }))}
                        accent="blue"
                      />
                    </TodayModule>
                  )}

                  {detailsPanel === "pending" && (
                    <TodayModule
                      accent="amber"
                      icon={Inbox}
                      title="待整理资料"
                      count={data.pendingItemCount}
                      actionLabel={data.pendingItemCount > MAX_TODAY_ROWS ? "查看全部" : undefined}
                      onAction={() => onOpenLibraryView("attention")}
                    >
                      <TodayRows
                        emptyText="没有急着归位的资料。"
                        items={data.pendingItems.slice(0, MAX_TODAY_ROWS).map((item) => ({
                          id: item.id,
                          title: item.title,
                          meta: item.processStatus,
                          status: item.folderId ? "待整理" : "未归档",
                          onClick: () => onOpenEntity("item", item.id),
                        }))}
                        accent="amber"
                      />
                    </TodayModule>
                  )}

                  {detailsPanel === "todos" && (
                    <TodayModule
                      accent="emerald"
                      icon={CheckCircle2}
                      title="顺手记下的待办"
                      count={data.journalTodoCount}
                      actionLabel={data.journalTodoCount > MAX_TODAY_ROWS ? "查看全部" : undefined}
                      onAction={onOpenJournalPage}
                    >
                      <TodayRows
                        emptyText="没有悬着的小事。"
                        items={data.journalTodos.slice(0, MAX_TODAY_ROWS).map((todo) => ({
                          id: todo.id,
                          title: todo.content,
                          meta: todo.entryDate,
                          onClick: () => onOpenEntity("journal", todo.entryId),
                        }))}
                        accent="emerald"
                      />
                    </TodayModule>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </PageWorkspace>
  );
}
function TodayInlineShortcuts({
  active,
  writtenCount,
  reviewCount,
  patchCount,
  pendingCount,
  todoCount,
  onOpenReview,
  onSelect,
}: {
  active: TodayDetailsPanel;
  writtenCount: number;
  reviewCount: number;
  patchCount: number;
  pendingCount: number;
  todoCount: number;
  onOpenReview: () => void;
  onSelect: (panel: Exclude<TodayDetailsPanel, null>) => void;
}) {
  const items: Array<{ id: Exclude<TodayDetailsPanel, null>; label: string; count: number; icon: LucideIcon; hint?: string }> = [
    { id: "written", label: "今天已写", count: writtenCount, icon: FileText },
    { id: "review", label: "AI 今日回顾", count: reviewCount + patchCount, icon: MessagesSquare, hint: patchCount > 0 ? `${patchCount} 条建议` : undefined },
    { id: "pending", label: "待整理资料", count: pendingCount, icon: Inbox },
    { id: "todos", label: "待办", count: todoCount, icon: CheckCircle2 },
  ];

  return (
    <div className="home-shortcut-row">
      {items.map(({ id, label, count, icon: Icon, hint }) => {
        const selected = active === id;
        return (
          <button
            key={id}
            className={`home-shortcut ${
              selected
                ? "home-shortcut-active"
                : ""
            }`}
            onClick={() => (id === "review" ? onOpenReview() : onSelect(id))}
          >
            <Icon size={15} />
            <span>{label}</span>
            <span className="rounded-full border border-line px-1.5 py-0.5 text-[11px] text-ink/45">{count}</span>
            {hint && <span className="hidden text-[11px] text-ink/38 sm:inline">{hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

function TodayComposer({
  value,
  saving,
  onChange,
  onSubmit,
}: {
  value: string;
  saving: boolean;
  onChange: (value: string) => void;
  onSubmit: () => Promise<boolean> | boolean;
}) {
  const [focused, setFocused] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);

  const submitAndClose = async () => {
    await Promise.resolve(onSubmit()).then((saved) => {
      if (saved) setZoomOpen(false);
    });
  };

  return (
    <div className={`home-composer ${focused ? "home-composer-focused" : ""}`}>
      <label htmlFor="today-composer" className="sr-only">
        此刻记录
      </label>
      <textarea
        id="today-composer"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        rows={2}
        placeholder="此刻想到什么，就先放在这里。"
        className="home-composer-input"
      />
      <div className="home-composer-actions">
        <div className="text-xs text-ink/35">此刻记录</div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            className="ghost-action flex h-10 w-10 items-center justify-center px-0"
            onClick={() => setZoomOpen(true)}
            title="放大写作"
            aria-label="放大此刻记录输入框"
          >
            <Maximize2 size={16} />
          </button>
          <button
            className="primary-action flex h-10 items-center justify-center gap-2 px-4"
            disabled={saving || !value.trim()}
            onClick={onSubmit}
          >
            <Plus size={16} />
            {saving ? "保存中" : "留下"}
          </button>
        </div>
      </div>
      {zoomOpen && (
        <TodayFocusOverlay title="此刻记录" onClose={() => setZoomOpen(false)} onSubmit={submitAndClose}>
          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            autoFocus
            spellCheck={false}
            placeholder="把这一刻展开写完。"
            className="fullscreen-editor-input min-h-0 flex-1 w-full resize-none overflow-y-auto rounded-[16px] px-5 py-4 text-base leading-8 scrollbar-thin"
          />
          <div className="mt-4 flex shrink-0 flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-ink/45">保存后会回到今日页；这里不会套模板，也不会自动分析。</p>
            <button
              className="primary-action flex h-10 items-center gap-2 px-4"
              disabled={saving || !value.trim()}
              onClick={submitAndClose}
            >
              <Save size={16} />
              {saving ? "保存中" : "留下这一刻"}
            </button>
          </div>
        </TodayFocusOverlay>
      )}
    </div>
  );
}

function TodayFocusOverlay({
  title,
  children,
  onClose,
  onSubmit,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  onSubmit?: () => Promise<void> | void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.key === "Process") return;
      if (event.key === "Escape") onClose();
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && onSubmit) {
        event.preventDefault();
        void onSubmit();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, onSubmit]);

  return (
    <div className="fixed inset-0 z-[90] bg-paper">
      <section aria-label={title} aria-modal="true" className="fullscreen-shell flex flex-col overflow-hidden" role="dialog">
        <header className="flex shrink-0 items-center justify-between border-b border-line/70 bg-panel/40 px-5 py-3 lg:px-7">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink/45 transition hover:bg-panel hover:text-ink"
            onClick={onClose}
            aria-label="关闭"
            title="关闭"
          >
            <X size={16} />
          </button>
        </header>
        <div className="mx-auto flex min-h-0 w-full max-w-[1180px] flex-1 flex-col overflow-hidden p-5 scrollbar-thin lg:p-7">{children}</div>
      </section>
    </div>
  );
}

function TodayReviewPanel({
  todayKey,
  settings,
  codexReviews,
  memoryPatchDrafts,
  conversationGenerationDrafts,
  onOpenMemoryPage,
  onReplaceCodexSessionIndex,
  onGenerateCodexReview,
  onGenerateCombinedReview,
}: {
  todayKey: string;
  settings: AiSettings | null;
  codexReviews: CodexDailyReview[];
  memoryPatchDrafts: MemoryPatchDraft[];
  conversationGenerationDrafts: ConversationGenerationDraft[];
  onOpenMemoryPage: (subView?: MemorySubView) => void;
  onReplaceCodexSessionIndex: (records: CodexSessionIndex[]) => Promise<void>;
  onGenerateCodexReview: TodayPageProps["onGenerateCodexReview"];
  onGenerateCombinedReview: TodayPageProps["onGenerateCombinedReview"];
}) {
  const [sessions, setSessions] = useState<CodexSessionIndex[]>([]);
  const [scanning, setScanning] = useState(false);
  const [generatingSource, setGeneratingSource] = useState<ConversationSourceKind | "combined" | null>(null);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<CodexReviewProgress | null>(null);
  const [pendingSource, setPendingSource] = useState<ConversationSourceKind | null>(null);
  const [pendingCombined, setPendingCombined] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const jobIdRef = useRef("");
  const desktop = isDesktopRuntime();
  const aiReady = settings ? getEffectiveAiSettings(settings).keySource !== "missing" : false;

  const todayReviews = useMemo(
    () => codexReviews.filter((review) => review.date === todayKey),
    [codexReviews, todayKey],
  );
  const codexReview = todayReviews.find((review) => review.reviewKind === "source" && review.sourceKind === "codex");
  const claudeReview = todayReviews.find((review) => review.reviewKind === "source" && review.sourceKind === "claude");
  const combinedReview = todayReviews.find((review) => review.reviewKind === "combined");
  const todayReviewIds = new Set(todayReviews.map((review) => review.id));
  const todayPatchCount = memoryPatchDrafts.filter(
    (draft) => draft.status === "pending" && draft.sourceReviewId && todayReviewIds.has(draft.sourceReviewId),
  ).length;
  const cancelledDraft = conversationGenerationDrafts.find(
    (draft) => draft.status === "cancelled" && draft.date === todayKey,
  );

  const sourceSessionCount = (sourceKind: ConversationSourceKind) =>
    sessions.filter((session) => session.sourceKind === sourceKind).length;

  const scanToday = async () => {
    if (!desktop) {
      setMessage("AI 对话回顾需要在桌面端使用。");
      return [];
    }

    setScanning(true);
    setMessage("");
    setProgress(null);
    setPendingSource(null);
    setPendingCombined(false);
    try {
      const result = await indexConversationSessions({
        sourceKinds: ["codex", "claude"],
        dateFrom: todayKey,
        dateTo: todayKey,
        limit: 120,
      });
      setSessions(result);
      await onReplaceCodexSessionIndex(result);
      setMessage(result.length > 0 ? `今天找到 ${result.length} 个会话。生成时才会读取正文。` : "今天没有找到可回顾的 AI 会话。");
      return result;
    } catch (error) {
      const text = getSafeErrorMessage(error, "扫描今日会话失败。");
      setMessage(text);
      return [];
    } finally {
      setScanning(false);
    }
  };

  const generateSourceReview = async (sourceKind: ConversationSourceKind) => {
    if (!desktop) {
      setMessage("AI 对话回顾需要在桌面端使用。");
      return;
    }
    if (!aiReady) {
      setMessage("还没有配置 AI API Key。当前不会读取或上传对话正文。");
      return;
    }
    setPendingCombined(false);

    if (sessions.length === 0) {
      const scanned = await scanToday();
      const count = scanned.filter((session) => session.sourceKind === sourceKind).length;
      if (count > 0) {
        setPendingSource(sourceKind);
      }
      setMessage(
        count > 0
          ? `已找到 ${count} 个 ${sourceLabels[sourceKind]} 会话。再次点击“确认生成”才会读取正文并开始生成。`
          : `今天没有找到 ${sourceLabels[sourceKind]} 会话。`,
      );
      return;
    }

    const available = sessions;
    const selected = available.filter((session) => session.sourceKind === sourceKind);
    if (selected.length === 0) {
      setPendingSource(null);
      setMessage(`今天没有找到 ${sourceLabels[sourceKind]} 会话。`);
      return;
    }

    if (pendingSource !== sourceKind) {
      const selectedBytes = selected.reduce((sum, session) => sum + session.sizeBytes, 0);
      setPendingSource(sourceKind);
      setProgress(null);
      setMessage(`将读取 ${selected.length} 个 ${sourceLabels[sourceKind]} 会话正文（约 ${formatBytes(selectedBytes)}），调用 AI 生成回顾，并可能结合长期记忆生成待审核建议。再次点击“确认生成”才会开始。`);
      return;
    }

    const controller = new AbortController();
    const jobId = createClientJobId();
    abortRef.current = controller;
    jobIdRef.current = jobId;
    setGeneratingSource(sourceKind);
    setPendingSource(null);
    setProgress({ stage: "读取会话", message: `准备读取今天的 ${selected.length} 个 ${sourceLabels[sourceKind]} 会话。` });
    setMessage("");

    try {
      const input = await readSelectedConversationSessions(selected.map((session) => session.id), jobId);
      if (controller.signal.aborted) throw new DOMException("已取消生成。", "AbortError");
      const result = await onGenerateCodexReview(
        input,
        (nextProgress) => setProgress(nextProgress),
        controller.signal,
      );
      setMessage(
        result.replacementDraft
          ? `已生成 ${sourceLabels[sourceKind]} 今日回顾新版本，并保存为替换草稿；原回顾没有被覆盖。`
          : result.patchDraft
          ? `已生成 ${sourceLabels[sourceKind]} 今日回顾，并提出记忆修改建议。`
          : `已生成 ${sourceLabels[sourceKind]} 今日回顾。记忆修改建议未生成，可稍后在 AI 回顾台重试。`,
      );
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "生成今日回顾失败。"));
    } finally {
      setGeneratingSource(null);
      abortRef.current = null;
      jobIdRef.current = "";
    }
  };

  const generateCombined = async () => {
    const sourceReviews = [codexReview, claudeReview].filter(Boolean) as CodexDailyReview[];
    if (!aiReady) {
      setPendingCombined(false);
      setMessage("还没有配置 AI API Key。当前不会合成今日总回顾。");
      return;
    }
    if (sourceReviews.length < 2) {
      setPendingCombined(false);
      setMessage("请先分别生成 Codex 和 Claude Code 今日回顾，再合成总回顾。");
      return;
    }
    if (!pendingCombined) {
      setPendingCombined(true);
      setPendingSource(null);
      setProgress(null);
      setMessage("合成总回顾会把 Codex 与 Claude Code 的今日回顾一起发送给 AI，并可能生成待审核的记忆建议。再次点击“确认合成”才会开始。");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setGeneratingSource("combined");
    setPendingSource(null);
    setPendingCombined(false);
    setProgress({ stage: "合成每日回顾", message: "正在合成 Codex 与 Claude Code 的今日总回顾。" });
    setMessage("");

    try {
      const result = await onGenerateCombinedReview(sourceReviews, (nextProgress) => setProgress(nextProgress), controller.signal);
      setMessage(
        result.replacementDraft
          ? "已合成今日总回顾新版本，并保存为替换草稿；原综合回顾没有被覆盖。"
          : result.patchDraft
          ? "已合成今日总回顾，并提出记忆修改建议。"
          : "已合成今日总回顾。记忆修改建议未生成，可稍后在 AI 回顾台重试。",
      );
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "合成今日总回顾失败。"));
    } finally {
      setGeneratingSource(null);
      abortRef.current = null;
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    if (jobIdRef.current) void cancelConversationReviewJob(jobIdRef.current);
    setPendingCombined(false);
    setMessage("正在取消本次生成。");
  };

  const busy = scanning || Boolean(generatingSource);

  return (
    <section className={`today-module ${accentClass.copper}`}>
      <header className="today-module-header">
        <div className="flex min-w-0 items-center gap-2">
          <span className="today-icon-box">
            <Bot size={16} />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-ink">AI 今日回顾</h3>
            <p className="mt-0.5 truncate text-xs text-ink/45">{todayKey}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="secondary-action flex h-8 items-center gap-1.5 px-2.5 text-xs" onClick={() => onOpenMemoryPage("patches")}>
            查看记忆建议
          </button>
          <button className="primary-action flex h-8 items-center gap-1.5 px-2.5 text-xs" onClick={() => onOpenMemoryPage("ai-review")}>
            进入 AI 回顾台
            <ArrowRight size={13} />
          </button>
        </div>
      </header>

      <div className="space-y-3 p-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <ReviewStatusCard label="Codex" ready={Boolean(codexReview)} count={sourceSessionCount("codex")} />
          <ReviewStatusCard label="Claude Code" ready={Boolean(claudeReview)} count={sourceSessionCount("claude")} />
          <ReviewStatusCard label="综合回顾" ready={Boolean(combinedReview)} count={todayReviews.length} />
          <ReviewStatusCard label="待审记忆" ready={todayPatchCount > 0} count={todayPatchCount} />
        </div>

        <div className="flex flex-wrap gap-2">
          <TodayActionButton disabled={busy} loading={scanning} icon={MessagesSquare} onClick={() => void scanToday()}>
            扫描今日会话
          </TodayActionButton>
          <TodayActionButton
            disabled={busy}
            loading={generatingSource === "codex"}
            icon={Sparkles}
            onClick={() => void generateSourceReview("codex")}
          >
            {pendingSource === "codex" ? "确认生成 Codex" : "生成 Codex"}
          </TodayActionButton>
          <TodayActionButton
            disabled={busy}
            loading={generatingSource === "claude"}
            icon={Sparkles}
            onClick={() => void generateSourceReview("claude")}
          >
            {pendingSource === "claude" ? "确认生成 Claude" : "生成 Claude"}
          </TodayActionButton>
          <TodayActionButton
            disabled={busy || !codexReview || !claudeReview}
            loading={generatingSource === "combined"}
            icon={Sparkles}
            onClick={() => void generateCombined()}
          >
            {pendingCombined ? "确认合成" : "合成总回顾"}
          </TodayActionButton>
          {generatingSource && (
            <button className="soft-button h-8 px-2.5 text-xs" onClick={cancel}>
              取消
            </button>
          )}
        </div>

        {(message || progress || cancelledDraft) && (
          <div className="rounded-[8px] border border-line bg-panel/75 px-3 py-2 text-xs leading-5 text-ink/58">
            {progress && (
              <div className="mb-1 font-medium text-copper">
                {progress.stage}：{progress.message}
              </div>
            )}
            {message && <div>{message}</div>}
            {cancelledDraft && !progress && <div>有一份取消后保留的临时草稿，可到记忆页继续处理。</div>}
            {progress?.partialContent && (
              <pre className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap rounded-[8px] bg-surface p-2 text-anywhere text-[11px] leading-5 text-ink/60 scrollbar-thin">
                {progress.partialContent}
              </pre>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function ReviewStatusCard({ label, ready, count }: { label: string; ready: boolean; count: number }) {
  return (
    <div className="rounded-[8px] border border-line bg-panel/70 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-ink/62">{label}</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] ${ready ? "bg-moss/10 text-moss" : "bg-surface text-ink/42"}`}>
          {ready ? "已就绪" : "待生成"}
        </span>
      </div>
      <div className="mt-1 text-[11px] text-ink/42">{count} 条线索</div>
    </div>
  );
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function TodayActionButton({
  icon: Icon,
  loading,
  disabled,
  children,
  onClick,
}: {
  icon: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="secondary-action flex h-8 items-center gap-1.5 px-2.5 text-xs" disabled={disabled} onClick={onClick}>
      {loading ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />}
      {children}
    </button>
  );
}

function TodayModule({
  accent,
  icon: Icon,
  title,
  count,
  compact = false,
  actionLabel,
  onAction,
  children,
}: {
  accent: Accent;
  icon: LucideIcon;
  title: string;
  count: number;
  compact?: boolean;
  actionLabel?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  return (
    <section className={`today-module ${accentClass[accent]} ${compact ? "opacity-95" : ""}`}>
      <header className="today-module-header">
        <div className="flex min-w-0 items-center gap-2">
          <span className="today-icon-box">
            <Icon size={16} />
          </span>
          <h3 className="truncate text-sm font-semibold text-ink">{title}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="today-count-badge">{count}</span>
          {actionLabel && onAction && (
            <button className="text-xs font-medium text-ink/48 transition hover:text-copper" onClick={onAction}>
              {actionLabel}
            </button>
          )}
        </div>
      </header>
      <div>{children}</div>
    </section>
  );
}

type TodayRowItem = {
  id: string;
  title: string;
  meta?: string;
  status?: string;
  onClick: () => void;
};

function TodayRows({ items, accent, emptyText }: { items: TodayRowItem[]; accent: Accent; emptyText: string }) {
  if (items.length === 0) return <CompactEmptyState text={emptyText} />;

  return (
    <>
      {items.map((item) => (
        <TodayRow
          key={item.id}
          title={item.title}
          meta={item.meta}
          status={item.status}
          accent={accent}
          onClick={item.onClick}
        />
      ))}
    </>
  );
}

function TodayRow({
  title,
  meta,
  status,
  accent,
  onClick,
}: {
  title: string;
  meta?: string;
  status?: string;
  accent: Accent;
  onClick: () => void;
}) {
  return (
    <button className="today-row today-row-compact" onClick={onClick}>
      <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--module-accent)" }} />
      <span className="min-w-0 flex-1">
        <span className="today-row-title block">{title}</span>
        {meta && <span className="today-row-meta">{meta}</span>}
      </span>
      {status && <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${statusBadgeClass[accent]}`}>{status}</span>}
    </button>
  );
}

function CompactEmptyState({ text }: { text: string }) {
  return <div className="today-empty">{text}</div>;
}

function EmptyToday({ text }: { text: string }) {
  return (
    <div className="flex min-h-[180px] items-center justify-center border-t border-line/60 bg-transparent p-6 text-sm text-ink/42">
      {text}
    </div>
  );
}

function TodayQuietState() {
  return (
    <div className="mt-5 rounded-[12px] border border-line/55 bg-panel/20 px-4 py-3 text-center text-sm leading-6 text-ink/42">
      今天还很安静。想到什么时，直接写在上面就好。
    </div>
  );
}

function createClientJobId() {
  return `today-review-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readTextDraft(key: string) {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeTextDraft(key: string, value: string) {
  try {
    const nextValue = value.trim() ? value : "";
    if (nextValue) {
      window.localStorage.setItem(key, nextValue);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage failures; the composer itself still works.
  }
}

function clearTextDraft(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
}
