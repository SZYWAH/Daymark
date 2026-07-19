import "fake-indexeddb/auto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
  DAYMARK_CORE_BACKUP_SCHEMA,
  createKnowledgeLink,
  exportCoreBackup,
  getItems,
  getKnowledgeLinks,
  putLibraryRecords,
  restoreCoreBackup,
  searchKnowledge,
  type DaymarkCoreBackupPayload,
  type DaymarkCoreBackupV1,
} from "../../src/data/itemStore";
import { ITEM_TYPES, PROCESS_STATUSES, READING_STATUSES, type Item } from "../../src/types";

const NOW = "2026-07-18 10:00:00";

describe.sequential("archive QA data pressure", () => {
  beforeEach(async () => restoreCoreBackup(backup()));

  it("keeps core data atomic when an invalid backup is rejected", async () => {
    await putLibraryRecords({ items: [item(0)], folders: [] });
    const before = await exportCoreBackup();

    await expect(restoreCoreBackup({ schema: "not-daymark", payload: {} })).rejects.toThrow();

    expect((await exportCoreBackup()).payload).toEqual(before.payload);
  });

  it("preserves daily-review origin provenance through backup v1", async () => {
    const review = item(0, "# published review");
    review.origin = {
      kind: "daily-review",
      sourceId: "qa-source",
      sourceKey: "qa-source-key",
      sourceDate: "2026-07-18",
      sourceLabel: "Synthetic QA",
      contentVersion: "source-v2",
      revision: 3,
      revisionKind: "restore",
      derivedFromRevision: 1,
      syncedItemContentVersion: "item-v3",
    };
    await putLibraryRecords({ items: [review], folders: [] });

    const exported = await exportCoreBackup();
    await restoreCoreBackup(backup());
    await restoreCoreBackup(exported);

    expect((await getItems())[0].origin).toEqual(review.origin);
  });

  it("imports 10/100/500/1000 records with one transactional inline rebuild", async () => {
    const timings: Record<string, number> = {};
    for (const count of [10, 100, 500, 1_000]) {
      await restoreCoreBackup(backup());
      const records = Array.from({ length: count }, (_, index) => item(index));
      const started = performance.now();
      await putLibraryRecords({ items: records, folders: [] });
      timings[String(count)] = Math.round(performance.now() - started);
      expect(await getItems()).toHaveLength(count);
    }
    console.info("DAYMARK_QA_IMPORT_TIMINGS_MS", JSON.stringify(timings));
    writeQaMetrics({ importTimingsMs: timings });
  });

  it("rebuilds 5000 inline references, deduplicates positions and preserves manual links", async () => {
    const count = 1_000;
    const items = Array.from({ length: count }, (_, index) => {
      const refs = Array.from({ length: 5 }, (__, offset) => {
        const target = (index + offset + 1) % count;
        return `[[item:qa-item-${String(target).padStart(5, "0")}]]`;
      });
      if (index === 0) refs.push(refs[0], `[[item:qa-item-00001|alias]]`);
      return item(index, refs.join(" "));
    });
    await putLibraryRecords({ items, folders: [] });
    await createKnowledgeLink({
      sourceKind: "item",
      sourceId: items[0].id,
      targetKind: "item",
      targetId: items[2].id,
      relation: "synthetic-manual",
    });

    const started = performance.now();
    await putLibraryRecords({ items, folders: [] });
    const links = await getKnowledgeLinks();
    const inline = links.filter((link) => link.linkKind === "inline");
    const manual = links.filter((link) => (link.linkKind ?? "manual") === "manual");
    const linkRebuildMs = Math.round(performance.now() - started);
    console.info("DAYMARK_QA_LINK_REBUILD_MS", linkRebuildMs);
    writeQaMetrics({ linkRebuildMs, inlineLinkCount: inline.length });

    expect(inline).toHaveLength(5_000);
    expect(new Set(inline.map((link) => `${link.sourceId}:${link.targetId}`)).size).toBe(5_000);
    expect(manual).toEqual([expect.objectContaining({ relation: "synthetic-manual" })]);
  });

  it("searches link display text without exposing stable IDs", async () => {
    const target = item(1);
    target.title = "Synthetic constellation target";
    const source = item(0, `Reference [[item:${target.id}]]`);
    await putLibraryRecords({ items: [source, target], folders: [] });

    const results = await searchKnowledge("constellation");
    const sourceResult = results.item.find((result) => result.id === source.id);
    expect(sourceResult).toBeDefined();
    expect(sourceResult?.snippet).not.toContain(target.id);
  });
});

function item(index: number, content = ""): Item {
  return {
    id: `qa-item-${String(index).padStart(5, "0")}`,
    title: `Synthetic item ${index}`,
    type: ITEM_TYPES[0],
    processStatus: PROCESS_STATUSES[0],
    readingStatus: READING_STATUSES[0],
    tags: ["QA", `group-${index % 20}`],
    content,
    aiSummary: "Synthetic QA data only.",
    todos: [],
    createdAt: NOW,
    updatedAt: NOW,
    favorite: false,
  };
}

function backup(payload: Partial<DaymarkCoreBackupPayload> = {}): DaymarkCoreBackupV1 {
  const fullPayload: DaymarkCoreBackupPayload = {
    items: [],
    folders: [],
    journalEntries: [],
    memoryDocument: null,
    memoryCards: [],
    links: [],
    ...payload,
  };
  return {
    schema: DAYMARK_CORE_BACKUP_SCHEMA,
    exportedAt: "2026-07-18T10:00:00.000Z",
    dbVersion: 11,
    payload: fullPayload,
    counts: {
      items: fullPayload.items.length,
      folders: fullPayload.folders.length,
      journalEntries: fullPayload.journalEntries.length,
      memoryDocument: fullPayload.memoryDocument ? 1 : 0,
      memoryCards: fullPayload.memoryCards.length,
      links: fullPayload.links.length,
    },
  };
}

function writeQaMetrics(patch: Record<string, unknown>) {
  const root = process.env.DAYMARK_QA_RUN_DIR;
  if (!root) return;
  mkdirSync(root, { recursive: true });
  const target = path.join(root, "data-metrics.json");
  const current = existsSync(target) ? JSON.parse(readFileSync(target, "utf8")) as Record<string, unknown> : {};
  writeFileSync(target, `${JSON.stringify({ ...current, ...patch }, null, 2)}\n`, "utf8");
}
