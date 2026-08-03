/**
 * Liveness for daily-note timeblocks: the calendar watch mechanism reused
 * with a daily-note relevance probe, so a timeblock edit, daily-note rename,
 * or deletion coalesces through the same debounce into one monotonic epoch
 * bump per settled burst. The epoch feeds both the timeblock source's
 * staleness signal and the entry signature; event wiring goes through
 * {@link import('../../bases/calendarWatch').wireCalendarWatch}, so the
 * subscription set can never drift from the calendar watch's.
 *
 * @module datasource/calendarItems/timeblockWatch
 */

import { createCalendarWatch } from '../../bases/calendarWatch';
import type { TimerScheduler } from '../../bases/scheduler';

export interface TimeblockWatchConfig {
  /** Daily-note probe; called at event time. */
  isDailyNote(path: string): boolean;
  /** Fires after each epoch bump — once per settled burst of relevant events. */
  onEpochBump?(): void;
  scheduler?: TimerScheduler;
  debounceMs?: number;
}

export interface TimeblockWatch {
  notifyChanged(path: string): void;
  notifyRenamed(path: string, oldPath: string): void;
  notifyDeleted(path: string): void;
  /**
   * Register the daily notes currently rendered so a later DELETE of one is
   * recognised even if the note was never edited in view (a deletion cannot
   * probe the file once it is gone).
   */
  syncKnownPaths(paths: Iterable<string>): void;
  /** Monotonic count of settled relevant bursts; folds into the entry signature. */
  epoch(): number;
  dispose(): void;
}

/**
 * Build the timeblock liveness watch over the calendar watch core. The epoch
 * counts settled bursts (the debounced re-resolve), not raw events, so one
 * burst of edits invalidates the cached batch exactly once.
 */
export function createTimeblockWatch(config: TimeblockWatchConfig): TimeblockWatch {
  let settledBursts = 0;
  const watch = createCalendarWatch({
    isCalendarNote: config.isDailyNote,
    onReResolve: () => {
      settledBursts += 1;
      config.onEpochBump?.();
    },
    scheduler: config.scheduler,
    debounceMs: config.debounceMs,
  });
  return {
    notifyChanged: watch.notifyChanged,
    notifyRenamed: watch.notifyRenamed,
    notifyDeleted: watch.notifyDeleted,
    syncKnownPaths: watch.syncKnownPaths,
    epoch: () => settledBursts,
    dispose: watch.dispose,
  };
}
