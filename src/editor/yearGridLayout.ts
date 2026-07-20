/**
 * Pure layout for the year-at-a-glance preview: a calendar definition and a
 * year become a contributions-style grid — weekday rows (Mon..Sun) by
 * Monday-aligned week columns — with every day classified exactly as the live
 * chart would shade it. The classification reuses the same windowed evaluator
 * the renderer does, so the preview is an honest rehearsal, not a lookalike.
 *
 * @module editor/yearGridLayout
 */

import type { CalendarDefinition } from '../controller/calendar/schema';
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

  const blocking = blockingDays(definition, window);
  const events = eventDays(definition, window);
  const markers = new Set(definition.markers.map((marker) => marker.date));
  const names = dayNames(definition);

  const start = mondayOf(firstDay);
  const end = sundayOf(lastDay);

  const cells: YearGridCell[] = [];
  let index = 0;
  for (let day = start; day <= end; day = addDaysIso(day, 1)) {
    const inYear = day >= firstDay && day <= lastDay;
    cells.push({
      date: day,
      row: index % 7, // start is a Monday, so the offset is the weekday directly
      column: Math.floor(index / 7),
      inYear,
      dayClass: inYear ? classify(day, blocking, events, markers) : 'working',
      name: inYear ? names.get(day) : undefined,
    });
    index += 1;
  }
  return { year, columns: Math.ceil(index / 7), cells, invalid: undefined };
}

function classify(
  day: string,
  blocking: Set<string>,
  events: Set<string>,
  markers: Set<string>,
): DayClass {
  if (markers.has(day)) return 'marker';
  if (blocking.has(day)) return 'blocking';
  if (events.has(day)) return 'event';
  return 'working';
}

/** Non-working days: the pattern's blocking complement plus explicit spans. */
function blockingDays(definition: CalendarDefinition, window: EvaluationWindow): Set<string> {
  const days = new Set<string>();
  if (definition.pattern !== undefined) {
    const complement = blockingComplement(definition.pattern, definition.patternStart, window);
    if (complement.kind === 'ok') for (const day of complement.dates) days.add(day);
  }
  addSpanDays(definition.nonWorking, window, days);
  return days;
}

/** Display-only days: dated event spans plus recurring-event occurrences. */
function eventDays(definition: CalendarDefinition, window: EvaluationWindow): Set<string> {
  const days = new Set<string>();
  addSpanDays(definition.events, window, days);
  for (const event of definition.recurringEvents) {
    const result = evaluatePattern(event.rrule, undefined, window);
    if (result.kind === 'ok') for (const day of result.dates) days.add(day);
  }
  return days;
}

function addSpanDays(
  spans: ReadonlyArray<{ startDate: string; endDateExclusive: string }>,
  window: EvaluationWindow,
  into: Set<string>,
): void {
  for (const span of spans) {
    for (let day = span.startDate; day < span.endDateExclusive; day = addDaysIso(day, 1)) {
      if (day >= window.startDate && day < window.endDateExclusive) into.add(day);
    }
  }
}

/** Name per day, higher-precedence entries overwriting lower ones. */
function dayNames(definition: CalendarDefinition): Map<string, string> {
  const names = new Map<string, string>();
  const put = (day: string, name: string | undefined): void => {
    if (name !== undefined) names.set(day, name);
  };
  for (const span of definition.events) {
    for (let day = span.startDate; day < span.endDateExclusive; day = addDaysIso(day, 1)) put(day, span.name);
  }
  for (const span of definition.nonWorking) {
    for (let day = span.startDate; day < span.endDateExclusive; day = addDaysIso(day, 1)) put(day, span.name);
  }
  for (const marker of definition.markers) put(marker.date, marker.name);
  return names;
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
