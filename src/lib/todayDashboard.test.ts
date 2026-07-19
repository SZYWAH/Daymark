import { describe, expect, it } from "vitest";
import { buildTodayDashboardData, withStartupTimeout } from "./todayDashboard";

describe("today dashboard", () => {
  it("derives the dashboard from already loaded records", () => {
    const data = buildTodayDashboardData(
      [{ id: "item", title: "待整理", content: "", aiSummary: "", type: "note", processStatus: "待整理", readingStatus: "不需要", tags: [], todos: [], favorite: false, createdAt: "2026-07-19", updatedAt: "2026-07-19" }],
      [{ id: "entry", content: "记录", entryDate: "2026-07-19T09:00:00", tags: [], todos: ["待办"], createdAt: "", updatedAt: "" }],
      [],
      new Date("2026-07-19T12:00:00"),
    );

    expect(data.pendingItemCount).toBe(1);
    expect(data.todayJournalEntryCount).toBe(1);
    expect(data.journalTodoCount).toBe(1);
  });

  it("rejects a startup task that never settles", async () => {
    await expect(withStartupTimeout(new Promise<never>(() => undefined), "资料", 1)).rejects.toThrow("资料 加载超时");
  });
});
