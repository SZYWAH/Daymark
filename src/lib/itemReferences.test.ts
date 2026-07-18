import { describe, expect, it } from "vitest";

import type { FolderNode, Item } from "../types";
import {
  extractItemReferenceContexts,
  findOpenItemReferenceQuery,
  getItemReferenceCandidates,
  getItemTargetRef,
  insertItemReference,
  parseItemReferences,
  replaceItemReferencesForSearch,
  resolveItemReferences,
} from "./itemReferences";

function item(id: string, title: string, patch: Partial<Item> = {}): Item {
  return {
    id,
    title,
    type: "note",
    processStatus: "收件箱",
    readingStatus: "不需要",
    tags: [],
    content: "",
    aiSummary: "",
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
    favorite: false,
    ...patch,
  };
}

describe("item references", () => {
  it("parses stable, aliased and unbound references with positions", () => {
    const content = "前 [[item:a]] 中 [[item:b|别名]] 后 [[手写名称]]";
    expect(parseItemReferences(content)).toEqual([
      expect.objectContaining({ targetRef: "a", alias: undefined, kind: "bound", start: 2 }),
      expect.objectContaining({ targetRef: "b", alias: "别名", kind: "bound" }),
      expect.objectContaining({ label: "手写名称", kind: "unbound" }),
    ]);
  });

  it("skips fenced code, inline code, HTML, standard links and images", () => {
    const content = [
      "[[item:ok]]",
      "`[[item:inline]]`",
      "```ts\n[[item:fence]]\n```",
      "<span>[[item:html]]</span>",
      "[外链 [[item:link]]](https://example.com)",
      "![图 [[item:image]]](https://example.com/a.png)",
    ].join("\n");
    expect(parseItemReferences(content).map((token) => token.targetRef)).toEqual(["ok"]);
  });

  it("resolves live titles, aliases, missing targets, self references and review heads", () => {
    const normal = item("a", "新的标题");
    const reviewV1 = item("r1", "旧回顾", { origin: {
      kind: "daily-review", sourceId: "s", sourceKey: "key", sourceDate: "2026-07-18", sourceLabel: "Codex",
      contentVersion: "v1", revision: 1,
    } });
    const reviewV2 = item("r2", "当前回顾", { createdAt: "2026-07-19T00:00:00.000Z", origin: {
      ...reviewV1.origin!, contentVersion: "v2", revision: 2,
    } });
    const content = "[[item:a]] [[item:a|固定]] [[item:missing]] [[item:review:key]] [[手写]]";
    const resolved = resolveItemReferences(content, [normal, reviewV1, reviewV2], "a");
    expect(resolved.map(({ status, displayText, item: target }) => [status, displayText, target?.id])).toEqual([
      ["self", "新的标题", "a"],
      ["self", "固定", "a"],
      ["missing", "链接目标不存在", undefined],
      ["resolved", "当前回顾", "r2"],
      ["unbound", "手写", undefined],
    ]);
    expect(getItemTargetRef(reviewV2)).toBe("review:key");
  });

  it("uses display titles for search and never exposes stable ids", () => {
    const content = "参考 [[item:a]] 和 [[item:a|固定称呼]]";
    const searchable = replaceItemReferencesForSearch(content, [item("a", "目标资料")]);
    expect(searchable).toBe("参考 目标资料 和 固定称呼");
    expect(searchable).not.toContain("item:a");
  });

  it("extracts at most two compact backlink contexts", () => {
    const target = item("a", "目标资料");
    const content = "第一段引用 [[item:a]] 的说明。\n\n第二段再次 [[item:a|这里]]。\n\n第三次 [[item:a]]。";
    expect(extractItemReferenceContexts(content, "a", [target])).toEqual([
      "第一段引用 目标资料 的说明。",
      "第二段再次 这里。",
    ]);
  });

  it("sorts candidates, hides history/current lineage and inserts stable syntax", () => {
    const folders: FolderNode[] = [{
      id: "folder", title: "研究", kind: "folder", sortOrder: 1,
      createdAt: "2026-07-18T00:00:00.000Z", updatedAt: "2026-07-18T00:00:00.000Z",
    }];
    const current = item("current", "当前");
    const titlePrefix = item("prefix", "资料链接指南");
    const titleContains = item("contains", "内部资料链接");
    const tagMatch = item("tag", "其他", { tags: ["资料链接"] });
    const pathMatch = item("path", "路径命中", { folderId: "folder" });
    const candidates = getItemReferenceCandidates([current, tagMatch, titleContains, titlePrefix, pathMatch], folders, "资料链接", current);
    expect(candidates.map((candidate) => candidate.item.id)).toEqual(["prefix", "contains", "tag"]);

    expect(insertItemReference("选中文字", 0, 4, "prefix")).toEqual({
      value: "[[item:prefix|选中文字]]",
      selectionStart: 20,
      selectionEnd: 20,
    });
    expect(findOpenItemReferenceQuery("正文 [[资", 6)).toEqual({ start: 3, end: 6, query: "资" });
    expect(insertItemReference("前\n后", 0, 3, "prefix").value).toBe("[[item:prefix]]前\n后");
  });
});
