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
