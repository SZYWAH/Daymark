import type { Item, ReadingStatus } from "../types";

export const ATTENTION_READING_STATUSES: ReadingStatus[] = ["待阅读", "阅读中", "需复习"];

export function isAttentionItem(item: Item) {
  return (
    item.processStatus === "收件箱" ||
    item.processStatus === "待整理" ||
    !item.folderId ||
    ATTENTION_READING_STATUSES.includes(item.readingStatus)
  );
}

export function getAttentionPriority(item: Item) {
  if (item.processStatus === "收件箱" || !item.folderId) return 0;
  if (item.processStatus === "待整理") return 1;
  if (ATTENTION_READING_STATUSES.includes(item.readingStatus)) return 2;
  return 3;
}

export function getLibraryStats(items: Item[]) {
  return {
    attention: items.filter(isAttentionItem).length,
    inbox: items.filter((item) => item.processStatus === "收件箱").length,
    organizing: items.filter((item) => item.processStatus === "待整理").length,
    unfiled: items.filter((item) => !item.folderId).length,
    reading: items.filter((item) => ATTENTION_READING_STATUSES.includes(item.readingStatus)).length,
  };
}
