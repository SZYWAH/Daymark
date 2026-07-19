# Daymark archive remediation case results

- Run: `archive-remediation-installed-20260720`
- Branch: `codex/archive-fixes`
- Result: PASS 25 / FAIL 0 / UNVERIFIED 104 / BLOCKED 0
- Rule: only direct end-to-end evidence can mark a whole high-level case PASS; UNVERIFIED never counts as pass.

| ID | Case | Result | Environment | Actual result | Evidence | Severity | Reproducibility |
|---|---|---|---|---|---|---|---|
| G-01 | Startup screen minimum display and load failure | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| G-02 | First-run guide complete, dismiss, focus trap and persistence | PASS | Microsoft Edge Playwright | 首次引导焦点受限，可关闭，重新打开页面后保持已完成。 | work/qa/remediation-browser-final6/playwright/results.json | — | 最终全套 1/1；独立旧跑通过 |
| G-03 | Six primary routes and one current navigation state | PASS | Microsoft Edge Playwright | 六个一级入口均只有一个 aria-current 页面。 | work/qa/remediation-browser-final6/playwright/results.json | — | 最终全套 1/1；独立复跑 2/2 |
| G-04 | Sidebar collapse, expand, resize and reset | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| G-05 | Library-specific global rail transition | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| G-06 | Narrow bottom navigation | PASS | Edge 320x568 / 390x844 | 窄屏底部导航可见，页面无横向溢出或遮挡。 | work/qa/remediation-browser-final6/playwright/artifacts | — | 2/2 视口 |
| G-07 | Global search entry and route return | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| G-08 | Scan/review global task-entry visibility and priority | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| G-09 | Restart persistence for layout, theme and drafts | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| G-10 | Unsaved-content confirmation across route changes | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| T-01 | Quick record empty, save and failure retention | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| T-02 | Ctrl/Cmd+Enter and expanded writing | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| T-03 | Expanded writing Escape and focus return | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| T-04 | Four quick cards, empty and overflow states | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| T-05 | Journal, inbox and todo entity navigation | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| T-06 | AI daily review and memory-review entries | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| T-07 | Legacy Today review scan/generate confirmation flow | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| T-08 | Rolling review read, archive and library publication | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| J-01 | Date selection, calendar navigation and today reset | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| J-02 | Journal search and result expansion | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| J-03 | Create content, tags, todos and empty validation | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| J-04 | Edit, cancel, save and cross-entry discard | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| J-05 | Expand, fullscreen and quiet writing | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| J-06 | Delete confirmation and rollback | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| J-07 | Extract knowledge card and discard draft | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| J-08 | Day/week/month summaries and busy states | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| J-09 | Journal manual link create, delete and navigate | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| L-01 | Six smart views | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| L-02 | Folder expand, child, rename, delete and non-empty guard | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| L-03 | Search, status filter and empty import entry | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| L-04 | Card Enter and Space activation | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| L-05 | Directory/list collapse, resize and reset | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| L-06 | Create, edit, save and discard item | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| L-07 | Favorite, folder, process, reading and todo updates | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| L-08 | Delete consistency between list and reader | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| L-09 | Long title, 100 tags, deep path and long content | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| I-01 | Card, file, folder and URL import | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| I-02 | Native file/folder chooser cancel and selection | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| I-03 | Batch draft edit, remove, back and discard | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| I-04 | txt/md/csv/pdf/docx/pptx/xlsx/image success, empty, corrupt, fake extension and size limits | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| I-05 | Copy/open/reveal attachment path and missing path | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| I-06 | Open URL and invalid URL feedback | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| R-01 | Reader empty selection and return | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| R-02 | AI actions confirm, run, stop and failure retention | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| R-03 | AI summary, todos and run-history expansion | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| R-04 | Reader folder/process/reading updates | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| R-05 | Source URL and attachment native open | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| R-06 | AI scope, redaction, failure matrix, cancel and retry | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| MD-01 | Headings, lists, tables, tasks, footnotes, code and single breaks | PASS | Vitest + React static render | CommonMark、GFM、脚注、任务列表、表格和单换行渲染正确。 | src/components/MarkdownContent.test.tsx | — | 自动化稳定 |
| MD-02 | HTML, script and event attributes never execute | PASS | Vitest + React static render | 原始 HTML、script、事件属性和危险链接不进入可执行渲染树。 | src/components/MarkdownContent.test.tsx | — | 自动化稳定 |
| MD-03 | HTTP/HTTPS/mailto opens externally once | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| MD-04 | javascript/data/file/relative/unknown schemes blocked | PASS | Vitest | javascript/data/file/相对路径和未知协议均被阻断。 | src/lib/markdown.test.ts | — | 自动化稳定 |
| MD-05 | HTTPS image lazy load and unsafe image blocking | PASS | Vitest + React static render | 仅 HTTPS 图片生成 img；HTTP/data/file 使用安全占位。 | src/lib/markdown.test.ts; src/components/MarkdownContent.test.tsx | — | 自动化稳定 |
| MD-06 | Toolbar, selection, shortcuts and cursor recovery | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| MD-07 | Split preview, narrow tabs and preview debounce | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| K-01 | Stable, alias, unbound, self and missing references | PASS | Vitest | 稳定引用、别名、未绑定、自引用和失效引用解析正确。 | src/lib/itemReferences.test.ts; src/components/MarkdownContent.test.tsx | — | 自动化稳定 |
| K-02 | Code/HTML/standard link/image parsing exclusions | PASS | Vitest | 代码、HTML、标准链接和图片中的相似语法不会成为资料引用。 | src/lib/itemReferences.test.ts | — | 自动化稳定 |
| K-03 | `[[`, toolbar and Ctrl/Cmd+Shift+K suggestions | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| K-04 | Duplicate title path, ranking and eight-result limit | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| K-05 | Suggestion keyboard controls and nested Escape | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| K-06 | Rename follows title while alias stays fixed | PASS | Vitest | 普通引用跟随当前标题，显式别名保持固定。 | src/lib/itemReferences.test.ts | — | 自动化稳定 |
| K-07 | Outgoing, backlink, broken and manual panels/counts | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| K-08 | Multi-position merge and context truncation | PASS | Vitest | 同一目标多处引用合并，反向上下文最多两段。 | src/lib/itemReferences.test.ts | — | 自动化稳定 |
| K-09 | Multi-level item navigation stack | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| K-10 | Deleted target leaves source body and shows broken state | PASS | Vitest + fake-indexeddb | 删除目标只清理关系，来源正文保留并解析为失效引用。 | src/data/itemStore.inlineLinks.test.ts; src/components/MarkdownContent.test.tsx | — | 自动化稳定 |
| K-11 | Inline rebuild preserves manual links | PASS | Vitest + fake-indexeddb | inline 差异同步不覆盖 manual 关系，未变化关系不重写。 | src/data/itemStore.inlineLinks.test.ts; work/qa/remediation-native-2/webview-performance.json | — | 自动化稳定 |
| V-01 | Publish source, combined and archived rolling reviews | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| V-02 | Unarchived rolling review cannot publish | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| V-03 | Publish defaults, edits, validation and discard | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| V-04 | Idempotent publish and republish after deletion | PASS | Vitest + fake-indexeddb | 首次发布幂等；资料删除后允许重新发布。 | src/data/itemStore.reviewPublication.test.ts | — | 自动化稳定 |
| V-05 | Source update badge and search deduplication | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| V-06 | Source card current/changed/missing/manually-edited states | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| V-07 | Item to source review return context | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| V-08 | Review to item return context | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| V-09 | Compare, update current, create version and discard | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| V-10 | History, open current and restore as new revision | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| V-11 | Reactivation, delete head and delete all fallback | PASS | Vitest + fake-indexeddb | reactivation、删除 head 和全部删除后的版本链回退正确。 | src/data/itemStore.reviewVersioning.test.ts; src/data/itemStore.inlineLinks.test.ts | — | 自动化稳定 |
| V-12 | Historical revisions hidden from normal surfaces | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| M-01 | Long-term memory edit, expand and save | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| M-02 | Review filters, dates, sources, cwd and keyword | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| M-03 | Single-source lock, unlock and mixed-source select-all guard | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| M-04 | Unique primary action for all scan/generate states | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| M-05 | Risk confirmation and invalidation after selection changes | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| M-06 | Session preview, copy and privacy notice | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| M-07 | Archive filtering, reading, merge, replacement and discard | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| M-08 | Memory suggestion generate, edit, apply and ignore | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| M-09 | Legacy memory activate and archive | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| M-10 | Active generation hides interrupted-history actions | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| Q-01 | Dated and undated scans open workspace immediately | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| Q-02 | Discovering/verifying/background/completed counters | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| Q-03 | Large-file metrics change without fake percentage | PASS | Tauri dev / WebView2 / 2000 synthetic sessions | 大候选扫描阶段计数持续变化，界面未显示估算百分比。 | work/qa/remediation-native-2/native-remediation-evidence.json | — | 1/1 |
| Q-04 | Collapse, route away and global scan entry | PASS | Tauri dev / WebView2 | 扫描可收起，切到今日后继续运行，完成后显示全局任务结果。 | work/qa/remediation-native-2/native-remediation-evidence.json | — | 1/1 |
| Q-05 | Cancelling disabled, prior result retained and background indexing restored | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| Q-06 | Failed/cancelled return and rescan | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| Q-07 | Scan/generation mutual exclusion | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| Q-08 | Generation locate/read/chunk/compress/merge/memory stages | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| Q-09 | Cancel, pause, resume, restart and delete generation | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| Q-10 | Slow, empty, 401, 429, 500, drop, retry and checkpoint recovery | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| Q-11 | Events, UI and logs contain no path/title/body privacy fields | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| S-01 | Empty, no-result and clear search | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| S-02 | Title/body/tag/summary/link-display match | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| S-03 | Stable IDs hidden from snippets | PASS | Vitest | 搜索使用目标显示标题，不暴露稳定引用 ID。 | src/lib/itemReferences.test.ts; qa/tests/data-integrity.test.ts | — | 自动化稳定 |
| S-04 | Item/journal/memory/summary/review route navigation | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| S-05 | Current/changed/missing source result rules | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| S-06 | Historical revisions hidden and return chain reset | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| C-01 | Six palettes, dark/light/system and accent choices | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| C-02 | Three AI protocols, discovery, reasoning, vision, stream and auth | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| C-03 | AI settings save, test and discard | PASS | Tauri QA / installed qa.1→qa.2 / local mock | 既有原生交互断言与安装版探针共同证明合成密钥保存、Mock 请求、升级后重启读取、清除及放弃未保存远程配置符合预期。 | work/qa/remediation-native-2/native-remediation-evidence.json; work/qa/installed-cli-lifecycle-archive-final/installed-lifecycle-summary.json | — | 1/1 |
| C-04 | API-key clearing scoped by provider and URL | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| C-05 | Date-index idle completion, clear and busy state | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| C-06 | Rolling review toggle, source guard and update-now | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| C-07 | Backup export, corruption, restore and non-core preservation | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| C-08 | Demo-data install, repeat and safe delete | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| C-09 | Help, reopen onboarding and local-source probe | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| N-00 | QA credential namespace is independent from production and native AI endpoints are loopback-only | PASS | Installed Tauri QA / Windows Credential Manager / local mock | qa.1 写入的合成 QA 凭据在 qa.2 覆盖升级后可读取，本地 Mock 非流式与流式请求通过，删除后重启仍不存在；未知远程 origin 继续被安全门阻断。 | work/qa/installed-cli-lifecycle-archive-final/installed-lifecycle-summary.json; work/qa/remediation-native-2/native-remediation-evidence.json | — | 完整生命周期 1/1 |
| N-01 | Minimize, maximize, close-to-tray and tray restore | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| N-02 | Main-window position and size restore | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| N-03 | Quick-capture hotspot expand, collapse and return | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| N-04 | Ctrl+Shift+Space, capture save/failure and main-window open | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| N-05 | Native chooser, external link, file open and reveal | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| N-06 | QA identity, isolated data/profile and production-process gate | PASS | Installed Tauri QA / isolated WebView profiles | identifier、每次运行的 WebView profile、凭据命名空间和证据目录均为 QA 专用；静默卸载后 profile、安装目录和卸载项已清除，正式数据目录元数据未变化。 | work/qa/installed-cli-lifecycle-archive-final/installed-lifecycle-summary.json; work/qa/remediation-native-2/generated-tauri.qa.conf.json | — | 多次启动一致 |
| A-01 | Modal Tab loop, Escape and focus restoration | PASS | Microsoft Edge Playwright | 导入弹窗 Tab 循环、Escape 和关闭后返焦通过。 | work/qa/remediation-browser-final6/playwright/results.json | — | 最终全套 1/1 |
| A-02 | Busy state blocks duplicate submit | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| A-03 | Nested overlay close order | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| A-04 | Modal background cannot be operated | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| A-05 | Eight responsive browser viewports have no overflow/dead scroll | PASS | Microsoft Edge Playwright / 8 viewports | 320x568 至 1440x900 无 document/body 横向溢出。 | work/qa/remediation-browser-final6/playwright/results.json | — | 8/8 视口 |
| A-06 | 1100x720, 1280x820, 1440x900 native windows at 125%/150% scaling | UNVERIFIED | 未执行完整组合 | 本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。 | — | — | — |
| A-07 | Accessible names, roles, contrast and targets via axe plus manual review | PASS | Microsoft Edge Playwright + manual screenshot review | 六个一级页及 12 主题重点页 serious/critical axe 为零；抽样视觉无阻断。 | work/qa/remediation-browser-final6/playwright/results.json | — | 最终全套 1/1 |
| A-08 | Reduced motion removes continuous animation | PASS | Microsoft Edge Playwright / reduced motion | 未发现仍持续无限运行的动画。 | work/qa/remediation-browser-final6/playwright/results.json | — | 最终全套 1/1 |
