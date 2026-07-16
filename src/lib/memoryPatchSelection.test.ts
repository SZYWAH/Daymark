import { describe, expect, it } from "vitest";
import { getMemoryPatchSelectionAfterRemoval, resolveMemoryPatchSelection } from "./memoryPatchSelection";

describe("memory patch selection", () => {
  it("keeps a valid selection and falls back to the first draft", () => {
    expect(resolveMemoryPatchSelection(["a", "b"], "b")).toBe("b");
    expect(resolveMemoryPatchSelection(["a", "b"], "missing")).toBe("a");
    expect(resolveMemoryPatchSelection([], "missing")).toBe("");
  });

  it("selects the next draft after removal, then the previous draft", () => {
    expect(getMemoryPatchSelectionAfterRemoval(["a", "b", "c"], "b")).toBe("c");
    expect(getMemoryPatchSelectionAfterRemoval(["a", "b"], "b")).toBe("a");
    expect(getMemoryPatchSelectionAfterRemoval(["a"], "a")).toBe("");
  });
});
