import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { animate } from "animejs";
import { listen } from "@tauri-apps/api/event";
import { ChevronRight, PanelLeftOpen } from "lucide-react";
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
  type MemorySuggestionTaskHooks,
  type ReviewGenerationTaskHooks,
} from "./ai/deepseek";
import { EditorOverlay } from "./components/EditorOverlay";
import { ExtractDialog, type ExtractDraft } from "./components/ExtractDialog";
import { FirstRunGuide, type OnboardingStartAction } from "./components/FirstRunGuide";
import { ImportDialog, type ImportDraft, type ImportMode } from "./components/ImportDialog";
import { ConfirmDialog, PromptDialog } from "./components/ConfirmDialog";
import { ItemList } from "./components/ItemList";
import { ItemReader, type ItemReaderProps, type ReviewLibraryReaderState } from "./components/ItemReader";
import { JournalPage } from "./components/JournalPage";
import { LibrarySmartToolbar } from "./components/LibrarySmartToolbar";
import { MemoryPage } from "./components/MemoryPage";
import { SearchPage } from "./components/SearchPage";
import { SettingsPanel, type SettingsPanelHandle } from "./components/SettingsPanel";
import { MobileGlobalNav, Sidebar } from "./components/Sidebar";
import { MainWindowTitleBar } from "./components/MainWindowTitleBar";
import { StartupScreen } from "./components/StartupScreen";
import { TodayPage } from "./components/TodayPage";
import {
  ReviewGenerationWorkspace,
  type ReviewGenerationRuntime,
} from "./components/ReviewGenerationWorkspace";
import { ConversationScanWorkspace } from "./components/ConversationScanWorkspace";
import { ReviewPublishDialog } from "./components/ReviewPublishDialog";
import {
  createKnowledgeLink,
  createFolder,
  createItem,
  createItemsBatch,
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
  applyDailyReviewLibraryUpdate,
  applyMemoryPatchDraft,
  formatTimestamp,
  getCodexDailyReviews,
  getCodexSessionIndex,
  getConversationGenerationDrafts,
  getDailyConversationReviewById,
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
  publishDailyReviewToLibrary,
  replaceConversationSessionIndex,
  restoreCoreBackup,
  restoreDailyReviewLibraryVersion,
  saveAutoWorkReviewSettings,
  type DaymarkCoreBackupCounts,
  type DaymarkCoreBackupV1,
  updateCodexDailyReview,
  updateConversationGenerationDraft,
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
  deleteConversationGenerationDraft,
  removeExpiredConversationGenerationDrafts,
} from "./data/itemStore";
import { loadAiSettingsWithSecrets, saveAiSettingsWithSecrets } from "./lib/aiSecrets";
import { runAutoWorkReviewOnce } from "./lib/autoWorkReview";
import { flattenFolderOptions, getFolderAndDescendantIds } from "./lib/folders";
import { applyAppearancePreference, bindSystemThemeListener, getThemeMode } from "./lib/theme";
import { useMainWindowMaximized } from "./hooks/useMainWindowMaximized";
import { getSafeErrorMessage } from "./lib/redaction";
import { markOnboardingCompleted, shouldShowOnboarding } from "./lib/onboarding";
import { shouldOpenFirstRunGuide } from "./lib/startup";
import { buildTodayDashboardData, withStartupTimeout, type AsyncResource } from "./lib/todayDashboard";
import {
  markConversationDateIndexUserScanCompleted,
  pauseConversationDateIndexCompletion,
  startConversationDateIndexCompletion,
} from "./lib/conversationDateIndex";
import { formatConversationScanProgress } from "./lib/conversationScanProgress";
import {
  createConversationScanJobId,
  createConversationScanKey,
  DEFAULT_CONVERSATION_SCAN_QUERY,
  isConversationScanActive,
  normalizeConversationScanQuery,
  shouldShowConversationScanEntry,
  toConversationScanOptions,
  type ConversationScanQuery,
  type ConversationScanRuntime,
} from "./lib/conversationScanTask";
import {
  createMemoryContentVersion,
  createMemorySuggestionCheckpoint,
  createReviewContentVersion,
  isMemorySuggestionCheckpointCurrent,
  updateMemorySuggestionCheckpoint,
} from "./lib/memorySuggestion";
import { formatReviewGenerationResult } from "./lib/reviewGenerationResult";
import {
  createReviewLibraryDraft,
  getDailyReviewLibraryHead,
  getDailyReviewLibraryRevision,
  getVisibleDailyReviewLibraryItems,
  resolveDailyReviewLibraryState,
  type ReviewLibraryDraft,
} from "./lib/reviewLibraryPublication";
import { toConversationReadProgressView } from "./lib/conversationReadProgress";
import {
  createInitialReviewCheckpoint,
  createReviewSettingsFingerprint,
  createReviewTaskFingerprint,
  getReviewCheckpointExpiry,
  shouldShowReviewGenerationEntry,
} from "./lib/reviewGenerationTask";
import { resolveCollapsedConversationTaskEntry } from "./lib/conversationReviewWorkbench";
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
  cancelConversationReviewJob,
  getQuickCaptureRuntimeState,
  getSupportedVisionTypes,
  isDesktopRuntime,
  readSelectedConversationSessions,
  scanConversationSessionsExact,
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
  ConversationReviewGenerationRequest,
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
  MemorySuggestionGenerationResult,
  MemorySuggestionCheckpointV1,
  MemorySubView,
  ProcessStatus,
  ReadingStatus,
  ResizableLayoutState,
  RollingWorkReview,
  ReviewMemorySuggestionSource,
  ReviewGenerationTaskCheckpointV1,
  SearchResult,
  SmartView,
  SummaryReport,
  TodayDashboardData,
} from "./types";
import { PROCESS_STATUSES, READING_STATUSES } from "./types";

type StatusFilter = ProcessStatus | "all";
type ListView = { kind: "smart"; id: SmartView } | { kind: "folder"; folderId: string };
type ForegroundWorkspace = "scan" | "review" | null;
type ReviewLibraryNavigationContext =
  | { kind: "return-item"; itemId: string; reviewId: string }
  | { kind: "return-review"; reviewId: string; surface: "memory" | "today" };
type SummaryPrompt = {
  id: string;
  periodType: "day" | "week" | "month";
  periodStart: string;
  periodEnd: string;
  label: string;
};

async function updateReviewTaskCheckpoint(
  hooks: ReviewGenerationTaskHooks | undefined,
  patch: Partial<ReviewGenerationTaskCheckpointV1>,
) {
  if (!hooks) return;
  await hooks.onCheckpoint({ ...hooks.checkpoint, ...patch });
}

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
  cancelLabel?: string;
  secondaryLabel?: string;
  danger?: boolean;
  closeBeforeRun?: boolean;
  onCancel?: () => void;
  onConfirm: () => Promise<void>;
  onSecondary?: () => Promise<void>;
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

function createReviewGenerationJobId() {
  if ("randomUUID" in crypto) return crypto.randomUUID();
  return `review-generation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatReviewGenerationStageMessage(checkpoint: ReviewGenerationTaskCheckpointV1) {
  if (checkpoint.stage === "reading") return "正在读取所选会话。";
  if (checkpoint.stage === "summarizing") {
    return `正在整理分段 ${checkpoint.completedChunkCount}/${checkpoint.chunkCount}。`;
  }
  if (checkpoint.stage === "compacting") {
    return `正在压缩第 ${checkpoint.compactionLevel} 层摘要。`;
  }
  if (checkpoint.stage === "synthesizing") return "正在合成回顾。";
  if (checkpoint.stage === "memory-suggestion") return "正在分析长期记忆建议。";
  return "回顾已生成。";
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
  const mainWindowMaximized = useMainWindowMaximized();
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
  const [reviewGenerationTask, setReviewGenerationTask] = useState<ReviewGenerationRuntime | null>(null);
  const [conversationScanQuery, setConversationScanQuery] = useState<ConversationScanQuery>(DEFAULT_CONVERSATION_SCAN_QUERY);
  const [conversationScanTask, setConversationScanTask] = useState<ConversationScanRuntime | null>(null);
  const [lastCompletedConversationScanKey, setLastCompletedConversationScanKey] = useState("");
  const [foregroundWorkspace, setForegroundWorkspace] = useState<ForegroundWorkspace>(null);
  const [links, setLinks] = useState<KnowledgeLink[]>([]);
  const [todayDashboard, setTodayDashboard] = useState<TodayDashboardData | null>(null);
  const [todayDashboardResource, setTodayDashboardResource] = useState<AsyncResource<TodayDashboardData>>({ status: "loading" });
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
  const [reviewPublishSource, setReviewPublishSource] = useState<DailyConversationReview | null>(null);
  const [reviewPublishDraft, setReviewPublishDraft] = useState<ReviewLibraryDraft | null>(null);
  const [reviewPublishInitialDraft, setReviewPublishInitialDraft] = useState<ReviewLibraryDraft | null>(null);
  const [reviewPublishReturnSurface, setReviewPublishReturnSurface] = useState<"memory" | "today">("memory");
  const [reviewLibraryNavigation, setReviewLibraryNavigation] = useState<ReviewLibraryNavigationContext | null>(null);
  const [libraryItemNavigationStack, setLibraryItemNavigationStack] = useState<string[]>([]);
  const [todayAutoWorkReviewOpenRequestKey, setTodayAutoWorkReviewOpenRequestKey] = useState(0);
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
  const reviewGenerationTaskRef = useRef<ReviewGenerationRuntime | null>(null);
  const reviewGenerationAbortRef = useRef<AbortController | null>(null);
  const reviewGenerationJobIdRef = useRef("");
  const reviewGenerationRunRef = useRef(0);
  const reviewDraftRecoveryDoneRef = useRef(false);
  const conversationScanTaskRef = useRef<ConversationScanRuntime | null>(null);
  const autoWorkReviewRunningRef = useRef(false);
  const settingsRef = useRef<AiSettings | null>(null);
  const settingsPanelRef = useRef<SettingsPanelHandle | null>(null);
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
    if (loading) return;
    startConversationDateIndexCompletion();
    return () => {
      void pauseConversationDateIndexCompletion();
    };
  }, [loading]);

  useEffect(() => {
    reviewGenerationTaskRef.current = reviewGenerationTask;
  }, [reviewGenerationTask]);

  useEffect(() => {
    conversationScanTaskRef.current = conversationScanTask;
  }, [conversationScanTask]);

  const reviewGenerationWorkspaceOpen = foregroundWorkspace === "review";
  const conversationScanWorkspaceOpen = foregroundWorkspace === "scan";
  const openReviewGenerationWorkspace = () => setForegroundWorkspace("review");
  const closeReviewGenerationWorkspace = () => setForegroundWorkspace((current) => current === "review" ? null : current);
  const openConversationScanWorkspace = () => setForegroundWorkspace("scan");
  const closeConversationScanWorkspace = () => setForegroundWorkspace((current) => current === "scan" ? null : current);
  const collapsedConversationTaskEntry = resolveCollapsedConversationTaskEntry({
    reviewEntryVisible: shouldShowReviewGenerationEntry(
      activeView,
      Boolean(reviewGenerationTask),
      reviewGenerationWorkspaceOpen,
    ),
    reviewRunning: reviewGenerationTask?.status === "running",
    scanEntryVisible: shouldShowConversationScanEntry(
      activeView,
      conversationScanTask,
      conversationScanWorkspaceOpen,
    ),
  });

  useEffect(() => {
    if (loading || reviewDraftRecoveryDoneRef.current) return;
    reviewDraftRecoveryDoneRef.current = true;
    void (async () => {
      await removeExpiredConversationGenerationDrafts();
      const drafts = await getConversationGenerationDrafts();
      const normalized = await Promise.all(drafts.map(async (draft) => {
        if (draft.status !== "running") return draft;
        return updateConversationGenerationDraft(draft.id, {
          status: "paused",
          message: "Daymark 上次退出时任务尚未完成，可从检查点继续。",
          expiresAt: getReviewCheckpointExpiry(),
        });
      }));
      setConversationGenerationDrafts(normalized);
      const resumable = normalized.find((draft) => draft.checkpoint && (
        draft.status !== "completed"
        || draft.checkpoint.memorySuggestion?.status === "failed"
        || draft.checkpoint.memorySuggestion?.status === "cancelled"
      ));
      if (resumable?.checkpoint && !reviewGenerationTaskRef.current) {
        const request: ConversationReviewGenerationRequest = {
          reviewKey: resumable.reviewKey || `${resumable.date ?? "selected"}:${resumable.reviewKind}:${resumable.sourceKind ?? "mixed"}`,
          date: resumable.date || resumable.checkpoint.activityDateTo || resumable.checkpoint.activityDateFrom || toDateKey(new Date()),
          reviewKind: resumable.reviewKind,
          sourceKind: resumable.sourceKind,
          sourceLabel: resumable.sourceLabel,
          selectedSessionIds: resumable.selectedSessionIds,
          activityDateFrom: resumable.checkpoint.activityDateFrom,
          activityDateTo: resumable.checkpoint.activityDateTo,
        };
        const runtime: ReviewGenerationRuntime = {
          draftId: resumable.id,
          request,
          status: resumable.status === "running" ? "paused" : resumable.status,
          checkpoint: resumable.checkpoint,
          message: resumable.message,
          startedAt: resumable.checkpoint.startedAt,
          sessionCount: request.selectedSessionIds.length,
          messageCount: resumable.checkpoint.messageCount ?? 0,
          extractedChars: resumable.checkpoint.totalChars,
          retryCount: resumable.checkpoint.retryCount,
          resultReviewId: resumable.checkpoint.persistedReviewId,
          resultReviewDraftId: resumable.checkpoint.persistedReviewDraftId,
        };
        reviewGenerationTaskRef.current = runtime;
        setReviewGenerationTask(runtime);
        openReviewGenerationWorkspace();
      }
    })().catch(() => undefined);
  }, [loading]);

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
      setTodayDashboardResource({ status: "ready", data: dashboard });
    }
  };

  const retryTodayDashboard = useCallback(() => {
    const dashboardSeq = nextTodayDashboardSeq();
    setTodayDashboardResource((current) => current.data ? { status: "refreshing", data: current.data } : { status: "loading" });
    void Promise.all([
      withStartupTimeout(getItems(), "资料"),
      withStartupTimeout(getJournalEntries(), "日志"),
      withStartupTimeout(getMemoryCards(), "记忆"),
    ]).then(([loadedItems, loadedJournal, loadedMemories]) => {
      setItems(loadedItems);
      setJournalEntries(loadedJournal);
      setMemoryCards(loadedMemories);
      applyTodayDashboardIfCurrent(dashboardSeq, buildTodayDashboardData(loadedItems, loadedJournal, loadedMemories));
    }).catch((retryError) => {
      if (todayDashboardSeqRef.current !== dashboardSeq) return;
      setTodayDashboardResource((current) => ({
        status: "failed",
        ...(current.data ? { data: current.data } : {}),
        message: getSafeErrorMessage(retryError, "重新加载失败，请稍后再试。"),
      }));
    });
  }, []);

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
      const dashboardSeq = nextTodayDashboardSeq();
      const memorySharedSeq = nextMemorySharedSeq();
      const todayKey = toDateKey(new Date());
      const traceStartup = (stage: string, outcome: "ready" | "failed", startedAt: number) => {
        if (!import.meta.env.DEV || !globalThis.location.search.includes("qa-startup-trace")) return;
        console.info("[daymark:qa-startup]", { stage, outcome, elapsedMs: Math.round(performance.now() - startedAt) });
      };
      const start = performance.now();
      setTodayDashboardResource((current) => current.data ? { status: "refreshing", data: current.data } : { status: "loading" });

      try {
        await withStartupTimeout(seedDemoDataInDevIfEnabled(), "示例资料初始化");
        await withStartupTimeout(initializeDemoLibraryForFirstRun(), "资料库初始化");
      } catch (startupError) {
        if (mounted) setError(getSafeErrorMessage(startupError, "初始化失败，可继续使用已有资料。"));
      }

      const results = await Promise.allSettled([
        withStartupTimeout(getItems(), "资料"),
        withStartupTimeout(getFolders(), "目录"),
        withStartupTimeout(getJournalEntries(), "日志"),
        withStartupTimeout(getMemoryCards(), "记忆"),
        withStartupTimeout(getSummaryReports(), "总结"),
        withStartupTimeout(getMemoryDocument(), "长期记忆"),
        withStartupTimeout(getMemoryPatchDrafts(), "记忆审核"),
        withStartupTimeout(getCodexDailyReviews(), "回顾档案"),
        withStartupTimeout(getCodexSessionIndex(), "会话索引"),
        withStartupTimeout(getDailyReviewReplacementDrafts(), "回顾草稿"),
        withStartupTimeout(getConversationGenerationDrafts(), "生成任务"),
        withStartupTimeout(getKnowledgeLinks(), "资料关联"),
        withStartupTimeout(getAutoWorkReviewSettings(), "自动回顾设置"),
        withStartupTimeout(getRollingWorkReviews(), "自动回顾"),
      ]);
      if (!mounted) return;
      function valueAt<T>(index: number, fallback: T): T {
        const result = results[index];
        return result?.status === "fulfilled" ? result.value as T : fallback;
      }
      const loadedItems = valueAt<Item[]>(0, []);
      const loadedJournal = valueAt<JournalEntry[]>(2, []);
      const loadedMemories = valueAt<MemoryCard[]>(3, []);
      const dashboard = buildTodayDashboardData(loadedItems, loadedJournal, loadedMemories);
      setItems(loadedItems);
      setFolders(valueAt<FolderNode[]>(1, []));
      setJournalEntries(loadedJournal);
      setSummaryReports(valueAt<SummaryReport[]>(4, []));
      applyMemorySharedDataIfCurrent(memorySharedSeq, {
        loadedMemories,
        loadedMemoryDocument: valueAt<MemoryDocument | null>(5, null),
        loadedMemoryPatchDrafts: valueAt<MemoryPatchDraft[]>(6, []),
        loadedCodexReviews: valueAt<DailyConversationReview[]>(7, []),
        loadedCodexSessionIndex: valueAt<ConversationSessionIndex[]>(8, []),
        loadedDailyReviewDrafts: valueAt<DailyReviewReplacementDraft[]>(9, []),
        loadedConversationGenerationDrafts: valueAt<ConversationGenerationDraft[]>(10, []),
      });
      setLinks(valueAt<KnowledgeLink[]>(11, []));
      const loadedRollingWorkReviews = valueAt<RollingWorkReview[]>(13, []);
      setAutoWorkReviewSettings(valueAt<AutoWorkReviewSettings | null>(12, null));
      setRollingWorkReviews(loadedRollingWorkReviews);
      setRollingWorkReview(loadedRollingWorkReviews.find((review) => review.date === todayKey) ?? null);
      const dashboardInputsFailed = [0, 2, 3].every((index) => results[index]?.status === "rejected");
      if (dashboardInputsFailed) {
        setTodayDashboardResource({
          status: "failed",
          message: "资料、日志和记忆暂时无法读取，请重新加载。",
        });
      } else {
        applyTodayDashboardIfCurrent(dashboardSeq, dashboard);
      }
      setSelectedId("");
      void getDemoLibraryState().then((state) => mounted && setDemoLibraryState(state)).catch(() => undefined);
      applyAppearancePreference();

      const failed = results.filter((result) => result.status === "rejected");
      if (failed.length > 0) {
        setError("部分本地内容暂时未加载，可重新加载后再试。");
        traceStartup("core-data", "failed", start);
      } else {
        traceStartup("core-data", "ready", start);
      }
      // Credentials are optional startup metadata: never let a keychain error block the app shell.
      void withStartupTimeout(loadAiSettingsWithSecrets(), "AI 设置")
        .then((loaded) => {
          if (!mounted) return;
          setSettings(loaded.settings);
          if (loaded.notice) setError(loaded.notice);
          traceStartup("ai-settings", "ready", start);
        })
        .catch(() => {
          if (mounted) traceStartup("ai-settings", "failed", start);
        });
      if (mounted) setLoading(false);
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => bindSystemThemeListener(getThemeMode), []);

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
  const visibleItems = useMemo(() => getVisibleDailyReviewLibraryItems(items), [items]);
  const filteredItems = useMemo(
    () => getFilteredItems(visibleItems, activeView, statusFilter, query, activeFolderIds),
    [activeFolderIds, activeView, query, statusFilter, visibleItems],
  );

  const selectedItem =
    activeView.kind === "item"
      ? items.find((item) => item.id === activeView.itemId)
      : activeView.kind === "smart" || activeView.kind === "folder"
        ? items.find((item) => item.id === selectedId)
        : undefined;
  const reviewLibraryStatesBySourceKey = useMemo(() => {
    const states = new Map<string, NonNullable<ReturnType<typeof resolveDailyReviewLibraryState>>>();
    const sourceKeys = new Set(
      items.flatMap((item) => item.origin?.kind === "daily-review" ? [item.origin.sourceKey] : []),
    );
    sourceKeys.forEach((sourceKey) => {
      const state = resolveDailyReviewLibraryState(items, codexReviews, sourceKey);
      if (state) states.set(sourceKey, state);
    });
    return states;
  }, [codexReviews, items]);
  const publishedReviewItemIds = useMemo(() => {
    return Object.fromEntries(
      codexReviews.flatMap((review) => {
        const head = reviewLibraryStatesBySourceKey.get(review.reviewKey)?.head;
        return head ? [[review.id, head.id]] : [];
      }),
    ) as Record<string, string>;
  }, [codexReviews, reviewLibraryStatesBySourceKey]);
  const sourceChangedItemIds = useMemo(
    () => new Set(
      Array.from(reviewLibraryStatesBySourceKey.values())
        .filter((state) => state.status === "source-changed")
        .map((state) => state.head.id),
    ),
    [reviewLibraryStatesBySourceKey],
  );
  const sourceChangedReviewIds = useMemo(
    () => new Set(
      Array.from(reviewLibraryStatesBySourceKey.values())
        .filter((state) => state.status === "source-changed" && state.source)
        .map((state) => state.source!.id),
    ),
    [reviewLibraryStatesBySourceKey],
  );
  const selectedReviewLibraryState = useMemo<ReviewLibraryReaderState | null>(() => {
    const sourceKey = selectedItem?.origin?.kind === "daily-review"
      ? selectedItem.origin.sourceKey
      : "";
    const state = sourceKey ? reviewLibraryStatesBySourceKey.get(sourceKey) : undefined;
    if (!state) return null;
    const reviewTypeLabel = state.source?.reviewKind === "combined"
      ? "综合回顾"
      : state.source?.reviewKind === "auto-work"
        ? "自动工作回顾"
        : state.source
          ? "单来源回顾"
          : undefined;
    return {
      ...state,
      ...(reviewTypeLabel ? { reviewTypeLabel } : {}),
    };
  }, [reviewLibraryStatesBySourceKey, selectedItem]);
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
    const loadedVisibleItems = getVisibleDailyReviewLibraryItems(loadedItems);
    setSelectedId((current) => {
      if (nextSelectedId) return nextSelectedId;
      if (loadedItems.some((item) => item.id === current)) return current;
      return loadedVisibleItems[0]?.id ?? "";
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

  const blockUnsavedWorkNavigation = () => {
    if (editorDirty) {
      setError("资料编辑还没有保存。请先保存，或在编辑弹窗中选择放弃修改。");
      return true;
    }
    return false;
  };

  const blockUnsavedEditorNavigation = () => {
    if (!editorDirty) return false;
    setError("资料编辑还没有保存。请先保存，或在编辑弹窗中选择放弃修改。");
    return true;
  };

  const selectViewNow = (view: ActiveView) => {
    setReviewLibraryNavigation(null);
    setLibraryItemNavigationStack([]);
    setTodayAutoWorkReviewOpenRequestKey(0);
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

  const handleSelectView = (view: ActiveView) => {
    if (blockUnsavedWorkNavigation()) return false;
    if (activeView.kind === "settings" && view.kind !== "settings" && settingsDirty) {
      setPendingConfirm({
        title: "离开设置？",
        message: "AI 服务配置还有未保存的修改。你可以先保存并前往目标页面，或者放弃本次修改。",
        confirmLabel: "保存并前往",
        secondaryLabel: "放弃修改并前往",
        cancelLabel: "继续编辑",
        onConfirm: async () => {
          const saved = await settingsPanelRef.current?.save();
          if (!saved) throw new Error("设置保存失败，已留在当前页面。");
          setSettingsDirty(false);
          selectViewNow(view);
        },
        onSecondary: async () => {
          settingsPanelRef.current?.discard();
          setSettingsDirty(false);
          selectViewNow(view);
        },
      });
      return false;
    }
    return selectViewNow(view);
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
        void pauseConversationDateIndexCompletion();
        setImportOpen(true);
      }
      return navigated;
    }

    return handleSelectView({ kind: "memory", subView: "ai-review" });
  };

  const handleSelectItem = async (item: Item, preserveReviewNavigation = false) => {
    if (blockUnsavedEditorNavigation()) return;
    setLibraryItemNavigationStack([]);
    if (!preserveReviewNavigation) setReviewLibraryNavigation(null);
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
    setReviewLibraryNavigation(null);
    setLibraryItemNavigationStack([]);
    setTodayAutoWorkReviewOpenRequestKey(0);
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
    void pauseConversationDateIndexCompletion();
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
    await refreshLinks();
    setIsEditing(false);
  };

  const handleCreateImportedItems = async (drafts: ImportDraft[]) => {
    if (drafts.length === 0) return false;

    const result = await createItemsBatch(drafts.map((draftItem) => {
      const processStatus = draftItem.folderId ? PROCESS_TO_ORGANIZE : PROCESS_INBOX;
      return {
        title: draftItem.title.trim() || getPathBaseName(draftItem.filePath) || "未命名资料",
        type: draftItem.type,
        folderId: draftItem.folderId,
        processStatus,
        readingStatus: draftItem.readingStatus,
        tags: draftItem.tags.length > 0 ? draftItem.tags : ["资料"],
        content: draftItem.content,
        filePath: draftItem.filePath,
        aiSummary: "尚未生成 AI 摘要",
      };
    }));
    const lastCreatedId = result.created[result.created.length - 1]?.id ?? "";
    const skippedCount = result.duplicateItemIds.length;

    if (!lastCreatedId && skippedCount > 0) {
      setError(`已跳过 ${skippedCount} 条重复资料，没有创建新记录。`);
      const firstExistingItem = items.find((item) => item.id === result.duplicateItemIds[0]);
      if (firstExistingItem) await handleSelectItem(firstExistingItem);
      return false;
    }

    const attentionView: ListView = { kind: "smart", id: "attention" };
    setLastListView(attentionView);
    setActiveView(attentionView);
    setStatusFilter("all");
    setQuery("");
    await refreshLibraryData(lastCreatedId);
    await refreshLinks();
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
    applyAppearancePreference();
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
    await refreshLinks();
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
        const sourceKey = selectedItem.origin?.kind === "daily-review"
          ? selectedItem.origin.sourceKey
          : "";
        clearItemEditorDraft(selectedItem.id);
        await deleteItem(selectedItem.id);
        const remainingItems = items.filter((item) => item.id !== selectedItem.id);
        const remainingVisibleItems = getVisibleDailyReviewLibraryItems(remainingItems);
        const remainingHead = sourceKey
          ? getDailyReviewLibraryHead(remainingItems, sourceKey)
          : undefined;
        await refreshLibraryData(remainingHead?.id ?? remainingVisibleItems[0]?.id);
        await refreshLinks();
        setDraft(null);
        setTagText("");
        setIsEditing(false);
        if (remainingHead) {
          await handleSelectItem(
            remainingHead,
            reviewLibraryNavigation?.kind === "return-review",
          );
          return;
        }
        if (reviewLibraryNavigation?.kind === "return-review") {
          const navigation = reviewLibraryNavigation;
          setReviewLibraryNavigation(null);
          if (navigation.surface === "today") {
            setActiveView({ kind: "today" });
            setTodayAutoWorkReviewOpenRequestKey((current) => current + 1);
          } else {
            setActiveView({ kind: "memory", subView: "archive", reviewId: navigation.reviewId });
          }
          return;
        }
        setReviewLibraryNavigation(null);
        setActiveView(lastListView);
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
    if (Object.prototype.hasOwnProperty.call(patch, "content")) await refreshLinks();
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
        message: `${sourceText}。确认后才会调用 AI，结果会写入这条资料的「${changedFields}」字段，并显示处理记录。`,
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
          : "知识卡片生成失败，已保留本地草稿。",
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
      setError("正在整理上一条日志，请等待完成后再开始新的知识卡片。");
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
          setError("这条日志已提炼为知识卡片，已打开原卡片。");
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
        aiSummary: extractDraft.aiSummary || "从日志提炼的知识卡片。",
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
      if (!extractSourceId) await refreshLinks();
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

  const generateMemorySuggestionForReview = async (
    review: CodexDailyReview,
    source: { sourceReviewId?: string; sourceReviewDraftId?: string },
    onProgress?: (progress: CodexReviewProgress) => void,
    signal?: AbortSignal,
    reviewTaskHooks?: ReviewGenerationTaskHooks,
  ): Promise<MemorySuggestionGenerationResult> => {
    if (!settings || !aiConfigured) {
      return { status: "failed", error: "还没有配置 AI API Key。" };
    }

    const currentMemory = memoryDocument ?? (await getMemoryDocument());
    const sourceContentVersion = createReviewContentVersion(review.title, review.content);
    const memoryContentVersion = createMemoryContentVersion(currentMemory?.content ?? "");
    const sourceRecord = source.sourceReviewDraftId
      ? (await getDailyReviewReplacementDrafts()).find((item) => item.id === source.sourceReviewDraftId)
      : (await getCodexDailyReviews()).find((item) => item.id === source.sourceReviewId);
    const checkpointInput = {
      ...source,
      sourceContentVersion,
      memoryContentVersion,
    };
    let checkpoint = isMemorySuggestionCheckpointCurrent(sourceRecord?.memorySuggestionCheckpoint, checkpointInput)
      ? sourceRecord!.memorySuggestionCheckpoint!
      : isMemorySuggestionCheckpointCurrent(reviewTaskHooks?.checkpoint.memorySuggestion, checkpointInput)
        ? reviewTaskHooks!.checkpoint.memorySuggestion!
        : createMemorySuggestionCheckpoint(checkpointInput);

    const persistSuggestionCheckpoint = async (next: MemorySuggestionCheckpointV1) => {
      checkpoint = next;
      if (source.sourceReviewDraftId) {
        await updateDailyReviewReplacementDraft(source.sourceReviewDraftId, {
          memorySuggestionStatus: next.status,
          memorySuggestionCheckpoint: next,
        });
      } else if (source.sourceReviewId) {
        await updateCodexDailyReview(source.sourceReviewId, {
          memorySuggestionStatus: next.status,
          memorySuggestionCheckpoint: next,
        });
      }
      await updateReviewTaskCheckpoint(reviewTaskHooks, {
        memorySuggestion: next,
        memorySuggestionStatus: next.status === "created" || next.status === "none" || next.status === "failed" || next.status === "cancelled"
          ? next.status
          : undefined,
      });
    };

    if (checkpoint.status === "created" || checkpoint.status === "none") {
      const patchDraft = checkpoint.patchDraftId
        ? (await getMemoryPatchDrafts()).find((draft) => draft.id === checkpoint.patchDraftId)
        : undefined;
      return { status: checkpoint.status, patchDraft, checkpoint };
    }

    try {
      onProgress?.({ stage: "分析长期记忆", message: "正在分析长期记忆建议。" });
      const suggestionHooks: MemorySuggestionTaskHooks = {
        get checkpoint() {
          return checkpoint;
        },
        onCheckpoint: persistSuggestionCheckpoint,
      };
      const suggestion = await streamGenerateMemoryPatchFromReview(
        review,
        currentMemory?.content ?? "",
        settings,
        (progress) => onProgress?.(progress),
        signal,
        suggestionHooks,
      );
      if (signal?.aborted) throw new DOMException("已取消生成。", "AbortError");
      if (!suggestion.shouldCreate) {
        const existingDrafts = await getMemoryPatchDrafts();
        const existingDraft = existingDrafts.find(
          (draft) => draft.status === "pending" && (
            source.sourceReviewDraftId
              ? draft.sourceReviewDraftId === source.sourceReviewDraftId
              : draft.sourceReviewId === source.sourceReviewId
          ),
        );
        if (existingDraft) {
          await updateMemoryPatchDraft(existingDraft.id, { status: "ignored" });
        }
        const completed = updateMemorySuggestionCheckpoint(checkpoint, {
          status: "none",
          lastError: undefined,
          patchDraftId: undefined,
        });
        await persistSuggestionCheckpoint(completed);
        onProgress?.({ stage: "分析长期记忆", message: "本次未发现需要长期保留的新信息。" });
        return { status: "none", checkpoint: completed };
      }

      const patchDraft = await createMemoryPatchDraft({
        title: suggestion.title,
        rationale: suggestion.rationale,
        proposedContent: suggestion.proposedContent,
        sourceReviewId: source.sourceReviewId,
        sourceReviewDraftId: source.sourceReviewDraftId,
        sourceReviewContentVersion: createReviewContentVersion(review.title, review.content),
        status: "pending",
      });
      const completed = updateMemorySuggestionCheckpoint(checkpoint, {
        status: "created",
        lastError: undefined,
        patchDraftId: patchDraft.id,
      });
      await persistSuggestionCheckpoint(completed);
      return { status: "created", patchDraft, checkpoint: completed };
    } catch (error) {
      const cancelled = signal?.aborted || (error instanceof DOMException && error.name === "AbortError");
      const safeError = getSafeErrorMessage(error, cancelled ? "长期记忆建议生成已取消。" : "长期记忆建议未生成。");
      const failed = updateMemorySuggestionCheckpoint(checkpoint, {
        status: cancelled ? "cancelled" : "failed",
        lastError: safeError,
      });
      await persistSuggestionCheckpoint(failed).catch(() => undefined);
      onProgress?.({
        stage: "分析长期记忆",
        message: cancelled
          ? "长期记忆建议生成已取消，可稍后重试。"
          : "长期记忆建议未生成，可稍后重试。",
      });
      return { status: cancelled ? "cancelled" : "failed", checkpoint: failed, error: safeError };
    }
  };

  const handleGenerateCodexReview = async (
    input: CodexReviewInput,
    onProgress?: (progress: CodexReviewProgress) => void,
    signal?: AbortSignal,
    taskHooks?: ReviewGenerationTaskHooks,
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
      message: input.activityDateWarning || `准备读取 ${input.sessions.length} 个会话，共 ${input.totalChars.toLocaleString("zh-CN")} 字符。`,
    });
    const summary = await streamSummarizeConversationReview(
      input,
      settings,
      (progress) => onProgress?.(progress),
      signal,
      taskHooks,
    );
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
      activityDateFrom: input.activityDateFrom,
      activityDateTo: input.activityDateTo,
      sourceReviewIds: [],
      createdAt: formatTimestamp(),
      updatedAt: formatTimestamp(),
    };

    const existingReview = await getDailyConversationReviewByKey(reviewDraft.reviewKey);
    let review: CodexDailyReview;
    let storedAsReplacementDraft = false;
    let replacementDraftRecord: DailyReviewReplacementDraft | undefined;
    const persistedReplacementDraft = taskHooks?.checkpoint.persistedReviewDraftId
      ? (await getDailyReviewReplacementDrafts()).find(
        (draft) => draft.id === taskHooks.checkpoint.persistedReviewDraftId,
      )
      : undefined;
    const persistedReview = taskHooks?.checkpoint.persistedReviewId === existingReview?.id
      ? existingReview
      : undefined;

    if (persistedReplacementDraft && existingReview) {
      replacementDraftRecord = persistedReplacementDraft;
      review = existingReview;
      storedAsReplacementDraft = true;
    } else if (persistedReview) {
      review = persistedReview;
    } else if (existingReview) {
      replacementDraftRecord = await createDailyReviewReplacementDraft({
        reviewKey: reviewDraft.reviewKey,
        date: reviewDraft.date,
        reviewKind: reviewDraft.reviewKind,
        sourceKind: reviewDraft.sourceKind,
        sourceLabel: reviewDraft.sourceLabel,
        title: reviewDraft.title,
        content: reviewDraft.content,
        sessionCount: reviewDraft.sessionCount,
        sessionIds: reviewDraft.sessionIds ?? [],
        activityDateFrom: reviewDraft.activityDateFrom,
        activityDateTo: reviewDraft.activityDateTo,
        sourceReviewIds: [],
        status: "pending",
        targetReviewId: existingReview.id,
      });
      review = existingReview;
      storedAsReplacementDraft = true;
      onProgress?.({ stage: "整理长期记忆建议", message: "已存在同日回顾，新版本等待确认替换。" });
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
        activityDateFrom: reviewDraft.activityDateFrom,
        activityDateTo: reviewDraft.activityDateTo,
        sourceReviewIds: [],
      });
    }

    await updateReviewTaskCheckpoint(taskHooks, {
      stage: "memory-suggestion",
      persistedReviewId: storedAsReplacementDraft ? undefined : review.id,
      persistedReviewDraftId: replacementDraftRecord?.id,
      finalTitle: reviewDraft.title,
      finalContent: reviewDraft.content,
      lastError: undefined,
    });

    const memorySuggestion = await generateMemorySuggestionForReview(
      reviewDraft,
      replacementDraftRecord
        ? { sourceReviewDraftId: replacementDraftRecord.id }
        : { sourceReviewId: review.id },
      onProgress,
      signal,
      taskHooks,
    );
    await updateReviewTaskCheckpoint(taskHooks, {
      stage: "completed",
      memorySuggestionStatus: memorySuggestion.status,
      memorySuggestion: memorySuggestion.checkpoint,
      lastError: memorySuggestion.error,
    });

    await refreshMemoryData();
    return {
      review,
      patchDraft: memorySuggestion.patchDraft,
      replacementDraft: storedAsReplacementDraft,
      replacementDraftId: replacementDraftRecord?.id,
      memorySuggestionStatus: memorySuggestion.status,
    };
    } finally {
      reviewGenerationRunningRef.current.delete(generationKey);
    }
  };

  const handleReplaceCodexSessionIndex = async (records: CodexSessionIndex[]) => {
    const saved = await replaceConversationSessionIndex(records);
    setCodexSessionIndex(saved);
  };

  const updateConversationScanTask = (
    updater: (current: ConversationScanRuntime | null) => ConversationScanRuntime | null,
  ) => {
    setConversationScanTask((current) => {
      const next = updater(current);
      conversationScanTaskRef.current = next;
      return next;
    });
  };

  const handleStartConversationScan = async (requestedQuery: ConversationScanQuery) => {
    if (!isDesktopRuntime()) return;
    if (reviewGenerationTaskRef.current?.status === "running") {
      openReviewGenerationWorkspace();
      return;
    }
    if (isConversationScanActive(conversationScanTaskRef.current)) {
      openConversationScanWorkspace();
      return;
    }

    const query = normalizeConversationScanQuery(requestedQuery);
    const scanKey = createConversationScanKey(query);
    const options = toConversationScanOptions(query);
    const jobId = createConversationScanJobId();
    const runtime: ConversationScanRuntime = {
      jobId,
      status: "running",
      query,
      scanKey,
      startedAt: new Date().toISOString(),
      message: "正在准备本地会话扫描。",
    };

    setConversationScanQuery(query);
    conversationScanTaskRef.current = runtime;
    setConversationScanTask(runtime);
    openConversationScanWorkspace();
    await pauseConversationDateIndexCompletion();

    try {
      const result = await scanConversationSessionsExact(options, jobId, (progress) => {
        updateConversationScanTask((current) => current?.jobId === jobId
          ? {
              ...current,
              progress,
              message: formatConversationScanProgress(progress, query.dateFrom || query.dateTo ? "活动日期" : "会话"),
            }
          : current);
      });
      if (conversationScanTaskRef.current?.jobId !== jobId) return;
      await handleReplaceCodexSessionIndex(result.sessions);
      setLastCompletedConversationScanKey(scanKey);
      markConversationDateIndexUserScanCompleted();
      updateConversationScanTask((current) => current?.jobId === jobId
        ? {
            ...current,
            status: "completed",
            result,
            message: query.dateFrom || query.dateTo
              ? `找到 ${result.sessions.length} 个所选日期内有消息的会话，排除 ${result.excludedCount} 个候选。`
              : result.sessions.length > 0
                ? `找到 ${result.sessions.length} 个会话，可以返回结果页选择要生成回顾的会话。`
                : "没有找到符合当前条件的会话。",
          }
        : current);
    } catch (scanError) {
      if (conversationScanTaskRef.current?.jobId !== jobId) return;
      const safeMessage = getSafeErrorMessage(scanError, "扫描会话失败。");
      const cancelled = safeMessage.toLowerCase().includes("cancelled")
        || conversationScanTaskRef.current.status === "cancelling";
      updateConversationScanTask((current) => current?.jobId === jobId
        ? {
            ...current,
            status: cancelled ? "cancelled" : "failed",
            message: cancelled
              ? "扫描已取消，上一次完整扫描结果已保留。"
              : safeMessage,
          }
        : current);
    } finally {
      startConversationDateIndexCompletion({ sourceKinds: options.sourceKinds });
    }
  };

  const handleCancelConversationScan = async () => {
    const task = conversationScanTaskRef.current;
    if (!task || task.status !== "running") return;
    updateConversationScanTask((current) => current?.jobId === task.jobId
      ? { ...current, status: "cancelling", message: "正在安全停止扫描，上一次完整结果会保留。" }
      : current);
    try {
      await cancelConversationReviewJob(task.jobId);
    } catch (cancelError) {
      updateConversationScanTask((current) => current?.jobId === task.jobId
        ? {
            ...current,
            status: "running",
            message: `取消请求失败，扫描仍在继续。${getSafeErrorMessage(cancelError, "")}`,
          }
        : current);
    }
  };

  const handleOpenConversationScanResults = () => {
    closeConversationScanWorkspace();
    setActiveView({ kind: "memory", subView: "ai-review" });
  };

  const handleRetryConversationScan = () => {
    const query = conversationScanTaskRef.current?.query ?? conversationScanQuery;
    void handleStartConversationScan(query);
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
    let replacementDraftRecord: DailyReviewReplacementDraft | undefined;
    if (existingReview) {
      replacementDraftRecord = await createDailyReviewReplacementDraft({
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
      onProgress?.({ stage: "整理长期记忆建议", message: "已存在今日回顾，新版本等待确认替换。" });
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

    const memorySuggestion = await generateMemorySuggestionForReview(
      reviewDraft,
      replacementDraftRecord
        ? { sourceReviewDraftId: replacementDraftRecord.id }
        : { sourceReviewId: review.id },
      onProgress,
      signal,
    );

    await refreshMemoryData();
    return {
      review,
      patchDraft: memorySuggestion.patchDraft,
      replacementDraft: storedAsReplacementDraft,
      memorySuggestionStatus: memorySuggestion.status,
    };
    } finally {
      reviewGenerationRunningRef.current.delete(generationKey);
    }
  };

  const handleSaveGenerationDraft = async (draftInput: Omit<ConversationGenerationDraft, "id" | "createdAt" | "updatedAt">) => {
    const saved = await upsertConversationGenerationDraft(draftInput);
    setConversationGenerationDrafts((current) => [
      saved,
      ...current.filter((draft) => draft.id !== saved.id),
    ]);
    return saved;
  };

  const persistReviewGenerationDraft = async (
    id: string,
    patch: Partial<Omit<ConversationGenerationDraft, "id" | "createdAt" | "updatedAt">>,
  ) => {
    const saved = await updateConversationGenerationDraft(id, patch);
    setConversationGenerationDrafts((current) => [
      saved,
      ...current.filter((draft) => draft.id !== saved.id),
    ]);
    return saved;
  };

  const runReviewGenerationTask = async (
    draft: ConversationGenerationDraft,
    request: ConversationReviewGenerationRequest,
  ) => {
    const currentSettings = settingsRef.current;
    if (!currentSettings || getEffectiveAiSettings(currentSettings).keySource === "missing") {
      const safeError = "当前连接未配置 API Key，请先在设置中完成配置。";
      const failedCheckpoint: ReviewGenerationTaskCheckpointV1 = {
        ...draft.checkpoint!,
        lastError: safeError,
      };
      await persistReviewGenerationDraft(draft.id, {
        status: "failed",
        checkpoint: failedCheckpoint,
        message: safeError,
        expiresAt: getReviewCheckpointExpiry(),
      });
      setReviewGenerationTask((current) => current?.draftId === draft.id ? {
        ...current,
        status: "failed",
        checkpoint: failedCheckpoint,
        message: safeError,
      } : current);
      return;
    }
    const runId = reviewGenerationRunRef.current + 1;
    reviewGenerationRunRef.current = runId;
    reviewGenerationAbortRef.current?.abort();
    if (reviewGenerationJobIdRef.current) {
      void cancelConversationReviewJob(reviewGenerationJobIdRef.current);
    }

    const controller = new AbortController();
    const jobId = createReviewGenerationJobId();
    const checkpointRef = { current: draft.checkpoint! };
    const messageCounts = new Map<number, number>();
    reviewGenerationAbortRef.current = controller;
    reviewGenerationJobIdRef.current = jobId;

    const taskHooks: ReviewGenerationTaskHooks = {
      get checkpoint() {
        return checkpointRef.current;
      },
      onCheckpoint: async (nextCheckpoint) => {
        checkpointRef.current = nextCheckpoint;
        const stageMessage = formatReviewGenerationStageMessage(nextCheckpoint);
        await persistReviewGenerationDraft(draft.id, {
          checkpoint: nextCheckpoint,
          stage: nextCheckpoint.stage,
          message: stageMessage,
          partialContent: nextCheckpoint.finalContent ?? "",
          status: "running",
          expiresAt: getReviewCheckpointExpiry(),
        });
        if (reviewGenerationRunRef.current !== runId) return;
        setReviewGenerationTask((current) => current?.draftId === draft.id ? {
          ...current,
          checkpoint: nextCheckpoint,
          retryCount: nextCheckpoint.retryCount,
          message: stageMessage,
        } : current);
      },
    };

    await persistReviewGenerationDraft(draft.id, {
      status: "running",
      stage: checkpointRef.current.stage,
      message: checkpointRef.current.stage === "reading" ? "正在定位所选日期的会话内容。" : "正在从检查点继续生成。",
      expiresAt: getReviewCheckpointExpiry(),
    });
    setReviewGenerationTask((current) => current?.draftId === draft.id ? {
      ...current,
      status: "running",
      checkpoint: checkpointRef.current,
      message: checkpointRef.current.stage === "reading" ? "正在定位所选日期的会话内容。" : "正在从检查点继续生成。",
      startedAt: checkpointRef.current.startedAt,
    } : current);
    openReviewGenerationWorkspace();

    try {
      const input = await readSelectedConversationSessions(
        request.selectedSessionIds,
        jobId,
        {
          activityDateFrom: request.activityDateFrom,
          activityDateTo: request.activityDateTo,
        },
        (event) => {
          if (reviewGenerationRunRef.current !== runId) return;
          messageCounts.set(event.sessionIndex, event.messageCount);
          const nextProgress = toConversationReadProgressView(event);
          setReviewGenerationTask((current) => current?.draftId === draft.id ? {
            ...current,
            progress: nextProgress,
            message: nextProgress.message,
            messageCount: Array.from(messageCounts.values()).reduce((sum, value) => sum + value, 0),
            extractedChars: Math.max(current.extractedChars, event.extractedChars),
          } : current);
        },
      );
      if (controller.signal.aborted) throw new DOMException("已取消生成。", "AbortError");

      await taskHooks.onCheckpoint({
        ...checkpointRef.current,
        stage: checkpointRef.current.finalContent ? checkpointRef.current.stage : "summarizing",
        totalChars: input.totalChars,
        messageCount: Array.from(messageCounts.values()).reduce((sum, value) => sum + value, 0),
        chunkCount: input.transcriptChunks.filter((chunk) => chunk.trim()).length,
        lastError: undefined,
      });
      setReviewGenerationTask((current) => current?.draftId === draft.id ? {
        ...current,
        extractedChars: input.totalChars,
        sessionCount: input.sessions.length,
      } : current);

      const result = await handleGenerateCodexReview(
        input,
        (nextProgress) => {
          if (reviewGenerationRunRef.current !== runId) return;
          setReviewGenerationTask((current) => current?.draftId === draft.id ? {
            ...current,
            progress: nextProgress,
            message: nextProgress.message,
          } : current);
        },
        controller.signal,
        taskHooks,
      );
      const completedCheckpoint: ReviewGenerationTaskCheckpointV1 = {
        ...checkpointRef.current,
        stage: "completed",
        memorySuggestionStatus: result.memorySuggestionStatus,
        memorySuggestion: checkpointRef.current.memorySuggestion,
        persistedReviewId: result.replacementDraft ? undefined : result.review.id,
        persistedReviewDraftId: result.replacementDraftId,
        lastError: result.memorySuggestionStatus === "failed" || result.memorySuggestionStatus === "cancelled"
          ? checkpointRef.current.memorySuggestion?.lastError
          : undefined,
      };
      checkpointRef.current = completedCheckpoint;
      const suggestionNeedsAttention = result.memorySuggestionStatus === "failed" || result.memorySuggestionStatus === "cancelled";
      if (suggestionNeedsAttention) {
        const retained = await persistReviewGenerationDraft(draft.id, {
          status: "completed",
          stage: "completed",
          message: formatReviewGenerationResult(result),
          checkpoint: completedCheckpoint,
          partialContent: "",
          expiresAt: getReviewCheckpointExpiry(),
        });
        setConversationGenerationDrafts((current) => [retained, ...current.filter((item) => item.id !== retained.id)]);
      } else {
        await deleteConversationGenerationDraft(draft.id);
        setConversationGenerationDrafts((current) => current.filter((item) => item.id !== draft.id));
      }
      if (reviewGenerationRunRef.current === runId) {
        setReviewGenerationTask((current) => current?.draftId === draft.id ? {
          ...current,
          status: "completed",
          checkpoint: completedCheckpoint,
          retryCount: completedCheckpoint.retryCount,
          message: formatReviewGenerationResult(result),
          resultReviewId: result.replacementDraft ? undefined : result.review.id,
          resultReviewDraftId: result.replacementDraftId,
          progress: { stage: "生成回顾", message: formatReviewGenerationResult(result), indicator: { mode: "completed", percent: 100 } },
        } : current);
        if (suggestionNeedsAttention) {
          openReviewGenerationWorkspace();
        } else {
          closeReviewGenerationWorkspace();
          setActiveView(result.replacementDraftId
            ? { kind: "memory", subView: "archive", reviewDraftId: result.replacementDraftId }
            : { kind: "memory", subView: "archive", reviewId: result.review.id });
        }
      }
    } catch (error) {
      const cancelled = controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
      const safeError = getSafeErrorMessage(error, cancelled ? "任务已取消。" : "回顾生成失败。");
      const failedCheckpoint: ReviewGenerationTaskCheckpointV1 = {
        ...checkpointRef.current,
        lastError: safeError,
      };
      checkpointRef.current = failedCheckpoint;
      const status = cancelled ? "cancelled" : "failed";
      await persistReviewGenerationDraft(draft.id, {
        status,
        stage: failedCheckpoint.stage,
        message: safeError,
        checkpoint: failedCheckpoint,
        partialContent: failedCheckpoint.finalContent ?? "",
        expiresAt: getReviewCheckpointExpiry(),
      }).catch(() => undefined);
      if (reviewGenerationRunRef.current === runId) {
        setReviewGenerationTask((current) => current?.draftId === draft.id ? {
          ...current,
          status,
          checkpoint: failedCheckpoint,
          retryCount: failedCheckpoint.retryCount,
          message: safeError,
        } : current);
      }
    } finally {
      if (reviewGenerationRunRef.current === runId) {
        reviewGenerationAbortRef.current = null;
        reviewGenerationJobIdRef.current = "";
      }
    }
  };

  const handleStartReviewGeneration = async (request: ConversationReviewGenerationRequest) => {
    if (isConversationScanActive(conversationScanTaskRef.current)) {
      openConversationScanWorkspace();
      return;
    }
    if (reviewGenerationTaskRef.current?.status === "running") {
      openReviewGenerationWorkspace();
      return;
    }
    const currentSettings = settingsRef.current;
    if (!currentSettings || getEffectiveAiSettings(currentSettings).keySource === "missing") {
      throw new Error("还没有配置 AI API Key。");
    }
    const settingsFingerprint = await createReviewSettingsFingerprint(currentSettings);
    const taskFingerprint = await createReviewTaskFingerprint(request, settingsFingerprint);
    const checkpoint: ReviewGenerationTaskCheckpointV1 = {
      ...createInitialReviewCheckpoint({
        taskFingerprint,
        settingsFingerprint,
        activityDateFrom: request.activityDateFrom,
        activityDateTo: request.activityDateTo,
      }),
      provider: currentSettings.provider,
      protocol: currentSettings.protocol,
      model: currentSettings.model,
    };
    const draft = await handleSaveGenerationDraft({
      reviewKey: request.reviewKey,
      date: request.date,
      reviewKind: request.reviewKind,
      sourceKind: request.sourceKind,
      sourceLabel: request.sourceLabel,
      title: `${request.date} 回顾生成任务`,
      partialContent: "",
      selectedSessionIds: request.selectedSessionIds,
      stage: "reading",
      message: "正在定位所选日期的会话内容。",
      status: "running",
      checkpoint,
      expiresAt: getReviewCheckpointExpiry(),
    });
    const runtime: ReviewGenerationRuntime = {
      draftId: draft.id,
      request,
      status: "running",
      checkpoint,
      message: draft.message,
      startedAt: checkpoint.startedAt,
      sessionCount: request.selectedSessionIds.length,
      messageCount: 0,
      extractedChars: 0,
      retryCount: 0,
    };
    reviewGenerationTaskRef.current = runtime;
    setReviewGenerationTask(runtime);
    openReviewGenerationWorkspace();
    void runReviewGenerationTask(draft, request);
  };

  const requestFromGenerationDraft = (draft: ConversationGenerationDraft): ConversationReviewGenerationRequest => ({
    reviewKey: draft.reviewKey || `${draft.date ?? "selected"}:${draft.reviewKind}:${draft.sourceKind ?? "mixed"}`,
    date: draft.date || draft.checkpoint?.activityDateTo || draft.checkpoint?.activityDateFrom || toDateKey(new Date()),
    reviewKind: draft.reviewKind,
    sourceKind: draft.sourceKind,
    sourceLabel: draft.sourceLabel,
    selectedSessionIds: draft.selectedSessionIds,
    activityDateFrom: draft.checkpoint?.activityDateFrom,
    activityDateTo: draft.checkpoint?.activityDateTo,
  });

  const handleResumeReviewGeneration = async (draftId?: string) => {
    if (isConversationScanActive(conversationScanTaskRef.current)) {
      openConversationScanWorkspace();
      return;
    }
    const targetId = draftId ?? reviewGenerationTaskRef.current?.draftId;
    const draft = conversationGenerationDrafts.find((item) => item.id === targetId);
    if (!draft?.checkpoint) return;
    const request = requestFromGenerationDraft(draft);
    const runtime: ReviewGenerationRuntime = {
      draftId: draft.id,
      request,
      status: "running",
      checkpoint: draft.checkpoint,
      message: "正在从检查点继续生成。",
      startedAt: draft.checkpoint.startedAt,
      sessionCount: request.selectedSessionIds.length,
      messageCount: draft.checkpoint.messageCount ?? 0,
      extractedChars: draft.checkpoint.totalChars,
      retryCount: draft.checkpoint.retryCount,
      resultReviewId: draft.checkpoint.persistedReviewId,
      resultReviewDraftId: draft.checkpoint.persistedReviewDraftId,
    };
    if (
      draft.checkpoint.stage === "memory-suggestion" &&
      (draft.checkpoint.persistedReviewId || draft.checkpoint.persistedReviewDraftId)
    ) {
      const suggestionRuntime: ReviewGenerationRuntime = {
        ...runtime,
        status: "completed",
        message: "回顾已保存，正在恢复长期记忆建议步骤。",
      };
      reviewGenerationTaskRef.current = suggestionRuntime;
      setReviewGenerationTask(suggestionRuntime);
      openReviewGenerationWorkspace();
      void handleRetryReviewTaskMemorySuggestion();
      return;
    }
    reviewGenerationTaskRef.current = runtime;
    setReviewGenerationTask(runtime);
    openReviewGenerationWorkspace();
    void runReviewGenerationTask(draft, request);
  };

  const handleRestartReviewGeneration = async (draftId?: string) => {
    if (isConversationScanActive(conversationScanTaskRef.current)) {
      openConversationScanWorkspace();
      return;
    }
    const targetId = draftId ?? reviewGenerationTaskRef.current?.draftId;
    const draft = conversationGenerationDrafts.find((item) => item.id === targetId);
    const currentSettings = settingsRef.current;
    if (!draft || !currentSettings) return;
    reviewGenerationAbortRef.current?.abort();
    if (reviewGenerationJobIdRef.current) void cancelConversationReviewJob(reviewGenerationJobIdRef.current);
    const request = requestFromGenerationDraft(draft);
    const settingsFingerprint = await createReviewSettingsFingerprint(currentSettings);
    const taskFingerprint = await createReviewTaskFingerprint(request, settingsFingerprint);
    const checkpoint: ReviewGenerationTaskCheckpointV1 = {
      ...createInitialReviewCheckpoint({
        taskFingerprint,
        settingsFingerprint,
        activityDateFrom: request.activityDateFrom,
        activityDateTo: request.activityDateTo,
      }),
      provider: currentSettings.provider,
      protocol: currentSettings.protocol,
      model: currentSettings.model,
    };
    const resetDraft = await persistReviewGenerationDraft(draft.id, {
      status: "running",
      stage: "reading",
      message: "正在重新定位会话内容。",
      partialContent: "",
      checkpoint,
      expiresAt: getReviewCheckpointExpiry(),
    });
    const runtime: ReviewGenerationRuntime = {
      draftId: draft.id,
      request,
      status: "running",
      checkpoint,
      message: "正在重新定位会话内容。",
      startedAt: checkpoint.startedAt,
      sessionCount: request.selectedSessionIds.length,
      messageCount: 0,
      extractedChars: 0,
      retryCount: 0,
    };
    reviewGenerationTaskRef.current = runtime;
    setReviewGenerationTask(runtime);
    openReviewGenerationWorkspace();
    void runReviewGenerationTask(resetDraft, request);
  };

  const handleCancelReviewGeneration = () => {
    reviewGenerationAbortRef.current?.abort(new DOMException("已取消生成。", "AbortError"));
    if (reviewGenerationJobIdRef.current) void cancelConversationReviewJob(reviewGenerationJobIdRef.current);
    setReviewGenerationTask((current) => current ? { ...current, message: "正在停止并保存检查点。" } : current);
  };

  const handleDeleteReviewGeneration = async (draftId?: string) => {
    const targetId = draftId ?? reviewGenerationTaskRef.current?.draftId;
    if (!targetId) return;
    if (reviewGenerationTaskRef.current?.draftId === targetId) {
      reviewGenerationAbortRef.current?.abort();
      reviewGenerationRunRef.current += 1;
      setReviewGenerationTask(null);
      reviewGenerationTaskRef.current = null;
      closeReviewGenerationWorkspace();
    }
    await deleteConversationGenerationDraft(targetId);
    setConversationGenerationDrafts((current) => current.filter((item) => item.id !== targetId));
  };

  const requestRestartReviewGeneration = async (draftId?: string) => {
    setPendingConfirm({
      title: "重新开始生成？",
      message: "现有检查点和已完成分段摘要将被删除，任务会从读取会话重新开始。",
      confirmLabel: "重新开始",
      cancelLabel: "保留检查点",
      danger: true,
      onConfirm: async () => handleRestartReviewGeneration(draftId),
    });
  };

  const requestDeleteReviewGeneration = async (draftId?: string) => {
    setPendingConfirm({
      title: "删除生成任务？",
      message: "任务检查点和已完成分段摘要将被删除，且无法恢复。已经保存的正式回顾不会受影响。",
      confirmLabel: "删除任务",
      cancelLabel: "取消",
      danger: true,
      onConfirm: async () => handleDeleteReviewGeneration(draftId),
    });
  };

  const handleOpenReviewGenerationResult = () => {
    const task = reviewGenerationTaskRef.current;
    if (!task) return;
    closeReviewGenerationWorkspace();
    if (task.resultReviewDraftId) {
      setActiveView({ kind: "memory", subView: "archive", reviewDraftId: task.resultReviewDraftId });
    } else if (task.resultReviewId) {
      setActiveView({ kind: "memory", subView: "archive", reviewId: task.resultReviewId });
    }
  };

  const handleUpdateCodexReview = async (id: string, patch: Partial<CodexDailyReview>) => {
    await updateCodexDailyReview(id, patch);
    await refreshMemoryData();
  };

  const closeReviewPublishDialog = () => {
    setReviewPublishSource(null);
    setReviewPublishDraft(null);
    setReviewPublishInitialDraft(null);
  };

  const handlePublishDailyReview = async (
    reviewId: string,
    returnSurface: "memory" | "today" = "memory",
  ) => {
    try {
      const latestReview = await getDailyConversationReviewById(reviewId);
      if (!latestReview) {
        setError("找不到这份正式回顾，请刷新回顾档案后重试。");
        return;
      }

      const existingItem = getDailyReviewLibraryHead(items, latestReview.reviewKey);
      if (existingItem) {
        if (
          reviewLibraryNavigation?.kind === "return-item"
          && reviewLibraryNavigation.reviewId === reviewId
        ) {
          setReviewLibraryNavigation(null);
          await handleSelectItem(existingItem);
          return;
        }
        setReviewLibraryNavigation({ kind: "return-review", reviewId, surface: returnSurface });
        await handleSelectItem(existingItem, true);
        return;
      }

      const initialDraft = createReviewLibraryDraft(
        latestReview,
        createReviewContentVersion(latestReview.title, latestReview.content),
      );
      setReviewPublishSource(latestReview);
      setReviewPublishDraft(initialDraft);
      setReviewPublishInitialDraft(initialDraft);
      setReviewPublishReturnSurface(returnSurface);
    } catch (publishError) {
      setError(getSafeErrorMessage(publishError, "打开回顾资料草稿失败。"));
    }
  };

  const handleSaveReviewPublishDraft = async () => {
    if (!reviewPublishDraft || !reviewPublishSource) return;
    const sourceReviewId = reviewPublishSource.id;
    const result = await publishDailyReviewToLibrary(reviewPublishDraft);
    await refreshLibraryData(result.item.id);
    await refreshLinks();
    setReviewLibraryNavigation({
      kind: "return-review",
      reviewId: sourceReviewId,
      surface: reviewPublishReturnSurface,
    });
    closeReviewPublishDialog();
    await handleSelectItem(result.item, true);
  };

  const handleOpenReviewSource = (reviewId: string) => {
    if (!selectedItem) return;
    setReviewLibraryNavigation({ kind: "return-item", itemId: selectedItem.id, reviewId });
    setActiveView({ kind: "memory", subView: "archive", reviewId });
    setIsEditing(false);
    setDraft(null);
  };

  const handleReviewReaderClose = (reviewId: string) => {
    const navigation = reviewLibraryNavigation;
    if (navigation?.kind === "return-item" && navigation.reviewId === reviewId) {
      const item = items.find((candidate) => candidate.id === navigation.itemId);
      setReviewLibraryNavigation(null);
      if (item) {
        void handleSelectItem(item);
        return;
      }
    }
    setActiveView({ kind: "memory", subView: "archive" });
  };

  const handleBackFromReviewLibraryItem = () => {
    if (libraryItemNavigationStack.length > 0) {
      const previousId = libraryItemNavigationStack[libraryItemNavigationStack.length - 1];
      const previous = items.find((item) => item.id === previousId);
      const remaining = libraryItemNavigationStack.slice(0, -1);
      if (previous) {
        void handleSelectItem(previous, true).then(() => setLibraryItemNavigationStack(remaining));
        return;
      }
      setLibraryItemNavigationStack(remaining);
    }
    const navigation = reviewLibraryNavigation;
    if (navigation?.kind !== "return-review") {
      handleSelectView(lastListView);
      return;
    }
    setReviewLibraryNavigation(null);
    if (navigation.surface === "today") {
      setActiveView({ kind: "today" });
      setTodayAutoWorkReviewOpenRequestKey((current) => current + 1);
      return;
    }
    setActiveView({ kind: "memory", subView: "archive", reviewId: navigation.reviewId });
  };

  const handleOpenReviewLibraryItem = async (itemId: string) => {
    const target = items.find((item) => item.id === itemId);
    if (!target) throw new Error("找不到这份资料版本，请刷新后重试。");
    await handleSelectItem(target, true);
  };

  const handleApplyReviewLibraryUpdate: NonNullable<ItemReaderProps["onApplyReviewLibraryUpdate"]> = async (
    mode,
    finalDraft,
    context,
  ) => {
    const result = await applyDailyReviewLibraryUpdate({
      mode,
      itemId: context.item.id,
      expectedItemUpdatedAt: context.item.updatedAt,
      expectedItemContentVersion: createReviewContentVersion(context.item.title, context.item.content),
      expectedRecordedSourceVersion: context.item.origin?.contentVersion ?? "",
      expectedHeadId: context.item.id,
      expectedHeadRevision: getDailyReviewLibraryRevision(context.item),
      expectedHeadUpdatedAt: context.item.updatedAt,
      expectedHeadItemContentVersion: createReviewContentVersion(context.item.title, context.item.content),
      expectedHeadRecordedSourceVersion: context.item.origin?.contentVersion ?? "",
      sourceId: context.source.id,
      sourceKey: context.source.reviewKey,
      expectedSourceVersion: createReviewContentVersion(context.source.title, context.source.content),
      title: finalDraft.title,
      content: finalDraft.content,
    });
    await refreshLibraryData(result.item.id);
    await refreshLinks();
    await handleSelectItem(result.item, true);
  };

  const handleRestoreReviewLibraryVersion: NonNullable<ItemReaderProps["onRestoreReviewLibraryVersion"]> = async (
    version,
    expectedCurrentItem,
  ) => {
    if (version.origin?.kind !== "daily-review" || expectedCurrentItem.origin?.kind !== "daily-review") {
      throw new Error("这份资料不属于回顾版本链。");
    }
    const result = await restoreDailyReviewLibraryVersion({
      itemId: version.id,
      expectedItemUpdatedAt: version.updatedAt,
      expectedItemContentVersion: createReviewContentVersion(version.title, version.content),
      expectedRecordedSourceVersion: version.origin.contentVersion,
      expectedHeadId: expectedCurrentItem.id,
      expectedHeadRevision: getDailyReviewLibraryRevision(expectedCurrentItem),
      expectedHeadUpdatedAt: expectedCurrentItem.updatedAt,
      expectedHeadItemContentVersion: createReviewContentVersion(
        expectedCurrentItem.title,
        expectedCurrentItem.content,
      ),
      expectedHeadRecordedSourceVersion: expectedCurrentItem.origin.contentVersion,
      sourceKey: version.origin.sourceKey,
    });
    await refreshLibraryData(result.item.id);
    await refreshLinks();
    await handleSelectItem(result.item, true);
  };

  const handleUpdateDailyReviewDraft = async (id: string, patch: Partial<DailyReviewReplacementDraft>) => {
    const updated = await updateDailyReviewReplacementDraft(id, patch);
    await refreshMemoryData();
    return updated;
  };

  const handleGenerateMemorySuggestion = async (
    source: ReviewMemorySuggestionSource,
    onProgress?: (progress: CodexReviewProgress) => void,
    signal?: AbortSignal,
  ): Promise<MemorySuggestionGenerationResult> => {
    const sourceReview = source.kind === "review" ? source.review : source.draft;
    const review: CodexDailyReview = {
      id: source.kind === "review" ? source.review.id : source.draft.targetReviewId ?? source.draft.id,
      reviewKey: sourceReview.reviewKey,
      date: sourceReview.date,
      reviewKind: sourceReview.reviewKind,
      sourceKind: sourceReview.sourceKind,
      sourceLabel: sourceReview.sourceLabel,
      title: sourceReview.title,
      content: sourceReview.content,
      sessionCount: sourceReview.sessionCount,
      sessionIds: sourceReview.sessionIds,
      activityDateFrom: sourceReview.activityDateFrom,
      activityDateTo: sourceReview.activityDateTo,
      sourceReviewIds: sourceReview.sourceReviewIds,
      createdAt: sourceReview.createdAt,
      updatedAt: sourceReview.updatedAt,
    };
    const result = await generateMemorySuggestionForReview(
      review,
      source.kind === "review"
        ? { sourceReviewId: source.review.id }
        : { sourceReviewDraftId: source.draft.id },
      onProgress,
      signal,
    );
    await refreshMemoryData();
    return result;
  };

  const handleRetryReviewTaskMemorySuggestion = async () => {
    const task = reviewGenerationTaskRef.current;
    if (!task || task.status === "running") return;
    const checkpoint = task.checkpoint;
    const source: ReviewMemorySuggestionSource | undefined = checkpoint.persistedReviewDraftId
      ? (() => {
          const draft = dailyReviewDrafts.find((item) => item.id === checkpoint.persistedReviewDraftId);
          return draft ? { kind: "replacement" as const, draft } : undefined;
        })()
      : (() => {
          const review = codexReviews.find((item) => item.id === checkpoint.persistedReviewId);
          return review ? { kind: "review" as const, review } : undefined;
        })();
    if (!source) {
      setReviewGenerationTask((current) => current ? {
        ...current,
        message: "找不到已保存的来源回顾，无法重试长期记忆建议。",
      } : current);
      return;
    }

    const controller = new AbortController();
    reviewGenerationAbortRef.current?.abort();
    reviewGenerationAbortRef.current = controller;
    const runningCheckpoint: ReviewGenerationTaskCheckpointV1 = {
      ...checkpoint,
      stage: "memory-suggestion",
      lastError: undefined,
      memorySuggestionStatus: undefined,
      memorySuggestion: checkpoint.memorySuggestion
        ? updateMemorySuggestionCheckpoint(checkpoint.memorySuggestion, { status: "pending", lastError: undefined })
        : undefined,
    };
    setReviewGenerationTask((current) => current ? {
      ...current,
      status: "running",
      checkpoint: runningCheckpoint,
      message: "正在重新分析长期记忆建议。",
      progress: { stage: "分析长期记忆", message: "正在重新分析长期记忆建议。" },
    } : current);
    openReviewGenerationWorkspace();
    await persistReviewGenerationDraft(task.draftId, {
      status: "running",
      stage: "memory-suggestion",
      checkpoint: runningCheckpoint,
      message: "正在重新分析长期记忆建议。",
      expiresAt: getReviewCheckpointExpiry(),
    }).catch(() => undefined);

    try {
      const result = await handleGenerateMemorySuggestion(
        source,
        (progress) => setReviewGenerationTask((current) => current ? {
          ...current,
          message: progress.message,
          progress,
        } : current),
        controller.signal,
      );
      const completedCheckpoint: ReviewGenerationTaskCheckpointV1 = {
        ...runningCheckpoint,
        stage: "completed",
        memorySuggestionStatus: result.status,
        memorySuggestion: result.checkpoint,
        lastError: result.error,
      };
      const resultMessage = formatReviewGenerationResult({
        replacementDraft: source.kind === "replacement",
        patchDraft: result.patchDraft,
        memorySuggestionStatus: result.status,
      });
      if (result.status === "created" || result.status === "none") {
        await deleteConversationGenerationDraft(task.draftId).catch(() => undefined);
        setConversationGenerationDrafts((current) => current.filter((item) => item.id !== task.draftId));
      } else {
        const retained = await persistReviewGenerationDraft(task.draftId, {
          status: "completed",
          stage: "completed",
          checkpoint: completedCheckpoint,
          message: resultMessage,
          expiresAt: getReviewCheckpointExpiry(),
        });
        setConversationGenerationDrafts((current) => [retained, ...current.filter((item) => item.id !== retained.id)]);
      }
      setReviewGenerationTask((current) => current ? {
        ...current,
        status: "completed",
        checkpoint: completedCheckpoint,
        retryCount: completedCheckpoint.retryCount + (result.checkpoint?.retryCount ?? 0),
        message: resultMessage,
        progress: { stage: "分析长期记忆", message: resultMessage, indicator: { mode: "completed", percent: 100 } },
      } : current);
    } catch (error) {
      const safeError = getSafeErrorMessage(error, "长期记忆建议未生成。");
      const failedSuggestion = runningCheckpoint.memorySuggestion
        ? updateMemorySuggestionCheckpoint(runningCheckpoint.memorySuggestion, {
            status: "failed",
            lastError: safeError,
          })
        : undefined;
      const failedCheckpoint: ReviewGenerationTaskCheckpointV1 = {
        ...runningCheckpoint,
        stage: "completed",
        memorySuggestionStatus: "failed",
        memorySuggestion: failedSuggestion,
        lastError: safeError,
      };
      const resultMessage = `回顾已保存。长期记忆建议未生成，可稍后重试。${safeError ? ` ${safeError}` : ""}`;
      await persistReviewGenerationDraft(task.draftId, {
        status: "completed",
        stage: "completed",
        checkpoint: failedCheckpoint,
        message: resultMessage,
        expiresAt: getReviewCheckpointExpiry(),
      }).catch(() => undefined);
      setReviewGenerationTask((current) => current ? {
        ...current,
        status: "completed",
        checkpoint: failedCheckpoint,
        message: resultMessage,
        progress: { stage: "分析长期记忆", message: resultMessage, indicator: { mode: "completed", percent: 100 } },
      } : current);
    } finally {
      reviewGenerationAbortRef.current = null;
      await refreshMemoryData().catch(() => undefined);
    }
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

  const handleCreateLink: ItemReaderProps["onCreateLink"] = async (input) => {
    await createKnowledgeLink(input);
    await refreshLinks();
  };

  const handleOpenItemReference = (itemId: string) => {
    const target = items.find((item) => item.id === itemId);
    if (!target || !selectedItem || target.id === selectedItem.id) return;
    const previousStack = libraryItemNavigationStack;
    const sourceId = selectedItem.id;
    void handleSelectItem(target, true).then(() => setLibraryItemNavigationStack([...previousStack, sourceId]));
  };

  const handleDeleteLink = async (id: string) => {
    await deleteKnowledgeLink(id);
    await refreshLinks();
  };

  const handleOpenEntity = (kind: EntityKind, id: string) => {
    setReviewLibraryNavigation(null);
    setLibraryItemNavigationStack([]);
    setTodayAutoWorkReviewOpenRequestKey(0);
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
    setReviewLibraryNavigation(null);
    setTodayAutoWorkReviewOpenRequestKey(0);
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
      <div className="app-shell">
        <StartupScreen ready={!loading} onComplete={handleStartupComplete} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <MainWindowTitleBar maximized={mainWindowMaximized} />
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <Sidebar
          folders={folders}
          items={visibleItems}
          sourceChangedItemIds={sourceChangedItemIds}
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
              dashboardResource={todayDashboardResource}
              onRetryDashboard={retryTodayDashboard}
              focusComposerRequest={todayComposerFocusRequest}
              settings={settings}
              autoWorkReviewSettings={autoWorkReviewSettings}
              rollingWorkReview={rollingWorkReview}
              autoWorkReviewRunning={autoWorkReviewRunning}
              autoWorkReviewProgress={autoWorkReviewProgress}
              codexReviews={codexReviews}
              publishedReviewItemIds={publishedReviewItemIds}
              sourceChangedReviewIds={sourceChangedReviewIds}
              autoWorkReviewOpenRequestKey={todayAutoWorkReviewOpenRequestKey}
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
              onPublishDailyReview={(reviewId) => handlePublishDailyReview(reviewId, "today")}
              onAutoWorkReviewReaderClose={() => {
                setReviewLibraryNavigation(null);
                setTodayAutoWorkReviewOpenRequestKey(0);
              }}
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
              publishedReviewItemIds={publishedReviewItemIds}
              sourceChangedReviewIds={sourceChangedReviewIds}
              rollingWorkReviews={rollingWorkReviews}
              codexSessionIndex={codexSessionIndex}
              dailyReviewDrafts={dailyReviewDrafts}
              conversationGenerationDrafts={conversationGenerationDrafts}
              reviewGenerationTask={reviewGenerationTask}
              conversationScanQuery={conversationScanQuery}
              conversationScanTask={conversationScanTask}
              lastCompletedConversationScanKey={lastCompletedConversationScanKey}
              settings={settings}
              initialSubView={activeView.kind === "memory" ? activeView.subView : undefined}
              onSubViewChange={(subView) => {
                setActiveView((current) => current.kind === "memory" ? { kind: "memory", subView } : current);
              }}
              initialMemoryId={activeView.kind === "memory" ? activeView.memoryId : undefined}
              initialReviewId={activeView.kind === "memory" ? activeView.reviewId : undefined}
              initialReviewDraftId={activeView.kind === "memory" ? activeView.reviewDraftId : undefined}
              initialSummaryId={activeView.kind === "memory" ? activeView.summaryId : undefined}
              mainWindowMaximized={mainWindowMaximized}
              onUpdateMemory={handleUpdateMemory}
              onGenerateCombinedReview={handleGenerateCombinedReview}
              onStartReviewGeneration={handleStartReviewGeneration}
              onOpenReviewGeneration={openReviewGenerationWorkspace}
              onConversationScanQueryChange={setConversationScanQuery}
              onStartConversationScan={handleStartConversationScan}
              onOpenConversationScan={openConversationScanWorkspace}
              onOpenSettings={() => handleSelectView({ kind: "settings" })}
              onResumeReviewGeneration={handleResumeReviewGeneration}
              onRestartReviewGeneration={requestRestartReviewGeneration}
              onDeleteReviewGeneration={requestDeleteReviewGeneration}
              onUpdateCodexReview={handleUpdateCodexReview}
              onUpdateDailyReviewDraft={handleUpdateDailyReviewDraft}
              onGenerateMemorySuggestion={handleGenerateMemorySuggestion}
              onApplyDailyReviewDraft={handleApplyDailyReviewDraft}
              onIgnoreDailyReviewDraft={handleIgnoreDailyReviewDraft}
              onArchiveRollingWorkReview={handleArchiveRollingWorkReview}
              onPublishDailyReview={(reviewId) => handlePublishDailyReview(reviewId, "memory")}
              onReviewReaderClose={handleReviewReaderClose}
              onSaveMemoryDocument={handleSaveMemoryDocument}
              onApplyMemoryPatch={handleApplyMemoryPatch}
              onIgnoreMemoryPatch={handleIgnoreMemoryPatch}
            />
          ) : activeView.kind === "settings" ? (
            settings ? (
              <SettingsPanel
                ref={settingsPanelRef}
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
              backLabel={libraryItemNavigationStack.length > 0 ? "返回上一资料" : reviewLibraryNavigation?.kind === "return-review" ? "返回回顾" : "返回列表"}
              onBackToList={handleBackFromReviewLibraryItem}
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
              onOpenItemReference={handleOpenItemReference}
              reviewLibraryState={selectedReviewLibraryState}
              onOpenReviewSource={handleOpenReviewSource}
              onOpenReviewLibraryItem={handleOpenReviewLibraryItem}
              onApplyReviewLibraryUpdate={handleApplyReviewLibraryUpdate}
              onRestoreReviewLibraryVersion={handleRestoreReviewLibraryVersion}
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
                      items={visibleItems}
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
                items={visibleItems}
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
                    allItems={visibleItems}
                    sourceChangedItemIds={sourceChangedItemIds}
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
                    showBackButton={libraryItemNavigationStack.length > 0}
                    backLabel={libraryItemNavigationStack.length > 0 ? "返回上一资料" : reviewLibraryNavigation?.kind === "return-review" ? "返回回顾" : "返回列表"}
                    onBackToList={handleBackFromReviewLibraryItem}
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
                    onOpenItemReference={handleOpenItemReference}
                    reviewLibraryState={selectedReviewLibraryState}
                    onOpenReviewSource={handleOpenReviewSource}
                    onOpenReviewLibraryItem={handleOpenReviewLibraryItem}
                    onApplyReviewLibraryUpdate={handleApplyReviewLibraryUpdate}
                    onRestoreReviewLibraryVersion={handleRestoreReviewLibraryVersion}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
        {conversationScanTask && conversationScanWorkspaceOpen && (
          <ConversationScanWorkspace
            task={conversationScanTask}
            onCollapse={closeConversationScanWorkspace}
            onCancel={() => void handleCancelConversationScan()}
            onViewResults={handleOpenConversationScanResults}
            onRetry={handleRetryConversationScan}
          />
        )}
        {reviewGenerationTask && reviewGenerationWorkspaceOpen && (
          <ReviewGenerationWorkspace
            task={reviewGenerationTask}
            onCollapse={closeReviewGenerationWorkspace}
            onCancel={handleCancelReviewGeneration}
            onResume={() => void handleResumeReviewGeneration(reviewGenerationTask.draftId)}
            onRestart={() => requestRestartReviewGeneration(reviewGenerationTask.draftId)}
            onDelete={() => requestDeleteReviewGeneration(reviewGenerationTask.draftId)}
            onOpenResult={handleOpenReviewGenerationResult}
            onRetryMemorySuggestion={() => void handleRetryReviewTaskMemorySuggestion()}
          />
        )}
        {collapsedConversationTaskEntry === "review" && reviewGenerationTask && (
          <button
            className="review-generation-entry absolute bottom-5 right-5 z-30 flex max-w-[360px] items-center gap-3 border border-line bg-paper/96 px-4 py-3 text-left shadow-[0_14px_34px_rgba(0,0,0,0.18)] backdrop-blur-md"
            type="button"
            onClick={openReviewGenerationWorkspace}
            aria-label="打开回顾生成进度"
          >
            <span className={`review-generation-entry-dot ${reviewGenerationTask.status === "running" ? "is-running" : ""}`} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium text-ink">
                {reviewGenerationTask.status === "completed" &&
                (reviewGenerationTask.checkpoint.memorySuggestion?.status === "failed" ||
                  reviewGenerationTask.checkpoint.memorySuggestion?.status === "cancelled")
                  ? "回顾已保存，建议待处理"
                  : reviewGenerationTask.status === "completed"
                    ? "回顾已生成"
                    : reviewGenerationTask.status === "running"
                      ? "正在生成工作回顾"
                      : "回顾生成已暂停"}
              </span>
              <span className="mt-0.5 block truncate text-xs text-ink/48">{reviewGenerationTask.message}</span>
            </span>
            <ChevronRight size={15} className="shrink-0 text-ink/42" />
          </button>
        )}
        {collapsedConversationTaskEntry === "scan" && conversationScanTask && (
          <button
            className="review-generation-entry absolute bottom-5 right-5 z-30 flex max-w-[360px] items-center gap-3 border border-line bg-paper/96 px-4 py-3 text-left shadow-[0_14px_34px_rgba(0,0,0,0.18)] backdrop-blur-md"
            type="button"
            onClick={openConversationScanWorkspace}
            aria-label="打开会话扫描进度"
          >
            <span className={`review-generation-entry-dot ${isConversationScanActive(conversationScanTask) ? "is-running" : ""}`} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium text-ink">
                {conversationScanTask.status === "completed"
                  ? "会话扫描已完成"
                  : conversationScanTask.status === "cancelled"
                    ? "会话扫描已取消"
                    : conversationScanTask.status === "failed"
                      ? "会话扫描需要处理"
                      : "正在扫描 AI 对话"}
              </span>
              <span className="mt-0.5 block truncate text-xs text-ink/48">{conversationScanTask.message}</span>
            </span>
            <ChevronRight size={15} className="shrink-0 text-ink/42" />
          </button>
        )}
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
      <ReviewPublishDialog
        open={Boolean(reviewPublishSource)}
        review={reviewPublishSource}
        draft={reviewPublishDraft}
        initialDraft={reviewPublishInitialDraft}
        folders={folders}
        items={items}
        onDraftChange={setReviewPublishDraft}
        onClose={closeReviewPublishDialog}
        onSave={handleSaveReviewPublishDraft}
      />
      <EditorOverlay
        open={isEditing}
        draft={draft}
        folders={folders}
        items={items}
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
        cancelLabel={pendingConfirm?.cancelLabel}
        secondaryLabel={pendingConfirm?.secondaryLabel}
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
        onSecondary={pendingConfirm?.onSecondary ? async () => {
          const confirm = pendingConfirm;
          if (!confirm?.onSecondary) return;
          await confirm.onSecondary();
          setPendingConfirm(null);
        } : undefined}
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
    </div>
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
    title: `日志提炼 - ${createLocalTitleFromContent(entry.content)}`,
    content: entry.content,
    tags: Array.from(new Set([...entry.tags, "知识卡片"])),
    aiSummary: "从日志提炼的知识卡片",
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
                active ? "border-accent bg-accent/10 text-ink" : "border-line/70 text-ink/56 hover:border-line hover:text-ink"
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
                active ? "border-accent bg-accent/10 text-ink" : "border-line/70 text-ink/56 hover:border-line hover:text-ink"
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
