import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DAYMARK_CORE_BACKUP_SCHEMA,
  archiveRollingWorkReview,
  createFolder,
  createItem,
  createJournalEntry,
  createKnowledgeLink,
  createMemoryCandidate,
  createSummaryReport,
  exportCoreBackup,
  getCodexDailyReviews,
  getDefaultAiSettings,
  getItems,
  getRollingWorkReviewByDate,
  restoreCoreBackup,
  saveAiSettings,
  saveAutoWorkReviewSettings,
  updateMemoryDocument,
  upsertAutoWorkReviewCursors,
  upsertRollingWorkReview,
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
    await saveAutoWorkReviewSettings({
      enabled: true,
      lastMessage: "Auto review should stay local.",
    });
    await upsertRollingWorkReview({
      date: "2026-07-09",
      title: "Auto work review",
      content: "Private rolling work summary should not export.",
      sourceKinds: ["codex"],
      processedSessionCount: 1,
      processedChars: 128,
      lastRunAt: NOW,
      status: "ready",
    });
    await upsertAutoWorkReviewCursors([
      {
        sessionId: "codex-session-secret",
        path: "C:\\Users\\example\\.codex\\sessions\\secret.jsonl",
        sourceKind: "codex",
        date: "2026-07-09",
        readOffset: 42,
        modifiedAt: 42,
        lastProcessedAt: NOW,
        updatedAt: NOW,
      },
    ]);

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
    expect(serialized).not.toContain("Auto work review");
    expect(serialized).not.toContain("autoWorkReview");
    expect(serialized).not.toContain("codex-session-secret");
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
    expect(() => validateCoreBackup(makeBackup({
      items: [{
        ...makeItem("item-invalid-origin", "Invalid origin"),
        origin: { kind: "unknown" },
      }] as never,
    }))).toThrow(/origin\.kind/);
  });

  it("validates and preserves optional daily-review version provenance in backup v1", async () => {
    const versionedItem = {
      ...makeItem("item-versioned-review", "Versioned review"),
      origin: {
        kind: "daily-review" as const,
        sourceId: "review-source",
        sourceKey: "2026-07-09:source:codex",
        sourceDate: "2026-07-09",
        sourceLabel: "Codex",
        contentVersion: "source-version-2",
        revision: 3,
        revisionKind: "restore" as const,
        derivedFromRevision: 1,
        syncedItemContentVersion: "item-version-3",
      },
    };
    const backup = makeBackup({ items: [versionedItem] });

    expect(validateCoreBackup(backup).payload.items[0].origin).toEqual(versionedItem.origin);
    await restoreCoreBackup(backup);
    expect((await exportCoreBackup()).payload.items[0].origin).toEqual(versionedItem.origin);

    expect(() => validateCoreBackup(makeBackup({
      items: [{ ...versionedItem, origin: { ...versionedItem.origin, revision: 0 } }],
    }))).toThrow(/revision.*正整数/);
    expect(() => validateCoreBackup(makeBackup({
      items: [{ ...versionedItem, origin: { ...versionedItem.origin, revisionKind: "branch" } }],
    } as never))).toThrow(/revisionKind.*无效/);
    expect(() => validateCoreBackup(makeBackup({
      items: [{ ...versionedItem, origin: { ...versionedItem.origin, syncedItemContentVersion: "" } }],
    }))).toThrow(/syncedItemContentVersion/);
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

  it("archives rolling work reviews without creating duplicate archive entries", async () => {
    await upsertRollingWorkReview({
      date: "2026-07-11",
      title: "2026-07-11 自动工作回顾",
      content: "Useful rolling work review.",
      sourceKinds: ["codex", "claude"],
      processedSessionCount: 3,
      processedChars: 512,
      lastRunAt: NOW,
      status: "ready",
    });

    const first = await archiveRollingWorkReview("2026-07-11");
    const second = await archiveRollingWorkReview("2026-07-11");
    const savedRolling = await getRollingWorkReviewByDate("2026-07-11");
    const archiveEntries = (await getCodexDailyReviews()).filter((review) => review.reviewKind === "auto-work" && review.date === "2026-07-11");

    expect(second.archiveReview.id).toBe(first.archiveReview.id);
    expect(savedRolling?.archiveReviewId).toBe(first.archiveReview.id);
    expect(archiveEntries).toHaveLength(1);
    expect(archiveEntries[0].sourceLabel).toBe("自动工作回顾");
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
