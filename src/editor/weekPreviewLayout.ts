/**
 * Pure layout for the week preview: a calendar definition becomes seven day
 * columns (Mon..Sun), each marked working or not and carrying its authored hour
 * ranges — uniform working hours on the pattern's working days, or per-day hours
 * when availability blocks are present. Working days come from evaluating the
 * pattern over a representative week through the same evaluator the chart uses.
 *
 * This is the only surface that shows hours; they are authored now and honoured
 * once hour-granularity scheduling lands.
 *
 * @module editor/weekPreviewLayout
 */

import type {
  CalendarDefinition,
  ParsedCalendarNote,
  TimeRange,
} from '../controller/calendar/schema';
import { addDaysIso } from '../controller/calendar/schema';
import {
  evaluatePattern,
  validatePattern,
  type EvaluationWindow,
} from '../controller/calendar/patternWindow';

export interface DayColumn {
  /** 0 = Monday .. 6 = Sunday. */
  weekday: number;
  label: string;
  isWorking: boolean;
  hours: TimeRange[];
}

export interface WeekPreviewLayout {
  days: DayColumn[];
  /** Set when the pattern cannot evaluate — render the flag state, not columns. */
  invalid: string | undefined;
}

const LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// A fixed fallback Monday, deterministic and never derived from wall-clock time.
const WEEK_ANCHOR = '2026-01-05';
// A full leap cycle, so the first occurrence of any valid rule (incl. quadrennial
// leap-day patterns) is found when picking the representative week.
const SEARCH_DAYS = 4 * 366 + 1;

/**
 * The week layout for a parsed note: columns for a calendar, a flagged layout
 * carrying the reasons for an invalid definition, or null for a set (no working
 * pattern) — which the tab renders as the "not a calendar" message.
 */
export function weekLayoutFor(note: ParsedCalendarNote | null): WeekPreviewLayout | null {
  if (note === null || note.kind === 'calendar-set') return null;
  if (note.kind === 'invalid') return { days: [], invalid: note.reasons.join('; ') };
  return buildWeekPreview(note);
}

export function buildWeekPreview(definition: CalendarDefinition): WeekPreviewLayout {
  const invalid =
    definition.pattern !== undefined
      ? validatePattern(definition.pattern, definition.patternStart)
      : null;
  if (invalid !== null) {
    return { days: [], invalid };
  }
  // Availability blocks are fail-visible too: a bad block pattern flags the week
  // rather than silently vanishing into no availability.
  for (const block of definition.availability) {
    const blockInvalid = validatePattern(block.pattern, undefined);
    if (blockInvalid !== null) return { days: [], invalid: blockInvalid };
  }

  // A fixed week can miss a monthly or anchored-weekly recurrence entirely; anchor
  // the preview to the week that contains the pattern's first occurrence.
  const week = representativeWeek(definition);
  const perDay =
    definition.availability.length > 0
      ? availabilityHours(definition.availability, week)
      : uniformHours(definition, week);

  const days = LABELS.map((label, weekday) => ({
    weekday,
    label,
    isWorking: perDay[weekday]?.isWorking ?? false,
    hours: perDay[weekday]?.hours ?? [],
  }));
  return { days, invalid: undefined };
}

interface DayHours {
  isWorking: boolean;
  hours: TimeRange[];
}

/** Per-day hours from availability blocks — a day is working if a block covers it. */
function availabilityHours(
  blocks: ReadonlyArray<{ pattern: string; hours: TimeRange[] }>,
  week: EvaluationWindow,
): DayHours[] {
  const days: DayHours[] = LABELS.map(() => ({ isWorking: false, hours: [] }));
  for (const block of blocks) {
    for (const weekday of weekdaysMatching(block.pattern, undefined, week)) {
      const day = days[weekday];
      if (day === undefined) continue;
      day.isWorking = true;
      day.hours = [...day.hours, ...block.hours];
    }
  }
  return days;
}

/** Uniform working hours on the pattern's working days (all seven with no pattern). */
function uniformHours(definition: CalendarDefinition, week: EvaluationWindow): DayHours[] {
  const working =
    definition.pattern !== undefined
      ? weekdaysMatching(definition.pattern, definition.patternStart, week)
      : new Set([0, 1, 2, 3, 4, 5, 6]);
  return LABELS.map((_label, weekday) => {
    const isWorking = working.has(weekday);
    return { isWorking, hours: isWorking ? definition.workingHours : [] };
  });
}

/** The Monday-aligned week that contains the pattern's first occurrence. */
function representativeWeek(definition: CalendarDefinition): EvaluationWindow {
  if (definition.pattern === undefined) return weekFrom(WEEK_ANCHOR);
  const anchor = definition.patternStart ?? WEEK_ANCHOR;
  const probe = evaluatePattern(definition.pattern, definition.patternStart, {
    startDate: anchor,
    endDateExclusive: addDaysIso(anchor, SEARCH_DAYS),
  });
  const first = probe.kind === 'ok' ? earliest(probe.dates) : undefined;
  return weekFrom(first ?? WEEK_ANCHOR);
}

function weekFrom(iso: string): EvaluationWindow {
  const monday = addDaysIso(iso, -isoWeekday(iso));
  return { startDate: monday, endDateExclusive: addDaysIso(monday, 7) };
}

function earliest(dates: Set<string>): string | undefined {
  let min: string | undefined;
  for (const date of dates) if (min === undefined || date < min) min = date;
  return min;
}

/** The weekdays (0=Mon..6=Sun) a pattern matches within the representative week. */
function weekdaysMatching(
  rule: string,
  anchor: string | undefined,
  week: EvaluationWindow,
): Set<number> {
  const result = evaluatePattern(rule, anchor, week);
  const weekdays = new Set<number>();
  if (result.kind !== 'ok') return weekdays;
  for (const date of result.dates) weekdays.add(isoWeekday(date));
  return weekdays;
}

/** 0 = Monday .. 6 = Sunday for an ISO day, via a UTC-midnight instant. */
function isoWeekday(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}
