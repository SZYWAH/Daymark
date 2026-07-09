import {
  Bot,
  CheckCircle2,
  Database,
  Download,
  Moon,
  FolderSearch,
  HardDrive,
  KeyRound,
  RefreshCw,
  Save,
  ShieldCheck,
  Sun,
  Monitor,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { getEffectiveAiSettings, getProviderLabel, hasEnvApiKey, testAiConnection } from "../ai/deepseek";
import {
  isDesktopRuntime,
  probeConversationSources,
  readTextFileWithDialog,
  saveTextFileWithDialog,
} from "../lib/desktop";
import {
  exportCoreBackup,
  validateCoreBackup,
  type DaymarkCoreBackupCounts,
  type DaymarkCoreBackupV1,
} from "../data/itemStore";
import { hasStoredAiApiKey } from "../lib/aiSecrets";
import { getSafeErrorMessage } from "../lib/redaction";
import { applyThemeMode } from "../lib/theme";
import { PageWorkspace } from "./PageWorkspace";
import { ResultRow, ScrollableResultPanel } from "./ResultPanels";
import { SelectMenu } from "./SelectMenu";
import type { AiSettings, ConversationSourceProbe } from "../types";

type SettingsPanelProps = {
  settings: AiSettings;
  onSave: (settings: AiSettings) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  onRestoreCoreBackup: (backup: DaymarkCoreBackupV1) => Promise<DaymarkCoreBackupCounts | null>;
};

function normalizeSettingsForDirty(settings: AiSettings) {
  return {
    provider: settings.provider,
    customProviderName: settings.customProviderName?.trim() ?? "",
    baseUrl: settings.baseUrl.trim(),
    model: settings.model.trim(),
    useEnvKey: settings.useEnvKey,
    manualApiKey: settings.manualApiKey?.trim() ?? "",
    manualKeyStored: Boolean(settings.manualKeyStored),
    manualKeyClearRequested: Boolean(settings.manualKeyClearRequested),
    supportsVision: Boolean(settings.supportsVision),
    stream: settings.stream,
    themeMode: settings.themeMode,
  };
}

function hasNonThemeSettingsChanges(draft: AiSettings, settings: AiSettings) {
  const { themeMode: _draftTheme, ...draftWithoutTheme } = normalizeSettingsForDirty(draft);
  const { themeMode: _settingsTheme, ...settingsWithoutTheme } = normalizeSettingsForDirty(settings);
  return JSON.stringify(draftWithoutTheme) !== JSON.stringify(settingsWithoutTheme);
}

export function SettingsPanel({ settings, onSave, onDirtyChange, onRestoreCoreBackup }: SettingsPanelProps) {
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [themeSaving, setThemeSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [backupBusy, setBackupBusy] = useState<"export" | "restore" | null>(null);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"ok" | "error" | "info">("info");
  const themeSaveSeqRef = useRef(0);
  const themeSavingRef = useRef(false);
  const savingRef = useRef(false);
  const testingRef = useRef(false);
  const keyProbeSeqRef = useRef(0);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const envKeyAvailable = hasEnvApiKey();
  const desktop = isDesktopRuntime();
  const effective = useMemo(() => getEffectiveAiSettings(draft), [draft]);
  const pendingManualKey = Boolean(draft.manualApiKey?.trim());
  const keySourceLabel =
    effective.keySource === "env"
      ? "环境变量"
      : desktop
        ? pendingManualKey
          ? "手动输入待保存"
          : draft.manualKeyStored
            ? "系统凭据"
            : "未配置"
        : effective.keySource === "manual"
          ? "本机应用数据"
          : "未配置";
  const dirty = useMemo(
    () => JSON.stringify(normalizeSettingsForDirty(draft)) !== JSON.stringify(normalizeSettingsForDirty(settings)),
    [draft, settings],
  );

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!desktop || draft.manualApiKey?.trim() || draft.manualKeyClearRequested) return;
    const requestSeq = ++keyProbeSeqRef.current;
    void hasStoredAiApiKey(draft)
      .then((stored) => {
        if (keyProbeSeqRef.current !== requestSeq) return;
        setDraft((current) => {
          if (
            current.provider !== draft.provider ||
            current.baseUrl !== draft.baseUrl ||
            current.manualApiKey?.trim() ||
            current.manualKeyClearRequested
          ) {
            return current;
          }
          if (Boolean(current.manualKeyStored) === stored) return current;
          return { ...current, manualKeyStored: stored };
        });
      })
      .catch((error) => {
        if (keyProbeSeqRef.current !== requestSeq) return;
        setMessageType("error");
        setMessage(getSafeErrorMessage(error, "无法读取系统凭据状态。"));
      });
  }, [desktop, draft.provider, draft.baseUrl, draft.manualApiKey, draft.manualKeyClearRequested]);

  const saveSettings = async () => {
    if (savingRef.current || themeSavingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setMessage("");

    try {
      const saved = {
        ...draft,
        manualApiKey: draft.manualApiKey?.trim() ?? "",
      };
      await onSave(saved);
      setMessageType("ok");
      setMessage("设置已保存。");
    } catch (error) {
      setMessageType("error");
      setMessage(getSafeErrorMessage(error, "保存失败。"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const exportBackup = async () => {
    if (backupBusy) return;
    setBackupBusy("export");
    setMessage("");

    try {
      const backup = await exportCoreBackup();
      const fileName = getCoreBackupFileName();
      const contents = `${JSON.stringify(backup, null, 2)}\n`;
      if (isDesktopRuntime()) {
        const savedPath = await saveTextFileWithDialog({
          title: "导出 Daymark 核心备份",
          defaultPath: fileName,
          contents,
          filters: [{ name: "JSON", extensions: ["json"] }],
        });
        if (!savedPath) {
          setMessageType("info");
          setMessage("已取消导出。");
          return;
        }
      } else {
        downloadTextFile(fileName, contents);
      }
      setMessageType("ok");
      setMessage(`核心备份已导出：${formatCoreBackupCounts(backup.counts)}。`);
    } catch (error) {
      setMessageType("error");
      setMessage(getSafeErrorMessage(error, "导出核心备份失败。"));
    } finally {
      setBackupBusy(null);
    }
  };

  const startRestoreBackup = async () => {
    if (backupBusy) return;
    setMessage("");

    if (!isDesktopRuntime()) {
      backupInputRef.current?.click();
      return;
    }

    setBackupBusy("restore");
    try {
      const selected = await readTextFileWithDialog({
        title: "选择 Daymark 核心备份",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!selected) {
        setMessageType("info");
        setMessage("已取消恢复。");
        return;
      }
      await restoreBackupFromText(selected.contents);
    } catch (error) {
      setMessageType("error");
      setMessage(getSafeErrorMessage(error, "恢复核心备份失败。"));
    } finally {
      setBackupBusy(null);
    }
  };

  const restoreBackupFromText = async (contents: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(contents);
    } catch {
      throw new Error("备份文件不是有效的 JSON。");
    }
    const backup = validateCoreBackup(parsed);
    setMessageType("info");
    setMessage(`已读取备份：${formatCoreBackupCounts(backup.counts)}。请确认是否覆盖恢复。`);
    const restored = await onRestoreCoreBackup(backup);
    if (!restored) {
      setMessageType("info");
      setMessage("已取消恢复。");
      return;
    }
    setMessageType("ok");
    setMessage(`核心备份已恢复：${formatCoreBackupCounts(restored)}。`);
  };

  const handleBrowserBackupFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBackupBusy("restore");
    try {
      await restoreBackupFromText(await file.text());
    } catch (error) {
      setMessageType("error");
      setMessage(getSafeErrorMessage(error, "恢复核心备份失败。"));
    } finally {
      setBackupBusy(null);
    }
  };

  const testConnection = async () => {
    if (testingRef.current) return;
    testingRef.current = true;
    setTesting(true);
    setMessage("");

    try {
      const result = await testAiConnection(draft);
      setMessageType("ok");
      setMessage(result || "连接正常。");
    } catch (error) {
      setMessageType("error");
      setMessage(getSafeErrorMessage(error, "测试连接失败。"));
    } finally {
      testingRef.current = false;
      setTesting(false);
    }
  };

  return (
    <PageWorkspace
      eyebrow="Settings"
      title="设置"
      description="把外部能力收好，真正使用前再轻轻打开。"
      meta={getProviderLabel(draft)}
      actions={
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <button
            className={`${dirty ? "primary-action" : "secondary-action"} flex h-9 items-center gap-2 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-55`}
            disabled={saving || themeSaving || !dirty}
            onClick={saveSettings}
          >
            <Save size={15} />
            {saving ? "保存中" : "保存"}
          </button>
          <button
            className="secondary-action flex h-9 items-center gap-2 px-3 text-xs"
            disabled={testing || saving || themeSaving}
            onClick={testConnection}
          >
            <Bot size={15} />
            {testing ? "测试中" : "测试连接"}
          </button>
          {dirty && <span className="text-xs text-copper/80">未保存</span>}
        </div>
      }
    >
      <div className="min-h-full px-5 pb-24 pt-5 lg:pb-5 xl:h-full xl:min-h-0 xl:overflow-hidden">
        <div className="mx-auto grid min-h-0 max-w-7xl gap-5 xl:h-full xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-5 pr-1 xl:min-h-0 xl:overflow-y-auto xl:scrollbar-thin">
        <div className="section-surface space-y-4 p-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-copper">Theme</p>
            <h3 className="mt-1 text-base font-semibold text-ink">界面主题</h3>
            <p className="mt-1 text-sm leading-6 text-ink/52">暗色为默认书房场，浅色保留，系统模式会跟随 Windows 设置。</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              { mode: "dark" as const, label: "暗色", icon: Moon, text: "静场书房" },
              { mode: "light" as const, label: "浅色", icon: Sun, text: "纸面工具" },
              { mode: "system" as const, label: "跟随系统", icon: Monitor, text: "自动切换" },
            ].map(({ mode, label, icon: Icon, text }) => {
              const active = draft.themeMode === mode;
              return (
                <button
                  key={mode}
                  className={`flex items-center gap-3 rounded-[8px] border px-3 py-3 text-left transition ${
                    active
                      ? "border-copper/50 bg-copper/10 text-ink shadow-card"
                      : "border-line bg-panel/70 text-ink/62 hover:border-copper/30 hover:bg-surface"
                  }`}
                  disabled={themeSaving || saving}
                  onClick={() => {
                    if (themeSavingRef.current || active) return;
                    themeSavingRef.current = true;
                    setThemeSaving(true);
                    const requestSeq = themeSaveSeqRef.current + 1;
                    themeSaveSeqRef.current = requestSeq;
                    const nextDraft = { ...draft, themeMode: mode };
                    setDraft(nextDraft);
                    setMessage("");
                    applyThemeMode(mode);
                    if (hasNonThemeSettingsChanges(draft, settings)) {
                      themeSavingRef.current = false;
                      setThemeSaving(false);
                      setMessageType("info");
                      setMessage("主题已预览。当前页面还有未保存的 AI 配置，请点击“保存”后一起生效。");
                      return;
                    }
                    void onSave({ ...settings, themeMode: mode })
                      .then(() => {
                        if (themeSaveSeqRef.current !== requestSeq) return;
                        setMessageType("ok");
                        setMessage("主题已保存。");
                      })
                      .catch((error) => {
                        if (themeSaveSeqRef.current !== requestSeq) return;
                        setDraft(settings);
                        applyThemeMode(settings.themeMode);
                        setMessageType("error");
                        setMessage(getSafeErrorMessage(error, "主题保存失败。"));
                      })
                      .finally(() => {
                        if (themeSaveSeqRef.current !== requestSeq) return;
                        themeSavingRef.current = false;
                        setThemeSaving(false);
                      });
                  }}
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-line bg-surface text-copper">
                    <Icon size={17} />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold">{label}</span>
                    <span className="mt-0.5 block text-xs text-ink/45">{text}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="section-surface space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-copper">Backup</p>
              <h3 className="mt-1 text-base font-semibold text-ink">数据备份</h3>
              <p className="mt-1 text-sm leading-6 text-ink/52">
                导出资料、目录、日记、记忆和链接；不会导出 AI 设置、API Key、草稿或历史总结报告。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="secondary-action flex h-10 items-center gap-2 px-4 text-xs"
                disabled={Boolean(backupBusy)}
                onClick={exportBackup}
              >
                {backupBusy === "export" ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />}
                {backupBusy === "export" ? "导出中" : "导出核心备份"}
              </button>
              <button
                className="secondary-action flex h-10 items-center gap-2 px-4 text-xs"
                disabled={Boolean(backupBusy)}
                onClick={startRestoreBackup}
              >
                {backupBusy === "restore" ? <RefreshCw size={16} className="animate-spin" /> : <Upload size={16} />}
                {backupBusy === "restore" ? "恢复中" : "恢复核心备份"}
              </button>
              <input
                ref={backupInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={handleBrowserBackupFileSelected}
              />
            </div>
          </div>
          <div className="rounded-[8px] border border-line bg-panel/70 p-3 text-xs leading-5 text-ink/52">
            恢复会在确认后覆盖当前核心内容。主题、布局、AI 设置和手动 API Key 会保留在本机，不会被备份文件改写。
          </div>
        </div>

        <div className="section-surface space-y-4 p-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-copper">AI Provider</p>
            <h3 className="mt-1 text-base font-semibold text-ink">AI 整理</h3>
            <p className="mt-1 text-sm leading-6 text-ink/52">只在你点击总结、提炼或整理时调用，不做后台自动请求。</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-xs font-medium text-ink/58">
              AI 供应商
              <div className="mt-1">
                <SelectMenu
                  value={draft.provider}
                  options={[
                    { value: "deepseek", label: "DeepSeek" },
                    { value: "openai-compatible", label: "OpenAI 兼容自定义" },
                  ]}
                  onChange={(value) => {
                    const provider = value as AiSettings["provider"];
                    const providerChanged = provider !== draft.provider;
                    setDraft({
                      ...draft,
                      provider,
                      supportsVision: provider === "openai-compatible" ? draft.supportsVision : false,
                      useEnvKey: provider === "deepseek" ? draft.useEnvKey : false,
                      baseUrl: provider === "deepseek" ? "https://api.deepseek.com" : draft.baseUrl,
                      model: provider === "deepseek" ? "deepseek-v4-flash" : draft.model,
                      manualApiKey: providerChanged ? "" : draft.manualApiKey,
                      manualKeyStored: providerChanged ? false : draft.manualKeyStored,
                      manualKeyClearRequested: false,
                    });
                    if (providerChanged) {
                      setMessageType("info");
                      setMessage("已切换供应商。为避免旧 Key 误用，手动 API Key 已清空。");
                    }
                  }}
                />
              </div>
            </label>

            <label className="text-xs font-medium text-ink/58">
              模型
              <input
                value={draft.model}
                onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                className="field-control mt-1 h-10 w-full px-3 text-sm"
              />
            </label>
          </div>

          {draft.provider === "openai-compatible" && (
            <label className="block text-xs font-medium text-ink/58">
              自定义名称
              <input
                value={draft.customProviderName ?? ""}
                onChange={(event) => setDraft({ ...draft, customProviderName: event.target.value })}
                placeholder="例如 OpenAI、硅基流动、OpenRouter"
                className="field-control mt-1 h-10 w-full px-3 text-sm"
              />
            </label>
          )}

          <label className="block text-xs font-medium text-ink/58">
            Base URL
            <input
              value={draft.baseUrl}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  baseUrl: event.target.value,
                  manualKeyStored: false,
                  manualKeyClearRequested: false,
                })
              }
              className="field-control mt-1 h-10 w-full px-3 text-sm"
            />
          </label>

          <div className="rounded-[8px] border border-moss/30 bg-moss/10 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-moss">
              <KeyRound size={16} />
              API Key 来源
            </div>
            <label className="mb-3 flex items-center gap-2 text-sm text-ink/70">
              <input
                type="checkbox"
                checked={draft.useEnvKey}
                disabled={draft.provider !== "deepseek"}
                onChange={(event) => setDraft({ ...draft, useEnvKey: event.target.checked })}
                className="control-checkbox"
              />
              优先使用环境变量 VITE_DEEPSEEK_API_KEY（仅 DeepSeek）
            </label>
            <div className="flex gap-2">
              <input
                value={draft.manualApiKey ?? ""}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    manualApiKey: event.target.value,
                    manualKeyClearRequested: false,
                  })
                }
                type="password"
                placeholder={
                  desktop
                    ? draft.manualKeyStored
                      ? "已保存到系统凭据；输入新 Key 会覆盖"
                      : "填写 API Key；保存后进入系统凭据"
                    : "填写 API Key；Web 模式保存在本机应用数据中"
                }
                className="field-control h-10 min-w-0 flex-1 px-3 text-sm"
              />
              <button
                className="soft-button flex h-10 shrink-0 items-center gap-1.5 px-3 text-xs"
                disabled={!draft.manualApiKey && !draft.manualKeyStored}
                onClick={() => {
                  if (draft.manualApiKey?.trim()) {
                    setDraft({ ...draft, manualApiKey: "", manualKeyClearRequested: false });
                    setMessage("待保存的手动 API Key 已从当前配置草稿中清除。");
                  } else {
                    setDraft({
                      ...draft,
                      manualApiKey: "",
                      manualKeyStored: false,
                      manualKeyClearRequested: true,
                    });
                    setMessage("当前 Base URL 的系统凭据 Key 已标记清除，保存后生效。");
                  }
                  setMessageType("info");
                }}
              >
                <X size={14} />
                清除
              </button>
            </div>
            <p className="mt-3 text-xs leading-5 text-ink/52">
              {envKeyAvailable
                ? draft.provider === "deepseek"
                  ? "已检测到 DeepSeek 环境变量 Key，调用时会优先使用它。注意：Vite 环境变量不是系统钥匙串，若在打包前写入 Key，不适合把生成的应用分发给他人。"
                  : "自定义供应商使用下方手动 API Key，不读取 DeepSeek 环境变量。"
                : "未检测到 DeepSeek 环境变量 Key。自定义供应商可直接填写自己的 API Key。"}
              {" "}桌面端手动 Key 会保存到系统凭据；Web 模式保留本机应用数据降级。连接错误会在界面显示前脱敏。
            </p>
          </div>

          {draft.provider === "openai-compatible" && (
            <div className="rounded-[8px] border border-line bg-panel/75 p-4">
              <div className="mb-3 text-sm font-semibold text-ink">自定义模型能力</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex items-center gap-2 text-sm text-ink/70">
                  <input
                    type="checkbox"
                    checked={Boolean(draft.supportsVision)}
                    onChange={(event) => setDraft({ ...draft, supportsVision: event.target.checked })}
                    className="control-checkbox"
                  />
                  支持图片分析
                </label>
                <label className="flex items-center gap-2 text-sm text-ink/70">
                  <input
                    type="checkbox"
                    checked={draft.stream}
                    onChange={(event) => setDraft({ ...draft, stream: event.target.checked })}
                    className="control-checkbox"
                  />
                  启用流式输出
                </label>
              </div>
              <p className="mt-3 text-xs leading-5 text-ink/52">
                请求使用 OpenAI Chat Completions 兼容格式：Base URL 后自动拼接 /chat/completions。图片只在你点击资料 AI 操作时读取并发送。
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink/45">
              当前模型：{getProviderLabel(draft)} · Key 来源：{keySourceLabel}
            </span>
            {dirty && <span className="text-xs text-copper/80">有未保存修改</span>}
          </div>

          {message && (
            <div
              role={messageType === "error" ? "alert" : "status"}
              aria-live={messageType === "error" ? "assertive" : "polite"}
              className={`flex max-h-36 items-start gap-2 overflow-y-auto rounded-[8px] border p-3 text-sm scrollbar-thin ${
                messageType === "ok"
                  ? "border-ink/20 bg-ink/10 text-ink"
                  : messageType === "error"
                    ? "border-red-400/45 bg-red-500/10 text-red-400"
                    : "border-line bg-surface text-ink/62"
              }`}
            >
              {messageType === "ok" ? <CheckCircle2 size={16} /> : messageType === "error" ? <XCircle size={16} /> : <ShieldCheck size={16} />}
              <span className="min-w-0 whitespace-pre-wrap text-anywhere">{message}</span>
            </div>
          )}

          <p className="text-xs leading-5 text-ink/42">
            “测试连接”只发送最小连接请求，用于确认模型可访问；不会发送资料库、日志或记忆正文。
          </p>
        </div>
          </div>
          <aside className="space-y-5 pr-1 xl:min-h-0 xl:overflow-y-auto xl:scrollbar-thin">
            <BuildInfo />
            <CodexProbePanel />
          </aside>
        </div>
      </div>
    </PageWorkspace>
  );
}

function getCoreBackupFileName(date = new Date()) {
  return `daymark-core-backup-${date.toISOString().slice(0, 10)}.json`;
}

function formatCoreBackupCounts(counts: DaymarkCoreBackupCounts) {
  const parts = [
    `${counts.items} 条资料`,
    `${counts.folders} 个目录`,
    `${counts.journalEntries} 篇日记`,
    `${counts.memoryDocument} 份记忆文档`,
    `${counts.memoryCards} 张记忆卡片`,
    `${counts.links} 个链接`,
  ];
  return parts.join(" / ");
}

function downloadTextFile(fileName: string, contents: string) {
  const blob = new Blob([contents], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function BuildInfo() {
  const buildTime = useMemo(() => {
    const date = new Date(__BUILD_TIME__);
    if (Number.isNaN(date.getTime())) return "本地开发构建";
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }, []);

  return (
    <section className="section-surface space-y-3 p-5">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-copper">Build</p>
        <h3 className="mt-1 text-base font-semibold text-ink">当前构建</h3>
        <p className="mt-1 text-sm leading-6 text-ink/52">用于确认你打开的是最新桌面程序。</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        <div className="rounded-[8px] border border-line bg-panel/70 p-3">
          <div className="text-xs text-ink/42">版本</div>
          <div className="mt-1 text-sm font-semibold text-ink">v{__APP_VERSION__}</div>
        </div>
        <div className="rounded-[8px] border border-line bg-panel/70 p-3">
          <div className="text-xs text-ink/42">构建时间</div>
          <div className="mt-1 text-sm font-semibold text-ink">{buildTime}</div>
        </div>
      </div>
    </section>
  );
}

function CodexProbePanel() {
  const desktop = isDesktopRuntime();
  const [probing, setProbing] = useState(false);
  const [probes, setProbes] = useState<ConversationSourceProbe[]>([]);
  const [message, setMessage] = useState("");
  const probingRef = useRef(false);

  const runProbe = async () => {
    if (probingRef.current) return;
    probingRef.current = true;
    setProbing(true);
    setMessage("");

    try {
      const result = await probeConversationSources();
      setProbes(result);
      const found = result.filter((probe) => probe.exists).length;
      setMessage(`已完成只读预检，找到 ${found} 个可访问来源。`);
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "预检失败，请稍后再试。"));
      setProbes([]);
    } finally {
      probingRef.current = false;
      setProbing(false);
    }
  };

  return (
    <section className="section-surface space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-copper">AI Sources</p>
          <h3 className="mt-1 text-base font-semibold text-ink">AI 对话来源预检</h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-ink/52">
            先看看本机是否有可用的 Codex 与 Claude Code 对话痕迹。本轮只看路径、大小和修改时间，不读取正文，不上传内容，也不写入记忆。
          </p>
        </div>
        <button
          className="secondary-action flex h-10 items-center gap-2 px-4"
          disabled={!desktop || probing}
          onClick={runProbe}
        >
          {probing ? <RefreshCw size={16} className="animate-spin" /> : <FolderSearch size={16} />}
          {probing ? "预检中" : "只读预检"}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <CodexPrinciple icon={ShieldCheck} title="只读" text="不修改 Codex 或 Claude Code 文件，也不移动任何记录。" />
        <CodexPrinciple icon={HardDrive} title="本机" text="预检发生在本机桌面壳里，Web 模式不启用。" />
        <CodexPrinciple icon={Database} title="不总结" text="本轮不调用 AI，只判断未来是否可做。" />
      </div>

      {!desktop && (
        <div className="rounded-[8px] border border-line bg-panel px-3 py-2 text-sm leading-6 text-ink/70">
          AI 对话来源预检需要桌面端运行。浏览器模式下不会读取本机路径。
        </div>
      )}

      {message && (
        <div className="rounded-[8px] border border-line bg-panel px-3 py-2 text-anywhere text-sm leading-6 text-ink/62">
          {message}
        </div>
      )}

      {probes.length > 0 && (
        <ScrollableResultPanel
          title="预检结果"
          count={`${probes.filter((probe) => probe.exists).length} / ${probes.length} 可访问`}
          maxHeightClass="max-h-[280px]"
          bodyClassName="space-y-1.5"
        >
          {probes.map((probe) => (
            <ResultRow key={probe.id} className="px-3 py-2">
              <details>
                <summary className="plain-summary cursor-pointer select-none">
                  <div className="inline-flex w-full min-w-0 items-center gap-2 align-middle">
                    <h4 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{probe.label}</h4>
                    <span className="shrink-0 text-[11px] text-ink/40">
                      {probe.sourceKind === "claude" ? "Claude Code" : "Codex"} · {getProbeKindLabel(probe.probeKind)}
                    </span>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${
                        probe.exists ? "border-moss/30 bg-moss/10 text-moss" : "border-line bg-panel text-ink/50"
                      }`}
                    >
                      {probe.exists ? "可访问" : "未找到"}
                    </span>
                  </div>
                  <div className="mt-1 flex min-w-0 items-center justify-between gap-2 text-xs text-ink/42">
                    <span className="min-w-0 truncate" title={probe.path}>{formatProbePathTail(probe.path)}</span>
                    <span className="shrink-0">
                      {formatProbeSize(probe)}
                      {probe.modifiedAt !== undefined ? ` · ${formatProbeTime(probe.modifiedAt)}` : ""}
                    </span>
                  </div>
                </summary>
                <div className="mt-2 rounded-[8px] border border-line bg-panel/70 px-3 py-2 text-xs leading-5 text-ink/48">
                  <p className="text-anywhere">{probe.path}</p>
                  {probe.message && <p className="mt-1 text-anywhere">{probe.message}</p>}
                </div>
              </details>
            </ResultRow>
          ))}
        </ScrollableResultPanel>
      )}

      <div className="rounded-[8px] border border-line bg-panel/80 p-3 text-sm leading-6 text-ink/58">
        后续若正式开启，会采用“选择日期范围 → 手动生成每日回顾 → 产生待确认记忆 → 你审核后写入长期记忆”的流程。
      </div>
    </section>
  );
}

function CodexPrinciple({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof ShieldCheck;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-[8px] border border-line bg-panel/70 p-3">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
        <Icon size={15} className="text-moss" />
        {title}
      </div>
      <p className="text-xs leading-5 text-ink/50">{text}</p>
    </div>
  );
}

function getProbeKindLabel(kind: ConversationSourceProbe["probeKind"]) {
  if (kind === "database") return "数据库";
  if (kind === "directory") return "目录";
  return "文件";
}

function formatProbeSize(probe: ConversationSourceProbe) {
  if (probe.probeKind === "directory") return "目录";
  if (probe.sizeBytes === undefined || probe.sizeBytes === null) return "";
  return formatBytes(probe.sizeBytes);
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatProbePathTail(path: string) {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.length > 2 ? `...\\${parts.slice(-2).join("\\")}` : path;
}

function formatProbeTime(value: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
