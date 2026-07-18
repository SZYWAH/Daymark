import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarkdownContent } from "./MarkdownContent";

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
});
