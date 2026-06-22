/**
 * Collapse-all / expand-all helper (U7).
 *
 * Collapse state is *ephemeral session state* — the user collapses/expands with
 * the floating toggle or the row chevrons and re-adjusts as needed. It is
 * deliberately NOT persisted to per-view config (storing instance ids in the
 * view proved fragile: ids drift as the tree changes, and every toggle churned
 * the `.base` file). This module is just the pure decision for the toggle button.
 *
 * @module bases/collapseState
 */

/**
 * Decide the next collapsed-id set for a collapse-all / expand-all toggle. When
 * every collapsible (parent) id is already collapsed, expand all (empty set);
 * otherwise collapse all parents. A view with no parents can't collapse, so the
 * toggle always resolves to expand-all (empty).
 */
export function toggleCollapseAll(
  parentIds: ReadonlySet<string>,
  collapsed: ReadonlySet<string>,
): Set<string> {
  const allCollapsed = parentIds.size > 0 && [...parentIds].every((id) => collapsed.has(id));
  return allCollapsed ? new Set() : new Set(parentIds);
}
