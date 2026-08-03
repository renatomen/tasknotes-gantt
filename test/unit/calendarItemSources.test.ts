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

import { jest } from '@jest/globals';
import {
  createCalendarItemSourcesProvider,
  type CalendarItemSourceDeps,
  type CalendarItemSourcesProvider,
} from '../../src/bases/calendarItemSources';
import type { CalendarItemToggles } from '../../src/bases/calendarItemOptions';
import type {
  CalendarItemBatch,
  CalendarItemQueryContext,
  CalendarItemSource,
  DailyNoteTimeblocks,
} from '../../src/datasource/calendarItems';
import { externalCalendarFeedKey } from '../../src/datasource/calendarItems';
import type { TaskNotesTaskInfo } from '../../src/datasource/TaskNotesSource';
import type { TimerScheduler } from '../../src/bases/scheduler';
import type { BasesEntry } from 'obsidian';

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
  fireBasesData: () => void;
  unsubscribeCount: () => number;
  basesDataUnsubscribeCount: () => number;
  visibleFeeds: Set<string>;
}

interface HarnessOptions {
  dailyNotes?: readonly DailyNoteTimeblocks[];
  onListDailyNotes?: (window: { startDate: string; endDateExclusive: string }) => void;
  timeblockEpoch?: () => number;
  taskNotesPlugin?: unknown;
  scheduler?: TimerScheduler;
  onExternalEpochBump?: () => void;
  onExternalBatchFlags?: (flags: { degraded: boolean; loading: boolean }) => void;
}

function makeHarness(tasks: readonly TaskNotesTaskInfo[], options: HarnessOptions = {}): Harness {
  const toggles = allOffToggles();
  const handlers: Array<(eventName: string, payload?: unknown) => void> = [];
  const basesDataHandlers: Array<() => void> = [];
  let unsubscribed = 0;
  let basesDataUnsubscribed = 0;
  const visibleFeeds = new Set<string>();
  const deps: CalendarItemSourceDeps = {
    toggles: () => ({ ...toggles }),
    listTasks: () => tasks,
    subscribe: (handler) => {
      handlers.push(handler);
      return () => {
        unsubscribed += 1;
      };
    },
    subscribeBasesData: (handler) => {
      basesDataHandlers.push(handler);
      return () => {
        basesDataUnsubscribed += 1;
      };
    },
    ...(options.dailyNotes
      ? {
          listDailyNotes: (window: { startDate: string; endDateExclusive: string }) => {
            options.onListDailyNotes?.(window);
            return options.dailyNotes ?? [];
          },
        }
      : {}),
    ...(options.timeblockEpoch ? { timeblockEpoch: options.timeblockEpoch } : {}),
    ...(options.taskNotesPlugin !== undefined
      ? {
          getTaskNotesPlugin: () => options.taskNotesPlugin,
          visibleExternalFeeds: () => visibleFeeds,
          scheduler: options.scheduler ?? manualScheduler().scheduler,
        }
      : {}),
    ...(options.onExternalEpochBump ? { onExternalEpochBump: options.onExternalEpochBump } : {}),
    ...(options.onExternalBatchFlags ? { onExternalBatchFlags: options.onExternalBatchFlags } : {}),
  };
  const provider = createCalendarItemSourcesProvider(deps);
  return {
    provider,
    toggles,
    fireChange: (eventName) => {
      for (const handler of handlers) handler(eventName);
    },
    fireBasesData: () => {
      for (const handler of basesDataHandlers) handler();
    },
    unsubscribeCount: () => unsubscribed,
    basesDataUnsubscribeCount: () => basesDataUnsubscribed,
    visibleFeeds,
  };
}

function manualScheduler() {
  let nextHandle = 1;
  const pending = new Map<number, () => void>();
  const scheduler: TimerScheduler = {
    setTimeout: (callback: () => void) => {
      const handle = nextHandle++;
      pending.set(handle, callback);
      return handle as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (timer) => {
      pending.delete(timer as unknown as number);
    },
  };
  return { scheduler, pendingCount: () => pending.size };
}

/** A Bases entry carrying only what the property-event fast path reads. */
function basesEntry(path: string, frontmatter: Record<string, unknown>): BasesEntry {
  return {
    file: { path, name: path, basename: path.replace(/\.md$/, '') },
    frontmatter,
    getValue: () => undefined,
  } as unknown as BasesEntry;
}

/** A TaskNotes plugin fixture shaped like the real ICS + provider services. */
function taskNotesPluginFixture(input: {
  subscriptions?: Array<{ id: string; name: string; enabled: boolean }>;
  icsEvents?: Array<Record<string, unknown>>;
  withProviderRegistry?: boolean;
}) {
  const listeners = new Map<string, Array<() => void>>();
  const icsSubscriptionService = {
    getSubscriptions: () => input.subscriptions ?? [],
    getAllEvents: () => input.icsEvents ?? [],
    on: (event: string, listener: () => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return () => {};
    },
  };
  const plugin: Record<string, unknown> = { icsSubscriptionService };
  if (input.withProviderRegistry !== false) {
    plugin.calendarProviderRegistry = { getAllProviders: () => [] };
  }
  return {
    plugin,
    emit: (event: string) => {
      for (const listener of listeners.get(event) ?? []) listener();
    },
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

  describe('property-event family', () => {
    it('creates the source lazily on its toggle and collects events from the Bases entries', async () => {
      const harness = makeHarness([]);
      expect(families(provideSources(harness))).not.toContain('property-event');

      harness.toggles.showPropertyBasedEvents = true;
      harness.toggles.propertyEventStart = 'note.eventStart';
      const sources = provideSources(harness);
      expect(families(sources)).toContain('property-event');

      const source = sources.find((entry) => entry.family === 'property-event')!;
      const batch = await source.collect({
        ...context(),
        basesEntries: () => [basesEntry('Events/Offsite.md', { eventStart: '2026-03-05' })],
      });
      expect(batch.items).toHaveLength(1);
      expect(batch.items[0]!.family).toBe('property-event');
      expect(batch.items[0]!.startDay).toBe('2026-03-05');
    });

    it('bumps the property-event epoch when the Bases data seam fires', () => {
      const harness = makeHarness([]);
      harness.toggles.showPropertyBasedEvents = true;
      harness.toggles.propertyEventStart = 'note.eventStart';
      const source = provideSources(harness).find((entry) => entry.family === 'property-event')!;
      const initialEpoch = source.epoch();

      harness.fireBasesData();

      expect(source.epoch()).toBe(initialEpoch + 1);
    });

    it('bumps the epoch when a picker is re-pointed (same family toggles, new property)', () => {
      const harness = makeHarness([]);
      harness.toggles.showPropertyBasedEvents = true;
      harness.toggles.propertyEventStart = 'note.eventStart';
      const source = provideSources(harness).find((entry) => entry.family === 'property-event')!;
      const initialEpoch = source.epoch();

      harness.toggles.propertyEventStart = 'note.begins';
      const repointedEpoch = provideSources(harness)
        .find((entry) => entry.family === 'property-event')!
        .epoch();

      expect(repointedEpoch).toBe(initialEpoch + 1);
    });
  });

  describe('timeblock family', () => {
    const dailyNote: DailyNoteTimeblocks = {
      date: '2026-03-06',
      path: 'Daily/2026-03-06.md',
      timeblocks: [{ id: 'tb-1', title: 'Deep work', startTime: '09:00', endTime: '11:00' }],
    };

    it('creates the source lazily on its toggle, listing daily notes for the derivation window', async () => {
      const seenWindows: Array<{ startDate: string; endDateExclusive: string }> = [];
      const harness = makeHarness([], {
        dailyNotes: [dailyNote],
        onListDailyNotes: (window) => seenWindows.push(window),
      });
      expect(families(provideSources(harness))).not.toContain('timeblock');

      harness.toggles.showTimeblocks = true;
      const source = provideSources(harness).find((entry) => entry.family === 'timeblock')!;
      const batch = await collectOne(source);

      expect(seenWindows).toEqual([{ startDate: '2026-03-01', endDateExclusive: '2026-04-01' }]);
      expect(batch.items).toHaveLength(1);
      expect(batch.items[0]!.family).toBe('timeblock');
      expect(batch.items[0]!.startDay).toBe('2026-03-06');
      expect(batch.items[0]!.notePath).toBe('Daily/2026-03-06.md');
    });

    it('never creates the source without a daily-note accessor, toggle on included', () => {
      const harness = makeHarness([]);
      harness.toggles.showTimeblocks = true;

      expect(families(provideSources(harness))).not.toContain('timeblock');
    });

    it('drives the provided epoch from the injected timeblock watch epoch', () => {
      let watchEpoch = 4;
      const harness = makeHarness([], {
        dailyNotes: [dailyNote],
        timeblockEpoch: () => watchEpoch,
      });
      harness.toggles.showTimeblocks = true;

      const source = provideSources(harness).find((entry) => entry.family === 'timeblock')!;
      const initialEpoch = source.epoch();

      watchEpoch += 1;
      expect(source.epoch()).toBe(initialEpoch + 1);
    });
  });

  describe('external-event family', () => {
    const visibleWorkFeed = (harness: Harness): void => {
      harness.visibleFeeds.add(externalCalendarFeedKey('ics', 'work-cal'));
    };

    it('creates the source lazily once a feed is visible and collects its events', async () => {
      const fixture = taskNotesPluginFixture({
        subscriptions: [{ id: 'work-cal', name: 'Work', enabled: true }],
        icsEvents: [
          {
            subscriptionId: 'work-cal',
            title: 'Team sync',
            start: '2026-03-10',
            allDay: true,
          },
        ],
      });
      const harness = makeHarness([], { taskNotesPlugin: fixture.plugin });
      expect(families(provideSources(harness))).not.toContain('external-event');

      visibleWorkFeed(harness);
      const source = provideSources(harness).find((entry) => entry.family === 'external-event')!;
      const batch = await collectOne(source);

      expect(batch.items).toHaveLength(1);
      expect(batch.items[0]!.family).toBe('external-event');
      expect(batch.items[0]!.title).toBe('Team sync');
      expect(batch.items[0]!.startDay).toBe('2026-03-10');
    });

    it('keeps providing the retained source after every feed is hidden again', () => {
      const fixture = taskNotesPluginFixture({
        subscriptions: [{ id: 'work-cal', name: 'Work', enabled: true }],
      });
      const harness = makeHarness([], { taskNotesPlugin: fixture.plugin });
      visibleWorkFeed(harness);
      provideSources(harness);

      harness.visibleFeeds.clear();

      expect(families(provideSources(harness))).toContain('external-event');
    });

    it('bumps the provided epoch when the visible feed set changes', () => {
      const fixture = taskNotesPluginFixture({
        subscriptions: [{ id: 'work-cal', name: 'Work', enabled: true }],
      });
      const harness = makeHarness([], { taskNotesPlugin: fixture.plugin });
      visibleWorkFeed(harness);
      const source = provideSources(harness).find((entry) => entry.family === 'external-event')!;
      const initialEpoch = source.epoch();

      harness.visibleFeeds.add(externalCalendarFeedKey('ics', 'home-cal'));
      const bumpedEpoch = provideSources(harness)
        .find((entry) => entry.family === 'external-event')!
        .epoch();

      expect(bumpedEpoch).toBe(initialEpoch + 1);
    });

    it('reports a degraded collect through the batch-flags hook', async () => {
      const fixture = taskNotesPluginFixture({
        subscriptions: [{ id: 'work-cal', name: 'Work', enabled: true }],
        withProviderRegistry: false,
      });
      const onExternalBatchFlags = jest.fn();
      const harness = makeHarness([], {
        taskNotesPlugin: fixture.plugin,
        onExternalBatchFlags,
      });
      visibleWorkFeed(harness);
      const source = provideSources(harness).find((entry) => entry.family === 'external-event')!;

      const batch = await collectOne(source);

      expect(batch.degraded).toBe(true);
      expect(onExternalBatchFlags).toHaveBeenCalledWith({ degraded: true, loading: false });
    });

    it('reports a cold-cache loading collect through the batch-flags hook', async () => {
      const fixture = taskNotesPluginFixture({
        subscriptions: [{ id: 'work-cal', name: 'Work', enabled: true }],
        icsEvents: [],
      });
      const onExternalBatchFlags = jest.fn();
      const harness = makeHarness([], {
        taskNotesPlugin: fixture.plugin,
        onExternalBatchFlags,
      });
      visibleWorkFeed(harness);
      const source = provideSources(harness).find((entry) => entry.family === 'external-event')!;

      const batch = await collectOne(source);

      expect(batch.loading).toBe(true);
      expect(onExternalBatchFlags).toHaveBeenCalledWith({ degraded: false, loading: true });
    });

    it('forwards the external data-changed bump and exposes the raw external epoch', () => {
      const fixture = taskNotesPluginFixture({
        subscriptions: [{ id: 'work-cal', name: 'Work', enabled: true }],
      });
      const onExternalEpochBump = jest.fn();
      const harness = makeHarness([], {
        taskNotesPlugin: fixture.plugin,
        onExternalEpochBump,
      });
      expect(harness.provider.externalEpoch()).toBe(0);

      visibleWorkFeed(harness);
      provideSources(harness);
      fixture.emit('data-changed');

      expect(onExternalEpochBump).toHaveBeenCalledTimes(1);
      expect(harness.provider.externalEpoch()).toBe(1);
    });

    it('dispose releases the external timer and the Bases data subscription', () => {
      const timers = manualScheduler();
      const fixture = taskNotesPluginFixture({
        subscriptions: [{ id: 'work-cal', name: 'Work', enabled: true }],
      });
      const harness = makeHarness([], {
        taskNotesPlugin: fixture.plugin,
        scheduler: timers.scheduler,
      });
      harness.toggles.showPropertyBasedEvents = true;
      harness.toggles.propertyEventStart = 'note.eventStart';
      visibleWorkFeed(harness);
      provideSources(harness);
      expect(timers.pendingCount()).toBe(1);

      harness.provider.dispose();

      expect(timers.pendingCount()).toBe(0);
      expect(harness.basesDataUnsubscribeCount()).toBe(1);
    });

    it('one family\'s throwing dispose does not suppress sibling cleanup', () => {
      const timers = manualScheduler();
      const fixture = taskNotesPluginFixture({
        subscriptions: [{ id: 'work-cal', name: 'Work', enabled: true }],
      });
      let subscribeCalls = 0;
      const releasedSubscriptions: number[] = [];
      const deps: CalendarItemSourceDeps = {
        toggles: () => ({ ...allOffToggles(), showRecurring: true, showTimeEntries: true }),
        listTasks: () => [recurringTask, trackedTask],
        subscribe: () => {
          const ordinal = ++subscribeCalls;
          // The first subscriber (the recurring family) gets an unsubscribe
          // that throws on release; later families must still release.
          if (ordinal === 1) {
            return () => {
              throw new Error('release exploded');
            };
          }
          return () => {
            releasedSubscriptions.push(ordinal);
          };
        },
        getTaskNotesPlugin: () => fixture.plugin,
        visibleExternalFeeds: () => new Set([externalCalendarFeedKey('ics', 'work-cal')]),
        scheduler: timers.scheduler,
      };
      const provider = createCalendarItemSourcesProvider(deps);
      provider.provide();
      expect(timers.pendingCount()).toBe(1);

      provider.dispose();

      expect(releasedSubscriptions).toEqual([2]);
      expect(timers.pendingCount()).toBe(0);
      // The idempotency bookkeeping survived the throw: a second dispose
      // releases nothing again.
      provider.dispose();
      expect(releasedSubscriptions).toEqual([2]);
    });

    it('dispose is idempotent: a mount-bail dispose racing unload releases nothing twice', () => {
      // The mount path may dispose the provider on a stale-mount bail or an
      // init failure while unload disposes it again — the second call must be
      // a no-op, never a double release or a throw.
      const timers = manualScheduler();
      const fixture = taskNotesPluginFixture({
        subscriptions: [{ id: 'work-cal', name: 'Work', enabled: true }],
      });
      const harness = makeHarness([recurringTask], {
        taskNotesPlugin: fixture.plugin,
        scheduler: timers.scheduler,
      });
      harness.toggles.showRecurring = true;
      visibleWorkFeed(harness);
      provideSources(harness);
      harness.provider.dispose();
      const unsubscribesAfterFirst = harness.unsubscribeCount();
      expect(unsubscribesAfterFirst).toBeGreaterThan(0);

      harness.provider.dispose();

      expect(harness.unsubscribeCount()).toBe(unsubscribesAfterFirst);
      expect(timers.pendingCount()).toBe(0);
    });
  });
});

function provideSources(harness: Harness): readonly CalendarItemSource[] {
  return harness.provider.provide();
}
