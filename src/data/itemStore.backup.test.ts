import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DAYMARK_CORE_BACKUP_SCHEMA,
  createFolder,
  createItem,
  createJournalEntry,
  createKnowledgeLink,
  createMemoryCandidate,
  createSummaryReport,
  exportCoreBackup,
  getDefaultAiSettings,
  getItems,
  restoreCoreBackup,
  saveAiSettings,
  updateMemoryDocument,
  validateCoreBackup,
  type DaymarkCoreBackupPayload,
  type DaymarkCoreBackupV1,
} from "./itemStore";
import { ITEM_TYPES, PROCESS_STATUSES, READING_STATUSES } from "../types";

const NOW = "2026-07-09 10:00:00";

describe("core backup", () => {
  beforeEach(async () => {
    await restoreCoreBackup(makeBackup());
  });

  it("exports only core data and omits settings, API keys, and summary reports", async () => {
    const folder = await createFolder({ title: "Projects" });
    const item = await createItem({
      title: "Design note",
      content: "Keep the current visual design.",
      folderId: folder.id,
    });
    const journal = await createJournalEntry({
      entryDate: "2026-07-09",
      content: "Today I added backup coverage.",
      tags: ["backup"],
    });
    await createMemoryCandidate({
      title: "Preference",
      content: "Do not redesign the visual system.",
      category: "Product",
      status: "active",
    });
    await updateMemoryDocument("Long-term memory document.");
    await createKnowledgeLink({
      sourceKind: "journal",
      sourceId: journal.id,
      targetKind: "item",
      targetId: item.id,
      relation: "related",
    });
    await createSummaryReport({
      periodType: "day",
      periodStart: "2026-07-09",
      periodEnd: "2026-07-09",
      title: "Should not export",
      content: "Summary report content should stay out of core backups.",
    });
    await saveAiSettings({
      ...getDefaultAiSettings(),
      manualApiKey: "sk-secret-key",
      useEnvKey: false,
    });

    const backup = await exportCoreBackup();
    const serialized = JSON.stringify(backup);

    expect(backup.schema).toBe(DAYMARK_CORE_BACKUP_SCHEMA);
    expect(backup.counts).toMatchObject({
      items: 1,
      folders: 1,
      journalEntries: 1,
      memoryDocument: 1,
      memoryCards: 1,
      links: 1,
    });
    expect(serialized).not.toContain("sk-secret-key");
    expect(serialized).not.toContain("manualApiKey");
    expect(serialized).not.toContain("summaryReports");
    expect(serialized).not.toContain("Should not export");
  });

  it("rejects non-Daymark and structurally invalid backups", () => {
    expect(() => validateCoreBackup({ schema: "other" })).toThrow(/Daymark/);
    expect(() =>
      validateCoreBackup({
        schema: DAYMARK_CORE_BACKUP_SCHEMA,
        exportedAt: new Date().toISOString(),
        dbVersion: 10,
        counts: {},
      }),
    ).toThrow(/payload/);
    expect(() =>
      validateCoreBackup(makeBackup({ items: [{ title: "Missing id" }] as never })),
    ).toThrow(/items\[0\]\.id/);
  });

  it("restores by replacing existing core data instead of merging", async () => {
    await createItem({ title: "Old item" });
    const restoredItem = makeItem("item-restored", "Restored item");
    const counts = await restoreCoreBackup(makeBackup({ items: [restoredItem] }));
    const items = await getItems();

    expect(counts.items).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("item-restored");
    expect(items[0].title).toBe("Restored item");
  });

  it("leaves existing core data untouched when restore validation fails", async () => {
    const oldItem = await createItem({ title: "Keep me" });

    await expect(
      restoreCoreBackup(makeBackup({ items: [{ title: "Broken item" }] as never })),
    ).rejects.toThrow(/items\[0\]\.id/);

    const items = await getItems();
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(oldItem.id);
    expect(items[0].title).toBe("Keep me");
  });
});

function makeBackup(payload: Partial<DaymarkCoreBackupPayload> = {}): DaymarkCoreBackupV1 {
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
    exportedAt: "2026-07-09T10:00:00.000Z",
    dbVersion: 10,
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

function makeItem(id: string, title: string) {
  return {
    id,
    title,
    type: ITEM_TYPES[0],
    processStatus: PROCESS_STATUSES[0],
    readingStatus: READING_STATUSES[0],
    tags: [],
    content: "",
    aiSummary: "",
    todos: [],
    createdAt: NOW,
    updatedAt: NOW,
    favorite: false,
  };
}
