/**
 * Readiness orchestration helper (U3, #161 §11).
 *
 * Drives the bounded-backoff window ({@link import('./readinessWindow')}) from the
 * GanttView lifecycle, healing Show-all/Inherit when TaskNotes' relationship index
 * warms *after* the first build. The view class (`ObsidianGanttBasesView extends
 * BasesView`) mounts Svelte and needs Obsidian DOM, so it can't be unit-tested
 * directly — this extracts the lifecycle logic behind injected deps (a controller
 * surface, a window factory, an alive predicate) so the start/stop/no-drop behavior
 * runs under a fake clock with stubbed deps, exactly like {@link
 * import('./coalesce').createCoalescer} and {@link
 * import('./basesConfigRefresh').installBasesConfigRefreshHook}.
 *
 * State machine (per mount): start the window ONLY when companion mode is active
 * AND the matched set has no resolved edges yet (so standalone — R11 — and
 * already-warm — R4 — are natural no-ops: no window is even created); each attempt
 * re-fetches the index and reads the matched-parent signal; stop early the moment
 * it resolves (R2) or at the cap (R3); cancel on unmount (R6).
 *
 * @module bases/readinessController
 */
import type { ReadinessStatus } from '../controller/GanttController';
import type { ReadinessWindow } from './readinessWindow';

/**
 * The narrow controller surface the orchestrator needs (U1) — a subset of
 * {@link import('../controller/GanttController').GanttController} so the helper
 * unit-tests with a stub.
 */
export interface ReadinessControllerSurface {
  /** Bust only the enrichment cache + recompute (re-fetch the relationship index). */
  recheckRelationshipIndex(): Promise<void>;
  /** The current readiness signal (companion active? matched edges resolved?). */
  readinessStatus(): ReadinessStatus;
}

/** Injected dependencies for {@link createReadinessOrchestrator}. */
export interface ReadinessOrchestratorDeps {
  /** The controller readiness surface (U1). */
  controller: ReadinessControllerSurface;
  /**
   * Factory for the bounded window (U2). A factory (not a single instance) so the
   * orchestrator can create one only when the start condition holds — a standalone
   * / already-warm mount allocates no scheduler at all. The view supplies a factory
   * closing over the calibrated constants (U4) + the default real-timer scheduler.
   */
  createWindow: () => ReadinessWindow;
  /**
   * Whether the view is still mounted/alive, re-checked at fire time (R6): a stale
   * attempt landing during teardown must not re-fetch against a torn-down
   * controller. Mirrors the `isConnected`/`mountToken` guards in register.ts.
   */
  isAlive: () => boolean;
}

/** A per-mount readiness orchestrator. */
export interface ReadinessOrchestrator {
  /**
   * Evaluate the start condition against the current readiness and start the
   * bounded window if (and only if) warranted. Called once after the initial mount
   * build. A no-op in standalone (R11) and already-warm (R4) mounts.
   */
  maybeStart(): void;
  /** Cancel the window and go dormant (unmount/remount — R6). Idempotent. */
  cancel(): void;
}

/**
 * Create a readiness orchestrator. See {@link ReadinessOrchestrator}.
 *
 * @param deps - controller surface, window factory, and alive predicate.
 */
export function createReadinessOrchestrator(
  deps: ReadinessOrchestratorDeps,
): ReadinessOrchestrator {
  const { controller, createWindow, isAlive } = deps;
  let window: ReadinessWindow | null = null;

  /**
   * One bounded re-check: re-fetch the index, then read the matched-parent signal
   * AFTER the re-fetch resolves. Reading it after is the no-drop mechanism (R13):
   * if a racing config refresh discarded the readiness recompute (latest-wins
   * `recomputeSeq` guard), the signal reads not-ready and the next bounded attempt
   * retries — a dropped attempt costs one retry, never a missed heal.
   *
   * The fire-time {@link ReadinessOrchestratorDeps.isAlive} guards bracket the
   * await so a teardown mid-check never re-fetches against a torn-down controller
   * (R6). A not-alive check returns NOT-ready (`false`), not ready — so a *transient*
   * leaf detach (Obsidian reparents/defers leaves without unmounting) retries on a
   * later bounded attempt instead of permanently giving up on the heal. A genuine
   * teardown is already stopped by `cancel()` (and the controller's `disposed`
   * early-return makes the skipped re-fetch a no-op), and the attempt cap bounds
   * the not-alive case regardless.
   */
  const check = async (): Promise<boolean> => {
    if (!isAlive()) return false;
    await controller.recheckRelationshipIndex();
    if (!isAlive()) return false;
    return controller.readinessStatus().matchedEdgesResolved;
  };

  return {
    maybeStart(): void {
      const status = controller.readinessStatus();
      // Start ONLY when companion mode is active AND the matched set is still cold.
      // Standalone (R11) and already-warm (R4) short-circuit here — no window, no
      // scheduler, no overhead (R8).
      if (!status.companionActive || status.matchedEdgesResolved) {
        return;
      }
      window = createWindow();
      window.start(check);
    },
    cancel(): void {
      window?.cancel();
      window = null;
    },
  };
}
