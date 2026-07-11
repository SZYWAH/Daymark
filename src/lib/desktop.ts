import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  CodexReviewInput,
  CodexSessionDay,
  CodexSessionIndex,
  CodexSessionIndexOptions,
  CodexSessionMeta,
  CodexSourceProbe,
  ConversationReviewInput,
  ConversationSessionDelta,
  ConversationSessionDeltaCursorInput,
  ConversationSessionDay,
  ConversationSessionIndex,
  ConversationSessionIndexOptions,
  ConversationSessionMeta,
  ConversationSourceKind,
  ConversationSourceProbe,
  FileTextExtractResult,
  ImageDataExtractResult,
} from "../types";

export type PathStatus = {
  exists: boolean;
  kind?: "file" | "directory";
  message?: string;
};

export function isDesktopRuntime() {
  return isTauri();
}

export async function openExternalUrl(url: string) {
  const value = url.trim();
  if (!value) return;

  if (isDesktopRuntime()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(value);
    return;
  }

  window.open(value, "_blank", "noopener,noreferrer");
}

export async function openLocalPath(path: string) {
  const value = path.trim();
  if (!value) return;

  if (isDesktopRuntime()) {
    const { openPath } = await import("@tauri-apps/plugin-opener");
    await openPath(value);
    return;
  }

  await copyToClipboard(value);
  throw new Error("浏览器模式无法直接打开本地文件，已复制路径；桌面端可直接打开。");
}

export async function revealLocalPath(path: string) {
  const value = path.trim();
  if (!value) return;

  if (isDesktopRuntime()) {
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    await revealItemInDir(value);
    return;
  }

  await copyToClipboard(value);
  throw new Error("浏览器模式无法打开所在文件夹，已复制路径；桌面端可直接定位。");
}

export async function pickLocalFiles() {
  if (!isDesktopRuntime()) return [];

  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    multiple: true,
    directory: false,
    title: "选择资料文件",
  });

  if (!selected) return [];
  return Array.isArray(selected) ? selected : [selected];
}

export async function pickLocalFolder() {
  if (!isDesktopRuntime()) return undefined;

  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    directory: true,
    multiple: false,
    title: "选择资料文件夹",
  });

  return Array.isArray(selected) ? selected[0] : selected ?? undefined;
}

export async function saveTextFileWithDialog(options: {
  title: string;
  defaultPath: string;
  contents: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}) {
  if (!isDesktopRuntime()) return undefined;

  const { save } = await import("@tauri-apps/plugin-dialog");
  const selected = await save({
    title: options.title,
    defaultPath: options.defaultPath,
    filters: options.filters,
  });
  if (!selected) return undefined;

  await invoke("write_text_file", { path: selected, contents: options.contents });
  return selected;
}

export async function readTextFileWithDialog(options: {
  title: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}) {
  if (!isDesktopRuntime()) return undefined;

  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    title: options.title,
    multiple: false,
    directory: false,
    filters: options.filters,
  });
  const path = Array.isArray(selected) ? selected[0] : selected;
  if (!path) return undefined;

  const contents = await invoke<string>("read_text_file", { path });
  return { path, contents };
}

export async function checkLocalPath(path: string): Promise<PathStatus> {
  const value = path.trim();
  if (!value) return { exists: false, message: "路径为空" };

  if (!isDesktopRuntime()) {
    return { exists: false, message: "浏览器模式无法检查本地路径，桌面端可检查。" };
  }

  return invoke<PathStatus>("check_local_path", { path: value });
}

export async function getSupportedFileAnalysisTypes(): Promise<string[]> {
  if (!isDesktopRuntime()) return [];

  return invoke<string[]>("get_supported_file_analysis_types");
}

export async function extractLocalFileText(path: string): Promise<FileTextExtractResult> {
  const value = path.trim();
  if (!value) {
    throw new Error("文件路径为空。");
  }
  if (!isDesktopRuntime()) {
    throw new Error("读取本地文件正文需要在桌面端使用。");
  }

  return invoke<FileTextExtractResult>("extract_local_file_text", { path: value });
}

export async function getSupportedVisionTypes(): Promise<string[]> {
  if (!isDesktopRuntime()) return [];

  return invoke<string[]>("get_supported_vision_types");
}

export async function extractLocalImageData(path: string): Promise<ImageDataExtractResult> {
  const value = path.trim();
  if (!value) {
    throw new Error("图片路径为空。");
  }
  if (!isDesktopRuntime()) {
    throw new Error("读取本地图片需要在桌面端使用。");
  }

  return invoke<ImageDataExtractResult>("extract_local_image_data", { path: value });
}

export async function probeCodexSources(): Promise<CodexSourceProbe[]> {
  if (!isDesktopRuntime()) return [];

  return invoke<CodexSourceProbe[]>("probe_codex_sources");
}

export async function probeConversationSources(): Promise<ConversationSourceProbe[]> {
  if (!isDesktopRuntime()) return [];

  return invoke<ConversationSourceProbe[]>("probe_conversation_sources");
}

export async function listCodexSessionDays(): Promise<CodexSessionDay[]> {
  if (!isDesktopRuntime()) return [];

  return invoke<CodexSessionDay[]>("list_codex_session_days");
}

export async function listConversationSessionDays(sourceKinds?: ConversationSourceKind[]): Promise<ConversationSessionDay[]> {
  if (!isDesktopRuntime()) return [];

  return invoke<ConversationSessionDay[]>("list_conversation_session_days", { sourceKinds });
}

export async function listCodexSessionsByDate(date: string): Promise<CodexSessionMeta[]> {
  if (!isDesktopRuntime()) return [];

  return invoke<CodexSessionMeta[]>("list_codex_sessions_by_date", { date });
}

export async function listConversationSessionsByDate(
  date: string,
  sourceKinds?: ConversationSourceKind[],
): Promise<ConversationSessionMeta[]> {
  if (!isDesktopRuntime()) return [];

  return invoke<ConversationSessionMeta[]>("list_conversation_sessions_by_date", { date, sourceKinds });
}

export async function indexCodexSessions(options: CodexSessionIndexOptions): Promise<CodexSessionIndex[]> {
  if (!isDesktopRuntime()) return [];

  return invoke<CodexSessionIndex[]>("index_codex_sessions", { options });
}

export async function indexConversationSessions(
  options: ConversationSessionIndexOptions,
): Promise<ConversationSessionIndex[]> {
  if (!isDesktopRuntime()) return [];

  return invoke<ConversationSessionIndex[]>("index_conversation_sessions", { options });
}

export async function readSelectedCodexSessions(sessionIds: string[], jobId?: string): Promise<CodexReviewInput> {
  if (!isDesktopRuntime()) {
    throw new Error("Codex 回顾需要在桌面端使用。");
  }

  return invoke<CodexReviewInput>("read_selected_codex_sessions", { sessionIds, jobId });
}

export async function readSelectedConversationSessions(
  sessionIds: string[],
  jobId?: string,
): Promise<ConversationReviewInput> {
  if (!isDesktopRuntime()) {
    throw new Error("AI 对话回顾需要在桌面端使用。");
  }

  return invoke<ConversationReviewInput>("read_selected_conversation_sessions", { sessionIds, jobId });
}

export async function readConversationSessionDeltas(
  sessionIds: string[],
  cursors: ConversationSessionDeltaCursorInput[],
  jobId?: string,
): Promise<ConversationSessionDelta[]> {
  if (!isDesktopRuntime()) {
    throw new Error("自动工作回顾需要在桌面端使用。");
  }

  return invoke<ConversationSessionDelta[]>("read_conversation_session_deltas", { sessionIds, cursors, jobId });
}

export async function cancelCodexReviewJob(jobId: string) {
  if (!isDesktopRuntime()) return;

  await invoke("cancel_codex_review_job", { jobId });
}

export async function cancelConversationReviewJob(jobId: string) {
  if (!isDesktopRuntime()) return;

  await invoke("cancel_conversation_review_job", { jobId });
}

export async function expandQuickCapture() {
  if (!isDesktopRuntime()) return;

  await invoke("expand_quick_capture");
}

export async function collapseQuickCapture() {
  if (!isDesktopRuntime()) return false;

  return invoke<boolean>("collapse_quick_capture").catch(() => false);
}

export async function showMainWindow() {
  if (!isDesktopRuntime()) return;

  await invoke("show_main_window");
}

export async function notifyMainWindowFrontendReady() {
  if (!isDesktopRuntime()) return;

  await invoke("main_window_frontend_ready");
}

export async function openMainFromQuickCapture() {
  if (!isDesktopRuntime()) return;

  await invoke("open_main_from_quick_capture");
}

export async function showQuickCapture() {
  if (!isDesktopRuntime()) return;

  await invoke("show_quick_capture");
}

export async function showQuickCaptureHotzone() {
  if (!isDesktopRuntime()) return;

  await invoke("show_quick_capture_hotzone");
}

export async function showQuickCapturePanel(hotzoneToken?: number, trigger?: "hover" | "click" | "explicit") {
  if (!isDesktopRuntime()) return false;

  return invoke<boolean>("show_quick_capture_panel", { hotzoneToken, trigger })
    .catch(() => false);
}

export async function hideQuickCapturePanel(token?: number) {
  if (!isDesktopRuntime()) return false;

  const effectiveToken = token || await getQuickCapturePanelToken().catch(() => 0);
  return invoke<boolean>("hide_quick_capture_panel", { token: effectiveToken || undefined }).catch(() => false);
}

export async function returnQuickCaptureToHotzone(token?: number) {
  if (!isDesktopRuntime()) return false;

  const effectiveToken = token || await getQuickCapturePanelToken().catch(() => 0);
  return invoke<boolean>("return_quick_capture_to_hotzone", { token: effectiveToken || undefined }).catch(() => false);
}

export async function quickCaptureWindowReady(label: string, token?: number) {
  if (!isDesktopRuntime()) return;

  await invoke("quick_capture_window_ready", { label, token });
}

export async function getQuickCapturePanelToken() {
  if (!isDesktopRuntime()) return 0;

  return invoke<number>("get_quick_capture_panel_token");
}

export type QuickCaptureRuntimeState = {
  state: "MainVisible" | "HotzoneVisible" | "PanelOpen" | "PanelDetached" | "Paused" | "Degraded";
  anchor: "left" | "center" | "right";
  panelToken: number;
  hotzoneToken: number;
  paused: boolean;
  degraded: boolean;
  degradedReason?: string | null;
  shortcutAvailable: boolean;
  shortcutError?: string | null;
  escapeAvailable?: boolean;
  escapeError?: string | null;
};

export type QuickCaptureDragResult = {
  applied: boolean;
  stillDragging: boolean;
  detached: boolean;
  anchor: "left" | "center" | "right";
  pointerOutside: boolean;
};

export async function getQuickCaptureRuntimeState() {
  if (!isDesktopRuntime()) return null;

  return invoke<QuickCaptureRuntimeState>("get_quick_capture_runtime_state");
}

export async function finalizeQuickCaptureDrag(token?: number) {
  if (!isDesktopRuntime()) return null;

  return invoke<QuickCaptureDragResult>("finalize_quick_capture_drag", { token });
}

export async function collapseQuickCaptureIfPointerOutside(token?: number) {
  if (!isDesktopRuntime()) return false;

  return invoke<boolean>("collapse_quick_capture_if_pointer_outside", { token }).catch(() => false);
}

export async function setQuickCaptureSaving(saving: boolean, token?: number) {
  if (!isDesktopRuntime()) return;

  await invoke("set_quick_capture_saving", { saving, token });
}

export async function notifyQuickCaptureSaved(token?: number) {
  if (!isDesktopRuntime()) return false;

  return invoke<boolean>("notify_quick_capture_saved", { token });
}

export async function hideMainToTray() {
  if (!isDesktopRuntime()) return;

  await invoke("hide_main_to_tray");
}

async function copyToClipboard(value: string) {
  await navigator.clipboard?.writeText(value).catch(() => undefined);
}
