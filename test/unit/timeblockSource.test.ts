/**
 * Timeblock calendar-item source and liveness-watch unit tests.
 *
 * Daily-note timeblocks become flat read-only event rows attributed to the
 * note's own date (day granularity): the clock times validate a block but
 * never move it off its note's day — a block whose end clock time is at or
 * before its start still renders on the note's date only. Malformed blocks
 * drop silently, never the derivation. The liveness watch reuses the calendar
 * watch mechanism: relevant vault/metadata events coalesce through the same
 * debounce into one monotonic epoch bump per settled burst.
 *
 * Following testing-standards.md: Jest, pure fixtures via DI, AAA.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { makeCalendarItemId, type CalendarItemQueryContext } from '../../src/datasource/calendarItems';
import {
  createTimeblockSource,
  expandTimeblockItems,
  UNTITLED_TIMEBLOCK_TITLE,
  type DailyNoteTimeblocks,
  type TimeblockSourceDeps,
  type TimeblockToggles,
} from '../../src/datasource/calendarItems/timeblockSource';
import {
  createTimeblockWatch,
  type TimeblockWatch,
} from '../../src/datasource/calendarItems/timeblockWatch';
import { wireCalendarWatch, type WatchEventSource } from '../../src/bases/calendarWatch';
import type { TimerScheduler } from '../../src/bases/scheduler';

const DAILY_PATH = 'Daily/2026-08-03.md';
const DAILY_DAY = '2026-08-03';

const CONTEXT: CalendarItemQueryContext = {
  window: { startDate: '2026-08-01', endDateExclusive: '2026-09-01' },
  tasks: () => [],
  basesEntries: () => [],
};

function dailyNote(timeblocks: unknown, path = DAILY_PATH, date = DAILY_DAY): DailyNoteTimeblocks {
  return { date, path, timeblocks };
}

function deepWorkBlock(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'block-1', title: 'Deep work', startTime: '09:00', endTime: '10:30', ...overrides };
}

function makeSource(
  notes: readonly DailyNoteTimeblocks[],
  toggles: TimeblockToggles = { showTimeblocks: true },
  deps: Partial<TimeblockSourceDeps> = {},
) {
  return createTimeblockSource({
    listDailyNotes: () => notes,
    toggles: () => toggles,
    ...deps,
  });
}

describe('timeblockSource — flat event rows from daily-note timeblocks', () => {
  it('renders one flat read-only row per valid block, one-day on its note date', async () => {
    const batch = await makeSource([dailyNote([deepWorkBlock()])]).collect(CONTEXT);

    expect(batch.items).toEqual([
      {
        id: makeCalendarItemId('timeblock', DAILY_PATH, 'block-1'),
        family: 'timeblock',
        title: 'Deep work',
        startDay: DAILY_DAY,
        endDay: DAILY_DAY,
        notePath: DAILY_PATH,
      },
    ]);
    expect(batch.occupancyByTaskPath.size).toBe(0);
  });

  it('passes the derivation window to the injected daily-note accessor', async () => {
    const listDailyNotes = jest.fn(() => [] as readonly DailyNoteTimeblocks[]);

    await makeSource([], { showTimeblocks: true }, { listDailyNotes }).collect(CONTEXT);

    expect(listDailyNotes).toHaveBeenCalledWith(CONTEXT.window);
  });

  it('tolerates TaskNotes extras (attachments, description) without threading them', async () => {
    const block = deepWorkBlock({ attachments: ['[[ref]]'], description: 'notes' });

    const batch = await makeSource([dailyNote([block])]).collect(CONTEXT);

    expect(batch.items).toHaveLength(1);
    expect(batch.items[0]).toEqual({
      id: makeCalendarItemId('timeblock', DAILY_PATH, 'block-1'),
      family: 'timeblock',
      title: 'Deep work',
      startDay: DAILY_DAY,
      endDay: DAILY_DAY,
      notePath: DAILY_PATH,
    });
  });

  it('keeps a block on its note date even when its end clock time is not after its start', async () => {
    // Some users cross midnight; day attribution stays the note's date only.
    const crossing = deepWorkBlock({ id: 'late', startTime: '23:00', endTime: '00:30' });

    const batch = await makeSource([dailyNote([crossing])]).collect(CONTEXT);

    expect(batch.items).toHaveLength(1);
    expect(batch.items[0]).toMatchObject({ startDay: DAILY_DAY, endDay: DAILY_DAY });
  });
});

describe('timeblockSource — validation and exclusions', () => {
  it('skips a block missing its endTime while keeping valid siblings', async () => {
    const missingEnd = deepWorkBlock({ id: 'bad', endTime: undefined });

    const batch = await makeSource([dailyNote([missingEnd, deepWorkBlock()])]).collect(CONTEXT);

    expect(batch.items.map((item) => item.id)).toEqual([
      makeCalendarItemId('timeblock', DAILY_PATH, 'block-1'),
    ]);
  });

  it('skips blocks whose clock times are non-string or unparseable, without throwing', async () => {
    const numericStart = deepWorkBlock({ id: 'numeric', startTime: 900 });
    const garbageEnd = deepWorkBlock({ id: 'garbage', endTime: 'half past ten' });
    const outOfRange = deepWorkBlock({ id: 'range', startTime: '25:00' });

    const batch = await makeSource([
      dailyNote([numericStart, garbageEnd, outOfRange, deepWorkBlock()]),
    ]).collect(CONTEXT);

    expect(batch.items.map((item) => item.id)).toEqual([
      makeCalendarItemId('timeblock', DAILY_PATH, 'block-1'),
    ]);
  });

  it('skips a block without an id', async () => {
    const noId = deepWorkBlock({ id: undefined });

    const batch = await makeSource([dailyNote([noId, deepWorkBlock()])]).collect(CONTEXT);

    expect(batch.items.map((item) => item.id)).toEqual([
      makeCalendarItemId('timeblock', DAILY_PATH, 'block-1'),
    ]);
  });

  it('yields nothing for a note whose timeblocks value is not an array', async () => {
    const batch = await makeSource([
      dailyNote(undefined),
      dailyNote('not-a-list'),
      dailyNote([null, 'not-a-block', deepWorkBlock()]),
    ]).collect(CONTEXT);

    expect(batch.items.map((item) => item.id)).toEqual([
      makeCalendarItemId('timeblock', DAILY_PATH, 'block-1'),
    ]);
  });

  it('yields an empty batch when there are no daily notes', async () => {
    const batch = await makeSource([]).collect(CONTEXT);

    expect(batch.items).toEqual([]);
    expect(batch.occupancyByTaskPath.size).toBe(0);
  });

  it('emits an empty batch when the timeblocks toggle is off', async () => {
    const batch = await makeSource([dailyNote([deepWorkBlock()])], {
      showTimeblocks: false,
    }).collect(CONTEXT);

    expect(batch.items).toEqual([]);
    expect(batch.occupancyByTaskPath.size).toBe(0);
  });
});

describe('timeblockSource — titles, colors, and ids', () => {
  it('titles a block without a usable title with the untitled placeholder', async () => {
    const untitled = deepWorkBlock({ id: 'untitled', title: undefined });
    const blank = deepWorkBlock({ id: 'blank', title: '   ' });

    const batch = await makeSource([dailyNote([untitled, blank])]).collect(CONTEXT);

    expect(batch.items.map((item) => item.title)).toEqual([
      UNTITLED_TIMEBLOCK_TITLE,
      UNTITLED_TIMEBLOCK_TITLE,
    ]);
  });

  it('threads a block color when present and omits the key when absent', async () => {
    const colored = deepWorkBlock({ id: 'colored', color: '#ff8800' });

    const batch = await makeSource([dailyNote([colored, deepWorkBlock()])]).collect(CONTEXT);

    expect(batch.items[0]?.color).toBe('#ff8800');
    expect(batch.items[1]).not.toHaveProperty('color');
  });

  it('gives two blocks on the same note distinct ids namespaced by the note path', async () => {
    const second = deepWorkBlock({ id: 'block-2', title: 'Review' });

    const batch = await makeSource([dailyNote([deepWorkBlock(), second])]).collect(CONTEXT);

    expect(batch.items.map((item) => item.id)).toEqual([
      makeCalendarItemId('timeblock', DAILY_PATH, 'block-1'),
      makeCalendarItemId('timeblock', DAILY_PATH, 'block-2'),
    ]);
  });
});

describe('timeblockSource — liveness epoch delegation', () => {
  it('reports the injected liveness epoch as its own', () => {
    const source = makeSource([], { showTimeblocks: true }, { epoch: () => 7 });

    expect(source.family).toBe('timeblock');
    expect(source.epoch()).toBe(7);
  });

  it('reports a constant zero epoch when no liveness signal is injected', () => {
    expect(makeSource([]).epoch()).toBe(0);
  });
});

describe('expandTimeblockItems — pure expansion', () => {
  it('derives the same batch as the source for the same input', () => {
    const batch = expandTimeblockItems({
      dailyNotes: [dailyNote([deepWorkBlock()])],
      toggles: { showTimeblocks: true },
    });

    expect(batch.items.map((item) => item.id)).toEqual([
      makeCalendarItemId('timeblock', DAILY_PATH, 'block-1'),
    ]);
  });
});

interface FakeTimer {
  callback: () => void;
  cleared: boolean;
}

function fakeScheduler(): { scheduler: TimerScheduler; timers: FakeTimer[]; fireLast(): void } {
  const timers: FakeTimer[] = [];
  return {
    timers,
    scheduler: {
      setTimeout: (callback) => {
        const timer: FakeTimer = { callback, cleared: false };
        timers.push(timer);
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: (handle) => {
        const timer = timers[(handle as unknown as number) - 1];
        if (timer) timer.cleared = true;
      },
    },
    fireLast() {
      const live = timers.filter((timer) => !timer.cleared);
      live[live.length - 1]?.callback();
    },
  };
}

describe('createTimeblockWatch — debounced liveness epoch', () => {
  function watchWith(dailyPaths: string[]): {
    watch: TimeblockWatch;
    bumps: number[];
    fake: ReturnType<typeof fakeScheduler>;
  } {
    const fake = fakeScheduler();
    const bumps: number[] = [];
    const watch = createTimeblockWatch({
      isDailyNote: (path) => dailyPaths.includes(path),
      onEpochBump: () => bumps.push(1),
      scheduler: fake.scheduler,
      debounceMs: 500,
    });
    return { watch, bumps, fake };
  }

  it('bumps the epoch once the debounce settles after a daily-note metadata event', () => {
    const { watch, bumps, fake } = watchWith([DAILY_PATH]);
    const registered = new Map<string, (...args: unknown[]) => unknown>();
    const source: WatchEventSource = {
      on: (name, callback) => {
        registered.set(name, callback);
        return name;
      },
      offref: () => undefined,
    };
    wireCalendarWatch({ metadataCache: source, vault: source }, watch);

    registered.get('changed')?.({ path: DAILY_PATH });

    expect(watch.epoch()).toBe(0);
    expect(bumps).toHaveLength(0);
    fake.fireLast();
    expect(watch.epoch()).toBe(1);
    expect(bumps).toHaveLength(1);
  });

  it('ignores an event on a path that is no daily note', () => {
    const { watch, bumps, fake } = watchWith([DAILY_PATH]);

    watch.notifyChanged('Notes/Plain.md');

    expect(fake.timers).toHaveLength(0);
    expect(bumps).toHaveLength(0);
    expect(watch.epoch()).toBe(0);
  });

  it('coalesces rapid daily-note events into a single epoch bump', () => {
    const { watch, bumps, fake } = watchWith([DAILY_PATH]);

    watch.notifyChanged(DAILY_PATH);
    watch.notifyChanged(DAILY_PATH);
    watch.notifyChanged(DAILY_PATH);
    fake.fireLast();

    expect(watch.epoch()).toBe(1);
    expect(bumps).toHaveLength(1);
    expect(fake.timers.filter((timer) => !timer.cleared)).toHaveLength(1);
  });

  it('bumps for the deletion of a synced daily note that was never edited in view', () => {
    const { watch, fake } = watchWith([DAILY_PATH]);
    watch.syncKnownPaths([DAILY_PATH]);

    watch.notifyDeleted(DAILY_PATH);
    fake.fireLast();

    expect(watch.epoch()).toBe(1);
  });

  it('dispose cancels the pending bump and stops future scheduling', () => {
    const { watch, bumps, fake } = watchWith([DAILY_PATH]);

    watch.notifyChanged(DAILY_PATH);
    watch.dispose();
    watch.notifyChanged(DAILY_PATH);

    expect(fake.timers[0]?.cleared).toBe(true);
    expect(fake.timers).toHaveLength(1);
    expect(bumps).toHaveLength(0);
    expect(watch.epoch()).toBe(0);
  });
});
