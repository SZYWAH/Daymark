import assert from "node:assert/strict";
import test from "node:test";
import { evaluateStartupProbe } from "./evaluate-startup-probe.mjs";

function events(stage, elapsedMs) {
  return [
    { stage, outcome: "pass", processElapsedMs: elapsedMs },
    { stage: "completed", outcome: "pass", processElapsedMs: elapsedMs + 1 },
  ];
}

test("accepts ready and explicit failed dashboard settlement", () => {
  assert.equal(evaluateStartupProbe({ exitCode: 0, evidencePresent: true, events: events("dashboard-ready", 900) }).passed, true);
  assert.equal(evaluateStartupProbe({ exitCode: 0, evidencePresent: true, events: events("dashboard-failed", 900) }).passed, true);
});

test("rejects timeout and abnormal exit", () => {
  assert.deepEqual(
    evaluateStartupProbe({ exitCode: 0, evidencePresent: true, events: events("dashboard-ready", 5_001) }),
    { passed: false, reason: "startup-timeout", elapsedMs: 5_001 },
  );
  assert.deepEqual(
    evaluateStartupProbe({ exitCode: 23, evidencePresent: true, events: events("dashboard-ready", 900) }),
    { passed: false, reason: "abnormal-exit" },
  );
});

test("rejects missing and incomplete evidence", () => {
  assert.equal(evaluateStartupProbe({ exitCode: 0, evidencePresent: false }).reason, "evidence-missing");
  assert.equal(evaluateStartupProbe({ exitCode: 0, evidencePresent: true, events: [] }).reason, "evidence-incomplete");
});
