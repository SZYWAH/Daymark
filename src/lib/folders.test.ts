import { describe, expect, it } from "vitest";

import { getFolderAggregateItemCounts } from "./folders";
import type { FolderNode } from "../types";

function folder(id: string, parentId?: string): FolderNode {
  return {
    id,
    title: id,
    kind: "folder",
    parentId,
    sortOrder: 0,
    createdAt: "2026-07-11 00:00:00",
    updatedAt: "2026-07-11 00:00:00",
  };
}

describe("getFolderAggregateItemCounts", () => {
  it("returns zero for empty folders", () => {
    expect(getFolderAggregateItemCounts([folder("root")], []).get("root")).toBe(0);
  });

  it("counts direct and deeply nested items for every ancestor", () => {
    const folders = [folder("root"), folder("product", "root"), folder("research", "product")];
    const items = [
      { folderId: "root" },
      { folderId: "product" },
      { folderId: "research" },
      { folderId: "research" },
    ];

    const counts = getFolderAggregateItemCounts(folders, items);

    expect(counts.get("root")).toBe(4);
    expect(counts.get("product")).toBe(3);
    expect(counts.get("research")).toBe(2);
  });

  it("keeps sibling branches isolated", () => {
    const folders = [folder("root"), folder("left", "root"), folder("right", "root")];
    const counts = getFolderAggregateItemCounts(folders, [
      { folderId: "left" },
      { folderId: "left" },
      { folderId: "right" },
    ]);

    expect(counts.get("root")).toBe(3);
    expect(counts.get("left")).toBe(2);
    expect(counts.get("right")).toBe(1);
  });

  it("stops safely when malformed folders contain a cycle", () => {
    const folders = [folder("a", "b"), folder("b", "a")];
    const counts = getFolderAggregateItemCounts(folders, [{ folderId: "a" }]);

    expect(counts.get("a")).toBe(1);
    expect(counts.get("b")).toBe(1);
  });
});
