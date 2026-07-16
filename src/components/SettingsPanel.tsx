import {
  Bot,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Database,
  Download,
  FolderSearch,
  HardDrive,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Upload,
  X,
  XCircle,
  Library,
} from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ChangeEvent } from "react";
import { fetchAvailableAiModels, hasEnvApiKey, testAiConnection } from "../ai/deepseek";
import type { AiModelOption } from "../lib/aiTransport";
import {
  isDesktopRuntime,
  clearConversationDateIndex,
  getQuickCaptureTopEntryEnabled,
  probeConversationSources,
  readTextFileWithDialog,
  saveTextFileWithDialog,
  setQuickCaptureTopEntryEnabled,
} from "../lib/desktop";
import {
  getConversationDateIndexPreference,
  pauseConversationDateIndexCompletion,
  saveConversationDateIndexPreference,
  startConversationDateIndexCompletion,
} from "../lib/conversationDateIndex";
import {
  exportCoreBackup,
  validateCoreBackup,
  type DaymarkCoreBackupCounts,
  type DaymarkCoreBackupV1,
} from "../data/itemStore";
import { hasStoredAiApiKey } from "../lib/aiSecrets";
import { getSafeErrorMessage } from "../lib/redaction";
import {
  getConnectionPresetLabel,
  getConnectionProtocolLabel,
  getCredentialStatusLabel,
  getValidCredentialAddress,
  type AiCredentialProbeState,
} from "../lib/aiConnectionDisplay";
import { saveThemeMode } from "../lib/theme";
import { PageWorkspace } from "./PageWorkspace";
import { ResultRow, ScrollableResultPanel } from "./ResultPanels";
import { SelectMenu } from "./SelectMenu";
import type { AiReasoningEffort, AiSettings, AutoWorkReviewSettings, ConversationSourceKind, ConversationSourceProbe } from "../types";
import type { DemoLibraryState } from "../data/demoLibrary";
import { AppearanceStyleSettings } from "./AppearanceStyleSettings";
import { AiConnectionConfigDialog } from "./AiConnectionConfigDialog";
import { ConfirmDialog } from "./ConfirmDialog";

type SettingsPanelProps = {
  settings: AiSettings;
  autoWorkReviewSettings: AutoWorkReviewSettings | null;
  autoWorkReviewRunning: boolean;
  onSave: (settings: AiSettings) => Promise<void>;
  onSaveAutoWorkReviewSettings: (patch: Partial<AutoWorkReviewSettings>) => Promise<AutoWorkReviewSettings>;
  onRunAutoWorkReview: () => Promise<unknown>;
  onDirtyChange?: (dirty: boolean) => void;
  onRestoreCoreBackup: (backup: DaymarkCoreBackupV1) => Promise<DaymarkCoreBackupCounts | null>;
  onOpenOnboarding: () => void;
  demoLibraryState: DemoLibraryState;
  onInstallDemoLibrary: () => Promise<void>;
  onRemoveDemoLibrary: () => void;
};

export type SettingsPanelHandle = {
  save: () => Promise<boolean>;
  discard: () => void;
};

function normalizeSettingsForDirty(settings: AiSettings) {
  return {
    provider: settings.provider,
    protocol: settings.protocol ?? "openai-chat-completions",
    reasoningEffort: settings.reasoningEffort ?? "default",
    customProviderName: settings.customProviderName?.trim() ?? "",
    anthropicAuthMode: settings.anthropicAuthMode ?? "x-api-key",
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

function getCredentialHost(address: string | null) {
  if (!address) return "等待有效地址";
  try {
    return new URL(address).host || address;
  } catch {
    return address;
  }
}

export const SettingsPanel = forwardRef<SettingsPanelHandle, SettingsPanelProps>(function SettingsPanel({
  settings,
  autoWorkReviewSettings,
  autoWorkReviewRunning,
  onSave,
  onSaveAutoWorkReviewSettings,
  onRunAutoWorkReview,
  onDirtyChange,
  onRestoreCoreBackup,
  onOpenOnboarding,
  demoLibraryState,
  onInstallDemoLibrary,
  onRemoveDemoLibrary,
}: SettingsPanelProps, ref) {
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [themeSaving, setThemeSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [availableModels, setAvailableModels] = useState<AiModelOption[]>([]);
  const [credentialProbeState, setCredentialProbeState] = useState<AiCredentialProbeState>("idle");
  const [aiConfigOpen, setAiConfigOpen] = useState(false);
  const [aiCloseConfirmOpen, setAiCloseConfirmOpen] = useState(false);
  const [backupBusy, setBackupBusy] = useState<"export" | "restore" | null>(null);
  const [quickCaptureTopEntryEnabled, setQuickCaptureTopEntryEnabledState] = useState(true);
  const [quickCaptureTopEntryBusy, setQuickCaptureTopEntryBusy] = useState(false);
  const [dateIndexIdleEnabled, setDateIndexIdleEnabled] = useState(false);
  const [dateIndexBusy, setDateIndexBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"ok" | "error" | "info">("info");
  const [aiConfigMessage, setAiConfigMessage] = useState("");
  const [aiConfigMessageType, setAiConfigMessageType] = useState<"ok" | "error" | "info">("info");
  const themeSaveSeqRef = useRef(0);
  const themeSavingRef = useRef(false);
  const savingRef = useRef(false);
  const testingRef = useRef(false);
  const keyProbeSeqRef = useRef(0);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const aiConfigTriggerRef = useRef<HTMLButtonElement | null>(null);
  const envKeyAvailable = hasEnvApiKey();
  const desktop = isDesktopRuntime();
  const pendingManualKey = Boolean(draft.manualApiKey?.trim());
  const credentialAddress = getValidCredentialAddress(draft.baseUrl);
  const envKeyActive = draft.provider === "deepseek" && draft.useEnvKey && envKeyAvailable;
  const credentialStatusLabel = getCredentialStatusLabel({
    desktop,
    envKeyActive,
    pendingManualKey,
    clearRequested: Boolean(draft.manualKeyClearRequested),
    stored: Boolean(draft.manualKeyStored),
    probeState: credentialProbeState,
    validAddress: Boolean(credentialAddress),
  });
  const dirty = useMemo(
    () => JSON.stringify(normalizeSettingsForDirty(draft)) !== JSON.stringify(normalizeSettingsForDirty(settings)),
    [draft, settings],
  );
  const aiDirty = useMemo(() => hasNonThemeSettingsChanges(draft, settings), [draft, settings]);
  const discoveredReasoningEfforts = availableModels.find((model) => model.id === draft.model)?.supportedReasoningEfforts;
  const allReasoningEfforts: Array<{ value: AiReasoningEffort; label: string }> = [
    { value: "default", label: "跟随模型（不发送 effort）" },
    { value: "none", label: "none" },
    { value: "minimal", label: "minimal" },
    { value: "low", label: "low" },
    { value: "medium", label: "medium" },
    { value: "high", label: "high" },
    { value: "xhigh", label: "xhigh" },
  ];
  const reasoningEfforts = allReasoningEfforts.filter((option) =>
    option.value === "default"
    || !discoveredReasoningEfforts?.length
    || discoveredReasoningEfforts.includes(option.value as Exclude<AiReasoningEffort, "default">));
  const autoWorkReviewEnabled = Boolean(autoWorkReviewSettings?.enabled);
  const autoSourceKinds = autoWorkReviewSettings?.sourceKinds ?? ["codex", "claude"];
  const autoWorkReviewStatus = autoWorkReviewRunning
    ? "正在更新今日工作内容。"
    : autoWorkReviewSettings?.lastMessage || "默认关闭；开启后 Daymark 运行期间每 30 分钟自动更新。";

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  useEffect(() => {
    setAvailableModels([]);
  }, [draft.provider, draft.baseUrl]);

  useEffect(() => {
    if (!desktop) return;
    void getQuickCaptureTopEntryEnabled()
      .then(setQuickCaptureTopEntryEnabledState)
      .catch(() => undefined);
  }, [desktop]);

  useEffect(() => {
    setDateIndexIdleEnabled(getConversationDateIndexPreference().idleCompletionEnabled);
  }, []);

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    const requestSeq = ++keyProbeSeqRef.current;
    if (!credentialAddress) {
      setCredentialProbeState("idle");
      return;
    }
    if (!desktop || draft.manualApiKey?.trim() || draft.manualKeyClearRequested) {
      setCredentialProbeState("ready");
      return;
    }
    setCredentialProbeState("probing");
    void hasStoredAiApiKey(draft)
      .then((stored) => {
        if (keyProbeSeqRef.current !== requestSeq) return;
        setCredentialProbeState("ready");
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
        setCredentialProbeState("error");
        setMessageType("error");
        setMessage(getSafeErrorMessage(error, "无法读取系统凭据状态。"));
      });
  }, [credentialAddress, desktop, draft.provider, draft.baseUrl, draft.manualApiKey, draft.manualKeyClearRequested]);

  const saveSettings = async ({ closeOnSuccess = false }: { closeOnSuccess?: boolean } = {}) => {
    if (savingRef.current || themeSavingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    setAiConfigMessage("正在保存设置…");
    setAiConfigMessageType("info");

    try {
      const saved = {
        ...draft,
        manualApiKey: draft.manualApiKey?.trim() ?? "",
      };
      await onSave(saved);
      setMessageType("ok");
      setMessage(closeOnSuccess ? "AI 连接已保存。" : "设置已保存。");
      if (closeOnSuccess) finishClosingAiConfig();
      return true;
    } catch (error) {
      setAiConfigMessageType("error");
      setAiConfigMessage(getSafeErrorMessage(error, "保存失败。"));
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  useImperativeHandle(ref, () => ({
    save: saveSettings,
    discard: () => {
      setDraft(settings);
      setMessageType("info");
      setMessage("已放弃未保存的 AI 配置修改。");
    },
  }), [settings, draft]);

  const toggleAutoWorkReviewSource = async (source: ConversationSourceKind) => {
    const current = new Set(autoSourceKinds);
    if (current.has(source) && current.size > 1) {
      current.delete(source);
    } else {
      current.add(source);
    }
    await onSaveAutoWorkReviewSettings({ sourceKinds: Array.from(current) });
  };

  const changeQuickCaptureTopEntry = async (enabled: boolean) => {
    if (!desktop || quickCaptureTopEntryBusy) return;
    setQuickCaptureTopEntryBusy(true);
    try {
      await setQuickCaptureTopEntryEnabled(enabled);
      setQuickCaptureTopEntryEnabledState(enabled);
      setMessageType("ok");
      setMessage(enabled ? "顶部快速记录入口已开启。" : "顶部快速记录入口已关闭；快捷键和托盘入口仍可使用。");
    } catch (error) {
      setMessageType("error");
      setMessage(getSafeErrorMessage(error, "无法更新顶部快速记录入口。"));
    } finally {
      setQuickCaptureTopEntryBusy(false);
    }
  };

  const changeDateIndexIdleCompletion = async (enabled: boolean) => {
    if (!desktop || dateIndexBusy) return;
    setDateIndexIdleEnabled(enabled);
    saveConversationDateIndexPreference({ idleCompletionEnabled: enabled });
    if (enabled) {
      startConversationDateIndexCompletion();
      setMessageType("ok");
      setMessage("空闲补全已开启；完成一次主动扫描后，Daymark 会在后台补全轻量日期索引。");
      return;
    }
    await pauseConversationDateIndexCompletion();
    setMessageType("info");
    setMessage("空闲补全已关闭；按日期扫描仍会按需核对并缓存结果。");
  };

  const clearDateIndex = async () => {
    if (!desktop || dateIndexBusy) return;
    setDateIndexBusy(true);
    try {
      await pauseConversationDateIndexCompletion();
      await clearConversationDateIndex();
      saveConversationDateIndexPreference({ userScanCompleted: false });
      setMessageType("ok");
      setMessage("会话日期索引已清除；下次按日期扫描时会重新核对。");
    } catch (error) {
      setMessageType("error");
      setMessage(getSafeErrorMessage(error, "无法清除会话日期索引。"));
    } finally {
      setDateIndexBusy(false);
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
    setAiConfigMessage("正在测试连接…");
    setAiConfigMessageType("info");

    try {
      const result = await testAiConnection(draft);
      setAiConfigMessageType("ok");
      setAiConfigMessage(result || "连接正常。");
    } catch (error) {
      setAiConfigMessageType("error");
      setAiConfigMessage(getSafeErrorMessage(error, "测试连接失败。"));
    } finally {
      testingRef.current = false;
      setTesting(false);
    }
  };

  const fetchModels = async () => {
    if (modelsLoading) return;
    setModelsLoading(true);
    setAiConfigMessage("正在获取模型列表…");
    setAiConfigMessageType("info");
    try {
      const models = await fetchAvailableAiModels(draft);
      setAvailableModels(models);
      setAiConfigMessageType("ok");
      setAiConfigMessage(`已获取 ${models.length} 个模型；可从列表选择，也可继续手动输入。`);
    } catch (error) {
      setAiConfigMessageType("error");
      setAiConfigMessage(getSafeErrorMessage(error, "获取模型列表失败。"));
    } finally {
      setModelsLoading(false);
    }
  };

  const changeThemeMode = (mode: AiSettings["themeMode"]) => {
    if (themeSavingRef.current || draft.themeMode === mode) return;
    themeSavingRef.current = true;
    setThemeSaving(true);
    const requestSeq = themeSaveSeqRef.current + 1;
    themeSaveSeqRef.current = requestSeq;
    setDraft({ ...draft, themeMode: mode });
    setMessage("");
    saveThemeMode(mode);

    if (hasNonThemeSettingsChanges(draft, settings)) {
      themeSavingRef.current = false;
      setThemeSaving(false);
      setMessageType("info");
      setMessage("外观已预览。当前页面还有未保存的 AI 配置，请点击“保存”后一起生效。");
      return;
    }

    void onSave({ ...settings, themeMode: mode })
      .then(() => {
        if (themeSaveSeqRef.current !== requestSeq) return;
        setMessageType("ok");
        setMessage("外观模式已保存。");
      })
      .catch((error) => {
        if (themeSaveSeqRef.current !== requestSeq) return;
        setDraft(settings);
        saveThemeMode(settings.themeMode);
        setMessageType("error");
        setMessage(getSafeErrorMessage(error, "外观模式保存失败。"));
      })
      .finally(() => {
        if (themeSaveSeqRef.current !== requestSeq) return;
        themeSavingRef.current = false;
        setThemeSaving(false);
      });
  };

  const finishClosingAiConfig = () => {
    setAiCloseConfirmOpen(false);
    setAiConfigOpen(false);
    window.setTimeout(() => aiConfigTriggerRef.current?.focus(), 0);
  };

  const openAiConfig = () => {
    setAiConfigMessage("");
    setAiConfigMessageType("info");
    setAiConfigOpen(true);
  };

  const requestCloseAiConfig = () => {
    if (saving || testing) return;
    if (aiDirty) {
      setAiCloseConfirmOpen(true);
      return;
    }
    finishClosingAiConfig();
  };

  const discardAiConfigChanges = () => {
    setDraft(settings);
    setAvailableModels([]);
    setMessageType("info");
    setMessage("已放弃未保存的 AI 配置修改。");
    finishClosingAiConfig();
  };

  return (
    <>
    <PageWorkspace
      eyebrow="Settings"
      title="设置"
      description="把外部能力收好，真正使用前再轻轻打开。"
      meta={getConnectionPresetLabel(draft)}
    >
      <div className="min-h-full px-5 pb-24 pt-5 lg:pb-5 xl:h-full xl:min-h-0 xl:overflow-hidden">
        <div className="mx-auto grid min-h-0 max-w-7xl gap-5 xl:h-full xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-0 pr-1 xl:min-h-0 xl:overflow-y-auto xl:scrollbar-thin">
        <div className="flex flex-col">
          <AppearanceStyleSettings
            mode={draft.themeMode}
            disabled={themeSaving || saving}
            onModeChange={changeThemeMode}
          />

          <section className="section-surface p-0">
            <div className="flex min-h-[76px] min-w-0 flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border border-line bg-panel text-ink/62" aria-hidden="true">
                  <Bot size={17} />
                </span>
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                    <h3 className="text-sm font-semibold text-ink">AI 连接</h3>
                    <span className="truncate text-sm text-ink/68">
                      {getConnectionPresetLabel(draft)} · {getConnectionProtocolLabel(draft)} · {draft.model.trim() || "未填写模型"}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-ink/46" title={credentialAddress ?? undefined}>
                    {getCredentialHost(credentialAddress)} · 凭据：{credentialStatusLabel}
                    {aiDirty ? " · 有未保存修改" : ""}
                  </p>
                </div>
              </div>
              <button
                ref={aiConfigTriggerRef}
                type="button"
                className="secondary-action action-standard shrink-0 gap-1.5 text-xs"
                disabled={themeSaving || saving}
                onClick={openAiConfig}
                aria-haspopup="dialog"
                aria-expanded={aiConfigOpen}
              >
                <Bot size={14} aria-hidden="true" />
                配置 AI
              </button>
            </div>
          </section>

          <section className="section-surface p-0">
            <div className="flex min-h-[88px] min-w-0 flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border border-line bg-panel text-ink/62" aria-hidden="true">
                  <Database size={17} />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-ink">会话日期索引</h3>
                  <p className="mt-1 text-xs leading-5 text-ink/46">
                    按日期扫描会在本地缓存时间戳和消息数量，不保存对话正文。空闲补全默认关闭。
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-ink/68">
                  <input
                    type="checkbox"
                    checked={dateIndexIdleEnabled}
                    disabled={!desktop || dateIndexBusy}
                    onChange={(event) => void changeDateIndexIdleCompletion(event.target.checked)}
                    className="control-checkbox"
                  />
                  空闲时补全
                </label>
                <button
                  type="button"
                  className="secondary-action action-standard text-xs"
                  disabled={!desktop || dateIndexBusy}
                  onClick={() => void clearDateIndex()}
                >
                  {dateIndexBusy ? <RefreshCw size={14} className="animate-spin" /> : <XCircle size={14} />}
                  清除索引
                </button>
              </div>
            </div>
          </section>

          {!aiConfigOpen && message && <SettingsMessage message={message} messageType={messageType} />}

          <div className="section-surface order-4 flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-copper">Quick Capture</p>
              <h3 className="mt-1 text-base font-semibold text-ink">顶部快速记录入口</h3>
              <p className="mt-1 text-sm leading-6 text-ink/52">
                触碰屏幕顶部后先显示薄入口，点击才展开记录窗。关闭后仍可使用 Ctrl+Shift+Space 或托盘入口。
              </p>
            </div>
            <label className="flex shrink-0 items-center gap-2 text-sm text-ink/70">
              <input
                type="checkbox"
                checked={quickCaptureTopEntryEnabled}
                disabled={!desktop || quickCaptureTopEntryBusy}
                onChange={(event) => void changeQuickCaptureTopEntry(event.target.checked)}
                className="control-checkbox"
              />
              {quickCaptureTopEntryEnabled ? "已开启" : "已关闭"}
            </label>
          </div>

          <div className="section-surface order-3 space-y-4 p-5">
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
                  className="secondary-action action-prominent text-xs"
                  disabled={Boolean(backupBusy)}
                  onClick={exportBackup}
                >
                  {backupBusy === "export" ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />}
                  {backupBusy === "export" ? "导出中" : "导出核心备份"}
                </button>
                <button
                  className="secondary-action action-prominent text-xs"
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
        </div>

        <div className="section-surface space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-copper">Automation</p>
              <h3 className="mt-1 text-base font-semibold text-ink">自动工作回顾</h3>
              <p className="mt-1 text-sm leading-6 text-ink/52">
                开启后会读取本机 Codex 与 Claude Code 今日新增对话正文，先本地脱敏，再发送给当前 AI 服务合并进今日工作内容。
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm text-ink/70">
              <input
                type="checkbox"
                checked={autoWorkReviewEnabled}
                onChange={(event) => void onSaveAutoWorkReviewSettings({ enabled: event.target.checked })}
                className="control-checkbox"
              />
              开启
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { source: "codex" as const, label: "Codex" },
              { source: "claude" as const, label: "Claude Code" },
            ].map(({ source, label }) => (
              <label key={source} className="flex items-center gap-2 rounded-[8px] border border-line bg-panel/70 px-3 py-2 text-sm text-ink/70">
                <input
                  type="checkbox"
                  checked={autoSourceKinds.includes(source)}
                  disabled={!autoWorkReviewEnabled || (autoSourceKinds.includes(source) && autoSourceKinds.length <= 1)}
                  onChange={() => void toggleAutoWorkReviewSource(source)}
                  className="control-checkbox"
                />
                {label}
              </label>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-line bg-panel/70 p-3">
            <div className="min-w-0 text-xs leading-5 text-ink/52">
              <div>{autoWorkReviewStatus}</div>
              <div>
                固定间隔：30 分钟
                {autoWorkReviewSettings?.lastRunAt ? ` · 上次运行：${autoWorkReviewSettings.lastRunAt}` : ""}
              </div>
            </div>
            <button
              className="soft-button action-standard shrink-0 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!autoWorkReviewEnabled || autoWorkReviewRunning}
              onClick={() => void onRunAutoWorkReview()}
            >
              {autoWorkReviewRunning ? <RefreshCw size={14} className="animate-spin" /> : <Bot size={14} />}
              {autoWorkReviewRunning ? "更新中" : "立即更新"}
            </button>
          </div>

          <p className="text-xs leading-5 text-ink/42">
            自动工作回顾默认关闭；不会自动写入长期记忆，也不会进入核心备份。关闭后不会继续读取对话正文或调用 AI。
          </p>
        </div>

        <AiConnectionConfigDialog
          open={aiConfigOpen}
          busy={saving || testing}
          onRequestClose={requestCloseAiConfig}
          footer={
            <>
              <button
                type="button"
                className="secondary-action action-standard min-w-[116px] text-xs"
                disabled={testing || saving || themeSaving}
                onClick={() => void testConnection()}
              >
                <Bot size={15} />
                {testing ? "测试中" : "测试连接"}
              </button>
              <button
                type="button"
                className="primary-action action-standard min-w-[132px] text-xs disabled:cursor-not-allowed disabled:opacity-55"
                disabled={saving || themeSaving || !aiDirty}
                onClick={() => void saveSettings({ closeOnSuccess: true })}
              >
                {saving ? <RefreshCw size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                {saving ? "保存中" : "保存并关闭"}
              </button>
            </>
          }
        >
          <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-xs font-medium text-ink/58">
              连接预设
              <div className="mt-1" data-ai-config-start>
                <SelectMenu
                  value={draft.provider}
                  options={[
                    { value: "deepseek", label: "DeepSeek（预设）" },
                    { value: "openai-compatible", label: "OpenAI 协议兼容" },
                    { value: "anthropic-messages", label: "Anthropic Messages" },
                  ]}
                  onChange={(value) => {
                    const provider = value as AiSettings["provider"];
                    const providerChanged = provider !== draft.provider;
                    const providerDefaults = provider === "deepseek"
                      ? { baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash" }
                      : provider === "anthropic-messages"
                        ? { baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-6" }
                        : { baseUrl: "https://api.openai.com/v1", model: "" };
                    setDraft({
                      ...draft,
                      provider,
                      protocol: provider === "anthropic-messages"
                        ? "anthropic-messages"
                        : "openai-chat-completions",
                      reasoningEffort: providerChanged ? "default" : draft.reasoningEffort ?? "default",
                      supportsVision: provider === "deepseek" ? false : draft.supportsVision,
                      useEnvKey: provider === "deepseek" ? draft.useEnvKey : false,
                      baseUrl: providerChanged ? providerDefaults.baseUrl : draft.baseUrl,
                      model: providerChanged ? providerDefaults.model : draft.model,
                      anthropicAuthMode: provider === "anthropic-messages" ? draft.anthropicAuthMode ?? "x-api-key" : "x-api-key",
                      manualApiKey: providerChanged ? "" : draft.manualApiKey,
                      manualKeyStored: providerChanged ? false : draft.manualKeyStored,
                      manualKeyClearRequested: false,
                    });
                    if (providerChanged) {
                      setMessageType("info");
                      setMessage("已切换连接预设，正在检查当前地址对应的凭据；其他连接的 Key 不会被删除。");
                    }
                  }}
                />
              </div>
            </label>

            <label className="text-xs font-medium text-ink/58">
              模型
              <div className="mt-1 flex gap-2">
                <div className="min-w-0 flex-1">
                  {draft.provider === "openai-compatible" && availableModels.length > 0 ? (
                    <SelectMenu
                      value={draft.model}
                      options={availableModels.map((model) => ({ value: model.id, label: model.id }))}
                      searchable
                      onChange={(model) => setDraft({ ...draft, model })}
                      renderTrigger={({ open, menuId, activeOptionId, buttonRef, toggle }) => (
                        <div className="relative">
                          <input
                            value={draft.model}
                            onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                            className="field-control field-prominent w-full pr-10"
                            aria-autocomplete="list"
                            aria-controls={open ? menuId : undefined}
                            aria-activedescendant={activeOptionId}
                          />
                          <button
                            ref={buttonRef}
                            type="button"
                            className="absolute inset-y-1 right-1 flex w-8 items-center justify-center rounded-[6px] text-ink/50 transition hover:bg-accent/10 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                            aria-label="选择已获取模型"
                            aria-haspopup="listbox"
                            aria-expanded={open}
                            aria-controls={open ? menuId : undefined}
                            onClick={toggle}
                          >
                            <ChevronDown size={15} className={`transition ${open ? "rotate-180" : ""}`} />
                          </button>
                        </div>
                      )}
                    />
                  ) : (
                    <input
                      value={draft.model}
                      onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                      className="field-control field-prominent w-full"
                    />
                  )}
                </div>
                {draft.provider === "openai-compatible" && (
                  <button
                    type="button"
                    className="secondary-action action-prominent shrink-0 text-xs"
                    disabled={modelsLoading || !draft.baseUrl.trim()}
                    onClick={() => void fetchModels()}
                  >
                    <RefreshCw size={14} className={modelsLoading ? "animate-spin" : ""} />
                    {modelsLoading ? "获取中" : "获取模型"}
                  </button>
                )}
              </div>
            </label>
          </div>

          {draft.provider === "openai-compatible" && (
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-xs font-medium text-ink/58">
                接口协议
                <div className="mt-1">
                  <SelectMenu
                    value={draft.protocol === "openai-responses" ? "openai-responses" : "openai-chat-completions"}
                    options={[
                      { value: "openai-chat-completions", label: "Chat Completions" },
                      { value: "openai-responses", label: "Responses" },
                    ]}
                    onChange={(protocol) => setDraft({
                      ...draft,
                      protocol: protocol === "openai-responses" ? "openai-responses" : "openai-chat-completions",
                    })}
                  />
                </div>
              </label>
              <label className="text-xs font-medium text-ink/58">
                推理强度
                <div className="mt-1">
                  <SelectMenu
                    value={draft.reasoningEffort ?? "default"}
                    options={reasoningEfforts}
                    disabled={draft.protocol !== "openai-responses"}
                    onChange={(reasoningEffort) => setDraft({
                      ...draft,
                      reasoningEffort: reasoningEffort as AiReasoningEffort,
                    })}
                  />
                </div>
              </label>
            </div>
          )}

          {draft.provider === "openai-compatible" && (
            <label className="block text-xs font-medium text-ink/58">
              自定义名称
              <input
                value={draft.customProviderName ?? ""}
                onChange={(event) => setDraft({ ...draft, customProviderName: event.target.value })}
                placeholder="例如 OpenAI、硅基流动、OpenRouter"
                className="field-control field-prominent mt-1 w-full"
              />
            </label>
          )}

          {draft.provider === "anthropic-messages" && (
            <label className="block text-xs font-medium text-ink/58">
              鉴权方式
              <div className="mt-1">
                <SelectMenu
                  value={draft.anthropicAuthMode ?? "x-api-key"}
                  options={[
                    { value: "x-api-key", label: "x-api-key（Anthropic 官方默认）" },
                    { value: "bearer", label: "Authorization: Bearer（兼容网关）" },
                  ]}
                  onChange={(value) => setDraft({
                    ...draft,
                    anthropicAuthMode: value === "bearer" ? "bearer" : "x-api-key",
                  })}
                />
              </div>
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
              className="field-control field-prominent mt-1 w-full"
            />
          </label>

          <div className="rounded-[8px] border border-moss/30 bg-moss/10 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-moss">
              <KeyRound size={16} />
              当前连接凭据
            </div>
            <div className="my-3 flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-[7px] border border-line/80 bg-surface/65 px-3 py-2 text-xs">
              <span className="min-w-0 truncate text-ink/56" title={credentialAddress ?? undefined}>
                当前地址凭据：{credentialAddress ?? "等待有效地址"}
              </span>
              <span className={`shrink-0 ${credentialStatusLabel === "读取失败" ? "text-red-400" : "text-ink/76"}`}>
                {credentialStatusLabel}
              </span>
            </div>
            {draft.provider === "deepseek" && (
              <label className="mb-3 flex items-center gap-2 text-sm text-ink/70">
                <input
                  type="checkbox"
                  checked={draft.useEnvKey}
                  onChange={(event) => setDraft({ ...draft, useEnvKey: event.target.checked })}
                  className="control-checkbox"
                />
                优先使用环境变量 VITE_DEEPSEEK_API_KEY
              </label>
            )}
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
                      ? "当前地址已有系统凭据；输入新 Key 会覆盖"
                      : "填写当前地址的 API Key；保存后进入系统凭据"
                    : "填写 API Key；Web 模式保存在本机应用数据中"
                }
                className="field-control field-prominent min-w-0 flex-1"
              />
              <button
                className="soft-button action-prominent shrink-0 text-xs"
                disabled={!draft.manualApiKey && !draft.manualKeyStored}
                onClick={() => {
                  if (draft.manualApiKey?.trim()) {
                    setDraft({ ...draft, manualApiKey: "", manualKeyClearRequested: false });
                    setMessage("待保存的 API Key 已从当前连接草稿中清除。");
                  } else {
                    setDraft({
                      ...draft,
                      manualApiKey: "",
                      manualKeyStored: false,
                      manualKeyClearRequested: true,
                    });
                    setMessage("当前地址的系统凭据已标记删除，保存后生效；其他地址的 Key 不受影响。");
                  }
                  setMessageType("info");
                }}
              >
                <X size={14} />
                清除
              </button>
            </div>
            <p className="mt-3 text-xs leading-5 text-ink/52">
              {draft.provider === "deepseek"
                ? envKeyAvailable
                  ? "已检测到 DeepSeek 环境变量 Key；启用后调用时优先使用它。"
                  : "未检测到 DeepSeek 环境变量 Key，可改用当前地址的手动 Key。"
                : "当前连接不会读取 DeepSeek 环境变量。"}
              {" "}桌面端手动 Key 按“连接预设 + Base URL”保存到系统凭据；同一 OpenAI 地址的 Chat Completions 与 Responses 共享 Key，不同地址及 Anthropic 相互隔离。真实 Key 不会回显。
            </p>
          </div>

          {draft.provider !== "deepseek" && (
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
                {draft.provider === "anthropic-messages"
                  ? "请求使用 Anthropic Messages 格式：根地址后自动拼接 /v1/messages，API 版本固定为 2023-06-01。图片只在你点击资料 AI 操作时读取并发送。"
                  : draft.protocol === "openai-responses"
                    ? "请求使用 OpenAI Responses 格式：根地址后自动拼接 /responses，固定发送 store:false；推理强度默认跟随模型。"
                    : "请求使用 OpenAI Chat Completions 兼容格式：Base URL 后自动拼接 /chat/completions。图片只在你点击资料 AI 操作时读取并发送。"}
                {!desktop && " Web 开发模式可能受到服务端 CORS 策略限制。"}
              </p>
            </div>
          )}

          <AiConnectionStatusSlot
            summary={`当前连接：${getConnectionPresetLabel(draft)} · ${getConnectionProtocolLabel(draft)} · 模型：${draft.model.trim() || "未填写"} · 凭据：${credentialStatusLabel}`}
            dirty={aiDirty}
            message={aiConfigMessage}
            messageType={aiConfigMessageType}
          />

          <p className="text-xs leading-5 text-ink/42">
            “测试连接”只发送最小连接请求，用于确认模型可访问；不会发送资料库、日志或记忆正文。
          </p>
        </div>
        </AiConnectionConfigDialog>
          </div>
          <aside className="space-y-0 pr-1 xl:min-h-0 xl:overflow-y-auto xl:scrollbar-thin">
            <UsageHelp
              demoLibraryState={demoLibraryState}
              onInstallDemoLibrary={onInstallDemoLibrary}
              onOpenOnboarding={onOpenOnboarding}
              onRemoveDemoLibrary={onRemoveDemoLibrary}
            />
            <BuildInfo />
            <CodexProbePanel />
          </aside>
        </div>
      </div>
    </PageWorkspace>
    <ConfirmDialog
      open={aiCloseConfirmOpen}
      title="AI 配置尚未保存"
      message="关闭后可以保留当前草稿，或放弃这些未保存的连接与凭据修改。"
      cancelLabel="继续编辑"
      secondaryLabel="保留草稿后关闭"
      confirmLabel="放弃修改并关闭"
      danger
      onCancel={() => setAiCloseConfirmOpen(false)}
      onSecondary={finishClosingAiConfig}
      onConfirm={discardAiConfigChanges}
    />
    </>
  );
});

function SettingsMessage({
  message,
  messageType,
}: {
  message: string;
  messageType: "ok" | "error" | "info";
}) {
  return (
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
  );
}

function AiConnectionStatusSlot({
  summary,
  dirty,
  message,
  messageType,
}: {
  summary: string;
  dirty: boolean;
  message: string;
  messageType: "ok" | "error" | "info";
}) {
  const statusClassName = messageType === "ok"
    ? "text-ink/72"
    : messageType === "error"
      ? "text-red-400"
      : "text-ink/48";
  const StatusIcon = messageType === "ok" ? CheckCircle2 : messageType === "error" ? XCircle : ShieldCheck;

  return (
    <div className="h-[60px] overflow-hidden">
      <p className="truncate text-xs text-ink/45" title={summary}>
        {summary}
        {dirty && <span className="text-copper/80"> · 有未保存修改</span>}
      </p>
      <div
        role={messageType === "error" ? "alert" : "status"}
        aria-live={messageType === "error" ? "assertive" : "polite"}
        className={`mt-1 flex h-8 items-start gap-1.5 overflow-y-auto pr-1 text-xs leading-4 scrollbar-thin ${statusClassName}`}
      >
        {message && <>
          <StatusIcon size={14} className="mt-px shrink-0" aria-hidden="true" />
          <span className="min-w-0 text-anywhere">{message}</span>
        </>}
      </div>
    </div>
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

function UsageHelp({
  demoLibraryState,
  onInstallDemoLibrary,
  onOpenOnboarding,
  onRemoveDemoLibrary,
}: {
  demoLibraryState: DemoLibraryState;
  onInstallDemoLibrary: () => Promise<void>;
  onOpenOnboarding: () => void;
  onRemoveDemoLibrary: () => void;
}) {
  const [demoBusy, setDemoBusy] = useState(false);
  const install = async () => {
    setDemoBusy(true);
    try {
      await onInstallDemoLibrary();
    } finally {
      setDemoBusy(false);
    }
  };
  return (
    <section className="section-surface space-y-3 p-5">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-copper">Help</p>
        <h3 className="mt-1 text-base font-semibold text-ink">使用帮助</h3>
        <p className="mt-1 text-sm leading-6 text-ink/52">需要时，可以重新查看 Daymark 的用途和基本工作流。</p>
      </div>
      <button className="secondary-action action-standard text-xs" onClick={onOpenOnboarding}>
        <CircleHelp size={15} />
        重新查看使用引导
      </button>
      <div className="border-t border-line pt-5">
        <p className="text-xs leading-5 text-ink/48">
          示例资料：{demoLibraryState.installed ? `${demoLibraryState.itemCount} 条资料` : "未安装"}
        </p>
        <button
          className="secondary-action action-standard mt-2 text-xs"
          disabled={demoBusy}
          onClick={demoLibraryState.installed ? onRemoveDemoLibrary : () => void install()}
        >
          <Library size={15} />
          {demoBusy ? "正在安装…" : demoLibraryState.installed ? "删除示例资料" : "安装示例资料"}
        </button>
      </div>
    </section>
  );
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
      setMessage(`已检查本机来源，找到 ${found} 个可访问来源。`);
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "检查失败，请稍后再试。"));
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
          <h3 className="mt-1 text-base font-semibold text-ink">检查本机来源</h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-ink/52">
            先看看本机是否有可用的 Codex 与 Claude Code 对话痕迹。本轮只看路径、大小和修改时间，不读取正文，不上传内容，也不写入记忆。
          </p>
        </div>
        <button
          className="secondary-action action-prominent"
          disabled={!desktop || probing}
          onClick={runProbe}
        >
          {probing ? <RefreshCw size={16} className="animate-spin" /> : <FolderSearch size={16} />}
          {probing ? "检查中" : "检查本机来源"}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <CodexPrinciple icon={ShieldCheck} title="只读" text="不修改 Codex 或 Claude Code 文件，也不移动任何记录。" />
        <CodexPrinciple icon={HardDrive} title="本机" text="检查在本机桌面端完成，Web 模式不启用。" />
        <CodexPrinciple icon={Database} title="不调用 AI" text="只检查来源信息，不读取正文或生成内容。" />
      </div>

      {!desktop && (
        <div className="rounded-[8px] border border-line bg-panel px-3 py-2 text-sm leading-6 text-ink/70">
          本机来源检查需要桌面端运行。浏览器模式下不会读取本机路径。
        </div>
      )}

      {message && (
        <div className="rounded-[8px] border border-line bg-panel px-3 py-2 text-anywhere text-sm leading-6 text-ink/62">
          {message}
        </div>
      )}

      {probes.length > 0 && (
        <ScrollableResultPanel
          title="检查结果"
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
        回顾流程由你手动开始；长期记忆建议需要确认后才会写入文档。
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
