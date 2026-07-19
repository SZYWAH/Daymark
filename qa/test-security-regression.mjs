import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const qaRoot = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(qaRoot, "playwright.config.ts");
const source = await readFile(configPath, "utf8");

assert.equal(/\.\.\.\s*process\.env/.test(source), false, "Playwright config must not spread host process.env into the web server.");
const webServerEnv = source.match(/webServer:\s*\{[\s\S]*?env:\s*\{([\s\S]*?)\n\s*\},/);
assert.ok(webServerEnv, "Playwright config must define an explicit webServer environment whitelist.");
assert.match(webServerEnv[1], /VITE_ENABLE_DEMO_SEED:\s*"true"/, "Demo seed must remain explicitly enabled.");
assert.equal(/(?:API_KEY|TOKEN|SECRET|PASSWORD)/i.test(webServerEnv[1]), false, "Playwright webServer environment whitelist must not contain credential-like variables.");

console.info("QA_PLAYWRIGHT_ENV_WHITELIST_PASS");
