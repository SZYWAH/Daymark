import type { ThemePalette } from "../types";

export const ACCENT_STORAGE_KEY = "daymark.ui.accent.v1";

export const ACCENT_PRESETS = ["neutral", "moss", "lake", "amber", "plum"] as const;

export type AccentPreset = (typeof ACCENT_PRESETS)[number];

export type AccentPreference = {
  preset: AccentPreset | "custom";
  customHex?: string;
};

export type AccentSelection =
  | { mode: "theme-default" }
  | { mode: "override"; value: AccentPreference };

type StorageLike = Pick<Storage, "getItem" | "setItem">;
type ResolvedTheme = "dark" | "light";
type Rgb = { r: number; g: number; b: number };

export const DEFAULT_ACCENT_PREFERENCE: AccentPreference = { preset: "neutral" };
export const DEFAULT_ACCENT_SELECTION: AccentSelection = { mode: "theme-default" };

export const THEME_DEFAULT_ACCENTS: Record<ThemePalette, {
  label: string;
  dark: string;
  light: string;
}> = {
  daymark: { label: "中性灰", dark: "#F5F5F5", light: "#4F6F8F" },
  graphite: { label: "中性灰", dark: "#B9BDC4", light: "#565E6A" },
  mist: { label: "苔绿", dark: "#72B89A", light: "#2F7D68" },
  ink: { label: "湖蓝", dark: "#7BA7C7", light: "#4F6F8F" },
  clay: { label: "陶土", dark: "#D18A72", light: "#A5533F" },
  fir: { label: "苔绿", dark: "#8EB69B", light: "#3F7658" },
};

export const ACCENT_PRESET_META: Record<AccentPreset, { label: string; hex: string }> = {
  neutral: { label: "中性灰", hex: "#A3A3A3" },
  moss: { label: "苔绿", hex: "#4F9A7E" },
  lake: { label: "湖蓝", hex: "#5F8EAD" },
  amber: { label: "暗金", hex: "#9A7438" },
  plum: { label: "灰紫", hex: "#7C6888" },
};

const PRESET_RGB: Record<AccentPreset, Record<ResolvedTheme, Rgb>> = {
  neutral: {
    dark: { r: 245, g: 245, b: 245 },
    light: { r: 79, g: 111, b: 143 },
  },
  moss: {
    dark: { r: 114, g: 184, b: 154 },
    light: { r: 47, g: 125, b: 104 },
  },
  lake: {
    dark: { r: 123, g: 167, b: 199 },
    light: { r: 79, g: 111, b: 143 },
  },
  amber: {
    dark: { r: 201, g: 168, b: 106 },
    light: { r: 138, g: 103, b: 47 },
  },
  plum: {
    dark: { r: 170, g: 145, b: 185 },
    light: { r: 117, g: 95, b: 131 },
  },
};

const THEME_BACKGROUNDS: Record<ResolvedTheme, Rgb> = {
  dark: { r: 14, g: 14, b: 14 },
  light: { r: 255, g: 254, b: 250 },
};

function getDefaultStorage(): StorageLike | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

export function normalizeHexColor(input: string): string | null {
  const value = input.trim().toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(value)) return value;
  if (/^#[0-9A-F]{3}$/.test(value)) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  }
  return null;
}

function hexToRgb(hex: string): Rgb {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function linearChannel(channel: number) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(color: Rgb) {
  return 0.2126 * linearChannel(color.r) + 0.7152 * linearChannel(color.g) + 0.0722 * linearChannel(color.b);
}

export function contrastRatio(a: Rgb, b: Rgb) {
  const lighter = Math.max(luminance(a), luminance(b));
  const darker = Math.min(luminance(a), luminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  return {
    r: Math.round(a.r + (b.r - a.r) * amount),
    g: Math.round(a.g + (b.g - a.g) * amount),
    b: Math.round(a.b + (b.b - a.b) * amount),
  };
}

function ensureContrast(color: Rgb, theme: ResolvedTheme, minimum = 4.5): Rgb {
  const background = THEME_BACKGROUNDS[theme];
  if (contrastRatio(color, background) >= minimum) return color;

  const target = theme === "dark" ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mix(color, target, step / 20);
    if (contrastRatio(candidate, background) >= minimum) return candidate;
  }
  return target;
}

export function isCustomAccentVisible(hex: string, theme: ResolvedTheme) {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return false;
  return contrastRatio(hexToRgb(normalized), THEME_BACKGROUNDS[theme]) >= 3;
}

export function resolveAccentRgb(preference: AccentPreference, theme: ResolvedTheme): Rgb {
  if (preference.preset !== "custom") return PRESET_RGB[preference.preset][theme];
  const normalized = normalizeHexColor(preference.customHex ?? "");
  if (!normalized) return PRESET_RGB.neutral[theme];
  return ensureContrast(hexToRgb(normalized), theme);
}

function isAccentPreference(value: unknown): value is AccentPreference {
  if (!value || typeof value !== "object") return false;
  const candidate = value as AccentPreference;
  if (ACCENT_PRESETS.includes(candidate.preset as AccentPreset)) return true;
  return candidate.preset === "custom" && normalizeHexColor(candidate.customHex ?? "") !== null;
}

export function getAccentPreference(storage: StorageLike | undefined = getDefaultStorage()): AccentPreference {
  if (!storage) return DEFAULT_ACCENT_PREFERENCE;
  try {
    const saved = storage.getItem(ACCENT_STORAGE_KEY);
    if (!saved) return DEFAULT_ACCENT_PREFERENCE;
    const parsed = JSON.parse(saved) as unknown;
    return isAccentPreference(parsed) ? parsed : DEFAULT_ACCENT_PREFERENCE;
  } catch {
    return DEFAULT_ACCENT_PREFERENCE;
  }
}

export function saveAccentPreference(
  preference: AccentPreference,
  storage: StorageLike | undefined = getDefaultStorage(),
) {
  const normalized = isAccentPreference(preference) ? preference : DEFAULT_ACCENT_PREFERENCE;
  try {
    storage?.setItem(ACCENT_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Interface preferences remain best-effort when storage is unavailable.
  }
  applyAccentPreference(normalized);
  return normalized;
}

export function resolveAccentSelection(
  selection: AccentSelection,
  palette: ThemePalette,
  theme: ResolvedTheme,
) {
  if (selection.mode === "theme-default") {
    return hexToRgb(THEME_DEFAULT_ACCENTS[palette][theme]);
  }
  return resolveAccentRgb(selection.value, theme);
}

export function applyAccentSelection(selection: AccentSelection, palette: ThemePalette) {
  try {
    const root = document.documentElement;
    const windowKind = root.dataset.window ?? "";
    if (windowKind.startsWith("quick-capture")) {
      root.style.removeProperty("--color-accent");
      root.style.removeProperty("--color-focus");
      return;
    }

    const theme: ResolvedTheme = root.dataset.theme === "light" ? "light" : "dark";
    const accent = windowKind.startsWith("quick-capture")
      ? resolveAccentRgb(DEFAULT_ACCENT_PREFERENCE, theme)
      : resolveAccentSelection(selection, palette, theme);
    const value = `${accent.r} ${accent.g} ${accent.b}`;
    root.style.setProperty("--color-accent", value);
    root.style.setProperty("--color-focus", value);
  } catch {
    // Startup and non-DOM test contexts can safely keep the CSS defaults.
  }
}

export function applyAccentPreference(preference: AccentPreference = getAccentPreference()) {
  applyAccentSelection({ mode: "override", value: preference }, "daymark");
}
