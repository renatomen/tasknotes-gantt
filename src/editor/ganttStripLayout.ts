/**
 * Pure layout for the gantt-strip preview: a zoomed-out day strip spanning the
 * calendar's dated content, shading each day exactly as the live chart would. Shading
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
import { buildUnionModel, type ConflictSource } from './unionPreview';

export interface StripCell {
  date: string;
  shaded: boolean;
  /** Set when members disagree on this day — one blocks it while another works it. */
  conflict: boolean;
  /** For a conflict day, the disagreeing members and how each labels it. */
  conflictSources: ConflictSource[] | undefined;
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

// The strip spans the calendar's own dated content so markers and holidays are
// visible, bounded so it stays a zoomed-out rehearsal: at least ~14 weeks, at
// most ~53 weeks.
const STRIP_MIN_DAYS = 98;
const STRIP_MAX_DAYS = 371;
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
    cells.push({ date: day, shaded: shaded.has(day), conflict: false, conflictSources: undefined });
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

/**
 * The strip layout for the union of a calendar-set's members: the window spans
 * every member's dated content, each day shades when any member shades it, and a
 * cell is flagged when members disagree on that day. Union markers concatenate
 * across members, deduped by date.
 */
export function buildGanttStripUnion(
  members: readonly CalendarDefinition[],
  names?: readonly string[],
): GanttStripLayout {
  const window = unionStripWindow(members);
  const union = buildUnionModel(members, window, names);

  const cells: StripCell[] = [];
  for (let day = window.startDate; day < window.endDateExclusive; day = addDaysIso(day, 1)) {
    cells.push({
      date: day,
      shaded: union.blocking.days.has(day) || union.events.days.has(day),
      conflict: union.conflicts.has(day),
      conflictSources: union.conflictSources.get(day),
    });
  }

  const total = cells.length;
  const markers: StripMarker[] = [...union.markers.days]
    .filter((date) => date >= window.startDate && date < window.endDateExclusive)
    .sort((a, b) => a.localeCompare(b))
    .map((date) => ({
      date,
      name: union.markers.names.get(date),
      xFraction: total > 0 ? dayIndex(date, window.startDate) / total : 0,
    }));

  return { cells, markers, window, invalid: undefined };
}

/** The window spanning a single calendar's dated content. */
function stripWindow(definition: CalendarDefinition): EvaluationWindow {
  return windowSpanning(datedPoints(definition), definition.patternStart);
}

/** The union window: spans the dated content of every member. */
function unionStripWindow(members: readonly CalendarDefinition[]): EvaluationWindow {
  const points: string[] = [];
  let fallbackAnchor: string | undefined;
  for (const member of members) {
    points.push(...datedPoints(member));
    if (fallbackAnchor === undefined) fallbackAnchor = member.patternStart;
  }
  return windowSpanning(points, fallbackAnchor);
}

/**
 * A Monday-aligned window spanning `points` (clamped to whole weeks in
 * [MIN, MAX]), or a fixed window anchored on `fallbackAnchor` when there is no
 * dated content.
 */
function windowSpanning(points: string[], fallbackAnchor: string | undefined): EvaluationWindow {
  if (points.length === 0) {
    const start = mondayOf(fallbackAnchor ?? STRIP_ANCHOR);
    return { startDate: start, endDateExclusive: addDaysIso(start, STRIP_MIN_DAYS) };
  }
  // ISO dates sort chronologically, so the ends of the content span are the
  // first and last after sorting.
  const sorted = [...points].sort((a, b) => a.localeCompare(b));
  const start = mondayOf(sorted[0] as string);
  const latest = sorted[sorted.length - 1] as string;
  const days = clampToWeeks(dayIndex(latest, start) + 1);
  return { startDate: start, endDateExclusive: addDaysIso(start, days) };
}

/** Every authored dated point that should fall inside the strip, if reachable. */
function datedPoints(definition: CalendarDefinition): string[] {
  const points: string[] = [];
  for (const marker of definition.markers) points.push(marker.date);
  // Spans shade through their end, so both ends must count toward the bounds.
  for (const span of definition.events) points.push(span.startDate, lastDayOf(span));
  for (const span of definition.nonWorking) points.push(span.startDate, lastDayOf(span));
  if (definition.patternStart !== undefined) points.push(definition.patternStart);
  return points;
}

/** The last day a span covers — its endDateExclusive is the day after. */
function lastDayOf(span: { endDateExclusive: string }): string {
  return addDaysIso(span.endDateExclusive, -1);
}

/** Round up to whole weeks, clamped to [STRIP_MIN_DAYS, STRIP_MAX_DAYS]. */
function clampToWeeks(days: number): number {
  const bounded = Math.min(STRIP_MAX_DAYS, Math.max(STRIP_MIN_DAYS, days));
  return Math.ceil(bounded / 7) * 7;
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
