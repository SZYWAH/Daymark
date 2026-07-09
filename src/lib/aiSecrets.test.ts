import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDefaultAiSettings, getAiSettings, saveAiSettings } from "../data/itemStore";
import type { AiProvider } from "../types";
import {
  normalizeAiBaseUrl,
  loadAiSettingsWithSecrets,
  resolveAiSettingsForRequest,
  saveAiSettingsWithSecrets,
  setAiSecretAdapterForTests,
  type AiSecretAdapter,
} from "./aiSecrets";

describe("AI secret storage", () => {
  let secrets: Map<string, string>;

  beforeEach(async () => {
    secrets = new Map();
    setAiSecretAdapterForTests(createMemoryAdapter(true, secrets));
    await saveAiSettings({ ...getDefaultAiSettings(), manualApiKey: "", manualKeyStored: false });
  });

  afterEach(() => {
    setAiSecretAdapterForTests(null);
  });

  it("stores desktop manual API keys outside IndexedDB", async () => {
    const saved = await saveAiSettingsWithSecrets({
      ...getDefaultAiSettings(),
      useEnvKey: false,
      baseUrl: "https://api.example.test",
      manualApiKey: "sk-desktop-secret-123456",
    });
    const storedSettings = await getAiSettings();

    expect(saved.manualApiKey).toBe("");
    expect(saved.manualKeyStored).toBe(true);
    expect(storedSettings.manualApiKey).toBe("");
    expect(JSON.stringify(storedSettings)).not.toContain("sk-desktop-secret-123456");
    expect(secrets.get(secretId("deepseek", "https://api.example.test"))).toBe("sk-desktop-secret-123456");
  });

  it("keeps IndexedDB fallback for web mode", async () => {
    setAiSecretAdapterForTests(createMemoryAdapter(false, secrets));

    const saved = await saveAiSettingsWithSecrets({
      ...getDefaultAiSettings(),
      useEnvKey: false,
      baseUrl: "https://api.example.test",
      manualApiKey: "sk-web-secret-123456",
    });
    const storedSettings = await getAiSettings();

    expect(saved.manualApiKey).toBe("sk-web-secret-123456");
    expect(saved.manualKeyStored).toBe(true);
    expect(storedSettings.manualApiKey).toBe("sk-web-secret-123456");
  });

  it("migrates a legacy IndexedDB key to desktop secret storage", async () => {
    await saveAiSettings({
      ...getDefaultAiSettings(),
      useEnvKey: false,
      baseUrl: "https://api.legacy.test",
      manualApiKey: "sk-legacy-secret-123456",
    });

    const result = await loadAiSettingsWithSecrets();
    const storedSettings = await getAiSettings();

    expect(result.notice).toContain("迁移");
    expect(result.settings.manualApiKey).toBe("");
    expect(result.settings.manualKeyStored).toBe(true);
    expect(storedSettings.manualApiKey).toBe("");
    expect(secrets.get(secretId("deepseek", "https://api.legacy.test"))).toBe("sk-legacy-secret-123456");
  });

  it("keeps the legacy key when migration fails", async () => {
    await saveAiSettings({
      ...getDefaultAiSettings(),
      useEnvKey: false,
      baseUrl: "https://api.legacy-fail.test",
      manualApiKey: "sk-still-in-idb-123456",
    });
    setAiSecretAdapterForTests(createMemoryAdapter(true, secrets, { failWrite: true }));

    const result = await loadAiSettingsWithSecrets();
    const storedSettings = await getAiSettings();

    expect(result.notice).toContain("迁移失败");
    expect(result.notice).not.toContain("sk-should-hide-123456");
    expect(result.settings.manualApiKey).toBe("sk-still-in-idb-123456");
    expect(storedSettings.manualApiKey).toBe("sk-still-in-idb-123456");
  });

  it("separates saved keys by provider and Base URL", async () => {
    await saveAiSettingsWithSecrets({
      ...getDefaultAiSettings(),
      useEnvKey: false,
      baseUrl: "https://api.one.test",
      manualApiKey: "sk-one-123456",
    });
    await saveAiSettingsWithSecrets({
      ...getDefaultAiSettings(),
      provider: "openai-compatible",
      customProviderName: "Custom",
      useEnvKey: false,
      baseUrl: "https://api.two.test/v1",
      manualApiKey: "sk-two-123456",
    });

    const resolvedOne = await resolveAiSettingsForRequest({
      ...getDefaultAiSettings(),
      useEnvKey: false,
      baseUrl: "https://api.one.test/",
      manualKeyStored: true,
    });
    const resolvedTwo = await resolveAiSettingsForRequest({
      ...getDefaultAiSettings(),
      provider: "openai-compatible",
      customProviderName: "Custom",
      useEnvKey: false,
      baseUrl: "https://api.two.test/v1/",
      manualKeyStored: true,
    });

    expect(resolvedOne.manualApiKey).toBe("sk-one-123456");
    expect(resolvedTwo.manualApiKey).toBe("sk-two-123456");
  });

  it("clears only the current provider and Base URL key", async () => {
    await saveAiSettingsWithSecrets({
      ...getDefaultAiSettings(),
      useEnvKey: false,
      baseUrl: "https://api.one.test",
      manualApiKey: "sk-one-123456",
    });
    await saveAiSettingsWithSecrets({
      ...getDefaultAiSettings(),
      useEnvKey: false,
      baseUrl: "https://api.two.test",
      manualApiKey: "sk-two-123456",
    });

    const saved = await saveAiSettingsWithSecrets({
      ...getDefaultAiSettings(),
      useEnvKey: false,
      baseUrl: "https://api.one.test",
      manualKeyStored: true,
      manualKeyClearRequested: true,
    });

    expect(saved.manualKeyStored).toBe(false);
    expect(secrets.has(secretId("deepseek", "https://api.one.test"))).toBe(false);
    expect(secrets.get(secretId("deepseek", "https://api.two.test"))).toBe("sk-two-123456");
  });
});

function createMemoryAdapter(
  desktop: boolean,
  secrets: Map<string, string>,
  options: { failWrite?: boolean } = {},
): AiSecretAdapter {
  return {
    isDesktop: () => desktop,
    read: async (provider, baseUrl) => secrets.get(secretId(provider, baseUrl)) ?? null,
    write: async (provider, baseUrl, apiKey) => {
      if (options.failWrite) throw new Error("keyring write failed for apiKey=sk-should-hide-123456");
      secrets.set(secretId(provider, baseUrl), apiKey);
    },
    delete: async (provider, baseUrl) => {
      secrets.delete(secretId(provider, baseUrl));
    },
  };
}

function secretId(provider: AiProvider, baseUrl: string) {
  return `${provider}:${normalizeAiBaseUrl(baseUrl)}`;
}
