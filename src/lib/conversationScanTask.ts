import type { ActiveView, ConversationSessionIndexOptions, ConversationSourceKind } from "../types";
import type {
  ConversationSessionScanProgressEvent,
  ConversationSessionScanResult,
} from "./desktop";

export type ConversationScanSourceFilter = "all" | ConversationSourceKind;

export type ConversationScanQuery = {
  sourceFilter: ConversationScanSourceFilter;
  dateFrom: string;
  dateTo: string;
  cwdQuery: string;
  keyword: string;
};

export type ConversationScanTaskStatus =
  | "running"
  | "cancelling"
  | "completed"
  | "cancelled"
  | "failed";

export type ConversationScanRuntime = {
  jobId: string;
  status: ConversationScanTaskStatus;
  query: ConversationScanQuery;
  scanKey: string;
  startedAt: string;
  message: string;
  progress?: ConversationSessionScanProgressEvent;
  result?: ConversationSessionScanResult;
};

export const DEFAULT_CONVERSATION_SCAN_QUERY: ConversationScanQuery = {
  sourceFilter: "all",
  dateFrom: "",
  dateTo: "",
  cwdQuery: "",
  keyword: "",
};

export function normalizeConversationScanQuery(query: ConversationScanQuery): ConversationScanQuery {
  return {
    sourceFilter: query.sourceFilter,
    dateFrom: query.dateFrom.trim(),
    dateTo: query.dateTo.trim(),
    cwdQuery: query.cwdQuery.trim(),
    keyword: query.keyword.trim(),
  };
}

export function createConversationScanKey(query: ConversationScanQuery) {
  return JSON.stringify(normalizeConversationScanQuery(query));
}

export function toConversationScanOptions(query: ConversationScanQuery): ConversationSessionIndexOptions {
  const normalized = normalizeConversationScanQuery(query);
  return {
    sourceKinds: normalized.sourceFilter === "all" ? ["codex", "claude"] : [normalized.sourceFilter],
    dateFrom: normalized.dateFrom || undefined,
    dateTo: normalized.dateTo || undefined,
    cwdQuery: normalized.cwdQuery || undefined,
    keyword: normalized.keyword || undefined,
    limit: 800,
  };
}

export function isConversationScanActive(task: ConversationScanRuntime | null) {
  return task?.status === "running" || task?.status === "cancelling";
}

export function shouldShowConversationScanEntry(
  activeView: ActiveView,
  task: ConversationScanRuntime | null,
  workspaceOpen: boolean,
) {
  if (!task || workspaceOpen) return false;
  if (activeView.kind === "memory" && activeView.subView === "ai-review") return false;
  return task.status !== "completed" || task.result !== undefined;
}

export function createConversationScanJobId() {
  if ("randomUUID" in crypto) return crypto.randomUUID();
  return `conversation-scan-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
