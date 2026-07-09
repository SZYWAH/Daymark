import type { FolderNode } from "../types";

export type FolderOption = {
  id?: string;
  label: string;
  depth: number;
};

export function getChildFolders(folders: FolderNode[], parentId?: string) {
  return folders
    .filter((folder) => folder.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, "zh-Hans-CN"));
}

export function getFolderPath(folders: FolderNode[], folderId?: string) {
  if (!folderId) return ["未归档"];

  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: string[] = [];
  let current = byId.get(folderId);
  const seen = new Set<string>();

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current.title);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return path.length > 0 ? path : ["未归档"];
}

export function getFolderAndDescendantIds(folders: FolderNode[], folderId: string) {
  const ids = new Set<string>([folderId]);
  let changed = true;

  while (changed) {
    changed = false;
    folders.forEach((folder) => {
      if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        changed = true;
      }
    });
  }

  return Array.from(ids);
}

export function flattenFolderOptions(folders: FolderNode[]) {
  const options: FolderOption[] = [{ label: "未归档", depth: 0 }];

  function visit(parentId: string | undefined, depth: number) {
    getChildFolders(folders, parentId).forEach((folder) => {
      options.push({ id: folder.id, label: folder.title, depth });
      visit(folder.id, depth + 1);
    });
  }

  visit(undefined, 0);
  return options;
}
