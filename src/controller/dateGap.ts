/**
 * Pure ISO-8601-duration helpers for dependency gaps (lag/lead).
 *
 * TaskNotes stores a dependency's `gap` as an ISO-8601 duration string (e.g.
 * `"P1D"`, `"PT4H"`, `"P1W2DT3H"`). SVAR Gantt links accept an optional numeric
 * `lag` in the chart's duration unit (days by default). This module converts
 * the former to the latter, and is also the parse primitive the tooltip
 * formatter reuses for display.
 *
 * Dependency-free (no Obsidian/SVAR/Svelte). Mirrors the pure-helper style of
 * {@link ../bases/cascadeGate} and {@link ../bases/statusColor}.
 *
 * @module controller/dateGap
 */

/**
 * Matches an ISO-8601 duration limited to week/day/time components — the forms
 * a task gap realistically uses. A leading `-` is accepted as a lead (negative)
 * offset. Year and month components are intentionally rejected (no exact
 * day-count) and yield `null` from {@link isoDurationToDays}. The lookahead
 * requires at least one component, so a bare `"P"` does not match.
 */
const ISO_DURATION =
  /^(-)?P(?=\d|T\d)(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

/**
 * Convert an ISO-8601 duration to a (possibly fractional) number of days.
 *
 * Approximations: weeks = 7d, days = 1d, hours = 1/24d, minutes = 1/1440d,
 * seconds = 1/86400d. A leading `-` produces a negative result (lead). Returns
 * `null` for a null/empty/unparseable input or any duration carrying a year or
 * month component (not convertible to an exact day count).
 *
 * @param iso - the ISO-8601 duration, or `null`
 * @returns days as a number, or `null` when not convertible
 */
export function isoDurationToDays(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = ISO_DURATION.exec(iso.trim());
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const weeks = m[2] ? Number.parseInt(m[2], 10) : 0;
  const days = m[3] ? Number.parseInt(m[3], 10) : 0;
  const hours = m[4] ? Number.parseInt(m[4], 10) : 0;
  const minutes = m[5] ? Number.parseInt(m[5], 10) : 0;
  const seconds = m[6] ? Number.parseFloat(m[6]) : 0;
  const total = weeks * 7 + days + hours / 24 + minutes / 1440 + seconds / 86400;
  return sign * total;
}
