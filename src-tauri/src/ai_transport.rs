use crate::{ensure_main_window, text_utils::redact_sensitive_text};
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{ipc::Channel, WebviewWindow};
use tokio_util::sync::CancellationToken;

const ANTHROPIC_VERSION: &str = "2023-06-01";
const MAX_ERROR_CHARS: usize = 800;
const MAX_OUTPUT_CHARS: usize = 4_000_000;

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum AiProtocol {
    OpenaiChatCompletions,
    OpenaiResponses,
    AnthropicMessages,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum AnthropicAuthMode {
    XApiKey,
    Bearer,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum AiMessageRole {
    User,
    Assistant,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum AiContentBlock {
    Text {
        text: String,
    },
    Image {
        #[serde(rename = "mediaType")]
        media_type: String,
        data: String,
    },
}

#[derive(Debug, Clone, Deserialize)]
struct AiInputMessage {
    role: AiMessageRole,
    content: Vec<AiContentBlock>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiGenerateRequest {
    request_id: String,
    protocol: AiProtocol,
    endpoint: String,
    api_key: String,
    auth_mode: Option<AnthropicAuthMode>,
    model: String,
    system: Option<String>,
    messages: Vec<AiInputMessage>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
    reasoning_effort: Option<String>,
    timeout_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiModelListRequest {
    base_url: String,
    api_key: String,
    timeout_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiModelOption {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    supported_reasoning_efforts: Option<Vec<String>>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum AiStreamEvent {
    Token { token: String, full_text: String },
}

struct RequestGuard {
    request_id: String,
}

impl Drop for RequestGuard {
    fn drop(&mut self) {
        cancellations()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&self.request_id);
    }
}

fn cancellations() -> &'static Mutex<HashMap<String, CancellationToken>> {
    static CANCELLATIONS: OnceLock<Mutex<HashMap<String, CancellationToken>>> = OnceLock::new();
    CANCELLATIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn register_request(request_id: &str) -> Result<(CancellationToken, RequestGuard), String> {
    let trimmed = request_id.trim();
    if trimmed.is_empty() || trimmed.len() > 128 {
        return Err("AI request id is invalid.".into());
    }
    let cancelled = CancellationToken::new();
    cancellations()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(trimmed.to_string(), cancelled.clone());
    Ok((
        cancelled,
        RequestGuard {
            request_id: trimmed.to_string(),
        },
    ))
}

fn validate_request(request: &AiGenerateRequest) -> Result<reqwest::Url, String> {
    if request.api_key.trim().is_empty() {
        return Err("API Key 为空。".into());
    }
    if request.model.trim().is_empty() {
        return Err("模型名称为空。".into());
    }
    if request.messages.is_empty() {
        return Err("AI 请求消息为空。".into());
    }
    for message in &request.messages {
        if message.content.is_empty() {
            return Err("AI 请求包含空消息。".into());
        }
        for block in &message.content {
            if let AiContentBlock::Image { media_type, data } = block {
                if !media_type.trim().to_ascii_lowercase().starts_with("image/")
                    || data.trim().is_empty()
                {
                    return Err("图片消息格式无效。".into());
                }
            }
        }
    }
    let endpoint =
        reqwest::Url::parse(request.endpoint.trim()).map_err(|_| "接口地址不是有效 URL。")?;
    if !matches!(endpoint.scheme(), "http" | "https") || endpoint.host_str().is_none() {
        return Err("接口地址只支持 http 或 https。".into());
    }
    Ok(endpoint)
}

fn client(timeout_ms: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms.clamp(1_000, 300_000)))
        .build()
        .map_err(|_| "无法初始化 AI 网络连接。".to_string())
}

fn request_headers(request: &AiGenerateRequest) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    match request.protocol {
        AiProtocol::OpenaiChatCompletions | AiProtocol::OpenaiResponses => {
            let mut value = HeaderValue::from_str(&format!("Bearer {}", request.api_key.trim()))
                .map_err(|_| "API Key 不能用于请求头。")?;
            value.set_sensitive(true);
            headers.insert(AUTHORIZATION, value);
        }
        AiProtocol::AnthropicMessages => {
            headers.insert(
                HeaderName::from_static("anthropic-version"),
                HeaderValue::from_static(ANTHROPIC_VERSION),
            );
            match request.auth_mode.unwrap_or(AnthropicAuthMode::XApiKey) {
                AnthropicAuthMode::XApiKey => {
                    let mut value = HeaderValue::from_str(request.api_key.trim())
                        .map_err(|_| "API Key 不能用于请求头。")?;
                    value.set_sensitive(true);
                    headers.insert(HeaderName::from_static("x-api-key"), value);
                }
                AnthropicAuthMode::Bearer => {
                    let mut value =
                        HeaderValue::from_str(&format!("Bearer {}", request.api_key.trim()))
                            .map_err(|_| "API Key 不能用于请求头。")?;
                    value.set_sensitive(true);
                    headers.insert(AUTHORIZATION, value);
                }
            }
        }
    }
    Ok(headers)
}

fn request_body(request: &AiGenerateRequest, stream: bool) -> Value {
    match request.protocol {
        AiProtocol::OpenaiChatCompletions => openai_request_body(request, stream),
        AiProtocol::OpenaiResponses => openai_responses_request_body(request, stream),
        AiProtocol::AnthropicMessages => anthropic_request_body(request, stream),
    }
}

fn openai_request_body(request: &AiGenerateRequest, stream: bool) -> Value {
    let mut messages = Vec::new();
    if let Some(system) = request
        .system
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        messages.push(json!({ "role": "system", "content": system }));
    }
    messages.extend(request.messages.iter().map(|message| {
        json!({
            "role": role_name(message.role),
            "content": openai_content(&message.content),
        })
    }));
    let mut body = Map::from_iter([
        ("model".into(), json!(request.model.trim())),
        ("messages".into(), Value::Array(messages)),
        ("stream".into(), json!(stream)),
    ]);
    if let Some(max_tokens) = request.max_tokens {
        body.insert("max_tokens".into(), json!(max_tokens));
    }
    if let Some(temperature) = request.temperature {
        body.insert("temperature".into(), json!(temperature));
    }
    Value::Object(body)
}

fn openai_responses_request_body(request: &AiGenerateRequest, stream: bool) -> Value {
    let mut body = Map::from_iter([
        ("model".into(), json!(request.model.trim())),
        ("input".into(), Value::Array(request.messages.iter().map(|message| {
            json!({
                "role": role_name(message.role),
                "content": message.content.iter().map(|block| match block {
                    AiContentBlock::Text { text } => json!({ "type": "input_text", "text": text }),
                    AiContentBlock::Image { media_type, data } => json!({
                        "type": "input_image",
                        "image_url": format!("data:{};base64,{}", media_type, data),
                        "detail": "auto",
                    }),
                }).collect::<Vec<_>>(),
            })
        }).collect())),
        ("stream".into(), json!(stream)),
        ("store".into(), json!(false)),
    ]);
    if let Some(system) = request.system.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        body.insert("instructions".into(), json!(system));
    }
    if let Some(effort) = request.reasoning_effort.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        body.insert("reasoning".into(), json!({ "effort": effort }));
    }
    Value::Object(body)
}

fn openai_content(content: &[AiContentBlock]) -> Value {
    if content
        .iter()
        .all(|block| matches!(block, AiContentBlock::Text { .. }))
    {
        return Value::String(
            content
                .iter()
                .filter_map(|block| match block {
                    AiContentBlock::Text { text } => Some(text.as_str()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("\n"),
        );
    }
    Value::Array(
        content
            .iter()
            .map(|block| match block {
                AiContentBlock::Text { text } => json!({ "type": "text", "text": text }),
                AiContentBlock::Image { media_type, data } => json!({
                    "type": "image_url",
                    "image_url": { "url": format!("data:{};base64,{}", media_type, data) },
                }),
            })
            .collect(),
    )
}

fn anthropic_request_body(request: &AiGenerateRequest, stream: bool) -> Value {
    let mut body = Map::from_iter([
        ("model".into(), json!(request.model.trim())),
        ("messages".into(), Value::Array(request.messages.iter().map(|message| {
            json!({
                "role": role_name(message.role),
                "content": message.content.iter().map(|block| match block {
                    AiContentBlock::Text { text } => json!({ "type": "text", "text": text }),
                    AiContentBlock::Image { media_type, data } => json!({
                        "type": "image",
                        "source": { "type": "base64", "media_type": media_type, "data": data },
                    }),
                }).collect::<Vec<_>>(),
            })
        }).collect())),
        ("stream".into(), json!(stream)),
    ]);
    if let Some(max_tokens) = request.max_tokens {
        body.insert("max_tokens".into(), json!(max_tokens));
    }
    if let Some(system) = request
        .system
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        body.insert("system".into(), json!(system));
    }
    Value::Object(body)
}

fn role_name(role: AiMessageRole) -> &'static str {
    match role {
        AiMessageRole::User => "user",
        AiMessageRole::Assistant => "assistant",
    }
}

async fn send_request(
    request: &AiGenerateRequest,
    stream: bool,
    cancelled: &CancellationToken,
) -> Result<reqwest::Response, String> {
    let endpoint = validate_request(request)?;
    if cancelled.is_cancelled() {
        return Err("AI 请求已停止。".into());
    }
    let request_future = client(request.timeout_ms)?
        .post(endpoint)
        .headers(request_headers(request)?)
        .json(&request_body(request, stream))
        .send();
    let response = tokio::select! {
        _ = cancelled.cancelled() => return Err("AI 请求已停止。".into()),
        response = request_future => response.map_err(|error| {
            if error.is_timeout() {
                "AI 请求超时。".to_string()
            } else if error.is_connect() {
                "无法连接 AI 服务，请检查接口地址、网络或代理。".to_string()
            } else {
                "AI 网络请求失败。".to_string()
            }
        })?,
    };
    if cancelled.is_cancelled() {
        return Err("AI 请求已停止。".into());
    }
    Ok(response)
}

async fn checked_response(response: reqwest::Response) -> Result<reqwest::Response, String> {
    if response.status().is_success() {
        return Ok(response);
    }
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    let detail = safe_service_error(&body);
    let category = match status.as_u16() {
        401 | 403 => "鉴权失败，请检查 API Key、鉴权方式和账户权限",
        404 => "接口或模型不存在，请检查完整地址和模型名称",
        429 => "请求过于频繁或账户额度不足",
        500..=599 => "AI 服务暂时异常",
        _ => "AI 服务拒绝了请求",
    };
    if detail.is_empty() {
        Err(format!("{}（HTTP {}）。", category, status.as_u16()))
    } else {
        Err(format!(
            "{}（HTTP {}）：{}",
            category,
            status.as_u16(),
            detail
        ))
    }
}

fn safe_service_error(body: &str) -> String {
    let parsed = serde_json::from_str::<Value>(body).ok();
    let message = parsed
        .as_ref()
        .and_then(|value| value.pointer("/error/message").and_then(Value::as_str))
        .or_else(|| {
            parsed
                .as_ref()
                .and_then(|value| value.get("message").and_then(Value::as_str))
        })
        .unwrap_or(body)
        .trim();
    let (safe, _) = redact_sensitive_text(message);
    safe.chars().take(MAX_ERROR_CHARS).collect()
}

fn validate_completion_status(protocol: AiProtocol, value: &Value) -> Result<(), String> {
    if protocol != AiProtocol::OpenaiResponses {
        return Ok(());
    }
    match value.get("status").and_then(Value::as_str) {
        Some("failed") => Err(value.pointer("/error/message").and_then(Value::as_str)
            .map(safe_service_error)
            .filter(|message| !message.is_empty())
            .unwrap_or_else(|| "Responses request failed.".to_string())),
        Some("incomplete") => Err(value.pointer("/incomplete_details/reason").and_then(Value::as_str)
            .map(safe_service_error)
            .filter(|message| !message.is_empty())
            .unwrap_or_else(|| "Responses request was incomplete.".to_string())),
        _ => Ok(()),
    }
}

fn completion_content(protocol: AiProtocol, value: &Value) -> Option<String> {
    let content = match protocol {
        AiProtocol::OpenaiChatCompletions => value
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .map(str::to_string),
        AiProtocol::OpenaiResponses => responses_content(value),
        AiProtocol::AnthropicMessages => {
            value
                .get("content")
                .and_then(Value::as_array)
                .map(|blocks| {
                    blocks
                        .iter()
                        .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
                        .filter_map(|block| block.get("text").and_then(Value::as_str))
                        .collect::<String>()
                })
        }
    }?;
    let trimmed = content.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn responses_content(value: &Value) -> Option<String> {
    if let Some(output_text) = value.get("output_text").and_then(Value::as_str).map(str::trim).filter(|text| !text.is_empty()) {
        return Some(output_text.to_string());
    }
    let text = value.get("output")?.as_array()?.iter()
        .filter_map(|item| item.get("content").and_then(Value::as_array))
        .flatten()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("output_text"))
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect::<String>();
    let trimmed = text.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

#[derive(Debug, PartialEq, Eq)]
enum StreamPiece {
    Token(String),
    Completed(Option<String>),
    None,
}

fn stream_piece(protocol: AiProtocol, value: &Value) -> Result<StreamPiece, String> {
    if let Some(message) = value.pointer("/error/message").and_then(Value::as_str) {
        return Err(safe_service_error(message));
    }
    match protocol {
        AiProtocol::OpenaiChatCompletions => Ok(value
            .pointer("/choices/0/delta/content")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(|value| StreamPiece::Token(value.to_string()))
            .unwrap_or(StreamPiece::None)),
        AiProtocol::OpenaiResponses => match value.get("type").and_then(Value::as_str) {
            Some("response.output_text.delta") => Ok(value.get("delta").and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(|value| StreamPiece::Token(value.to_string()))
                .unwrap_or(StreamPiece::None)),
            Some("response.completed") => Ok(StreamPiece::Completed(
                value.get("response").and_then(responses_content)
            )),
            Some("response.failed") => Err(value.pointer("/response/error/message")
                .and_then(Value::as_str)
                .map(safe_service_error)
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "Responses request failed.".to_string())),
            Some("response.incomplete") => Err(value.pointer("/response/incomplete_details/reason")
                .and_then(Value::as_str)
                .map(safe_service_error)
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "Responses request was incomplete.".to_string())),
            _ => Ok(StreamPiece::None),
        },
        AiProtocol::AnthropicMessages => {
            let is_text_delta = value.get("type").and_then(Value::as_str)
                == Some("content_block_delta")
                && value.pointer("/delta/type").and_then(Value::as_str) == Some("text_delta");
            Ok(is_text_delta
                .then(|| value.pointer("/delta/text").and_then(Value::as_str))
                .flatten()
                .filter(|value| !value.is_empty())
                .map(|value| StreamPiece::Token(value.to_string()))
                .unwrap_or(StreamPiece::None))
        }
    }
}

fn parse_sse_line(protocol: AiProtocol, line: &str) -> Result<StreamPiece, String> {
    let trimmed = line.trim();
    let Some(payload) = trimmed.strip_prefix("data:").map(str::trim) else {
        return Ok(StreamPiece::None);
    };
    if payload.is_empty() || payload == "[DONE]" {
        return Ok(StreamPiece::None);
    }
    let value = serde_json::from_str::<Value>(payload)
        .map_err(|_| "AI 流式响应格式不兼容。".to_string())?;
    stream_piece(protocol, &value)
}

fn append_stream_piece(
    piece: StreamPiece,
    full_text: &mut String,
    on_event: &Channel<AiStreamEvent>,
) -> Result<(), String> {
    let token = match piece {
        StreamPiece::Token(token) => token,
        StreamPiece::Completed(Some(text)) if full_text.is_empty() => text,
        StreamPiece::Completed(_) | StreamPiece::None => return Ok(()),
    };
    full_text.push_str(&token);
    if full_text.chars().count() > MAX_OUTPUT_CHARS {
        return Err("AI 返回内容过长，已停止接收。".into());
    }
    on_event
        .send(AiStreamEvent::Token {
            token,
            full_text: full_text.clone(),
        })
        .map_err(|_| "无法将 AI 流式内容传回页面。".to_string())
}

#[tauri::command]
pub(crate) async fn ai_generate(
    window: WebviewWindow,
    request: AiGenerateRequest,
) -> Result<String, String> {
    ensure_main_window(&window)?;
    let (cancelled, _guard) = register_request(&request.request_id)?;
    let response = checked_response(send_request(&request, false, &cancelled).await?).await?;
    let value = response
        .json::<Value>()
        .await
        .map_err(|_| "AI 返回的 JSON 无法解析。".to_string())?;
    validate_completion_status(request.protocol, &value)?;
    completion_content(request.protocol, &value)
        .ok_or_else(|| "AI 返回内容为空或格式不兼容。".to_string())
}

#[tauri::command]
pub(crate) async fn ai_generate_stream(
    window: WebviewWindow,
    request: AiGenerateRequest,
    on_event: Channel<AiStreamEvent>,
) -> Result<String, String> {
    ensure_main_window(&window)?;
    let (cancelled, _guard) = register_request(&request.request_id)?;
    let response = checked_response(send_request(&request, true, &cancelled).await?).await?;
    let mut stream = response.bytes_stream();
    let mut buffer = Vec::<u8>::new();
    let mut full_text = String::new();

    loop {
        let chunk = tokio::select! {
            _ = cancelled.cancelled() => return Err("AI 请求已停止。".into()),
            chunk = stream.next() => chunk,
        };
        let Some(chunk) = chunk else { break };
        buffer.extend_from_slice(&chunk.map_err(|_| "AI 流式连接中断。".to_string())?);
        while let Some(newline) = buffer.iter().position(|byte| *byte == b'\n') {
            let line = buffer.drain(..=newline).collect::<Vec<_>>();
            let line = String::from_utf8_lossy(&line);
            append_stream_piece(
                parse_sse_line(request.protocol, &line)?,
                &mut full_text,
                &on_event,
            )?;
        }
    }
    if !buffer.is_empty() {
        let line = String::from_utf8_lossy(&buffer);
        append_stream_piece(
            parse_sse_line(request.protocol, &line)?,
            &mut full_text,
            &on_event,
        )?;
    }

    let trimmed = full_text.trim();
    if trimmed.is_empty() {
        Err("AI 流式返回内容为空。".into())
    } else {
        Ok(trimmed.to_string())
    }
}

fn model_endpoint_candidates(base_url: &str) -> Result<Vec<reqwest::Url>, String> {
    let mut base = reqwest::Url::parse(base_url.trim()).map_err(|_| "Base URL 不是有效地址。".to_string())?;
    if !matches!(base.scheme(), "http" | "https") || base.host_str().is_none() {
        return Err("Base URL 只支持 http 或 https。".into());
    }
    base.set_query(None);
    base.set_fragment(None);
    let mut path = base.path().trim_end_matches('/').to_string();
    for suffix in ["/chat/completions", "/responses"] {
        if path.to_ascii_lowercase().ends_with(suffix) {
            path.truncate(path.len() - suffix.len());
            path = path.trim_end_matches('/').to_string();
            break;
        }
    }
    let ends_v1 = path.to_ascii_lowercase().ends_with("/v1");
    let primary = if ends_v1 { format!("{path}/models") } else { format!("{path}/v1/models") };
    let fallback_base = if ends_v1 { &path[..path.len() - 3] } else { path.as_str() };
    let fallback = format!("{fallback_base}/models");
    let mut endpoints = Vec::new();
    for candidate in [primary, fallback] {
        let mut endpoint = base.clone();
        endpoint.set_path(if candidate.is_empty() { "/models" } else { &candidate });
        if !endpoints.iter().any(|current: &reqwest::Url| current == &endpoint) {
            endpoints.push(endpoint);
        }
    }
    Ok(endpoints)
}

#[tauri::command]
pub(crate) async fn list_ai_models(
    window: WebviewWindow,
    request: AiModelListRequest,
) -> Result<Vec<AiModelOption>, String> {
    ensure_main_window(&window)?;
    if request.api_key.trim().is_empty() {
        return Err("API Key 为空。".into());
    }
    let mut authorization = HeaderValue::from_str(&format!("Bearer {}", request.api_key.trim()))
        .map_err(|_| "API Key 不能用于请求头。".to_string())?;
    authorization.set_sensitive(true);
    let http = client(request.timeout_ms)?;
    let endpoints = model_endpoint_candidates(&request.base_url)?;
    let mut last_not_found = None;

    for endpoint in endpoints {
        let response = http.get(endpoint).header(AUTHORIZATION, authorization.clone()).send().await
            .map_err(|error| {
                if error.is_timeout() { "获取模型列表超时。".to_string() }
                else if error.is_connect() { "无法连接模型列表接口，请检查地址、网络或代理。".to_string() }
                else { "获取模型列表的网络请求失败。".to_string() }
            })?;
        if response.status().as_u16() == 404 {
            last_not_found = Some(checked_response(response).await.unwrap_err());
            continue;
        }
        let response = checked_response(response).await?;
        let value = response.json::<Value>().await
            .map_err(|_| "模型列表返回的 JSON 无法解析。".to_string())?;
        let data = value.get("data").and_then(Value::as_array)
            .ok_or_else(|| "模型列表格式不兼容：缺少 data 数组。".to_string())?;
        let allowed = ["none", "minimal", "low", "medium", "high", "xhigh"];
        let mut models = HashMap::<String, AiModelOption>::new();
        for item in data {
            let Some(id) = item.get("id").and_then(Value::as_str).map(str::trim).filter(|id| !id.is_empty()) else { continue };
            let efforts = item.get("supported_reasoning_efforts").and_then(Value::as_array).map(|values| {
                values.iter().filter_map(Value::as_str).filter(|value| allowed.contains(value)).map(str::to_string).collect::<Vec<_>>()
            }).filter(|values| !values.is_empty());
            models.insert(id.to_string(), AiModelOption { id: id.to_string(), supported_reasoning_efforts: efforts });
        }
        let mut models = models.into_values().collect::<Vec<_>>();
        models.sort_by(|left, right| left.id.cmp(&right.id));
        if models.is_empty() {
            return Err("模型接口返回了空列表。".into());
        }
        return Ok(models);
    }
    Err(last_not_found.unwrap_or_else(|| "未找到兼容的 Models API。".to_string()))
}

#[tauri::command]
pub(crate) fn cancel_ai_request(window: WebviewWindow, request_id: String) -> Result<(), String> {
    ensure_main_window(&window)?;
    if let Some(cancelled) = cancellations()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(request_id.trim())
    {
        cancelled.cancel();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        completion_content, model_endpoint_candidates, parse_sse_line, request_body,
        request_headers, safe_service_error, validate_completion_status, validate_request,
        AiContentBlock, AiGenerateRequest, AiInputMessage, AiMessageRole, AiProtocol,
        AnthropicAuthMode, StreamPiece,
    };
    use reqwest::header::AUTHORIZATION;
    use serde_json::json;

    fn request(protocol: AiProtocol, endpoint: &str) -> AiGenerateRequest {
        AiGenerateRequest {
            request_id: "test".into(),
            protocol,
            endpoint: endpoint.into(),
            api_key: "secret".into(),
            auth_mode: Some(AnthropicAuthMode::XApiKey),
            model: "model".into(),
            system: Some("system instruction".into()),
            messages: vec![AiInputMessage {
                role: AiMessageRole::User,
                content: vec![AiContentBlock::Text {
                    text: "hello".into(),
                }],
            }],
            temperature: Some(0.2),
            max_tokens: Some(100),
            reasoning_effort: None,
            timeout_ms: 10_000,
        }
    }

    #[test]
    fn endpoint_accepts_http_and_https_only() {
        assert!(validate_request(&request(
            AiProtocol::OpenaiChatCompletions,
            "https://opencode.ai/zen/go/v1/chat/completions"
        ))
        .is_ok());
        assert!(validate_request(&request(
            AiProtocol::AnthropicMessages,
            "http://127.0.0.1:4000/anthropic/v1/messages"
        ))
        .is_ok());
        assert!(validate_request(&request(
            AiProtocol::AnthropicMessages,
            "file:///tmp/secret"
        ))
        .is_err());
    }

    #[test]
    fn openai_headers_and_body_keep_existing_message_format() {
        let mut input = request(
            AiProtocol::OpenaiChatCompletions,
            "https://api.example.com/v1/chat/completions",
        );
        input.messages[0].content.push(AiContentBlock::Image {
            media_type: "image/png".into(),
            data: "aGVsbG8=".into(),
        });

        let headers = request_headers(&input).unwrap();
        assert_eq!(headers.get(AUTHORIZATION).unwrap(), "Bearer secret");
        assert!(!headers.contains_key("x-api-key"));
        assert!(!headers.contains_key("anthropic-version"));

        let body = request_body(&input, true);
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"][0]["content"], "system instruction");
        assert_eq!(body["messages"][1]["content"][0]["type"], "text");
        assert_eq!(
            body["messages"][1]["content"][1]["image_url"]["url"],
            "data:image/png;base64,aGVsbG8="
        );
        assert_eq!(body["temperature"], 0.2);
        assert_eq!(body["stream"], true);
    }

    #[test]
    fn anthropic_headers_use_only_selected_authentication() {
        let x_key = request(
            AiProtocol::AnthropicMessages,
            "https://api.anthropic.com/v1/messages",
        );
        let headers = request_headers(&x_key).unwrap();
        assert!(headers.contains_key("x-api-key"));
        assert!(!headers.contains_key(AUTHORIZATION));
        assert_eq!(headers.get("anthropic-version").unwrap(), "2023-06-01");

        let mut bearer = x_key;
        bearer.auth_mode = Some(AnthropicAuthMode::Bearer);
        let headers = request_headers(&bearer).unwrap();
        assert!(!headers.contains_key("x-api-key"));
        assert_eq!(headers.get(AUTHORIZATION).unwrap(), "Bearer secret");
    }

    #[test]
    fn anthropic_body_moves_system_and_converts_images() {
        let mut input = request(
            AiProtocol::AnthropicMessages,
            "https://api.anthropic.com/v1/messages",
        );
        input.messages[0].content.push(AiContentBlock::Image {
            media_type: "image/png".into(),
            data: "aGVsbG8=".into(),
        });
        let body = request_body(&input, false);
        assert_eq!(body["system"], "system instruction");
        assert_eq!(body["messages"][0]["content"][1]["type"], "image");
        assert_eq!(
            body["messages"][0]["content"][1]["source"]["media_type"],
            "image/png"
        );
        assert!(body.get("temperature").is_none());
    }

    #[test]
    fn completion_extracts_both_protocols() {
        assert_eq!(
            completion_content(
                AiProtocol::OpenaiChatCompletions,
                &json!({"choices": [{"message": {"content": " okay "}}]})
            )
            .as_deref(),
            Some("okay")
        );
        assert_eq!(
            completion_content(
                AiProtocol::AnthropicMessages,
                &json!({"content": [
                    {"type": "text", "text": "hello "},
                    {"type": "tool_use", "id": "ignored"},
                    {"type": "text", "text": "world"}
                ]})
            )
            .as_deref(),
            Some("hello world")
        );
    }

    #[test]
    fn stream_parser_handles_text_errors_and_unknown_events() {
        assert_eq!(
            parse_sse_line(AiProtocol::AnthropicMessages, r#"data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}"#).unwrap(),
            StreamPiece::Token("hello".into())
        );
        assert!(
            parse_sse_line(AiProtocol::AnthropicMessages, r#"data: {"type":"ping"}"#)
                .unwrap()
                == StreamPiece::None
        );
        assert!(parse_sse_line(
            AiProtocol::AnthropicMessages,
            r#"data: {"type":"future_event"}"#
        )
        .unwrap()
        == StreamPiece::None);
        assert!(parse_sse_line(
            AiProtocol::AnthropicMessages,
            r#"data: {"type":"error","error":{"message":"overloaded"}}"#
        )
        .is_err());
    }

    #[test]
    fn service_errors_are_redacted_and_truncated() {
        let safe =
            safe_service_error(r#"{"error":{"message":"api_key=sk-secret-1234567890 failed"}}"#);
        assert!(!safe.contains("sk-secret"));
        assert!(safe.chars().count() <= 800);
    }

    #[test]
    fn responses_body_uses_store_false_and_standard_content() {
        let mut input = request(AiProtocol::OpenaiResponses, "https://api.example.com/v1/responses");
        input.reasoning_effort = Some("xhigh".into());
        input.messages[0].content.push(AiContentBlock::Image {
            media_type: "image/png".into(),
            data: "aGVsbG8=".into(),
        });
        let body = request_body(&input, true);
        assert_eq!(body["instructions"], "system instruction");
        assert_eq!(body["input"][0]["content"][0]["type"], "input_text");
        assert_eq!(body["input"][0]["content"][1]["type"], "input_image");
        assert_eq!(body["input"][0]["content"][1]["image_url"], "data:image/png;base64,aGVsbG8=");
        assert_eq!(body["store"], false);
        assert_eq!(body["reasoning"]["effort"], "xhigh");
        assert!(body.get("temperature").is_none());
        assert!(body.get("max_output_tokens").is_none());
        assert!(body.get("max_tokens").is_none());
    }

    #[test]
    fn responses_completion_and_stream_events_are_parsed() {
        assert_eq!(
            completion_content(AiProtocol::OpenaiResponses, &json!({
                "output": [{"content": [
                    {"type": "output_text", "text": "hello "},
                    {"type": "refusal", "refusal": "ignored"},
                    {"type": "output_text", "text": "world"}
                ]}]
            })).as_deref(),
            Some("hello world")
        );
        assert_eq!(
            parse_sse_line(AiProtocol::OpenaiResponses, r#"data: {"type":"response.output_text.delta","delta":"hello"}"#).unwrap(),
            StreamPiece::Token("hello".into())
        );
        assert!(parse_sse_line(AiProtocol::OpenaiResponses, r#"data: {"type":"response.incomplete","response":{"incomplete_details":{"reason":"max_output_tokens"}}}"#).is_err());
        assert!(validate_completion_status(AiProtocol::OpenaiResponses, &json!({"status":"failed","error":{"message":"bad request"}})).is_err());
    }

    #[test]
    fn model_endpoints_restore_service_root() {
        let endpoints = model_endpoint_candidates("https://mdkj.lol").unwrap();
        assert_eq!(endpoints[0].as_str(), "https://mdkj.lol/v1/models");
        assert_eq!(endpoints[1].as_str(), "https://mdkj.lol/models");
        let endpoints = model_endpoint_candidates("https://mdkj.lol/v1/responses").unwrap();
        assert_eq!(endpoints[0].as_str(), "https://mdkj.lol/v1/models");
        assert_eq!(endpoints[1].as_str(), "https://mdkj.lol/models");
    }
}
