use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex, OnceLock,
};
use std::thread;
use std::time::{Duration, Instant, UNIX_EPOCH};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{
    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::{LPARAM, LRESULT, POINT, WPARAM},
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        Input::KeyboardAndMouse::{GetAsyncKeyState, VK_ESCAPE},
        WindowsAndMessaging::{
            CallNextHookEx, DispatchMessageW, GetCursorPos, GetMessageW, KBDLLHOOKSTRUCT, MSG,
            SetWindowsHookExW, TranslateMessage, WH_KEYBOARD_LL, WM_KEYDOWN, WM_SYSKEYDOWN,
        },
    },
};

const CONVERSATION_REVIEW_CHUNK_CHARS: usize = 14_000;
const CONVERSATION_REVIEW_MAX_TOTAL_CHARS: usize = 900_000;
const CONVERSATION_REVIEW_MAX_SESSION_RAW_BYTES: usize = 8_000_000;
const FILE_TEXT_MAX_CHARS: usize = 180_000;
const FILE_TEXT_MAX_BYTES: u64 = 40_000_000;
const FILE_TEXT_MAX_OFFICE_XML_BYTES: u64 = 12_000_000;
const IMAGE_DATA_MAX_BYTES: u64 = 20_000_000;
const DAYMARK_TEXT_FILE_MAX_BYTES: u64 = 50_000_000;
const AI_API_KEY_SERVICE: &str = "daymark.ai-api-key.v1";
const QUICK_CAPTURE_HOTZONE_LABEL: &str = "quick-capture-hotzone";
const QUICK_CAPTURE_PANEL_LABEL: &str = "quick-capture-panel";
const QUICK_CAPTURE_HOT_WIDTH: u32 = 560;
const QUICK_CAPTURE_HOT_HEIGHT: u32 = 10;
const QUICK_CAPTURE_PANEL_WIDTH: u32 = 760;
const QUICK_CAPTURE_PANEL_HEIGHT: u32 = 260;
const QUICK_CAPTURE_READY_TIMEOUT_MS: u64 = 1_500;
const QUICK_CAPTURE_MAX_OPEN_FAILURES: u8 = 2;
const HOTZONE_HOVER_DELAY_MS: u64 = 240;
const QUICK_CAPTURE_HOTZONE_POLL_INTERVAL_MS: u64 = 80;
const QUICK_CAPTURE_ESCAPE_FALLBACK_MS: u64 = 620;
const QUICK_CAPTURE_HOTZONE_REOPEN_COOLDOWN_MS: u64 = 900;

static CANCELLED_CODEX_JOBS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static QUICK_CAPTURE_PAUSED: OnceLock<Mutex<bool>> = OnceLock::new();
static QUICK_CAPTURE_MONITOR: OnceLock<Mutex<Option<QuickCaptureMonitor>>> = OnceLock::new();
static QUICK_CAPTURE_STATE: OnceLock<Mutex<QuickCaptureState>> = OnceLock::new();
static QUICK_CAPTURE_READY_WINDOWS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static QUICK_CAPTURE_PANEL_FAILURES: OnceLock<Mutex<u8>> = OnceLock::new();
static QUICK_CAPTURE_HOTZONE_FAILURES: OnceLock<Mutex<u8>> = OnceLock::new();
static QUICK_CAPTURE_DEGRADED_NOTICE_SENT: OnceLock<Mutex<bool>> = OnceLock::new();
static QUICK_CAPTURE_DEGRADED: OnceLock<Mutex<bool>> = OnceLock::new();
static QUICK_CAPTURE_DEGRADED_REASON: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static QUICK_CAPTURE_PANEL_OPEN_TOKEN: OnceLock<Mutex<u64>> = OnceLock::new();
static QUICK_CAPTURE_PANEL_READY_TOKEN: OnceLock<Mutex<u64>> = OnceLock::new();
static QUICK_CAPTURE_PANEL_SAVING_TOKEN: OnceLock<Mutex<Option<u64>>> = OnceLock::new();
static QUICK_CAPTURE_HOTZONE_OPEN_TOKEN: OnceLock<Mutex<u64>> = OnceLock::new();
static QUICK_CAPTURE_HOTZONE_READY_TOKEN: OnceLock<Mutex<u64>> = OnceLock::new();
static QUICK_CAPTURE_HOTZONE_WATCHING: OnceLock<Mutex<Option<u64>>> = OnceLock::new();
static QUICK_CAPTURE_HOTZONE_SUPPRESSED_UNTIL: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();
static QUICK_CAPTURE_PANEL_OPENING: OnceLock<Mutex<bool>> = OnceLock::new();
static QUICK_CAPTURE_PANEL_RECOVERING: OnceLock<Mutex<bool>> = OnceLock::new();
static QUICK_CAPTURE_PANEL_RECOVERING_SINCE: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();
static QUICK_CAPTURE_SHORTCUT_ERROR: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static QUICK_CAPTURE_DESTROY_RECONCILE_SUPPRESSIONS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static QUICK_CAPTURE_ESCAPE_REGISTERED: OnceLock<Mutex<bool>> = OnceLock::new();
static QUICK_CAPTURE_ESCAPE_ERROR: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static QUICK_CAPTURE_PANEL_SOFT_RETRIES: OnceLock<Mutex<BTreeMap<u64, u8>>> = OnceLock::new();
static QUICK_CAPTURE_HOTZONE_SOFT_RETRIES: OnceLock<Mutex<BTreeMap<u64, u8>>> = OnceLock::new();
static QUICK_CAPTURE_LIFECYCLE_SYNC_PENDING: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static QUICK_CAPTURE_ESCAPE_HOOK_STARTED: OnceLock<()> = OnceLock::new();
#[cfg(target_os = "windows")]
static QUICK_CAPTURE_ESCAPE_POLL_STARTED: OnceLock<()> = OnceLock::new();
#[cfg(target_os = "windows")]
static QUICK_CAPTURE_ESCAPE_HOOK_ARMED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static QUICK_CAPTURE_ESCAPE_HOOK_REQUESTED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum QuickCaptureState {
    MainVisible,
    HotzoneVisible,
    PanelOpen,
    PanelDetached,
    Paused,
    Degraded,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QuickCaptureRuntimeState {
    state: &'static str,
    panel_token: u64,
    hotzone_token: u64,
    paused: bool,
    degraded: bool,
    degraded_reason: Option<String>,
    shortcut_available: bool,
    shortcut_error: Option<String>,
    escape_available: bool,
    escape_error: Option<String>,
}

struct QuickCapturePanelOpenGuard;

impl Drop for QuickCapturePanelOpenGuard {
    fn drop(&mut self) {
        *panel_opening_store()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = false;
    }
}

impl QuickCaptureState {
    fn as_str(self) -> &'static str {
        match self {
            QuickCaptureState::MainVisible => "MainVisible",
            QuickCaptureState::HotzoneVisible => "HotzoneVisible",
            QuickCaptureState::PanelOpen => "PanelOpen",
            QuickCaptureState::PanelDetached => "PanelDetached",
            QuickCaptureState::Paused => "Paused",
            QuickCaptureState::Degraded => "Degraded",
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PathStatus {
    exists: bool,
    kind: Option<&'static str>,
    message: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileTextExtractResult {
    path: String,
    file_name: String,
    extension: String,
    size_bytes: u64,
    text: String,
    extracted_chars: usize,
    sent_chars: usize,
    char_count: usize,
    truncated: bool,
    redacted: bool,
    quality: String,
    preview: String,
    warnings: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageDataExtractResult {
    path: String,
    file_name: String,
    extension: String,
    mime_type: String,
    size_bytes: u64,
    data_url: String,
    warnings: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexSourceProbe {
    id: String,
    source_kind: &'static str,
    label: String,
    path: String,
    exists: bool,
    size_bytes: Option<u64>,
    modified_at: Option<u64>,
    probe_kind: &'static str,
    message: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CodexSessionDay {
    source_kind: String,
    date: String,
    session_count: usize,
    total_size_bytes: u64,
    latest_modified_at: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CodexSessionMeta {
    id: String,
    source_kind: String,
    source_label: String,
    date: String,
    path: String,
    size_bytes: u64,
    modified_at: u64,
    cwd: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexSessionIndexOptions {
    source_kinds: Option<Vec<String>>,
    date_from: Option<String>,
    date_to: Option<String>,
    cwd_query: Option<String>,
    keyword: Option<String>,
    limit: Option<usize>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CodexSessionIndex {
    id: String,
    source_kind: String,
    source_label: String,
    date: String,
    path: String,
    size_bytes: u64,
    modified_at: u64,
    cwd: Option<String>,
    title: String,
    preview: String,
    message_count: usize,
    user_message_count: usize,
    assistant_message_count: usize,
    char_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexReviewInput {
    date: String,
    source_kinds: Vec<String>,
    review_kind: String,
    sessions: Vec<CodexSessionMeta>,
    transcript_chunks: Vec<String>,
    total_chars: usize,
    redacted: bool,
    truncated: bool,
}

fn ensure_main_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("该操作只能在主窗口中执行".into())
    }
}

fn ensure_quick_capture_panel_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == QUICK_CAPTURE_PANEL_LABEL {
        Ok(())
    } else {
        Err("This quick capture action must run from the panel window.".into())
    }
}

fn ensure_quick_capture_hotzone_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == QUICK_CAPTURE_HOTZONE_LABEL {
        Ok(())
    } else {
        Err("This quick capture action must run from the hotzone window.".into())
    }
}

fn ensure_quick_capture_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == QUICK_CAPTURE_PANEL_LABEL || window.label() == QUICK_CAPTURE_HOTZONE_LABEL {
        Ok(())
    } else {
        Err("This action must run from a quick capture window.".into())
    }
}

#[tauri::command]
fn check_local_path(window: WebviewWindow, path: String) -> PathStatus {
    if ensure_main_window(&window).is_err() {
        return PathStatus {
            exists: false,
            kind: None,
            message: Some("This operation can only run in the main window.".into()),
        };
    }
    let trimmed = path.trim();

    if trimmed.is_empty() {
        return PathStatus {
            exists: false,
            kind: None,
            message: Some("路径为空".into()),
        };
    }

    match std::fs::metadata(Path::new(trimmed)) {
        Ok(metadata) => PathStatus {
            exists: true,
            kind: Some(if metadata.is_dir() { "directory" } else { "file" }),
            message: None,
        },
        Err(error) => PathStatus {
            exists: false,
            kind: None,
            message: Some(error.to_string()),
        },
    }
}

#[tauri::command]
fn write_text_file(window: WebviewWindow, path: String, contents: String) -> Result<(), String> {
    ensure_main_window(&window)?;
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("文件路径为空。".into());
    }
    if contents.as_bytes().len() as u64 > DAYMARK_TEXT_FILE_MAX_BYTES {
        return Err(format!(
            "文件内容过大，最多允许约 {} MB。",
            DAYMARK_TEXT_FILE_MAX_BYTES / 1_000_000
        ));
    }

    let path_buf = PathBuf::from(trimmed);
    if let Some(parent) = path_buf.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|error| format!("无法创建目录：{}", error))?;
        }
    }
    fs::write(&path_buf, contents).map_err(|error| format!("写入文件失败：{}", error))
}

#[tauri::command]
fn read_text_file(window: WebviewWindow, path: String) -> Result<String, String> {
    ensure_main_window(&window)?;
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("文件路径为空。".into());
    }

    let path_buf = PathBuf::from(trimmed);
    let metadata = fs::metadata(&path_buf).map_err(|error| format!("无法访问文件：{}", error))?;
    if !metadata.is_file() {
        return Err("当前路径不是文件。".into());
    }
    if metadata.len() > DAYMARK_TEXT_FILE_MAX_BYTES {
        return Err(format!(
            "文件过大，最多允许约 {} MB。",
            DAYMARK_TEXT_FILE_MAX_BYTES / 1_000_000
        ));
    }

    fs::read_to_string(&path_buf).map_err(|error| format!("读取文件失败：{}", error))
}

#[tauri::command]
fn read_ai_api_key(
    window: WebviewWindow,
    provider: String,
    base_url: String,
) -> Result<Option<String>, String> {
    ensure_main_window(&window)?;
    let entry = ai_api_key_entry(&provider, &base_url)?;
    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::v1::Error::NoEntry) => Ok(None),
        Err(_) => Err("无法读取系统凭据中的 API Key，请重新保存。".into()),
    }
}

#[tauri::command]
fn write_ai_api_key(
    window: WebviewWindow,
    provider: String,
    base_url: String,
    api_key: String,
) -> Result<(), String> {
    ensure_main_window(&window)?;
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return Err("API Key 为空。".into());
    }

    let entry = ai_api_key_entry(&provider, &base_url)?;
    entry
        .set_password(trimmed)
        .map_err(|_| "无法写入系统凭据中的 API Key。".to_string())
}

#[tauri::command]
fn delete_ai_api_key(window: WebviewWindow, provider: String, base_url: String) -> Result<(), String> {
    ensure_main_window(&window)?;
    let entry = ai_api_key_entry(&provider, &base_url)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::v1::Error::NoEntry) => Ok(()),
        Err(_) => Err("无法删除系统凭据中的 API Key。".into()),
    }
}

fn ai_api_key_entry(provider: &str, base_url: &str) -> Result<keyring::v1::Entry, String> {
    let account = ai_api_key_account(provider, base_url)?;
    keyring::v1::Entry::new(AI_API_KEY_SERVICE, &account)
        .map_err(|_| "无法打开系统凭据存储。".to_string())
}

fn ai_api_key_account(provider: &str, base_url: &str) -> Result<String, String> {
    let provider = normalize_ai_key_provider(provider)?;
    let normalized_base_url = normalize_ai_key_base_url(base_url)?;
    Ok(format!(
        "{}:{}",
        provider,
        general_purpose::URL_SAFE_NO_PAD.encode(normalized_base_url.as_bytes())
    ))
}

fn normalize_ai_key_provider(provider: &str) -> Result<&'static str, String> {
    match provider.trim() {
        "deepseek" => Ok("deepseek"),
        "openai-compatible" | "OpenAICompatible" => Ok("openai-compatible"),
        _ => Err("未知 AI 供应商。".into()),
    }
}

fn normalize_ai_key_base_url(base_url: &str) -> Result<String, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Base URL 为空。".into());
    }

    if let Some((scheme, rest)) = trimmed.split_once("://") {
        let scheme = scheme.to_ascii_lowercase();
        let split_at = rest
            .find(|value| value == '/' || value == '?' || value == '#')
            .unwrap_or(rest.len());
        let host = rest[..split_at].to_ascii_lowercase();
        let suffix = &rest[split_at..];
        return Ok(format!("{}://{}{}", scheme, host, suffix).trim_end_matches('/').to_string());
    }

    Ok(trimmed.to_string())
}

#[tauri::command]
fn get_supported_file_analysis_types() -> Vec<&'static str> {
    vec!["txt", "md", "markdown", "csv", "pdf", "docx", "pptx", "xlsx"]
}

#[tauri::command]
fn get_supported_vision_types() -> Vec<&'static str> {
    vec!["jpg", "jpeg", "png", "webp", "gif"]
}

#[tauri::command]
fn extract_local_image_data(window: WebviewWindow, path: String) -> Result<ImageDataExtractResult, String> {
    ensure_main_window(&window)?;
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("图片路径为空".into());
    }

    let path_buf = PathBuf::from(trimmed);
    let metadata = fs::metadata(&path_buf).map_err(|error| format!("无法访问图片：{}", error))?;
    if !metadata.is_file() {
        return Err("当前路径不是图片文件".into());
    }
    if metadata.len() > IMAGE_DATA_MAX_BYTES {
        return Err(format!(
            "图片过大，第一版最多读取约 {} MB 的图片",
            IMAGE_DATA_MAX_BYTES / 1_000_000
        ));
    }

    let extension = path_buf
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_lowercase();
    let mime_type = match extension.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => {
            return Err(format!(
                "暂不支持 .{} 图片分析。当前支持：{}",
                extension,
                get_supported_vision_types().join(", ")
            ));
        }
    };
    let file_name = path_buf
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("未命名图")
        .to_string();
    let bytes = fs::read(&path_buf).map_err(|error| format!("读取图片失败：{}", error))?;
    let data_url = format!(
        "data:{};base64,{}",
        mime_type,
        general_purpose::STANDARD.encode(bytes)
    );

    Ok(ImageDataExtractResult {
        path: trimmed.to_string(),
        file_name,
        extension,
        mime_type: mime_type.to_string(),
        size_bytes: metadata.len(),
        data_url,
        warnings: Vec::new(),
    })
}

#[tauri::command]
fn extract_local_file_text(window: WebviewWindow, path: String) -> Result<FileTextExtractResult, String> {
    ensure_main_window(&window)?;
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("文件路径为空".into());
    }

    let path_buf = PathBuf::from(trimmed);
    let metadata = fs::metadata(&path_buf).map_err(|error| format!("无法访问文件：{}", error))?;
    if !metadata.is_file() {
        return Err("当前路径不是文件".into());
    }
    if metadata.len() > FILE_TEXT_MAX_BYTES {
        return Err(format!(
            "文件过大，第一版最多读取约 {} MB 的文件",
            FILE_TEXT_MAX_BYTES / 1_000_000
        ));
    }

    let extension = path_buf
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_lowercase();
    let file_name = path_buf
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("未命名文")
        .to_string();
    let mut warnings = Vec::new();
    let raw_text = match extension.as_str() {
        "txt" | "md" | "markdown" | "csv" => extract_plain_text(&path_buf)?,
        "pdf" => extract_pdf_text(&path_buf, &mut warnings)?,
        "docx" => extract_office_text(
            &path_buf,
            &[
                "word/document.xml",
                "word/header",
                "word/footer",
                "word/footnotes.xml",
                "word/endnotes.xml",
                "word/comments.xml",
            ],
            &mut warnings,
        )?,
        "pptx" => extract_office_text(&path_buf, &["ppt/slides/slide"], &mut warnings)?,
        "xlsx" => extract_office_text(&path_buf, &["xl/sharedStrings.xml", "xl/worksheets/sheet"], &mut warnings)?,
        _ => {
            return Err(format!(
                "暂不支持 .{} 文件的正文提取。当前支持：{}",
                extension,
                get_supported_file_analysis_types().join(", ")
            ));
        }
    };

    let finalized = finalize_file_text(raw_text, &extension, metadata.len(), warnings);

    Ok(FileTextExtractResult {
        path: trimmed.to_string(),
        file_name,
        extension,
        size_bytes: metadata.len(),
        text: finalized.text,
        extracted_chars: finalized.extracted_chars,
        sent_chars: finalized.sent_chars,
        char_count: finalized.sent_chars,
        truncated: finalized.truncated,
        redacted: finalized.redacted,
        quality: finalized.quality,
        preview: finalized.preview,
        warnings: finalized.warnings,
    })
}

struct FinalizedFileText {
    text: String,
    extracted_chars: usize,
    sent_chars: usize,
    truncated: bool,
    redacted: bool,
    quality: String,
    preview: String,
    warnings: Vec<String>,
}

fn finalize_file_text(
    raw_text: String,
    extension: &str,
    size_bytes: u64,
    mut warnings: Vec<String>,
) -> FinalizedFileText {
    let (safe_text, redacted) = redact_sensitive_text(&raw_text);
    if redacted {
        warnings.push("已在本机脱敏疑似密钥、token 或凭据".into());
    }

    let extracted_chars = safe_text.chars().count();
    let truncated = extracted_chars > FILE_TEXT_MAX_CHARS;
    let text = if truncated {
        warnings.push("文件内容较长，已在本机截断后用于本次 AI 操作".into());
        take_chars(&safe_text, FILE_TEXT_MAX_CHARS)
    } else {
        safe_text
    };
    let sent_chars = text.chars().count();

    let quality = classify_file_text_quality(extension, size_bytes, &text, &warnings);
    if quality != "ok" {
        warnings.push(format!(
            "Extraction quality is {quality}; AI actions should stop unless better text is available."
        ));
    }
    let preview = take_chars(&compact_text(&text), 360);

    FinalizedFileText {
        text,
        extracted_chars,
        sent_chars,
        truncated,
        redacted,
        quality: quality.to_string(),
        preview,
        warnings,
    }
}

#[tauri::command]
fn probe_codex_sources(window: WebviewWindow) -> Result<Vec<CodexSourceProbe>, String> {
    ensure_main_window(&window)?;
    Ok(probe_conversation_sources_impl()
        .into_iter()
        .filter(|source| source.source_kind == "codex")
        .collect())
}

fn extract_plain_text(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| format!("读取文件失败：{}", error))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn extract_pdf_text(path: &Path, warnings: &mut Vec<String>) -> Result<String, String> {
    let document = lopdf::Document::load(path).map_err(|error| format!("PDF 解析失败：{}", error))?;
    let pages = document.get_pages();
    let page_numbers = pages.keys().copied().collect::<Vec<_>>();
    if page_numbers.is_empty() {
        warnings.push("PDF 中没有找到可提取文本的页面".into());
        return Ok(String::new());
    }
    document
        .extract_text(&page_numbers)
        .map_err(|error| format!("PDF 文本提取失败：{}", error))
}

fn extract_office_text(path: &Path, prefixes: &[&str], warnings: &mut Vec<String>) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|error| format!("打开 Office 文件失败：{}", error))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|error| format!("Office 文件解包失败：{}", error))?;
    let mut output = String::new();

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("读取 Office 内部文件失败：{}", error))?;
        let name = entry.name().replace('\\', "/");
        if !name.ends_with(".xml") || !prefixes.iter().any(|prefix| name.starts_with(prefix)) {
            continue;
        }
        if entry.size() > FILE_TEXT_MAX_OFFICE_XML_BYTES {
            warnings.push(format!("Office internal xml {} is large; reading it with the normal extraction limit.", name));
        }

        let mut xml = String::new();
        entry
            .read_to_string(&mut xml)
            .map_err(|error| format!("读取 Office 文本片段失败：{}", error))?;
        let text = office_xml_to_text(&xml);
        if !text.trim().is_empty() {
            output.push_str(&text);
            output.push_str("\n\n");
        }
        if output.chars().count() > FILE_TEXT_MAX_CHARS {
            warnings.push("Office 文件内容较多，已停止读取后续片段".into());
            break;
        }
    }

    if output.trim().is_empty() {
        warnings.push("没有从该 Office 文件中提取到可见文本".into());
    }
    Ok(output.trim().to_string())
}

fn office_xml_to_text(xml: &str) -> String {
    let mut output = String::new();
    let mut index = 0usize;
    let mut found_text_nodes = false;

    while let Some(tag_start_offset) = xml[index..].find('<') {
        let tag_start = index + tag_start_offset;
        let Some(tag_end_offset) = xml[tag_start..].find('>') else {
            break;
        };
        let tag_end = tag_start + tag_end_offset;
        let raw_tag = &xml[tag_start + 1..tag_end];
        let tag = raw_tag
            .trim()
            .trim_start_matches('/')
            .split_whitespace()
            .next()
            .unwrap_or_default()
            .trim_end_matches('/');
        let closing_tag = raw_tag.trim_start().starts_with('/');
        let self_closing = raw_tag.trim_end().ends_with('/');

        if !closing_tag && matches!(tag, "w:t" | "a:t" | "t") {
            let close = format!("</{}>", tag);
            if let Some(close_offset) = xml[tag_end + 1..].find(&close) {
                let text_start = tag_end + 1;
                let text_end = tag_end + 1 + close_offset;
                output.push_str(&decode_xml_text(&xml[text_start..text_end]));
                found_text_nodes = true;
                index = text_end + close.len();
                continue;
            }
        }

        if closing_tag && matches!(tag, "w:p" | "a:p" | "si" | "row" | "xdr:txBody") {
            push_separator(&mut output, '\n');
        } else if closing_tag && matches!(tag, "w:tc" | "c") {
            push_separator(&mut output, '\t');
        } else if self_closing && matches!(tag, "w:tab" | "a:tab") {
            push_separator(&mut output, '\t');
        } else if self_closing && matches!(tag, "w:br" | "w:cr" | "a:br") {
            push_separator(&mut output, '\n');
        }

        index = tag_end + 1;
    }

    let readable = compact_multiline_text(&output);
    if found_text_nodes && !readable.trim().is_empty() {
        readable
    } else {
        xml_to_text(xml)
    }
}

fn decode_xml_text(value: &str) -> String {
    let mut output = String::new();
    let mut entity = String::new();
    let mut in_entity = false;

    for ch in value.chars() {
        if in_entity {
            if ch == ';' {
                output.push_str(&decode_xml_entity(&entity));
                entity.clear();
                in_entity = false;
            } else if entity.len() < 16 {
                entity.push(ch);
            } else {
                output.push('&');
                output.push_str(&entity);
                entity.clear();
                in_entity = false;
            }
            continue;
        }

        if ch == '&' {
            in_entity = true;
        } else {
            output.push(ch);
        }
    }

    if in_entity {
        output.push('&');
        output.push_str(&entity);
    }

    output
}

fn push_separator(output: &mut String, separator: char) {
    if output.ends_with(separator) {
        return;
    }
    output.push(separator);
}

fn compact_multiline_text(value: &str) -> String {
    value
        .lines()
        .map(compact_text)
        .filter(|line| !line.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn xml_to_text(xml: &str) -> String {
    let mut output = String::new();
    let mut in_tag = false;
    let mut entity = String::new();
    let mut in_entity = false;

    for ch in xml.chars() {
        if in_tag {
            if ch == '>' {
                in_tag = false;
                if !output.ends_with(' ') && !output.ends_with('\n') {
                    output.push(' ');
                }
            }
            continue;
        }

        if ch == '<' {
            in_tag = true;
            continue;
        }

        if in_entity {
            if ch == ';' {
                output.push_str(&decode_xml_entity(&entity));
                entity.clear();
                in_entity = false;
            } else if entity.len() < 16 {
                entity.push(ch);
            } else {
                output.push('&');
                output.push_str(&entity);
                entity.clear();
                in_entity = false;
            }
            continue;
        }

        if ch == '&' {
            in_entity = true;
            continue;
        }

        output.push(ch);
    }

    compact_text(&output)
}

fn decode_xml_entity(entity: &str) -> String {
    match entity {
        "amp" => "&".into(),
        "lt" => "<".into(),
        "gt" => ">".into(),
        "quot" => "\"".into(),
        "apos" => "'".into(),
        value if value.starts_with("#x") => u32::from_str_radix(&value[2..], 16)
            .ok()
            .and_then(char::from_u32)
            .map(|ch| ch.to_string())
            .unwrap_or_default(),
        value if value.starts_with('#') => value[1..]
            .parse::<u32>()
            .ok()
            .and_then(char::from_u32)
            .map(|ch| ch.to_string())
            .unwrap_or_default(),
        _ => String::new(),
    }
}

fn compact_text(value: &str) -> String {
    let mut output = String::new();
    let mut last_space = false;
    for ch in value.chars() {
        if ch.is_whitespace() {
            if !last_space {
                output.push(' ');
                last_space = true;
            }
        } else {
            output.push(ch);
            last_space = false;
        }
    }
    output.trim().to_string()
}

fn classify_file_text_quality(extension: &str, size_bytes: u64, text: &str, warnings: &[String]) -> &'static str {
    let char_count = text.trim().chars().count();
    if char_count == 0 {
        return "empty";
    }

    let likely_binary_document = matches!(extension, "pdf" | "docx" | "pptx" | "xlsx");
    let skipped_main_content = warnings
        .iter()
        .any(|warning| warning.to_lowercase().contains("skipped") || warning.contains("没有"));

    if (likely_binary_document && char_count < 200) || (size_bytes > 16_000 && char_count < 200) || skipped_main_content {
        return "low";
    }

    "ok"
}

#[tauri::command]
fn probe_conversation_sources(window: WebviewWindow) -> Result<Vec<CodexSourceProbe>, String> {
    ensure_main_window(&window)?;
    Ok(probe_conversation_sources_impl())
}

fn probe_conversation_sources_impl() -> Vec<CodexSourceProbe> {
    let Some(user_profile) = std::env::var_os("USERPROFILE") else {
        return vec![CodexSourceProbe {
            id: "user-profile".into(),
            source_kind: "codex",
            label: "用户目录".into(),
            path: String::new(),
            exists: false,
            size_bytes: None,
            modified_at: None,
            probe_kind: "directory",
            message: Some("无法定位 Windows 用户目录".into()),
        }];
    };

    let home = PathBuf::from(user_profile);
    let codex = home.join(".codex");
    let app_codex = home.join("AppData").join("Local").join("OpenAI").join("Codex");
    let claude = home.join(".claude");
    let sources = [
        (
            "history",
            "codex",
            "命令与输入历",
            codex.join("history.jsonl"),
            "file",
        ),
        (
            "session-index",
            "codex",
            "会话索引",
            codex.join("session_index.jsonl"),
            "file",
        ),
        ("sessions", "codex", "会话目录", codex.join("sessions"), "directory"),
        (
            "archived-sessions",
            "codex",
            "归档会话",
            codex.join("archived_sessions"),
            "directory",
        ),
        (
            "sqlite-logs",
            "codex",
            "桌面端日志库",
            codex.join("logs_2.sqlite"),
            "database",
        ),
        (
            "codex-app",
            "codex",
            "Codex 桌面数据目录",
            app_codex,
            "directory",
        ),
        ("claude-projects", "claude", "Claude Code 项目会话", claude.join("projects"), "directory"),
        ("claude-history", "claude", "Claude Code 历史", claude.join("history.jsonl"), "file"),
        ("claude-sessions", "claude", "Claude Code 会话目录", claude.join("sessions"), "directory"),
    ];

    sources
        .into_iter()
        .map(|(id, source_kind, label, path, probe_kind)| probe_codex_source(id, source_kind, label, path, probe_kind))
        .collect()
}

#[tauri::command]
fn list_codex_session_days(window: WebviewWindow) -> Result<Vec<CodexSessionDay>, String> {
    ensure_main_window(&window)?;
    let sessions = collect_codex_sessions()?;
    summarize_session_days(sessions)
}

#[tauri::command]
fn list_conversation_session_days(
    window: WebviewWindow,
    source_kinds: Option<Vec<String>>,
) -> Result<Vec<CodexSessionDay>, String> {
    ensure_main_window(&window)?;
    let filter = filter_source_kinds(source_kinds);
    let sessions = collect_conversation_sessions(filter.as_ref())?;
    summarize_session_days(sessions)
}

fn summarize_session_days(sessions: Vec<CodexSessionMeta>) -> Result<Vec<CodexSessionDay>, String> {
    let mut days: BTreeMap<String, CodexSessionDay> = BTreeMap::new();

    for session in sessions {
        let key = format!("{}:{}", session.source_kind, session.date);
        let entry = days.entry(key).or_insert(CodexSessionDay {
            source_kind: session.source_kind.clone(),
            date: session.date.clone(),
            session_count: 0,
            total_size_bytes: 0,
            latest_modified_at: 0,
        });

        entry.session_count += 1;
        entry.total_size_bytes += session.size_bytes;
        entry.latest_modified_at = entry.latest_modified_at.max(session.modified_at);
    }

    let mut result: Vec<_> = days.into_values().collect();
    result.sort_by(|a, b| b.date.cmp(&a.date).then(a.source_kind.cmp(&b.source_kind)));
    Ok(result)
}

#[tauri::command]
fn list_codex_sessions_by_date(
    window: WebviewWindow,
    date: String,
) -> Result<Vec<CodexSessionMeta>, String> {
    ensure_main_window(&window)?;
    let date = normalize_date(&date)?;
    let mut sessions: Vec<_> = collect_codex_sessions()?
        .into_iter()
        .filter(|session| session.date == date)
        .collect();
    sessions.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(sessions)
}

#[tauri::command]
fn list_conversation_sessions_by_date(
    window: WebviewWindow,
    date: String,
    source_kinds: Option<Vec<String>>,
) -> Result<Vec<CodexSessionMeta>, String> {
    ensure_main_window(&window)?;
    let date = normalize_date(&date)?;
    let filter = filter_source_kinds(source_kinds);
    let mut sessions: Vec<_> = collect_conversation_sessions(filter.as_ref())?
        .into_iter()
        .filter(|session| session.date == date)
        .collect();
    sessions.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(sessions)
}

#[tauri::command]
fn index_codex_sessions(
    window: WebviewWindow,
    options: CodexSessionIndexOptions,
) -> Result<Vec<CodexSessionIndex>, String> {
    ensure_main_window(&window)?;
    let mut options = options;
    options.source_kinds = Some(vec!["codex".into()]);
    index_conversation_sessions_impl(options)
}

#[tauri::command]
fn index_conversation_sessions(
    window: WebviewWindow,
    options: CodexSessionIndexOptions,
) -> Result<Vec<CodexSessionIndex>, String> {
    ensure_main_window(&window)?;
    index_conversation_sessions_impl(options)
}

fn index_conversation_sessions_impl(options: CodexSessionIndexOptions) -> Result<Vec<CodexSessionIndex>, String> {
    let date_from = normalize_optional_date(options.date_from.as_deref())?;
    let date_to = normalize_optional_date(options.date_to.as_deref())?;
    let cwd_query = options.cwd_query.unwrap_or_default().trim().to_lowercase();
    let keyword = options.keyword.unwrap_or_default().trim().to_lowercase();
    let limit = options.limit.unwrap_or(600).clamp(1, 2_000);
    let source_filter = filter_source_kinds(options.source_kinds);

    let mut result = Vec::new();
    for session in collect_conversation_sessions(source_filter.as_ref())? {
        if date_from.as_deref().is_some_and(|from| session.date.as_str() < from) {
            continue;
        }
        if date_to.as_deref().is_some_and(|to| session.date.as_str() > to) {
            continue;
        }

        let indexed = index_single_session(&session)?;

        if !cwd_query.is_empty() {
            let cwd = indexed.cwd.as_deref().unwrap_or("");
            if !indexed.path.to_lowercase().contains(&cwd_query) && !cwd.to_lowercase().contains(&cwd_query) {
                continue;
            }
        }

        if !keyword.is_empty() {
            let searchable = format!(
                "{} {} {} {}",
                indexed.title,
                indexed.preview,
                indexed.cwd.as_deref().unwrap_or(""),
                indexed.path,
            )
            .to_lowercase();
            if !searchable.contains(&keyword) {
                continue;
            }
        }

        result.push(indexed);
        if result.len() >= limit {
            break;
        }
    }

    result.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(result)
}

#[tauri::command]
fn read_selected_codex_sessions(window: WebviewWindow, session_ids: Vec<String>, job_id: Option<String>) -> Result<CodexReviewInput, String> {
    ensure_main_window(&window)?;
    let mut source_filter = HashSet::new();
    source_filter.insert("codex".to_string());
    read_selected_sessions_for_review(session_ids, job_id, Some(source_filter))
}

#[tauri::command]
fn read_selected_conversation_sessions(window: WebviewWindow, session_ids: Vec<String>, job_id: Option<String>) -> Result<CodexReviewInput, String> {
    ensure_main_window(&window)?;
    read_selected_sessions_for_review(session_ids, job_id, None)
}

fn read_selected_sessions_for_review(
    session_ids: Vec<String>,
    job_id: Option<String>,
    source_filter: Option<HashSet<String>>,
) -> Result<CodexReviewInput, String> {
    let requested: HashSet<String> = session_ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect();

    if requested.is_empty() {
        return Err("Select at least one AI conversation session.".into());
    }

    let mut sessions: Vec<_> = collect_conversation_sessions(source_filter.as_ref())?
        .into_iter()
        .filter(|session| requested.contains(&session.id))
        .collect();
    sessions.sort_by(|a, b| a.date.cmp(&b.date).then(a.modified_at.cmp(&b.modified_at)));

    if sessions.is_empty() {
        return Err("Selected sessions were not found. They may have been moved or deleted.".into());
    }

    let date = selected_sessions_date_label(&sessions);
    read_sessions_for_review(date, sessions, job_id.as_deref())
}

#[tauri::command]
fn cancel_codex_review_job(window: WebviewWindow, job_id: String) -> Result<(), String> {
    ensure_main_window(&window)?;
    cancel_conversation_review_job_impl(job_id)
}

#[derive(Debug, Clone, Copy)]
struct QuickCaptureMonitor {
    logical_x: f64,
    logical_y: f64,
    logical_width: f64,
    physical_x: f64,
    physical_y: f64,
    physical_width: f64,
    scale_factor: f64,
}

impl QuickCaptureMonitor {
    fn from_monitor(monitor: &tauri::Monitor) -> Self {
        let position = monitor.position();
        let size = monitor.size();
        let scale = monitor.scale_factor().max(1.0);
        Self {
            logical_x: position.x as f64 / scale,
            logical_y: position.y as f64 / scale,
            logical_width: size.width as f64 / scale,
            physical_x: position.x as f64,
            physical_y: position.y as f64,
            physical_width: size.width as f64,
            scale_factor: scale,
        }
    }
}

#[tauri::command]
fn cancel_conversation_review_job(window: WebviewWindow, job_id: String) -> Result<(), String> {
    ensure_main_window(&window)?;
    cancel_conversation_review_job_impl(job_id)
}

fn cancel_conversation_review_job_impl(job_id: String) -> Result<(), String> {
    let trimmed = job_id.trim();
    if trimmed.is_empty() {
        return Ok(());
    }

    let jobs = CANCELLED_CODEX_JOBS.get_or_init(|| Mutex::new(HashSet::new()));
    let mut guard = jobs.lock().map_err(|_| "取消状态不可用".to_string())?;
    guard.insert(trimmed.to_string());
    Ok(())
}

fn read_sessions_for_review(
    date: String,
    sessions: Vec<CodexSessionMeta>,
    job_id: Option<&str>,
) -> Result<CodexReviewInput, String> {
    let mut transcript = String::new();
    let mut redacted = false;
    let mut truncated = false;
    let mut transcript_chars = 0usize;

    for session in &sessions {
        ensure_codex_job_not_cancelled(job_id)?;
        if transcript_chars >= CONVERSATION_REVIEW_MAX_TOTAL_CHARS {
            truncated = true;
            break;
        }

        let session_result = append_session_transcript(
            session,
            &mut transcript,
            &mut transcript_chars,
            job_id,
        )?;
        redacted = redacted || session_result.redacted;
        truncated = truncated || session_result.truncated;

        if transcript_chars >= CONVERSATION_REVIEW_MAX_TOTAL_CHARS {
            truncated = true;
            break;
        }
    }

    if truncated && !transcript.ends_with("[Content was truncated locally.]\n") {
        transcript.push_str("\n\n[Content was truncated locally.]\n");
    }

    let total_chars = transcript_chars.min(CONVERSATION_REVIEW_MAX_TOTAL_CHARS);
    let mut source_kinds = sessions
        .iter()
        .map(|session| session.source_kind.clone())
        .collect::<Vec<_>>();
    source_kinds.sort();
    source_kinds.dedup();
    clear_codex_job_if_needed(job_id)?;
    Ok(CodexReviewInput {
        date,
        review_kind: "source".into(),
        source_kinds,
        sessions,
        transcript_chunks: chunk_text(&transcript, CONVERSATION_REVIEW_CHUNK_CHARS),
        total_chars,
        redacted,
        truncated,
    })
}

struct SessionTranscriptResult {
    redacted: bool,
    truncated: bool,
}

fn session_project_label(session: &CodexSessionMeta) -> Option<String> {
    let cwd = session.cwd.as_deref()?.trim();
    if cwd.is_empty() {
        return None;
    }

    let label = Path::new(cwd)
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "本地项目".to_string());
    Some(take_chars(&label, 80))
}

fn append_session_transcript(
    session: &CodexSessionMeta,
    output: &mut String,
    output_chars: &mut usize,
    job_id: Option<&str>,
) -> Result<SessionTranscriptResult, String> {
    let file = fs::File::open(Path::new(&session.path))
        .map_err(|error| format!("无法读取会话：{}，{}", session.path, error))?;
    let reader = BufReader::new(file);
    let mut redacted = false;
    let mut truncated = false;
    let mut wrote_any = false;
    let mut raw_bytes = 0usize;

    let project_line = session_project_label(session)
        .map(|label| format!("项目：{}", label))
        .unwrap_or_default();
    let header = format!("来源：{}\n会话：{}\n时间：{}\n{}\n", session.source_label, session.id, session.date, project_line);
    push_limited(output, output_chars, &header);

    for line in reader.lines() {
        ensure_codex_job_not_cancelled(job_id)?;
        let line = line.map_err(|error| format!("读取 Codex 会话失败：{}，{}", session.path, error))?;
        raw_bytes += line.len() + 1;
        if raw_bytes > CONVERSATION_REVIEW_MAX_SESSION_RAW_BYTES {
            truncated = true;
            break;
        }

        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let extracted = if session.source_kind == "claude" {
            extract_claude_message(&value)
        } else {
            extract_codex_message(&value)
        };
        let Some((role, text)) = extracted else {
            continue;
        };
        let text = text.trim();
        if text.is_empty() {
            continue;
        }

        let (safe_text, did_redact) = redact_sensitive_text(text);
        redacted = redacted || did_redact;
        push_limited(
            output,
            output_chars,
            &format!("\n[{}]\n{}\n", role_label(role, &session.source_kind), safe_text),
        );
        wrote_any = true;

        if *output_chars >= CONVERSATION_REVIEW_MAX_TOTAL_CHARS {
            truncated = true;
            break;
        }
    }

    if wrote_any {
        push_limited(output, output_chars, "\n\n---\n\n");
    }

    Ok(SessionTranscriptResult { redacted, truncated })
}

fn push_limited(output: &mut String, output_chars: &mut usize, value: &str) {
    if *output_chars >= CONVERSATION_REVIEW_MAX_TOTAL_CHARS {
        return;
    }

    let remaining = CONVERSATION_REVIEW_MAX_TOTAL_CHARS - *output_chars;
    let value_chars = value.chars().count();
    if value_chars <= remaining {
        output.push_str(value);
        *output_chars += value_chars;
        return;
    }

    output.push_str(&take_chars(value, remaining));
    *output_chars = CONVERSATION_REVIEW_MAX_TOTAL_CHARS;
}

fn ensure_codex_job_not_cancelled(job_id: Option<&str>) -> Result<(), String> {
    let Some(job_id) = job_id else {
        return Ok(());
    };
    if job_id.trim().is_empty() {
        return Ok(());
    }

    let jobs = CANCELLED_CODEX_JOBS.get_or_init(|| Mutex::new(HashSet::new()));
    let mut guard = jobs.lock().map_err(|_| "取消状态不可用".to_string())?;
    if guard.remove(job_id) {
        return Err("This Codex review read was cancelled.".into());
    }
    Ok(())
}

fn clear_codex_job_if_needed(job_id: Option<&str>) -> Result<(), String> {
    let Some(job_id) = job_id else {
        return Ok(());
    };
    if job_id.trim().is_empty() {
        return Ok(());
    }

    let jobs = CANCELLED_CODEX_JOBS.get_or_init(|| Mutex::new(HashSet::new()));
    let mut guard = jobs.lock().map_err(|_| "取消状态不可用".to_string())?;
    guard.remove(job_id);
    Ok(())
}

fn probe_codex_source(
    id: &'static str,
    source_kind: &'static str,
    label: &'static str,
    path: PathBuf,
    probe_kind: &'static str,
) -> CodexSourceProbe {
    let path_text = path.to_string_lossy().into_owned();

    match std::fs::metadata(&path) {
        Ok(metadata) => CodexSourceProbe {
            id: id.into(),
            source_kind,
            label: label.into(),
            path: path_text,
            exists: true,
            size_bytes: if metadata.is_file() { Some(metadata.len()) } else { None },
            modified_at: metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as u64),
            probe_kind,
            message: None,
        },
        Err(error) => CodexSourceProbe {
            id: id.into(),
            source_kind,
            label: label.into(),
            path: path_text,
            exists: false,
            size_bytes: None,
            modified_at: None,
            probe_kind,
            message: Some(error.to_string()),
        },
    }
}

fn codex_home() -> Result<PathBuf, String> {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .map(|home| home.join(".codex"))
        .ok_or_else(|| "无法定位 Windows 用户目录".to_string())
}

fn claude_home() -> Result<PathBuf, String> {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .map(|home| home.join(".claude"))
        .ok_or_else(|| "无法定位 Windows 用户目录".to_string())
}

fn filter_source_kinds(value: Option<Vec<String>>) -> Option<HashSet<String>> {
    let kinds = value?
        .into_iter()
        .map(|kind| kind.trim().to_lowercase())
        .filter(|kind| kind == "codex" || kind == "claude")
        .collect::<HashSet<_>>();
    if kinds.is_empty() {
        None
    } else {
        Some(kinds)
    }
}

fn normalize_date(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.len() == 10
        && trimmed.chars().enumerate().all(|(index, ch)| {
            if index == 4 || index == 7 {
                ch == '-'
            } else {
                ch.is_ascii_digit()
            }
        })
    {
        return Ok(trimmed.to_string());
    }

    Err("日期格式应为 YYYY-MM-DD".into())
}

fn normalize_optional_date(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    normalize_date(trimmed).map(Some)
}

fn collect_codex_sessions() -> Result<Vec<CodexSessionMeta>, String> {
    let codex = codex_home()?;
    let roots = [codex.join("sessions"), codex.join("archived_sessions")];
    let mut files = Vec::new();

    for root in roots {
        if root.exists() {
            walk_jsonl_files(&root, &mut files)
                .map_err(|error| format!("扫描 Codex 会话目录失败：{}", error))?;
        }
    }

    let mut sessions = Vec::new();
    for path in files {
        let Some(date) = infer_session_date(&path) else {
            continue;
        };
        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        sessions.push(CodexSessionMeta {
            id: stable_session_id(&path),
            source_kind: "codex".into(),
            source_label: "Codex".into(),
            date,
            path: path.to_string_lossy().into_owned(),
            size_bytes: metadata.len(),
            modified_at: metadata_millis(&metadata),
            cwd: None,
        });
    }

    sessions.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(sessions)
}

fn collect_claude_sessions() -> Result<Vec<CodexSessionMeta>, String> {
    let root = claude_home()?.join("projects");
    let mut files = Vec::new();
    if root.exists() {
        walk_jsonl_files(&root, &mut files)
            .map_err(|error| format!("扫描 Claude Code 会话目录失败：{}", error))?;
    }

    let mut sessions = Vec::new();
    for path in files {
        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        let modified_at = metadata_millis(&metadata);
        sessions.push(CodexSessionMeta {
            id: stable_source_session_id("claude", &path),
            source_kind: "claude".into(),
            source_label: "Claude Code".into(),
            date: millis_to_china_date(modified_at),
            path: path.to_string_lossy().into_owned(),
            size_bytes: metadata.len(),
            modified_at,
            cwd: infer_claude_project_cwd(&root, &path),
        });
    }

    sessions.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(sessions)
}

fn collect_conversation_sessions(source_filter: Option<&HashSet<String>>) -> Result<Vec<CodexSessionMeta>, String> {
    let mut sessions = Vec::new();
    if source_filter.is_none_or(|filter| filter.contains("codex")) {
        sessions.extend(collect_codex_sessions()?);
    }
    if source_filter.is_none_or(|filter| filter.contains("claude")) {
        sessions.extend(collect_claude_sessions()?);
    }
    sessions.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(sessions)
}

fn index_single_session(session: &CodexSessionMeta) -> Result<CodexSessionIndex, String> {
    let title = session
        .path
        .rsplit(['\\', '/'])
        .next()
        .and_then(|file_name| file_name.strip_suffix(".jsonl"))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&session.id)
        .to_string();
    let preview = format!(
        "{} · 扫描阶段只读取文件元信息；勾选并生成时才读取正文",
        session.source_label
    );

    Ok(CodexSessionIndex {
        id: session.id.clone(),
        source_kind: session.source_kind.clone(),
        source_label: session.source_label.clone(),
        date: session.date.clone(),
        path: session.path.clone(),
        size_bytes: session.size_bytes,
        modified_at: session.modified_at,
        cwd: session.cwd.clone(),
        title,
        preview,
        message_count: 0,
        user_message_count: 0,
        assistant_message_count: 0,
        char_count: 0,
    })
}

fn stable_session_id(path: &Path) -> String {
    stable_source_session_id("codex", path)
}

fn stable_source_session_id(source_kind: &str, path: &Path) -> String {
    let value = path.to_string_lossy().to_lowercase();
    let mut hash = 0xcbf29ce484222325u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{source_kind}-session-{hash:016x}")
}

fn selected_sessions_date_label(sessions: &[CodexSessionMeta]) -> String {
    let Some(first) = sessions.first() else {
        return "selected".to_string();
    };
    let Some(last) = sessions.last() else {
        return first.date.clone();
    };

    if first.date == last.date {
        first.date.clone()
    } else {
        format!("{} ~ {}", first.date, last.date)
    }
}

fn walk_jsonl_files(dir: &Path, files: &mut Vec<PathBuf>) -> std::io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().into_owned();

        if path.is_dir() {
            if file_name.starts_with("backup-") {
                continue;
            }
            walk_jsonl_files(&path, files)?;
        } else if path.extension().and_then(|value| value.to_str()) == Some("jsonl") {
            files.push(path);
        }
    }

    Ok(())
}

fn infer_session_date(path: &Path) -> Option<String> {
    if let Some(file_name) = path.file_name().and_then(|value| value.to_str()) {
        if let Some(date) = find_date_like(file_name) {
            return Some(date);
        }
    }

    let day = path.parent()?.file_name()?.to_str()?;
    let month = path.parent()?.parent()?.file_name()?.to_str()?;
    let year = path.parent()?.parent()?.parent()?.file_name()?.to_str()?;
    if year.len() == 4
        && month.len() == 2
        && day.len() == 2
        && year.chars().all(|ch| ch.is_ascii_digit())
        && month.chars().all(|ch| ch.is_ascii_digit())
        && day.chars().all(|ch| ch.is_ascii_digit())
    {
        return Some(format!("{}-{}-{}", year, month, day));
    }

    None
}

fn infer_claude_project_cwd(root: &Path, path: &Path) -> Option<String> {
    let parent = path.parent()?;
    let relative = parent.strip_prefix(root).ok()?;
    let encoded = relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("\\");
    if encoded.trim().is_empty() {
        return None;
    }

    Some(encoded.replace("--", "\\").replace('-', "\\"))
}

fn millis_to_china_date(millis: u64) -> String {
    let seconds = millis / 1000 + 8 * 60 * 60;
    let days = (seconds / 86_400) as i64;
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}")
}

fn civil_from_days(days_since_epoch: i64) -> (i32, u32, u32) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if m <= 2 { 1 } else { 0 };
    (year as i32, m as u32, d as u32)
}

fn find_date_like(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    if bytes.len() < 10 {
        return None;
    }

    for index in 0..=(bytes.len() - 10) {
        if let Ok(slice) = std::str::from_utf8(&bytes[index..index + 10]) {
            if normalize_date(slice).is_ok() {
                return Some(slice.to_string());
            }
        }
    }

    None
}

fn metadata_millis(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn extract_codex_message(value: &Value) -> Option<(&str, String)> {
    let payload = value.get("payload")?;
    let payload_type = payload.get("type").and_then(Value::as_str)?;
    if payload_type != "message" {
        return None;
    }

    let role = payload.get("role").and_then(Value::as_str)?;
    if role != "user" && role != "assistant" {
        return None;
    }

    let content = payload.get("content")?.as_array()?;
    let text = content
        .iter()
        .filter_map(|item| item.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n");

    Some((role, text))
}

fn extract_claude_message(value: &Value) -> Option<(&str, String)> {
    let entry_type = value.get("type").and_then(Value::as_str)?;
    if entry_type != "user" && entry_type != "assistant" {
        return None;
    }

    let message = value.get("message")?;
    let role = message.get("role").and_then(Value::as_str).unwrap_or(entry_type);
    if role != "user" && role != "assistant" {
        return None;
    }

    let content = message.get("content")?;
    let text = if let Some(text) = content.as_str() {
        text.to_string()
    } else if let Some(parts) = content.as_array() {
        parts
            .iter()
            .filter_map(|part| {
                if part.get("type").and_then(Value::as_str) == Some("text") {
                    part.get("text").and_then(Value::as_str)
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        String::new()
    };

    if text.trim().is_empty() {
        return None;
    }
    Some((role, text))
}

fn role_label(role: &str, source_kind: &str) -> &'static str {
    match role {
        "user" => "用户",
        "assistant" if source_kind == "claude" => "Claude Code",
        "assistant" => "Codex",
        _ => "消息",
    }
}

fn redact_sensitive_text(value: &str) -> (String, bool) {
    let mut redacted = false;
    let mut in_private_key_block = false;
    let mut lines = Vec::new();

    for line in value.lines() {
        let lower = line.to_lowercase();
        if in_private_key_block {
            redacted = true;
            lines.push("[已脱敏]".to_string());
            if lower.contains("end ") && lower.contains("private key") {
                in_private_key_block = false;
            }
            continue;
        }

        if lower.contains("begin ") && lower.contains("private key") {
            redacted = true;
            in_private_key_block = true;
            lines.push("[可能包含私钥，已脱敏]".to_string());
            continue;
        }

        let sensitive_line = [
            "api_key",
            "apikey",
            "access_key",
            "authorization",
            "bearer ",
            "client_secret",
            "password",
            "private key",
            "refresh_token",
            "secret",
            "secret_access_key",
            "session_token",
            "token",
            "vite_deepseek_api_key",
            "x-api-key",
        ]
        .iter()
        .any(|needle| lower.contains(needle));

        if sensitive_line {
            redacted = true;
            lines.push("[可能包含密钥或凭据，已脱敏]".to_string());
            continue;
        }

        lines.push(line.split_whitespace()
            .map(|part| {
                if looks_like_secret(part) {
                    redacted = true;
                    "[已脱敏]".to_string()
                } else {
                    part.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join(" "));
    }

    (lines.join("\n"), redacted)
}

fn looks_like_secret(value: &str) -> bool {
    let trimmed = value.trim_matches(|ch: char| {
        !ch.is_ascii_alphanumeric() && ch != '_' && ch != '-' && ch != '.' && ch != '/' && ch != '+' && ch != '='
    });
    if trimmed.len() < 16 {
        return false;
    }

    let common_prefixes = [
        "sk-",
        "sk_",
        "ghp_",
        "gho_",
        "ghu_",
        "ghs_",
        "github_pat_",
        "xoxb-",
        "xoxp-",
        "xoxa-",
        "ya29.",
        "AIza",
    ];
    if common_prefixes.iter().any(|prefix| trimmed.starts_with(prefix)) && trimmed.len() >= 20 {
        return true;
    }

    if (trimmed.starts_with("AKIA") || trimmed.starts_with("ASIA"))
        && trimmed.len() == 20
        && trimmed.chars().all(|ch| ch.is_ascii_uppercase() || ch.is_ascii_digit())
    {
        return true;
    }

    if trimmed.len() < 32 {
        return false;
    }

    let has_alpha = trimmed.chars().any(|ch| ch.is_ascii_alphabetic());
    let has_digit = trimmed.chars().any(|ch| ch.is_ascii_digit());
    let safe_charset = trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' || ch == '.' || ch == '/' || ch == '+' || ch == '=');

    has_alpha && has_digit && safe_charset
}

fn take_chars(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

fn chunk_text(value: &str, max_chars: usize) -> Vec<String> {
    if value.trim().is_empty() {
        return Vec::new();
    }

    let mut chunks = Vec::new();
    let mut current = String::new();
    let mut current_count = 0usize;

    for line in value.lines() {
        let line_count = line.chars().count() + 1;
        if current_count > 0 && current_count + line_count > max_chars {
            chunks.push(current.trim().to_string());
            current.clear();
            current_count = 0;
        }

        current.push_str(line);
        current.push('\n');
        current_count += line_count;
    }

    if !current.trim().is_empty() {
        chunks.push(current.trim().to_string());
    }

    chunks
}

fn quick_capture_paused() -> bool {
    *QUICK_CAPTURE_PAUSED
        .get_or_init(|| Mutex::new(false))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn set_quick_capture_paused(paused: bool) {
    *QUICK_CAPTURE_PAUSED
        .get_or_init(|| Mutex::new(false))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = paused;
}

fn quick_capture_state_store() -> &'static Mutex<QuickCaptureState> {
    QUICK_CAPTURE_STATE.get_or_init(|| Mutex::new(QuickCaptureState::MainVisible))
}

fn run_quick_capture_on_main<F>(app: &AppHandle, task: F) -> bool
where
    F: FnOnce(AppHandle) + Send + 'static,
{
    let app_for_run = app.clone();
    let app_for_task = app.clone();
    app_for_run
        .run_on_main_thread(move || {
            task(app_for_task);
        })
        .is_ok()
}

fn dispatch_quick_capture_on_main<F>(app: &AppHandle, task: F)
where
    F: FnOnce(AppHandle) + Send + 'static,
{
    let app_handle = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(12));
        let _ = run_quick_capture_on_main(&app_handle, task);
    });
}

fn panel_opening_store() -> &'static Mutex<bool> {
    QUICK_CAPTURE_PANEL_OPENING.get_or_init(|| Mutex::new(false))
}

fn escape_registered_store() -> &'static Mutex<bool> {
    QUICK_CAPTURE_ESCAPE_REGISTERED.get_or_init(|| Mutex::new(false))
}

fn escape_error_store() -> &'static Mutex<Option<String>> {
    QUICK_CAPTURE_ESCAPE_ERROR.get_or_init(|| Mutex::new(None))
}

fn set_quick_capture_escape_error(message: Option<String>) {
    *escape_error_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = message;
}

fn quick_capture_escape_error() -> Option<String> {
    escape_error_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

fn quick_capture_escape_shortcut() -> Shortcut {
    Shortcut::new(None, Code::Escape)
}

fn register_quick_capture_escape(app: &AppHandle) {
    #[cfg(target_os = "windows")]
    {
        QUICK_CAPTURE_ESCAPE_HOOK_ARMED.store(true, Ordering::SeqCst);
        start_quick_capture_escape_poll(app.clone());
        start_quick_capture_escape_hook(app.clone());
    }

    let mut registered = escape_registered_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if *registered {
        return;
    }
    match app
        .global_shortcut()
        .register(quick_capture_escape_shortcut())
    {
        Ok(_) => {
            *registered = true;
            set_quick_capture_escape_error(None);
        }
        Err(error) => {
            set_quick_capture_escape_error(Some(error.to_string()));
        }
    }
}

fn unregister_quick_capture_escape(app: &AppHandle) {
    #[cfg(target_os = "windows")]
    {
        QUICK_CAPTURE_ESCAPE_HOOK_ARMED.store(false, Ordering::SeqCst);
        QUICK_CAPTURE_ESCAPE_HOOK_REQUESTED.store(false, Ordering::SeqCst);
    }

    let mut registered = escape_registered_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if !*registered {
        return;
    }
    let _ = app
        .global_shortcut()
        .unregister(quick_capture_escape_shortcut());
    *registered = false;
    set_quick_capture_escape_error(None);
}

fn close_quick_capture_panel_from_escape(app_handle: &AppHandle) {
    if !quick_capture_panel_is_active() {
        return;
    }

    let Some(token) = current_panel_token_option() else {
        return;
    };

    if panel_is_saving(token) {
        return;
    }

    if let Some(panel) = app_handle.get_webview_window(QUICK_CAPTURE_PANEL_LABEL) {
        let _ = panel.emit("quick-capture:collapse-request", token);
        let fallback_app = app_handle.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(QUICK_CAPTURE_ESCAPE_FALLBACK_MS));
            run_quick_capture_on_main(&fallback_app, move |app| {
                if current_panel_open_token() != token
                    || !matches!(quick_capture_state(), QuickCaptureState::PanelOpen | QuickCaptureState::PanelDetached)
                    || !quick_capture_window_visible(&app, QUICK_CAPTURE_PANEL_LABEL)
                    || panel_is_saving(token)
                {
                    return;
                }

                if quick_capture_state() == QuickCaptureState::PanelDetached {
                    let _ = return_quick_capture_to_hotzone_impl(&app, Some(token));
                } else {
                    let _ = hide_quick_capture_panel_impl(&app, Some(token));
                }
            });
        });
        return;
    }

    if quick_capture_state() == QuickCaptureState::PanelDetached {
        let _ = return_quick_capture_to_hotzone_impl(app_handle, Some(token));
    } else {
        let _ = hide_quick_capture_panel_impl(app_handle, Some(token));
    }
}

#[cfg(target_os = "windows")]
fn start_quick_capture_escape_poll(app: AppHandle) {
    if QUICK_CAPTURE_ESCAPE_POLL_STARTED.set(()).is_err() {
        return;
    }

    thread::spawn(move || {
        let mut was_down = false;
        loop {
            thread::sleep(Duration::from_millis(28));
            if !QUICK_CAPTURE_ESCAPE_HOOK_ARMED.load(Ordering::SeqCst)
                || !quick_capture_panel_is_active()
            {
                was_down = false;
                continue;
            }

            let is_down = unsafe { (GetAsyncKeyState(VK_ESCAPE as i32) as u16 & 0x8000) != 0 };
            if is_down && !was_down {
                let app_for_escape = app.clone();
                run_quick_capture_on_main(&app_for_escape, move |app_handle| {
                    close_quick_capture_panel_from_escape(&app_handle);
                });
            }
            was_down = is_down;
        }
    });
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn quick_capture_keyboard_hook(
    code: i32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if code >= 0
        && QUICK_CAPTURE_ESCAPE_HOOK_ARMED.load(Ordering::SeqCst)
        && (wparam as u32 == WM_KEYDOWN || wparam as u32 == WM_SYSKEYDOWN)
    {
        let event = &*(lparam as *const KBDLLHOOKSTRUCT);
        if event.vkCode == 27 {
            if let Ok(state) = quick_capture_state_store().try_lock() {
                if !matches!(*state, QuickCaptureState::PanelOpen | QuickCaptureState::PanelDetached) {
                    QUICK_CAPTURE_ESCAPE_HOOK_ARMED.store(false, Ordering::SeqCst);
                    QUICK_CAPTURE_ESCAPE_HOOK_REQUESTED.store(false, Ordering::SeqCst);
                    return CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam);
                }
            }
            QUICK_CAPTURE_ESCAPE_HOOK_REQUESTED.store(true, Ordering::SeqCst);
            return CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam);
        }
    }
    CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
}

#[cfg(target_os = "windows")]
fn start_quick_capture_escape_hook(app: AppHandle) {
    if QUICK_CAPTURE_ESCAPE_HOOK_STARTED.set(()).is_err() {
        return;
    }

    let dispatcher_app = app.clone();
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(25));
        if !QUICK_CAPTURE_ESCAPE_HOOK_REQUESTED.swap(false, Ordering::SeqCst) {
            continue;
        }
        let app_for_escape = dispatcher_app.clone();
        run_quick_capture_on_main(&app_for_escape, move |app_handle| {
            if !quick_capture_panel_is_active() {
                return;
            }
            close_quick_capture_panel_from_escape(&app_handle);
        });
    });

    thread::spawn(move || unsafe {
        let module = GetModuleHandleW(std::ptr::null());
        let hook = SetWindowsHookExW(
            WH_KEYBOARD_LL,
            Some(quick_capture_keyboard_hook),
            module,
            0,
        );
        if hook.is_null() {
            set_quick_capture_escape_error(Some("Esc hook unavailable".to_string()));
            return;
        }

        let mut message: MSG = std::mem::zeroed();
        while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
            if QUICK_CAPTURE_ESCAPE_HOOK_REQUESTED.swap(false, Ordering::SeqCst) {
                let app_for_escape = app.clone();
                run_quick_capture_on_main(&app_for_escape, move |app_handle| {
                    close_quick_capture_panel_from_escape(&app_handle);
                });
            }
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    });
}

fn panel_recovering_store() -> &'static Mutex<bool> {
    QUICK_CAPTURE_PANEL_RECOVERING.get_or_init(|| Mutex::new(false))
}

fn panel_recovering_since_store() -> &'static Mutex<Option<Instant>> {
    QUICK_CAPTURE_PANEL_RECOVERING_SINCE.get_or_init(|| Mutex::new(None))
}

fn set_panel_recovering(recovering: bool) {
    *panel_recovering_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = recovering;
    *panel_recovering_since_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = recovering.then(Instant::now);
}

fn quick_capture_panel_recovering() -> bool {
    let recovering = *panel_recovering_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if !recovering {
        return false;
    }

    let started_at = *panel_recovering_since_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if started_at
        .map(|instant| instant.elapsed() <= Duration::from_secs(3))
        .unwrap_or(false)
    {
        return true;
    }

    set_panel_recovering(false);
    false
}

fn quick_capture_panel_transitioning() -> bool {
    *panel_opening_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        || quick_capture_panel_recovering()
}

fn begin_panel_open() -> Option<QuickCapturePanelOpenGuard> {
    let mut opening = panel_opening_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if *opening {
        return None;
    }
    *opening = true;
    Some(QuickCapturePanelOpenGuard)
}

fn quick_capture_state() -> QuickCaptureState {
    *quick_capture_state_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn set_quick_capture_state(state: QuickCaptureState) {
    *quick_capture_state_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = state;
}

fn ready_windows_store() -> &'static Mutex<HashSet<String>> {
    QUICK_CAPTURE_READY_WINDOWS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn destroy_reconcile_suppressions_store() -> &'static Mutex<HashSet<String>> {
    QUICK_CAPTURE_DESTROY_RECONCILE_SUPPRESSIONS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn suppress_next_destroy_reconcile(label: &str) {
    destroy_reconcile_suppressions_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(label.to_string());
}

fn take_destroy_reconcile_suppression(label: &str) -> bool {
    destroy_reconcile_suppressions_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(label)
}

fn mark_quick_capture_ready(label: &str) {
    ready_windows_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(label.to_string());
}

fn clear_quick_capture_ready(label: &str) {
    ready_windows_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(label);
}

fn clear_quick_capture_ready_state(label: &str) {
    if label == QUICK_CAPTURE_PANEL_LABEL {
        clear_panel_ready_token();
    } else if label == QUICK_CAPTURE_HOTZONE_LABEL {
        clear_hotzone_ready_token();
    }
}

fn invalidate_quick_capture_window_session(label: &str) {
    clear_quick_capture_ready_state(label);
}

fn invalidate_quick_capture_window_lifecycle(label: &str) {
    clear_quick_capture_ready(label);
    clear_quick_capture_ready_state(label);
    if label == QUICK_CAPTURE_PANEL_LABEL {
        set_panel_saving_token(None);
        next_panel_open_token();
    } else if label == QUICK_CAPTURE_HOTZONE_LABEL {
        next_hotzone_open_token();
    }
}

fn is_quick_capture_ready(label: &str) -> bool {
    ready_windows_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .contains(label)
}

fn panel_failures_store() -> &'static Mutex<u8> {
    QUICK_CAPTURE_PANEL_FAILURES.get_or_init(|| Mutex::new(0))
}

fn hotzone_failures_store() -> &'static Mutex<u8> {
    QUICK_CAPTURE_HOTZONE_FAILURES.get_or_init(|| Mutex::new(0))
}

fn hotzone_watch_running_store() -> &'static Mutex<Option<u64>> {
    QUICK_CAPTURE_HOTZONE_WATCHING.get_or_init(|| Mutex::new(None))
}

fn hotzone_suppressed_until_store() -> &'static Mutex<Option<Instant>> {
    QUICK_CAPTURE_HOTZONE_SUPPRESSED_UNTIL.get_or_init(|| Mutex::new(None))
}

fn suppress_quick_capture_hotzone_reopen() {
    *hotzone_suppressed_until_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) =
        Some(Instant::now() + Duration::from_millis(QUICK_CAPTURE_HOTZONE_REOPEN_COOLDOWN_MS));
}

fn quick_capture_hotzone_reopen_suppressed() -> bool {
    let mut suppressed_until = hotzone_suppressed_until_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    match *suppressed_until {
        Some(until) if Instant::now() < until => true,
        Some(_) => {
            *suppressed_until = None;
            false
        }
        None => false,
    }
}

fn panel_soft_retries_store() -> &'static Mutex<BTreeMap<u64, u8>> {
    QUICK_CAPTURE_PANEL_SOFT_RETRIES.get_or_init(|| Mutex::new(BTreeMap::new()))
}

fn hotzone_soft_retries_store() -> &'static Mutex<BTreeMap<u64, u8>> {
    QUICK_CAPTURE_HOTZONE_SOFT_RETRIES.get_or_init(|| Mutex::new(BTreeMap::new()))
}

fn reset_panel_soft_retry(token: u64) {
    panel_soft_retries_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(&token);
}

fn reset_hotzone_soft_retry(token: u64) {
    hotzone_soft_retries_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(&token);
}

fn reset_hotzone_failures() {
    *hotzone_failures_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = 0;
}

fn increment_hotzone_failures() -> u8 {
    let mut failures = hotzone_failures_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *failures = failures.saturating_add(1);
    *failures
}

fn reset_panel_failures() {
    *panel_failures_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = 0;
}

fn increment_panel_failures() -> u8 {
    let mut failures = panel_failures_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *failures = failures.saturating_add(1);
    *failures
}

fn panel_open_token_store() -> &'static Mutex<u64> {
    QUICK_CAPTURE_PANEL_OPEN_TOKEN.get_or_init(|| Mutex::new(0))
}

fn next_panel_open_token() -> u64 {
    let mut token = panel_open_token_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *token = token.saturating_add(1);
    *token
}

fn current_panel_open_token() -> u64 {
    *panel_open_token_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn panel_ready_token_store() -> &'static Mutex<u64> {
    QUICK_CAPTURE_PANEL_READY_TOKEN.get_or_init(|| Mutex::new(0))
}

fn mark_panel_ready_for_token(token: u64) {
    *panel_ready_token_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = token;
}

fn clear_panel_ready_token() {
    *panel_ready_token_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = 0;
}

fn is_panel_ready_for_token(token: u64) -> bool {
    token != 0
        && *panel_ready_token_store()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            == token
}

fn panel_saving_token_store() -> &'static Mutex<Option<u64>> {
    QUICK_CAPTURE_PANEL_SAVING_TOKEN.get_or_init(|| Mutex::new(None))
}

fn set_panel_saving_token(token: Option<u64>) {
    *panel_saving_token_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = token;
}

fn clear_panel_saving_token(token: u64) {
    let mut saving_token = panel_saving_token_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if *saving_token == Some(token) {
        *saving_token = None;
    }
}

fn panel_is_saving(token: u64) -> bool {
    token != 0
        && *panel_saving_token_store()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            == Some(token)
}

fn current_panel_is_saving() -> bool {
    panel_is_saving(current_panel_open_token())
}

fn hotzone_open_token_store() -> &'static Mutex<u64> {
    QUICK_CAPTURE_HOTZONE_OPEN_TOKEN.get_or_init(|| Mutex::new(0))
}

fn next_hotzone_open_token() -> u64 {
    let mut token = hotzone_open_token_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *token = token.saturating_add(1);
    *token
}

fn current_hotzone_open_token() -> u64 {
    *hotzone_open_token_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn hotzone_ready_token_store() -> &'static Mutex<u64> {
    QUICK_CAPTURE_HOTZONE_READY_TOKEN.get_or_init(|| Mutex::new(0))
}

fn mark_hotzone_ready_for_token(token: u64) {
    *hotzone_ready_token_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = token;
}

fn clear_hotzone_ready_token() {
    *hotzone_ready_token_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = 0;
}

fn is_hotzone_ready_for_token(token: u64) -> bool {
    token != 0
        && *hotzone_ready_token_store()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            == token
}

fn degraded_notice_store() -> &'static Mutex<bool> {
    QUICK_CAPTURE_DEGRADED_NOTICE_SENT.get_or_init(|| Mutex::new(false))
}

fn degraded_store() -> &'static Mutex<bool> {
    QUICK_CAPTURE_DEGRADED.get_or_init(|| Mutex::new(false))
}

fn degraded_reason_store() -> &'static Mutex<Option<String>> {
    QUICK_CAPTURE_DEGRADED_REASON.get_or_init(|| Mutex::new(None))
}

fn shortcut_error_store() -> &'static Mutex<Option<String>> {
    QUICK_CAPTURE_SHORTCUT_ERROR.get_or_init(|| Mutex::new(None))
}

fn set_quick_capture_shortcut_error(message: Option<String>) {
    *shortcut_error_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = message;
}

fn quick_capture_shortcut_error() -> Option<String> {
    shortcut_error_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

fn quick_capture_degraded() -> bool {
    *degraded_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn set_quick_capture_degraded(value: bool) {
    *degraded_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = value;
}

fn set_quick_capture_degraded_reason(message: Option<String>) {
    *degraded_reason_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = message;
}

fn quick_capture_degraded_reason() -> Option<String> {
    degraded_reason_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

fn clear_quick_capture_degraded() {
    set_quick_capture_degraded(false);
    set_quick_capture_degraded_reason(None);
    reset_panel_failures();
    reset_hotzone_failures();
    reset_panel_soft_retry(current_panel_open_token());
    reset_hotzone_soft_retry(current_hotzone_open_token());
    *degraded_notice_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = false;
}

fn invalidate_quick_capture_window_tokens() {
    next_panel_open_token();
    next_hotzone_open_token();
    clear_panel_ready_token();
    clear_hotzone_ready_token();
    clear_quick_capture_ready(QUICK_CAPTURE_PANEL_LABEL);
    clear_quick_capture_ready(QUICK_CAPTURE_HOTZONE_LABEL);
}

fn main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "主窗口不可用".to_string())
}

fn quick_capture_monitor_store() -> &'static Mutex<Option<QuickCaptureMonitor>> {
    QUICK_CAPTURE_MONITOR.get_or_init(|| Mutex::new(None))
}

fn remember_quick_capture_monitor(app: &AppHandle) -> Result<(), String> {
    let monitor = if let Ok(main) = main_window(app) {
        main
            .current_monitor()
            .map_err(|error| error.to_string())?
            .or(main
                .primary_monitor()
                .map_err(|error| error.to_string())?)
            .or(app.primary_monitor().map_err(|error| error.to_string())?)
    } else {
        app.primary_monitor().map_err(|error| error.to_string())?
    }
    .ok_or_else(|| "无法读取显示器信息".to_string())?;
    *quick_capture_monitor_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(QuickCaptureMonitor::from_monitor(&monitor));
    Ok(())
}

fn remember_primary_quick_capture_monitor(app: &AppHandle) -> Result<(), String> {
    let monitor = app
        .primary_monitor()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "无法读取显示器信息".to_string())?;
    *quick_capture_monitor_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(QuickCaptureMonitor::from_monitor(&monitor));
    Ok(())
}

fn quick_capture_geometry(app: &AppHandle, width: u32, height: u32) -> Result<(LogicalPosition<f64>, LogicalSize<f64>), String> {
    if remember_quick_capture_monitor(app).is_err() {
        remember_primary_quick_capture_monitor(app)?;
    }

    let mut stored_monitor = *quick_capture_monitor_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    if stored_monitor.is_none() {
        if remember_quick_capture_monitor(app).is_err() {
            remember_primary_quick_capture_monitor(app)?;
        }
        stored_monitor = *quick_capture_monitor_store()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
    }

    let monitor = stored_monitor.ok_or_else(|| "Unable to read monitor information.".to_string())?;
    let x = monitor.logical_x + ((monitor.logical_width - width as f64).max(0.0) / 2.0);
    let y = monitor.logical_y;

    Ok((LogicalPosition::new(x, y), LogicalSize::new(width as f64, height as f64)))
}

fn quick_capture_window(
    app: &AppHandle,
    label: &str,
    page: &str,
    width: u32,
    height: u32,
    focused: bool,
    transparent: bool,
) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(label) {
        let keep_detached_position =
            label == QUICK_CAPTURE_PANEL_LABEL && quick_capture_state() == QuickCaptureState::PanelDetached;
        if !keep_detached_position {
            let (position, size) = quick_capture_geometry(app, width, height)?;
            window.set_size(size).map_err(|error| error.to_string())?;
            window.set_position(position).map_err(|error| error.to_string())?;
        }
        window.set_always_on_top(true).map_err(|error| error.to_string())?;
        window.set_skip_taskbar(true).map_err(|error| error.to_string())?;
        window.unminimize().ok();
        window.show().map_err(|error| error.to_string())?;
        if focused {
            window.set_focus().ok();
        }
        return Ok(window);
    }

    let (position, size) = quick_capture_geometry(app, width, height)?;
    let mut builder = WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::App(page.into()),
    )
    .title("快速记")
    .inner_size(size.width, size.height)
    .position(position.x, position.y)
    .decorations(false)
    .resizable(false)
    .transparent(transparent)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .visible(true)
    .enable_clipboard_access()
    .shadow(false);

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon).map_err(|error| error.to_string())?;
    }

    let window = builder.build().map_err(|error| error.to_string())?;
    if focused {
        window.set_focus().ok();
    }
    Ok(window)
}

#[allow(dead_code)]
fn prewarm_quick_capture_window(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window(QUICK_CAPTURE_HOTZONE_LABEL).is_some() {
        return Ok(());
    }

    remember_quick_capture_monitor(app).ok();
    let (position, size) = quick_capture_geometry(app, QUICK_CAPTURE_HOT_WIDTH, QUICK_CAPTURE_HOT_HEIGHT)?;
    let mut builder = WebviewWindowBuilder::new(
        app,
        QUICK_CAPTURE_HOTZONE_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title("快速记")
    .inner_size(size.width, size.height)
    .position(position.x, position.y)
    .decorations(false)
    .resizable(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .visible(false)
    .enable_clipboard_access()
    .shadow(false);

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon).map_err(|error| error.to_string())?;
    }

    let window = builder.build().map_err(|error| error.to_string())?;
    let _ = window.hide();
    for _ in 0..10 {
        if is_quick_capture_ready(QUICK_CAPTURE_HOTZONE_LABEL) {
            break;
        }
        thread::sleep(Duration::from_millis(80));
    }
    Ok(())
}

#[allow(dead_code)]
fn prewarm_quick_capture_hidden_window(
    app: &AppHandle,
    label: &str,
    width: u32,
    height: u32,
) -> Result<(), String> {
    if app.get_webview_window(label).is_some() {
        return Ok(());
    }

    let (position, size) = quick_capture_geometry(app, width, height)?;
    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("快速记")
        .inner_size(size.width, size.height)
        .position(position.x, position.y)
        .decorations(false)
        .resizable(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .enable_clipboard_access()
        .shadow(false);

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon).map_err(|error| error.to_string())?;
    }

    let window = builder.build().map_err(|error| error.to_string())?;
    let _ = window.hide();
    Ok(())
}

#[allow(dead_code)]
fn prewarm_quick_capture_windows(app: &AppHandle) -> Result<(), String> {
    remember_quick_capture_monitor(app).ok();
    prewarm_quick_capture_hidden_window(
        app,
        QUICK_CAPTURE_HOTZONE_LABEL,
        QUICK_CAPTURE_HOT_WIDTH,
        QUICK_CAPTURE_HOT_HEIGHT,
    )?;
    prewarm_quick_capture_hidden_window(
        app,
        QUICK_CAPTURE_PANEL_LABEL,
        QUICK_CAPTURE_PANEL_WIDTH,
        QUICK_CAPTURE_PANEL_HEIGHT,
    )?;
    Ok(())
}

fn quick_capture_panel_is_active() -> bool {
    matches!(quick_capture_state(), QuickCaptureState::PanelOpen | QuickCaptureState::PanelDetached)
}

fn quick_capture_panel_is_visible(app: &AppHandle) -> bool {
    if !quick_capture_panel_is_active() {
        return false;
    }
    quick_capture_window_visible(app, QUICK_CAPTURE_PANEL_LABEL)
}

fn quick_capture_panel_should_be_preserved(app: &AppHandle) -> bool {
    current_panel_is_saving()
        || quick_capture_panel_transitioning()
        || quick_capture_window_visible(app, QUICK_CAPTURE_PANEL_LABEL)
}

fn panel_token_is_current(token: Option<u64>) -> bool {
    matches!(token, Some(value) if value != 0 && value == current_panel_open_token())
}

fn current_panel_token_option() -> Option<u64> {
    let token = current_panel_open_token();
    (token != 0).then_some(token)
}

fn effective_current_panel_token(token: Option<u64>) -> Option<u64> {
    match token {
        Some(value) if value != 0 && value == current_panel_open_token() => Some(value),
        Some(_) => token,
        None => current_panel_token_option(),
    }
}

fn schedule_panel_focus(app: AppHandle, token: u64) {
    thread::spawn(move || {
        for delay in [60_u64, 180, 420, 900, 1_600] {
            thread::sleep(Duration::from_millis(delay));
            run_quick_capture_on_main(&app, move |app_handle| {
                if current_panel_open_token() != token
                    || !matches!(quick_capture_state(), QuickCaptureState::PanelOpen | QuickCaptureState::PanelDetached)
                {
                    return;
                }
                if let Some(panel) = app_handle.get_webview_window(QUICK_CAPTURE_PANEL_LABEL) {
                    if panel.is_visible().unwrap_or(false) {
                        panel.set_focus().ok();
                    }
                }
            });
            if current_panel_open_token() != token {
                return;
            }
        }
    });
}

fn schedule_panel_show_kicks(app: AppHandle, token: u64) {
    thread::spawn(move || {
        for delay in [120_u64, 360, 720, 1_500, 3_000] {
            thread::sleep(Duration::from_millis(delay));
            run_quick_capture_on_main(&app, move |app_handle| {
                if current_panel_open_token() != token
                    || !matches!(quick_capture_state(), QuickCaptureState::PanelOpen | QuickCaptureState::PanelDetached)
                    || is_panel_ready_for_token(token)
                {
                    return;
                }
                if let Some(panel) = app_handle.get_webview_window(QUICK_CAPTURE_PANEL_LABEL) {
                    if panel.is_visible().unwrap_or(false) {
                        panel.emit("quick-capture:panel-show", token).ok();
                        panel.set_focus().ok();
                    }
                }
            });
            if current_panel_open_token() != token || is_panel_ready_for_token(token) {
                return;
            }
        }
    });
}

fn revive_visible_quick_capture_panel(app: &AppHandle) -> bool {
    if !quick_capture_panel_is_active() {
        return false;
    }
    let Some(existing_panel) = app.get_webview_window(QUICK_CAPTURE_PANEL_LABEL) else {
        return false;
    };
    if !existing_panel.is_visible().unwrap_or(false) {
        return false;
    }
    let Ok(panel) = quick_capture_window(
        app,
        QUICK_CAPTURE_PANEL_LABEL,
        "index.html",
        QUICK_CAPTURE_PANEL_WIDTH,
        QUICK_CAPTURE_PANEL_HEIGHT,
        true,
        true,
    ) else {
        return false;
    };

    let open_token = next_panel_open_token();
    clear_quick_capture_ready_state(QUICK_CAPTURE_PANEL_LABEL);
    if quick_capture_state() != QuickCaptureState::PanelDetached {
        set_quick_capture_state(QuickCaptureState::PanelOpen);
    }
    hide_quick_capture_window(app, QUICK_CAPTURE_HOTZONE_LABEL);
    register_quick_capture_escape(app);
    panel.emit("quick-capture:panel-show", open_token).ok();
    panel.set_focus().ok();
    schedule_panel_show_kicks(app.clone(), open_token);
    schedule_panel_focus(app.clone(), open_token);
    schedule_panel_ready_watchdog(app.clone(), open_token);
    true
}

fn main_is_available_for_hotzone(app: &AppHandle) -> bool {
    app.get_webview_window("main")
        .map(|window| {
            let visible = window.is_visible().unwrap_or(false);
            let minimized = window.is_minimized().unwrap_or(false);
            visible && !minimized
        })
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn cursor_in_quick_capture_hotzone(app: &AppHandle) -> bool {
    if quick_capture_monitor_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .is_none()
    {
        remember_quick_capture_monitor(app).ok();
    }
    let Some(monitor) = *quick_capture_monitor_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
    else {
        return false;
    };

    let mut cursor = POINT { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut cursor) } == 0 {
        return false;
    }

    let hot_width = QUICK_CAPTURE_HOT_WIDTH as f64 * monitor.scale_factor;
    let hot_height = (QUICK_CAPTURE_HOT_HEIGHT as f64).max(14.0) * monitor.scale_factor;
    let left = (monitor.physical_x + ((monitor.physical_width - hot_width).max(0.0) / 2.0)).round() as i32;
    let top = monitor.physical_y.round() as i32;
    let right = left.saturating_add(hot_width.round() as i32);
    let bottom = top.saturating_add(hot_height.round() as i32);
    cursor.x >= left && cursor.x < right && cursor.y >= top && cursor.y < bottom
}

#[cfg(target_os = "windows")]
fn schedule_hotzone_cursor_watch(app: AppHandle, token: u64) {
    {
        let mut active_token = hotzone_watch_running_store()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if *active_token == Some(token) {
            return;
        }
        *active_token = Some(token);
    }

    thread::spawn(move || {
        let mut inside_since: Option<Instant> = None;
        loop {
            if current_hotzone_open_token() != token || quick_capture_state() != QuickCaptureState::HotzoneVisible {
                break;
            }

            if quick_capture_hotzone_reopen_suppressed() {
                inside_since = None;
                thread::sleep(Duration::from_millis(QUICK_CAPTURE_HOTZONE_POLL_INTERVAL_MS));
                continue;
            }

            if cursor_in_quick_capture_hotzone(&app) {
                let entered_at = inside_since.get_or_insert_with(Instant::now);
                if entered_at.elapsed() >= Duration::from_millis(HOTZONE_HOVER_DELAY_MS) {
                    if current_hotzone_open_token() == token {
                        run_quick_capture_on_main(&app, move |app_handle| {
                            if current_hotzone_open_token() == token
                                && quick_capture_state() == QuickCaptureState::HotzoneVisible
                            {
                                let _ = show_quick_capture_panel_impl(&app_handle);
                            }
                        });
                    }
                    break;
                }
            } else {
                inside_since = None;
            }

            thread::sleep(Duration::from_millis(QUICK_CAPTURE_HOTZONE_POLL_INTERVAL_MS));
        }

        let mut active_token = hotzone_watch_running_store()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if *active_token == Some(token) {
            *active_token = None;
        }
    });
}

#[cfg(not(target_os = "windows"))]
fn schedule_hotzone_cursor_watch(_app: AppHandle, _token: u64) {}

fn quick_capture_window_visible(app: &AppHandle, label: &str) -> bool {
    app.get_webview_window(label)
        .map(|window| {
            window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false)
        })
        .unwrap_or(false)
}

fn hide_quick_capture_window(app: &AppHandle, label: &str) {
    if label == QUICK_CAPTURE_PANEL_LABEL && current_panel_is_saving() {
        return;
    }
    let event_token = if label == QUICK_CAPTURE_PANEL_LABEL {
        current_panel_open_token()
    } else if label == QUICK_CAPTURE_HOTZONE_LABEL {
        current_hotzone_open_token()
    } else {
        0
    };
    if let Some(window) = app.get_webview_window(label) {
        if window.hide().is_err() {
            return;
        }
        let event = if label == QUICK_CAPTURE_PANEL_LABEL {
            "quick-capture:panel-hide"
        } else {
            "quick-capture:hotzone-hide"
        };
        let _ = window.emit(event, event_token);
    }
    if label == QUICK_CAPTURE_PANEL_LABEL {
        set_panel_recovering(false);
        unregister_quick_capture_escape(app);
    }
    invalidate_quick_capture_window_session(label);
}

fn destroy_quick_capture_window(app: &AppHandle, label: &str) {
    if label == QUICK_CAPTURE_PANEL_LABEL && current_panel_is_saving() {
        return;
    }
    if let Some(window) = app.get_webview_window(label) {
        suppress_next_destroy_reconcile(label);
        if window.destroy().is_err() {
            let _ = take_destroy_reconcile_suppression(label);
            return;
        }
    }
    invalidate_quick_capture_window_lifecycle(label);
}

fn hide_quick_capture_windows(app: &AppHandle) {
    hide_quick_capture_window(app, QUICK_CAPTURE_HOTZONE_LABEL);
    hide_quick_capture_window(app, QUICK_CAPTURE_PANEL_LABEL);
}

fn hide_legacy_panel_window(app: &AppHandle) {
    if current_panel_is_saving() {
        return;
    }
    hide_quick_capture_window(app, QUICK_CAPTURE_PANEL_LABEL);
}

fn degrade_quick_capture(app: &AppHandle) {
    if current_panel_is_saving() {
        return;
    }
    let message = "顶部悬浮暂时不可用，已保留快捷键和托盘快速记录入口";
    set_panel_recovering(false);
    unregister_quick_capture_escape(app);
    invalidate_quick_capture_window_tokens();
    set_quick_capture_degraded(true);
    set_quick_capture_degraded_reason(Some(message.to_string()));
    set_quick_capture_state(QuickCaptureState::Degraded);
    destroy_quick_capture_window(app, QUICK_CAPTURE_HOTZONE_LABEL);
    destroy_quick_capture_window(app, QUICK_CAPTURE_PANEL_LABEL);

    let mut notice_sent = degraded_notice_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if !*notice_sent {
        *notice_sent = true;
        let _ = app.emit("quick-capture:degraded", message);
    }
}

fn schedule_panel_ready_watchdog(app: AppHandle, token: u64) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(QUICK_CAPTURE_READY_TIMEOUT_MS));
        if current_panel_open_token() != token || is_panel_ready_for_token(token) {
            reset_panel_soft_retry(token);
            reset_panel_failures();
            return;
        }

        if panel_is_saving(token) {
            return;
        }

        if !matches!(quick_capture_state(), QuickCaptureState::PanelOpen | QuickCaptureState::PanelDetached)
            || !quick_capture_window_visible(&app, QUICK_CAPTURE_PANEL_LABEL)
        {
            return;
        }

        run_quick_capture_on_main(&app, move |app_handle| {
            if current_panel_open_token() == token
                && matches!(quick_capture_state(), QuickCaptureState::PanelOpen | QuickCaptureState::PanelDetached)
                && quick_capture_window_visible(&app_handle, QUICK_CAPTURE_PANEL_LABEL)
            {
                if let Some(panel) = app_handle.get_webview_window(QUICK_CAPTURE_PANEL_LABEL) {
                    panel.emit("quick-capture:panel-show", token).ok();
                    panel.set_focus().ok();
                }
            }
        });

        thread::sleep(Duration::from_millis(450));

        if current_panel_open_token() != token || is_panel_ready_for_token(token) {
            reset_panel_soft_retry(token);
            reset_panel_failures();
            return;
        }

        if current_panel_open_token() != token
            || !matches!(quick_capture_state(), QuickCaptureState::PanelOpen | QuickCaptureState::PanelDetached)
            || !quick_capture_window_visible(&app, QUICK_CAPTURE_PANEL_LABEL)
        {
            return;
        }

        run_quick_capture_on_main(&app, move |app_handle| {
            if current_panel_open_token() != token
                || !matches!(quick_capture_state(), QuickCaptureState::PanelOpen | QuickCaptureState::PanelDetached)
                || !quick_capture_window_visible(&app_handle, QUICK_CAPTURE_PANEL_LABEL)
                || panel_is_saving(token)
            {
                return;
            }
            let failures = increment_panel_failures();
            if failures >= QUICK_CAPTURE_MAX_OPEN_FAILURES {
                reset_panel_soft_retry(token);
                reset_panel_failures();
                degrade_quick_capture(&app_handle);
                return;
            }

            reset_panel_soft_retry(token);
            set_panel_recovering(true);
            destroy_quick_capture_window(&app_handle, QUICK_CAPTURE_PANEL_LABEL);
            let retry_app = app_handle.clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(180));
                let dispatched = run_quick_capture_on_main(&retry_app, move |retry_handle| {
                    if matches!(quick_capture_state(), QuickCaptureState::PanelOpen | QuickCaptureState::PanelDetached) {
                        if show_quick_capture_panel_impl(&retry_handle).is_err() {
                            set_panel_recovering(false);
                            degrade_quick_capture(&retry_handle);
                            return;
                        }
                    }
                    set_panel_recovering(false);
                });
                if !dispatched {
                    set_panel_recovering(false);
                }
            });
        });
    });
}

fn schedule_hotzone_ready_watchdog(app: AppHandle, token: u64) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(QUICK_CAPTURE_READY_TIMEOUT_MS));
        if current_hotzone_open_token() != token || is_hotzone_ready_for_token(token) {
            reset_hotzone_soft_retry(token);
            reset_hotzone_failures();
            return;
        }

        if quick_capture_state() != QuickCaptureState::HotzoneVisible
            || !quick_capture_window_visible(&app, QUICK_CAPTURE_HOTZONE_LABEL)
        {
            return;
        }

        run_quick_capture_on_main(&app, move |app_handle| {
            if current_hotzone_open_token() == token
                && quick_capture_state() == QuickCaptureState::HotzoneVisible
                && quick_capture_window_visible(&app_handle, QUICK_CAPTURE_HOTZONE_LABEL)
            {
                if let Some(hotzone) = app_handle.get_webview_window(QUICK_CAPTURE_HOTZONE_LABEL) {
                    hotzone.emit("quick-capture:hotzone-show", token).ok();
                }
            }
        });

        thread::sleep(Duration::from_millis(450));

        if current_hotzone_open_token() != token || is_hotzone_ready_for_token(token) {
            reset_hotzone_soft_retry(token);
            reset_hotzone_failures();
            return;
        }

        if current_hotzone_open_token() != token
            || quick_capture_state() != QuickCaptureState::HotzoneVisible
            || !quick_capture_window_visible(&app, QUICK_CAPTURE_HOTZONE_LABEL)
        {
            return;
        }

        run_quick_capture_on_main(&app, move |app_handle| {
            if current_hotzone_open_token() != token
                || quick_capture_state() != QuickCaptureState::HotzoneVisible
                || !quick_capture_window_visible(&app_handle, QUICK_CAPTURE_HOTZONE_LABEL)
            {
                return;
            }

            let failures = increment_hotzone_failures();
            if failures >= QUICK_CAPTURE_MAX_OPEN_FAILURES {
                reset_hotzone_soft_retry(token);
                reset_hotzone_failures();
                degrade_quick_capture(&app_handle);
                return;
            }

            reset_hotzone_soft_retry(token);
            destroy_quick_capture_window(&app_handle, QUICK_CAPTURE_HOTZONE_LABEL);
            let retry_app = app_handle.clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(180));
                let _ = run_quick_capture_on_main(&retry_app, move |retry_handle| {
                    if quick_capture_paused() {
                        set_quick_capture_state(QuickCaptureState::Paused);
                        hide_quick_capture_windows(&retry_handle);
                        return;
                    }
                    if quick_capture_degraded() {
                        set_quick_capture_state(QuickCaptureState::Degraded);
                        hide_quick_capture_windows(&retry_handle);
                        return;
                    }
                    if main_is_available_for_hotzone(&retry_handle) {
                        set_quick_capture_state(QuickCaptureState::MainVisible);
                        hide_quick_capture_windows(&retry_handle);
                        return;
                    }
                    if show_quick_capture_hotzone_for_hidden_main_impl(&retry_handle).is_err() {
                        degrade_quick_capture(&retry_handle);
                    }
                });
            });
        });
    });
}

fn show_quick_capture_hotzone_impl(app: &AppHandle) -> Result<(), String> {
    show_quick_capture_hotzone_impl_with(app, false)
}

fn show_quick_capture_hotzone_for_hidden_main_impl(app: &AppHandle) -> Result<(), String> {
    show_quick_capture_hotzone_impl_with(app, true)
}

fn show_quick_capture_hotzone_impl_with(app: &AppHandle, force_hidden_main: bool) -> Result<(), String> {
    if current_panel_is_saving() && quick_capture_window_visible(app, QUICK_CAPTURE_PANEL_LABEL) {
        return Ok(());
    }

    if quick_capture_paused() {
        set_quick_capture_state(QuickCaptureState::Paused);
        hide_quick_capture_windows(app);
        return Ok(());
    }

    if quick_capture_degraded() || (!force_hidden_main && main_is_available_for_hotzone(app)) {
        if quick_capture_degraded() {
            set_quick_capture_state(QuickCaptureState::Degraded);
        } else {
            set_quick_capture_state(QuickCaptureState::MainVisible);
        }
        hide_quick_capture_windows(app);
        return Ok(());
    }

    if quick_capture_state() == QuickCaptureState::HotzoneVisible && current_hotzone_open_token() != 0 {
        let token = current_hotzone_open_token();
        if quick_capture_window_visible(app, QUICK_CAPTURE_HOTZONE_LABEL) {
            if let Some(hotzone) = app.get_webview_window(QUICK_CAPTURE_HOTZONE_LABEL) {
                hotzone.emit("quick-capture:hotzone-show", token).ok();
            }
            schedule_hotzone_cursor_watch(app.clone(), token);
            schedule_hotzone_ready_watchdog(app.clone(), token);
            return Ok(());
        }
    }

    hide_legacy_panel_window(app);
    hide_quick_capture_window(app, QUICK_CAPTURE_HOTZONE_LABEL);
    remember_quick_capture_monitor(app).ok();
    let hotzone_token = next_hotzone_open_token();
    clear_quick_capture_ready_state(QUICK_CAPTURE_HOTZONE_LABEL);
    if current_hotzone_open_token() != hotzone_token
        || quick_capture_paused()
        || quick_capture_degraded()
        || (!force_hidden_main && main_is_available_for_hotzone(app))
        || quick_capture_window_visible(app, QUICK_CAPTURE_PANEL_LABEL)
    {
        if current_hotzone_open_token() == hotzone_token {
            if quick_capture_paused() {
                set_quick_capture_state(QuickCaptureState::Paused);
            } else if quick_capture_degraded() {
                set_quick_capture_state(QuickCaptureState::Degraded);
            } else if main_is_available_for_hotzone(app) {
                set_quick_capture_state(QuickCaptureState::MainVisible);
            }
        }
        return Ok(());
    }
    let hotzone = match quick_capture_window(
        app,
        QUICK_CAPTURE_HOTZONE_LABEL,
        "index.html",
        QUICK_CAPTURE_HOT_WIDTH,
        QUICK_CAPTURE_HOT_HEIGHT,
        false,
        true,
    ) {
        Ok(window) => window,
        Err(error) => {
            let failures = increment_hotzone_failures();
            if failures >= QUICK_CAPTURE_MAX_OPEN_FAILURES {
                degrade_quick_capture(app);
            } else if main_is_available_for_hotzone(app) {
                set_quick_capture_state(QuickCaptureState::MainVisible);
            }
            return Err(error);
        }
    };
    if current_hotzone_open_token() != hotzone_token
        || quick_capture_paused()
        || quick_capture_degraded()
        || (!force_hidden_main && main_is_available_for_hotzone(app))
        || quick_capture_window_visible(app, QUICK_CAPTURE_PANEL_LABEL)
    {
        if current_hotzone_open_token() == hotzone_token {
            hide_quick_capture_window(app, QUICK_CAPTURE_HOTZONE_LABEL);
            if main_is_available_for_hotzone(app) {
                set_quick_capture_state(QuickCaptureState::MainVisible);
            }
        }
        return Ok(());
    }
    set_quick_capture_state(QuickCaptureState::HotzoneVisible);
    hotzone.emit("quick-capture:hotzone-show", hotzone_token).ok();
    schedule_hotzone_cursor_watch(app.clone(), hotzone_token);
    schedule_hotzone_ready_watchdog(app.clone(), hotzone_token);
    Ok(())
}

fn show_quick_capture_panel_impl(app: &AppHandle) -> Result<(), String> {
    if current_panel_is_saving() {
        if let Some(panel) = app.get_webview_window(QUICK_CAPTURE_PANEL_LABEL) {
            if panel.is_visible().unwrap_or(false) {
                panel.set_focus().ok();
                return Ok(());
            }
        }
    }
    let Some(_opening_guard) = begin_panel_open() else {
        return Ok(());
    };

    if revive_visible_quick_capture_panel(app) {
        return Ok(());
    }

    let open_token = next_panel_open_token();
    clear_quick_capture_ready_state(QUICK_CAPTURE_PANEL_LABEL);
    let was_detached = quick_capture_state() == QuickCaptureState::PanelDetached
        && app
            .get_webview_window(QUICK_CAPTURE_PANEL_LABEL)
            .map(|window| window.is_visible().unwrap_or(false))
            .unwrap_or(false);
    if !was_detached {
        set_quick_capture_state(QuickCaptureState::PanelOpen);
    }

    let panel = match quick_capture_window(
        app,
        QUICK_CAPTURE_PANEL_LABEL,
        "index.html",
        QUICK_CAPTURE_PANEL_WIDTH,
        QUICK_CAPTURE_PANEL_HEIGHT,
        true,
        true,
    ) {
        Ok(window) => window,
        Err(error) => {
            set_panel_recovering(false);
            let failures = increment_panel_failures();
            if failures >= QUICK_CAPTURE_MAX_OPEN_FAILURES {
                degrade_quick_capture(app);
            } else if main_is_available_for_hotzone(app) {
                set_quick_capture_state(QuickCaptureState::MainVisible);
                hide_quick_capture_windows(app);
            } else {
                let _ = show_quick_capture_hotzone_for_hidden_main_impl(app);
            }
            return Err(error);
        }
    };
    if current_panel_open_token() != open_token
        || !matches!(quick_capture_state(), QuickCaptureState::PanelOpen | QuickCaptureState::PanelDetached)
    {
        if current_panel_open_token() == open_token {
            hide_quick_capture_window(app, QUICK_CAPTURE_PANEL_LABEL);
        }
        return Ok(());
    }
    hide_quick_capture_window(app, QUICK_CAPTURE_HOTZONE_LABEL);
    if current_panel_open_token() != open_token {
        return Ok(());
    }
    set_quick_capture_state(if was_detached {
        QuickCaptureState::PanelDetached
    } else {
        QuickCaptureState::PanelOpen
    });
    register_quick_capture_escape(app);
    panel.emit("quick-capture:panel-show", open_token).ok();
    panel.set_focus().ok();
    schedule_panel_show_kicks(app.clone(), open_token);
    schedule_panel_focus(app.clone(), open_token);
    schedule_panel_ready_watchdog(app.clone(), open_token);
    set_panel_recovering(false);
    Ok(())
}

fn hide_quick_capture_panel_impl(app: &AppHandle, token: Option<u64>) -> Result<bool, String> {
    if !panel_token_is_current(token) {
        return Ok(false);
    }
    if let Some(token_value) = effective_current_panel_token(token) {
        if panel_is_saving(token_value) {
            return Ok(false);
        }
    }
    if quick_capture_paused() {
        set_quick_capture_state(QuickCaptureState::Paused);
        hide_quick_capture_windows(app);
        return Ok(true);
    }
    if quick_capture_degraded() || main_is_available_for_hotzone(app) {
        set_quick_capture_state(if quick_capture_degraded() {
            QuickCaptureState::Degraded
        } else {
            QuickCaptureState::MainVisible
        });
        hide_quick_capture_windows(app);
        return Ok(true);
    }
    suppress_quick_capture_hotzone_reopen();
    show_quick_capture_hotzone_for_hidden_main_impl(app)?;
    Ok(true)
}

fn return_quick_capture_to_hotzone_impl(app: &AppHandle, token: Option<u64>) -> Result<bool, String> {
    if !panel_token_is_current(token) {
        return Ok(false);
    }
    if let Some(token_value) = effective_current_panel_token(token) {
        if panel_is_saving(token_value) {
            return Ok(false);
        }
    }
    if quick_capture_paused() {
        set_quick_capture_state(QuickCaptureState::Paused);
        hide_quick_capture_windows(app);
        return Ok(true);
    }

    if quick_capture_degraded() || main_is_available_for_hotzone(app) {
        set_quick_capture_state(if quick_capture_degraded() {
            QuickCaptureState::Degraded
        } else {
            QuickCaptureState::MainVisible
        });
        hide_quick_capture_windows(app);
        return Ok(true);
    }

    suppress_quick_capture_hotzone_reopen();
    show_quick_capture_hotzone_for_hidden_main_impl(app)?;
    Ok(true)
}

fn reconcile_quick_capture_window_destroyed(app: &AppHandle, label: &str) {
    if app.get_webview_window(label).is_some() {
        return;
    }

    if take_destroy_reconcile_suppression(label) {
        return;
    }

    invalidate_quick_capture_window_lifecycle(label);

    if quick_capture_paused() {
        set_quick_capture_state(QuickCaptureState::Paused);
        return;
    }

    if label == QUICK_CAPTURE_PANEL_LABEL {
        unregister_quick_capture_escape(app);
        set_panel_recovering(false);
        if !matches!(quick_capture_state(), QuickCaptureState::PanelOpen | QuickCaptureState::PanelDetached) {
            return;
        }

        if quick_capture_degraded() {
            set_quick_capture_state(QuickCaptureState::Degraded);
        } else if main_is_available_for_hotzone(app) {
            set_quick_capture_state(QuickCaptureState::MainVisible);
        } else {
            let _ = show_quick_capture_hotzone_for_hidden_main_impl(app);
        }
        return;
    }

    if label == QUICK_CAPTURE_HOTZONE_LABEL && quick_capture_state() == QuickCaptureState::HotzoneVisible {
        if quick_capture_degraded() {
            set_quick_capture_state(QuickCaptureState::Degraded);
        } else if main_is_available_for_hotzone(app) {
            set_quick_capture_state(QuickCaptureState::MainVisible);
        } else {
            let _ = show_quick_capture_hotzone_for_hidden_main_impl(app);
        }
    }
}

fn show_main(app: &AppHandle) -> Result<(), String> {
    let main = main_window(app)?;
    let preserve_panel = quick_capture_panel_should_be_preserved(app);
    if preserve_panel {
        hide_quick_capture_window(app, QUICK_CAPTURE_HOTZONE_LABEL);
    } else {
        set_quick_capture_state(QuickCaptureState::MainVisible);
        hide_quick_capture_windows(app);
    }
    main.show().map_err(|error| error.to_string())?;
    main.unminimize().map_err(|error| error.to_string())?;
    remember_quick_capture_monitor(app).ok();
    if preserve_panel {
        if let Some(panel) = app.get_webview_window(QUICK_CAPTURE_PANEL_LABEL) {
            panel.set_focus().ok();
        }
        Ok(())
    } else {
        main.set_focus().map_err(|error| error.to_string())
    }
}

fn route_second_launch_to_main(app: &AppHandle) {
    let app_handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let _ = show_main(&app_handle);
    });
}

fn hide_main(app: &AppHandle) -> Result<(), String> {
    let main = main_window(app)?;
    remember_quick_capture_monitor(app).ok();
    if quick_capture_panel_should_be_preserved(app) {
        main.hide().map_err(|error| error.to_string())?;
        return Ok(());
    }
    let result = show_quick_capture_hotzone_for_hidden_main_impl(app).or_else(|error| {
        degrade_quick_capture(app);
        Err(error)
    });
    if result.is_err() && main.is_visible().unwrap_or(false) && !main.is_minimized().unwrap_or(false) {
        return result;
    }
    main.hide().map_err(|error| error.to_string())?;
    schedule_hotzone_after_main_hide(app.clone());
    result
}

fn schedule_hotzone_after_main_hide(app: AppHandle) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(180));
        sync_quick_capture_lifecycle_on_main(&app);
    });
}

fn schedule_main_minimized_check(app: AppHandle) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(180));
        sync_quick_capture_lifecycle_on_main(&app);
    });
}

fn start_quick_capture_lifecycle_watchdog(app: AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(420));
        sync_quick_capture_lifecycle_on_main(&app);
    });
}

fn sync_quick_capture_lifecycle_on_main(app: &AppHandle) {
    if QUICK_CAPTURE_LIFECYCLE_SYNC_PENDING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app_handle = app.clone();
    let dispatched = app.run_on_main_thread(move || {
        QUICK_CAPTURE_LIFECYCLE_SYNC_PENDING.store(false, Ordering::SeqCst);
        if quick_capture_paused() {
            if quick_capture_panel_should_be_preserved(&app_handle) {
                hide_quick_capture_window(&app_handle, QUICK_CAPTURE_HOTZONE_LABEL);
                return;
            }
            set_quick_capture_state(QuickCaptureState::Paused);
            hide_quick_capture_windows(&app_handle);
            return;
        }

        if quick_capture_degraded() {
            return;
        }

        let Some(main) = app_handle.get_webview_window("main") else {
            return;
        };

        let minimized = main.is_minimized().unwrap_or(false);
        let visible = main.is_visible().unwrap_or(false);
        let focused = main.is_focused().unwrap_or(false);
        let panel_active = quick_capture_panel_is_active();
        let panel_visible = quick_capture_panel_is_visible(&app_handle);
        let panel_transitioning = quick_capture_panel_transitioning();
        let hotzone_visible = quick_capture_window_visible(&app_handle, QUICK_CAPTURE_HOTZONE_LABEL);

        if panel_active && !panel_visible {
            if panel_transitioning {
                return;
            }
            if visible && !minimized {
                set_quick_capture_state(QuickCaptureState::MainVisible);
                hide_quick_capture_windows(&app_handle);
            } else {
                set_quick_capture_state(QuickCaptureState::HotzoneVisible);
                if hotzone_visible {
                    if let Some(hotzone) = app_handle.get_webview_window(QUICK_CAPTURE_HOTZONE_LABEL) {
                        let token = current_hotzone_open_token();
                        if token != 0 {
                            hotzone.emit("quick-capture:hotzone-show", token).ok();
                        }
                    }
                } else {
                let _ = show_quick_capture_hotzone_for_hidden_main_impl(&app_handle);
                }
            }
            return;
        }

        if minimized {
            remember_quick_capture_monitor(&app_handle).ok();
            let _ = main.hide();
            if !panel_active
                && !panel_visible
                && !panel_transitioning
                && !hotzone_visible
            {
                let _ = show_quick_capture_hotzone_for_hidden_main_impl(&app_handle);
            }
            return;
        }

        if visible {
            if focused
                && !panel_visible
                && !panel_active
                && !panel_transitioning
                && hotzone_visible
            {
                set_quick_capture_state(QuickCaptureState::MainVisible);
                hide_quick_capture_windows(&app_handle);
                return;
            }
            if !panel_active
                && !panel_visible
                && !panel_transitioning
                && hotzone_visible
            {
                hide_quick_capture_windows(&app_handle);
                set_quick_capture_state(QuickCaptureState::MainVisible);
            }
            return;
        }

        if !panel_active && !panel_visible && !panel_transitioning && hotzone_visible {
            set_quick_capture_state(QuickCaptureState::HotzoneVisible);
            let token = current_hotzone_open_token();
            if token != 0 {
                if let Some(hotzone) = app_handle.get_webview_window(QUICK_CAPTURE_HOTZONE_LABEL) {
                    hotzone.emit("quick-capture:hotzone-show", token).ok();
                }
                schedule_hotzone_cursor_watch(app_handle.clone(), token);
                schedule_hotzone_ready_watchdog(app_handle.clone(), token);
            }
            return;
        }

        if !panel_active
            && !panel_visible
            && !panel_transitioning
            && !hotzone_visible
        {
            let _ = show_quick_capture_hotzone_for_hidden_main_impl(&app_handle);
        }
    });
    if dispatched.is_err() {
        QUICK_CAPTURE_LIFECYCLE_SYNC_PENDING.store(false, Ordering::SeqCst);
    }
}

#[tauri::command]
fn show_main_window(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    ensure_quick_capture_window(&window)?;
    show_main(&app)
}

#[tauri::command]
fn hide_main_to_tray(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    ensure_main_window(&window)?;
    hide_main(&app)
}

#[tauri::command]
fn show_quick_capture(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    ensure_main_window(&window)?;
    show_quick_capture_panel_impl(&app)
}

#[tauri::command]
fn expand_quick_capture(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    ensure_quick_capture_hotzone_window(&window)?;
    show_quick_capture_panel_impl(&app)
}

#[tauri::command]
fn collapse_quick_capture(window: WebviewWindow, app: AppHandle) -> Result<bool, String> {
    ensure_quick_capture_panel_window(&window)?;
    hide_quick_capture_panel_impl(&app, current_panel_token_option())
}

#[tauri::command]
fn show_quick_capture_hotzone(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    ensure_main_window(&window)?;
    show_quick_capture_hotzone_impl(&app)
}

#[tauri::command]
fn show_quick_capture_panel(
    window: WebviewWindow,
    app: AppHandle,
    hotzone_token: Option<u64>,
    trigger: Option<String>,
) -> Result<bool, String> {
    if window.label() != "main" && window.label() != QUICK_CAPTURE_HOTZONE_LABEL {
        return Err("Quick capture can only be opened from main or hotzone.".into());
    }
    if window.label() == QUICK_CAPTURE_HOTZONE_LABEL {
        let click_trigger = matches!(trigger.as_deref(), Some("click") | Some("explicit"));
        if (!click_trigger && quick_capture_hotzone_reopen_suppressed())
            || quick_capture_state() != QuickCaptureState::HotzoneVisible
        {
            return Ok(false);
        }
        match hotzone_token {
            Some(token) if token != 0 && token == current_hotzone_open_token() => {}
            _ => {
                return Ok(false);
            }
        }
    }
    show_quick_capture_panel_impl(&app)?;
    Ok(true)
}

#[tauri::command]
fn hide_quick_capture_panel(window: WebviewWindow, app: AppHandle, token: Option<u64>) -> Result<bool, String> {
    ensure_quick_capture_panel_window(&window)?;
    hide_quick_capture_panel_impl(&app, effective_current_panel_token(token))
}

#[tauri::command]
fn return_quick_capture_to_hotzone(
    window: WebviewWindow,
    app: AppHandle,
    token: Option<u64>,
) -> Result<bool, String> {
    ensure_quick_capture_panel_window(&window)?;
    return_quick_capture_to_hotzone_impl(&app, effective_current_panel_token(token))
}

#[tauri::command]
fn quick_capture_window_ready(window: WebviewWindow, label: String, token: Option<u64>) -> Result<(), String> {
    if label != QUICK_CAPTURE_HOTZONE_LABEL && label != QUICK_CAPTURE_PANEL_LABEL {
        return Err("Unknown quick capture window label.".into());
    }
    if window.label() != label {
        return Ok(());
    }
    mark_quick_capture_ready(&label);

    let token = token.filter(|value| *value != 0);
    if token.is_none() {
        return Ok(());
    }
    if !window.is_visible().unwrap_or(false) || window.is_minimized().unwrap_or(false) {
        return Ok(());
    }
    if label == QUICK_CAPTURE_PANEL_LABEL {
        if !matches!(quick_capture_state(), QuickCaptureState::PanelOpen | QuickCaptureState::PanelDetached) {
            return Ok(());
        }
        let panel_token = match token {
            Some(value) if value == current_panel_open_token() => value,
            _ => return Ok(()),
        };
        mark_panel_ready_for_token(panel_token);
    } else {
        if quick_capture_state() != QuickCaptureState::HotzoneVisible {
            return Ok(());
        }
        let hotzone_token = match token {
            Some(value) if value == current_hotzone_open_token() => value,
            _ => return Ok(()),
        };
        mark_hotzone_ready_for_token(hotzone_token);
    }
    if label == QUICK_CAPTURE_PANEL_LABEL {
        reset_panel_failures();
    } else {
        reset_hotzone_failures();
    }
    Ok(())
}

#[tauri::command]
fn get_quick_capture_panel_token(window: WebviewWindow) -> Result<u64, String> {
    ensure_quick_capture_panel_window(&window)?;
    if !matches!(quick_capture_state(), QuickCaptureState::PanelOpen | QuickCaptureState::PanelDetached)
        || !window.is_visible().unwrap_or(false)
        || window.is_minimized().unwrap_or(false)
    {
        return Ok(0);
    }
    current_panel_open_token()
        .try_into()
        .map_err(|_| "Invalid quick capture token.".to_string())
}

#[tauri::command]
fn get_quick_capture_runtime_state() -> QuickCaptureRuntimeState {
    QuickCaptureRuntimeState {
        state: quick_capture_state().as_str(),
        panel_token: current_panel_open_token(),
        hotzone_token: current_hotzone_open_token(),
        paused: quick_capture_paused(),
        degraded: quick_capture_degraded(),
        degraded_reason: quick_capture_degraded_reason(),
        shortcut_available: quick_capture_shortcut_error().is_none(),
        shortcut_error: quick_capture_shortcut_error(),
        escape_available: quick_capture_escape_error().is_none(),
        escape_error: quick_capture_escape_error(),
    }
}

#[tauri::command]
fn set_quick_capture_detached(window: WebviewWindow, detached: bool, token: Option<u64>) -> Result<(), String> {
    if window.label() != QUICK_CAPTURE_PANEL_LABEL {
        return Ok(());
    }
    match token {
        Some(value) if value != 0 && value == current_panel_open_token() => {}
        _ => return Ok(()),
    }
    if !quick_capture_panel_is_active() {
        return Ok(());
    }
    set_quick_capture_state(if detached {
        QuickCaptureState::PanelDetached
    } else {
        QuickCaptureState::PanelOpen
    });
    Ok(())
}

#[tauri::command]
fn set_quick_capture_saving(window: WebviewWindow, saving: bool, token: Option<u64>) -> Result<(), String> {
    ensure_quick_capture_panel_window(&window)?;
    let Some(token_value) = token.filter(|value| *value != 0) else {
        return Ok(());
    };
    if token_value != current_panel_open_token() {
        return Ok(());
    }
    if saving {
        set_panel_saving_token(Some(token_value));
    } else {
        clear_panel_saving_token(token_value);
    }
    Ok(())
}

#[tauri::command]
fn notify_quick_capture_saved(window: WebviewWindow, app: AppHandle, token: Option<u64>) -> Result<bool, String> {
    ensure_quick_capture_panel_window(&window)?;
    let Some(token_value) = token.filter(|value| *value != 0) else {
        return Ok(false);
    };
    if token_value != current_panel_open_token() && !panel_is_saving(token_value) {
        return Ok(false);
    }
    app.emit("quick-capture:saved", ()).map_err(|error| error.to_string())?;
    Ok(true)
}

fn setup_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let open = MenuItem::with_id(app, "open-main", "打开个人知识库", true, None::<&str>)?;
    let quick = MenuItem::with_id(app, "quick-capture", "快速记录 Ctrl+Shift+Space", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "toggle-quick-capture", "暂停/恢复顶部悬浮", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quick, &pause, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main-tray")
        .tooltip("个人知识库")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open-main" => {
                dispatch_quick_capture_on_main(app, |app_handle| {
                    let _ = show_main(&app_handle);
                });
            }
            "quick-capture" => {
                dispatch_quick_capture_on_main(app, |app_handle| {
                    let _ = show_quick_capture_panel_impl(&app_handle);
                });
            }
            "toggle-quick-capture" => {
                dispatch_quick_capture_on_main(app, |app_handle| {
                    let paused = !quick_capture_paused();
                    set_quick_capture_paused(paused);
                    if paused {
                        set_quick_capture_state(QuickCaptureState::Paused);
                        hide_quick_capture_windows(&app_handle);
                    } else {
                        clear_quick_capture_degraded();
                        if quick_capture_panel_is_active() {
                            // Keep the explicit quick-capture panel where the user left it.
                        } else if !main_is_available_for_hotzone(&app_handle) {
                            let _ = show_quick_capture_hotzone_for_hidden_main_impl(&app_handle);
                        } else {
                            set_quick_capture_state(QuickCaptureState::MainVisible);
                        }
                    }
                });
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                dispatch_quick_capture_on_main(tray.app_handle(), |app_handle| {
                    let _ = show_main(&app_handle);
                });
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }

    tray.build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        ai_api_key_account, classify_file_text_quality, finalize_file_text,
        normalize_ai_key_base_url, office_xml_to_text, redact_sensitive_text, FILE_TEXT_MAX_CHARS,
    };

    #[test]
    fn office_xml_to_text_extracts_wordprocessing_text_nodes() {
        let xml = r#"
            <w:document>
              <w:body>
                <w:p><w:r><w:t>Project notes</w:t></w:r></w:p>
                <w:tbl>
                  <w:tr>
                    <w:tc><w:p><w:r><w:t>Decision</w:t></w:r></w:p></w:tc>
                    <w:tc><w:p><w:r><w:t>Keep the library quiet</w:t></w:r></w:p></w:tc>
                  </w:tr>
                </w:tbl>
              </w:body>
            </w:document>
        "#;

        let text = office_xml_to_text(xml);

        assert!(text.contains("Project notes"));
        assert!(text.contains("Decision"));
        assert!(text.contains("Keep the library quiet"));
    }

    #[test]
    fn short_binary_document_extraction_is_low_quality() {
        let quality = classify_file_text_quality("docx", 42_000, "Only a few words", &[]);

        assert_eq!(quality, "low");
    }

    #[test]
    fn ordinary_text_extraction_is_usable() {
        let text = "A careful note about the project direction. ".repeat(20);
        let quality = classify_file_text_quality("md", text.len() as u64, &text, &[]);

        assert_eq!(quality, "ok");
    }

    #[test]
    fn long_sensitive_text_reports_extracted_sent_and_redacted_counts() {
        let raw = format!(
            "api_key=sk-test-secret-1234567890\n{}",
            "机器学习章节复习重点".repeat(FILE_TEXT_MAX_CHARS / 8 + 200)
        );

        let finalized = finalize_file_text(raw, "md", 240_000, Vec::new());

        assert!(finalized.extracted_chars > FILE_TEXT_MAX_CHARS);
        assert_eq!(finalized.sent_chars, FILE_TEXT_MAX_CHARS);
        assert!(finalized.truncated);
        assert!(finalized.redacted);
        assert!(finalized.text.contains("已脱"));
        assert!(finalized.warnings.iter().any(|warning| warning.contains("脱敏")));
        assert!(finalized.warnings.iter().any(|warning| warning.contains("截断")));
    }

    #[test]
    fn redaction_covers_private_keys_and_common_cloud_tokens() {
        let raw = [
            "-----BEGIN OPENSSH PRIVATE KEY-----",
            "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAA==",
            "-----END OPENSSH PRIVATE KEY-----",
            "aws_access_key_id = AKIA1234567890ABCDEF",
            "github_pat_1234567890abcdefghijklmnopqrstuvwxyz",
            "normal project note",
        ]
        .join("\n");

        let (safe, redacted) = redact_sensitive_text(&raw);

        assert!(redacted);
        assert!(safe.contains("已脱"));
        assert!(!safe.contains("AKIA1234567890ABCDEF"));
        assert!(!safe.contains("github_pat_1234567890abcdefghijklmnopqrstuvwxyz"));
        assert!(safe.contains("normal project note"));
    }

    #[test]
    fn ai_key_base_url_normalization_keeps_scope_stable() {
        assert_eq!(
            normalize_ai_key_base_url(" HTTPS://API.DeepSeek.com/ ").unwrap(),
            "https://api.deepseek.com"
        );
        assert_eq!(
            normalize_ai_key_base_url("https://example.test/v1/").unwrap(),
            "https://example.test/v1"
        );
    }

    #[test]
    fn ai_key_account_scopes_provider_and_base_url() {
        let deepseek = ai_api_key_account("deepseek", "https://api.example.test").unwrap();
        let compatible = ai_api_key_account("openai-compatible", "https://api.example.test").unwrap();
        let other_url = ai_api_key_account("deepseek", "https://other.example.test").unwrap();

        assert_ne!(deepseek, compatible);
        assert_ne!(deepseek, other_url);
        assert!(deepseek.starts_with("deepseek:"));
        assert!(compatible.starts_with("openai-compatible:"));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            route_second_launch_to_main(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    let quick_shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
                    if shortcut == &quick_shortcut && event.state() == ShortcutState::Pressed {
                        dispatch_quick_capture_on_main(app, |app_handle| {
                            let _ = show_quick_capture_panel_impl(&app_handle);
                        });
                        return;
                    }
                    let escape_shortcut = quick_capture_escape_shortcut();
                    if shortcut == &escape_shortcut
                        && event.state() == ShortcutState::Pressed
                        && quick_capture_panel_is_active()
                    {
                        dispatch_quick_capture_on_main(app, |app_handle| {
                            close_quick_capture_panel_from_escape(&app_handle);
                        });
                    }
                })
                .build(),
        )
        .setup(|app| {
            setup_tray(app)?;
            let quick_shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
            if let Err(error) = app.global_shortcut().register(quick_shortcut) {
                let app_handle = app.handle().clone();
                set_quick_capture_shortcut_error(Some(error.to_string()));
                let message = format!("快速记录快捷键被占用，托盘入口仍可使用。{}", error);
                thread::spawn(move || {
                    thread::sleep(Duration::from_millis(1_400));
                    let _ = app_handle.emit("quick-capture:degraded", message);
                });
            } else {
                set_quick_capture_shortcut_error(None);
            }
            remember_primary_quick_capture_monitor(app.handle()).ok();
            let prewarm_app = app.handle().clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(360));
                let _ = run_quick_capture_on_main(&prewarm_app, move |app_handle| {
                    let _ = prewarm_quick_capture_windows(&app_handle);
                });
            });
            start_quick_capture_lifecycle_watchdog(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                match event {
                    WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = hide_main(window.app_handle());
                    }
                    WindowEvent::Resized(_) => {
                        if window.is_minimized().unwrap_or(false) {
                            let _ = hide_main(window.app_handle());
                        } else if main_is_available_for_hotzone(window.app_handle()) {
                            if quick_capture_panel_should_be_preserved(window.app_handle()) {
                                hide_quick_capture_window(
                                    window.app_handle(),
                                    QUICK_CAPTURE_HOTZONE_LABEL,
                                );
                            } else {
                                hide_quick_capture_windows(window.app_handle());
                                set_quick_capture_state(QuickCaptureState::MainVisible);
                            }
                        }
                        schedule_main_minimized_check(window.app_handle().clone());
                    }
                    WindowEvent::Focused(false) => {
                        schedule_main_minimized_check(window.app_handle().clone());
                    }
                    WindowEvent::Focused(true) => {
                        if main_is_available_for_hotzone(window.app_handle()) {
                            if quick_capture_panel_should_be_preserved(window.app_handle()) {
                                hide_quick_capture_window(
                                    window.app_handle(),
                                    QUICK_CAPTURE_HOTZONE_LABEL,
                                );
                            } else {
                                hide_quick_capture_windows(window.app_handle());
                                set_quick_capture_state(QuickCaptureState::MainVisible);
                            }
                        }
                    }
                    _ => {}
                }
            } else if window.label() == QUICK_CAPTURE_PANEL_LABEL {
                match event {
                    WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        if current_panel_is_saving() {
                            return;
                        }
                        let _ = hide_quick_capture_panel_impl(
                            window.app_handle(),
                            current_panel_token_option(),
                        );
                    }
                    WindowEvent::Destroyed => {
                        reconcile_quick_capture_window_destroyed(
                            window.app_handle(),
                            QUICK_CAPTURE_PANEL_LABEL,
                        );
                    }
                    _ => {}
                }
            } else if window.label() == QUICK_CAPTURE_HOTZONE_LABEL {
                match event {
                    WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        if !quick_capture_paused()
                            && !quick_capture_degraded()
                            && !main_is_available_for_hotzone(window.app_handle())
                        {
                            let _ = show_quick_capture_hotzone_for_hidden_main_impl(
                                window.app_handle(),
                            );
                        }
                    }
                    WindowEvent::Destroyed => {
                        reconcile_quick_capture_window_destroyed(
                            window.app_handle(),
                            QUICK_CAPTURE_HOTZONE_LABEL,
                        );
                    }
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            check_local_path,
            write_text_file,
            read_text_file,
            read_ai_api_key,
            write_ai_api_key,
            delete_ai_api_key,
            get_supported_file_analysis_types,
            extract_local_file_text,
            get_supported_vision_types,
            extract_local_image_data,
            probe_codex_sources,
            probe_conversation_sources,
            list_codex_session_days,
            list_conversation_session_days,
            list_codex_sessions_by_date,
            list_conversation_sessions_by_date,
            index_codex_sessions,
            index_conversation_sessions,
            read_selected_codex_sessions,
            read_selected_conversation_sessions,
            cancel_codex_review_job,
            cancel_conversation_review_job,
            show_main_window,
            hide_main_to_tray,
            show_quick_capture,
            show_quick_capture_hotzone,
            show_quick_capture_panel,
            hide_quick_capture_panel,
            return_quick_capture_to_hotzone,
            expand_quick_capture,
            collapse_quick_capture,
            quick_capture_window_ready,
            get_quick_capture_panel_token,
            get_quick_capture_runtime_state,
            set_quick_capture_detached,
            set_quick_capture_saving,
            notify_quick_capture_saved
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
