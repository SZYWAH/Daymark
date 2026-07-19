import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const matrixPath = path.join(repoRoot, "qa", "QA_MATRIX.md");
const evidencePath = path.join(repoRoot, "qa", "remediation-evidence.json");
const matrix = fs.readFileSync(matrixPath, "utf8");
const registry = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
const cases = Array.from(matrix.matchAll(/^\| ([A-Z]+-\d+) \| (.+) \|$/gm), (match) => ({ id: match[1], title: match[2] }));
if (cases.length !== 129) throw new Error(`Expected 129 QA cases, found ${cases.length}.`);

const allowed = new Set(["PASS", "FAIL", "UNVERIFIED", "BLOCKED"]);
const unknownIds = Object.keys(registry.results).filter((id) => !cases.some((item) => item.id === id));
if (unknownIds.length) throw new Error(`Unknown QA case IDs: ${unknownIds.join(", ")}`);

const rows = cases.map((entry) => {
  const result = registry.results[entry.id] ?? {
    status: "UNVERIFIED",
    environment: "未执行完整组合",
    actual: "本轮没有覆盖该 case 的全部子流程；局部单元测试或静态检查不计为整项通过。",
    evidence: "—",
    reproducibility: "—",
    severity: "—",
  };
  if (!allowed.has(result.status)) throw new Error(`Invalid status for ${entry.id}: ${result.status}`);
  return { ...entry, ...result };
});

const counts = Object.fromEntries(Array.from(allowed, (status) => [status, rows.filter((row) => row.status === status).length]));
const escapeCell = (value) => String(value).replaceAll("|", "\\|").replaceAll("\n", "<br>");
const output = [
  "# Daymark archive remediation case results",
  "",
  `- Run: \`${registry.runId}\``,
  `- Branch: \`${registry.branch}\``,
  `- Result: PASS ${counts.PASS} / FAIL ${counts.FAIL} / UNVERIFIED ${counts.UNVERIFIED} / BLOCKED ${counts.BLOCKED}`,
  "- Rule: only direct end-to-end evidence can mark a whole high-level case PASS; UNVERIFIED never counts as pass.",
  "",
  "| ID | Case | Result | Environment | Actual result | Evidence | Severity | Reproducibility |",
  "|---|---|---|---|---|---|---|---|",
  ...rows.map((row) => `| ${row.id} | ${escapeCell(row.title)} | ${row.status} | ${escapeCell(row.environment)} | ${escapeCell(row.actual)} | ${escapeCell(row.evidence)} | ${escapeCell(row.severity)} | ${escapeCell(row.reproducibility)} |`),
  "",
].join("\n");

process.stdout.write(output);
