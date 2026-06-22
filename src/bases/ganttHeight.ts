/**
 * Pure height math for the Gantt viewport (plan 003).
 *
 * SVAR has no auto-grow-to-content prop — `.wx-gantt` is `height:100%;
 * overflow-y:auto`, so the *host* must size itself. This module computes the
 * natural content height from SVAR's visible-row count and clamps it between a
 * ~2-row floor and the per-view max-height. No DOM/Obsidian/SVAR imports, so it
 * unit-tests in isolation; the view wires it to the live store (U2).
 *
 * @module bases/ganttHeight
 */

/** SVAR's default row height (`cellHeight`) in px. */
export const SVAR_CELL_HEIGHT = 38;

/** SVAR's default scale-header height (`scaleHeight`) in px. */
export const SVAR_SCALE_HEIGHT = 36;

/** Default per-view max-height (px) when `tngantt_maxHeight` is unset (R1). */
export const DEFAULT_MAX_HEIGHT = 400;

/**
 * Minimum host height (px): the scale header plus two rows (R3), so a 1–2 task
 * chart is never a sliver. Derived from SVAR's defaults: `36 + 2×38 = 112`.
 */
export const GANTT_MIN_HEIGHT = SVAR_SCALE_HEIGHT + 2 * SVAR_CELL_HEIGHT;

/**
 * Vertical space (px) reserved for the chart's horizontal scrollbar, mirroring
 * the `scrollSize` term in SVAR's own height formula
 * (`Layout.svelte`: `scrollHeight = scales.height + tasks.length×cellHeight +
 * scrollSize`). Without it, a chart sized to exactly its content would show a
 * spurious *vertical* scrollbar whenever a horizontal one is present, defeating
 * the fit. A small over-allocation when no horizontal scrollbar exists is benign
 * (and matches SVAR's behavior).
 */
export const SCROLLBAR_ALLOWANCE = 17;

/**
 * Natural content height (px) of the chart: the scale header, plus one row per
 * visible task, plus the horizontal-scrollbar allowance — SVAR's own formula
 * (see {@link SCROLLBAR_ALLOWANCE}). `rowCount` is the length of SVAR's
 * collapse-aware visible-row array (`_tasks`), so collapsed/grouped rows are
 * already excluded. Negative counts are floored at 0.
 *
 * @param rowCount - number of currently-visible rows (`_tasks.length`).
 * @param cellHeight - per-row height in px (SVAR `cellHeight`).
 * @param scaleHeight - total scale-header height in px (SVAR `_scales.height`).
 * @param scrollbarAllowance - horizontal-scrollbar reserve; defaults to {@link SCROLLBAR_ALLOWANCE}.
 */
export function computeContentHeight(
  rowCount: number,
  cellHeight: number,
  scaleHeight: number,
  scrollbarAllowance: number = SCROLLBAR_ALLOWANCE,
): number {
  const rows = Math.max(0, rowCount);
  return scaleHeight + rows * cellHeight + scrollbarAllowance;
}

/**
 * Resolve the host height (px): fit the content up to `maxHeight`, then scroll
 * (R2). The result is clamped to {@link GANTT_MIN_HEIGHT} so a tiny chart is
 * never a sliver (R3) — and the floor *wins* even when `maxHeight` is below it
 * (so a mis-set tiny max can't produce an unusable chart). When content exceeds
 * `maxHeight` the host caps at `maxHeight` and SVAR scrolls internally.
 *
 * The floor is the larger of the configured `minHeight` (per-view
 * `tngantt_minHeight`) and the absolute {@link GANTT_MIN_HEIGHT} — so the user
 * can raise the minimum (a stable, taller chart even with few rows) but never
 * lower it below the ~2-row floor that keeps a single row from clipping.
 *
 * @param rowCount - number of currently-visible rows (`_tasks.length`).
 * @param cellHeight - per-row height in px.
 * @param scaleHeight - total scale-header height in px.
 * @param maxHeight - per-view cap in px (`tngantt_maxHeight`).
 * @param minHeight - per-view floor in px (`tngantt_minHeight`); defaults to {@link GANTT_MIN_HEIGHT}.
 * @param scrollbarAllowance - horizontal-scrollbar reserve; defaults to {@link SCROLLBAR_ALLOWANCE}.
 */
export function resolveHostHeight(
  rowCount: number,
  cellHeight: number,
  scaleHeight: number,
  maxHeight: number,
  minHeight: number = GANTT_MIN_HEIGHT,
  scrollbarAllowance: number = SCROLLBAR_ALLOWANCE,
): number {
  const content = computeContentHeight(rowCount, cellHeight, scaleHeight, scrollbarAllowance);
  const floor = Math.max(GANTT_MIN_HEIGHT, minHeight);
  return Math.max(floor, Math.min(content, maxHeight));
}
