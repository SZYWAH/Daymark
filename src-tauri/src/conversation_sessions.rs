use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::UNIX_EPOCH;
use tauri::WebviewWindow;

use crate::ensure_main_window;
use crate::text_utils::{chunk_text, redact_sensitive_text, take_chars};

const CONVERSATION_REVIEW_CHUNK_CHARS: usize = 14_000;
const CONVERSATION_REVIEW_MAX_TOTAL_CHARS: usize = 900_000;
const CONVERSATION_REVIEW_MAX_SESSION_RAW_BYTES: usize = 8_000_000;

static CANCELLED_CODEX_JOBS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

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
    pub(crate) path: String,
    pub(crate) size_bytes: u64,
    pub(crate) modified_at: u64,
    pub(crate) cwd: Option<String>,
}

#[derive(Deserialize)]
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
pub(crate) struct CodexReviewInput {
    date: String,
    source_kinds: Vec<String>,
    review_kind: String,
    sessions: Vec<CodexSessionMeta>,
    transcript_chunks: Vec<String>,
    total_chars: usize,
    redacted: bool,
    truncated: bool,
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
    pub(crate) path: String,
    pub(crate) previous_read_offset: u64,
    pub(crate) next_read_offset: u64,
    pub(crate) modified_at: u64,
    pub(crate) transcript: String,
    pub(crate) char_count: usize,
    pub(crate) message_count: usize,
    pub(crate) redacted: bool,
    pub(crate) truncated: bool,
    pub(crate) reset: bool,
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
pub(crate) fn probe_conversation_sources(window: WebviewWindow) -> Result<Vec<CodexSourceProbe>, String> {
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
pub(crate) fn list_codex_session_days(window: WebviewWindow) -> Result<Vec<CodexSessionDay>, String> {
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
pub(crate) fn list_codex_sessions_by_date(
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
        .filter(|session| session.date == date)
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

pub(crate) fn index_conversation_sessions_impl(options: CodexSessionIndexOptions) -> Result<Vec<CodexSessionIndex>, String> {
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
pub(crate) fn read_selected_codex_sessions(window: WebviewWindow, session_ids: Vec<String>, job_id: Option<String>) -> Result<CodexReviewInput, String> {
    ensure_main_window(&window)?;
    let mut source_filter = HashSet::new();
    source_filter.insert("codex".to_string());
    read_selected_sessions_for_review(session_ids, job_id, Some(source_filter))
}

#[tauri::command]
pub(crate) fn read_selected_conversation_sessions(window: WebviewWindow, session_ids: Vec<String>, job_id: Option<String>) -> Result<CodexReviewInput, String> {
    ensure_main_window(&window)?;
    read_selected_sessions_for_review(session_ids, job_id, None)
}

#[tauri::command]
pub(crate) fn read_conversation_session_deltas(
    window: WebviewWindow,
    session_ids: Vec<String>,
    cursors: Option<Vec<ConversationSessionDeltaCursor>>,
    job_id: Option<String>,
) -> Result<Vec<ConversationSessionDelta>, String> {
    ensure_main_window(&window)?;
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
    let mut sessions: Vec<_> = collect_conversation_sessions(None)?
        .into_iter()
        .filter(|session| requested.contains(&session.id))
        .collect();
    sessions.sort_by(|a, b| a.date.cmp(&b.date).then(a.modified_at.cmp(&b.modified_at)));

    let mut result = Vec::new();
    for session in sessions {
        ensure_codex_job_not_cancelled(job_id.as_deref())?;
        let offset = cursor_map.get(&session.id).copied().unwrap_or(0);
        result.push(read_session_delta(&session, offset, job_id.as_deref())?);
    }
    clear_codex_job_if_needed(job_id.as_deref())?;
    Ok(result)
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
pub(crate) fn cancel_codex_review_job(window: WebviewWindow, job_id: String) -> Result<(), String> {
    ensure_main_window(&window)?;
    cancel_conversation_review_job_impl(job_id)
}


#[tauri::command]
pub(crate) fn cancel_conversation_review_job(window: WebviewWindow, job_id: String) -> Result<(), String> {
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

pub(crate) fn read_session_delta(
    session: &CodexSessionMeta,
    requested_offset: u64,
    job_id: Option<&str>,
) -> Result<ConversationSessionDelta, String> {
    let path = Path::new(&session.path);
    let metadata = fs::metadata(path)
        .map_err(|error| format!("无法读取会话元信息：{}，{}", session.path, error))?;
    let file_len = metadata.len();
    let reset = requested_offset > file_len;
    let previous_read_offset = if reset { 0 } else { requested_offset };
    let mut file = fs::File::open(path)
        .map_err(|error| format!("无法读取会话：{}，{}", session.path, error))?;
    file.seek(SeekFrom::Start(previous_read_offset))
        .map_err(|error| format!("定位会话增量失败：{}，{}", session.path, error))?;

    let max_raw = CONVERSATION_REVIEW_MAX_SESSION_RAW_BYTES as u64;
    let mut limited = file.take(max_raw + 1);
    let mut buffer = Vec::new();
    limited
        .read_to_end(&mut buffer)
        .map_err(|error| format!("读取会话增量失败：{}，{}", session.path, error))?;
    let mut truncated = buffer.len() as u64 > max_raw;
    if truncated {
        buffer.truncate(max_raw as usize);
    }

    let complete_len = complete_jsonl_prefix_len(&buffer);
    let next_read_offset = previous_read_offset + complete_len as u64;
    let mut transcript = String::new();
    let mut char_count = 0usize;
    let mut message_count = 0usize;
    let mut redacted = false;

    if complete_len > 0 {
        let text = String::from_utf8_lossy(&buffer[..complete_len]);
        let project_line = session_project_label(session)
            .map(|label| format!("项目：{}", label))
            .unwrap_or_default();
        let header = format!("来源：{}\n会话：{}\n时间：{}\n{}\n", session.source_label, session.id, session.date, project_line);
        push_limited(&mut transcript, &mut char_count, &header);

        for line in text.lines() {
            ensure_codex_job_not_cancelled(job_id)?;
            let Ok(value) = serde_json::from_str::<Value>(line) else {
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
                &mut transcript,
                &mut char_count,
                &format!("\n[{}]\n{}\n", role_label(role, &session.source_kind), safe_text),
            );
            message_count += 1;
            if char_count >= CONVERSATION_REVIEW_MAX_TOTAL_CHARS {
                truncated = true;
                break;
            }
        }
    }

    Ok(ConversationSessionDelta {
        session_id: session.id.clone(),
        source_kind: session.source_kind.clone(),
        source_label: session.source_label.clone(),
        date: session.date.clone(),
        path: session.path.clone(),
        previous_read_offset,
        next_read_offset,
        modified_at: metadata_millis(&metadata),
        transcript,
        char_count,
        message_count,
        redacted,
        truncated,
        reset,
    })
}

fn complete_jsonl_prefix_len(buffer: &[u8]) -> usize {
    if buffer.is_empty() {
        return 0;
    }
    if buffer.last() == Some(&b'\n') {
        return buffer.len();
    }
    buffer
        .iter()
        .rposition(|byte| *byte == b'\n')
        .map(|index| index + 1)
        .unwrap_or(0)
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
