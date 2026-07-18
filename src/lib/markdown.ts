export type MarkdownEditAction =
  | "heading"
  | "bold"
  | "italic"
  | "unordered-list"
  | "ordered-list"
  | "quote"
  | "inline-code"
  | "code-block"
  | "link";

export type MarkdownEditResult = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

export function getSafeMarkdownLinkUrl(value?: string | null) {
  const url = value?.trim() ?? "";
  if (!url) return null;
  if (/^#[A-Za-z0-9_.:-]+$/.test(url)) return url;

  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:"
      ? url
      : null;
  } catch {
    return null;
  }
}

export function getSafeMarkdownImageUrl(value?: string | null) {
  const url = value?.trim() ?? "";
  if (!url) return null;

  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function transformMarkdownUrl(url: string, key: string) {
  return key === "src" ? getSafeMarkdownImageUrl(url) : getSafeMarkdownLinkUrl(url);
}

export function applyMarkdownEdit(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  action: MarkdownEditAction,
): MarkdownEditResult {
  const start = clampSelection(selectionStart, value.length);
  const end = Math.max(start, clampSelection(selectionEnd, value.length));

  if (action === "bold") return wrapSelection(value, start, end, "**", "**", "加粗文字");
  if (action === "italic") return wrapSelection(value, start, end, "*", "*", "斜体文字");
  if (action === "inline-code") return wrapSelection(value, start, end, "`", "`", "代码");
  if (action === "link") return insertLink(value, start, end);
  if (action === "code-block") return insertCodeBlock(value, start, end);
  if (action === "heading") return prefixSelectedLines(value, start, end, () => "## ", "标题");
  if (action === "unordered-list") return prefixSelectedLines(value, start, end, () => "- ", "列表项");
  if (action === "ordered-list") return prefixSelectedLines(value, start, end, (index) => `${index + 1}. `, "列表项");
  return prefixSelectedLines(value, start, end, () => "> ", "引用内容");
}

export function stripMarkdownHeadingText(value: string) {
  return value
    .replace(/^#{1,6}\s+/, "")
    .replace(/\s+#+\s*$/, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]/g, "")
    .replace(/\\([\\`*_[\]{}()#+.!>-])/g, "$1")
    .trim();
}

export function extractMarkdownOutline(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => {
      const markdown = /^(#{1,6})\s+(.+)$/.exec(line);
      if (markdown) {
        const text = stripMarkdownHeadingText(markdown[2]);
        return text ? { level: markdown[1].length, text } : null;
      }
      const numbered = /^(\d+(?:\.\d+)*)[、.\s]+(.{2,120})$/.exec(line);
      if (!numbered) return null;
      const text = stripMarkdownHeadingText(numbered[2]);
      return text ? { level: Math.min(numbered[1].split(".").length, 6), text } : null;
    })
    .filter((heading): heading is { level: number; text: string } => Boolean(heading))
    .slice(0, 80);
}

function wrapSelection(
  value: string,
  start: number,
  end: number,
  before: string,
  after: string,
  placeholder: string,
): MarkdownEditResult {
  const selected = value.slice(start, end);
  const content = selected || placeholder;
  const replacement = `${before}${content}${after}`;
  return {
    value: `${value.slice(0, start)}${replacement}${value.slice(end)}`,
    selectionStart: start + before.length,
    selectionEnd: start + before.length + content.length,
  };
}

function insertLink(value: string, start: number, end: number): MarkdownEditResult {
  const selected = value.slice(start, end);
  const label = selected || "链接文字";
  const url = "https://";
  const replacement = `[${label}](${url})`;
  return {
    value: `${value.slice(0, start)}${replacement}${value.slice(end)}`,
    selectionStart: selected ? start + label.length + 3 : start + 1,
    selectionEnd: selected ? start + label.length + 3 + url.length : start + 1 + label.length,
  };
}

function insertCodeBlock(value: string, start: number, end: number): MarkdownEditResult {
  const selected = value.slice(start, end) || "代码";
  const leadingBreak = start > 0 && value[start - 1] !== "\n" ? "\n" : "";
  const trailingBreak = end < value.length && value[end] !== "\n" ? "\n" : "";
  const replacement = `${leadingBreak}\`\`\`\n${selected}\n\`\`\`${trailingBreak}`;
  const contentStart = start + leadingBreak.length + 4;
  return {
    value: `${value.slice(0, start)}${replacement}${value.slice(end)}`,
    selectionStart: contentStart,
    selectionEnd: contentStart + selected.length,
  };
}

function prefixSelectedLines(
  value: string,
  start: number,
  end: number,
  prefixForIndex: (index: number) => string,
  placeholder: string,
): MarkdownEditResult {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const nextLineBreak = value.indexOf("\n", end);
  const lineEnd = nextLineBreak < 0 ? value.length : nextLineBreak;
  const selectedBlock = value.slice(lineStart, lineEnd);
  const lines = (selectedBlock || placeholder).split("\n");
  const replacement = lines.map((line, index) => `${prefixForIndex(index)}${line}`).join("\n");
  return {
    value: `${value.slice(0, lineStart)}${replacement}${value.slice(lineEnd)}`,
    selectionStart: lineStart,
    selectionEnd: lineStart + replacement.length,
  };
}

function clampSelection(value: number, length: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.trunc(value), 0), length);
}
