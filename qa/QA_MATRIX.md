# Daymark archive QA matrix

All case IDs below require a result of `PASS`, `FAIL`, `UNVERIFIED`, or `BLOCKED`. Browser evidence cannot satisfy native cases, and narrow browser viewports cannot satisfy the Tauri minimum-window cases.

## Global and startup

| ID | Case |
|---|---|
| G-01 | Startup screen minimum display and load failure |
| G-02 | First-run guide complete, dismiss, focus trap and persistence |
| G-03 | Six primary routes and one current navigation state |
| G-04 | Sidebar collapse, expand, resize and reset |
| G-05 | Library-specific global rail transition |
| G-06 | Narrow bottom navigation |
| G-07 | Global search entry and route return |
| G-08 | Scan/review global task-entry visibility and priority |
| G-09 | Restart persistence for layout, theme and drafts |
| G-10 | Unsaved-content confirmation across route changes |

## Today and journals

| ID | Case |
|---|---|
| T-01 | Quick record empty, save and failure retention |
| T-02 | Ctrl/Cmd+Enter and expanded writing |
| T-03 | Expanded writing Escape and focus return |
| T-04 | Four quick cards, empty and overflow states |
| T-05 | Journal, inbox and todo entity navigation |
| T-06 | AI daily review and memory-review entries |
| T-07 | Legacy Today review scan/generate confirmation flow |
| T-08 | Rolling review read, archive and library publication |
| J-01 | Date selection, calendar navigation and today reset |
| J-02 | Journal search and result expansion |
| J-03 | Create content, tags, todos and empty validation |
| J-04 | Edit, cancel, save and cross-entry discard |
| J-05 | Expand, fullscreen and quiet writing |
| J-06 | Delete confirmation and rollback |
| J-07 | Extract knowledge card and discard draft |
| J-08 | Day/week/month summaries and busy states |
| J-09 | Journal manual link create, delete and navigate |

## Library, import and reading

| ID | Case |
|---|---|
| L-01 | Six smart views |
| L-02 | Folder expand, child, rename, delete and non-empty guard |
| L-03 | Search, status filter and empty import entry |
| L-04 | Card Enter and Space activation |
| L-05 | Directory/list collapse, resize and reset |
| L-06 | Create, edit, save and discard item |
| L-07 | Favorite, folder, process, reading and todo updates |
| L-08 | Delete consistency between list and reader |
| L-09 | Long title, 100 tags, deep path and long content |
| I-01 | Card, file, folder and URL import |
| I-02 | Native file/folder chooser cancel and selection |
| I-03 | Batch draft edit, remove, back and discard |
| I-04 | txt/md/csv/pdf/docx/pptx/xlsx/image success, empty, corrupt, fake extension and size limits |
| I-05 | Copy/open/reveal attachment path and missing path |
| I-06 | Open URL and invalid URL feedback |
| R-01 | Reader empty selection and return |
| R-02 | AI actions confirm, run, stop and failure retention |
| R-03 | AI summary, todos and run-history expansion |
| R-04 | Reader folder/process/reading updates |
| R-05 | Source URL and attachment native open |
| R-06 | AI scope, redaction, failure matrix, cancel and retry |

## Markdown and knowledge links

| ID | Case |
|---|---|
| MD-01 | Headings, lists, tables, tasks, footnotes, code and single breaks |
| MD-02 | HTML, script and event attributes never execute |
| MD-03 | HTTP/HTTPS/mailto opens externally once |
| MD-04 | javascript/data/file/relative/unknown schemes blocked |
| MD-05 | HTTPS image lazy load and unsafe image blocking |
| MD-06 | Toolbar, selection, shortcuts and cursor recovery |
| MD-07 | Split preview, narrow tabs and preview debounce |
| K-01 | Stable, alias, unbound, self and missing references |
| K-02 | Code/HTML/standard link/image parsing exclusions |
| K-03 | `[[`, toolbar and Ctrl/Cmd+Shift+K suggestions |
| K-04 | Duplicate title path, ranking and eight-result limit |
| K-05 | Suggestion keyboard controls and nested Escape |
| K-06 | Rename follows title while alias stays fixed |
| K-07 | Outgoing, backlink, broken and manual panels/counts |
| K-08 | Multi-position merge and context truncation |
| K-09 | Multi-level item navigation stack |
| K-10 | Deleted target leaves source body and shows broken state |
| K-11 | Inline rebuild preserves manual links |

## Daily-review publication and versions

| ID | Case |
|---|---|
| V-01 | Publish source, combined and archived rolling reviews |
| V-02 | Unarchived rolling review cannot publish |
| V-03 | Publish defaults, edits, validation and discard |
| V-04 | Idempotent publish and republish after deletion |
| V-05 | Source update badge and search deduplication |
| V-06 | Source card current/changed/missing/manually-edited states |
| V-07 | Item to source review return context |
| V-08 | Review to item return context |
| V-09 | Compare, update current, create version and discard |
| V-10 | History, open current and restore as new revision |
| V-11 | Reactivation, delete head and delete all fallback |
| V-12 | Historical revisions hidden from normal surfaces |

## Memory, scanning and generation

| ID | Case |
|---|---|
| M-01 | Long-term memory edit, expand and save |
| M-02 | Review filters, dates, sources, cwd and keyword |
| M-03 | Single-source lock, unlock and mixed-source select-all guard |
| M-04 | Unique primary action for all scan/generate states |
| M-05 | Risk confirmation and invalidation after selection changes |
| M-06 | Session preview, copy and privacy notice |
| M-07 | Archive filtering, reading, merge, replacement and discard |
| M-08 | Memory suggestion generate, edit, apply and ignore |
| M-09 | Legacy memory activate and archive |
| M-10 | Active generation hides interrupted-history actions |
| Q-01 | Dated and undated scans open workspace immediately |
| Q-02 | Discovering/verifying/background/completed counters |
| Q-03 | Large-file metrics change without fake percentage |
| Q-04 | Collapse, route away and global scan entry |
| Q-05 | Cancelling disabled, prior result retained and background indexing restored |
| Q-06 | Failed/cancelled return and rescan |
| Q-07 | Scan/generation mutual exclusion |
| Q-08 | Generation locate/read/chunk/compress/merge/memory stages |
| Q-09 | Cancel, pause, resume, restart and delete generation |
| Q-10 | Slow, empty, 401, 429, 500, drop, retry and checkpoint recovery |
| Q-11 | Events, UI and logs contain no path/title/body privacy fields |

## Search and settings

| ID | Case |
|---|---|
| S-01 | Empty, no-result and clear search |
| S-02 | Title/body/tag/summary/link-display match |
| S-03 | Stable IDs hidden from snippets |
| S-04 | Item/journal/memory/summary/review route navigation |
| S-05 | Current/changed/missing source result rules |
| S-06 | Historical revisions hidden and return chain reset |
| C-01 | Six palettes, dark/light/system and accent choices |
| C-02 | Three AI protocols, discovery, reasoning, vision, stream and auth |
| C-03 | AI settings save, test and discard |
| C-04 | API-key clearing scoped by provider and URL |
| C-05 | Date-index idle completion, clear and busy state |
| C-06 | Rolling review toggle, source guard and update-now |
| C-07 | Backup export, corruption, restore and non-core preservation |
| C-08 | Demo-data install, repeat and safe delete |
| C-09 | Help, reopen onboarding and local-source probe |

## Native and general usability

| ID | Case |
|---|---|
| N-00 | QA credential namespace is independent from production and native AI endpoints are loopback-only |
| N-01 | Minimize, maximize, close-to-tray and tray restore |
| N-02 | Main-window position and size restore |
| N-03 | Quick-capture hotspot expand, collapse and return |
| N-04 | Ctrl+Shift+Space, capture save/failure and main-window open |
| N-05 | Native chooser, external link, file open and reveal |
| N-06 | QA identity, isolated data/profile and production-process gate |
| A-01 | Modal Tab loop, Escape and focus restoration |
| A-02 | Busy state blocks duplicate submit |
| A-03 | Nested overlay close order |
| A-04 | Modal background cannot be operated |
| A-05 | Eight responsive browser viewports have no overflow/dead scroll |
| A-06 | 1100x720, 1280x820, 1440x900 native windows at 125%/150% scaling |
| A-07 | Accessible names, roles, contrast and targets via axe plus manual review |
| A-08 | Reduced motion removes continuous animation |

## Severity

- P0: data corruption/loss, privacy boundary breach or security defect. Stop immediately.
- P1: core flow blocked, unrecoverable state, or unexplained freeze longer than five seconds.
- P2: state, navigation, focus, responsive or design-consistency defect.
- P3: low-frequency visual, wording or minor usability defect.
