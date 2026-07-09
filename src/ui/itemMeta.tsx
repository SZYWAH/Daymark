import {
  Archive,
  Box,
  FileText,
  FolderKanban,
  Globe2,
  Image,
  type LucideIcon,
} from "lucide-react";
import type { ItemType, ProcessStatus, ReadingStatus } from "../types";

export const typeMeta: Record<ItemType, { label: string; icon: LucideIcon; color: string }> = {
  note: { label: "知识卡片", icon: FileText, color: "bg-lake/10 text-lake" },
  document: { label: "文档", icon: Box, color: "bg-moss/10 text-moss" },
  archive: { label: "压缩包", icon: Archive, color: "bg-copper/10 text-copper" },
  url: { label: "网站", icon: Globe2, color: "bg-lake/10 text-lake" },
  image: { label: "图片", icon: Image, color: "bg-panel text-ink/60" },
  project: { label: "项目", icon: FolderKanban, color: "bg-panel text-ink/60" },
};

export const processStatusClass: Record<ProcessStatus, string> = {
  收件箱: "border-lake/30 bg-lake/10 text-lake",
  待整理: "border-copper/35 bg-copper/10 text-copper",
  已整理: "border-moss/35 bg-moss/10 text-moss",
  已归档: "border-line bg-panel text-ink/55",
  废弃: "border-red-400/25 bg-red-500/10 text-red-300",
};

export const readingStatusClass: Record<ReadingStatus, string> = {
  不需要: "border-line bg-surface text-ink/50",
  待阅读: "border-lake/30 bg-lake/10 text-lake",
  阅读中: "border-line bg-panel text-ink/65",
  已阅读: "border-moss/35 bg-moss/10 text-moss",
  需复习: "border-copper/35 bg-copper/10 text-copper",
};
