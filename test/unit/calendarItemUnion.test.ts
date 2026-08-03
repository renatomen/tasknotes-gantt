/**
 * Calendar-item union unit tests: the controller-side seam that merges
 * injected CalendarItemSource batches into the render snapshot alongside the
 * task pipeline.
 *
 * - Flat items from every source render as read-only rows AFTER all task rows.
 * - Per-task occupancy attachments merge onto the owning task's render
 *   instance(s) and never become rows.
 * - A source's epoch is the staleness signal: an unchanged epoch reuses the
 *   cached batch (no re-collect, no notify); a bump re-collects and notifies.
 * - No injected sources → the snapshot is identical to the task-only pipeline.
 * - Bar-activate resolution: backing note when present, else null (no-op).
 *
 * Following testing-standards.md: Jest, fake sources via DI, AAA.
 */

import { describe, it, expect } from '@jest/globals';
import type { App } from 'obsidian';
import { GanttController } from '../../src/controller/GanttController';
import {
  calendarDerivationWindow,
  unionCalendarBatches,
} from '../../src/controller/calendarItemUnion';
import type { RenderInstance } from '../../src/controller/InstanceExpansion';
import type {
  DataSource,
  DataSourceCapabilities,
  SourceDependency,
  SourceTask,
} from '../../src/datasource/types';
import {
  EXTERNAL_OCCUPANCY_STATE,
  makeCalendarItemId,
  type CalendarItem,
  type CalendarItemBatch,
  type CalendarItemFamily,
  type CalendarItemQueryContext,
  type CalendarItemSource,
  type CalendarOccupancy,
} from '../../src/datasource/calendarItems';

/** Concise SourceTask factory. */
function task(partial: Partial<SourceTask> & { path: string }): SourceTask {
  return {
    text: partial.path,
    start: new Date(2026, 0, 10),
    end: new Date(2026, 0, 12),
    progress: null,
    status: null,
    priority: null,
    parents: [],
    ...partial,
  };
}

/** Concise CalendarItem factory. */
function calendarItem(
  partial: Partial<CalendarItem> & { id: string; family: CalendarItemFamily },
): CalendarItem {
  return {
    title: partial.id,
    startDay: '2026-01-10',
    endDay: '2026-01-10',
    ...partial,
  };
}

/** A read-only task source over a fixed task set. */
class FakeTaskSource implements DataSource {
  public readonly capabilities: DataSourceCapabilities = { write: false };
  constructor(public tasks: SourceTask[]) {}
  async getTasks(): Promise<SourceTask[]> {
    return this.tasks;
  }
  async getDependencies(): Promise<SourceDependency[]> {
    return [];
  }
}

/** A controllable calendar-item source with an explicit epoch and batch. */
class FakeCalendarSource implements CalendarItemSource {
  public epochValue = 1;
  public collectCalls = 0;
  public lastContext: CalendarItemQueryContext | null = null;
  public windowStartAnchorValue: CalendarItemQueryContext['window']['startDate'] | null = null;
  constructor(
    public readonly family: CalendarItemFamily,
    public batch: CalendarItemBatch,
  ) {}
  epoch(): number {
    return this.epochValue;
  }
  windowStartAnchor(): CalendarItemQueryContext['window']['startDate'] | null {
    return this.windowStartAnchorValue;
  }
  async collect(context: CalendarItemQueryContext): Promise<CalendarItemBatch> {
    this.collectCalls += 1;
    this.lastContext = context;
    return this.batch;
  }
}

/** Batch with flat items only. */
function itemsBatch(items: CalendarItem[]): CalendarItemBatch {
  return { items, occupancyByTaskPath: new Map() };
}

const fakeApp = {} as App;

/** Build a controller over fake task + calendar sources. */
function makeController(opts: {
  tasks: SourceTask[];
  calendarSources?: readonly CalendarItemSource[];
}): GanttController {
  const source = new FakeTaskSource(opts.tasks);
  return new GanttController({
    app: fakeApp,
    basesInput: () => ({ entries: [], mappings: {} as never }),
    now: () => new Date(2026, 0, 15),
    deps: {
      createTaskNotesSource: async () => source,
      ...(opts.calendarSources
        ? { createCalendarItemSources: () => opts.calendarSources! }
        : {}),
    },
  });
}

describe('calendar-item union — derivation window', () => {
  it('extends dated spans from the existing margin through one year after today', () => {
    const window = calendarDerivationWindow(
      [{ start: new Date(2026, 0, 10), end: new Date(2026, 0, 12) }],
      new Date(2026, 0, 15),
    );

    expect(window).toEqual({
      startDate: '2025-11-09',
      endDateExclusive: '2027-01-15',
    });
  });

  it('anchors a future-only span at today across the local year boundary', () => {
    const window = calendarDerivationWindow(
      [{ start: new Date(2027, 5, 1), end: new Date(2027, 5, 2) }],
      new Date(2026, 11, 31, 23, 30),
    );

    expect(window).toEqual({
      startDate: '2026-12-31',
      endDateExclusive: '2027-12-31',
    });
  });

  it('clamps a leap-day annual horizon to the last valid local day', () => {
    const window = calendarDerivationWindow(
      [{ start: new Date(2024, 1, 29), end: new Date(2024, 1, 29) }],
      new Date(2024, 1, 29, 12),
    );

    expect(window.endDateExclusive).toBe('2025-02-28');
  });

  it('retains the today-centered margin when every task is undated', () => {
    const window = calendarDerivationWindow(
      [{ start: null, end: null }],
      new Date(2026, 0, 15),
    );

    expect(window).toEqual({
      startDate: '2025-11-14',
      endDateExclusive: '2026-03-19',
    });
  });

  it('includes an older Daily Note anchor when collecting timeblocks without tasks', async () => {
    const source = new FakeCalendarSource('timeblock', itemsBatch([]));
    source.windowStartAnchorValue = '2024-02-03';
    const controller = makeController({ tasks: [], calendarSources: [source] });

    await controller.init();

    expect(source.lastContext?.window).toEqual({
      startDate: '2024-02-03',
      endDateExclusive: '2026-03-19',
    });
  });
});

describe('calendar-item union — flat rows', () => {
  it('unions items from two sources as rows ordered after every task row', async () => {
    const timeblockId = makeCalendarItemId('timeblock', 'Daily/2026-01-10.md#tb-1');
    const externalId = makeCalendarItemId('external-event', 'work/standup', '2026-01-12');
    const timeblocks = new FakeCalendarSource(
      'timeblock',
      itemsBatch([calendarItem({ id: timeblockId, family: 'timeblock', title: 'Deep work' })]),
    );
    const external = new FakeCalendarSource(
      'external-event',
      itemsBatch([
        calendarItem({
          id: externalId,
          family: 'external-event',
          title: 'Standup',
          startDay: '2026-01-12',
          endDay: '2026-01-12',
        }),
      ]),
    );
    const controller = makeController({
      tasks: [task({ path: 'a.md' }), task({ path: 'b.md' })],
      calendarSources: [timeblocks, external],
    });

    await controller.init();
    const instances = await controller.getInstances();

    expect(instances.map((i) => i.sourcePath)).toEqual([
      'a.md',
      'b.md',
      timeblockId,
      externalId,
    ]);
    const timeblockRow = instances[2]!;
    expect(timeblockRow.text).toBe('Deep work');
    expect(timeblockRow.calendarItem?.family).toBe('timeblock');
    expect(timeblockRow.start).toEqual(new Date(2026, 0, 10));
    expect(timeblockRow.end).toEqual(new Date(2026, 0, 10, 23, 59, 59, 999));
  });

  it('hands each source a query context with a derivation window and accessors', async () => {
    const tasks = [task({ path: 'a.md' })];
    const source = new FakeCalendarSource('timeblock', itemsBatch([]));
    const controller = makeController({ tasks, calendarSources: [source] });

    await controller.init();

    const context = source.lastContext;
    expect(context).not.toBeNull();
    // The window is fixed per derivation and covers the task spans (with the
    // shared margin), expressed as local days.
    expect(context!.window.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(context!.window.endDateExclusive).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(context!.window.startDate < context!.window.endDateExclusive).toBe(true);
    expect(context!.tasks().map((t) => t.path)).toEqual(['a.md']);
    expect(context!.basesEntries()).toEqual([]);
  });
});

describe('calendar-item union — occupancy attachments', () => {
  it('merges occupancy onto the owning task instance and never adds rows', async () => {
    const entryId = makeCalendarItemId('time-entry', 'a.md', '2026-01-10');
    const occupancy: CalendarOccupancy = {
      family: 'time-entry',
      itemId: entryId,
      day: '2026-01-10',
      minutes: 90,
    };
    const source = new FakeCalendarSource('time-entry', {
      items: [],
      occupancyByTaskPath: new Map([
        ['a.md', [occupancy]],
        ['missing.md', [{ ...occupancy, itemId: makeCalendarItemId('time-entry', 'missing.md') }]],
      ]),
    });
    const controller = makeController({
      tasks: [task({ path: 'a.md' }), task({ path: 'b.md' })],
      calendarSources: [source],
    });

    await controller.init();
    const instances = await controller.getInstances();

    // No new rows — not for the owning task, not for the unmatched path.
    expect(instances.map((i) => i.sourcePath)).toEqual(['a.md', 'b.md']);
    expect(instances[0]!.occupancy).toEqual([occupancy]);
    expect(instances[1]!.occupancy).toBeUndefined();
  });
});

describe('calendar-item union — multi-occurrence series rows (occupancyDays)', () => {
  it('threads occupancyDays into per-day external-state occupancy in envelope mode', () => {
    const seriesId = makeCalendarItemId('external-event', 'daily-sync@e2e', '2026-01-10#09:00');
    const series = calendarItem({
      id: seriesId,
      family: 'external-event',
      title: 'Daily sync',
      startDay: '2026-01-10',
      endDay: '2026-01-14',
      occupancyDays: ['2026-01-10', '2026-01-12', '2026-01-14'],
    });

    const [row] = unionCalendarBatches([], [itemsBatch([series])]);

    // One occupancy entry per occupied day, carrying the dedicated external
    // state class; no backing note (an occurrence has none of its own).
    expect(row!.occupancy).toEqual([
      {
        family: 'external-event',
        itemId: seriesId,
        day: '2026-01-10',
        minutes: null,
        stateClass: EXTERNAL_OCCUPANCY_STATE,
      },
      {
        family: 'external-event',
        itemId: seriesId,
        day: '2026-01-12',
        minutes: null,
        stateClass: EXTERNAL_OCCUPANCY_STATE,
      },
      {
        family: 'external-event',
        itemId: seriesId,
        day: '2026-01-14',
        minutes: null,
        stateClass: EXTERNAL_OCCUPANCY_STATE,
      },
    ]);
    // Envelope mode: the item's span IS the occupancy envelope, so the sync
    // layer takes the suppressed-plain-bar path (pieces only, gaps unrendered).
    expect(row!.plainBarSuppressed).toBe(true);
    expect(row!.calendarItem).toBe(series);
  });

  it('keeps a single-span item a solid event row: no occupancy, no envelope flag', () => {
    const singleId = makeCalendarItemId('external-event', 'ics:feed', '2026-01-12');
    const single = calendarItem({
      id: singleId,
      family: 'external-event',
      startDay: '2026-01-12',
      endDay: '2026-01-12',
    });

    const [row] = unionCalendarBatches([], [itemsBatch([single])]);

    expect(row!.occupancy).toBeUndefined();
    expect(row!.plainBarSuppressed).toBeUndefined();
  });
});

describe('calendar-item union — epoch staleness signal', () => {
  it('reuses the cached batch while both the derivation window and epoch are unchanged', async () => {
    const source = new FakeCalendarSource(
      'timeblock',
      itemsBatch([
        calendarItem({
          id: makeCalendarItemId('timeblock', 'Daily.md#tb-1'),
          family: 'timeblock',
        }),
      ]),
    );
    const controller = makeController({
      tasks: [task({ path: 'a.md' })],
      calendarSources: [source],
    });
    await controller.init();
    let notifications = 0;
    controller.onChange(() => {
      notifications += 1;
    });

    await controller.refreshSource();

    expect(source.collectCalls).toBe(1);
    expect(notifications).toBe(0);
  });

  it('re-collects when a task widens the derivation window at an unchanged epoch', async () => {
    const tasks = [task({ path: 'a.md' })];
    const source = new FakeCalendarSource('timeblock', itemsBatch([]));
    const controller = makeController({ tasks, calendarSources: [source] });
    await controller.init();
    const initialWindow = source.lastContext!.window;

    tasks[0]!.end = new Date(2028, 1, 1);
    await controller.refreshSource();

    expect(source.epochValue).toBe(1);
    expect(source.collectCalls).toBe(2);
    expect(source.lastContext!.window.startDate).toBe(initialWindow.startDate);
    expect(source.lastContext!.window.endDateExclusive).not.toBe(
      initialWindow.endDateExclusive,
    );
  });

  it('re-collects on an epoch bump and notifies with the new items', async () => {
    const source = new FakeCalendarSource('timeblock', itemsBatch([]));
    const controller = makeController({
      tasks: [task({ path: 'a.md' })],
      calendarSources: [source],
    });
    await controller.init();
    let notifications = 0;
    controller.onChange(() => {
      notifications += 1;
    });
    const addedId = makeCalendarItemId('timeblock', 'Daily.md#tb-2');

    source.batch = itemsBatch([
      calendarItem({ id: addedId, family: 'timeblock', title: 'Added block' }),
    ]);
    source.epochValue = 2;
    await controller.refreshSource();

    expect(source.collectCalls).toBe(2);
    expect(notifications).toBe(1);
    const instances = await controller.getInstances();
    expect(instances.map((i) => i.sourcePath)).toEqual(['a.md', addedId]);
  });

  it('notifies when only a calendar item occupancyDays value changes', async () => {
    const seriesId = makeCalendarItemId('external-event', 'work/standup');
    const source = new FakeCalendarSource(
      'external-event',
      itemsBatch([
        calendarItem({
          id: seriesId,
          family: 'external-event',
          startDay: '2026-01-10',
          endDay: '2026-01-14',
          occupancyDays: ['2026-01-11'],
        }),
      ]),
    );
    const controller = makeController({ tasks: [], calendarSources: [source] });
    await controller.init();
    let notifications = 0;
    controller.onChange(() => {
      notifications += 1;
    });

    source.batch = itemsBatch([
      calendarItem({
        id: seriesId,
        family: 'external-event',
        startDay: '2026-01-10',
        endDay: '2026-01-14',
        occupancyDays: ['2026-01-12'],
      }),
    ]);
    source.epochValue += 1;
    await controller.refreshSource();

    expect(notifications).toBe(1);
    expect((await controller.getInstances())[0]!.calendarItem?.occupancyDays).toEqual([
      '2026-01-12',
    ]);
  });
});

describe('calendar-item union — inert default', () => {
  it('yields a snapshot identical to the task-only pipeline when every family is off', async () => {
    const tasks = [task({ path: 'a.md' }), task({ path: 'b.md', parents: ['a.md'] })];
    const withoutSeam = makeController({ tasks });
    const withEmptySeam = makeController({ tasks, calendarSources: [] });

    await withoutSeam.init();
    await withEmptySeam.init();

    const baseline = await withoutSeam.getInstances();
    expect(baseline.length).toBeGreaterThan(0); // the baseline itself renders
    expect(await withEmptySeam.getInstances()).toEqual(baseline);
  });

  it('returns the task instance list unchanged (same reference) with no batches', () => {
    const instances: readonly RenderInstance[] = [];

    expect(unionCalendarBatches(instances, [])).toBe(instances);
  });
});

describe('calendar-item union — bar-activate resolution', () => {
  it('resolves a backing note when present and nothing when absent', async () => {
    const backedId = makeCalendarItemId('time-entry', 'a.md', '2026-01-10');
    const notelessId = makeCalendarItemId('external-event', 'work/standup', '2026-01-12');
    const source = new FakeCalendarSource(
      'time-entry',
      itemsBatch([
        calendarItem({ id: backedId, family: 'time-entry', notePath: 'a.md' }),
        calendarItem({ id: notelessId, family: 'external-event' }),
      ]),
    );
    const controller = makeController({
      tasks: [task({ path: 'a.md' })],
      calendarSources: [source],
    });

    await controller.init();

    expect(controller.resolveBarActivationPath('a.md')).toBe('a.md');
    expect(controller.resolveBarActivationPath(backedId)).toBe('a.md');
    expect(controller.resolveBarActivationPath(notelessId)).toBeNull();
  });
});
