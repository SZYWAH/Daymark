import {
  ACCENT_PRESET_META,
  ACCENT_STORAGE_KEY,
  DEFAULT_ACCENT_SELECTION,
  THEME_DEFAULT_ACCENTS,
  getAccentPreference,
  applyAccentSelection,
  type AccentSelection,
} from "./accent";
import { THEME_MODES, THEME_PALETTES, type ThemeMode, type ThemePalette } from "../types";

export const APPEARANCE_STORAGE_KEY = "daymark.ui.appearance.v1";
export const LEGACY_THEME_STORAGE_KEY = "personal-knowledge-base-theme";
export const APPEARANCE_CHANGE_EVENT = "daymark:appearance-change";

type StorageLike = Pick<Storage, "getItem" | "setItem"> & Partial<Pick<Storage, "removeItem">>;

export type AppearancePreferenceV1 = {
  version: 1;
  mode: ThemeMode;
  palette: ThemePalette;
  accent: AccentSelection;
};

export const DEFAULT_APPEARANCE: AppearancePreferenceV1 = {
  version: 1,
  mode: "dark",
  palette: "daymark",
  accent: DEFAULT_ACCENT_SELECTION,
};

export const THEME_PALETTE_META: Record<ThemePalette, {
  label: string;
  description: string;
  preview: { paper: string; surface: string; ink: string; accent: string };
}> = {
  daymark: {
    label: "Daymark 原生",
    description: "纯黑书房与冷静纸面",
    preview: { paper: "#000000", surface: "#0E0E0E", ink: "#F5F5F5", accent: "#C7C7C7" },
  },
  graphite: {
    label: "石墨",
    description: "柔和炭灰与中性灰白",
    preview: { paper: "#0D0E10", surface: "#18191D", ink: "#EEEFF1", accent: "#B9BDC4" },
  },
  mist: {
    label: "雾青",
    description: "低饱和青灰知识空间",
    preview: { paper: "#070C0B", surface: "#111916", ink: "#EBF2EF", accent: "#72B89A" },
  },
  ink: {
    label: "墨蓝",
    description: "克制蓝黑与冷灰纸面",
    preview: { paper: "#080A0E", surface: "#12161E", ink: "#EEF1F6", accent: "#7BA7C7" },
  },
  clay: {
    label: "暖陶",
    description: "暖纸与陶土色深度界面",
    preview: { paper: "#171310", surface: "#F5F1E8", ink: "#2D2926", accent: "#A5533F" },
  },
  fir: {
    label: "冷杉",
    description: "冷杉灰绿与矿物纸面",
    preview: { paper: "#0D0F0E", surface: "#F4F6F3", ink: "#232B26", accent: "#3F7658" },
  },
};

export function getAppearanceSummary(preference: AppearancePreferenceV1) {
  const modeLabel = preference.mode === "dark" ? "深色" : preference.mode === "light" ? "浅色" : "跟随系统";
  const paletteLabel = THEME_PALETTE_META[preference.palette].label;
  let accentLabel: string;

  if (preference.accent.mode === "theme-default") {
    accentLabel = `跟随主题 · ${THEME_DEFAULT_ACCENTS[preference.palette].label}`;
  } else if (preference.accent.value.preset === "custom") {
    accentLabel = `自定义 · ${preference.accent.value.customHex ?? ""}`;
  } else {
    accentLabel = ACCENT_PRESET_META[preference.accent.value.preset].label;
  }

  return {
    combination: `${paletteLabel} · ${modeLabel}`,
    accent: `强调色：${accentLabel}`,
  };
}

function getDefaultStorage(): StorageLike | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

function isAccentSelection(value: unknown): value is AccentSelection {
  if (!value || typeof value !== "object") return false;
  const candidate = value as AccentSelection;
  if (candidate.mode === "theme-default") return true;
  if (candidate.mode !== "override" || !candidate.value) return false;
  const accent = candidate.value;
  if (accent.preset === "custom") return /^#[0-9A-Fa-f]{6}$/.test(accent.customHex ?? "");
  return ["neutral", "moss", "lake", "amber", "plum"].includes(accent.preset);
}

function isAppearancePreference(value: unknown): value is AppearancePreferenceV1 {
  if (!value || typeof value !== "object") return false;
  const candidate = value as AppearancePreferenceV1;
  return candidate.version === 1
    && THEME_MODES.includes(candidate.mode)
    && THEME_PALETTES.includes(candidate.palette)
    && isAccentSelection(candidate.accent);
}

function readLegacyAppearance(storage: StorageLike): AppearancePreferenceV1 {
  let mode: ThemeMode = "dark";
  try {
    const savedMode = storage.getItem(LEGACY_THEME_STORAGE_KEY);
    if (THEME_MODES.includes(savedMode as ThemeMode)) mode = savedMode as ThemeMode;
  } catch {
    // Keep the dark default when legacy storage cannot be read.
  }

  let accent: AccentSelection = DEFAULT_ACCENT_SELECTION;
  try {
    const legacyAccent = storage.getItem(ACCENT_STORAGE_KEY);
    if (legacyAccent) {
      const preference = getAccentPreference(storage);
      if (preference.preset !== "neutral") accent = { mode: "override", value: preference };
    }
  } catch {
    // Keep the theme default accent.
  }

  return { version: 1, mode, palette: "daymark", accent };
}

export function getAppearancePreference(storage: StorageLike | undefined = getDefaultStorage()): AppearancePreferenceV1 {
  if (!storage) return DEFAULT_APPEARANCE;
  try {
    const saved = storage.getItem(APPEARANCE_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as unknown;
      if (isAppearancePreference(parsed)) return parsed;
    }

    const migrated = readLegacyAppearance(storage);
    storage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function saveAppearancePreference(
  preference: AppearancePreferenceV1,
  storage: StorageLike | undefined = getDefaultStorage(),
) {
  const normalized = isAppearancePreference(preference) ? preference : DEFAULT_APPEARANCE;
  try {
    storage?.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(normalized));
    storage?.setItem(LEGACY_THEME_STORAGE_KEY, normalized.mode);
    if (normalized.accent.mode === "override") {
      storage?.setItem(ACCENT_STORAGE_KEY, JSON.stringify(normalized.accent.value));
    } else {
      storage?.removeItem?.(ACCENT_STORAGE_KEY);
    }
  } catch {
    // Appearance persistence is best-effort; the selected appearance still applies now.
  }
  applyAppearancePreference(normalized);
  try {
    window.dispatchEvent(new CustomEvent(APPEARANCE_CHANGE_EVENT, { detail: normalized }));
  } catch {
    // Non-window startup contexts do not need the notification.
  }
  return normalized;
}

export function resolveSystemTheme(): "dark" | "light" {
  try {
    return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyAppearancePreference(preference: AppearancePreferenceV1 = getAppearancePreference()) {
  const resolved = preference.mode === "system" ? resolveSystemTheme() : preference.mode;
  try {
    const root = document.documentElement;
    root.dataset.themeMode = preference.mode;
    root.dataset.theme = resolved;
    root.dataset.palette = preference.palette;
    root.style.colorScheme = resolved;
    applyAccentSelection(preference.accent, preference.palette);
  } catch {
    // In unusual startup contexts the document may not be writable yet.
  }
}

export function getThemeMode() {
  return getAppearancePreference().mode;
}

export function saveThemeMode(mode: ThemeMode) {
  const current = getAppearancePreference();
  return saveAppearancePreference({ ...current, mode });
}

export function applyThemeMode(mode?: ThemeMode) {
  const current = getAppearancePreference();
  applyAppearancePreference(mode ? { ...current, mode } : current);
}

export function bindSystemThemeListener(getMode: () => ThemeMode) {
  const media = (() => {
    try {
      return window.matchMedia?.("(prefers-color-scheme: light)");
    } catch {
      return null;
    }
  })();
  if (!media) return () => undefined;

  const listener = () => {
    if (getMode() === "system") applyAppearancePreference();
  };
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
