/* global clearTimeout */
/**
 * Shared injectable-timer surface for the view's lifecycle schedulers
 * ({@link import('./coalesce').createCoalescer} debounce and {@link
 * import('./readinessWindow').createReadinessWindow} bounded-backoff poll).
 *
 * Both need the same two things: a fake timer surface so they unit-test with a
 * controllable clock, and a default that wraps the globals in arrows. This is one
 * place so the load-bearing Electron fix below lives once, not copy-pasted per
 * scheduler (a drift here would silently reintroduce the F2 crash).
 *
 * @module bases/scheduler
 */

/** Injectable timer surface so schedulers unit-test with fake timers. */
export interface TimerScheduler {
  setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
}

// Wrap the globals in arrows so they're invoked as FREE functions, not as methods
// of this object literal. `{ setTimeout, clearTimeout }` would call them with
// `this === defaultScheduler`, which throws `TypeError: Illegal invocation` in a
// browser/Electron renderer (the built-in timer methods require `this === window`).
// Node/jsdom tolerate it, which is why a fake-scheduler unit test can't catch this
// — it only bites in the real Obsidian runtime (the F2 incident). The real-timer
// regression tests in coalesce.test.ts / readinessWindow.test.ts exercise this path.
export const defaultScheduler: TimerScheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer),
};
