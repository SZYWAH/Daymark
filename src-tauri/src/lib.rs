mod ai_secrets;
mod conversation_sessions;
mod file_commands;
mod quick_capture;
mod text_utils;

use quick_capture::{
    close_quick_capture_panel_from_escape, current_panel_is_saving, current_panel_token_option,
    dispatch_quick_capture_on_main, hide_main, hide_quick_capture_panel_impl,
    hide_quick_capture_window, hide_quick_capture_windows, main_is_available_for_hotzone,
    prewarm_quick_capture_windows, quick_capture_degraded,
    quick_capture_escape_shortcut, quick_capture_panel_is_active, quick_capture_panel_should_be_preserved,
    quick_capture_paused, reconcile_quick_capture_window_destroyed,
    remember_primary_quick_capture_monitor, route_second_launch_to_main,
    run_quick_capture_on_main, schedule_main_minimized_check,
    set_quick_capture_shortcut_error, set_quick_capture_state, setup_tray,
    show_quick_capture_hotzone_for_hidden_main_impl, show_quick_capture_panel_impl,
    start_quick_capture_lifecycle_watchdog,
    QuickCaptureState, QUICK_CAPTURE_HOTZONE_LABEL, QUICK_CAPTURE_PANEL_LABEL,
};
use std::thread;
use std::time::Duration;
use tauri::{Emitter, Manager, WebviewWindow, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

pub(crate) fn ensure_main_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("This operation can only run in the main window.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::ai_secrets::{ai_api_key_account, normalize_ai_key_base_url};
    use super::conversation_sessions::{read_session_delta, CodexSessionMeta};
    use super::file_commands::{
        classify_file_text_quality, finalize_file_text, office_xml_to_text, FILE_TEXT_MAX_CHARS,
    };
    use super::text_utils::redact_sensitive_text;
    use std::fs;

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

    #[test]
    fn session_delta_reads_only_complete_new_jsonl_lines() {
        let path = std::env::temp_dir().join(format!("daymark-delta-{}.jsonl", std::process::id()));
        let first = r#"{"payload":{"type":"message","role":"user","content":[{"text":"first note"}]}}"#;
        let second = r#"{"payload":{"type":"message","role":"assistant","content":[{"text":"api_key=sk-test-secret-1234567890"}]}}"#;
        fs::write(&path, format!("{}\n{} incomplete", first, second)).unwrap();

        let session = test_codex_session(&path);
        let delta = read_session_delta(&session, 0, None).unwrap();

        assert_eq!(delta.message_count, 1);
        assert!(delta.transcript.contains("first note"));
        assert!(!delta.transcript.contains("sk-test-secret"));
        assert_eq!(delta.next_read_offset, first.len() as u64 + 1);

        fs::write(&path, format!("{}\n{}\n", first, second)).unwrap();
        let delta = read_session_delta(&session, delta.next_read_offset, None).unwrap();

        assert_eq!(delta.message_count, 1);
        assert!(delta.redacted);
        assert!(delta.transcript.contains("已脱敏") || delta.transcript.contains("宸茶劚"));
        assert!(!delta.transcript.contains("sk-test-secret"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn session_delta_resets_when_offset_is_beyond_file_length() {
        let path = std::env::temp_dir().join(format!("daymark-delta-reset-{}.jsonl", std::process::id()));
        let line = r#"{"payload":{"type":"message","role":"user","content":[{"text":"after rewrite"}]}}"#;
        fs::write(&path, format!("{}\n", line)).unwrap();

        let session = test_codex_session(&path);
        let delta = read_session_delta(&session, 10_000, None).unwrap();

        assert!(delta.reset);
        assert_eq!(delta.previous_read_offset, 0);
        assert_eq!(delta.message_count, 1);
        assert!(delta.transcript.contains("after rewrite"));
        let _ = fs::remove_file(path);
    }

    fn test_codex_session(path: &std::path::Path) -> CodexSessionMeta {
        CodexSessionMeta {
            id: "codex-session-test".into(),
            source_kind: "codex".into(),
            source_label: "Codex".into(),
            date: "2026-07-09".into(),
            path: path.to_string_lossy().into_owned(),
            size_bytes: fs::metadata(path).unwrap().len(),
            modified_at: 0,
            cwd: None,
        }
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
                        if !window.is_minimized().unwrap_or(false)
                            && main_is_available_for_hotzone(window.app_handle())
                        {
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
            file_commands::check_local_path,
            file_commands::write_text_file,
            file_commands::read_text_file,
            ai_secrets::read_ai_api_key,
            ai_secrets::write_ai_api_key,
            ai_secrets::delete_ai_api_key,
            file_commands::get_supported_file_analysis_types,
            file_commands::extract_local_file_text,
            file_commands::get_supported_vision_types,
            file_commands::extract_local_image_data,
            conversation_sessions::probe_codex_sources,
            conversation_sessions::probe_conversation_sources,
            conversation_sessions::list_codex_session_days,
            conversation_sessions::list_conversation_session_days,
            conversation_sessions::list_codex_sessions_by_date,
            conversation_sessions::list_conversation_sessions_by_date,
            conversation_sessions::index_codex_sessions,
            conversation_sessions::index_conversation_sessions,
            conversation_sessions::read_selected_codex_sessions,
            conversation_sessions::read_selected_conversation_sessions,
            conversation_sessions::read_conversation_session_deltas,
            conversation_sessions::cancel_codex_review_job,
            conversation_sessions::cancel_conversation_review_job,
            quick_capture::show_main_window,
            quick_capture::open_main_from_quick_capture,
            quick_capture::hide_main_to_tray,
            quick_capture::show_quick_capture,
            quick_capture::show_quick_capture_hotzone,
            quick_capture::show_quick_capture_panel,
            quick_capture::hide_quick_capture_panel,
            quick_capture::return_quick_capture_to_hotzone,
            quick_capture::expand_quick_capture,
            quick_capture::collapse_quick_capture,
            quick_capture::quick_capture_window_ready,
            quick_capture::get_quick_capture_panel_token,
            quick_capture::get_quick_capture_runtime_state,
            quick_capture::finalize_quick_capture_drag,
            quick_capture::collapse_quick_capture_if_pointer_outside,
            quick_capture::set_quick_capture_saving,
            quick_capture::notify_quick_capture_saved
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
