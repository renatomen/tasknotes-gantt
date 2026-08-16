/**
 * SVAR interceptor policies, extracted from `GanttContainer.svelte` so echo
 * suppression, collapse persistence, reorder blocking, selection/activation
 * semantics, drag vetoes, cell-edit routing, and link authoring are provable
 * in jest.
 *
 * The view owns every piece of mutable state. Handlers reach it only through
 * {@link InterceptorAccess} — live getter/setter properties closed over the
 * view's scope — never through copied values: a snapshot of `syncing` would
 * silently stop suppressing echo re-entry the first time the sync coordinator
 * raises it. Reactive `$derived` reads (`readOnly`, `cellEditColumnIds`)
 * cross the same way, as getter-valued deps: both change without a SVAR
 * re-init, so a wiring-time value would freeze the policy.
 *
 * @module bases/svarInterceptors
 */
import { cycleNext, type EphemeralSort } from './sortCycle';
import { resolveShowEditorRoute } from './eventRowGuards';
import { resolveClickActivation } from './taskNotesInteractions';
import type { DrawnLink, UpdateEventClass, UpdateGesture } from './cascadeGate';
import type { TypedValue } from './propertyValues';

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
): (ev: ShowEditorEvent) => false {
  const routeDoubleClick = ({ id }: ShowEditorEvent): void => {
    // Ignore programmatic selection/editor events emitted while we reseed the
    // store (add/delete/update during diff-sync) — those are not user clicks.
    // Without this, a per-view settings change that reseeds the chart would
    // spuriously open the TaskNotes edit modal. Same guard as update-task.
    if (access.syncing) return;
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
      return;
    }
    if (route.kind === 'none') return;
    // Double-click runs the configured action regardless of selection.
    if (id && resolveClickActivation({ kind: 'double' }) === 'activateDouble') {
      deps.activateBar(String(id), 'double', access.lastCtrlMeta);
    }
  };
  // The interceptor's answer to SVAR is the constant `false` — its native
  // editor never opens; editing is fully delegated to TaskNotes. The routing
  // above carries the policy; the return carries no decision.
  return (ev) => {
    routeDoubleClick(ev);
    return false;
  };
}

// Single-click → SVAR fires `select-task` (carries `toggle` = ctrl/meta).
// SVAR applies its own `.wx-selected` highlight when we return true; we add
// the select-first gate on top: only an already-selected row activates.
export function makeSelectTaskInterceptor(
  access: InterceptorAccess,
  deps: InteractionInterceptorDeps,
): (ev: SelectTaskEvent) => true {
  const gateSingleClickActivation = (ev: SelectTaskEvent): void => {
    // Ignore programmatic re-selection emitted during a store reseed (a
    // deleted/re-added selected task makes SVAR fire select-task with
    // syncing=true). Only genuine user clicks drive selection/activation.
    if (access.syncing) return;
    // Focus's programmatic select: never schedule activation, so focusing
    // keeps navigation-only even when the target was already selected. Drop
    // any stale pending single action.
    if (access.suppressSelectActivation) {
      if (access.pendingSingleClick) {
        globalThis.clearTimeout(access.pendingSingleClick);
        access.pendingSingleClick = null;
      }
      return;
    }
    const id = ev?.id != null ? String(ev.id) : null;
    if (!id) return;
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
    // else: first click of an unselected row → select + highlight only;
    // no action is scheduled.
  };
  // The interceptor's answer to SVAR is the constant `true` — SVAR always
  // applies its own `.wx-selected` highlight; the gate above only decides
  // whether a deferred activation gets scheduled. The return carries no
  // decision.
  return (ev) => {
    gateSingleClickActivation(ev);
    return true;
  };
}

/**
 * Register the interaction cluster against the SVAR api in the preserved
 * order. Composed by {@link wireSvarInterceptors}, which the view calls once;
 * exported separately as the interaction cluster's own test seam.
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

// ── Data-mutation cluster (drag-task / update-task / add-link / delete-link) ──

/** The slice of SVAR's `update-task` payload the data-mutation policies read. */
export interface UpdateTaskEvent {
  id?: string | number;
  inProgress?: boolean;
  eventSource?: string;
  task?: Record<string, unknown>;
}

/**
 * The slice of SVAR's `add-link`/`delete-link` event payloads the dependency
 * authoring path reads. `delete-link` carries `{ id }`; `add-link` carries
 * `{ link: { source, target, type } }` (a user-drawn link has no id until SVAR
 * assigns one after the intercept). `eventSource` is our echo tag.
 */
export interface LinkEvent {
  id?: string | number;
  inProgress?: boolean;
  eventSource?: string;
  link?: { source?: string | number; target?: string | number; type?: string };
}

/**
 * Stable collaborators plus live getter-valued reads for the data-mutation
 * handlers. `isReadOnly` and `cellEditColumnIds` wrap the view's `$derived`
 * bindings — a capabilities flip or a grid-column edit changes them without a
 * SVAR re-init, so they must be read at event time, never captured at wiring.
 * The classifiers and row/link predicates cross as deps (not module imports)
 * so tests drive the handlers' plumbing of live state into them.
 */
export interface DataInterceptorDeps {
  /** The echo tag our own programmatic execs carry (`OG_ECHO_SOURCE`). */
  echoSource: string;
  /** Live read of the view's `$derived` write-capability flag. */
  isReadOnly(): boolean;
  /** Live read of the view's `$derived` editor-attached column ids. */
  cellEditColumnIds(): ReadonlyArray<string>;
  allowsRowMutation(id: unknown): boolean;
  refusesUserRowMutation(
    ev: { id?: unknown; eventSource?: string },
    context: { syncing: boolean; echoSource: string },
  ): boolean;
  allowsLinkEndpoints(source: unknown, target: unknown): boolean;
  /** Live per-row lookup of derived (occupancy) bar geometry (closes over the view's api binding). */
  rowHasDerivedGeometry(id: string | number | undefined): boolean;
  linkTouchesDerivedGeometry(source: unknown, target: unknown): boolean;
  classifyUpdateEvent(
    ev: { eventSource?: string | null },
    opts: { echoSource: string; syncing: boolean },
  ): UpdateEventClass;
  classifyUpdateGesture(
    ev: { eventSource?: string | null; task?: Record<string, unknown> },
    opts: {
      echoSource: string;
      syncing: boolean;
      cellEditColumnIds: ReadonlyArray<string>;
      storedProperties: Readonly<Record<string, TypedValue>> | undefined;
    },
  ): UpdateGesture;
  classifyLinkCreate(link: DrawnLink): { predecessor: string; dependent: string } | null;
  /** Live lookup of a row's stored typed values (closes over the view's api binding). */
  storedPropertiesOf(id: string | number | undefined): Record<string, TypedValue> | undefined;
  handleCellEditCommit(instanceId: string, columnId: string, rawValue: unknown): boolean;
  reseedRowFlatKeys(instanceId: string): void;
  handleUserBarGesture(ev: UpdateTaskEvent, id: string): boolean;
  /** Presence gates the bar-gesture route; the gesture handler persists through it. */
  onMutate?(instanceId: string, patch: unknown): Promise<void>;
  onAddDependency?(predecessorInstanceId: string, dependentInstanceId: string): Promise<void>;
  onRemoveDependency?(predecessorInstanceId: string, dependentInstanceId: string): Promise<void>;
  /** Live lookup into the applied diff-sync link map (closes over the view's applied state). */
  lookupAppliedLink(linkId: string): { source: string; target: string } | undefined;
  /** User-facing notice (the view backs it with Obsidian's `Notice`). */
  notify(message: string): void;
}

/** Everything one {@link wireSvarInterceptors} call needs: both clusters' collaborators. */
export interface SvarInterceptorDeps extends InteractionInterceptorDeps, DataInterceptorDeps {}

// Unified drag veto. Read-only calendar-item rows: refusing `drag-task` makes
// SVAR abort the move/resize gesture natively at the first frame — the bar
// never moves. Occupancy rows refuse the same way: their bar is a DERIVED
// envelope of instances, so a drag (even on a bare gap stretch between pieces)
// would commit absolute envelope dates into scheduled/due.
export function makeDragTaskInterceptor(
  deps: DataInterceptorDeps,
): (ev: { id?: string | number }) => boolean {
  return (ev) => deps.allowsRowMutation(ev?.id) && !deps.rowHasDerivedGeometry(ev?.id);
}

// Committed update routing. Parents are ordinary (non-summary) tasks, so
// dragging one moves only that bar — SVAR fires a single committing
// `update-task` (no eventSource) and no cascade. The committed gesture is
// submitted to the gesture handler, which runs the planner's gesture plan and
// its deferred cascade pass in one per-source queue slot. `inProgress` frames
// and our own echoes / refreshes pass through untouched.
export function makeUpdateTaskInterceptor(
  access: InterceptorAccess,
  deps: DataInterceptorDeps,
): (ev: UpdateTaskEvent) => boolean {
  return (ev) => {
    if (!ev || ev.inProgress) return true;
    // Read-only calendar-item rows: refuse any user change (cell edit,
    // progress, dates) before gesture classification; our echoes and
    // programmatic refreshes keep passing so the diff-sync applies.
    if (deps.refusesUserRowMutation(ev, { syncing: access.syncing, echoSource: deps.echoSource })) {
      return false;
    }
    // Cell edits fold into the same event stream: the grid's update-cell
    // bridge re-emits a committed inline edit as an untagged `update-task`
    // with a flat `[columnId]` key; classifyUpdateGesture tells those apart
    // from drag/resize gestures by diffing flat keys against stored values.
    const gesture = deps.classifyUpdateGesture(ev, {
      echoSource: deps.echoSource,
      syncing: access.syncing,
      cellEditColumnIds: deps.cellEditColumnIds(),
      storedProperties: deps.storedPropertiesOf(ev.id),
    });
    if (gesture.kind === 'cell-edit') {
      return ev.id != null
        ? deps.handleCellEditCommit(String(ev.id), gesture.columnId, gesture.value)
        : false;
    }
    // Re-committing the current value: nothing to write, nothing to revert.
    if (gesture.kind === 'cell-edit-noop') return false;
    // More than one flat key diffs (a stale committed key over an externally
    // changed note): writing either could clobber the external change, so
    // block the apply, re-align the row's flat keys with the stored truth,
    // and tell the user the silently-dropped edit needs a retry.
    if (gesture.kind === 'cell-edit-ambiguous') {
      if (ev.id != null) deps.reseedRowFlatKeys(String(ev.id));
      deps.notify("Couldn't save — the row changed externally; try again.");
      return false;
    }
    if (gesture.kind === 'user-gesture' && !deps.isReadOnly() && !!deps.onMutate && ev.id != null) {
      return deps.handleUserBarGesture(ev, String(ev.id));
    }
    return true;
  };
}

// Drag-to-create an FS dependency. SVAR fires `add-link` on drop; a
// user-drawn link has no id yet (SVAR assigns a temp id in the router AFTER
// this intercept), so we return `false` and let the controller write drive
// the arrow via the diff-sync — no optimistic add, no temp-id revert.
// Only `e2s` (finish→start) is accepted; other geometries / self-links are
// rejected. Our own echo / programmatic refresh (cls !== 'user-gesture')
// passes through so the diff-sync's add-link applies.
export function makeAddLinkInterceptor(
  access: InterceptorAccess,
  deps: DataInterceptorDeps,
): (ev: LinkEvent) => boolean {
  return (ev) => {
    if (!ev || ev.inProgress) return true;
    if (
      deps.classifyUpdateEvent(ev, { echoSource: deps.echoSource, syncing: access.syncing }) !==
      'user-gesture'
    ) {
      return true;
    }
    const onAddDependency = deps.onAddDependency;
    if (deps.isReadOnly() || !onAddDependency || !ev.link) return false;
    // Dependencies never touch a read-only calendar-item row on either end,
    // nor an occupancy row — an edge would anchor to its derived envelope.
    if (!deps.allowsLinkEndpoints(ev.link.source, ev.link.target)) return false;
    if (deps.linkTouchesDerivedGeometry(ev.link.source, ev.link.target)) return false;
    const roles = deps.classifyLinkCreate({
      source: String(ev.link.source ?? ''),
      target: String(ev.link.target ?? ''),
      type: String(ev.link.type ?? ''),
    });
    if (!roles) {
      deps.notify('Only Finish-to-Start links can be created for now.');
      return false;
    }
    void onAddDependency(roles.predecessor, roles.dependent).catch((err) => {
      console.error('[GanttContainer] add-dependency failed:', err);
      deps.notify("Couldn't create the dependency — check TaskNotes is running.");
    });
    return false;
  };
}

// Delete a dependency. SVAR fires `delete-link { id }` from its
// native select-and-delete. Resolve the link's endpoints from the applied-
// links map (its id may carry SVAR's leading `:`), remove the edge via the
// controller, and return `false` so the diff-sync removal — not SVAR's
// optimistic one — drives the arrow's disappearance. No confirm; no revert
// needed (nothing removed locally).
export function makeDeleteLinkInterceptor(
  access: InterceptorAccess,
  deps: DataInterceptorDeps,
): (ev: LinkEvent) => boolean {
  return (ev) => {
    if (!ev) return true;
    if (
      deps.classifyUpdateEvent(ev, { echoSource: deps.echoSource, syncing: access.syncing }) !==
      'user-gesture'
    ) {
      return true;
    }
    const onRemoveDependency = deps.onRemoveDependency;
    if (deps.isReadOnly() || !onRemoveDependency || ev.id == null) return false;
    const rawId = String(ev.id);
    const link = deps.lookupAppliedLink(rawId.startsWith(':') ? rawId.slice(1) : rawId);
    if (!link) return false;
    // A resolved edge touching a read-only calendar-item row is never
    // removable; same for an occupancy (derived-geometry) row.
    if (!deps.allowsLinkEndpoints(link.source, link.target)) return false;
    if (deps.linkTouchesDerivedGeometry(link.source, link.target)) return false;
    void onRemoveDependency(link.source, link.target).catch((err) => {
      console.error('[GanttContainer] remove-dependency failed:', err);
      deps.notify("Couldn't remove the dependency — check TaskNotes is running.");
    });
    return false;
  };
}

const DATA_INTERCEPT_ACTIONS = ['drag-task', 'update-task', 'add-link', 'delete-link'] as const;

/**
 * The full registration sequence — interaction cluster first, data cluster
 * last, exactly as the view has always registered it. Re-ordering could change
 * which handler sees an event first, which is not a refactor.
 */
export const SVAR_INTERCEPT_ACTIONS = [
  ...INTERACTION_INTERCEPT_ACTIONS,
  ...DATA_INTERCEPT_ACTIONS,
] as const;

/**
 * Register every interceptor policy against the SVAR api in the preserved
 * order ({@link SVAR_INTERCEPT_ACTIONS}). The view's single wiring call:
 * `api.intercept` never appears in `GanttContainer.svelte` itself.
 */
export function wireSvarInterceptors(
  api: SvarInterceptApi,
  access: InterceptorAccess,
  deps: SvarInterceptorDeps,
): void {
  wireInteractionInterceptors(api, access, deps);
  api.intercept('drag-task', makeDragTaskInterceptor(deps));
  api.intercept('update-task', makeUpdateTaskInterceptor(access, deps));
  api.intercept('add-link', makeAddLinkInterceptor(access, deps));
  api.intercept('delete-link', makeDeleteLinkInterceptor(access, deps));
}
