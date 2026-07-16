export function resolveMemoryPatchSelection(ids: string[], selectedId: string) {
  if (selectedId && ids.includes(selectedId)) return selectedId;
  return ids[0] ?? "";
}

export function getMemoryPatchSelectionAfterRemoval(ids: string[], removedId: string) {
  const index = ids.indexOf(removedId);
  if (index < 0) return ids[0] ?? "";
  return ids[index + 1] ?? ids[index - 1] ?? "";
}
