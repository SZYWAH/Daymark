import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { ONBOARDING_COMPLETED_KEY } from "../lib/onboarding";
import {
  DEMO_LIBRARY_FOLDER_IDS,
  DEMO_LIBRARY_INIT_KEY,
  DEMO_LIBRARY_ITEM_IDS,
  DEMO_LIBRARY_ROOT_ID,
  getDemoLibraryState,
  initializeDemoLibraryForFirstRun,
  installDemoLibrary,
  removeDemoLibrary,
} from "./demoLibrary";
import {
  createFolder,
  createItem,
  exportCoreBackup,
  getFolders,
  getItems,
  restoreCoreBackup,
} from "./itemStore";

describe("formal demo library", () => {
  beforeEach(async () => {
    await restoreCoreBackup({
      schema: "daymark.core-backup.v1",
      exportedAt: "2026-07-11T00:00:00.000Z",
      dbVersion: 11,
      payload: {
        items: [],
        folders: [],
        journalEntries: [],
        memoryDocument: null,
        memoryCards: [],
        links: [],
      },
      counts: { items: 0, folders: 0, journalEntries: 0, memoryDocument: 0, memoryCards: 0, links: 0 },
    });
  });

  it("installs nine items and five folders once for a fresh empty user", async () => {
    const storage = createStorage();
    const first = await initializeDemoLibraryForFirstRun(storage);
    const second = await initializeDemoLibraryForFirstRun(storage);

    expect(first).toMatchObject({ installed: true, rootFolderId: DEMO_LIBRARY_ROOT_ID });
    expect(second).toMatchObject({ installed: false, skipped: true });
    expect(await getDemoLibraryState()).toMatchObject({ installed: true, itemCount: 9, folderCount: 5 });
    expect(storage.getItem(DEMO_LIBRARY_INIT_KEY)).toBe("true");
  });

  it("does not auto-install for existing data or completed onboarding", async () => {
    const withData = createStorage();
    await createItem({ title: "User item" });
    expect(await initializeDemoLibraryForFirstRun(withData)).toMatchObject({ installed: false, skipped: true });
    expect((await getItems()).filter((item) => DEMO_LIBRARY_ITEM_IDS.includes(item.id as never))).toHaveLength(0);

    await restoreCoreBackup(emptyBackup());
    const completed = createStorage({ [ONBOARDING_COMPLETED_KEY]: "true" });
    expect(await initializeDemoLibraryForFirstRun(completed)).toMatchObject({ installed: false, skipped: true });
    expect(await getDemoLibraryState()).toMatchObject({ installed: false });
  });

  it("is idempotent when installed manually", async () => {
    await installDemoLibrary();
    await installDemoLibrary();
    expect((await getItems()).filter((item) => DEMO_LIBRARY_ITEM_IDS.includes(item.id as never))).toHaveLength(9);
    expect((await getFolders()).filter((folder) => DEMO_LIBRARY_FOLDER_IDS.includes(folder.id as never))).toHaveLength(5);
  });

  it("removes demo records but preserves user content and its required folder chain", async () => {
    await installDemoLibrary();
    const customFolder = await createFolder({ title: "我的资料", parentId: DEMO_LIBRARY_FOLDER_IDS[1] });
    const userItem = await createItem({ title: "Keep me", folderId: customFolder.id });

    await removeDemoLibrary();

    const items = await getItems();
    const folders = await getFolders();
    expect(items.map((item) => item.id)).toContain(userItem.id);
    expect(items.some((item) => DEMO_LIBRARY_ITEM_IDS.includes(item.id as never))).toBe(false);
    expect(folders.map((folder) => folder.id)).toEqual(expect.arrayContaining([
      customFolder.id,
      DEMO_LIBRARY_ROOT_ID,
      DEMO_LIBRARY_FOLDER_IDS[1],
    ]));
    expect(folders.map((folder) => folder.id)).not.toContain(DEMO_LIBRARY_FOLDER_IDS[2]);
  });

  it("excludes demo content from backup while retaining ancestry for user content", async () => {
    await installDemoLibrary();
    const userItem = await createItem({ title: "Real item", folderId: DEMO_LIBRARY_FOLDER_IDS[3] });

    const backup = await exportCoreBackup();

    expect(backup.payload.items.map((item) => item.id)).toEqual([userItem.id]);
    expect(backup.payload.folders.map((folder) => folder.id)).toEqual(expect.arrayContaining([
      DEMO_LIBRARY_ROOT_ID,
      DEMO_LIBRARY_FOLDER_IDS[3],
    ]));
    expect(backup.payload.folders).toHaveLength(2);
    expect(backup.counts.items).toBe(1);
    expect(backup.counts.folders).toBe(2);
  });
});

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

function emptyBackup() {
  return {
    schema: "daymark.core-backup.v1" as const,
    exportedAt: "2026-07-11T00:00:00.000Z",
    dbVersion: 11,
    payload: { items: [], folders: [], journalEntries: [], memoryDocument: null, memoryCards: [], links: [] },
    counts: { items: 0, folders: 0, journalEntries: 0, memoryDocument: 0, memoryCards: 0, links: 0 },
  };
}
