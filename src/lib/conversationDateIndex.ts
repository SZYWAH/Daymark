import type { ConversationSourceKind } from "../types";
import {
  cancelConversationReviewJob,
  completeConversationDateIndex,
  isDesktopRuntime,
  type ConversationSessionScanProgressEvent,
} from "./desktop";

const STORAGE_KEY = "daymark.conversation-date-index.v1";

export type ConversationDateIndexPreferenceV1 = {
  version: 1;
  idleCompletionEnabled: boolean;
  userScanCompleted: boolean;
};

const DEFAULT_PREFERENCE: ConversationDateIndexPreferenceV1 = {
  version: 1,
  idleCompletionEnabled: false,
  userScanCompleted: false,
};

let activeBackgroundJobId = "";

function getStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function getConversationDateIndexPreference(): ConversationDateIndexPreferenceV1 {
  const storage = getStorage();
  if (!storage) return { ...DEFAULT_PREFERENCE };
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || "null") as Partial<ConversationDateIndexPreferenceV1> | null;
    if (!parsed || parsed.version !== 1) return { ...DEFAULT_PREFERENCE };
    return {
      version: 1,
      idleCompletionEnabled: Boolean(parsed.idleCompletionEnabled),
      userScanCompleted: Boolean(parsed.userScanCompleted),
    };
  } catch {
    return { ...DEFAULT_PREFERENCE };
  }
}

export function saveConversationDateIndexPreference(
  patch: Partial<Omit<ConversationDateIndexPreferenceV1, "version">>,
) {
  const next = { ...getConversationDateIndexPreference(), ...patch, version: 1 as const };
  try {
    getStorage()?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // The preference is optional; indexing remains available on demand.
  }
  return next;
}

export function markConversationDateIndexUserScanCompleted() {
  return saveConversationDateIndexPreference({ userScanCompleted: true });
}

export async function pauseConversationDateIndexCompletion() {
  const jobId = activeBackgroundJobId;
  activeBackgroundJobId = "";
  if (!jobId) return;
  try {
    await cancelConversationReviewJob(jobId);
  } catch {
    // The Rust task may already have completed or been paused by a foreground scan.
  }
}

export function startConversationDateIndexCompletion(options?: {
  sourceKinds?: ConversationSourceKind[];
  onProgress?: (event: ConversationSessionScanProgressEvent) => void;
}) {
  const preference = getConversationDateIndexPreference();
  if (
    !isDesktopRuntime()
    || !preference.idleCompletionEnabled
    || !preference.userScanCompleted
    || activeBackgroundJobId
  ) {
    return;
  }

  const jobId = `date-index-background-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  activeBackgroundJobId = jobId;
  void completeConversationDateIndex(
    {
      sourceKinds: options?.sourceKinds ?? ["codex", "claude"],
      limit: 2_000,
    },
    jobId,
    options?.onProgress,
  )
    .catch(() => undefined)
    .finally(() => {
      if (activeBackgroundJobId === jobId) activeBackgroundJobId = "";
    });
}

export const conversationDateIndexPreferenceStorageKey = STORAGE_KEY;
