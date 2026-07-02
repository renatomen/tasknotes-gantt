/**
 * Obsidian Bases API Registration for Gantt View
 *
 * Uses the official Obsidian Bases API (1.10.0+) via plugin.registerBasesView().
 * All Bases types are imported from the `obsidian` package.
 *
 * @module bases/register
 */

/* global MouseEvent */
import {
  BasesView,
  TFile,
  type Plugin,
  type BasesViewConfig,
  type BasesPropertyId,
  type BasesSortConfig,
  type BasesAllOptions,
  type QueryController,
} from 'obsidian';
import { mount, unmount } from 'svelte';
import { writable, type Writable } from 'svelte/store';
import GanttContainer from './GanttContainer.svelte';
import { pickActiveFocusEntry } from './focusController';
import type { GanttData } from './types/gantt-view-data';
import { GanttTaskListView } from './views/GanttTaskListView';
import type { FieldMappings } from './types/field-mapping';
import { readFieldMappings } from './fieldMappingConfig';
import {
  GanttController,
  type DatePolicyConfig,
  type DateMappingInfo,
} from '../controller/GanttController';
import type { LinkRewriteMode } from '../controller/InstanceExpansion';
import { TaskNotesInteractions } from './taskNotesInteractions';
import { normalizeCascadeMode } from './cascadeGate';
import { buildEntryProperties, buildFetchedEntryProperties, type FetchedFileMeta } from './propertyValues';
import { buildGridColumns, gridColumnsKey, mergeColumnSize } from './gridColumns';
import { persistGridWidth } from './gridWidthPersist';
import type { TaskPatch } from '../datasource';
import { createCoalescer, type Coalescer } from './coalesce';
import {
  createReadinessWindow,
  DEFAULT_READINESS_WINDOW_CONFIG,
} from './readinessWindow';
import {
  createReadinessOrchestrator,
  type ReadinessOrchestrator,
} from './readinessController';
import { installBasesConfigRefreshHook } from './basesConfigRefresh';
import { BasesDataAdapter } from './services/BasesDataAdapter';
import { asPropertyId } from './types/bases-entry';
import { normalizeDefaultScale } from './zoomConfig';
import {
  ganttViewOptions,
  readContextOpacity,
  readExpandedRelationships,
  readHideTopLevelSubtasks,
  readMaxHeight,
  readMinHeight,
  readShowToolbar,
  readBarColorMode,
  readBarColorSource,
  readBarIcon,
  taskListViewOptions,
} from './viewOptions';
import { persistThemeMode, readThemeMode, type ThemeMode } from './themeResolver';

/**
 * Trailing-debounce window (ms) for the Bases `onDataUpdated` storm (#161).
 * Matches TaskNotes' BasesViewBase (`scheduleBasesDataUpdateRender`, 500ms): long
 * enough to swallow a view-option toggle's persist+reload burst, short enough
 * that a genuine data change still feels responsive.
 */
const GANTT_REFRESH_DEBOUNCE_MS = 500;

/**
 * Build a one-line notice when a start/end date mapping fell back to the default
 * because the configured property isn't a writable TaskNotes date field (R-C).
 * Returns `undefined` when both mappings are valid.
 */
function buildDateMappingNotice(info: DateMappingInfo): string | undefined {
  const parts: string[] = [];
  if (info.startInvalid) {
    parts.push(`Start date mapping isn't a TaskNotes date field — using "${info.startReadProp}".`);
  }
  if (info.endInvalid) {
    parts.push(`End date mapping isn't a TaskNotes date field — using "${info.endReadProp}".`);
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
}
import { readDatePolicyConfig, readRowVisibilityOptions } from './datePolicyConfig';
import { entriesSignature } from './entrySignature';
import { dlog, isGanttDebugEnabled } from '../debugLog';

export { readDatePolicyConfig, readRowVisibilityOptions } from './datePolicyConfig';

// ============================================================================
// Gantt Bases View Implementation
//
// Bases types (`BasesView`, `BasesViewConfig`, `BasesPropertyId`,
// `BasesAllOptions`, `QueryController`, the option interfaces, etc.) are now
// imported from the official `obsidian` package (1.10.0+); the hand-rolled
// parallel vocabulary and the `declare module 'obsidian'` augmentation that
// previously lived here were removed once the package shipped them.
// ============================================================================

const VIEW_TYPE_ID = 'obsidianGantt';
const VIEW_NAME = 'Gantt (OG)';
const VIEW_ICON = 'calendar-range';

/** Ephemeral state for preserving view state across refreshes */
interface GanttEphemeralState {
  scrollTop?: number;
  scrollLeft?: number;
}

/**
 * Gantt chart view for Obsidian Bases
 */
/**
 * Live "focus on task" openers, one per mounted Gantt view, keyed by the view's
 * mount container element. The plugin command ("Gantt: Focus on task…" in
 * main.ts) resolves the opener for the *active* Gantt leaf via
 * {@link getActiveGanttFocusEntry}; a view adds its opener on mount and removes
 * it on teardown. Map insertion order → last = most recently mounted (the
 * fallback when the active leaf can't be matched to a registered view).
 */
const liveFocusEntries = new Map<HTMLElement, () => void>();

/**
 * The focus opener for the active Gantt leaf, or null when no Gantt view is
 * mounted. Given the active leaf's container element, returns the entry whose
 * mount container is inside it (the Gantt in the focused leaf); falls back to
 * the most-recently-mounted entry when the active leaf isn't a Gantt view.
 */
export function getActiveGanttFocusEntry(
  activeContainer?: HTMLElement | null,
): (() => void) | null {
  return pickActiveFocusEntry(liveFocusEntries, activeContainer);
}

class ObsidianGanttBasesView extends BasesView {
  /** This view's mount container, used as the focus-entry registry key. */
  private focusEntryKey: HTMLElement | null = null;
  readonly type = VIEW_TYPE_ID;
  private readonly containerEl: HTMLElement;
  private svelteComponent: ReturnType<typeof mount> | null = null;
  private ephemeralState: GanttEphemeralState = {};

  /** [OGDBG #161] monotonic onDataUpdated counter for loop diagnosis. */
  private dbgDataUpdates = 0;
  /** [OGDBG #161] wall-clock of the previous onDataUpdated, to log inter-notify gaps. */
  private dbgLastUpdateTs = 0;
  /**
   * #161 config-settle hook. While Bases is persisting+reloading a view-option
   * change, it re-fires `onDataUpdated` with the config value oscillating. We
   * SUPPRESS those refreshes (>0 = a change is in flight) and instead refresh once
   * when `onConfigChanged` settles — rendering the stable config, not the churn.
   */
  private configChangeInFlight = 0;
  /** Restores the original `controller.onConfigChanged` on unload (or null). */
  private restoreConfigChangeHook: (() => void) | null = null;

  /**
   * Signature (count + file paths) of the Bases entries at the last refresh
   * (#161 storm fix). A config-only / echo `onDataUpdated` carries the same
   * entries; comparing against this lets the refresh REUSE the controller's
   * cached base tasks (skip the Bases re-read that re-pokes the notify storm)
   * rather than re-extracting every entry's values. `null` until the first mount.
   */
  private lastEntrySignature: string | null = null;

  /**
   * Trailing-debounce for the Bases data-update storm (#161). A view-option
   * toggle / search-clear makes Bases re-fire `onDataUpdated` in a rapid burst
   * (its config persist+reload cycle, during which the persisted value can
   * oscillate); refreshing synchronously on each fire amplifies the burst into a
   * render loop. Coalescing collapses the burst into a single refresh against the
   * settled config — the discipline TaskNotes' BasesViewBase uses (500ms).
   * Created per mount (closes over the live controller); cancelled on unload.
   */
  private refreshCoalescer: Coalescer | null = null;

  /**
   * Post-mount readiness re-check window (#161 §11). When companion mode is active
   * but TaskNotes' relationship index hasn't resolved matched-set edges yet (the
   * lag state PR #166 leaves cached as authoritative-empty), this bounded-backoff
   * orchestrator re-fetches the index a few times until it warms, healing Show-all/
   * Inherit without a manual edit. A no-op in standalone / already-warm mounts.
   * Created per mount; cancelled on unload/remount alongside `refreshCoalescer`.
   */
  private readinessOrchestrator: ReadinessOrchestrator | null = null;

  /** The action layer / source of truth (U6). Recreated per mount. */
  private ganttController: GanttController | null = null;

  /**
   * Reactive store of the dynamic render data. Mounted once into the view; each
   * controller change re-`set`s it, so the SVAR instance persists and keeps its
   * view state (zoom, scroll, selection) across data changes instead of being
   * destroyed by a remount. `null` until the first mount.
   */
  private dataStore: Writable<GanttData> | null = null;

  /**
   * Monotonic mount token. `mountGantt()` is async (the controller's `init()`
   * resolves a source and may await TaskNotes readiness); a newer mount or an
   * unmount that races an in-flight one bumps this so the stale async mount
   * bails instead of clobbering the live component.
   */
  private mountToken = 0;

  /** [OGDBG #161] view-instance counter: a bump here = Bases recreated the view
   * (a remount). Distinguishes "we looped in one view" from "Bases re-created us". */
  private static dbgInstances = 0;
  private readonly dbgInstanceId = ++ObsidianGanttBasesView.dbgInstances;

  constructor(controller: QueryController, parentEl: HTMLElement) {
    super(controller);
    this.containerEl = parentEl.createDiv({ cls: 'og-bases-gantt-root' });
    this.containerEl.style.height = '100%';
    this.containerEl.style.width = '100%';
    dlog(`[OGDBG] GanttView constructed #${this.dbgInstanceId} (a new instance = a Bases view remount)`);

    // #161 config-settle hook (TaskNotes-ported). Refresh ONCE after Bases'
    // `onConfigChanged` settles (its returned persist+reload resolves), against the
    // stable config — and mark the change "in flight" so the oscillating
    // `onDataUpdated` burst during the reload is suppressed (see onDataUpdated).
    this.restoreConfigChangeHook = installBasesConfigRefreshHook({
      controller,
      view: this,
      isConnected: () => !!this.containerEl?.isConnected,
      onChangeStart: () => {
        this.configChangeInFlight += 1;
        dlog(`[OGDBG] onConfigChanged START (inFlight=${this.configChangeInFlight})`);
      },
      onSettled: () => {
        if (this.configChangeInFlight > 0) this.configChangeInFlight -= 1;
        dlog(`[OGDBG] onConfigChanged SETTLED (inFlight=${this.configChangeInFlight}) → refresh`);
        // One refresh on the settled config. Entries are unchanged (config-only),
        // so the coalescer reuses cached tasks and re-runs only the cheap companion
        // expansion against the now-stable option value.
        this.refreshCoalescer?.schedule();
      },
      scheduleTimeout: (callback, delayMs) => { window.setTimeout(callback, delayMs); },
    });
  }

  override onload(): void {
    // Don't mount yet - wait for onDataUpdated() when config and data are ready
    dlog('[Gantt] View loaded, waiting for data...');
  }

  override onunload(): void {
    dlog(`[OGDBG] GanttView onunload #${this.dbgInstanceId}`);
    this.refreshCoalescer?.cancel();
    this.readinessOrchestrator?.cancel();
    this.restoreConfigChangeHook?.();
    this.restoreConfigChangeHook = null;
    this.unmountGantt();
  }

  /**
   * Called by Obsidian when data changes.
   * Re-renders the Gantt chart with updated data.
   *
   * Refreshes **in place**, not by remounting: the first data event mounts the
   * view once; subsequent ones re-select the controller's source (rebuilding the
   * Bases source from the now-current live entries), which fires the controller's
   * change listener → a store update the persistent component renders. Avoiding
   * the remount preserves the SVAR view state (zoom, scroll, selection) across
   * writes and filter changes.
   */
  public onDataUpdated(): void {
    // Skip a detached view (#161): during a Bases config persist+reload the
    // outgoing view instance still receives onDataUpdated while disconnected.
    // Recomputing for it is wasted work that feeds the refresh storm. Mirrors
    // TaskNotes' BasesViewBase isConnected guard.
    if (!this.containerEl?.isConnected) {
      return;
    }
    if (!this.svelteComponent || !this.ganttController) {
      dlog('[Gantt] First data event — mounting. Entries:', this.data?.data?.length || 0);
      void this.mountGantt();
      return;
    }
    this.dbgDataUpdates += 1;
    const nowTs = Date.now();
    const gapMs = this.dbgLastUpdateTs ? nowTs - this.dbgLastUpdateTs : 0;
    this.dbgLastUpdateTs = nowTs;
    dlog(`[OGDBG] onDataUpdated #${this.dbgDataUpdates} (+${gapMs}ms) entries=${this.data?.data?.length ?? 0}`);
    // #161 U6 (search→clear loop) investigation tool: who fired this onDataUpdated?
    // Bases-internal frames ⇒ autonomous re-notify; our-plugin frames ⇒ a feedback
    // loop. `new Error().stack` is EXPENSIVE per-event, so it is gated default-OFF
    // (set window.__tnGanttDebug=true) and capped — never always-on in production.
    // See docs/solutions/developer-experience/no-heavy-diagnostics-on-hot-paths.md.
    if (isGanttDebugEnabled() && this.dbgDataUpdates <= 6) {
      dlog(`[OGDBG] onDataUpdated-stack #${this.dbgDataUpdates}:\n${(new Error('og:onDataUpdated-stack').stack ?? '').split('\n').slice(1, 12).join('\n')}`);
    }
    // #161 config-settle suppression: while a view-option change is in flight,
    // Bases re-fires onDataUpdated with the config value OSCILLATING. Refreshing on
    // those paints the intermediate (stale) states — our expensive SVAR diff. Skip
    // them; the onConfigChanged settle hook refreshes ONCE against the stable config
    // when Bases' persist+reload resolves. Genuine data updates (no change in
    // flight) still coalesce + refresh normally below.
    if (this.configChangeInFlight > 0) {
      dlog(`[OGDBG] onDataUpdated #${this.dbgDataUpdates} SUPPRESSED (config change in flight)`);
      return;
    }
    // Coalesce a Bases update burst into ONE trailing refresh (#161): debouncing
    // collapses rapid fires so we re-select the source once. The controller's
    // change listener then refreshes the store in place — no remount.
    this.refreshCoalescer?.schedule();
  }

  /**
   * Focus the view - required by Bases view contract
   */
  public focus(): void {
    this.containerEl?.focus();
  }

  /**
   * Get ephemeral state (scroll position, etc.) for preservation
   */
  public getEphemeralState(): GanttEphemeralState {
    return {
      scrollTop: this.containerEl?.scrollTop ?? 0,
      scrollLeft: this.containerEl?.scrollLeft ?? 0,
    };
  }

  /**
   * Restore ephemeral state after refresh
   */
  public setEphemeralState(state: GanttEphemeralState): void {
    this.ephemeralState = state;
    if (this.containerEl && state) {
      if (state.scrollTop !== undefined) {
        this.containerEl.scrollTop = state.scrollTop;
      }
      if (state.scrollLeft !== undefined) {
        this.containerEl.scrollLeft = state.scrollLeft;
      }
    }
  }

  /**
   * Called when view is resized - required by Bases view contract
   */
  public onResize(): void {
    // Future: notify Svelte component of resize if needed
  }

  /**
   * Cheap signature of the current Bases entries — count + each entry's file
   * path, joined. Reads ONLY `entry.file.path` (a plain TFile reference), never
   * `getValue` (the value extraction that re-pokes Bases — #161). Two notifies
   * with the same signature carry the same matched set, so the refresh can reuse
   * the controller's cached base tasks instead of re-reading the source.
   */
  private computeEntrySignature(): string {
    return entriesSignature((this.data?.data ?? []) as ReadonlyArray<{ file?: { path?: string } }>);
  }

  /** Stateless extractor for grid property-column values (U1). */
  private readonly gridAdapter = new BasesDataAdapter();

  /**
   * The Base's visible property ids, in display order (U2). Prefer the view
   * config's `getOrder()` (the user's live column selection); fall back to the
   * query result's `properties` when it's unavailable/empty.
   */
  private getVisiblePropertyIds(): BasesPropertyId[] {
    try {
      const order = this.config.getOrder?.();
      if (Array.isArray(order) && order.length > 0) return order;
    } catch {
      // getOrder unavailable on this Bases version — fall through.
    }
    return this.data?.properties ?? [];
  }

  /**
   * The Base's sort descriptor (`config.getSort()`) — the toolbar sort, as
   * `{ property, direction }[]` (primary first). Drives the default-view
   * fetched-row interleave (R7/U6). Returns `[]` when no sort is configured or
   * `getSort()` is unavailable on this Bases version → matched-first fallback.
   */
  private getBaseSort(): readonly BasesSortConfig[] {
    try {
      const sort = this.config.getSort?.();
      if (Array.isArray(sort)) return sort;
    } catch {
      // getSort unavailable on this Bases version — fall through to no sort.
    }
    return [];
  }

  /** The Base's display name for a property id, falling back to the id (U2). */
  private getDisplayName(propertyId: BasesPropertyId): string {
    try {
      const name = this.config.getDisplayName?.(propertyId);
      if (typeof name === 'string' && name.trim() !== '') return name;
    } catch {
      // getDisplayName unavailable — fall through to the id.
    }
    return propertyId;
  }

  /**
   * The standard per-property width map (`columnSize`), or undefined when
   * unset/malformed. Same field the native table view uses (U2/U7).
   */
  private getColumnSize(): Record<string, number> | undefined {
    const raw = this.config.get('columnSize');
    if (!raw || typeof raw !== 'object') return undefined;
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'number' && value > 0) out[key] = value;
    }
    return out;
  }

  /**
   * The persisted grid/timeline divider width (`tableWidth`), or undefined when
   * unset/invalid (→ SVAR's default grid width). Standard `obsidianGantt`
   * namespaced key (plan 002 U3).
   */
  private getTableWidth(): number | undefined {
    const raw = this.config.get('tngantt_tableWidth');
    return typeof raw === 'number' && raw > 0 ? raw : undefined;
  }

  /**
   * Build the FieldMappings from the current view config (OG-87).
   *
   * start/end default to "unset" (empty): the controller then resolves them to
   * TaskNotes' configured scheduled/due when TaskNotes is present, else to the
   * legacy note.start/note.due (see GanttController.applyDateFieldMapping).
   */
  private buildFieldMappings(): FieldMappings {
    return readFieldMappings((key) => this.config.get(key));
  }

  /** Read the per-view dependency-arrow mode (R27), defaulting to `primary`. */
  private getArrowMode(): LinkRewriteMode {
    return this.config.get('tngantt_dependencyArrowMode') === 'all' ? 'all' : 'primary';
  }

  /** Build the date-policy + visibility config from the per-view options (U3). */
  private buildDatePolicyConfig(): DatePolicyConfig {
    return readDatePolicyConfig((key) => this.config.get(key));
  }

  /** Read the per-view "show date-status indicators" toggle (R11); default on. */
  private getShowDateIndicators(): boolean {
    return this.config.get('tngantt_showDateIndicators') !== false;
  }

  /** Read the per-view "show toolbar" toggle (plan 002 R2); default off. */
  private getShowToolbar(): boolean {
    return readShowToolbar((key) => this.config.get(key));
  }

  /** Read the per-view max-height in px (plan 003 R1); default 400. */
  private getMaxHeight(): number {
    return readMaxHeight((key) => this.config.get(key));
  }

  /** Read the per-view min-height in px; default/clamped to the ~2-row floor. */
  private getMinHeight(): number {
    return readMinHeight((key) => this.config.get(key));
  }

  /** Read the per-view Expanded relationships mode (companion mode); default inherit. */
  private getExpandedRelationships() {
    return readExpandedRelationships((key) => this.config.get(key));
  }

  /** Read the per-view Hide top-level subtasks toggle (companion mode); default off. */
  private getHideTopLevelSubtasks(): boolean {
    return readHideTopLevelSubtasks((key) => this.config.get(key));
  }

  /** Read the per-view Show-all context-bar opacity (U6) as a 0–1 fraction. */
  private getContextOpacity(): number {
    return readContextOpacity((key) => this.config.get(key));
  }

  /** Read the per-view bar color mode (U5); default `fill`. */
  private getBarColorMode() {
    return readBarColorMode((key) => this.config.get(key));
  }

  /** Read the per-view bar color source (U5); default `default`. */
  private getBarColorSource() {
    return readBarColorSource((key) => this.config.get(key));
  }

  /** Read the per-view task-icon source (U5); default `none`. */
  private getBarIcon() {
    return readBarIcon((key) => this.config.get(key));
  }

  /**
   * Read the per-view theme mode (plan 002 R4), normalized to
   * `auto`|`light`|`dark` (default `auto`). Mirrors getArrowMode() /
   * getShowDateIndicators(); the toolbar persists the value via setThemeMode().
   */
  private getThemeMode(): ThemeMode {
    return readThemeMode((key) => this.config.get(key));
  }

  /**
   * Read the per-view parent/ancestor date-cascade mode; defaults to `ask`.
   * Governs whether a child drag/resize that would change ancestor spans
   * prompts before writing the ancestor notes (see cascadeGate / GanttContainer).
   */
  private getCascadeMode(): import('./cascadeGate').CascadeMode {
    return normalizeCascadeMode(this.config.get('tngantt_parentDateCascade'));
  }

  /**
   * Mount the Svelte view from controller-derived data (U7).
   *
   * The controller now owns the transform: this builds a {@link GanttController}
   * whose `basesInput` reads the *current* Bases entries + mappings at selection
   * time, awaits `init()` (source selection, which may await TaskNotes
   * readiness), then mounts {@link GanttContainer} with the expanded instances,
   * rewritten links, and the active source capabilities. `data`/`fieldMappings`
   * are no longer passed to the component.
   *
   * Async-safe: a `mountToken` captured before `await` is re-checked after, so a
   * remount/unmount that races this in-flight mount discards the stale result.
   */
  private async mountGantt(): Promise<void> {
    const token = ++this.mountToken;
    try {
      // The controller reads the live Bases query at (re-)selection time, so the
      // provider closes over `this` rather than a captured snapshot.
      const controller = new GanttController({
        app: this.app,
        // The Gantt is a Bases view: the Base owns the task set (its filter +
        // field mappings), TaskNotes enriches it (dependencies, and writes in
        // U8). See GanttController SourceStrategy.
        sourceStrategy: 'bases-scoped',
        basesInput: () => ({
          entries: this.data?.data ?? [],
          mappings: this.buildFieldMappings(),
        }),
        // All per-view controller settings are provider closures → read fresh on
        // every recompute, so toggling any per-view option applies instantly
        // (onDataUpdated → refreshSource), no manual refresh/remount needed.
        policyConfig: () => this.buildDatePolicyConfig(),
        // hideTopLevel is NOT a companion concern anymore — it's a pure view
        // display filter (filter-tasks), so the expanded instance set is identical
        // whether the toggle is on or off (#161: a config toggle can't churn it).
        companionConfig: () => ({
          mode: this.getExpandedRelationships(),
        }),
        // Default-view safe-partial interleave (plan 002 R7/U6): the controller
        // positions Show-all fetched rows among their matched siblings by the
        // Base's primary sort when it maps to a Gantt field. Read fresh each
        // recompute (provider closure) so a toolbar-sort change reflows without a
        // remount. getSort() returns [] when no sort is configured → fallback.
        sortConfig: () => this.getBaseSort(),
      });

      await controller.init();

      // A newer mount or an unmount happened while we awaited init() — discard.
      if (token !== this.mountToken) {
        controller.dispose();
        return;
      }

      this.ganttController = controller;
      // Trailing-debounce for onDataUpdated (#161): closes over this mount's
      // controller; re-checks isConnected at fire time so a refresh queued just
      // before teardown is dropped. Recreated per mount, cancelled on unload.
      this.refreshCoalescer = createCoalescer(() => {
        if (!this.containerEl?.isConnected) return;
        // #161 storm fix: a config-only / echo notify carries the SAME Bases
        // entries (matched set). Re-reading them (controller.refreshSource →
        // source.getTasks, extracting every entry's values) is what re-pokes Bases
        // into an endless re-notify storm. Compare a cheap entry signature
        // (count + paths, no value reads) to the last refresh: unchanged ⇒ tell
        // the controller to REUSE the cached base tasks (skip the Bases re-read,
        // breaking the feedback); changed (filter/data) ⇒ a real re-read.
        const sig = this.computeEntrySignature();
        // [OGDBG #161] `__OG_DISABLE_REUSE` forces the pre-fix behavior (always
        // re-read the source) so the storm repro can validate fails-first.
        const disableReuse = !!(window as unknown as { __OG_DISABLE_REUSE?: boolean }).__OG_DISABLE_REUSE;
        const reuseTasks = !disableReuse && this.lastEntrySignature !== null && sig === this.lastEntrySignature;
        this.lastEntrySignature = sig;
        dlog(`[OGDBG] coalescer fired → refreshSource (reuseTasks=${reuseTasks})`);
        void (async () => {
          await this.ganttController?.refreshSource({ reuseTasks });
          // Always push the latest view-DISPLAY config to the store — even when the
          // instance snapshot is unchanged. The controller only notifies on a
          // CHANGED snapshot, so a config-only toggle (e.g. Hide-top, now that it no
          // longer alters the instance set) would otherwise never reach the view.
          // `store.set` re-runs the component's filter/display effects; the task
          // sync sees no diff (NOOP), so this stays cheap and cannot churn (#161).
          await this.refreshData();
        })();
      }, GANTT_REFRESH_DEBOUNCE_MS);
      // Native edit interaction (plan 004): resolves bar clicks to TaskNotes
      // actions (open note / native edit modal / task menu). Holds only `app`.
      const interactions = new TaskNotesInteractions(this.app);

      const data = await this.buildGanttData(controller);
      // Seed the entry signature from the mount-time entries so the FIRST
      // config-only onDataUpdated already reuses the cached tasks (no re-read,
      // no storm) instead of paying one full re-read before the gate engages.
      this.lastEntrySignature = this.computeEntrySignature();

      // Re-check after the second await window.
      if (token !== this.mountToken) {
        controller.dispose();
        return;
      }

      dlog('[Gantt] Mounting (refresh-in-place):', {
        instanceCount: data.instances.length,
        linkCount: data.links.length,
        write: data.capabilities.write,
        arrowMode: data.arrowMode,
      });

      // One reactive store, mounted once; controller changes re-set it in place.
      this.dataStore = writable(data);
      const tMountStart = performance.now(); // [OGDBG #161]
      this.svelteComponent = mount(GanttContainer, {
        target: this.containerEl,
        props: {
          data: this.dataStore,
          app: this.app,
          config: this.config,
          // Theme toolbar (plan 002 U3/U4): the initial per-view theme mode and
          // a persist callback closing over config.set so the toolbar never
          // touches config directly. Toolbar VISIBILITY is NOT passed here — it
          // flows through the reactive GanttData store (showToolbar) so toggling
          // the option live shows/hides the toolbar without a remount.
          themeMode: this.getThemeMode(),
          onThemeModeChange: (mode: ThemeMode) =>
            persistThemeMode((key, value) => this.config.set(key, value), mode),
          // Drag/resize persistence (U8): the view calls this on a commit; the
          // controller resolves instance→source and writes through TaskNotes.
          onMutate: (instanceId: string, patch: TaskPatch) => controller.mutate(instanceId, patch),
          // FS dependency authoring (M2): drag-to-create / delete a link route to
          // the controller, which resolves both endpoints → source and writes
          // blockedBy through TaskNotes.
          onAddDependency: (predecessorInstanceId: string, dependentInstanceId: string) =>
            controller.addDependency(predecessorInstanceId, dependentInstanceId),
          onRemoveDependency: (predecessorInstanceId: string, dependentInstanceId: string) =>
            controller.removeDependency(predecessorInstanceId, dependentInstanceId),
          // Native edit interaction (plan 004): a bar's left/double-click and
          // right-click delegate to TaskNotes (open note / native edit modal /
          // task menu) via the interaction service — no custom modal.
          onBarActivate: (path: string, opts: { kind: 'single' | 'double'; ctrlOrMeta: boolean }) =>
            interactions.handleActivate(path, opts),
          onBarContextMenu: (path: string, event: MouseEvent) =>
            interactions.showContextMenu(path, event),
          // Focus-on-task command wiring (R2): the view publishes its opener on
          // mount and retracts it on teardown, so the plugin command targets the
          // active Gantt view. Tracked per-view so one view's teardown never
          // clears another live view's entry.
          onFocusEntryReady: (entry: (() => void) | null) => {
            if (entry) {
              this.focusEntryKey = this.containerEl;
              liveFocusEntries.set(this.containerEl, entry);
            } else if (this.focusEntryKey) {
              liveFocusEntries.delete(this.focusEntryKey);
              this.focusEntryKey = null;
            }
          },
          // Column resize persistence (U8/R8): write the new width back to the
          // standard `columnSize` map so it survives reload. Merges into the
          // current map (never clobbers a width the native table view stored).
          onColumnResize: (propId: string, width: number) => {
            try {
              this.config.set('columnSize', mergeColumnSize(this.getColumnSize(), propId, width));
            } catch (error) {
              console.warn('[Gantt] Failed to persist column width:', error);
            }
          },
          // Divider width persistence (plan 002 U3): write the dragged grid-pane
          // width to the standard `tableWidth` so it survives reload. In-session
          // dragging is SVAR's Resizer; this only persists the chosen value.
          // persistGridWidth skips unchanged writes — the loop guard. Persisting
          // an unchanged width feeds a refresh loop (config.set → Obsidian
          // re-runs onDataUpdated → chart refreshes → re-asserts width → …),
          // which ignites on the command-palette light/dark toggle (flips the
          // effective theme → remounts → re-execs resize-grid with the
          // already-persisted width).
          onGridWidthChange: (width: number) =>
            persistGridWidth((key, value) => this.config.set(key, value), this.getTableWidth(), width),
        },
      });
      // [OGDBG #161] synchronous cost of Svelte mount() (SVAR's eager init). If
      // this is small but the UI still freezes, the cost is SVAR's deferred
      // (rAF/effect) layout over the instance set, not our mount path.
      dlog(`[OGDBG] mount() returned in ${Math.round(performance.now() - tMountStart)}ms`);

      // Controller snapshot changes (TaskNotes events, source re-selection on a
      // data update / capability flip) refresh the store in place — no remount,
      // so the SVAR view state (zoom, scroll, selection) is preserved.
      controller.onChange(() => {
        if (token === this.mountToken) {
          void this.refreshData();
        }
      });

      // Post-mount readiness re-check (#161 §11). The initial build above already
      // ran once, so readinessStatus() now reflects it: if companion mode is active
      // but the relationship index hasn't resolved matched-set edges yet (the
      // post-#166 lag state), drive a bounded-backoff re-fetch until it warms. Each
      // re-check flows through the controller's onChange listener above, so the
      // healed Show-all rows reach the view via the normal refresh path. Standalone
      // / already-warm mounts allocate no scheduler. Cancelled on unload/remount.
      this.readinessOrchestrator = createReadinessOrchestrator({
        controller,
        createWindow: () => createReadinessWindow(DEFAULT_READINESS_WINDOW_CONFIG),
        // Re-checked at fire time: a stale attempt landing during teardown must not
        // re-fetch against a disposed controller (R6) — mirrors the coalescer's
        // isConnected + mountToken guards.
        isAlive: () => !!this.containerEl?.isConnected && token === this.mountToken,
      });
      this.readinessOrchestrator.maybeStart();
    } catch (error) {
      console.error('[Gantt] Failed to mount GanttContainer:', error);
      if (token === this.mountToken) {
        this.containerEl.empty();
        this.containerEl.createDiv({
          cls: 'og-bases-gantt-error',
          text: 'Gantt (OG): Failed to render chart. See console for details.',
        });
      }
    }
  }

  /** Compute the current dynamic render data from the controller + view config. */
  private async buildGanttData(controller: GanttController): Promise<GanttData> {
    const arrowMode = this.getArrowMode();
    const [instances, links, statusColors, priorityColors] = await Promise.all([
      controller.getInstances(),
      controller.getLinks(arrowMode),
      controller.getStatusColors(),
      controller.getPriorityColors(),
    ]);
    // Resolve the visible property columns once; share between the per-task
    // value map (U1) and the column descriptors (U2).
    const visiblePropIds = this.getVisiblePropertyIds();
    const propertyValues = buildEntryProperties(
      this.data?.data ?? [],
      visiblePropIds,
      this.gridAdapter,
    );
    // Show-all *context* rows (companion-fetched subtasks) are NOT in the Bases
    // result, so the matched-only map above leaves their grid cells blank. Fill
    // their note.*/file.* columns from the metadata cache (formula columns fall
    // back to empty — R5). Matched rows already in the map are never overwritten.
    if (visiblePropIds.length > 0) {
      const seen = new Set(propertyValues.keys());
      const fetchedMetas: FetchedFileMeta[] = [];
      for (const inst of instances) {
        if (seen.has(inst.sourcePath)) continue;
        seen.add(inst.sourcePath);
        const file = this.app.vault.getAbstractFileByPath(inst.sourcePath);
        if (!(file instanceof TFile)) continue;
        fetchedMetas.push({
          path: inst.sourcePath,
          basename: file.basename,
          extension: file.extension,
          frontmatter: this.app.metadataCache.getFileCache(file)?.frontmatter ?? null,
        });
      }
      for (const [path, record] of buildFetchedEntryProperties(
        fetchedMetas,
        visiblePropIds,
        this.gridAdapter,
      )) {
        propertyValues.set(path, record);
      }
    }
    const gridColumns = buildGridColumns(
      visiblePropIds,
      (id) => this.getDisplayName(asPropertyId(id)),
      this.getColumnSize(),
      // The task-name property: the configured textProperty, else file.name.
      (this.config.get('tngantt_textProperty') as string) || 'file.name',
    );
    return {
      instances,
      links,
      capabilities: controller.capabilities,
      arrowMode,
      showDateIndicators: this.getShowDateIndicators(),
      showToolbar: this.getShowToolbar(),
      // #161: read the SAME config key as before (UI + .base syntax unchanged), but
      // it now drives a view-level filter-tasks display filter, not the instance set.
      hideTopLevelSubtasks: this.getHideTopLevelSubtasks(),
      // #161: the show-undated/show-partial toggles flow through the store like
      // hide-top — a presentation filter over the stable instance set, never a
      // re-derivation — so a Bases config oscillation can't churn the chart.
      ...readRowVisibilityOptions((key) => this.config.get(key)),
      maxHeight: this.getMaxHeight(),
      minHeight: this.getMinHeight(),
      contextOpacity: this.getContextOpacity(),
      statusColors,
      priorityColors,
      barColorMode: this.getBarColorMode(),
      barColorSource: this.getBarColorSource(),
      barIcon: this.getBarIcon(),
      dateMappingNotice: buildDateMappingNotice(controller.getDateMappingInfo()),
      cascadeMode: this.getCascadeMode(),
      defaultScale: normalizeDefaultScale(this.config.get('tngantt_defaultScale')),
      propertyValues,
      gridColumns,
      gridColumnsKey: gridColumnsKey(gridColumns),
      gridWidth: this.getTableWidth(),
    };
  }

  /**
   * Recompute the render data and push it into the store (refresh in place).
   * No-op when the view isn't mounted. Errors are swallowed so a transient
   * refresh failure doesn't tear down the live chart.
   */
  private async refreshData(): Promise<void> {
    const controller = this.ganttController;
    const store = this.dataStore;
    if (!controller || !store) {
      return;
    }
    try {
      store.set(await this.buildGanttData(controller));
    } catch (error) {
      console.error('[Gantt] Failed to refresh data:', error);
    }
  }

  private unmountGantt(): void {
    // Invalidate any in-flight async mount so it does not resurrect the view.
    this.mountToken++;

    // Cancel the readiness window so a pending re-check can't fire against the
    // controller we're about to dispose (R6).
    this.readinessOrchestrator?.cancel();
    this.readinessOrchestrator = null;

    if (this.svelteComponent) {
      try {
        unmount(this.svelteComponent);
      } catch (error) {
        console.warn('[Gantt] Error unmounting Svelte component:', error);
      }
      this.svelteComponent = null;
    }

    if (this.ganttController) {
      try {
        this.ganttController.dispose();
      } catch (error) {
        console.warn('[Gantt] Error disposing controller:', error);
      }
      this.ganttController = null;
    }

    this.dataStore = null;
    this.containerEl.empty();
  }
}

/**
 * Whether the TaskNotes plugin is present with an exposed API. Sync (used at
 * options-panel build time) — mirrors the `app.plugins.getPlugin('tasknotes')`
 * resolution in {@link TaskNotesSource}. Companion-only relationship controls
 * are shown only when this is true.
 */
function isTaskNotesPresent(app: Plugin['app']): boolean {
  try {
    const plugins = (app as unknown as {
      plugins?: { getPlugin(id: string): { api?: unknown } | null | undefined };
    }).plugins;
    return Boolean(plugins?.getPlugin('tasknotes')?.api);
  } catch {
    return false;
  }
}

/**
 * Register the Gantt view with Obsidian's Bases API
 *
 * @param plugin - The Obsidian plugin instance
 * @returns Cleanup function (no-op since Obsidian handles unregistration)
 */
export function registerBasesGantt(plugin: Plugin): () => void {
  // Check API version - Bases API requires 1.10.0+
  try {
    const requireApiVersion = (window as { requireApiVersion?: (v: string) => boolean }).requireApiVersion;
    if (typeof requireApiVersion === 'function' && !requireApiVersion('1.10.0')) {
      console.warn('[Gantt] Skipping Bases registration: Obsidian API < 1.10.0');
      return () => {};
    }
  } catch {
    // If version check unavailable, continue optimistically
  }

  // Check if registerBasesView is available
  if (typeof plugin.registerBasesView !== 'function') {
    console.warn('[Gantt] plugin.registerBasesView not available - Bases API not supported');
    return () => {};
  }

  // Register the Gantt chart view type
  const registeredGantt = plugin.registerBasesView(VIEW_TYPE_ID, {
    name: VIEW_NAME,
    icon: VIEW_ICON,
    factory: (controller: QueryController, containerEl: HTMLElement) => {
      return new ObsidianGanttBasesView(controller, containerEl);
    },
    // Companion-only relationship controls render only when TaskNotes is
    // present (expansion is companion-only — see plan U1/R6). Presence is
    // re-checked each time the options panel builds; cheap.
    options: (_config: BasesViewConfig): BasesAllOptions[] =>
      ganttViewOptions(isTaskNotesPresent(plugin.app)),
  });

  if (registeredGantt) {
    console.info(`[Gantt] Registered Bases view: ${VIEW_NAME}`);
  } else {
    console.warn('[Gantt] Failed to register Bases view - Bases plugin may not be enabled');
  }

  // Register the TaskList view (text-based hierarchy view for testing)
  const registeredTaskList = plugin.registerBasesView('obsidianGanttTaskList', {
    name: 'Gantt TaskList (OG)',
    icon: 'list-tree',
    factory: (controller: QueryController, containerEl: HTMLElement) => {
      return new GanttTaskListView(controller, containerEl);
    },
    options: (_config: BasesViewConfig): BasesAllOptions[] => taskListViewOptions(),
  });

  if (registeredTaskList) {
    console.info('[Gantt] Registered Bases view: Gantt TaskList (OG)');
  } else {
    console.warn('[Gantt] Failed to register TaskList view - Bases plugin may not be enabled');
  }

  // Obsidian handles cleanup automatically via plugin lifecycle
  return () => {
    // No manual cleanup needed - Obsidian manages registered views
  };
}
