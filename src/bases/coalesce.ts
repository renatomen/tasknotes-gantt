/**
 * Trailing-debounce coalescer for the Bases data-update storm (#161).
 *
 * Obsidian Bases can fire `onDataUpdated` many times in a rapid burst: a
 * view-option toggle (e.g. "Hide top-level subtasks") triggers a config
 * persist + reload cycle that re-fires the hook several times, and the persisted
 * value can momentarily oscillate (the "true persists immediately, false isn't
 * written" asymmetry). Recomputing + rendering synchronously on every fire —
 * while re-reading the live (oscillating) config each time — amplifies the burst
 * into a visible, self-sustaining render loop.
 *
 * Coalescing collapses a burst into a single trailing run after it goes quiet,
 * so the view refreshes ONCE against the settled config. This mirrors TaskNotes'
 * `BasesViewBase` (`scheduleBasesDataUpdateRender`, 500ms) — the proven response
 * to the same Bases notify source, which "does the same expansion with no loop".
 *
 * @module bases/coalesce
 */

import { defaultScheduler, type TimerScheduler } from './scheduler';

/**
 * Injectable timer surface so the debounce unit-tests with fake timers. Alias of
 * the shared {@link TimerScheduler} — kept as a named export for existing callers.
 */
export type CoalesceScheduler = TimerScheduler;

/** A trailing-debounced runner. */
export interface Coalescer {
  /** (Re)schedule the trailing run; each call resets the quiet window. */
  schedule(): void;
  /** Cancel any pending run (call on unload, to avoid a post-teardown render). */
  cancel(): void;
  /** Whether a trailing run is currently pending. */
  readonly pending: boolean;
}

/**
 * Create a trailing-debounce coalescer: once {@link Coalescer.schedule} stops
 * being called for `delayMs`, `run` fires exactly once. Re-scheduling within the
 * window collapses the burst into that single trailing call.
 *
 * @param run - the (idempotent) work to coalesce — here, the chart refresh.
 * @param delayMs - quiet window (ms) before the trailing run.
 * @param scheduler - injectable timers; defaults to the globals.
 */
export function createCoalescer(
  run: () => void,
  delayMs: number,
  scheduler: CoalesceScheduler = defaultScheduler,
): Coalescer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule(): void {
      if (timer !== null) scheduler.clearTimeout(timer);
      timer = scheduler.setTimeout(() => {
        timer = null;
        run();
      }, delayMs);
    },
    cancel(): void {
      if (timer !== null) {
        scheduler.clearTimeout(timer);
        timer = null;
      }
    },
    get pending(): boolean {
      return timer !== null;
    },
  };
}
