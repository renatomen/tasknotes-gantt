/**
 * Recurring occupancy from the model calendar.
 *
 * One call per task. Dates the model cannot parse are dropped field by field
 * so one bad value cannot hide the rest of the task. The task id is the note
 * path. Placement is the local civil day of the entry start; the occurrence
 * identity is what the item id carries, because a moved occurrence is drawn
 * on its new day and still names its original day.
 *
 * @module datasource/calendarItems/recurringModelCalendar
 */

import {
  buildCalendarEntries,
  calendarDateToInstant,
  calendarInstantToDate,
  type CalendarEntry,
  type CalendarTask,
} from '@tasknotes/model/calendar';
import { normalizeTaskReference } from '@tasknotes/model/operations';
import { parseLinkToPath } from '@tasknotes/model/mapping';
import type { TaskNotesTaskInfo, TaskNotesTimeEntry } from '../TaskNotesSource';
import type { CalendarDerivationWindow, CalendarOccupancy, LocalDay } from './types';
import { makeCalendarItemId } from './types';
import { isRealCalendarDay } from './normalizers';
import type { RecurringInstanceState, TaskReferenceResolver } from './recurringSource';

export interface RecurringModelInput {
  tasks: readonly TaskNotesTaskInfo[];
  window: CalendarDerivationWindow;
  toggles: {
    showRecurring: boolean;
    showCompletedRecurringInstances: boolean;
    showSkippedRecurringInstances: boolean;
  };
  resolveTaskReference?: TaskReferenceResolver;
  timezone?: string;
  now?: string;
}

const MAX_OCCUPANCY_DAYS_PER_SERIES = 1_000;

const STATE_PRECEDENCE: Record<RecurringInstanceState, number> = {
  projected: 1,
  next: 2,
  materialized: 3,
  skipped: 4,
  completed: 5,
};

interface OccupancyFact {
  day: LocalDay;
  state: RecurringInstanceState;
  identity: string;
  notePath?: string;
}

function defaultCalendarTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function defaultCalendarNow(): string {
  return new Date().toISOString();
}

function asDateString(value: Date | string | null | undefined): string | undefined {
  if (value == null || value === '') return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function calendarDate(value: string | undefined, timezone: string): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  const trimmed = value.trim().replace(/^(\d{4}-\d{2}-\d{2}) (?=\d)/, '$1T');
  for (const candidate of [value, trimmed]) {
    try {
      calendarDateToInstant(candidate, timezone);
      return candidate;
    } catch {
      // Try the next spelling.
    }
  }
  return undefined;
}

function validDateList(values: readonly string[] | null | undefined, timezone: string): string[] | undefined {
  if (!Array.isArray(values)) return undefined;
  return values.flatMap((value) => {
    const parsed = calendarDate(value, timezone);
    return parsed ? [parsed] : [];
  });
}

function recurrenceAnchor(
  value: string | null | undefined,
): 'scheduled' | 'completion' | undefined {
  return value === 'scheduled' || value === 'completion' ? value : undefined;
}

function optionalText(value: string | null | undefined): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * An impossible scheduled day is not an anchor. Dropping it avoids rolling the
 * series onto the next month.
 */
function scheduledForModel(value: Date | string | null | undefined, timezone: string): string | undefined {
  const parsed = calendarDate(asDateString(value), timezone);
  const day = parsed?.slice(0, 10);
  return parsed && day && isRealCalendarDay(day) ? parsed : undefined;
}

function projectTask(task: TaskNotesTaskInfo, timezone: string): CalendarTask {
  const timeEntries = Array.isArray(task.timeEntries)
    ? task.timeEntries.flatMap((entry) => {
        if (typeof entry?.startTime !== 'string') return [];
        const startTime = calendarDate(entry.startTime, timezone);
        const endTime = typeof entry.endTime === 'string' ? calendarDate(entry.endTime, timezone) : undefined;
        if (!startTime) return [];
        if (typeof entry.endTime === 'string' && !endTime) return [];
        const projected: TaskNotesTimeEntry = { ...entry, startTime, ...(endTime ? { endTime } : {}) };
        return [projected];
      })
    : undefined;
  return {
    path: task.path,
    title: task.title ?? '',
    status: task.status ?? undefined,
    scheduled: scheduledForModel(task.scheduled, timezone),
    due: calendarDate(asDateString(task.due), timezone),
    timeEstimate: task.timeEstimate ?? undefined,
    recurrence: optionalText(task.recurrence),
    recurrence_anchor: recurrenceAnchor(task.recurrence_anchor),
    recurrence_original_date: optionalText(task.recurrence_original_date),
    recurrence_parent: optionalText(task.recurrence_parent),
    occurrence_date: optionalText(task.occurrence_date),
    complete_instances: validDateList(task.complete_instances, timezone),
    skipped_instances: validDateList(task.skipped_instances, timezone),
    timeEntries,
    // A rejected calendar date does not throw here; the prefix is compared as text.
    googleCalendarMovedOriginalDates: Array.isArray(task.googleCalendarMovedOriginalDates)
      ? task.googleCalendarMovedOriginalDates.filter((value): value is string => typeof value === 'string')
      : undefined,
    googleCalendarExceptionOriginalScheduled: optionalText(task.googleCalendarExceptionOriginalScheduled),
  };
}

function placementDay(start: string, timezone: string): LocalDay {
  const instant = calendarDateToInstant(start, timezone);
  return calendarInstantToDate(instant, timezone, true).slice(0, 10);
}

function stateOf(entry: CalendarEntry): RecurringInstanceState {
  if (entry.isCompleted) return 'completed';
  if (entry.isSkipped) return 'skipped';
  if (entry.recurringKind === 'next-scheduled') return 'next';
  return 'projected';
}

function parentPath(task: TaskNotesTaskInfo, resolve: RecurringModelInput['resolveTaskReference']): string {
  const raw = task.recurrence_parent ?? '';
  const resolved = resolve?.(parseLinkToPath(raw), task.path) ?? raw;
  return resolved;
}

function occurrenceIdentity(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const day = value.slice(0, 10);
  return isRealCalendarDay(day) ? day : undefined;
}

function materializedForModel(tasks: readonly TaskNotesTaskInfo[], input: RecurringModelInput): Record<string, string[]> {
  const occurrences: Record<string, string[]> = Object.create(null);
  for (const task of tasks) {
    const occurrence = occurrenceIdentity(task.occurrence_date);
    if (!task.recurrence_parent || !occurrence) continue;
    const parent = normalizeTaskReference(parentPath(task, input.resolveTaskReference));
    if (!parent) continue;
    const dates = occurrences[parent] ?? [];
    dates.push(occurrence);
    occurrences[parent] = dates;
  }
  return occurrences;
}

function materializedFacts(
  tasks: readonly TaskNotesTaskInfo[],
  parent: TaskNotesTaskInfo,
  window: CalendarDerivationWindow,
  input: RecurringModelInput,
): OccupancyFact[] {
  const parentKey = normalizeTaskReference(parent.path);
  const facts: OccupancyFact[] = [];
  for (const task of tasks) {
    const identity = occurrenceIdentity(task.occurrence_date);
    if (!task.recurrence_parent || !identity) continue;
    if (normalizeTaskReference(parentPath(task, input.resolveTaskReference)) !== parentKey) continue;
    const timezone = input.timezone ?? defaultCalendarTimezone();
    const scheduled = scheduledForModel(task.scheduled, timezone);
    const placed = scheduled ? placementDay(scheduled, timezone) : identity;
    if (!isRealCalendarDay(placed) || placed < window.startDate || placed >= window.endDateExclusive) continue;
    facts.push({ day: placed, state: 'materialized', identity, notePath: task.path });
  }
  return facts;
}

function chooseFacts(facts: readonly OccupancyFact[]): OccupancyFact[] {
  const byDay = new Map<LocalDay, OccupancyFact>();
  for (const fact of facts) {
    const current = byDay.get(fact.day);
    if (!current) {
      byDay.set(fact.day, fact);
      continue;
    }
    const betterPrecedence = STATE_PRECEDENCE[fact.state] > STATE_PRECEDENCE[current.state];
    const earlierIdentity =
      STATE_PRECEDENCE[fact.state] === STATE_PRECEDENCE[current.state] && fact.identity < current.identity;
    if (betterPrecedence || earlierIdentity) byDay.set(fact.day, fact);
  }
  return [...byDay.values()]
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-MAX_OCCUPANCY_DAYS_PER_SERIES);
}

function entryFact(entry: CalendarEntry, timezone: string, window: CalendarDerivationWindow): OccupancyFact | undefined {
  if (!entry.recurringKind) return undefined;
  const day = placementDay(entry.start, timezone);
  if (!isRealCalendarDay(day) || day < window.startDate || day >= window.endDateExclusive) return undefined;
  return { day, state: stateOf(entry), identity: entry.instanceDate ?? day };
}

function toOccupancy(taskPath: string, facts: readonly OccupancyFact[]): CalendarOccupancy[] {
  return facts.map((fact) => ({
    family: 'recurring-instance' as const,
    itemId: makeCalendarItemId('recurring-instance', taskPath, fact.identity),
    day: fact.day,
    minutes: null,
    stateClass: fact.state,
    ...(fact.notePath === undefined ? {} : { notePath: fact.notePath }),
  }));
}

/** Recurring occupancy for one derivation window. A bad task drops out of the batch. */
export function deriveRecurringOccupancy(input: RecurringModelInput): {
  occupancyByTaskPath: Map<string, readonly CalendarOccupancy[]>;
  plainBarSuppressedTaskPaths: Set<string>;
} {
  const timezone = input.timezone ?? defaultCalendarTimezone();
  const now = input.now ?? defaultCalendarNow();
  const materializedOccurrences = materializedForModel(input.tasks, input);
  const occupancyByTaskPath = new Map<string, readonly CalendarOccupancy[]>();
  const plainBarSuppressedTaskPaths = new Set<string>();

  for (const task of input.tasks) {
    if (typeof task.recurrence !== 'string' || task.recurrence === '') continue;
    try {
      const projected = projectTask(task, timezone);
      if (!projected.scheduled) continue;
      const entries = buildCalendarEntries({
        tasks: [projected],
        range: { start: input.window.startDate, end: input.window.endDateExclusive },
        timezone,
        now,
        settings: {
          showScheduled: false,
          showDue: false,
          showTimeEntries: false,
          showScheduledToDueSpan: false,
          showOverdueOnToday: false,
          showRecurring: input.toggles.showRecurring,
          showCompletedRecurringInstances: input.toggles.showCompletedRecurringInstances,
          showSkippedRecurringInstances: input.toggles.showSkippedRecurringInstances,
        },
        materializedOccurrences,
      });
      const facts = [
        ...entries.flatMap((entry) => {
          const fact = entryFact(entry, timezone, input.window);
          return fact ? [fact] : [];
        }),
        ...materializedFacts(input.tasks, task, input.window, input),
      ];
      const chosen = chooseFacts(facts);
      if (chosen.length > 0) occupancyByTaskPath.set(task.path, toOccupancy(task.path, chosen));
      if (input.toggles.showRecurring) plainBarSuppressedTaskPaths.add(task.path);
    } catch {
      // One unreadable task drops its occurrences, not the batch.
    }
  }
  return { occupancyByTaskPath, plainBarSuppressedTaskPaths };
}
