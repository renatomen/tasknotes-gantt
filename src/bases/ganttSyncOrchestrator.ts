/**
 * Diff-sync orchestration seam, extracted from `GanttContainer.svelte` so the
 * coordination logic is provable in jest. This module currently owns the
 * ephemeral-sort coordination cluster: reassert, the SVAR sort-arrow reset,
 * the Base-order restore, and the two clear paths.
 *
 * The view owns every piece of mutable state. The orchestrator reaches it only
 * through {@link SyncOrchestratorAccess} — live getter/setter properties closed
 * over the view's scope — never through copied values: a snapshot of `syncing`
 * would silently stop bracketing echo suppression the moment the flag changes,
 * and a wiring-time api capture would exec into a torn-down store after a
 * remount. Reads stay branch-scoped: no accessor is dereferenced outside the
 * branch that needs it.
 *
 * The pure planning core stays in `ganttSyncCoordinator.ts`; what belongs here
 * is the orchestration that carries api access and view-state reads.
 *
 * @module bases/ganttSyncOrchestrator
 */
import { planReorder, type SvarTask } from './ganttSync';
import { ganttOrderFingerprint, type AppliedGanttSyncState } from './ganttSyncCoordinator';
import type { EphemeralSort } from './sortCycle';

/**
 * The slice of the SVAR Gantt api the orchestrator drives. Structural (not the
 * vendor type) because the `_sort` reset reaches the internal data store via
 * `getStores` — internal-but-reachable, beyond the published declarations.
 */
export interface SyncOrchestratorApi {
  exec(action: string, payload: object): unknown;
  getStores?(): { data?: { setState?(state: object): void } };
}

/**
 * Live access to the view's mutable sync-coordination state. Members the
 * orchestrator only reads are getter-only; members it writes carry a setter.
 * The view passes an object literal of accessor properties — each `get`/`set`
 * body closes over the component binding, so a write here is visible to the
 * view's interceptors, effects, and template, and an api re-bind is visible to
 * the next call (and to a timer callback firing after a remount).
 */
export interface SyncOrchestratorAccess {
  /** The view's echo-suppression flag — a plain component `let`, never copied. */
  syncing: boolean;
  ephemeralSort: EphemeralSort | null;
  readonly api: SyncOrchestratorApi | undefined;
}

/** Stable collaborators the orchestrator calls but never assigns. */
export interface SyncOrchestratorDeps {
  /** The echo tag our own programmatic execs carry (`OG_ECHO_SOURCE`). */
  echoSource: string;
  /**
   * Current tasks in Base order — the view's closure over its task-shaping
   * pipeline, read at call time so a restore always replays the live data.
   */
  currentTasks(): ReadonlyArray<SvarTask>;
  /**
   * The view's applied diff-sync state, aliased — the same reference the
   * incremental sync and the echo baseline mutate, so an order-key write here
   * is what the next sync diffs against.
   */
  appliedSyncState: AppliedGanttSyncState;
}

/** The ephemeral-sort coordination surface the view's staying hooks call. */
export interface GanttSyncOrchestrator {
  reassertEphemeralSort(): void;
  clearSvarSortArrow(): void;
  restoreBaseOrder(): void;
  clearEphemeralSort(): void;
  clearEphemeralSortForBaseChange(baseSortChanged: boolean): void;
}

export function createGanttSyncOrchestrator(
  access: SyncOrchestratorAccess,
  deps: SyncOrchestratorDeps,
): GanttSyncOrchestrator {
  /**
   * Re-apply the active ephemeral column sort over SVAR's current rows.
   * Echo-tagged so it never re-enters the `sort-tasks` recording interceptor.
   * A no-op when no ephemeral sort is active or the api isn't ready. Called
   * from the data-only sync branch (synchronously, inside the `syncing`
   * window) and, deferred a tick, after a reseed remount.
   */
  function reassertEphemeralSort(): void {
    if (!access.ephemeralSort || !access.api?.exec) return;
    access.api.exec('sort-tasks', {
      key: access.ephemeralSort.column,
      order: access.ephemeralSort.direction,
      eventSource: deps.echoSource,
    });
  }

  /**
   * Clear SVAR's lit column-header sort arrow by nulling its internal `_sort`
   * state. There is no `sort-tasks` payload that resets `_sort` to null
   * (verified vs `@svar-ui/gantt-store` 2.7.0), so reach the data store
   * directly — the same internal-but-reachable class as the gridWidth
   * recompute workaround. Centralised here so a SVAR upgrade that renames
   * `_sort`/`setState` has a single call site to fix.
   */
  function clearSvarSortArrow(): void {
    access.api?.getStores?.().data?.setState?.({ _sort: null });
  }

  /**
   * Restore the Base row order after an ephemeral sort is cleared (the third
   * header click and the floating reset pill both funnel here). SVAR's
   * `tree.sort` mutated the row order in place, so this resets `_sort` (drops
   * the lit header arrow) then replays the Base-order `move-task` steps so the
   * rows return to the Base order. Echo-guarded + `syncing`-wrapped so the
   * moves don't re-enter the view's interceptors. Does NOT touch
   * `ephemeralSort` — the caller sets it null first (so the reset pill hides
   * immediately).
   */
  function restoreBaseOrder(): void {
    if (!access.api?.exec) return;
    access.syncing = true;
    try {
      clearSvarSortArrow();
      const next = deps.currentTasks();
      for (const m of planReorder(next)) {
        access.api.exec('move-task', {
          id: m.id,
          target: m.after,
          mode: 'after',
          eventSource: deps.echoSource,
        });
      }
      deps.appliedSyncState.orderKey = ganttOrderFingerprint(next);
    } catch {
      /* a move-task threw synchronously mid-restore (e.g. store torn down); the stale
         applied order key forces the next sync to replay the full reorder */
    } finally {
      access.syncing = false;
    }
  }

  /**
   * Shared clear path for the floating reset pill: drop the ephemeral sort and
   * restore the Base order. The third-click cancel clears inline instead (it
   * must return falsy to cancel SVAR's toggle), but funnels into the same
   * `restoreBaseOrder`.
   */
  function clearEphemeralSort(): void {
    access.ephemeralSort = null;
    restoreBaseOrder();
  }

  function clearEphemeralSortForBaseChange(baseSortChanged: boolean): void {
    if (!access.ephemeralSort || !baseSortChanged) return;
    access.ephemeralSort = null;
    clearSvarSortArrow();
  }

  return {
    reassertEphemeralSort,
    clearSvarSortArrow,
    restoreBaseOrder,
    clearEphemeralSort,
    clearEphemeralSortForBaseChange,
  };
}
