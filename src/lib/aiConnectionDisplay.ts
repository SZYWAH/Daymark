import type { AiSettings } from "../types";
import { normalizeAiBaseUrl } from "./aiSecrets";

export type AiCredentialProbeState = "idle" | "probing" | "ready" | "error";

export function getConnectionPresetLabel(settings: Pick<AiSettings, "provider" | "customProviderName">) {
  if (settings.provider === "deepseek") return "DeepSeek（预设）";
  if (settings.provider === "anthropic-messages") return "Anthropic Messages";
  return settings.customProviderName?.trim() || "OpenAI 协议兼容";
}

export function getConnectionProtocolLabel(settings: Pick<AiSettings, "provider" | "protocol">) {
  if (settings.provider === "anthropic-messages") return "Messages";
  if (settings.provider === "deepseek") return "Chat Completions";
  return settings.protocol === "openai-responses" ? "Responses" : "Chat Completions";
}

export function getValidCredentialAddress(baseUrl: string) {
  const normalized = normalizeAiBaseUrl(baseUrl);
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized);
    return matchesNetworkProtocol(parsed.protocol) && parsed.host ? normalized : null;
  } catch {
    return null;
  }
}

export function getCredentialStatusLabel(input: {
  desktop: boolean;
  envKeyActive: boolean;
  pendingManualKey: boolean;
  clearRequested: boolean;
  stored: boolean;
  probeState: AiCredentialProbeState;
  validAddress: boolean;
}) {
  if (!input.validAddress) return "等待有效地址";
  if (input.pendingManualKey) return "待保存";
  if (input.clearRequested) return "保存后删除";
  if (input.envKeyActive) return "使用环境变量";
  if (input.probeState === "probing") return "检查中";
  if (input.probeState === "error") return "读取失败";
  if (input.desktop) return input.stored ? "已保存到系统凭据" : "未配置";
  return input.stored ? "已保存到本机应用数据" : "未配置";
}

function matchesNetworkProtocol(protocol: string) {
  return protocol === "http:" || protocol === "https:";
}
