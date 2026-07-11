import { describe, expect, it } from "vitest";
import { ACCENT_STORAGE_KEY } from "./accent";
import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  LEGACY_THEME_STORAGE_KEY,
  THEME_PALETTE_META,
  getAppearancePreference,
  getAppearanceSummary,
  saveAppearancePreference,
} from "./theme";

function createMemoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("appearance preference", () => {
  it("creates the Daymark default when no preference exists", () => {
    const storage = createMemoryStorage();
    expect(getAppearancePreference(storage)).toEqual(DEFAULT_APPEARANCE);
    expect(storage.getItem(APPEARANCE_STORAGE_KEY)).not.toBeNull();
  });

  it("migrates the legacy theme mode and a non-default accent", () => {
    const storage = createMemoryStorage({
      [LEGACY_THEME_STORAGE_KEY]: "light",
      [ACCENT_STORAGE_KEY]: JSON.stringify({ preset: "moss" }),
    });
    expect(getAppearancePreference(storage)).toEqual({
      version: 1,
      mode: "light",
      palette: "daymark",
      accent: { mode: "override", value: { preset: "moss" } },
    });
  });

  it("treats the old neutral accent as the theme default", () => {
    const storage = createMemoryStorage({
      [ACCENT_STORAGE_KEY]: JSON.stringify({ preset: "neutral" }),
    });
    expect(getAppearancePreference(storage).accent).toEqual({ mode: "theme-default" });
  });

  it("persists a palette and mirrors compatibility keys", () => {
    const storage = createMemoryStorage();
    const saved = saveAppearancePreference({
      version: 1,
      mode: "system",
      palette: "mist",
      accent: { mode: "override", value: { preset: "amber" } },
    }, storage);
    expect(saved.palette).toBe("mist");
    expect(storage.getItem(LEGACY_THEME_STORAGE_KEY)).toBe("system");
    expect(storage.getItem(ACCENT_STORAGE_KEY)).toBe(JSON.stringify({ preset: "amber" }));
  });

  it("restores the clay palette with its independent display mode", () => {
    const storage = createMemoryStorage();
    saveAppearancePreference({
      version: 1,
      mode: "light",
      palette: "clay",
      accent: { mode: "theme-default" },
    }, storage);

    expect(getAppearancePreference(storage)).toEqual({
      version: 1,
      mode: "light",
      palette: "clay",
      accent: { mode: "theme-default" },
    });
    expect(THEME_PALETTE_META.clay.label).toBe("暖陶");
  });

  it("persists and restores the fir palette", () => {
    const storage = createMemoryStorage();
    saveAppearancePreference({
      version: 1,
      mode: "system",
      palette: "fir",
      accent: { mode: "override", value: { preset: "lake" } },
    }, storage);

    expect(getAppearancePreference(storage)).toEqual({
      version: 1,
      mode: "system",
      palette: "fir",
      accent: { mode: "override", value: { preset: "lake" } },
    });
  });

  it("describes theme-default, preset, and custom appearance summaries", () => {
    expect(getAppearanceSummary({
      version: 1,
      mode: "dark",
      palette: "fir",
      accent: { mode: "theme-default" },
    })).toEqual({
      combination: "冷杉 · 深色",
      accent: "强调色：跟随主题 · 苔绿",
    });

    expect(getAppearanceSummary({
      version: 1,
      mode: "system",
      palette: "clay",
      accent: { mode: "override", value: { preset: "amber" } },
    })).toEqual({
      combination: "暖陶 · 跟随系统",
      accent: "强调色：暗金",
    });

    expect(getAppearanceSummary({
      version: 1,
      mode: "light",
      palette: "daymark",
      accent: { mode: "override", value: { preset: "custom", customHex: "#7594B0" } },
    })).toEqual({
      combination: "Daymark 原生 · 浅色",
      accent: "强调色：自定义 · #7594B0",
    });
  });

  it("removes the legacy accent when returning to theme default", () => {
    const storage = createMemoryStorage({
      [ACCENT_STORAGE_KEY]: JSON.stringify({ preset: "lake" }),
    });
    saveAppearancePreference({ ...DEFAULT_APPEARANCE, palette: "graphite" }, storage);
    expect(storage.getItem(ACCENT_STORAGE_KEY)).toBeNull();
  });

  it("falls back safely for malformed or unavailable storage", () => {
    const malformed = createMemoryStorage({ [APPEARANCE_STORAGE_KEY]: "{" });
    expect(getAppearancePreference(malformed)).toEqual(DEFAULT_APPEARANCE);

    const unavailable = {
      getItem: () => { throw new Error("unavailable"); },
      setItem: () => { throw new Error("unavailable"); },
      removeItem: () => { throw new Error("unavailable"); },
    };
    expect(getAppearancePreference(unavailable)).toEqual(DEFAULT_APPEARANCE);
    expect(() => saveAppearancePreference(DEFAULT_APPEARANCE, unavailable)).not.toThrow();
  });
});
