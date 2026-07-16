import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  conversationDateIndexPreferenceStorageKey,
  getConversationDateIndexPreference,
  markConversationDateIndexUserScanCompleted,
  saveConversationDateIndexPreference,
} from "./conversationDateIndex";

describe("conversation date index preference", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, String(value)),
      },
    });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to on-demand indexing", () => {
    expect(getConversationDateIndexPreference()).toEqual({
      version: 1,
      idleCompletionEnabled: false,
      userScanCompleted: false,
    });
  });

  it("persists the optional idle completion setting", () => {
    saveConversationDateIndexPreference({ idleCompletionEnabled: true });
    expect(getConversationDateIndexPreference().idleCompletionEnabled).toBe(true);
  });

  it("records that the user has completed an explicit scan", () => {
    markConversationDateIndexUserScanCompleted();
    expect(getConversationDateIndexPreference().userScanCompleted).toBe(true);
  });

  it("falls back safely for invalid or incompatible storage", () => {
    window.localStorage.setItem(conversationDateIndexPreferenceStorageKey, "not-json");
    expect(getConversationDateIndexPreference().idleCompletionEnabled).toBe(false);
    window.localStorage.setItem(
      conversationDateIndexPreferenceStorageKey,
      JSON.stringify({ version: 2, idleCompletionEnabled: true }),
    );
    expect(getConversationDateIndexPreference().idleCompletionEnabled).toBe(false);
  });
});
