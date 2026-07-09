import { invoke, isTauri } from "@tauri-apps/api/core";
import { getAiSettings, saveAiSettings } from "../data/itemStore";
import type { AiProvider, AiSettings } from "../types";
import { getSafeErrorMessage } from "./redaction";

export type AiSettingsLoadResult = {
  settings: AiSettings;
  notice?: string;
};

export type AiSecretAdapter = {
  isDesktop: () => boolean;
  read: (provider: AiProvider, baseUrl: string) => Promise<string | null>;
  write: (provider: AiProvider, baseUrl: string, apiKey: string) => Promise<void>;
  delete: (provider: AiProvider, baseUrl: string) => Promise<void>;
};

const defaultAiSecretAdapter: AiSecretAdapter = {
  isDesktop: () => isTauri(),
  read: (provider, baseUrl) => invoke<string | null>("read_ai_api_key", { provider, baseUrl }),
  write: (provider, baseUrl, apiKey) => invoke("write_ai_api_key", { provider, baseUrl, apiKey }),
  delete: (provider, baseUrl) => invoke("delete_ai_api_key", { provider, baseUrl }),
};

let aiSecretAdapter = defaultAiSecretAdapter;

export function setAiSecretAdapterForTests(adapter: AiSecretAdapter | null) {
  aiSecretAdapter = adapter ?? defaultAiSecretAdapter;
}

export function normalizeAiBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    return url.toString().replace(/\/+$/, "");
  } catch {
    return trimmed;
  }
}

export function getAiSecretScope(settings: Pick<AiSettings, "provider" | "baseUrl">) {
  const provider = settings.provider === "openai-compatible" ? "openai-compatible" : "deepseek";
  return `${provider}:${normalizeAiBaseUrl(settings.baseUrl)}`;
}

export async function loadAiSettingsWithSecrets(): Promise<AiSettingsLoadResult> {
  const settings = await getAiSettings();
  return prepareLoadedAiSettings(settings);
}

export async function prepareLoadedAiSettings(settings: AiSettings): Promise<AiSettingsLoadResult> {
  if (!aiSecretAdapter.isDesktop()) {
    return {
      settings: {
        ...settings,
        manualApiKey: settings.manualApiKey?.trim() ?? "",
        manualKeyStored: Boolean(settings.manualApiKey?.trim()),
        manualKeyClearRequested: false,
      },
    };
  }

  const legacyKey = settings.manualApiKey?.trim() ?? "";
  if (legacyKey) {
    try {
      await writeStoredAiApiKey(settings, legacyKey);
      const sanitized = await saveAiSettings({
        ...settings,
        manualApiKey: "",
        manualKeyStored: true,
        manualKeyClearRequested: false,
      });
      return {
        settings: sanitized,
        notice: "旧手动 API Key 已迁移到系统凭据存储。",
      };
    } catch (error) {
      return {
        settings: {
          ...settings,
          manualKeyStored: false,
          manualKeyClearRequested: false,
        },
        notice: `手动 API Key 自动迁移失败：${getSafeErrorMessage(error, "请稍后在设置页重新保存。")}`,
      };
    }
  }

  try {
    const manualKeyStored = await hasStoredAiApiKey(settings);
    return {
      settings: {
        ...settings,
        manualApiKey: "",
        manualKeyStored,
        manualKeyClearRequested: false,
      },
    };
  } catch (error) {
    return {
      settings: {
        ...settings,
        manualApiKey: "",
        manualKeyStored: false,
        manualKeyClearRequested: false,
      },
      notice: getSafeErrorMessage(error, "无法读取系统凭据中的 API Key，请在设置页重新保存。"),
    };
  }
}

export async function saveAiSettingsWithSecrets(settings: AiSettings): Promise<AiSettings> {
  const manualApiKey = settings.manualApiKey?.trim() ?? "";

  if (!aiSecretAdapter.isDesktop()) {
    return saveAiSettings({
      ...settings,
      manualApiKey,
      manualKeyStored: Boolean(manualApiKey),
      manualKeyClearRequested: false,
    });
  }

  let manualKeyStored = Boolean(settings.manualKeyStored);
  if (manualApiKey) {
    await writeStoredAiApiKey(settings, manualApiKey);
    manualKeyStored = true;
  } else if (settings.manualKeyClearRequested) {
    await deleteStoredAiApiKey(settings);
    manualKeyStored = false;
  } else {
    manualKeyStored = await hasStoredAiApiKey(settings).catch(() => false);
  }

  return saveAiSettings({
    ...settings,
    manualApiKey: "",
    manualKeyStored,
    manualKeyClearRequested: false,
  });
}

export async function resolveAiSettingsForRequest(settings: AiSettings): Promise<AiSettings> {
  const manualApiKey = settings.manualApiKey?.trim() ?? "";
  if (manualApiKey || !aiSecretAdapter.isDesktop() || hasDeepSeekEnvKey(settings) || !settings.manualKeyStored) {
    return {
      ...settings,
      manualApiKey,
      manualKeyClearRequested: false,
    };
  }

  const storedKey = await readStoredAiApiKey(settings).catch((error) => {
    throw new Error(getSafeErrorMessage(error, "无法读取系统凭据中的 API Key，请在设置页重新保存。"));
  });

  return {
    ...settings,
    manualApiKey: storedKey ?? "",
    manualKeyStored: Boolean(storedKey),
    manualKeyClearRequested: false,
  };
}

export async function hasStoredAiApiKey(settings: Pick<AiSettings, "provider" | "baseUrl">) {
  if (!aiSecretAdapter.isDesktop()) return false;
  return Boolean(await readStoredAiApiKey(settings));
}

async function readStoredAiApiKey(settings: Pick<AiSettings, "provider" | "baseUrl">) {
  const provider = normalizeAiProvider(settings.provider);
  const baseUrl = normalizeAiBaseUrl(settings.baseUrl);
  if (!baseUrl) return null;
  return aiSecretAdapter.read(provider, baseUrl);
}

async function writeStoredAiApiKey(settings: Pick<AiSettings, "provider" | "baseUrl">, apiKey: string) {
  const provider = normalizeAiProvider(settings.provider);
  const baseUrl = normalizeAiBaseUrl(settings.baseUrl);
  if (!baseUrl) throw new Error("Base URL 为空，无法保存 API Key。");
  await aiSecretAdapter.write(provider, baseUrl, apiKey);
}

async function deleteStoredAiApiKey(settings: Pick<AiSettings, "provider" | "baseUrl">) {
  const provider = normalizeAiProvider(settings.provider);
  const baseUrl = normalizeAiBaseUrl(settings.baseUrl);
  if (!baseUrl) return;
  await aiSecretAdapter.delete(provider, baseUrl);
}

function normalizeAiProvider(provider: AiProvider): AiProvider {
  return provider === "openai-compatible" ? "openai-compatible" : "deepseek";
}

function hasDeepSeekEnvKey(settings: AiSettings) {
  return (
    settings.provider !== "openai-compatible" &&
    settings.useEnvKey &&
    Boolean(import.meta.env.VITE_DEEPSEEK_API_KEY?.trim())
  );
}
