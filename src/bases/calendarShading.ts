/**
 * Calendar-aware background shading: assembles the vault's calendar layer into
 * the generated stylesheet that gives the chart's static per-date identity
 * classes their meaning. Pure — vault access is injected — so the whole
 * assembly unit-tests without Obsidian and the view glue stays one call.
 *
 * The stylesheet always carries the layout base rule for identity cells (they
 * render as overlay divs whose positioning otherwise comes from no rule at
 * all); shaded dates additionally paint with SVAR's own holiday theme
 * variable, so calendar shading matches the weekend look in every theme.
 */

import { addDaysIso, type CalendarDefinition, type DatedSpan } from '../controller/calendar/schema';
import {
  blockingComplement,
  evaluatePattern,
  type EvaluationWindow,
} from '../controller/calendar/patternWindow';
import {
  buildCalendarRegistry,
  resolveTaskCalendar,
  stripSubpath,
  type CalendarNoteInput,
  type CalendarRecord,
  type LinkResolver,
} from '../controller/calendar/resolveCalendars';
import { conflictDates } from './calendarConflicts';
import type { MarkerInput } from './markerOverlay';
import {
  effectiveDisplayPaths,
  type DisplaySelection,
  type ResolvedTarget,
} from './calendarSelection';

/**
 * SVAR stamps the classifier's identity classes in two places — the chart
 * body's holiday overlay cells and the scale header's own cells — so shading
 * paints in both scopes. Only the body cells are absolutely-positioned
 * overlays; header cells are normal-flow with explicit widths, so the layout
 * base rule stays body-scoped.
 */
const BODY_SCOPE = '.og-bases-gantt .wx-gantt-holidays';
const HEADER_SCOPE = '.og-bases-gantt .wx-scale';

/** Layout base for every identity cell; shading paints on top of it. */
const CELL_BASE_RULE = `${BODY_SCOPE} .og-cal-cell{position:absolute;top:0;height:100%;}`;

// !important: the weekends-off neutralization rule strips `.wx-weekend`
// backgrounds with !important, and a calendar-shaded date can fall on a
// weekend — calendar shading must survive that toggle (adding a calendar
// only ever adds shading; the legacy toggle gates only the built-in default).
const SHADE_DECLARATION = '{background:var(--wx-gantt-holiday-background)!important;}';

// Disagreement stripes: one displayed calendar blocks the day, another's
// working pattern covers it. Emitted after the shade rule so it wins at
// equal specificity.
const CONFLICT_DECLARATION =
  '{background:repeating-linear-gradient(45deg,var(--wx-gantt-holiday-background),var(--wx-gantt-holiday-background) 6px,transparent 6px,transparent 12px)!important;}';

/**
 * The evaluation window for shading: the tasks' pre-stretch span padded by a
 * margin generous enough to cover SVAR's own scale rounding. Null when there
 * is nothing to shade against (no dated tasks).
 */
export function shadingWindow(
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

/**
 * Every displayed date of the given calendars inside the window — blocking
 * spans, display-only events, the working pattern's blocking complement, and
 * recurring display events. Markers deliberately excluded (they render as
 * lines, never as column shading). Invalid patterns contribute nothing here;
 * their visibility is the resolution layer's flags.
 */
export function collectShadedDates(
  calendars: ReadonlyArray<CalendarDefinition>,
  window: EvaluationWindow,
): string[] {
  const dates = new Set<string>();
  for (const calendar of calendars) {
    for (const span of calendar.nonWorking) addSpanDates(dates, span, window);
    for (const span of calendar.events) addSpanDates(dates, span, window);
    addPatternComplement(dates, calendar, window);
    addRecurringEvents(dates, calendar, window);
  }
  return [...dates].sort((a, b) => a.localeCompare(b));
}

function addPatternComplement(
  dates: Set<string>,
  calendar: CalendarDefinition,
  window: EvaluationWindow,
): void {
  if (calendar.pattern === undefined) return;
  const complement = blockingComplement(calendar.pattern, calendar.patternStart, window);
  if (complement.kind !== 'ok') return;
  for (const date of complement.dates) dates.add(date);
}

function addRecurringEvents(
  dates: Set<string>,
  calendar: CalendarDefinition,
  window: EvaluationWindow,
): void {
  for (const recurring of calendar.recurringEvents) {
    const expanded = evaluatePattern(recurring.rrule, calendar.patternStart, window);
    if (expanded.kind !== 'ok') continue;
    for (const date of expanded.dates) dates.add(date);
  }
}

/**
 * The generated stylesheet: the layout base rule, one grouped shade rule, and
 * (after it, so it wins) one grouped conflict-stripes rule.
 */
export function buildCalendarShadingCss(
  shadedDates: readonly string[],
  conflicts: readonly string[] = [],
): string {
  const parts = [CELL_BASE_RULE];
  if (shadedDates.length > 0) {
    parts.push(`${dateSelectors(shadedDates)}${SHADE_DECLARATION}`);
  }
  if (conflicts.length > 0) {
    parts.push(`${dateSelectors(conflicts)}${CONFLICT_DECLARATION}`);
  }
  return parts.join('\n');
}

function dateSelectors(dates: readonly string[]): string {
  return dates
    .flatMap((date) => [`${BODY_SCOPE} .og-d-${date}`, `${HEADER_SCOPE} .og-d-${date}`])
    .join(',');
}

export interface ShadingAssemblyInputs {
  /** Every vault note carrying the calendar marker. */
  markedNotes: readonly CalendarNoteInput[];
  resolveLink: LinkResolver;
  /** Each task's association value (raw frontmatter) with its note path. */
  associations: ReadonlyArray<{ value: unknown; taskPath: string }>;
  /** Pre-stretch task spans driving the evaluation window. */
  taskSpans: ReadonlyArray<{ start: Date | null; end: Date | null }>;
  marginDays?: number;
  /**
   * The view's display selection; resolved here against the registry. An
   * absent/auto selection displays the association union.
   */
  displaySelection?: DisplaySelection | null;
}

/** The assembly result: the stylesheet plus the facts the banner reads. */
export interface ShadingComputation {
  css: string;
  displayedCount: number;
  conflictCount: number;
  invalidCount: number;
  /** Selected entries whose links no longer resolve. */
  flaggedCount: number;
  /** Flagged events of the displayed calendars, for the marker overlay. */
  markers: MarkerInput[];
  /** Every valid calendar/set in the vault as a bar-colour palette. */
  calendarPalette: { value: string; color: string }[];
  /** Each associated task's resolved calendar identity, by source path. */
  calendarBySource: Map<string, string>;
}

/**
 * The whole shading assembly: registry over marked notes, the displayed set
 * (the picker's explicit selection when stored, else the union of the
 * calendars the current result's tasks associate), windowed evaluation,
 * conflict classification across the displayed set, stylesheet. The
 * locale-weekend default stays with the classifier — it needs no dated rules.
 * The union is monotonic: a superset selection can only add shaded dates.
 */
export function computeCalendarShadingCss(inputs: ShadingAssemblyInputs): ShadingComputation {
  const registry = buildCalendarRegistry(inputs.markedNotes, inputs.resolveLink);
  const invalidCount = registry.invalid.size;
  const display = inputs.displaySelection
    ? effectiveDisplayPaths(inputs.displaySelection, (link) =>
        registryTarget(registry, inputs.resolveLink, link),
      )
    : null;
  const flaggedCount = display?.flagged.length ?? 0;
  const window = shadingWindow(inputs.taskSpans, inputs.marginDays);
  const calendarPalette = buildCalendarPalette(registry);
  const calendarBySource = resolveCalendarIdentities(registry, inputs);
  if (window === null) {
    return {
      css: buildCalendarShadingCss([]),
      displayedCount: 0,
      conflictCount: 0,
      invalidCount,
      flaggedCount,
      markers: [],
      calendarPalette,
      calendarBySource,
    };
  }

  const displayed = new Map<string, CalendarRecord>();
  if (display !== null) {
    for (const path of display.paths) {
      const record = registry.calendars.get(path);
      if (record) displayed.set(path, record);
    }
  } else {
    for (const association of inputs.associations) {
      const resolved = resolveTaskCalendar(
        registry,
        association.value,
        association.taskPath,
        inputs.resolveLink,
      );
      for (const record of resolved.calendars) displayed.set(record.path, record);
    }
  }

  const definitions = [...displayed.values()].map((record) => record.definition);
  const conflicts = definitions.length >= 2 ? conflictDates(definitions, window) : [];
  return {
    css: buildCalendarShadingCss(collectShadedDates(definitions, window), conflicts),
    displayedCount: displayed.size,
    conflictCount: conflicts.length,
    invalidCount,
    flaggedCount,
    markers: collectMarkers([...displayed.values()]),
    calendarPalette,
    calendarBySource,
  };
}

/**
 * Every valid calendar and set in the vault, as a colour palette. Deliberately
 * the whole vault rather than the displayed set: the bar-colour classes are
 * registered with SVAR once at mount, and re-registering would re-init its
 * store — so the registered superset must not shrink when a selection changes.
 */
function buildCalendarPalette(
  registry: ReturnType<typeof buildCalendarRegistry>,
): { value: string; color: string }[] {
  const palette: { value: string; color: string }[] = [];
  for (const record of registry.calendars.values()) {
    if (record.definition.color) palette.push({ value: record.path, color: record.definition.color });
  }
  for (const set of registry.sets.values()) {
    if (set.definition.color) palette.push({ value: set.path, color: set.definition.color });
  }
  return palette;
}

/**
 * Each associated task's calendar identity — the SET's id for a set-linked
 * task, so a set's colour wins over its members'.
 */
function resolveCalendarIdentities(
  registry: ReturnType<typeof buildCalendarRegistry>,
  inputs: ShadingAssemblyInputs,
): Map<string, string> {
  const bySource = new Map<string, string>();
  for (const association of inputs.associations) {
    const resolved = resolveTaskCalendar(
      registry,
      association.value,
      association.taskPath,
      inputs.resolveLink,
    );
    if (resolved.identity) bySource.set(association.taskPath, resolved.identity.id);
  }
  return bySource;
}

/**
 * Flagged events of the displayed calendars. Markers render as lines, never as
 * column shading, so they are collected separately from the shaded dates and
 * are not windowed — the overlay drops whatever falls outside the drawn span.
 */
function collectMarkers(records: readonly CalendarRecord[]): MarkerInput[] {
  return records.flatMap((record) =>
    record.definition.markers.map((marker) => ({
      date: marker.date,
      name: marker.name,
      calendarId: record.path,
      calendarName: record.name,
      color: record.definition.color,
    })),
  );
}

/** Resolve a selection entry's link to its calendar/set registry target. */
function registryTarget(
  registry: ReturnType<typeof buildCalendarRegistry>,
  resolveLink: LinkResolver,
  link: string,
): ResolvedTarget {
  const path = resolveLink(stripSubpath(link), '');
  if (path === null) return null;
  if (registry.calendars.has(path)) return { kind: 'calendar', path };
  const set = registry.sets.get(path);
  if (set) return { kind: 'set', path, members: set.members };
  return null;
}

/**
 * Staleness key for the shading assembly: when nothing calendar-relevant
 * changed — the watch epoch (calendar-note contents), the mapped association
 * property, the window, the associations — the whole vault walk and
 * evaluation are skipped and the cached stylesheet is reused.
 */
export function shadingCacheKey(inputs: {
  epoch: number;
  calendarProperty: string;
  window: EvaluationWindow | null;
  associations: ReadonlyArray<{ value: unknown; taskPath: string }>;
  /** Sorted displayed paths for an explicit selection; '' while auto. */
  selectionKey?: string;
}): string {
  return JSON.stringify([
    inputs.epoch,
    inputs.calendarProperty,
    inputs.window,
    inputs.associations.map((association) => [association.taskPath, association.value]),
    inputs.selectionKey ?? '',
  ]);
}

export interface ShadingCssCache {
  compute(key: string, produce: () => ShadingComputation): ShadingComputation;
}

/** Skip-if-unchanged memo for the shading assembly (one per view). */
export function createShadingCssCache(): ShadingCssCache {
  let lastKey: string | null = null;
  let lastValue: ShadingComputation | null = null;
  return {
    compute(key, produce) {
      if (key === lastKey && lastValue !== null) return lastValue;
      lastKey = key;
      lastValue = produce();
      return lastValue;
    },
  };
}

export interface TaskBlockingQuery {
  isBlocked(dayIso: string): boolean;
  /** Widest blocked run (days) across the task's calendars — ceiling headroom. */
  maxBlockedRunDays: number;
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
 * Per-task blocking lookup for working-time stretch: each calendar's BLOCKING
 * days (non-working spans plus the working pattern's complement — display
 * events never block) materialize once over the padded window; a task's query
 * unions its calendars' sets by reference. Days beyond the materialized
 * window read as working, so an extreme span degrades toward the authored
 * calendar-day placement rather than guessing. A broken or absent association
 * yields null — such tasks never stretch.
 */
export function computeTaskBlocking(
  inputs: TaskBlockingInputs,
): (taskPath: string) => TaskBlockingQuery | null {
  const window = shadingWindow(inputs.taskSpans, 62 + inputs.extraWindowDays);
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

/** Inclusive working-day count of a local span (floor 1 — a bar is never zero). */
export function countWorkingDaysInSpan(
  blocking: TaskBlockingQuery,
  start: Date,
  end: Date,
): number {
  let count = 0;
  const endIso = localIso(end);
  for (let day = localIso(start); day <= endIso; day = addDaysIso(day, 1)) {
    if (!blocking.isBlocked(day)) count += 1;
  }
  return Math.max(1, count);
}

function materializeBlocking(
  definition: CalendarDefinition,
  window: EvaluationWindow,
): { days: Set<string>; maxRun: number } {
  const days = new Set<string>();
  for (const span of definition.nonWorking) addSpanDates(days, span, window);
  addPatternComplement(days, definition, window);

  let maxRun = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of [...days].sort((a, b) => a.localeCompare(b))) {
    run = previous !== null && addDaysIso(previous, 1) === day ? run + 1 : 1;
    if (run > maxRun) maxRun = run;
    previous = day;
  }
  return { days, maxRun };
}

function addSpanDates(dates: Set<string>, span: DatedSpan, window: EvaluationWindow): void {
  const start = span.startDate > window.startDate ? span.startDate : window.startDate;
  const end =
    span.endDateExclusive < window.endDateExclusive ? span.endDateExclusive : window.endDateExclusive;
  for (let day = start; day < end; day = addDaysIso(day, 1)) {
    dates.add(day);
  }
}

function localIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
