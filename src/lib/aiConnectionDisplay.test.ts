import { describe, expect, it } from "vitest";
import {
  getConnectionPresetLabel,
  getConnectionProtocolLabel,
  getCredentialStatusLabel,
  getValidCredentialAddress,
} from "./aiConnectionDisplay";

describe("AI connection display", () => {
  it("labels connection presets and protocols without mixing the concepts", () => {
    expect(getConnectionPresetLabel({ provider: "deepseek" })).toBe("DeepSeek（预设）");
    expect(getConnectionPresetLabel({ provider: "openai-compatible", customProviderName: "硅基流动" })).toBe("硅基流动");
    expect(getConnectionPresetLabel({ provider: "anthropic-messages" })).toBe("Anthropic Messages");
    expect(getConnectionProtocolLabel({ provider: "deepseek" })).toBe("Chat Completions");
    expect(getConnectionProtocolLabel({ provider: "openai-compatible", protocol: "openai-responses" })).toBe("Responses");
  });

  it("normalizes valid network addresses and rejects incomplete values", () => {
    expect(getValidCredentialAddress(" HTTPS://MDKJ.LOL/ ")).toBe("https://mdkj.lol");
    expect(getValidCredentialAddress("https://gateway.test/v1/")).toBe("https://gateway.test/v1");
    expect(getValidCredentialAddress("https://")).toBeNull();
    expect(getValidCredentialAddress("file:///tmp/key")).toBeNull();
  });

  it("prioritizes draft, deletion, environment, and probe states", () => {
    const base = {
      desktop: true,
      envKeyActive: false,
      pendingManualKey: false,
      clearRequested: false,
      stored: false,
      probeState: "ready" as const,
      validAddress: true,
    };
    expect(getCredentialStatusLabel({ ...base, pendingManualKey: true })).toBe("待保存");
    expect(getCredentialStatusLabel({ ...base, clearRequested: true })).toBe("保存后删除");
    expect(getCredentialStatusLabel({ ...base, envKeyActive: true })).toBe("使用环境变量");
    expect(getCredentialStatusLabel({ ...base, probeState: "probing" })).toBe("检查中");
    expect(getCredentialStatusLabel({ ...base, stored: true })).toBe("已保存到系统凭据");
    expect(getCredentialStatusLabel({ ...base, validAddress: false })).toBe("等待有效地址");
  });
});
