# Daymark archive QA

This directory contains audit-only infrastructure. It must not use the production Daymark profile, real conversation data, or real API keys.

## Isolation rules

- Tauri identity: `com.szywah.daymark.qa` / `Daymark QA`.
- Every native run writes a generated Tauri config with `work/qa/<run-id>/webview-data` as its WebView data directory; it also sets `WEBVIEW2_USER_DATA_FOLDER` to the same location.
- Every native run uses `work/qa/<run-id>/profile` as both `USERPROFILE` and `HOME`.
- The launcher refuses to start while a production `Daymark.exe` process exists.
- Runtime identifier controls the credential namespace: production uses `daymark.ai-api-key.v1`, while `com.szywah.daymark.qa` uses `daymark.qa.ai-api-key.v1`. The launcher executes the Rust security tests before it can start Tauri.
- In QA, AI traffic is blocked unless its origin exactly matches `DAYMARK_QA_MOCK_ORIGIN` (a loopback origin). `-AllowDeepSeekSmoke` is the only opt-in that additionally permits `https://api.deepseek.com`; it is for the user-operated, one-time fake-text smoke only.
- AI request logs contain body length and SHA-256 only, never request bodies or credentials.
- Any evidence of real-data access, secret logging, partial backup restore, or data loss is P0 and stops the run.

## Commands

```powershell
pnpm qa:fixtures -- archive-qa-YYYYMMDD
$env:DAYMARK_QA_RUN_DIR = "work/qa/archive-qa-YYYYMMDD"
pnpm qa:mock-ai
pnpm qa:data
pnpm qa:web
# Start qa:mock-ai in a separate terminal first, then run the native QA window:
pnpm qa:tauri:dev -RunId archive-qa-YYYYMMDD
# Verify native isolation without starting a window:
pnpm qa:tauri:dev -RunId archive-qa-YYYYMMDD -ValidateOnly
# One-time, user-operated real-service smoke only:
pnpm qa:tauri:dev -RunId archive-qa-YYYYMMDD -AllowDeepSeekSmoke
pnpm qa:tauri:build -- -Qualifier qa.2 -RunId archive-qa-final
# Rebuild an earlier commit from an isolated worktree without switching this checkout:
pnpm qa:tauri:build -- -Qualifier qa.1 -RunId archive-qa-security -SourceRoot D:\path\to\daymark-qa1 -BaseCommit 522f829 -ProbeOverlayCommit <final-qa-commit>
# After qa.1 and qa.2 exist, run the no-Computer-Use install/upgrade lifecycle with PowerShell 7:
pnpm qa:installed:unit
pnpm qa:installed:lifecycle -- -Qa1Installer <qa.1-setup.exe> -Qa2Installer <qa.2-setup.exe> -RunId archive-qa-installed
```

The QA build wrapper writes a temporary version override, copies the installer, and records a SHA-256 manifest under `work/qa/<run-id>/`; it never changes the product version in `package.json` or `src-tauri/tauri.conf.json`.

The installed lifecycle is command-line only. Its QA automation probe is rejected unless the runtime identifier is `com.szywah.daymark.qa`, `DAYMARK_QA_AUTOMATION=1`, the scenario is allowlisted, and the evidence path is inside the run directory. It uses a per-run WebView profile, writes synthetic state through application data APIs, exercises only the exact loopback Mock origin, exits through a QA-only command, and attempts silent uninstall plus bounded profile cleanup even after a failed assertion. It does not claim visual, tray, native file-picker, focus, DPI, or real-service coverage.

Playwright uses the installed Microsoft Edge channel and does not download a browser to the system drive. Raw artifacts stay under ignored `work/qa/`; the repository report contains only sanitized conclusions.

The mock service selects failure behavior through the model name: `qa-success`, `qa-slow`, `qa-slow-stream`, `qa-empty`, `qa-401`, `qa-429`, `qa-500`, and `qa-drop`. It implements OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages response shapes.

Generated size boundaries use the application's decimal limits (40,000,000 text bytes and 20,000,000 image bytes). The primary synthetic session profile also contains cross-day, incomplete-tail, oversized-line, append-pair and truncate-pair cases. Each profile stores one deterministic aggregate hash in the manifest; no real session path or content is used.

## Result vocabulary

- `PASS`: expected behavior was directly observed with evidence.
- `FAIL`: reproducible mismatch; report severity P0-P3.
- `UNVERIFIED`: not executed or environment cannot prove it. It never counts as pass.
- `BLOCKED`: an earlier safety gate prevented execution.

Each executed case records fixture, steps, expected result, environment, actual result, evidence path, severity, and reproducibility in the run report.
