/**
 * Ephemeral column-sort cycle (plan 2026-06-22-002, U2).
 *
 * SVAR's native header click is an infinite ascending↔descending toggle with no
 * notion of a "default order to return to" (verified against `@svar-ui/svelte-*`
 * docs/demos + the 2.7.0 store source). The ephemeral-sort feature adds a third
 * state — *cleared*, back to the Base toolbar order — so a header click cycles
 * ascending → descending → cleared. This module is the pure decision; the
 * `sort-tasks` interceptor in `GanttContainer` applies it: it lets SVAR perform
 * the sort for asc/desc, and routes the `null` (third-click) result to the
 * shared clear path that restores the Base order.
 *
 * Mirrors `collapseState.ts` (`toggleCollapseAll`) as the pure-decision-helper
 * precedent. Pure and dependency-free.
 *
 * @module bases/sortCycle
 */

/**
 * An active ephemeral column sort, or `null` when the Base toolbar sort is in
 * effect (the default). `column` is the SVAR column id (`'text'` for the name
 * column, else the Bases property id); `direction` is the sort order.
 */
export interface EphemeralSort {
  column: string;
  direction: 'asc' | 'desc';
}

/**
 * Decide the next ephemeral-sort state for a header click on `clickedColumn`,
 * given the `current` state:
 *
 * - no sort, or a *different* column → ascending on the clicked column
 * - same column, ascending → descending
 * - same column, descending → `null` (clear → restore the Base order)
 *
 * @param current - the active ephemeral sort, or `null` for the Base default
 * @param clickedColumn - the SVAR column id whose header was clicked
 * @returns the next ephemeral-sort state, or `null` to clear back to Base order
 */
export function cycleNext(
  current: EphemeralSort | null,
  clickedColumn: string,
): EphemeralSort | null {
  if (!current || current.column !== clickedColumn) {
    return { column: clickedColumn, direction: 'asc' };
  }
  if (current.direction === 'asc') {
    return { column: clickedColumn, direction: 'desc' };
  }
  return null;
}
