/**
 * The span↔estimate derivation authority (pure core).
 *
 * Exactly one place derives a task's rendered span from its estimate and its
 * calendar's blocking facts — and an estimate back from a span. The read pass
 * (bar rendering) and the write path (drag commits, cascade projections) both
 * ask this module through the controller; no caller assembles blocking facts,
 * evaluation windows, day floors, or give-up flags itself. Results carry full
 * render geometry with provenance: the give-up flag is the stretch's own and
 * ghost runs come from the same call, so an echo can never disagree with the
 * bar the read pass renders from the same facts.
 *
 * @module controller/calendar/derivation
 */

import { addDaysIso, type CalendarDefinition, type DatedSpan } from './schema';
import type { EvaluationWindow } from './patternWindow';
import { workingComplement } from './workingDays';
import {
  buildCalendarRegistry,
  resolveTaskCalendar,
  type CalendarNoteInput,
  type CalendarRecord,
  type LinkResolver,
} from './resolveCalendars';
import {
  applyWorkingTimeStretch,
  computeGhostRuns,
  isSpanFullyBlocked,
  localIso,
  type GhostRun,
  type StretchDateStatus,
} from './stretch';
import { minutesToSpanDays } from '../durationConversion';
import type { EstimateMeaning, NonWorkingRendering } from '../InstanceExpansion';

/** A task's blocking query, materialized over a bounded window. */
export interface TaskBlocking {
  isBlocked(dayIso: string): boolean;
  /** Widest authored blocked run (days) — feeds the scan ceiling. */
  maxBlockedRunDays: number;
}

/**
 * The facts one task's derivation reads: its policy-resolved plain span, how
 * that span was derived, both calendar axes, and its blocking facts. Assembled
 * by the controller — never by a write-path consumer.
 */
export interface SpanDerivationFacts {
  /** Policy-resolved plain span (calendar days) the derivation starts from. */
  start: Date;
  end: Date;
  dateStatus: StretchDateStatus;
  /** The *Estimate meaning* axis: `working-days` re-projects a derived edge. */
  meaning: EstimateMeaning;
  /** The *Non-working-day rendering* axis: `split` attaches ghost runs. */
  rendering: NonWorkingRendering;
  /** Blocking facts, or null when the task has no (resolvable) calendar. */
  blocking: TaskBlocking | null;
  /** Working-day duration when no estimate supplies one (partial/placeholder bars). */
  defaultDurationDays: number;
}

/** Full render geometry with provenance — what every derivation answer carries. */
export interface DerivedGeometry {
  start: Date;
  end: Date;
  /** The stretch's own give-up signal: the scan hit its ceiling and fell back
   *  to the plain span. Surfaced as-is, never re-derived from a day count. */
  flagged: boolean;
  /** Blocked-day runs inside the final span under split rendering; empty otherwise. */
  ghostRuns: GhostRun[];
}

/** A derived estimate: the working-day count plus the span's echo geometry. */
export interface DerivedEstimate extends DerivedGeometry {
  /**
   * Inclusive working-day count of the span (floor 1 — a bar is never zero),
   * or null when the task's meaning or missing calendar leaves the plain span
   * as the record.
   */
  days: number | null;
}

/**
 * Derive the span the given facts render: a `working-days` task with a derived
 * edge re-projects over working days (hard-capped — a fully-blocked calendar
 * falls back to the plain span and flags); every other combination keeps the
 * plain span. Ghost runs cover the FINAL span whenever split rendering has a
 * calendar to contrast against.
 */
export function deriveSpan(
  facts: SpanDerivationFacts,
  estimateMinutes: number | null,
): DerivedGeometry {
  const durationDays =
    estimateMinutes != null ? minutesToSpanDays(estimateMinutes) : facts.defaultDurationDays;
  let { start, end } = facts;
  let flagged = false;
  if (facts.meaning === 'working-days' && facts.blocking) {
    const stretched = applyWorkingTimeStretch({
      start,
      end,
      dateStatus: facts.dateStatus,
      durationDays,
      isBlocked: facts.blocking.isBlocked,
      ceilingDays: 8 * Math.max(1, durationDays) + facts.blocking.maxBlockedRunDays,
    });
    if (stretched) {
      ({ start, end } = stretched);
      flagged = stretched.flagged;
    }
  }
  return { start, end, flagged, ghostRuns: ghostRunsFor(facts, start, end, flagged) };
}

/**
 * Derive the estimate a span records: the working-day count for a
 * `working-days` task with a calendar, null when the plain span is the record.
 * The result echoes the span's full render geometry so a write-side echo shows
 * exactly what the read pass would render.
 */
export function deriveEstimate(
  facts: SpanDerivationFacts,
  span: { start: Date; end: Date },
): DerivedEstimate {
  const days =
    facts.meaning === 'working-days' && facts.blocking
      ? countUnblockedDays(facts.blocking, span.start, span.end)
      : null;
  return {
    days,
    start: span.start,
    end: span.end,
    flagged: false,
    ghostRuns: ghostRunsFor(facts, span.start, span.end, false),
  };
}

/**
 * The plain calendar-day span an estimate occupies from its authored anchor —
 * the pre-derivation shape of a one-sided task at write time, mirroring the
 * date policy's duration-anchored placement.
 */
export function projectPlainSpan(
  edge: 'start' | 'end',
  anchor: Date,
  durationDays: number,
): { start: Date; end: Date; dateStatus: StretchDateStatus } {
  const inclusiveOffset = Math.max(1, durationDays) - 1;
  const far = addLocalDays(anchor, (edge === 'end' ? 1 : -1) * inclusiveOffset);
  return edge === 'end'
    ? { start: anchor, end: far, dateStatus: 'inferred-end' }
    : { start: far, end: anchor, dateStatus: 'inferred-start' };
}

/**
 * Ghost runs for the *split* rendering axis: only when a calendar is present,
 * the stretch did not give up, and the span has a working day to contrast
 * against (a fully-blocked span degrades to a continuous bar).
 */
function ghostRunsFor(
  facts: SpanDerivationFacts,
  start: Date,
  end: Date,
  flagged: boolean,
): GhostRun[] {
  if (facts.rendering !== 'split' || flagged || facts.blocking === null) return [];
  if (isSpanFullyBlocked(start, end, facts.blocking.isBlocked)) return [];
  return computeGhostRuns(start, end, facts.blocking.isBlocked);
}

/** Inclusive working-day count of a local span (floor 1 — a bar is never zero). */
function countUnblockedDays(blocking: TaskBlocking, start: Date, end: Date): number {
  let count = 0;
  const endIso = localIso(end);
  for (let dayIso = localIso(start); dayIso <= endIso; dayIso = addDaysIso(dayIso, 1)) {
    if (!blocking.isBlocked(dayIso)) count += 1;
  }
  return Math.max(1, count);
}

function addLocalDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * The evaluation window over task spans: the pre-stretch extent padded by a
 * margin. One window concept feeds both the shading stylesheet and the
 * blocking-facts assembly. Null when no span bounds it (nothing dated).
 */
export function spanEvaluationWindow(
  spans: ReadonlyArray<{ start: Date | null; end: Date | null }>,
  marginDays = 62,
): EvaluationWindow | null {
  let min: Date | null = null;
  let max: Date | null = null;
  for (const span of spans) {
    if (!(span.start instanceof Date) || !(span.end instanceof Date)) continue;
    if (Number.isNaN(span.start.getTime()) || Number.isNaN(span.end.getTime())) continue;
    if (min === null || span.start < min) min = span.start;
    if (max === null || span.end > max) max = span.end;
  }
  if (min === null || max === null) return null;
  return {
    startDate: addDaysIso(localIso(min), -marginDays),
    endDateExclusive: addDaysIso(localIso(max), marginDays + 1),
  };
}

/** Add every day of the span that falls inside the window to the set. */
export function addSpanDatesInWindow(
  dates: Set<string>,
  span: DatedSpan,
  window: EvaluationWindow,
): void {
  const start = span.startDate > window.startDate ? span.startDate : window.startDate;
  const end =
    span.endDateExclusive < window.endDateExclusive ? span.endDateExclusive : window.endDateExclusive;
  for (let dayIso = start; dayIso < end; dayIso = addDaysIso(dayIso, 1)) {
    dates.add(dayIso);
  }
}

/** Add the blocking complement of the calendar's working rules to the set. */
export function addWorkingComplementDates(
  dates: Set<string>,
  calendar: CalendarDefinition,
  window: EvaluationWindow,
): void {
  for (const date of workingComplement(calendar, window).blocked) dates.add(date);
}

export interface TaskBlockingInputs {
  markedNotes: readonly CalendarNoteInput[];
  resolveLink: LinkResolver;
  associations: ReadonlyArray<{ value: unknown; taskPath: string }>;
  taskSpans: ReadonlyArray<{ start: Date | null; end: Date | null }>;
  /** Window headroom beyond the task extent (covers the scan ceiling). */
  extraWindowDays: number;
}

/**
 * Per-task blocking lookup for working-time derivation: each calendar's
 * BLOCKING days (non-working spans plus the working pattern's complement —
 * display events never block) materialize once over the padded window; a
 * task's query unions its calendars' sets by reference. Days beyond the
 * materialized window read as working, so an extreme span degrades toward the
 * authored calendar-day placement rather than guessing. A broken or absent
 * association yields null — such tasks never stretch.
 */
export function computeTaskBlocking(
  inputs: TaskBlockingInputs,
): (taskPath: string) => TaskBlocking | null {
  const window = spanEvaluationWindow(inputs.taskSpans, 62 + inputs.extraWindowDays);
  if (window === null) return () => null;

  const registry = buildCalendarRegistry(inputs.markedNotes, inputs.resolveLink);
  const blockedByCalendar = new Map<string, { days: Set<string>; maxRun: number }>();
  const calendarsByTask = new Map<string, CalendarRecord[]>();

  for (const association of inputs.associations) {
    const resolved = resolveTaskCalendar(
      registry,
      association.value,
      association.taskPath,
      inputs.resolveLink,
    );
    if (resolved.schedulingSuspended || resolved.calendars.length === 0) continue;
    calendarsByTask.set(association.taskPath, resolved.calendars);
    for (const record of resolved.calendars) {
      if (!blockedByCalendar.has(record.path)) {
        blockedByCalendar.set(record.path, materializeBlocking(record.definition, window));
      }
    }
  }

  return (taskPath) => {
    const records = calendarsByTask.get(taskPath);
    if (!records) return null;
    const sets = records
      .map((record) => blockedByCalendar.get(record.path))
      .filter((entry): entry is { days: Set<string>; maxRun: number } => entry !== undefined);
    // Runs from different calendars can abut, so the union's widest run is
    // over-approximated by the sum — generous ceiling headroom, still bounded.
    const maxBlockedRunDays = Math.min(
      366,
      sets.reduce((total, entry) => total + entry.maxRun, 0),
    );
    return {
      isBlocked: (dayIso) => sets.some((entry) => entry.days.has(dayIso)),
      maxBlockedRunDays,
    };
  };
}

function materializeBlocking(
  definition: CalendarDefinition,
  window: EvaluationWindow,
): { days: Set<string>; maxRun: number } {
  const days = new Set<string>();
  for (const span of definition.nonWorking) addSpanDatesInWindow(days, span, window);
  addWorkingComplementDates(days, definition, window);

  let maxRun = 0;
  let run = 0;
  let previous: string | null = null;
  for (const dayIso of [...days].sort((a, b) => a.localeCompare(b))) {
    run = previous !== null && addDaysIso(previous, 1) === dayIso ? run + 1 : 1;
    if (run > maxRun) maxRun = run;
    previous = dayIso;
  }
  return { days, maxRun };
}
