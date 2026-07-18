import { describe, expect, it } from "vitest";

import {
  applyMarkdownEdit,
  extractMarkdownOutline,
  getSafeMarkdownImageUrl,
  getSafeMarkdownLinkUrl,
  stripMarkdownHeadingText,
  transformMarkdownUrl,
} from "./markdown";

describe("markdown URL policy", () => {
  it("allows standard external links and document fragments", () => {
    expect(getSafeMarkdownLinkUrl("https://example.com/path")).toBe("https://example.com/path");
    expect(getSafeMarkdownLinkUrl("http://example.com")).toBe("http://example.com");
    expect(getSafeMarkdownLinkUrl("mailto:hello@example.com")).toBe("mailto:hello@example.com");
    expect(getSafeMarkdownLinkUrl("#footnote-1")).toBe("#footnote-1");
  });

  it("blocks executable, local, data, relative, and unknown links", () => {
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,hello",
      "file:///C:/secret.txt",
      "./relative.md",
      "/absolute/path",
      "ftp://example.com/file",
    ]) {
      expect(getSafeMarkdownLinkUrl(value)).toBeNull();
    }
  });

  it("loads only absolute HTTPS images", () => {
    expect(getSafeMarkdownImageUrl("https://images.example.com/a.png")).toBe("https://images.example.com/a.png");
    expect(getSafeMarkdownImageUrl("http://images.example.com/a.png")).toBeNull();
    expect(getSafeMarkdownImageUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(getSafeMarkdownImageUrl("file:///C:/a.png")).toBeNull();
    expect(getSafeMarkdownImageUrl("./a.png")).toBeNull();
    expect(transformMarkdownUrl("https://example.com/a.png", "src")).toBe("https://example.com/a.png");
    expect(transformMarkdownUrl("mailto:hello@example.com", "href")).toBe("mailto:hello@example.com");
  });
});

describe("markdown editing", () => {
  it("wraps selected and empty text while preserving a useful selection", () => {
    expect(applyMarkdownEdit("hello", 0, 5, "bold")).toEqual({
      value: "**hello**",
      selectionStart: 2,
      selectionEnd: 7,
    });
    expect(applyMarkdownEdit("", 0, 0, "italic")).toEqual({
      value: "*斜体文字*",
      selectionStart: 1,
      selectionEnd: 5,
    });
  });

  it("prefixes every selected line for lists, quotes, and headings", () => {
    expect(applyMarkdownEdit("alpha\nbeta", 0, 10, "unordered-list").value).toBe("- alpha\n- beta");
    expect(applyMarkdownEdit("alpha\nbeta", 0, 10, "ordered-list").value).toBe("1. alpha\n2. beta");
    expect(applyMarkdownEdit("alpha", 2, 2, "quote").value).toBe("> alpha");
    expect(applyMarkdownEdit("", 0, 0, "heading").value).toBe("## 标题");
  });

  it("inserts links and fenced code without losing surrounding text", () => {
    const linked = applyMarkdownEdit("read docs now", 5, 9, "link");
    expect(linked.value).toBe("read [docs](https://) now");
    expect(linked.value.slice(linked.selectionStart, linked.selectionEnd)).toBe("https://");

    const fenced = applyMarkdownEdit("before code after", 7, 11, "code-block");
    expect(fenced.value).toBe("before \n```\ncode\n```\n after");
    expect(fenced.value.slice(fenced.selectionStart, fenced.selectionEnd)).toBe("code");
  });
});

describe("markdown outline", () => {
  it("extracts Markdown and numbered headings without decoration", () => {
    expect(extractMarkdownOutline([
      "# **Main** title",
      "## [Linked heading](https://example.com)",
      "1.2. `Numbered` section",
      "ordinary text",
    ].join("\n"))).toEqual([
      { level: 1, text: "Main title" },
      { level: 2, text: "Linked heading" },
      { level: 2, text: "Numbered section" },
    ]);
  });

  it("keeps duplicate headings in stable source order and caps output", () => {
    const content = Array.from({ length: 90 }, () => "## Same").join("\n");
    const outline = extractMarkdownOutline(content);
    expect(outline).toHaveLength(80);
    expect(outline[0]).toEqual({ level: 2, text: "Same" });
    expect(outline[79]).toEqual({ level: 2, text: "Same" });
    expect(stripMarkdownHeadingText("### ~~Title~~ ###")).toBe("Title");
  });
});
