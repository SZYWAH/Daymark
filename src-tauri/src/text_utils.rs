use std::vec::Vec;

pub(crate) fn redact_sensitive_text(value: &str) -> (String, bool) {
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

pub(crate) fn take_chars(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

pub(crate) fn chunk_text(value: &str, max_chars: usize) -> Vec<String> {
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
