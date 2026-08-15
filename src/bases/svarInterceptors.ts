/**
 * SVAR interaction-cluster interceptor policies, extracted from
 * `GanttContainer.svelte` so echo suppression, collapse persistence, reorder
 * blocking, and selection/activation semantics are provable in jest.
 *
 * The view owns every piece of mutable state. Handlers reach it only through
 * {@link InterceptorAccess} — live getter/setter properties closed over the
 * view's scope — never through copied values: a snapshot of `syncing` would
 * silently stop suppressing echo re-entry the first time the sync coordinator
 * raises it.
 *
 * @module bases/svarInterceptors
 */
import { cycleNext, type EphemeralSort } from './sortCycle';
import { resolveShowEditorRoute } from './eventRowGuards';
import { resolveClickActivation } from './taskNotesInteractions';

/**
 * Live access to the view's mutable interaction state. Members the handlers
 * only read are getter-only; members they write carry a setter. The view
 * passes an object literal of accessor properties — each `get`/`set` body
 * closes over the component binding, so a handler's write is visible to the
 * next handler, the view's effects, and the template.
 */
export interface InterceptorAccess {
  readonly syncing: boolean;
  ephemeralSort: EphemeralSort | null;
  collapsedIds: Set<string>;
  pendingSingleClick: ReturnType<typeof setTimeout> | null;
  readonly lastCtrlMeta: boolean;
  readonly pointerButtonDown: boolean;
  readonly suppressSelectActivation: boolean;
}

/** Stable collaborators the interaction handlers call but never assign. */
export interface InteractionInterceptorDeps {
  /** The echo tag our own programmatic execs carry (`OG_ECHO_SOURCE`). */
  echoSource: string;
  restoreBaseOrder(): void;
  activateBar(id: string, kind: 'single' | 'double', ctrlOrMeta: boolean): void;
  /** Live lookup of a calendar row's backing note path (closes over the view's reactive instances). */
  notePathOf(rowId: string): string | null | undefined;
  /** Live selection read at event time (closes over the view's api binding). */
  getState(): { selected?: ReadonlyArray<string | number> } | undefined;
}

/** Minimal structural slice of the SVAR Gantt api the wiring consumes. */
export interface SvarInterceptApi {
  intercept<E>(action: string, handler: (ev: E) => boolean | void): void;
}

interface SortTasksEvent {
  key?: string;
  order?: string;
  eventSource?: string;
}

interface OpenTaskEvent {
  id?: string | number;
  mode?: boolean;
  eventSource?: string;
}

interface ReorderEvent {
  eventSource?: string;
}

interface ShowEditorEvent {
  id: string;
}

interface SelectTaskEvent {
  id?: string | number;
  toggle?: boolean;
}

const REORDER_ACTIONS = [
  'move-task',
  'move-task:up',
  'move-task:down',
  'reorder-tasks',
  'move-up',
  'move-down',
] as const;

/**
 * The full interaction-cluster registration sequence, in the order the view
 * has always registered it: re-ordering could change which handler sees an
 * event first, which is not a refactor.
 */
export const INTERACTION_INTERCEPT_ACTIONS = [
  'sort-tasks',
  'open-task',
  ...REORDER_ACTIONS,
  'show-editor',
  'select-task',
] as const;

// Ephemeral column sort: a user header click cycles the column
// asc → desc → cleared (cycleNext). SVAR's native
// header click is an infinite asc↔desc toggle with no "clear" state, so we
// drive the cycle off OUR `ephemeralSort` and inject the third (clear) state
// ourselves. For asc/desc we let SVAR perform the sort (its `order` matches
// the cycle, since both go no-sort→asc→desc); for the clear we CANCEL SVAR's
// toggle-back-to-asc (return falsy) and restore the Base order. Echo-guarded
// (mirrors the open-task interceptor) so the diff-sync re-asserts can't re-enter.
export function makeSortTasksInterceptor(
  access: InterceptorAccess,
  deps: InteractionInterceptorDeps,
): (ev: SortTasksEvent) => boolean {
  return (ev) => {
    if (access.syncing || ev?.eventSource === deps.echoSource) return true;
    if (typeof ev?.key !== 'string') return true;
    const nextSort = cycleNext(access.ephemeralSort, ev.key);
    if (nextSort === null) {
      // Third click on the active column → clear. Hide the reset pill now
      // (synchronous state), and restore the Base order on a deferred tick so
      // the store finishes cancelling THIS action before we reset `_sort` +
      // replay the Base-order moves (avoids re-entrancy inside the intercept).
      // Bail if a new sort started within the tick (a fast re-click) — that
      // sort now owns the display (mirrors the reseed re-assert's guard).
      access.ephemeralSort = null;
      setTimeout(() => {
        if (access.ephemeralSort) return;
        deps.restoreBaseOrder();
      }, 0);
      return false;
    }
    access.ephemeralSort = nextSort;
    return true;
  };
}

// Persist user collapse/expand. SVAR fires open-task on a toggle-icon
// click — mode=true expands, mode=false collapses. Let it proceed (return
// true) and record the change so it survives reload. Ignore our own bulk
// collapse-all execs (tagged eventSource) and any event during a reseed.
// Veto only the mid-drag collapse: SVAR's reorder gesture folds a parent
// (startReorder) before dragging it, so a drag begun on a cell would collapse
// the row by surprise. That is the only open-task that fires with a button
// held; the deliberate toggles (chevron click, keyboard hotkey) fire with the
// pointer already up, so they pass.
export function makeOpenTaskInterceptor(
  access: InterceptorAccess,
  deps: InteractionInterceptorDeps,
): (ev: OpenTaskEvent) => boolean {
  return (ev) => {
    if (access.syncing || ev?.eventSource === deps.echoSource) return true;
    if (access.pointerButtonDown) return false;
    const id = ev?.id != null ? String(ev.id) : null;
    if (!id || typeof ev.mode !== 'boolean') return true;
    const next = new Set(access.collapsedIds);
    if (ev.mode) next.delete(id);
    else next.add(id);
    access.collapsedIds = next;
    return true;
  };
}

// Row reordering is disabled. SVAR ships no reorder-toggle prop in this
// version (readonly is too broad — it also kills editing and double-click
// editor opening), so the documented lever is api.intercept returning false.
// A user reorder would not persist (the next data pass rebuilds order) and
// its drag-start collapses parents and swallows in-editor text selection.
// Our own ordering moves are echo-tagged and pass through. The keyboard
// actions and the newer semantic aliases are blocked too so a SVAR bump
// can't silently re-enable reordering.
export function makeReorderBlocker(
  access: InterceptorAccess,
  deps: InteractionInterceptorDeps,
): (ev?: ReorderEvent) => boolean {
  // Echoes must keep passing even for event rows: planReorder's ordering
  // moves are the only way appended event rows stay positioned.
  return (ev) => access.syncing || ev?.eventSource === deps.echoSource;
}

export function makeShowEditorInterceptor(
  access: InterceptorAccess,
  deps: InteractionInterceptorDeps,
): (ev: ShowEditorEvent) => boolean {
  return ({ id }) => {
    // Ignore programmatic selection/editor events emitted while we reseed the
    // store (add/delete/update during diff-sync) — those are not user clicks.
    // Without this, a per-view settings change that reseeds the chart would
    // spuriously open the TaskNotes edit modal. Same guard as update-task.
    if (access.syncing) return false;
    if (access.pendingSingleClick) {
      globalThis.clearTimeout(access.pendingSingleClick);
      access.pendingSingleClick = null;
    }
    // A calendar-item row never opens a task editor: with a backing note the
    // double-click opens that note (activateBar's synthetic id resolves to it
    // downstream), without one it is a no-op.
    const route = resolveShowEditorRoute(id, deps.notePathOf);
    if (route.kind === 'open-note') {
      deps.activateBar(String(id), 'double', access.lastCtrlMeta);
      return false;
    }
    if (route.kind === 'none') return false;
    // Double-click runs the configured action regardless of selection.
    if (id && resolveClickActivation({ kind: 'double' }) === 'activateDouble') {
      deps.activateBar(String(id), 'double', access.lastCtrlMeta);
    }
    return false;
  };
}

// Single-click → SVAR fires `select-task` (carries `toggle` = ctrl/meta).
// SVAR applies its own `.wx-selected` highlight when we return true; we add
// the select-first gate on top: only an already-selected row activates.
export function makeSelectTaskInterceptor(
  access: InterceptorAccess,
  deps: InteractionInterceptorDeps,
): (ev: SelectTaskEvent) => boolean {
  return (ev) => {
    // Ignore programmatic re-selection emitted during a store reseed (a
    // deleted/re-added selected task makes SVAR fire select-task with
    // syncing=true). Only genuine user clicks drive selection/activation.
    if (access.syncing) return true;
    // Focus's programmatic select: apply the highlight (return true) but never
    // schedule activation, so focusing keeps navigation-only even when the
    // target was already selected. Drop any stale pending single action.
    if (access.suppressSelectActivation) {
      if (access.pendingSingleClick) {
        globalThis.clearTimeout(access.pendingSingleClick);
        access.pendingSingleClick = null;
      }
      return true;
    }
    const id = ev?.id != null ? String(ev.id) : null;
    if (id) {
      // Select-first gate: the intercept runs BEFORE SVAR applies this
      // selection, so getState().selected still holds the pre-click set.
      const selectedBefore = (deps.getState()?.selected ?? []).map(String);
      const wasSelected = selectedBefore.includes(id);

      // Ctrl/Cmd is the new-tab modifier, NOT multi-select (out of scope).
      // SVAR maps ctrl/meta to `toggle` (add-to-selection); clear it so a
      // modified click can never leave a lingering multi-selection. Read
      // the modifier from the pointer event — the same source the double-click
      // (show-editor) path uses.
      const ctrlOrMeta = ev.toggle === true || access.lastCtrlMeta;
      if (ev.toggle) ev.toggle = false;

      // Drop any stale deferred action from a previous click.
      if (access.pendingSingleClick) {
        globalThis.clearTimeout(access.pendingSingleClick);
        access.pendingSingleClick = null;
      }

      if (resolveClickActivation({ kind: 'single', wasSelected }) === 'activateSingle') {
        // Second click of an already-selected row → run the configured action,
        // deferred so a following double-click can cancel it.
        access.pendingSingleClick = setTimeout(() => {
          access.pendingSingleClick = null;
          deps.activateBar(id, 'single', ctrlOrMeta);
        }, 250);
      }
      // else: first click of an unselected row → select + highlight only.
      // We return true so SVAR applies `.wx-selected`; no action is scheduled.
    }
    return true;
  };
}

/**
 * Register the interaction cluster against the SVAR api in the preserved
 * order. The data-mutation cluster (drag/update/link handlers) is the next
 * extraction slice; until then the view registers those inline after this call.
 */
export function wireInteractionInterceptors(
  api: SvarInterceptApi,
  access: InterceptorAccess,
  deps: InteractionInterceptorDeps,
): void {
  api.intercept('sort-tasks', makeSortTasksInterceptor(access, deps));
  api.intercept('open-task', makeOpenTaskInterceptor(access, deps));
  const blockUserReorder = makeReorderBlocker(access, deps);
  for (const reorderAction of REORDER_ACTIONS) {
    api.intercept(reorderAction, blockUserReorder);
  }
  api.intercept('show-editor', makeShowEditorInterceptor(access, deps));
  api.intercept('select-task', makeSelectTaskInterceptor(access, deps));
}
