use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::WebviewWindow;

use crate::ensure_main_window;
use crate::text_utils::{redact_sensitive_text, take_chars};

pub(crate) const FILE_TEXT_MAX_CHARS: usize = 180_000;
const FILE_TEXT_MAX_BYTES: u64 = 40_000_000;
const FILE_TEXT_MAX_OFFICE_XML_BYTES: u64 = 12_000_000;
const IMAGE_DATA_MAX_BYTES: u64 = 20_000_000;
const DAYMARK_TEXT_FILE_MAX_BYTES: u64 = 50_000_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PathStatus {
    exists: bool,
    kind: Option<&'static str>,
    message: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileTextExtractResult {
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
pub(crate) struct ImageDataExtractResult {
    path: String,
    file_name: String,
    extension: String,
    mime_type: String,
    size_bytes: u64,
    data_url: String,
    warnings: Vec<String>,
}

#[tauri::command]
pub(crate) fn check_local_path(window: WebviewWindow, path: String) -> PathStatus {
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
pub(crate) fn write_text_file(window: WebviewWindow, path: String, contents: String) -> Result<(), String> {
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
pub(crate) fn read_text_file(window: WebviewWindow, path: String) -> Result<String, String> {
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
pub(crate) fn get_supported_file_analysis_types() -> Vec<&'static str> {
    vec!["txt", "md", "markdown", "csv", "pdf", "docx", "pptx", "xlsx"]
}

#[tauri::command]
pub(crate) fn get_supported_vision_types() -> Vec<&'static str> {
    vec!["jpg", "jpeg", "png", "webp", "gif"]
}

#[tauri::command]
pub(crate) fn extract_local_image_data(window: WebviewWindow, path: String) -> Result<ImageDataExtractResult, String> {
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
pub(crate) fn extract_local_file_text(window: WebviewWindow, path: String) -> Result<FileTextExtractResult, String> {
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

pub(crate) struct FinalizedFileText {
    pub(crate) text: String,
    pub(crate) extracted_chars: usize,
    pub(crate) sent_chars: usize,
    pub(crate) truncated: bool,
    pub(crate) redacted: bool,
    pub(crate) quality: String,
    pub(crate) preview: String,
    pub(crate) warnings: Vec<String>,
}

pub(crate) fn finalize_file_text(
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

pub(crate) fn office_xml_to_text(xml: &str) -> String {
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

pub(crate) fn classify_file_text_quality(extension: &str, size_bytes: u64, text: &str, warnings: &[String]) -> &'static str {
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
