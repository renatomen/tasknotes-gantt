/**
 * Day-granular date deltas shared by the Gantt drag gates.
 *
 * The Gantt compares drag endpoints at whole-day granularity: `dayDelta`
 * truncates both dates to local midnight before differencing, so a bar's
 * end-of-day (`23:59:59.999`) normalization and SVAR's day-boundary snapping
 * (`00:00`) don't read as a spurious delta. Used by {@link ./cascadeGate}
 * (move detection) and {@link ./inferredDragGate} (dragged-edge classification).
 *
 * Pure and dependency-free (no Obsidian/Svelte/SVAR).
 *
 * @module bases/dayGranularity
 */

/** Local-midnight epoch of a date (drops the time-of-day component). */
function startOfDayMs(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Whole-day delta (rounded) between two dates, ignoring time-of-day. */
export function dayDelta(before: Date, after: Date): number {
  return Math.round((startOfDayMs(after) - startOfDayMs(before)) / 86_400_000);
}
