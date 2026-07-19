import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const qaRoot = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(qaRoot, "playwright.config.ts");
const source = await readFile(configPath, "utf8");
const repoRoot = path.dirname(qaRoot);
const probeSource = await readFile(path.join(repoRoot, "src-tauri", "src", "qa_automation.rs"), "utf8");
const lifecycleSource = await readFile(path.join(qaRoot, "run-installed-lifecycle.ps1"), "utf8");

assert.equal(/\.\.\.\s*process\.env/.test(source), false, "Playwright config must not spread host process.env into the web server.");
const webServerEnv = source.match(/webServer:\s*\{[\s\S]*?env:\s*\{([\s\S]*?)\n\s*\},/);
assert.ok(webServerEnv, "Playwright config must define an explicit webServer environment whitelist.");
assert.match(webServerEnv[1], /VITE_ENABLE_DEMO_SEED:\s*"true"/, "Demo seed must remain explicitly enabled.");
assert.equal(/(?:API_KEY|TOKEN|SECRET|PASSWORD)/i.test(webServerEnv[1]), false, "Playwright webServer environment whitelist must not contain credential-like variables.");
assert.match(probeSource, /is_qa_identifier\(identifier\)/, "QA automation must remain gated by the runtime QA identifier.");
assert.match(probeSource, /DAYMARK_QA_AUTOMATION/, "QA automation must require its explicit environment gate.");
assert.match(probeSource, /validate_evidence_path/, "QA automation evidence must remain path constrained.");
assert.equal(/Get-Content[^\r\n]+com\.szywah\.daymark/i.test(lifecycleSource), false, "Lifecycle QA must not read production Daymark data contents.");

console.info("QA_PLAYWRIGHT_ENV_WHITELIST_PASS");
