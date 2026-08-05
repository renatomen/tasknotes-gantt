/**
 * Per-mount timeblock liveness assembly: the daily-note watch and the lister
 * that seeds it are built together, so every listing — the mount-time collect
 * included — lands its paths in the SAME watch the vault events feed. A
 * deleted daily note is only recognisable through that known-paths set (the
 * file cannot be probed once gone), which is the behavior pinned here.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { createTimeblockLiveness } from '../../src/bases/timeblockLiveness';
import type { DailyNoteAccess } from '../../src/bases/dailyNoteAccess';
import type { TimerScheduler } from '../../src/bases/scheduler';

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
  return {
    scheduler,
    settle: () => {
      const [handle, callback] = pending.entries().next().value ?? [];
      if (handle === undefined || callback === undefined) return false;
      pending.delete(handle);
      callback();
      return true;
    },
  };
}

const DAILY_PATH = 'Daily/2026-08-04.md';

function dailyNoteAccessFixture(): DailyNoteAccess {
  return {
    listDailyNotes: () => [{ date: '2026-08-04', path: DAILY_PATH, timeblocks: [] }],
    isDailyNote: (path) => path.startsWith('Daily/'),
  };
}

const WINDOW = { startDate: '2026-08-01', endDateExclusive: '2026-09-01' };

describe('createTimeblockLiveness', () => {
  it('recognises the deletion of a listed daily note: the listing seeds the live watch', () => {
    const timers = manualScheduler();
    const onEpochBump = jest.fn();
    const liveness = createTimeblockLiveness({
      dailyNotes: dailyNoteAccessFixture(),
      onEpochBump,
      scheduler: timers.scheduler,
    });

    const notes = liveness.listDailyNotes(WINDOW);
    liveness.watch.notifyDeleted(DAILY_PATH);
    timers.settle();

    expect(notes.map((note) => note.path)).toEqual([DAILY_PATH]);
    expect(liveness.watch.epoch()).toBe(1);
    expect(onEpochBump).toHaveBeenCalledTimes(1);
  });

  it('a deletion without a prior listing goes unrecognised (the seeding is the only delete signal)', () => {
    const timers = manualScheduler();
    const onEpochBump = jest.fn();
    const liveness = createTimeblockLiveness({
      dailyNotes: dailyNoteAccessFixture(),
      onEpochBump,
      scheduler: timers.scheduler,
    });

    liveness.watch.notifyDeleted(DAILY_PATH);
    timers.settle();

    expect(liveness.watch.epoch()).toBe(0);
    expect(onEpochBump).not.toHaveBeenCalled();
  });

  it('an edit to a listed-then-deleted note stops re-triggering (the delete releases the path)', () => {
    const timers = manualScheduler();
    const liveness = createTimeblockLiveness({
      dailyNotes: {
        listDailyNotes: () => [{ date: '2026-08-04', path: DAILY_PATH, timeblocks: [] }],
        // A note the probe no longer answers for (daily-notes folder changed).
        isDailyNote: () => false,
      },
      onEpochBump: () => {},
      scheduler: timers.scheduler,
    });
    liveness.listDailyNotes(WINDOW);
    liveness.watch.notifyDeleted(DAILY_PATH);
    timers.settle();
    expect(liveness.watch.epoch()).toBe(1);

    liveness.watch.notifyDeleted(DAILY_PATH);
    timers.settle();

    expect(liveness.watch.epoch()).toBe(1);
  });
});
