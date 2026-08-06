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
import { get, writable, type Writable } from 'svelte/store';
import GanttContainer from './GanttContainer.svelte';
import { pickActiveFocusEntry } from './focusController';
import type { GanttData } from './types/gantt-view-data';
import { hasRecordedRecurringOccurrences } from './legendCatalog';
import type { FieldMappings } from './types/field-mapping';
import { readFieldMappings } from './fieldMappingConfig';
import {
  calendarItemOptionsGroup,
  calendarItemTogglesSignatureTag,
  calendarItemWatchedProperties,
  externalCalendarDegradedEntry,
  externalCalendarOptionEntries,
  readCalendarItemToggles,
  readVisibleExternalCalendarFeeds,
  type CalendarItemToggles,
} from './calendarItemOptions';
import {
  createCalendarItemSourcesProvider,
  createTaskNotesCalendarBinding,
  type CalendarItemSourcesProvider,
  type ExternalBatchFlags,
} from './calendarItemSources';
import {
  readExternalCalendarDiscovery,
  readExternalIcsSubscriptions,
  readExternalProviderCalendars,
  externalCalendarFeedKey,
  type TimeblockWatch,
} from '../datasource/calendarItems';
import { isSafeColor } from './barTreatment';
import { createDailyNoteAccess } from './dailyNoteAccess';
import { sessionExternalCalendarDegradeSignal } from './externalCalendarDegradeNotice';
import { createTimeblockLiveness } from './timeblockLiveness';
import { defaultScheduler } from './scheduler';
import { SourceSwitcherModal } from './SourceSwitcherModal';
import {
  activeSwitcherSources,
  createSourceSwitcherState,
  registerSourceSwitcherEntry,
  switcherCountsFromInstances,
  switcherSourceCensus,
  type ActiveSwitcherSource,
  type SourceSwitcherState,
} from './sourceSwitcher';
import {
  GanttController,
  type DatePolicyConfig,
  type DateMappingInfo,
} from '../controller/GanttController';
import type { LinkRewriteMode } from '../controller/InstanceExpansion';
import { TaskNotesInteractions } from './taskNotesInteractions';
import { normalizeCascadeMode } from './cascadeGate';
import {
  normalizeInferredDragMode,
  persistInferredDragMode,
  type InferredDragAction,
} from './inferredDragGate';
import { collectFetchedFileMetas } from './propertyValues';
import { buildCellData, buildFetchedCellData, type ResolveRenderType } from './cellRender';
import { resolveDateLocale } from './dateLocale';
import { resolveCellRenderType } from './cellRenderType';
import { getObsidianPropertyWidget } from './obsidianPropertyType';
import { resolveUserFieldTypes } from './taskNotesFieldTypes';
import { resolveGridCellEditors } from './cellEditability';
import { buildGridColumns, gridColumnsKey, mergeColumnSize, firstColumnWidth, DEFAULT_NAME_WIDTH } from './gridColumns';
import { persistGridWidth, resolveInitialGridWidth } from './gridWidthPersist';
import { TaskNotesSource, type TaskPatch } from '../datasource';
import { createCoalescer, type Coalescer } from './coalesce';
import { createMountCalendarWatch, wireCalendarWatch, type CalendarWatch } from './calendarWatch';
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
  readDefaultLegendPosition,
  readHighlightWeekends,
  readEstimateMeaning,
  readNonWorkingRendering,
  type EstimateMeaning,
  readDisplayCalendars,
  readBarFillSource,
  readBarStripSource,
  readBarIcon,
  readProgressMode,
  readTimeEstimateMode,
  isProgressReadonly,
  isTimeEstimateWriteEnabled,
} from './viewOptions';
import { persistThemeMode, readThemeMode, type ThemeMode } from './themeResolver';
import { needsCalendarSeam, estimateMeaningForTask } from '../controller/calendar/estimateMeaning';

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
import { composeEntrySignature, frontmatterSignatureKeys, type SignatureEntry } from './entrySignature';
import {
  computeCalendarShadingCss,
  associationTaskPaths,
  calendarAssociationsFrom,
  createShadingCssCache,
  shadingWindow,
} from './calendarShading';
import { shadingCacheKey } from '../controller/calendar/derivation';
import { nextInstanceScopeClass } from './instanceScope';
import {
  readDisplaySelection,
  reconcileLegacyFlip,
  serializeSelection,
} from './calendarSelection';
import { buildCalendarNotice } from './calendarConflicts';
import type { MarkerInput } from './markerOverlay';
import { buildCalendarRegistry, stripSubpath } from '../controller/calendar/resolveCalendars';
import { CalendarPickerModal } from './CalendarPickerModal';
import { autoDisplayedPathsFrom, calendarLinkFor, type PickerContext } from './calendarPickerModel';
import {
  createAndOpenCalendarNote,
  type PluginLifetime,
} from './createCalendarNote';
import { matchesCalendarMarker } from '../controller/calendar/schema';
import { resolveParentLink } from '../datasource/parentLink';
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
const VIEW_NAME = 'TaskNotes Gantt';
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

/**
 * Live calendar-picker openers, one per mounted Gantt view — same registry
 * shape and active-leaf resolution as the focus entries above.
 */
const livePickerEntries = new Map<HTMLElement, () => void>();

/** The calendar-picker opener for the active Gantt leaf, or null when none. */
export function getActiveGanttCalendarPickerEntry(
  activeContainer?: HTMLElement | null,
): (() => void) | null {
  return pickActiveFocusEntry(livePickerEntries, activeContainer);
}

/**
 * The raw TaskNotes plugin handle (NOT its api) for the external-calendar
 * family's structurally-guarded service reads; `null` when absent.
 * {@link isTaskNotesPresent} derives its presence check from this lookup.
 */
function getTaskNotesPluginHandle(app: Plugin['app']): unknown {
  try {
    const plugins = (app as unknown as {
      plugins?: { getPlugin(id: string): unknown };
    }).plugins;
    return plugins?.getPlugin('tasknotes') ?? null;
  } catch {
    return null;
  }
}

/**
 * The external batch-flags observer exactly as the mount wires it: the loading
 * flag feeds the view's indicator state, and every collect's degrade flag
 * feeds the session-wide Notice/options-panel signal. Exported so tests can
 * drive the production collect→signal path through the same composition.
 */
export function wireExternalBatchFlags(
  setExternalEventsLoading: (loading: boolean) => void,
): (flags: ExternalBatchFlags) => void {
  return (flags) => {
    setExternalEventsLoading(flags.loading);
    sessionExternalCalendarDegradeSignal.observeCollect(flags);
  };
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
   * Per-mount provider of the calendar-item family sources (recurring
   * instances, time entries), handed to the controller as its
   * `createCalendarItemSources` dep. Recreated per mount; disposed on
   * unload/remount so the sources' TaskNotes subscriptions never outlive it.
   */
  private calendarItemSourcesProvider: CalendarItemSourcesProvider | null = null;

  /**
   * Calendar-note liveness (edits/renames/deletions of marked notes refresh the
   * chart without a Bases notify). Created per mount; unwired on unload/remount.
   */
  private calendarWatch: CalendarWatch | null = null;
  private unwireCalendarWatch: (() => void) | null = null;

  /**
   * Daily-note liveness for the timeblock family — the calendar-watch
   * mechanism reused with a daily-note relevance probe. Its epoch drives the
   * timeblock source's staleness signal and folds into the entry signature.
   * Created per mount; unwired on unload/remount.
   */
  private timeblockWatch: TimeblockWatch | null = null;
  private unwireTimeblockWatch: (() => void) | null = null;

  /**
   * Handlers the property-event source subscribed through the provider's
   * Bases-data seam. Fired by the refresh coalescer when the entry signature
   * changes (a genuine data/property change), bumping the family's epoch so
   * its cached batch re-derives from the current entries.
   */
  private readonly basesDataHandlers = new Set<() => void>();

  /**
   * The external-calendar source's last observed loading flag (visible feeds
   * awaiting their first completion signal). Rides the reactive data path into
   * the toolbar's transient fetching indicator; cleared by the refresh the
   * first completion signal triggers, even when zero events came back.
   */
  private externalEventsLoading = false;

  /**
   * Per-view-instance session state of the quick source switcher (hidden
   * sources). Created lazily on the first mount and retained across remounts
   * of this view instance — it survives refreshes and dies with the view.
   */
  private sourceSwitcherState: SourceSwitcherState | null = null;
  /** Retracts this view's switcher opener from the command registry. */
  private unregisterSwitcherEntry: (() => void) | null = null;

  /**
   * Reactive store of the dynamic render data. Mounted once into the view; each
   * controller change re-`set`s it, so the SVAR instance persists and keeps its
   * view state (zoom, scroll, selection) across data changes instead of being
   * destroyed by a remount. `null` until the first mount.
   */
  private dataStore: Writable<GanttData> | null = null;

  /**
   * Unique per-view scope class shared by BOTH injected stylesheets — the bar
   * treatment (built in the component) and the calendar shading (built here).
   * Every generated rule anchors under `.<treatmentScopeClass>`, so one view's
   * sheet can never restyle another view's bars/cells that share
   * `.og-bases-gantt`. Stable for the view's lifetime.
   */
  private readonly treatmentScopeClass = nextInstanceScopeClass();

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

  constructor(
    controller: QueryController,
    parentEl: HTMLElement,
    /**
     * Scopes the picker's create-calendar flow to the plugin load, so its metadata
     * watches and continuations cannot outlive it. Supplied by the view factory,
     * which is where a plugin handle exists.
     */
    private readonly calendarLifetime: PluginLifetime,
  ) {
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
    this.unwireCalendarWatch?.();
    this.unwireCalendarWatch = null;
    this.calendarWatch = null;
    this.unwireTimeblockWatch?.();
    this.unwireTimeblockWatch = null;
    this.timeblockWatch = null;
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
    // Re-assert the persisted divider width on reveal/reattach (Bug B): SVAR can
    // reset the grid to column-sum on reattach without a column change. No-op
    // until the component registers; idempotent (see the divider-width plan).
    this.reassertGridWidth?.();
  }

  /**
   * Signature of the current Bases entries — count + each entry's file path, plus
   * the values of the instance-driving `note.*` fields (dates/progress/status/
   * priority/parent) read from Obsidian's metadata cache. `reuseTasks` reuses the
   * controller's cached tasks when this is unchanged, so:
   *  - a config-only / echo notify (same files, same values) reuses → no #161 storm;
   *  - a genuine field edit (e.g. status/priority via the context menu) flips the
   *    signature → the source re-reads → the bars' color/icon refresh in place.
   *
   * The value read is cache-safe: it uses `metadataCache` frontmatter directly and
   * NEVER `entry.getValue` (the extraction that re-pokes the #161 storm). `file.*`
   * fields need no value read — a rename changes the path, already in the signature.
   */
  /**
   * The calendar-item family toggles, read fresh from the live view config on
   * every call — a provider-closure-style read, so a toggle change is seen by
   * the very next recompute with no remount.
   */
  private getCalendarItemToggles(): CalendarItemToggles {
    return readCalendarItemToggles((key) => this.config.get(key));
  }

  /**
   * The visible external feed keys for the CURRENT TaskNotes subscription and
   * provider-calendar lists — a provider-closure read like the toggles, so a
   * per-feed flip applies on the very next provide/collect.
   */
  private readVisibleExternalFeeds(): ReadonlySet<string> {
    const handle = getTaskNotesPluginHandle(this.app);
    if (handle === null) return new Set();
    return readVisibleExternalCalendarFeeds(
      (key) => this.config.get(key),
      readExternalIcsSubscriptions(handle),
      readExternalProviderCalendars(handle),
    );
  }

  private readExternalCalendarLegendFacts(): {
    enabled: boolean;
    representativeColor: string | null;
  } {
    const handle = getTaskNotesPluginHandle(this.app);
    if (handle === null) return { enabled: false, representativeColor: null };
    const subscriptions = readExternalIcsSubscriptions(handle);
    const providerCalendars = readExternalProviderCalendars(handle);
    const visibleFeeds = readVisibleExternalCalendarFeeds(
      (key) => this.config.get(key),
      subscriptions,
      providerCalendars,
    );
    const representativeColor = subscriptions.find(
      ({ id, color }) =>
        visibleFeeds.has(externalCalendarFeedKey('ics', id)) && isSafeColor(color),
    )?.color;
    return {
      enabled: visibleFeeds.size > 0,
      representativeColor: representativeColor ?? null,
    };
  }

  private computeEntrySignature(): string {
    const app = this.app;
    const calendarItemToggles = this.getCalendarItemToggles();
    return composeEntrySignature({
      entries: (this.data?.data ?? []) as ReadonlyArray<SignatureEntry>,
      // The LIVE view config: this runs BEFORE the refresh re-selects the source, so
      // the controller's resolved mappings still describe the previous config.
      viewMappings: this.buildFieldMappings(),
      resolvedMappings: this.getEffectiveMappings(),
      estimateReadKey: this.ganttController?.getEstimateReadKey() ?? null,
      noteCacheOf: (entry) => {
        const path = entry.file?.path;
        if (!path) return null;
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return null;
        const cache = app.metadataCache.getFileCache(file);
        return { frontmatter: cache?.frontmatter ?? null, listItems: cache?.listItems };
      },
      // Calendar-note edits change no task entry; the watch epochs flip the
      // signature so the refresh re-reads instead of reusing stale calendar
      // state. The timeblock watch and the external-calendar source fold in
      // the same way: their facts live outside the Bases entries entirely.
      calendarStateTag:
        `cal:${this.calendarWatch?.epoch() ?? 0}|` +
        `tb:${this.timeblockWatch?.epoch() ?? 0}|` +
        `ext:${this.calendarItemSourcesProvider?.externalEpoch() ?? 0}|`,
      // Calendar-item family toggles: flipping one repaints (tag change); a
      // family switched on adds its consumed properties to the watched set,
      // switched off removes them.
      calendarItemsTag: calendarItemTogglesSignatureTag(calendarItemToggles),
      calendarItemProperties: calendarItemWatchedProperties(calendarItemToggles),
    });
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

  /** Name-column width from the last build; the divider-width fallback when unset (R4). */
  private lastFirstColumnWidth = DEFAULT_NAME_WIDTH;

  /** Component-registered re-assert of the persisted width (Bug B); null while unmounted. */
  private reassertGridWidth: (() => void) | null = null;

  /**
   * The effective divider width to seed (px): the persisted `tngantt_tableWidth`
   * coerced+clamped, else the first-column fallback (R3/R4). Backs both the mount
   * seed and the persist loop-guard's `currentPersisted` — same value in both so
   * a re-asserted fallback is a no-op write, not a spurious pin (see the plan's KTD2).
   */
  private getTableWidth(): number {
    return resolveInitialGridWidth(this.config.get('tngantt_tableWidth'), this.lastFirstColumnWidth);
  }

  /**
   * Build the RAW FieldMappings from the current view config — every unmapped field
   * stays "unset" (empty).
   *
   * This is the controller's input, not the resolved answer: the controller fills an
   * unset field in from TaskNotes' configured property. Surfaces that must treat an
   * unset field as the property it resolves to (cell editors, refresh signatures)
   * read {@link getEffectiveMappings} instead. Read this one where the user's own
   * choice is what matters — the progress/estimate write gates, which must not open
   * an editor on a property the write path has no target for.
   */
  private buildFieldMappings(): FieldMappings {
    const get = (key: string) => this.config.get(key);
    const base = readFieldMappings(get);
    // Resolve the Progress mode (R1–R3) and thread it onto the mappings so
    // BasesSource reads the right source (U3) and computeEntrySignature folds in
    // the right change-detection state (U4). An unset mode preserves an existing
    // view: a configured Progress Property defaults to `property` (not silently
    // switched to computed); a fresh companion view defaults to `tasknotes`. The
    // dropdown's shown default is aligned to this (see the options callback).
    const companionAvailable = isTaskNotesPresent(this.app);
    const progressMode = readProgressMode(get, {
      companionAvailable,
      hasProgressProperty: (base.progressProperty ?? '').trim() !== '',
    });
    // Resolve the Time Estimate write mode (R1–R3), companion-gated. The estimate
    // is always READ for inference regardless of mode (R5/R6); the mode only gates
    // whether a resize writes it back. Default `dont-update`.
    const timeEstimateMode = readTimeEstimateMode(get, { companionAvailable });
    return { ...base, progressMode, timeEstimateMode };
  }

  /**
   * The field mappings as resolved by the active controller: the view config with
   * every unset field filled in from TaskNotes' configured property. Read this
   * wherever an unset field must behave as the property it resolves to (which editor
   * a cell offers, which frontmatter keys a refresh watches) rather than as "no
   * property at all".
   *
   * The controller only publishes these once source selection has run, so with no
   * controller yet they degrade to the raw view config — every field then reads as
   * the user left it, which is the same answer for a view that maps everything.
   */
  private getEffectiveMappings(): FieldMappings {
    return this.ganttController?.getEffectiveMappings() ?? this.buildFieldMappings();
  }

  /**
   * Whether the bar's progress handle is read-only/hidden (U5/R7). The handle is
   * editable ONLY in Property mode with a mapped Progress Property — the sole
   * configuration where a drag has a resolved write target. Hiding it in
   * TaskNotes mode (computed) AND in Property mode with no mapped property means
   * a drag can never silently no-op (the controller would drop a write with no
   * target and the persist would resolve as if saved). Goes through a dedicated
   * accessor like the sibling flags (getBarFillSource, etc.).
   */
  private getProgressReadonly(): boolean {
    return isProgressReadonly(this.buildFieldMappings());
  }

  /** Read the per-view dependency-arrow mode (R27), defaulting to `primary`. */
  private getArrowMode(): LinkRewriteMode {
    return this.config.get('tngantt_dependencyArrowMode') === 'all' ? 'all' : 'primary';
  }

  /** Build the date-policy + visibility config from the per-view options (U3). */
  private buildDatePolicyConfig(): DatePolicyConfig {
    const base = readDatePolicyConfig((key) => this.config.get(key));
    const get = (key: string): unknown => this.config.get(key);
    const meaning = readEstimateMeaning(get);
    const rendering = readNonWorkingRendering(get);
    const overrideMapped = (this.getEffectiveMappings().estimateMeaningProperty ?? '') !== '';
    if (!needsCalendarSeam(rendering, meaning, overrideMapped)) return base;
    return {
      ...base,
      nonWorkingRendering: rendering,
      estimateMeaningForTask: this.buildEstimateMeaningForTask(meaning),
      viewEstimateMeaning: meaning,
      // Engages the stretch axis; the controller's own derivation authority
      // assembles the blocking facts (the closure inside is a test seam only).
      workingTimeStretch: {},
    };
  }

  /**
   * The register-side wiring for {@link estimateMeaningForTask}: resolves the
   * mapped override property to a frontmatter key and supplies the per-task value
   * read, threaded through the date-policy config.
   */
  private buildEstimateMeaningForTask(
    viewDefault: EstimateMeaning,
  ): (taskPath: string) => EstimateMeaning {
    const property = this.getEffectiveMappings().estimateMeaningProperty ?? '';
    const frontmatterKey = frontmatterSignatureKeys([property])[0];
    if (!frontmatterKey) return estimateMeaningForTask(viewDefault, null, () => undefined);
    const app = this.app;
    return estimateMeaningForTask(viewDefault, frontmatterKey, (taskPath) => {
      const file = app.vault.getAbstractFileByPath(taskPath);
      if (!(file instanceof TFile)) return undefined;
      return app.metadataCache.getFileCache(file)?.frontmatter?.[frontmatterKey];
    });
  }

  /** The association task paths of the last shading build (entries + instances). */
  private lastAssociationTaskPaths: string[] | null = null;

  /** Every vault note bearing the calendar/calendar-set marker, cache-safely. */
  private collectMarkedCalendarNotes(): { path: string; basename: string; frontmatter: unknown }[] {
    const app = this.app;
    return app.vault.getMarkdownFiles().flatMap((file) => {
      const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
      return matchesCalendarMarker(frontmatter) !== null
        ? [{ path: file.path, basename: file.basename, frontmatter }]
        : [];
    });
  }

  /**
   * The picker's resolution snapshot, rebuilt fresh on every render so rows
   * always reflect the vault's present (live re-resolution).
   */
  private buildPickerContext(): PickerContext {
    const app = this.app;
    const resolve = (linkText: string, fromPath: string) => resolveParentLink(app, linkText, fromPath);
    const registry = buildCalendarRegistry(this.collectMarkedCalendarNotes(), resolve);
    const calendarProperty = this.getEffectiveMappings().calendarProperty ?? '';
    const frontmatterKey = frontmatterSignatureKeys([calendarProperty])[0];
    // The SAME association population the shading resolves from: Bases entries
    // plus rendered (Show-all fetched) instances, stashed by the last shading
    // build. Deriving the picker from entries alone showed a fetched row's
    // calendar shading the chart while unchecked here — and a toggle then
    // materialised an explicit selection that silently omitted it.
    const entryPaths = (this.data?.data ?? []).flatMap((entry) => {
      const path = (entry as SignatureEntry).file?.path;
      return path ? [path] : [];
    });
    const taskPaths = this.lastAssociationTaskPaths ?? entryPaths;
    const associations = frontmatterKey
      ? calendarAssociationsFrom(taskPaths, (path) => {
          const file = app.vault.getAbstractFileByPath(path);
          if (!(file instanceof TFile)) return undefined;
          return app.metadataCache.getFileCache(file)?.frontmatter?.[frontmatterKey];
        })
      : [];
    return {
      registry,
      selection: readDisplaySelection(
        readDisplayCalendars((key) => this.config.get(key)),
        this.config.get('tngantt_highlightWeekends'),
      ),
      resolveLink: (link) => resolve(stripSubpath(link), ''),
      linkFor: calendarLinkFor,
      autoDisplayedPaths: autoDisplayedPathsFrom(registry, associations, resolve),
    };
  }

  /**
   * The note's calendar-association value under the CURRENT mapping, serialized
   * for the watch's one-string-compare relevance probe. Mapping-aware at event
   * time, so a Field Mapping change never compares against a stale key.
   */
  private readAssociationValue(path: string): string {
    const calendarProperty = this.getEffectiveMappings().calendarProperty ?? '';
    const frontmatterKey = frontmatterSignatureKeys([calendarProperty])[0];
    if (!frontmatterKey) return '';
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return '';
    const value = this.app.metadataCache.getFileCache(file)?.frontmatter?.[frontmatterKey];
    return value === undefined ? '' : JSON.stringify(value) ?? '';
  }

  private openCalendarPicker(): void {
    new CalendarPickerModal(this.app, {
      getContext: () => this.buildPickerContext(),
      persist: (writes) => {
        this.config.set('tngantt_displayCalendars', writes.displayCalendars);
        if (writes.highlightWeekends !== undefined) {
          this.config.set('tngantt_highlightWeekends', writes.highlightWeekends);
        }
      },
      createCalendar: () => createAndOpenCalendarNote(this.app, 'calendar', this.calendarLifetime),
    }).open();
  }

  /**
   * The switchable sources right now: enabled AND non-empty families, counted
   * from the last rendered instance set (event rows by family; recurring by
   * occupancy). External enablement is its live per-feed visibility (at least
   * one visible feed). Re-derived on every modal render so the list tracks
   * the view.
   */
  private buildActiveSwitcherSources(): ActiveSwitcherSource[] {
    const data = this.dataStore ? get(this.dataStore) : null;
    return activeSwitcherSources(
      switcherSourceCensus(
        this.getCalendarItemToggles(),
        switcherCountsFromInstances(data?.instances ?? []),
        this.readVisibleExternalFeeds().size > 0,
      ),
    );
  }

  private openSourceSwitcher(): void {
    const state = this.sourceSwitcherState;
    if (!state) return;
    new SourceSwitcherModal(this.app, {
      getActiveSources: () => this.buildActiveSwitcherSources(),
      state,
    }).open();
  }

  /** Read the per-view "show date-status indicators" toggle (R11); default on. */
  private getShowDateIndicators(): boolean {
    return this.config.get('tngantt_showDateIndicators') !== false;
  }

  /** Read the per-view "show toolbar" toggle (plan 002 R2); default off. */
  private getShowToolbar(): boolean {
    return readShowToolbar((key) => this.config.get(key));
  }

  private getDefaultLegendPosition() {
    return readDefaultLegendPosition((key) => this.config.get(key));
  }

  /** Read the per-view "Highlight weekends" toggle; default on. */
  private getHighlightWeekends(): boolean {
    return readHighlightWeekends((key) => this.config.get(key));
  }

  /**
   * Two-way weekend alias: the legacy toggle and the stored selection's
   * default row are one state with two keys. A legacy flip observed here is
   * written back to the selection key; guarded, so agreement never writes and
   * the refresh a write triggers converges on the next pass.
   */
  private reconcileCalendarSelectionAlias(): void {
    const legacy = this.config.get('tngantt_highlightWeekends');
    const stored = readDisplaySelection(readDisplayCalendars((key) => this.config.get(key)), legacy);
    const { write } = reconcileLegacyFlip(stored, legacy);
    if (write !== null) this.config.set('tngantt_displayCalendars', write);
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

  /** Read the per-view Bar fill channel source; default `default`. */
  private getBarFillSource() {
    return readBarFillSource((key) => this.config.get(key));
  }

  /** Read the per-view Bar strip channel source; default `none`. */
  private getBarStripSource() {
    return readBarStripSource((key) => this.config.get(key));
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
   * Read the per-view inferred-edge drag mode; defaults to `ask`. Governs whether
   * a resize of an estimate-inferred bar edge prompts, grows the estimate only, or
   * grows the estimate and writes dates (see inferredDragGate / GanttContainer).
   */
  private getInferredDragMode(): import('./inferredDragGate').InferredDragMode {
    return normalizeInferredDragMode(this.config.get('tngantt_inferredDrag'));
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
      // Calendar-item families read the RAW TaskNotes task list (recurrence
      // state, time entries) — richer than the SourceTask projection — so they
      // get their own TaskNotesSource seam here (the controller's memoized
      // enrichment source is internal to it). Null when TaskNotes is absent:
      // the families then derive nothing, which is their standalone behavior.
      const calendarItemTaskNotes = createTaskNotesCalendarBinding({
        identity: () => TaskNotesSource.apiIdentity(this.app),
        createSource: () => TaskNotesSource.create(this.app),
      });
      const dailyNoteAccess = createDailyNoteAccess(this.app);
      // Daily-note liveness for timeblocks: the same event wiring as the
      // calendar watch (metadata `changed` + vault `rename`/`delete`), with a
      // daily-note relevance probe. Each settled burst bumps the epoch (the
      // timeblock source's staleness signal, folded into the entry signature)
      // and schedules the same coalesced refresh. Created BEFORE the
      // controller below so the init-time collect's daily-note listing seeds
      // the LIVE watch — a deleted note is only recognised via seeded paths.
      this.unwireTimeblockWatch?.();
      const timeblockLiveness = createTimeblockLiveness({
        dailyNotes: dailyNoteAccess,
        onEpochBump: () => {
          if (this.containerEl?.isConnected) this.refreshCoalescer?.schedule();
        },
      });
      // Register the disposer BEFORE wiring events (created-then-throw
      // window): if the wiring throws, the watch still dies with the view.
      this.timeblockWatch = timeblockLiveness.watch;
      this.unwireTimeblockWatch = () => timeblockLiveness.watch.dispose();
      const unwireTimeblockEvents = wireCalendarWatch(
        { metadataCache: this.app.metadataCache, vault: this.app.vault },
        timeblockLiveness.watch,
      );
      const unwireTimeblockThisMount = (): void => {
        unwireTimeblockEvents();
        timeblockLiveness.watch.dispose();
      };
      this.unwireTimeblockWatch = unwireTimeblockThisMount;
      const calendarItemSources = createCalendarItemSourcesProvider({
        toggles: () => this.getCalendarItemToggles(),
        listTasks: calendarItemTaskNotes.listTasks,
        subscribe: calendarItemTaskNotes.subscribe,
        taskNotesIdentity: calendarItemTaskNotes.identity,
        resolveTaskReference: (linkPath, fromPath) =>
          resolveParentLink(this.app, linkPath, fromPath),
        // Property events derive from the view's Bases entries; the coalescer
        // fires these handlers on a changed entry signature so the family's
        // cached batch re-derives exactly when the data (or a watched event
        // property) actually changed.
        subscribeBasesData: (handler: () => void) => {
          this.basesDataHandlers.add(handler);
          return () => {
            this.basesDataHandlers.delete(handler);
          };
        },
        // Timeblocks: the daily-note walk, seeded into THIS mount's live
        // watch by the liveness assembly so a later deletion of a rendered
        // daily note is recognised (a deletion cannot probe the gone file).
        listDailyNotes: (window) => timeblockLiveness.listDailyNotes(window),
        earliestDailyNoteDay: dailyNoteAccess.earliestDailyNoteDay,
        timeblockEpoch: () => timeblockLiveness.watch.epoch(),
        dailyNotesConfigTag: dailyNoteAccess.configTag,
        // External calendars: guarded reads off the raw TaskNotes plugin
        // handle, per-feed visibility from the live view config, and a bump
        // hook so a service's data-changed emitter schedules a refresh.
        getTaskNotesPlugin: () => getTaskNotesPluginHandle(this.app),
        visibleExternalFeeds: () => this.readVisibleExternalFeeds(),
        scheduler: defaultScheduler,
        onExternalEpochBump: () => {
          if (this.containerEl?.isConnected) this.refreshCoalescer?.schedule();
        },
        onExternalBatchFlags: wireExternalBatchFlags((loading) => {
          this.externalEventsLoading = loading;
        }),
      });
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
        // View-owned inputs for the derivation authority's blocking facts —
        // provider closures like everything above, read fresh per pass.
        derivationInputs: {
          effectiveMappings: () => this.getEffectiveMappings(),
          calendarEpoch: () => this.calendarWatch?.epoch() ?? 0,
          markedCalendarNotes: () => this.collectMarkedCalendarNotes(),
        },
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
        // Calendar-item family sources (recurring instances, time entries):
        // the provider re-reads the family toggles on every provide, so an
        // opted-in family joins the very next recompute without a remount.
        deps: { createCalendarItemSources: () => calendarItemSources.provide() },
      });

      // Until the assignments below register these on `this`, only this scope
      // can release the timers/subscriptions init() makes the sources create —
      // an exception here would otherwise leak them past the error path with
      // refreshes still scheduling. One disposer covers the throw and both
      // stale-mount bails; disposal is idempotent, so a bail racing the
      // unload-path disposal is safe.
      const disposeMountResources = (): void => {
        controller.dispose();
        calendarItemSources.dispose();
        // This mount's own watch (never `this.unwireTimeblockWatch`, which a
        // newer racing mount may already have replaced with its own).
        unwireTimeblockThisMount();
      };

      try {
        await controller.init();
      } catch (error) {
        disposeMountResources();
        throw error;
      }

      // A newer mount or an unmount happened while we awaited init() — discard.
      if (token !== this.mountToken) {
        disposeMountResources();
        return;
      }

      this.ganttController = controller;
      this.calendarItemSourcesProvider = calendarItemSources;
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
        // A changed signature is the "Bases data changed" event the
        // property-event family subscribes to: bump its epoch so the batch
        // cache re-derives from the current entries in the refresh below.
        if (this.lastEntrySignature !== null && sig !== this.lastEntrySignature) {
          for (const handler of [...this.basesDataHandlers]) handler();
        }
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
      // Calendar-note liveness: a marked note's edit/rename/deletion re-runs the
      // same coalesced refresh; the epoch (folded into the entry signature) makes
      // that refresh a genuine re-read rather than a cached-task reuse.
      this.unwireCalendarWatch?.();
      const mountWatch = createMountCalendarWatch({
        app: this.app,
        isConnected: () => !!this.containerEl?.isConnected,
        scheduleRefresh: () => this.refreshCoalescer?.schedule(),
        readAssociationValue: (path) => this.readAssociationValue(path),
      });
      this.calendarWatch = mountWatch.watch;
      this.unwireCalendarWatch = mountWatch.unwire;

      const interactions = new TaskNotesInteractions(this.app);

      const data = await this.buildGanttData(controller);
      // Seed the entry signature from the mount-time entries so the FIRST
      // config-only onDataUpdated already reuses the cached tasks (no re-read,
      // no storm) instead of paying one full re-read before the gate engages.
      this.lastEntrySignature = this.computeEntrySignature();

      // Re-check after the second await window.
      if (token !== this.mountToken) {
        disposeMountResources();
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
      livePickerEntries.set(this.containerEl, () => this.openCalendarPicker());
      // Quick source switcher: session state is retained across remounts of
      // this view instance (display-only hiding survives refreshes, dies with
      // the view); the opener joins the command registry like the focus and
      // calendar-picker entries.
      this.sourceSwitcherState ??= createSourceSwitcherState();
      this.unregisterSwitcherEntry?.();
      this.unregisterSwitcherEntry = registerSourceSwitcherEntry(this.containerEl, () =>
        this.openSourceSwitcher(),
      );
      const tMountStart = performance.now(); // [OGDBG #161]
      this.svelteComponent = mount(GanttContainer, {
        target: this.containerEl,
        props: {
          data: this.dataStore,
          app: this.app,
          config: this.config,
          // Unique per-view CSS namespace: the component anchors its bar-treatment
          // sheet under this class and the shading sheet built here uses the same,
          // so neither leaks onto another view sharing `.og-bases-gantt`.
          scopeClass: this.treatmentScopeClass,
          // Theme toolbar (plan 002 U3/U4): the initial per-view theme mode and
          // a persist callback closing over config.set so the toolbar never
          // touches config directly. Toolbar VISIBILITY is NOT passed here — it
          // flows through the reactive GanttData store (showToolbar) so toggling
          // the option live shows/hides the toolbar without a remount.
          themeMode: this.getThemeMode(),
          onThemeModeChange: (mode: ThemeMode) =>
            persistThemeMode((key, value) => this.config.set(key, value), mode),
          // "Don't ask again" on the inferred-drag prompt persists the chosen
          // action as the per-view mode, closing over config.set (mirrors the
          // theme-mode persist callback; the cascade mode is read-only).
          onInferredDragModeChange: (mode: InferredDragAction) =>
            persistInferredDragMode((key, value) => this.config.set(key, value), mode),
          // Drag/resize persistence (U8): the view calls this on a commit; the
          // controller resolves instance→source and writes through TaskNotes.
          onMutate: (instanceId: string, patch: TaskPatch) => controller.mutate(instanceId, patch),
          // Inline cell-edit persistence: a committed grid editor value routes
          // to the controller's property write (mapped fields via their
          // resolved branches, user fields as a generic fieldWrite). Rejects
          // without writing where the resolution refuses.
          onMutateProperty: (instanceId: string, propertyId: string, value: unknown) =>
            controller.mutateProperty(instanceId, propertyId, value),
          // FS dependency authoring (M2): drag-to-create / delete a link route to
          // the controller, which resolves both endpoints → source and writes
          // blockedBy through TaskNotes.
          onAddDependency: (predecessorInstanceId: string, dependentInstanceId: string) =>
            controller.addDependency(predecessorInstanceId, dependentInstanceId),
          onRemoveDependency: (predecessorInstanceId: string, dependentInstanceId: string) =>
            controller.removeDependency(predecessorInstanceId, dependentInstanceId),
          // Native edit interaction (plan 004): a bar's left/double-click and
          // right-click delegate to TaskNotes (open note / native edit modal /
          // task menu) via the interaction service — no custom modal. The
          // controller first resolves what to open: task rows pass through; a
          // calendar-item row resolves to its backing note or, without one,
          // to null — activation then no-ops (a synthetic id is never a path).
          onBarActivate: (path: string, opts: { kind: 'single' | 'double'; ctrlOrMeta: boolean }) => {
            const target = controller.resolveBarActivationPath(path);
            if (target !== null) void interactions.handleActivate(target, opts);
          },
          onBarContextMenu: (path: string, event: MouseEvent) =>
            interactions.showContextMenu(path, event),
          // Focus-on-task command wiring (R2): the view publishes its opener on
          // mount and retracts it on teardown, so the plugin command targets the
          // active Gantt view. Tracked per-view so one view's teardown never
          // clears another live view's entry.
          onOpenCalendarPicker: () => this.openCalendarPicker(),
          // Quick source switcher (display-only per-source hiding): the view
          // folds the session state into its composed display filter; the
          // toolbar button and the plugin command share this opener.
          sourceSwitcher: this.sourceSwitcherState,
          onOpenSourceSwitcher: () => this.openSourceSwitcher(),
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
          // Re-assert hook (Bug B): the component publishes a width-restore
          // callback that onResize() invokes on reveal/reattach. Null on teardown.
          onReassertGridWidthReady: (reassert: (() => void) | null) => {
            this.reassertGridWidth = reassert;
          },
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
          text: 'TaskNotes Gantt: Failed to render chart. See console for details.',
        });
      }
    }
  }

  /** Compute the current dynamic render data from the controller + view config. */
  private async buildGanttData(controller: GanttController): Promise<GanttData> {
    this.reconcileCalendarSelectionAlias();
    const arrowMode = this.getArrowMode();
    const [instances, links, statusColors, priorityColors, managedPaths, statusOptions, priorityOptions] =
      await Promise.all([
        controller.getInstances(),
        controller.getLinks(arrowMode),
        controller.getStatusColors(),
        controller.getPriorityColors(),
        controller.getManagedPaths(),
        controller.getChoiceOptions('status'),
        controller.getChoiceOptions('priority'),
      ]);
    // Resolve the visible property columns once; share between the per-task
    // value map (U1) and the column descriptors (U2).
    const visiblePropIds = this.getVisiblePropertyIds();
    // Resolve each column's render type once: TaskNotes custom field -> Obsidian
    // widget -> Bases value shape. Drives markdown-vs-conventional cell rendering.
    const userFieldTypes = resolveUserFieldTypes(this.app);
    const resolveRenderType: ResolveRenderType = (propId, valueKind) =>
      resolveCellRenderType(propId, {
        taskNotesFieldType: (key) => userFieldTypes.get(key.toLowerCase()) ?? null,
        obsidianWidget: (name) => getObsidianPropertyWidget(this.app, name),
        valueKind,
      });
    // Snapshot the display locale ONCE per assembly pass and thread it down, so
    // every cell of this pass (matched + fetched) formats dates identically.
    const dateLocale = resolveDateLocale();
    const cellDataContext = { extractor: this.gridAdapter, resolveRenderType, dateLocale };
    const { cellRenders, propertyValues } = buildCellData(
      this.data?.data ?? [],
      visiblePropIds,
      cellDataContext,
    );
    // Show-all *context* rows (companion-fetched subtasks) are NOT in the Bases
    // result, so the matched-only maps above leave their grid cells blank. Fill
    // their note.*/file.* columns from the metadata cache (formula columns fall
    // back to empty). Matched rows already in the maps are never overwritten.
    if (visiblePropIds.length > 0) {
      const seen = new Set(propertyValues.keys());
      const fetchedMetas = collectFetchedFileMetas(instances, seen, (path) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return null;
        return {
          basename: file.basename,
          extension: file.extension,
          frontmatter: this.app.metadataCache.getFileCache(file)?.frontmatter ?? null,
        };
      });
      const fetched = buildFetchedCellData(fetchedMetas, visiblePropIds, cellDataContext);
      for (const [path, record] of fetched.cellRenders) cellRenders.set(path, record);
      for (const [path, record] of fetched.propertyValues) propertyValues.set(path, record);
    }
    const gridColumns = buildGridColumns(
      visiblePropIds,
      (id) => this.getDisplayName(asPropertyId(id)),
      this.getColumnSize(),
      // The task-name property: the configured textProperty, else file.name.
      (this.config.get('tngantt_textProperty') as string) || 'file.name',
    );
    // Per-column inline editors (inline cell editing): resolve each grid
    // column's editor descriptor against the same mappings + writability the
    // write path (`mutateProperty` → `resolvePropertyPatch`) enforces, so an
    // editor is never offered where the write would refuse.
    //
    // Which property IS the status/start/… field comes from the controller's
    // RESOLVED mappings, so a field left unset in the view settings offers the
    // same editor as an explicitly selected one (it resolves to TaskNotes'
    // configured property, and the write routes through that field's canonical
    // branch). The progress/estimate writability gates stay on the RAW view
    // config, mirroring the controller's write-target resolution: the resolved
    // estimate property is a READ fallback with no write target in Property mode,
    // so gating on it would open an editor the write path then refuses.
    const viewMappings = this.buildFieldMappings();
    const cellEditors = resolveGridCellEditors(gridColumns, {
      taskNotesFieldType: (key) => userFieldTypes.get(key.toLowerCase()) ?? null,
      // Identity from the RESOLVED mappings; the progress/estimate write gates from the
      // RAW view config (their resolved property is a read-only fallback with no write
      // target). resolveGridCellEditors documents and tests the pairing.
      mappings: this.getEffectiveMappings(),
      progressWritable: !isProgressReadonly(viewMappings),
      estimateWritable: isTimeEstimateWriteEnabled(viewMappings),
      statusWritable: controller.isStatusWritable(),
      priorityWritable: controller.isPriorityWritable(),
    });
    // Cache the name-column width as the unset-divider fallback (R4), read by getTableWidth().
    this.lastFirstColumnWidth = firstColumnWidth(gridColumns);
    const calendarShading = this.buildCalendarShading(instances);
    const showDateIndicators = this.getShowDateIndicators();
    const highlightWeekends = this.getHighlightWeekends();
    const barFillSource = this.getBarFillSource();
    const barStripSource = this.getBarStripSource();
    const barIconSource = this.getBarIcon();
    const taskNotesPresent = isTaskNotesPresent(this.app);
    const calendarItems = this.getCalendarItemToggles();
    const estimateMeaning = readEstimateMeaning((key) => this.config.get(key));
    const nonWorkingRendering = readNonWorkingRendering((key) => this.config.get(key));
    const effectiveMappings = this.getEffectiveMappings();
    const estimateOverrideMapped = (effectiveMappings.estimateMeaningProperty ?? '') !== '';
    const externalCalendarLegendFacts = this.readExternalCalendarLegendFacts();
    const recordedRecurringOccurrencesPresent = hasRecordedRecurringOccurrences(instances);
    const visibleCalendarEventColor =
      instances
        .map((instance) => instance.calendarItem?.color)
        .find((color) => isSafeColor(color)) ?? null;
    const visibleExternalOccurrenceColor =
      instances
        .filter((instance) => instance.calendarItem?.family === 'external-event')
        .map((instance) => instance.calendarItem?.color)
        .find((color) => isSafeColor(color)) ?? null;
    return {
      instances,
      links,
      capabilities: controller.capabilities,
      arrowMode,
      showDateIndicators,
      showToolbar: this.getShowToolbar(),
      defaultLegendPosition: this.getDefaultLegendPosition(),
      highlightWeekends,
      // #161: the same config key as before, now a view-level display filter.
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
      choiceOptions: { status: statusOptions, priority: priorityOptions },
      barFillSource,
      barStripSource,
      barIcon: barIconSource,
      // Read-only bar → the view hides the drag handle (U5/R7). True in TaskNotes
      // mode and in Property mode with no mapped property (nowhere to persist).
      progressReadonly: this.getProgressReadonly(),
      // Whether a resize should write the Time Estimate back (U6/R13–R15). The
      // container additionally gates on read-only (standalone never writes, R17).
      timeEstimateWriteEnabled: isTimeEstimateWriteEnabled(this.buildFieldMappings()),
      dateMappingNotice: buildDateMappingNotice(controller.getDateMappingInfo()),
      taskNotesPresent,
      cascadeMode: this.getCascadeMode(),
      getInferredDragMode: () => this.getInferredDragMode(),
      defaultScale: normalizeDefaultScale(this.config.get('tngantt_defaultScale')),
      propertyValues,
      cellRenders,
      dateLocale,
      managedPaths,
      cellEditors,
      gridColumns,
      gridColumnsKey: gridColumnsKey(gridColumns),
      gridWidth: this.getTableWidth(),
      // Transient external-calendar fetching state (visible feeds awaiting
      // their first completion signal) — the toolbar's honest minimal
      // indicator. Cleared by the refresh the first completion signal
      // (data-changed, a changed fallback tick, or a warm cache) triggers.
      externalEventsLoading: this.externalEventsLoading,
      calendarShadingCss: calendarShading.css,
      calendarNotice: calendarShading.notice,
      calendarMarkers: calendarShading.markers,
      calendarPalette: calendarShading.calendarPalette,
      calendarBySource: calendarShading.calendarBySource,
      legendContext: {
        taskNotesPresent,
        parentPropertyMapped: (effectiveMappings.parentProperty ?? '') !== '',
        showDateIndicators,
        highlightWeekends,
        barFillSource,
        barStripSource,
        barIconSource,
        statusColors,
        priorityColors,
        calendarPalette: calendarShading.calendarPalette,
        calendarMarkers: calendarShading.markers,
        calendarDisplayedCount: calendarShading.selectedCount,
        hasResolvedSchedulingCalendar: calendarShading.hasResolvedSchedulingCalendar,
        hasRecordedRecurringOccurrences: recordedRecurringOccurrencesPresent,
        calendarEventColor:
          visibleCalendarEventColor ?? externalCalendarLegendFacts.representativeColor,
        externalOccurrenceColor:
          visibleExternalOccurrenceColor ?? externalCalendarLegendFacts.representativeColor,
        estimateMeaning,
        nonWorkingRendering,
        estimateOverrideMapped,
        expandedRelationships: this.getExpandedRelationships(),
        calendarItems,
        externalCalendarsEnabled: externalCalendarLegendFacts.enabled,
      },
      // Span↔estimate answers come from the controller's derivation authority —
      // the write path asks; it never assembles blocking facts itself.
      deriveEstimate: controller.buildDeriveEstimate(),
      deriveSpan: controller.buildDeriveSpan(),
      refreshGeneration: () => controller.recomputeGeneration(),
      defaultDurationDays: readDatePolicyConfig((key) => this.config.get(key)).defaultDuration,
    };
  }

  /** Skip-if-unchanged memo for the shading stylesheet. */
  private readonly shadingCssCache = createShadingCssCache();

  /**
   * The S1 calendar-shading assembly inputs, gathered cache-safely (marked
   * notes and association values via the metadata cache, never the Bases value
   * system) and handed to the pure `computeCalendarShadingCss`. The cheap
   * inputs (associations, window, watch epoch) build the staleness key; the
   * whole-vault enumeration and evaluation run only when the key changes.
   */
  private buildCalendarShading(
    instances: ReadonlyArray<{ start: Date | null; end: Date | null; sourcePath?: string }>,
  ): {
    css: string;
    notice: string | null;
    markers: MarkerInput[];
    calendarPalette: { value: string; color: string }[];
    calendarBySource: Map<string, string>;
    displayedCount: number;
    selectedCount: number;
    hasResolvedSchedulingCalendar: boolean;
  } {
    const app = this.app;
    const calendarProperty = this.getEffectiveMappings().calendarProperty ?? '';
    const frontmatterKey = frontmatterSignatureKeys([calendarProperty])[0];
    const entryPaths = (this.data?.data ?? []).flatMap((entry) => {
      const path = (entry as SignatureEntry).file?.path;
      return path ? [path] : [];
    });
    // Rendered instances too, not just Bases entries: Show-all fetches descendants
    // that are not entries, and their bars need a calendar identity as well.
    const taskPaths = associationTaskPaths(entryPaths, instances);
    const associations = frontmatterKey
      ? calendarAssociationsFrom(taskPaths, (path) => {
          const file = app.vault.getAbstractFileByPath(path);
          if (!(file instanceof TFile)) return undefined;
          return app.metadataCache.getFileCache(file)?.frontmatter?.[frontmatterKey];
        })
      : [];
    const selection = readDisplaySelection(
      readDisplayCalendars((key) => this.config.get(key)),
      this.config.get('tngantt_highlightWeekends'),
    );
    const key = shadingCacheKey({
      epoch: this.calendarWatch?.epoch() ?? 0,
      calendarProperty,
      window: shadingWindow(instances),
      associations,
      selectionKey: selection.auto ? '' : JSON.stringify(serializeSelection(selection)),
    });
    const computed = this.shadingCssCache.compute(key, () =>
      // The marked-note enumeration scans the vault, so it stays INSIDE the cache
      // callback (runs only on a real shading change); the paths ride out on the
      // memoised result (computed.markedNotePaths) for the watch seed below.
      computeCalendarShadingCss({
        scope: `.${this.treatmentScopeClass}`,
        markedNotes: this.collectMarkedCalendarNotes(),
        resolveLink: (linkText, fromPath) => resolveParentLink(app, linkText, fromPath),
        associations,
        taskSpans: instances,
        displaySelection: selection,
      }),
    );
    // Register every marked calendar note the shading inspected — not just the
    // task-associated ones — so deleting any in-use calendar (including one only
    // shown via the display selection) re-resolves even if it was never edited in
    // view (a deletion cannot probe the marker once the file is gone).
    this.calendarWatch?.syncKnownPaths(computed.markedNotePaths);
    // And every task note whose association the shading read — a later edit that
    // MOVES one of those associations must refresh, and nothing else re-reads it:
    // the controller snapshot compares dates/text, not associations, and a
    // fetched (Show-all) row has no Bases entry to re-notify through.
    this.calendarWatch?.syncAssociations(
      // EVERY rendered task path, not just the ones with a value: a fetched row
      // that has no association yet must still be tracked (baseline: absent), or
      // gaining its FIRST calendar link would be invisible — no Bases entry, no
      // snapshot change, no marker relevance.
      taskPaths.map((path) => [path, this.readAssociationValue(path)] as const),
    );
    // The picker must see the SAME association set the chart shades from, or a
    // fetched row's calendar shades the chart while sitting unchecked in the
    // picker (and a toggle there would materialise a selection omitting it).
    this.lastAssociationTaskPaths = taskPaths;
    return {
      css: computed.css,
      markers: computed.markers,
      calendarPalette: computed.calendarPalette,
      calendarBySource: computed.calendarBySource,
      displayedCount: computed.displayedCount,
      selectedCount: computed.selectedCount,
      hasResolvedSchedulingCalendar: computed.hasResolvedSchedulingCalendar,
      notice: buildCalendarNotice({
        displayedCount: computed.displayedCount,
        conflictCount: computed.conflictCount,
        conflictCalendars: computed.conflictCalendars,
        invalidCount: computed.invalidCount,
        flaggedCount: computed.flaggedCount,
      }),
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
    livePickerEntries.delete(this.containerEl);
    this.unregisterSwitcherEntry?.();
    this.unregisterSwitcherEntry = null;

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
    // Drop the re-assert bridge (Bug B) so onResize can't call a dead component.
    this.reassertGridWidth = null;

    if (this.ganttController) {
      try {
        this.ganttController.dispose();
      } catch (error) {
        console.warn('[Gantt] Error disposing controller:', error);
      }
      this.ganttController = null;
    }

    if (this.calendarItemSourcesProvider) {
      try {
        this.calendarItemSourcesProvider.dispose();
      } catch (error) {
        console.warn('[Gantt] Error disposing calendar-item sources:', error);
      }
      this.calendarItemSourcesProvider = null;
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
  const handle = getTaskNotesPluginHandle(app) as { api?: unknown } | null;
  return Boolean(handle?.api);
}

/**
 * Register the Gantt view with Obsidian's Bases API
 *
 * @param plugin - The Obsidian plugin instance
 * @returns Cleanup function (no-op since Obsidian handles unregistration)
 */
export function registerBasesGantt(plugin: Plugin, calendarLifetime: PluginLifetime): () => void {
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
      return new ObsidianGanttBasesView(controller, containerEl, calendarLifetime);
    },
    // Companion-only relationship controls render only when TaskNotes is
    // present (expansion is companion-only — see plan U1/R6). Presence is
    // re-checked each time the options panel builds; cheap. The current
    // Progress Property drives the Progress-mode dropdown's shown default so it
    // matches readProgressMode's unset resolution (property when one is mapped).
    options: (config: BasesViewConfig): BasesAllOptions[] => {
      const hasProgressProperty =
        (readFieldMappings((key) => config.get(key)).progressProperty ?? '').trim() !== '';
      const calendarItems = calendarItemOptionsGroup();
      // Per-feed external-calendar toggles: dynamic entries built from the
      // CURRENT TaskNotes subscription/calendar lists (guarded reads), gated
      // on TaskNotes presence like the other companion-only controls. When an
      // external service surface degraded this session, a description line
      // states it (Bases toggles carry no disabled/tooltip shape).
      const taskNotesHandle = getTaskNotesPluginHandle(plugin.app);
      if (isTaskNotesPresent(plugin.app) && taskNotesHandle !== null) {
        const discovery = readExternalCalendarDiscovery(taskNotesHandle);
        sessionExternalCalendarDegradeSignal.observeCollect({ degraded: discovery.degraded });
        calendarItems.items.push(
          ...externalCalendarOptionEntries(
            discovery.icsSubscriptions,
            discovery.providerCalendars,
          ),
        );
        if (sessionExternalCalendarDegradeSignal.wasDegradedThisSession()) {
          calendarItems.items.push(externalCalendarDegradedEntry());
        }
      }
      return [
        ...ganttViewOptions(isTaskNotesPresent(plugin.app), hasProgressProperty),
        calendarItems,
      ];
    },
  });

  if (registeredGantt) {
    console.info(`[Gantt] Registered Bases view: ${VIEW_NAME}`);
  } else {
    console.warn('[Gantt] Failed to register Bases view - Bases plugin may not be enabled');
  }

  // Obsidian handles cleanup automatically via plugin lifecycle
  return () => {
    // No manual cleanup needed - Obsidian manages registered views
  };
}
