import { createHash } from "node:crypto";
import { mkdir, writeFile, truncate, readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

const runId = process.argv[2] || new Date().toISOString().replace(/[:.]/g, "-");
const repoRoot = path.resolve(import.meta.dirname, "..");
const runRoot = path.join(repoRoot, "work", "qa", runId);
const profileRoot = path.join(runRoot, "profile");
const fixtureRoot = path.join(runRoot, "fixtures");
await mkdir(fixtureRoot, { recursive: true });
await mkdir(path.join(profileRoot, ".codex", "sessions", "2026", "07", "18"), { recursive: true });
await mkdir(path.join(profileRoot, ".claude", "projects", "D--synthetic-project"), { recursive: true });

const manifests = [];
for (const scale of [0, 150, 1_000, 5_000]) {
  await emitJson(`backups/library-${scale}.json`, makeBackup(scale));
}
await emitJson("backups/lineage-100.json", makeBackup(100, { lineage: true }));
await emitJson("backups/link-graph-1000-5000.json", makeBackup(1_000, { linkGraph: true }));
await emitJson("backups/invalid-schema.json", { schema: "not-daymark", payload: {} });

await emitText("imports/sample.txt", "Daymark QA plain text fixture.\nSecond line.\n");
await emitText("imports/sample.md", "# Daymark QA Markdown\n\n- [ ] task\n- **bold**\n\n| A | B |\n|---|---|\n| 1 | 2 |\n");
await emitText("imports/sample.csv", "title,status\nSynthetic note,inbox\n");
await emitBuffer("imports/sample.pdf", Buffer.from(minimalPdf(), "ascii"));
await emitBuffer("imports/sample.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
await emitBuffer("imports/sample.gif", Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64"));
await emitBuffer("imports/sample.webp", Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEALmk0mk0iIiIiIgBoSygABc6zbAAA", "base64"));
await emitOfficeFixtures();
for (const name of ["broken.pdf", "broken.docx", "broken.pptx", "broken.xlsx", "fake.png"]) {
  await emitText(`imports/${name}`, "synthetic corrupted fixture");
}
await emitText("imports/empty.txt", "");

const boundaryFiles = [
  ["imports/boundary-text-40mb.txt", 40_000_000],
  ["imports/over-text-40mb.txt", 40_000_001],
  ["imports/boundary-image-20mb.png", 20_000_000],
  ["imports/over-image-20mb.png", 20_000_001],
];
for (const [relative, size] of boundaryFiles) {
  const target = path.join(fixtureRoot, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, Buffer.alloc(0));
  await truncate(target, size);
  manifests.push(await manifestEntry(target, relative));
}

const sessionProfiles = [];
for (const count of [0, 600, 800, 2_000]) {
  const targetProfile = count === 800 ? profileRoot : path.join(runRoot, "profiles", `sessions-${count}`);
  const sessionDir = path.join(targetProfile, ".codex", "sessions", "2026", "07", "18");
  await mkdir(sessionDir, { recursive: true });
  await mkdir(path.join(targetProfile, ".claude", "projects"), { recursive: true });
  const profileHash = createHash("sha256");
  let fileCount = 0;
  for (let index = 0; index < count; index += 1) {
    const file = path.join(sessionDir, `synthetic-2026-07-18-${String(index).padStart(4, "0")}.jsonl`);
    const lines = [
      codexLine("user", `Synthetic question ${index}. Token sk-qa-secret-must-be-redacted.`),
      codexLine("assistant", `Synthetic answer ${index}.`),
    ];
    const content = `${lines.join("\n")}\n`;
    await writeFile(file, content, "utf8");
    updateProfileHash(profileHash, path.basename(file), content);
    fileCount += 1;
  }

  const edgeCases = [];
  if (count === 800) {
    const crossDay = [
      codexLine("user", "Synthetic cross-day question.", "2026-07-17T23:59:59Z"),
      codexLine("assistant", "Synthetic cross-day answer.", "2026-07-18T00:00:01Z"),
    ].join("\n") + "\n";
    await emitSessionCase("synthetic-cross-day.jsonl", crossDay, "cross-day");

    const incompleteTail = `${codexLine("user", "Synthetic valid prefix.")}\n{\"timestamp\":\"2026-07-18T01:00:01Z\",\"payload\":`;
    await emitSessionCase("synthetic-incomplete-tail.jsonl", incompleteTail, "incomplete-tail");

    const oversizedLine = `${"x".repeat(32 * 1024 * 1024 + 1)}\n`;
    await emitSessionCase("synthetic-oversized-line.jsonl", oversizedLine, "oversized-line");

    const appendBefore = `${codexLine("user", "Synthetic append baseline.")}\n`;
    const appendAfter = `${appendBefore}${codexLine("assistant", "Synthetic appended tail.")}\n`;
    await emitSessionCase("synthetic-append-before.jsonl", appendBefore, "append-before");
    await emitSessionCase("synthetic-append-after.jsonl", appendAfter, "append-after");

    const truncateBefore = `${codexLine("user", "Synthetic truncate baseline.")}\n${codexLine("assistant", "Synthetic content removed after truncation.")}\n`;
    const truncateAfter = `${codexLine("user", "Synthetic truncate replacement.")}\n`;
    await emitSessionCase("synthetic-truncate-before.jsonl", truncateBefore, "truncate-before");
    await emitSessionCase("synthetic-truncate-after.jsonl", truncateAfter, "truncate-after");
  }

  sessionProfiles.push({
    candidateCount: count,
    fileCount,
    profileRoot: targetProfile,
    sha256: profileHash.digest("hex"),
    edgeCases,
  });

  async function emitSessionCase(name, content, kind) {
    const file = path.join(sessionDir, name);
    await writeFile(file, content, "utf8");
    updateProfileHash(profileHash, name, content);
    fileCount += 1;
    edgeCases.push({ kind, file: name, bytes: Buffer.byteLength(content) });
  }
}

const claudeFile = path.join(profileRoot, ".claude", "projects", "D--synthetic-project", "synthetic.jsonl");
await writeFile(claudeFile, `${JSON.stringify({ type: "user", timestamp: "2026-07-18T01:00:00Z", message: { role: "user", content: "Synthetic Claude fixture" } })}\n`, "utf8");
manifests.push(await manifestEntry(claudeFile, "profile/.claude/projects/D--synthetic-project/synthetic.jsonl"));

await writeFile(path.join(runRoot, "manifest.json"), JSON.stringify({
  schema: "daymark.qa.manifest.v1",
  runId,
  generatedAt: new Date().toISOString(),
  profileRoot,
  fixtureRoot,
  sessionProfiles,
  files: manifests.sort((a, b) => a.path.localeCompare(b.path)),
}, null, 2), "utf8");

process.stdout.write(`${runRoot}\n`);

async function emitJson(relative, value) {
  return emitText(relative, `${JSON.stringify(value, null, 2)}\n`);
}

async function emitText(relative, value) {
  return emitBuffer(relative, Buffer.from(value, "utf8"));
}

async function emitBuffer(relative, value) {
  const target = path.join(fixtureRoot, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, value);
  manifests.push(await manifestEntry(target, relative));
}

async function manifestEntry(target, relative) {
  const data = await readFile(target);
  return { path: relative.replaceAll("\\", "/"), bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") };
}

function makeBackup(itemCount, options = {}) {
  const now = "2026-07-18 10:00:00";
  const items = Array.from({ length: itemCount }, (_, index) => {
    const lineage = options.lineage;
    const id = lineage ? `review-revision-${index + 1}` : `qa-item-${String(index).padStart(5, "0")}`;
    const refs = options.linkGraph
      ? Array.from({ length: 5 }, (__, offset) => `[[item:qa-item-${String((index + offset + 1) % itemCount).padStart(5, "0")}]]`).join(" ")
      : "";
    const revisionKind = lineage && index === 49
      ? "restore"
      : lineage && index === 74
        ? "reactivation"
        : "source";
    return {
      id,
      title: lineage ? `Synthetic review revision ${index + 1}` : `Synthetic library item ${index + 1}`,
      type: "note",
      processStatus: "收件箱",
      readingStatus: "不需要",
      tags: ["QA", `group-${index % 20}`],
      content: `# Synthetic content ${index + 1}\n\n${refs}`,
      aiSummary: "Synthetic QA fixture; contains no user data.",
      todos: [],
      createdAt: now,
      updatedAt: now,
      favorite: false,
      ...(lineage ? { origin: {
        kind: "daily-review",
        sourceId: "missing-synthetic-review",
        sourceKey: "qa-lineage",
        sourceDate: "2026-07-18",
        sourceLabel: "Synthetic",
        contentVersion: `source-${index + 1}`,
        revision: index + 1,
        revisionKind,
        ...(revisionKind === "restore" ? { derivedFromRevision: 1 } : {}),
        ...(revisionKind === "reactivation" ? { derivedFromRevision: 60 } : {}),
        syncedItemContentVersion: `item-${index + 1}`,
      } } : {}),
    };
  });
  const payload = { items, folders: [], journalEntries: [], memoryDocument: null, memoryCards: [], links: [] };
  return {
    schema: "daymark.core-backup.v1",
    exportedAt: "2026-07-18T10:00:00.000Z",
    dbVersion: 11,
    payload,
    counts: { items: items.length, folders: 0, journalEntries: 0, memoryDocument: 0, memoryCards: 0, links: 0 },
  };
}

function codexLine(role, text, timestamp = "2026-07-18T01:00:00Z") {
  return JSON.stringify({
    timestamp,
    payload: { type: "message", role, content: [{ type: "input_text", text }] },
  });
}

function updateProfileHash(hash, relative, content) {
  hash.update(relative.replaceAll("\\", "/"));
  hash.update("\0");
  hash.update(content);
  hash.update("\0");
}

async function emitOfficeFixtures() {
  const office = [
    ["sample.docx", {
      "[Content_Types].xml": contentTypes("word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"),
      "word/document.xml": "<?xml version=\"1.0\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>Daymark QA DOCX</w:t></w:r></w:p></w:body></w:document>",
    }],
    ["sample.pptx", {
      "[Content_Types].xml": contentTypes("ppt/slides/slide1.xml", "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"),
      "ppt/slides/slide1.xml": "<?xml version=\"1.0\"?><p:sld xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Daymark QA PPTX</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>",
    }],
    ["sample.xlsx", {
      "[Content_Types].xml": contentTypes("xl/worksheets/sheet1.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"),
      "xl/workbook.xml": "<?xml version=\"1.0\"?><workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheets/></workbook>",
      "xl/worksheets/sheet1.xml": "<?xml version=\"1.0\"?><worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData><row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>Daymark QA XLSX</t></is></c></row></sheetData></worksheet>",
    }],
  ];
  for (const [name, entries] of office) {
    const zip = new JSZip();
    for (const [entryName, value] of Object.entries(entries)) zip.file(entryName, value);
    await emitBuffer(`imports/${name}`, await zip.generateAsync({ type: "nodebuffer" }));
  }
}

function contentTypes(partName, contentType) {
  return `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${partName}" ContentType="${contentType}"/></Types>`;
}

function minimalPdf() {
  return "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R>>endobj\n4 0 obj<</Length 42>>stream\nBT /F1 12 Tf 20 100 Td (Daymark QA PDF) Tj ET\nendstream endobj\nxref\n0 5\n0000000000 65535 f \ntrailer<</Root 1 0 R/Size 5>>\nstartxref\n0\n%%EOF\n";
}
