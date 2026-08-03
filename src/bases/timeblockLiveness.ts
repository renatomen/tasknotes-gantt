/**
 * Per-mount timeblock liveness: the daily-note watch plus the lister that
 * seeds it. A deleted daily note can only be recognised through the watch's
 * known-paths set (the file cannot be probed once it is gone), so every
 * listing — the controller's mount-time collect included — must land its
 * paths in the SAME watch the vault events feed. Building both here, with the
 * lister closing over the watch, makes a listing that misses the live watch
 * structurally impossible.
 *
 * @module bases/timeblockLiveness
 */

import {
  createTimeblockWatch,
  type CalendarDerivationWindow,
  type DailyNoteTimeblocks,
  type TimeblockWatch,
} from '../datasource/calendarItems';
import type { DailyNoteAccess } from './dailyNoteAccess';
import type { TimerScheduler } from './scheduler';

export interface TimeblockLivenessOptions {
  dailyNotes: DailyNoteAccess;
  /** Fires once per settled burst of relevant daily-note events. */
  onEpochBump(): void;
  scheduler?: TimerScheduler;
  debounceMs?: number;
}

export interface TimeblockLiveness {
  watch: TimeblockWatch;
  /** Lists the window's daily notes AND registers them as known paths. */
  listDailyNotes(window: CalendarDerivationWindow): DailyNoteTimeblocks[];
}

/** Build the watch and its seeding daily-note lister as one unit. */
export function createTimeblockLiveness(options: TimeblockLivenessOptions): TimeblockLiveness {
  const watch = createTimeblockWatch({
    isDailyNote: (path) => options.dailyNotes.isDailyNote(path),
    onEpochBump: options.onEpochBump,
    ...(options.scheduler ? { scheduler: options.scheduler } : {}),
    ...(options.debounceMs === undefined ? {} : { debounceMs: options.debounceMs }),
  });
  return {
    watch,
    listDailyNotes: (window) => {
      const notes = options.dailyNotes.listDailyNotes(window);
      watch.syncKnownPaths(notes.map((note) => note.path));
      return notes;
    },
  };
}
