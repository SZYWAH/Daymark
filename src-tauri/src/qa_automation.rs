use crate::{ai_security, ensure_main_window};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;
use std::time::Instant;
use tauri::{AppHandle, Manager, WebviewWindow};

const ENABLE_ENV: &str = "DAYMARK_QA_AUTOMATION";
const RUN_DIR_ENV: &str = "DAYMARK_QA_RUN_DIR";
const SCENARIO_ENV: &str = "DAYMARK_QA_SCENARIO";
const EVIDENCE_ENV: &str = "DAYMARK_QA_EVIDENCE_PATH";
const EVIDENCE_SCHEMA: &str = "daymark.qa-automation-event.v1";

static PROCESS_STARTED_AT: OnceLock<Instant> = OnceLock::new();

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum QaAutomationScenario {
    SeedUpgrade,
    VerifyUpgrade,
    VerifyCredentialCleared,
    StartupProbe,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QaAutomationConfig {
    scenario: QaAutomationScenario,
    mock_origin: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum QaAutomationStage {
    FrontendMounted,
    DashboardReady,
    DashboardFailed,
    Seeded,
    UpgradeVerified,
    CredentialCleared,
    AiNonStream,
    AiStream,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum QaAutomationOutcome {
    Info,
    Pass,
    Fail,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QaAutomationRecordInput {
    stage: QaAutomationStage,
    outcome: QaAutomationOutcome,
    elapsed_ms: u64,
    #[serde(default)]
    metrics: BTreeMap<String, u64>,
    #[serde(default)]
    checks: BTreeMap<String, bool>,
    #[serde(default)]
    fingerprints: BTreeMap<String, String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QaAutomationEvidence<'a> {
    schema: &'static str,
    scenario: QaAutomationScenario,
    stage: QaAutomationStage,
    outcome: QaAutomationOutcome,
    process_elapsed_ms: u64,
    reported_elapsed_ms: u64,
    metrics: &'a BTreeMap<String, u64>,
    checks: &'a BTreeMap<String, bool>,
    fingerprints: &'a BTreeMap<String, String>,
}

#[derive(Debug, Clone)]
struct ResolvedQaAutomation {
    scenario: QaAutomationScenario,
    evidence_path: PathBuf,
    mock_origin: String,
}

pub(crate) fn initialize() {
    let _ = PROCESS_STARTED_AT.set(Instant::now());
}

pub(crate) fn is_active_for_identifier(identifier: &str) -> bool {
    resolve_from_values(
        identifier,
        std::env::var(ENABLE_ENV).ok().as_deref(),
        std::env::var(RUN_DIR_ENV).ok().as_deref(),
        std::env::var(SCENARIO_ENV).ok().as_deref(),
        std::env::var(EVIDENCE_ENV).ok().as_deref(),
        std::env::var("DAYMARK_QA_MOCK_ORIGIN").ok().as_deref(),
    )
    .is_ok()
}

fn resolve_for_identifier(identifier: &str) -> Result<Option<ResolvedQaAutomation>, String> {
    let enabled = std::env::var(ENABLE_ENV).ok();
    if enabled.as_deref().map(str::trim) != Some("1") {
        return Ok(None);
    }
    resolve_from_values(
        identifier,
        enabled.as_deref(),
        std::env::var(RUN_DIR_ENV).ok().as_deref(),
        std::env::var(SCENARIO_ENV).ok().as_deref(),
        std::env::var(EVIDENCE_ENV).ok().as_deref(),
        std::env::var("DAYMARK_QA_MOCK_ORIGIN").ok().as_deref(),
    )
    .map(Some)
}

fn resolve_from_values(
    identifier: &str,
    enabled: Option<&str>,
    run_dir: Option<&str>,
    scenario: Option<&str>,
    evidence_path: Option<&str>,
    mock_origin: Option<&str>,
) -> Result<ResolvedQaAutomation, String> {
    if enabled.map(str::trim) != Some("1") {
        return Err("QA automation is disabled.".into());
    }
    if !ai_security::is_qa_identifier(identifier) {
        return Err("QA automation is blocked for this application identifier.".into());
    }

    let scenario = match scenario.map(str::trim) {
        Some("seed-upgrade") => QaAutomationScenario::SeedUpgrade,
        Some("verify-upgrade") => QaAutomationScenario::VerifyUpgrade,
        Some("verify-credential-cleared") => QaAutomationScenario::VerifyCredentialCleared,
        Some("startup-probe") => QaAutomationScenario::StartupProbe,
        _ => return Err("Unknown QA automation scenario.".into()),
    };
    let run_dir = run_dir
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "QA automation run directory is missing.".to_string())?;
    let evidence_path = evidence_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "QA automation evidence path is missing.".to_string())?;
    let evidence_path = validate_evidence_path(Path::new(run_dir), Path::new(evidence_path))?;

    let mock_origin = mock_origin
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "QA automation mock origin is missing.".to_string())?;
    let parsed = reqwest::Url::parse(mock_origin)
        .map_err(|_| "QA automation mock origin is invalid.".to_string())?;
    ai_security::ensure_ai_origin_allowed_with_policy(
        identifier,
        &parsed,
        Some(mock_origin),
        None,
    )?;
    if parsed.as_str().trim_end_matches('/') != parsed.origin().ascii_serialization() {
        return Err("QA automation requires an exact mock origin.".into());
    }

    Ok(ResolvedQaAutomation {
        scenario,
        evidence_path,
        mock_origin: parsed.origin().ascii_serialization(),
    })
}

fn validate_evidence_path(run_dir: &Path, evidence_path: &Path) -> Result<PathBuf, String> {
    if !run_dir.is_absolute() || !evidence_path.is_absolute() {
        return Err("QA automation paths must be absolute.".into());
    }
    if evidence_path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("QA automation evidence path cannot contain parent traversal.".into());
    }
    let canonical_run = run_dir
        .canonicalize()
        .map_err(|_| "QA automation run directory is unavailable.".to_string())?;
    let parent = evidence_path
        .parent()
        .ok_or_else(|| "QA automation evidence parent is unavailable.".to_string())?
        .canonicalize()
        .map_err(|_| "QA automation evidence parent is unavailable.".to_string())?;
    if !parent.starts_with(&canonical_run) {
        return Err("QA automation evidence path is outside the run directory.".into());
    }
    let file_name = evidence_path
        .file_name()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "QA automation evidence file name is missing.".to_string())?;
    Ok(parent.join(file_name))
}

fn validate_record(record: &QaAutomationRecordInput) -> Result<(), String> {
    if record.elapsed_ms > 3_600_000 {
        return Err("QA automation elapsed time is out of range.".into());
    }
    for key in record
        .metrics
        .keys()
        .chain(record.checks.keys())
        .chain(record.fingerprints.keys())
    {
        if key.is_empty()
            || key.len() > 48
            || !key
                .bytes()
                .all(|value| value.is_ascii_lowercase() || value.is_ascii_digit() || value == b'-' || value == b'_')
        {
            return Err("QA automation evidence key is invalid.".into());
        }
    }
    if record
        .fingerprints
        .values()
        .any(|value| value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()))
    {
        return Err("QA automation fingerprints must be SHA-256 hex values.".into());
    }
    Ok(())
}

fn append_record(
    resolved: &ResolvedQaAutomation,
    record: &QaAutomationRecordInput,
) -> Result<(), String> {
    validate_record(record)?;
    let event = QaAutomationEvidence {
        schema: EVIDENCE_SCHEMA,
        scenario: resolved.scenario,
        stage: record.stage,
        outcome: record.outcome,
        process_elapsed_ms: PROCESS_STARTED_AT
            .get_or_init(Instant::now)
            .elapsed()
            .as_millis()
            .min(u64::MAX as u128) as u64,
        reported_elapsed_ms: record.elapsed_ms,
        metrics: &record.metrics,
        checks: &record.checks,
        fingerprints: &record.fingerprints,
    };
    let line = serde_json::to_string(&event)
        .map_err(|_| "Unable to encode QA automation evidence.".to_string())?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&resolved.evidence_path)
        .map_err(|_| "Unable to open QA automation evidence.".to_string())?;
    writeln!(file, "{line}")
        .map_err(|_| "Unable to append QA automation evidence.".to_string())
}

#[tauri::command]
pub(crate) fn qa_automation_config(
    window: WebviewWindow,
) -> Result<Option<QaAutomationConfig>, String> {
    ensure_main_window(&window)?;
    let Some(resolved) = resolve_for_identifier(&window.app_handle().config().identifier)? else {
        return Ok(None);
    };
    Ok(Some(QaAutomationConfig {
        scenario: resolved.scenario,
        mock_origin: resolved.mock_origin,
    }))
}

#[tauri::command]
pub(crate) fn qa_automation_record(
    window: WebviewWindow,
    record: QaAutomationRecordInput,
) -> Result<(), String> {
    ensure_main_window(&window)?;
    let resolved = resolve_for_identifier(&window.app_handle().config().identifier)?
        .ok_or_else(|| "QA automation is disabled.".to_string())?;
    append_record(&resolved, &record)
}

#[tauri::command]
pub(crate) fn qa_automation_finish(
    window: WebviewWindow,
    app: AppHandle,
    success: bool,
) -> Result<(), String> {
    ensure_main_window(&window)?;
    resolve_for_identifier(&window.app_handle().config().identifier)?
        .ok_or_else(|| "QA automation is disabled.".to_string())?;
    app.exit(if success { 0 } else { 2 });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        resolve_from_values, validate_evidence_path, validate_record, QaAutomationOutcome,
        QaAutomationRecordInput, QaAutomationStage,
    };
    use crate::ai_security::{PRODUCTION_IDENTIFIER, QA_IDENTIFIER};
    use std::collections::BTreeMap;
    use std::fs;

    fn temp_root(name: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "daymark-qa-automation-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("evidence")).unwrap();
        root
    }

    #[test]
    fn production_identifier_cannot_enable_automation() {
        let root = temp_root("prod");
        let evidence = root.join("evidence/events.jsonl");
        let result = resolve_from_values(
            PRODUCTION_IDENTIFIER,
            Some("1"),
            root.to_str(),
            Some("startup-probe"),
            evidence.to_str(),
            Some("http://127.0.0.1:18888"),
        );
        assert!(result.is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn qa_automation_requires_known_scenario_and_bounded_path() {
        let root = temp_root("bounds");
        let evidence = root.join("evidence/events.jsonl");
        assert!(resolve_from_values(
            QA_IDENTIFIER,
            Some("1"),
            root.to_str(),
            Some("seed-upgrade"),
            evidence.to_str(),
            Some("http://127.0.0.1:18888"),
        )
        .is_ok());
        assert!(resolve_from_values(
            QA_IDENTIFIER,
            Some("1"),
            root.to_str(),
            Some("unknown"),
            evidence.to_str(),
            Some("http://127.0.0.1:18888"),
        )
        .is_err());
        let outside = std::env::temp_dir().join("daymark-qa-outside.jsonl");
        assert!(validate_evidence_path(&root, &outside).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn evidence_rejects_arbitrary_text_and_non_hash_fingerprints() {
        let mut checks = BTreeMap::new();
        checks.insert("credential-present".to_string(), true);
        let valid = QaAutomationRecordInput {
            stage: QaAutomationStage::UpgradeVerified,
            outcome: QaAutomationOutcome::Pass,
            elapsed_ms: 250,
            metrics: BTreeMap::new(),
            checks,
            fingerprints: BTreeMap::from([("item".into(), "a".repeat(64))]),
        };
        assert!(validate_record(&valid).is_ok());

        let mut invalid = valid;
        invalid
            .fingerprints
            .insert("item".into(), "synthetic title".into());
        assert!(validate_record(&invalid).is_err());
    }
}
