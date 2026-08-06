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

import type { CalendarDefinition } from '../controller/calendar/schema';
import { evaluatePattern, type EvaluationWindow } from '../controller/calendar/patternWindow';
import {
  addSpanDatesInWindow,
  addWorkingComplementDates,
  spanEvaluationWindow,
} from '../controller/calendar/derivation';
import {
  buildCalendarRegistry,
  resolveTaskCalendar,
  stripSubpath,
  type CalendarNoteInput,
  type CalendarRecord,
  type LinkResolver,
} from '../controller/calendar/resolveCalendars';
import { conflictDatesWithSources } from './calendarConflicts';
import type { MarkerInput } from './markerOverlay';
import {
  effectiveDisplayPaths,
  type DisplaySelection,
  type ResolvedTarget,
} from './calendarSelection';
import { GANTT_VISUAL_CLASS_TOKENS } from './visualSemantics';

// !important: the weekends-off neutralization rule strips `.wx-weekend`
// backgrounds with !important, and a calendar-shaded date can fall on a
// weekend — calendar shading must survive that toggle (adding a calendar
// only ever adds shading; the legacy toggle gates only the built-in default).
export const CALENDAR_SHADE_BACKGROUND = 'var(--wx-gantt-holiday-background)';
export const CALENDAR_CONFLICT_BACKGROUND =
  'repeating-linear-gradient(45deg,var(--wx-gantt-holiday-background),var(--wx-gantt-holiday-background) 6px,transparent 6px,transparent 12px)';

const SHADE_DECLARATION = `{background:${CALENDAR_SHADE_BACKGROUND}!important;}`;

// Disagreement stripes: one displayed calendar blocks the day, another's
// working pattern covers it. Emitted after the shade rule so it wins at
// equal specificity.
const CONFLICT_DECLARATION = `{background:${CALENDAR_CONFLICT_BACKGROUND}!important;}`;

/**
 * The evaluation window for shading — the derivation authority's span window
 * under its shading name, so the stylesheet evaluates over exactly the window
 * the blocking facts materialize in. The default margin generously covers
 * SVAR's own scale rounding.
 */
export const shadingWindow = spanEvaluationWindow;

/**
 * Every displayed date of the given calendars inside the window — blocking
 * spans, display-only events, the working rules' non-working complement, and
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
    for (const span of calendar.nonWorking) addSpanDatesInWindow(dates, span, window);
    for (const span of calendar.events) addSpanDatesInWindow(dates, span, window);
    addWorkingComplementDates(dates, calendar, window);
    addRecurringEvents(dates, calendar, window);
  }
  return [...dates].sort((a, b) => a.localeCompare(b));
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
 *
 * `scope` is the instance's unique per-view root selector: every rule is
 * anchored under it so one instance's injected sheet cannot re-shade another
 * instance's cells that share `.og-bases-gantt`. SVAR stamps the identity
 * classes in two places — the chart body's holiday overlay cells and the scale
 * header's own cells — so shading paints in both scopes; only the body cells
 * are absolutely-positioned overlays, so the layout base rule stays body-scoped.
 */
export function buildCalendarShadingCss(
  scope: string,
  shadedDates: readonly string[],
  conflicts: readonly string[] = [],
): string {
  const bodyScope = `${scope} .wx-gantt-holidays`;
  const headerScope = `${scope} .wx-scale`;
  const cellBaseRule = `${bodyScope} .${GANTT_VISUAL_CLASS_TOKENS.calendarCell}{position:absolute;top:0;height:100%;}`;
  const parts = [cellBaseRule];
  if (shadedDates.length > 0) {
    parts.push(`${dateSelectors(shadedDates, bodyScope, headerScope)}${SHADE_DECLARATION}`);
  }
  if (conflicts.length > 0) {
    parts.push(`${dateSelectors(conflicts, bodyScope, headerScope)}${CONFLICT_DECLARATION}`);
  }
  return parts.join('\n');
}

/**
 * Every note whose calendar association matters for the chart: the Base entries
 * (the matched set) plus the source of every rendered instance.
 *
 * Those differ under companion Show-all, which fetches descendants that are NOT
 * Bases entries. Leaving them out gave their bars no calendar identity, so they
 * fell back to the default role colour instead of following their calendar.
 * Entry order comes first so the association list stays stable across refreshes.
 */
export function associationTaskPaths(
  entryPaths: Iterable<string>,
  instances: ReadonlyArray<{ sourcePath?: string }>,
): string[] {
  const paths = new Set<string>(entryPaths);
  for (const instance of instances) {
    if (instance.sourcePath) paths.add(instance.sourcePath);
  }
  return [...paths];
}

/**
 * Task→calendar associations from the given task note paths (deduped): reads
 * each note's calendar value via `valueOf` and drops the ones without a value.
 * Pure — the caller supplies the frontmatter reader — so the union-and-dedup of
 * Bases entries with fetched instances is testable without the view or Obsidian.
 */
export function calendarAssociationsFrom(
  taskPaths: Iterable<string>,
  valueOf: (path: string) => unknown,
): Array<{ value: unknown; taskPath: string }> {
  const associations: Array<{ value: unknown; taskPath: string }> = [];
  for (const path of new Set(taskPaths)) {
    const value = valueOf(path);
    if (value !== undefined) associations.push({ value, taskPath: path });
  }
  return associations;
}

function dateSelectors(dates: readonly string[], bodyScope: string, headerScope: string): string {
  return dates
    .flatMap((date) => [`${bodyScope} .og-d-${date}`, `${headerScope} .og-d-${date}`])
    .join(',');
}

export interface ShadingAssemblyInputs {
  /**
   * The instance's unique per-view root selector (e.g. `.og-gantt-abc12345`);
   * every generated rule is anchored under it so the injected sheet cannot
   * re-shade another instance's cells sharing `.og-bases-gantt`.
   */
  scope: string;
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
  /** Calendars that actually contributed to the current dated chart window. */
  displayedCount: number;
  /** Calendars selected by the active display configuration, window or not. */
  selectedCount: number;
  conflictCount: number;
  /** The displayed calendars that disagree, so the banner can name them. */
  conflictCalendars: string[];
  invalidCount: number;
  /** Selected entries whose links no longer resolve. */
  flaggedCount: number;
  /** Flagged events of the displayed calendars, for the marker overlay. */
  markers: MarkerInput[];
  /** Every valid calendar/set in the vault as a bar-colour palette. */
  calendarPalette: { value: string; color: string }[];
  /** Each associated task's resolved calendar identity, by source path. */
  calendarBySource: Map<string, string>;
  /** The paths of every marked calendar note inspected — echoed for the watch seed. */
  markedNotePaths: string[];
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
  const markedNotePaths = inputs.markedNotes.map((note) => note.path);
  const display = inputs.displaySelection
    ? effectiveDisplayPaths(inputs.displaySelection, (link) =>
        registryTarget(registry, inputs.resolveLink, link),
      )
    : null;
  const flaggedCount = display?.flagged.length ?? 0;
  const window = shadingWindow(inputs.taskSpans, inputs.marginDays);
  const calendarPalette = buildCalendarPalette(registry);
  const calendarBySource = resolveCalendarIdentities(registry, inputs);
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

  const records = [...displayed.values()];
  const markers = collectMarkers(records);
  if (window === null) {
    return {
      css: buildCalendarShadingCss(inputs.scope, []),
      displayedCount: 0,
      selectedCount: displayed.size,
      conflictCount: 0,
      conflictCalendars: [],
      invalidCount,
      flaggedCount,
      markers,
      calendarPalette,
      calendarBySource,
      markedNotePaths,
    };
  }
  const definitions = records.map((record) => record.definition);
  // Attributed: the banner names the disagreeing calendars, so a user does not have
  // to open the picker and compare patterns to find which selection conflicts.
  const conflicts =
    definitions.length >= 2
      ? conflictDatesWithSources(records, window)
      : { dates: [] as string[], calendars: [] as string[] };
  return {
    css: buildCalendarShadingCss(
      inputs.scope,
      collectShadedDates(definitions, window),
      conflicts.dates,
    ),
    displayedCount: displayed.size,
    selectedCount: displayed.size,
    conflictCount: conflicts.dates.length,
    conflictCalendars: conflicts.calendars,
    invalidCount,
    flaggedCount,
    markers,
    calendarPalette,
    calendarBySource,
    markedNotePaths,
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
