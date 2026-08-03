/**
 * Unit tests for the calendar-item sources provider — the register-side wiring
 * that turns the per-view family toggles into concrete calendar-item sources
 * for the controller's `createCalendarItemSources` dep.
 *
 * Key behaviors under test:
 *  - dataset parity: the recurring source exists from the FIRST provide, family
 *    toggle off included, so recorded (completed/skipped) instances and
 *    materialized occurrences render on a fresh default view exactly as the
 *    TaskNotes calendar renders them; event-emitting families (time entries)
 *    stay opt-in default-off (their off-state emits nothing);
 *  - each family toggle creates/activates its source, collecting from the
 *    injected TaskNotes task list;
 *  - the recurring source is RETAINED across toggle flips with a stable
 *    identity (the controller's batch cache keys on the source object);
 *  - a toggle flip bumps the provided epoch, so the controller's cached batch
 *    invalidates even though no task data changed;
 *  - dispose releases the change-event subscriptions.
 */

import {
  createCalendarItemSourcesProvider,
  type CalendarItemSourcesProvider,
} from '../../src/bases/calendarItemSources';
import type { CalendarItemToggles } from '../../src/bases/calendarItemOptions';
import type {
  CalendarItemBatch,
  CalendarItemQueryContext,
  CalendarItemSource,
} from '../../src/datasource/calendarItems';
import type { TaskNotesTaskInfo } from '../../src/datasource/TaskNotesSource';

const allOffToggles = (): CalendarItemToggles => ({
  showRecurring: false,
  showCompletedRecurringInstances: true,
  showSkippedRecurringInstances: true,
  showTimeEntries: false,
  showTimeblocks: false,
  showPropertyBasedEvents: false,
  propertyEventStart: '',
  propertyEventEnd: '',
  propertyEventTitle: '',
});

const recurringTask: TaskNotesTaskInfo = {
  path: 'Tasks/Weekly.md',
  title: 'Weekly',
  recurrence: 'FREQ=WEEKLY;BYDAY=MO',
  scheduled: '2026-03-02',
  complete_instances: ['2026-03-09'],
  skipped_instances: ['2026-03-16'],
};

const trackedTask: TaskNotesTaskInfo = {
  path: 'Tasks/Tracked.md',
  title: 'Tracked',
  timeEntries: [{ startTime: '2026-03-04T09:00:00+00:00', endTime: '2026-03-04T10:00:00+00:00' }],
};

const context = (): CalendarItemQueryContext => ({
  window: { startDate: '2026-03-01', endDateExclusive: '2026-04-01' },
  tasks: () => [],
  basesEntries: () => [],
});

interface Harness {
  provider: CalendarItemSourcesProvider;
  toggles: CalendarItemToggles;
  fireChange: (eventName: string) => void;
  unsubscribeCount: () => number;
}

function makeHarness(tasks: readonly TaskNotesTaskInfo[]): Harness {
  const toggles = allOffToggles();
  const handlers: Array<(eventName: string, payload?: unknown) => void> = [];
  let unsubscribed = 0;
  const provider = createCalendarItemSourcesProvider({
    toggles: () => ({ ...toggles }),
    listTasks: () => tasks,
    subscribe: (handler) => {
      handlers.push(handler);
      return () => {
        unsubscribed += 1;
      };
    },
  });
  return {
    provider,
    toggles,
    fireChange: (eventName) => {
      for (const handler of handlers) handler(eventName);
    },
    unsubscribeCount: () => unsubscribed,
  };
}

const families = (sources: readonly CalendarItemSource[]): string[] =>
  sources.map((source) => source.family);

const collectOne = async (source: CalendarItemSource): Promise<CalendarItemBatch> =>
  source.collect(context());

describe('createCalendarItemSourcesProvider', () => {
  it('provides the recurring source with every family toggle off, emitting recorded-only occupancy', async () => {
    // Dataset parity: the TaskNotes calendar renders recorded (completed/
    // skipped) instances with its recurring toggle off, so a fresh default
    // view must too — the source exists from the first provide.
    const harness = makeHarness([recurringTask, trackedTask]);

    const sources = provideSources(harness);
    expect(families(sources)).toEqual(['recurring-instance']);

    const batch = await collectOne(sources[0]!);
    const states = (batch.occupancyByTaskPath.get(recurringTask.path) ?? []).map(
      (entry) => entry.stateClass,
    );
    expect(states).toEqual(['completed', 'skipped']);
    expect(batch.plainBarSuppressedTaskPaths?.has(recurringTask.path) ?? false).toBe(false);
    // The opt-in-off promise holds for everything else: no event rows, and a
    // task with no recorded history contributes nothing.
    expect(batch.items).toEqual([]);
    expect(batch.occupancyByTaskPath.has(trackedTask.path)).toBe(false);
  });

  it('provides the recurring source once showRecurring is on, collecting occupancy from the task list', async () => {
    const harness = makeHarness([recurringTask]);
    harness.toggles.showRecurring = true;

    const sources = provideSources(harness);
    expect(families(sources)).toEqual(['recurring-instance']);

    const batch = await collectOne(sources[0]!);
    const occupancy = batch.occupancyByTaskPath.get(recurringTask.path) ?? [];
    const states = occupancy.map((entry) => entry.stateClass);
    expect(states).toContain('next');
    expect(states).toContain('completed');
    expect(states).toContain('skipped');
    expect(batch.plainBarSuppressedTaskPaths?.has(recurringTask.path)).toBe(true);
  });

  it('provides the time-entry source once showTimeEntries is on, collecting flat items', async () => {
    const harness = makeHarness([trackedTask]);
    harness.toggles.showTimeEntries = true;

    // The always-on recurring source rides along (dataset parity); the
    // time-entry family joins on its toggle.
    const sources = provideSources(harness);
    expect(families(sources)).toEqual(['recurring-instance', 'time-entry']);

    const batch = await collectOne(sources[1]!);
    expect(batch.items).toHaveLength(1);
    expect(batch.items[0]!.family).toBe('time-entry');
    expect(batch.items[0]!.startDay).toBe('2026-03-04');
  });

  it('provides both sources when both families are on', () => {
    const harness = makeHarness([recurringTask, trackedTask]);
    harness.toggles.showRecurring = true;
    harness.toggles.showTimeEntries = true;

    expect(families(provideSources(harness))).toEqual(['recurring-instance', 'time-entry']);
  });

  it('keeps a family source identity stable across provides', () => {
    const harness = makeHarness([recurringTask]);
    harness.toggles.showRecurring = true;

    const first = provideSources(harness)[0];
    const second = provideSources(harness)[0];

    expect(second).toBe(first);
  });

  it('threads the completed/skipped sub-toggles through to the recurring expansion', async () => {
    const harness = makeHarness([recurringTask]);
    harness.toggles.showRecurring = true;
    harness.toggles.showCompletedRecurringInstances = false;
    harness.toggles.showSkippedRecurringInstances = false;

    const batch = await collectOne(provideSources(harness)[0]!);
    const states = (batch.occupancyByTaskPath.get(recurringTask.path) ?? []).map(
      (entry) => entry.stateClass,
    );
    expect(states).toContain('next');
    expect(states).not.toContain('completed');
    expect(states).not.toContain('skipped');
  });

  it('keeps providing a retained recurring source after the family is switched off, recorded-only', async () => {
    const harness = makeHarness([recurringTask]);
    harness.toggles.showRecurring = true;
    provideSources(harness);

    harness.toggles.showRecurring = false;
    const sources = provideSources(harness);
    expect(families(sources)).toEqual(['recurring-instance']);

    const batch = await collectOne(sources[0]!);
    const states = (batch.occupancyByTaskPath.get(recurringTask.path) ?? []).map(
      (entry) => entry.stateClass,
    );
    expect(states).toContain('completed');
    expect(states).toContain('skipped');
    expect(states).not.toContain('next');
    expect(states).not.toContain('projected');
    expect(batch.plainBarSuppressedTaskPaths?.has(recurringTask.path) ?? false).toBe(false);
  });

  it('bumps the provided epoch when a toggle changes and holds it while unchanged', () => {
    const harness = makeHarness([recurringTask]);
    harness.toggles.showRecurring = true;

    const source = provideSources(harness)[0]!;
    const initialEpoch = source.epoch();

    expect(provideSources(harness)[0]!.epoch()).toBe(initialEpoch);

    harness.toggles.showCompletedRecurringInstances = false;
    const flippedEpoch = provideSources(harness)[0]!.epoch();
    expect(flippedEpoch).toBe(initialEpoch + 1);
  });

  it('bumps the epoch when the change subscription fires', () => {
    const harness = makeHarness([recurringTask]);
    harness.toggles.showRecurring = true;

    const source = provideSources(harness)[0]!;
    const initialEpoch = source.epoch();
    harness.fireChange('task.updated');

    expect(source.epoch()).toBe(initialEpoch + 1);
  });

  it('dispose releases the change subscriptions of every created source', () => {
    const harness = makeHarness([recurringTask, trackedTask]);
    harness.toggles.showRecurring = true;
    harness.toggles.showTimeEntries = true;
    provideSources(harness);

    harness.provider.dispose();

    expect(harness.unsubscribeCount()).toBe(2);
  });
});

function provideSources(harness: Harness): readonly CalendarItemSource[] {
  return harness.provider.provide();
}
