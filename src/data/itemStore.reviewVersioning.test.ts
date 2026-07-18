import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import { createReviewContentVersion } from "../lib/memorySuggestion";
import {
  getDailyReviewLibraryLineage,
  getVisibleDailyReviewLibraryItems,
} from "../lib/reviewLibraryPublication";
import type { DailyConversationReview, Item } from "../types";
import type { DaymarkCoreBackupPayload, DaymarkCoreBackupV1 } from "./itemStore";
import {
  DAYMARK_CORE_BACKUP_SCHEMA,
  applyDailyReviewLibraryUpdate,
  createKnowledgeLink,
  deleteItem,
  getItems,
  getKnowledgeLinks,
  getTodayDashboardData,
  publishDailyReviewToLibrary,
  restoreCoreBackup,
  restoreDailyReviewLibraryVersion,
  searchKnowledge,
  updateCodexDailyReview,
  updateItem,
  upsertDailyConversationReview,
} from "./itemStore";

describe("daily review library versioning", () => {
  beforeEach(async () => {
    await restoreCoreBackup(makeBackup());
  });

  it("updates the current item atomically while preserving all library attributes", async () => {
    const review = await createReview("2026-08-01", "来源第一版");
    const published = await publish(review);
    const customized = await updateItem(published.id, {
      folderId: "folder-keep",
      tags: ["保留标签"],
      processStatus: "已整理",
      readingStatus: "需复习",
      favorite: true,
      todos: ["保留待办"],
      aiSummary: "保留 AI 摘要",
      lastAiRunAt: "2026-08-01 12:00:00",
      lastOpenedAt: "2026-08-01 12:30:00",
      filePath: "D:\\keep.md",
      sourceUrl: "https://example.com/keep",
    });
    await createKnowledgeLink({
      sourceKind: "item",
      sourceId: customized.id,
      targetKind: "memory",
      targetId: "memory-keep",
      relation: "related",
    });
    const latest = await updateCodexDailyReview(review.id, { content: "来源第二版" });

    const result = await applyDailyReviewLibraryUpdate({
      ...makeApplyInput(customized, latest, "update-current", {
        title: "用户确认的第二版",
        content: "用户确认后的第二版正文",
      }),
      sourceId: "stale-source-id",
    });

    expect(result.created).toBe(false);
    expect(result.item).toMatchObject({
      id: customized.id,
      title: "用户确认的第二版",
      content: "用户确认后的第二版正文",
      folderId: "folder-keep",
      tags: ["保留标签"],
      processStatus: "已整理",
      readingStatus: "需复习",
      favorite: true,
      todos: ["保留待办"],
      aiSummary: "保留 AI 摘要",
      lastAiRunAt: "2026-08-01 12:00:00",
      lastOpenedAt: "2026-08-01 12:30:00",
      filePath: "D:\\keep.md",
      sourceUrl: "https://example.com/keep",
      origin: {
        revision: 1,
        revisionKind: "source",
        contentVersion: createReviewContentVersion(latest.title, latest.content),
        syncedItemContentVersion: createReviewContentVersion("用户确认的第二版", "用户确认后的第二版正文"),
      },
    });
    expect((await getKnowledgeLinks()).map((link) => link.sourceId)).toContain(customized.id);
  });

  it("creates one idempotent source version, inherits organization, and resets item-specific state", async () => {
    const review = await createReview("2026-08-02", "版本一检索词");
    const published = await publish(review);
    const head = await updateItem(published.id, {
      folderId: "folder-inherit",
      tags: ["继承标签"],
      processStatus: "待整理",
      readingStatus: "阅读中",
      favorite: true,
      todos: ["不继承"],
      aiSummary: "不继承摘要",
      lastAiRunAt: "2026-08-02 12:00:00",
      lastOpenedAt: "2026-08-02 12:30:00",
      filePath: "D:\\do-not-inherit.md",
      sourceUrl: "https://example.com/no",
    });
    await createKnowledgeLink({
      sourceKind: "item",
      sourceId: head.id,
      targetKind: "memory",
      targetId: "memory-old",
      relation: "related",
    });
    const latest = await updateCodexDailyReview(review.id, { content: "版本二检索词" });
    const input = makeApplyInput(head, latest, "create-version");

    const [first, second] = await Promise.all([
      applyDailyReviewLibraryUpdate(input),
      applyDailyReviewLibraryUpdate(input),
    ]);
    const items = await getItems();

    expect(first.created).toBe(true);
    expect(second).toMatchObject({ created: false, item: { id: first.item.id } });
    expect(items).toHaveLength(2);
    expect(first.item).toMatchObject({
      folderId: "folder-inherit",
      tags: ["继承标签"],
      processStatus: "待整理",
      readingStatus: "阅读中",
      favorite: false,
      todos: [],
      origin: { revision: 2, revisionKind: "source" },
    });
    expect(first.item.aiSummary).toMatch(/来自/);
    expect(first.item).not.toHaveProperty("lastAiRunAt");
    expect(first.item).not.toHaveProperty("lastOpenedAt");
    expect(first.item).not.toHaveProperty("filePath");
    expect(first.item).not.toHaveProperty("sourceUrl");
    expect((await getKnowledgeLinks()).some((link) => link.sourceId === first.item.id || link.targetId === first.item.id)).toBe(false);
    expect(getVisibleDailyReviewLibraryItems(items).map((item) => item.id)).toEqual([first.item.id]);
    expect((await getTodayDashboardData()).pendingItems.map((item) => item.id)).toEqual([first.item.id]);

    const oldSearch = await searchKnowledge("版本一检索词");
    expect(oldSearch.item).toHaveLength(0);
  });

  it("creates and deduplicates a reactivation when the latest source snapshot exists in history", async () => {
    const reviewV1 = await createReview("2026-08-03", "来源版本一");
    const v1 = await publish(reviewV1);
    const reviewV2 = await updateCodexDailyReview(reviewV1.id, { content: "来源版本二" });
    const v2 = await applyDailyReviewLibraryUpdate(makeApplyInput(v1, reviewV2, "create-version"));
    const reviewBackToV1 = await updateCodexDailyReview(reviewV1.id, { content: "来源版本一" });
    const input = makeApplyInput(v2.item, reviewBackToV1, "create-version");

    const first = await applyDailyReviewLibraryUpdate(input);
    const second = await applyDailyReviewLibraryUpdate(input);

    expect(first.item.origin).toMatchObject({
      revision: 3,
      revisionKind: "reactivation",
      derivedFromRevision: 1,
    });
    expect(second).toMatchObject({ created: false, item: { id: first.item.id } });
    expect(await getItems()).toHaveLength(3);
  });

  it("restores an edited historical item as a new idempotent head without needing its source", async () => {
    const sourceKey = "2099-01-01:source:codex-missing";
    const v1 = makeVersionItem({
      id: "missing-source-v1",
      sourceKey,
      revision: 1,
      title: "历史标题",
      content: "历史正文",
      createdAt: "2026-08-04 10:00:00",
    });
    const v2 = makeVersionItem({
      id: "missing-source-v2",
      sourceKey,
      revision: 2,
      title: "当前标题",
      content: "当前正文",
      createdAt: "2026-08-04 11:00:00",
      folderId: "folder-current",
      tags: ["当前标签"],
      processStatus: "已归档",
      readingStatus: "已阅读",
    });
    await restoreCoreBackup(makeBackup({ items: [v1, v2] }));
    const input = {
      itemId: v1.id,
      expectedItemUpdatedAt: v1.updatedAt,
      expectedItemContentVersion: createReviewContentVersion(v1.title, v1.content),
      expectedRecordedSourceVersion: v1.origin!.contentVersion,
      expectedHeadId: v2.id,
      expectedHeadRevision: 2,
      expectedHeadUpdatedAt: v2.updatedAt,
      expectedHeadItemContentVersion: createReviewContentVersion(v2.title, v2.content),
      expectedHeadRecordedSourceVersion: v2.origin!.contentVersion,
      sourceKey,
    };

    const [first, second] = await Promise.all([
      restoreDailyReviewLibraryVersion(input),
      restoreDailyReviewLibraryVersion(input),
    ]);

    expect(first.item).toMatchObject({
      title: v1.title,
      content: v1.content,
      folderId: v2.folderId,
      tags: v2.tags,
      processStatus: v2.processStatus,
      readingStatus: v2.readingStatus,
      favorite: false,
      todos: [],
      origin: {
        sourceId: "missing-source",
        revision: 3,
        revisionKind: "restore",
        derivedFromRevision: 1,
      },
    });
    expect(second).toMatchObject({ created: false, item: { id: first.item.id } });
    expect(await getItems()).toHaveLength(3);
  });

  it("does not confuse restores from duplicate revision numbers with different source snapshots", async () => {
    const sourceKey = "2099-01-02:source:duplicate-revision";
    const shared = {
      sourceKey,
      revision: 1,
      title: "Same historical title",
      content: "Same historical content",
    };
    const v1a = makeVersionItem({
      ...shared,
      id: "duplicate-revision-v1-a",
      createdAt: "2026-08-04 09:00:00",
    });
    const v1b = makeVersionItem({
      ...shared,
      id: "duplicate-revision-v1-b",
      createdAt: "2026-08-04 09:30:00",
    });
    v1a.origin = { ...v1a.origin!, contentVersion: "source-snapshot-a" };
    v1b.origin = { ...v1b.origin!, contentVersion: "source-snapshot-b" };
    const v2 = makeVersionItem({
      id: "duplicate-revision-v2",
      sourceKey,
      revision: 2,
      title: "Current title",
      content: "Current content",
      createdAt: "2026-08-04 10:00:00",
    });
    await restoreCoreBackup(makeBackup({ items: [v1a, v1b, v2] }));

    const first = await restoreDailyReviewLibraryVersion(makeRestoreInput(v1a, v2));
    await expect(restoreDailyReviewLibraryVersion(makeRestoreInput(v1b, v2))).rejects.toThrow();

    expect(first.item.origin).toMatchObject({
      contentVersion: "source-snapshot-a",
      revision: 3,
      revisionKind: "restore",
      derivedFromRevision: 1,
    });
    expect(await getItems()).toHaveLength(4);
  });

  it("rejects stale item, head, and source versions without partial writes", async () => {
    const review = await createReview("2026-08-05", "冲突版本一");
    const head = await publish(review);
    const latest = await updateCodexDailyReview(review.id, { content: "冲突版本二" });
    const valid = makeApplyInput(head, latest, "create-version");

    await expect(applyDailyReviewLibraryUpdate({ ...valid, expectedItemUpdatedAt: "stale" })).rejects.toThrow(/资料已被修改/);
    await expect(applyDailyReviewLibraryUpdate({ ...valid, expectedHeadUpdatedAt: "stale" })).rejects.toThrow(/当前资料版本已经变化/);
    await expect(applyDailyReviewLibraryUpdate({ ...valid, expectedSourceVersion: "stale" })).rejects.toThrow(/来源回顾已经更新/);
    expect(await getItems()).toHaveLength(1);
  });

  it("rejects item content and recorded-source changes even when updatedAt is unchanged", async () => {
    const review = await createReview("2026-08-07", "同秒冲突版本一");
    const head = await publish(review);
    const latest = await updateCodexDailyReview(review.id, { content: "同秒冲突版本二" });
    const input = makeApplyInput(head, latest, "create-version");

    const sameTimestampEdit: Item = {
      ...head,
      title: "同秒手动修改",
      updatedAt: head.updatedAt,
    };
    await restoreCoreBackup(makeBackup({ items: [sameTimestampEdit] }));
    await expect(applyDailyReviewLibraryUpdate(input)).rejects.toThrow(/资料已被修改/);

    const sameTimestampOriginChange: Item = {
      ...head,
      updatedAt: head.updatedAt,
      origin: {
        ...head.origin!,
        contentVersion: "same-second-origin-change",
      },
    };
    await restoreCoreBackup(makeBackup({ items: [sameTimestampOriginChange] }));
    await expect(applyDailyReviewLibraryUpdate(input)).rejects.toThrow(/资料已被修改/);
    expect(await getItems()).toHaveLength(1);
  });

  it("rejects a same-timestamp head change before restoring a historical version", async () => {
    const sourceKey = "2099-01-02:source:restore-head-conflict";
    const v1 = makeVersionItem({
      id: "restore-head-conflict-v1",
      sourceKey,
      revision: 1,
      title: "待恢复历史版",
      content: "待恢复历史正文",
      createdAt: "2026-08-07 11:00:00",
    });
    const v2 = makeVersionItem({
      id: "restore-head-conflict-v2",
      sourceKey,
      revision: 2,
      title: "冲突前当前版",
      content: "冲突前当前正文",
      createdAt: "2026-08-07 12:00:00",
    });
    await restoreCoreBackup(makeBackup({ items: [v1, v2] }));
    const input = makeRestoreInput(v1, v2);
    await restoreCoreBackup(makeBackup({
      items: [v1, { ...v2, content: "同秒修改后的当前正文", updatedAt: v2.updatedAt }],
    }));

    await expect(restoreDailyReviewLibraryVersion(input)).rejects.toThrow(/当前资料版本已经变化/);
    expect(await getItems()).toHaveLength(2);
  });

  it("preserves restore and reactivation provenance when updating the current item", async () => {
    const restoreReviewV1 = await createReview("2026-08-08", "恢复来源一");
    const restoreV1 = await publish(restoreReviewV1);
    const restoreReviewV2 = await updateCodexDailyReview(restoreReviewV1.id, { content: "恢复来源二" });
    const restoreV2 = await applyDailyReviewLibraryUpdate(makeApplyInput(restoreV1, restoreReviewV2, "create-version"));
    const restored = await restoreDailyReviewLibraryVersion(makeRestoreInput(restoreV1, restoreV2.item));
    const restoreReviewV3 = await updateCodexDailyReview(restoreReviewV1.id, { content: "恢复来源三" });
    const updatedRestore = await applyDailyReviewLibraryUpdate(
      makeApplyInput(restored.item, restoreReviewV3, "update-current"),
    );

    expect(updatedRestore.item.origin).toMatchObject({
      revision: 3,
      revisionKind: "restore",
      derivedFromRevision: 1,
      contentVersion: createReviewContentVersion(restoreReviewV3.title, restoreReviewV3.content),
    });

    const reactReviewV1 = await createReview("2026-08-09", "重新启用来源一");
    const reactV1 = await publish(reactReviewV1);
    const reactReviewV2 = await updateCodexDailyReview(reactReviewV1.id, { content: "重新启用来源二" });
    const reactV2 = await applyDailyReviewLibraryUpdate(makeApplyInput(reactV1, reactReviewV2, "create-version"));
    const reactReviewBack = await updateCodexDailyReview(reactReviewV1.id, { content: "重新启用来源一" });
    const reactivated = await applyDailyReviewLibraryUpdate(makeApplyInput(reactV2.item, reactReviewBack, "create-version"));
    const reactReviewV3 = await updateCodexDailyReview(reactReviewV1.id, { content: "重新启用来源三" });
    const updatedReactivation = await applyDailyReviewLibraryUpdate(
      makeApplyInput(reactivated.item, reactReviewV3, "update-current"),
    );

    expect(updatedReactivation.item.origin).toMatchObject({
      revision: 3,
      revisionKind: "reactivation",
      derivedFromRevision: 1,
      contentVersion: createReviewContentVersion(reactReviewV3.title, reactReviewV3.content),
    });
  });

  it("does not treat a different final edit as an idempotent create-version replay", async () => {
    const review = await createReview("2026-08-10", "最终编辑来源一");
    const head = await publish(review);
    const latest = await updateCodexDailyReview(review.id, { content: "最终编辑来源二" });
    const originalInput = makeApplyInput(head, latest, "create-version", {
      title: "确认版本 A",
      content: "确认正文 A",
    });
    const conflictingReplay = {
      ...makeApplyInput(head, latest, "create-version"),
      title: "确认版本 B",
      content: "确认正文 B",
    };

    const first = await applyDailyReviewLibraryUpdate(originalInput);
    await expect(applyDailyReviewLibraryUpdate(conflictingReplay)).rejects.toThrow(/确认内容与现有版本不同/);

    const items = await getItems();
    expect(items).toHaveLength(2);
    expect(items.find((item) => item.id === first.item.id)).toMatchObject({ title: "确认版本 A", content: "确认正文 A" });
    expect(items.some((item) => item.title === "确认版本 B" || item.content === "确认正文 B")).toBe(false);
  });

  it("searches only the head and exposes an updated source until it is synchronized", async () => {
    const review = await createReview("2026-08-06", "旧来源关键词");
    const head = await publish(review);
    const latest = await updateCodexDailyReview(review.id, { content: "旧来源关键词 与 最新来源关键词" });

    const changedResults = await searchKnowledge("最新来源关键词");
    expect(changedResults.summary).toContainEqual(expect.objectContaining({
      id: review.id,
      statusLabel: "有更新",
    }));
    const changedItemResults = await searchKnowledge("旧来源关键词");
    expect(changedItemResults.item).toContainEqual(expect.objectContaining({
      id: head.id,
      statusLabel: "来源有更新",
    }));

    const created = await applyDailyReviewLibraryUpdate(makeApplyInput(head, latest, "create-version"));
    const syncedResults = await searchKnowledge("最新来源关键词");
    expect(syncedResults.item.map((result) => result.id)).toEqual([created.item.id]);
    expect(syncedResults.summary.map((result) => result.id)).not.toContain(review.id);

    await deleteItem(created.item.id);
    const fallbackResults = await searchKnowledge("最新来源关键词");
    expect(fallbackResults.summary).toContainEqual(expect.objectContaining({ id: review.id, statusLabel: "有更新" }));

    const remainingItems = await getItems();
    expect(getVisibleDailyReviewLibraryItems(remainingItems).map((item) => item.id)).toEqual([head.id]);
    await deleteItem(head.id);
    const afterFullDeletion = await searchKnowledge("最新来源关键词");
    const restoredReviewResult = afterFullDeletion.summary.find((result) => result.id === review.id);
    expect(restoredReviewResult).toBeDefined();
    expect(restoredReviewResult?.statusLabel).toBeUndefined();
  });

  it("keeps a source-missing head searchable without exposing a review duplicate", async () => {
    const sourceKey = "2099-02-01:source:missing-search";
    const item = makeVersionItem({
      id: "missing-search-v1",
      sourceKey,
      revision: 1,
      title: "仅本机资料关键词",
      content: "来源回顾已经不在本机",
      createdAt: "2026-08-11 10:00:00",
    });
    await restoreCoreBackup(makeBackup({ items: [item] }));

    const results = await searchKnowledge("仅本机资料关键词");
    expect(results.item).toContainEqual(expect.objectContaining({ id: item.id }));
    expect(results.summary).toHaveLength(0);
  });

  it("keeps the current head visible when a historical version is deleted", async () => {
    const review = await createReview("2026-08-12", "历史删除来源一");
    const first = await publish(review);
    const latest = await updateCodexDailyReview(review.id, { content: "历史删除来源二" });
    const second = await applyDailyReviewLibraryUpdate(makeApplyInput(first, latest, "create-version"));

    await deleteItem(first.id);

    const remainingItems = await getItems();
    expect(getDailyReviewLibraryLineage(remainingItems, review.reviewKey)?.head.id).toBe(second.item.id);
    expect(getVisibleDailyReviewLibraryItems(remainingItems).map((item) => item.id)).toEqual([second.item.id]);
    const results = await searchKnowledge("历史删除来源二");
    expect(results.item.map((result) => result.id)).toEqual([second.item.id]);
    expect(results.summary.map((result) => result.id)).not.toContain(review.id);
  });
});

async function createReview(date: string, content: string) {
  return upsertDailyConversationReview({
    reviewKey: `${date}:source:codex`,
    date,
    reviewKind: "source",
    sourceKind: "codex",
    sourceLabel: "Codex",
    title: `${date} Codex 回顾`,
    content,
    sessionCount: 1,
    sessionIds: [`session-${date}`],
    sourceReviewIds: [],
  });
}

async function publish(review: DailyConversationReview) {
  return (await publishDailyReviewToLibrary({
    reviewId: review.id,
    expectedSourceVersion: createReviewContentVersion(review.title, review.content),
    title: review.title,
    content: review.content,
    tags: ["AI 回顾"],
  })).item;
}

function makeApplyInput(
  head: Item,
  review: DailyConversationReview,
  mode: "update-current" | "create-version",
  result: { title?: string; content?: string } = {},
) {
  const lineage = getDailyReviewLibraryLineage([head], head.origin!.sourceKey)!;
  return {
    mode,
    itemId: head.id,
    expectedItemUpdatedAt: head.updatedAt,
    expectedItemContentVersion: createReviewContentVersion(head.title, head.content),
    expectedRecordedSourceVersion: head.origin!.contentVersion,
    expectedHeadId: lineage.head.id,
    expectedHeadRevision: lineage.head.origin?.revision ?? 1,
    expectedHeadUpdatedAt: lineage.head.updatedAt,
    expectedHeadItemContentVersion: createReviewContentVersion(lineage.head.title, lineage.head.content),
    expectedHeadRecordedSourceVersion: lineage.head.origin!.contentVersion,
    sourceId: review.id,
    sourceKey: review.reviewKey,
    expectedSourceVersion: createReviewContentVersion(review.title, review.content),
    title: result.title ?? review.title,
    content: result.content ?? review.content,
  };
}

function makeRestoreInput(item: Item, head: Item) {
  return {
    itemId: item.id,
    expectedItemUpdatedAt: item.updatedAt,
    expectedItemContentVersion: createReviewContentVersion(item.title, item.content),
    expectedRecordedSourceVersion: item.origin!.contentVersion,
    expectedHeadId: head.id,
    expectedHeadRevision: head.origin?.revision ?? 1,
    expectedHeadUpdatedAt: head.updatedAt,
    expectedHeadItemContentVersion: createReviewContentVersion(head.title, head.content),
    expectedHeadRecordedSourceVersion: head.origin!.contentVersion,
    sourceKey: item.origin!.sourceKey,
  };
}

function makeVersionItem(input: {
  id: string;
  sourceKey: string;
  revision: number;
  title: string;
  content: string;
  createdAt: string;
  folderId?: string;
  tags?: string[];
  processStatus?: Item["processStatus"];
  readingStatus?: Item["readingStatus"];
}): Item {
  return {
    id: input.id,
    title: input.title,
    type: "note",
    processStatus: input.processStatus ?? "收件箱",
    readingStatus: input.readingStatus ?? "不需要",
    folderId: input.folderId,
    tags: input.tags ?? [],
    content: input.content,
    aiSummary: "来源缺失测试",
    todos: [],
    favorite: false,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    origin: {
      kind: "daily-review",
      sourceId: "missing-source",
      sourceKey: input.sourceKey,
      sourceDate: "2099-01-01",
      sourceLabel: "Codex",
      contentVersion: createReviewContentVersion(input.title, input.content),
      revision: input.revision,
      revisionKind: "source",
      syncedItemContentVersion: createReviewContentVersion(input.title, input.content),
    },
  };
}

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
    exportedAt: "2026-08-01T00:00:00.000Z",
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
