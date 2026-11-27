/**
 * Recurring occupancy unit tests.
 *
 * Expected days are transcribed by hand. The shipped calendar fixtures live in
 * `recurringSource.fixtures.test.ts` and are not recomputed here.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { DEFAULT_FIELD_MAPPING, mapTaskFromFrontmatter, type FieldMapping } from '@tasknotes/model';
import {
  makeCalendarItemId,
  type CalendarDerivationWindow,
  type CalendarItemQueryContext,
} from '../../src/datasource/calendarItems';
import {
  createRecurringInstanceSource,
  expandRecurringOccupancy,
  type RecurringInstanceToggles,
  type RecurringSourceDeps,
} from '../../src/datasource/calendarItems/recurringSource';
import { hasRecordedRecurringOccurrences } from '../../src/controller/InstanceExpansion';
import type { RenderInstance } from '../../src/controller/InstanceExpansion';
import { TASKNOTES_CHANGE_EVENTS, type TaskNotesTaskInfo } from '../../src/datasource/TaskNotesSource';

/**
 * Default derivation window: 2026-01-05 (Mon) to 2026-02-03 exclusive — four
 * full weeks plus the boundary day. Tuesdays inside: Jan 6, 13, 20, 27; the
 * next Tuesday (Feb 3) sits exactly ON the exclusive end day.
 */
const WINDOW = { startDate: '2026-01-05', endDateExclusive: '2026-02-03' } as const;

const DEFAULT_TOGGLES: RecurringInstanceToggles = {
  showRecurring: true,
  showCompletedRecurringInstances: true,
  showSkippedRecurringInstances: true,
};

const STANDUP_PATH = 'routines/standup.md';

/** A weekly-Tuesday recurring task fixture (frontmatter-shaped TaskInfo). */
function weeklyTask(partial: Partial<TaskNotesTaskInfo> = {}): TaskNotesTaskInfo {
  return {
    path: STANDUP_PATH,
    title: 'Standup',
    recurrence: 'FREQ=WEEKLY;BYDAY=TU',
    scheduled: '2026-01-06',
    ...partial,
  };
}

function queryContext(window: CalendarDerivationWindow = WINDOW): CalendarItemQueryContext {
  return { window, tasks: () => [], basesEntries: () => [] };
}

function makeSource(
  tasks: readonly TaskNotesTaskInfo[],
  toggles: Partial<RecurringInstanceToggles> = {},
  deps: Partial<RecurringSourceDeps> = {},
) {
  return createRecurringInstanceSource({
    listTasks: () => tasks,
    toggles: () => ({ ...DEFAULT_TOGGLES, ...toggles }),
    ...deps,
  });
}

/** Collect and project a task's occupancy to comparable [day, state] pairs. */
async function collectStates(
  tasks: readonly TaskNotesTaskInfo[],
  toggles: Partial<RecurringInstanceToggles> = {},
  deps: Partial<RecurringSourceDeps> = {},
  path: string = STANDUP_PATH,
): Promise<Array<[string, string | undefined]>> {
  const batch = await makeSource(tasks, toggles, deps).collect(queryContext());
  return (batch.occupancyByTaskPath.get(path) ?? []).map((o) => [o.day, o.stateClass]);
}

describe('recurringSource — weekly expansion over the derivation window', () => {
  it('yields next + projected instances on the hand-computed Tuesdays, excluding the boundary day', async () => {
    const states = await collectStates([weeklyTask()]);

    // Feb 3 is a Tuesday on the exclusive end, so it is outside the window.
    expect(states).toEqual([
      ['2026-01-06', 'next'],
      ['2026-01-13', 'projected'],
      ['2026-01-20', 'projected'],
      ['2026-01-27', 'projected'],
    ]);
  });

  it('emits on the occupancy channel only, with day-granular synthetic-id entries', async () => {
    const batch = await makeSource([weeklyTask()]).collect(queryContext());

    expect(batch.items).toEqual([]);
    const occupancy = batch.occupancyByTaskPath.get(STANDUP_PATH)!;
    expect(occupancy[0]).toEqual({
      family: 'recurring-instance',
      itemId: makeCalendarItemId('recurring-instance', STANDUP_PATH, '2026-01-06'),
      day: '2026-01-06',
      minutes: null,
      stateClass: 'next',
    });
  });

  it('suppresses the plain scheduled→due bar while the family is on', async () => {
    const batch = await makeSource([weeklyTask()]).collect(queryContext());

    expect(batch.plainBarSuppressedTaskPaths?.has(STANDUP_PATH)).toBe(true);
  });
});

describe('recurringSource — recorded instances', () => {
  it('renders an off-pattern date present only in complete_instances as a completed instance', async () => {
    // Jan 15 is a Thursday — not on the weekly-Tuesday pattern.
    const states = await collectStates([weeklyTask({ complete_instances: ['2026-01-15'] })]);

    expect(states).toContainEqual(['2026-01-15', 'completed']);
    expect(states).toContainEqual(['2026-01-13', 'projected']);
  });

  it('marks a pattern date present in complete_instances as completed, not projected', async () => {
    const states = await collectStates([weeklyTask({ complete_instances: ['2026-01-13'] })]);

    expect(states).toContainEqual(['2026-01-13', 'completed']);
  });

  it('excludes recorded dates outside the window (exclusive end, inclusive start)', async () => {
    const states = await collectStates([
      weeklyTask({ complete_instances: ['2026-01-04', '2026-02-03'], skipped_instances: ['2026-01-05'] }),
    ]);

    const days = states.map(([day]) => day);
    expect(days).not.toContain('2026-01-04');
    expect(days).not.toContain('2026-02-03');
    expect(states).toContainEqual(['2026-01-05', 'skipped']);
  });

  it('drops an impossible recorded day instead of rolling it into the next month', async () => {
    // 2026-01-32 is inside the window lexically but not a real day; Date
    // construction would roll it to Feb 1, so it must be dropped entirely.
    const states = await collectStates([weeklyTask({ complete_instances: ['2026-01-32'] })]);

    const days = states.map(([day]) => day);
    expect(days).not.toContain('2026-01-32');
    expect(days).not.toContain('2026-02-01');
  });

  it('drops an impossible skipped day as well as a completed one', async () => {
    const states = await collectStates([weeklyTask({ skipped_instances: ['2026-01-32'] })]);

    expect(states.map(([day]) => day)).not.toContain('2026-01-32');
  });
});

describe('recurringSource — completed/skipped sub-toggles', () => {
  it('filters exactly the completed family when its sub-toggle is off', async () => {
    const states = await collectStates(
      [weeklyTask({ complete_instances: ['2026-01-13'], skipped_instances: ['2026-01-20'] })],
      { showCompletedRecurringInstances: false },
    );

    expect(states).toEqual([
      ['2026-01-06', 'next'],
      ['2026-01-20', 'skipped'],
      ['2026-01-27', 'projected'],
    ]);
  });

  it('filters exactly the skipped family when its sub-toggle is off', async () => {
    const states = await collectStates(
      [weeklyTask({ complete_instances: ['2026-01-13'], skipped_instances: ['2026-01-20'] })],
      { showSkippedRecurringInstances: false },
    );

    expect(states).toEqual([
      ['2026-01-06', 'next'],
      ['2026-01-13', 'completed'],
      ['2026-01-27', 'projected'],
    ]);
  });
});

describe('recurringSource — materialized occurrences', () => {
  const materializedNote: TaskNotesTaskInfo = {
    path: 'routines/standup 2026-01-13.md',
    title: 'Standup 2026-01-13',
    recurrence_parent: '[[standup]]',
    occurrence_date: '2026-01-13',
  };
  const resolveTaskReference = (linkPath: string): string | null =>
    linkPath === 'standup' ? STANDUP_PATH : null;

  it('suppresses the virtual instance for a materialized date and emits the materialized marker', async () => {
    const states = await collectStates([weeklyTask(), materializedNote], {}, { resolveTaskReference });

    expect(states).toEqual([
      ['2026-01-06', 'next'],
      ['2026-01-13', 'materialized'],
      ['2026-01-20', 'projected'],
      ['2026-01-27', 'projected'],
    ]);
  });

  it('ignores a materialized occurrence carrying an impossible date', async () => {
    const badNote: TaskNotesTaskInfo = {
      path: 'routines/standup bad.md',
      title: 'Standup bad',
      recurrence_parent: '[[standup]]',
      occurrence_date: '2026-01-32',
    };
    const states = await collectStates([weeklyTask(), badNote], {}, { resolveTaskReference });

    expect(states.map(([, state]) => state)).not.toContain('materialized');
    const days = states.map(([day]) => day);
    expect(days).not.toContain('2026-01-32');
    expect(days).not.toContain('2026-02-01');
  });

  it('threads the materialized note path onto its occupancy entry (piece-click target)', async () => {
    const batch = await makeSource([weeklyTask(), materializedNote], {}, { resolveTaskReference }).collect(
      queryContext(),
    );

    const entry = (batch.occupancyByTaskPath.get(STANDUP_PATH) ?? []).find(
      (o) => o.day === '2026-01-13',
    );
    expect(entry?.stateClass).toBe('materialized');
    expect(entry?.notePath).toBe(materializedNote.path);
  });

  it('gives the materialized note no recurring occupancy of its own', async () => {
    const batch = await makeSource([weeklyTask(), materializedNote], {}, { resolveTaskReference }).collect(
      queryContext(),
    );

    expect(batch.occupancyByTaskPath.has(materializedNote.path)).toBe(false);
  });

  it('replaces a recorded instance too when its date is materialized', async () => {
    const states = await collectStates(
      [weeklyTask({ complete_instances: ['2026-01-13'] }), materializedNote],
      {},
      { resolveTaskReference },
    );

    expect(states).toContainEqual(['2026-01-13', 'materialized']);
    expect(states).not.toContainEqual(['2026-01-13', 'completed']);
  });
});

describe('recurringSource — family off (R13)', () => {
  it('drops next/projected but keeps recorded and materialized entries, with no suppression', async () => {
    const materializedNote: TaskNotesTaskInfo = {
      path: 'routines/standup 2026-01-20.md',
      recurrence_parent: `[[${STANDUP_PATH}]]`,
      occurrence_date: '2026-01-20',
    };
    const batch = await makeSource(
      [
        weeklyTask({ complete_instances: ['2026-01-15'], skipped_instances: ['2026-01-16'] }),
        materializedNote,
      ],
      { showRecurring: false },
    ).collect(queryContext());

    expect((batch.occupancyByTaskPath.get(STANDUP_PATH) ?? []).map((o) => [o.day, o.stateClass])).toEqual([
      ['2026-01-15', 'completed'],
      ['2026-01-16', 'skipped'],
      ['2026-01-20', 'materialized'],
    ]);
    expect(batch.plainBarSuppressedTaskPaths?.has(STANDUP_PATH)).toBe(false);
    const renderedInstance: Pick<RenderInstance, 'occupancy'> = {
      occupancy: batch.occupancyByTaskPath.get(STANDUP_PATH),
    };
    expect(
      hasRecordedRecurringOccurrences([renderedInstance]),
    ).toBe(true);
  });
});

describe('recurringSource — guards', () => {
  it('yields zero instances and no suppression for a recurring task with no scheduled date', async () => {
    const batch = await makeSource([weeklyTask({ scheduled: null })]).collect(queryContext());

    expect(batch.occupancyByTaskPath.size).toBe(0);
    expect(batch.plainBarSuppressedTaskPaths?.has(STANDUP_PATH)).toBe(false);
  });

  it('emits nothing for an impossible scheduled day', async () => {
    const batch = await makeSource([weeklyTask({ scheduled: '2026-02-30' })]).collect(queryContext());

    expect(batch.occupancyByTaskPath.has(STANDUP_PATH)).toBe(false);
  });

  it('yields nothing for a task without a recurrence', async () => {
    const batch = await makeSource([{ path: 'plain.md', scheduled: '2026-01-06' }]).collect(queryContext());

    expect(batch.occupancyByTaskPath.size).toBe(0);
    expect(batch.plainBarSuppressedTaskPaths?.size ?? 0).toBe(0);
  });

  it('caps one series before constructing occupancy for a long-lived daily recurrence', async () => {
    const batch = await makeSource([
      weeklyTask({ recurrence: 'FREQ=DAILY', scheduled: '2000-01-01' }),
    ]).collect(
      queryContext({ startDate: '2000-01-01', endDateExclusive: '2030-01-01' }),
    );

    const occupancy = batch.occupancyByTaskPath.get(STANDUP_PATH) ?? [];
    expect(occupancy).toHaveLength(1_000);
    expect(occupancy[0]?.day).toBe('2027-04-07');
    expect(occupancy[1]?.day).toBe('2027-04-08');
    expect(occupancy.at(-1)?.day).toBe('2029-12-31');
  });

  it('finishes a multi-year daily series within the stated budget', () => {
    const started = performance.now();
    const batch = expandRecurringOccupancy({
      tasks: [weeklyTask({ recurrence: 'FREQ=DAILY', scheduled: '2000-01-01' })],
      window: { startDate: '2000-01-01', endDateExclusive: '2030-01-01' },
      toggles: DEFAULT_TOGGLES,
      timezone: 'UTC',
      now: '2026-01-01T00:00:00Z',
    });
    const elapsed = performance.now() - started;

    expect(batch.occupancyByTaskPath.get(STANDUP_PATH)).toHaveLength(1_000);
    expect(elapsed).toBeLessThan(5_000);
  });
});

describe('recurringSource — DTSTART quirk parity', () => {
  it('attributes a DTSTART wall time stamped Z to the same local days as the date-only rule', async () => {
    // 20:00 "Z" is really a local wall time misleadingly stamped Z (the
    // calendar's storage quirk); day attribution must stay the date part —
    // a +13:00-style observer must NOT see the days shift.
    const timed = await collectStates([
      weeklyTask({ recurrence: 'DTSTART:20260106T200000Z;FREQ=WEEKLY;BYDAY=TU' }),
    ]);
    const dateOnly = await collectStates([weeklyTask()]);

    expect(timed).toEqual(dateOnly);
    expect(timed.map(([day]) => day)).toEqual([
      '2026-01-06',
      '2026-01-13',
      '2026-01-20',
      '2026-01-27',
    ]);
  });

  it('expands a single-line date-valued weekly rule every week', async () => {
    const states = await collectStates([
      weeklyTask({ recurrence: 'DTSTART;VALUE=DATE:20260106;FREQ=WEEKLY' }),
    ]);

    expect(states.map(([day]) => day)).toEqual([
      '2026-01-06',
      '2026-01-13',
      '2026-01-20',
      '2026-01-27',
    ]);
  });

  it('reads a newline-terminated weekly rule as its next day and the following anniversary', async () => {
    const batch = await makeSource([
      weeklyTask({ recurrence: 'DTSTART:20260106;FREQ=WEEKLY\n' }),
    ]).collect(queryContext({ startDate: '2026-01-01', endDateExclusive: '2028-01-01' }));

    expect(batch.occupancyByTaskPath.get(STANDUP_PATH)?.map((entry) => [entry.day, entry.stateClass])).toEqual([
      ['2026-01-06', 'next'],
      ['2027-01-06', 'projected'],
    ]);
  });

  it('expands a weekly series when the task has no title', async () => {
    const states = await collectStates([weeklyTask({ title: undefined })]);

    expect(states.map(([day]) => day)).toEqual([
      '2026-01-06',
      '2026-01-13',
      '2026-01-20',
      '2026-01-27',
    ]);
  });

  it('emits the yearly occurrence that falls inside the derivation window', async () => {
    const batch = await makeSource([
      weeklyTask({
        recurrence: 'DTSTART:20260302T000000Z;FREQ=YEARLY',
        scheduled: '2026-03-02',
      }),
    ]).collect(
      queryContext({ startDate: '2020-01-01', endDateExclusive: '2027-03-01' }),
    );

    expect(batch.occupancyByTaskPath.get(STANDUP_PATH)?.map((entry) => entry.day)).toEqual([
      '2026-03-02',
    ]);
  });
});

const MARCH = { startDate: '2026-03-01', endDateExclusive: '2026-04-01' } as const;
const MOVED_PATH = 'tasks/moved.md';

function movedTask(partial: Partial<TaskNotesTaskInfo> = {}): TaskNotesTaskInfo {
  return {
    path: MOVED_PATH,
    title: 'Moved',
    recurrence: 'DTSTART:20260318;FREQ=DAILY;COUNT=3',
    scheduled: '2026-03-12',
    recurrence_original_date: '2026-03-18',
    ...partial,
  };
}

function occupancyId(path: string, identity: string): string {
  return makeCalendarItemId('recurring-instance', path, identity);
}

describe('recurringSource — moved occurrences and date guards', () => {
  it('draws a scheduled move once, on the new day, under its original identity', async () => {
    const batch = await makeSource([movedTask()]).collect(queryContext(MARCH));
    const occupancy = batch.occupancyByTaskPath.get(MOVED_PATH) ?? [];

    expect(occupancy.map((entry) => [entry.day, entry.stateClass, entry.itemId])).toEqual([
      ['2026-03-12', 'next', occupancyId(MOVED_PATH, '2026-03-18')],
      ['2026-03-19', 'projected', occupancyId(MOVED_PATH, '2026-03-19')],
      ['2026-03-20', 'projected', occupancyId(MOVED_PATH, '2026-03-20')],
    ]);
    expect(occupancy.map((entry) => entry.day)).not.toContain('2026-03-18');
  });

  it('keeps a completed moved occurrence completed on the day it was moved to', async () => {
    const batch = await makeSource([
      movedTask({ complete_instances: ['2026-03-18'] }),
    ]).collect(queryContext(MARCH));

    expect(batch.occupancyByTaskPath.get(MOVED_PATH)?.map((entry) => [entry.day, entry.stateClass, entry.itemId])).toEqual([
      ['2026-03-12', 'completed', occupancyId(MOVED_PATH, '2026-03-18')],
      ['2026-03-19', 'projected', occupancyId(MOVED_PATH, '2026-03-19')],
      ['2026-03-20', 'projected', occupancyId(MOVED_PATH, '2026-03-20')],
    ]);
  });

  it('ignores recurrence_original_date on a completion-anchored series', async () => {
    const batch = await makeSource([
      movedTask({
        recurrence: 'DTSTART:20260312;FREQ=DAILY;COUNT=8',
        recurrence_anchor: 'completion',
      }),
    ]).collect(queryContext(MARCH));
    const occupancy = batch.occupancyByTaskPath.get(MOVED_PATH) ?? [];

    expect(occupancy.find((entry) => entry.day === '2026-03-12')).toMatchObject({
      stateClass: 'next',
      itemId: occupancyId(MOVED_PATH, '2026-03-12'),
    });
    expect(occupancy.find((entry) => entry.day === '2026-03-18')).toMatchObject({
      stateClass: 'projected',
      itemId: occupancyId(MOVED_PATH, '2026-03-18'),
    });
  });

  it('keeps the higher-precedence identity when a move lands on another rule day', async () => {
    const batch = await makeSource([
      movedTask({
        scheduled: '2026-10-19',
        recurrence: 'DTSTART:20261012;FREQ=WEEKLY;COUNT=3',
        recurrence_original_date: '2026-10-12',
        complete_instances: ['2026-10-12'],
        skipped_instances: ['2026-10-19'],
        googleCalendarMovedOriginalDates: ['2026-10-26'],
      }),
    ]).collect(queryContext({ startDate: '2026-10-01', endDateExclusive: '2026-11-01' }));

    expect(batch.occupancyByTaskPath.get(MOVED_PATH)?.map((entry) => [entry.day, entry.stateClass, entry.itemId])).toEqual([
      ['2026-10-19', 'completed', occupancyId(MOVED_PATH, '2026-10-12')],
    ]);
  });

  it('keeps the earlier identity when two skipped occurrences share a day', async () => {
    const batch = await makeSource([
      movedTask({
        scheduled: '2026-03-19',
        recurrence: 'DTSTART:20260312;FREQ=WEEKLY',
        recurrence_original_date: '2026-03-12',
        skipped_instances: ['2026-03-12', '2026-03-19'],
      }),
    ]).collect(queryContext(MARCH));
    const onThe19th = (batch.occupancyByTaskPath.get(MOVED_PATH) ?? []).filter((entry) => entry.day === '2026-03-19');

    expect(onThe19th).toEqual([
      expect.objectContaining({
        stateClass: 'skipped',
        itemId: occupancyId(MOVED_PATH, '2026-03-12'),
      }),
    ]);
  });

  it('omits a rule day listed as a moved original date', async () => {
    const states = await collectStates([
      weeklyTask({
        recurrence: 'DTSTART:20260106;FREQ=DAILY;COUNT=3',
        scheduled: '2026-01-06',
        googleCalendarMovedOriginalDates: ['2026-01-07'],
      }),
    ]);

    expect(states).toEqual([
      ['2026-01-06', 'next'],
      ['2026-01-08', 'projected'],
    ]);
  });

  it('places a materialized note on its scheduled day and keeps the occurrence date as identity', async () => {
    const parent = 'tasks/series.md';
    const child = 'tasks/series 2026-03-10.md';
    const batch = await makeSource([
      {
        path: parent,
        title: 'Series',
        recurrence: 'DTSTART:20260310;FREQ=DAILY;COUNT=3',
        scheduled: '2026-03-10',
      },
      {
        path: child,
        title: 'Occurrence',
        recurrence_parent: parent,
        occurrence_date: '2026-03-10',
        scheduled: '2026-03-11',
      },
    ]).collect(queryContext(MARCH));
    const occupancy = batch.occupancyByTaskPath.get(parent) ?? [];

    expect(occupancy.find((entry) => entry.day === '2026-03-11')).toMatchObject({
      stateClass: 'materialized',
      itemId: occupancyId(parent, '2026-03-10'),
      notePath: child,
    });
    expect(occupancy.map((entry) => entry.day)).not.toContain('2026-03-10');
  });

  it('places a materialized note on its occurrence date when scheduled is not a real day', async () => {
    const parent = 'tasks/series.md';
    const child = 'tasks/series bad.md';
    const batch = await makeSource([
      {
        path: parent,
        title: 'Series',
        recurrence: 'DTSTART:20260310;FREQ=DAILY;COUNT=2',
        scheduled: '2026-03-10',
      },
      {
        path: child,
        recurrence_parent: parent,
        occurrence_date: '2026-03-10',
        scheduled: '2026-02-30',
      },
    ]).collect(queryContext(MARCH));

    expect(batch.occupancyByTaskPath.get(parent)?.find((entry) => entry.day === '2026-03-10')).toMatchObject({
      stateClass: 'materialized',
      itemId: occupancyId(parent, '2026-03-10'),
      notePath: child,
    });
  });

  it('puts a moved completed occurrence back on its rule day when recurring projection is off', async () => {
    const batch = await makeSource(
      [movedTask({ complete_instances: ['2026-03-18'] })],
      { showRecurring: false },
    ).collect(queryContext(MARCH));

    expect(batch.occupancyByTaskPath.get(MOVED_PATH)?.map((entry) => [entry.day, entry.stateClass, entry.itemId])).toEqual([
      ['2026-03-18', 'completed', occupancyId(MOVED_PATH, '2026-03-18')],
    ]);
    expect(batch.items).toEqual([]);
    expect(batch.plainBarSuppressedTaskPaths?.has(MOVED_PATH)).toBe(false);
  });

  it('accepts a scheduled clock time written with a space', async () => {
    const batch = await makeSource([
      weeklyTask({ scheduled: '2026-03-08 09:00', recurrence: 'FREQ=DAILY;COUNT=1' }),
    ]).collect(queryContext(MARCH));

    expect(batch.occupancyByTaskPath.get(STANDUP_PATH)?.map((entry) => [entry.day, entry.stateClass])).toEqual([
      ['2026-03-08', 'next'],
    ]);
  });

  it('drops an impossible completed day and keeps the series', async () => {
    const batch = await makeSource([
      weeklyTask({ complete_instances: ['2026-02-30', '2026-01-13'] }),
    ]).collect(queryContext({ startDate: '2026-01-05', endDateExclusive: '2026-04-01' }));
    const states = (batch.occupancyByTaskPath.get(STANDUP_PATH) ?? []).map((entry) => [entry.day, entry.stateClass]);

    expect(states).toContainEqual(['2026-01-06', 'next']);
    expect(states).toContainEqual(['2026-01-13', 'completed']);
    const days = states.map(([day]) => day);
    expect(days).not.toContain('2026-02-30');
    expect(days).not.toContain('2026-03-02');
  });
});

describe('recurringSource — a bad value does not hide the batch', () => {
  it('drops a child whose parent lookup throws and keeps the other series', async () => {
    const materializedNote: TaskNotesTaskInfo = {
      path: 'routines/standup 2026-01-13.md',
      title: 'Standup 2026-01-13',
      recurrence_parent: '[[standup]]',
      occurrence_date: '2026-01-13',
    };
    const states = await collectStates(
      [
        weeklyTask(),
        materializedNote,
        { path: 'notes/odd.md', recurrence_parent: '[[broken]]', occurrence_date: '2026-01-20' },
      ],
      {},
      {
        resolveTaskReference: (linkPath) => {
          if (linkPath === 'broken') throw new Error('lookup failed');
          return linkPath === 'standup' ? STANDUP_PATH : null;
        },
      },
    );

    expect(states).toContainEqual(['2026-01-06', 'next']);
    expect(states).toContainEqual(['2026-01-13', 'materialized']);
    expect(states).toContainEqual(['2026-01-20', 'projected']);
  });

  it('keeps other series when a parent link is named constructor', async () => {
    const states = await collectStates([
      weeklyTask(),
      {
        path: 'notes/odd.md',
        recurrence_parent: '[[constructor]]',
        occurrence_date: '2026-01-13',
      },
    ]);

    expect(states).toContainEqual(['2026-01-06', 'next']);
    expect(states).toContainEqual(['2026-01-13', 'projected']);
  });

  it('keeps a series when due is an invalid Date', async () => {
    const states = await collectStates([weeklyTask({ due: new Date(Number.NaN) })]);

    expect(states).toContainEqual(['2026-01-06', 'next']);
  });

  it('uses the occurrence date when a materialized scheduled Date is invalid', async () => {
    const parent = 'tasks/series.md';
    const child = 'tasks/series bad-date.md';
    const batch = await makeSource([
      {
        path: parent,
        title: 'Series',
        recurrence: 'DTSTART:20260310;FREQ=DAILY;COUNT=2',
        scheduled: '2026-03-10',
      },
      {
        path: child,
        recurrence_parent: parent,
        occurrence_date: '2026-03-10',
        scheduled: new Date(Number.NaN),
      },
    ]).collect(queryContext(MARCH));

    expect(batch.occupancyByTaskPath.get(parent)?.find((entry) => entry.day === '2026-03-10')).toMatchObject({
      stateClass: 'materialized',
      notePath: child,
    });
  });

  it('keeps a series when a time entry start is not text', async () => {
    const states = await collectStates([
      weeklyTask({
        complete_instances: ['2026-01-13'],
        timeEntries: [{ startTime: 123 as unknown as string }],
      }),
    ]);

    expect(states).toContainEqual(['2026-01-06', 'next']);
    expect(states).toContainEqual(['2026-01-13', 'completed']);
  });
});

describe('recurringSource — field-mapper resolution', () => {
  it('expands a task whose recurrence properties are user-remapped, resolved through the field mapper', async () => {
    // The calendar's read path: user frontmatter property names resolve to
    // canonical TaskInfo fields through the @tasknotes/model field mapper
    // (TaskNotes' FieldMapper delegates to mapTaskFromFrontmatter). The
    // engine consumes the canonical fields — never hardcoded property names.
    const mapping: FieldMapping = {
      ...DEFAULT_FIELD_MAPPING,
      recurrence: 'repeat-rule',
      scheduled: 'planned-for',
      completeInstances: 'done-days',
    };
    const mapped = mapTaskFromFrontmatter(
      mapping,
      {
        'repeat-rule': 'FREQ=WEEKLY;BYDAY=TU',
        'planned-for': '2026-01-06',
        'done-days': ['2026-01-15'],
      },
      'tasks/custom.md',
    );
    const task: TaskNotesTaskInfo = { ...mapped, path: 'tasks/custom.md' };

    const states = await collectStates([task], {}, {}, 'tasks/custom.md');

    expect(states).toContainEqual(['2026-01-06', 'next']);
    expect(states).toContainEqual(['2026-01-15', 'completed']);
  });
});

describe('recurringSource — epoch and change events', () => {
  it('bumps the epoch when a subscribed TaskNotes recurrence event fires and unsubscribes on dispose', () => {
    let handler: ((eventName: string, payload?: unknown) => void) | undefined;
    const unsubscribe = jest.fn();
    const source = makeSource([], {}, {
      subscribe: (h) => {
        handler = h;
        return unsubscribe;
      },
    });

    const before = source.epoch();
    handler!('task.recurrence.changed');
    const after = source.epoch();
    source.dispose();

    expect(after).toBe(before + 1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('lists the recurrence change events in the canonical TaskNotes subscription set', () => {
    expect(TASKNOTES_CHANGE_EVENTS).toContain('task.recurrence.changed');
    expect(TASKNOTES_CHANGE_EVENTS).toContain('recurring.instance.completed');
    expect(TASKNOTES_CHANGE_EVENTS).toContain('recurring.instance.skipped');
  });
});
