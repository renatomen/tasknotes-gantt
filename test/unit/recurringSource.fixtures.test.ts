/**
 * Occupancy for the model's shipped calendar fixtures.
 *
 * Expected recurring entries collapse to one fact per task and instance date,
 * on the earliest start day, then to one fact per day. The model has no
 * materialized entry kind, so a child note or a fixture materialized-occurrence
 * list adds that fact from the inputs before the per-day collapse.
 */

import { describe, expect, it } from '@jest/globals';
import type { TaskInfo } from '@tasknotes/model';
import {
  calendarDateToInstant,
  calendarInstantToDate,
  type CalendarEntry,
} from '@tasknotes/model/calendar';
import { calendarFixtures, type CalendarFixture } from '@tasknotes/model/calendar/fixtures';
import { parseLinkToPath } from '@tasknotes/model/mapping';
import { normalizeTaskReference } from '@tasknotes/model/operations';
import { makeCalendarItemId } from '../../src/datasource/calendarItems';
import { expandRecurringOccupancy } from '../../src/datasource/calendarItems/recurringSource';
import { isRealCalendarDay } from '../../src/datasource/calendarItems/normalizers';
import type { TaskNotesTaskInfo } from '../../src/datasource/TaskNotesSource';

const NATIVE_FIXTURE_COUNT = 11;

type OccupancyState = 'projected' | 'next' | 'materialized' | 'skipped' | 'completed';

interface OccupancyFact {
  taskPath: string;
  day: string;
  state: OccupancyState;
  identity: string;
}

const STATE_PRECEDENCE: Record<OccupancyState, number> = {
  projected: 1,
  next: 2,
  materialized: 3,
  skipped: 4,
  completed: 5,
};

function recurringFixtures(): CalendarFixture[] {
  return calendarFixtures.filter(
    (fixture) =>
      fixture.name.startsWith('native-') ||
      fixture.expectedEntries.some((entry) => entry.recurringKind !== undefined),
  );
}

function civilDay(start: string, timezone: string): string {
  const instant = calendarDateToInstant(start, timezone);
  return calendarInstantToDate(instant, timezone, true).slice(0, 10);
}

function acceptedScheduledDay(value: string | undefined, timezone: string): string | undefined {
  if (!value) return undefined;
  const spaced = value.trim().replace(/^(\d{4}-\d{2}-\d{2}) (?=\d)/, '$1T');
  for (const candidate of [value, spaced]) {
    try {
      calendarDateToInstant(candidate, timezone);
      if (!isRealCalendarDay(candidate.slice(0, 10))) return undefined;
      const day = civilDay(candidate, timezone);
      return isRealCalendarDay(day) ? day : undefined;
    } catch {
      // Try the next spelling.
    }
  }
  return undefined;
}

function stateOf(entry: CalendarEntry): OccupancyState {
  if (entry.isCompleted) return 'completed';
  if (entry.isSkipped) return 'skipped';
  if (entry.recurringKind === 'next-scheduled') return 'next';
  return 'projected';
}

function pathForTaskId(fixture: CalendarFixture, taskId: string): string {
  const task = fixture.input.tasks.find((candidate) => (candidate.id || candidate.path) === taskId);
  if (!task) throw new Error(`${fixture.name} has no task ${taskId}`);
  return task.path;
}

function parentPathOf(task: TaskInfo, tasks: readonly TaskInfo[]): string | undefined {
  if (!task.recurrence_parent) return undefined;
  const key = normalizeTaskReference(parseLinkToPath(task.recurrence_parent));
  const parent = tasks.find(
    (candidate) =>
      normalizeTaskReference(candidate.path) === key ||
      (candidate.id !== undefined && normalizeTaskReference(candidate.id) === key),
  );
  return parent?.path;
}

function inWindow(day: string, fixture: CalendarFixture): boolean {
  const start = fixture.input.range.start.slice(0, 10);
  const end = fixture.input.range.end.slice(0, 10);
  return day >= start && day < end;
}

function recurringFacts(fixture: CalendarFixture): OccupancyFact[] {
  const byIdentity = new Map<string, OccupancyFact>();
  for (const entry of fixture.expectedEntries) {
    if (!entry.recurringKind) continue;
    const taskPath = pathForTaskId(fixture, entry.taskId);
    const identity = entry.instanceDate ?? civilDay(entry.start, fixture.input.timezone);
    const day = civilDay(entry.start, fixture.input.timezone);
    if (!inWindow(day, fixture)) continue;
    const key = `${taskPath}\0${identity}`;
    const current = byIdentity.get(key);
    if (!current || day < current.day) {
      byIdentity.set(key, { taskPath, day, state: stateOf(entry), identity });
    }
  }
  return [...byIdentity.values()];
}

function tasksWithContextOccurrences(fixture: CalendarFixture): TaskInfo[] {
  const tasks = [...fixture.input.tasks];
  for (const [parentId, dates] of Object.entries(fixture.input.materializedOccurrences ?? {})) {
    const parent = tasks.find((task) => (task.id || task.path) === parentId);
    const parentPath = parent?.path ?? parentId;
    for (const date of dates) {
      const identity = date.slice(0, 10);
      const present = tasks.some(
        (task) =>
          task.occurrence_date?.slice(0, 10) === identity && parentPathOf(task, tasks) === parentPath,
      );
      if (present) continue;
      tasks.push({
        id: `${parentId}-${identity}`,
        path: `${parentPath}#${identity}`,
        title: identity,
        status: 'open',
        priority: 'normal',
        archived: false,
        recurrence_parent: parentPath,
        occurrence_date: identity,
      });
    }
  }
  return tasks;
}

function materializedFacts(fixture: CalendarFixture, tasks: readonly TaskInfo[]): OccupancyFact[] {
  const facts: OccupancyFact[] = [];
  for (const task of tasks) {
    const parent = parentPathOf(task, tasks);
    const identity = task.occurrence_date?.slice(0, 10);
    if (!parent || !identity || !isRealCalendarDay(identity)) continue;
    const scheduled = acceptedScheduledDay(task.scheduled, fixture.input.timezone);
    const day = scheduled ?? identity;
    if (!isRealCalendarDay(day) || !inWindow(day, fixture)) continue;
    facts.push({ taskPath: parent, day, state: 'materialized', identity });
  }
  return facts;
}

function collapseDays(facts: readonly OccupancyFact[]): OccupancyFact[] {
  const byDay = new Map<string, OccupancyFact>();
  for (const fact of facts) {
    const key = `${fact.taskPath}\0${fact.day}`;
    const current = byDay.get(key);
    if (!current) {
      byDay.set(key, fact);
      continue;
    }
    const better = STATE_PRECEDENCE[fact.state] > STATE_PRECEDENCE[current.state];
    const earlier =
      STATE_PRECEDENCE[fact.state] === STATE_PRECEDENCE[current.state] && fact.identity < current.identity;
    if (better || earlier) byDay.set(key, fact);
  }
  return [...byDay.values()];
}

function sortFacts(facts: readonly OccupancyFact[]): OccupancyFact[] {
  return [...facts].sort(
    (a, b) =>
      a.taskPath.localeCompare(b.taskPath) ||
      a.day.localeCompare(b.day) ||
      a.identity.localeCompare(b.identity),
  );
}

function toInputTask(task: TaskInfo): TaskNotesTaskInfo {
  return {
    path: task.path,
    title: task.title,
    status: task.status,
    scheduled: task.scheduled,
    due: task.due,
    recurrence: task.recurrence,
    recurrence_anchor: task.recurrence_anchor,
    recurrence_original_date: task.recurrence_original_date,
    complete_instances: task.complete_instances,
    skipped_instances: task.skipped_instances,
    recurrence_parent: task.recurrence_parent,
    occurrence_date: task.occurrence_date,
    timeEstimate: task.timeEstimate,
    timeEntries: task.timeEntries,
    googleCalendarMovedOriginalDates: task.googleCalendarMovedOriginalDates,
    googleCalendarExceptionOriginalScheduled: task.googleCalendarExceptionOriginalScheduled,
  };
}

function identityFromItemId(itemId: string, taskPath: string): string {
  const base = makeCalendarItemId('recurring-instance', taskPath);
  if (!itemId.startsWith(`${base}@`)) throw new Error(`unexpected item id ${itemId}`);
  return decodeURIComponent(itemId.slice(base.length + 1));
}

function adapterFacts(fixture: CalendarFixture, tasks: readonly TaskInfo[]): OccupancyFact[] {
  const settings = fixture.input.settings;
  const batch = expandRecurringOccupancy({
    tasks: tasks.map(toInputTask),
    window: {
      startDate: fixture.input.range.start.slice(0, 10),
      endDateExclusive: fixture.input.range.end.slice(0, 10),
    },
    toggles: {
      showRecurring: settings?.showRecurring !== false,
      showCompletedRecurringInstances: settings?.showCompletedRecurringInstances !== false,
      showSkippedRecurringInstances: settings?.showSkippedRecurringInstances !== false,
    },
    timezone: fixture.input.timezone,
    now: fixture.input.now,
  });
  const facts: OccupancyFact[] = [];
  for (const [taskPath, occupancy] of batch.occupancyByTaskPath) {
    for (const entry of occupancy) {
      facts.push({
        taskPath,
        day: entry.day,
        state: entry.stateClass as OccupancyState,
        identity: identityFromItemId(entry.itemId, taskPath),
      });
    }
  }
  return facts;
}

function expectedFacts(fixture: CalendarFixture, tasks: readonly TaskInfo[]): OccupancyFact[] {
  return sortFacts(collapseDays([...recurringFacts(fixture), ...materializedFacts(fixture, tasks)]));
}

describe('recurringSource — shipped calendar fixtures', () => {
  it('includes every moved-occurrence fixture', () => {
    const native = calendarFixtures.filter((fixture) => fixture.name.startsWith('native-'));
    expect(native).toHaveLength(NATIVE_FIXTURE_COUNT);
    expect(recurringFixtures().filter((fixture) => fixture.name.startsWith('native-'))).toHaveLength(
      NATIVE_FIXTURE_COUNT,
    );
  });

  it.each(recurringFixtures())('$name', (fixture) => {
    const tasks = tasksWithContextOccurrences(fixture);
    expect(sortFacts(adapterFacts(fixture, tasks))).toEqual(expectedFacts(fixture, tasks));
  });
});
