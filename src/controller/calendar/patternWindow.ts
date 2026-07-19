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

import { RRule } from 'rrule';

import { addDaysIso } from './schema';

export interface EvaluationWindow {
  startDate: string;
  endDateExclusive: string;
}

export type PatternResult =
  | { kind: 'ok'; dates: Set<string> }
  | { kind: 'invalid'; reason: string };

const ANCHORED_GRAMMAR = /(^|;)\s*(INTERVAL|COUNT|UNTIL)=/i;
const DAY_MS = 86_400_000;

export function evaluatePattern(
  rule: string,
  patternStart: string | undefined,
  window: EvaluationWindow,
): PatternResult {
  if (patternStart === undefined && ANCHORED_GRAMMAR.test(rule)) {
    return {
      kind: 'invalid',
      reason: 'pattern uses INTERVAL/COUNT/UNTIL, which needs a pattern_start anchor date',
    };
  }

  let parsed: RRule;
  try {
    const options = RRule.parseString(rule);
    options.dtstart = utcMidnight(patternStart ?? window.startDate);
    parsed = new RRule(options);
  } catch (error) {
    return { kind: 'invalid', reason: `not a valid RRULE: ${describe(error)}` };
  }

  const firstDay = utcMidnight(window.startDate);
  const lastDay = new Date(utcMidnight(window.endDateExclusive).getTime() - DAY_MS);
  const dates = new Set<string>();
  for (const occurrence of parsed.between(firstDay, lastDay, true)) {
    dates.add(toIso(occurrence));
  }
  return { kind: 'ok', dates };
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

const REPRESENTATIVE_WINDOW_DAYS = 366;

/**
 * Validity probe backing the fail-visible contract (an invalid calendar is
 * flagged and inert, never silently wrong): null when the pattern is
 * evaluable and matches at least one day in a representative year from its
 * anchor; otherwise the reason to surface.
 */
export function validatePattern(rule: string, patternStart: string | undefined): string | null {
  const anchor = patternStart ?? '2026-01-05';
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
