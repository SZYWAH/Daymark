import type { FolderNode, Item } from "../types";
import { getFolderPath } from "./folders";
import { getDailyReviewLibraryHead, getVisibleDailyReviewLibraryItems } from "./reviewLibraryPublication";

export type ItemReferenceToken = {
  raw: string;
  start: number;
  end: number;
  kind: "bound" | "unbound";
  targetRef?: string;
  alias?: string;
  label: string;
};

export type ItemReferenceResolution = {
  token: ItemReferenceToken;
  status: "resolved" | "missing" | "self" | "unbound";
  displayText: string;
  item?: Item;
};

export type ItemReferenceCandidate = {
  item: Item;
  targetRef: string;
  folderPath: string;
  score: number;
};

const BOUND_REFERENCE = /^item:([A-Za-z0-9:_-]+)(?:\|([^\]\r\n]*))?$/;
const MAX_CONTEXT_LENGTH = 160;

export function getItemTargetRef(item: Item) {
  return item.origin?.kind === "daily-review" ? `review:${item.origin.sourceKey}` : item.id;
}

export function parseItemReferences(content: string): ItemReferenceToken[] {
  const tokens: ItemReferenceToken[] = [];
  let offset = 0;
  for (const segment of splitMarkdownReferenceSegments(content)) {
    if (!segment.skipped) {
      const pattern = /\[\[([^\]\r\n]+)\]\]/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(segment.value))) {
        const body = match[1].trim();
        const bound = BOUND_REFERENCE.exec(body);
        const start = offset + match.index;
        const raw = match[0];
        if (bound) {
          const alias = bound[2]?.trim() || undefined;
          tokens.push({ raw, start, end: start + raw.length, kind: "bound", targetRef: bound[1], alias, label: alias ?? bound[1] });
        } else {
          tokens.push({ raw, start, end: start + raw.length, kind: "unbound", label: body });
        }
      }
    }
    offset += segment.value.length;
  }
  return tokens;
}

export function resolveItemTargetRef(items: Item[], targetRef: string) {
  const normalized = targetRef.trim();
  if (!normalized) return undefined;
  if (normalized.startsWith("review:")) return getDailyReviewLibraryHead(items, normalized.slice("review:".length));
  const visibleIds = new Set(getVisibleDailyReviewLibraryItems(items).map((item) => item.id));
  return items.find((item) => item.id === normalized && visibleIds.has(item.id));
}

export function resolveItemReference(token: ItemReferenceToken, items: Item[], currentItemId?: string): ItemReferenceResolution {
  if (token.kind === "unbound" || !token.targetRef) {
    return { token, status: "unbound", displayText: token.label || "未绑定资料" };
  }
  const item = resolveItemTargetRef(items, token.targetRef);
  if (!item) return { token, status: "missing", displayText: token.alias ?? "链接目标不存在" };
  return { token, item, status: item.id === currentItemId ? "self" : "resolved", displayText: token.alias ?? item.title };
}

export function resolveItemReferences(content: string, items: Item[], currentItemId?: string) {
  return parseItemReferences(content).map((token) => resolveItemReference(token, items, currentItemId));
}

export function renderItemReferencesForMarkdown(content: string, items: Item[], currentItemId?: string) {
  const resolutions = resolveItemReferences(content, items, currentItemId);
  if (resolutions.length === 0) return content;
  let result = "";
  let cursor = 0;
  resolutions.forEach((resolution, index) => {
    result += content.slice(cursor, resolution.token.start);
    const label = escapeMarkdownLabel(resolution.displayText);
    result += `[${label}](#daymark-item-ref-${index})`;
    cursor = resolution.token.end;
  });
  return result + content.slice(cursor);
}

export function replaceItemReferencesForSearch(content: string, items: Item[]) {
  const resolutions = resolveItemReferences(content, items);
  if (resolutions.length === 0) return content;
  let result = "";
  let cursor = 0;
  resolutions.forEach((resolution) => {
    result += content.slice(cursor, resolution.token.start) + resolution.displayText;
    cursor = resolution.token.end;
  });
  return result + content.slice(cursor);
}

export function extractItemReferenceContexts(content: string, targetRef: string, items: Item[], limit = 2) {
  return resolveItemReferences(content, items)
    .filter((resolution) => resolution.token.targetRef === targetRef)
    .slice(0, Math.max(0, limit))
    .map((resolution) => {
      const previousBreak = content.lastIndexOf("\n\n", resolution.token.start - 1);
      const paragraphStart = previousBreak < 0 ? 0 : previousBreak + 2;
      const nextBreak = content.indexOf("\n\n", resolution.token.end);
      const paragraphEnd = nextBreak < 0 ? content.length : nextBreak;
      const plain = replaceItemReferencesForSearch(content.slice(paragraphStart, paragraphEnd), items)
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/^[#>*+\-\d.\s]+/gm, "").replace(/[*_~`]/g, "").replace(/\s+/g, " ").trim();
      return truncateAround(plain, resolution.displayText, MAX_CONTEXT_LENGTH);
    })
    .filter(Boolean);
}

export function getItemReferenceCandidates(items: Item[], folders: FolderNode[], query: string, currentItem?: Item, limit = 8): ItemReferenceCandidate[] {
  const normalized = query.trim().toLocaleLowerCase("zh-Hans-CN");
  return getVisibleDailyReviewLibraryItems(items)
    .filter((item) => item.id !== currentItem?.id)
    .filter((item) => !(currentItem?.origin?.kind === "daily-review" && item.origin?.kind === "daily-review" && currentItem.origin.sourceKey === item.origin.sourceKey))
    .map((item) => {
      const title = item.title.toLocaleLowerCase("zh-Hans-CN");
      const tags = item.tags.join(" ").toLocaleLowerCase("zh-Hans-CN");
      const folderPath = getFolderPath(folders, item.folderId).join(" / ") || "未归档";
      const path = folderPath.toLocaleLowerCase("zh-Hans-CN");
      const score = !normalized ? 1 : title.startsWith(normalized) ? 40 : title.includes(normalized) ? 30 : tags.includes(normalized) ? 20 : path.includes(normalized) ? 10 : 0;
      return { item, targetRef: getItemTargetRef(item), folderPath, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || right.item.updatedAt.localeCompare(left.item.updatedAt) || left.item.title.localeCompare(right.item.title, "zh-Hans-CN"))
    .slice(0, Math.max(0, limit));
}

export function insertItemReference(value: string, selectionStart: number, selectionEnd: number, targetRef: string) {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  const selected = value.slice(start, end);
  const multiline = selected.includes("\n") || selected.includes("\r");
  const safeAlias = multiline ? "" : selected.replace(/\s+/g, " ").replace(/\]\]/g, "］］").trim();
  const token = safeAlias ? `[[item:${targetRef}|${safeAlias}]]` : `[[item:${targetRef}]]`;
  const replaceEnd = multiline ? start : end;
  const next = `${value.slice(0, start)}${token}${value.slice(replaceEnd)}`;
  return { value: next, selectionStart: start + token.length, selectionEnd: start + token.length };
}

export function findOpenItemReferenceQuery(value: string, caret: number) {
  const safeCaret = Math.max(0, Math.min(caret, value.length));
  const lineStart = value.lastIndexOf("\n", safeCaret - 1) + 1;
  const prefix = value.slice(lineStart, safeCaret);
  const startInLine = prefix.lastIndexOf("[[");
  if (startInLine < 0 || prefix.slice(startInLine + 2).includes("]]")) return undefined;
  const query = prefix.slice(startInLine + 2);
  if (query.includes("\n") || query.startsWith("item:")) return undefined;
  return { start: lineStart + startInLine, end: safeCaret, query };
}

function splitMarkdownReferenceSegments(content: string) {
  const result: Array<{ value: string; skipped: boolean }> = [];
  const lines = content.match(/.*(?:\r?\n|$)/g)?.filter(Boolean) ?? [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      result.push({ value: line, skipped: true });
    } else if (inFence) {
      result.push({ value: line, skipped: true });
    } else {
      splitInlineMarkdown(line, result);
    }
  }
  return result;
}

function splitInlineMarkdown(line: string, result: Array<{ value: string; skipped: boolean }>) {
  const ranges: Array<{ start: number; end: number }> = [];
  const skippedPattern = /(`+)[\s\S]*?\1|<([A-Za-z][A-Za-z0-9-]*)\b[^>]*>[\s\S]*?<\/\2\s*>|<[^>]*>/g;
  let skippedMatch: RegExpExecArray | null;
  while ((skippedMatch = skippedPattern.exec(line))) {
    ranges.push({ start: skippedMatch.index, end: skippedMatch.index + skippedMatch[0].length });
  }
  for (let start = line.indexOf("["); start >= 0; start = line.indexOf("[", start + 1)) {
    const labelEnd = line.indexOf("](", start + 1);
    if (labelEnd < 0) continue;
    const linkEnd = line.indexOf(")", labelEnd + 2);
    if (linkEnd < 0) continue;
    ranges.push({ start: start > 0 && line[start - 1] === "!" ? start - 1 : start, end: linkEnd + 1 });
  }
  ranges.sort((left, right) => left.start - right.start || right.end - left.end);
  const merged = ranges.reduce<Array<{ start: number; end: number }>>((all, range) => {
    const previous = all[all.length - 1];
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else all.push({ ...range });
    return all;
  }, []);
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor) result.push({ value: line.slice(cursor, range.start), skipped: false });
    result.push({ value: line.slice(range.start, range.end), skipped: true });
    cursor = range.end;
  }
  if (cursor < line.length) result.push({ value: line.slice(cursor), skipped: false });
}

function escapeMarkdownLabel(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/([\[\]])/g, "\\$1").replace(/\r?\n/g, " ");
}

function truncateAround(value: string, needle: string, length: number) {
  if (value.length <= length) return value;
  const found = value.indexOf(needle);
  const center = found >= 0 ? found + Math.floor(needle.length / 2) : Math.floor(value.length / 2);
  const start = Math.max(0, Math.min(center - Math.floor(length / 2), value.length - length));
  return `${start > 0 ? "…" : ""}${value.slice(start, start + length).trim()}${start + length < value.length ? "…" : ""}`;
}
