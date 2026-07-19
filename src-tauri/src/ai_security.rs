use reqwest::Url;

pub(crate) const PRODUCTION_IDENTIFIER: &str = "com.szywah.daymark";
pub(crate) const QA_IDENTIFIER: &str = "com.szywah.daymark.qa";
pub(crate) const PRODUCTION_CREDENTIAL_SERVICE: &str = "daymark.ai-api-key.v1";
pub(crate) const QA_CREDENTIAL_SERVICE: &str = "daymark.qa.ai-api-key.v1";
const QA_MOCK_ORIGIN_ENV: &str = "DAYMARK_QA_MOCK_ORIGIN";
const QA_DEEPSEEK_SMOKE_ENV: &str = "DAYMARK_QA_ALLOW_DEEPSEEK_SMOKE";
const DEEPSEEK_ORIGIN: &str = "https://api.deepseek.com";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct QaAiNetworkPolicy {
    mock_origin: String,
    allow_deepseek_smoke: bool,
}

pub(crate) fn is_qa_identifier(identifier: &str) -> bool {
    identifier.trim() == QA_IDENTIFIER
}

fn is_production_identifier(identifier: &str) -> bool {
    identifier.trim() == PRODUCTION_IDENTIFIER
}

pub(crate) fn credential_service_for_identifier(identifier: &str) -> Result<&'static str, String> {
    if is_qa_identifier(identifier) {
        Ok(QA_CREDENTIAL_SERVICE)
    } else if is_production_identifier(identifier) {
        Ok(PRODUCTION_CREDENTIAL_SERVICE)
    } else {
        Err("AI credentials are blocked for an unknown application identifier.".into())
    }
}

pub(crate) fn qa_network_policy_from_env() -> Result<QaAiNetworkPolicy, String> {
    qa_network_policy(
        std::env::var(QA_MOCK_ORIGIN_ENV).ok().as_deref(),
        std::env::var(QA_DEEPSEEK_SMOKE_ENV).ok().as_deref(),
    )
}

fn qa_network_policy(
    configured_mock_origin: Option<&str>,
    allow_deepseek_smoke: Option<&str>,
) -> Result<QaAiNetworkPolicy, String> {
    let configured_mock_origin = configured_mock_origin
        .map(str::trim)
        .filter(|origin| !origin.is_empty())
        .ok_or_else(|| {
            "QA AI requests are blocked until DAYMARK_QA_MOCK_ORIGIN is configured.".to_string()
        })?;
    let parsed = Url::parse(configured_mock_origin)
        .map_err(|_| "DAYMARK_QA_MOCK_ORIGIN must be a valid loopback origin.".to_string())?;
    if !is_loopback_origin(&parsed)
        || parsed.as_str().trim_end_matches('/') != parsed.origin().ascii_serialization()
    {
        return Err("DAYMARK_QA_MOCK_ORIGIN must be an exact loopback origin without a path, query, or fragment.".into());
    }

    Ok(QaAiNetworkPolicy {
        mock_origin: parsed.origin().ascii_serialization(),
        allow_deepseek_smoke: allow_deepseek_smoke.map(str::trim) == Some("1"),
    })
}

fn is_loopback_origin(url: &Url) -> bool {
    if !matches!(url.scheme(), "http" | "https") || url.username() != "" || url.password().is_some()
    {
        return false;
    }
    matches!(
        url.host_str(),
        Some("127.0.0.1") | Some("::1") | Some("[::1]") | Some("localhost")
    )
}

pub(crate) fn ensure_ai_origin_allowed(identifier: &str, endpoint: &Url) -> Result<(), String> {
    ensure_ai_origin_allowed_with_policy(
        identifier,
        endpoint,
        std::env::var(QA_MOCK_ORIGIN_ENV).ok().as_deref(),
        std::env::var(QA_DEEPSEEK_SMOKE_ENV).ok().as_deref(),
    )
}

pub(crate) fn ensure_ai_origin_allowed_with_policy(
    identifier: &str,
    endpoint: &Url,
    configured_mock_origin: Option<&str>,
    allow_deepseek_smoke: Option<&str>,
) -> Result<(), String> {
    if is_production_identifier(identifier) {
        return Ok(());
    }
    if !is_qa_identifier(identifier) {
        return Err(
            "AI network requests are blocked for an unknown application identifier.".into(),
        );
    }

    let policy = qa_network_policy(configured_mock_origin, allow_deepseek_smoke)?;
    let origin = endpoint.origin().ascii_serialization();
    if origin == policy.mock_origin || (policy.allow_deepseek_smoke && origin == DEEPSEEK_ORIGIN) {
        return Ok(());
    }
    Err("QA AI requests may only target the configured local mock origin. The one-time DeepSeek smoke origin requires DAYMARK_QA_ALLOW_DEEPSEEK_SMOKE=1.".into())
}

pub(crate) fn qa_security_summary(identifier: &str) -> Option<String> {
    if !is_qa_identifier(identifier) {
        return None;
    }
    let network = match qa_network_policy_from_env() {
        Ok(policy) => format!(
            "allowed_ai_origin={} deepseek_smoke={}",
            policy.mock_origin, policy.allow_deepseek_smoke
        ),
        Err(_) => "allowed_ai_origin=blocked deepseek_smoke=false".to_string(),
    };
    Some(format!(
        "DAYMARK_QA_SECURITY identifier={} credential_namespace=qa {}",
        identifier, network
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        credential_service_for_identifier, ensure_ai_origin_allowed_with_policy, qa_network_policy,
        qa_security_summary, PRODUCTION_CREDENTIAL_SERVICE, PRODUCTION_IDENTIFIER,
        QA_CREDENTIAL_SERVICE, QA_IDENTIFIER,
    };
    use reqwest::Url;

    #[test]
    fn credential_namespace_follows_runtime_identifier() {
        assert_eq!(
            credential_service_for_identifier(PRODUCTION_IDENTIFIER).unwrap(),
            PRODUCTION_CREDENTIAL_SERVICE
        );
        assert_eq!(
            credential_service_for_identifier(QA_IDENTIFIER).unwrap(),
            QA_CREDENTIAL_SERVICE
        );
        assert!(credential_service_for_identifier("com.example.other").is_err());
    }

    #[test]
    fn qa_policy_requires_an_exact_loopback_origin() {
        assert!(qa_network_policy(None, None).is_err());
        assert!(qa_network_policy(Some("https://api.example.test"), None).is_err());
        assert!(qa_network_policy(Some("http://127.0.0.1:18888/api"), None).is_err());
        assert!(qa_network_policy(Some("http://127.0.0.1:18888"), None).is_ok());
        assert!(qa_network_policy(Some("http://localhost:18888"), None).is_ok());
        assert!(qa_network_policy(Some("http://[::1]:18888"), None).is_ok());
    }

    #[test]
    fn qa_origin_guard_allows_only_mock_or_explicit_deepseek_smoke() {
        let policy = qa_network_policy(Some("http://127.0.0.1:18888"), Some("1")).unwrap();
        assert_eq!(policy.mock_origin, "http://127.0.0.1:18888");
        assert!(policy.allow_deepseek_smoke);

        let unrelated = Url::parse("https://example.test/v1/chat/completions").unwrap();
        let mock = Url::parse("http://127.0.0.1:18888/v1/chat/completions").unwrap();
        let deepseek = Url::parse("https://api.deepseek.com/chat/completions").unwrap();

        assert!(ensure_ai_origin_allowed_with_policy(
            QA_IDENTIFIER,
            &mock,
            Some("http://127.0.0.1:18888"),
            None,
        )
        .is_ok());
        assert!(ensure_ai_origin_allowed_with_policy(
            QA_IDENTIFIER,
            &deepseek,
            Some("http://127.0.0.1:18888"),
            None,
        )
        .is_err());
        assert!(ensure_ai_origin_allowed_with_policy(
            QA_IDENTIFIER,
            &deepseek,
            Some("http://127.0.0.1:18888"),
            Some("1"),
        )
        .is_ok());
        assert!(ensure_ai_origin_allowed_with_policy(
            QA_IDENTIFIER,
            &unrelated,
            Some("http://127.0.0.1:18888"),
            Some("1"),
        )
        .is_err());
        assert!(ensure_ai_origin_allowed_with_policy(
            PRODUCTION_IDENTIFIER,
            &unrelated,
            None,
            None
        )
        .is_ok());
        assert!(
            ensure_ai_origin_allowed_with_policy("com.example.other", &unrelated, None, None)
                .is_err()
        );
    }

    #[test]
    fn qa_security_summary_never_contains_credentials() {
        let summary = qa_security_summary(QA_IDENTIFIER).unwrap();
        assert!(summary.contains("credential_namespace=qa"));
        assert!(!summary.to_ascii_lowercase().contains("api_key"));
        assert!(!summary.to_ascii_lowercase().contains("secret"));
    }
}
