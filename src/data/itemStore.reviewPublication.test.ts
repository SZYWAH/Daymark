import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import { createReviewContentVersion } from "../lib/memorySuggestion";
import type { DaymarkCoreBackupPayload, DaymarkCoreBackupV1 } from "./itemStore";
import {
  DAYMARK_CORE_BACKUP_SCHEMA,
  deleteItem,
  exportCoreBackup,
  getDailyConversationReviewById,
  getItems,
  publishDailyReviewToLibrary,
  restoreCoreBackup,
  searchKnowledge,
  updateCodexDailyReview,
  upsertDailyConversationReview,
} from "./itemStore";

describe("daily review publication", () => {
  beforeEach(async () => {
    await restoreCoreBackup(makeBackup());
  });

  it("publishes one stable snapshot and returns the existing item on duplicate saves", async () => {
    const review = await createReview("2026-07-18", "发布闭环唯一词");
    const input = {
      reviewId: review.id,
      expectedSourceVersion: createReviewContentVersion(review.title, review.content),
      title: "资料库中的今日回顾",
      content: "用户确认后的资料正文。",
      tags: ["AI 回顾", "Codex", "AI 回顾", "  "],
      folderId: undefined,
    };

    const first = await publishDailyReviewToLibrary(input);
    const second = await publishDailyReviewToLibrary(input);
    const savedReview = await getDailyConversationReviewById(review.id);
    const items = await getItems();

    expect(first.created).toBe(true);
    expect(second).toMatchObject({ created: false, item: { id: first.item.id } });
    expect(items).toHaveLength(1);
    expect(first.item).toMatchObject({
      type: "note",
      processStatus: "收件箱",
      readingStatus: "不需要",
      title: input.title,
      content: input.content,
      tags: ["AI 回顾", "Codex"],
      origin: {
        kind: "daily-review",
        sourceId: review.id,
        sourceKey: review.reviewKey,
        sourceDate: review.date,
        sourceLabel: review.sourceLabel,
        contentVersion: input.expectedSourceVersion,
        revision: 1,
        revisionKind: "source",
        syncedItemContentVersion: createReviewContentVersion(input.title, input.content),
      },
    });
    expect(savedReview).toEqual(review);
  });

  it("allows publishing the review again after its library item is deleted", async () => {
    const review = await createReview("2026-07-24", "Publish again after deleting the snapshot.");
    const input = {
      reviewId: review.id,
      expectedSourceVersion: createReviewContentVersion(review.title, review.content),
      title: review.title,
      content: review.content,
      tags: ["AI review", review.sourceLabel],
    };

    const first = await publishDailyReviewToLibrary(input);
    await deleteItem(first.item.id);
    const second = await publishDailyReviewToLibrary(input);

    expect(second.created).toBe(true);
    expect(second.item.id).not.toBe(first.item.id);
    expect(await getItems()).toEqual([second.item]);
  });

  it("rejects missing or changed sources without writing a partial item", async () => {
    const review = await createReview("2026-07-19", "来源版本唯一词");
    const staleVersion = createReviewContentVersion(review.title, review.content);
    await updateCodexDailyReview(review.id, { content: "来源已经更新。" });

    await expect(publishDailyReviewToLibrary({
      reviewId: review.id,
      expectedSourceVersion: staleVersion,
      title: review.title,
      content: review.content,
      tags: ["AI 回顾"],
    })).rejects.toThrow(/已经更新/);
    await expect(publishDailyReviewToLibrary({
      reviewId: "missing-review",
      expectedSourceVersion: "missing-version",
      title: "不存在的回顾",
      content: "不会保存。",
      tags: [],
    })).rejects.toThrow(/不存在/);
    expect(await getItems()).toHaveLength(0);
  });

  it("retains publication provenance through core backup and restore", async () => {
    const review = await createReview("2026-07-20", "备份来源唯一词");
    const published = await publishDailyReviewToLibrary({
      reviewId: review.id,
      expectedSourceVersion: createReviewContentVersion(review.title, review.content),
      title: review.title,
      content: review.content,
      tags: ["AI 回顾"],
    });
    const backup = await exportCoreBackup();

    await restoreCoreBackup(makeBackup());
    await restoreCoreBackup(backup);

    expect((await getItems())[0].origin).toEqual(published.item.origin);
  });

  it("publishes different reviews independently and marks filed items for organization", async () => {
    const firstReview = await createReview("2026-07-22", "第一份回顾唯一词");
    const secondReview = await createReview("2026-07-23", "第二份回顾唯一词");
    const first = await publishDailyReviewToLibrary({
      reviewId: firstReview.id,
      expectedSourceVersion: createReviewContentVersion(firstReview.title, firstReview.content),
      title: firstReview.title,
      content: firstReview.content,
      tags: ["AI 回顾"],
      folderId: "folder-review",
    });
    const second = await publishDailyReviewToLibrary({
      reviewId: secondReview.id,
      expectedSourceVersion: createReviewContentVersion(secondReview.title, secondReview.content),
      title: secondReview.title,
      content: secondReview.content,
      tags: ["AI 回顾"],
    });

    expect(first.item).toMatchObject({ folderId: "folder-review", processStatus: "待整理" });
    expect(second.item.processStatus).toBe("收件箱");
    expect(new Set((await getItems()).map((item) => item.id))).toEqual(new Set([first.item.id, second.item.id]));
  });

  it("uses the published library item as the global search result", async () => {
    const review = await createReview("2026-07-21", "检索去重唯一词");
    const published = await publishDailyReviewToLibrary({
      reviewId: review.id,
      expectedSourceVersion: createReviewContentVersion(review.title, review.content),
      title: "资料检索去重唯一词",
      content: review.content,
      tags: ["AI 回顾"],
    });

    const results = await searchKnowledge("检索去重唯一词");
    expect(results.item.map((item) => item.id)).toContain(published.item.id);
    expect(results.summary.map((item) => item.id)).not.toContain(review.id);
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
    sessionCount: 2,
    sessionIds: [`session-${date}`],
    sourceReviewIds: [],
  });
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
