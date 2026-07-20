/**
 * Pure layout for the gantt-strip preview: a zoomed-out day strip over a fixed
 * multi-month window, shading each day exactly as the live chart would. Shading
 * comes from the SHARED `collectShadedDates` classifier (U5), so the rehearsal
 * is the same code, not a lookalike; markers place linearly across the window.
 *
 * @module editor/ganttStripLayout
 */

import type {
  CalendarDefinition,
  ParsedCalendarNote,
} from '../controller/calendar/schema';
import { addDaysIso } from '../controller/calendar/schema';
import { validatePattern, type EvaluationWindow } from '../controller/calendar/patternWindow';
import { collectShadedDates } from '../bases/calendarShading';

export interface StripCell {
  date: string;
  shaded: boolean;
}

export interface StripMarker {
  date: string;
  name: string | undefined;
  /** Position across the strip, 0 (start) .. 1 (end). */
  xFraction: number;
}

export interface GanttStripLayout {
  cells: StripCell[];
  markers: StripMarker[];
  window: EvaluationWindow;
  /** Set when the pattern cannot evaluate — render the flag state, not a strip. */
  invalid: string | undefined;
}

// ~14 whole weeks — wide enough to rehearse weekly shading and a few monthly
// occurrences without scrolling.
const STRIP_DAYS = 98;
// A fixed fallback Monday, deterministic and never derived from wall-clock time.
const STRIP_ANCHOR = '2026-01-05';
const EMPTY_WINDOW: EvaluationWindow = { startDate: STRIP_ANCHOR, endDateExclusive: STRIP_ANCHOR };

/**
 * The strip layout for a parsed note: a strip for a calendar, a flagged layout
 * carrying the reasons for an invalid definition, or null for a set.
 */
export function ganttStripLayoutFor(note: ParsedCalendarNote | null): GanttStripLayout | null {
  if (note === null || note.kind === 'calendar-set') return null;
  if (note.kind === 'invalid') {
    return { cells: [], markers: [], window: EMPTY_WINDOW, invalid: note.reasons.join('; ') };
  }
  return buildGanttStrip(note);
}

export function buildGanttStrip(definition: CalendarDefinition): GanttStripLayout {
  const invalid =
    definition.pattern !== undefined
      ? validatePattern(definition.pattern, definition.patternStart)
      : null;
  if (invalid !== null) {
    return { cells: [], markers: [], window: EMPTY_WINDOW, invalid };
  }

  const window = stripWindow(definition);
  const shaded = new Set(collectShadedDates([definition], window));

  const cells: StripCell[] = [];
  for (let day = window.startDate; day < window.endDateExclusive; day = addDaysIso(day, 1)) {
    cells.push({ date: day, shaded: shaded.has(day) });
  }

  const total = cells.length;
  const markers: StripMarker[] = definition.markers
    .filter((marker) => marker.date >= window.startDate && marker.date < window.endDateExclusive)
    .map((marker) => ({
      date: marker.date,
      name: marker.name,
      xFraction: total > 0 ? dayIndex(marker.date, window.startDate) / total : 0,
    }));

  return { cells, markers, window, invalid: undefined };
}

/** A Monday-aligned multi-month window anchored at the pattern's start. */
function stripWindow(definition: CalendarDefinition): EvaluationWindow {
  const start = mondayOf(definition.patternStart ?? STRIP_ANCHOR);
  return { startDate: start, endDateExclusive: addDaysIso(start, STRIP_DAYS) };
}

/** Whole days from `start` to `date` (both ISO), assuming date >= start. */
function dayIndex(date: string, start: string): number {
  return Math.round((utcMs(date) - utcMs(start)) / 86_400_000);
}

function utcMs(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day);
}

function mondayOf(iso: string): string {
  const weekday = (new Date(utcMs(iso)).getUTCDay() + 6) % 7;
  return addDaysIso(iso, -weekday);
}
