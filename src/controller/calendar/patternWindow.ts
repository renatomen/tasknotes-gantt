/**
 * Windowed RRULE evaluation over floating local calendar days.
 * The rrule library never escapes this module. Dates cross the boundary as
 * ISO Y-M-D strings; internally everything is UTC-midnight Date instances —
 * the library defaults an omitted dtstart to wall-clock "now", which shifts
 * weekdays near midnight offsets and empties past windows, so anchorless
 * patterns always get a synthesized UTC-midnight dtstart at the window start.
 * Occurrence queries are always inclusive: between() is boundary-exclusive by
 * default and would drop a holiday on the first rendered day.
 */

import { RRule, type Options } from 'rrule';

import { addDaysIso } from './schema';

export interface EvaluationWindow {
  startDate: string;
  endDateExclusive: string;
}

export type PatternResult =
  | { kind: 'ok'; dates: Set<string> }
  | { kind: 'invalid'; reason: string };

const DAY_MS = 86_400_000;

export function evaluatePattern(
  rule: string,
  patternStart: string | undefined,
  window: EvaluationWindow,
): PatternResult {
  let options: Partial<Options>;
  try {
    options = RRule.parseString(rule);
  } catch (error) {
    return { kind: 'invalid', reason: `not a valid RRULE: ${describe(error)}` };
  }

  const unstable = rejectUnstable(options, patternStart !== undefined);
  if (unstable !== null) return { kind: 'invalid', reason: unstable };

  try {
    options.dtstart = utcMidnight(patternStart ?? window.startDate);
    // An authored DTSTART/TZID inside the rule text would re-zone every
    // occurrence off the floating convention (or throw on an unknown zone).
    options.tzid = null;
    const parsed = new RRule(options);
    const firstDay = utcMidnight(window.startDate);
    const lastDay = new Date(utcMidnight(window.endDateExclusive).getTime() - DAY_MS);
    const dates = new Set<string>();
    for (const occurrence of parsed.between(firstDay, lastDay, true)) {
      dates.add(toIso(occurrence));
    }
    return { kind: 'ok', dates };
  } catch (error) {
    return { kind: 'invalid', reason: `not a valid RRULE: ${describe(error)}` };
  }
}

/**
 * Reject rules a day-granularity calendar can't evaluate safely or
 * deterministically, before expansion:
 *  - a sub-daily FREQ (HOURLY/MINUTELY/SECONDLY) yields intra-day occurrences a
 *    day calendar can't use, and would materialize ~10^8 dates over the
 *    multi-year validity probe — a freeze;
 *  - an anchorless rule whose phase no BY-part pins (or that counts/bounds from
 *    the start via INTERVAL>1 / COUNT / UNTIL) floats with the render window:
 *    its matched days shift whenever the window moves, so it needs a
 *    pattern_start anchor.
 */
function rejectUnstable(options: Partial<Options>, hasAnchor: boolean): string | null {
  if (options.freq !== undefined && options.freq > RRule.DAILY) {
    return 'pattern uses a sub-daily frequency (HOURLY/MINUTELY/SECONDLY); a day-granularity calendar cannot use it';
  }
  if (!hasAnchor && !isPhasePinned(options)) {
    return 'pattern floats without a pattern_start anchor date (its matched days depend on the start date)';
  }
  return null;
}

/** Whether the rule's occurrence phase is fixed independent of its anchor date. */
function isPhasePinned(options: Partial<Options>): boolean {
  // Counted or bounded from the anchor (INTERVAL>1, COUNT, UNTIL) — always
  // anchor-dependent, whatever BY-parts are present.
  if ((options.interval ?? 1) > 1) return false;
  if (options.count !== undefined && options.count !== null) return false;
  if (options.until !== undefined && options.until !== null) return false;
  switch (options.freq) {
    case RRule.DAILY:
      return true;
    case RRule.WEEKLY:
      return present(options.byweekday);
    case RRule.MONTHLY:
      return present(options.bymonthday) || present(options.byweekday);
    case RRule.YEARLY:
      return (
        present(options.bymonth) ||
        present(options.bymonthday) ||
        present(options.byweekday) ||
        present(options.byyearday)
      );
    default:
      return false;
  }
}

/** A BY-part is present when it's a non-null scalar or a non-empty list. */
function present(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return !Array.isArray(value) || value.length > 0;
}

/** The window days the pattern does NOT match — the blocking non-working complement. */
export function blockingComplement(
  rule: string,
  patternStart: string | undefined,
  window: EvaluationWindow,
): PatternResult {
  const matched = evaluatePattern(rule, patternStart, window);
  if (matched.kind === 'invalid') return matched;
  const dates = new Set<string>();
  for (let day = window.startDate; day < window.endDateExclusive; day = addDaysIso(day, 1)) {
    if (!matched.dates.has(day)) dates.add(day);
  }
  return { kind: 'ok', dates };
}

// A full leap cycle, so quadrennial (leap-day) patterns are never falsely rejected.
const REPRESENTATIVE_WINDOW_DAYS = 4 * 366 + 1;
// Arbitrary fixed Monday: probes stay deterministic, never wall-clock-derived.
const FALLBACK_PROBE_ANCHOR = '2026-01-05';

/**
 * Validity probe backing the fail-visible contract (an invalid calendar is
 * flagged and inert, never silently wrong): null when the pattern is
 * evaluable and matches at least one day in a representative leap cycle from
 * its anchor; otherwise the reason to surface.
 */
export function validatePattern(rule: string, patternStart: string | undefined): string | null {
  const anchor = patternStart ?? FALLBACK_PROBE_ANCHOR;
  const result = evaluatePattern(rule, patternStart, {
    startDate: anchor,
    endDateExclusive: addDaysIso(anchor, REPRESENTATIVE_WINDOW_DAYS),
  });
  if (result.kind === 'invalid') return result.reason;
  if (result.dates.size === 0) return 'pattern matches no days';
  return null;
}

function utcMidnight(date: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day));
}

function toIso(occurrence: Date): string {
  const year = occurrence.getUTCFullYear();
  const month = String(occurrence.getUTCMonth() + 1).padStart(2, '0');
  const day = String(occurrence.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
