import type { FolderNode, Item, KnowledgeLink } from "../types";

export const DEMO_LIBRARY_ROOT_ID = "daymark-demo-v1-folder-root";
export const DEMO_LIBRARY_FOLDER_IDS = [
  DEMO_LIBRARY_ROOT_ID,
  "daymark-demo-v1-folder-projects",
  "daymark-demo-v1-folder-research",
  "daymark-demo-v1-folder-reading",
  "daymark-demo-v1-folder-meetings",
] as const;
export const DEMO_LIBRARY_ITEM_IDS = [
  "daymark-demo-v1-item-inbox",
  "daymark-demo-v1-item-project",
  "daymark-demo-v1-item-plan",
  "daymark-demo-v1-item-research",
  "daymark-demo-v1-item-ai-summary",
  "daymark-demo-v1-item-reading",
  "daymark-demo-v1-item-favorite",
  "daymark-demo-v1-item-meeting",
  "daymark-demo-v1-item-decisions",
] as const;

const demoFolderIdSet = new Set<string>(DEMO_LIBRARY_FOLDER_IDS);
const demoItemIdSet = new Set<string>(DEMO_LIBRARY_ITEM_IDS);

export function isDemoLibraryItemId(id: string) {
  return demoItemIdSet.has(id);
}

export function isDemoLibraryFolderId(id: string) {
  return demoFolderIdSet.has(id);
}

export function collectRequiredDemoFolderIds(items: Item[], folders: FolderNode[]) {
  const folderById = new Map(folders.map((folder) => [folder.id, folder]));
  const required = new Set<string>();
  for (const item of items) {
    let folderId = item.folderId;
    const visited = new Set<string>();
    while (folderId && !visited.has(folderId)) {
      visited.add(folderId);
      if (isDemoLibraryFolderId(folderId)) required.add(folderId);
      folderId = folderById.get(folderId)?.parentId;
    }
  }
  return required;
}

export function filterDemoLibraryFromBackup(input: {
  items: Item[];
  folders: FolderNode[];
  links: KnowledgeLink[];
}) {
  const items = input.items.filter((item) => !isDemoLibraryItemId(item.id));
  const requiredDemoFolderIds = collectRequiredDemoFolderIds(items, input.folders);
  const folders = input.folders.filter(
    (folder) => !isDemoLibraryFolderId(folder.id) || requiredDemoFolderIds.has(folder.id),
  );
  const links = input.links.filter(
    (link) =>
      !(link.sourceKind === "item" && isDemoLibraryItemId(link.sourceId)) &&
      !(link.targetKind === "item" && isDemoLibraryItemId(link.targetId)),
  );
  return { items, folders, links };
}
