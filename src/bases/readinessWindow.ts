/* global clearTimeout */
/**
 * Bounded-backoff readiness window (#161 §11) — a view-agnostic, deterministically
 * testable scheduler that heals Gantt Show-all/Inherit when TaskNotes' relationship
 * index warms *after* the first build.
 *
 * The bug: relationship resolution lags file resolution, so a tasks-warm-but-edges-
 * cold index gets cached as authoritative-empty and never self-heals (a warm-restart
 * `metadataCache` load fires no `task.*` event — see {@link
 * import('./readinessController')}). There is no TaskNotes "relationships ready"
 * event, so the only signal is to re-read and observe whether matched-set edges
 * appeared — i.e. a *bounded poll*, not an event subscription.
 *
 * This module is the pure timing engine: it fires up to `maxAttempts` checks with
 * exponential backoff (`baseDelayMs * backoffFactor^k` before attempt k, 0-indexed),
 * stops early the moment a check reports ready (R2), and otherwise goes dormant at
 * the cap (R3) — never re-fetching on a steady-state notify (R8). The check itself
 * (re-fetch the index, read the matched-parent signal) and the start condition live
 * in {@link import('./readinessController')}; the view lifecycle owns one of these
 * per mount and cancels it on unmount (R6), mirroring {@link
 * import('./coalesce').createCoalescer}.
 *
 * @module bases/readinessWindow
 */

/** Injectable timer surface so the window unit-tests with a fake clock. */
export interface ReadinessScheduler {
  setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
}

/**
 * Bound + schedule configuration. The constants are named + injectable (R5) so
 * tests drive them deterministically and U4 can calibrate them from the perf
 * harness without touching call sites.
 */
export interface ReadinessWindowConfig {
  /** Hard cap on attempts (full-vault scans per mount — R10/R12). */
  maxAttempts: number;
  /** Delay (ms) before the first attempt. */
  baseDelayMs: number;
  /** Multiplier applied per attempt: delay before attempt k = baseDelayMs * factor^k. */
  backoffFactor: number;
  /** Injectable timers; defaults to the arrow-wrapped globals (F2 lesson). */
  scheduler?: ReadinessScheduler;
}

/**
 * Default bound + schedule (R5) — named, in one place, so call sites never carry
 * magic literals and U4 calibrates them from the perf harness here.
 *
 * 5 attempts at base 500ms × factor 2 → re-checks at ~0.5s, 1s, 2s, 4s, 8s after
 * mount (≈15.5s of coverage), bounding warmup to ≤5 full-vault scans per mount
 * (R10/R12) while the exponential spacing keeps later attempts off the in-progress
 * cold `metadataCache` scan. Confirmed against the perf harness in U4.
 */
export const DEFAULT_READINESS_WINDOW_CONFIG: Readonly<
  Omit<ReadinessWindowConfig, 'scheduler'>
> = {
  maxAttempts: 5,
  baseDelayMs: 500,
  backoffFactor: 2,
};

/** A started/cancellable bounded-backoff window. */
export interface ReadinessWindow {
  /**
   * Begin the bounded re-check schedule. `check` returns whether relationships
   * have warmed (ready); a truthy result stops the window early. (Re)starting
   * resets the attempt counter and cancels any pending attempt.
   */
  start(check: () => boolean | Promise<boolean>): void;
  /** Cancel any pending attempt and go dormant; safe to call repeatedly. */
  cancel(): void;
  /** Whether an attempt is currently scheduled. */
  readonly pending: boolean;
}

// Wrap the globals in arrows so they're invoked as FREE functions, not as methods
// of this object literal — `{ setTimeout, clearTimeout }` would call them with
// `this === scheduler`, throwing `TypeError: Illegal invocation` in an Electron
// renderer (the built-in timer methods require `this === window`). Node/jsdom
// tolerate it, so only the real-timer regression test catches the difference.
// See coalesce.ts for the original incident (F2).
const defaultScheduler: ReadinessScheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer),
};

/**
 * Create a bounded-backoff readiness window. See {@link ReadinessWindow}.
 *
 * @param config - cap, base delay, backoff factor, and (optionally) the scheduler.
 */
export function createReadinessWindow(config: ReadinessWindowConfig): ReadinessWindow {
  const { maxAttempts, baseDelayMs, backoffFactor } = config;
  const scheduler = config.scheduler ?? defaultScheduler;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let cancelled = false;

  function clearPending(): void {
    if (timer !== null) {
      scheduler.clearTimeout(timer);
      timer = null;
    }
  }

  function scheduleNext(check: () => boolean | Promise<boolean>): void {
    // Dormant once cancelled or the cap is reached — the sole backstop for the
    // no-edges case (R3): no further full-vault scans on subsequent notifies (R8).
    if (cancelled || attempt >= maxAttempts) {
      return;
    }
    const delay = baseDelayMs * Math.pow(backoffFactor, attempt);
    timer = scheduler.setTimeout(() => {
      timer = null;
      void runAttempt(check);
    }, delay);
  }

  async function runAttempt(check: () => boolean | Promise<boolean>): Promise<void> {
    if (cancelled) {
      return;
    }
    attempt += 1;
    let ready = false;
    try {
      ready = await check();
    } catch {
      // A failing re-check is treated as not-ready: the attempt cap still bounds
      // it, so a transient error can never wedge the window open.
      ready = false;
    }
    // Re-check cancellation AFTER awaiting: a teardown (unmount) that lands while
    // the check is in flight must drop the result, never schedule another attempt
    // against a torn-down controller (R6 / AE4).
    if (cancelled || ready) {
      return;
    }
    scheduleNext(check);
  }

  return {
    start(check: () => boolean | Promise<boolean>): void {
      cancelled = false;
      attempt = 0;
      clearPending();
      scheduleNext(check);
    },
    cancel(): void {
      cancelled = true;
      clearPending();
    },
    get pending(): boolean {
      return timer !== null;
    },
  };
}
