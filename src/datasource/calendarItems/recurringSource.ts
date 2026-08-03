/**
 * Recurring parity expansion engine: turns a recurring task's frontmatter
 * state into per-day instance occupancy matching the TaskNotes calendar
 * exactly. Parity is by construction — it reproduces the calendar's read path
 * over the same public `@tasknotes/model` expansion, quirks included (UTC-day
 * snapped window with exclusive end by date-string compare, the yearly
 * look-ahead, UTC-date-part day attribution so a DTSTART wall time stamped
 * `Z` never shifts days) — never "fixing" them, so the Gantt and calendar
 * always agree on which days a task recurs.
 *
 * Pure module: task-set access, toggles, reference resolution, and the change
 * subscription all arrive via DI. Emits occupancy attachments only — the
 * recurring family adds no flat event rows.
 *
 * @module datasource/calendarItems/recurringSource
 */

import { formatDateForStorage, getDatePart } from '@tasknotes/model/date';
import { generateRecurringInstances } from '@tasknotes/model/recurrence';
import { normalizeTaskReference } from '@tasknotes/model/operations';
import { parseLinkToPath } from '@tasknotes/model/mapping';
import type { TaskNotesTaskInfo } from '../TaskNotesSource';
import type {
  CalendarDerivationWindow,
  CalendarItemBatch,
  CalendarItemQueryContext,
  CalendarItemSource,
  CalendarOccupancy,
  LocalDay,
} from './types';
import { makeCalendarItemId } from './types';

/** Per-day state of one recurring instance (drives the per-instance piece classes). */
export type RecurringInstanceState = 'next' | 'projected' | 'completed' | 'skipped' | 'materialized';

/** The recurring-family slice of the per-view calendar-item toggles. */
export interface RecurringInstanceToggles {
  showRecurring: boolean;
  showCompletedRecurringInstances: boolean;
  showSkippedRecurringInstances: boolean;
}

/** Resolves a parent link path to a vault note path (metadataCache seam). */
export type TaskReferenceResolver = (linkPath: string, fromPath: string) => string | null;

/** Dependencies of the recurring source, injected by the controller wiring. */
export interface RecurringSourceDeps {
  /** The full TaskNotes task list (canonical, field-mapper-resolved fields). */
  listTasks(): Promise<readonly TaskNotesTaskInfo[]> | readonly TaskNotesTaskInfo[];
  /** Per-view recurring toggles, read fresh on every collect. */
  toggles(): RecurringInstanceToggles;
  /** Resolve `recurrence_parent` references; absent → normalized-reference fallback. */
  resolveTaskReference?: TaskReferenceResolver;
  /** Change-event seam ({@link import('../TaskNotesSource').TaskNotesSource.subscribe} shape) driving the epoch. */
  subscribe?(handler: (eventName: string, payload?: unknown) => void): () => void;
}

/** The recurring source; `dispose` releases the change-event subscription. */
export interface RecurringInstanceSource extends CalendarItemSource {
  dispose(): void;
}

/** Everything one parity expansion derives against. */
export interface RecurringExpansionInput {
  tasks: readonly TaskNotesTaskInfo[];
  window: CalendarDerivationWindow;
  toggles: RecurringInstanceToggles;
  resolveTaskReference?: TaskReferenceResolver;
}

/**
 * Calendar quirk, reproduced verbatim: yearly rules expand over a fixed
 * ~2.2-year look-ahead from the window start (instead of the window end), so
 * short windows still find an occurrence — and windows longer than the
 * look-ahead miss the ones beyond it, exactly as the calendar does.
 */
const YEARLY_LOOKAHEAD_DAYS = 800;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_OCCUPANCY_DAYS_PER_SERIES = 1_000;

const NO_MATERIALIZED: ReadonlyMap<LocalDay, string> = new Map();

function utcDayStart(day: LocalDay): Date {
  return new Date(`${day}T00:00:00Z`);
}

/** A scheduled/occurrence value's local day (`yyyy-MM-dd`), or `''`. */
function toLocalDay(value: Date | string | null | undefined): string {
  if (value === null || value === undefined) return '';
  return value instanceof Date ? formatDateForStorage(value) : getDatePart(value);
}

function stringList(values: readonly string[] | null | undefined): readonly string[] {
  return Array.isArray(values) ? values.filter((v): v is string => typeof v === 'string') : [];
}

/** Materialized dates per parent (day → occurrence note path), keyed by normalized task reference. */
function buildMaterializedIndex(
  tasks: readonly TaskNotesTaskInfo[],
  resolveTaskReference: TaskReferenceResolver | undefined,
): Map<string, Map<LocalDay, string>> {
  const index = new Map<string, Map<LocalDay, string>>();
  for (const task of tasks) {
    if (!task.recurrence_parent || !task.occurrence_date) continue;
    try {
      const resolvedPath = resolveTaskReference?.(
        parseLinkToPath(task.recurrence_parent),
        task.path,
      );
      const parentKey = normalizeTaskReference(resolvedPath ?? task.recurrence_parent);
      const day = getDatePart(task.occurrence_date);
      if (parentKey === '' || day === '') continue;
      const days = index.get(parentKey) ?? new Map<LocalDay, string>();
      days.set(day, task.path);
      index.set(parentKey, days);
    } catch {
      // An unparseable occurrence date drops this entry, not the derivation.
    }
  }
  return index;
}

/** Pattern days from the model expansion, window-filtered as the calendar does. */
function patternDays(
  task: TaskNotesTaskInfo & { recurrence: string },
  window: CalendarDerivationWindow,
): LocalDay[] {
  const windowStart = utcDayStart(window.startDate);
  const searchEnd = task.recurrence.includes('FREQ=YEARLY')
    ? new Date(windowStart.getTime() + YEARLY_LOOKAHEAD_DAYS * MILLISECONDS_PER_DAY)
    : utcDayStart(window.endDateExclusive);
  const scheduled = task.scheduled instanceof Date ? toLocalDay(task.scheduled) : task.scheduled;
  const occurrences = generateRecurringInstances(
    { title: task.title ?? '', recurrence: task.recurrence, ...(scheduled ? { scheduled } : {}) },
    windowStart,
    searchEnd,
  );
  return occurrences
    .map((occurrence) => formatDateForStorage(occurrence))
    .filter((day) => day < window.endDateExclusive);
}

/** Day predicates/classifiers shared by the instance families of one task. */
interface InstanceDayRules {
  inWindow(day: LocalDay): boolean;
  /** Recorded classification of a day, or `null` when unrecorded. */
  recordedState(day: LocalDay): RecurringInstanceState | null;
  /** Sub-toggle gate for virtual (next/pattern) instances. */
  passesSubToggles(day: LocalDay): boolean;
}

interface InstanceExpansionScope {
  task: TaskNotesTaskInfo & { recurrence: string };
  scheduledDay: LocalDay;
  window: CalendarDerivationWindow;
  toggles: RecurringInstanceToggles;
  /** Materialized day → the occurrence note's path. */
  materializedDays: ReadonlyMap<LocalDay, string>;
  rules: InstanceDayRules;
  states: Map<LocalDay, RecurringInstanceState>;
}

function buildInstanceDayRules(
  complete: readonly string[],
  skipped: readonly string[],
  window: CalendarDerivationWindow,
  toggles: RecurringInstanceToggles,
): InstanceDayRules {
  return {
    inWindow: (day) => day >= window.startDate && day < window.endDateExclusive,
    recordedState: (day) => {
      if (complete.includes(day)) return 'completed';
      if (skipped.includes(day)) return 'skipped';
      return null;
    },
    passesSubToggles: (day) =>
      (toggles.showCompletedRecurringInstances || !complete.includes(day)) &&
      (toggles.showSkippedRecurringInstances || !skipped.includes(day)),
  };
}

/** Next-scheduled + projected pattern instances (family toggle on only). */
function addVirtualInstances(scope: InstanceExpansionScope): void {
  const { task, scheduledDay, window, materializedDays, rules, states } = scope;
  if (
    rules.inWindow(scheduledDay) &&
    !materializedDays.has(scheduledDay) &&
    rules.passesSubToggles(scheduledDay)
  ) {
    states.set(scheduledDay, rules.recordedState(scheduledDay) ?? 'next');
  }
  for (const day of patternDays(task, window)) {
    if (day === scheduledDay || materializedDays.has(day) || !rules.passesSubToggles(day)) continue;
    states.set(day, rules.recordedState(day) ?? 'projected');
  }
}

/**
 * Recorded dates render regardless of the family toggle, gated only by
 * their own sub-toggles; a date in both lists classifies as completed first.
 */
function addRecordedInstances(
  scope: InstanceExpansionScope,
  complete: readonly string[],
  skipped: readonly string[],
): void {
  const { toggles, materializedDays, rules, states } = scope;
  const recordedDays = new Set<LocalDay>([
    ...(toggles.showCompletedRecurringInstances ? complete.filter(rules.inWindow) : []),
    ...(toggles.showSkippedRecurringInstances ? skipped.filter(rules.inWindow) : []),
  ]);
  for (const day of [...recordedDays].sort((a, b) => a.localeCompare(b))) {
    if (materializedDays.has(day) || states.has(day)) continue;
    states.set(day, rules.recordedState(day) ?? 'skipped');
  }
}

/** One task's per-day instance states, in calendar emission semantics. */
function collectInstanceStates(
  task: TaskNotesTaskInfo & { recurrence: string },
  scheduledDay: LocalDay,
  window: CalendarDerivationWindow,
  toggles: RecurringInstanceToggles,
  materializedDays: ReadonlyMap<LocalDay, string>,
): Map<LocalDay, RecurringInstanceState> {
  const complete = stringList(task.complete_instances);
  const skipped = stringList(task.skipped_instances);
  const scope: InstanceExpansionScope = {
    task,
    scheduledDay,
    window,
    toggles,
    materializedDays,
    rules: buildInstanceDayRules(complete, skipped, window, toggles),
    states: new Map<LocalDay, RecurringInstanceState>(),
  };

  if (toggles.showRecurring) addVirtualInstances(scope);
  addRecordedInstances(scope, complete, skipped);
  for (const day of materializedDays.keys()) {
    if (scope.rules.inWindow(day)) scope.states.set(day, 'materialized');
  }
  return scope.states;
}

function capInstanceStates(
  states: ReadonlyMap<LocalDay, RecurringInstanceState>,
): ReadonlyMap<LocalDay, RecurringInstanceState> {
  if (states.size <= MAX_OCCUPANCY_DAYS_PER_SERIES) return states;
  return new Map(
    [...states.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-MAX_OCCUPANCY_DAYS_PER_SERIES),
  );
}

function toOccupancy(
  taskPath: string,
  states: ReadonlyMap<LocalDay, RecurringInstanceState>,
  materializedDays: ReadonlyMap<LocalDay, string>,
): readonly CalendarOccupancy[] {
  return [...states.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, state]) => {
      const notePath = state === 'materialized' ? materializedDays.get(day) : undefined;
      return {
        family: 'recurring-instance' as const,
        itemId: makeCalendarItemId('recurring-instance', taskPath, day),
        day,
        minutes: null,
        stateClass: state,
        ...(notePath === undefined ? {} : { notePath }),
      };
    });
}

/** Pure parity expansion: recurring frontmatter state → per-day occupancy. */
export function expandRecurringOccupancy(input: RecurringExpansionInput): CalendarItemBatch {
  const { tasks, window, toggles } = input;
  const materializedIndex = buildMaterializedIndex(tasks, input.resolveTaskReference);
  const occupancyByTaskPath = new Map<string, readonly CalendarOccupancy[]>();
  const plainBarSuppressedTaskPaths = new Set<string>();

  for (const task of tasks) {
    try {
      const recurrence = task.recurrence;
      if (typeof recurrence !== 'string' || recurrence === '') continue;
      const scheduledDay = toLocalDay(task.scheduled);
      if (scheduledDay === '') continue;

      const materializedDays =
        materializedIndex.get(normalizeTaskReference(task.path)) ?? NO_MATERIALIZED;
      const states = capInstanceStates(
        collectInstanceStates(
          { ...task, recurrence },
          scheduledDay,
          window,
          toggles,
          materializedDays,
        ),
      );
      if (states.size > 0) {
        occupancyByTaskPath.set(task.path, toOccupancy(task.path, states, materializedDays));
      }
      if (toggles.showRecurring) plainBarSuppressedTaskPaths.add(task.path);
    } catch {
      // A task with unparseable recurrence state degrades to no instances
      // rather than breaking the whole family (calendar per-task tolerance).
    }
  }
  return { items: [], occupancyByTaskPath, plainBarSuppressedTaskPaths };
}

/** Build the recurring-instance {@link CalendarItemSource} over injected deps. */
export function createRecurringInstanceSource(deps: RecurringSourceDeps): RecurringInstanceSource {
  let epoch = 0;
  const unsubscribe = deps.subscribe?.(() => {
    epoch += 1;
  });
  return {
    family: 'recurring-instance',
    epoch: () => epoch,
    collect: async (context: CalendarItemQueryContext) =>
      expandRecurringOccupancy({
        tasks: await deps.listTasks(),
        window: context.window,
        toggles: deps.toggles(),
        resolveTaskReference: deps.resolveTaskReference,
      }),
    dispose: () => {
      unsubscribe?.();
    },
  };
}
