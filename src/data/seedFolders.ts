import type { FolderNode } from "../types";

const createdAt = "2026-07-03 12:00";

export const seedFolders: FolderNode[] = [
  {
    id: "folder-learning",
    title: "学习",
    kind: "folder",
    sortOrder: 10,
    createdAt,
    updatedAt: createdAt,
  },
  {
    id: "folder-projects",
    title: "项目",
    kind: "folder",
    sortOrder: 20,
    createdAt,
    updatedAt: createdAt,
  },
  {
    id: "folder-resources",
    title: "资源",
    kind: "folder",
    sortOrder: 30,
    createdAt,
    updatedAt: createdAt,
  },
  {
    id: "folder-documents",
    title: "文档",
    kind: "folder",
    parentId: "folder-resources",
    sortOrder: 10,
    createdAt,
    updatedAt: createdAt,
  },
  {
    id: "folder-websites",
    title: "网址",
    kind: "folder",
    parentId: "folder-resources",
    sortOrder: 20,
    createdAt,
    updatedAt: createdAt,
  },
  {
    id: "folder-archives",
    title: "压缩包",
    kind: "folder",
    parentId: "folder-resources",
    sortOrder: 30,
    createdAt,
    updatedAt: createdAt,
  },
  {
    id: "folder-images",
    title: "图片",
    kind: "folder",
    parentId: "folder-resources",
    sortOrder: 40,
    createdAt,
    updatedAt: createdAt,
  },
  {
    id: "folder-archive",
    title: "归档",
    kind: "folder",
    sortOrder: 90,
    createdAt,
    updatedAt: createdAt,
  },
];
