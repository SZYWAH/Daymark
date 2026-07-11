import type { FolderNode, Item } from "../types";
import { ONBOARDING_COMPLETED_KEY } from "../lib/onboarding";
import {
  deleteFolder,
  deleteItem,
  getFolders,
  getItems,
  getKnowledgeLinks,
  putLibraryRecords,
} from "./itemStore";
import {
  DEMO_LIBRARY_FOLDER_IDS,
  DEMO_LIBRARY_ITEM_IDS,
  DEMO_LIBRARY_ROOT_ID,
  collectRequiredDemoFolderIds,
  isDemoLibraryFolderId,
  isDemoLibraryItemId,
} from "./demoLibraryModel";

export { DEMO_LIBRARY_FOLDER_IDS, DEMO_LIBRARY_ITEM_IDS, DEMO_LIBRARY_ROOT_ID } from "./demoLibraryModel";

export const DEMO_LIBRARY_INIT_KEY = "daymark.demo-library.v1.initialized";
const CREATED_AT = "2026-01-01 09:00:00";

type DemoStorage = Pick<Storage, "getItem" | "setItem">;

export type DemoLibraryState = {
  installed: boolean;
  itemCount: number;
  folderCount: number;
};

export type DemoLibraryInitializationResult = {
  installed: boolean;
  skipped: boolean;
  rootFolderId?: string;
};

function getLocalStorage(): DemoStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function markDemoInitializationHandled(storage: DemoStorage | null) {
  if (!storage) return;
  try {
    storage.setItem(DEMO_LIBRARY_INIT_KEY, "true");
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

function hasHandledDemoInitialization(storage: DemoStorage | null) {
  if (!storage) return false;
  try {
    return storage.getItem(DEMO_LIBRARY_INIT_KEY) === "true";
  } catch {
    return false;
  }
}

function hasCompletedOnboarding(storage: DemoStorage | null) {
  if (!storage) return false;
  try {
    return storage.getItem(ONBOARDING_COMPLETED_KEY) === "true";
  } catch {
    return false;
  }
}

export async function getDemoLibraryState(): Promise<DemoLibraryState> {
  const [items, folders] = await Promise.all([getItems(), getFolders()]);
  const itemCount = items.filter((item) => isDemoLibraryItemId(item.id)).length;
  const folderCount = folders.filter((folder) => isDemoLibraryFolderId(folder.id)).length;
  return { installed: itemCount > 0 || folderCount > 0, itemCount, folderCount };
}

export async function installDemoLibrary() {
  const { items, folders } = createDemoLibraryRecords();
  const [existingItems, existingFolders] = await Promise.all([getItems(), getFolders()]);
  const existingItemIds = new Set(existingItems.map((item) => item.id));
  const existingFolderIds = new Set(existingFolders.map((folder) => folder.id));

  await putLibraryRecords({
    items: items.filter((item) => !existingItemIds.has(item.id)),
    folders: folders.filter((folder) => !existingFolderIds.has(folder.id)),
  });
  markDemoInitializationHandled(getLocalStorage());
  return getDemoLibraryState();
}

export async function initializeDemoLibraryForFirstRun(
  storage: DemoStorage | null = getLocalStorage(),
): Promise<DemoLibraryInitializationResult> {
  if (hasHandledDemoInitialization(storage)) return { installed: false, skipped: true };

  const [items, folders] = await Promise.all([getItems(), getFolders()]);
  const shouldInstall = items.length === 0 && folders.length === 0 && !hasCompletedOnboarding(storage);
  markDemoInitializationHandled(storage);
  if (!shouldInstall) return { installed: false, skipped: true };

  await installDemoLibrary();
  return { installed: true, skipped: false, rootFolderId: DEMO_LIBRARY_ROOT_ID };
}

export async function removeDemoLibrary() {
  const [items, folders] = await Promise.all([getItems(), getFolders()]);
  const userItems = items.filter((item) => !isDemoLibraryItemId(item.id));
  const retainedFolderIds = collectRequiredDemoFolderIds(userItems, folders);

  for (const itemId of DEMO_LIBRARY_ITEM_IDS) {
    if (items.some((item) => item.id === itemId)) await deleteItem(itemId);
  }
  for (const folderId of [...DEMO_LIBRARY_FOLDER_IDS].reverse()) {
    if (!retainedFolderIds.has(folderId) && folders.some((folder) => folder.id === folderId)) {
      await deleteFolder(folderId);
    }
  }

  return getDemoLibraryState();
}

function createDemoLibraryRecords(): { items: Item[]; folders: FolderNode[] } {
  const folder = (id: string, title: string, sortOrder: number, parentId?: string): FolderNode => ({
    id,
    title,
    kind: "folder",
    parentId,
    sortOrder,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  });
  const folders = [
    folder(DEMO_LIBRARY_ROOT_ID, "Daymark 示例库", 9000),
    folder(DEMO_LIBRARY_FOLDER_IDS[1], "项目与计划", 9010, DEMO_LIBRARY_ROOT_ID),
    folder(DEMO_LIBRARY_FOLDER_IDS[2], "技术研究", 9020, DEMO_LIBRARY_ROOT_ID),
    folder(DEMO_LIBRARY_FOLDER_IDS[3], "阅读与灵感", 9030, DEMO_LIBRARY_ROOT_ID),
    folder(DEMO_LIBRARY_FOLDER_IDS[4], "会议与决策", 9040, DEMO_LIBRARY_ROOT_ID),
  ];
  const item = (
    id: string,
    title: string,
    folderId: string,
    patch: Partial<Item> = {},
  ): Item => ({
    id,
    title,
    type: "note",
    processStatus: "已整理",
    readingStatus: "不需要",
    folderId,
    tags: ["示例资料"],
    content: `# ${title}\n\n这是一条 Daymark 示例资料。你可以编辑它、移动它，或在设置中删除整套示例。`,
    aiSummary: "这条示例展示资料的目录、状态与摘要如何协同工作。",
    todos: [],
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    favorite: false,
    ...patch,
  });
  const items = [
    item(DEMO_LIBRARY_ITEM_IDS[0], "把零散想法先放进收件箱", DEMO_LIBRARY_ROOT_ID, {
      processStatus: "收件箱",
      aiSummary: "尚未整理的内容可以先进入收件箱，稍后再决定目录和状态。",
    }),
    item(DEMO_LIBRARY_ITEM_IDS[1], "新版网站项目概览", DEMO_LIBRARY_FOLDER_IDS[1], {
      type: "project",
      tags: ["示例资料", "项目"],
      aiSummary: "汇总目标、阶段、负责人和下一步，让项目上下文集中在一处。",
      todos: ["确认首版范围", "整理本周里程碑"],
    }),
    item(DEMO_LIBRARY_ITEM_IDS[2], "本周推进计划", DEMO_LIBRARY_FOLDER_IDS[1], {
      processStatus: "待整理",
      tags: ["示例资料", "计划"],
      todos: ["完成需求评审", "更新风险清单"],
    }),
    item(DEMO_LIBRARY_ITEM_IDS[3], "本地优先应用的存储方案", DEMO_LIBRARY_FOLDER_IDS[2], {
      type: "document",
      readingStatus: "需复习",
      tags: ["示例资料", "技术研究"],
      aiSummary: "比较本地数据库、文件备份和系统凭据的职责边界。",
    }),
    item(DEMO_LIBRARY_ITEM_IDS[4], "AI 摘要如何帮助资料回看", DEMO_LIBRARY_FOLDER_IDS[2], {
      type: "document",
      tags: ["示例资料", "AI 摘要"],
      aiSummary: "摘要用于快速判断资料价值，正文仍保留完整上下文。",
    }),
    item(DEMO_LIBRARY_ITEM_IDS[5], "待读：如何建立个人工作记忆", DEMO_LIBRARY_FOLDER_IDS[3], {
      type: "url",
      processStatus: "收件箱",
      readingStatus: "待阅读",
      tags: ["示例资料", "待读"],
      aiSummary: "将记录、回顾和长期记忆串成可持续的个人工作流。",
    }),
    item(DEMO_LIBRARY_ITEM_IDS[6], "灵感：安静但有层次的工具", DEMO_LIBRARY_FOLDER_IDS[3], {
      readingStatus: "已阅读",
      favorite: true,
      tags: ["示例资料", "灵感"],
      aiSummary: "功能感来自清晰层级与可发现性，而不是额外装饰。",
    }),
    item(DEMO_LIBRARY_ITEM_IDS[7], "周会纪要", DEMO_LIBRARY_FOLDER_IDS[4], {
      tags: ["示例资料", "会议"],
      aiSummary: "记录结论、责任人和截止日期，避免决策散落在聊天记录里。",
      todos: ["跟进设计稿", "确认下次评审时间"],
    }),
    item(DEMO_LIBRARY_ITEM_IDS[8], "关键决策记录", DEMO_LIBRARY_FOLDER_IDS[4], {
      type: "archive",
      processStatus: "已归档",
      tags: ["示例资料", "决策"],
      aiSummary: "保存做出决定时的背景、取舍和后续影响。",
    }),
  ];
  return { items, folders };
}
