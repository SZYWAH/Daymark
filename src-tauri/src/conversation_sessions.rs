use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, UNIX_EPOCH};
use tauri::{ipc::Channel, AppHandle, Manager, WebviewWindow};
use time::format_description::well_known::Rfc3339;
use time::{OffsetDateTime, UtcOffset};
#[cfg(windows)]
use windows_sys::Win32::Storage::FileSystem::{
    MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
};

use crate::ensure_main_window;
use crate::text_utils::{chunk_text, redact_sensitive_text, take_chars};

const CONVERSATION_REVIEW_CHUNK_CHARS: usize = 8_000;
const CONVERSATION_REVIEW_MAX_TOTAL_CHARS: usize = 900_000;
const CONVERSATION_REVIEW_MAX_SESSION_RAW_BYTES: usize = 8_000_000;
const CONVERSATION_REVIEW_CONTEXT_CHARS: usize = 6_000;
const CONVERSATION_REVIEW_CONTEXT_TURNS: usize = 4;
const CONVERSATION_REVIEW_REVERSE_BLOCK_BYTES: usize = 256 * 1024;
const CONVERSATION_REVIEW_MAX_JSONL_LINE_BYTES: usize = 32 * 1024 * 1024;
const CONVERSATION_READ_PROGRESS_BYTES: u64 = 8 * 1024 * 1024;
const CONVERSATION_READ_PROGRESS_INTERVAL: Duration = Duration::from_millis(250);
const CONVERSATION_DATE_INDEX_SCHEMA: &str = "daymark.conversation-date-index.v1";
const CONVERSATION_DATE_INDEX_FILE: &str = "conversation-date-index-v1.json";
const CONVERSATION_DATE_INDEX_CHECKPOINT_BYTES: u64 = 32 * 1024 * 1024;
const CONVERSATION_DATE_INDEX_HEAD_BYTES: usize = 64 * 1024;

static CANCELLED_CODEX_JOBS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static CONVERSATION_DATE_INDEX_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static ACTIVE_DATE_INDEX_BACKGROUND_JOB: OnceLock<Mutex<Option<String>>> = OnceLock::new();

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexSourceProbe {
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
pub(crate) struct CodexSessionDay {
    source_kind: String,
    date: String,
    session_count: usize,
    total_size_bytes: u64,
    latest_modified_at: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexSessionMeta {
    pub(crate) id: String,
    pub(crate) source_kind: String,
    pub(crate) source_label: String,
    pub(crate) date: String,
    pub(crate) started_date: String,
    pub(crate) last_active_date: String,
    pub(crate) path: String,
    pub(crate) size_bytes: u64,
    pub(crate) modified_at: u64,
    pub(crate) cwd: Option<String>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexSessionIndexOptions {
    source_kinds: Option<Vec<String>>,
    date_from: Option<String>,
    date_to: Option<String>,
    cwd_query: Option<String>,
    keyword: Option<String>,
    limit: Option<usize>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexSessionIndex {
    id: String,
    source_kind: String,
    source_label: String,
    date: String,
    started_date: String,
    last_active_date: String,
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

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConversationSessionScanProgressEvent {
    stage: &'static str,
    candidate_count: usize,
    session_index: usize,
    session_count: usize,
    processed_bytes: u64,
    cache_hit_count: usize,
    matched_count: usize,
    excluded_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConversationSessionScanResult {
    sessions: Vec<CodexSessionIndex>,
    candidate_count: usize,
    excluded_count: usize,
    cache_hit_count: usize,
}

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct ConversationDateIndexV1 {
    schema: String,
    sessions: BTreeMap<String, ConversationDateIndexSessionV1>,
}

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct ConversationDateIndexSessionV1 {
    source_kind: String,
    file_size: u64,
    modified_at: u64,
    head_fingerprint: u64,
    #[serde(default)]
    head_fingerprint_bytes: u64,
    last_complete_line_offset: u64,
    fully_indexed: bool,
    indexed_offset: u64,
    days: BTreeMap<String, ConversationDateIndexDayV1>,
    ranges: BTreeMap<String, ConversationDateIndexRangeV1>,
}

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct ConversationDateIndexDayV1 {
    first_offset: u64,
    last_offset: u64,
    user_message_count: usize,
    assistant_message_count: usize,
}

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct ConversationDateIndexRangeV1 {
    matched: bool,
    first_offset: Option<u64>,
    last_offset: Option<u64>,
    user_message_count: usize,
    assistant_message_count: usize,
    checked_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexReviewInput {
    date: String,
    activity_date_from: Option<String>,
    activity_date_to: Option<String>,
    activity_date_warning: Option<String>,
    source_kinds: Vec<String>,
    review_kind: String,
    sessions: Vec<CodexSessionMeta>,
    transcript_chunks: Vec<String>,
    total_chars: usize,
    redacted: bool,
    truncated: bool,
    skipped_oversized_record_count: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConversationReadProgressEvent {
    stage: &'static str,
    session_index: usize,
    session_count: usize,
    processed_bytes: u64,
    total_bytes: u64,
    message_count: usize,
    extracted_chars: usize,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConversationSessionDeltaCursor {
    session_id: String,
    read_offset: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConversationSessionDelta {
    pub(crate) session_id: String,
    pub(crate) source_kind: String,
    pub(crate) source_label: String,
    pub(crate) date: String,
    pub(crate) started_date: String,
    pub(crate) last_active_date: String,
    pub(crate) path: String,
    pub(crate) previous_read_offset: u64,
    pub(crate) next_read_offset: u64,
    pub(crate) modified_at: u64,
    pub(crate) context_transcript: String,
    pub(crate) transcript: String,
    pub(crate) char_count: usize,
    pub(crate) message_count: usize,
    pub(crate) redacted: bool,
    pub(crate) truncated: bool,
    pub(crate) reset: bool,
    pub(crate) skipped_oversized_record_count: usize,
}

#[derive(Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConversationSessionReadOptions {
    activity_date_from: Option<String>,
    activity_date_to: Option<String>,
}

#[derive(Clone)]
pub(crate) struct ActivityDateRange {
    from: Option<String>,
    to: Option<String>,
}

impl ActivityDateRange {
    fn contains(&self, date: &str) -> bool {
        !self.from.as_deref().is_some_and(|from| date < from)
            && !self.to.as_deref().is_some_and(|to| date > to)
    }

    fn label(&self) -> Option<String> {
        match (&self.from, &self.to) {
            (Some(from), Some(to)) if from == to => Some(from.clone()),
            (Some(from), Some(to)) => Some(format!("{from} ~ {to}")),
            (Some(from), None) => Some(format!("{from} 之后")),
            (None, Some(to)) => Some(format!("{to} 之前")),
            (None, None) => None,
        }
    }
}

#[derive(Clone)]
struct SessionMessage {
    role: String,
    text: String,
    activity_date: Option<String>,
}

#[derive(Clone)]
struct SessionMessageIdentity {
    role: String,
    activity_date: String,
}

#[derive(Clone, Copy)]
struct SessionActivityWindow {
    context_start_offset: u64,
    target_start_offset: u64,
    target_end_offset: u64,
    skipped_oversized_record_count: usize,
}

struct ConversationReadProgressReporter {
    channel: Option<Channel<ConversationReadProgressEvent>>,
    last_stage: &'static str,
    last_processed_bytes: u64,
    last_emitted_at: Instant,
}

struct ConversationScanProgressReporter {
    channel: Option<Channel<ConversationSessionScanProgressEvent>>,
    last_stage: &'static str,
    last_processed_bytes: u64,
    last_emitted_at: Instant,
}

impl ConversationScanProgressReporter {
    fn new(channel: Option<Channel<ConversationSessionScanProgressEvent>>) -> Self {
        Self {
            channel,
            last_stage: "",
            last_processed_bytes: 0,
            last_emitted_at: Instant::now(),
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn emit(
        &mut self,
        stage: &'static str,
        candidate_count: usize,
        session_index: usize,
        session_count: usize,
        processed_bytes: u64,
        cache_hit_count: usize,
        matched_count: usize,
        excluded_count: usize,
        force: bool,
    ) {
        let stage_changed = self.last_stage != stage;
        let enough_bytes = processed_bytes.saturating_sub(self.last_processed_bytes)
            >= CONVERSATION_READ_PROGRESS_BYTES;
        let enough_time = self.last_emitted_at.elapsed() >= CONVERSATION_READ_PROGRESS_INTERVAL;
        if !force && !stage_changed && !enough_bytes && !enough_time {
            return;
        }
        if let Some(channel) = &self.channel {
            let _ = channel.send(ConversationSessionScanProgressEvent {
                stage,
                candidate_count,
                session_index,
                session_count,
                processed_bytes,
                cache_hit_count,
                matched_count,
                excluded_count,
            });
        }
        self.last_stage = stage;
        self.last_processed_bytes = processed_bytes;
        self.last_emitted_at = Instant::now();
    }
}

impl ConversationReadProgressReporter {
    fn new(channel: Option<Channel<ConversationReadProgressEvent>>) -> Self {
        Self {
            channel,
            last_stage: "",
            last_processed_bytes: 0,
            last_emitted_at: Instant::now(),
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn emit(
        &mut self,
        stage: &'static str,
        session_index: usize,
        session_count: usize,
        processed_bytes: u64,
        total_bytes: u64,
        message_count: usize,
        extracted_chars: usize,
        force: bool,
    ) {
        let stage_changed = self.last_stage != stage;
        let enough_bytes = processed_bytes.saturating_sub(self.last_processed_bytes)
            >= CONVERSATION_READ_PROGRESS_BYTES;
        let enough_time = self.last_emitted_at.elapsed() >= CONVERSATION_READ_PROGRESS_INTERVAL;
        if !force && !stage_changed && !enough_bytes && !enough_time {
            return;
        }

        if let Some(channel) = &self.channel {
            let _ = channel.send(ConversationReadProgressEvent {
                stage,
                session_index,
                session_count,
                processed_bytes,
                total_bytes,
                message_count,
                extracted_chars,
            });
        }
        self.last_stage = stage;
        self.last_processed_bytes = processed_bytes;
        self.last_emitted_at = Instant::now();
    }
}

enum LimitedJsonlLine {
    Eof,
    Incomplete,
    Complete { bytes: Vec<u8>, raw_bytes: u64 },
    Oversized { raw_bytes: u64 },
}

fn read_limited_jsonl_line<R: BufRead>(
    reader: &mut R,
    job_id: Option<&str>,
) -> Result<LimitedJsonlLine, String> {
    read_limited_jsonl_line_with_limit(reader, job_id, CONVERSATION_REVIEW_MAX_JSONL_LINE_BYTES)
}

fn read_limited_jsonl_line_with_limit<R: BufRead>(
    reader: &mut R,
    job_id: Option<&str>,
    max_line_bytes: usize,
) -> Result<LimitedJsonlLine, String> {
    let mut bytes = Vec::new();
    let mut raw_bytes = 0u64;
    let mut oversized = false;

    loop {
        ensure_codex_job_not_cancelled(job_id)?;
        let buffer = reader
            .fill_buf()
            .map_err(|error| format!("读取会话记录失败：{error}"))?;
        if buffer.is_empty() {
            return if raw_bytes == 0 {
                Ok(LimitedJsonlLine::Eof)
            } else {
                Ok(LimitedJsonlLine::Incomplete)
            };
        }

        let chunk_len = buffer
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(buffer.len(), |index| index + 1);
        let is_complete = buffer.get(chunk_len.saturating_sub(1)) == Some(&b'\n');
        raw_bytes = raw_bytes.saturating_add(chunk_len as u64);

        if !oversized {
            if bytes.len().saturating_add(chunk_len) <= max_line_bytes {
                bytes.extend_from_slice(&buffer[..chunk_len]);
            } else {
                oversized = true;
                bytes.clear();
            }
        }
        reader.consume(chunk_len);

        if is_complete {
            return if oversized {
                Ok(LimitedJsonlLine::Oversized { raw_bytes })
            } else {
                Ok(LimitedJsonlLine::Complete { bytes, raw_bytes })
            };
        }
    }
}

#[tauri::command]
pub(crate) fn probe_codex_sources(window: WebviewWindow) -> Result<Vec<CodexSourceProbe>, String> {
    ensure_main_window(&window)?;
    Ok(probe_conversation_sources_impl()
        .into_iter()
        .filter(|source| source.source_kind == "codex")
        .collect())
}

#[tauri::command]
pub(crate) fn probe_conversation_sources(
    window: WebviewWindow,
) -> Result<Vec<CodexSourceProbe>, String> {
    ensure_main_window(&window)?;
    Ok(probe_conversation_sources_impl())
}

pub(crate) fn probe_conversation_sources_impl() -> Vec<CodexSourceProbe> {
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
    let app_codex = home
        .join("AppData")
        .join("Local")
        .join("OpenAI")
        .join("Codex");
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
        (
            "sessions",
            "codex",
            "会话目录",
            codex.join("sessions"),
            "directory",
        ),
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
        (
            "claude-projects",
            "claude",
            "Claude Code 项目会话",
            claude.join("projects"),
            "directory",
        ),
        (
            "claude-history",
            "claude",
            "Claude Code 历史",
            claude.join("history.jsonl"),
            "file",
        ),
        (
            "claude-sessions",
            "claude",
            "Claude Code 会话目录",
            claude.join("sessions"),
            "directory",
        ),
    ];

    sources
        .into_iter()
        .map(|(id, source_kind, label, path, probe_kind)| {
            probe_codex_source(id, source_kind, label, path, probe_kind)
        })
        .collect()
}

#[tauri::command]
pub(crate) fn list_codex_session_days(
    window: WebviewWindow,
) -> Result<Vec<CodexSessionDay>, String> {
    ensure_main_window(&window)?;
    let sessions = collect_codex_sessions()?;
    summarize_session_days(sessions)
}

#[tauri::command]
pub(crate) fn list_conversation_session_days(
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
        let key = format!("{}:{}", session.source_kind, session.last_active_date);
        let entry = days.entry(key).or_insert(CodexSessionDay {
            source_kind: session.source_kind.clone(),
            date: session.last_active_date.clone(),
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
pub(crate) fn list_codex_sessions_by_date(
    window: WebviewWindow,
    date: String,
) -> Result<Vec<CodexSessionMeta>, String> {
    ensure_main_window(&window)?;
    let date = normalize_date(&date)?;
    let mut sessions: Vec<_> = collect_codex_sessions()?
        .into_iter()
        .filter(|session| session_matches_activity_range(session, Some(&date), Some(&date)))
        .collect();
    sessions.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(sessions)
}

#[tauri::command]
pub(crate) fn list_conversation_sessions_by_date(
    window: WebviewWindow,
    date: String,
    source_kinds: Option<Vec<String>>,
) -> Result<Vec<CodexSessionMeta>, String> {
    ensure_main_window(&window)?;
    let date = normalize_date(&date)?;
    let filter = filter_source_kinds(source_kinds);
    let mut sessions: Vec<_> = collect_conversation_sessions(filter.as_ref())?
        .into_iter()
        .filter(|session| session_matches_activity_range(session, Some(&date), Some(&date)))
        .collect();
    sessions.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(sessions)
}

#[tauri::command]
pub(crate) fn index_codex_sessions(
    window: WebviewWindow,
    options: CodexSessionIndexOptions,
) -> Result<Vec<CodexSessionIndex>, String> {
    ensure_main_window(&window)?;
    let mut options = options;
    options.source_kinds = Some(vec!["codex".into()]);
    index_conversation_sessions_impl(options)
}

#[tauri::command]
pub(crate) fn index_conversation_sessions(
    window: WebviewWindow,
    options: CodexSessionIndexOptions,
) -> Result<Vec<CodexSessionIndex>, String> {
    ensure_main_window(&window)?;
    index_conversation_sessions_impl(options)
}

#[tauri::command]
pub(crate) async fn scan_conversation_sessions_exact(
    window: WebviewWindow,
    app: AppHandle,
    options: CodexSessionIndexOptions,
    job_id: Option<String>,
    on_event: Channel<ConversationSessionScanProgressEvent>,
) -> Result<ConversationSessionScanResult, String> {
    ensure_main_window(&window)?;
    pause_date_index_background_job()?;
    let index_path = conversation_date_index_path(&app)?;
    run_conversation_read_job(job_id.clone(), move || {
        scan_conversation_sessions_exact_impl(
            options,
            job_id.as_deref(),
            Some(on_event),
            &index_path,
        )
    })
    .await
}

#[tauri::command]
pub(crate) async fn complete_conversation_date_index(
    window: WebviewWindow,
    app: AppHandle,
    options: CodexSessionIndexOptions,
    job_id: String,
    on_event: Channel<ConversationSessionScanProgressEvent>,
) -> Result<(), String> {
    ensure_main_window(&window)?;
    remember_date_index_background_job(Some(job_id.clone()))?;
    let index_path = conversation_date_index_path(&app)?;
    let task_job_id = job_id.clone();
    let result = run_conversation_read_job(Some(job_id.clone()), move || {
        complete_conversation_date_index_impl(
            options,
            Some(task_job_id.as_str()),
            Some(on_event),
            &index_path,
        )
    })
    .await;
    let _ = remember_date_index_background_job(None);
    result
}

#[tauri::command]
pub(crate) async fn clear_conversation_date_index(
    window: WebviewWindow,
    app: AppHandle,
) -> Result<(), String> {
    ensure_main_window(&window)?;
    pause_date_index_background_job()?;
    let path = conversation_date_index_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let lock = CONVERSATION_DATE_INDEX_LOCK.get_or_init(|| Mutex::new(()));
        let _guard = lock
            .lock()
            .map_err(|_| "会话日期索引暂时不可用".to_string())?;
        if path.exists() {
            fs::remove_file(path).map_err(|error| format!("清除会话日期索引失败：{error}"))?;
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("清除会话日期索引任务异常结束：{error}"))?
}

pub(crate) fn index_conversation_sessions_impl(
    options: CodexSessionIndexOptions,
) -> Result<Vec<CodexSessionIndex>, String> {
    let activity_range =
        normalize_activity_date_range(options.date_from.as_deref(), options.date_to.as_deref())?;
    let cwd_query = options.cwd_query.unwrap_or_default().trim().to_lowercase();
    let keyword = options.keyword.unwrap_or_default().trim().to_lowercase();
    let limit = options.limit.unwrap_or(600).clamp(1, 2_000);
    let source_filter = filter_source_kinds(options.source_kinds);

    let mut result = Vec::new();
    for session in collect_conversation_sessions(source_filter.as_ref())? {
        if !session_matches_activity_range(
            &session,
            activity_range
                .as_ref()
                .and_then(|range| range.from.as_deref()),
            activity_range
                .as_ref()
                .and_then(|range| range.to.as_deref()),
        ) {
            continue;
        }

        let indexed = index_single_session(&session)?;

        if !cwd_query.is_empty() {
            let cwd = indexed.cwd.as_deref().unwrap_or("");
            if !indexed.path.to_lowercase().contains(&cwd_query)
                && !cwd.to_lowercase().contains(&cwd_query)
            {
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

fn scan_conversation_sessions_exact_impl(
    options: CodexSessionIndexOptions,
    job_id: Option<&str>,
    on_event: Option<Channel<ConversationSessionScanProgressEvent>>,
    index_path: &Path,
) -> Result<ConversationSessionScanResult, String> {
    let activity_range =
        normalize_activity_date_range(options.date_from.as_deref(), options.date_to.as_deref())?;
    let cwd_query = options.cwd_query.unwrap_or_default().trim().to_lowercase();
    let keyword = options.keyword.unwrap_or_default().trim().to_lowercase();
    let limit = options.limit.unwrap_or(600).clamp(1, 2_000);
    let source_filter = filter_source_kinds(options.source_kinds);
    let mut progress = ConversationScanProgressReporter::new(on_event);
    progress.emit("discovering", 0, 0, 0, 0, 0, 0, 0, true);
    let discovered_sessions = collect_conversation_sessions(source_filter.as_ref())?;
    let discovered_count = discovered_sessions.len();
    progress.emit("discovering", 0, 0, discovered_count, 0, 0, 0, 0, true);

    if activity_range.is_none() {
        let mut sessions = Vec::new();
        let mut inspected_count = 0usize;
        for (position, session) in discovered_sessions.into_iter().enumerate() {
            ensure_codex_job_not_cancelled(job_id)?;
            inspected_count = position + 1;
            let indexed = index_single_session(&session)?;
            if indexed_session_matches_queries(&indexed, &cwd_query, &keyword) {
                sessions.push(indexed);
            }
            progress.emit(
                "discovering",
                sessions.len(),
                inspected_count,
                discovered_count,
                0,
                0,
                sessions.len(),
                0,
                false,
            );
            if sessions.len() >= limit {
                break;
            }
        }
        sessions.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
        let count = sessions.len();
        progress.emit(
            "completed",
            count,
            inspected_count,
            discovered_count,
            0,
            0,
            count,
            0,
            true,
        );
        return Ok(ConversationSessionScanResult {
            sessions,
            candidate_count: count,
            excluded_count: 0,
            cache_hit_count: 0,
        });
    }

    let activity_range = activity_range.expect("date range checked above");
    let mut candidates = Vec::new();
    for (position, session) in discovered_sessions.into_iter().enumerate() {
        ensure_codex_job_not_cancelled(job_id)?;
        if !session_matches_activity_range(
            &session,
            activity_range.from.as_deref(),
            activity_range.to.as_deref(),
        ) {
            progress.emit(
                "discovering",
                candidates.len(),
                position + 1,
                discovered_count,
                0,
                0,
                0,
                0,
                false,
            );
            continue;
        }
        let indexed = index_single_session(&session)?;
        if indexed_session_matches_queries(&indexed, &cwd_query, &keyword) {
            candidates.push((session, indexed));
        }
        progress.emit(
            "discovering",
            candidates.len(),
            position + 1,
            discovered_count,
            0,
            0,
            0,
            0,
            false,
        );
    }

    let candidate_count = candidates.len();
    progress.emit(
        "candidates",
        candidate_count,
        0,
        candidate_count,
        0,
        0,
        0,
        0,
        true,
    );

    let lock = CONVERSATION_DATE_INDEX_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock
        .lock()
        .map_err(|_| "会话日期索引暂时不可用".to_string())?;
    let mut date_index = load_conversation_date_index(index_path);
    let range_key = activity_range_cache_key(&activity_range);
    let mut sessions = Vec::new();
    let mut cache_hit_count = 0usize;
    let mut excluded_count = 0usize;
    let mut processed_bytes_total = 0u64;

    for (position, (session, mut indexed)) in candidates.into_iter().enumerate() {
        ensure_codex_job_not_cancelled(job_id)?;
        let session_index = position + 1;
        let mut record = date_index.sessions.remove(&session.id).unwrap_or_default();
        let processed_bytes_before_session = processed_bytes_total;
        let mut preparation_bytes = 0u64;
        let unchanged = prepare_conversation_date_index_session(
            &session,
            &mut record,
            job_id,
            |processed_bytes| {
                preparation_bytes = processed_bytes;
                progress.emit(
                    "verifying",
                    candidate_count,
                    session_index,
                    candidate_count,
                    processed_bytes_before_session.saturating_add(processed_bytes),
                    cache_hit_count,
                    sessions.len(),
                    excluded_count,
                    false,
                );
            },
        )?;

        let range_entry = if unchanged {
            record.ranges.get(&range_key).cloned().or_else(|| {
                record.fully_indexed.then(|| {
                    range_entry_from_days(
                        &record.days,
                        &activity_range,
                        record.last_complete_line_offset,
                    )
                })
            })
        } else {
            None
        };
        let mut verification_bytes = 0u64;
        let range_entry = if let Some(entry) = range_entry {
            cache_hit_count += 1;
            entry
        } else {
            let entry = verify_session_activity_range(
                &session,
                &activity_range,
                job_id,
                &mut record.days,
                |processed_bytes| {
                    verification_bytes = processed_bytes;
                    progress.emit(
                        "verifying",
                        candidate_count,
                        session_index,
                        candidate_count,
                        processed_bytes_before_session
                            .saturating_add(preparation_bytes)
                            .saturating_add(processed_bytes),
                        cache_hit_count,
                        sessions.len(),
                        excluded_count,
                        false,
                    );
                },
            )?;
            record.ranges.insert(range_key.clone(), entry.clone());
            entry
        };

        if range_entry.matched {
            indexed.user_message_count = range_entry.user_message_count;
            indexed.assistant_message_count = range_entry.assistant_message_count;
            indexed.message_count = indexed
                .user_message_count
                .saturating_add(indexed.assistant_message_count);
            if sessions.len() < limit {
                sessions.push(indexed);
            }
        } else {
            excluded_count += 1;
        }

        processed_bytes_total = processed_bytes_before_session
            .saturating_add(preparation_bytes)
            .saturating_add(verification_bytes);
        date_index.sessions.insert(session.id.clone(), record);
        save_conversation_date_index(index_path, &date_index)?;
        progress.emit(
            "verifying",
            candidate_count,
            session_index,
            candidate_count,
            processed_bytes_total,
            cache_hit_count,
            sessions.len(),
            excluded_count,
            true,
        );
    }

    sessions.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    progress.emit(
        "completed",
        candidate_count,
        candidate_count,
        candidate_count,
        processed_bytes_total,
        cache_hit_count,
        sessions.len(),
        excluded_count,
        true,
    );
    Ok(ConversationSessionScanResult {
        sessions,
        candidate_count,
        excluded_count,
        cache_hit_count,
    })
}

fn indexed_session_matches_queries(
    indexed: &CodexSessionIndex,
    cwd_query: &str,
    keyword: &str,
) -> bool {
    if !cwd_query.is_empty() {
        let cwd = indexed.cwd.as_deref().unwrap_or("");
        if !indexed.path.to_lowercase().contains(cwd_query)
            && !cwd.to_lowercase().contains(cwd_query)
        {
            return false;
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
        if !searchable.contains(keyword) {
            return false;
        }
    }
    true
}

fn complete_conversation_date_index_impl(
    options: CodexSessionIndexOptions,
    job_id: Option<&str>,
    on_event: Option<Channel<ConversationSessionScanProgressEvent>>,
    index_path: &Path,
) -> Result<(), String> {
    let source_filter = filter_source_kinds(options.source_kinds);
    let sessions = collect_conversation_sessions(source_filter.as_ref())?;
    let session_count = sessions.len();
    let mut progress = ConversationScanProgressReporter::new(on_event);
    let lock = CONVERSATION_DATE_INDEX_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock
        .lock()
        .map_err(|_| "会话日期索引暂时不可用".to_string())?;
    let mut date_index = load_conversation_date_index(index_path);
    let mut processed_bytes_total = 0u64;

    for (position, session) in sessions.into_iter().enumerate() {
        ensure_codex_job_not_cancelled(job_id)?;
        let session_index = position + 1;
        let mut record = date_index.sessions.remove(&session.id).unwrap_or_default();
        let processed_bytes_before_session = processed_bytes_total;
        let mut preparation_bytes = 0u64;
        prepare_conversation_date_index_session(
            &session,
            &mut record,
            job_id,
            |processed_bytes| {
                preparation_bytes = processed_bytes;
                progress.emit(
                    "background",
                    session_count,
                    session_index,
                    session_count,
                    processed_bytes_before_session.saturating_add(processed_bytes),
                    0,
                    position,
                    0,
                    false,
                );
            },
        )?;
        let mut indexing_bytes = 0u64;
        if !record.fully_indexed {
            let start_offset = record.indexed_offset.min(record.last_complete_line_offset);
            if start_offset == 0 {
                record.days.clear();
                record.ranges.clear();
            }
            let complete_end = record.last_complete_line_offset;
            let mut last_checkpoint = start_offset;
            visit_complete_jsonl_lines(
                Path::new(&session.path),
                start_offset,
                complete_end,
                job_id,
                |offset, line_end, line| {
                    if let Some(identity) = session_message_identity_from_jsonl(&session, line) {
                        update_date_index_day(&mut record.days, &identity, offset, line_end);
                    }
                    record.indexed_offset = line_end;
                    if record.indexed_offset.saturating_sub(last_checkpoint)
                        >= CONVERSATION_DATE_INDEX_CHECKPOINT_BYTES
                    {
                        last_checkpoint = record.indexed_offset;
                        date_index
                            .sessions
                            .insert(session.id.clone(), record.clone());
                        save_conversation_date_index(index_path, &date_index)?;
                    }
                    Ok(true)
                },
                |processed_bytes| {
                    indexing_bytes = processed_bytes;
                    progress.emit(
                        "background",
                        session_count,
                        session_index,
                        session_count,
                        processed_bytes_before_session
                            .saturating_add(preparation_bytes)
                            .saturating_add(processed_bytes),
                        0,
                        position,
                        0,
                        false,
                    );
                },
            )?;
            record.indexed_offset = complete_end;
            record.fully_indexed = true;
        }
        processed_bytes_total = processed_bytes_before_session
            .saturating_add(preparation_bytes)
            .saturating_add(indexing_bytes);
        date_index.sessions.insert(session.id.clone(), record);
        save_conversation_date_index(index_path, &date_index)?;
        progress.emit(
            "background",
            session_count,
            session_index,
            session_count,
            processed_bytes_total,
            0,
            session_index,
            0,
            true,
        );
    }
    progress.emit(
        "completed",
        session_count,
        session_count,
        session_count,
        processed_bytes_total,
        0,
        session_count,
        0,
        true,
    );
    Ok(())
}

#[tauri::command]
pub(crate) async fn read_selected_codex_sessions(
    window: WebviewWindow,
    session_ids: Vec<String>,
    job_id: Option<String>,
    options: Option<ConversationSessionReadOptions>,
    on_event: Channel<ConversationReadProgressEvent>,
) -> Result<CodexReviewInput, String> {
    ensure_main_window(&window)?;
    pause_date_index_background_job()?;
    let mut source_filter = HashSet::new();
    source_filter.insert("codex".to_string());
    run_conversation_read_job(job_id.clone(), move || {
        read_selected_sessions_for_review(
            session_ids,
            job_id,
            Some(source_filter),
            options,
            Some(on_event),
        )
    })
    .await
}

#[tauri::command]
pub(crate) async fn read_selected_conversation_sessions(
    window: WebviewWindow,
    session_ids: Vec<String>,
    job_id: Option<String>,
    options: Option<ConversationSessionReadOptions>,
    on_event: Channel<ConversationReadProgressEvent>,
) -> Result<CodexReviewInput, String> {
    ensure_main_window(&window)?;
    pause_date_index_background_job()?;
    run_conversation_read_job(job_id.clone(), move || {
        read_selected_sessions_for_review(session_ids, job_id, None, options, Some(on_event))
    })
    .await
}

#[tauri::command]
pub(crate) async fn read_conversation_session_deltas(
    window: WebviewWindow,
    session_ids: Vec<String>,
    cursors: Option<Vec<ConversationSessionDeltaCursor>>,
    job_id: Option<String>,
    activity_date_from: Option<String>,
    activity_date_to: Option<String>,
) -> Result<Vec<ConversationSessionDelta>, String> {
    ensure_main_window(&window)?;
    pause_date_index_background_job()?;
    run_conversation_read_job(job_id.clone(), move || {
        let requested: HashSet<String> = session_ids
            .into_iter()
            .map(|id| id.trim().to_string())
            .filter(|id| !id.is_empty())
            .collect();
        if requested.is_empty() {
            return Ok(Vec::new());
        }

        let cursor_map: BTreeMap<String, u64> = cursors
            .unwrap_or_default()
            .into_iter()
            .map(|cursor| (cursor.session_id, cursor.read_offset))
            .collect();
        let activity_range = normalize_activity_date_range(
            activity_date_from.as_deref(),
            activity_date_to.as_deref(),
        )?;
        let mut sessions: Vec<_> = collect_conversation_sessions(None)?
            .into_iter()
            .filter(|session| requested.contains(&session.id))
            .collect();
        sessions.sort_by(|a, b| {
            a.started_date
                .cmp(&b.started_date)
                .then(a.modified_at.cmp(&b.modified_at))
        });

        let mut result = Vec::new();
        for session in sessions {
            ensure_codex_job_not_cancelled(job_id.as_deref())?;
            let offset = cursor_map.get(&session.id).copied().unwrap_or(0);
            result.push(read_session_delta(
                &session,
                offset,
                job_id.as_deref(),
                activity_range.as_ref(),
            )?);
        }
        Ok(result)
    })
    .await
}

async fn run_conversation_read_job<T, F>(job_id: Option<String>, task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    let result = tauri::async_runtime::spawn_blocking(task).await;
    let cleanup_result = clear_codex_job_if_needed(job_id.as_deref());
    match (result, cleanup_result) {
        (Ok(Ok(value)), Ok(())) => Ok(value),
        (Ok(Err(error)), _) => Err(error),
        (Err(error), _) => Err(format!("本地会话读取任务异常结束：{error}")),
        (Ok(Ok(_)), Err(error)) => Err(error),
    }
}

fn read_selected_sessions_for_review(
    session_ids: Vec<String>,
    job_id: Option<String>,
    source_filter: Option<HashSet<String>>,
    options: Option<ConversationSessionReadOptions>,
    on_event: Option<Channel<ConversationReadProgressEvent>>,
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
    sessions.sort_by(|a, b| {
        a.started_date
            .cmp(&b.started_date)
            .then(a.modified_at.cmp(&b.modified_at))
    });

    if sessions.is_empty() {
        return Err(
            "Selected sessions were not found. They may have been moved or deleted.".into(),
        );
    }

    let options = options.unwrap_or_default();
    let activity_range = normalize_activity_date_range(
        options.activity_date_from.as_deref(),
        options.activity_date_to.as_deref(),
    )?;
    let date = activity_range
        .as_ref()
        .and_then(ActivityDateRange::label)
        .unwrap_or_else(|| selected_sessions_date_label(&sessions));
    read_sessions_for_review(
        date,
        sessions,
        job_id.as_deref(),
        activity_range.as_ref(),
        on_event,
    )
}

#[tauri::command]
pub(crate) fn cancel_codex_review_job(window: WebviewWindow, job_id: String) -> Result<(), String> {
    ensure_main_window(&window)?;
    cancel_conversation_review_job_impl(job_id)
}

#[tauri::command]
pub(crate) fn cancel_conversation_review_job(
    window: WebviewWindow,
    job_id: String,
) -> Result<(), String> {
    ensure_main_window(&window)?;
    cancel_conversation_review_job_impl(job_id)
}

pub(crate) fn cancel_conversation_review_job_impl(job_id: String) -> Result<(), String> {
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
    activity_range: Option<&ActivityDateRange>,
    on_event: Option<Channel<ConversationReadProgressEvent>>,
) -> Result<CodexReviewInput, String> {
    let session_count = sessions.len();
    let mut progress = ConversationReadProgressReporter::new(on_event);
    let mut transcript = String::new();
    let mut redacted = false;
    let mut truncated = false;
    let mut transcript_chars = 0usize;
    let mut context_chars = 0usize;
    let mut selected_message_count = 0usize;
    let mut unscoped_message_count = 0usize;
    let mut skipped_oversized_record_count = 0usize;

    for (session_offset, session) in sessions.iter().enumerate() {
        let session_index = session_offset + 1;
        ensure_codex_job_not_cancelled(job_id)?;
        if transcript_chars >= CONVERSATION_REVIEW_MAX_TOTAL_CHARS {
            truncated = true;
            break;
        }

        let session_result = if let Some(range) = activity_range {
            append_scoped_session_transcript(
                session,
                &mut transcript,
                &mut transcript_chars,
                &mut context_chars,
                range,
                job_id,
                &mut progress,
                session_index,
                session_count,
            )?
        } else {
            append_session_transcript(
                session,
                &mut transcript,
                &mut transcript_chars,
                job_id,
                &mut progress,
                session_index,
                session_count,
            )?
        };
        redacted = redacted || session_result.redacted;
        truncated = truncated || session_result.truncated;
        selected_message_count += session_result.message_count;
        unscoped_message_count += session_result.unscoped_message_count;
        skipped_oversized_record_count += session_result.skipped_oversized_record_count;
        progress.emit(
            "completed",
            session_index,
            session_count,
            session.size_bytes,
            session.size_bytes,
            session_result.message_count,
            transcript_chars,
            true,
        );

        if transcript_chars >= CONVERSATION_REVIEW_MAX_TOTAL_CHARS {
            truncated = true;
            break;
        }
    }

    if truncated && !transcript.ends_with("[Content was truncated locally.]\n") {
        transcript.push_str("\n\n[Content was truncated locally.]\n");
    }

    if activity_range.is_some() && selected_message_count == 0 {
        let detail = if unscoped_message_count > 0 {
            "所选活动日期内没有可确认时间的消息；部分跨日旧消息缺少时间戳，未自动纳入回顾。"
        } else {
            "这些会话的活动区间覆盖所选日期，但实际消息中没有该日期的内容。"
        };
        return Err(detail.into());
    }

    let total_chars = transcript_chars.min(CONVERSATION_REVIEW_MAX_TOTAL_CHARS);
    let mut source_kinds = sessions
        .iter()
        .map(|session| session.source_kind.clone())
        .collect::<Vec<_>>();
    source_kinds.sort();
    source_kinds.dedup();
    let mut warnings = Vec::new();
    if unscoped_message_count > 0 {
        warnings.push(format!(
            "检测到 {} 条跨日会话消息缺少时间戳，未自动计入本次活动日期正文。",
            unscoped_message_count
        ));
    }
    if skipped_oversized_record_count > 0 {
        warnings.push(format!(
            "有 {} 条超过 32 MB 的单条会话记录未纳入本次回顾。",
            skipped_oversized_record_count
        ));
    }
    Ok(CodexReviewInput {
        date,
        activity_date_from: activity_range.and_then(|range| range.from.clone()),
        activity_date_to: activity_range.and_then(|range| range.to.clone()),
        activity_date_warning: (!warnings.is_empty()).then(|| warnings.join(" ")),
        review_kind: "source".into(),
        source_kinds,
        sessions,
        transcript_chunks: chunk_text(&transcript, CONVERSATION_REVIEW_CHUNK_CHARS),
        total_chars,
        redacted,
        truncated,
        skipped_oversized_record_count,
    })
}

struct SessionTranscriptResult {
    redacted: bool,
    truncated: bool,
    message_count: usize,
    unscoped_message_count: usize,
    skipped_oversized_record_count: usize,
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
    progress: &mut ConversationReadProgressReporter,
    session_index: usize,
    session_count: usize,
) -> Result<SessionTranscriptResult, String> {
    let file = fs::File::open(Path::new(&session.path))
        .map_err(|error| format!("无法读取会话：{}，{}", session.path, error))?;
    let mut reader = BufReader::new(file);
    let mut redacted = false;
    let mut truncated = false;
    let mut wrote_any = false;
    let mut message_count = 0usize;
    let mut raw_bytes = 0usize;
    let mut skipped_oversized_record_count = 0usize;

    let project_line = session_project_label(session)
        .map(|label| format!("项目：{}", label))
        .unwrap_or_default();
    let header = format!(
        "来源：{}\n会话：{}\n时间：{}\n{}\n",
        session.source_label, session.id, session.date, project_line
    );
    push_limited(output, output_chars, &header);

    progress.emit(
        "reading",
        session_index,
        session_count,
        0,
        session.size_bytes,
        0,
        *output_chars,
        true,
    );
    loop {
        let line = match read_limited_jsonl_line(&mut reader, job_id)? {
            LimitedJsonlLine::Eof | LimitedJsonlLine::Incomplete => break,
            LimitedJsonlLine::Oversized { raw_bytes: read } => {
                raw_bytes = raw_bytes.saturating_add(read as usize);
                skipped_oversized_record_count += 1;
                progress.emit(
                    "reading",
                    session_index,
                    session_count,
                    raw_bytes as u64,
                    session.size_bytes,
                    message_count,
                    *output_chars,
                    false,
                );
                if raw_bytes > CONVERSATION_REVIEW_MAX_SESSION_RAW_BYTES {
                    truncated = true;
                    break;
                }
                continue;
            }
            LimitedJsonlLine::Complete {
                bytes,
                raw_bytes: read,
            } => {
                raw_bytes = raw_bytes.saturating_add(read as usize);
                bytes
            }
        };
        if raw_bytes > CONVERSATION_REVIEW_MAX_SESSION_RAW_BYTES {
            truncated = true;
            break;
        }

        let Ok(value) = serde_json::from_slice::<Value>(&line) else {
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
            &format!(
                "\n[{}]\n{}\n",
                role_label(role, &session.source_kind),
                safe_text
            ),
        );
        wrote_any = true;
        message_count += 1;
        progress.emit(
            "reading",
            session_index,
            session_count,
            raw_bytes as u64,
            session.size_bytes,
            message_count,
            *output_chars,
            false,
        );

        if *output_chars >= CONVERSATION_REVIEW_MAX_TOTAL_CHARS {
            truncated = true;
            break;
        }
    }

    if wrote_any {
        push_limited(output, output_chars, "\n\n---\n\n");
    }

    Ok(SessionTranscriptResult {
        redacted,
        truncated,
        message_count,
        unscoped_message_count: 0,
        skipped_oversized_record_count,
    })
}

fn append_scoped_session_transcript(
    session: &CodexSessionMeta,
    output: &mut String,
    output_chars: &mut usize,
    context_chars: &mut usize,
    activity_range: &ActivityDateRange,
    job_id: Option<&str>,
    progress: &mut ConversationReadProgressReporter,
    session_index: usize,
    session_count: usize,
) -> Result<SessionTranscriptResult, String> {
    let Some(window) = locate_activity_window(
        session,
        activity_range,
        job_id,
        progress,
        session_index,
        session_count,
    )?
    else {
        return Ok(SessionTranscriptResult {
            redacted: false,
            truncated: false,
            message_count: 0,
            unscoped_message_count: 0,
            skipped_oversized_record_count: 0,
        });
    };
    let file = fs::File::open(Path::new(&session.path))
        .map_err(|error| format!("无法读取会话：{}，{}", session.path, error))?;
    let mut file = file;
    file.seek(SeekFrom::Start(window.context_start_offset))
        .map_err(|error| format!("定位会话活动日期失败：{}，{}", session.path, error))?;
    let reader = BufReader::new(file);
    let mut reader = reader;
    let mut prior_messages = Vec::new();
    let mut truncated = false;
    let mut redacted = false;
    let mut wrote_header = false;
    let mut message_count = 0usize;
    let mut unscoped_message_count = 0usize;
    let mut skipped_oversized_record_count = 0usize;
    let is_single_day = session.started_date == session.last_active_date;
    let read_total = window
        .target_end_offset
        .saturating_sub(window.context_start_offset);
    let mut current_offset = window.context_start_offset;

    progress.emit(
        "reading",
        session_index,
        session_count,
        0,
        read_total,
        0,
        *output_chars,
        true,
    );

    loop {
        ensure_codex_job_not_cancelled(job_id)?;
        if current_offset >= window.target_end_offset {
            break;
        }
        let line = match read_limited_jsonl_line(&mut reader, job_id)? {
            LimitedJsonlLine::Eof | LimitedJsonlLine::Incomplete => break,
            LimitedJsonlLine::Oversized { raw_bytes } => {
                current_offset = current_offset.saturating_add(raw_bytes);
                skipped_oversized_record_count += 1;
                progress.emit(
                    "reading",
                    session_index,
                    session_count,
                    current_offset.saturating_sub(window.context_start_offset),
                    read_total,
                    message_count,
                    *output_chars,
                    false,
                );
                continue;
            }
            LimitedJsonlLine::Complete { bytes, raw_bytes } => {
                current_offset = current_offset.saturating_add(raw_bytes);
                bytes
            }
        };
        if current_offset > window.target_end_offset {
            break;
        }

        let Some(message) = session_message_from_jsonl(session, &line) else {
            progress.emit(
                "reading",
                session_index,
                session_count,
                current_offset.saturating_sub(window.context_start_offset),
                read_total,
                message_count,
                *output_chars,
                false,
            );
            continue;
        };

        if is_message_before_activity_range(&message, activity_range) {
            prior_messages.push(message);
            continue;
        }

        if !is_message_in_activity_range(&message, session, activity_range, is_single_day) {
            if message.activity_date.is_none() {
                unscoped_message_count += 1;
            }
            continue;
        }

        if !wrote_header {
            let project_line = session_project_label(session)
                .map(|label| format!("项目：{}", label))
                .unwrap_or_default();
            let header = format!(
                "来源：{}\n会话：{}\n开始于：{}\n最后活动：{}\n{}\n",
                session.source_label,
                session.id,
                session.started_date,
                session.last_active_date,
                project_line
            );
            push_limited(output, output_chars, &header);
            append_limited_prior_context(
                output,
                output_chars,
                context_chars,
                &prior_messages,
                session,
                &mut redacted,
            );
            push_limited(
                output,
                output_chars,
                &format!(
                    "\n【本次活动日期：{}】\n",
                    activity_range
                        .label()
                        .unwrap_or_else(|| session.last_active_date.clone())
                ),
            );
            wrote_header = true;
        }

        let (safe_text, did_redact) = redact_sensitive_text(&message.text);
        redacted = redacted || did_redact;
        push_limited(
            output,
            output_chars,
            &format!(
                "\n[{}]\n{}\n",
                role_label(&message.role, &session.source_kind),
                safe_text
            ),
        );
        message_count += 1;
        progress.emit(
            "reading",
            session_index,
            session_count,
            current_offset.saturating_sub(window.context_start_offset),
            read_total,
            message_count,
            *output_chars,
            false,
        );
        if *output_chars >= CONVERSATION_REVIEW_MAX_TOTAL_CHARS {
            truncated = true;
            break;
        }
    }

    if wrote_header {
        push_limited(output, output_chars, "\n\n---\n\n");
    }

    Ok(SessionTranscriptResult {
        redacted,
        truncated,
        message_count,
        unscoped_message_count,
        skipped_oversized_record_count: skipped_oversized_record_count
            .max(window.skipped_oversized_record_count),
    })
}

fn append_limited_prior_context(
    output: &mut String,
    output_chars: &mut usize,
    context_chars: &mut usize,
    prior_messages: &[SessionMessage],
    session: &CodexSessionMeta,
    redacted: &mut bool,
) {
    if prior_messages.is_empty() || *context_chars >= CONVERSATION_REVIEW_CONTEXT_CHARS {
        return;
    }

    push_limited(
        output,
        output_chars,
        "\n【前序上下文，仅用于理解，不计入本次回顾】\n",
    );
    for message in prior_messages {
        if *context_chars >= CONVERSATION_REVIEW_CONTEXT_CHARS {
            break;
        }
        let (safe_text, did_redact) = redact_sensitive_text(&message.text);
        *redacted = *redacted || did_redact;
        let entry = format!(
            "\n[{}]\n{}\n",
            role_label(&message.role, &session.source_kind),
            safe_text
        );
        let remaining = CONVERSATION_REVIEW_CONTEXT_CHARS - *context_chars;
        let entry_chars = entry.chars().count();
        let clipped = if entry_chars > remaining {
            take_chars(&entry, remaining)
        } else {
            entry
        };
        *context_chars += clipped.chars().count();
        push_limited(output, output_chars, &clipped);
    }
}

fn session_message_from_jsonl(
    session: &CodexSessionMeta,
    raw_line: &[u8],
) -> Option<SessionMessage> {
    let line = std::str::from_utf8(raw_line).ok()?.trim();
    let value = serde_json::from_str::<Value>(line).ok()?;
    let extracted = if session.source_kind == "claude" {
        extract_claude_message(&value)
    } else {
        extract_codex_message(&value)
    }?;
    let text = extracted.1.trim();
    (!text.is_empty()).then(|| SessionMessage {
        role: extracted.0.to_string(),
        text: text.to_string(),
        activity_date: message_activity_date(&value),
    })
}

fn is_message_in_activity_range(
    message: &SessionMessage,
    session: &CodexSessionMeta,
    range: &ActivityDateRange,
    is_single_day: bool,
) -> bool {
    match message.activity_date.as_deref() {
        Some(date) => range.contains(date),
        None => is_single_day && range.contains(&session.last_active_date),
    }
}

fn is_message_before_activity_range(message: &SessionMessage, range: &ActivityDateRange) -> bool {
    message
        .activity_date
        .as_deref()
        .zip(range.from.as_deref())
        .is_some_and(|(date, from)| date < from)
}

fn locate_activity_window(
    session: &CodexSessionMeta,
    range: &ActivityDateRange,
    job_id: Option<&str>,
    progress: &mut ConversationReadProgressReporter,
    session_index: usize,
    session_count: usize,
) -> Result<Option<SessionActivityWindow>, String> {
    let path = Path::new(&session.path);
    let file_len = fs::metadata(path)
        .map_err(|error| format!("无法读取会话元信息：{}，{}", session.path, error))?
        .len();
    let is_single_day = session.started_date == session.last_active_date;
    if is_single_day && range.contains(&session.last_active_date) {
        progress.emit(
            "locating",
            session_index,
            session_count,
            file_len,
            file_len,
            0,
            0,
            true,
        );
        return Ok(Some(SessionActivityWindow {
            context_start_offset: 0,
            target_start_offset: 0,
            target_end_offset: file_len,
            skipped_oversized_record_count: 0,
        }));
    }

    let mut target_start_offset = None;
    let mut target_end_offset = range.to.is_none().then_some(file_len);
    let mut context_start_offset = range.from.is_none().then_some(0);
    let mut context_user_turns = 0usize;
    let mut found_target = false;
    progress.emit(
        "locating",
        session_index,
        session_count,
        0,
        file_len,
        0,
        0,
        true,
    );
    let skipped_oversized_record_count = visit_jsonl_lines_from_end(
        path,
        job_id,
        |offset, line_end, line| {
            let Some(message) = session_message_from_jsonl(session, line) else {
                return Ok(true);
            };
            let Some(date) = message.activity_date.as_deref() else {
                return Ok(true);
            };

            if range.contains(date) {
                found_target = true;
                if range.from.is_some() {
                    target_start_offset = Some(offset);
                }
                if target_end_offset.is_none() {
                    target_end_offset = Some(line_end);
                }
                return Ok(true);
            }

            if let Some(from) = range.from.as_deref() {
                if date < from && found_target && message.role == "user" {
                    context_user_turns += 1;
                    context_start_offset = Some(offset);
                    if context_user_turns >= CONVERSATION_REVIEW_CONTEXT_TURNS {
                        return Ok(false);
                    }
                } else if date < from && !found_target {
                    return Ok(false);
                }
            }
            Ok(true)
        },
        |processed_bytes, total_bytes| {
            progress.emit(
                "locating",
                session_index,
                session_count,
                processed_bytes,
                total_bytes,
                0,
                0,
                false,
            );
        },
    )?;

    if !found_target {
        return Ok(None);
    }

    let target_start_offset = target_start_offset.unwrap_or(0);
    Ok(Some(SessionActivityWindow {
        context_start_offset: context_start_offset.unwrap_or(target_start_offset),
        target_start_offset,
        target_end_offset: target_end_offset.unwrap_or(file_len),
        skipped_oversized_record_count,
    }))
}

fn visit_jsonl_lines_from_end<F, P>(
    path: &Path,
    job_id: Option<&str>,
    mut visitor: F,
    mut report_progress: P,
) -> Result<usize, String>
where
    F: FnMut(u64, u64, &[u8]) -> Result<bool, String>,
    P: FnMut(u64, u64),
{
    let mut file = fs::File::open(path)
        .map_err(|error| format!("无法读取会话：{}，{}", path.display(), error))?;
    let file_len = file
        .metadata()
        .map_err(|error| format!("无法读取会话元信息：{}，{}", path.display(), error))?
        .len();
    let mut position = file_len;
    let mut carry = Vec::new();
    let mut carry_is_oversized = false;
    let mut skipped_oversized_record_count = 0usize;

    while position > 0 {
        ensure_codex_job_not_cancelled(job_id)?;
        let start = position.saturating_sub(CONVERSATION_REVIEW_REVERSE_BLOCK_BYTES as u64);
        let read_len = (position - start) as usize;
        file.seek(SeekFrom::Start(start))
            .map_err(|error| format!("定位会话尾部失败：{}，{}", path.display(), error))?;
        let mut data = vec![0; read_len];
        file.read_exact(&mut data)
            .map_err(|error| format!("读取会话尾部失败：{}，{}", path.display(), error))?;
        if !carry_is_oversized {
            data.extend_from_slice(&carry);
        }

        let newlines = data
            .iter()
            .enumerate()
            .filter_map(|(index, byte)| (*byte == b'\n').then_some(index))
            .collect::<Vec<_>>();
        if newlines.is_empty() {
            if carry_is_oversized || data.len() > CONVERSATION_REVIEW_MAX_JSONL_LINE_BYTES {
                if !carry_is_oversized {
                    skipped_oversized_record_count += 1;
                }
                carry.clear();
                carry_is_oversized = true;
            } else {
                carry = data;
            }
            position = start;
            report_progress(file_len.saturating_sub(start), file_len);
            continue;
        }

        for index in (1..newlines.len()).rev() {
            let line_start = newlines[index - 1] + 1;
            let line_end = newlines[index];
            if line_start >= line_end {
                continue;
            }
            let line = &data[line_start..line_end];
            if line.len() > CONVERSATION_REVIEW_MAX_JSONL_LINE_BYTES {
                skipped_oversized_record_count += 1;
                continue;
            }
            if !visitor(start + line_start as u64, start + line_end as u64 + 1, line)? {
                report_progress(file_len.saturating_sub(start), file_len);
                return Ok(skipped_oversized_record_count);
            }
        }

        let first_newline = newlines[0];
        if start == 0 {
            if first_newline > 0 {
                let line = &data[..first_newline];
                if line.len() > CONVERSATION_REVIEW_MAX_JSONL_LINE_BYTES {
                    skipped_oversized_record_count += 1;
                } else if !visitor(0, first_newline as u64 + 1, line)? {
                    report_progress(file_len, file_len);
                    return Ok(skipped_oversized_record_count);
                }
            }
            report_progress(file_len, file_len);
            return Ok(skipped_oversized_record_count);
        }

        let prefix_len = first_newline + 1;
        if prefix_len > CONVERSATION_REVIEW_MAX_JSONL_LINE_BYTES {
            if !carry_is_oversized {
                skipped_oversized_record_count += 1;
            }
            carry.clear();
            carry_is_oversized = true;
        } else {
            carry = data[..prefix_len].to_vec();
            carry_is_oversized = false;
        }
        position = start;
        report_progress(file_len.saturating_sub(start), file_len);
    }

    Ok(skipped_oversized_record_count)
}

pub(crate) fn read_session_delta(
    session: &CodexSessionMeta,
    requested_offset: u64,
    job_id: Option<&str>,
    activity_range: Option<&ActivityDateRange>,
) -> Result<ConversationSessionDelta, String> {
    let path = Path::new(&session.path);
    let metadata = fs::metadata(path)
        .map_err(|error| format!("无法读取会话元信息：{}，{}", session.path, error))?;
    let file_len = metadata.len();
    let reset = requested_offset > file_len;
    let requested_offset = if reset { 0 } else { requested_offset };
    let mut previous_read_offset = requested_offset;
    let mut include_prior_context = false;
    let mut read_end_offset = file_len;
    let mut located_oversized_record_count = 0usize;

    if let Some(range) = activity_range {
        let mut progress = ConversationReadProgressReporter::new(None);
        let Some(window) = locate_activity_window(session, range, job_id, &mut progress, 1, 1)?
        else {
            return Ok(ConversationSessionDelta {
                session_id: session.id.clone(),
                source_kind: session.source_kind.clone(),
                source_label: session.source_label.clone(),
                date: session.date.clone(),
                started_date: session.started_date.clone(),
                last_active_date: session.last_active_date.clone(),
                path: session.path.clone(),
                previous_read_offset: requested_offset,
                next_read_offset: file_len,
                modified_at: metadata_millis(&metadata),
                context_transcript: String::new(),
                transcript: String::new(),
                char_count: 0,
                message_count: 0,
                redacted: false,
                truncated: false,
                reset,
                skipped_oversized_record_count: 0,
            });
        };
        read_end_offset = window.target_end_offset;
        located_oversized_record_count = window.skipped_oversized_record_count;

        if requested_offset < window.target_start_offset {
            previous_read_offset = window.context_start_offset;
            include_prior_context = previous_read_offset < window.target_start_offset;
        }
    }

    let mut file = fs::File::open(path)
        .map_err(|error| format!("无法读取会话：{}，{}", session.path, error))?;
    file.seek(SeekFrom::Start(previous_read_offset))
        .map_err(|error| format!("定位会话增量失败：{}，{}", session.path, error))?;
    let mut reader = BufReader::new(file);
    let mut next_read_offset = previous_read_offset;
    let mut transcript = String::new();
    let mut context_transcript = String::new();
    let mut char_count = 0usize;
    let mut context_chars = 0usize;
    let mut message_count = 0usize;
    let mut redacted = false;
    let mut truncated = false;
    let mut wrote_header = false;
    let is_single_day = session.started_date == session.last_active_date;
    let mut skipped_oversized_record_count = 0usize;

    loop {
        ensure_codex_job_not_cancelled(job_id)?;
        if next_read_offset >= read_end_offset {
            break;
        }
        let line_start = next_read_offset;
        let (line, line_end) = match read_limited_jsonl_line(&mut reader, job_id)? {
            LimitedJsonlLine::Eof | LimitedJsonlLine::Incomplete => break,
            LimitedJsonlLine::Oversized { raw_bytes } => {
                next_read_offset = line_start.saturating_add(raw_bytes).min(read_end_offset);
                skipped_oversized_record_count += 1;
                continue;
            }
            LimitedJsonlLine::Complete { bytes, raw_bytes } => {
                (bytes, line_start.saturating_add(raw_bytes))
            }
        };
        if line_end > read_end_offset {
            break;
        }
        let Some(message) = session_message_from_jsonl(session, &line) else {
            next_read_offset = line_end;
            continue;
        };

        if let Some(range) = activity_range {
            if include_prior_context && is_message_before_activity_range(&message, range) {
                append_delta_prior_context(
                    &mut context_transcript,
                    &mut context_chars,
                    session,
                    &message,
                    &mut redacted,
                );
                next_read_offset = line_end;
                continue;
            }
            if !is_message_in_activity_range(&message, session, range, is_single_day) {
                next_read_offset = line_end;
                continue;
            }
        }

        let (safe_text, did_redact) = redact_sensitive_text(&message.text);
        let entry = format!(
            "\n[{}]\n{}\n",
            role_label(&message.role, &session.source_kind),
            safe_text
        );
        if message_count > 0
            && char_count + entry.chars().count() > CONVERSATION_REVIEW_MAX_TOTAL_CHARS
        {
            truncated = true;
            break;
        }

        if !wrote_header {
            let project_line = session_project_label(session)
                .map(|label| format!("项目：{}", label))
                .unwrap_or_default();
            let header = format!(
                "来源：{}\n会话：{}\n开始于：{}\n最后活动：{}\n{}\n",
                session.source_label,
                session.id,
                session.started_date,
                session.last_active_date,
                project_line
            );
            push_limited(&mut transcript, &mut char_count, &header);
            wrote_header = true;
        }

        redacted = redacted || did_redact;
        push_limited(&mut transcript, &mut char_count, &entry);
        message_count += 1;
        next_read_offset = line_end;
    }

    Ok(ConversationSessionDelta {
        session_id: session.id.clone(),
        source_kind: session.source_kind.clone(),
        source_label: session.source_label.clone(),
        date: session.date.clone(),
        started_date: session.started_date.clone(),
        last_active_date: session.last_active_date.clone(),
        path: session.path.clone(),
        previous_read_offset,
        next_read_offset,
        modified_at: metadata_millis(&metadata),
        context_transcript,
        transcript,
        char_count,
        message_count,
        redacted,
        truncated,
        reset,
        skipped_oversized_record_count: skipped_oversized_record_count
            .max(located_oversized_record_count),
    })
}

fn append_delta_prior_context(
    output: &mut String,
    output_chars: &mut usize,
    session: &CodexSessionMeta,
    message: &SessionMessage,
    redacted: &mut bool,
) {
    if *output_chars >= CONVERSATION_REVIEW_CONTEXT_CHARS {
        return;
    }
    if output.is_empty() {
        output.push_str("【前序上下文，仅用于理解，不计入今日工作】\n");
    }
    let (safe_text, did_redact) = redact_sensitive_text(&message.text);
    *redacted = *redacted || did_redact;
    let entry = format!(
        "\n[{}]\n{}\n",
        role_label(&message.role, &session.source_kind),
        safe_text
    );
    let remaining = CONVERSATION_REVIEW_CONTEXT_CHARS - *output_chars;
    let clipped = if entry.chars().count() > remaining {
        take_chars(&entry, remaining)
    } else {
        entry
    };
    *output_chars += clipped.chars().count();
    output.push_str(&clipped);
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
    let guard = jobs.lock().map_err(|_| "取消状态不可用".to_string())?;
    if guard.contains(job_id) {
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
            size_bytes: if metadata.is_file() {
                Some(metadata.len())
            } else {
                None
            },
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

fn normalize_activity_date_range(
    from: Option<&str>,
    to: Option<&str>,
) -> Result<Option<ActivityDateRange>, String> {
    let mut from = normalize_optional_date(from)?;
    let mut to = normalize_optional_date(to)?;
    if from
        .as_deref()
        .is_some_and(|start| to.as_deref().is_some_and(|end| start > end))
    {
        std::mem::swap(&mut from, &mut to);
    }
    if from.is_none() && to.is_none() {
        Ok(None)
    } else {
        Ok(Some(ActivityDateRange { from, to }))
    }
}

fn session_matches_activity_range(
    session: &CodexSessionMeta,
    from: Option<&str>,
    to: Option<&str>,
) -> bool {
    !from.is_some_and(|start| session.last_active_date.as_str() < start)
        && !to.is_some_and(|end| session.started_date.as_str() > end)
}

fn conversation_date_index_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    Ok(directory.join(CONVERSATION_DATE_INDEX_FILE))
}

fn load_conversation_date_index(path: &Path) -> ConversationDateIndexV1 {
    let loaded = fs::read(path)
        .ok()
        .and_then(|contents| serde_json::from_slice::<ConversationDateIndexV1>(&contents).ok())
        .filter(|index| index.schema == CONVERSATION_DATE_INDEX_SCHEMA);
    loaded.unwrap_or_else(|| ConversationDateIndexV1 {
        schema: CONVERSATION_DATE_INDEX_SCHEMA.to_string(),
        sessions: BTreeMap::new(),
    })
}

fn save_conversation_date_index(
    path: &Path,
    index: &ConversationDateIndexV1,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建会话日期索引目录失败：{error}"))?;
    }
    let contents =
        serde_json::to_vec(index).map_err(|error| format!("序列化会话日期索引失败：{error}"))?;
    let temp_path = path.with_extension("json.tmp");
    {
        let mut file = fs::File::create(&temp_path)
            .map_err(|error| format!("写入会话日期索引失败：{error}"))?;
        use std::io::Write;
        file.write_all(&contents)
            .map_err(|error| format!("写入会话日期索引失败：{error}"))?;
        file.sync_all()
            .map_err(|error| format!("同步会话日期索引失败：{error}"))?;
    }
    replace_file_atomically(&temp_path, path)
        .map_err(|error| format!("提交会话日期索引失败：{error}"))
}

#[cfg(windows)]
fn replace_file_atomically(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;

    let source_wide = source
        .as_os_str()
        .encode_wide()
        .chain(once(0))
        .collect::<Vec<_>>();
    let destination_wide = destination
        .as_os_str()
        .encode_wide()
        .chain(once(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            destination_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file_atomically(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}

fn remember_date_index_background_job(job_id: Option<String>) -> Result<(), String> {
    let state = ACTIVE_DATE_INDEX_BACKGROUND_JOB.get_or_init(|| Mutex::new(None));
    *state
        .lock()
        .map_err(|_| "会话日期索引后台状态不可用".to_string())? = job_id;
    Ok(())
}

fn pause_date_index_background_job() -> Result<(), String> {
    let active = ACTIVE_DATE_INDEX_BACKGROUND_JOB
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| "会话日期索引后台状态不可用".to_string())?
        .clone();
    if let Some(job_id) = active {
        cancel_conversation_review_job_impl(job_id)?;
    }
    Ok(())
}

fn activity_range_cache_key(range: &ActivityDateRange) -> String {
    format!(
        "{}|{}",
        range.from.as_deref().unwrap_or(""),
        range.to.as_deref().unwrap_or("")
    )
}

fn activity_range_from_cache_key(value: &str) -> Option<ActivityDateRange> {
    let (from, to) = value.split_once('|')?;
    Some(ActivityDateRange {
        from: (!from.is_empty()).then(|| from.to_string()),
        to: (!to.is_empty()).then(|| to.to_string()),
    })
}

fn conversation_file_head_fingerprint(path: &Path, byte_limit: u64) -> Result<u64, String> {
    let mut file =
        fs::File::open(path).map_err(|error| format!("无法读取会话校验信息：{error}"))?;
    let mut buffer = vec![0u8; byte_limit.min(CONVERSATION_DATE_INDEX_HEAD_BYTES as u64) as usize];
    let read = file
        .read(&mut buffer)
        .map_err(|error| format!("无法读取会话校验信息：{error}"))?;
    let mut hash = 0xcbf29ce484222325u64;
    for byte in &buffer[..read] {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    Ok(hash)
}

fn last_complete_jsonl_offset(path: &Path, file_len: u64) -> Result<u64, String> {
    if file_len == 0 {
        return Ok(0);
    }
    let mut file = fs::File::open(path).map_err(|error| format!("无法读取会话尾部：{error}"))?;
    let mut position = file_len;
    while position > 0 {
        let start = position.saturating_sub(CONVERSATION_REVIEW_REVERSE_BLOCK_BYTES as u64);
        let mut buffer = vec![0u8; (position - start) as usize];
        file.seek(SeekFrom::Start(start))
            .map_err(|error| format!("无法定位会话尾部：{error}"))?;
        file.read_exact(&mut buffer)
            .map_err(|error| format!("无法读取会话尾部：{error}"))?;
        if position == file_len && buffer.last() == Some(&b'\n') {
            return Ok(file_len);
        }
        if let Some(index) = buffer.iter().rposition(|byte| *byte == b'\n') {
            return Ok(start + index as u64 + 1);
        }
        position = start;
    }
    Ok(0)
}

fn prepare_conversation_date_index_session<F>(
    session: &CodexSessionMeta,
    record: &mut ConversationDateIndexSessionV1,
    job_id: Option<&str>,
    mut on_progress: F,
) -> Result<bool, String>
where
    F: FnMut(u64),
{
    let path = Path::new(&session.path);
    let metadata = fs::metadata(path).map_err(|error| format!("无法读取会话元信息：{error}"))?;
    let file_size = metadata.len();
    let modified_at = metadata_millis(&metadata);
    let previous_fingerprint_bytes = if record.head_fingerprint_bytes > 0 {
        record.head_fingerprint_bytes
    } else {
        record
            .file_size
            .min(CONVERSATION_DATE_INDEX_HEAD_BYTES as u64)
    };
    let comparison_fingerprint =
        conversation_file_head_fingerprint(path, previous_fingerprint_bytes)?;
    let complete_offset = last_complete_jsonl_offset(path, file_size)?;
    let is_existing = record.source_kind == session.source_kind
        && record.head_fingerprint == comparison_fingerprint
        && record.file_size <= file_size
        && !record.source_kind.is_empty();

    if is_existing && record.file_size == file_size && record.modified_at == modified_at {
        return Ok(true);
    }

    if is_existing && file_size > record.file_size {
        let append_start = record.last_complete_line_offset.min(complete_offset);
        visit_complete_jsonl_lines(
            path,
            append_start,
            complete_offset,
            job_id,
            |offset, line_end, line| {
                if let Some(identity) = session_message_identity_from_jsonl(session, line) {
                    update_date_index_day(&mut record.days, &identity, offset, line_end);
                    for (key, entry) in &mut record.ranges {
                        if activity_range_from_cache_key(key)
                            .is_some_and(|range| range.contains(&identity.activity_date))
                        {
                            update_date_index_range(entry, &identity, offset, line_end);
                        }
                    }
                }
                record.indexed_offset = line_end;
                Ok(true)
            },
            |processed_bytes| on_progress(processed_bytes),
        )?;
        let appended_bytes = complete_offset.saturating_sub(append_start);
        for entry in record.ranges.values_mut() {
            entry.checked_bytes = entry.checked_bytes.saturating_add(appended_bytes);
        }
        record.file_size = file_size;
        record.modified_at = modified_at;
        record.head_fingerprint_bytes = file_size.min(CONVERSATION_DATE_INDEX_HEAD_BYTES as u64);
        record.head_fingerprint =
            conversation_file_head_fingerprint(path, record.head_fingerprint_bytes)?;
        record.last_complete_line_offset = complete_offset;
        if record.fully_indexed {
            record.indexed_offset = complete_offset;
        }
        return Ok(true);
    }

    let head_fingerprint_bytes = file_size.min(CONVERSATION_DATE_INDEX_HEAD_BYTES as u64);
    *record = ConversationDateIndexSessionV1 {
        source_kind: session.source_kind.clone(),
        file_size,
        modified_at,
        head_fingerprint: conversation_file_head_fingerprint(path, head_fingerprint_bytes)?,
        head_fingerprint_bytes,
        last_complete_line_offset: complete_offset,
        fully_indexed: false,
        indexed_offset: 0,
        days: BTreeMap::new(),
        ranges: BTreeMap::new(),
    };
    Ok(false)
}

fn session_message_identity_from_jsonl(
    session: &CodexSessionMeta,
    raw_line: &[u8],
) -> Option<SessionMessageIdentity> {
    let line = std::str::from_utf8(raw_line).ok()?.trim();
    let value = serde_json::from_str::<Value>(line).ok()?;
    let extracted = if session.source_kind == "claude" {
        extract_claude_message(&value)
    } else {
        extract_codex_message(&value)
    }?;
    if extracted.1.trim().is_empty() {
        return None;
    }
    Some(SessionMessageIdentity {
        role: extracted.0.to_string(),
        activity_date: message_activity_date(&value)?,
    })
}

fn update_date_index_day(
    days: &mut BTreeMap<String, ConversationDateIndexDayV1>,
    identity: &SessionMessageIdentity,
    offset: u64,
    line_end: u64,
) {
    let entry = days.entry(identity.activity_date.clone()).or_default();
    if entry.first_offset == 0 || offset < entry.first_offset {
        entry.first_offset = offset;
    }
    entry.last_offset = entry.last_offset.max(line_end);
    if identity.role == "user" {
        entry.user_message_count += 1;
    } else if identity.role == "assistant" {
        entry.assistant_message_count += 1;
    }
}

fn update_date_index_range(
    entry: &mut ConversationDateIndexRangeV1,
    identity: &SessionMessageIdentity,
    offset: u64,
    line_end: u64,
) {
    entry.matched = true;
    entry.first_offset = Some(
        entry
            .first_offset
            .map_or(offset, |current| current.min(offset)),
    );
    entry.last_offset = Some(
        entry
            .last_offset
            .map_or(line_end, |current| current.max(line_end)),
    );
    if identity.role == "user" {
        entry.user_message_count += 1;
    } else if identity.role == "assistant" {
        entry.assistant_message_count += 1;
    }
}

fn range_entry_from_days(
    days: &BTreeMap<String, ConversationDateIndexDayV1>,
    range: &ActivityDateRange,
    checked_bytes: u64,
) -> ConversationDateIndexRangeV1 {
    let mut entry = ConversationDateIndexRangeV1 {
        checked_bytes,
        ..Default::default()
    };
    for (date, day) in days {
        if !range.contains(date) {
            continue;
        }
        entry.matched = true;
        entry.first_offset = Some(
            entry
                .first_offset
                .map_or(day.first_offset, |current| current.min(day.first_offset)),
        );
        entry.last_offset = Some(
            entry
                .last_offset
                .map_or(day.last_offset, |current| current.max(day.last_offset)),
        );
        entry.user_message_count += day.user_message_count;
        entry.assistant_message_count += day.assistant_message_count;
    }
    entry
}

fn verify_session_activity_range<F>(
    session: &CodexSessionMeta,
    range: &ActivityDateRange,
    job_id: Option<&str>,
    days: &mut BTreeMap<String, ConversationDateIndexDayV1>,
    mut on_progress: F,
) -> Result<ConversationDateIndexRangeV1, String>
where
    F: FnMut(u64),
{
    let path = Path::new(&session.path);
    let file_len = fs::metadata(path)
        .map_err(|error| format!("无法读取会话元信息：{error}"))?
        .len();
    let complete_end = last_complete_jsonl_offset(path, file_len)?;
    let mut entry = ConversationDateIndexRangeV1::default();
    let mut checked_bytes = 0u64;

    if range.from.is_none() {
        visit_complete_jsonl_lines(
            path,
            0,
            complete_end,
            job_id,
            |offset, line_end, line| {
                if let Some(identity) = session_message_identity_from_jsonl(session, line) {
                    update_date_index_day(days, &identity, offset, line_end);
                    if range.contains(&identity.activity_date) {
                        update_date_index_range(&mut entry, &identity, offset, line_end);
                    } else if range
                        .to
                        .as_deref()
                        .is_some_and(|to| identity.activity_date.as_str() > to)
                    {
                        return Ok(false);
                    }
                }
                Ok(true)
            },
            |processed_bytes| {
                checked_bytes = processed_bytes;
                on_progress(processed_bytes);
            },
        )?;
    } else {
        visit_jsonl_lines_from_end(
            path,
            job_id,
            |offset, line_end, line| {
                let Some(identity) = session_message_identity_from_jsonl(session, line) else {
                    return Ok(true);
                };
                update_date_index_day(days, &identity, offset, line_end);
                if range.contains(&identity.activity_date) {
                    update_date_index_range(&mut entry, &identity, offset, line_end);
                    return Ok(true);
                }
                if range
                    .from
                    .as_deref()
                    .is_some_and(|from| identity.activity_date.as_str() < from)
                {
                    return Ok(false);
                }
                Ok(true)
            },
            |processed_bytes, _| {
                checked_bytes = processed_bytes;
                on_progress(processed_bytes);
            },
        )?;
    }
    entry.checked_bytes = checked_bytes;
    Ok(entry)
}

fn visit_complete_jsonl_lines<F, P>(
    path: &Path,
    start_offset: u64,
    end_offset: u64,
    job_id: Option<&str>,
    mut visitor: F,
    mut on_progress: P,
) -> Result<usize, String>
where
    F: FnMut(u64, u64, &[u8]) -> Result<bool, String>,
    P: FnMut(u64),
{
    let mut file = fs::File::open(path).map_err(|error| format!("无法读取会话：{error}"))?;
    file.seek(SeekFrom::Start(start_offset))
        .map_err(|error| format!("无法定位会话内容：{error}"))?;
    let mut reader = BufReader::new(file);
    let mut offset = start_offset;
    let mut skipped = 0usize;
    loop {
        ensure_codex_job_not_cancelled(job_id)?;
        if offset >= end_offset {
            break;
        }
        match read_limited_jsonl_line(&mut reader, job_id)? {
            LimitedJsonlLine::Eof | LimitedJsonlLine::Incomplete => break,
            LimitedJsonlLine::Oversized { raw_bytes } => {
                offset = offset.saturating_add(raw_bytes);
                skipped += 1;
            }
            LimitedJsonlLine::Complete { bytes, raw_bytes } => {
                let line_end = offset.saturating_add(raw_bytes);
                if line_end > end_offset {
                    break;
                }
                if !visitor(offset, line_end, &bytes)? {
                    offset = line_end;
                    on_progress(offset.saturating_sub(start_offset));
                    break;
                }
                offset = line_end;
            }
        }
        on_progress(offset.saturating_sub(start_offset));
    }
    Ok(skipped)
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
        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        let modified_at = metadata_millis(&metadata);
        let started_date =
            infer_session_date(&path).unwrap_or_else(|| millis_to_china_date(modified_at));
        let last_active_date = millis_to_china_date(modified_at);
        sessions.push(CodexSessionMeta {
            id: stable_session_id(&path),
            source_kind: "codex".into(),
            source_label: "Codex".into(),
            date: started_date.clone(),
            started_date,
            last_active_date,
            path: path.to_string_lossy().into_owned(),
            size_bytes: metadata.len(),
            modified_at,
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
        let started_date =
            millis_to_china_date(metadata_created_millis(&metadata).unwrap_or(modified_at));
        let last_active_date = millis_to_china_date(modified_at);
        sessions.push(CodexSessionMeta {
            id: stable_source_session_id("claude", &path),
            source_kind: "claude".into(),
            source_label: "Claude Code".into(),
            date: started_date.clone(),
            started_date,
            last_active_date,
            path: path.to_string_lossy().into_owned(),
            size_bytes: metadata.len(),
            modified_at,
            cwd: infer_claude_project_cwd(&root, &path),
        });
    }

    sessions.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(sessions)
}

fn collect_conversation_sessions(
    source_filter: Option<&HashSet<String>>,
) -> Result<Vec<CodexSessionMeta>, String> {
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
        started_date: session.started_date.clone(),
        last_active_date: session.last_active_date.clone(),
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

    if first.last_active_date == last.last_active_date {
        first.last_active_date.clone()
    } else {
        format!("{} ~ {}", first.last_active_date, last.last_active_date)
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

fn metadata_created_millis(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .created()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
}

fn message_activity_date(value: &Value) -> Option<String> {
    let timestamp = value.get("timestamp")?.as_str()?.trim();
    let parsed = OffsetDateTime::parse(timestamp, &Rfc3339).ok()?;
    let china_offset = UtcOffset::from_hms(8, 0, 0).ok()?;
    let date = parsed.to_offset(china_offset).date();
    Some(format!(
        "{:04}-{:02}-{:02}",
        date.year(),
        u8::from(date.month()),
        date.day()
    ))
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
    let role = message
        .get("role")
        .and_then(Value::as_str)
        .unwrap_or(entry_type);
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};

    fn session(started_date: &str, last_active_date: &str) -> CodexSessionMeta {
        CodexSessionMeta {
            id: "test-session".into(),
            source_kind: "codex".into(),
            source_label: "Codex".into(),
            date: started_date.into(),
            started_date: started_date.into(),
            last_active_date: last_active_date.into(),
            path: String::new(),
            size_bytes: 0,
            modified_at: 0,
            cwd: None,
        }
    }

    #[test]
    fn activity_range_finds_sessions_that_overlap_the_selected_day() {
        let cross_day = session("2026-07-13", "2026-07-14");
        assert!(session_matches_activity_range(
            &cross_day,
            Some("2026-07-14"),
            Some("2026-07-14")
        ));
        assert!(!session_matches_activity_range(
            &cross_day,
            Some("2026-07-15"),
            Some("2026-07-15")
        ));
    }

    #[test]
    fn rfc3339_timestamp_uses_china_local_date() {
        let value: Value = serde_json::from_str(r#"{"timestamp":"2026-07-13T16:30:00Z"}"#).unwrap();
        assert_eq!(message_activity_date(&value).as_deref(), Some("2026-07-14"));
    }

    #[test]
    fn exact_activity_check_excludes_envelope_only_candidate() {
        let path = std::env::temp_dir().join(format!(
            "daymark-date-index-envelope-only-{}.jsonl",
            std::process::id()
        ));
        let before = r#"{"timestamp":"2026-07-12T09:00:00+08:00","payload":{"type":"message","role":"user","content":[{"text":"before"}]}}"#;
        let after = r#"{"timestamp":"2026-07-14T09:00:00+08:00","payload":{"type":"message","role":"assistant","content":[{"text":"after"}]}}"#;
        fs::write(&path, format!("{before}\n{after}\n")).unwrap();
        let mut test_session = session("2026-07-12", "2026-07-14");
        test_session.path = path.to_string_lossy().into_owned();
        let range = ActivityDateRange {
            from: Some("2026-07-13".into()),
            to: Some("2026-07-13".into()),
        };
        let mut days = BTreeMap::new();

        let result =
            verify_session_activity_range(&test_session, &range, None, &mut days, |_| {}).unwrap();

        assert!(!result.matched);
        assert_eq!(result.user_message_count, 0);
        assert_eq!(result.assistant_message_count, 0);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn exact_activity_check_counts_extractable_messages() {
        let path = std::env::temp_dir().join(format!(
            "daymark-date-index-exact-hit-{}.jsonl",
            std::process::id()
        ));
        let user = r#"{"timestamp":"2026-07-13T09:00:00+08:00","payload":{"type":"message","role":"user","content":[{"text":"question"}]}}"#;
        let assistant = r#"{"timestamp":"2026-07-13T09:01:00+08:00","payload":{"type":"message","role":"assistant","content":[{"text":"answer"}]}}"#;
        fs::write(&path, format!("{user}\n{assistant}\n")).unwrap();
        let mut test_session = session("2026-07-13", "2026-07-13");
        test_session.path = path.to_string_lossy().into_owned();
        let range = ActivityDateRange {
            from: Some("2026-07-13".into()),
            to: Some("2026-07-13".into()),
        };
        let mut days = BTreeMap::new();

        let result =
            verify_session_activity_range(&test_session, &range, None, &mut days, |_| {}).unwrap();

        assert!(result.matched);
        assert_eq!(result.user_message_count, 1);
        assert_eq!(result.assistant_message_count, 1);
        assert_eq!(days.get("2026-07-13").unwrap().user_message_count, 1);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn appended_session_only_indexes_the_new_complete_tail() {
        let path = std::env::temp_dir().join(format!(
            "daymark-date-index-append-{}.jsonl",
            std::process::id()
        ));
        let first = r#"{"timestamp":"2026-07-13T09:00:00+08:00","payload":{"type":"message","role":"user","content":[{"text":"first"}]}}"#;
        fs::write(&path, format!("{first}\n")).unwrap();
        let mut test_session = session("2026-07-13", "2026-07-14");
        test_session.path = path.to_string_lossy().into_owned();
        let mut record = ConversationDateIndexSessionV1::default();
        assert!(
            !prepare_conversation_date_index_session(&test_session, &mut record, None, |_| {})
                .unwrap()
        );
        let initial_end = record.last_complete_line_offset;
        record.indexed_offset = initial_end;
        record.fully_indexed = true;
        update_date_index_day(
            &mut record.days,
            &SessionMessageIdentity {
                role: "user".into(),
                activity_date: "2026-07-13".into(),
            },
            0,
            initial_end,
        );

        let second = r#"{"timestamp":"2026-07-14T09:00:00+08:00","payload":{"type":"message","role":"assistant","content":[{"text":"second"}]}}"#;
        let mut file = fs::OpenOptions::new().append(true).open(&path).unwrap();
        file.write_all(format!("{second}\n").as_bytes()).unwrap();
        file.flush().unwrap();

        assert!(
            prepare_conversation_date_index_session(&test_session, &mut record, None, |_| {})
                .unwrap()
        );
        assert_eq!(record.days.get("2026-07-13").unwrap().user_message_count, 1);
        assert_eq!(
            record
                .days
                .get("2026-07-14")
                .unwrap()
                .assistant_message_count,
            1
        );
        assert_eq!(record.indexed_offset, record.last_complete_line_offset);
        assert!(record.last_complete_line_offset > initial_end);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn date_index_serialization_contains_only_rebuildable_metadata() {
        let mut index = ConversationDateIndexV1 {
            schema: CONVERSATION_DATE_INDEX_SCHEMA.into(),
            sessions: BTreeMap::new(),
        };
        let mut record = ConversationDateIndexSessionV1 {
            source_kind: "codex".into(),
            file_size: 128,
            modified_at: 42,
            head_fingerprint: 99,
            head_fingerprint_bytes: 128,
            last_complete_line_offset: 128,
            fully_indexed: true,
            indexed_offset: 128,
            days: BTreeMap::new(),
            ranges: BTreeMap::new(),
        };
        record.days.insert(
            "2026-07-13".into(),
            ConversationDateIndexDayV1 {
                first_offset: 0,
                last_offset: 128,
                user_message_count: 1,
                assistant_message_count: 1,
            },
        );
        index
            .sessions
            .insert("codex-session-safe-id".into(), record);

        let serialized = serde_json::to_string(&index).unwrap();
        assert!(!serialized.contains("question"));
        assert!(!serialized.contains("C:\\Users"));
        assert!(!serialized.contains("api-key"));
        assert!(serialized.contains("codex-session-safe-id"));
        assert!(serialized.contains("2026-07-13"));
    }

    #[test]
    fn review_chunks_cap_even_a_single_long_line_at_eight_thousand_chars() {
        let chunks = chunk_text(
            &"x".repeat(CONVERSATION_REVIEW_CHUNK_CHARS + 1),
            CONVERSATION_REVIEW_CHUNK_CHARS,
        );
        assert_eq!(chunks.len(), 2);
        assert!(chunks
            .iter()
            .all(|chunk| chunk.chars().count() <= CONVERSATION_REVIEW_CHUNK_CHARS));
    }

    #[test]
    fn scoped_read_keeps_today_and_limited_prior_context() {
        let path = std::env::temp_dir().join(format!(
            "daymark-scoped-review-{}.jsonl",
            std::process::id()
        ));
        let prior = r#"{"timestamp":"2026-07-13T10:00:00+08:00","payload":{"type":"message","role":"user","content":[{"text":"昨天的背景"}]}}"#;
        let today = r#"{"timestamp":"2026-07-14T09:00:00+08:00","payload":{"type":"message","role":"assistant","content":[{"text":"今天完成的工作"}]}}"#;
        fs::write(&path, format!("{prior}\n{today}\n")).unwrap();
        let mut test_session = session("2026-07-13", "2026-07-14");
        test_session.path = path.to_string_lossy().into_owned();
        let range = ActivityDateRange {
            from: Some("2026-07-14".into()),
            to: Some("2026-07-14".into()),
        };
        let mut output = String::new();
        let mut output_chars = 0;
        let mut context_chars = 0;
        let mut progress = ConversationReadProgressReporter::new(None);

        let result = append_scoped_session_transcript(
            &test_session,
            &mut output,
            &mut output_chars,
            &mut context_chars,
            &range,
            None,
            &mut progress,
            1,
            1,
        )
        .unwrap();

        assert_eq!(result.message_count, 1);
        assert!(output.contains("【前序上下文，仅用于理解，不计入本次回顾】"));
        assert!(output.contains("昨天的背景"));
        assert!(output.contains("【本次活动日期：2026-07-14】"));
        assert!(output.contains("今天完成的工作"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn scoped_delta_advances_past_yesterday_without_repeating_it_today() {
        let path =
            std::env::temp_dir().join(format!("daymark-scoped-delta-{}.jsonl", std::process::id()));
        let yesterday = r#"{"timestamp":"2026-07-13T23:59:00+08:00","payload":{"type":"message","role":"user","content":[{"text":"昨天内容"}]}}"#;
        let today = r#"{"timestamp":"2026-07-14T00:01:00+08:00","payload":{"type":"message","role":"assistant","content":[{"text":"今天增量"}]}}"#;
        let contents = format!("{yesterday}\n{today}\n");
        fs::write(&path, &contents).unwrap();
        let mut test_session = session("2026-07-13", "2026-07-14");
        test_session.path = path.to_string_lossy().into_owned();
        let range = ActivityDateRange {
            from: Some("2026-07-14".into()),
            to: Some("2026-07-14".into()),
        };

        let delta = read_session_delta(&test_session, 0, None, Some(&range)).unwrap();

        assert_eq!(delta.message_count, 1);
        assert!(delta.transcript.contains("今天增量"));
        assert!(!delta.transcript.contains("昨天内容"));
        assert_eq!(delta.next_read_offset, contents.len() as u64);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn large_cross_day_session_reads_today_from_the_tail() {
        let path =
            std::env::temp_dir().join(format!("daymark-tail-review-{}.jsonl", std::process::id()));
        let huge_history = "x".repeat(CONVERSATION_REVIEW_MAX_SESSION_RAW_BYTES + 128);
        let old = format!(
            r#"{{"timestamp":"2026-07-10T09:00:00+08:00","payload":{{"type":"message","role":"assistant","content":[{{"text":"{}"}}]}}}}"#,
            huge_history
        );
        let prior_user = r#"{"timestamp":"2026-07-13T10:00:00+08:00","payload":{"type":"message","role":"user","content":[{"text":"prior question"}]}}"#;
        let prior_assistant = r#"{"timestamp":"2026-07-13T10:01:00+08:00","payload":{"type":"message","role":"assistant","content":[{"text":"prior answer"}]}}"#;
        let today = r#"{"timestamp":"2026-07-14T09:00:00+08:00","payload":{"type":"message","role":"assistant","content":[{"text":"today tail activity"}]}}"#;
        let mut file = fs::File::create(&path).unwrap();
        file.write_all(old.as_bytes()).unwrap();
        file.write_all(b"\n").unwrap();
        file.write_all(prior_user.as_bytes()).unwrap();
        file.write_all(b"\n").unwrap();
        file.write_all(prior_assistant.as_bytes()).unwrap();
        file.write_all(b"\n").unwrap();
        file.write_all(today.as_bytes()).unwrap();
        file.write_all(b"\n").unwrap();
        file.flush().unwrap();

        let mut test_session = session("2026-07-10", "2026-07-14");
        test_session.path = path.to_string_lossy().into_owned();
        let range = ActivityDateRange {
            from: Some("2026-07-14".into()),
            to: Some("2026-07-14".into()),
        };

        let mut output = String::new();
        let mut output_chars = 0;
        let mut context_chars = 0;
        let mut progress = ConversationReadProgressReporter::new(None);
        let review = append_scoped_session_transcript(
            &test_session,
            &mut output,
            &mut output_chars,
            &mut context_chars,
            &range,
            None,
            &mut progress,
            1,
            1,
        )
        .unwrap();
        let delta = read_session_delta(&test_session, 0, None, Some(&range)).unwrap();

        assert_eq!(review.message_count, 1);
        assert!(output.contains("today tail activity"));
        assert!(output.contains("prior question"));
        assert!(!output.contains(&huge_history[..128]));
        assert!(delta.previous_read_offset > CONVERSATION_REVIEW_MAX_SESSION_RAW_BYTES as u64);
        assert!(delta.context_transcript.contains("prior question"));
        assert!(delta.transcript.contains("today tail activity"));
        assert_eq!(delta.next_read_offset, fs::metadata(&path).unwrap().len());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn scoped_read_stops_at_the_selected_date_end() {
        let path =
            std::env::temp_dir().join(format!("daymark-scoped-end-{}.jsonl", std::process::id()));
        let prior = r#"{"timestamp":"2026-07-13T09:00:00+08:00","payload":{"type":"message","role":"user","content":[{"text":"prior context"}]}}"#;
        let target = r#"{"timestamp":"2026-07-14T09:00:00+08:00","payload":{"type":"message","role":"assistant","content":[{"text":"selected day"}]}}"#;
        let future = r#"{"timestamp":"2026-07-15T09:00:00+08:00","payload":{"type":"message","role":"assistant","content":[{"text":"future day"}]}}"#;
        let contents = format!("{prior}\n{target}\n{future}\n");
        fs::write(&path, &contents).unwrap();

        let mut test_session = session("2026-07-13", "2026-07-15");
        test_session.path = path.to_string_lossy().into_owned();
        test_session.size_bytes = contents.len() as u64;
        let range = ActivityDateRange {
            from: Some("2026-07-14".into()),
            to: Some("2026-07-14".into()),
        };
        let expected_end = format!("{prior}\n{target}\n").len() as u64;
        let mut output = String::new();
        let mut output_chars = 0;
        let mut context_chars = 0;
        let mut progress = ConversationReadProgressReporter::new(None);

        let review = append_scoped_session_transcript(
            &test_session,
            &mut output,
            &mut output_chars,
            &mut context_chars,
            &range,
            None,
            &mut progress,
            1,
            1,
        )
        .unwrap();
        let delta = read_session_delta(&test_session, 0, None, Some(&range)).unwrap();

        assert_eq!(review.message_count, 1);
        assert!(output.contains("selected day"));
        assert!(!output.contains("future day"));
        assert_eq!(delta.next_read_offset, expected_end);
        assert!(delta.next_read_offset < contents.len() as u64);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn bounded_jsonl_reader_skips_oversized_lines_without_retaining_them() {
        let oversized = format!("{}\n", "x".repeat(80));
        let mut reader = BufReader::new(Cursor::new(format!("{oversized}ok\n")));

        match read_limited_jsonl_line_with_limit(&mut reader, None, 64).unwrap() {
            LimitedJsonlLine::Oversized { raw_bytes } => {
                assert_eq!(raw_bytes, oversized.len() as u64);
            }
            _ => panic!("expected oversized line"),
        }
        match read_limited_jsonl_line_with_limit(&mut reader, None, 64).unwrap() {
            LimitedJsonlLine::Complete { bytes, .. } => assert_eq!(bytes, b"ok\n"),
            _ => panic!("expected following complete line"),
        }
    }

    #[test]
    fn bounded_jsonl_reader_ignores_an_incomplete_tail() {
        let mut reader = BufReader::new(Cursor::new(b"unfinished"));
        assert!(matches!(
            read_limited_jsonl_line_with_limit(&mut reader, None, 64).unwrap(),
            LimitedJsonlLine::Incomplete
        ));
    }

    #[test]
    fn cancellation_remains_active_until_the_job_finishes() {
        let job_id = format!("cancel-test-{}", std::process::id());
        cancel_conversation_review_job_impl(job_id.clone()).unwrap();
        assert!(ensure_codex_job_not_cancelled(Some(&job_id)).is_err());
        assert!(ensure_codex_job_not_cancelled(Some(&job_id)).is_err());
        clear_codex_job_if_needed(Some(&job_id)).unwrap();
        assert!(ensure_codex_job_not_cancelled(Some(&job_id)).is_ok());
    }

    #[test]
    fn progress_event_contains_only_aggregate_read_metrics() {
        let event = ConversationReadProgressEvent {
            stage: "reading",
            session_index: 1,
            session_count: 2,
            processed_bytes: 8,
            total_bytes: 16,
            message_count: 3,
            extracted_chars: 120,
        };
        let value = serde_json::to_value(event).unwrap();
        let object = value.as_object().unwrap();
        assert_eq!(object.get("stage").and_then(Value::as_str), Some("reading"));
        assert!(!object.contains_key("path"));
        assert!(!object.contains_key("transcript"));
        assert!(!object.contains_key("content"));
    }

    #[test]
    fn scan_progress_event_supports_discovery_without_private_fields() {
        let event = ConversationSessionScanProgressEvent {
            stage: "discovering",
            candidate_count: 3,
            session_index: 5,
            session_count: 8,
            processed_bytes: 0,
            cache_hit_count: 0,
            matched_count: 0,
            excluded_count: 0,
        };
        let value = serde_json::to_value(event).unwrap();
        let object = value.as_object().unwrap();
        assert_eq!(
            object.get("stage").and_then(Value::as_str),
            Some("discovering")
        );
        assert_eq!(object.get("sessionIndex").and_then(Value::as_u64), Some(5));
        assert!(!object.contains_key("path"));
        assert!(!object.contains_key("title"));
        assert!(!object.contains_key("content"));
    }
}
