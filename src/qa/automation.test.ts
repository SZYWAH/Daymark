import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DAYMARK_CORE_BACKUP_SCHEMA, getFolders, getItems, restoreCoreBackup } from "../data/itemStore";
import { normalizeAiBaseUrl, setAiSecretAdapterForTests, type AiSecretAdapter } from "../lib/aiSecrets";
import type { AiProvider } from "../types";
import { getDashboardSettlement, seedQaUpgradeState } from "./automation";

let secrets: Map<string, string>;

beforeEach(async () => {
  secrets = new Map();
  setAiSecretAdapterForTests(createMemoryAdapter(secrets));
  vi.stubGlobal("window", { localStorage: createMemoryStorage() });
  await restoreCoreBackup({
    schema: DAYMARK_CORE_BACKUP_SCHEMA,
    exportedAt: "2026-07-20T00:00:00.000Z",
    dbVersion: 11,
    payload: { items: [], folders: [], journalEntries: [], memoryDocument: null, memoryCards: [], links: [] },
    counts: { items: 0, folders: 0, journalEntries: 0, memoryDocument: 0, memoryCards: 0, links: 0 },
  });
});

afterEach(() => {
  setAiSecretAdapterForTests(null);
  vi.unstubAllGlobals();
});

describe("QA automation dashboard settlement", () => {
  it("waits while the startup or Today loading state is visible", () => {
    expect(getDashboardSettlement({
      startupVisible: true,
      bodyText: "今日",
      hasTodayNavigation: true,
    })).toBe("loading");
    expect(getDashboardSettlement({
      startupVisible: false,
      bodyText: "正在整理今日内容。",
      hasTodayNavigation: true,
    })).toBe("loading");
  });

  it("distinguishes ready from explicit failure", () => {
    expect(getDashboardSettlement({
      startupVisible: false,
      bodyText: "今日 此刻记录",
      hasTodayNavigation: true,
    })).toBe("ready");
    expect(getDashboardSettlement({
      startupVisible: false,
      bodyText: "今日内容暂时未加载 重新加载",
      hasTodayNavigation: true,
    })).toBe("failed");
  });

  it("seeds the same synthetic item, folder and credential idempotently", async () => {
    const first = await seedQaUpgradeState("http://127.0.0.1:18888");
    const second = await seedQaUpgradeState("http://127.0.0.1:18888");

    expect(second).toEqual(first);
    expect((await getItems()).filter((item) => item.id === first.itemId)).toHaveLength(1);
    expect((await getFolders()).filter((folder) => folder.id === first.folderId)).toHaveLength(1);
    expect(secrets.size).toBe(1);
  });
});

function createMemoryAdapter(values: Map<string, string>): AiSecretAdapter {
  return {
    isDesktop: () => true,
    read: async (provider, baseUrl) => values.get(secretId(provider, baseUrl)) ?? null,
    write: async (provider, baseUrl, apiKey) => {
      values.set(secretId(provider, baseUrl), apiKey);
    },
    delete: async (provider, baseUrl) => {
      values.delete(secretId(provider, baseUrl));
    },
  };
}

function secretId(provider: AiProvider, baseUrl: string) {
  return `${provider}:${normalizeAiBaseUrl(baseUrl)}`;
}

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}
