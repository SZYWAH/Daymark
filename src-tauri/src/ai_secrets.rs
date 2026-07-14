use base64::{engine::general_purpose, Engine as _};
use tauri::WebviewWindow;

use crate::ensure_main_window;

const AI_API_KEY_SERVICE: &str = "daymark.ai-api-key.v1";

#[tauri::command]
pub(crate) fn read_ai_api_key(
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
pub(crate) fn write_ai_api_key(
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
pub(crate) fn delete_ai_api_key(window: WebviewWindow, provider: String, base_url: String) -> Result<(), String> {
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

pub(crate) fn ai_api_key_account(provider: &str, base_url: &str) -> Result<String, String> {
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
        "anthropic-messages" => Ok("anthropic-messages"),
        _ => Err("未知 AI 供应商。".into()),
    }
}

pub(crate) fn normalize_ai_key_base_url(base_url: &str) -> Result<String, String> {
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
