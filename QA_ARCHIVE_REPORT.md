# Daymark archive QA report

## Remediation and installed lifecycle run — 2026-07-20

- Branch: `codex/archive-fixes`
- Security baseline installer: `Daymark QA 0.1.0-qa.1` from `522f829`
- Probe overlay: the final `test: complete archive remediation QA` commit, recorded by full hash in the qa.1 build manifest
- Installed lifecycle evidence: `work/qa/installed-cli-lifecycle-archive-final/`
- Browser evidence: `work/qa/installed-cli-browser-managed/` (8/8, managed preview exited cleanly)
- Native evidence: `work/qa/remediation-native-2/`
- Case ledger: `QA_REMEDIATION_RESULTS.md`

### Current decision

**CORE RISKS CLEARED — ELIGIBLE AS A DEVELOPMENT SNAPSHOT ARCHIVE, NOT AS A STABLE RELEASE**

The identified credential-isolation P0, startup data-loss/freeze path, accessibility blockers and inline-link performance risk were remediated. The command-line-only installed lifecycle then passed qa.1 install, synthetic state creation, qa.2 overwrite upgrade, state retention, local Mock AI, credential deletion, three cold starts and silent uninstall without changing production data-directory metadata. No P0/P1 remains in the exercised paths. The 129-case ledger still records **25 PASS / 0 FAIL / 104 UNVERIFIED / 0 BLOCKED**; therefore this is not a claim of full coverage, release readiness or 129-case success.

### Remediation evidence

| Area | Result | Evidence |
|---|---|---|
| QA credential and endpoint isolation | PASS | Runtime identifier selects `daymark.qa.ai-api-key.v1`; synthetic write → restart/read → delete passed; unknown remote origin was blocked; safety summary contained no credential value. |
| Startup resource loading | PASS (automated) | Core stores load independently with 5 s task limits; partial failure, refresh retention, retry and stale-result protection are covered by Vitest. Credential probing is non-critical. |
| Browser accessibility | PASS (covered surfaces) | Final Edge run passed 8/8 tests. All six primary pages and the 6 palettes × dark/light matrix for Today, Library and Memory had zero serious/critical axe violations. |
| Modal and semantic repairs | PASS (covered surfaces) | Import focus trap, nested confirmation Escape ordering and focus restoration passed; invalid card/folder/icon semantics and landmark issues were removed. |
| Inline-link reconciliation | PASS | Single-source updates are incremental; unchanged 1,000-item/5,000-link reconciliation retained every relation with zero inline writes. |
| Real WebView2 performance | PASS | Save 20× p95 15.4 ms, max 20.5 ms; 200-item atomic import 122.7 ms; unchanged reconcile 74.2 ms; first 5,000-link establishment 888.0 ms. |
| Large session scan | PASS (covered paths) | 2,000 synthetic sessions showed live discovering counters, 800-result cap, collapse-and-continue, cancellation with old-result retention and global task entry behavior. |
| Automated release checks | PASS | 33 Vitest files / 167 tests, 55 Rust tests, 5 QA data tests, 3 installed-startup evaluator tests and all 11 mock-service protocol/failure cases passed. |
| Installed qa.1 → qa.2 lifecycle | PASS | qa.1 seeded a deterministic item, folder, layout, settings and synthetic QA credential; qa.2 preserved them, completed one non-streaming and one streaming request against the exact loopback Mock origin, cleared the credential, restarted cleanly and uninstalled silently. |
| Cold fresh-profile startup | PASS (installed qa.2) | Three new WebView profiles each reached Today `ready` below the 5 s process-start gate; exact timings are retained in the installed lifecycle summary. The older 22.7 s / 28.3 s development-harness evidence is retained and not reclassified. |
| Production-boundary cleanup | PASS | QA install directory, uninstall registration and per-run WebView profiles were removed; production Daymark data-directory existence/last-write metadata was unchanged. No production data content was read. |
| Real DeepSeek service | UNVERIFIED | Deliberately omitted because the no-Computer-Use flow cannot satisfy the requirement that a real key never passes through Agent-controlled parameters, environment or logs. |

The exact baseline commit, probe-overlay commit and SHA-256, source commit, installer sizes and installer SHA-256 values are recorded in `work/qa/installed-cli-qa1-archive-final/qa-installer-build.json` and `work/qa/installed-cli-qa2-archive-final/qa-installer-build.json`. Keeping those generated values in manifests avoids a self-referential tracked commit hash in this report.

The no-Computer-Use run does not prove window visuals, tray behavior, native file/folder pickers, focus behavior in the installed WebView, Windows 125%/150% DPI rendering or any real AI service. Those cases remain `UNVERIFIED` and cannot be inferred from hidden process execution.

The full corrected browser run completed in 2.2 minutes with 8 expected, 0 unexpected and 0 flaky tests. The original failure evidence and conclusions remain below unchanged so the remediation can be audited against the first run.

## Initial audit — preserved evidence

- Date: 2026-07-19
- Branch: `codex/archive-qa`
- Product baseline: `e5542b6`
- Primary evidence run: `work/qa/archive-qa-20260719-195213/`
- Corrected-fixture run: `work/qa/archive-qa-20260719-final/`
- Scope: audit and QA infrastructure only; no product defect was changed

## Decision

**NEEDS FIXES BEFORE STABLE ARCHIVE**

The source can be retained as a development snapshot with known limitations. It must not be labelled fully tested, stable, release-ready, or a program whose every panel and control has been checked.

The stop condition was a P0 QA isolation failure: the QA Tauri identity and profile do not isolate Windows Credential Manager, while the application uses the fixed production credential service `daymark.ai-api-key.v1`. A fresh `Daymark QA` process therefore read the production credential namespace at startup. No key value was printed in the report or intentionally sent to a service, but the process boundary was already crossed, so all later native cases were stopped.

The QA native launcher now fails closed until a dedicated `daymark.qa.ai-api-key.v1` service exists. This is a guard in the QA harness, not a fix to production credential routing.

## Gate status

| Gate | Result | Evidence |
|---|---|---|
| Every visible page/control has a recorded outcome | FAIL | The matrix catalogs 129 high-level cases, but P0 stopped the native run before full execution. Missing records are `UNVERIFIED`, never inferred as pass. |
| P0/P1 count is zero | FAIL | One open P0 isolation failure; one native startup P1 candidate lacks reproducibility evidence. |
| Backup/version/scan/AI/link invariants all pass | NOT MET | Selected data invariants passed; native scan, integrated AI and backup UI remained blocked. |
| Browser smoke | FAIL | 5 passed, 2 failed, 0 flaky. Both failures are accessibility gates. |
| Production checks/build | PASS | TypeScript, 157 Vitest tests, 48 Rust tests and frontend production build passed. |
| QA NSIS build | PASS (build only) | Installer produced and hashed; installation/upgrade was not authorized or executed. |

## Findings

### P0 — open: QA credential namespace is not isolated

- Cases: `N-00`, `N-06`, and all credential-mutating parts of `C-03`/`C-04`.
- The QA app had its own Tauri identifier, title, WebView data directory and synthetic `USERPROFILE`.
- `src-tauri/src/ai_secrets.rs` nevertheless uses a fixed Windows credential service name shared with production; its account key is derived only from provider and base URL.
- A fresh QA window displayed that a credential already existed, proving the production namespace was read by the QA process.
- The Tauri process was stopped immediately. No clear/save/test-connection action and no real AI request was performed.
- Required before resuming native QA: a dedicated QA credential service, a startup hard failure if production service resolution occurs, and loopback-only AI endpoints with synthetic keys.

### P0 incident — contained: browser artifacts inherited process secrets

The first Playwright configuration spread the parent process environment into `webServer.env`; its JSON report serialized environment variables, including secret-bearing variables. The contaminated Playwright and web-server artifact directories were deleted locally, the configuration was changed to pass only `VITE_ENABLE_DEMO_SEED`, and the whole browser suite was rerun. A scan of the clean run found no matching secret material. No contaminated artifact is tracked, committed or uploaded.

### P1 candidate — native first-load Today state

On one fresh isolated native start, Today remained at “正在整理今日内容” for more than 26 seconds while Library was usable. `Ctrl+R` recovered immediately. Because the P0 stop prevented clean-profile reproduction and the launcher did not retain native console evidence, record this as **one observed P1 candidate**, not a diagnosed or reproducible product defect.

### P2-high — Import dialog focus management

`A-01` failed in system Edge:

- The first `Tab` moved focus outside the dialog into the background.
- `Escape` closed the dialog, but focus did not return to “导入资料”.

This is one focus-management root cause with two symptoms. It blocks the current accessibility acceptance gate.

### P2 — primary-page accessibility

`A-07` found the following serious or critical nodes in the default state:

| Surface | Nodes | Finding |
|---|---:|---|
| Library | 25 | `aria-selected` is invalid on articles with `role="button"`. |
| Library | 14 | Folder expand buttons have no accessible name. |
| Library | 1 | A plain `div` uses a prohibited `aria-label`. |
| Library | 5 | Color contrast failures. |
| Today | 1 | Color contrast failure on “此刻记录”. |
| Memory | 1 | Color contrast failure in the empty-state explanation. |

The 45 Library nodes represent four systemic causes, not 45 independent defects. Additional moderate landmark issues are P3: nested/repeated `main` landmarks, Library missing an `h1`, and a non-unique Memory navigation landmark label.

### Performance signal — desktop unverified

- A Node `fake-indexeddb` bulk transaction wrote 10/100/500/1,000 empty-body items in 1/3/15/20 ms. This is **not** the real UI import path and must not be reported as UI import performance.
- A complete rebuild for 1,000 items and 5,000 inline references took 13,717 ms in the primary Node run. A final rerun performed concurrently with Rust and production builds took 23,040 ms, so it is not a comparable benchmark. Both runs produced 5,000 unique relations and retained the manual relation.
- This is a high-risk algorithmic signal and a P1 candidate only. WebView2 IndexedDB, ordinary item save and the UI's per-item import loop remain unverified; no controlled warm/cold median, p95 or SLA was established.

## Directly observed passes

### Product checks

- `pnpm check`: typecheck passed; 31 Vitest files / 157 tests passed; 48 Rust tests passed.
- `pnpm build`: passed. The existing approximately 992 kB bundle warning remains informational.
- No production source file was changed during this audit.

### Browser smoke in installed Microsoft Edge

Five of seven Playwright tests passed:

- `G-02`: first-run guide focus trap, close and persistence.
- `G-03` / route portion of `S-01`: all six top-level routes and one current state.
- `A-05`: eight browser viewports had no document-level horizontal overflow.
- `C-01`: six palettes in light/dark mode rendered with matching root theme attributes.
- `A-08`: no infinite animation under reduced-motion emulation.

These results do not prove every component inside those pages, touch target quality, runtime performance, or native desktop behavior.

### Data-layer assertions

The separate QA data suite passed 5/5 assertions:

- A schema-invalid backup rejected before mutation kept the existing core payload unchanged.
- Daily-review origin metadata survived a core backup v1 round trip.
- 10/100/500/1,000 records completed one transactional bulk-write baseline.
- 5,000 inline references rebuilt with source/target deduplication and a manual link preserved.
- Search matched an internal link's display title without exposing its stable target ID in the snippet.

These are partial data assertions, not full passes for the broader matrix cases covering UI backup, all version conflicts, import and search navigation.

### Mock AI service self-test

The mock service itself passed 11/11 protocol-shape cases: models, Chat Completions, Responses streaming, Anthropic Messages, 401, 429, 500, empty output, slow stream, client cancellation and stream drop. Its request log records size, SHA-256 and authentication kind, not body or credential values.

This does not prove Daymark's integrated streaming display, Tauri cancellation command, retry/checkpoint recovery or three-protocol settings UI; those native flows are blocked.

### QA fixtures and build

- Corrected import boundaries use exactly 40,000,000/40,000,001 text bytes and 20,000,000/20,000,001 image bytes.
- Synthetic session profiles contain 0/600/800/2,000 ordinary candidates plus cross-day, incomplete-tail, oversized-line, append-pair and truncate-pair cases. Each profile has an aggregate SHA-256 in the manifest.
- The 100-revision provenance fixture now includes source, restore and reactivation revision kinds. It is still a static backup fixture, not a full formal-review source store.
- QA installer build:
  - Path: `src-tauri/target/release/bundle/nsis/Daymark QA_0.1.0-rc.10_x64-setup.exe`
  - Bytes: `210937219`
  - SHA-256: `E8E4A722E05909B4E0DA239DDF0B55D548959A03D619ED659D78BA531DCE9B0B`

## Blocked or unverified

The following do not count as passing:

- Native session scan progress, cancellation, restart, cache/append/truncate behavior and scan/generation mutual exclusion.
- Daymark-to-mock integration for slow streams, cancellation, retry, disconnect and checkpoint recovery.
- Native backup export, deliberate damage, restore, restart and non-core-store behavior.
- System file/folder chooser and actual Daymark import of txt/md/csv/pdf/docx/pptx/xlsx/images, including corrupt and size-boundary cases.
- Tray close/restore, quick-capture window/hotspot and persisted window state across full scenarios.
- Exact `1100×720`, `1280×820`, `1440×900` matrix at Windows 125% and 150% scaling.
- Keyboard/focus behavior for every modal and nested overlay.
- Real service smoke; intentionally omitted after the isolation failure.
- Installer install, overwrite-upgrade, uninstall and retained-data behavior.
- Complete manual visual review of every primary page, modal, empty state, long-content state and all theme combinations.

## Evidence and reproducibility

Raw artifacts are intentionally ignored by Git and remain local:

- Browser JSON, screenshots, traces and HTML report: `work/qa/archive-qa-20260719-195213/playwright/`
- Data metrics: `work/qa/archive-qa-20260719-195213/data-metrics.json`
- Mock results and privacy-safe request log: `work/qa/archive-qa-20260719-195213/mock-ai-selftest.json` and `mock-ai-requests.jsonl`
- Corrected fixture manifest: `work/qa/archive-qa-20260719-final/manifest.json`

The reusable matrix is `qa/QA_MATRIX.md`, and `qa/CASE_RESULT_TEMPLATE.md` defines the mandatory per-case fields. Unexecuted matrix rows are explicitly `UNVERIFIED`; native-dependent rows after `N-00` are `BLOCKED` by the P0 gate.

## Required next action if development resumes

Implement QA-only credential routing and loopback endpoint enforcement first. Then rerun `N-00` on a clean profile and verify write → restart/read → clear without accessing production credentials. Only after that gate passes should the native matrix resume, beginning with the first-load Today symptom, scan/cancel, integrated mock AI, backup/restore and import boundaries.
