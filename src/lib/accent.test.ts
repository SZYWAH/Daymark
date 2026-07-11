import { describe, expect, it } from "vitest";
import {
  ACCENT_STORAGE_KEY,
  contrastRatio,
  getAccentPreference,
  isCustomAccentVisible,
  normalizeHexColor,
  resolveAccentRgb,
  resolveAccentSelection,
  saveAccentPreference,
} from "./accent";

function createMemoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("accent preference", () => {
  it("normalizes short and long hex colors", () => {
    expect(normalizeHexColor("#3a7")).toBe("#33AA77");
    expect(normalizeHexColor(" #4f6f8f ")).toBe("#4F6F8F");
    expect(normalizeHexColor("blue")).toBeNull();
  });

  it("uses neutral when storage is empty or invalid", () => {
    expect(getAccentPreference(createMemoryStorage())).toEqual({ preset: "neutral" });
    expect(getAccentPreference(createMemoryStorage({ [ACCENT_STORAGE_KEY]: "not-json" }))).toEqual({ preset: "neutral" });
  });

  it("persists preset and custom preferences", () => {
    const storage = createMemoryStorage();
    saveAccentPreference({ preset: "moss" }, storage);
    expect(getAccentPreference(storage)).toEqual({ preset: "moss" });

    saveAccentPreference({ preset: "custom", customHex: "#7594B0" }, storage);
    expect(getAccentPreference(storage)).toEqual({ preset: "custom", customHex: "#7594B0" });
  });

  it("falls back safely when storage throws", () => {
    const storage = {
      getItem: () => {
        throw new Error("unavailable");
      },
      setItem: () => {
        throw new Error("unavailable");
      },
    };
    expect(getAccentPreference(storage)).toEqual({ preset: "neutral" });
    expect(() => saveAccentPreference({ preset: "lake" }, storage)).not.toThrow();
  });

  it("rejects colors that disappear into the active theme", () => {
    expect(isCustomAccentVisible("#080808", "dark")).toBe(false);
    expect(isCustomAccentVisible("#FAFAFA", "light")).toBe(false);
    expect(isCustomAccentVisible("#4F8DAA", "light")).toBe(true);
  });

  it("derives readable custom variants for both themes", () => {
    const preference = { preset: "custom" as const, customHex: "#123040" };
    const dark = resolveAccentRgb(preference, "dark");
    const light = resolveAccentRgb(preference, "light");
    expect(contrastRatio(dark, { r: 14, g: 14, b: 14 })).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(light, { r: 255, g: 254, b: 250 })).toBeGreaterThanOrEqual(4.5);
  });

  it("uses each palette's recommended accent while following the theme", () => {
    expect(resolveAccentSelection({ mode: "theme-default" }, "mist", "dark"))
      .toEqual(resolveAccentRgb({ preset: "moss" }, "dark"));
    expect(resolveAccentSelection({ mode: "theme-default" }, "ink", "light"))
      .toEqual(resolveAccentRgb({ preset: "lake" }, "light"));
    expect(resolveAccentSelection({ mode: "theme-default" }, "clay", "dark"))
      .toEqual({ r: 209, g: 138, b: 114 });
    expect(resolveAccentSelection({ mode: "theme-default" }, "clay", "light"))
      .toEqual({ r: 165, g: 83, b: 63 });
    expect(resolveAccentSelection({ mode: "theme-default" }, "fir", "dark"))
      .toEqual({ r: 142, g: 182, b: 155 });
    expect(resolveAccentSelection({ mode: "theme-default" }, "fir", "light"))
      .toEqual({ r: 63, g: 118, b: 88 });
  });

  it("keeps an explicit override when the palette changes", () => {
    const selection = { mode: "override" as const, value: { preset: "amber" as const } };
    expect(resolveAccentSelection(selection, "mist", "dark"))
      .toEqual(resolveAccentSelection(selection, "ink", "dark"));
    expect(resolveAccentSelection(selection, "clay", "light"))
      .toEqual(resolveAccentSelection(selection, "daymark", "light"));
    expect(resolveAccentSelection(selection, "fir", "dark"))
      .toEqual(resolveAccentSelection(selection, "graphite", "dark"));
  });
});
