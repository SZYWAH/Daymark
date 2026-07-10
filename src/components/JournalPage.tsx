import {
  BookOpenCheck,
  Brain,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Maximize2,
  MoreHorizontal,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode, type TextareaHTMLAttributes } from "react";
import { LinkPanel } from "./LinkPanel";
import { PageWorkspace } from "./PageWorkspace";
import { getSafeErrorMessage } from "../lib/redaction";
import type { EntityKind, Item, JournalEntry, KnowledgeLink, MemoryCard, SummaryReport } from "../types";

type SummaryPrompt = {
  id: string;
  periodType: "day" | "week" | "month";
  periodStart: string;
  periodEnd: string;
  label: string;
};

type JournalPageProps = {
  entries: JournalEntry[];
  reports: SummaryReport[];
  items: Item[];
  memories: MemoryCard[];
  links: KnowledgeLink[];
  loading: boolean;
  summaryPrompts: SummaryPrompt[];
  summaryMessage: string;
  summaryRunning: string;
  onCreateEntry: (input: { content: string; tags: string[]; todos: string[]; entryDate?: string }) => Promise<void>;
  onUpdateEntry: (id: string, patch: Partial<JournalEntry>) => Promise<void>;
  onDeleteEntry: (id: string) => Promise<boolean | void>;
  onExtractToLibrary: (entry: JournalEntry) => void;
  onGenerateSummary: (prompt: SummaryPrompt) => Promise<void>;
  onCreateLink: (input: Omit<KnowledgeLink, "id" | "createdAt">) => Promise<void>;
  onDeleteLink: (id: string) => Promise<void>;
  onOpenEntity: (kind: EntityKind, id: string) => void;
  initialDate?: string;
  initialEntryId?: string;
  initialSummaryId?: string;
};

const JOURNAL_COMPOSER_CONTENT_DRAFT_KEY = "personal-knowledge-base:journal-composer-content-draft:v1";
const JOURNAL_COMPOSER_TAG_DRAFT_KEY = "personal-knowledge-base:journal-composer-tags-draft:v1";
const JOURNAL_COMPOSER_TODO_DRAFT_KEY = "personal-knowledge-base:journal-composer-todos-draft:v1";
const JOURNAL_INLINE_EDIT_DRAFT_KEY = "personal-knowledge-base:journal-inline-edit-draft:v1";

type JournalInlineEditDraft = {
  entryId: string;
  content: string;
  tags: string;
  todos: string;
};

export function JournalPage({
  entries,
  reports,
  items,
  memories,
  links,
  loading,
  summaryPrompts,
  summaryMessage,
  summaryRunning,
  onCreateEntry,
  onUpdateEntry,
  onDeleteEntry,
  onExtractToLibrary,
  onGenerateSummary,
  onCreateLink,
  onDeleteLink,
  onOpenEntity,
  initialDate,
  initialEntryId,
  initialSummaryId,
}: JournalPageProps) {
  const [content, setContent] = useState(() => readTextDraft(JOURNAL_COMPOSER_CONTENT_DRAFT_KEY));
  const [tagText, setTagText] = useState(() => readTextDraft(JOURNAL_COMPOSER_TAG_DRAFT_KEY));
  const [todoText, setTodoText] = useState(() => readTextDraft(JOURNAL_COMPOSER_TODO_DRAFT_KEY));
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [savingEditId, setSavingEditId] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [draftTags, setDraftTags] = useState("");
  const [draftTodos, setDraftTodos] = useState("");
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()));
  const [calendarMonth, setCalendarMonth] = useState(() => toDateKey(new Date()).slice(0, 7));
  const [searchOpen, setSearchOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [expandedJournalEntryIds, setExpandedJournalEntryIds] = useState<string[]>([]);
  const [journalMessage, setJournalMessage] = useState("");
  const [pendingCancelEditId, setPendingCancelEditId] = useState("");
  const [pendingSwitchEditId, setPendingSwitchEditId] = useState("");
  const [pendingDeleteEditId, setPendingDeleteEditId] = useState("");
  const [pendingScrollEntryId, setPendingScrollEntryId] = useState("");
  const savingRef = useRef(false);
  const savingEditRef = useRef("");
  const restoredInlineEditRef = useRef(false);
  const popoverRef = useRef<HTMLElement | null>(null);
  const popoverActionsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (initialDate) setSelectedDate(initialDate);
  }, [initialDate]);

  useEffect(() => {
    if (!initialEntryId) return undefined;

    const entry = entries.find((currentEntry) => currentEntry.id === initialEntryId);
    if (entry) {
      setSelectedDate(entry.entryDate.slice(0, 10));
      setExpandedJournalEntryIds((current) => (current.includes(initialEntryId) ? current : [...current, initialEntryId]));
    }

    setPendingScrollEntryId(initialEntryId);
    return undefined;
  }, [entries, initialEntryId]);

  useEffect(() => {
    if (!initialSummaryId) return undefined;

    const report = reports.find((currentReport) => currentReport.id === initialSummaryId);
    if (report?.periodType === "day") {
      setSelectedDate(report.periodStart);
    }

    const timeout = window.setTimeout(() => {
      document.getElementById(`daily-summary-${initialSummaryId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 160);

    return () => window.clearTimeout(timeout);
  }, [initialSummaryId, reports]);

  useEffect(() => {
    writeTextDraft(JOURNAL_COMPOSER_CONTENT_DRAFT_KEY, content);
    writeTextDraft(JOURNAL_COMPOSER_TAG_DRAFT_KEY, tagText);
    writeTextDraft(JOURNAL_COMPOSER_TODO_DRAFT_KEY, todoText);
  }, [content, tagText, todoText]);

  useEffect(() => {
    if (restoredInlineEditRef.current || editingId || entries.length === 0) return;
    restoredInlineEditRef.current = true;
    const saved = readJournalInlineEditDraft();
    if (!saved) return;
    const entry = entries.find((currentEntry) => currentEntry.id === saved.entryId);
    if (!entry) {
      clearJournalInlineEditDraft();
      return;
    }
    setEditingId(entry.id);
    setDraftContent(saved.content);
    setDraftTags(saved.tags);
    setDraftTodos(saved.todos);
    setSelectedDate(entry.entryDate.slice(0, 10));
    setExpandedJournalEntryIds((current) => (current.includes(entry.id) ? current : [...current, entry.id]));
    setJournalMessage("已恢复上次未保存的日志编辑草稿。");
  }, [editingId, entries]);

  const [composerFullscreenOpen, setComposerFullscreenOpen] = useState(false);
  const [fullscreenJournalEntryId, setFullscreenJournalEntryId] = useState("");

  useEffect(() => {
    setCalendarMonth(selectedDate.slice(0, 7));
  }, [selectedDate]);

  useEffect(() => {
    if (!searchOpen && !calendarOpen && !reportsOpen) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.key === "Process") return;
      if (event.key !== "Escape") return;
      setSearchOpen(false);
      setCalendarOpen(false);
      setReportsOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchOpen, calendarOpen, reportsOpen]);

  useEffect(() => {
    if (!searchOpen && !calendarOpen && !reportsOpen) return undefined;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (popoverRef.current?.contains(target)) return;
      if (popoverActionsRef.current?.contains(target)) return;
      setSearchOpen(false);
      setCalendarOpen(false);
      setReportsOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [searchOpen, calendarOpen, reportsOpen]);

  const dayEntries = useMemo(
    () =>
      entries
        .filter((entry) => entry.entryDate.slice(0, 10) === selectedDate)
        .slice()
        .sort((a, b) => a.entryDate.localeCompare(b.entryDate)),
    [entries, selectedDate],
  );

  const searchResults = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return [];

    return entries
      .filter((entry) => [entry.content, ...entry.tags, ...entry.todos].join(" ").toLowerCase().includes(keyword))
      .slice(0, 30);
  }, [entries, query]);

  const entryCountsByDate = useMemo(() => countEntriesByDate(entries), [entries]);
  const recentReports = reports.filter((report) => report.periodType !== "day").slice(0, 4);
  const daySummary = reports.find(
    (report) => report.periodType === "day" && report.periodStart === selectedDate && report.periodEnd === selectedDate,
  );
  const daySummaryStale = Boolean(daySummary && isDailySummaryStale(daySummary, dayEntries));
  const daySummaryPrompt: SummaryPrompt = {
    id: `day-${selectedDate}`,
    periodType: "day",
    periodStart: selectedDate,
    periodEnd: selectedDate,
    label: `${selectedDate} 日总结`,
  };
  const generatingDaySummary = summaryRunning === daySummaryPrompt.id;
  const fullscreenEntry = entries.find((entry) => entry.id === fullscreenJournalEntryId);
  const editingEntry = entries.find((entry) => entry.id === editingId);
  const fullscreenInitialDraft =
    fullscreenEntry && editingId === fullscreenEntry.id
      ? {
          content: draftContent,
          tags: draftTags,
          todos: draftTodos,
          editing: true,
        }
      : undefined;
  const inlineEditDirty = Boolean(
    editingEntry &&
      (draftContent.trim() !== editingEntry.content.trim() ||
        !sameStringList(parseList(draftTags), editingEntry.tags) ||
        !sameStringList(parseList(draftTodos), editingEntry.todos)),
  );

  useEffect(() => {
    if (!pendingScrollEntryId) return undefined;
    if (!dayEntries.some((entry) => entry.id === pendingScrollEntryId)) return undefined;

    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`journal-entry-${pendingScrollEntryId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      setPendingScrollEntryId("");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [dayEntries, pendingScrollEntryId]);

  useEffect(() => {
    if (!editingId) return;
    writeJournalInlineEditDraft({
      entryId: editingId,
      content: draftContent,
      tags: draftTags,
      todos: draftTodos,
    });
  }, [draftContent, draftTags, draftTodos, editingId]);

  const submit = async (closeFullscreen = false) => {
    const submittedContent = content;
    const submittedTagText = tagText;
    const submittedTodoText = todoText;
    const trimmedContent = submittedContent.trim();
    if (!trimmedContent || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setJournalMessage("");
    try {
      await onCreateEntry({
        entryDate: composeJournalEntryDate(selectedDate),
        content: trimmedContent,
        tags: parseList(submittedTagText),
        todos: parseList(submittedTodoText),
      });
      setContent((current) => (current === submittedContent ? "" : current));
      setTagText((current) => (current === submittedTagText ? "" : current));
      setTodoText((current) => (current === submittedTodoText ? "" : current));
      if (closeFullscreen) setComposerFullscreenOpen(false);
    } catch (error) {
      setJournalMessage(getSafeErrorMessage(error, "日志保存失败，请稍后再试。"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const startEdit = (entry: JournalEntry) => {
    if (editingId && editingId !== entry.id && inlineEditDirty && pendingSwitchEditId !== entry.id) {
      setPendingSwitchEditId(entry.id);
      setJournalMessage("当前日志还有未保存的编辑。请先保存，或再次点击目标日志的“编辑”才会切换。");
      return;
    }
    setPendingCancelEditId("");
    setPendingSwitchEditId("");
    setPendingDeleteEditId("");
    setEditingId(entry.id);
    setDraftContent(entry.content);
    setDraftTags(entry.tags.join("，"));
    setDraftTodos(entry.todos.join("\n"));
  };

  const saveEdit = async (entry: JournalEntry) => {
    if (savingEditRef.current) return;
    setJournalMessage("");
    if (!draftContent.trim()) {
      setJournalMessage("日志内容不能为空。");
      return;
    }
    savingEditRef.current = entry.id;
    setSavingEditId(entry.id);
    try {
      await onUpdateEntry(entry.id, {
        content: draftContent.trim(),
        tags: parseList(draftTags),
        todos: parseList(draftTodos),
      });
      setEditingId("");
      setPendingCancelEditId("");
      setPendingSwitchEditId("");
      setPendingDeleteEditId("");
      clearJournalInlineEditDraft();
    } catch (error) {
      setJournalMessage(getSafeErrorMessage(error, "日志保存失败，请稍后再试。"));
    } finally {
      savingEditRef.current = "";
      setSavingEditId("");
    }
  };

  const cancelEdit = () => {
    if (savingEditRef.current) {
      setJournalMessage("正在保存，完成后再取消。");
      return;
    }
    if (inlineEditDirty && pendingCancelEditId !== editingId) {
      setPendingCancelEditId(editingId);
      setJournalMessage("这条日志还有未保存的编辑。再次点击取消才会放弃草稿。");
      return;
    }
    setEditingId("");
    setDraftContent("");
    setDraftTags("");
    setDraftTodos("");
    setPendingCancelEditId("");
    setPendingSwitchEditId("");
    setPendingDeleteEditId("");
    setJournalMessage("");
    clearJournalInlineEditDraft();
  };

  const updateDraftContent = (value: string) => {
    setPendingCancelEditId("");
    setPendingSwitchEditId("");
    setPendingDeleteEditId("");
    setDraftContent(value);
  };

  const updateDraftTags = (value: string) => {
    setPendingCancelEditId("");
    setPendingSwitchEditId("");
    setPendingDeleteEditId("");
    setDraftTags(value);
  };

  const updateDraftTodos = (value: string) => {
    setPendingCancelEditId("");
    setPendingSwitchEditId("");
    setPendingDeleteEditId("");
    setDraftTodos(value);
  };

  const requestDeleteEntry = async (id: string) => {
    if (savingEditRef.current === id) {
      setJournalMessage("这条日志正在保存，完成后再删除。");
      return;
    }
    if (editingId === id && inlineEditDirty && pendingDeleteEditId !== id) {
      setPendingDeleteEditId(id);
      setJournalMessage("这条日志还有未保存的编辑。再次点击删除，才会放弃草稿并进入删除确认。");
      return;
    }
    const deleted = await onDeleteEntry(id);
    if (deleted && editingId === id) {
      setEditingId("");
      setDraftContent("");
      setDraftTags("");
      setDraftTodos("");
      setPendingCancelEditId("");
      setPendingSwitchEditId("");
      setPendingDeleteEditId("");
      clearJournalInlineEditDraft();
    }
  };

  const toggleEntryExpanded = (id: string) => {
    setExpandedJournalEntryIds((current) =>
      current.includes(id) ? current.filter((entryId) => entryId !== id) : [...current, id],
    );
  };

  const setPopoverNode = (node: HTMLElement | null) => {
    popoverRef.current = node;
  };

  return (
    <PageWorkspace
      eyebrow="Journal"
      title="日志"
      compactHeader
      fixedBody
      meta={
        <span className="inline-flex items-center gap-2">
            <CalendarDays size={16} />
            {selectedDate} · {dayEntries.length} 段
        </span>
      }
      actions={
        <div ref={popoverActionsRef}>
          <JournalTopActions
            searchOpen={searchOpen}
            calendarOpen={calendarOpen}
            reportsOpen={reportsOpen}
            summaryPrompts={summaryPrompts}
            summaryMessage={summaryMessage}
            summaryRunning={summaryRunning}
            recentReportCount={recentReports.length}
            onToggleSearch={() => {
              setSearchOpen((value) => !value);
              setCalendarOpen(false);
              setReportsOpen(false);
            }}
            onToggleCalendar={() => {
              setCalendarOpen((value) => !value);
              setReportsOpen(false);
              setSearchOpen(false);
            }}
            onToggleReports={() => {
              setReportsOpen((value) => !value);
              setCalendarOpen(false);
              setSearchOpen(false);
            }}
            onGenerateSummary={onGenerateSummary}
          />
        </div>
      }
    >
      <div className="relative flex h-full min-h-0 flex-col overflow-hidden px-5 py-3 lg:px-8">
        {journalMessage && (
          <div className="mb-2 shrink-0 rounded-[8px] border border-line bg-panel px-3 py-2 text-sm text-red-400">
            {journalMessage}
          </div>
        )}
        {calendarOpen && (
          <div ref={setPopoverNode} className="popover-surface absolute right-4 top-4 z-30 max-h-[min(70vh,520px)] w-[min(360px,calc(100%-2rem))] overflow-y-auto scrollbar-thin">
            <JournalCalendar
              month={calendarMonth}
              selectedDate={selectedDate}
              entryCountsByDate={entryCountsByDate}
              onMonthChange={setCalendarMonth}
              onSelectDate={(date) => {
                setSelectedDate(date);
                setCalendarOpen(false);
              }}
              onClearDate={() => {
                setSelectedDate(toDateKey(new Date()));
                setCalendarOpen(false);
              }}
            />
          </div>
        )}

        {reportsOpen && (
          <div ref={setPopoverNode} className="popover-surface absolute right-4 top-4 z-30 max-h-[min(70vh,520px)] w-[min(360px,calc(100%-2rem))] overflow-y-auto scrollbar-thin">
            <RecentReports reports={recentReports} />
          </div>
        )}

        {searchOpen && (
          <JournalSearchOverlay
            setContainerRef={setPopoverNode}
            query={query}
            results={searchResults}
            onQueryChange={setQuery}
            onClose={() => setSearchOpen(false)}
            onPick={(entry) => {
              const entryId = entry.id;
              setSelectedDate(entry.entryDate.slice(0, 10));
              setExpandedJournalEntryIds((current) => (current.includes(entryId) ? current : [...current, entryId]));
              setPendingScrollEntryId(entryId);
              setSearchOpen(false);
              setQuery("");
            }}
          />
        )}

        <JournalDayDocument
          date={selectedDate}
          entries={dayEntries}
          allEntries={entries}
          items={items}
          memories={memories}
          reports={reports}
          links={links}
          loading={loading}
          daySummary={daySummary}
          daySummaryStale={daySummaryStale}
          daySummaryPrompt={daySummaryPrompt}
          targetSummaryId={initialSummaryId}
          generatingDaySummary={generatingDaySummary}
          summaryBusy={Boolean(summaryRunning)}
          editingId={editingId}
          savingEditId={savingEditId}
          draftContent={draftContent}
          draftTags={draftTags}
          draftTodos={draftTodos}
          content={content}
          tagText={tagText}
          todoText={todoText}
          saving={saving}
          expandedEntryIds={expandedJournalEntryIds}
          onContentChange={setContent}
          onTagTextChange={setTagText}
          onTodoTextChange={setTodoText}
          onSubmit={() => submit()}
          onOpenComposerFullscreen={() => setComposerFullscreenOpen(true)}
          onGenerateSummary={onGenerateSummary}
          onDraftContentChange={updateDraftContent}
          onDraftTagsChange={updateDraftTags}
          onDraftTodosChange={updateDraftTodos}
          onStartEdit={startEdit}
          onSaveEdit={saveEdit}
          onCancelEdit={cancelEdit}
          onDeleteEntry={requestDeleteEntry}
          onExtractToLibrary={onExtractToLibrary}
          onOpenFullscreen={(entry) => setFullscreenJournalEntryId(entry.id)}
          onToggleEntryExpanded={toggleEntryExpanded}
          onCreateLink={onCreateLink}
          onDeleteLink={onDeleteLink}
          onOpenEntity={onOpenEntity}
        />

        <div className="mt-3 shrink-0 xl:hidden">
          <details className="rounded-[8px] border border-line bg-paper">
            <summary className="plain-summary cursor-pointer px-3 py-2 text-xs text-ink/55">日期与回顾</summary>
            <div className="border-t border-line">
              <JournalCalendar
                month={calendarMonth}
                selectedDate={selectedDate}
                entryCountsByDate={entryCountsByDate}
                onMonthChange={setCalendarMonth}
                onSelectDate={setSelectedDate}
                onClearDate={() => setSelectedDate(toDateKey(new Date()))}
              />
              <RecentReports reports={recentReports} />
            </div>
          </details>
        </div>
      </div>

      <JournalFullscreenComposer
        open={composerFullscreenOpen}
        content={content}
        tagText={tagText}
        todoText={todoText}
        saving={saving}
        onContentChange={setContent}
        onTagTextChange={setTagText}
        onTodoTextChange={setTodoText}
        onClose={() => setComposerFullscreenOpen(false)}
        onSubmit={() => submit(true)}
      />
      <JournalEntryFullscreenOverlay
        entry={fullscreenEntry}
        open={Boolean(fullscreenEntry)}
        initialDraft={fullscreenInitialDraft}
        onClose={() => setFullscreenJournalEntryId("")}
        onSave={onUpdateEntry}
        onSaveSuccess={(entryId) => {
          if (editingId !== entryId) return;
          setEditingId("");
          setDraftContent("");
          setDraftTags("");
          setDraftTodos("");
          setPendingCancelEditId("");
          setPendingSwitchEditId("");
          setPendingDeleteEditId("");
          clearJournalInlineEditDraft();
        }}
      />
    </PageWorkspace>
  );
}

function JournalTopActions({
  searchOpen,
  calendarOpen,
  reportsOpen,
  summaryPrompts,
  summaryMessage,
  summaryRunning,
  recentReportCount,
  onToggleSearch,
  onToggleCalendar,
  onToggleReports,
  onGenerateSummary,
}: {
  searchOpen: boolean;
  calendarOpen: boolean;
  reportsOpen: boolean;
  summaryPrompts: SummaryPrompt[];
  summaryMessage: string;
  summaryRunning: string;
  recentReportCount: number;
  onToggleSearch: () => void;
  onToggleCalendar: () => void;
  onToggleReports: () => void;
  onGenerateSummary: (prompt: SummaryPrompt) => Promise<void>;
}) {
  const reviewPrompts = summaryPrompts.filter((prompt) => prompt.periodType !== "day");

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {summaryMessage && <span className="max-w-[220px] truncate text-xs text-ink/45">{summaryMessage}</span>}
      {reviewPrompts.slice(0, 2).map((prompt) => (
        <button
          key={prompt.id}
          className="secondary-action action-compact"
          disabled={Boolean(summaryRunning)}
          title={prompt.label}
          onClick={() => void onGenerateSummary(prompt)}
        >
          <Brain size={13} />
          {summaryRunning === prompt.id ? "回顾中" : `写${getSummaryPromptShortLabel(prompt.periodType)}`}
        </button>
      ))}
      <button className={`soft-button action-compact ${searchOpen ? "active-toggle" : ""}`} onClick={onToggleSearch}>
        <Search size={14} />
        搜索
      </button>
      <button className={`soft-button action-compact ${calendarOpen ? "active-toggle" : ""}`} onClick={onToggleCalendar}>
        <CalendarDays size={14} />
        日期
      </button>
      <button className={`soft-button action-compact ${reportsOpen ? "active-toggle" : ""}`} onClick={onToggleReports}>
        <BookOpenCheck size={14} />
        回顾{recentReportCount > 0 ? ` · ${recentReportCount}` : ""}
      </button>
    </div>
  );
}

function JournalSearchOverlay({
  setContainerRef,
  query,
  results,
  onQueryChange,
  onClose,
  onPick,
}: {
  setContainerRef?: (node: HTMLElement | null) => void;
  query: string;
  results: JournalEntry[];
  onQueryChange: (value: string) => void;
  onClose: () => void;
  onPick: (entry: JournalEntry) => void;
}) {
  return (
    <section ref={setContainerRef} className="popover-surface absolute left-4 right-4 top-4 z-30 overflow-hidden">
      <div className="flex h-11 items-center gap-2 border-b border-line/70 px-3">
        <Search size={16} className="text-ink/45" />
        <input
          autoFocus
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索留下的字句、标签或待办"
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink/35"
        />
        <button className="soft-button icon-action-compact" onClick={onClose} title="关闭搜索" aria-label="关闭搜索">
          <X size={14} />
        </button>
      </div>
      <div className="max-h-[260px] overflow-y-auto p-2 scrollbar-thin">
        {query.trim() ? (
          results.length > 0 ? (
            <div className="space-y-1">
              {results.map((entry) => (
                <button
                  key={entry.id}
                  className="journal-search-result block w-full rounded-[8px] px-3 py-2 text-left transition"
                  onClick={() => onPick(entry)}
                >
                  <div className="mb-1 text-xs text-ink/42">{entry.entryDate}</div>
                  <div className="line-clamp-2 text-sm leading-6 text-ink/72">{entry.content}</div>
                </button>
              ))}
            </div>
          ) : (
            <div className="px-3 py-8 text-center text-sm text-ink/45">没有找到相符的片刻。</div>
          )
        ) : (
          <div className="px-3 py-8 text-center text-sm text-ink/45">输入关键词后，结果会在这里出现。</div>
        )}
      </div>
    </section>
  );
}

function JournalDayDocument({
  date,
  entries,
  allEntries,
  items,
  memories,
  reports,
  links,
  loading,
  daySummary,
  daySummaryStale,
  daySummaryPrompt,
  targetSummaryId,
  generatingDaySummary,
  summaryBusy,
  editingId,
  savingEditId,
  draftContent,
  draftTags,
  draftTodos,
  content,
  tagText,
  todoText,
  saving,
  expandedEntryIds,
  onContentChange,
  onTagTextChange,
  onTodoTextChange,
  onSubmit,
  onOpenComposerFullscreen,
  onGenerateSummary,
  onDraftContentChange,
  onDraftTagsChange,
  onDraftTodosChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDeleteEntry,
  onExtractToLibrary,
  onOpenFullscreen,
  onToggleEntryExpanded,
  onCreateLink,
  onDeleteLink,
  onOpenEntity,
}: {
  date: string;
  entries: JournalEntry[];
  allEntries: JournalEntry[];
  items: Item[];
  memories: MemoryCard[];
  reports: SummaryReport[];
  links: KnowledgeLink[];
  loading: boolean;
  daySummary?: SummaryReport;
  daySummaryStale: boolean;
  daySummaryPrompt: SummaryPrompt;
  targetSummaryId?: string;
  generatingDaySummary: boolean;
  summaryBusy: boolean;
  editingId: string;
  savingEditId: string;
  draftContent: string;
  draftTags: string;
  draftTodos: string;
  content: string;
  tagText: string;
  todoText: string;
  saving: boolean;
  expandedEntryIds: string[];
  onContentChange: (value: string) => void;
  onTagTextChange: (value: string) => void;
  onTodoTextChange: (value: string) => void;
  onSubmit: () => void;
  onOpenComposerFullscreen: () => void;
  onGenerateSummary: (prompt: SummaryPrompt) => Promise<void>;
  onDraftContentChange: (value: string) => void;
  onDraftTagsChange: (value: string) => void;
  onDraftTodosChange: (value: string) => void;
  onStartEdit: (entry: JournalEntry) => void;
  onSaveEdit: (entry: JournalEntry) => void;
  onCancelEdit: () => void;
  onDeleteEntry: (id: string) => Promise<boolean | void>;
  onExtractToLibrary: (entry: JournalEntry) => void;
  onOpenFullscreen: (entry: JournalEntry) => void;
  onToggleEntryExpanded: (id: string) => void;
  onCreateLink: (input: Omit<KnowledgeLink, "id" | "createdAt">) => Promise<void>;
  onDeleteLink: (id: string) => Promise<void>;
  onOpenEntity: (kind: EntityKind, id: string) => void;
}) {
  const isToday = date === toDateKey(new Date());

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-line bg-paper">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line px-1 py-2">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-baseline gap-3">
            <p className="text-xs uppercase tracking-[0.16em] text-ink/38">{isToday ? "Today Document" : "Day Document"}</p>
            <h3 className="text-xl font-semibold tracking-normal text-ink">{date}</h3>
            <p className="text-sm text-ink/46">{entries.length > 0 ? `${entries.length} 段` : "暂无记录"}</p>
          </div>
        </div>
        <button
          className="secondary-action action-standard"
          disabled={summaryBusy || entries.length === 0}
          onClick={() => void onGenerateSummary(daySummaryPrompt)}
        >
          {generatingDaySummary ? "总结中" : daySummary ? "重新总结" : "总结这一天"}
        </button>
      </header>

      {daySummary && <DailySummaryBlock report={daySummary} highlighted={targetSummaryId === daySummary.id} stale={daySummaryStale} />}

      <div className="min-h-0 flex-1 overflow-y-auto px-0 py-2 scrollbar-thin">
        {loading ? (
          <EmptyJournal text="正在翻开你的日志。" />
        ) : entries.length > 0 ? (
          <div className="w-full">
            {entries.map((entry, index) => (
              <CompactJournalEntry
                key={entry.id}
                entry={entry}
                entries={allEntries}
                items={items}
                memories={memories}
                reports={reports}
                links={links}
                editing={editingId === entry.id}
                savingEdit={savingEditId === entry.id}
                draftContent={draftContent}
                draftTags={draftTags}
                draftTodos={draftTodos}
                expanded={expandedEntryIds.includes(entry.id)}
                firstInDay={index === 0}
                onToggleExpanded={() => onToggleEntryExpanded(entry.id)}
                onDraftContentChange={onDraftContentChange}
                onDraftTagsChange={onDraftTagsChange}
                onDraftTodosChange={onDraftTodosChange}
                onStartEdit={onStartEdit}
                onSaveEdit={onSaveEdit}
                onCancelEdit={onCancelEdit}
                onDeleteEntry={onDeleteEntry}
                onExtractToLibrary={onExtractToLibrary}
                onOpenFullscreen={onOpenFullscreen}
                onCreateLink={onCreateLink}
                onDeleteLink={onDeleteLink}
                onOpenEntity={onOpenEntity}
              />
            ))}
          </div>
        ) : (
          <EmptyJournal
            text="这一天暂时很安静。"
            action={
              <button className="primary-button action-standard" onClick={onOpenComposerFullscreen}>
                写下这一刻
              </button>
            }
          />
        )}
      </div>

      <div className="shrink-0 pb-16 sm:pb-0">
        <JournalComposer
          content={content}
          tagText={tagText}
          todoText={todoText}
          saving={saving}
          onContentChange={onContentChange}
          onTagTextChange={onTagTextChange}
          onTodoTextChange={onTodoTextChange}
          onSubmit={onSubmit}
          onOpenFullscreen={onOpenComposerFullscreen}
        />
      </div>
    </section>
  );
}

function CompactJournalEntry({
  entry,
  entries,
  items,
  memories,
  reports,
  links,
  editing,
  savingEdit,
  draftContent,
  draftTags,
  draftTodos,
  expanded,
  firstInDay,
  onToggleExpanded,
  onDraftContentChange,
  onDraftTagsChange,
  onDraftTodosChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDeleteEntry,
  onExtractToLibrary,
  onOpenFullscreen,
  onCreateLink,
  onDeleteLink,
  onOpenEntity,
}: {
  entry: JournalEntry;
  entries: JournalEntry[];
  items: Item[];
  memories: MemoryCard[];
  reports: SummaryReport[];
  links: KnowledgeLink[];
  editing: boolean;
  savingEdit: boolean;
  draftContent: string;
  draftTags: string;
  draftTodos: string;
  expanded: boolean;
  firstInDay: boolean;
  onToggleExpanded: () => void;
  onDraftContentChange: (value: string) => void;
  onDraftTagsChange: (value: string) => void;
  onDraftTodosChange: (value: string) => void;
  onStartEdit: (entry: JournalEntry) => void;
  onSaveEdit: (entry: JournalEntry) => void;
  onCancelEdit: () => void;
  onDeleteEntry: (id: string) => Promise<boolean | void>;
  onExtractToLibrary: (entry: JournalEntry) => void;
  onOpenFullscreen: (entry: JournalEntry) => void;
  onCreateLink: (input: Omit<KnowledgeLink, "id" | "createdAt">) => Promise<void>;
  onDeleteLink: (id: string) => Promise<void>;
  onOpenEntity: (kind: EntityKind, id: string) => void;
}) {
  const [showLinks, setShowLinks] = useState(false);
  const relatedCount = links.filter(
    (link) =>
      (link.sourceKind === "journal" && link.sourceId === entry.id) ||
      (link.targetKind === "journal" && link.targetId === entry.id),
  ).length;
  const longContent = entry.content.length > 260 || entry.content.split(/\r?\n/).length > 7;

  return (
    <article id={`journal-entry-${entry.id}`} className={`group w-full scroll-mt-24 px-1 py-2 ${firstInDay ? "" : "border-t border-line/70"}`}>
      <div className="flex min-w-0 w-full flex-col gap-2">
        <div className="min-w-0">
          <div className="mb-1 flex min-w-0 flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-ink/38">{entry.entryDate.slice(11, 16) || entry.entryDate}</span>
              {entry.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="quiet-chip py-0.5 text-[11px]">
                  #{tag}
                </span>
              ))}
              {entry.todos.length > 0 && <span className="text-xs text-ink/42">待办 {entry.todos.length}</span>}
              {relatedCount > 0 && <span className="text-xs text-ink/42">相关 {relatedCount}</span>}
            </div>
            <div className="journal-entry-actions flex flex-wrap items-center gap-1.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
            <button className="ghost-action action-micro" disabled={savingEdit} onClick={() => onExtractToLibrary(entry)} aria-label="将这条日志交给 AI 沉淀为知识卡片">
              <Sparkles size={13} className="mr-1 inline" />
              AI 沉淀
            </button>
            <button className="ghost-action action-micro" disabled={savingEdit} onClick={() => onOpenFullscreen(entry)} aria-label="全屏查看这条日志">
              <Maximize2 size={13} className="mr-1 inline" />
              全屏
            </button>
            <button className="ghost-action action-micro" disabled={savingEdit} onClick={() => (editing ? onSaveEdit(entry) : onStartEdit(entry))} aria-label={editing ? "保存这条日志编辑" : "编辑这条日志"}>
              {savingEdit ? "保存中" : editing ? "保存" : "编辑"}
            </button>
            {editing && (
              <button className="ghost-action action-micro" disabled={savingEdit} onClick={onCancelEdit}>
                取消
              </button>
            )}
            <button
              className="danger-icon-action icon-action-micro"
              disabled={savingEdit}
              onClick={() => onDeleteEntry(entry.id)}
              title="删除"
              aria-label="删除这条日志"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {editing ? (
          <div className="space-y-2">
            <textarea
              value={draftContent}
              onChange={(event) => onDraftContentChange(event.target.value)}
              className="field-control h-28 w-full resize-none overflow-y-auto px-3 py-2 text-sm leading-6 scrollbar-thin"
            />
            <div className="grid gap-2 md:grid-cols-2">
              <input
                value={draftTags}
                onChange={(event) => onDraftTagsChange(event.target.value)}
                className="field-control field-standard w-full"
                placeholder="标签"
              />
              <textarea
                value={draftTodos}
                onChange={(event) => onDraftTodosChange(event.target.value)}
                className="field-control field-standard w-full resize-none overflow-y-auto py-1.5 leading-6 scrollbar-thin"
                placeholder="待办"
              />
            </div>
          </div>
        ) : (
          <>
            <p className={`${longContent && !expanded ? "line-clamp-6" : "whitespace-pre-wrap"} ${longContent && expanded ? "max-h-[34rem] overflow-y-auto pr-2 scrollbar-thin" : ""} w-full text-anywhere text-[15px] leading-[1.58] text-ink/78`}>
              {entry.content}
            </p>
            {(longContent || relatedCount > 0) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {longContent && (
                <button className="ghost-action action-micro" onClick={onToggleExpanded}>
                  {expanded ? "收起" : "展开"}
                </button>
              )}
              <button className={`ghost-action action-micro ${relatedCount > 0 ? "" : "text-ink/32"}`} onClick={() => setShowLinks((value) => !value)}>
                相关线索{relatedCount > 0 ? ` · ${relatedCount}` : ""}
              </button>
            </div>
            )}
            {entry.todos.length > 0 && (
              <div className="mt-2 space-y-1 border-l border-line/80 pl-3">
                {entry.todos.map((todo) => (
                  <div key={todo} className="flex gap-2 text-sm text-ink/58">
                    <CheckCircle2 size={14} className="mt-0.5 text-ink/42" />
                    <span className="min-w-0 text-anywhere">{todo}</span>
                  </div>
                ))}
              </div>
            )}
            {showLinks && (
              <div className="mt-3">
                <LinkPanel
                  entityKind="journal"
                  entityId={entry.id}
                  links={links}
                  items={items}
                  journalEntries={entries}
                  memories={memories}
                  reports={reports}
                  onCreateLink={onCreateLink}
                  onDeleteLink={onDeleteLink}
                  onOpenEntity={onOpenEntity}
                />
              </div>
            )}
          </>
        )}
      </div>
      </div>
    </article>
  );
}

function JournalComposer({
  content,
  tagText,
  todoText,
  saving,
  onContentChange,
  onTagTextChange,
  onTodoTextChange,
  onSubmit,
  onOpenFullscreen,
}: {
  content: string;
  tagText: string;
  todoText: string;
  saving: boolean;
  onContentChange: (value: string) => void;
  onTagTextChange: (value: string) => void;
  onTodoTextChange: (value: string) => void;
  onSubmit: () => void;
  onOpenFullscreen: () => void;
}) {
  const [showMoreFields, setShowMoreFields] = useState(false);

  return (
    <div className="shrink-0 border-t border-line bg-paper px-2 py-2 lg:px-3">
      <div className="journal-composer-bar flex min-h-[44px] items-end gap-2 rounded-[10px] border border-line bg-panel/60 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
        <AutosizeTextarea
          value={content}
          onChange={onContentChange}
          minHeight={28}
          maxHeight={128}
          placeholder="写下一刻。"
          className="flex-1 bg-transparent text-sm leading-7 text-ink outline-none placeholder:text-ink/32 scrollbar-thin"
        />
        <button
          className="soft-button icon-action-compact"
          onClick={() => setShowMoreFields((value) => !value)}
          title={showMoreFields ? "收起标签与待办" : "标签与待办"}
          aria-label={showMoreFields ? "收起标签与待办" : "展开标签与待办"}
          aria-expanded={showMoreFields}
        >
          <MoreHorizontal size={14} />
        </button>
        <button
          className="soft-button icon-action-compact"
          onClick={onOpenFullscreen}
          title="展开写作"
          aria-label="展开写作"
        >
          <Maximize2 size={14} />
        </button>
        <button
          className="primary-button action-compact shrink-0"
          disabled={saving || !content.trim()}
          onClick={onSubmit}
        >
          <Plus size={14} />
          {saving ? "保存中" : "留下"}
        </button>
      </div>
      {showMoreFields && (
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <input
            value={tagText}
            onChange={(event) => onTagTextChange(event.target.value)}
            placeholder="标签，用逗号轻轻分开"
            className="field-control field-standard"
          />
          <textarea
            value={todoText}
            onChange={(event) => onTodoTextChange(event.target.value)}
            placeholder="待办，可以逗号或换行"
            className="field-control field-standard resize-none overflow-y-auto py-1.5 leading-6 scrollbar-thin"
          />
        </div>
      )}
    </div>
  );
}

function JournalFullscreenComposer({
  open,
  content,
  tagText,
  todoText,
  saving,
  onContentChange,
  onTagTextChange,
  onTodoTextChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  content: string;
  tagText: string;
  todoText: string;
  saving: boolean;
  onContentChange: (value: string) => void;
  onTagTextChange: (value: string) => void;
  onTodoTextChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.key === "Process") return;
      if (event.key === "Escape") onClose();
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        onSubmit();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, onSubmit]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-paper/82 backdrop-blur-sm">
      <div aria-label="安静写作" aria-modal="true" className="fullscreen-shell flex flex-col overflow-hidden" role="dialog">
        <div className="flex shrink-0 items-center justify-between border-b border-line bg-panel/70 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">安静写作</h3>
            <p className="mt-0.5 text-xs text-ink/45">不用整理成篇，先把真实留下。</p>
          </div>
          <button
            className="ghost-action icon-action-standard"
            onClick={onClose}
            title="关闭"
            aria-label="关闭安静写作"
          >
            <X size={17} />
          </button>
        </div>

        <div className="mx-auto grid min-h-0 w-full max-w-[1120px] flex-1 grid-rows-[minmax(0,1fr)_auto] gap-3 overflow-y-auto p-4 scrollbar-thin lg:grid-cols-[minmax(0,1fr)_280px] lg:grid-rows-none lg:overflow-hidden lg:p-6">
            <textarea
              autoFocus
              value={content}
              onChange={(event) => onContentChange(event.target.value)}
              placeholder="今天留下了什么？"
              className="fullscreen-editor-input h-full min-h-0 w-full resize-none overflow-y-auto px-5 py-4 text-base leading-8 scrollbar-thin lg:px-7 lg:py-6"
          />
          <aside className="min-h-0 space-y-3 overflow-y-auto rounded-[8px] border border-line bg-panel p-3 scrollbar-thin">
            <label className="block text-xs font-medium text-ink/58">
              给这段时光一个标记
              <input
                value={tagText}
                onChange={(event) => onTagTextChange(event.target.value)}
                placeholder="例如：工作、灵感、心情"
                className="field-control field-prominent mt-1 w-full"
              />
            </label>
            <label className="block text-xs font-medium text-ink/58">
              顺手留下要做的事
              <textarea
                value={todoText}
                onChange={(event) => onTodoTextChange(event.target.value)}
                rows={7}
                placeholder="一行一件，也可以空着。"
                className="field-control mt-1 w-full resize-none px-3 py-2 text-sm leading-6"
              />
            </label>
          </aside>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-line bg-panel px-4 py-3">
          <button
            className="soft-button action-standard"
            onClick={onClose}
          >
            回到日志
          </button>
          <button
            className="primary-button action-standard"
            disabled={saving || !content.trim()}
            onClick={onSubmit}
          >
            {saving ? "保存中" : "保存这一刻"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DailySummaryBlock({ report, highlighted = false, stale = false }: { report: SummaryReport; highlighted?: boolean; stale?: boolean }) {
  const [expanded, setExpanded] = useState(highlighted);

  useEffect(() => {
    if (highlighted) setExpanded(true);
  }, [highlighted, report.id]);

  return (
    <section
      id={`daily-summary-${report.id}`}
      className={`border-b border-line bg-panel/45 px-4 py-3 ${highlighted ? "ring-1 ring-copper/35" : ""}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-copper">Daily Summary</div>
          <h4 className="mt-1 text-sm font-semibold text-ink">{report.title}</h4>
          {stale && <p className="mt-1 text-xs text-copper/75">这一天的日志后来有变化，建议重新总结。</p>}
        </div>
        <button className="soft-button action-micro" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "收起" : "展开"}
        </button>
      </div>
      <p className={`${expanded ? "max-h-48 overflow-y-auto whitespace-pre-wrap pr-1 scrollbar-thin" : "line-clamp-2"} mt-2 text-anywhere text-xs leading-6 text-ink/58`}>
        {report.content}
      </p>
    </section>
  );
}

function JournalEntryFullscreenOverlay({
  entry,
  open,
  initialDraft,
  onClose,
  onSave,
  onSaveSuccess,
}: {
  entry?: JournalEntry;
  open: boolean;
  initialDraft?: {
    content: string;
    tags: string;
    todos: string;
    editing: boolean;
  };
  onClose: () => void;
  onSave: (id: string, patch: Partial<JournalEntry>) => Promise<void>;
  onSaveSuccess?: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [draftTags, setDraftTags] = useState("");
  const [draftTodos, setDraftTodos] = useState("");
  const [message, setMessage] = useState("");
  const fullscreenEditTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const savingRef = useRef(false);
  const hasUnsavedChanges = () => {
    if (!entry || !editing) return false;
    return (
      draftContent.trim() !== entry.content.trim() ||
      !sameStringList(parseList(draftTags), entry.tags) ||
      !sameStringList(parseList(draftTodos), entry.todos)
    );
  };
  const requestClose = () => {
    if (hasUnsavedChanges()) {
      setMessage("有未保存的编辑，先保存或取消编辑后再关闭。");
      return;
    }
    onClose();
  };

  useEffect(() => {
    if (!open || !entry) return;
    const sourceDraft = initialDraft;
    setEditing(Boolean(sourceDraft?.editing));
    setMessage("");
    setDraftContent(sourceDraft?.content ?? entry.content);
    setDraftTags(sourceDraft?.tags ?? entry.tags.join("，"));
    setDraftTodos(sourceDraft?.todos ?? entry.todos.join("\n"));
  }, [open, entry?.id, entry?.updatedAt]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.key === "Process") return;
      if (event.key === "Escape") requestClose();
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && editing) {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, editing, draftContent, draftTags, draftTodos, entry?.id, entry?.updatedAt]);

  useEffect(() => {
    if (!open || !editing) return;
    const timer = window.setTimeout(() => {
      fullscreenEditTextareaRef.current?.focus();
    }, 40);
    return () => window.clearTimeout(timer);
  }, [open, editing]);

  if (!open || !entry) return null;

  const save = async () => {
    if (savingRef.current) return;
    if (!draftContent.trim()) {
      setMessage("日志内容不能为空。");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setMessage("");
    try {
      await onSave(entry.id, {
        content: draftContent.trim(),
        tags: parseList(draftTags),
        todos: parseList(draftTodos),
      });
      onSaveSuccess?.(entry.id);
      setEditing(false);
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "日志保存失败，请稍后再试。"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const copyEntry = async () => {
    const copyContent = editing ? draftContent : entry.content;
    const copyTags = editing ? parseList(draftTags) : entry.tags;
    const copyTodos = editing ? parseList(draftTodos) : entry.todos;
    const parts = [
      copyContent,
      copyTags.length ? `标签：${copyTags.join("、")}` : "",
      copyTodos.length ? `待办：\n${copyTodos.map((todo) => `- ${todo}`).join("\n")}` : "",
    ].filter(Boolean);
    setMessage("");
    try {
      await navigator.clipboard?.writeText(parts.join("\n\n"));
      setMessage("已复制。");
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "复制失败，请稍后再试。"));
    }
  };

  return (
    <div className="fixed inset-0 z-[90] bg-paper">
      <section aria-label="日志全屏查看" aria-modal="true" className="fullscreen-shell flex flex-col overflow-hidden" role="dialog">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5 lg:px-7">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.16em] text-ink/38">Journal Entry</p>
            <h2 className="mt-1 truncate text-lg font-semibold text-ink">{entry.entryDate}</h2>
          </div>
          <div className="flex max-w-full items-center gap-2 overflow-x-auto scrollbar-thin">
            <button className="secondary-action action-standard" onClick={() => void copyEntry()}>
              <Copy size={15} />
              复制
            </button>
            {editing && (
              <button
                className="secondary-action action-standard"
                disabled={saving}
                onClick={() => {
                  setDraftContent(entry.content);
                  setDraftTags(entry.tags.join(", "));
                  setDraftTodos(entry.todos.join("\n"));
                  setMessage("");
                  setEditing(false);
                }}
              >
                取消
              </button>
            )}
            <button
              className={editing ? "primary-action action-standard" : "secondary-action action-standard"}
              disabled={saving}
              onClick={() => (editing ? void save() : setEditing(true))}
            >
              {editing ? (saving ? "保存中" : "保存") : "编辑"}
            </button>
            <button className="soft-button icon-action-standard" onClick={requestClose} title="关闭" aria-label="关闭日志全屏查看">
              <X size={16} />
            </button>
          </div>
        </header>
        {message && <div className="shrink-0 border-b border-line px-4 py-2 text-sm text-red-400 lg:px-7">{message}</div>}

        <div className="min-h-0 flex-1 overflow-hidden px-4 py-4 lg:px-7">
          {editing ? (
            <div className="flex h-full w-full max-w-none flex-col space-y-3">
              <textarea
                ref={fullscreenEditTextareaRef}
                value={draftContent}
                onChange={(event) => setDraftContent(event.target.value)}
                className="fullscreen-editor-input min-h-0 flex-1 resize-none overflow-y-auto px-4 py-3 text-base leading-8 scrollbar-thin"
              />
              <div className="grid shrink-0 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <input
                  value={draftTags}
                  onChange={(event) => setDraftTags(event.target.value)}
                  className="field-control field-prominent w-full"
                  placeholder="标签"
                />
                <textarea
                  value={draftTodos}
                  onChange={(event) => setDraftTodos(event.target.value)}
                  className="field-control min-h-[96px] w-full resize-none overflow-y-auto px-3 py-2 text-sm leading-6 scrollbar-thin md:min-h-[72px]"
                  placeholder="待办"
                />
              </div>
            </div>
          ) : (
            <article className="flex h-full w-full max-w-none min-h-0 flex-col gap-3">
              <aside className="shrink-0 rounded-[8px] border border-line/70 bg-panel/35 px-3 py-2">
                <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink/48">
                  <span>时间：<span className="text-ink/62">{entry.entryDate}</span></span>
                  <span>字数：<span className="text-ink/62">{entry.content.length}</span></span>
                  {entry.tags.length > 0 && (
                    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                      标签：
                      {entry.tags.map((tag) => (
                        <span key={tag} className="quiet-chip py-0.5 text-[11px]">
                          #{tag}
                        </span>
                      ))}
                    </span>
                  )}
                  {entry.todos.length > 0 && (
                    <span className="min-w-0 text-anywhere">
                      待办：{entry.todos.join(" / ")}
                    </span>
                  )}
                </div>
              </aside>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1 scrollbar-thin">
                <p className="whitespace-pre-wrap text-anywhere text-[17px] leading-9 text-ink/80 lg:text-[18px] lg:leading-10">
                  {entry.content}
                </p>
              </div>
            </article>
          )}
        </div>
      </section>
    </div>
  );
}

function JournalCalendar({
  month,
  selectedDate,
  entryCountsByDate,
  onMonthChange,
  onSelectDate,
  onClearDate,
}: {
  month: string;
  selectedDate?: string;
  entryCountsByDate: Map<string, number>;
  onMonthChange: (month: string) => void;
  onSelectDate: (date: string) => void;
  onClearDate: () => void;
}) {
  const days = useMemo(() => getCalendarDays(month), [month]);
  const monthLabel = formatMonthLabel(month);
  const today = toDateKey(new Date());

  return (
    <section className="section-surface">
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          className="soft-button icon-action-compact"
          onClick={() => onMonthChange(shiftMonth(month, -1))}
          title="上个月"
          aria-label="上个月"
        >
          <ChevronLeft size={15} />
        </button>
        <div className="text-sm font-semibold text-ink">{monthLabel}</div>
        <button
          className="soft-button icon-action-compact"
          onClick={() => onMonthChange(shiftMonth(month, 1))}
          title="下个月"
          aria-label="下个月"
        >
          <ChevronRight size={15} />
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-ink/35">
        {["一", "二", "三", "四", "五", "六", "日"].map((day) => (
          <span key={day} className="py-1">
            {day}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((dateKey) => {
          const isCurrentMonth = dateKey.slice(0, 7) === month;
          const isSelected = selectedDate === dateKey;
          const count = entryCountsByDate.get(dateKey) ?? 0;
          const isToday = dateKey === today;
          const ariaParts = [
            dateKey,
            isToday ? "今天" : "",
            count > 0 ? `${count} 条日志` : "没有日志",
            isSelected ? "已选中" : "",
          ].filter(Boolean);

          return (
            <button
              key={dateKey}
              className={`relative flex h-8 items-center justify-center rounded-[8px] text-xs transition ${
                isSelected
                  ? "bg-copper/20 font-semibold text-copper ring-1 ring-copper/25"
                  : isToday
                    ? "bg-lake/10 font-semibold text-lake"
                    : isCurrentMonth
                      ? "text-ink/70 hover:bg-panel hover:text-ink"
                      : "text-ink/24 hover:bg-panel"
              }`}
              onClick={() => {
                if (!isCurrentMonth) onMonthChange(dateKey.slice(0, 7));
                onSelectDate(dateKey);
              }}
              title={count > 0 ? `${dateKey} · ${count} 条日志` : dateKey}
              aria-label={ariaParts.join("，")}
              aria-current={isToday ? "date" : undefined}
              aria-pressed={isSelected}
            >
              {Number(dateKey.slice(8, 10))}
              {count > 0 && (
                <span
                  className={`absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${
                    isSelected ? "bg-copper" : "bg-copper"
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="truncate text-xs text-ink/45">{selectedDate ? `正在看：${selectedDate}` : "显示今天"}</span>
        <button
          className="soft-button action-compact"
          onClick={onClearDate}
        >
          回到今天
        </button>
      </div>
    </section>
  );
}

function RecentReports({ reports }: { reports: SummaryReport[] }) {
  return (
    <section className="section-surface">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
        <BookOpenCheck size={16} />
        回顾档案
      </div>
      {reports.length > 0 ? (
        <div className="space-y-2">
          {reports.map((report) => (
            <article key={report.id} className="muted-card p-3">
              <div className="mb-1 text-[11px] text-ink/38">
                {getSummaryPeriodLabel(report.periodType)} · {report.periodStart}
              </div>
              <h3 className="truncate text-sm font-semibold text-ink">{report.title}</h3>
              <p className="mt-1 line-clamp-3 text-xs leading-5 text-ink/52">{report.content}</p>
            </article>
          ))}
        </div>
      ) : (
        <p className="text-sm leading-6 text-ink/45">写过的周/月回顾会安静地收在这里。</p>
      )}
    </section>
  );
}

function EmptyJournal({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center gap-3 border-t border-line/60 bg-transparent p-6 text-sm text-ink/42">
      <span>{text}</span>
      {action}
    </div>
  );
}

function getSummaryPeriodLabel(periodType: SummaryReport["periodType"]) {
  if (periodType === "day") return "日总结";
  if (periodType === "week") return "周回顾";
  return "月回顾";
}

function getSummaryPromptShortLabel(periodType: SummaryReport["periodType"]) {
  if (periodType === "day") return "当天";
  if (periodType === "week") return "上周";
  return "上月";
}

function isDailySummaryStale(report: SummaryReport, entries: JournalEntry[]) {
  if (entries.length === 0) return true;
  return entries.some((entry) => (entry.updatedAt || entry.createdAt || entry.entryDate) > report.updatedAt);
}

function parseList(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,\uFF0C\u3001\r\n]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function sameStringList(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function groupEntriesByDate(entries: JournalEntry[]) {
  const groups = new Map<string, JournalEntry[]>();
  entries.forEach((entry) => {
    const date = entry.entryDate.slice(0, 10);
    groups.set(date, [...(groups.get(date) ?? []), entry]);
  });

  return Array.from(groups.entries()).map(([date, dateEntries]) => ({
    date,
    entries: dateEntries,
  }));
}

function countEntriesByDate(entries: JournalEntry[]) {
  const counts = new Map<string, number>();
  entries.forEach((entry) => {
    const date = entry.entryDate.slice(0, 10);
    counts.set(date, (counts.get(date) ?? 0) + 1);
  });
  return counts;
}

function getCalendarDays(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  const firstDay = dayOfWeek(year, monthIndex, 1) || 7;
  const startOffset = 1 - firstDay;

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(year, monthIndex - 1, 1 + startOffset + index, 12);
    return toDateKey(date);
  });
}

function dayOfWeek(year: number, month: number, day: number) {
  return new Date(year, month - 1, day, 12).getDay();
}

function shiftMonth(month: string, offset: number) {
  const [year, monthIndex] = month.split("-").map(Number);
  const date = new Date(year, monthIndex - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(month: string) {
  const [year, monthIndex] = month.split("-");
  return `${year} 年 ${Number(monthIndex)} 月`;
}

function getCurrentMonthKey() {
  return toDateKey(new Date()).slice(0, 7);
}

function toDateKey(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function composeJournalEntryDate(dateKey: string) {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${dateKey} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

type AutosizeTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  minHeight?: number;
  maxHeight?: number;
};

function AutosizeTextarea({
  value,
  onChange,
  minHeight = 40,
  maxHeight = 180,
  className = "",
  ...props
}: AutosizeTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    const nextHeight = Math.max(minHeight, Math.min(maxHeight, textarea.scrollHeight));
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [maxHeight, minHeight, value]);

  return (
    <textarea
      {...props}
      ref={textareaRef}
      value={value}
      rows={1}
      onChange={(event) => onChange(event.target.value)}
      className={`${className} resize-none`}
    />
  );
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

function clearJournalComposerDraft() {
  [JOURNAL_COMPOSER_CONTENT_DRAFT_KEY, JOURNAL_COMPOSER_TAG_DRAFT_KEY, JOURNAL_COMPOSER_TODO_DRAFT_KEY].forEach((key) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore storage failures.
    }
  });
}

function readJournalInlineEditDraft(): JournalInlineEditDraft | null {
  try {
    const raw = window.localStorage.getItem(JOURNAL_INLINE_EDIT_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<JournalInlineEditDraft>;
    if (!parsed.entryId || typeof parsed.content !== "string") return null;
    return {
      entryId: parsed.entryId,
      content: parsed.content,
      tags: typeof parsed.tags === "string" ? parsed.tags : "",
      todos: typeof parsed.todos === "string" ? parsed.todos : "",
    };
  } catch {
    return null;
  }
}

function writeJournalInlineEditDraft(draft: JournalInlineEditDraft) {
  try {
    window.localStorage.setItem(JOURNAL_INLINE_EDIT_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Ignore storage failures; inline editing still works for the current session.
  }
}

function clearJournalInlineEditDraft() {
  try {
    window.localStorage.removeItem(JOURNAL_INLINE_EDIT_DRAFT_KEY);
  } catch {
    // Ignore storage failures.
  }
}
