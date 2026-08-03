/**
 * Time-entry calendar-item source unit tests.
 *
 * Finished time entries become flat read-only event rows, day-attributed from
 * their offset-stamped timestamps (absolute instants converted to the
 * observer's local day). The observer zone cannot be pinned under Jest, so
 * timestamp fixtures are built dynamically from machine-local wall times —
 * where the offset conversion is the behavior under test, the fixture is
 * stamped with a foreign offset and a sanity assertion proves its wall date
 * differs from the expected local day. Running entries (no `endTime`) and
 * unparseable timestamps drop the entry, never the derivation.
 *
 * Following testing-standards.md: Jest, pure fixtures via DI, AAA.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { makeCalendarItemId, type CalendarItemQueryContext } from '../../src/datasource/calendarItems';
import {
  createTimeEntrySource,
  type TimeEntrySourceDeps,
  type TimeEntryToggles,
} from '../../src/datasource/calendarItems/timeEntrySource';
import {
  TASKNOTES_CHANGE_EVENTS,
  type TaskNotesTaskInfo,
  type TaskNotesTimeEntry,
} from '../../src/datasource/TaskNotesSource';

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** Express an absolute instant as an ISO string at the given UTC offset. */
function isoAtOffset(instant: Date, offsetMinutes: number): string {
  const wall = new Date(instant.getTime() + offsetMinutes * 60_000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return (
    `${pad(wall.getUTCFullYear(), 4)}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}` +
    `T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}:${pad(wall.getUTCSeconds())}` +
    `${sign}${pad(Math.trunc(abs / 60))}:${pad(abs % 60)}`
  );
}

/** Express an absolute instant as an ISO string at the observer's own offset. */
function isoAtLocalOffset(instant: Date): string {
  return isoAtOffset(instant, -instant.getTimezoneOffset());
}

const REPORT_PATH = 'work/report.md';

function taskWithEntries(entries: readonly TaskNotesTimeEntry[]): TaskNotesTaskInfo {
  return { path: REPORT_PATH, title: 'Write report', timeEntries: entries };
}

/** A finished one-hour morning entry on local 2026-08-03. */
function morningEntry(): TaskNotesTimeEntry {
  return {
    startTime: isoAtLocalOffset(new Date(2026, 7, 3, 9, 0, 0)),
    endTime: isoAtLocalOffset(new Date(2026, 7, 3, 10, 0, 0)),
    duration: 60,
  };
}

const CONTEXT: CalendarItemQueryContext = {
  window: { startDate: '2026-08-01', endDateExclusive: '2026-09-01' },
  tasks: () => [],
  basesEntries: () => [],
};

function makeSource(
  tasks: readonly TaskNotesTaskInfo[],
  toggles: TimeEntryToggles = { showTimeEntries: true },
  deps: Partial<TimeEntrySourceDeps> = {},
) {
  return createTimeEntrySource({
    listTasks: () => tasks,
    toggles: () => toggles,
    ...deps,
  });
}

describe('timeEntrySource — flat event rows from finished entries', () => {
  it('renders one flat read-only row per finished entry, carrying title and note path', async () => {
    const entry = morningEntry();

    const batch = await makeSource([taskWithEntries([entry])]).collect(CONTEXT);

    expect(batch.items).toEqual([
      {
        id: makeCalendarItemId('time-entry', REPORT_PATH, `2026-08-03#${entry.startTime}`),
        family: 'time-entry',
        title: 'Write report',
        startDay: '2026-08-03',
        endDay: '2026-08-03',
        notePath: REPORT_PATH,
      },
    ]);
    expect(batch.occupancyByTaskPath.size).toBe(0);
  });

  it('attributes an offset-stamped entry to the observer-local day, not its wall date', async () => {
    // 00:30–00:45 local on Aug 4, stamped at an offset one hour behind the
    // observer's — the wall clock still reads Aug 3 there.
    const start = new Date(2026, 7, 4, 0, 30, 0);
    const offset = -start.getTimezoneOffset() - 60;
    const entry: TaskNotesTimeEntry = {
      startTime: isoAtOffset(start, offset),
      endTime: isoAtOffset(new Date(2026, 7, 4, 0, 45, 0), offset),
    };
    expect(entry.startTime.startsWith('2026-08-03T23:30:00')).toBe(true);

    const batch = await makeSource([taskWithEntries([entry])]).collect(CONTEXT);

    expect(batch.items).toHaveLength(1);
    expect(batch.items[0]).toMatchObject({ startDay: '2026-08-04', endDay: '2026-08-04' });
    expect(batch.items[0]?.id).toBe(
      makeCalendarItemId('time-entry', REPORT_PATH, `2026-08-04#${entry.startTime}`),
    );
  });

  it('spans both days inclusively when an entry crosses local midnight', async () => {
    const entry: TaskNotesTimeEntry = {
      startTime: isoAtLocalOffset(new Date(2026, 7, 3, 23, 30, 0)),
      endTime: isoAtLocalOffset(new Date(2026, 7, 4, 0, 30, 0)),
    };

    const batch = await makeSource([taskWithEntries([entry])]).collect(CONTEXT);

    expect(batch.items[0]).toMatchObject({ startDay: '2026-08-03', endDay: '2026-08-04' });
  });

  it('excludes the end day when a finished entry stops exactly at local midnight', async () => {
    const entry: TaskNotesTimeEntry = {
      startTime: isoAtLocalOffset(new Date(2026, 7, 3, 22, 0, 0)),
      endTime: isoAtLocalOffset(new Date(2026, 7, 4, 0, 0, 0)),
    };

    const batch = await makeSource([taskWithEntries([entry])]).collect(CONTEXT);

    expect(batch.items[0]).toMatchObject({ startDay: '2026-08-03', endDay: '2026-08-03' });
  });

  it('gives a zero-length entry a one-day span', async () => {
    const nineAm = isoAtLocalOffset(new Date(2026, 7, 3, 9, 0, 0));
    const entry: TaskNotesTimeEntry = { startTime: nineAm, endTime: nineAm };

    const batch = await makeSource([taskWithEntries([entry])]).collect(CONTEXT);

    expect(batch.items[0]).toMatchObject({ startDay: '2026-08-03', endDay: '2026-08-03' });
  });
});

describe('timeEntrySource — exclusions', () => {
  it('excludes a running entry (no endTime) while keeping finished siblings', async () => {
    const running: TaskNotesTimeEntry = {
      startTime: isoAtLocalOffset(new Date(2026, 7, 3, 11, 0, 0)),
    };

    const batch = await makeSource([taskWithEntries([morningEntry(), running])]).collect(CONTEXT);

    expect(batch.items).toHaveLength(1);
    expect(batch.items[0]?.startDay).toBe('2026-08-03');
  });

  it('skips entries with unparseable timestamps without throwing, keeping parseable siblings', async () => {
    const good = morningEntry();
    const badStart: TaskNotesTimeEntry = { startTime: 'not-a-timestamp', endTime: good.endTime };
    const badEnd: TaskNotesTimeEntry = { startTime: good.startTime, endTime: 'garbage' };

    const batch = await makeSource([taskWithEntries([badStart, badEnd, good])]).collect(CONTEXT);

    expect(batch.items).toHaveLength(1);
    expect(batch.items[0]?.id).toBe(
      makeCalendarItemId('time-entry', REPORT_PATH, `2026-08-03#${good.startTime}`),
    );
  });

  it('yields nothing for tasks without time entries', async () => {
    const batch = await makeSource([{ path: 'plain.md', title: 'Plain' }]).collect(CONTEXT);

    expect(batch.items).toEqual([]);
  });

  it('emits an empty batch when the time-entries toggle is off', async () => {
    const batch = await makeSource([taskWithEntries([morningEntry()])], {
      showTimeEntries: false,
    }).collect(CONTEXT);

    expect(batch.items).toEqual([]);
    expect(batch.occupancyByTaskPath.size).toBe(0);
  });
});

describe('timeEntrySource — id stability', () => {
  it('gives two same-day entries distinct ids that are stable across refreshes', async () => {
    const afternoon: TaskNotesTimeEntry = {
      startTime: isoAtLocalOffset(new Date(2026, 7, 3, 14, 0, 0)),
      endTime: isoAtLocalOffset(new Date(2026, 7, 3, 15, 0, 0)),
    };
    const source = makeSource([taskWithEntries([morningEntry(), afternoon])]);

    const first = await source.collect(CONTEXT);
    const second = await source.collect(CONTEXT);

    const firstIds = first.items.map((item) => item.id);
    expect(new Set(firstIds).size).toBe(2);
    expect(second.items.map((item) => item.id)).toEqual(firstIds);
  });
});

describe('timeEntrySource — epoch and change events', () => {
  it('bumps the epoch when a subscribed TaskNotes time event fires and unsubscribes on dispose', () => {
    let handler: ((eventName: string, payload?: unknown) => void) | undefined;
    const unsubscribe = jest.fn();
    const source = makeSource([], { showTimeEntries: true }, {
      subscribe: (h) => {
        handler = h;
        return unsubscribe;
      },
    });

    const before = source.epoch();
    handler!('time.stopped');
    const after = source.epoch();
    source.dispose();

    expect(after).toBe(before + 1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('lists the time-tracking change events in the canonical TaskNotes subscription set', () => {
    expect(TASKNOTES_CHANGE_EVENTS).toContain('time.started');
    expect(TASKNOTES_CHANGE_EVENTS).toContain('time.stopped');
  });
});
