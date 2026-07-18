import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarkdownContent } from "./MarkdownContent";
import type { Item } from "../types";

describe("MarkdownContent", () => {
  it("renders CommonMark, GFM, footnotes, and legacy line breaks", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent content={[
        "# Title",
        "first line",
        "second line",
        "",
        "- [x] done",
        "- [ ] pending",
        "",
        "| A | B |",
        "| - | - |",
        "| 1 | 2 |",
        "",
        "note[^1]",
        "",
        "[^1]: detail",
      ].join("\n")} />,
    );

    expect(html).toContain("<h1>Title</h1>");
    expect(html).toMatch(/first line<br\/?>(?:\n)?second line/);
    expect(html).toContain("type=\"checkbox\"");
    expect(html).toContain("<table>");
    expect(html).toContain("data-footnotes");
  });

  it("drops raw HTML and blocks dangerous links", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent content={'<script>alert(1)</script>\n\n<img src="x" onerror="alert(2)">\n\n[bad](javascript:alert(3))'} />,
    );

    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("markdown-link-blocked");
  });

  it("keeps standard links and only renders HTTPS images", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent content={[
        "[site](https://example.com)",
        "![safe](https://images.example.com/a.png)",
        "![http](http://images.example.com/a.png)",
        "![local](file:///C:/a.png)",
      ].join("\n\n")} />,
    );

    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('src="https://images.example.com/a.png"');
    expect(html).not.toContain('src="http://images.example.com/a.png"');
    expect(html).not.toContain('src="file:///C:/a.png"');
    expect(html.match(/图片无法加载/g)).toHaveLength(2);
  });

  it("renders an accessible empty state", () => {
    expect(renderToStaticMarkup(<MarkdownContent content="  " emptyText="No content" />)).toContain("No content");
  });

  it("renders resolved, aliased, missing, unbound and self item references without external URLs", () => {
    const target: Item = {
      id: "target", title: "目标当前标题", type: "note", processStatus: "收件箱", readingStatus: "不需要",
      tags: [], content: "", aiSummary: "", createdAt: "2026-07-18", updatedAt: "2026-07-18", favorite: false,
    };
    const html = renderToStaticMarkup(
      <MarkdownContent
        content="[[item:target]] [[item:target|固定别名]] [[item:missing]] [[手写名称]]"
        currentItemId="target"
        items={[target]}
        onOpenItem={() => undefined}
      />,
    );
    expect(html).toContain("目标当前标题");
    expect(html).toContain("固定别名");
    expect(html).toContain("链接目标不存在");
    expect(html).toContain("手写名称");
    expect(html).not.toContain("item:target");
    expect(html).not.toContain("https://");
  });
});
