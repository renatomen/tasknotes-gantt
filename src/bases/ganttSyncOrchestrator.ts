/**
 * Diff-sync orchestration seam, extracted from `GanttContainer.svelte` so the
 * coordination logic is provable in jest. This module owns three concerns: the
 * ephemeral-sort coordination cluster — reassert, the SVAR sort-arrow reset,
 * the Base-order restore, and the two clear paths — the reseed family —
 * column-config reseed, the content-NOOP grid-width re-assert, and the
 * seed-snapshot refresh with its deferred reassert — and the sync
 * orchestration itself: `syncToGantt` with its plan/apply branches, driven by
 * the view's sync $effect through one thin call.
 *
 * The view owns every piece of mutable state. The orchestrator reaches it only
 * through {@link SyncOrchestratorAccess} — live getter/setter properties closed
 * over the view's scope — never through copied values: a snapshot of `syncing`
 * would silently stop bracketing echo suppression the moment the flag changes,
 * and a wiring-time api capture would exec into a torn-down store after a
 * remount. Reads stay branch-scoped: no accessor is dereferenced outside the
 * branch that needs it (the NOOP branch performs zero `ephemeralSort` reads —
 * widening the read set changes when the view's effect re-runs). Every
 * dependency-establishing read on the synchronous sync path executes within
 * the sync entry point's call frame; only the timer callbacks read lazily at
 * fire time, by design.
 *
 * The pure planning core stays in `ganttSyncCoordinator.ts`; what belongs here
 * is the orchestration that carries timers, api access, and view-state reads.
 *
 * @module bases/ganttSyncOrchestrator
 */
import type { RenderLink } from '../controller/InstanceExpansion';
import type { CalendarItemFamily } from '../datasource/calendarItems';
import { dlog } from '../debugLog';
import {
  baseSortDescriptor,
  buildSvarTasks,
  planReorder,
  shouldBulkReseed,
  structuralOpCount,
  type BaseSortEntry,
  type SvarTask,
  type SvarTaskInputs,
} from './ganttSync';
import {
  applyIncrementalGanttSync,
  createGanttSeedSnapshot,
  ganttOrderFingerprint,
  isGanttSyncNoop,
  planGanttSync,
  replaceAppliedGanttData,
  type AppliedGanttSyncState,
  type GanttSyncPlan,
} from './ganttSyncCoordinator';
import type { GridColumn } from './gridColumns';
import type { EphemeralSort } from './sortCycle';
import { createSvarGanttAdapter, type SvarGanttCommandApi } from './svarGanttAdapter';
import type { GanttData } from './types/gantt-view-data';

/**
 * The slice of {@link GanttData} the sync orchestration reads: the task-shaping
 * inputs plus the reseed family's column/width facts. Narrower than the full
 * store payload so the module states its actual data coupling and unit
 * fixtures build only what the code consumes.
 */
export type GanttSyncSource = Pick<
  GanttData,
  | 'instances'
  | 'links'
  | 'statusColors'
  | 'priorityColors'
  | 'barFillSource'
  | 'barStripSource'
  | 'calendarPalette'
  | 'calendarBySource'
  | 'barIcon'
  | 'showDateIndicators'
  | 'arrowMode'
  | 'hideTopLevelSubtasks'
  | 'propertyValues'
  | 'cellRenders'
  | 'managedPaths'
  | 'gridColumnsKey'
  | 'gridWidth'
  | 'gridColumns'
>;

/**
 * The live per-call view state folded into the task-shaping inputs beside the
 * store payload: the switcher's hidden families and the collapsed-instance
 * set. Threaded as one argument so the seed, the id-keyed diff, and any reseed
 * all compute `open` and occupancy geometry from the same source of truth.
 */
export interface SvarTaskLiveInputs {
  hiddenSources: ReadonlySet<CalendarItemFamily> | undefined;
  collapsedIds: ReadonlySet<string>;
}

/**
 * Project the dynamic render data into the pure SVAR-task builder inputs.
 * Exported for the view's mount-time seed (built before the orchestrator
 * factory can run — the applied-state baseline it feeds is itself a factory
 * dependency); the orchestrator wraps it with its own bridge reads for every
 * later call, so there is exactly one projection.
 */
export function toSvarTaskInputs(d: GanttSyncSource, live: SvarTaskLiveInputs): SvarTaskInputs {
  return {
    instances: d.instances,
    links: d.links,
    statusColors: d.statusColors ?? [],
    priorityColors: d.priorityColors ?? [],
    barFillSource: d.barFillSource ?? 'default',
    barStripSource: d.barStripSource ?? 'none',
    calendarPalette: d.calendarPalette ?? [],
    calendarBySource: d.calendarBySource,
    barIconSource: d.barIcon ?? 'none',
    showDateIndicators: d.showDateIndicators ?? true,
    arrowMode: d.arrowMode,
    // Read on the stable instance set so the replicated cue counts only VISIBLE
    // instances: when on, the display-filtered alsoTopLevel twin is excluded from
    // the count. Toggling this re-runs the task shaping via the store →
    // sync path and diffs update-only, so the hatch flips live without churning.
    hideTopLevelSubtasks: d.hideTopLevelSubtasks ?? false,
    propertyValues: d.propertyValues,
    cellRenders: d.cellRenders,
    managedPaths: d.managedPaths,
    hiddenSources: live.hiddenSources,
    // The live collapsed set — threaded here so the seed, the id-keyed diff,
    // and any reseed all compute `open` from the same source of truth.
    collapsedIds: live.collapsedIds,
  };
}

/**
 * The slice of the SVAR Gantt api the orchestrator drives: the sync port's
 * command surface (exec, plus the row-presence probe `getTask`) plus the
 * `_sort` reset's reach into the internal data store via `getStores` —
 * internal-but-reachable, beyond the published declarations.
 */
export interface SyncOrchestratorApi extends SvarGanttCommandApi {
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
export interface SyncOrchestratorAccess<TColumn = unknown> {
  /** The view's echo-suppression flag — a plain component `let`, never copied. */
  syncing: boolean;
  ephemeralSort: EphemeralSort | null;
  readonly api: SyncOrchestratorApi | undefined;
  /**
   * SVAR grid-column seed prop — written only on a column-config reseed
   * (reassigning it re-inits SVAR's store). The element type is the view's
   * private SVAR column shape; the orchestrator only pipes `buildSvarColumns`'
   * result through, so it stays generic rather than coupling to that shape.
   */
  columns: TColumn[];
  /** SVAR task seed prop — rewritten only by an explicit reseed. */
  initialTasks: SvarTask[];
  /** SVAR link seed prop — rewritten only by an explicit reseed. */
  initialLinks: RenderLink[];
  /**
   * The view's collapsed-instance set (view `$state`), read synchronously by
   * the task shaping inside every sync call frame — the read that makes a
   * collapse change re-trigger the view's sync effect.
   */
  readonly collapsedIds: ReadonlySet<string>;
}

/**
 * The factory's immutable mount-time baseline for the module-private applied
 * keys. Passed by value at construction — never read through live accessors,
 * which would break the bridge's no-eager-dereference contract.
 */
export interface SyncOrchestratorInit {
  readonly columnsKey: string;
  readonly editorAttachKey: string;
  readonly gridWidth: number | undefined;
}

/** Stable collaborators the orchestrator calls but never assigns. */
export interface SyncOrchestratorDeps<TColumn = unknown> {
  /** The echo tag our own programmatic execs carry (`OG_ECHO_SOURCE`). */
  echoSource: string;
  /**
   * The live store payload, read at call time — the Base-order restore has no
   * data argument of its own (its callers are UI gestures), so it re-derives
   * the current rows from this supplier at each call.
   */
  currentData(): GanttSyncSource;
  /**
   * The view's applied diff-sync state, aliased — the same reference the
   * incremental sync and the echo baseline mutate, so an order-key write here
   * is what the next sync diffs against.
   */
  appliedSyncState: AppliedGanttSyncState;
  /** Turn config-derived descriptors into fresh SVAR columns (view closure). */
  buildSvarColumns(descriptors: GridColumn[]): TColumn[];
  /**
   * Re-assert the persisted divider width after a column recompute. Stays in
   * the view (dual-homed: `initGantt` and the host callback also call it) and
   * owns its own deferral; it crosses the seam as a plain call.
   */
  applyPersistedGridWidth(): void;
  /**
   * Re-apply the view's composed row-visibility display filter. Stays in the
   * view (its own effect also drives it); the post-bulk deferral that restores
   * it after a reseed re-init is module-owned.
   */
  applyDisplayFilters(): void;
  /** Live editor-attach set (a view `$derived`), read at call time. */
  cellEditColumnIds(): ReadonlyArray<string>;
  /** The switcher's session-hidden source families, read per sync call. */
  hiddenSources(): ReadonlySet<CalendarItemFamily> | undefined;
  /** The Base toolbar sort supplier (`config.getSort()`), read at call time. */
  getSort(): ReadonlyArray<BaseSortEntry> | undefined;
}

/** The diff-sync coordination surface the view's staying hooks call. */
export interface GanttSyncOrchestrator {
  reassertEphemeralSort(): void;
  clearSvarSortArrow(): void;
  restoreBaseOrder(): void;
  clearEphemeralSort(): void;
  clearEphemeralSortForBaseChange(baseSortChanged: boolean): void;
  reseedColumnsIfNeeded(d: GanttSyncSource): boolean;
  applyChangedGridWidth(d: GanttSyncSource): void;
  reseedSeedsFromData(d: GanttSyncSource): void;
  syncToGantt(d: GanttSyncSource): void;
}

export function createGanttSyncOrchestrator<TColumn>(
  access: SyncOrchestratorAccess<TColumn>,
  deps: SyncOrchestratorDeps<TColumn>,
  init: SyncOrchestratorInit,
): GanttSyncOrchestrator {
  // Last-applied column-config fingerprint; a change triggers a column reseed.
  let appliedColumnsKey = init.columnsKey;
  // Last-applied editor-attach set. Which columns CARRY an editor/getter is
  // decided at column-build time, so an editability change with an unchanged
  // column config (e.g. a newly registered TaskNotes field) also needs a column
  // reseed — otherwise the new editor never attaches (or a dead one lingers).
  let appliedEditorAttachKey = init.editorAttachKey;
  // The effective width last applied to SVAR, tracked so a settings-panel edit
  // of "Table width (px)" (which changes only `d.gridWidth` — tasks/columns
  // unchanged, so the sync takes the content-NOOP path) still re-asserts the
  // new width live instead of waiting for a resize/reseed/remount.
  let appliedGridWidth = init.gridWidth;

  /** The task-shaping inputs for `d`, with the live bridge reads folded in. */
  function toInputs(d: GanttSyncSource): SvarTaskInputs {
    return toSvarTaskInputs(d, {
      hiddenSources: deps.hiddenSources(),
      collapsedIds: access.collapsedIds,
    });
  }

  /** The rows the live store payload implies right now (restore replays these). */
  function currentTasks(): SvarTask[] {
    return buildSvarTasks(toInputs(deps.currentData()));
  }

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
      const next = currentTasks();
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

  /**
   * Reseed the SVAR column/task/link seeds when the column config or the
   * editor-attach set changed since the last apply. Returns `true` when the
   * reseed ran (the caller's sync pass is done — a reseed replaces the whole
   * store, so no diff follows).
   */
  function reseedColumnsIfNeeded(d: GanttSyncSource): boolean {
    const editorAttachKey = deps.cellEditColumnIds().join('|');
    const columnsChanged =
      d.gridColumnsKey !== appliedColumnsKey
      || editorAttachKey !== appliedEditorAttachKey;
    if (!columnsChanged) return false;

    dlog(`[OGDBG] sync RESEED columns "${appliedColumnsKey}" -> "${d.gridColumnsKey}"`);
    appliedGridWidth = d.gridWidth;
    appliedEditorAttachKey = editorAttachKey;
    reseedForColumnChange(d);
    return true;
  }

  /**
   * Re-assert a changed effective grid width on the content-NOOP path (a
   * settings-panel "Table width" edit changes only `d.gridWidth`).
   */
  function applyChangedGridWidth(d: GanttSyncSource): void {
    if (d.gridWidth === appliedGridWidth) return;
    appliedGridWidth = d.gridWidth;
    deps.applyPersistedGridWidth();
  }

  /**
   * Reseed the SVAR `columns`/`tasks`/`links` props from the current data on a
   * column-config change, and resync the applied maps so the next incremental
   * diff is a no-op. Reassigning these `$state` seeds re-inits SVAR's store once
   * (the only correct way to change the column set).
   */
  function reseedForColumnChange(d: GanttSyncSource): void {
    appliedColumnsKey = d.gridColumnsKey;
    access.columns = deps.buildSvarColumns(d.gridColumns);

    reseedSeedsFromData(d);

    // The re-init triggers the column recompute (gridWidth → column-sum); re-
    // assert the user's persisted divider width afterward so a column-config
    // change doesn't silently reset it.
    deps.applyPersistedGridWidth();
  }

  /**
   * Refresh the `<Gantt>` seed props (tasks/links) from the data argument —
   * rows and links both derive from the same `d`, so a reseed can never mix
   * two payload generations — and resync the applied-state maps so the next
   * incremental diff is a no-op. Shared by the column-config reseed and the
   * theme-flip reseed: a theme flip remounts the <Gantt> (the view's
   * dark/light swap), which re-reads these seeds — without this the post-flip
   * chart would show the stale mount-time seed instead of the current data.
   */
  function reseedSeedsFromData(d: GanttSyncSource): void {
    const seed = createGanttSeedSnapshot({
      tasks: buildSvarTasks(toInputs(d)),
      links: d.links,
      cellEditColumnIds: deps.cellEditColumnIds(),
    });
    access.initialTasks = seed.tasks;
    access.initialLinks = seed.links;
    replaceAppliedGanttData(deps.appliedSyncState, seed);
    // The reseed re-inits SVAR from `tasks` (already in Base order), so the
    // applied order key tracks it — the next diff won't re-issue reorder moves.
    // Re-baseline the Base sort descriptor too (symmetry with the order key): a
    // reseed coinciding with a toolbar-sort change must not leave the next sync
    // comparing against a stale descriptor.
    deps.appliedSyncState.baseSortKey = baseSortDescriptor(deps.getSort());

    // A reseed re-inits the store in Base order and wipes SVAR's `_sort`. If an
    // ephemeral column sort is active, re-apply it once the store's column
    // recompute settles — deferred a tick like applyPersistedGridWidth, since a
    // theme-flip reseed remounts <Gantt> (fresh api/store). Raw scheduling by
    // design: no handle, no cancellation, no destroy gate — the fire-time
    // override guard and the catch are the staleness mechanism, and the
    // deferred exec deliberately lands on the re-bound api after a remount.
    if (access.ephemeralSort) {
      setTimeout(() => {
        if (!access.ephemeralSort) return;
        access.syncing = true;
        try {
          reassertEphemeralSort();
        } catch {
          /* exec threw on a torn-down / freshly-remounted store — skip */
        } finally {
          access.syncing = false;
        }
      }, 0);
    }
  }

  /** Diff the incoming payload against the applied baseline (pure planning). */
  function planSyncFromData(d: GanttSyncSource): GanttSyncPlan {
    return planGanttSync({
      next: buildSvarTasks(toInputs(d)),
      links: d.links,
      applied: deps.appliedSyncState,
      baseSortKey: baseSortDescriptor(deps.getSort()),
    });
  }

  /**
   * Replace the whole store when the diff is structurally too large to apply
   * incrementally. Returns `true` when the reseed ran (the sync pass is done).
   */
  function applyBulkReseedIfNeeded(d: GanttSyncSource, plan: GanttSyncPlan): boolean {
    const { taskPlan, linkPlan } = plan;
    if (!shouldBulkReseed(taskPlan, linkPlan)) return false;

    dlog(
      `[OGDBG] sync BULK-RESEED ops=${structuralOpCount(taskPlan, linkPlan)}` +
        ` (adds=${taskPlan.adds.length} deletes=${taskPlan.deletes.length} moves=${taskPlan.moves.length} linkAdds=${linkPlan.adds.length} linkDeletes=${linkPlan.deletes.length})`,
    );
    access.syncing = true;
    try {
      // Clear a stale override first so the reseed cannot reassert it.
      clearEphemeralSortForBaseChange(plan.baseSortChanged);
      reseedSeedsFromData(d);
      deps.applyPersistedGridWidth();
    } finally {
      access.syncing = false;
    }
    // SVAR clears its display filter during reinit, after Svelte's synchronous
    // data effect can run, so restore the filter after the reseed settles.
    setTimeout(() => deps.applyDisplayFilters(), 0);
    return true;
  }

  /** Apply a small diff as targeted SVAR actions (zoom/scroll survive). */
  function applyIncrementalSync(plan: GanttSyncPlan): void {
    const api = access.api;
    if (!api) return;
    const { taskPlan, linkPlan } = plan;
    dlog(
      `[OGDBG] sync DIFF moves=${taskPlan.moves.length} updates=${taskPlan.updates.length}` +
        ` adds=${taskPlan.adds.length} deletes=${taskPlan.deletes.length}` +
        ` linkAdds=${linkPlan.adds.length} linkDeletes=${linkPlan.deletes.length}` +
        ` orderChanged=${plan.orderKey !== deps.appliedSyncState.orderKey} baseSortChanged=${plan.baseSortChanged}`,
    );

    const syncPort = createSvarGanttAdapter(api, {
      echoSource: deps.echoSource,
      cellEditColumnIds: deps.cellEditColumnIds(),
    });
    access.syncing = true;
    const tSyncStart = performance.now();
    let tAfterExec = tSyncStart;
    try {
      const { reorderMoves } = applyIncrementalGanttSync({
        plan,
        port: syncPort,
        state: deps.appliedSyncState,
        ephemeralSort: {
          isActive: () => access.ephemeralSort !== null,
          reassert: reassertEphemeralSort,
          clear: () => {
            access.ephemeralSort = null;
            clearSvarSortArrow();
          },
        },
        onTaskAndLinkChangesApplied: () => {
          tAfterExec = performance.now();
        },
      });
      const now = performance.now();
      dlog(
        `[OGDBG] sync applied in ${Math.round(now - tSyncStart)}ms` +
          ` (exec=${Math.round(tAfterExec - tSyncStart)}ms reorder=${Math.round(now - tAfterExec)}ms` +
          ` reorderMoves=${reorderMoves})`,
      );
    } finally {
      access.syncing = false;
    }
  }

  /**
   * One full sync pass over the current payload: column reseed short-circuit,
   * content-NOOP width re-assert, then plan and apply — bulk reseed or
   * incremental diff. The view's sync $effect is a guard plus this one call.
   */
  function syncToGantt(d: GanttSyncSource): void {
    if (reseedColumnsIfNeeded(d)) return;
    applyChangedGridWidth(d);

    const plan = planSyncFromData(d);
    if (isGanttSyncNoop(plan, deps.appliedSyncState)) {
      dlog('[OGDBG] sync NOOP');
      return;
    }
    if (applyBulkReseedIfNeeded(d, plan)) return;
    applyIncrementalSync(plan);
  }

  return {
    reassertEphemeralSort,
    clearSvarSortArrow,
    restoreBaseOrder,
    clearEphemeralSort,
    clearEphemeralSortForBaseChange,
    reseedColumnsIfNeeded,
    applyChangedGridWidth,
    reseedSeedsFromData,
    syncToGantt,
  };
}
