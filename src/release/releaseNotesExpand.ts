/**
 * Pure default-expand logic for the "What's New" view, split out of
 * ReleaseNotesView so it is unit-testable without importing Obsidian.
 */

/**
 * Indices to expand by default: the current version + the first prior, with
 * degenerate fallbacks (single-entry → that one; no `isCurrent` → the first;
 * empty → none).
 */
export function defaultExpandedIndices(bundle: ReadonlyArray<{ isCurrent: boolean }>): Set<number> {
  const expanded = new Set<number>();
  if (bundle.length === 0) return expanded;
  const currentIdx = bundle.findIndex((v) => v.isCurrent);
  if (bundle.length === 1 || currentIdx === -1) {
    expanded.add(0);
  } else {
    expanded.add(currentIdx);
    if (currentIdx + 1 < bundle.length) expanded.add(currentIdx + 1);
  }
  return expanded;
}
