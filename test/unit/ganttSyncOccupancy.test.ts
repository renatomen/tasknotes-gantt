/**
 * Recurring-row occupancy rendering at the ganttSync seam (calendar-view
 * union): the envelope span that replaces a suppressed plain bar, the
 * whole-day occupancy runs with per-instance state classes, the recurring
 * type cue, plain-bar suppression semantics, the materialized dual
 * representation, and piece-level click routing.
 *
 * Following testing-standards.md: Jest, pure fixtures, AAA.
 */

import { describe, it, expect } from '@jest/globals';
import {
  buildSvarTasks,
  buildInstanceCueTaskTypes,
  buildTreatmentTaskTypes,
  planTaskSync,
  taskStateKey,
  DATE_STATUS_TYPE,
  EVENT_TYPE,
  RECURRING_TYPE,
  type SvarTaskInputs,
} from '../../src/bases/ganttSync';
import { unionCalendarBatches } from '../../src/controller/calendarItemUnion';
import type { RenderInstance } from '../../src/controller/InstanceExpansion';
import {
  EXTERNAL_OCCUPANCY_STATE,
  makeCalendarItemId,
  type CalendarItemBatch,
  type CalendarOccupancy,
  type LocalDay,
} from '../../src/datasource/calendarItems';

const STANDUP_PATH = 'routines/standup.md';

/** Minimal RenderInstance factory with sane defaults. */
function inst(over: Partial<RenderInstance> & { id: string }): RenderInstance {
  return {
    id: over.id,
    sourcePath: over.sourcePath ?? over.id,
    text: over.text ?? over.id,
    start: over.start ?? new Date(2026, 0, 6),
    end: over.end ?? new Date(2026, 0, 6, 23, 59, 59, 999),
    progress: over.progress ?? 0,
    parent: over.parent,
    isVirtual: false,
    isCollapsed: false,
    dateStatus: over.dateStatus ?? 'complete',
    estimateMinutes: null,
    status: null,
    priority: null,
    isFetched: false,
    isTopLevelPlacement: false,
    occupancy: over.occupancy,
    plainBarSuppressed: over.plainBarSuppressed,
  };
}

function inputs(over: Partial<SvarTaskInputs>): SvarTaskInputs {
  return {
    instances: over.instances ?? [],
    links: [],
    statusColors: [],
    barFillSource: 'default',
    showDateIndicators: over.showDateIndicators ?? true,
    arrowMode: 'primary',
  };
}

/** One recurring-instance occupancy entry for a day. */
function occ(day: string, stateClass: string, notePath?: string): CalendarOccupancy {
  return {
    family: 'recurring-instance',
    itemId: makeCalendarItemId('recurring-instance', STANDUP_PATH, day),
    day,
    minutes: null,
    stateClass,
    ...(notePath === undefined ? {} : { notePath }),
  };
}

describe('buildSvarTasks — occupancy envelope (family on, plain bar suppressed)', () => {
  it('replaces a suppressed row\'s plain span with the envelope, ending at end-of-day', () => {
    const [task] = buildSvarTasks(
      inputs({
        instances: [
          inst({
            id: STANDUP_PATH,
            start: new Date(2026, 0, 6),
            end: new Date(2026, 0, 6, 23, 59, 59, 999),
            occupancy: [occ('2026-01-06', 'next'), occ('2026-01-13', 'projected'), occ('2026-01-20', 'projected')],
            plainBarSuppressed: true,
          }),
        ],
      }),
    );

    expect(task!.start).toEqual(new Date(2026, 0, 6));
    // The envelope's end lands on the last occupied day's end-of-day — a
    // midnight end would render the bar one column short.
    expect(task!.end).toEqual(new Date(2026, 0, 20, 23, 59, 59, 999));
    expect(task!.custom.occupancyEnvelope).toBe(true);
  });

  it('attaches whole-day occupancy runs preserving each instance state', () => {
    const [task] = buildSvarTasks(
      inputs({
        instances: [
          inst({
            id: STANDUP_PATH,
            occupancy: [
              occ('2026-01-06', 'next'),
              occ('2026-01-13', 'projected'),
              occ('2026-01-14', 'completed'),
              occ('2026-01-15', 'skipped'),
              occ('2026-01-20', 'materialized', 'routines/standup 2026-01-20.md'),
            ],
            plainBarSuppressed: true,
          }),
        ],
      }),
    );

    expect(task!.custom.occupancyRuns).toEqual([
      { startDate: '2026-01-06', days: 1, stateClass: 'next', notePath: undefined },
      { startDate: '2026-01-13', days: 1, stateClass: 'projected', notePath: undefined },
      { startDate: '2026-01-14', days: 1, stateClass: 'completed', notePath: undefined },
      { startDate: '2026-01-15', days: 1, stateClass: 'skipped', notePath: undefined },
      {
        startDate: '2026-01-20',
        days: 1,
        stateClass: 'materialized',
        notePath: 'routines/standup 2026-01-20.md',
      },
    ]);
  });

  it('stamps the recurring cue and the composed type round-trips through registration', () => {
    const [task] = buildSvarTasks(
      inputs({
        instances: [
          inst({
            id: STANDUP_PATH,
            dateStatus: 'inferred-end',
            occupancy: [occ('2026-01-06', 'next')],
            plainBarSuppressed: true,
          }),
        ],
      }),
    );

    const expected = `${DATE_STATUS_TYPE} ${RECURRING_TYPE}`;
    expect(task!.type).toBe(expected);
    // The coupling contract: the whole composed string must be registered, or
    // SVAR's whole-string match silently drops the cue back to plain `task`.
    const registered = buildInstanceCueTaskTypes(
      buildTreatmentTaskTypes({ status: [], priority: [], calendar: [] }).map((t) => t.id),
    ).map((t) => t.id);
    expect(registered).toContain(expected);
  });

  it('keeps the plain bar for a suppressed task with no occupancy (families filtered out)', () => {
    const start = new Date(2026, 0, 6);
    const end = new Date(2026, 0, 8, 23, 59, 59, 999);
    const [task] = buildSvarTasks(
      inputs({ instances: [inst({ id: STANDUP_PATH, start, end, plainBarSuppressed: true })] }),
    );

    expect(task!.start).toEqual(start);
    expect(task!.end).toEqual(end);
    expect(task!.custom.occupancyRuns).toBeUndefined();
    expect(task!.custom.occupancyEnvelope).toBeUndefined();
    expect(task!.type).not.toContain(RECURRING_TYPE);
  });
});

describe('buildSvarTasks — family off, recorded pieces (plain bar retained)', () => {
  it('retains the plain span and overlays the recorded occupancy pieces', () => {
    const start = new Date(2026, 0, 5);
    const end = new Date(2026, 0, 30, 23, 59, 59, 999);
    const [task] = buildSvarTasks(
      inputs({
        instances: [
          inst({
            id: STANDUP_PATH,
            start,
            end,
            occupancy: [occ('2026-01-15', 'completed'), occ('2026-01-16', 'skipped')],
          }),
        ],
      }),
    );

    expect(task!.start).toEqual(start);
    expect(task!.end).toEqual(end);
    expect(task!.custom.occupancyEnvelope).toBeUndefined();
    expect(task!.custom.occupancyRuns?.map((r) => [r.startDate, r.stateClass])).toEqual([
      ['2026-01-15', 'completed'],
      ['2026-01-16', 'skipped'],
    ]);
  });
});

describe('buildSvarTasks — family off, recorded outside the plain span (union envelope)', () => {
  it('switches to the union envelope and injects a plain-state run over the scheduled→due days', () => {
    const [task] = buildSvarTasks(
      inputs({
        instances: [
          inst({
            id: STANDUP_PATH,
            start: new Date(2026, 0, 5),
            end: new Date(2026, 0, 8, 23, 59, 59, 999),
            occupancy: [occ('2026-01-06', 'completed'), occ('2026-01-15', 'skipped')],
          }),
        ],
      }),
    );

    // The span covers the union of the plain scheduled→due days and every
    // occupied day, ending end-of-day so the last column renders full width.
    expect(task!.start).toEqual(new Date(2026, 0, 5));
    expect(task!.end).toEqual(new Date(2026, 0, 15, 23, 59, 59, 999));
    // Split like the suppressed case: the host bar goes transparent and only
    // the pieces paint — the plain run stands in for the plain bar.
    expect(task!.custom.occupancyEnvelope).toBe(true);
    // The plain run covers the FULL scheduled→due span and comes FIRST: the
    // piece layer resolves days last-write-wins, so the recorded day inside
    // the span (Jan 6) keeps its recorded state and the plain piece paints
    // only the unclaimed days.
    expect(task!.custom.occupancyRuns).toEqual([
      { startDate: '2026-01-05', days: 4, stateClass: 'plain' },
      { startDate: '2026-01-06', days: 1, stateClass: 'completed', notePath: undefined },
      { startDate: '2026-01-15', days: 1, stateClass: 'skipped', notePath: undefined },
    ]);
  });

  it('extends the envelope backwards for a recorded day before the plain start', () => {
    const [task] = buildSvarTasks(
      inputs({
        instances: [
          inst({
            id: STANDUP_PATH,
            start: new Date(2026, 0, 5),
            end: new Date(2026, 0, 8, 23, 59, 59, 999),
            occupancy: [occ('2026-01-02', 'completed')],
          }),
        ],
      }),
    );

    expect(task!.start).toEqual(new Date(2026, 0, 2));
    expect(task!.end).toEqual(new Date(2026, 0, 8, 23, 59, 59, 999));
    expect(task!.custom.occupancyEnvelope).toBe(true);
    expect(task!.custom.occupancyRuns).toEqual([
      { startDate: '2026-01-05', days: 4, stateClass: 'plain' },
      { startDate: '2026-01-02', days: 1, stateClass: 'completed', notePath: undefined },
    ]);
  });
});

describe('union + ganttSync pipeline — materialized dual representation', () => {
  it('renders a materialized occurrence as its own row AND as the marked piece on the parent', () => {
    const materializedPath = 'routines/standup 2026-01-13.md';
    const parent = inst({ id: STANDUP_PATH });
    const child = inst({
      id: materializedPath,
      start: new Date(2026, 0, 13),
      end: new Date(2026, 0, 13, 23, 59, 59, 999),
    });
    const batch: CalendarItemBatch = {
      items: [],
      occupancyByTaskPath: new Map([
        [
          STANDUP_PATH,
          [occ('2026-01-06', 'next'), occ('2026-01-13', 'materialized', materializedPath)],
        ],
      ]),
      plainBarSuppressedTaskPaths: new Set([STANDUP_PATH]),
    };

    const unioned = unionCalendarBatches([parent, child], [batch]);
    const tasks = buildSvarTasks(inputs({ instances: [...unioned] }));

    // Its own task row survives the union untouched…
    const childTask = tasks.find((t) => t.id === materializedPath);
    expect(childTask).toBeDefined();
    expect(childTask!.custom.occupancyRuns).toBeUndefined();
    // …and the parent's envelope carries the marked materialized piece.
    const parentTask = tasks.find((t) => t.id === STANDUP_PATH)!;
    expect(parentTask.custom.occupancyEnvelope).toBe(true);
    expect(parentTask.custom.occupancyRuns).toContainEqual({
      startDate: '2026-01-13',
      days: 1,
      stateClass: 'materialized',
      notePath: materializedPath,
    });
    expect(parentTask.start).toEqual(new Date(2026, 0, 6));
    expect(parentTask.end).toEqual(new Date(2026, 0, 13, 23, 59, 59, 999));
  });
});

describe('union + ganttSync pipeline — external series event rows (occupancyDays)', () => {
  const SERIES_ID = makeCalendarItemId('external-event', 'daily-sync@e2e', '2026-01-10#09:00');

  /** The external series row shaped through union + sync, occupying `days`. */
  function buildSeriesRow(days: readonly LocalDay[]) {
    const batch: CalendarItemBatch = {
      items: [
        {
          id: SERIES_ID,
          family: 'external-event',
          title: 'Daily sync',
          startDay: days[0]!,
          endDay: days[days.length - 1]!,
          occupancyDays: days,
        },
      ],
      occupancyByTaskPath: new Map(),
    };
    return buildSvarTasks(inputs({ instances: [...unionCalendarBatches([], [batch])] }))[0]!;
  }

  it('renders the series through the suppressed-envelope path: one external run per occupied day', () => {
    const row = buildSeriesRow(['2026-01-10', '2026-01-12', '2026-01-14']);

    expect(row.custom.occupancyRuns).toEqual([
      { startDate: '2026-01-10', days: 1, stateClass: EXTERNAL_OCCUPANCY_STATE, notePath: undefined },
      { startDate: '2026-01-12', days: 1, stateClass: EXTERNAL_OCCUPANCY_STATE, notePath: undefined },
      { startDate: '2026-01-14', days: 1, stateClass: EXTERNAL_OCCUPANCY_STATE, notePath: undefined },
    ]);
    // The span IS the envelope (first..last occupied day, end-of-day), the
    // host bar splits, and only the pieces paint — no synthetic plain run.
    expect(row.custom.occupancyEnvelope).toBe(true);
    expect(row.start).toEqual(new Date(2026, 0, 10));
    expect(row.end).toEqual(new Date(2026, 0, 14, 23, 59, 59, 999));
  });

  it('keeps the og-event cue alone — the recurring cue stays a task-row cue', () => {
    const row = buildSeriesRow(['2026-01-10', '2026-01-11', '2026-01-12']);

    // `og-recurring og-event` is not a registered composition, so composing
    // both would silently collapse the type to plain `task` in SVAR and drop
    // the read-only affordances. The event cue must survive registration.
    expect(row.type).toBe(EVENT_TYPE);
    const registered = buildInstanceCueTaskTypes(
      buildTreatmentTaskTypes({ status: [], priority: [], calendar: [] }).map((t) => t.id),
    ).map((t) => t.id);
    expect(registered).toContain(row.type);
    // The switcher must hide this row under external-event, never recurring.
    expect(row.custom.calendarItemFamily).toBe('external-event');
    expect(row.custom.hasRecurringOccupancy).toBeUndefined();
  });

  it('folds the occupied days into taskStateKey so a moved occurrence re-issues the row', () => {
    const before = buildSeriesRow(['2026-01-10', '2026-01-11', '2026-01-14']);
    const after = buildSeriesRow(['2026-01-10', '2026-01-12', '2026-01-14']);

    // Same envelope span — only the middle occupied day moved.
    expect(after.start).toEqual(before.start);
    expect(after.end).toEqual(before.end);
    expect(taskStateKey(after)).not.toBe(taskStateKey(before));
  });
});

describe('planTaskSync — occupancy attaching to an existing row stays in-place', () => {
  it('plans the plain→union-envelope flip as one update: zero adds, deletes, moves', () => {
    // The enrichment moment: the first render pass shaped the row WITHOUT
    // occupancy (TaskNotes facts not served yet); the next pass attaches the
    // recorded occupancy and the span becomes the union envelope. SVAR keys
    // bar elements by task id, so only a delete+add would unmount the bar —
    // this pins the flip to the in-place `update-task` path.
    const base = {
      id: STANDUP_PATH,
      start: new Date(2026, 0, 5),
      end: new Date(2026, 0, 8, 23, 59, 59, 999),
    };
    const before = buildSvarTasks(inputs({ instances: [inst(base)] }));
    const after = buildSvarTasks(
      inputs({
        instances: [
          inst({
            ...base,
            occupancy: [occ('2026-01-06', 'completed'), occ('2026-01-15', 'skipped')],
          }),
        ],
      }),
    );

    const plan = planTaskSync(new Map(before.map((t) => [t.id, t])), after);

    expect(plan.updates.map((u) => u.id)).toEqual([STANDUP_PATH]);
    expect(plan.updates[0]!.task.custom.occupancyEnvelope).toBe(true);
    expect(plan.adds).toEqual([]);
    expect(plan.deletes).toEqual([]);
    expect(plan.moves).toEqual([]);
  });

  it('plans the envelope release (family toggled off, no recorded days) the same way', () => {
    const base = {
      id: STANDUP_PATH,
      start: new Date(2026, 0, 5),
      end: new Date(2026, 0, 8, 23, 59, 59, 999),
    };
    const enveloped = buildSvarTasks(
      inputs({
        instances: [
          inst({
            ...base,
            occupancy: [occ('2026-01-06', 'next'), occ('2026-01-13', 'projected')],
            plainBarSuppressed: true,
          }),
        ],
      }),
    );
    const plain = buildSvarTasks(inputs({ instances: [inst(base)] }));

    const plan = planTaskSync(new Map(enveloped.map((t) => [t.id, t])), plain);

    expect(plan.updates.map((u) => u.id)).toEqual([STANDUP_PATH]);
    expect(plan.adds).toEqual([]);
    expect(plan.deletes).toEqual([]);
    expect(plan.moves).toEqual([]);
  });
});

describe('taskStateKey — occupancy folds into the diff fingerprint', () => {
  it('re-issues the task when an instance state flips on an unchanged span', () => {
    const build = (stateClass: string) =>
      buildSvarTasks(
        inputs({
          instances: [
            inst({
              id: STANDUP_PATH,
              occupancy: [occ('2026-01-13', stateClass)],
              plainBarSuppressed: true,
            }),
          ],
        }),
      )[0]!;

    expect(taskStateKey(build('projected'))).not.toBe(taskStateKey(build('completed')));
  });
});
