/**
 * Pure layout for the year-at-a-glance preview: a calendar definition and a
 * year become a contributions-style grid — weekday rows (Mon..Sun) by
 * Monday-aligned week columns — with every day classified exactly as the live
 * chart would shade it. The classification reuses the same windowed evaluator
 * the renderer does, so the preview is an honest rehearsal, not a lookalike.
 *
 * @module editor/yearGridLayout
 */

import type { CalendarDefinition, ParsedCalendarNote } from '../controller/calendar/schema';
import { addDaysIso } from '../controller/calendar/schema';
import {
  blockingComplement,
  evaluatePattern,
  validatePattern,
  type EvaluationWindow,
} from '../controller/calendar/patternWindow';

/** Highest-precedence treatment a day carries: marker > blocking > event > working. */
export type DayClass = 'working' | 'blocking' | 'event' | 'marker';

export interface YearGridCell {
  /** ISO `YYYY-MM-DD`. */
  date: string;
  /** 0 = Monday .. 6 = Sunday. */
  row: number;
  /** 0-based week column. */
  column: number;
  dayClass: DayClass;
  /** False for the padding days of the leading/trailing partial weeks. */
  inYear: boolean;
  /** The entry name for a classified day, for a hover label. */
  name: string | undefined;
}

export interface YearGridLayout {
  year: number;
  columns: number;
  cells: YearGridCell[];
  /** Set when the pattern cannot evaluate — render the flag state, not a grid. */
  invalid: string | undefined;
}

/**
 * The year layout for a parsed note: the grid for a calendar, an invalid-flag
 * layout for an unparseable definition (so the author sees why), or null for a
 * set — which has no working pattern and gets the "not a calendar" message.
 */
export function yearLayoutFor(note: ParsedCalendarNote | null, year: number): YearGridLayout | null {
  if (note === null || note.kind === 'calendar-set') return null;
  if (note.kind === 'invalid') {
    return { year, columns: 0, cells: [], invalid: note.reasons.join('; ') };
  }
  return buildYearGrid(note, year);
}

export function buildYearGrid(definition: CalendarDefinition, year: number): YearGridLayout {
  // A pattern that cannot evaluate flags the whole preview rather than showing a
  // stale or misleading grid.
  const invalid =
    definition.pattern !== undefined
      ? validatePattern(definition.pattern, definition.patternStart)
      : null;
  if (invalid !== null) {
    return { year, columns: 0, cells: [], invalid };
  }

  const firstDay = `${pad4(year)}-01-01`;
  const lastDay = `${pad4(year)}-12-31`;
  const window: EvaluationWindow = { startDate: firstDay, endDateExclusive: `${pad4(year + 1)}-01-01` };

  const markers = markerDays(definition);
  const blocking = blockingDays(definition, window);
  const events = eventDays(definition, window);

  const start = mondayOf(firstDay);
  const end = sundayOf(lastDay);

  const cells: YearGridCell[] = [];
  let index = 0;
  for (let day = start; day <= end; day = addDaysIso(day, 1)) {
    const inYear = day >= firstDay && day <= lastDay;
    const classified = inYear
      ? classify(day, markers, blocking, events)
      : { dayClass: 'working' as const, name: undefined };
    cells.push({
      date: day,
      row: index % 7, // start is a Monday, so the offset is the weekday directly
      column: Math.floor(index / 7),
      inYear,
      dayClass: classified.dayClass,
      name: classified.name,
    });
    index += 1;
  }
  return { year, columns: Math.ceil(index / 7), cells, invalid: undefined };
}

/** A day set with the entry name that produced each day (for hover labels). */
interface ClassifiedDays {
  days: Set<string>;
  names: Map<string, string>;
}

/**
 * The winning class AND its own entry's name — read from the same source the
 * class was chosen from, so an unnamed higher-precedence entry never inherits a
 * lower one's label.
 */
function classify(
  day: string,
  markers: ClassifiedDays,
  blocking: ClassifiedDays,
  events: ClassifiedDays,
): { dayClass: DayClass; name: string | undefined } {
  if (markers.days.has(day)) return { dayClass: 'marker', name: markers.names.get(day) };
  if (blocking.days.has(day)) return { dayClass: 'blocking', name: blocking.names.get(day) };
  if (events.days.has(day)) return { dayClass: 'event', name: events.names.get(day) };
  return { dayClass: 'working', name: undefined };
}

function markerDays(definition: CalendarDefinition): ClassifiedDays {
  const days = new Set<string>();
  const names = new Map<string, string>();
  for (const marker of definition.markers) {
    days.add(marker.date);
    if (marker.name !== undefined) names.set(marker.date, marker.name);
  }
  return { days, names };
}

/** Non-working days: the pattern's blocking complement plus explicit spans. */
function blockingDays(definition: CalendarDefinition, window: EvaluationWindow): ClassifiedDays {
  const result: ClassifiedDays = { days: new Set(), names: new Map() };
  if (definition.pattern !== undefined) {
    const complement = blockingComplement(definition.pattern, definition.patternStart, window);
    if (complement.kind === 'ok') for (const day of complement.dates) result.days.add(day);
  }
  addSpanDays(definition.nonWorking, window, result);
  return result;
}

/** Display-only days: dated event spans plus recurring-event occurrences. */
function eventDays(definition: CalendarDefinition, window: EvaluationWindow): ClassifiedDays {
  const result: ClassifiedDays = { days: new Set(), names: new Map() };
  addSpanDays(definition.events, window, result);
  for (const event of definition.recurringEvents) {
    // Anchor to the calendar's pattern_start, matching the live shading path, so
    // an anchored (INTERVAL/COUNT/UNTIL) recurrence is not silently dropped.
    const occurrences = evaluatePattern(event.rrule, definition.patternStart, window);
    if (occurrences.kind !== 'ok') continue;
    for (const day of occurrences.dates) {
      result.days.add(day);
      if (event.name !== undefined) result.names.set(day, event.name);
    }
  }
  return result;
}

function addSpanDays(
  spans: ReadonlyArray<{ startDate: string; endDateExclusive: string; name: string | undefined }>,
  window: EvaluationWindow,
  into: ClassifiedDays,
): void {
  for (const span of spans) {
    for (let day = span.startDate; day < span.endDateExclusive; day = addDaysIso(day, 1)) {
      if (day < window.startDate || day >= window.endDateExclusive) continue;
      into.days.add(day);
      if (span.name !== undefined) into.names.set(day, span.name);
    }
  }
}

function pad4(year: number): string {
  return String(year).padStart(4, '0');
}

/** 0 = Monday .. 6 = Sunday for an ISO day, via a UTC-midnight instant. */
function isoWeekday(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

function mondayOf(iso: string): string {
  return addDaysIso(iso, -isoWeekday(iso));
}

function sundayOf(iso: string): string {
  return addDaysIso(iso, 6 - isoWeekday(iso));
}
