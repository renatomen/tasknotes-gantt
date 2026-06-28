/**
 * Pure decision for persisting the grid/timeline divider width (plan: theme
 * css-change loop fix).
 *
 * Persisting the per-view config makes Obsidian re-run the Bases view
 * (`onDataUpdated`), which refreshes the chart, which re-asserts the divider
 * width. Writing an *unchanged* width therefore feeds a refresh loop (observed
 * on the command-palette light/dark toggle, which remounts the chart and
 * re-asserts the already-persisted width). The guard: only persist when the
 * rounded width actually differs from what's already stored.
 *
 * Kept pure (no Obsidian/DOM) so the loop-breaking decision is unit-tested in
 * isolation; `register`'s `onGridWidthChange` wraps it.
 *
 * @module bases/gridWidthPersist
 */

/** The per-view config key the divider width is persisted under. */
const TABLE_WIDTH_KEY = 'tngantt_tableWidth';

/**
 * The width to persist for a `resize-grid` commit, or `null` when the write
 * should be skipped because the value is unchanged (the loop-breaking no-op).
 *
 * @param rawWidth - the width SVAR reported (may be fractional).
 * @param currentPersisted - the currently-stored width, or `undefined` if unset.
 */
export function nextPersistableWidth(
  rawWidth: number,
  currentPersisted: number | undefined,
): number | null {
  const next = Math.round(rawWidth);
  return next === currentPersisted ? null : next;
}

/**
 * Persist the divider width through the injected `set` (the Bases `config.set`),
 * skipping unchanged values (the loop guard, see {@link nextPersistableWidth})
 * and swallowing a failing write so a transient persist error never propagates
 * out of SVAR's resize handler. Pure aside from the injected `set`, so the
 * skip/write/failure paths unit-test in isolation; `register`'s
 * `onGridWidthChange` wraps it.
 *
 * @param set - persists a per-view option value by key (the Bases `config.set`).
 * @param currentPersisted - the currently-stored width, or `undefined` if unset.
 * @param rawWidth - the width SVAR reported.
 */
export function persistGridWidth(
  set: (key: string, value: unknown) => void,
  currentPersisted: number | undefined,
  rawWidth: number,
): void {
  const next = nextPersistableWidth(rawWidth, currentPersisted);
  if (next === null) return;
  try {
    set(TABLE_WIDTH_KEY, next);
  } catch (error) {
    console.warn('[Gantt] Failed to persist grid width:', error);
  }
}
