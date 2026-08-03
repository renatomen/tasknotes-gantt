/**
 * Occupancy-display shaping (calendar-view union): how a row's per-instance
 * whole-day occupancy renders — the envelope span that replaces a suppressed
 * plain bar, the union envelope with its synthetic plain run when occupied
 * days overflow the plain span, the whole-day runs the `BarContent` occupancy
 * branch pieces, and piece-level click routing.
 *
 * Dependency-free of Svelte/SVAR/Obsidian (mirrors the pure-module style of
 * {@link ./barTreatment}); `ganttSync` consumes it while building SVAR tasks.
 *
 * @module bases/occupancyDisplay
 */

import type { RenderInstance } from '../controller/InstanceExpansion';
import { isoToLocalDate, isoToLocalEndOfDay, localIso } from '../controller/calendar/stretch';
import type { CalendarOccupancy } from '../datasource/calendarItems';
import { PLAIN_OCCUPANCY_STATE, type OccupancyRunSpan } from '../render/segmentLayout';

export { PLAIN_OCCUPANCY_STATE };

/** How one row renders its occupancy: an envelope span (or null) plus the runs. */
export interface OccupancyDisplay {
  envelope: { start: Date; end: Date } | null;
  occupancyRuns: readonly OccupancyRunSpan[] | undefined;
}

/**
 * Resolve a row's occupancy display. While the family suppresses the plain
 * scheduled→due bar, the row's span becomes the occupancy envelope: earliest
 * occupied day 00:00 to the latest occupied day's END-of-day (a midnight end
 * draws one column short); a suppressed task with NO occupancy keeps its plain
 * bar untouched. With the family off, the plain span stays and the recorded
 * pieces overlay it — but a piece can only be placed as a fraction of its host
 * bar, so an occupied day OUTSIDE the plain span would be clipped to nothing.
 * That row switches to the UNION envelope (plain span + every occupied day)
 * and the plain bar rides along as a synthetic full-span `plain` run. The
 * plain run comes FIRST: the piece layer resolves days last-write-wins, so a
 * day claimed by an instance state keeps that state and the plain piece paints
 * only the unclaimed days.
 */
export function resolveOccupancyDisplay(
  inst: RenderInstance,
  occupancy: readonly CalendarOccupancy[],
): OccupancyDisplay {
  if (occupancy.length === 0) return { envelope: null, occupancyRuns: undefined };
  const runs = occupancy.map(toOccupancyRun);
  if (inst.plainBarSuppressed === true) {
    return { envelope: occupancyEnvelope(occupancy), occupancyRuns: runs };
  }
  if (!(inst.start instanceof Date) || !(inst.end instanceof Date)) {
    return { envelope: null, occupancyRuns: runs };
  }
  const plainStart = localIso(inst.start);
  const plainEnd = localIso(inst.end);
  const occupied = occupancyDayBounds(occupancy);
  if (occupied.first >= plainStart && occupied.last <= plainEnd) {
    return { envelope: null, occupancyRuns: runs };
  }
  const firstDay = occupied.first < plainStart ? occupied.first : plainStart;
  const lastDay = occupied.last > plainEnd ? occupied.last : plainEnd;
  return {
    envelope: { start: isoToLocalDate(firstDay), end: isoToLocalEndOfDay(lastDay) },
    occupancyRuns: [
      {
        startDate: plainStart,
        days: inclusiveDayCount(plainStart, plainEnd),
        stateClass: PLAIN_OCCUPANCY_STATE,
      },
      ...runs,
    ],
  };
}

/**
 * `true` only when occupancy renders on a TASK row (per-task occupancy is the
 * recurring family's channel); else absent. An event row's occupancy belongs
 * to its own family — flagging it would let the switcher's recurring key
 * wrongly hide external series rows.
 */
export function recurringOccupancyFlag(
  inst: RenderInstance,
  occupancy: readonly CalendarOccupancy[],
): true | undefined {
  return occupancy.length > 0 && !inst.calendarItem ? true : undefined;
}

/** Earliest and latest occupied day (local-day ISO keys order chronologically). */
function occupancyDayBounds(occupancy: readonly CalendarOccupancy[]): {
  first: string;
  last: string;
} {
  let first = occupancy[0]!.day;
  let last = first;
  for (const entry of occupancy) {
    if (entry.day < first) first = entry.day;
    if (entry.day > last) last = entry.day;
  }
  return { first, last };
}

/** The occupancy envelope: earliest occupied day 00:00 → latest day end-of-day. */
function occupancyEnvelope(occupancy: readonly CalendarOccupancy[]): { start: Date; end: Date } {
  const { first, last } = occupancyDayBounds(occupancy);
  return { start: isoToLocalDate(first), end: isoToLocalEndOfDay(last) };
}

/** Whole days from `startIso` to `endIso` inclusive (UTC math — no DST drift). */
function inclusiveDayCount(startIso: string, endIso: string): number {
  return Math.round((isoDayUtcMs(endIso) - isoDayUtcMs(startIso)) / 86_400_000) + 1;
}

function isoDayUtcMs(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day);
}

/** One occupancy fact as a whole-day run (day granularity: whole-day pieces). */
function toOccupancyRun(entry: CalendarOccupancy): OccupancyRunSpan {
  return { startDate: entry.day, days: 1, stateClass: entry.stateClass, notePath: entry.notePath };
}

/**
 * Where a click on an occupancy piece routes: a materialized piece
 * opens its backing note; every other piece — and a materialized one whose
 * note is unresolved — routes to the owning recurring task.
 */
export function resolveOccupancyActivationPath(
  piece: { stateClass?: string; notePath?: string },
  taskSourcePath: string,
): string {
  return piece.stateClass === 'materialized' && piece.notePath ? piece.notePath : taskSourcePath;
}

/** Deterministic fingerprint of a bar's occupancy runs (order-preserving). */
export function occupancyRunsKey(runs: readonly OccupancyRunSpan[] | undefined): string {
  if (!runs?.length) return '';
  return runs
    .map((run) => `${run.startDate}~${run.days}~${run.stateClass ?? ''}~${run.notePath ?? ''}`)
    .join('|');
}
