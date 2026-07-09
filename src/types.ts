export const ITEM_TYPES = ["note", "document", "archive", "url", "image", "project"] as const;
export const LEGACY_ITEM_STATUSES = ["未处理", "待阅读", "已整理", "已归档", "废弃"] as const;
export const PROCESS_STATUSES = ["收件箱", "待整理", "已整理", "已归档", "废弃"] as const;
export const READING_STATUSES = ["不需要", "待阅读", "阅读中", "已阅读", "需复习"] as const;
export const MEMORY_STATUSES = ["candidate", "active", "archived", "ignored"] as const;
export const MEMORY_PATCH_STATUSES = ["pending", "applied", "ignored"] as const;
export const THEME_MODES = ["dark", "light", "system"] as const;

export type ItemType = (typeof ITEM_TYPES)[number];
export type LegacyItemStatus = (typeof LEGACY_ITEM_STATUSES)[number];
export type ProcessStatus = (typeof PROCESS_STATUSES)[number];
export type ReadingStatus = (typeof READING_STATUSES)[number];
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];
export type MemoryPatchStatus = (typeof MEMORY_PATCH_STATUSES)[number];
export type ThemeMode = (typeof THEME_MODES)[number];

export type Item = {
  id: string;
  title: string;
  type: ItemType;
  status?: LegacyItemStatus;
  processStatus: ProcessStatus;
  readingStatus: ReadingStatus;
  folderId?: string;
  tags: string[];
  content: string;
  filePath?: string;
  sourceUrl?: string;
  aiSummary: string;
  todos?: string[];
  lastAiRunAt?: string;
  lastOpenedAt?: string;
  createdAt: string;
  updatedAt: string;
  favorite: boolean;
};

export type JournalEntry = {
  id: string;
  entryDate: string;
  content: string;
  tags: string[];
  todos: string[];
  createdAt: string;
  updatedAt: string;
};

export type SummaryReport = {
  id: string;
  periodType: "day" | "week" | "month";
  periodStart: string;
  periodEnd: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type MemoryCard = {
  id: string;
  title: string;
  content: string;
  category: string;
  status: MemoryStatus;
  sourceSummaryId?: string;
  sourceKind?: "journal-summary" | "codex-review";
  sourceReviewId?: string;
  createdAt: string;
  updatedAt: string;
};

export type FolderKind = "folder" | "system";

export type FolderNode = {
  id: string;
  title: string;
  kind: FolderKind;
  parentId?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type AiProvider = "deepseek" | "openai-compatible";

export type AiSettings = {
  id: "ai";
  provider: AiProvider;
  customProviderName?: string;
  baseUrl: string;
  model: string;
  useEnvKey: boolean;
  manualApiKey?: string;
  manualKeyStored?: boolean;
  manualKeyClearRequested?: boolean;
  supportsVision?: boolean;
  stream: boolean;
  themeMode: ThemeMode;
  updatedAt: string;
};

export type AiAction = "summarize" | "title" | "tags" | "todos";

export type FileTextExtractResult = {
  path: string;
  fileName: string;
  extension: string;
  sizeBytes: number;
  text: string;
  extractedChars: number;
  sentChars: number;
  charCount: number;
  truncated: boolean;
  redacted: boolean;
  quality: "ok" | "low" | "empty" | "unsupported";
  preview: string;
  warnings: string[];
};

export type ImageDataExtractResult = {
  path: string;
  fileName: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
  warnings: string[];
};

export type AiActionContext = {
  fileText?: string;
  fileName?: string;
  fileWarnings?: string[];
  sentCharCount?: number;
  imageDataUrl?: string;
  imageMimeType?: string;
  sourceStatus?: string;
};

export type AiRunReceipt = {
  action: AiAction;
  providerLabel: string;
  model: string;
  fileName?: string;
  extractedChars?: number;
  sentChars?: number;
  outputChars?: number;
  truncated: boolean;
  redacted: boolean;
  warnings: string[];
  createdAt: string;
};

export type AiRunDisplayState = {
  itemId?: string;
  status: "reading" | "sending" | "success" | "error";
  message: string;
  receipt?: AiRunReceipt;
  preview?: string;
  resultText?: string;
};

export type ResizableLayoutState = {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  libraryDirectoryWidth: number;
  libraryListWidth: number;
  libraryListCollapsed: boolean;
  libraryDirectoryCollapsed: boolean;
};

export type SmartView = "attention" | "inbox" | "unfiled" | "recent" | "favorite" | "reading";

export type EntityKind = "journal" | "item" | "memory" | "summary";

export type KnowledgeLink = {
  id: string;
  sourceKind: EntityKind;
  sourceId: string;
  targetKind: EntityKind;
  targetId: string;
  relation: string;
  createdAt: string;
};

export type MemorySubView = "document" | "ai-review" | "archive" | "patches" | "legacy";

export type SearchResultRoute =
  | { kind: "item"; itemId: string }
  | { kind: "journal"; date?: string; entryId?: string; summaryId?: string }
  | { kind: "memory"; subView?: MemorySubView; memoryId?: string; reviewId?: string; reviewDraftId?: string; summaryId?: string };

export type SearchResult = {
  kind: EntityKind;
  id: string;
  title: string;
  snippet: string;
  updatedAt: string;
  route?: SearchResultRoute;
};

export type JournalTodo = {
  id: string;
  entryId: string;
  content: string;
  entryDate: string;
};

export type TodayDashboardData = {
  todayJournalEntries: JournalEntry[];
  todayJournalEntryCount: number;
  pendingItems: Item[];
  pendingItemCount: number;
  readingItems: Item[];
  readingItemCount: number;
  candidateMemories: MemoryCard[];
  candidateMemoryCount: number;
  journalTodos: JournalTodo[];
  journalTodoCount: number;
};

export type ConversationSourceKind = "codex" | "claude";
export type ConversationReviewKind = "source" | "combined" | "auto-work";
export type ConversationProbeKind = "file" | "directory" | "database";
export type ReviewDraftStatus = "pending" | "applied" | "ignored";
export type GenerationDraftStatus = "running" | "cancelled" | "failed" | "completed";

export type ConversationSourceProbe = {
  id: string;
  sourceKind: ConversationSourceKind;
  label: string;
  path: string;
  exists: boolean;
  sizeBytes?: number;
  modifiedAt?: number;
  probeKind: ConversationProbeKind;
  message?: string;
};

export type ConversationSessionDay = {
  sourceKind: ConversationSourceKind;
  date: string;
  sessionCount: number;
  totalSizeBytes: number;
  latestModifiedAt: number;
};

export type ConversationSessionMeta = {
  id: string;
  sourceKind: ConversationSourceKind;
  sourceLabel: string;
  date: string;
  path: string;
  sizeBytes: number;
  modifiedAt: number;
  cwd?: string;
};

export type ConversationSessionIndex = ConversationSessionMeta & {
  cwd?: string;
  title: string;
  preview: string;
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  charCount: number;
};

export type ConversationSessionIndexOptions = {
  sourceKinds?: ConversationSourceKind[];
  dateFrom?: string;
  dateTo?: string;
  cwdQuery?: string;
  keyword?: string;
  limit?: number;
};

export type ConversationReviewInput = {
  date: string;
  sourceKinds: ConversationSourceKind[];
  reviewKind: ConversationReviewKind;
  sessions: ConversationSessionMeta[];
  transcriptChunks: string[];
  totalChars: number;
  redacted: boolean;
  truncated: boolean;
};

export type AutoWorkReviewStatus = "idle" | "running" | "success" | "paused" | "error";

export type AutoWorkReviewSettings = {
  id: "auto-work-review";
  enabled: boolean;
  sourceKinds: ConversationSourceKind[];
  intervalMinutes: 30;
  lastRunAt?: string;
  nextRunAt?: string;
  lastStatus: AutoWorkReviewStatus;
  lastMessage?: string;
  updatedAt: string;
};

export type AutoWorkReviewCursor = {
  sessionId: string;
  path: string;
  sourceKind: ConversationSourceKind;
  date: string;
  readOffset: number;
  modifiedAt: number;
  lastProcessedAt?: string;
  error?: string;
  updatedAt: string;
};

export type RollingWorkReviewStatus = "empty" | "updating" | "ready" | "error";

export type RollingWorkReview = {
  id: string;
  date: string;
  title: string;
  content: string;
  sourceKinds: ConversationSourceKind[];
  processedSessionCount: number;
  processedChars: number;
  lastRunAt?: string;
  status: RollingWorkReviewStatus;
  message?: string;
  archivedAt?: string;
  archiveReviewId?: string;
  createdAt: string;
  updatedAt: string;
};

export type ConversationSessionDeltaCursorInput = {
  sessionId: string;
  readOffset: number;
};

export type ConversationSessionDelta = {
  sessionId: string;
  sourceKind: ConversationSourceKind;
  sourceLabel: string;
  date: string;
  path: string;
  previousReadOffset: number;
  nextReadOffset: number;
  modifiedAt: number;
  transcript: string;
  charCount: number;
  messageCount: number;
  redacted: boolean;
  truncated: boolean;
  reset: boolean;
};

export type DailyConversationReview = {
  id: string;
  reviewKey: string;
  date: string;
  reviewKind: ConversationReviewKind;
  sourceKind?: ConversationSourceKind;
  sourceLabel: string;
  title: string;
  content: string;
  sessionCount: number;
  sessionIds?: string[];
  sourceReviewIds?: string[];
  createdAt: string;
  updatedAt: string;
};

export type DailyReviewReplacementDraft = {
  id: string;
  reviewKey: string;
  targetReviewId?: string;
  date: string;
  reviewKind: ConversationReviewKind;
  sourceKind?: ConversationSourceKind;
  sourceLabel: string;
  title: string;
  content: string;
  sessionCount: number;
  sessionIds: string[];
  sourceReviewIds?: string[];
  status: ReviewDraftStatus;
  createdAt: string;
  updatedAt: string;
};

export type ConversationGenerationDraft = {
  id: string;
  reviewKey?: string;
  date?: string;
  reviewKind: ConversationReviewKind;
  sourceKind?: ConversationSourceKind;
  sourceLabel: string;
  title?: string;
  partialContent: string;
  selectedSessionIds: string[];
  stage: string;
  message: string;
  status: GenerationDraftStatus;
  createdAt: string;
  updatedAt: string;
};

export type CodexSourceKind = ConversationProbeKind;
export type CodexSourceProbe = ConversationSourceProbe;
export type CodexSessionDay = ConversationSessionDay;
export type CodexSessionMeta = ConversationSessionMeta;
export type CodexSessionIndex = ConversationSessionIndex;
export type CodexSessionIndexOptions = ConversationSessionIndexOptions;
export type CodexReviewInput = ConversationReviewInput;
export type CodexDailyReview = DailyConversationReview;
export type CodexReviewDraft = DailyReviewReplacementDraft;

export type MemoryDocument = {
  id: "main";
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type MemoryPatchDraft = {
  id: string;
  title: string;
  rationale: string;
  proposedContent: string;
  sourceReviewId?: string;
  status: MemoryPatchStatus;
  createdAt: string;
  updatedAt: string;
};

export type ActiveView =
  | { kind: "today" }
  | { kind: "search" }
  | { kind: "journal"; date?: string; entryId?: string; summaryId?: string }
  | { kind: "memory"; subView?: MemorySubView; memoryId?: string; reviewId?: string; reviewDraftId?: string; summaryId?: string }
  | { kind: "smart"; id: SmartView }
  | { kind: "folder"; folderId: string }
  | { kind: "item"; itemId: string }
  | { kind: "settings" };
