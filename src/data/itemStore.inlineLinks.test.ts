import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import type { DaymarkCoreBackupPayload, DaymarkCoreBackupV1 } from "./itemStore";
import type { Item } from "../types";
import {
  DAYMARK_CORE_BACKUP_SCHEMA,
  createItemsBatch,
  createItem,
  createKnowledgeLink,
  deleteItem,
  exportCoreBackup,
  getItems,
  getKnowledgeLinks,
  restoreCoreBackup,
  reconcileInlineLinks,
  searchKnowledge,
  syncInlineLinksForSource,
  updateItem,
  validateCoreBackup,
} from "./itemStore";

describe("inline item knowledge links", () => {
  beforeEach(async () => restoreCoreBackup(makeBackup()));

  it("adds, deduplicates and removes inline relations without touching manual links", async () => {
    const target = await createItem({ title: "目标资料" });
    const source = await createItem({ title: "来源资料", content: `一处 [[item:${target.id}]]，二处 [[item:${target.id}|别名]]。` });
    await createKnowledgeLink({
      sourceKind: "item", sourceId: source.id, targetKind: "item", targetId: target.id, relation: "相关",
    });

    const links = await getKnowledgeLinks();
    expect(links.filter((link) => link.linkKind === "inline")).toEqual([
      expect.objectContaining({ sourceId: source.id, targetId: target.id, targetRef: target.id, relation: "正文引用" }),
    ]);
    expect(links.filter((link) => (link.linkKind ?? "manual") === "manual")).toHaveLength(1);
    const search = await searchKnowledge("目标资料");
    expect(search.item.map((result) => result.id)).toContain(source.id);
    expect(search.item.find((result) => result.id === source.id)?.snippet).not.toContain(target.id);

    await updateItem(source.id, { content: "正文引用已经删除。" });
    const after = await getKnowledgeLinks();
    expect(after.some((link) => link.linkKind === "inline")).toBe(false);
    expect(after.filter((link) => (link.linkKind ?? "manual") === "manual")).toHaveLength(1);
  });

  it("keeps source markdown but removes relations when a normal target is deleted", async () => {
    const target = await createItem({ title: "将被删除" });
    const source = await createItem({ title: "来源", content: `正文 [[item:${target.id}]]` });
    await deleteItem(target.id);

    expect((await getKnowledgeLinks()).some((link) => link.linkKind === "inline")).toBe(false);
    expect((await getItems()).find((item) => item.id === source.id)?.content).toContain(`[[item:${target.id}]]`);
    expect(JSON.stringify(await searchKnowledge(target.id))).not.toContain(target.id);
  });

  it("points review references at the current head and falls back after deleting it", async () => {
    const v1 = reviewItem("review-v1", 1, "第一版");
    const v2 = reviewItem("review-v2", 2, "第二版");
    const source = makeItem("source", "来源资料", "[[item:review:review-key]]");
    await restoreCoreBackup(makeBackup({ items: [v1, v2, source] }));

    expect((await getKnowledgeLinks()).find((link) => link.linkKind === "inline")).toMatchObject({
      sourceId: source.id, targetId: v2.id, targetRef: "review:review-key",
    });
    await deleteItem(v2.id);
    expect((await getKnowledgeLinks()).find((link) => link.linkKind === "inline")).toMatchObject({
      sourceId: source.id, targetId: v1.id, targetRef: "review:review-key",
    });
  });

  it("preserves optional link fields through backup v1 and treats old records as manual", async () => {
    const target = await createItem({ title: "目标" });
    await createItem({ title: "来源", content: `[[item:${target.id}]]` });
    const backup = await exportCoreBackup();
    expect(backup.payload.links[0]).toMatchObject({ linkKind: "inline", targetRef: target.id });
    await restoreCoreBackup(backup);
    expect((await exportCoreBackup()).payload.links[0]).toMatchObject({ linkKind: "inline", targetRef: target.id });

    const oldManual = {
      id: "old-link", sourceKind: "item" as const, sourceId: "a", targetKind: "item" as const,
      targetId: "b", relation: "相关", createdAt: "2026-07-18T00:00:00.000Z",
    };
    expect(validateCoreBackup(makeBackup({ links: [oldManual] })).payload.links[0].linkKind).toBeUndefined();
    expect(() => validateCoreBackup(makeBackup({ links: [{ ...oldManual, linkKind: "inline" }] }))).toThrow(/正文引用|targetRef/);
  });

  it("updates only the edited source and keeps unrelated inline records stable", async () => {
    const firstTarget = await createItem({ title: "first target" });
    const secondTarget = await createItem({ title: "second target" });
    const firstSource = await createItem({ title: "first source", content: `[[item:${firstTarget.id}]]` });
    const secondSource = await createItem({ title: "second source", content: `[[item:${secondTarget.id}]]` });
    const before = (await getKnowledgeLinks()).find((link) => link.sourceId === secondSource.id && link.linkKind === "inline")!;

    await updateItem(firstSource.id, { content: `[[item:${secondTarget.id}]]` });

    const after = (await getKnowledgeLinks()).find((link) => link.sourceId === secondSource.id && link.linkKind === "inline")!;
    expect(after.id).toBe(before.id);
    expect(after.createdAt).toBe(before.createdAt);
    expect(await syncInlineLinksForSource(firstSource.id)).toEqual({ created: 0, updated: 0, deleted: 0, unchanged: 1 });
  });

  it("creates a 200-item batch atomically, deduplicates existing and in-batch sources, and reconciles once", async () => {
    const existing = await createItem({ title: "existing", sourceUrl: "https://example.com/existing" });
    const inputs = Array.from({ length: 200 }, (_, index) => ({
      title: `batch ${index}`,
      sourceUrl: `https://example.com/${index}`,
      content: index === 0 ? "[[item:missing]]" : "",
    }));
    inputs.push({ title: "existing duplicate", sourceUrl: "https://example.com/existing", content: "" });
    inputs.push({ title: "batch duplicate", sourceUrl: "https://example.com/20", content: "" });

    const result = await createItemsBatch(inputs);
    expect(result.created).toHaveLength(200);
    expect(result.duplicateItemIds).toEqual([existing.id, result.created[20].id]);
    expect(await getItems()).toHaveLength(201);
  });

  it("aborts an entire batch when a later input fails", async () => {
    const broken = {} as { title: string };
    Object.defineProperty(broken, "title", { get: () => { throw new Error("batch input failure"); } });

    await expect(createItemsBatch([
      { title: "before failure", sourceUrl: "https://example.com/before" },
      broken,
    ])).rejects.toThrow("batch input failure");
    expect(await getItems()).toHaveLength(0);
  });

  it("serializes single and batch source deduplication in write transactions", async () => {
    const sourceUrl = "https://example.com/concurrent";
    const [single, batch] = await Promise.all([
      createItem({ title: "single", sourceUrl }),
      createItemsBatch([{ title: "batch", sourceUrl }]),
    ]);

    const stored = await getItems();
    expect(stored).toHaveLength(1);
    expect(single.id).toBe(stored[0].id);
    expect(batch.created.length + batch.duplicateItemIds.length).toBe(1);
    expect(batch.created[0]?.id ?? batch.duplicateItemIds[0]).toBe(stored[0].id);
  });

  it("reconciles a 1,000-item / 5,000-reference graph without rewriting unchanged inline records", async () => {
    const items = Array.from({ length: 1000 }, (_, index) => makeItem(
      `graph-${index}`,
      `graph ${index}`,
      Array.from({ length: 5 }, (_, offset) => `[[item:graph-${(index + offset + 1) % 1000}]]`).join(" "),
    ));
    await restoreCoreBackup(makeBackup({ items }));
    const firstLinks = (await getKnowledgeLinks()).filter((link) => link.linkKind === "inline");
    expect(firstLinks).toHaveLength(5000);
    const result = await reconcileInlineLinks();
    const secondLinks = (await getKnowledgeLinks()).filter((link) => link.linkKind === "inline");

    expect(result).toEqual({ created: 0, updated: 0, deleted: 0, unchanged: 5000 });
    expect(secondLinks.map((link) => link.id).sort()).toEqual(firstLinks.map((link) => link.id).sort());
  });
});

function makeItem(id: string, title: string, content = ""): Item {
  return {
    id, title, content, type: "note", processStatus: "收件箱", readingStatus: "不需要", tags: [], aiSummary: "",
    createdAt: "2026-07-18T00:00:00.000Z", updatedAt: "2026-07-18T00:00:00.000Z", favorite: false,
  };
}

function reviewItem(id: string, revision: number, title: string): Item {
  return {
    ...makeItem(id, title),
    createdAt: `2026-07-${String(17 + revision).padStart(2, "0")}T00:00:00.000Z`,
    origin: {
      kind: "daily-review", sourceId: "review-source", sourceKey: "review-key", sourceDate: "2026-07-18",
      sourceLabel: "Codex", contentVersion: `source-${revision}`, revision,
    },
  };
}

function makeBackup(payload: Partial<DaymarkCoreBackupPayload> = {}): DaymarkCoreBackupV1 {
  const fullPayload: DaymarkCoreBackupPayload = {
    items: [], folders: [], journalEntries: [], memoryDocument: null, memoryCards: [], links: [], ...payload,
  };
  return {
    schema: DAYMARK_CORE_BACKUP_SCHEMA,
    exportedAt: "2026-07-18T00:00:00.000Z",
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
