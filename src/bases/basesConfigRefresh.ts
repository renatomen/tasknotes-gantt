/**
 * Bases config-change settle hook (#161) — ported from TaskNotes'
 * `installBasesConfigRefreshHook` (`../tasknotes/src/bases/basesRefreshLifecycle.ts`).
 *
 * A view-option toggle (e.g. "Hide top-level subtasks") makes Bases persist+reload
 * its config and re-fire `onDataUpdated` SEVERAL times while the persisted value
 * momentarily OSCILLATES (e.g. `hideTop` true→…→false). Rendering on each fire
 * paints the intermediate (stale) states — for us an expensive SVAR diff
 * (collapse→expand churn, scroll jumps) — before the value settles.
 *
 * The principled fix (no guessed debounce window): Bases' `QueryController` exposes
 * an `onConfigChanged` method that it calls when the view config changes, and which
 * returns the persist+reload work — a PROMISE that resolves once the change has
 * **settled**. We wrap it: refresh exactly ONCE after that result resolves, against
 * the now-stable config. We await Bases' OWN completion signal instead of guessing
 * how long the oscillation lasts.
 *
 * Adaptation over TaskNotes: we also expose `onChangeStart` so the view can SUPPRESS
 * the oscillating `onDataUpdated` refreshes while the change is in flight (TaskNotes
 * can skip this because its render is cheap/idempotent; ours is not).
 *
 * @module bases/basesConfigRefresh
 */

/** Options for {@link installBasesConfigRefreshHook}. */
export interface InstallBasesConfigRefreshHookOptions {
  /** The Bases `QueryController` (the object that owns `onConfigChanged`). */
  controller: unknown;
  /** This view instance — used to skip the refresh if Bases switched views. */
  view: unknown;
  /** Whether the view is still mounted (skip refresh/settle if not). */
  isConnected: () => boolean;
  /** Called SYNCHRONOUSLY when a config change begins (before Bases' work). */
  onChangeStart?: () => void;
  /** Called once the config change has SETTLED (the result resolved). */
  onSettled: () => void;
  /** Schedule a macrotask (used when the result is not a promise). */
  scheduleTimeout: (callback: () => void, delayMs: number) => void;
}

interface BasesConfigController {
  onConfigChanged?: (...args: unknown[]) => unknown;
  view?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Run `settled` after `result` resolves (promise) or on the next macrotask. */
function runAfterResult(
  result: unknown,
  settled: () => void,
  scheduleTimeout: (callback: () => void, delayMs: number) => void,
): void {
  const maybePromise = result as PromiseLike<unknown> | null;
  if (maybePromise && typeof maybePromise.then === 'function') {
    void maybePromise.then(settled, settled);
    return;
  }
  scheduleTimeout(settled, 0);
}

/**
 * Wrap `controller.onConfigChanged` so the view refreshes once the config change
 * settles. Returns a cleanup that restores the original method, or `null` if the
 * controller exposes no `onConfigChanged` (older Bases — caller falls back to its
 * debounced `onDataUpdated` path).
 */
export function installBasesConfigRefreshHook({
  controller,
  view,
  isConnected,
  onChangeStart,
  onSettled,
  scheduleTimeout,
}: InstallBasesConfigRefreshHookOptions): (() => void) | null {
  if (!isRecord(controller) || typeof controller.onConfigChanged !== 'function') {
    return null;
  }

  const basesController = controller as BasesConfigController;
  const originalOnConfigChanged = basesController.onConfigChanged;
  if (!originalOnConfigChanged) {
    return null;
  }

  const settleIfCurrentView = (): void => {
    // Bases may share one controller across views; only refresh if it's still ours.
    if (basesController.view && basesController.view !== view) return;
    if (!isConnected()) return;
    onSettled();
  };

  const wrappedOnConfigChanged = (...args: unknown[]): unknown => {
    onChangeStart?.();
    const result = originalOnConfigChanged.apply(basesController, args);
    runAfterResult(result, settleIfCurrentView, scheduleTimeout);
    return result;
  };

  basesController.onConfigChanged = wrappedOnConfigChanged;
  return () => {
    if (basesController.onConfigChanged === wrappedOnConfigChanged) {
      basesController.onConfigChanged = originalOnConfigChanged;
    }
  };
}
