import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { animate } from "animejs";
import { listen } from "@tauri-apps/api/event";
import { PanelLeftOpen } from "lucide-react";
import {
  extractMemoryCandidates,
  generateLibraryCardFromJournal,
  getEffectiveAiSettings,
  getProviderLabel,
  runAiAction,
  streamGenerateMemoryPatchFromReview,
  streamSynthesizeCombinedDailyReview,
  streamSummarizeConversationReview,
  summarizeJournalPeriod,
  type AiActionResult,
  type CodexReviewProgress,
} from "./ai/deepseek";
import { EditorOverlay } from "./components/EditorOverlay";
import { ExtractDialog, type ExtractDraft } from "./components/ExtractDialog";
import { FirstRunGuide, type OnboardingStartAction } from "./components/FirstRunGuide";
import { ImportDialog, type ImportDraft, type ImportMode } from "./components/ImportDialog";
import { ConfirmDialog, PromptDialog } from "./components/ConfirmDialog";
import { ItemList } from "./components/ItemList";
import { ItemReader } from "./components/ItemReader";
import { JournalPage } from "./components/JournalPage";
import { LibrarySmartToolbar } from "./components/LibrarySmartToolbar";
import { MemoryPage } from "./components/MemoryPage";
import { SearchPage } from "./components/SearchPage";
import { SettingsPanel } from "./components/SettingsPanel";
import { MobileGlobalNav, Sidebar } from "./components/Sidebar";
import { MainWindowTitleBar } from "./components/MainWindowTitleBar";
import { StartupScreen } from "./components/StartupScreen";
import { TodayPage } from "./components/TodayPage";
import {
  createKnowledgeLink,
  createFolder,
  createItem,
  createItemWithKnowledgeLink,
  createJournalEntry,
  createDailyReviewReplacementDraft,
  archiveRollingWorkReview,
  createMemoryCandidate,
  createMemoryPatchDraft,
  deleteFoldersAndMoveItems,
  deleteItem,
  deleteJournalEntry,
  deleteKnowledgeLink,
  getAutoWorkReviewSettings,
  applyDailyReviewReplacementDraft,
  applyMemoryPatchDraft,
  formatTimestamp,
  getCodexDailyReviews,
  getCodexSessionIndex,
  getConversationGenerationDrafts,
  getDailyConversationReviewByKey,
  getDailyReviewReplacementDrafts,
  getFolders,
  getItems,
  getJournalEntries,
  getKnowledgeLinks,
  getMemoryCards,
  getMemoryDocument,
  getMemoryPatchDrafts,
  getRollingWorkReviewByDate,
  getRollingWorkReviews,
  getSummaryReports,
  getTodayDashboardData,
  markItemOpened,
  replaceConversationSessionIndex,
  restoreCoreBackup,
  saveAutoWorkReviewSettings,
  type DaymarkCoreBackupCounts,
  type DaymarkCoreBackupV1,
  updateCodexDailyReview,
  updateDailyReviewReplacementDraft,
  updateFolder,
  updateItem,
  updateJournalEntry,
  updateMemoryCard,
  updateMemoryDocument,
  updateMemoryPatchDraft,
  upsertConversationGenerationDraft,
  upsertDailyConversationReview,
  upsertSummaryReport,
} from "./data/itemStore";
import { loadAiSettingsWithSecrets, saveAiSettingsWithSecrets } from "./lib/aiSecrets";
import { runAutoWorkReviewOnce } from "./lib/autoWorkReview";
import { flattenFolderOptions, getFolderAndDescendantIds } from "./lib/folders";
import { applyThemeMode, bindSystemThemeListener } from "./lib/theme";
import { getSafeErrorMessage } from "./lib/redaction";
import { markOnboardingCompleted, shouldShowOnboarding } from "./lib/onboarding";
import { shouldOpenFirstRunGuide } from "./lib/startup";
import {
  DEMO_LIBRARY_ROOT_ID,
  getDemoLibraryState,
  initializeDemoLibraryForFirstRun,
  installDemoLibrary,
  removeDemoLibrary,
  type DemoLibraryState,
} from "./data/demoLibrary";
import { ATTENTION_READING_STATUSES, getAttentionPriority, isAttentionItem } from "./lib/libraryViews";
import {
  extractLocalFileText,
  extractLocalImageData,
  getQuickCaptureRuntimeState,
  getSupportedVisionTypes,
  isDesktopRuntime,
} from "./lib/desktop";
import type {
  ActiveView,
  AiAction,
  AiRunDisplayState,
  AiRunReceipt,
  AiSettings,
  AiActionContext,
  AutoWorkReviewSettings,
  CodexDailyReview,
  CodexReviewInput,
  CodexSessionIndex,
  ConversationGenerationDraft,
  ConversationSessionIndex,
  DailyConversationReview,
  DailyReviewReplacementDraft,
  EntityKind,
  FolderNode,
  FileTextExtractResult,
  Item,
  ItemType,
  JournalEntry,
  KnowledgeLink,
  MemoryCard,
  MemoryDocument,
  MemoryPatchDraft,
  MemorySubView,
  ProcessStatus,
  ReadingStatus,
  ResizableLayoutState,
  RollingWorkReview,
  SearchResult,
  SmartView,
  SummaryReport,
  TodayDashboardData,
} from "./types";
import { PROCESS_STATUSES, READING_STATUSES } from "./types";

type StatusFilter = ProcessStatus | "all";
type ListView = { kind: "smart"; id: SmartView } | { kind: "folder"; folderId: string };
type SummaryPrompt = {
  id: string;
  periodType: "day" | "week" | "month";
  periodStart: string;
  periodEnd: string;
  label: string;
};

type MemoryDocumentSaveOptions = {
  baselineContent: string;
  baselineUpdatedAt?: string;
};

type MemoryPatchApplyOptions = {
  allowStale?: boolean;
  confirmedDocumentUpdatedAt?: string;
  confirmedDocumentContent?: string;
};

const QUICK_CAPTURE_DIRTY_KEY = "personal-knowledge-base:quick-capture-dirty:v1";

const hasQuickCaptureDirtyFlag = () => {
  try {
    return Boolean(window.localStorage.getItem(QUICK_CAPTURE_DIRTY_KEY));
  } catch {
    return false;
  }
};

const clearQuickCaptureDirtyFlag = () => {
  try {
    window.localStorage.removeItem(QUICK_CAPTURE_DIRTY_KEY);
  } catch {
    // Best effort; the next focus can refresh again.
  }
};

const normalizeUniqueSource = (value?: string) => {
  let normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized) return "";
  if (/^[a-z]:[\\/]/.test(normalized)) {
    normalized = normalized.replace(/\//g, "\\");
    return normalized.length > 3 ? normalized.replace(/\\+$/, "") : normalized;
  }
  return normalized.replace(/\/+$/, "");
};

const normalizeUniqueContent = (value?: string) => {
  const normalized = value?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
  return normalized.length >= 24 ? normalized : "";
};

const findExistingImportedItem = (items: Item[], input: { filePath?: string; sourceUrl?: string; content?: string }) => {
  const filePath = normalizeUniqueSource(input.filePath);
  const sourceUrl = normalizeUniqueSource(input.sourceUrl);
  const content = !filePath && !sourceUrl ? normalizeUniqueContent(input.content) : "";
  if (!filePath && !sourceUrl && !content) return undefined;

  return items.find((item) => {
    if (filePath && normalizeUniqueSource(item.filePath) === filePath) return true;
    if (sourceUrl && normalizeUniqueSource(item.sourceUrl) === sourceUrl) return true;
    if (content && normalizeUniqueContent(item.content) === content) return true;
    return false;
  });
};

const getAiActionLabel = (action: AiAction) => {
  if (action === "summarize") return "总结";
  if (action === "title") return "生成标题";
  if (action === "tags") return "建议标签";
  return "提取待办";
};

const PROCESS_INBOX = PROCESS_STATUSES[0];
const PROCESS_TO_ORGANIZE = PROCESS_STATUSES[1];
const READING_NOT_NEEDED = READING_STATUSES[0];
const READING_TO_READ = READING_STATUSES[1];
const LAYOUT_STORAGE_KEY = "personal-knowledge-base:layout:v11";
const ITEM_EDITOR_DRAFT_STORAGE_KEY = "personal-knowledge-base:item-editor-draft:v1";
const DEFAULT_LAYOUT_STATE: ResizableLayoutState = {
  sidebarWidth: 204,
  sidebarCollapsed: false,
  libraryDirectoryWidth: 248,
  libraryListWidth: 640,
  libraryListCollapsed: false,
  libraryDirectoryCollapsed: false,
};

async function seedDemoDataInDevIfEnabled() {
  if (!import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEMO_SEED !== "true") return;

  const demoSeedModulePath = "/src/data/demoSeed.ts";
  const seedModule = await import(/* @vite-ignore */ demoSeedModulePath) as {
    seedDemoDataIfEmpty: () => Promise<void>;
  };
  await seedModule.seedDemoDataIfEmpty();
}

type PendingConfirm = {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  closeBeforeRun?: boolean;
  onCancel?: () => void;
  onConfirm: () => Promise<void>;
};

type FolderPromptState =
  | { mode: "create"; parentId?: string }
  | { mode: "rename"; folder: FolderNode };

type ItemEditorDraftSnapshot = {
  itemId: string;
  draft: Item;
  tagText: string;
  updatedAt: string;
};

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeLayoutState(input: Partial<ResizableLayoutState>): ResizableLayoutState {
  return {
    sidebarWidth: clampNumber(input.sidebarWidth ?? DEFAULT_LAYOUT_STATE.sidebarWidth, 176, 232),
    sidebarCollapsed: Boolean(input.sidebarCollapsed ?? DEFAULT_LAYOUT_STATE.sidebarCollapsed),
    libraryDirectoryWidth: clampNumber(
      input.libraryDirectoryWidth ?? DEFAULT_LAYOUT_STATE.libraryDirectoryWidth,
      220,
      320,
    ),
    libraryListWidth: clampNumber(input.libraryListWidth ?? DEFAULT_LAYOUT_STATE.libraryListWidth, 560, 860),
    libraryListCollapsed: Boolean(input.libraryListCollapsed ?? DEFAULT_LAYOUT_STATE.libraryListCollapsed),
    libraryDirectoryCollapsed: Boolean(
      input.libraryDirectoryCollapsed ?? DEFAULT_LAYOUT_STATE.libraryDirectoryCollapsed,
    ),
  };
}

function loadLayoutState(): ResizableLayoutState {
  if (typeof window === "undefined") return DEFAULT_LAYOUT_STATE;

  try {
    const stored = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    return stored ? normalizeLayoutState(JSON.parse(stored) as Partial<ResizableLayoutState>) : DEFAULT_LAYOUT_STATE;
  } catch {
    return DEFAULT_LAYOUT_STATE;
  }
}

function parseTags(value: string) {
  const tags = value
    .split(/[,，、\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean);

  return Array.from(new Set(tags));
}

function sanitizeItemDraft(item: Item, tagText: string): Partial<Item> {
  return {
    title: item.title.trim() || "未命名资料",
    type: item.type,
    processStatus: item.processStatus,
    readingStatus: item.readingStatus,
    folderId: item.folderId,
    tags: parseTags(tagText),
    content: item.content.trim(),
    filePath: item.filePath?.trim() || undefined,
    sourceUrl: item.sourceUrl?.trim() || undefined,
    aiSummary: item.aiSummary.trim() || "尚未生成 AI 摘要",
    todos: item.todos ?? [],
    lastAiRunAt: item.lastAiRunAt,
    lastOpenedAt: item.lastOpenedAt,
    favorite: item.favorite,
  };
}

function readItemEditorDraft(itemId: string): ItemEditorDraftSnapshot | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = window.localStorage.getItem(ITEM_EDITOR_DRAFT_STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<ItemEditorDraftSnapshot>;
    if (parsed.itemId !== itemId || !parsed.draft || parsed.draft.id !== itemId) return null;
    return {
      itemId,
      draft: parsed.draft,
      tagText: typeof parsed.tagText === "string" ? parsed.tagText : parsed.draft.tags?.join("，") ?? "",
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    };
  } catch {
    return null;
  }
}

function writeItemEditorDraft(itemId: string, draft: Item, tagText: string) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      ITEM_EDITOR_DRAFT_STORAGE_KEY,
      JSON.stringify({
        itemId,
        draft,
        tagText,
        updatedAt: new Date().toISOString(),
      } satisfies ItemEditorDraftSnapshot),
    );
  } catch {
    // Draft recovery is best-effort; the normal save path remains the source of truth.
  }
}

function clearItemEditorDraft(itemId?: string) {
  if (typeof window === "undefined") return;

  try {
    if (!itemId) {
      window.localStorage.removeItem(ITEM_EDITOR_DRAFT_STORAGE_KEY);
      return;
    }
    const stored = window.localStorage.getItem(ITEM_EDITOR_DRAFT_STORAGE_KEY);
    if (!stored) return;
    const parsed = JSON.parse(stored) as Partial<ItemEditorDraftSnapshot>;
    if (parsed.itemId === itemId) {
      window.localStorage.removeItem(ITEM_EDITOR_DRAFT_STORAGE_KEY);
    }
  } catch {
    // Ignore cleanup failures.
  }
}

function itemEditorDraftChanged(snapshot: ItemEditorDraftSnapshot, sourceItem: Item) {
  return (
    JSON.stringify(sanitizeItemDraft(snapshot.draft, snapshot.tagText)) !==
    JSON.stringify(sanitizeItemDraft(sourceItem, sourceItem.tags.join("，")))
  );
}

function createAiPatch(item: Item, result: AiActionResult): Partial<Item> {
  if (result.action === "summarize") {
    return { aiSummary: result.aiSummary };
  }

  if (result.action === "title") {
    return { title: result.title || item.title };
  }

  if (result.action === "tags") {
    return {
      tags: Array.from(new Set([...item.tags, ...result.tags])).filter(Boolean),
    };
  }

  return { todos: result.todos };
}

function getFileExtension(path: string) {
  const fileName = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  const match = fileName.match(/\.([^.]+)$/);
  return match?.[1]?.toLowerCase() ?? "";
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

function isUsableFileExtraction(extracted: FileTextExtractResult) {
  const usableChars = extracted.sentChars ?? extracted.charCount;
  if (extracted.quality !== "ok") {
    throw new Error(buildFileExtractionError(extracted));
  }

  if (!extracted.text.trim() || usableChars < 200) {
    throw new Error(buildFileExtractionError({ ...extracted, quality: usableChars === 0 ? "empty" : "low" }));
  }

  return true;
}

function formatFileExtractionStatus(extracted: FileTextExtractResult) {
  const parts = [
    `已读取文件正文：${extracted.fileName}`,
    `提取 ${extracted.extractedChars.toLocaleString("zh-CN")} 字符`,
    `实际发送 ${extracted.sentChars.toLocaleString("zh-CN")} 字符`,
    extracted.truncated ? "已截断" : "未截断",
    extracted.redacted ? "已脱敏" : "",
    extracted.warnings.length > 0 ? `提醒：${extracted.warnings.map(trimSentenceEnd).join("；")}` : "",
  ].filter(Boolean).map(trimSentenceEnd);

  return parts.join("，");
}

function trimSentenceEnd(value: string) {
  return value.replace(/[。；;\s]+$/g, "");
}

function countCharacters(value: string) {
  return Array.from(value).length;
}

function formatCoreBackupCounts(counts: DaymarkCoreBackupCounts) {
  return [
    `${counts.items} 条资料`,
    `${counts.folders} 个目录`,
    `${counts.journalEntries} 篇日记`,
    `${counts.memoryDocument} 份记忆文档`,
    `${counts.memoryCards} 张记忆卡片`,
    `${counts.links} 个链接`,
  ].join(" / ");
}

function hasRedactionWarning(warnings: string[]) {
  return warnings.some((warning) => /脱敏|密钥|token|凭据|key/i.test(warning));
}

function buildFileExtractionError(extracted: FileTextExtractResult) {
  const status =
    extracted.quality === "empty"
      ? "没有提取到可用于 AI 的正文"
      : extracted.quality === "unsupported"
        ? "暂不支持这种文件内容提取"
        : "提取到的正文过短，可信度不足";
  const details = [
    `文件读取已停止：${status}`,
    `文件：${extracted.fileName}`,
    `提取字符数：${extracted.extractedChars ?? extracted.charCount}`,
    `发送字符数：${extracted.sentChars ?? extracted.charCount}`,
    extracted.preview ? `提取预览：${extracted.preview}` : "",
    extracted.warnings.length > 0 ? `提醒：${extracted.warnings.join("；")}` : "",
    "低质量内容没有发送给 AI，请换一个可读取的文本文件。",
  ].filter(Boolean);

  return details.join("\n");
}

function getFilteredItems(
  allItems: Item[],
  activeView: ActiveView,
  statusFilter: StatusFilter,
  query: string,
  activeFolderIds?: ReadonlySet<string>,
) {
  const normalizedQuery = query.trim().toLowerCase();

  return allItems
    .filter((item) => {
      const viewMatch =
        activeView.kind === "folder"
          ? Boolean(item.folderId && activeFolderIds?.has(item.folderId))
          : activeView.kind === "smart"
            ? matchSmartView(item, activeView.id)
            : true;

      if (!viewMatch) return false;
      if (statusFilter !== "all" && item.processStatus !== statusFilter) return false;
      if (!normalizedQuery) return true;

      return [item.title, item.content, item.aiSummary, item.filePath, item.sourceUrl, ...item.tags]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    })
    .sort((a, b) => {
      if (activeView.kind === "smart" && activeView.id === "attention") {
        return getAttentionPriority(a) - getAttentionPriority(b) || b.updatedAt.localeCompare(a.updatedAt);
      }

      if (activeView.kind === "smart" && activeView.id === "recent") {
        return (b.lastOpenedAt ?? b.updatedAt).localeCompare(a.lastOpenedAt ?? a.updatedAt);
      }

      return b.updatedAt.localeCompare(a.updatedAt);
    });
}

function matchSmartView(item: Item, view: SmartView) {
  if (view === "attention") return isAttentionItem(item);
  if (view === "inbox") return item.processStatus === PROCESS_INBOX;
  if (view === "unfiled") return !item.folderId;
  if (view === "favorite") return item.favorite;
  if (view === "reading") return ATTENTION_READING_STATUSES.includes(item.readingStatus);
  return true;
}

export default function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [summaryReports, setSummaryReports] = useState<SummaryReport[]>([]);
  const [memoryCards, setMemoryCards] = useState<MemoryCard[]>([]);
  const [memoryDocument, setMemoryDocument] = useState<MemoryDocument | null>(null);
  const [memoryPatchDrafts, setMemoryPatchDrafts] = useState<MemoryPatchDraft[]>([]);
  const [codexReviews, setCodexReviews] = useState<CodexDailyReview[]>([]);
  const [codexSessionIndex, setCodexSessionIndex] = useState<CodexSessionIndex[]>([]);
  const [dailyReviewDrafts, setDailyReviewDrafts] = useState<DailyReviewReplacementDraft[]>([]);
  const [conversationGenerationDrafts, setConversationGenerationDrafts] = useState<ConversationGenerationDraft[]>([]);
  const [links, setLinks] = useState<KnowledgeLink[]>([]);
  const [todayDashboard, setTodayDashboard] = useState<TodayDashboardData | null>(null);
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [autoWorkReviewSettings, setAutoWorkReviewSettings] = useState<AutoWorkReviewSettings | null>(null);
  const [rollingWorkReview, setRollingWorkReview] = useState<RollingWorkReview | null>(null);
  const [rollingWorkReviews, setRollingWorkReviews] = useState<RollingWorkReview[]>([]);
  const [autoWorkReviewRunning, setAutoWorkReviewRunning] = useState(false);
  const [autoWorkReviewProgress, setAutoWorkReviewProgress] = useState<CodexReviewProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState<ActiveView>({ kind: "today" });
  const [lastListView, setLastListView] = useState<ListView>({ kind: "smart", id: "attention" });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<Item | null>(null);
  const [tagText, setTagText] = useState("");
  const [aiRunningAction, setAiRunningAction] = useState<AiAction | null>(null);
  const [aiRunState, setAiRunState] = useState<AiRunDisplayState | null>(null);
  const [summaryRunning, setSummaryRunning] = useState("");
  const summaryRunningRef = useRef("");
  const [summaryMessage, setSummaryMessage] = useState("");
  const [extractOpen, setExtractOpen] = useState(false);
  const [extractLoading, setExtractLoading] = useState(false);
  const [extractDraft, setExtractDraft] = useState<ExtractDraft | null>(null);
  const [extractMessage, setExtractMessage] = useState("");
  const [extractSourceId, setExtractSourceId] = useState("");
  const [error, setError] = useState("");
  const [quickCaptureNotice, setQuickCaptureNotice] = useState("");
  const [searchRefreshKey, setSearchRefreshKey] = useState(0);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [folderPrompt, setFolderPrompt] = useState<FolderPromptState | null>(null);
  const [firstRunGuideOpen, setFirstRunGuideOpen] = useState(false);
  const [startupComplete, setStartupComplete] = useState(false);
  const [demoLibraryState, setDemoLibraryState] = useState<DemoLibraryState>({ installed: false, itemCount: 0, folderCount: 0 });
  const [firstRunGuideAutoPending, setFirstRunGuideAutoPending] = useState(() => shouldShowOnboarding());
  const [todayComposerFocusRequest, setTodayComposerFocusRequest] = useState(0);
  const [layout, setLayout] = useState<ResizableLayoutState>(() => loadLayoutState());
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const quickCaptureNoticeTimerRef = useRef<number | undefined>(undefined);
  const quickCaptureDirtyRef = useRef(false);
  const quickCaptureRefreshSeqRef = useRef(0);
  const quickCaptureLastNoticeRef = useRef("");
  const quickCaptureLastNoticeAtRef = useRef(0);
  const libraryRefreshSeqRef = useRef(0);
  const journalRefreshSeqRef = useRef(0);
  const memoryRefreshSeqRef = useRef(0);
  const todayDashboardSeqRef = useRef(0);
  const memorySharedSeqRef = useRef(0);
  const extractSaveRef = useRef(false);
  const extractRequestSeqRef = useRef(0);
  const extractAbortRef = useRef<AbortController | null>(null);
  const aiActionAbortRef = useRef<AbortController | null>(null);
  const reviewGenerationRunningRef = useRef(new Set<string>());
  const autoWorkReviewRunningRef = useRef(false);
  const settingsRef = useRef<AiSettings | null>(null);
  const autoWorkReviewSettingsRef = useRef<AutoWorkReviewSettings | null>(null);

  const aiConfigured = Boolean(settings && getEffectiveAiSettings(settings).keySource !== "missing");

  const closeFirstRunGuide = useCallback(() => {
    markOnboardingCompleted();
    setFirstRunGuideAutoPending(false);
    setFirstRunGuideOpen(false);
  }, []);

  const handleStartupComplete = useCallback(() => {
    setStartupComplete(true);
  }, []);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    autoWorkReviewSettingsRef.current = autoWorkReviewSettings;
  }, [autoWorkReviewSettings]);

  useEffect(() => {
    if (!shouldOpenFirstRunGuide({ loading, startupComplete, pending: firstRunGuideAutoPending })) return;
    setFirstRunGuideAutoPending(false);
    setFirstRunGuideOpen(true);
  }, [firstRunGuideAutoPending, loading, startupComplete]);

  const nextTodayDashboardSeq = () => {
    todayDashboardSeqRef.current += 1;
    return todayDashboardSeqRef.current;
  };

  const applyTodayDashboardIfCurrent = (seq: number, dashboard: TodayDashboardData) => {
    if (todayDashboardSeqRef.current === seq) {
      setTodayDashboard(dashboard);
    }
  };

  const nextMemorySharedSeq = () => {
    memorySharedSeqRef.current += 1;
    return memorySharedSeqRef.current;
  };

  const applyMemorySharedDataIfCurrent = (
    seq: number,
    data: {
      loadedMemories: MemoryCard[];
      loadedMemoryDocument: MemoryDocument | null;
      loadedMemoryPatchDrafts: MemoryPatchDraft[];
      loadedCodexReviews: DailyConversationReview[];
      loadedCodexSessionIndex: ConversationSessionIndex[];
      loadedDailyReviewDrafts: DailyReviewReplacementDraft[];
      loadedConversationGenerationDrafts: ConversationGenerationDraft[];
    },
  ) => {
    if (memorySharedSeqRef.current !== seq) return;
    setMemoryCards(data.loadedMemories);
    setMemoryDocument(data.loadedMemoryDocument);
    setMemoryPatchDrafts(data.loadedMemoryPatchDrafts);
    setCodexReviews(data.loadedCodexReviews);
    setCodexSessionIndex(data.loadedCodexSessionIndex);
    setDailyReviewDrafts(data.loadedDailyReviewDrafts);
    setConversationGenerationDrafts(data.loadedConversationGenerationDrafts);
  };

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      try {
        await seedDemoDataInDevIfEnabled();
        await initializeDemoLibraryForFirstRun();
        const dashboardSeq = nextTodayDashboardSeq();
        const memorySharedSeq = nextMemorySharedSeq();
        const todayKey = toDateKey(new Date());
        const [
          loadedItems,
          loadedFolders,
          loadedSettingsResult,
          loadedAutoWorkReviewSettings,
          loadedRollingWorkReviews,
          loadedJournal,
          loadedReports,
          loadedMemories,
          loadedMemoryDocument,
          loadedMemoryPatchDrafts,
          loadedCodexReviews,
          loadedCodexSessionIndex,
          loadedDailyReviewDrafts,
          loadedConversationGenerationDrafts,
          loadedLinks,
          loadedDashboard,
        ] =
          await Promise.all([
            getItems(),
            getFolders(),
            loadAiSettingsWithSecrets(),
            getAutoWorkReviewSettings(),
            getRollingWorkReviews(),
            getJournalEntries(),
            getSummaryReports(),
            getMemoryCards(),
            getMemoryDocument(),
            getMemoryPatchDrafts(),
            getCodexDailyReviews(),
            getCodexSessionIndex(),
            getDailyReviewReplacementDrafts(),
            getConversationGenerationDrafts(),
            getKnowledgeLinks(),
            getTodayDashboardData(),
          ]);

        if (!mounted) return;
        setItems(loadedItems);
        setFolders(loadedFolders);
        setDemoLibraryState(await getDemoLibraryState());
        setSettings(loadedSettingsResult.settings);
        setAutoWorkReviewSettings(loadedAutoWorkReviewSettings);
        setRollingWorkReviews(loadedRollingWorkReviews);
        setRollingWorkReview(loadedRollingWorkReviews.find((review) => review.date === todayKey) ?? null);
        applyThemeMode(loadedSettingsResult.settings.themeMode);
        if (loadedSettingsResult.notice) setError(loadedSettingsResult.notice);
        setJournalEntries(loadedJournal);
        setSummaryReports(loadedReports);
        applyMemorySharedDataIfCurrent(memorySharedSeq, {
          loadedMemories,
          loadedMemoryDocument,
          loadedMemoryPatchDrafts,
          loadedCodexReviews,
          loadedCodexSessionIndex,
          loadedDailyReviewDrafts,
          loadedConversationGenerationDrafts,
        });
        setLinks(loadedLinks);
        applyTodayDashboardIfCurrent(dashboardSeq, loadedDashboard);
        setSelectedId("");
      } catch (loadError) {
        if (!mounted) return;
        setError(getSafeErrorMessage(loadError, "加载数据失败。"));
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    return bindSystemThemeListener(() => settings?.themeMode ?? "dark");
  }, [settings?.themeMode]);

  useEffect(() => {
    summaryRunningRef.current = summaryRunning;
  }, [summaryRunning]);

  useEffect(() => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  }, [layout]);

  const activeFolderIds = useMemo(
    () =>
      activeView.kind === "folder"
        ? new Set(getFolderAndDescendantIds(folders, activeView.folderId))
        : undefined,
    [activeView, folders],
  );
  const filteredItems = useMemo(
    () => getFilteredItems(items, activeView, statusFilter, query, activeFolderIds),
    [activeFolderIds, activeView, items, query, statusFilter],
  );

  const selectedItem =
    activeView.kind === "item"
      ? items.find((item) => item.id === activeView.itemId)
      : activeView.kind === "smart" || activeView.kind === "folder"
        ? items.find((item) => item.id === selectedId)
        : undefined;
  const editorDirty = useMemo(() => {
    if (!isEditing || !draft || !selectedItem) return false;
    const draftValue = sanitizeItemDraft(draft, tagText);
    const savedValue = sanitizeItemDraft(selectedItem, selectedItem.tags.join("，"));
    return JSON.stringify(draftValue) !== JSON.stringify(savedValue);
  }, [draft, isEditing, selectedItem, tagText]);

  useEffect(() => {
    if (!isEditing || !draft) return;
    if (editorDirty) {
      writeItemEditorDraft(draft.id, draft, tagText);
    } else {
      clearItemEditorDraft(draft.id);
    }
  }, [draft, editorDirty, isEditing, tagText]);

  const summaryPrompts = useMemo(() => getMissingSummaryPrompts(summaryReports), [summaryReports]);

  useEffect(() => {
    if (
      activeView.kind === "item" ||
      activeView.kind === "settings" ||
      activeView.kind === "journal" ||
      activeView.kind === "memory" ||
      activeView.kind === "today" ||
      activeView.kind === "search"
    ) {
      return;
    }
    if (selectedId && !filteredItems.some((item) => item.id === selectedId)) {
      setSelectedId("");
    }
  }, [activeView, filteredItems, selectedId]);

  useEffect(() => {
    if (!workspaceRef.current) return;

    animate(workspaceRef.current, {
      opacity: [0.78, 1],
      duration: 220,
      easing: "outQuad",
    });
  }, [activeView, selectedItem?.id]);

  const refreshLibraryData = async (nextSelectedId?: string) => {
    const refreshSeq = libraryRefreshSeqRef.current + 1;
    libraryRefreshSeqRef.current = refreshSeq;
    const dashboardSeq = nextTodayDashboardSeq();
    const [loadedItems, loadedFolders, loadedDashboard] = await Promise.all([
      getItems(),
      getFolders(),
      getTodayDashboardData(),
    ]);
    if (libraryRefreshSeqRef.current !== refreshSeq) return;
    setItems(loadedItems);
    setFolders(loadedFolders);
    applyTodayDashboardIfCurrent(dashboardSeq, loadedDashboard);
    setSelectedId((current) => {
      if (nextSelectedId) return nextSelectedId;
      if (loadedItems.some((item) => item.id === current)) return current;
      return loadedItems[0]?.id ?? "";
    });
    setSearchRefreshKey((key) => key + 1);
  };

  const refreshJournalData = async () => {
    const refreshSeq = journalRefreshSeqRef.current + 1;
    journalRefreshSeqRef.current = refreshSeq;
    const dashboardSeq = nextTodayDashboardSeq();
    const memorySharedSeq = nextMemorySharedSeq();
    const [
      loadedJournal,
      loadedReports,
      loadedMemories,
      loadedMemoryDocument,
      loadedMemoryPatchDrafts,
      loadedCodexReviews,
      loadedCodexSessionIndex,
      loadedDailyReviewDrafts,
      loadedConversationGenerationDrafts,
      loadedDashboard,
    ] = await Promise.all([
      getJournalEntries(),
      getSummaryReports(),
      getMemoryCards(),
      getMemoryDocument(),
      getMemoryPatchDrafts(),
      getCodexDailyReviews(),
      getCodexSessionIndex(),
      getDailyReviewReplacementDrafts(),
      getConversationGenerationDrafts(),
      getTodayDashboardData(),
    ]);
    if (journalRefreshSeqRef.current !== refreshSeq) return;
    setJournalEntries(loadedJournal);
    setSummaryReports(loadedReports);
    applyMemorySharedDataIfCurrent(memorySharedSeq, {
      loadedMemories,
      loadedMemoryDocument,
      loadedMemoryPatchDrafts,
      loadedCodexReviews,
      loadedCodexSessionIndex,
      loadedDailyReviewDrafts,
      loadedConversationGenerationDrafts,
    });
    applyTodayDashboardIfCurrent(dashboardSeq, loadedDashboard);
    setSearchRefreshKey((key) => key + 1);
  };

  useEffect(() => {
    if (!isDesktopRuntime()) return undefined;

    let disposed = false;
    let unlistenSaved: (() => void) | undefined;
    let unlistenDegraded: (() => void) | undefined;
    let refreshRetryTimer: number | undefined;
    const refreshFromQuickCapture = (retry = true) => {
      const refreshSeq = quickCaptureRefreshSeqRef.current + 1;
      quickCaptureRefreshSeqRef.current = refreshSeq;
      void refreshJournalData()
        .then(() => {
          if (quickCaptureRefreshSeqRef.current !== refreshSeq) return;
          quickCaptureDirtyRef.current = false;
          clearQuickCaptureDirtyFlag();
        })
        .catch(() => {
          quickCaptureDirtyRef.current = true;
          if (!retry || disposed) return;
          showNotice("快速记录已保存，但主窗口暂时没刷新；我会再试一次。");
          window.clearTimeout(refreshRetryTimer);
          refreshRetryTimer = window.setTimeout(() => refreshFromQuickCapture(false), 1_400);
        });
    };

    void listen("quick-capture:saved", () => {
      quickCaptureDirtyRef.current = true;
      refreshFromQuickCapture();
    }).then((handler) => {
      if (disposed) {
        handler();
        return;
      }
      unlistenSaved = handler;
    }).catch(() => undefined);
    const showNotice = (message: string) => {
      const now = Date.now();
      if (quickCaptureLastNoticeRef.current === message && now - quickCaptureLastNoticeAtRef.current < 12_000) {
        return;
      }
      quickCaptureLastNoticeRef.current = message;
      quickCaptureLastNoticeAtRef.current = now;
      window.clearTimeout(quickCaptureNoticeTimerRef.current);
      setQuickCaptureNotice(message);
      quickCaptureNoticeTimerRef.current = window.setTimeout(() => setQuickCaptureNotice(""), 5200);
    };

    void listen<string>("quick-capture:degraded", (event) => {
      showNotice(event.payload || "顶部悬浮暂时休息，快捷键和托盘还能继续记录。");
    }).then((handler) => {
      if (disposed) {
        handler();
        return;
      }
      unlistenDegraded = handler;
    }).catch(() => undefined);

    const showRuntimeNotice = (runtime: Awaited<ReturnType<typeof getQuickCaptureRuntimeState>>) => {
      if (!runtime?.degraded && runtime?.shortcutAvailable !== false) return;
      if (runtime.shortcutAvailable === false) {
        showNotice("快捷键可能被占用，仍可以从托盘打开快速记录。");
        return;
      }
      showNotice(runtime.degradedReason || "顶部悬浮暂时不可用，仍可用 Ctrl + Shift + Space 或托盘里的快速记录。");
    };

    const refreshAfterReturn = () => {
      if (document.visibilityState === "visible") {
        if (quickCaptureDirtyRef.current || hasQuickCaptureDirtyFlag()) {
          refreshFromQuickCapture();
        }
        void getQuickCaptureRuntimeState()
          .then(showRuntimeNotice)
          .catch(() => undefined);
      }
    };

    window.addEventListener("focus", refreshAfterReturn);
    document.addEventListener("visibilitychange", refreshAfterReturn);
    void getQuickCaptureRuntimeState().then(showRuntimeNotice).catch(() => undefined);

    return () => {
      disposed = true;
      unlistenSaved?.();
      unlistenDegraded?.();
      window.clearTimeout(quickCaptureNoticeTimerRef.current);
      window.clearTimeout(refreshRetryTimer);
      window.removeEventListener("focus", refreshAfterReturn);
      document.removeEventListener("visibilitychange", refreshAfterReturn);
    };
  }, []);

  const refreshMemoryData = async () => {
    const refreshSeq = memoryRefreshSeqRef.current + 1;
    memoryRefreshSeqRef.current = refreshSeq;
    const dashboardSeq = nextTodayDashboardSeq();
    const memorySharedSeq = nextMemorySharedSeq();
    const [
      loadedMemories,
      loadedMemoryDocument,
      loadedMemoryPatchDrafts,
      loadedCodexReviews,
      loadedCodexSessionIndex,
      loadedDailyReviewDrafts,
      loadedConversationGenerationDrafts,
      loadedDashboard,
    ] =
      await Promise.all([
        getMemoryCards(),
        getMemoryDocument(),
        getMemoryPatchDrafts(),
        getCodexDailyReviews(),
        getCodexSessionIndex(),
        getDailyReviewReplacementDrafts(),
        getConversationGenerationDrafts(),
        getTodayDashboardData(),
      ]);
    if (memoryRefreshSeqRef.current !== refreshSeq) return;
    applyMemorySharedDataIfCurrent(memorySharedSeq, {
      loadedMemories,
      loadedMemoryDocument,
      loadedMemoryPatchDrafts,
      loadedCodexReviews,
      loadedCodexSessionIndex,
      loadedDailyReviewDrafts,
      loadedConversationGenerationDrafts,
    });
    applyTodayDashboardIfCurrent(dashboardSeq, loadedDashboard);
    setSearchRefreshKey((key) => key + 1);
  };

  const refreshLinks = async () => {
    setLinks(await getKnowledgeLinks());
    setSearchRefreshKey((key) => key + 1);
  };

  const refreshAutoWorkReviewData = async () => {
    const todayKey = toDateKey(new Date());
    const [loadedAutoSettings, loadedRollingReviews] = await Promise.all([
      getAutoWorkReviewSettings(),
      getRollingWorkReviews(),
    ]);
    setAutoWorkReviewSettings(loadedAutoSettings);
    setRollingWorkReviews(loadedRollingReviews);
    setRollingWorkReview(loadedRollingReviews.find((review) => review.date === todayKey) ?? null);
  };

  const handleSaveAutoWorkReviewSettings = async (patch: Partial<AutoWorkReviewSettings>) => {
    const saved = await saveAutoWorkReviewSettings(patch);
    setAutoWorkReviewSettings(saved);
    if (!saved.enabled) {
      setAutoWorkReviewProgress(null);
    }
    return saved;
  };

  const handleRunAutoWorkReview = useCallback(async () => {
    const currentAutoSettings = autoWorkReviewSettingsRef.current;
    if (!currentAutoSettings || autoWorkReviewRunningRef.current) return;
    autoWorkReviewRunningRef.current = true;
    setAutoWorkReviewRunning(true);
    setAutoWorkReviewProgress(null);
    try {
      const result = await runAutoWorkReviewOnce({
        settings: settingsRef.current,
        autoSettings: currentAutoSettings,
        onProgress: setAutoWorkReviewProgress,
      });
      await refreshAutoWorkReviewData();
      if (result.review) {
        setRollingWorkReview(result.review);
      }
      if (result.status === "error") {
        setError(result.message);
      }
      return result;
    } finally {
      autoWorkReviewRunningRef.current = false;
      setAutoWorkReviewRunning(false);
    }
  }, []);

  const handleArchiveRollingWorkReview = async (date: string) => {
    const result = await archiveRollingWorkReview(date);
    const [loadedRollingReviews, loadedCodexReviews] = await Promise.all([
      getRollingWorkReviews(),
      getCodexDailyReviews(),
    ]);
    const todayKey = toDateKey(new Date());
    setRollingWorkReviews(loadedRollingReviews);
    setRollingWorkReview(loadedRollingReviews.find((review) => review.date === todayKey) ?? null);
    setCodexReviews(loadedCodexReviews);
    setSearchRefreshKey((key) => key + 1);
    return result;
  };

  useEffect(() => {
    if (loading || !settings || !autoWorkReviewSettings?.enabled || !isDesktopRuntime()) return undefined;
    let disposed = false;
    const runIfActive = () => {
      if (disposed || autoWorkReviewRunningRef.current) return;
      void handleRunAutoWorkReview();
    };
    const firstRunTimer = window.setTimeout(runIfActive, 60_000);
    const intervalTimer = window.setInterval(runIfActive, autoWorkReviewSettings.intervalMinutes * 60_000);
    return () => {
      disposed = true;
      window.clearTimeout(firstRunTimer);
      window.clearInterval(intervalTimer);
    };
  }, [
    autoWorkReviewSettings?.enabled,
    autoWorkReviewSettings?.intervalMinutes,
    autoWorkReviewSettings?.sourceKinds.join("|"),
    handleRunAutoWorkReview,
    loading,
    settings,
  ]);

  const refreshCoreBackupData = async () => {
    const dashboardSeq = nextTodayDashboardSeq();
    const memorySharedSeq = nextMemorySharedSeq();
    const [
      loadedItems,
      loadedFolders,
      loadedJournal,
      loadedMemories,
      loadedMemoryDocument,
      loadedLinks,
      loadedDashboard,
    ] = await Promise.all([
      getItems(),
      getFolders(),
      getJournalEntries(),
      getMemoryCards(),
      getMemoryDocument(),
      getKnowledgeLinks(),
      getTodayDashboardData(),
    ]);
    setItems(loadedItems);
    setFolders(loadedFolders);
    setJournalEntries(loadedJournal);
    if (memorySharedSeqRef.current === memorySharedSeq) {
      setMemoryCards(loadedMemories);
      setMemoryDocument(loadedMemoryDocument);
    }
    setLinks(loadedLinks);
    applyTodayDashboardIfCurrent(dashboardSeq, loadedDashboard);
    setSelectedId("");
    setSearchRefreshKey((key) => key + 1);
  };

  const currentFolderId = activeView.kind === "folder" ? activeView.folderId : selectedItem?.folderId;
  const libraryViewActive = activeView.kind === "smart" || activeView.kind === "folder" || activeView.kind === "item";

  const updateLayout = (patch: Partial<ResizableLayoutState>) => {
    setLayout((current) => normalizeLayoutState({ ...current, ...patch }));
  };

  const startLayoutResize =
    (
      key:
        | "sidebarWidth"
        | "libraryDirectoryWidth"
        | "libraryListWidth",
      min: number,
      max: number,
      direction = 1,
    ) =>
    (event: ReactMouseEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startValue = layout[key];

      const handleMove = (moveEvent: MouseEvent) => {
        const nextValue = clampNumber(startValue + (moveEvent.clientX - startX) * direction, min, max);
        setLayout((current) => normalizeLayoutState({ ...current, [key]: nextValue }));
      };

      const handleUp = () => {
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    };

  const resetLayout = () => {
    setLayout(DEFAULT_LAYOUT_STATE);
  };

  const blockUnsavedWorkNavigation = (nextView?: ActiveView) => {
    if (editorDirty) {
      setError("资料编辑还没有保存。请先保存，或在编辑弹窗里再次关闭以放弃修改。");
      return true;
    }
    if (activeView.kind === "settings" && nextView?.kind !== "settings" && settingsDirty) {
      setError("设置页有未保存修改。请先保存，再离开设置。");
      return true;
    }
    return false;
  };

  const blockUnsavedEditorNavigation = () => {
    if (!editorDirty) return false;
    setError("资料编辑还没有保存。请先保存，或在编辑弹窗里再次关闭以放弃修改。");
    return true;
  };

  const handleSelectView = (view: ActiveView) => {
    if (blockUnsavedWorkNavigation(view)) return false;
    if (view.kind === "memory" && !view.subView) {
      setActiveView({ kind: "memory", subView: "document" });
    } else {
      setActiveView(view);
    }
    if (view.kind === "folder" || view.kind === "smart") {
      setLastListView(view);
      setSelectedId("");
      updateLayout({ libraryListCollapsed: false });
    }
    setStatusFilter("all");
    setIsEditing(false);
    setDraft(null);
    setAiRunState(null);
    return true;
  };

  const handleOnboardingStart = (action: OnboardingStartAction) => {
    closeFirstRunGuide();

    if (action === "record") {
      const navigated = handleSelectView({ kind: "today" });
      if (navigated) {
        setTodayComposerFocusRequest((current) => current + 1);
      }
      return navigated;
    }

    if (action === "import") {
      const navigated = handleSelectView({ kind: "smart", id: "attention" });
      if (navigated) {
        setImportOpen(true);
      }
      return navigated;
    }

    return handleSelectView({ kind: "memory", subView: "ai-review" });
  };

  const handleSelectItem = async (item: Item) => {
    if (blockUnsavedEditorNavigation()) return;
    const fallbackView: ListView = item.folderId ? { kind: "folder", folderId: item.folderId } : { kind: "smart", id: "unfiled" };
    if (activeView.kind === "folder" || activeView.kind === "smart") {
      setLastListView(activeView);
    } else {
      setLastListView(fallbackView);
    }
    setActiveView({ kind: "item", itemId: item.id });
    setSelectedId(item.id);
    updateLayout({ libraryListCollapsed: true });
    setIsEditing(false);
    setDraft(null);
    setAiRunState(null);

    const now = formatTimestamp();
    setItems((currentItems) =>
      currentItems.map((currentItem) =>
        currentItem.id === item.id ? { ...currentItem, lastOpenedAt: now } : currentItem,
      ),
    );
    await markItemOpened(item.id);
  };

  const handlePreviewLibraryItem = async (item: Item) => {
    if (blockUnsavedEditorNavigation()) return;
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1279px)").matches) {
      await handleSelectItem(item);
      return;
    }

    if (activeView.kind === "folder" || activeView.kind === "smart") {
      setLastListView(activeView);
    }
    setSelectedId(item.id);
    updateLayout({ libraryListCollapsed: true });
    setIsEditing(false);
    setDraft(null);
    setAiRunState(null);

    const now = formatTimestamp();
    setItems((currentItems) =>
      currentItems.map((currentItem) =>
        currentItem.id === item.id ? { ...currentItem, lastOpenedAt: now } : currentItem,
      ),
    );
    await markItemOpened(item.id);
  };

  const handleCreateItem = () => {
    setImportOpen(true);
  };

  const handleCreateImportedItem = async (input: {
    mode: ImportMode;
    title: string;
    titleProvided: boolean;
    type: ItemType;
    folderId?: string;
    content: string;
    sourceUrl?: string;
    filePath?: string;
    tags: string[];
    readingStatus?: ReadingStatus;
  }) => {
    const existing = findExistingImportedItem(items, input);
    if (existing) {
      setError("这份资料已经存在，已为你打开原记录。");
      await handleSelectItem(existing);
      setImportOpen(false);
      return;
    }

    const title = await resolveImportedTitle(input);
    const processStatus = input.folderId ? PROCESS_TO_ORGANIZE : PROCESS_INBOX;
    const created = await createItem({
      title,
      type: input.type,
      folderId: input.folderId,
      processStatus,
      readingStatus: input.readingStatus,
      tags: input.tags.length > 0 ? input.tags : ["资料"],
      content: input.content,
      filePath: input.filePath,
      sourceUrl: input.sourceUrl,
      aiSummary: "尚未生成 AI 摘要",
    });

    await refreshLibraryData(created.id);
    setIsEditing(false);
  };

  const handleCreateImportedItems = async (drafts: ImportDraft[]) => {
    if (drafts.length === 0) return false;

    let lastCreatedId = "";
    let skippedCount = 0;
    const knownFilePaths = new Set(items.map((item) => normalizeUniqueSource(item.filePath)).filter(Boolean));
    let firstExistingItem: Item | undefined;

    for (const draftItem of drafts) {
      const filePathKey = normalizeUniqueSource(draftItem.filePath);
      if (filePathKey && knownFilePaths.has(filePathKey)) {
        firstExistingItem ??= items.find((item) => normalizeUniqueSource(item.filePath) === filePathKey);
        skippedCount += 1;
        continue;
      }

      const processStatus = draftItem.folderId ? PROCESS_TO_ORGANIZE : PROCESS_INBOX;
      const created = await createItem({
        title: draftItem.title.trim() || getPathBaseName(draftItem.filePath) || "未命名资料",
        type: draftItem.type,
        folderId: draftItem.folderId,
        processStatus,
        readingStatus: draftItem.readingStatus,
        tags: draftItem.tags.length > 0 ? draftItem.tags : ["资料"],
        content: draftItem.content,
        filePath: draftItem.filePath,
        aiSummary: "尚未生成 AI 摘要",
      });
      lastCreatedId = created.id;
      if (filePathKey) knownFilePaths.add(filePathKey);
    }

    if (!lastCreatedId && skippedCount > 0) {
      setError(`已跳过 ${skippedCount} 条重复资料，没有创建新记录。`);
      if (firstExistingItem) await handleSelectItem(firstExistingItem);
      return false;
    }

    if (!lastCreatedId && skippedCount > 0) {
      setError(`已跳过 ${skippedCount} 条重复资料。`);
      return;
    }

    const attentionView: ListView = { kind: "smart", id: "attention" };
    setLastListView(attentionView);
    setActiveView(attentionView);
    setStatusFilter("all");
    setQuery("");
    await refreshLibraryData(lastCreatedId);
    if (skippedCount > 0) {
      setError(`已导入新资料，并跳过 ${skippedCount} 条重复资料。`);
    }
    setIsEditing(false);
    return true;
  };

  const resolveImportedTitle = async (input: {
    mode: ImportMode;
    title: string;
    titleProvided: boolean;
    content: string;
  }) => {
    if (input.titleProvided || input.mode !== "card") {
      return input.title.trim() || "未命名资料";
    }

    const content = input.content.trim();
    if (content) return `摘录资料 - ${createLocalTitleFromContent(content)}`;
    if (!content) return "摘录资料";
  };

  const handleCreateFolder = async (parentId?: string) => {
    setFolderPrompt({ mode: "create", parentId });
  };

  const handleRenameFolder = async (folder: FolderNode) => {
    setFolderPrompt({ mode: "rename", folder });
  };

  const handleSubmitFolderPrompt = async (title: string) => {
    if (!folderPrompt) return;

    if (folderPrompt.mode === "create") {
      const folder = await createFolder({ title, parentId: folderPrompt.parentId });
      await refreshLibraryData();
      handleSelectView({ kind: "folder", folderId: folder.id });
      setFolderPrompt(null);
      return;
    }

    const updated = await updateFolder(folderPrompt.folder.id, { title });
    await refreshLibraryData();
    handleSelectView({ kind: "folder", folderId: updated.id });
    setFolderPrompt(null);
  };

  const handleDeleteFolder = async (folder: FolderNode) => {
    const folderIds = getFolderAndDescendantIds(folders, folder.id);
    const affectedItems = items.filter((item) => item.folderId && folderIds.includes(item.folderId));
    setPendingConfirm({
      title: "删除目录",
      message:
        affectedItems.length > 0
          ? `删除“${folder.title}”及其子目录？其中 ${affectedItems.length} 条资料会移动到“未归档”。`
          : `删除空目录“${folder.title}”？`,
      confirmLabel: "删除",
      danger: true,
      onConfirm: async () => {
        await deleteFoldersAndMoveItems(folderIds);
        await refreshLibraryData(selectedId);

        if (activeView.kind === "folder" && folderIds.includes(activeView.folderId)) {
          handleSelectView({ kind: "smart", id: "unfiled" });
        }
      },
    });
  };

  const handleSaveSettings = async (nextSettings: AiSettings) => {
    const saved = await saveAiSettingsWithSecrets(nextSettings);
    setSettings(saved);
    applyThemeMode(saved.themeMode);
  };

  const handleRestoreCoreBackup = async (backup: DaymarkCoreBackupV1) =>
    new Promise<DaymarkCoreBackupCounts | null>((resolve, reject) => {
      setPendingConfirm({
        title: "恢复核心备份",
        message: `这会覆盖当前的资料、目录、日记、记忆和链接。\n\n备份内容：${formatCoreBackupCounts(backup.counts)}。\n\nAI 设置、API Key、主题和布局不会被改写。`,
        confirmLabel: "覆盖恢复",
        danger: true,
        onCancel: () => resolve(null),
        onConfirm: async () => {
          try {
            const counts = await restoreCoreBackup(backup);
            await refreshCoreBackupData();
            setActiveView({ kind: "settings" });
            setSelectedId("");
            setDraft(null);
            setTagText("");
            setIsEditing(false);
            setError("");
            resolve(counts);
          } catch (error) {
            reject(error);
          }
        },
      });
    });

  const handleInstallDemoLibrary = async () => {
    const nextState = await installDemoLibrary();
    setDemoLibraryState(nextState);
    await refreshLibraryData();
    handleSelectView({ kind: "folder", folderId: DEMO_LIBRARY_ROOT_ID });
  };

  const handleRemoveDemoLibrary = () => {
    setPendingConfirm({
      title: "删除示例资料",
      message: "确定删除 Daymark 示例资料吗？你对示例内容所做的修改也会删除。你自行放入示例目录的资料会保留。",
      confirmLabel: "删除示例",
      danger: true,
      onConfirm: async () => {
        const nextState = await removeDemoLibrary();
        setDemoLibraryState(nextState);
        await refreshLibraryData();
        if (activeView.kind === "folder" && activeView.folderId.startsWith("daymark-demo-v1-folder-")) {
          handleSelectView({ kind: "smart", id: "attention" });
        }
      },
    });
  };

  const handleStartEdit = () => {
    if (!selectedItem) return;
    const savedDraft = readItemEditorDraft(selectedItem.id);
    if (savedDraft && itemEditorDraftChanged(savedDraft, selectedItem)) {
      setDraft({ ...savedDraft.draft });
      setTagText(savedDraft.tagText);
      setError("已恢复上次未保存的资料编辑草稿。");
    } else {
      setDraft({ ...selectedItem });
      setTagText(selectedItem.tags.join("，"));
    }
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    if (draft?.id) clearItemEditorDraft(draft.id);
    setDraft(null);
    setTagText("");
    setIsEditing(false);
  };

  const handleSaveEdit = async () => {
    if (!draft) return;
    const updated = await updateItem(draft.id, sanitizeItemDraft(draft, tagText));
    clearItemEditorDraft(draft.id);
    await refreshLibraryData(updated.id);
    setActiveView({ kind: "item", itemId: updated.id });
    setDraft(null);
    setTagText("");
    setIsEditing(false);
  };

  const handleDeleteSelected = async () => {
    if (!selectedItem) return;
    setPendingConfirm({
      title: "删除资料",
      message: `确定删除“${selectedItem.title}”吗？这个操作不会删除本地源文件。`,
      confirmLabel: "删除",
      danger: true,
      onConfirm: async () => {
        clearItemEditorDraft(selectedItem.id);
        await deleteItem(selectedItem.id);
        const remainingItems = items.filter((item) => item.id !== selectedItem.id);
        await refreshLibraryData(remainingItems[0]?.id);
        await refreshLinks();
        setActiveView(lastListView);
        setDraft(null);
        setTagText("");
        setIsEditing(false);
      },
    });
  };

  const handleToggleFavorite = async () => {
    if (!selectedItem) return;
    try {
      const updated = await updateItem(selectedItem.id, { favorite: !selectedItem.favorite });
      await refreshLibraryData(updated.id);
    } catch (error) {
      setError(getSafeErrorMessage(error, "更新收藏状态失败。"));
      throw error;
    }
  };

  const handleMoveItem = async (folderId?: string) => {
    if (!selectedItem) return;
    const updated = await updateItem(selectedItem.id, { folderId });
    await refreshLibraryData(updated.id);
    setLastListView(folderId ? { kind: "folder", folderId } : { kind: "smart", id: "unfiled" });
  };

  const handleUpdateSelected = async (patch: Partial<Item>) => {
    if (!selectedItem) return;
    const updated = await updateItem(selectedItem.id, patch);
    await refreshLibraryData(updated.id);
  };

  const handleRunAiAction = async (action: AiAction, confirmed = false, confirmedItem?: Item) => {
    const aiTargetItem = confirmedItem ?? selectedItem;
    if (!aiTargetItem) return;
    const aiTargetItemId = aiTargetItem.id;
    const setTargetAiRunState = (state: AiRunDisplayState) => setAiRunState({ ...state, itemId: aiTargetItemId });
    if (!aiConfigured) {
      setTargetAiRunState({
        status: "error",
        message: "还没有可用的 AI Key。当前不会读取文件或发送内容给 AI。",
      });
      return;
    }
    const activeSettings = settings!;
    if (!confirmed) {
      const sourceText = aiTargetItem.filePath
        ? `会读取本地文件：${aiTargetItem.filePath}`
        : aiTargetItem.sourceUrl
          ? `会使用资料链接和正文：${aiTargetItem.sourceUrl}`
          : "会使用这条资料当前保存的正文。";
      const changedFields = action === "summarize"
        ? "AI 摘要"
        : action === "title"
          ? "标题"
          : action === "tags"
            ? "标签"
            : "待办";
      setPendingConfirm({
        title: `AI ${getAiActionLabel(action)}`,
        message: `${sourceText}。确认后才会调用 AI，结果会写入这条资料的「${changedFields}」字段，并保留本次提取/发送回执。`,
        confirmLabel: "确认发送",
        closeBeforeRun: true,
        onConfirm: () => handleRunAiAction(action, true, aiTargetItem),
      });
      return;
    }
    const effectiveSettings = getEffectiveAiSettings(activeSettings);

    aiActionAbortRef.current?.abort();
    const aiController = new AbortController();
    aiActionAbortRef.current = aiController;
    setAiRunningAction(action);
    setAiRunState(null);
    const providerLabel = getProviderLabel(effectiveSettings);
    let receiptBase: Omit<AiRunReceipt, "createdAt" | "outputChars"> = {
      action,
      providerLabel,
      model: effectiveSettings.model,
      truncated: false,
      redacted: false,
      warnings: [],
    };
    let extractionPreview = "";

    try {
      let context: AiActionContext = {};
      if (aiTargetItem.filePath) {
        if (!isDesktopRuntime()) {
          throw new Error("本地文件只能在桌面端读取；Web 模式不会读取或发送本地文件。");
        }

        const visionTypes = await getSupportedVisionTypes();
        const extension = getFileExtension(aiTargetItem.filePath);
        const isImageForVision = visionTypes.includes(extension);

        if (isImageForVision) {
          if (!activeSettings.supportsVision) {
            throw new Error("当前 AI 配置不支持图片理解，请切换到支持视觉的模型。");
          }

          setTargetAiRunState({ status: "reading", message: "正在读取图片，尚未发送给 AI。" });
          const extractedImage = await extractLocalImageData(aiTargetItem.filePath);
          const warnings = extractedImage.warnings.map(trimSentenceEnd);
          receiptBase = {
            ...receiptBase,
            fileName: extractedImage.fileName,
            redacted: hasRedactionWarning(warnings),
            warnings,
          };
          context = {
            imageDataUrl: extractedImage.dataUrl,
            imageMimeType: extractedImage.mimeType,
            fileName: extractedImage.fileName,
            fileWarnings: warnings,
            sourceStatus: `已读取图片：${extractedImage.fileName}（${formatBytes(extractedImage.sizeBytes)}）`,
          };
          setTargetAiRunState({
            status: "sending",
            message: `已读取图片 ${extractedImage.fileName}，正在发送给 ${providerLabel}。`,
            receipt: { ...receiptBase, createdAt: formatTimestamp() },
          });
          if (aiController.signal.aborted) throw new DOMException("已停止 AI 操作。", "AbortError");
        } else {
          setTargetAiRunState({ status: "reading", message: "正在提取本地文件正文。" });
          const extracted = await extractLocalFileText(aiTargetItem.filePath);
          if (aiController.signal.aborted) throw new DOMException("已停止 AI 操作。", "AbortError");
          if (!isUsableFileExtraction(extracted)) {
            throw new Error("文件正文提取质量不足，已停止本次 AI 操作。");
          }

          const warnings = extracted.warnings.map(trimSentenceEnd);
          const fileText = extracted.text.trim();
          const sentCharCount = countCharacters(fileText);
          extractionPreview = extracted.preview;
          receiptBase = {
            ...receiptBase,
            fileName: extracted.fileName,
            extractedChars: extracted.extractedChars,
            sentChars: sentCharCount,
            truncated: extracted.truncated,
            redacted: extracted.redacted,
            warnings,
          };
          context = {
            fileText,
            fileName: extracted.fileName,
            fileWarnings: warnings,
            sentCharCount,
            sourceStatus: formatFileExtractionStatus(extracted),
          };
          setTargetAiRunState({
            status: "sending",
            message: `已提取 ${extracted.extractedChars.toLocaleString("zh-CN")} 字符，实际发送 ${sentCharCount.toLocaleString("zh-CN")} 字符，正在请求 ${providerLabel}。`,
            receipt: { ...receiptBase, createdAt: formatTimestamp() },
            preview: extractionPreview,
          });
        }
      }
      if (aiController.signal.aborted) throw new DOMException("已停止 AI 操作。", "AbortError");
      const result = await runAiAction(aiTargetItem, action, activeSettings, context, { signal: aiController.signal });
      const latestTargetItem = (await getItems()).find((item) => item.id === aiTargetItemId) ?? aiTargetItem;
      const patch = createAiPatch(latestTargetItem, result);
      const now = formatTimestamp();
      const updated = await updateItem(aiTargetItemId, {
        ...patch,
        lastAiRunAt: now,
      });

      await refreshLibraryData(updated.id);
      setTargetAiRunState({
        status: "success",
        message: "AI 操作已完成。",
        receipt: {
          ...receiptBase,
          outputChars: result.outputCharCount,
          createdAt: now,
        },
        preview: extractionPreview,
        resultText: result.displayText,
      });
    } catch (aiError) {
      setTargetAiRunState({
        status: "error",
        message: aiError instanceof DOMException && aiError.name === "AbortError"
          ? "AI 操作已停止。"
          : aiError instanceof Error ? aiError.message : "AI 操作失败。",
        receipt: { ...receiptBase, createdAt: formatTimestamp() },
        preview: extractionPreview,
      });
    } finally {
      if (aiActionAbortRef.current === aiController) {
        aiActionAbortRef.current = null;
      }
      setAiRunningAction(null);
    }
  };

  const handleCancelAiAction = () => {
    aiActionAbortRef.current?.abort();
    aiActionAbortRef.current = null;
    setAiRunningAction(null);
    setAiRunState((state) =>
      state
        ? { ...state, status: "error", message: "AI 操作已停止。" }
        : selectedItem
          ? { itemId: selectedItem.id, status: "error", message: "AI 操作已停止。" }
          : null,
    );
  };

  const handleCreateJournalEntry = async (input: { content: string; tags: string[]; todos: string[]; entryDate?: string }) => {
    await createJournalEntry(input);
    await refreshJournalData();
  };

  const handleUpdateJournalEntry = async (id: string, patch: Partial<JournalEntry>) => {
    await updateJournalEntry(id, patch);
    await refreshJournalData();
  };

  const handleDeleteJournalEntry = async (id: string) => {
    return new Promise<boolean>((resolve) => {
    setPendingConfirm({
      title: "删除日志",
      message: "确定删除这条日志吗？与它直接相关的线索链接也会一并移除。",
      confirmLabel: "删除",
      danger: true,
      onCancel: () => resolve(false),
      onConfirm: async () => {
        await deleteJournalEntry(id);
        await refreshJournalData();
        await refreshLinks();
        resolve(true);
      },
    });
    });
  };

  const performExtractToLibrary = async (entry: JournalEntry) => {
    const requestSeq = extractRequestSeqRef.current + 1;
    extractRequestSeqRef.current = requestSeq;
    extractAbortRef.current?.abort();
    const controller = new AbortController();
    extractAbortRef.current = controller;
    setExtractOpen(true);
    setExtractLoading(true);
    setExtractDraft(null);
    setExtractSourceId(entry.id);
    setExtractMessage("");

    try {
      if (!settings || !aiConfigured) throw new Error("还没有配置 AI API Key。");
      const generated = await generateLibraryCardFromJournal(entry, settings, { signal: controller.signal });
      if (extractRequestSeqRef.current !== requestSeq) return;
      setExtractDraft({
        title: generated.title,
        content: generated.content,
        tags: generated.tags.length > 0 ? generated.tags : entry.tags,
        aiSummary: generated.aiSummary,
      });
    } catch (extractError) {
      if (extractRequestSeqRef.current !== requestSeq) return;
      setExtractDraft(createFallbackExtractDraft(entry));
      setExtractMessage(
        extractError instanceof Error
          ? `${extractError.message} 已先生成本地草稿，你可以手动调整后保存。`
          : "AI 沉淀失败，已先生成本地草稿。",
      );
    } finally {
      if (extractRequestSeqRef.current === requestSeq) {
        setExtractLoading(false);
        extractAbortRef.current = null;
      }
    }
  };

  const handleCancelExtractGeneration = () => {
    extractRequestSeqRef.current += 1;
    extractAbortRef.current?.abort();
    extractAbortRef.current = null;
    setExtractLoading(false);
    setExtractDraft(null);
    setExtractMessage("");
    setExtractOpen(false);
  };

  const handleExtractToLibrary = async (entry: JournalEntry) => {
    if (extractLoading) {
      setError("正在整理上一条日志，请稍等完成后再开始新的沉淀。");
      return;
    }
    if (!settings || !aiConfigured) {
      setExtractOpen(true);
      setExtractLoading(false);
      setExtractDraft(createFallbackExtractDraft(entry));
      setExtractSourceId(entry.id);
      setExtractMessage("还没有配置 AI。已先生成本地草稿，你可以手动调整后保存。");
      return;
    }

    setPendingConfirm({
      title: "AI 整理这条日志",
      message: `将读取这条日志正文（${entry.content.length.toLocaleString("zh-CN")} 字），发送给 AI 生成知识卡片草稿。不会直接写入资料库，生成后仍需要你在弹窗里确认保存。`,
      confirmLabel: "开始整理",
      onConfirm: async () => {
        void performExtractToLibrary(entry);
      },
    });
  };

  const handleSaveExtractDraft = async () => {
    if (!extractDraft || extractSaveRef.current) return;
    extractSaveRef.current = true;
    try {
      if (extractSourceId) {
        const [latestLinks, latestItems] = await Promise.all([getKnowledgeLinks(), getItems()]);
        const existingLink = latestLinks.find(
          (link) =>
            link.sourceKind === "journal" &&
            link.sourceId === extractSourceId &&
            link.targetKind === "item" &&
            link.relation === "沉淀",
        );
        const existingItem = existingLink ? latestItems.find((item) => item.id === existingLink.targetId) : undefined;
        if (existingItem) {
          await refreshLibraryData(existingItem.id);
          setExtractOpen(false);
          setExtractDraft(null);
          setExtractSourceId("");
          setActiveView({ kind: "item", itemId: existingItem.id });
          setError("这条日志已经沉淀过，已为你打开原知识卡片。");
          return;
        }
      }

      const itemInput = {
        title: extractDraft.title,
        type: "note" as const,
        folderId: extractDraft.folderId,
        processStatus: extractDraft.folderId ? PROCESS_TO_ORGANIZE : PROCESS_INBOX,
        readingStatus: READING_NOT_NEEDED,
        tags: extractDraft.tags.length > 0 ? extractDraft.tags : ["知识卡片"],
        content: extractDraft.content,
        aiSummary: extractDraft.aiSummary || "从日志沉淀的知识卡片。",
      };

      const created = extractSourceId
        ? (await createItemWithKnowledgeLink(itemInput, {
            sourceKind: "journal",
            sourceId: extractSourceId,
            targetKind: "item",
            relation: "沉淀",
          })).item
        : await createItem(itemInput);

      if (extractSourceId) await refreshLinks();

      await refreshLibraryData(created.id);
      setExtractOpen(false);
      setExtractDraft(null);
      setExtractSourceId("");
      setActiveView({ kind: "item", itemId: created.id });
    } finally {
      extractSaveRef.current = false;
    }
  };

  const handleGenerateSummary = async (prompt: SummaryPrompt, confirmed = false) => {
    if (summaryRunningRef.current && summaryRunningRef.current !== prompt.id) {
      setSummaryMessage("已有一个 AI 回顾正在生成，完成后再开始新的总结。");
      return;
    }
    if (summaryRunningRef.current === prompt.id) return;

    if (!settings || !aiConfigured) {
      setSummaryMessage("还没有配置 AI API Key。");
      return;
    }

    const periodEntries = getEntriesForPeriod(journalEntries, prompt.periodStart, prompt.periodEnd);
    if (periodEntries.length === 0) {
      setSummaryMessage(`${prompt.label} 没有可总结的日志。`);
      return;
    }

    if (!confirmed) {
      const totalChars = periodEntries.reduce((sum, entry) => sum + entry.content.length, 0);
      const existingReport = summaryReports.find(
        (report) =>
          report.periodType === prompt.periodType &&
          report.periodStart === prompt.periodStart &&
          report.periodEnd === prompt.periodEnd,
      );
      const overwriteNotice = existingReport ? " 这个时间段已有总结，新结果会覆盖旧总结。" : "";
      setPendingConfirm({
        title: `生成${prompt.label}`,
        message:
          prompt.periodType === "day"
            ? `将读取 ${periodEntries.length} 条日志正文（约 ${totalChars.toLocaleString("zh-CN")} 字）并发送给 AI，生成这一天的总结。结果会保存为日总结。${overwriteNotice}`
            : `将读取 ${periodEntries.length} 条日志正文（约 ${totalChars.toLocaleString("zh-CN")} 字）并发送给 AI，先生成${prompt.label}；随后会再调用一次 AI 提取长期记忆候选。候选只进入待审核，不会自动写入长期记忆。${overwriteNotice}`,
        confirmLabel: "开始生成",
        onConfirm: async () => {
          void handleGenerateSummary(prompt, true);
        },
      });
      return;
    }

    summaryRunningRef.current = prompt.id;
    setSummaryRunning(prompt.id);
    setSummaryMessage("");

    try {
      const summary = await summarizeJournalPeriod(periodEntries, prompt, settings);
      const reportInput = {
        periodType: prompt.periodType,
        periodStart: prompt.periodStart,
        periodEnd: prompt.periodEnd,
        title: summary.title,
        content: summary.content,
      };
      const report = await upsertSummaryReport(reportInput);
      await refreshJournalData();

      let candidatesCount = 0;
      let candidateError = "";
      if (prompt.periodType !== "day") {
        try {
          const candidates = await extractMemoryCandidates(report, periodEntries, settings);
          candidatesCount = candidates.length;
          await Promise.all(
            candidates.map((candidate) =>
              createMemoryCandidate({
                ...candidate,
                status: "candidate",
                sourceSummaryId: report.id,
              }),
            ),
          );
          await refreshJournalData();
        } catch (error) {
          candidateError = getSafeErrorMessage(error, "未知错误");
        }
      }

      setSummaryMessage(
        candidateError
          ? `总结已保存，但记忆候选提取失败：${candidateError}`
          : prompt.periodType === "day"
          ? `已保存“${report.title}”。`
          : `已保存“${report.title}”，并提出 ${candidatesCount} 条待审核记忆候选。`,
      );
    } catch (summaryError) {
      setSummaryMessage(summaryError instanceof Error ? summaryError.message : "生成总结失败。");
    } finally {
      summaryRunningRef.current = "";
      setSummaryRunning("");
    }
  };

  const handleUpdateMemory = async (id: string, patch: Partial<MemoryCard>) => {
    await updateMemoryCard(id, patch);
    await refreshJournalData();
  };

  const handleGenerateCodexReview = async (
    input: CodexReviewInput,
    onProgress?: (progress: CodexReviewProgress) => void,
    signal?: AbortSignal,
  ) => {
    if (!settings || !aiConfigured) {
      throw new Error("还没有配置 AI API Key。");
    }

    const lockSourceKind = input.sourceKinds.length === 1 ? input.sourceKinds[0] : undefined;
    const generationKey = `${input.date}:${input.reviewKind}:${input.reviewKind === "combined" ? "combined" : lockSourceKind ?? "codex"}`;
    if (reviewGenerationRunningRef.current.has(generationKey)) {
      throw new Error("这份回顾正在生成，请稍后。");
    }
    reviewGenerationRunningRef.current.add(generationKey);
    try {
    onProgress?.({
      stage: "读取会话",
      message: `准备读取 ${input.sessions.length} 个会话，共 ${input.totalChars.toLocaleString("zh-CN")} 字符。`,
    });
    const summary = await streamSummarizeConversationReview(input, settings, (progress) => onProgress?.(progress), signal);
    if (signal?.aborted) throw new DOMException("已取消生成。", "AbortError");

    const sourceKind = input.sourceKinds.length === 1 ? input.sourceKinds[0] : undefined;
    const sourceLabel = input.reviewKind === "combined"
      ? "综合"
      : sourceKind === "claude"
        ? "Claude Code"
        : "Codex";
    const reviewKey = `${input.date}:${input.reviewKind}:${input.reviewKind === "combined" ? "combined" : sourceKind ?? "codex"}`;
    const reviewDraft: CodexDailyReview = {
      id: "draft",
      reviewKey,
      date: input.date,
      reviewKind: input.reviewKind,
      sourceKind,
      sourceLabel,
      title: summary.title || `${input.date} ${sourceLabel}回顾`,
      content: summary.content,
      sessionCount: input.sessions.length,
      sessionIds: input.sessions.map((session) => session.id),
      sourceReviewIds: [],
      createdAt: formatTimestamp(),
      updatedAt: formatTimestamp(),
    };

    const existingReview = await getDailyConversationReviewByKey(reviewDraft.reviewKey);
    let review: CodexDailyReview;
    let storedAsReplacementDraft = false;
    if (existingReview) {
      await createDailyReviewReplacementDraft({
        reviewKey: reviewDraft.reviewKey,
        date: reviewDraft.date,
        reviewKind: reviewDraft.reviewKind,
        sourceKind: reviewDraft.sourceKind,
        sourceLabel: reviewDraft.sourceLabel,
        title: reviewDraft.title,
        content: reviewDraft.content,
        sessionCount: reviewDraft.sessionCount,
        sessionIds: reviewDraft.sessionIds ?? [],
        sourceReviewIds: [],
        status: "pending",
        targetReviewId: existingReview.id,
      });
      review = existingReview;
      storedAsReplacementDraft = true;
      onProgress?.({ stage: "提出记忆修改建议", message: "已存在同日回顾，新版本已保存为替换草稿，等待你审核后再覆盖。" });
    } else {
      review = await upsertDailyConversationReview({
        reviewKey: reviewDraft.reviewKey,
        date: reviewDraft.date,
        reviewKind: reviewDraft.reviewKind,
        sourceKind: reviewDraft.sourceKind,
        sourceLabel: reviewDraft.sourceLabel,
        title: reviewDraft.title,
        content: reviewDraft.content,
        sessionCount: reviewDraft.sessionCount,
        sessionIds: reviewDraft.sessionIds ?? [],
        sourceReviewIds: [],
      });
    }

    let patchDraft: MemoryPatchDraft | undefined;
    if (storedAsReplacementDraft) {
      onProgress?.({ stage: "提出记忆修改建议", message: "替换草稿不会自动生成长期记忆建议，请先在回顾档案中审核替换。" });
    } else {
      try {
      onProgress?.({ stage: "提出记忆修改建议", message: "正在根据回顾生成待审核的记忆修改建议。" });
      const currentMemory = memoryDocument ?? (await getMemoryDocument());
      const suggestion = await streamGenerateMemoryPatchFromReview(
        reviewDraft,
        currentMemory?.content ?? "",
        settings,
        (progress) => onProgress?.(progress),
        signal,
      );
      if (signal?.aborted) throw new DOMException("已取消生成。", "AbortError");

      patchDraft = await createMemoryPatchDraft({
        title: suggestion.title,
        rationale: suggestion.rationale,
        proposedContent: suggestion.proposedContent,
        sourceReviewId: review.id,
        status: "pending",
      });
    } catch (patchError) {
      if (patchError instanceof DOMException && patchError.name === "AbortError") {
        onProgress?.({ stage: "提出记忆修改建议", message: "回顾已保存，记忆建议生成已取消。" });
      } else {
        onProgress?.({
          stage: "提出记忆修改建议",
          message: `回顾已保存，但记忆建议生成失败：${patchError instanceof Error ? patchError.message : "未知错误"}`,
        });
      }
    }
    }

    await refreshMemoryData();
    return { review, patchDraft, replacementDraft: storedAsReplacementDraft };
    } finally {
      reviewGenerationRunningRef.current.delete(generationKey);
    }
  };

  const handleReplaceCodexSessionIndex = async (records: CodexSessionIndex[]) => {
    const saved = await replaceConversationSessionIndex(records);
    setCodexSessionIndex(saved);
  };

  const handleGenerateCombinedReview = async (
    sourceReviews: CodexDailyReview[],
    onProgress?: (progress: CodexReviewProgress) => void,
    signal?: AbortSignal,
  ) => {
    if (!settings || !aiConfigured) {
      throw new Error("还没有配置 AI API Key。");
    }
    if (sourceReviews.length < 2) {
      throw new Error("请先选择至少两个来源回顾。");
    }

    const date = sourceReviews[0].date;
    const generationKey = `${date}:combined:combined`;
    if (reviewGenerationRunningRef.current.has(generationKey)) {
      throw new Error("这份回顾正在生成，请稍后。");
    }
    reviewGenerationRunningRef.current.add(generationKey);
    try {
    const summary = await streamSynthesizeCombinedDailyReview(sourceReviews, settings, (progress) => onProgress?.(progress), signal);
    if (signal?.aborted) throw new DOMException("已取消生成。", "AbortError");

    const reviewDraft: CodexDailyReview = {
      id: "draft",
      reviewKey: `${date}:combined:combined`,
      date,
      reviewKind: "combined",
      sourceLabel: "综合",
      title: summary.title || `${date} 综合回顾`,
      content: summary.content,
      sessionCount: sourceReviews.reduce((sum, review) => sum + review.sessionCount, 0),
      sessionIds: sourceReviews.flatMap((review) => review.sessionIds ?? []),
      sourceReviewIds: sourceReviews.map((review) => review.id),
      createdAt: formatTimestamp(),
      updatedAt: formatTimestamp(),
    };

    const existingReview = await getDailyConversationReviewByKey(reviewDraft.reviewKey);
    let review: CodexDailyReview;
    let storedAsReplacementDraft = false;
    if (existingReview) {
      await createDailyReviewReplacementDraft({
        reviewKey: reviewDraft.reviewKey,
        date: reviewDraft.date,
        reviewKind: reviewDraft.reviewKind,
        sourceLabel: reviewDraft.sourceLabel,
        title: reviewDraft.title,
        content: reviewDraft.content,
        sessionCount: reviewDraft.sessionCount,
        sessionIds: reviewDraft.sessionIds ?? [],
        sourceReviewIds: reviewDraft.sourceReviewIds,
        status: "pending",
        targetReviewId: existingReview.id,
      });
      review = existingReview;
      storedAsReplacementDraft = true;
      onProgress?.({ stage: "提出记忆修改建议", message: "已存在综合回顾，新版本已保存为替换草稿，等待你审核后再覆盖。" });
    } else {
      review = await upsertDailyConversationReview({
        reviewKey: reviewDraft.reviewKey,
        date: reviewDraft.date,
        reviewKind: reviewDraft.reviewKind,
        sourceLabel: reviewDraft.sourceLabel,
        title: reviewDraft.title,
        content: reviewDraft.content,
        sessionCount: reviewDraft.sessionCount,
        sessionIds: reviewDraft.sessionIds,
        sourceReviewIds: reviewDraft.sourceReviewIds,
      });
    }

    let patchDraft: MemoryPatchDraft | undefined;
    if (storedAsReplacementDraft) {
      onProgress?.({ stage: "提出记忆修改建议", message: "替换草稿不会自动生成长期记忆建议，请先在回顾档案中审核替换。" });
    } else {
      try {
      onProgress?.({ stage: "提出记忆修改建议", message: "正在根据综合回顾生成待审核的记忆修改建议。" });
      const currentMemory = memoryDocument ?? (await getMemoryDocument());
      const suggestion = await streamGenerateMemoryPatchFromReview(
        reviewDraft,
        currentMemory?.content ?? "",
        settings,
        (progress) => onProgress?.(progress),
        signal,
      );
      if (signal?.aborted) throw new DOMException("已取消生成。", "AbortError");

      patchDraft = await createMemoryPatchDraft({
        title: suggestion.title,
        rationale: suggestion.rationale,
        proposedContent: suggestion.proposedContent,
        sourceReviewId: review.id,
        status: "pending",
      });
    } catch (patchError) {
      if (patchError instanceof DOMException && patchError.name === "AbortError") {
        onProgress?.({ stage: "提出记忆修改建议", message: "综合回顾已保存，记忆建议生成已取消。" });
      } else {
        onProgress?.({
          stage: "提出记忆修改建议",
          message: `综合回顾已保存，但记忆建议生成失败：${patchError instanceof Error ? patchError.message : "未知错误"}`,
        });
      }
    }
    }

    await refreshMemoryData();
    return { review, patchDraft, replacementDraft: storedAsReplacementDraft };
    } finally {
      reviewGenerationRunningRef.current.delete(generationKey);
    }
  };

  const handleSaveGenerationDraft = async (draftInput: Omit<ConversationGenerationDraft, "id" | "createdAt" | "updatedAt">) => {
    await upsertConversationGenerationDraft(draftInput);
    await refreshMemoryData();
  };

  const handleUpdateCodexReview = async (id: string, patch: Partial<CodexDailyReview>) => {
    await updateCodexDailyReview(id, patch);
    await refreshMemoryData();
  };

  const handleApplyDailyReviewDraft = async (id: string) => {
    await applyDailyReviewReplacementDraft(id);
    await refreshMemoryData();
  };

  const handleIgnoreDailyReviewDraft = async (id: string) => {
    await updateDailyReviewReplacementDraft(id, { status: "ignored" });
    await refreshMemoryData();
  };

  const handleSaveMemoryDocument = async (content: string, options: MemoryDocumentSaveOptions) => {
    const latest = await getMemoryDocument();
    const baselineChanged = latest
      ? latest.content !== options.baselineContent || latest.updatedAt !== options.baselineUpdatedAt
      : options.baselineContent.trim().length > 0 || Boolean(options.baselineUpdatedAt);

    if (baselineChanged) {
      throw new Error("长期记忆文档已经在别处更新。请重新确认最新内容后再保存，避免覆盖新的记忆。");
    }

    const saved = await updateMemoryDocument(content);
    setMemoryDocument(saved);
    return saved;
  };

  const handleApplyMemoryPatch = async (id: string, editedContent: string, options?: MemoryPatchApplyOptions) => {
    const [latestDocument, currentDraft] = await Promise.all([
      getMemoryDocument(),
      Promise.resolve(memoryPatchDrafts.find((draft) => draft.id === id)),
    ]);
    const draftBaselineAt = currentDraft?.createdAt || currentDraft?.updatedAt || "";
    if (latestDocument?.updatedAt && draftBaselineAt && latestDocument.updatedAt > draftBaselineAt) {
      if (!options?.allowStale) {
        throw new Error("长期记忆文档已经更新过。请重新确认这条建议后再写入。");
      }
      const confirmedStillCurrent =
        latestDocument.updatedAt === options.confirmedDocumentUpdatedAt &&
        latestDocument.content === (options.confirmedDocumentContent ?? "");
      if (!confirmedStillCurrent) {
        throw new Error("长期记忆文档在你确认后又发生了变化。请重新查看最新内容后再写入。");
      }
    }
    await applyMemoryPatchDraft(id, editedContent, {
      expectedDocumentUpdatedAt: latestDocument?.updatedAt ?? "",
      expectedDocumentContent: latestDocument?.content ?? "",
    });
    await refreshMemoryData();
  };

  const handleIgnoreMemoryPatch = async (id: string) => {
    await updateMemoryPatchDraft(id, { status: "ignored" });
    await refreshMemoryData();
  };

  const handleCreateLink = async (input: Omit<KnowledgeLink, "id" | "createdAt">) => {
    await createKnowledgeLink(input);
    await refreshLinks();
  };

  const handleDeleteLink = async (id: string) => {
    await deleteKnowledgeLink(id);
    await refreshLinks();
  };

  const handleOpenEntity = (kind: EntityKind, id: string) => {
    if (kind === "item") {
      const item = items.find((currentItem) => currentItem.id === id);
      if (item) {
        void handleSelectItem(item);
      } else {
        setSelectedId(id);
        setActiveView({ kind: "item", itemId: id });
        void refreshLibraryData(id);
      }
      return;
    }

    if (kind === "journal") {
      const entry = journalEntries.find((currentEntry) => currentEntry.id === id);
      if (!entry) {
        setError("找不到这条日志。");
        return;
      }
      setActiveView({ kind: "journal", date: entry?.entryDate.slice(0, 10), entryId: id });
      return;
    }

    if (kind === "summary") {
      const report = summaryReports.find((currentReport) => currentReport.id === id);
      if (!report) {
        setError("找不到这份回顾。");
        return;
      }
      if (report.periodType === "day") {
        setActiveView({ kind: "journal", date: report.periodStart, summaryId: id });
      } else {
        setActiveView({ kind: "memory", subView: "archive", summaryId: id });
      }
      return;
    }

    const memory = memoryCards.find((currentMemory) => currentMemory.id === id);
    if (!memory) {
      setError("找不到这条记忆。");
      return;
    }
    setActiveView({ kind: "memory", subView: "legacy", memoryId: id });
  };

  const handleOpenSearchResult = (result: SearchResult) => {
    const route = result.route;
    if (!route) {
      handleOpenEntity(result.kind, result.id);
      return;
    }

    if (route.kind === "item") {
      const item = items.find((currentItem) => currentItem.id === route.itemId);
      if (item) {
        void handleSelectItem(item);
      } else {
        setSelectedId(route.itemId);
        setActiveView({ kind: "item", itemId: route.itemId });
        void refreshLibraryData(route.itemId);
      }
      return;
    }

    if (route.kind === "journal") {
      setActiveView({
        kind: "journal",
        date: route.date,
        entryId: route.entryId,
        summaryId: route.summaryId,
      });
      return;
    }

    setActiveView({
      kind: "memory",
      subView: route.subView ?? "legacy",
      memoryId: route.memoryId,
      reviewId: route.reviewId,
      reviewDraftId: route.reviewDraftId,
      summaryId: route.summaryId,
    });
  };

  if (!startupComplete) {
    return (
      <main className="app-shell">
        <StartupScreen ready={!loading} onComplete={handleStartupComplete} />
      </main>
    );
  }

  return (
    <main className="app-shell">
      <MainWindowTitleBar />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar
          folders={folders}
          items={items}
          activeView={activeView}
          selectedItemId={selectedItem?.id}
          collapsed={libraryViewActive ? layout.libraryDirectoryCollapsed : layout.sidebarCollapsed}
          width={libraryViewActive
            ? layout.libraryDirectoryWidth
            : layout.sidebarCollapsed
              ? 64
              : layout.sidebarWidth}
          onSelectView={handleSelectView}
          onSelectItem={handleSelectItem}
          onCreateFolder={handleCreateFolder}
          onRenameFolder={handleRenameFolder}
          onDeleteFolder={handleDeleteFolder}
          onToggleCollapsed={() =>
            libraryViewActive
              ? updateLayout({ libraryDirectoryCollapsed: !layout.libraryDirectoryCollapsed })
              : updateLayout({ sidebarCollapsed: !layout.sidebarCollapsed })
          }
          onResizeStart={
            libraryViewActive
              ? startLayoutResize("libraryDirectoryWidth", 220, 320)
              : startLayoutResize("sidebarWidth", 176, 232)
          }
          onResetLayout={resetLayout}
        />

        {(!libraryViewActive || !layout.libraryDirectoryCollapsed) && (
          <div
            className="resize-handle hidden h-full shrink-0 lg:block"
            onMouseDown={
              libraryViewActive
                ? startLayoutResize("libraryDirectoryWidth", 220, 320)
                : startLayoutResize("sidebarWidth", 176, 232)
            }
            title={libraryViewActive ? "拖动调整目录宽度" : "拖动调整侧栏宽度"}
            role="separator"
            aria-label={libraryViewActive ? "拖动调整目录宽度" : "拖动调整侧栏宽度"}
          />
        )}

        <div ref={workspaceRef} className="min-h-0 min-w-0 flex-1">
          {activeView.kind === "today" ? (
            <TodayPage
              data={todayDashboard}
              loading={loading}
              focusComposerRequest={todayComposerFocusRequest}
              settings={settings}
              autoWorkReviewSettings={autoWorkReviewSettings}
              rollingWorkReview={rollingWorkReview}
              autoWorkReviewRunning={autoWorkReviewRunning}
              autoWorkReviewProgress={autoWorkReviewProgress}
              codexReviews={codexReviews}
              memoryPatchDrafts={memoryPatchDrafts}
              conversationGenerationDrafts={conversationGenerationDrafts}
              onCreateJournalEntry={handleCreateJournalEntry}
              onOpenEntity={handleOpenEntity}
              onOpenSearch={() => handleSelectView({ kind: "search" })}
              onOpenLibraryView={(view) => handleSelectView({ kind: "smart", id: view })}
              onOpenJournalPage={() => handleSelectView({ kind: "journal" })}
              onOpenMemoryPage={(subView?: MemorySubView) => handleSelectView({ kind: "memory", subView })}
              onOpenSettings={() => handleSelectView({ kind: "settings" })}
              onRunAutoWorkReview={handleRunAutoWorkReview}
              onArchiveRollingWorkReview={handleArchiveRollingWorkReview}
              onReplaceCodexSessionIndex={handleReplaceCodexSessionIndex}
              onGenerateCodexReview={handleGenerateCodexReview}
              onGenerateCombinedReview={handleGenerateCombinedReview}
            />
          ) : activeView.kind === "search" ? (
            <SearchPage
              onOpenResult={handleOpenSearchResult}
              refreshKey={searchRefreshKey}
            />
          ) : activeView.kind === "journal" ? (
            <JournalPage
              entries={journalEntries}
              reports={summaryReports}
              items={items}
              memories={memoryCards}
              links={links}
              loading={loading}
              summaryPrompts={summaryPrompts}
              summaryMessage={summaryMessage}
              summaryRunning={summaryRunning}
              onCreateEntry={handleCreateJournalEntry}
              onUpdateEntry={handleUpdateJournalEntry}
              onDeleteEntry={handleDeleteJournalEntry}
              onExtractToLibrary={handleExtractToLibrary}
              onGenerateSummary={handleGenerateSummary}
              onCreateLink={handleCreateLink}
              onDeleteLink={handleDeleteLink}
              onOpenEntity={handleOpenEntity}
              initialDate={activeView.kind === "journal" ? activeView.date : undefined}
              initialEntryId={activeView.kind === "journal" ? activeView.entryId : undefined}
              initialSummaryId={activeView.kind === "journal" ? activeView.summaryId : undefined}
            />
          ) : activeView.kind === "memory" ? (
            <MemoryPage
              memories={memoryCards}
              memoryDocument={memoryDocument}
              memoryPatchDrafts={memoryPatchDrafts}
              reports={summaryReports}
              codexReviews={codexReviews}
              rollingWorkReviews={rollingWorkReviews}
              codexSessionIndex={codexSessionIndex}
              dailyReviewDrafts={dailyReviewDrafts}
              conversationGenerationDrafts={conversationGenerationDrafts}
              settings={settings}
              initialSubView={activeView.kind === "memory" ? activeView.subView : undefined}
              initialMemoryId={activeView.kind === "memory" ? activeView.memoryId : undefined}
              initialReviewId={activeView.kind === "memory" ? activeView.reviewId : undefined}
              initialReviewDraftId={activeView.kind === "memory" ? activeView.reviewDraftId : undefined}
              initialSummaryId={activeView.kind === "memory" ? activeView.summaryId : undefined}
              onUpdateMemory={handleUpdateMemory}
              onGenerateCodexReview={handleGenerateCodexReview}
              onGenerateCombinedReview={handleGenerateCombinedReview}
              onSaveGenerationDraft={handleSaveGenerationDraft}
              onReplaceCodexSessionIndex={handleReplaceCodexSessionIndex}
              onUpdateCodexReview={handleUpdateCodexReview}
              onApplyDailyReviewDraft={handleApplyDailyReviewDraft}
              onIgnoreDailyReviewDraft={handleIgnoreDailyReviewDraft}
              onArchiveRollingWorkReview={handleArchiveRollingWorkReview}
              onSaveMemoryDocument={handleSaveMemoryDocument}
              onApplyMemoryPatch={handleApplyMemoryPatch}
              onIgnoreMemoryPatch={handleIgnoreMemoryPatch}
            />
          ) : activeView.kind === "settings" ? (
            settings ? (
              <SettingsPanel
                settings={settings}
                autoWorkReviewSettings={autoWorkReviewSettings}
                autoWorkReviewRunning={autoWorkReviewRunning}
                onSave={handleSaveSettings}
                onSaveAutoWorkReviewSettings={handleSaveAutoWorkReviewSettings}
                onRunAutoWorkReview={handleRunAutoWorkReview}
                onDirtyChange={setSettingsDirty}
                onRestoreCoreBackup={handleRestoreCoreBackup}
                onOpenOnboarding={() => setFirstRunGuideOpen(true)}
                demoLibraryState={demoLibraryState}
                onInstallDemoLibrary={handleInstallDemoLibrary}
                onRemoveDemoLibrary={handleRemoveDemoLibrary}
              />
            ) : (
              <section className="workspace-surface">
                <div className="flex h-full items-center justify-center text-sm text-ink/52">正在读取设置…</div>
              </section>
            )
          ) : activeView.kind === "item" ? (
            <ItemReader
              item={selectedItem}
              folders={folders}
              items={items}
              journalEntries={journalEntries}
              memories={memoryCards}
              reports={summaryReports}
              links={links}
              aiRunningAction={aiRunningAction}
              aiRunState={aiRunState?.itemId === selectedItem?.id ? aiRunState : null}
              onBackToList={() => handleSelectView(lastListView)}
              onEdit={handleStartEdit}
              onCreate={handleCreateItem}
              onDelete={handleDeleteSelected}
              onToggleFavorite={handleToggleFavorite}
              onMoveItem={handleMoveItem}
              onUpdateItem={handleUpdateSelected}
              onRunAiAction={handleRunAiAction}
              onCancelAiAction={handleCancelAiAction}
              onCreateLink={handleCreateLink}
              onDeleteLink={handleDeleteLink}
              onOpenEntity={handleOpenEntity}
            />
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              <header className="workspace-header px-6 py-3">
                <div className="flex min-w-0 flex-wrap items-end justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink/42">Library</p>
                    <div className="mt-1 flex min-w-0 flex-wrap items-end gap-3">
                      {layout.libraryDirectoryCollapsed && (
                        <button
                          className="soft-button icon-action-compact hidden lg:flex"
                          onClick={() => updateLayout({ libraryDirectoryCollapsed: false })}
                          title="展开目录"
                          aria-label="展开目录"
                        >
                          <PanelLeftOpen size={15} />
                        </button>
                      )}
                      <h2 className="truncate text-[26px] font-semibold tracking-normal text-ink lg:text-[30px]">资料库</h2>
                      <div className="min-w-0 truncate text-sm text-ink/46">{filteredItems.length} 条资料</div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    <LibrarySmartToolbar
                      items={items}
                      activeView={activeView}
                      onSelectView={(view) => handleSelectView({ kind: "smart", id: view })}
                    />
                    <button
                      className="primary-button action-compact"
                      onClick={handleCreateItem}
                    >
                      导入资料
                    </button>
                    {layout.libraryListCollapsed && (
                      <button
                        className="secondary-action action-compact"
                        onClick={() => updateLayout({ libraryListCollapsed: false })}
                      >
                        切换资料
                      </button>
                    )}
                  </div>
                </div>
              </header>

              <MobileLibrarySwitcher
                folders={folders}
                items={items}
                activeView={activeView}
                selectedItem={selectedItem}
                onSelectView={handleSelectView}
                onCreateFolder={() => handleCreateFolder()}
              />

              <div className="relative flex min-h-0 flex-1 gap-3 pt-3">
                <div
                  className={
                    layout.libraryListCollapsed
                      ? "hidden"
                      : selectedItem
                        ? "absolute right-3 top-3 z-30 h-[min(58vh,500px)] w-[min(420px,calc(100%-1.5rem))] min-w-[min(340px,calc(100%-1.5rem))] overflow-hidden rounded-[10px] border border-line/70 bg-paper/96 shadow-[0_14px_34px_rgba(0,0,0,0.14)] backdrop-blur-md"
                        : "min-w-0 flex-1 overflow-hidden xl:min-w-[420px] xl:flex-none"
                  }
                  style={selectedItem ? undefined : { width: `min(calc(100% - 1rem), ${layout.libraryListWidth}px)` }}
                >
                  <ItemList
                    items={filteredItems}
                    allItems={items}
                    folders={folders}
                    activeView={activeView}
                    selectedId={selectedItem?.id ?? ""}
                    loading={loading}
                    error={error}
                    query={query}
                    statusFilter={statusFilter}
                    onQueryChange={setQuery}
                    onStatusFilterChange={setStatusFilter}
                    onCreateItem={handleCreateItem}
                    onCollapse={() => updateLayout({ libraryListCollapsed: true })}
                    onSelectItem={handlePreviewLibraryItem}
                    compact={Boolean(selectedItem)}
                  />
                </div>
                <div
                  className={`resize-handle hidden h-full shrink-0 ${layout.libraryListCollapsed || selectedItem ? "xl:hidden" : "xl:block"}`}
                  onMouseDown={startLayoutResize("libraryListWidth", 560, 860)}
                  title="拖动调整列表宽度"
                  role="separator"
                  aria-label="拖动调整列表宽度"
                />
                <div className={`${selectedItem ? "min-w-0 flex-1" : "hidden min-w-0 flex-1 xl:block"}`}>
                  <ItemReader
                    item={selectedItem}
                    folders={folders}
                    items={items}
                    journalEntries={journalEntries}
                    memories={memoryCards}
                    reports={summaryReports}
                    links={links}
                    aiRunningAction={aiRunningAction}
                    aiRunState={aiRunState?.itemId === selectedItem?.id ? aiRunState : null}
                    showBackButton={false}
                    onBackToList={() => handleSelectView(lastListView)}
                    onEdit={handleStartEdit}
                    onCreate={handleCreateItem}
                    onDelete={handleDeleteSelected}
                    onToggleFavorite={handleToggleFavorite}
                    onMoveItem={handleMoveItem}
                    onUpdateItem={handleUpdateSelected}
                    onRunAiAction={handleRunAiAction}
                    onCancelAiAction={handleCancelAiAction}
                    onCreateLink={handleCreateLink}
                    onDeleteLink={handleDeleteLink}
                    onOpenEntity={handleOpenEntity}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <MobileGlobalNav activeView={activeView} onSelectView={handleSelectView} />
      <ImportDialog
        open={importOpen}
        folders={folders}
        defaultFolderId={currentFolderId}
        onClose={() => setImportOpen(false)}
        onCreate={handleCreateImportedItem}
        onCreateBatch={handleCreateImportedItems}
      />
      <ExtractDialog
        open={extractOpen}
        loading={extractLoading}
        draft={extractDraft}
        folders={folders}
        message={extractMessage}
        onDraftChange={setExtractDraft}
        onClose={() => setExtractOpen(false)}
        onCancelGeneration={handleCancelExtractGeneration}
        onSave={handleSaveExtractDraft}
      />
      <EditorOverlay
        open={isEditing}
        draft={draft}
        folders={folders}
        tagText={tagText}
        dirty={editorDirty}
        onDraftChange={setDraft}
        onTagTextChange={setTagText}
        onCancel={handleCancelEdit}
        onSave={handleSaveEdit}
      />
      <PromptDialog
        confirmLabel={folderPrompt?.mode === "rename" ? "保存名称" : "创建目录"}
        initialValue={folderPrompt?.mode === "rename" ? folderPrompt.folder.title : ""}
        onCancel={() => setFolderPrompt(null)}
        onSubmit={handleSubmitFolderPrompt}
        open={Boolean(folderPrompt)}
        placeholder="目录名称"
        title={folderPrompt?.mode === "rename" ? "重命名目录" : "新建目录"}
      />
      <ConfirmDialog
        confirmLabel={pendingConfirm?.confirmLabel}
        danger={pendingConfirm?.danger}
        message={pendingConfirm?.message ?? ""}
        onCancel={() => {
          const confirm = pendingConfirm;
          setPendingConfirm(null);
          confirm?.onCancel?.();
        }}
        onConfirm={async () => {
          const confirm = pendingConfirm;
          if (!confirm) return;
          if (confirm.closeBeforeRun) {
            setPendingConfirm(null);
            void confirm.onConfirm();
            return;
          }
          await confirm.onConfirm();
          setPendingConfirm(null);
        }}
        open={Boolean(pendingConfirm)}
        title={pendingConfirm?.title ?? ""}
      />
      <FirstRunGuide
        open={firstRunGuideOpen}
        onStart={handleOnboardingStart}
        onDismiss={closeFirstRunGuide}
      />
      {quickCaptureNotice && (
        <div className="pointer-events-none fixed bottom-5 right-5 z-[80] max-w-sm rounded-[14px] border border-line/70 bg-paper/92 px-4 py-3 text-sm text-ink shadow-[0_18px_48px_rgba(0,0,0,0.22)] backdrop-blur-xl">
          {quickCaptureNotice}
        </div>
      )}
    </main>
  );
}

function createLocalTitleFromContent(content: string) {
  const compact = content
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/[`*_>#-]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return Array.from(compact || "空白内容").slice(0, 18).join("");
}

function getDefaultImportedReadingStatus(type: ItemType): ReadingStatus {
  return type === "document" || type === "url" ? READING_TO_READ : READING_NOT_NEEDED;
}

function getPathBaseName(path: string) {
  const parts = path.trim().replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function createFallbackExtractDraft(entry: JournalEntry): ExtractDraft {
  return {
    title: `日志沉淀 - ${createLocalTitleFromContent(entry.content)}`,
    content: entry.content,
    tags: Array.from(new Set([...entry.tags, "知识卡片"])),
    aiSummary: "从日志沉淀的知识卡片",
  };
}

function getEntriesForPeriod(entries: JournalEntry[], start: string, end: string) {
  return entries.filter((entry) => {
    const date = entry.entryDate.slice(0, 10);
    return date >= start && date <= end;
  });
}

function MobileLibrarySwitcher({
  folders,
  items,
  activeView,
  selectedItem,
  onSelectView,
  onCreateFolder,
}: {
  folders: FolderNode[];
  items: Item[];
  activeView: ActiveView;
  selectedItem?: Item | null;
  onSelectView: (view: ActiveView) => void;
  onCreateFolder: () => void;
}) {
  const folderOptions = useMemo(() => flattenFolderOptions(folders), [folders]);
  const countsByFolder = useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach((item) => {
      counts.set(item.folderId ?? "", (counts.get(item.folderId ?? "") ?? 0) + 1);
    });
    return counts;
  }, [items]);
  const activeFolderId =
    activeView.kind === "folder"
      ? activeView.folderId
      : activeView.kind === "item"
        ? selectedItem?.folderId
        : activeView.kind === "smart" && activeView.id === "unfiled"
          ? undefined
          : null;
  const smartEntries: Array<{ id: SmartView; label: string }> = [
    { id: "attention", label: "待处理" },
    { id: "inbox", label: "收件箱" },
    { id: "recent", label: "最近" },
    { id: "favorite", label: "收藏" },
    { id: "reading", label: "待读" },
  ];

  return (
    <section className="border-b border-line/70 px-4 py-2 lg:hidden">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-ink/42">资料视图</div>
        <button className="ghost-action action-micro" type="button" onClick={onCreateFolder}>
          新建目录
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
        {smartEntries.map((entry) => {
          const active = activeView.kind === "smart" && activeView.id === entry.id;
          return (
            <button
              key={entry.id}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs transition ${
                active ? "border-copper bg-copper/12 text-ink" : "border-line/70 text-ink/56 hover:border-line hover:text-ink"
              }`}
              type="button"
              onClick={() => onSelectView({ kind: "smart", id: entry.id })}
            >
              {entry.label}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
        {folderOptions.map((folder) => {
          const folderKey = folder.id ?? "";
          const active = activeFolderId === folder.id;
          return (
            <button
              key={folderKey || "unfiled"}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs transition ${
                active ? "border-copper bg-copper/12 text-ink" : "border-line/70 text-ink/56 hover:border-line hover:text-ink"
              }`}
              style={{ marginLeft: folder.depth ? Math.min(folder.depth, 2) * 8 : undefined }}
              type="button"
              onClick={() =>
                onSelectView(folder.id ? { kind: "folder", folderId: folder.id } : { kind: "smart", id: "unfiled" })
              }
            >
              {folder.label}
              <span className="ml-1 text-ink/35">{countsByFolder.get(folderKey) ?? 0}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function getMissingSummaryPrompts(reports: SummaryReport[]): SummaryPrompt[] {
  const previousWeek = getPreviousWeekRange();
  const previousMonth = getPreviousMonthRange();
  const periods = [
    { periodType: "week" as const, ...previousWeek, label: `上周回顾（${previousWeek.periodStart} 至 ${previousWeek.periodEnd}）` },
    { periodType: "month" as const, ...previousMonth, label: `上月回顾（${previousMonth.periodStart} 至 ${previousMonth.periodEnd}）` },
  ];

  return periods
    .filter(
      (period) =>
        !reports.some(
          (report) =>
            report.periodType === period.periodType &&
            report.periodStart === period.periodStart &&
            report.periodEnd === period.periodEnd,
        ),
    )
    .map((period) => ({
      id: `${period.periodType}-${period.periodStart}`,
      periodType: period.periodType,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      label: period.label,
    }));
}

function getPreviousWeekRange(now = new Date()) {
  const current = new Date(now);
  current.setHours(0, 0, 0, 0);
  const day = current.getDay() || 7;
  const thisMonday = new Date(current);
  thisMonday.setDate(current.getDate() - day + 1);
  const start = new Date(thisMonday);
  start.setDate(thisMonday.getDate() - 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  return { periodStart: toDateKey(start), periodEnd: toDateKey(end) };
}

function getPreviousMonthRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0);

  return { periodStart: toDateKey(start), periodEnd: toDateKey(end) };
}

function toDateKey(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
