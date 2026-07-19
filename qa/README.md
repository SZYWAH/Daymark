# Daymark archive QA

This directory contains audit-only infrastructure. It must not use the production Daymark profile, real conversation data, or real API keys.

## Isolation rules

- Tauri identity: `com.szywah.daymark.qa` / `Daymark QA`.
- WebView data directory: `daymark-qa-webview`.
- Every native run uses `work/qa/<run-id>/profile` as both `USERPROFILE` and `HOME`.
- The launcher refuses to start while a production `Daymark.exe` process exists.
- The native launcher is intentionally hard-blocked until Daymark implements the dedicated `daymark.qa.ai-api-key.v1` Windows credential namespace. `USERPROFILE` and the Tauri identifier do not isolate Credential Manager.
- AI request logs contain body length and SHA-256 only, never request bodies or credentials.
- Any evidence of real-data access, secret logging, partial backup restore, or data loss is P0 and stops the run.

## Commands

```powershell
pnpm qa:fixtures -- archive-qa-YYYYMMDD
$env:DAYMARK_QA_RUN_DIR = "work/qa/archive-qa-YYYYMMDD"
pnpm qa:mock-ai
pnpm qa:data
pnpm qa:web
# Expected to stop at the credential isolation gate until the QA-only service exists:
pnpm qa:tauri:dev -RunId archive-qa-YYYYMMDD
pnpm qa:tauri:build
```

Playwright uses the installed Microsoft Edge channel and does not download a browser to the system drive. Raw artifacts stay under ignored `work/qa/`; the repository report contains only sanitized conclusions.

The mock service selects failure behavior through the model name: `qa-success`, `qa-slow`, `qa-slow-stream`, `qa-empty`, `qa-401`, `qa-429`, `qa-500`, and `qa-drop`. It implements OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages response shapes.

Generated size boundaries use the application's decimal limits (40,000,000 text bytes and 20,000,000 image bytes). The primary synthetic session profile also contains cross-day, incomplete-tail, oversized-line, append-pair and truncate-pair cases. Each profile stores one deterministic aggregate hash in the manifest; no real session path or content is used.

## Result vocabulary

- `PASS`: expected behavior was directly observed with evidence.
- `FAIL`: reproducible mismatch; report severity P0-P3.
- `UNVERIFIED`: not executed or environment cannot prove it. It never counts as pass.
- `BLOCKED`: an earlier safety gate prevented execution.

Each executed case records fixture, steps, expected result, environment, actual result, evidence path, severity, and reproducibility in the run report.
