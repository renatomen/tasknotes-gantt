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
 * Plugin-chosen minimum divider width (px). SVAR enforces no bounds of its own —
 * `resize-grid` is an unbounded `setState({gridWidth})` and `Resizer.svelte` only
 * carries a `rightThreshold` collapse point of 50 (a display-mode threshold, not
 * a width floor). We adopt that same 50 as the guardrail floor for a
 * user-entered/stored width so the grid can't be driven to an unusable sliver.
 */
export const MIN_TABLE_WIDTH = 50;

/**
 * Ceiling for the AUTO (unset) divider fallback (px). SVAR's Resizer clamps a
 * user drag to 50–800px, so an unset view borrowing the same ceiling can never
 * grow the pane wider than the widest width a user could drag to — a column
 * set summing past it gets the pane and an inner horizontal scroll instead of
 * a timeline pushed outside the visible area. Deliberately NOT applied to a
 * persisted value: a width the user chose (drag or text control) is honoured
 * as stored.
 */
export const MAX_AUTO_TABLE_WIDTH = 800;

/**
 * Timeline width the AUTO (unset) divider fallback must leave visible (px) —
 * the same role as {@link MIN_TABLE_WIDTH}, on the chart side. `resize-grid`
 * is unbounded: seeding the pane wider than the host minus this reserve pushes
 * the divider outside the visible area with the chart squeezed to nothing, so
 * the user can never drag it back. Only applies when the host's rendered width
 * is known; an unlaid-out host (0) keeps the columns/drag-max bound alone.
 */
export const MIN_CHART_RESERVE_WIDTH = 200;

/**
 * Resolve the effective divider width to seed at mount from the (possibly unset)
 * persisted value, falling back to the first (name) column's width when unset.
 *
 * A stored value may be a number (the drag path writes a rounded number) or a
 * numeric string (the Bases `text` control writes a string). Coerce, and if it
 * is finite and positive, clamp it up to {@link MIN_TABLE_WIDTH} and round.
 * Otherwise — blank, non-numeric, zero, or negative — return `columnsWidth`
 * bounded by {@link MAX_AUTO_TABLE_WIDTH} and, when the host's rendered width
 * is supplied, by the host minus {@link MIN_CHART_RESERVE_WIDTH} so the pane
 * can never swallow the timeline (the fallback mirrors the rendered columns'
 * combined width; it is NOT clamped to the divider minimum). Pure (no
 * Obsidian/DOM) so it unit-tests in isolation; `register`'s `getTableWidth`
 * supplies `columnsWidth` from the built grid columns
 * (`this.lastGridColumnsWidth`).
 *
 * This is the SEED read only. It must NOT be reused as the persist loop-guard's
 * `currentPersisted` (see {@link persistGridWidth} / {@link nextPersistableWidth}):
 * routing the fallback there would make an unset view look "set to the fallback"
 * and defeat the unchanged-write guard.
 *
 * @param rawPersisted - the stored `tngantt_tableWidth` value (number | string | unset).
 * @param columnsWidth - the rendered columns' combined resolved width.
 * @param availableWidth - the host's rendered width in px, or 0 when not yet laid out.
 * @param min - the guardrail floor; defaults to {@link MIN_TABLE_WIDTH}.
 */
export function resolveInitialGridWidth(
  rawPersisted: unknown,
  columnsWidth: number,
  availableWidth: number = 0,
  min: number = MIN_TABLE_WIDTH,
): number {
  const coerced = Number(rawPersisted);
  if (Number.isFinite(coerced) && coerced > 0) {
    return Math.max(min, Math.round(coerced));
  }
  const hostCap = availableWidth > 0
    ? Math.max(min, availableWidth - MIN_CHART_RESERVE_WIDTH)
    : MAX_AUTO_TABLE_WIDTH;
  return Math.min(columnsWidth, hostCap, MAX_AUTO_TABLE_WIDTH);
}

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
    // Persist as a STRING: the key is surfaced as a Bases `text` option, whose
    // input binds a string. Writing a number leaves the option unable to bind it
    // and Bases clears it to empty — so a divider drag would wipe the setting.
    // The reader (resolveInitialGridWidth) Number()-coerces, so a string round-trips.
    set(TABLE_WIDTH_KEY, String(next));
  } catch (error) {
    console.warn('[Gantt] Failed to persist grid width:', error);
  }
}
