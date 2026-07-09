/**
 * The single minutes↔days conversion seam for the Time Estimate feature (U1).
 *
 * The Gantt is day-granular: every bar is normalized to whole-day boundaries by
 * {@link import('./datePolicy')}. A Time Estimate is stored in minutes, so it
 * must be converted to a whole-day duration to drive the bar, and a resized bar
 * span must be converted back to minutes to persist. This module is the ONLY
 * place that conversion lives, so the future working-time schedule (weekends,
 * holidays, working hours) replaces this one module without touching the read or
 * write paths.
 *
 * The conversion is a flat calendar-time factor: 1440 minutes (24h) = one
 * calendar day. That is lossless and intuitive (1 day = 1 day) and defers all
 * working-time semantics to the schedule that will supersede it.
 *
 * Pure and dependency-free (no Obsidian, no Svelte) so the conversion is
 * unit-testable in isolation, mirroring {@link import('./datePolicy')}.
 *
 * @module controller/durationConversion
 */

/** Minutes in one calendar day — the flat conversion factor (24h). */
export const MINUTES_PER_DAY = 1440;

/**
 * Convert an estimate in minutes to an inclusive whole-day bar duration.
 *
 * Rounds UP to the next whole day and never returns less than one, so every task
 * with a usable estimate renders at least a single-day bar (R11). A 120-minute
 * estimate → 1 day; 1440 → 1 day; 1441 → 2 days. Callers pass a validated
 * positive integer (invalid/zero estimates are coalesced to "no estimate"
 * upstream), but the `max(1, …)` guard keeps the result sane for any input.
 */
export function minutesToSpanDays(minutes: number): number {
  return Math.max(1, Math.ceil(minutes / MINUTES_PER_DAY));
}

/**
 * Convert an inclusive whole-day bar duration back to minutes (R14). The inverse
 * of {@link minutesToSpanDays} for whole-day inputs, so a resize that does not
 * change the span rewrites the same minutes value (no spurious drift).
 */
export function spanDaysToMinutes(days: number): number {
  return days * MINUTES_PER_DAY;
}

/** Normalize a date to the start of its local day (mirrors datePolicy). */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/**
 * The number of whole calendar days a bar spans, counted inclusively: a bar that
 * starts and ends on the same day is 1, `[Mon, Tue]` is 2, `[Mon, Fri]` is 5.
 * This matches the inclusive-day convention `datePolicy` uses when it resolves a
 * duration into a span (`[start, start + (D − 1)]`), so read and write conversions
 * round-trip. `Math.round` absorbs any DST hour shift in the raw millisecond
 * diff; the `max(1, …)` guard keeps an inverted range at a single day.
 */
export function inclusiveDaySpan(start: Date, end: Date): number {
  const msPerDay = 86_400_000;
  const wholeDays = Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / msPerDay);
  return Math.max(1, wholeDays + 1);
}
