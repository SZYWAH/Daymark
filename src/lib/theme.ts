import type { ThemeMode } from "../types";

const THEME_STORAGE_KEY = "personal-knowledge-base-theme";
const THEME_MODES: ThemeMode[] = ["dark", "light", "system"];

export function getThemeMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return THEME_MODES.includes(saved as ThemeMode) ? (saved as ThemeMode) : "dark";
  } catch {
    return "dark";
  }
}

export function saveThemeMode(mode: ThemeMode) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Theme persistence is best-effort; applying the selected theme still matters.
  }
  applyThemeMode(mode);
}

export function resolveSystemTheme(): "dark" | "light" {
  try {
    return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyThemeMode(mode: ThemeMode = getThemeMode()) {
  const resolved = mode === "system" ? resolveSystemTheme() : mode;
  try {
    document.documentElement.dataset.themeMode = mode;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
  } catch {
    // In unusual startup contexts the document may not be writable yet.
  }
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
    if (getMode() === "system") {
      applyThemeMode("system");
    }
  };

  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
