import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const playwrightCli = path.join(path.dirname(require.resolve("@playwright/test/package.json")), "cli.js");
const allowedNames = [
  "PATH", "Path", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "TEMP", "TMP",
  "APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432",
  "DAYMARK_QA_RUN_DIR", "NO_COLOR", "FORCE_COLOR",
];
const childEnv = Object.fromEntries(allowedNames.flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]]]));
childEnv.VITE_ENABLE_DEMO_SEED = "true";

const preview = spawn(process.execPath, [path.join(repoRoot, "qa", "start-preview.mjs")], {
  cwd: repoRoot,
  env: childEnv,
  stdio: "inherit",
  windowsHide: true,
});

let exitCode = 1;
try {
  await waitForPort(5173, preview);
  const test = spawn(process.execPath, [playwrightCli, "test", "--config", "qa/playwright.config.ts"], {
    cwd: repoRoot,
    env: { ...childEnv, DAYMARK_QA_EXTERNAL_WEB_SERVER: "1" },
    stdio: "inherit",
    windowsHide: true,
  });
  exitCode = await waitForExit(test);
} finally {
  if (preview.exitCode === null) preview.kill();
  await Promise.race([waitForExit(preview), new Promise((resolve) => setTimeout(resolve, 5_000))]);
}

process.exitCode = exitCode;

async function waitForPort(port, processHandle) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) throw new Error("QA preview exited before becoming ready.");
    if (await canConnect(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("QA preview did not become ready within 120 seconds.");
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(250);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
  });
}

function waitForExit(processHandle) {
  if (processHandle.exitCode !== null) return Promise.resolve(processHandle.exitCode);
  return new Promise((resolve, reject) => {
    processHandle.once("error", reject);
    processHandle.once("exit", (code) => resolve(code ?? 1));
  });
}
