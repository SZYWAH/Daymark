import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  PROCESS_STATUSES,
  READING_STATUSES,
  type AutoWorkReviewCursor,
  type AutoWorkReviewSettings,
  type AiSettings,
  type CodexDailyReview,
  type ConversationGenerationDraft,
  type ConversationReviewKind,
  type ConversationSessionIndex,
  type ConversationSourceKind,
  type DailyConversationReview,
  type DailyReviewReplacementDraft,
  type EntityKind,
  type FolderNode,
  type Item,
  type JournalEntry,
  type JournalTodo,
  type KnowledgeLink,
  type MemoryCard,
  type MemoryDocument,
  type MemoryPatchDraft,
  type MemoryPatchStatus,
  type MemoryStatus,
  type ProcessStatus,
  type ReadingStatus,
  type RollingWorkReview,
  type RollingWorkReviewStatus,
  type SearchResult,
  type SummaryReport,
  type TodayDashboardData,
} from "../types";
import { getThemeMode, saveThemeMode } from "../lib/theme";
import { filterDemoLibraryFromBackup } from "./demoLibraryModel";

const DB_NAME = "personal-knowledge-base";
const DB_VERSION = 11;
const ITEM_STORE = "items";
const SETTINGS_STORE = "settings";
const FOLDER_STORE = "folders";
const JOURNAL_STORE = "journalEntries";
const SUMMARY_STORE = "summaryReports";
const MEMORY_STORE = "memoryCards";
const LINK_STORE = "links";
const CODEX_REVIEW_STORE = "codexDailyReviews";
const CODEX_SESSION_INDEX_STORE = "codexSessionIndex";
const DAILY_CONVERSATION_REVIEW_STORE = "dailyConversationReviews";
const DAILY_REVIEW_DRAFT_STORE = "dailyReviewReplacementDrafts";
const CONVERSATION_GENERATION_DRAFT_STORE = "conversationGenerationDrafts";
const MEMORY_DOCUMENT_STORE = "memoryDocuments";
const MEMORY_PATCH_STORE = "memoryPatchDrafts";
const AUTO_WORK_REVIEW_SETTINGS_STORE = "autoWorkReviewSettings";
const AUTO_WORK_REVIEW_CURSOR_STORE = "autoWorkReviewCursors";
const ROLLING_WORK_REVIEW_STORE = "rollingWorkReviews";
export const DAYMARK_CORE_BACKUP_SCHEMA = "daymark.core-backup.v1";
const CORE_BACKUP_STORE_NAMES = [
  ITEM_STORE,
  FOLDER_STORE,
  JOURNAL_STORE,
  MEMORY_DOCUMENT_STORE,
  MEMORY_STORE,
  LINK_STORE,
] as const;

type ItemPatch = Partial<Omit<Item, "id" | "createdAt" | "updatedAt">>;
type CreateItemInput = Partial<Omit<Item, "id" | "createdAt" | "updatedAt">>;
type FolderPatch = Partial<Omit<FolderNode, "id" | "createdAt" | "updatedAt">>;
type CreateFolderInput = Pick<FolderNode, "title"> & Partial<Pick<FolderNode, "parentId" | "sortOrder" | "kind">>;
export type LibraryRecordsInput = {
  items: Item[];
  folders: FolderNode[];
};
type JournalPatch = Partial<Omit<JournalEntry, "id" | "createdAt" | "updatedAt">>;
type CreateJournalInput = Partial<Omit<JournalEntry, "id" | "createdAt" | "updatedAt">>;
type CreateSummaryInput = Omit<SummaryReport, "id" | "createdAt" | "updatedAt">;
type CreateMemoryInput = Omit<MemoryCard, "id" | "createdAt" | "updatedAt">;
type MemoryPatch = Partial<Omit<MemoryCard, "id" | "createdAt" | "updatedAt">>;
type CreateKnowledgeLinkInput = Omit<KnowledgeLink, "id" | "createdAt">;
type CreateCodexDailyReviewInput = {
  date: string;
  title: string;
  content: string;
  sessionCount: number;
  sessionIds?: string[];
};
type CodexDailyReviewPatch = Partial<Omit<DailyConversationReview, "id" | "createdAt" | "updatedAt">>;
type CreateDailyConversationReviewInput = Omit<DailyConversationReview, "id" | "createdAt" | "updatedAt">;
type DailyConversationReviewPatch = Partial<Omit<DailyConversationReview, "id" | "createdAt" | "updatedAt">>;
type CreateDailyReviewReplacementDraftInput = Omit<DailyReviewReplacementDraft, "id" | "createdAt" | "updatedAt">;
type DailyReviewReplacementDraftPatch = Partial<Omit<DailyReviewReplacementDraft, "id" | "createdAt" | "updatedAt">>;
type CreateConversationGenerationDraftInput = Omit<ConversationGenerationDraft, "id" | "createdAt" | "updatedAt">;
type ConversationGenerationDraftPatch = Partial<Omit<ConversationGenerationDraft, "id" | "createdAt" | "updatedAt">>;
type CreateMemoryPatchDraftInput = Omit<MemoryPatchDraft, "id" | "createdAt" | "updatedAt">;
type MemoryPatchDraftPatch = Partial<Omit<MemoryPatchDraft, "id" | "createdAt" | "updatedAt">>;
type AutoWorkReviewSettingsPatch = Partial<Omit<AutoWorkReviewSettings, "id" | "intervalMinutes" | "updatedAt">>;
type RollingWorkReviewInput = Omit<RollingWorkReview, "id" | "createdAt" | "updatedAt">;
type ApplyMemoryPatchOptions = {
  expectedDocumentUpdatedAt?: string;
  expectedDocumentContent?: string;
};
type SearchOptions = {
  limitPerKind?: number;
  offsetByKind?: Partial<Record<EntityKind, number>>;
};
export type DaymarkCoreBackupCounts = {
  items: number;
  folders: number;
  journalEntries: number;
  memoryDocument: number;
  memoryCards: number;
  links: number;
};
export type DaymarkCoreBackupPayload = {
  items: Item[];
  folders: FolderNode[];
  journalEntries: JournalEntry[];
  memoryDocument: MemoryDocument | null;
  memoryCards: MemoryCard[];
  links: KnowledgeLink[];
};
export type DaymarkCoreBackupV1 = {
  schema: typeof DAYMARK_CORE_BACKUP_SCHEMA;
  exportedAt: string;
  dbVersion: number;
  payload: DaymarkCoreBackupPayload;
  counts: DaymarkCoreBackupCounts;
};
type LinkStoreForTransaction = {
  index(name: "by-source" | "by-target"): {
    getAll(query: [EntityKind, string]): Promise<KnowledgeLink[]>;
  };
  delete(key: string): Promise<void>;
};

function normalizeUniqueSource(value?: string) {
  let normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized) return "";
  if (/^[a-z]:[\\/]/.test(normalized)) {
    normalized = normalized.replace(/\//g, "\\");
    return normalized.length > 3 ? normalized.replace(/\\+$/, "") : normalized;
  }
  return normalized.replace(/\/+$/, "");
}

function findDuplicateItemBySource(items: Item[], input: Pick<CreateItemInput, "filePath" | "sourceUrl">) {
  const filePath = normalizeUniqueSource(input.filePath);
  const sourceUrl = normalizeUniqueSource(input.sourceUrl);
  if (!filePath && !sourceUrl) return undefined;

  return items.map(normalizeItem).find((item) => {
    if (filePath && normalizeUniqueSource(item.filePath) === filePath) return true;
    if (sourceUrl && normalizeUniqueSource(item.sourceUrl) === sourceUrl) return true;
    return false;
  });
}

interface KnowledgeBaseDb extends DBSchema {
  items: {
    key: string;
    value: Item;
    indexes: {
      "by-createdAt": string;
      "by-updatedAt": string;
    };
  };
  settings: {
    key: string;
    value: AiSettings;
  };
  folders: {
    key: string;
    value: FolderNode;
    indexes: {
      "by-parentId": string;
    };
  };
  journalEntries: {
    key: string;
    value: JournalEntry;
    indexes: {
      "by-entryDate": string;
      "by-updatedAt": string;
    };
  };
  summaryReports: {
    key: string;
    value: SummaryReport;
    indexes: {
      "by-periodStart": string;
      "by-periodType": string;
    };
  };
  memoryCards: {
    key: string;
    value: MemoryCard;
    indexes: {
      "by-status": MemoryStatus;
      "by-updatedAt": string;
    };
  };
  links: {
    key: string;
    value: KnowledgeLink;
    indexes: {
      "by-source": [EntityKind, string];
      "by-target": [EntityKind, string];
    };
  };
  codexDailyReviews: {
    key: string;
    value: CodexDailyReview;
    indexes: {
      "by-date": string;
      "by-updatedAt": string;
    };
  };
  codexSessionIndex: {
    key: string;
    value: ConversationSessionIndex;
    indexes: {
      "by-date": string;
      "by-modifiedAt": number;
    };
  };
  dailyConversationReviews: {
    key: string;
    value: DailyConversationReview;
    indexes: {
      "by-reviewKey": string;
      "by-date": string;
      "by-updatedAt": string;
    };
  };
  dailyReviewReplacementDrafts: {
    key: string;
    value: DailyReviewReplacementDraft;
    indexes: {
      "by-reviewKey": string;
      "by-status": string;
      "by-updatedAt": string;
    };
  };
  conversationGenerationDrafts: {
    key: string;
    value: ConversationGenerationDraft;
    indexes: {
      "by-status": string;
      "by-updatedAt": string;
    };
  };
  memoryDocuments: {
    key: "main";
    value: MemoryDocument;
  };
  memoryPatchDrafts: {
    key: string;
    value: MemoryPatchDraft;
    indexes: {
      "by-status": MemoryPatchStatus;
      "by-updatedAt": string;
    };
  };
  autoWorkReviewSettings: {
    key: "auto-work-review";
    value: AutoWorkReviewSettings;
  };
  autoWorkReviewCursors: {
    key: string;
    value: AutoWorkReviewCursor;
    indexes: {
      "by-date": string;
      "by-sourceKind": ConversationSourceKind;
      "by-updatedAt": string;
    };
  };
  rollingWorkReviews: {
    key: string;
    value: RollingWorkReview;
    indexes: {
      "by-date": string;
      "by-status": RollingWorkReviewStatus;
      "by-updatedAt": string;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<KnowledgeBaseDb>> | undefined;

function getDb() {
  dbPromise ??= openDB<KnowledgeBaseDb>(DB_NAME, DB_VERSION, {
    upgrade(db, _oldVersion, _newVersion, transaction) {
      if (!db.objectStoreNames.contains(ITEM_STORE)) {
        const store = db.createObjectStore(ITEM_STORE, { keyPath: "id" });
        store.createIndex("by-createdAt", "createdAt");
        store.createIndex("by-updatedAt", "updatedAt");
      }

      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(FOLDER_STORE)) {
        const store = db.createObjectStore(FOLDER_STORE, { keyPath: "id" });
        store.createIndex("by-parentId", "parentId");
      }

      if (!db.objectStoreNames.contains(JOURNAL_STORE)) {
        const store = db.createObjectStore(JOURNAL_STORE, { keyPath: "id" });
        store.createIndex("by-entryDate", "entryDate");
        store.createIndex("by-updatedAt", "updatedAt");
      }

      if (!db.objectStoreNames.contains(SUMMARY_STORE)) {
        const store = db.createObjectStore(SUMMARY_STORE, { keyPath: "id" });
        store.createIndex("by-periodStart", "periodStart");
        store.createIndex("by-periodType", "periodType");
      }

      if (!db.objectStoreNames.contains(MEMORY_STORE)) {
        const store = db.createObjectStore(MEMORY_STORE, { keyPath: "id" });
        store.createIndex("by-status", "status");
        store.createIndex("by-updatedAt", "updatedAt");
      }

      if (!db.objectStoreNames.contains(LINK_STORE)) {
        const store = db.createObjectStore(LINK_STORE, { keyPath: "id" });
        store.createIndex("by-source", ["sourceKind", "sourceId"]);
        store.createIndex("by-target", ["targetKind", "targetId"]);
      }

      if (!db.objectStoreNames.contains(CODEX_REVIEW_STORE)) {
        const store = db.createObjectStore(CODEX_REVIEW_STORE, { keyPath: "id" });
        store.createIndex("by-date", "date");
        store.createIndex("by-updatedAt", "updatedAt");
      }

      if (!db.objectStoreNames.contains(CODEX_SESSION_INDEX_STORE)) {
        const store = db.createObjectStore(CODEX_SESSION_INDEX_STORE, { keyPath: "id" });
        store.createIndex("by-date", "date");
        store.createIndex("by-modifiedAt", "modifiedAt");
      }

      if (!db.objectStoreNames.contains(DAILY_CONVERSATION_REVIEW_STORE)) {
        const store = db.createObjectStore(DAILY_CONVERSATION_REVIEW_STORE, { keyPath: "id" });
        store.createIndex("by-reviewKey", "reviewKey", { unique: true });
        store.createIndex("by-date", "date");
        store.createIndex("by-updatedAt", "updatedAt");
      } else {
        const store = transaction.objectStore(DAILY_CONVERSATION_REVIEW_STORE);
        if (!store.indexNames.contains("by-reviewKey")) store.createIndex("by-reviewKey", "reviewKey", { unique: true });
        if (!store.indexNames.contains("by-date")) store.createIndex("by-date", "date");
        if (!store.indexNames.contains("by-updatedAt")) store.createIndex("by-updatedAt", "updatedAt");
      }

      if (!db.objectStoreNames.contains(DAILY_REVIEW_DRAFT_STORE)) {
        const store = db.createObjectStore(DAILY_REVIEW_DRAFT_STORE, { keyPath: "id" });
        store.createIndex("by-reviewKey", "reviewKey");
        store.createIndex("by-status", "status");
        store.createIndex("by-updatedAt", "updatedAt");
      } else {
        const store = transaction.objectStore(DAILY_REVIEW_DRAFT_STORE);
        if (!store.indexNames.contains("by-reviewKey")) store.createIndex("by-reviewKey", "reviewKey");
        if (!store.indexNames.contains("by-status")) store.createIndex("by-status", "status");
        if (!store.indexNames.contains("by-updatedAt")) store.createIndex("by-updatedAt", "updatedAt");
      }

      if (!db.objectStoreNames.contains(CONVERSATION_GENERATION_DRAFT_STORE)) {
        const store = db.createObjectStore(CONVERSATION_GENERATION_DRAFT_STORE, { keyPath: "id" });
        store.createIndex("by-status", "status");
        store.createIndex("by-updatedAt", "updatedAt");
      } else {
        const store = transaction.objectStore(CONVERSATION_GENERATION_DRAFT_STORE);
        if (!store.indexNames.contains("by-status")) store.createIndex("by-status", "status");
        if (!store.indexNames.contains("by-updatedAt")) store.createIndex("by-updatedAt", "updatedAt");
      }

      if (!db.objectStoreNames.contains(MEMORY_DOCUMENT_STORE)) {
        db.createObjectStore(MEMORY_DOCUMENT_STORE, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(MEMORY_PATCH_STORE)) {
        const store = db.createObjectStore(MEMORY_PATCH_STORE, { keyPath: "id" });
        store.createIndex("by-status", "status");
        store.createIndex("by-updatedAt", "updatedAt");
      } else {
        const store = transaction.objectStore(MEMORY_PATCH_STORE);
        if (!store.indexNames.contains("by-status")) store.createIndex("by-status", "status");
        if (!store.indexNames.contains("by-updatedAt")) store.createIndex("by-updatedAt", "updatedAt");
      }

      if (!db.objectStoreNames.contains(AUTO_WORK_REVIEW_SETTINGS_STORE)) {
        db.createObjectStore(AUTO_WORK_REVIEW_SETTINGS_STORE, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(AUTO_WORK_REVIEW_CURSOR_STORE)) {
        const store = db.createObjectStore(AUTO_WORK_REVIEW_CURSOR_STORE, { keyPath: "sessionId" });
        store.createIndex("by-date", "date");
        store.createIndex("by-sourceKind", "sourceKind");
        store.createIndex("by-updatedAt", "updatedAt");
      } else {
        const store = transaction.objectStore(AUTO_WORK_REVIEW_CURSOR_STORE);
        if (!store.indexNames.contains("by-date")) store.createIndex("by-date", "date");
        if (!store.indexNames.contains("by-sourceKind")) store.createIndex("by-sourceKind", "sourceKind");
        if (!store.indexNames.contains("by-updatedAt")) store.createIndex("by-updatedAt", "updatedAt");
      }

      if (!db.objectStoreNames.contains(ROLLING_WORK_REVIEW_STORE)) {
        const store = db.createObjectStore(ROLLING_WORK_REVIEW_STORE, { keyPath: "id" });
        store.createIndex("by-date", "date");
        store.createIndex("by-status", "status");
        store.createIndex("by-updatedAt", "updatedAt");
      } else {
        const store = transaction.objectStore(ROLLING_WORK_REVIEW_STORE);
        if (!store.indexNames.contains("by-date")) store.createIndex("by-date", "date");
        if (!store.indexNames.contains("by-status")) store.createIndex("by-status", "status");
        if (!store.indexNames.contains("by-updatedAt")) store.createIndex("by-updatedAt", "updatedAt");
      }
    },
  });

  return dbPromise;
}

function createId(prefix = "item") {
  if ("randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function formatTimestamp(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");

  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    " ",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
    ":",
    pad(date.getSeconds()),
  ].join("");
}

export function getDefaultAiSettings(): AiSettings {
  return {
    id: "ai",
    provider: "deepseek",
    customProviderName: "",
    baseUrl: import.meta.env.VITE_DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    model: import.meta.env.VITE_DEEPSEEK_MODEL || "deepseek-v4-flash",
    useEnvKey: true,
    manualApiKey: "",
    manualKeyStored: false,
    supportsVision: false,
    stream: false,
    themeMode: getThemeMode(),
    updatedAt: formatTimestamp(),
  };
}

export function getDefaultAutoWorkReviewSettings(): AutoWorkReviewSettings {
  return {
    id: "auto-work-review",
    enabled: false,
    sourceKinds: ["codex", "claude"],
    intervalMinutes: 30,
    lastStatus: "idle",
    updatedAt: formatTimestamp(),
  };
}

export async function getAutoWorkReviewSettings() {
  const db = await getDb();
  const saved = await db.get(AUTO_WORK_REVIEW_SETTINGS_STORE, "auto-work-review");
  return normalizeAutoWorkReviewSettings(saved);
}

export async function saveAutoWorkReviewSettings(patch: AutoWorkReviewSettingsPatch) {
  const db = await getDb();
  const current = await getAutoWorkReviewSettings();
  const next = normalizeAutoWorkReviewSettings({
    ...current,
    ...patch,
    id: "auto-work-review",
    intervalMinutes: 30,
    updatedAt: formatTimestamp(),
  });
  await db.put(AUTO_WORK_REVIEW_SETTINGS_STORE, next);
  return next;
}

export async function getAutoWorkReviewCursors() {
  const db = await getDb();
  const cursors = await db.getAll(AUTO_WORK_REVIEW_CURSOR_STORE);
  return cursors.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getAutoWorkReviewCursorsBySessionIds(sessionIds: string[]) {
  const db = await getDb();
  const uniqueIds = Array.from(new Set(sessionIds.map((id) => id.trim()).filter(Boolean)));
  const records = await Promise.all(uniqueIds.map((id) => db.get(AUTO_WORK_REVIEW_CURSOR_STORE, id)));
  return records.filter((cursor): cursor is AutoWorkReviewCursor => Boolean(cursor));
}

export async function upsertAutoWorkReviewCursors(cursors: AutoWorkReviewCursor[]) {
  if (cursors.length === 0) return [];
  const db = await getDb();
  const tx = db.transaction(AUTO_WORK_REVIEW_CURSOR_STORE, "readwrite");
  const now = formatTimestamp();
  const saved = cursors.map((cursor) => ({
    ...cursor,
    readOffset: Math.max(0, Math.floor(cursor.readOffset || 0)),
    modifiedAt: Math.max(0, Math.floor(cursor.modifiedAt || 0)),
    updatedAt: now,
  }));
  await Promise.all(saved.map((cursor) => tx.store.put(cursor)));
  await tx.done;
  return saved;
}

export async function getRollingWorkReviewByDate(date: string) {
  const db = await getDb();
  return db.get(ROLLING_WORK_REVIEW_STORE, date);
}

export async function getRollingWorkReviews() {
  const db = await getDb();
  const reviews = await db.getAll(ROLLING_WORK_REVIEW_STORE);
  return reviews.sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
}

export async function upsertRollingWorkReview(input: RollingWorkReviewInput) {
  const db = await getDb();
  const now = formatTimestamp();
  const existing = await db.get(ROLLING_WORK_REVIEW_STORE, input.date);
  const review: RollingWorkReview = {
    id: input.date,
    createdAt: existing?.createdAt ?? now,
    ...existing,
    ...input,
    date: input.date,
    title: input.title.trim() || `${input.date} 今日工作内容`,
    content: input.content.trim(),
    sourceKinds: normalizeConversationSourceKinds(input.sourceKinds),
    processedSessionCount: Math.max(0, Math.floor(input.processedSessionCount || 0)),
    processedChars: Math.max(0, Math.floor(input.processedChars || 0)),
    updatedAt: now,
  };
  await db.put(ROLLING_WORK_REVIEW_STORE, review);
  return review;
}

export async function archiveRollingWorkReview(date: string) {
  const db = await getDb();
  const current = await db.get(ROLLING_WORK_REVIEW_STORE, date);
  if (!current || !current.content.trim()) {
    throw new Error("还没有可归档的自动工作回顾。");
  }

  const archivedAt = current.archivedAt ?? formatTimestamp();
  const archiveReview = await upsertDailyConversationReview({
    reviewKey: createReviewKey(current.date, "auto-work"),
    date: current.date,
    reviewKind: "auto-work",
    sourceLabel: "自动工作回顾",
    title: current.title.trim() || `${current.date} 自动工作回顾`,
    content: current.content,
    sessionCount: current.processedSessionCount,
    sessionIds: [],
    sourceReviewIds: [],
  });

  const updated: RollingWorkReview = {
    ...current,
    archivedAt,
    archiveReviewId: archiveReview.id,
    updatedAt: formatTimestamp(),
  };
  await db.put(ROLLING_WORK_REVIEW_STORE, updated);

  return { review: updated, archiveReview };
}

export async function exportCoreBackup(): Promise<DaymarkCoreBackupV1> {
  const [allItems, allFolders, journalEntries, memoryDocument, memoryCards, allLinks] = await Promise.all([
    getItems(),
    getFolders(),
    getJournalEntries(),
    getMemoryDocument(),
    getMemoryCards(),
    getKnowledgeLinks(),
  ]);
  const { items, folders, links } = filterDemoLibraryFromBackup({
    items: allItems,
    folders: allFolders,
    links: allLinks,
  });
  const payload: DaymarkCoreBackupPayload = {
    items,
    folders,
    journalEntries,
    memoryDocument,
    memoryCards,
    links,
  };

  return {
    schema: DAYMARK_CORE_BACKUP_SCHEMA,
    exportedAt: new Date().toISOString(),
    dbVersion: DB_VERSION,
    payload,
    counts: getCoreBackupCounts(payload),
  };
}

export function validateCoreBackup(input: unknown): DaymarkCoreBackupV1 {
  if (!isRecord(input)) {
    throw new Error("备份文件格式无效。");
  }
  if (input.schema !== DAYMARK_CORE_BACKUP_SCHEMA) {
    throw new Error("这不是 Daymark 核心备份文件。");
  }
  if (typeof input.exportedAt !== "string" || !input.exportedAt.trim()) {
    throw new Error("备份文件缺少导出时间。");
  }
  if (typeof input.dbVersion !== "number" || !Number.isFinite(input.dbVersion)) {
    throw new Error("备份文件缺少数据库版本。");
  }
  if (!isRecord(input.counts)) {
    throw new Error("备份文件缺少数量摘要 counts。");
  }
  if (!isRecord(input.payload)) {
    throw new Error("备份文件缺少核心数据 payload。");
  }

  const payload: DaymarkCoreBackupPayload = {
    items: validateBackupArray<Item>(input.payload.items, "items", validateBackupItem),
    folders: validateBackupArray<FolderNode>(input.payload.folders, "folders", validateBackupFolder),
    journalEntries: validateBackupArray<JournalEntry>(
      input.payload.journalEntries,
      "journalEntries",
      validateBackupJournalEntry,
    ),
    memoryDocument: validateBackupMemoryDocument(input.payload.memoryDocument),
    memoryCards: validateBackupArray<MemoryCard>(input.payload.memoryCards, "memoryCards", validateBackupMemoryCard),
    links: validateBackupArray<KnowledgeLink>(input.payload.links, "links", validateBackupLink),
  };

  return {
    schema: DAYMARK_CORE_BACKUP_SCHEMA,
    exportedAt: input.exportedAt,
    dbVersion: input.dbVersion,
    payload,
    counts: getCoreBackupCounts(payload),
  };
}

export async function restoreCoreBackup(input: unknown): Promise<DaymarkCoreBackupCounts> {
  const backup = validateCoreBackup(input);
  const db = await getDb();
  const tx = db.transaction(CORE_BACKUP_STORE_NAMES, "readwrite");
  const itemStore = tx.objectStore(ITEM_STORE);
  const folderStore = tx.objectStore(FOLDER_STORE);
  const journalStore = tx.objectStore(JOURNAL_STORE);
  const memoryDocumentStore = tx.objectStore(MEMORY_DOCUMENT_STORE);
  const memoryStore = tx.objectStore(MEMORY_STORE);
  const linkStore = tx.objectStore(LINK_STORE);
  const requests: Promise<unknown>[] = [
    itemStore.clear(),
    folderStore.clear(),
    journalStore.clear(),
    memoryDocumentStore.clear(),
    memoryStore.clear(),
    linkStore.clear(),
  ];

  backup.payload.items.forEach((item) => requests.push(itemStore.put(normalizeItem(item))));
  backup.payload.folders.forEach((folder) => requests.push(folderStore.put(folder)));
  backup.payload.journalEntries.forEach((entry) => requests.push(journalStore.put(normalizeJournalEntry(entry))));
  if (backup.payload.memoryDocument) {
    requests.push(memoryDocumentStore.put(backup.payload.memoryDocument));
  }
  backup.payload.memoryCards.forEach((card) => requests.push(memoryStore.put(card)));
  backup.payload.links.forEach((link) => requests.push(linkStore.put(link)));

  await Promise.all([...requests, tx.done]);
  return backup.counts;
}

function getCoreBackupCounts(payload: DaymarkCoreBackupPayload): DaymarkCoreBackupCounts {
  return {
    items: payload.items.length,
    folders: payload.folders.length,
    journalEntries: payload.journalEntries.length,
    memoryDocument: payload.memoryDocument ? 1 : 0,
    memoryCards: payload.memoryCards.length,
    links: payload.links.length,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateBackupArray<T>(
  value: unknown,
  label: string,
  validate: (record: Record<string, unknown>, label: string) => void,
): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`备份字段 ${label} 必须是数组。`);
  }
  const ids = new Set<string>();
  value.forEach((record, index) => {
    const recordLabel = `${label}[${index}]`;
    if (!isRecord(record)) {
      throw new Error(`备份字段 ${recordLabel} 必须是对象。`);
    }
    const id = requireStringField(record, "id", recordLabel);
    if (ids.has(id)) {
      throw new Error(`备份字段 ${label} 包含重复 id：${id}`);
    }
    ids.add(id);
    validate(record, recordLabel);
  });
  return value as T[];
}

function validateBackupItem(record: Record<string, unknown>, label: string) {
  requireStringField(record, "title", label);
  requireStringField(record, "type", label);
  requireStringField(record, "createdAt", label);
  requireStringField(record, "updatedAt", label);
  requireOptionalArrayField(record, "tags", label);
  requireOptionalArrayField(record, "todos", label);
}

function validateBackupFolder(record: Record<string, unknown>, label: string) {
  requireStringField(record, "title", label);
  requireStringField(record, "kind", label);
  requireNumberField(record, "sortOrder", label);
  requireStringField(record, "createdAt", label);
  requireStringField(record, "updatedAt", label);
}

function validateBackupJournalEntry(record: Record<string, unknown>, label: string) {
  requireStringField(record, "entryDate", label);
  requireStringField(record, "content", label);
  requireArrayField(record, "tags", label);
  requireArrayField(record, "todos", label);
  requireStringField(record, "createdAt", label);
  requireStringField(record, "updatedAt", label);
}

function validateBackupMemoryDocument(value: unknown): MemoryDocument | null {
  if (value === null) return null;
  if (!isRecord(value)) {
    throw new Error("备份字段 memoryDocument 必须是 null 或对象。");
  }
  const id = requireStringField(value, "id", "memoryDocument");
  if (id !== "main") {
    throw new Error("备份字段 memoryDocument.id 必须是 main。");
  }
  requireStringField(value, "content", "memoryDocument");
  requireStringField(value, "createdAt", "memoryDocument");
  requireStringField(value, "updatedAt", "memoryDocument");
  return value as MemoryDocument;
}

function validateBackupMemoryCard(record: Record<string, unknown>, label: string) {
  requireStringField(record, "title", label);
  requireStringField(record, "content", label);
  requireStringField(record, "category", label);
  requireStringField(record, "status", label);
  requireStringField(record, "createdAt", label);
  requireStringField(record, "updatedAt", label);
}

function validateBackupLink(record: Record<string, unknown>, label: string) {
  requireStringField(record, "sourceKind", label);
  requireStringField(record, "sourceId", label);
  requireStringField(record, "targetKind", label);
  requireStringField(record, "targetId", label);
  requireStringField(record, "relation", label);
  requireStringField(record, "createdAt", label);
}

function requireStringField(record: Record<string, unknown>, field: string, label: string) {
  const value = record[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`备份字段 ${label}.${field} 必须是非空字符串。`);
  }
  return value;
}

function requireNumberField(record: Record<string, unknown>, field: string, label: string) {
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`备份字段 ${label}.${field} 必须是数字。`);
  }
  return value;
}

function requireArrayField(record: Record<string, unknown>, field: string, label: string) {
  if (!Array.isArray(record[field])) {
    throw new Error(`备份字段 ${label}.${field} 必须是数组。`);
  }
}

function requireOptionalArrayField(record: Record<string, unknown>, field: string, label: string) {
  if (record[field] !== undefined && !Array.isArray(record[field])) {
    throw new Error(`备份字段 ${label}.${field} 必须是数组。`);
  }
}

export async function seedItemsIfEmpty() {
  const db = await getDb();
  const count = await db.count(ITEM_STORE);
  if (count > 0) return;

  const { seedItems } = await import("./seedItems");
  const tx = db.transaction(ITEM_STORE, "readwrite");
  await Promise.all(seedItems.map((item) => tx.store.put(normalizeItem(item))));
  await tx.done;
}

export async function seedFoldersIfEmpty() {
  const db = await getDb();
  const count = await db.count(FOLDER_STORE);
  if (count > 0) return;

  const { seedFolders } = await import("./seedFolders");
  const tx = db.transaction(FOLDER_STORE, "readwrite");
  await Promise.all(seedFolders.map((folder) => tx.store.put(folder)));
  await tx.done;
}

export async function seedJournalEntriesIfEmpty() {
  const db = await getDb();
  const count = await db.count(JOURNAL_STORE);
  if (count > 0) return;

  const { seedJournalEntries } = await import("./seedJournalEntries");
  const tx = db.transaction(JOURNAL_STORE, "readwrite");
  await Promise.all(seedJournalEntries.map((entry) => tx.store.put(normalizeJournalEntry(entry))));
  await tx.done;
}

export async function getItems() {
  const db = await getDb();
  const items = await db.getAll(ITEM_STORE);
  return items.map(normalizeItem).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createItem(input: CreateItemInput = {}) {
  const db = await getDb();
  const duplicate = findDuplicateItemBySource(await db.getAll(ITEM_STORE), input);
  if (duplicate) return duplicate;

  const now = formatTimestamp();
  const item: Item = {
    id: createId("item"),
    title: input.title?.trim() || "未命名条目",
    type: input.type ?? "note",
    status: input.status,
    processStatus: input.processStatus ?? "收件箱",
    readingStatus: input.readingStatus ?? getDefaultReadingStatus(input.type),
    folderId: input.folderId,
    tags: input.tags ?? [],
    content: input.content ?? "",
    filePath: input.filePath,
    sourceUrl: input.sourceUrl,
    aiSummary: input.aiSummary ?? "等待 AI 摘要。",
    todos: input.todos ?? [],
    lastAiRunAt: input.lastAiRunAt,
    lastOpenedAt: input.lastOpenedAt,
    createdAt: now,
    updatedAt: now,
    favorite: input.favorite ?? false,
  };

  const normalized = normalizeItem(item);
  await db.put(ITEM_STORE, normalized);
  return normalized;
}

export async function createItemWithKnowledgeLink(
  input: CreateItemInput,
  linkInput: Omit<CreateKnowledgeLinkInput, "targetId">,
) {
  const sourceId = linkInput.sourceId.trim();
  if (!sourceId) {
    throw new Error("Link source cannot be empty.");
  }
  const relation = linkInput.relation.trim() || "related";
  const db = await getDb();
  const tx = db.transaction([ITEM_STORE, LINK_STORE], "readwrite");
  const itemStore = tx.objectStore(ITEM_STORE);
  const linkStore = tx.objectStore(LINK_STORE);
  const duplicate = findDuplicateItemBySource(await itemStore.getAll(), input);
  const now = formatTimestamp();
  const item = duplicate ?? normalizeItem({
    id: createId("item"),
    title: input.title?.trim() || "Untitled item",
    type: input.type ?? "note",
    status: input.status,
    processStatus: input.processStatus ?? PROCESS_STATUSES[0],
    readingStatus: input.readingStatus ?? getDefaultReadingStatus(input.type),
    folderId: input.folderId,
    tags: input.tags ?? [],
    content: input.content ?? "",
    filePath: input.filePath,
    sourceUrl: input.sourceUrl,
    aiSummary: input.aiSummary ?? "Waiting for AI summary.",
    todos: input.todos ?? [],
    lastAiRunAt: input.lastAiRunAt,
    lastOpenedAt: input.lastOpenedAt,
    createdAt: now,
    updatedAt: now,
    favorite: input.favorite ?? false,
  });

  if (!duplicate) {
    await itemStore.put(item);
  }

  const existingLinks = await linkStore.index("by-source").getAll([linkInput.sourceKind, sourceId]);
  const duplicateLink = existingLinks.find(
    (link) =>
      link.targetKind === linkInput.targetKind &&
      link.targetId === item.id &&
      link.relation === relation,
  );
  const link: KnowledgeLink = duplicateLink ?? {
    id: createId("link"),
    sourceKind: linkInput.sourceKind,
    sourceId,
    targetKind: linkInput.targetKind,
    targetId: item.id,
    relation,
    createdAt: now,
  };

  if (!duplicateLink) {
    await linkStore.put(link);
  }

  await tx.done;
  return { item, link };
}

export async function updateItem(id: string, patch: ItemPatch) {
  const db = await getDb();
  const current = await db.get(ITEM_STORE, id);

  if (!current) {
    throw new Error(`Item not found: ${id}`);
  }

  const updated: Item = normalizeItem({
    ...normalizeItem(current),
    ...patch,
    updatedAt: formatTimestamp(),
  });

  await db.put(ITEM_STORE, updated);
  return updated;
}

export async function deleteItem(id: string) {
  const db = await getDb();
  const tx = db.transaction([ITEM_STORE, LINK_STORE], "readwrite");
  await tx.objectStore(ITEM_STORE).delete(id);
  await deleteLinksForEntityInTransaction(tx.objectStore(LINK_STORE), "item", id);
  await tx.done;
}

export async function markItemOpened(id: string) {
  const db = await getDb();
  const current = await db.get(ITEM_STORE, id);
  if (!current) return;

  await db.put(ITEM_STORE, {
    ...normalizeItem(current),
    lastOpenedAt: formatTimestamp(),
  });
}

export async function getFolders() {
  const db = await getDb();
  const folders = await db.getAll(FOLDER_STORE);
  return folders.sort((a, b) => {
    if ((a.parentId ?? "") !== (b.parentId ?? "")) {
      return (a.parentId ?? "").localeCompare(b.parentId ?? "");
    }

    return a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, "zh-Hans-CN");
  });
}

export async function createFolder(input: CreateFolderInput) {
  const db = await getDb();
  const now = formatTimestamp();
  const folder: FolderNode = {
    id: createId("folder"),
    title: input.title.trim() || "新建文件夹",
    kind: input.kind ?? "folder",
    parentId: input.parentId,
    sortOrder: input.sortOrder ?? Date.now(),
    createdAt: now,
    updatedAt: now,
  };

  await db.put(FOLDER_STORE, folder);
  return folder;
}

export async function updateFolder(id: string, patch: FolderPatch) {
  const db = await getDb();
  const current = await db.get(FOLDER_STORE, id);
  if (!current) {
    throw new Error(`Folder not found: ${id}`);
  }

  const updated: FolderNode = {
    ...current,
    ...patch,
    title: patch.title?.trim() || current.title,
    updatedAt: formatTimestamp(),
  };

  await db.put(FOLDER_STORE, updated);
  return updated;
}

export async function deleteFolder(id: string) {
  const db = await getDb();
  await db.delete(FOLDER_STORE, id);
}

export async function deleteFoldersAndMoveItems(folderIds: string[]) {
  const ids = new Set(folderIds.map((id) => id.trim()).filter(Boolean));
  if (ids.size === 0) return;

  const db = await getDb();
  const tx = db.transaction([FOLDER_STORE, ITEM_STORE], "readwrite");
  const itemStore = tx.objectStore(ITEM_STORE);
  const folderStore = tx.objectStore(FOLDER_STORE);
  const now = formatTimestamp();
  const items = await itemStore.getAll();

  await Promise.all(
    items
      .filter((item) => item.folderId && ids.has(item.folderId))
      .map((item) =>
        itemStore.put(normalizeItem({
          ...item,
          folderId: undefined,
          updatedAt: now,
        })),
      ),
  );
  await Promise.all(Array.from(ids).map((id) => folderStore.delete(id)));
  await tx.done;
}

export async function getJournalEntries() {
  const db = await getDb();
  const entries = await db.getAll(JOURNAL_STORE);
  return entries.map(normalizeJournalEntry).sort((a, b) => b.entryDate.localeCompare(a.entryDate));
}

export async function createJournalEntry(input: CreateJournalInput = {}) {
  const db = await getDb();
  const now = formatTimestamp();
  const entry: JournalEntry = normalizeJournalEntry({
    id: createId("journal"),
    entryDate: input.entryDate || now,
    content: input.content ?? "",
    tags: input.tags ?? [],
    todos: input.todos ?? [],
    createdAt: now,
    updatedAt: now,
  });

  await db.put(JOURNAL_STORE, entry);
  return entry;
}

export async function updateJournalEntry(id: string, patch: JournalPatch) {
  const db = await getDb();
  const current = await db.get(JOURNAL_STORE, id);
  if (!current) {
    throw new Error(`Journal entry not found: ${id}`);
  }

  const updated = normalizeJournalEntry({
    ...current,
    ...patch,
    updatedAt: formatTimestamp(),
  });

  await db.put(JOURNAL_STORE, updated);
  return updated;
}

export async function deleteJournalEntry(id: string) {
  const db = await getDb();
  const tx = db.transaction([JOURNAL_STORE, LINK_STORE], "readwrite");
  await tx.objectStore(JOURNAL_STORE).delete(id);
  await deleteLinksForEntityInTransaction(tx.objectStore(LINK_STORE), "journal", id);
  await tx.done;
}

export async function getSummaryReports() {
  const db = await getDb();
  const reports = await db.getAll(SUMMARY_STORE);
  return reports.sort((a, b) => b.periodStart.localeCompare(a.periodStart));
}

export async function createSummaryReport(input: CreateSummaryInput) {
  const db = await getDb();
  const now = formatTimestamp();
  const report: SummaryReport = {
    id: createId("summary"),
    ...input,
    title: input.title.trim() || getSummaryFallbackTitle(input.periodType),
    content: input.content.trim(),
    createdAt: now,
    updatedAt: now,
  };

  await db.put(SUMMARY_STORE, report);
  return report;
}

export async function upsertSummaryReport(input: CreateSummaryInput) {
  const db = await getDb();
  const reports = await db.getAll(SUMMARY_STORE);
  const existing = reports.find(
    (report) =>
      report.periodType === input.periodType &&
      report.periodStart === input.periodStart &&
      report.periodEnd === input.periodEnd,
  );

  if (!existing) return createSummaryReport(input);

  const updated: SummaryReport = {
    ...existing,
    title: input.title.trim() || existing.title || getSummaryFallbackTitle(input.periodType),
    content: input.content.trim(),
    updatedAt: formatTimestamp(),
  };

  await db.put(SUMMARY_STORE, updated);
  return updated;
}

function getSummaryFallbackTitle(periodType: SummaryReport["periodType"]) {
  if (periodType === "day") return "日总结";
  if (periodType === "week") return "周总结";
  return "月总结";
}

export async function getMemoryCards() {
  const db = await getDb();
  const cards = await db.getAll(MEMORY_STORE);
  return cards.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createMemoryCandidate(input: CreateMemoryInput) {
  const db = await getDb();
  const now = formatTimestamp();
  const title = input.title.trim() || "未命名记忆";
  const content = input.content.trim();
  const category = input.category.trim() || "一般";

  if (input.sourceSummaryId) {
    const cards = await db.getAll(MEMORY_STORE);
    const existing = cards.find(
      (card) =>
        card.sourceSummaryId === input.sourceSummaryId &&
        card.title.trim() === title &&
        card.content.trim() === content,
    );
    if (existing) {
      if (existing.status !== "candidate") return existing;

      const updated: MemoryCard = {
        ...existing,
        ...input,
        id: existing.id,
        title,
        content,
        category,
        status: existing.status,
        createdAt: existing.createdAt,
        updatedAt: now,
      };
      await db.put(MEMORY_STORE, updated);
      return updated;
    }
  }

  const card: MemoryCard = {
    id: createId("memory"),
    ...input,
    title,
    content,
    category,
    status: input.status,
    createdAt: now,
    updatedAt: now,
  };

  await db.put(MEMORY_STORE, card);
  return card;
}

export async function updateMemoryCard(id: string, patch: MemoryPatch) {
  const db = await getDb();
  const current = await db.get(MEMORY_STORE, id);
  if (!current) {
    throw new Error(`Memory card not found: ${id}`);
  }

  const updated: MemoryCard = {
    ...current,
    ...patch,
    title: patch.title?.trim() || current.title,
    content: patch.content?.trim() ?? current.content,
    category: patch.category?.trim() || current.category,
    updatedAt: formatTimestamp(),
  };

  await db.put(MEMORY_STORE, updated);
  return updated;
}

export async function getCodexDailyReviews() {
  return getDailyConversationReviews();
}

export async function getDailyConversationReviews() {
  const db = await getDb();
  await migrateLegacyCodexReviews(db);
  const reviews = await db.getAll(DAILY_CONVERSATION_REVIEW_STORE);
  return reviews.sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
}

export async function getCodexDailyReviewByDate(date: string) {
  return getDailyConversationReviewByKey(createReviewKey(date, "source", "codex"));
}

export async function getDailyConversationReviewByKey(reviewKey: string) {
  const db = await getDb();
  return db.getFromIndex(DAILY_CONVERSATION_REVIEW_STORE, "by-reviewKey", reviewKey);
}

export async function getDailyConversationReviewsByDate(date: string) {
  const db = await getDb();
  await migrateLegacyCodexReviews(db);
  const reviews = await db.getAllFromIndex(DAILY_CONVERSATION_REVIEW_STORE, "by-date", date);
  return reviews.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createCodexDailyReview(input: CreateCodexDailyReviewInput) {
  return upsertDailyConversationReview({
    reviewKey: createReviewKey(input.date, "source", "codex"),
    date: input.date,
    reviewKind: "source",
    sourceKind: "codex",
    sourceLabel: "Codex",
    title: input.title,
    content: input.content,
    sessionCount: input.sessionCount,
    sessionIds: input.sessionIds ?? [],
  });
}

export async function upsertDailyConversationReview(input: CreateDailyConversationReviewInput) {
  const db = await getDb();
  const now = formatTimestamp();
  const reviewKey = createReviewKey(input.date, input.reviewKind, input.sourceKind);
  const existing = await db.getFromIndex(DAILY_CONVERSATION_REVIEW_STORE, "by-reviewKey", reviewKey);
  const review: DailyConversationReview = {
    id: existing?.id ?? createId("conversation-review"),
    createdAt: existing?.createdAt ?? now,
    ...existing,
    ...input,
    reviewKey,
    date: input.date,
    reviewKind: input.reviewKind,
    sourceKind: input.sourceKind,
    sourceLabel: input.sourceLabel || getReviewSourceLabel(input.reviewKind, input.sourceKind),
    title: input.title.trim() || `${input.date} ${input.sourceLabel || "AI 对话"}回顾`,
    content: input.content.trim(),
    sessionCount: input.sessionCount,
    sessionIds: input.sessionIds ?? [],
    sourceReviewIds: input.sourceReviewIds ?? [],
    updatedAt: now,
  };

  await db.put(DAILY_CONVERSATION_REVIEW_STORE, review);
  return review;
}

export async function updateCodexDailyReview(id: string, patch: CodexDailyReviewPatch) {
  return updateDailyConversationReview(id, patch);
}

export async function updateDailyConversationReview(id: string, patch: DailyConversationReviewPatch) {
  const db = await getDb();
  const current = await db.get(DAILY_CONVERSATION_REVIEW_STORE, id);
  if (!current) throw new Error(`Conversation review not found: ${id}`);

  const updated: DailyConversationReview = {
    ...current,
    ...patch,
    reviewKey: patch.reviewKey ?? current.reviewKey,
    title: patch.title?.trim() || current.title,
    content: patch.content?.trim() ?? current.content,
    sessionIds: patch.sessionIds ?? current.sessionIds ?? [],
    sourceReviewIds: patch.sourceReviewIds ?? current.sourceReviewIds ?? [],
    updatedAt: formatTimestamp(),
  };

  await db.put(DAILY_CONVERSATION_REVIEW_STORE, updated);
  return updated;
}

export async function createDailyReviewReplacementDraft(input: CreateDailyReviewReplacementDraftInput) {
  const db = await getDb();
  const now = formatTimestamp();
  const reviewKey = createReviewKey(input.date, input.reviewKind, input.sourceKind);
  const existing = (await db.getAll(DAILY_REVIEW_DRAFT_STORE)).find(
    (draft) => draft.status === "pending" && draft.reviewKey === reviewKey,
  );
  const draft: DailyReviewReplacementDraft = {
    id: existing?.id ?? createId("review-draft"),
    createdAt: existing?.createdAt ?? now,
    ...existing,
    ...input,
    reviewKey,
    sourceLabel: input.sourceLabel || getReviewSourceLabel(input.reviewKind, input.sourceKind),
    title: input.title.trim() || "回顾替换草稿",
    content: input.content.trim(),
    sessionIds: input.sessionIds ?? [],
    sourceReviewIds: input.sourceReviewIds ?? [],
    updatedAt: now,
  };
  await db.put(DAILY_REVIEW_DRAFT_STORE, draft);
  return draft;
}

export async function getDailyReviewReplacementDrafts() {
  const db = await getDb();
  const drafts = await db.getAll(DAILY_REVIEW_DRAFT_STORE);
  return drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function updateDailyReviewReplacementDraft(id: string, patch: DailyReviewReplacementDraftPatch) {
  const db = await getDb();
  const current = await db.get(DAILY_REVIEW_DRAFT_STORE, id);
  if (!current) throw new Error(`Review replacement draft not found: ${id}`);
  const updated: DailyReviewReplacementDraft = {
    ...current,
    ...patch,
    title: patch.title?.trim() || current.title,
    content: patch.content?.trim() ?? current.content,
    sessionIds: patch.sessionIds ?? current.sessionIds,
    sourceReviewIds: patch.sourceReviewIds ?? current.sourceReviewIds,
    updatedAt: formatTimestamp(),
  };
  await db.put(DAILY_REVIEW_DRAFT_STORE, updated);
  return updated;
}

export async function applyDailyReviewReplacementDraft(id: string) {
  const db = await getDb();
  const tx = db.transaction([DAILY_REVIEW_DRAFT_STORE, DAILY_CONVERSATION_REVIEW_STORE], "readwrite");
  const draftStore = tx.objectStore(DAILY_REVIEW_DRAFT_STORE);
  const reviewStore = tx.objectStore(DAILY_CONVERSATION_REVIEW_STORE);
  const draft = await draftStore.get(id);
  if (!draft) throw new Error(`Review replacement draft not found: ${id}`);
  const now = formatTimestamp();
  const reviewKey = createReviewKey(draft.date, draft.reviewKind, draft.sourceKind);
  const existing = await reviewStore.index("by-reviewKey").get(reviewKey);
  const review: DailyConversationReview = {
    id: existing?.id ?? createId("conversation-review"),
    createdAt: existing?.createdAt ?? now,
    ...existing,
    reviewKey,
    date: draft.date,
    reviewKind: draft.reviewKind,
    sourceKind: draft.sourceKind,
    sourceLabel: draft.sourceLabel,
    title: draft.title.trim() || `${draft.date} ${draft.sourceLabel || "AI 对话"}回顾`,
    content: draft.content.trim(),
    sessionCount: draft.sessionCount,
    sessionIds: draft.sessionIds,
    sourceReviewIds: draft.sourceReviewIds,
    updatedAt: now,
  };
  await reviewStore.put(review);
  await draftStore.put({
    ...draft,
    status: "applied",
    targetReviewId: review.id,
    updatedAt: now,
  });
  await tx.done;
  return review;
}

export async function upsertConversationGenerationDraft(input: CreateConversationGenerationDraftInput) {
  const db = await getDb();
  const now = formatTimestamp();
  const existing = input.reviewKey
    ? (await db.getAll(CONVERSATION_GENERATION_DRAFT_STORE)).find((draft) => draft.reviewKey === input.reviewKey)
    : undefined;
  const draft: ConversationGenerationDraft = {
    id: existing?.id ?? createId("generation-draft"),
    createdAt: existing?.createdAt ?? now,
    ...existing,
    ...input,
    sourceLabel: input.sourceLabel || getReviewSourceLabel(input.reviewKind, input.sourceKind),
    partialContent: input.partialContent.trim(),
    selectedSessionIds: input.selectedSessionIds ?? [],
    updatedAt: now,
  };
  await db.put(CONVERSATION_GENERATION_DRAFT_STORE, draft);
  return draft;
}

export async function updateConversationGenerationDraft(id: string, patch: ConversationGenerationDraftPatch) {
  const db = await getDb();
  const current = await db.get(CONVERSATION_GENERATION_DRAFT_STORE, id);
  if (!current) throw new Error(`Conversation generation draft not found: ${id}`);
  const updated: ConversationGenerationDraft = {
    ...current,
    ...patch,
    partialContent: patch.partialContent?.trim() ?? current.partialContent,
    updatedAt: formatTimestamp(),
  };
  await db.put(CONVERSATION_GENERATION_DRAFT_STORE, updated);
  return updated;
}

export async function getConversationGenerationDrafts() {
  const db = await getDb();
  const drafts = await db.getAll(CONVERSATION_GENERATION_DRAFT_STORE);
  return drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function replaceCodexSessionIndex(records: ConversationSessionIndex[]) {
  return replaceConversationSessionIndex(records);
}

export async function replaceConversationSessionIndex(records: ConversationSessionIndex[]) {
  const db = await getDb();
  const tx = db.transaction(CODEX_SESSION_INDEX_STORE, "readwrite");
  await tx.store.clear();
  await Promise.all(records.map((record) => tx.store.put(normalizeConversationSessionIndex(record))));
  await tx.done;
  return records;
}

export async function getCodexSessionIndex() {
  return getConversationSessionIndex();
}

export async function getConversationSessionIndex() {
  const db = await getDb();
  const records = await db.getAll(CODEX_SESSION_INDEX_STORE);
  return records.map(normalizeConversationSessionIndex).sort((a, b) => b.modifiedAt - a.modifiedAt);
}

export async function getMemoryDocument() {
  const db = await getDb();
  return (await db.get(MEMORY_DOCUMENT_STORE, "main")) ?? null;
}

export async function putLibraryRecords({ items, folders }: LibraryRecordsInput) {
  const db = await getDb();
  const tx = db.transaction([ITEM_STORE, FOLDER_STORE], "readwrite");
  await Promise.all([
    ...folders.map((folder) => tx.objectStore(FOLDER_STORE).put(folder)),
    ...items.map((item) => tx.objectStore(ITEM_STORE).put(normalizeItem(item))),
  ]);
  await tx.done;
}

async function getSavedMemoryDocument() {
  const db = await getDb();
  return db.get(MEMORY_DOCUMENT_STORE, "main");
}

export async function updateMemoryDocument(content: string) {
  const db = await getDb();
  const current = await getMemoryDocument();
  const now = formatTimestamp();
  const updated: MemoryDocument = {
    id: "main",
    createdAt: current?.createdAt ?? now,
    ...current,
    content: content.trim(),
    updatedAt: now,
  };
  await db.put(MEMORY_DOCUMENT_STORE, updated);
  return updated;
}

export async function getMemoryPatchDrafts() {
  const db = await getDb();
  const drafts = await db.getAll(MEMORY_PATCH_STORE);
  return drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createMemoryPatchDraft(input: CreateMemoryPatchDraftInput) {
  const db = await getDb();
  const now = formatTimestamp();

  if (input.sourceReviewId) {
    const drafts = await db.getAll(MEMORY_PATCH_STORE);
    const existing = drafts.find(
      (draft) => draft.status === "pending" && draft.sourceReviewId === input.sourceReviewId,
    );

    if (existing) {
      const updated: MemoryPatchDraft = {
        ...existing,
        ...input,
        id: existing.id,
        title: input.title.trim() || existing.title,
        rationale: input.rationale.trim(),
        proposedContent: input.proposedContent.trim(),
        createdAt: existing.createdAt,
        updatedAt: now,
      };
      await db.put(MEMORY_PATCH_STORE, updated);
      return updated;
    }
  }

  const draft: MemoryPatchDraft = {
    id: createId("memory-patch"),
    ...input,
    title: input.title.trim() || "记忆修改建议",
    rationale: input.rationale.trim(),
    proposedContent: input.proposedContent.trim(),
    status: input.status,
    createdAt: now,
    updatedAt: now,
  };
  await db.put(MEMORY_PATCH_STORE, draft);
  return draft;
}

export async function updateMemoryPatchDraft(id: string, patch: MemoryPatchDraftPatch) {
  const db = await getDb();
  const current = await db.get(MEMORY_PATCH_STORE, id);
  if (!current) throw new Error(`Memory patch draft not found: ${id}`);

  const updated: MemoryPatchDraft = {
    ...current,
    ...patch,
    title: patch.title?.trim() || current.title,
    rationale: patch.rationale?.trim() ?? current.rationale,
    proposedContent: patch.proposedContent?.trim() ?? current.proposedContent,
    updatedAt: formatTimestamp(),
  };
  await db.put(MEMORY_PATCH_STORE, updated);
  return updated;
}

export async function applyMemoryPatchDraft(id: string, editedContent: string, options: ApplyMemoryPatchOptions = {}) {
  const db = await getDb();
  const tx = db.transaction([MEMORY_DOCUMENT_STORE, MEMORY_PATCH_STORE], "readwrite");
  const documentStore = tx.objectStore(MEMORY_DOCUMENT_STORE);
  const patchStore = tx.objectStore(MEMORY_PATCH_STORE);
  const [currentDocument, currentPatch] = await Promise.all([
    documentStore.get("main"),
    patchStore.get(id),
  ]);
  if (!currentPatch) throw new Error(`Memory patch draft not found: ${id}`);
  const hasExpectedDocument =
    options.expectedDocumentUpdatedAt !== undefined || options.expectedDocumentContent !== undefined;
  if (hasExpectedDocument) {
    const currentUpdatedAt = currentDocument?.updatedAt ?? "";
    const currentContent = currentDocument?.content ?? "";
    if (
      currentUpdatedAt !== (options.expectedDocumentUpdatedAt ?? "") ||
      currentContent !== (options.expectedDocumentContent ?? "")
    ) {
      throw new Error("长期记忆文档已经变化。请重新确认最新内容后再写入。");
    }
  }

  const now = formatTimestamp();
  const updatedDocument: MemoryDocument = {
    ...(currentDocument ?? {
      id: "main" as const,
      content: createInitialMemoryDocument(),
      createdAt: now,
    }),
    content: editedContent.trim(),
    updatedAt: now,
  };
  const updatedPatch: MemoryPatchDraft = {
    ...currentPatch,
    status: "applied",
    proposedContent: editedContent.trim(),
    updatedAt: now,
  };

  await Promise.all([
    documentStore.put(updatedDocument),
    patchStore.put(updatedPatch),
  ]);
  await tx.done;
  return updatedDocument;
}

export async function getAiSettings() {
  const db = await getDb();
  const saved = await db.get(SETTINGS_STORE, "ai");
  const savedProvider = String(saved?.provider ?? "deepseek");
  const provider = savedProvider === "OpenAICompatible" || savedProvider === "openai-compatible" ? "openai-compatible" : "deepseek";
  const settings: AiSettings = {
    ...getDefaultAiSettings(),
    ...saved,
    id: "ai",
    provider,
    supportsVision: Boolean(saved?.supportsVision),
    manualKeyStored: Boolean(saved?.manualKeyStored),
    manualKeyClearRequested: false,
    themeMode: saved?.themeMode ?? getThemeMode(),
  };

  return settings;
}

export async function saveAiSettings(settings: AiSettings) {
  const db = await getDb();
  const provider = settings.provider === "openai-compatible" ? "openai-compatible" : "deepseek";
  const {
    manualKeyClearRequested: _manualKeyClearRequested,
    ...settingsToSave
  } = settings;
  const nextSettings: AiSettings = {
    ...settingsToSave,
    id: "ai",
    provider,
    customProviderName: provider === "openai-compatible" ? settings.customProviderName?.trim() || "自定义模型" : "",
    supportsVision: provider === "openai-compatible" ? Boolean(settings.supportsVision) : false,
    manualKeyStored: Boolean(settings.manualKeyStored),
    themeMode: settings.themeMode ?? "dark",
    updatedAt: formatTimestamp(),
  };

  await db.put(SETTINGS_STORE, nextSettings);
  saveThemeMode(nextSettings.themeMode);
  return nextSettings;
}

export async function getKnowledgeLinks() {
  const db = await getDb();
  const links = await db.getAll(LINK_STORE);
  return links.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getLinksForEntity(kind: EntityKind, id: string) {
  const db = await getDb();
  const sourceLinks = await db.getAllFromIndex(LINK_STORE, "by-source", [kind, id]);
  const targetLinks = await db.getAllFromIndex(LINK_STORE, "by-target", [kind, id]);
  const byId = new Map<string, KnowledgeLink>();

  [...sourceLinks, ...targetLinks].forEach((link) => byId.set(link.id, link));
  return Array.from(byId.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createKnowledgeLink(input: CreateKnowledgeLinkInput) {
  const db = await getDb();
  const sourceId = input.sourceId.trim();
  const targetId = input.targetId.trim();
  const relation = input.relation.trim() || "相关";

  if (!sourceId || !targetId) {
    throw new Error("关联对象不能为空。");
  }

  if (input.sourceKind === input.targetKind && sourceId === targetId) {
    throw new Error("不能把内容关联到自己。");
  }

  const tx = db.transaction(LINK_STORE, "readwrite");
  const existing = await tx.store.index("by-source").getAll([input.sourceKind, sourceId]);
  const duplicate = existing.find(
    (link) =>
      link.targetKind === input.targetKind &&
      link.targetId === targetId &&
      link.relation === relation,
  );

  if (duplicate) {
    await tx.done;
    return duplicate;
  }

  const link: KnowledgeLink = {
    id: createId("link"),
    sourceKind: input.sourceKind,
    sourceId,
    targetKind: input.targetKind,
    targetId,
    relation,
    createdAt: formatTimestamp(),
  };

  await tx.store.put(link);
  await tx.done;
  return link;
}

export async function deleteKnowledgeLink(id: string) {
  const db = await getDb();
  await db.delete(LINK_STORE, id);
}

export async function deleteLinksForEntity(kind: EntityKind, id: string) {
  const db = await getDb();
  const tx = db.transaction(LINK_STORE, "readwrite");
  await deleteLinksForEntityInTransaction(tx.store, kind, id);
  await tx.done;
}

async function deleteLinksForEntityInTransaction(
  store: LinkStoreForTransaction,
  kind: EntityKind,
  id: string,
) {
  const sourceLinks = await store.index("by-source").getAll([kind, id]);
  const targetLinks = await store.index("by-target").getAll([kind, id]);
  const linkIds = new Set([...sourceLinks, ...targetLinks].map((link) => link.id));
  if (linkIds.size === 0) return;

  await Promise.all(Array.from(linkIds).map((linkId) => store.delete(linkId)));
}

export async function getSearchSnapshot() {
  const [
    items,
    journalEntries,
    memoryCards,
    summaryReports,
    memoryDocument,
    conversationReviews,
    dailyReviewDrafts,
    conversationGenerationDrafts,
    memoryPatchDrafts,
  ] = await Promise.all([
    getItems(),
    getJournalEntries(),
    getMemoryCards(),
    getSummaryReports(),
    getSavedMemoryDocument(),
    getDailyConversationReviews(),
    getDailyReviewReplacementDrafts(),
    getConversationGenerationDrafts(),
    getMemoryPatchDrafts(),
  ]);

  return {
    items,
    journalEntries,
    memoryCards,
    summaryReports,
    memoryDocument,
    conversationReviews,
    dailyReviewDrafts,
    conversationGenerationDrafts,
    memoryPatchDrafts,
  };
}

export async function searchKnowledge(query: string, options: SearchOptions = {}) {
  const normalizedQuery = normalizeSearchText(query);
  const limitPerKind = options.limitPerKind ?? 20;
  const offsetByKind = options.offsetByKind ?? {};
  const results = createEmptySearchResults();

  if (!normalizedQuery) return results;

  const snapshot = await getSearchSnapshot();
  results.item = buildSearchGroup(
    snapshot.items,
    normalizedQuery,
    (item) => ({
      kind: "item",
      id: item.id,
      title: item.title,
      snippetSource: [
        item.title,
        item.content,
        item.aiSummary,
        item.filePath,
        item.sourceUrl,
        ...item.tags,
        ...(item.todos ?? []),
      ].join(" "),
      updatedAt: item.updatedAt,
      route: { kind: "item", itemId: item.id },
    }),
    offsetByKind.item ?? 0,
    limitPerKind,
  );
  results.journal = buildSearchGroup(
    snapshot.journalEntries,
    normalizedQuery,
    (entry) => ({
      kind: "journal",
      id: entry.id,
      title: `日志 · ${entry.entryDate}`,
      snippetSource: [entry.content, ...entry.tags, ...entry.todos].join(" "),
      updatedAt: entry.updatedAt,
      route: { kind: "journal", date: entry.entryDate.slice(0, 10), entryId: entry.id },
    }),
    offsetByKind.journal ?? 0,
    limitPerKind,
  );
  const memorySearchRecords = [
    ...snapshot.memoryCards.filter((memory) => memory.status !== "ignored").map((memory) => ({
      id: memory.id,
      title: memory.title,
      snippetSource: [memory.title, memory.content, memory.category].join(" "),
      updatedAt: memory.updatedAt,
      route: { kind: "memory" as const, subView: "legacy" as const, memoryId: memory.id },
    })),
    ...(snapshot.memoryDocument
      ? [{
          id: "memory-document-main",
          title: "长期记忆文档",
          snippetSource: snapshot.memoryDocument.content,
          updatedAt: snapshot.memoryDocument.updatedAt,
          route: { kind: "memory" as const, subView: "document" as const },
        }]
      : []),
    ...snapshot.memoryPatchDrafts.filter((draft) => draft.status === "pending").map((draft) => ({
      id: draft.id,
      title: draft.title || "记忆修改建议",
      snippetSource: [draft.title, draft.rationale, draft.proposedContent, draft.status].join(" "),
      updatedAt: draft.updatedAt,
      route: { kind: "memory" as const, subView: "patches" as const },
    })),
  ];

  results.memory = buildSearchGroup(
    memorySearchRecords,
    normalizedQuery,
    (memory) => ({
      kind: "memory",
      id: memory.id,
      title: memory.title,
      snippetSource: memory.snippetSource,
      updatedAt: memory.updatedAt,
      route: memory.route,
    }),
    offsetByKind.memory ?? 0,
    limitPerKind,
  );
  const summarySearchRecords = [
    ...snapshot.summaryReports.map((report) => ({
      id: report.id,
      title: report.title,
      snippetSource: [report.title, report.content, report.periodType, report.periodStart, report.periodEnd].join(" "),
      updatedAt: report.updatedAt,
      route:
        report.periodType === "day"
          ? ({ kind: "journal" as const, date: report.periodStart, summaryId: report.id })
          : ({ kind: "memory" as const, subView: "archive" as const, summaryId: report.id }),
    })),
    ...snapshot.conversationReviews.map((review) => ({
      id: review.id,
      title: review.title || `${review.sourceLabel} 回顾`,
      snippetSource: [
        review.title,
        review.content,
        review.sourceLabel,
        review.date,
        review.reviewKind,
        review.sourceKind ?? "",
      ].join(" "),
      updatedAt: review.updatedAt,
      route: { kind: "memory" as const, subView: "archive" as const, reviewId: review.id },
    })),
    ...snapshot.dailyReviewDrafts.filter((draft) => draft.status === "pending").map((draft) => ({
      id: draft.id,
      title: `${draft.title || "回顾替换草稿"} · 草稿`,
      snippetSource: [draft.title, draft.content, draft.sourceLabel, draft.status, draft.date].join(" "),
      updatedAt: draft.updatedAt,
      route: { kind: "memory" as const, subView: "archive" as const, reviewId: draft.targetReviewId, reviewDraftId: draft.id },
    })),
    ...snapshot.conversationGenerationDrafts.filter((draft) => draft.status === "running").map((draft) => ({
      id: draft.id,
      title: `${draft.title || "未完成的回顾草稿"} · ${draft.status}`,
      snippetSource: [
        draft.title ?? "",
        draft.partialContent,
        draft.sourceLabel,
        draft.stage,
        draft.message,
        draft.date ?? "",
      ].join(" "),
      updatedAt: draft.updatedAt,
      route: { kind: "memory" as const, subView: "ai-review" as const },
    })),
  ];

  results.summary = buildSearchGroup(
    summarySearchRecords,
    normalizedQuery,
    (report) => ({
      kind: "summary",
      id: report.id,
      title: report.title,
      snippetSource: report.snippetSource,
      updatedAt: report.updatedAt,
      route: report.route,
    }),
    offsetByKind.summary ?? 0,
    limitPerKind,
  );

  return results;
}

export async function getTodayDashboardData(): Promise<TodayDashboardData> {
  const [items, journalEntries, memoryCards] = await Promise.all([getItems(), getJournalEntries(), getMemoryCards()]);
  const todayKey = formatDateKey(new Date());
  const readingStatuses: ReadingStatus[] = ["待阅读", "阅读中", "需复习"];
  const todayJournalEntries = journalEntries.filter((entry) => entry.entryDate.slice(0, 10) === todayKey);
  const journalTodos: JournalTodo[] = todayJournalEntries.flatMap((entry) =>
    entry.todos.map((todo, index) => ({
      id: `${entry.id}-${index}`,
      entryId: entry.id,
      content: todo,
      entryDate: entry.entryDate,
    })),
  );
  const pendingItems = items.filter((item) => item.processStatus === "待整理");
  const readingItems = items.filter((item) => readingStatuses.includes(item.readingStatus));
  const candidateMemories = memoryCards.filter((memory) => memory.status === "candidate");

  return {
    todayJournalEntries: todayJournalEntries.slice(0, 6),
    todayJournalEntryCount: todayJournalEntries.length,
    pendingItems: pendingItems.slice(0, 6),
    pendingItemCount: pendingItems.length,
    readingItems: readingItems.slice(0, 6),
    readingItemCount: readingItems.length,
    candidateMemories: candidateMemories.slice(0, 6),
    candidateMemoryCount: candidateMemories.length,
    journalTodos: journalTodos.slice(0, 8),
    journalTodoCount: journalTodos.length,
  };
}

function normalizeItem(item: Item): Item {
  const legacy = mapLegacyStatus(String(item.status ?? ""));

  return {
    ...item,
    processStatus: normalizeProcessStatus(item.processStatus) ?? legacy.processStatus,
    readingStatus: normalizeReadingStatus(item.readingStatus) ?? legacy.readingStatus,
    tags: item.tags ?? [],
    content: item.content ?? "",
    aiSummary: item.aiSummary ?? "等待 AI 摘要。",
    todos: item.todos ?? [],
    favorite: item.favorite ?? false,
  };
}

function normalizeJournalEntry(entry: JournalEntry): JournalEntry {
  return {
    ...entry,
    entryDate: entry.entryDate ?? entry.createdAt ?? formatTimestamp(),
    content: entry.content ?? "",
    tags: entry.tags ?? [],
    todos: entry.todos ?? [],
    createdAt: entry.createdAt ?? entry.entryDate ?? formatTimestamp(),
    updatedAt: entry.updatedAt ?? entry.entryDate ?? formatTimestamp(),
  };
}

function createReviewKey(
  date: string,
  reviewKind: ConversationReviewKind,
  sourceKind?: ConversationSourceKind,
) {
  const sourceKey = reviewKind === "combined" || reviewKind === "auto-work" ? reviewKind : sourceKind ?? "codex";
  return `${date}:${reviewKind}:${sourceKey}`;
}

function getReviewSourceLabel(reviewKind: ConversationReviewKind, sourceKind?: ConversationSourceKind) {
  if (reviewKind === "combined") return "综合";
  if (reviewKind === "auto-work") return "自动工作回顾";
  if (sourceKind === "claude") return "Claude Code";
  return "Codex";
}

function normalizeConversationSourceKinds(sourceKinds?: ConversationSourceKind[]) {
  const normalized = Array.from(
    new Set((sourceKinds ?? []).filter((source): source is ConversationSourceKind => source === "codex" || source === "claude")),
  );
  return normalized.length > 0 ? normalized : (["codex", "claude"] as ConversationSourceKind[]);
}

function normalizeAutoWorkReviewSettings(saved?: Partial<AutoWorkReviewSettings>): AutoWorkReviewSettings {
  const defaults = getDefaultAutoWorkReviewSettings();
  return {
    ...defaults,
    ...saved,
    id: "auto-work-review",
    enabled: Boolean(saved?.enabled),
    sourceKinds: normalizeConversationSourceKinds(saved?.sourceKinds),
    intervalMinutes: 30,
    lastStatus: saved?.lastStatus ?? defaults.lastStatus,
    updatedAt: saved?.updatedAt ?? defaults.updatedAt,
  };
}

function normalizeConversationSessionIndex(record: ConversationSessionIndex): ConversationSessionIndex {
  const sourceKind = record.sourceKind ?? (record.id.startsWith("claude-session-") ? "claude" : "codex");
  return {
    ...record,
    sourceKind,
    sourceLabel: record.sourceLabel || getReviewSourceLabel("source", sourceKind),
    title: record.title || record.path.split(/[\\/]/).pop()?.replace(/\.jsonl$/i, "") || record.id,
    preview: record.preview || "扫描阶段只读取文件元信息；勾选并生成时才读取正文。",
    messageCount: record.messageCount ?? 0,
    userMessageCount: record.userMessageCount ?? 0,
    assistantMessageCount: record.assistantMessageCount ?? 0,
    charCount: record.charCount ?? 0,
  };
}

async function migrateLegacyCodexReviews(db: IDBPDatabase<KnowledgeBaseDb>) {
  if (!db.objectStoreNames.contains(CODEX_REVIEW_STORE) || !db.objectStoreNames.contains(DAILY_CONVERSATION_REVIEW_STORE)) {
    return;
  }

  const legacyReviews = await db.getAll(CODEX_REVIEW_STORE);
  if (legacyReviews.length === 0) return;

  for (const legacy of legacyReviews) {
    const reviewKey = createReviewKey(legacy.date, "source", "codex");
    const existing = await db.getFromIndex(DAILY_CONVERSATION_REVIEW_STORE, "by-reviewKey", reviewKey);
    if (existing && existing.updatedAt >= legacy.updatedAt) continue;

    const migrated: DailyConversationReview = {
      id: existing?.id ?? `migrated-${legacy.id}`,
      reviewKey,
      date: legacy.date,
      reviewKind: "source",
      sourceKind: "codex",
      sourceLabel: "Codex",
      title: legacy.title,
      content: legacy.content,
      sessionCount: legacy.sessionCount,
      sessionIds: legacy.sessionIds ?? [],
      sourceReviewIds: [],
      createdAt: existing?.createdAt ?? legacy.createdAt,
      updatedAt: legacy.updatedAt,
    };
    await db.put(DAILY_CONVERSATION_REVIEW_STORE, migrated);
  }
}

function normalizeProcessStatus(value?: string): ProcessStatus | undefined {
  if (!value) return undefined;
  const exact = PROCESS_STATUSES.find((status) => status === value);
  return exact ?? processStatusAliases[value];
}

function normalizeReadingStatus(value?: string): ReadingStatus | undefined {
  if (!value) return undefined;
  const exact = READING_STATUSES.find((status) => status === value);
  return exact ?? readingStatusAliases[value];
}

function mapLegacyStatus(status: string): { processStatus: ProcessStatus; readingStatus: ReadingStatus } {
  if (status === "未处理" || status === "鏈鐞?") {
    return { processStatus: "收件箱", readingStatus: "不需要" };
  }

  if (status === "待阅读" || status === "寰呴槄璇?") {
    return { processStatus: "待整理", readingStatus: "待阅读" };
  }

  if (status === "已整理" || status === "宸叉暣鐞?") {
    return { processStatus: "已整理", readingStatus: "已阅读" };
  }

  if (status === "已归档" || status === "宸插綊妗?") {
    return { processStatus: "已归档", readingStatus: "不需要" };
  }

  if (status === "废弃" || status === "搴熷純") {
    return { processStatus: "废弃", readingStatus: "不需要" };
  }

  return { processStatus: "收件箱", readingStatus: "不需要" };
}

function getDefaultReadingStatus(type?: Item["type"]): ReadingStatus {
  return type === "document" || type === "url" ? "待阅读" : "不需要";
}

const processStatusAliases: Record<string, ProcessStatus> = {
  "鏀朵欢绠?": "收件箱",
  "寰呮暣鐞?": "待整理",
  "宸叉暣鐞?": "已整理",
  "宸插綊妗?": "已归档",
  "搴熷純": "废弃",
};

const readingStatusAliases: Record<string, ReadingStatus> = {
  "涓嶉渶瑕?": "不需要",
  "寰呴槄璇?": "待阅读",
  "闃呰涓?": "阅读中",
  "宸查槄璇?": "已阅读",
  "闇€澶嶄範": "需复习",
};

function createEmptySearchResults(): Record<EntityKind, SearchResult[]> {
  return {
    journal: [],
    item: [],
    memory: [],
    summary: [],
  };
}

function buildSearchGroup<T>(
  records: T[],
  query: string,
  select: (record: T) => {
    kind: EntityKind;
    id: string;
    title: string;
    snippetSource: string;
    updatedAt: string;
    route?: SearchResult["route"];
  },
  offset: number,
  limit: number,
): SearchResult[] {
  const matched: SearchResult[] = [];

  for (const record of records) {
    const selected = select(record);
    const searchable = normalizeSearchText(`${selected.title} ${selected.snippetSource}`);
    if (!searchable.includes(query)) continue;

    matched.push({
      kind: selected.kind,
      id: selected.id,
      title: redactSensitiveSearchText(selected.title),
      snippet: createSearchSnippet(selected.snippetSource, query),
      updatedAt: selected.updatedAt,
      route: selected.route,
    });
  }

  return matched
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(offset, offset + limit);
}

function normalizeSearchText(value: string) {
  return value.trim().toLowerCase();
}

function createSearchSnippet(source: string, query: string) {
  const compact = redactSensitiveSearchText(source).replace(/\s+/g, " ").trim();
  if (!compact) return "无可预览内容";

  const index = compact.toLowerCase().indexOf(query);
  if (index < 0) {
    return Array.from(compact).slice(0, 96).join("");
  }

  const start = Math.max(0, index - 32);
  const end = Math.min(compact.length, index + query.length + 64);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < compact.length ? "..." : "";

  return `${prefix}${compact.slice(start, end)}${suffix}`;
}

function redactSensitiveSearchText(source: string) {
  return source
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[已隐藏的 token]")
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/gi, "[已隐藏的 key]")
    .replace(/\bBearer\s+[A-Za-z0-9._-]{16,}/gi, "Bearer [已隐藏]")
    .replace(/\b(authorization)\s*[:=]\s*Bearer\s+[A-Za-z0-9._-]{8,}/gi, "$1=[已隐藏]")
    .replace(
      /((?:api[_-]?key|access[_-]?token|id[_-]?token|refresh[_-]?token|session[_-]?token|client[_-]?secret|secret|password|authorization|token|key)\s*["']?\s*[:=]\s*["']?)([^"',\s}\]&]{8,})/gi,
      "$1[已隐藏]",
    )
    .replace(
      /([?&](?:api[_-]?key|access[_-]?token|id[_-]?token|refresh[_-]?token|session[_-]?token|client[_-]?secret|secret|password|authorization|token|key)=)([^&#\s]{8,})/gi,
      "$1[已隐藏]",
    );
}

function createInitialMemoryDocument() {
  return [
    "这是你的长期记忆文档。",
    "",
    "这里适合保存长期稳定的信息，例如你的偏好、项目方向、工具习惯、设计原则和反复出现的重要约束。",
    "",
    "暂时不要把一次性的报错、临时路径、密钥、当天情绪或无上下文碎片写进来。每一次写入都应经过你确认。",
  ].join("\n");
}

function formatDateKey(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
