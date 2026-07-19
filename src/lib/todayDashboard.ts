import { getVisibleDailyReviewLibraryItems } from "./reviewLibraryPublication";
import type { Item, JournalEntry, MemoryCard, ReadingStatus, TodayDashboardData } from "../types";

export type AsyncResource<T> =
  | { status: "loading"; data?: T }
  | { status: "ready"; data: T }
  | { status: "refreshing"; data: T }
  | { status: "failed"; data?: T; message: string };

export function buildTodayDashboardData(
  items: Item[],
  journalEntries: JournalEntry[],
  memoryCards: MemoryCard[],
  now = new Date(),
): TodayDashboardData {
  const visibleItems = getVisibleDailyReviewLibraryItems(items);
  const todayKey = formatDateKey(now);
  const readingStatuses: ReadingStatus[] = ["待阅读", "阅读中", "需复习"];
  const todayJournalEntries = journalEntries.filter((entry) => entry.entryDate.slice(0, 10) === todayKey);
  const journalTodos = todayJournalEntries.flatMap((entry) =>
    entry.todos.map((todo, index) => ({
      id: `${entry.id}-${index}`,
      entryId: entry.id,
      content: todo,
      entryDate: entry.entryDate,
    })),
  );
  const pendingItems = visibleItems.filter((item) => item.processStatus === "待整理");
  const readingItems = visibleItems.filter((item) => readingStatuses.includes(item.readingStatus));
  const candidateMemories = memoryCards.filter((memory) => memory.status === "candidate");

  return {
    todayJournalEntries: todayJournalEntries.slice(0, 6),
    todayJournalEntryCount: todayJournalEntries.length,
    pendingItems: pendingItems.slice(0, 6),
    pendingItemCount: pendingItems.length,
    readingItems: readingItems.slice(0, 6),
    readingItemCount: readingItems.length,
    candidateMemories: candidateMemories.slice(0, 6),
    candidateMemoryCount: candidateMemories.length,
    journalTodos: journalTodos.slice(0, 8),
    journalTodoCount: journalTodos.length,
  };
}

export async function withStartupTimeout<T>(
  task: Promise<T>,
  label: string,
  timeoutMs = 5_000,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timeoutId = globalThis.setTimeout(() => reject(new Error(`${label} 加载超时。`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
  }
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
