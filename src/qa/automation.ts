import { invoke } from "@tauri-apps/api/core";
import {
  createFolder,
  createItem,
  getAiSettings,
  getFolders,
  getItems,
  saveAiSettings,
  updateItem,
} from "../data/itemStore";
import {
  hasStoredAiApiKey,
  resolveAiSettingsForRequest,
  saveAiSettingsWithSecrets,
} from "../lib/aiSecrets";
import {
  requestDesktopAiGeneration,
  streamDesktopAiGeneration,
  type DesktopAiGenerateRequest,
} from "../lib/aiTransport";
import type { AiSettings, FolderNode, Item } from "../types";

export type QaAutomationScenario =
  | "seed-upgrade"
  | "verify-upgrade"
  | "verify-credential-cleared"
  | "startup-probe";

type QaAutomationConfig = {
  scenario: QaAutomationScenario;
  mockOrigin: string;
};

type QaAutomationStage =
  | "frontend-mounted"
  | "dashboard-ready"
  | "dashboard-failed"
  | "seeded"
  | "upgrade-verified"
  | "credential-cleared"
  | "ai-non-stream"
  | "ai-stream"
  | "completed"
  | "failed";

type QaAutomationRecord = {
  stage: QaAutomationStage;
  outcome: "info" | "pass" | "fail";
  elapsedMs: number;
  metrics?: Record<string, number>;
  checks?: Record<string, boolean>;
  fingerprints?: Record<string, string>;
};

type QaUpgradeMarker = {
  version: 1;
  itemId: string;
  folderId: string;
  itemFingerprint: string;
  layoutFingerprint: string;
};

export type QaUpgradeState = {
  item: Item;
  folder: FolderNode;
  settings: AiSettings;
  layoutValue: string | null;
  credentialStored: boolean;
};

const MARKER_KEY = "daymark.qa.installer-upgrade.v1";
const LAYOUT_KEY = "personal-knowledge-base:layout:v11";
const SENTINEL_SOURCE_URL = "https://qa.invalid/daymark-archive-upgrade-sentinel";
const SENTINEL_FOLDER_TITLE = "QA Archive Upgrade";
const SENTINEL_TITLE = "Synthetic archive upgrade sentinel";
const SENTINEL_CONTENT = "Synthetic local-only content used to verify the Daymark QA installer upgrade.";
const SENTINEL_TAGS = ["QA", "archive-upgrade"];
const SYNTHETIC_KEY = "daymark-qa-synthetic-key-v1";
const EXPECTED_LAYOUT = JSON.stringify({
  sidebarWidth: 232,
  sidebarCollapsed: false,
  libraryDirectoryWidth: 264,
  libraryListWidth: 612,
  libraryListCollapsed: false,
  libraryDirectoryCollapsed: false,
});
const DASHBOARD_TIMEOUT_MS = 5_000;

function elapsed(startedAt: number) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalItem(item: Pick<Item, "title" | "content" | "tags" | "folderId" | "sourceUrl" | "type" | "processStatus" | "readingStatus">) {
  return JSON.stringify({
    title: item.title,
    content: item.content,
    tags: item.tags,
    folderId: item.folderId ?? "",
    sourceUrl: item.sourceUrl ?? "",
    type: item.type,
    processStatus: item.processStatus,
    readingStatus: item.readingStatus,
  });
}

function expectedCanonicalItem(folderId: string) {
  return canonicalItem({
    title: SENTINEL_TITLE,
    content: SENTINEL_CONTENT,
    tags: SENTINEL_TAGS,
    folderId,
    sourceUrl: SENTINEL_SOURCE_URL,
    type: "note",
    processStatus: "待整理",
    readingStatus: "不需要",
  });
}

export function getDashboardSettlement(input: {
  startupVisible: boolean;
  bodyText: string;
  hasTodayNavigation: boolean;
}): "loading" | "ready" | "failed" {
  if (input.startupVisible) return "loading";
  if (input.bodyText.includes("今日内容暂时未加载")) return "failed";
  if (input.bodyText.includes("正在整理今日内容")) return "loading";
  return input.hasTodayNavigation ? "ready" : "loading";
}

function readDashboardSettlement() {
  const bodyText = document.body.textContent ?? "";
  const hasTodayNavigation = Array.from(document.querySelectorAll("button"))
    .some((button) => button.textContent?.trim() === "今日");
  return getDashboardSettlement({
    startupVisible: Boolean(document.querySelector(".startup-screen")),
    bodyText,
    hasTodayNavigation,
  });
}

async function waitForDashboardSettlement() {
  const startedAt = performance.now();
  while (performance.now() - startedAt <= DASHBOARD_TIMEOUT_MS) {
    const status = readDashboardSettlement();
    if (status !== "loading") return { status, elapsedMs: elapsed(startedAt) };
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  return { status: "loading" as const, elapsedMs: elapsed(startedAt) };
}

async function record(record: QaAutomationRecord) {
  await invoke("qa_automation_record", { record });
}

async function finish(success: boolean) {
  await invoke("qa_automation_finish", { success });
}

function makeSettings(mockOrigin: string, current: AiSettings): AiSettings {
  return {
    ...current,
    id: "ai",
    provider: "openai-compatible",
    protocol: "openai-chat-completions",
    customProviderName: "QA Mock",
    baseUrl: mockOrigin,
    model: "qa-success",
    useEnvKey: false,
    manualApiKey: SYNTHETIC_KEY,
    manualKeyStored: false,
    manualKeyClearRequested: false,
    supportsVision: false,
    stream: true,
    themeMode: "dark",
    updatedAt: new Date().toISOString(),
  };
}

export async function seedQaUpgradeState(mockOrigin: string): Promise<QaUpgradeMarker> {
  const folders = await getFolders();
  const folder = folders.find((candidate) => candidate.title === SENTINEL_FOLDER_TITLE)
    ?? await createFolder({ title: SENTINEL_FOLDER_TITLE, sortOrder: 9_001 });
  const items = await getItems();
  const existing = items.find((candidate) => candidate.sourceUrl === SENTINEL_SOURCE_URL);
  const item = existing
    ? await updateItem(existing.id, {
        title: SENTINEL_TITLE,
        content: SENTINEL_CONTENT,
        tags: SENTINEL_TAGS,
        folderId: folder.id,
        sourceUrl: SENTINEL_SOURCE_URL,
        type: "note",
        aiSummary: "Synthetic QA installer upgrade sentinel.",
        processStatus: "待整理",
        readingStatus: "不需要",
      })
    : await createItem({
        title: SENTINEL_TITLE,
        content: SENTINEL_CONTENT,
        tags: SENTINEL_TAGS,
        folderId: folder.id,
        sourceUrl: SENTINEL_SOURCE_URL,
        type: "note",
        aiSummary: "Synthetic QA installer upgrade sentinel.",
        processStatus: "待整理",
        readingStatus: "不需要",
      });

  window.localStorage.setItem(LAYOUT_KEY, EXPECTED_LAYOUT);
  const currentSettings = await getAiSettings();
  await saveAiSettingsWithSecrets(makeSettings(mockOrigin, currentSettings));
  const marker: QaUpgradeMarker = {
    version: 1,
    itemId: item.id,
    folderId: folder.id,
    itemFingerprint: await sha256(expectedCanonicalItem(folder.id)),
    layoutFingerprint: await sha256(EXPECTED_LAYOUT),
  };
  window.localStorage.setItem(MARKER_KEY, JSON.stringify(marker));
  return marker;
}

function readMarker(): QaUpgradeMarker {
  const parsed = JSON.parse(window.localStorage.getItem(MARKER_KEY) ?? "null") as Partial<QaUpgradeMarker> | null;
  if (!parsed || parsed.version !== 1 || !parsed.itemId || !parsed.folderId
    || !parsed.itemFingerprint || !parsed.layoutFingerprint) {
    throw new Error("QA upgrade marker is missing.");
  }
  return parsed as QaUpgradeMarker;
}

export async function evaluateUpgradeState(marker: QaUpgradeMarker): Promise<QaUpgradeState> {
  const [items, folders, settings] = await Promise.all([getItems(), getFolders(), getAiSettings()]);
  const item = items.find((candidate) => candidate.id === marker.itemId);
  const folder = folders.find((candidate) => candidate.id === marker.folderId);
  if (!item || !folder) throw new Error("QA upgrade sentinel records are missing.");
  return {
    item,
    folder,
    settings,
    layoutValue: window.localStorage.getItem(LAYOUT_KEY),
    credentialStored: await hasStoredAiApiKey(settings),
  };
}

async function verifyUpgrade(marker: QaUpgradeMarker, mockOrigin: string, startedAt: number) {
  const state = await evaluateUpgradeState(marker);
  const itemFingerprint = await sha256(canonicalItem(state.item));
  const layoutFingerprint = await sha256(state.layoutValue ?? "");
  const checks = {
    "item-preserved": itemFingerprint === marker.itemFingerprint,
    "folder-preserved": state.folder.title === SENTINEL_FOLDER_TITLE,
    "layout-preserved": layoutFingerprint === marker.layoutFingerprint,
    "settings-preserved": state.settings.baseUrl === mockOrigin
      && state.settings.model === "qa-success"
      && state.settings.provider === "openai-compatible",
    "credential-present": state.credentialStored,
  };
  if (Object.values(checks).some((value) => !value)) throw new Error("QA upgrade state verification failed.");
  await record({
    stage: "upgrade-verified",
    outcome: "pass",
    elapsedMs: elapsed(startedAt),
    checks,
    metrics: { items: 1, folders: 1 },
    fingerprints: { item: itemFingerprint, layout: layoutFingerprint },
  });

  const effective = await resolveAiSettingsForRequest({ ...state.settings, manualKeyStored: true });
  const request: DesktopAiGenerateRequest = {
    protocol: "openai-chat-completions",
    endpoint: `${mockOrigin}/chat/completions`,
    apiKey: effective.manualApiKey ?? "",
    model: "qa-success",
    system: "Return a short synthetic QA acknowledgement.",
    messages: [{ role: "user", content: [{ type: "text", text: "Synthetic Daymark installer QA." }] }],
    maxTokens: 32,
    timeoutMs: 8_000,
  };
  const nonStream = await requestDesktopAiGeneration(request);
  await record({
    stage: "ai-non-stream",
    outcome: nonStream.trim() ? "pass" : "fail",
    elapsedMs: elapsed(startedAt),
    checks: { "non-stream-nonempty": Boolean(nonStream.trim()) },
    metrics: { characters: nonStream.length },
  });
  let tokenCount = 0;
  const streamed = await streamDesktopAiGeneration(request, () => { tokenCount += 1; });
  await record({
    stage: "ai-stream",
    outcome: streamed.trim() && tokenCount > 0 ? "pass" : "fail",
    elapsedMs: elapsed(startedAt),
    checks: { "stream-nonempty": Boolean(streamed.trim()), "stream-token-received": tokenCount > 0 },
    metrics: { characters: streamed.length, tokens: tokenCount },
  });
  if (!nonStream.trim() || !streamed.trim() || tokenCount === 0) {
    throw new Error("QA mock AI verification failed.");
  }

  await saveAiSettingsWithSecrets({
    ...state.settings,
    manualApiKey: "",
    manualKeyStored: true,
    manualKeyClearRequested: true,
  });
  const credentialCleared = !await hasStoredAiApiKey(state.settings);
  await record({
    stage: "credential-cleared",
    outcome: credentialCleared ? "pass" : "fail",
    elapsedMs: elapsed(startedAt),
    checks: { "credential-cleared": credentialCleared },
  });
  if (!credentialCleared) throw new Error("QA credential was not cleared.");
}

async function verifyCredentialCleared(startedAt: number) {
  const settings = await getAiSettings();
  const cleared = !await hasStoredAiApiKey(settings);
  await record({
    stage: "credential-cleared",
    outcome: cleared ? "pass" : "fail",
    elapsedMs: elapsed(startedAt),
    checks: { "credential-absent-after-restart": cleared },
  });
  if (!cleared) throw new Error("QA credential still exists after restart.");
}

export async function runQaAutomation() {
  const startedAt = performance.now();
  const config = await invoke<QaAutomationConfig | null>("qa_automation_config");
  if (!config) return;

  let success = false;
  try {
    await record({ stage: "frontend-mounted", outcome: "info", elapsedMs: elapsed(startedAt) });
    const dashboard = await waitForDashboardSettlement();
    if (dashboard.status === "loading") {
      await record({
        stage: "failed",
        outcome: "fail",
        elapsedMs: elapsed(startedAt),
        checks: { "dashboard-settled": false },
      });
      return;
    }
    await record({
      stage: dashboard.status === "ready" ? "dashboard-ready" : "dashboard-failed",
      outcome: "pass",
      elapsedMs: elapsed(startedAt),
      checks: { "dashboard-settled": true, "dashboard-ready": dashboard.status === "ready" },
      metrics: { "settlement-ms": dashboard.elapsedMs },
    });

    if (config.scenario === "seed-upgrade") {
      const marker = await seedQaUpgradeState(config.mockOrigin);
      await record({
        stage: "seeded",
        outcome: "pass",
        elapsedMs: elapsed(startedAt),
        checks: { "synthetic-state-created": true, "credential-written": true },
        metrics: { items: 1, folders: 1 },
        fingerprints: { item: marker.itemFingerprint, layout: marker.layoutFingerprint },
      });
    } else if (config.scenario === "verify-upgrade") {
      await verifyUpgrade(readMarker(), config.mockOrigin, startedAt);
    } else if (config.scenario === "verify-credential-cleared") {
      await verifyCredentialCleared(startedAt);
    }

    await record({ stage: "completed", outcome: "pass", elapsedMs: elapsed(startedAt) });
    success = true;
  } catch {
    await record({
      stage: "failed",
      outcome: "fail",
      elapsedMs: elapsed(startedAt),
      checks: { "scenario-completed": false },
    }).catch(() => undefined);
  } finally {
    await finish(success).catch(() => undefined);
  }
}

export async function resetQaUpgradeStateForTests() {
  window.localStorage.removeItem(MARKER_KEY);
  window.localStorage.removeItem(LAYOUT_KEY);
  const settings = await getAiSettings();
  await saveAiSettings({ ...settings, manualKeyStored: false, manualApiKey: "" });
}
