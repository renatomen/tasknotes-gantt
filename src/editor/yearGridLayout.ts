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
import { validatePattern, type EvaluationWindow } from '../controller/calendar/patternWindow';
import { blockingDays, eventDays, markerDays, type ClassifiedDays } from './calendarDayFacts';
import { buildUnionModel } from './unionPreview';

/**
 * Highest-precedence treatment a day carries:
 * conflict > marker > blocking > event > working.
 */
export type DayClass = 'working' | 'blocking' | 'event' | 'marker' | 'conflict';

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

  const window = yearWindow(year);
  return layoutFromFacts(year, {
    markers: markerDays(definition),
    blocking: blockingDays(definition, window),
    events: eventDays(definition, window),
  });
}

/**
 * The year grid for a calendar-set: the union of its resolved member calendars,
 * with the days where members disagree classified as `conflict` (the highest
 * precedence). Union blocking/events/markers classify exactly as the single
 * calendar grid does; only the conflict overlay is new. Members are already
 * filtered to valid calendars by the caller, so the union has no invalid state.
 */
export function buildYearGridUnion(
  members: readonly CalendarDefinition[],
  year: number,
): YearGridLayout {
  const union = buildUnionModel(members, yearWindow(year));
  return layoutFromFacts(year, union);
}

function yearWindow(year: number): EvaluationWindow {
  return { startDate: `${pad4(year)}-01-01`, endDateExclusive: `${pad4(year + 1)}-01-01` };
}

/** The classified day-sets a year grid colours from — the shared shape of a
 * single calendar's facts and a set's union (which adds conflicts). */
interface YearFacts {
  markers: ClassifiedDays;
  blocking: ClassifiedDays;
  events: ClassifiedDays;
  conflicts?: Set<string>;
}

function layoutFromFacts(year: number, facts: YearFacts): YearGridLayout {
  const firstDay = `${pad4(year)}-01-01`;
  const lastDay = `${pad4(year)}-12-31`;
  const start = mondayOf(firstDay);
  const end = sundayOf(lastDay);

  const cells: YearGridCell[] = [];
  let index = 0;
  for (let day = start; day <= end; day = addDaysIso(day, 1)) {
    const inYear = day >= firstDay && day <= lastDay;
    const classified = inYear
      ? classify(day, facts)
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

/**
 * The winning class AND its own entry's name — read from the same source the
 * class was chosen from, so an unnamed higher-precedence entry never inherits a
 * lower one's label. A conflict outranks every other class; it carries no name
 * of its own here (the disagreeing members are named by the caller's tooltip).
 */
function classify(
  day: string,
  facts: YearFacts,
): { dayClass: DayClass; name: string | undefined } {
  const { markers, blocking, events, conflicts } = facts;
  if (conflicts?.has(day)) return { dayClass: 'conflict', name: undefined };
  if (markers.days.has(day)) return { dayClass: 'marker', name: markers.names.get(day) };
  if (blocking.days.has(day)) return { dayClass: 'blocking', name: blocking.names.get(day) };
  if (events.days.has(day)) return { dayClass: 'event', name: events.names.get(day) };
  return { dayClass: 'working', name: undefined };
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
