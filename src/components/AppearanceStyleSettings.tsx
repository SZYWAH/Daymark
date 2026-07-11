import {
  Check,
  Monitor,
  Moon,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  ACCENT_PRESET_META,
  ACCENT_PRESETS,
  THEME_DEFAULT_ACCENTS,
  isCustomAccentVisible,
  normalizeHexColor,
  type AccentPreference,
} from "../lib/accent";
import {
  APPEARANCE_CHANGE_EVENT,
  DEFAULT_APPEARANCE,
  THEME_PALETTE_META,
  getAppearancePreference,
  getAppearanceSummary,
  saveAppearancePreference,
  type AppearancePreferenceV1,
} from "../lib/theme";
import { THEME_PALETTES, type ThemeMode } from "../types";

function getResolvedTheme(): "dark" | "light" {
  try {
    return document.documentElement.dataset.theme === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function getAccentPreviewHex(appearance: AppearancePreferenceV1) {
  if (appearance.accent.mode === "theme-default") {
    return THEME_DEFAULT_ACCENTS[appearance.palette][getResolvedTheme()];
  }
  if (appearance.accent.value.preset === "custom") {
    return normalizeHexColor(appearance.accent.value.customHex ?? "") ?? "#5F8EAD";
  }
  return ACCENT_PRESET_META[appearance.accent.value.preset].hex;
}

export function AppearanceStyleSettings({
  mode,
  disabled = false,
  onModeChange,
}: {
  mode: ThemeMode;
  disabled?: boolean;
  onModeChange: (mode: ThemeMode) => void;
}) {
  const [appearance, setAppearance] = useState<AppearancePreferenceV1>(() => getAppearancePreference());
  const initialOverride = appearance.accent.mode === "override" ? appearance.accent.value : null;
  const [customHex, setCustomHex] = useState(() =>
    initialOverride?.preset === "custom" ? initialOverride.customHex ?? "#5F8EAD" : "#5F8EAD",
  );
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const sync = (event: Event) => {
      const next = (event as CustomEvent<AppearancePreferenceV1>).detail ?? getAppearancePreference();
      setAppearance(next);
    };
    window.addEventListener(APPEARANCE_CHANGE_EVENT, sync);
    return () => window.removeEventListener(APPEARANCE_CHANGE_EVENT, sync);
  }, []);

  const closeDialog = useCallback(() => {
    setOpen(false);
    setMessage("");
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const dialog = dialogRef.current;
    const focusCurrentMode = window.setTimeout(() => {
      dialog?.querySelector<HTMLElement>(`[data-appearance-mode="${mode}"]`)?.focus();
    }, 30);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusCurrentMode);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeDialog, mode, open]);

  const commit = (next: AppearancePreferenceV1) => {
    const saved = saveAppearancePreference(next);
    setAppearance(saved);
    setMessage("");
  };

  const commitOverride = (value: AccentPreference) => {
    commit({ ...appearance, accent: { mode: "override", value } });
  };

  const applyCustom = (value = customHex) => {
    const normalized = normalizeHexColor(value);
    if (!normalized) {
      setMessage("请输入有效的 HEX 颜色，例如 #5F8EAD。");
      return;
    }
    if (!isCustomAccentVisible(normalized, getResolvedTheme())) {
      setMessage("这个颜色与当前主题过于接近，请选择对比更清晰的颜色。");
      return;
    }
    setCustomHex(normalized);
    commitOverride({ preset: "custom", customHex: normalized });
  };

  const resetAppearance = () => {
    commit(DEFAULT_APPEARANCE);
    setCustomHex("#5F8EAD");
    onModeChange("dark");
  };

  const activeOverride = appearance.accent.mode === "override" ? appearance.accent.value : null;
  const recommendedAccent = THEME_DEFAULT_ACCENTS[appearance.palette].label;
  const paletteMeta = THEME_PALETTE_META[appearance.palette];
  const summary = getAppearanceSummary(appearance);
  const accentPreview = getAccentPreviewHex(appearance);

  return (
    <>
      <section className="section-surface min-h-[76px] p-4">
        <div className="flex min-w-0 flex-wrap items-center gap-3 sm:flex-nowrap">
          <span className="relative grid h-10 w-14 shrink-0 grid-cols-2 overflow-hidden rounded-[8px] border border-line" aria-hidden="true">
            <span style={{ backgroundColor: paletteMeta.preview.paper }} />
            <span style={{ backgroundColor: paletteMeta.preview.surface }} />
            <span style={{ backgroundColor: paletteMeta.preview.ink }} />
            <span style={{ backgroundColor: paletteMeta.preview.accent }} />
            <span
              className="absolute bottom-1 right-1 h-3.5 w-3.5 rounded-full border-2 border-white/80 shadow-sm"
              style={{ backgroundColor: accentPreview }}
            />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="text-sm font-semibold text-ink">外观</h3>
              <span className="truncate text-sm font-medium text-ink/70">{summary.combination}</span>
            </div>
            <p className="mt-1 truncate text-xs text-ink/46">{summary.accent}</p>
          </div>
          <button
            ref={triggerRef}
            type="button"
            className="secondary-action action-standard shrink-0 gap-1.5 text-xs"
            disabled={disabled}
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={open}
          >
            <SlidersHorizontal size={14} aria-hidden="true" />
            调整
          </button>
        </div>
      </section>

      {open ? (
        <div className="modal-backdrop" role="presentation">
          <section
            ref={dialogRef}
            aria-labelledby={titleId}
            aria-modal="true"
            className="modal-surface flex max-h-[82vh] w-full max-w-[640px] flex-col"
            role="dialog"
          >
            <header className="flex items-center justify-between gap-3 border-b border-line bg-panel/70 px-5 py-3">
              <div className="min-w-0">
                <h3 id={titleId} className="text-sm font-semibold text-ink">外观</h3>
                <p className="mt-0.5 truncate text-xs text-ink/44">{summary.combination} · {summary.accent}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  className="secondary-action action-compact gap-1.5 text-xs"
                  onClick={resetAppearance}
                  disabled={
                    disabled
                    || (
                      appearance.mode === "dark"
                      && appearance.palette === "daymark"
                      && appearance.accent.mode === "theme-default"
                    )
                  }
                >
                  <RotateCcw size={13} aria-hidden="true" />
                  恢复默认
                </button>
                <button type="button" className="ghost-action icon-action-compact" onClick={closeDialog} aria-label="关闭外观设置">
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            </header>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 scrollbar-thin">
              <section>
                <h4 className="text-sm font-semibold text-ink">显示模式</h4>
                <div className="mt-2 grid grid-cols-3 overflow-hidden rounded-[8px] border border-line bg-panel/55 p-1">
                  {[
                    { value: "dark" as const, label: "深色", icon: Moon },
                    { value: "light" as const, label: "浅色", icon: Sun },
                    { value: "system" as const, label: "跟随系统", icon: Monitor },
                  ].map(({ value, label, icon: Icon }) => {
                    const active = mode === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        data-appearance-mode={value}
                        className={`flex h-9 min-w-0 items-center justify-center gap-2 rounded-[6px] px-2 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 ${
                          active
                            ? "bg-surface text-ink shadow-sm ring-1 ring-accent/25"
                            : "text-ink/48 hover:bg-surface/65 hover:text-ink"
                        }`}
                        disabled={disabled}
                        onClick={() => onModeChange(value)}
                        aria-pressed={active}
                      >
                        <Icon size={14} aria-hidden="true" />
                        <span className="truncate">{label}</span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="border-t border-line pt-4">
                <div>
                  <h4 className="text-sm font-semibold text-ink">主题风格</h4>
                  <p className="mt-1 text-xs leading-5 text-ink/48">改变背景、侧栏和面板的整体色温。</p>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {THEME_PALETTES.map((palette) => {
                    const meta = THEME_PALETTE_META[palette];
                    const active = appearance.palette === palette;
                    return (
                      <button
                        key={palette}
                        type="button"
                        className={`flex min-h-[64px] items-center gap-3 rounded-[8px] border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 ${
                          active
                            ? "border-accent/50 bg-accent/10 text-ink"
                            : "border-line bg-panel/70 text-ink/62 hover:border-accent/30 hover:bg-surface"
                        }`}
                        disabled={disabled}
                        onClick={() => commit({ ...appearance, palette })}
                        aria-pressed={active}
                      >
                        <span className="relative grid h-9 w-12 shrink-0 grid-cols-2 overflow-hidden rounded-[7px] border border-white/10" aria-hidden="true">
                          <span style={{ backgroundColor: meta.preview.paper }} />
                          <span style={{ backgroundColor: meta.preview.surface }} />
                          <span style={{ backgroundColor: meta.preview.ink }} />
                          <span style={{ backgroundColor: meta.preview.accent }} />
                          {active ? (
                            <span className="absolute inset-0 grid place-items-center bg-black/18">
                              <Check size={14} strokeWidth={2.4} className="text-white drop-shadow" />
                            </span>
                          ) : null}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-ink">{meta.label}</span>
                          <span className="mt-0.5 block truncate text-xs text-ink/45">{meta.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="border-t border-line pt-4">
                <div>
                  <h4 className="text-sm font-semibold text-ink">强调色</h4>
                  <p className="mt-1 text-xs leading-5 text-ink/48">用于选中、聚焦和交互反馈，不改变主题表面。</p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2" aria-label="强调色选项">
                  <button
                    type="button"
                    className={`flex h-9 items-center gap-2 rounded-[8px] border px-2.5 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 ${
                      appearance.accent.mode === "theme-default"
                        ? "border-accent/55 bg-accent/10 text-ink"
                        : "border-line bg-panel/70 text-ink/58 hover:border-accent/35 hover:text-ink"
                    }`}
                    disabled={disabled}
                    onClick={() => commit({ ...appearance, accent: { mode: "theme-default" } })}
                    aria-pressed={appearance.accent.mode === "theme-default"}
                  >
                    <Sparkles size={14} aria-hidden="true" />
                    跟随主题 · {recommendedAccent}
                  </button>

                  {ACCENT_PRESETS.map((preset) => {
                    const meta = ACCENT_PRESET_META[preset];
                    const active = activeOverride?.preset === preset;
                    return (
                      <button
                        key={preset}
                        type="button"
                        className={`flex h-9 items-center gap-2 rounded-[8px] border px-2.5 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40 ${
                          active
                            ? "border-accent/55 bg-accent/10 text-ink"
                            : "border-line bg-panel/70 text-ink/58 hover:border-accent/35 hover:text-ink"
                        }`}
                        disabled={disabled}
                        onClick={() => commitOverride({ preset })}
                        aria-pressed={active}
                        title={meta.label}
                      >
                        <span
                          className="grid h-4 w-4 place-items-center rounded-full border border-white/15"
                          style={{ backgroundColor: meta.hex }}
                          aria-hidden="true"
                        >
                          {active ? <Check size={10} strokeWidth={2.4} className="text-white drop-shadow" /> : null}
                        </span>
                        {meta.label}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <label className="relative grid h-9 w-9 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-[8px] border border-line bg-panel" title="选择自定义颜色">
                    <span className="h-5 w-5 rounded-full border border-white/15" style={{ backgroundColor: customHex }} aria-hidden="true" />
                    <input
                      type="color"
                      value={normalizeHexColor(customHex) ?? "#5F8EAD"}
                      className="absolute inset-0 cursor-pointer opacity-0"
                      aria-label="选择自定义强调色"
                      disabled={disabled}
                      onChange={(event) => {
                        setCustomHex(event.target.value.toUpperCase());
                        applyCustom(event.target.value);
                      }}
                    />
                  </label>
                  <input
                    className="field-control h-9 w-32 px-3 text-xs uppercase"
                    value={customHex}
                    aria-label="自定义强调色 HEX"
                    maxLength={7}
                    spellCheck={false}
                    disabled={disabled}
                    onChange={(event) => {
                      setCustomHex(event.target.value);
                      setMessage("");
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        applyCustom();
                      }
                    }}
                  />
                  <button type="button" className="secondary-action action-standard text-xs" disabled={disabled} onClick={() => applyCustom()}>
                    应用自定义色
                  </button>
                  {activeOverride?.preset === "custom" ? <span className="text-xs text-accent">当前使用自定义色</span> : null}
                </div>
                {message ? <p className="mt-2 text-xs text-red-400" role="alert">{message}</p> : null}
              </section>
            </div>

            <footer className="flex items-center justify-between gap-3 border-t border-line bg-panel/45 px-5 py-3">
              <p className="text-xs text-ink/42">更改会即时保存。</p>
              <button type="button" className="primary-action action-standard text-xs" onClick={closeDialog}>完成</button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
