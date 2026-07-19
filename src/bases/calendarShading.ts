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
  type CalendarNoteInput,
  type CalendarRecord,
  type LinkResolver,
} from '../controller/calendar/resolveCalendars';

/** Layout base for every identity cell; shading paints on top of it. */
const CELL_BASE_RULE =
  '.og-bases-gantt .wx-gantt-holidays .og-cal-cell{position:absolute;top:0;height:100%;}';

const SHADE_DECLARATION = '{background:var(--wx-gantt-holiday-background);}';

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

/** The generated stylesheet: the layout base rule plus one grouped shade rule. */
export function buildCalendarShadingCss(shadedDates: readonly string[]): string {
  if (shadedDates.length === 0) return CELL_BASE_RULE;
  const selectors = shadedDates
    .map((date) => `.og-bases-gantt .wx-gantt-holidays .og-d-${date}`)
    .join(',');
  return `${CELL_BASE_RULE}\n${selectors}${SHADE_DECLARATION}`;
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
}

/**
 * The whole S1 shading assembly: registry over marked notes, the union of the
 * calendars the current result's tasks associate (auto-display until the
 * explicit picker lands), windowed evaluation, stylesheet. The locale-weekend
 * default stays with the classifier — it needs no dated rules.
 */
export function computeCalendarShadingCss(inputs: ShadingAssemblyInputs): string {
  const window = shadingWindow(inputs.taskSpans, inputs.marginDays);
  if (window === null) return buildCalendarShadingCss([]);

  const registry = buildCalendarRegistry(inputs.markedNotes, inputs.resolveLink);
  const displayed = new Map<string, CalendarRecord>();
  for (const association of inputs.associations) {
    const resolved = resolveTaskCalendar(
      registry,
      association.value,
      association.taskPath,
      inputs.resolveLink,
    );
    for (const record of resolved.calendars) displayed.set(record.path, record);
  }

  const definitions = [...displayed.values()].map((record) => record.definition);
  return buildCalendarShadingCss(collectShadedDates(definitions, window));
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
