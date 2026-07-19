import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function evaluateStartupProbe({
  exitCode,
  evidencePresent,
  events = [],
  thresholdMs = 5_000,
}) {
  if (exitCode !== 0) return { passed: false, reason: "abnormal-exit" };
  if (!evidencePresent) return { passed: false, reason: "evidence-missing" };
  if (events.some((event) => event?.outcome === "fail")) {
    return { passed: false, reason: "probe-reported-failure" };
  }
  const completed = events.filter((event) => event?.stage === "completed" && event?.outcome === "pass");
  const settled = events.find((event) => event?.stage === "dashboard-ready" || event?.stage === "dashboard-failed");
  if (completed.length !== 1 || !settled) return { passed: false, reason: "evidence-incomplete" };
  const elapsedMs = Number(settled.processElapsedMs);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return { passed: false, reason: "elapsed-invalid" };
  if (elapsedMs > thresholdMs) return { passed: false, reason: "startup-timeout", elapsedMs };
  return { passed: true, reason: "settled", stage: settled.stage, elapsedMs };
}

async function runCli() {
  const [evidencePath, exitCodeValue] = process.argv.slice(2);
  const exitCode = Number(exitCodeValue);
  let events = [];
  let evidencePresent = false;
  try {
    const text = await readFile(evidencePath, "utf8");
    evidencePresent = true;
    events = text.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    evidencePresent = false;
  }
  process.stdout.write(JSON.stringify(evaluateStartupProbe({ exitCode, evidencePresent, events })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
