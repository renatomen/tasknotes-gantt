<script lang="ts">
  /* global HTMLElement, HTMLButtonElement, HTMLStyleElement, Element, Event, CustomEvent, MouseEvent, MediaQueryListEvent, KeyboardEvent, ResizeObserver, requestAnimationFrame, cancelAnimationFrame, setTimeout, clearTimeout */
  // Willow / WillowDark are SVAR's real theme components: each renders the full
  // nested core → grid → gantt theme layers, sets the load-bearing `wx-theme`
  // context, and guarantees its CSS. We render the one chosen by the effective
  // theme around the chart (plan 002 U2) so the theme applies completely.
  import { Gantt, Tooltip, Willow, WillowDark, defaultTaskTypes, type IApi } from '@svar-ui/svelte-gantt';
  import { createMaximizeController, type MaximizeController } from './maximizeController';
  import DependencyTooltip from './DependencyTooltip.svelte';
  import GanttToolbar from './GanttToolbar.svelte';
  import { Notice, Scope, TFile } from 'obsidian';
  import { GANTT_DATE_STATUS_FILL_COLOR } from './visualSemantics';
  import { get } from 'svelte/store';
  import {
    isEffectiveDark,
    isObsidianDark,
    subscribeObsidianTheme,
    type ThemeMode,
  } from './themeResolver';
  import type { TaskPatch } from '../datasource/types';
  import type { GanttData } from './types/gantt-view-data';
  import type { RenderLink } from '../controller/InstanceExpansion';
  import { buildTreatmentStyle } from './barTreatment';
  import { nextInstanceScopeClass } from './instanceScope';
  import { buildMarkerOverlay } from './markerOverlay';
  import { chartSpanSnapshot } from '../render/svarContract';
  import { lucideIcon } from './lucideIconAction';
  import BarContent from './BarContent.svelte';
  import { onDestroy, setContext, tick } from 'svelte';
  import {
    GRID_APP_CONTEXT_KEY,
    GRID_DATE_LOCALE_CONTEXT_KEY,
    GRID_EDITABLE_COLUMNS_CONTEXT_KEY,
  } from './gridContext';
  import { buildFocusPlan } from './focusController';
  import { FocusTaskModal } from './FocusTaskModal';
  import {
    allowsLinkEndpoints,
    allowsRowMutation,
    allowsTaskContextMenu,
    hasDerivedBarGeometry,
    refusesUserRowMutation,
  } from './eventRowGuards';
  import {
    buildSvarTasks,
    buildTreatmentTaskTypes,
    buildInstanceCueTaskTypes,
    planReorder,
    baseSortDescriptor,
    echoTaskPatch,
    shouldBulkReseed,
    structuralOpCount,
    type SvarTask,
    type SvarTaskInputs,
  } from './ganttSync';
  import {
    applyEchoToBaseline,
    applyIncrementalGanttSync,
    createAppliedGanttSyncState,
    createGanttSeedSnapshot,
    ganttOrderFingerprint,
    isGanttSyncNoop,
    planGanttSync,
    replaceAppliedGanttData,
    type AppliedGanttSyncState,
    type GanttSyncPlan,
  } from './ganttSyncCoordinator';
  import { createSvarGanttAdapter } from './svarGanttAdapter';
  import {
    classifyUpdateEvent,
    classifyUpdateGesture,
    classifyLinkCreate,
    type DateRange,
  } from './cascadeGate';
  import { type InferredDragAction } from './inferredDragGate';
  import { InferredDragModal } from './InferredDragModal';
  import { createCellEditCoordinator } from './cellEditCoordinator';
  import {
    choiceEditorOptions,
    dateRoleColumns,
    editorAttachedColumnIds,
    editorSeedFor,
    rowEditorConfig,
    shippedEditorKinds,
    storedFlatValue,
    suggestColumns,
    type SvarEditorConfig,
    type SvarRowLike,
  } from './cellEditCommit';
  import { wireSvarCellEditorForOpen } from './svarCellEditorWiring';
  import { bareProperty } from '../datasource/dateFieldMapping';
  import { ensureInlineEditorsRegistered } from './inlineEditors';
  import type { TypedValue } from './propertyValues';
  import { formatPropertyValue } from './propertyFormat';
  import type { CellRender } from './cellRender';
  import { CascadeConfirmModal } from './CascadeConfirmModal';
  import PropertyCell from './PropertyCell.svelte';
  import type { GridColumn } from './gridColumns';
  import { buildZoomConfig, initialCellWidth } from './zoomConfig';
  import {
    buildAvailability,
    calendarCellClass,
    localeWeekendSource,
    resolveWeekendDays,
  } from '../controller/availability';
  import {
    resolveHostHeight,
    DEFAULT_MAX_HEIGHT,
    GANTT_MIN_HEIGHT,
    SVAR_CELL_HEIGHT,
    SVAR_SCALE_HEIGHT,
  } from './ganttHeight';
  import { DEFAULT_CONTEXT_OPACITY } from './viewOptions';
  import { toggleCollapseAll } from './collapseState';
  import { propertyColumnSort } from './columnSort';
  import { type EphemeralSort } from './sortCycle';
  import {
    wireSvarInterceptors,
    type InterceptorAccess,
    type SvarInterceptorDeps,
    type UpdateTaskEvent,
  } from './svarInterceptors';
  import { shouldHideRow, anyRowFilterActive } from './rowVisibility';
  import type { SourceSwitcherState, SwitcherRowSource } from './sourceSwitcher';
  import { buildRetainedAncestorNotice } from './retainedAncestorNotice';
  import type { DateStatus } from '../controller/datePolicy';
  import { spanDaysToMinutes, inclusiveDaySpan, minutesToSpanDays } from '../controller/durationConversion';
  import {
    createDequeueBeforeRebase, memoizePlannerDerivation, overlayStoreGeometry, planCascade, planGestureCommit,
    pureMoveBefore, type BarBefore, type CommitGesture, type DerivationMemo, type PlannedPatch,
    type PlannedWrite, type PlannerDerivation, type SourceEchoes,
  } from './dragCommitPlanner';
  import { createDragExecutor, type CascadePhase } from './dragExecutor';
  import { createDragPromptResolver } from './dragPromptResolver';
  import {
    captureGanttLifecycle,
    classifyViewportSettlement,
    currentGanttLifecycleCaptureGeneration,
    currentGanttLifecyclePhase,
    dlog,
    isGanttLifecycleCaptureActive,
    type GanttLifecycleFacts,
    type ViewportObservation,
  } from '../debugLog';
  import GanttLegend from './GanttLegend.svelte';
  import { buildLegendCatalog } from './legendCatalog';
  import {
    CLOSED_LEGEND_SESSION,
    reduceLegendSession,
    resolveLegendLayout,
    type LegendPosition,
    type LegendSessionState,
  } from './legendLayout';

  // The toggle handler our floating full-screen button invokes (wired as an
  // onclick; it ignores the event). Named alias so the snippet signature can be
  // typed without an inline function-type param.
  type MaximizeToggleAction = () => void;

  // Obsidian overlay surfaces that should consume Escape themselves while
  // maximized — when one is open, our Esc-to-exit handler stands down so a single
  // Escape closes the popup without also dropping maximize. Named (not inline) so
  // the policy has one canonical home; extend here if Obsidian adds a layer.
  const OBSIDIAN_OVERLAY_SELECTOR =
    '.modal-container, .menu, .suggestion-container, .hover-popover';

  // Component props. The dynamic render inputs arrive via a reactive `data`
  // store (refreshed in place by register.ts) so the SVAR instance persists
  // across data changes and keeps its view state (zoom, scroll). Static inputs
  // (app, config, interaction callbacks) stay ordinary props.
  interface Props {
    /** Reactive bundle of the dynamic render inputs (see GanttData). */
    data: import('svelte/store').Readable<GanttData>;
    app: import('obsidian').App;
    config?: import('obsidian').BasesViewConfig;
    /**
     * The instance's unique per-view scope class (e.g. `og-gantt-abc12345`),
     * minted by the host (register.ts) so BOTH injected stylesheets — the bar
     * treatment built here and the calendar shading built by the host — anchor
     * under the same class and cannot leak onto another instance's bars/cells
     * that share `.og-bases-gantt`. Absent → a self-minted fallback still scopes
     * the treatment sheet.
     */
    scopeClass?: string;
    /** Monotonic identity of the register.ts mount that owns this component. */
    mountToken?: number;
    /** Live controller source/delivery generations for diagnostic correlation. */
    controllerGeneration?: () => { started: number; delivered: number };
    /**
     * Persist a field patch for a render instance through the controller (U8).
     * The view calls this on a drag/resize commit (dates-only patch). Absent in
     * read-only contexts / older callers — drag persistence is then inert.
     */
    onMutate?: (instanceId: string, patch: TaskPatch) => Promise<void>;
    /**
     * Persist a single property edit (inline cell edit) for a render instance
     * through the controller's `mutateProperty`. Rejects (throws) without
     * writing for non-writable columns, wrong-typed values, canonical-key
     * collisions, and unmanaged rows. Absent in read-only contexts — inline
     * editors are then never offered.
     */
    onMutateProperty?: (instanceId: string, propertyId: string, value: unknown) => Promise<void>;
    /**
     * Create a Finish-to-Start dependency from a drawn link (M2/U4): the task
     * behind `predecessorInstanceId` blocks the one behind `dependentInstanceId`.
     * Routed to the controller's `addDependency`. Absent in read-only contexts.
     */
    onAddDependency?: (predecessorInstanceId: string, dependentInstanceId: string) => Promise<void>;
    /**
     * Remove a dependency from a deleted link (M2/U3). Routed to the controller's
     * `removeDependency`. Absent in read-only contexts.
     */
    onRemoveDependency?: (predecessorInstanceId: string, dependentInstanceId: string) => Promise<void>;
    /**
     * Native edit interaction: invoked on a left/double-click of a bar with the
     * resolved note path, the click kind, and whether ctrl/meta was held. The
     * binder (register.ts) routes this to the TaskNotes interaction service
     * (open note / open native edit modal per TaskNotes settings).
     */
    onBarActivate?: (path: string, opts: { kind: 'single' | 'double'; ctrlOrMeta: boolean }) => void;
    /**
     * Native context menu: invoked on right-click of a bar with the resolved
     * note path and the mouse event, routed to TaskNotes' own task menu.
     */
    onBarContextMenu?: (path: string, event: MouseEvent) => void;
    /**
     * Persist a column's new width (U5/R8). Invoked on a resize commit with the
     * Bases property id the column maps to (the name column reports its name
     * key, not `text`). The binder writes it to the standard `columnSize` map.
     */
    onColumnResize?: (propId: string, width: number) => void;
    /**
     * Persist the grid/timeline divider width (plan 002 U3). Invoked on a
     * `resize-grid` commit with the new grid-pane width; the binder writes it to
     * the standard `obsidianGantt.tableWidth`. In-session dragging is SVAR's own
     * Resizer — this only persists the chosen width across reloads.
     */
    onGridWidthChange?: (width: number) => void;
    /**
     * The initial per-view theme mode (plan 002 U3). Seeds the live `mode`
     * state; `auto` follows Obsidian, `light`/`dark` pin this chart's theme.
     */
    themeMode?: ThemeMode;
    /**
     * Persist a chosen theme mode per-view (plan 002 U3). The toolbar calls
     * this on change; register.ts closes it over `config.set`. Absent callers
     * keep an in-session-only switch.
     */
    onThemeModeChange?: (mode: ThemeMode) => void;
    /**
     * Persist a chosen inferred-drag action per-view when the user ticks "Don't
     * ask again" in the prompt. register.ts closes it over `config.set`.
     * Absent callers keep an in-session-only choice.
     */
    onInferredDragModeChange?: (mode: InferredDragAction) => void;
    /**
     * Publish (and later retract) this view's "focus on task" entry point so the
     * plugin command (register.ts → main.ts) can open the focus search for the
     * active Gantt leaf. Called with the opener on mount and `null` on teardown.
     */
    onFocusEntryReady?: (entry: (() => void) | null) => void;
    /** Open the calendar picker (the banner's click-through). */
    onOpenCalendarPicker?: () => void;
    /**
     * The view instance's session-scoped hidden-source state (quick source
     * switcher). The host owns its lifetime — it survives refreshes of the same
     * view and dies with it. The view folds it into the composed display filter
     * and re-applies on every change. Absent → no switcher filtering.
     */
    sourceSwitcher?: SourceSwitcherState;
    /** Open the quick source switcher; the toolbar button renders only when provided. */
    onOpenSourceSwitcher?: () => void;
    /**
     * Register a callback the host calls to re-assert the persisted divider width
     * when the view is revealed/reattached (Obsidian's `onResize`). SVAR can
     * recompute the grid pane to the column-sum width on reattach WITHOUT a column
     * change (e.g. returning to this tab), which the mount/reseed re-assert path
     * doesn't catch — so the host re-triggers the re-assert here. Passed `null` on
     * teardown.
     */
    onReassertGridWidthReady?: (reassert: (() => void) | null) => void;
  }

  // The controller owns the data transform, so the view does not read `config`
  // for rendering — but it DOES read `config.getSort()` to detect a Base toolbar
  // sort change while an ephemeral column sort is active (plan 2026-06-22-002,
  // U4/U5/R6). `app` is used to host the parent-date-cascade confirmation modal.
  let {
    data,
    app,
    config,
    scopeClass,
    mountToken = 0,
    controllerGeneration,
    onMutate,
    onMutateProperty,
    onAddDependency,
    onRemoveDependency,
    onBarActivate,
    onBarContextMenu,
    onColumnResize,
    onGridWidthChange,
    themeMode = 'auto',
    onThemeModeChange,
    onInferredDragModeChange,
    onFocusEntryReady,
    onOpenCalendarPicker,
    sourceSwitcher,
    onOpenSourceSwitcher,
    onReassertGridWidthReady,
  }: Props = $props();

  // Unique per-instance scope class: BOTH injected stylesheets (the bar-treatment
  // sheet built here and the calendar-shading sheet the host builds) anchor every
  // rule under `.<treatmentScopeClass>`, so one instance's rules never restyle
  // another instance's bars/cells that share `.og-bases-gantt`. The host supplies
  // it so the shading sheet targets the same class; a self-minted fallback keeps
  // the treatment sheet scoped when absent. A plain const — stable for the
  // component's lifetime.
  const treatmentScopeClass = scopeClass ?? nextInstanceScopeClass();

  // Hand `app` to SVAR-mounted grid cells (PropertyCell) via context — SVAR
  // passes cells only { api, row, column, onaction }, so a prop can't reach them.
  setContext(GRID_APP_CONTEXT_KEY, app);

  // The custom inline editors (locale-aware date editor) must be registered in
  // SVAR's grid editor registry before any column referencing their type opens.
  ensureInlineEditorsRegistered();

  // ── Theme (plan 002 U2) ─────────────────────────────────────────────────
  // Live theme mode (seeded from the per-view prop) + the current Obsidian
  // dark/light read. `effectiveIsDark` (U1) chooses between SVAR's real
  // <Willow> / <WillowDark> theme components in the markup — each renders the
  // full core/grid/gantt theme layers and sets the `wx-theme` context itself.
  const initialMode: ThemeMode = themeMode;
  const initialDark = isObsidianDark();
  let mode = $state<ThemeMode>(initialMode);
  let obsidianIsDark = $state(initialDark);

  const effectiveIsDark = $derived(isEffectiveDark(mode, obsidianIsDark));

  // While in Auto, follow Obsidian's theme live (R1/R6) — independent of toolbar
  // visibility. Re-read `isObsidianDark()` on each `css-change` (MutationObserver
  // fallback inside the helper). Subscribe only in Auto; dispose on mode change
  // and on unmount. Apply the read THROUGH the guarded setter so a flip reseeds
  // the SVAR seed props before the {#if} remounts (see maybeReseedForThemeFlip).
  $effect(() => {
    if (mode !== 'auto') return;
    // Sync immediately in case the theme changed since mount/last subscription.
    applyObsidianDark(isObsidianDark());
    const dispose = subscribeObsidianTheme(app, () => {
      applyObsidianDark(isObsidianDark());
    });
    return dispose;
  });

  /**
   * Toolbar change handler (U3/U4). The parent owns the `mode` write so the
   * reseed + the flip batch in one synchronous tick before the {#if} re-renders:
   * reseed the SVAR seeds first (only when the effective theme actually flips),
   * then flip `mode`, then persist. A no-op change short-circuits.
   */
  function handleThemeModeChange(next: ThemeMode): void {
    if (next === mode) return;
    maybeReseedForThemeFlip(next, obsidianIsDark);
    mode = next;
    onThemeModeChange?.(next);
  }

  /**
   * Apply a new Obsidian dark/light read (auto-follow). Reseeds the SVAR seeds
   * first when the effective theme flips, then flips `obsidianIsDark` — same
   * synchronous-tick ordering as the toolbar handler.
   */
  function applyObsidianDark(nextDark: boolean): void {
    if (nextDark === obsidianIsDark) return;
    dlog(`[OGDBG] applyObsidianDark ${obsidianIsDark} -> ${nextDark} (effectiveIsDark may flip → <Gantt> remount)`);
    maybeReseedForThemeFlip(mode, nextDark);
    obsidianIsDark = nextDark;
  }

  /**
   * Reseed the SVAR seed props from the current data ONLY when the *effective*
   * theme actually flips. The {#if effectiveIsDark} swap remounts the <Gantt>,
   * which re-reads the seed props; those are otherwise refreshed only on a
   * column change, so a theme flip would show stale data without this. Guarded
   * so it never fires on unrelated mode/dark changes (e.g. auto→light while
   * already light).
   */
  function maybeReseedForThemeFlip(nextMode: ThemeMode, nextDark: boolean): void {
    if (isEffectiveDark(nextMode, nextDark) !== isEffectiveDark(mode, obsidianIsDark)) {
      reseedSeedsFromData(get(data));
    }
  }

  // Dynamic render inputs derived from the reactive store. Keeping the original
  // local names means the rest of the component is unchanged — only the source
  // of these values moved from individual props to the store (refresh-in-place).
  // `instances` + `statusColors` feed the reactive status-color stylesheet and
  // the bar→path click maps; `capabilities` gates the read-only banner. The SVAR
  // task/link/type shaping reads the raw `$data` directly in the diff-sync below
  // (so links / arrowMode / showDateIndicators need no standalone derived).
  const instances = $derived($data.instances);
  const capabilities = $derived($data.capabilities);
  const statusColors = $derived($data.statusColors ?? []);
  // Bar color/icon treatments (U5/U7), store-driven so the options are LIVE
  // toggles (no remount) — same treatment as showDateIndicators/showToolbar.
  // These feed the generated treatment stylesheet; the icon source flows through
  // toInputs → buildSvarTasks (per-task), so it needs no standalone derived here.
  const priorityColors = $derived($data.priorityColors ?? []);
  const barFillSource = $derived($data.barFillSource ?? 'default');
  const barStripSource = $derived($data.barStripSource ?? 'none');
  // U5/R7: TaskNotes progress mode is read-only — hide the bar's progress drag
  // handle (scoped CSS below). Date drag/resize is unaffected.
  const progressReadonly = $derived($data.progressReadonly ?? false);
  // Whether a resize should also persist the Time Estimate (write mode). Gated
  // again by `readOnly` at the write site so standalone never writes.
  const timeEstimateWriteEnabled = $derived($data.timeEstimateWriteEnabled ?? false);
  const dateMappingNotice = $derived($data.dateMappingNotice);
  // Calendar-status banner text (store-driven, so selection changes are live).
  const calendarNotice = $derived($data.calendarNotice ?? null);

  /**
   * Marker overlay (calendar markers + the generated today line). SVAR's own
   * marker feature is force-disabled in the MIT build, and cell-class markers
   * would vanish at the zooms people plan at, so markers are a plugin-owned
   * layer positioned from the contract choke-point's chart span.
   *
   * `markerTick` is the recompute signal: the span is SVAR state, invisible to
   * Svelte's reactivity, so zoom changes bump it explicitly.
   */
  let markerTick = $state(0);
  const markerEntries = $derived.by(() => {
    void markerTick;
    return buildMarkerOverlay({
      markers: $data.calendarMarkers ?? [],
      span: api ? chartSpanSnapshot(api as unknown as IApi) : null,
      today: new Date(),
    });
  });

  /**
   * The chart span lives in SVAR state, which Svelte cannot track, so every
   * way it can move has to announce itself: zoom, a scroll that extends an
   * auto-scaled range, and a container resize (which also changes the pixel
   * width the label-proximity grouping is measured in).
   *
   * Scroll fires per frame, so the tick is gated on the span actually having
   * changed — otherwise the overlay would re-derive on every scrolled pixel.
   */
  let lastSpanKey = '';
  function refreshMarkerGeometry(): void {
    if (!api) return;
    const span = chartSpanSnapshot(api as unknown as IApi);
    const key = span
      ? `${span.start.getTime()}|${span.end.getTime()}|${span.widthPx}`
      : 'none';
    if (key === lastSpanKey) return;
    lastSpanKey = key;
    markerTick += 1;
  }

  function wireMarkerRecompute(ganttApi: GanttAPI): void {
    if (typeof ganttApi?.on !== 'function') return;
    const wiredHostGeneration = hostGeneration;
    for (const event of ['zoom-scale', 'scroll-chart', 'resize-chart']) {
      ganttApi.on(event, () => {
        if (hostGeneration !== wiredHostGeneration) return;
        refreshMarkerGeometry();
        if (event !== 'resize-chart') captureViewportDelivery(event, wiredHostGeneration);
      });
    }
  }

  /** Host the overlay inside SVAR's own content area so it scrolls with it. */
  function hostInChartArea(node: Element): (() => void) | undefined {
    const area = rootEl?.querySelector('.wx-area');
    if (!area || node.parentElement === area) return undefined;
    const origin = node.parentElement;
    area.appendChild(node);
    return () => {
      if (origin && node.parentElement === area) origin.appendChild(node);
    };
  }
  const taskNotesPresent = $derived($data.taskNotesPresent);
  // Toolbar visibility is store-driven (FIX A): reading it from the reactive
  // data — like showDateIndicators — makes the `tngantt_showToolbar` option a
  // LIVE toggle (show/hide without a remount). Default off (R6) is preserved by
  // register.getShowToolbar()'s `=== true` default-false read.
  const showToolbar = $derived($data.showToolbar ?? false);

  // The legend is presentation-only: every opening copies the latest Appearance
  // default into local session state, while live Right/Bottom moves stay local.
  // The catalogue consumes the same effective values already driving the chart.
  let legendSession = $state<LegendSessionState>(CLOSED_LEGEND_SESSION);
  let legendTriggerEl: HTMLButtonElement | undefined = $state();
  let chartHostEl: HTMLElement | undefined = $state();
  let chartHostWidth = $state(0);
  let chartHostHeight = $state(0);
  let legendEscapeScope: Scope | undefined;
  const legendGroups = $derived($data.legendContext ? buildLegendCatalog($data.legendContext) : []);
  const legendLayout = $derived(
    legendSession.open
      ? resolveLegendLayout({
          position: legendSession.position,
          width: chartHostWidth,
          height: chartHostHeight,
        })
      : null,
  );

  $effect(() => {
    if (!legendSession.open) return;
    const host = chartHostEl;
    if (!host) return;
    const measure = (): void => {
      const bounds = host.getBoundingClientRect();
      chartHostWidth = bounds.width;
      chartHostHeight = bounds.height;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  });

  function openLegend(): void {
    captureLifecycle('legend-handler-delivered', {
      requestedPosition: $data.defaultLegendPosition,
      wasOpen: legendSession.open,
    });
    legendSession = reduceLegendSession(legendSession, {
      type: 'open',
      defaultPosition: $data.defaultLegendPosition,
    });
    activateLegendEscapeScope();
    captureLifecycleAfterTick('legend-rendered', () => ({
        legendOpen: legendSession.open,
        layout: legendLayout,
        rendered: !!rootEl?.querySelector('.og-gantt-legend'),
      }));
  }

  function moveLegend(position: LegendPosition): void {
    legendSession = reduceLegendSession(legendSession, { type: 'move', position });
  }

  async function closeLegend(options: { restoreFocus?: boolean } = {}): Promise<void> {
    if (!legendSession.open) return;
    deactivateLegendEscapeScope();
    legendSession = reduceLegendSession(legendSession, { type: 'close' });
    const captureGeneration = currentGanttLifecycleCaptureGeneration();
    const capturePhase = currentGanttLifecyclePhase();
    await tick();
    if (!destroyed && captureGeneration !== null && capturePhase !== null &&
      currentGanttLifecycleCaptureGeneration() === captureGeneration) {
      try {
        captureLifecycle('legend-closed', {
          rendered: !!rootEl?.querySelector('.og-gantt-legend'),
        }, capturePhase);
      } catch {
        // Diagnostics must never change product control flow.
      }
    }
    if (options.restoreFocus !== false && !document.querySelector(OBSIDIAN_OVERLAY_SELECTOR)) {
      legendTriggerEl?.focus();
    }
  }

  function deactivateLegendEscapeScope(): void {
    if (legendEscapeScope) app.keymap.popScope(legendEscapeScope);
    legendEscapeScope = undefined;
  }

  function activateLegendEscapeScope(): void {
    deactivateLegendEscapeScope();
    const scope = new Scope(app.scope);
    scope.register([], 'Escape', (event) => {
      if (document.querySelector(OBSIDIAN_OVERLAY_SELECTOR)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void closeLegend();
      return false;
    });
    app.keymap.pushScope(scope);
    legendEscapeScope = scope;
  }

  // External-calendar fetching indicator, store-driven like showToolbar so the
  // transient loading state appears/clears live without a remount.
  const externalEventsLoading = $derived($data.externalEventsLoading ?? false);

  // "Highlight weekends", store-driven like showToolbar so the toggle is LIVE.
  // Only the og-weekends-off root class reacts — the highlightTime seed prop
  // stays fixed (SVAR reads it into store state at init; swapping it would
  // re-init and drop zoom/scroll).
  const highlightWeekends = $derived($data.highlightWeekends ?? true);

  // "Hide top-level subtasks" (#161), store-driven like showToolbar. Applied as a
  // SVAR filter-tasks DISPLAY filter (see the effect below), NOT by changing the
  // task set — so toggling it (or Bases oscillating the persisted value) hides/
  // shows the duplicate root rows cheaply, scroll-stable, and can never churn.
  const hideTopLevel = $derived($data.hideTopLevelSubtasks ?? false);

  // "Show tasks with no dates / only one date" (#161), store-driven like hideTopLevel.
  // Applied in the SAME composed filter-tasks DISPLAY filter (see applyDisplayFilters),
  // never by re-derivation — so toggling them (or Bases oscillating the persisted
  // value) hides/shows rows cheaply, scroll-stable, and can never churn the chart.
  const showUndated = $derived($data.showUndatedTasks ?? true);
  const showPartial = $derived($data.showPartialDateTasks ?? true);

  // Heads-up when a date filter is OFF but incomplete-date PARENTS (undated or
  // partial-date) stay visible because a dated descendant keeps them (SVAR filterTree
  // semantics, KTD4/R8). Contextual: only present when it actually happens, so
  // there's no standing noise.
  const retainedAncestorNotice = $derived(
    buildRetainedAncestorNotice($data.instances, { hideTopLevel, showUndated, showPartial }),
  );

  // Per-view max-height cap (plan 003 R1), store-driven like showToolbar so the
  // option re-fits the host live without a remount. Default 400 (R1).
  const maxHeight = $derived($data.maxHeight ?? DEFAULT_MAX_HEIGHT);
  // Per-view min-height floor; clamped to the absolute ~2-row floor in the reader.
  const minHeight = $derived($data.minHeight ?? GANTT_MIN_HEIGHT);

  // Show-all context-bar opacity (U6). Reactive so the slider re-tints bars live.
  // Applied below as a CSS custom property the `.og-context` rule reads (driving
  // a dynamic value through a class-only stylesheet isn't possible otherwise).
  const contextOpacity = $derived($data.contextOpacity ?? DEFAULT_CONTEXT_OPACITY);

  // Collapse-all / expand-all (U7). Collapsible ids = instance ids referenced as
  // a parent by some row. The floating toggle collapses all when any is open,
  // otherwise expands all. `allCollapsed` drives the button's icon/label.
  const parentInstanceIds = $derived.by(() => {
    const ids = new Set<string>();
    for (const inst of $data.instances) if (inst.parent) ids.add(inst.parent);
    return ids;
  });
  const allCollapsed = $derived(
    parentInstanceIds.size > 0 && [...parentInstanceIds].every((id) => collapsedIds.has(id)),
  );

  function toggleAllCollapse(): void {
    const next = toggleCollapseAll(parentInstanceIds, collapsedIds);
    if (!api) {
      collapsedIds = next;
      return;
    }
    // Set `syncing` BEFORE mutating collapsedIds: the sync $effect tracks
    // collapsedIds (via toInputs), so the write schedules it — raising the guard
    // first ensures any resulting diff treats our open-task execs as echoes.
    // Apply live via SVAR's own open-task action (tagged so the open-task
    // intercept skips re-persisting). The reactive seed/diff keeps `open`
    // consistent on any later reseed; this just reflects the change immediately.
    syncing = true;
    collapsedIds = next;
    try {
      for (const id of parentInstanceIds) {
        const shouldClose = next.has(id);
        const task = api.getTask?.(id);
        const isOpen = task ? task.open !== false : true;
        if (shouldClose && isOpen) {
          api.exec('open-task', { id, mode: false, eventSource: OG_ECHO_SOURCE });
        } else if (!shouldClose && !isOpen) {
          api.exec('open-task', { id, mode: true, eventSource: OG_ECHO_SOURCE });
        }
      }
    } finally {
      syncing = false;
    }
  }

  // Tags our own programmatic store writes (sibling mirror, revert) so the update-task
  // intercept ignores them and we never re-persist an echo (the SVAR-store echo guard — KTD "two echo loops").
  const OG_ECHO_SOURCE = 'og-self';
  // A write still unsettled after this window raises ONE slow-save Notice per SOURCE, cleared when that source's own write settles (silent once destroyed) — it never releases the write.
  const MUTATION_TIMEOUT_MS = 10000;
  const slowSaveNoticed = new Set<string>();
  const notifySlowSaveOnce = (write: PlannedWrite) => { if (destroyed || slowSaveNoticed.has(write.sourcePath)) return; slowSaveNoticed.add(write.sourcePath); new Notice('Saving is taking longer than expected — the change will apply when it finishes.'); };

  // Generated stylesheet applying the per-view treatment: the Fill channel paints
  // the bar body and the Strip channel the left accent, independently (or the
  // theme/default role rules), scoped under .og-bases-gantt. Injected via a managed
  // style element (see the $effect below) — a literal style tag in markup would be
  // compiled away as component CSS and cannot carry this dynamic content. Reactive
  // on the two sources and palettes so the options re-color live without a remount.
  const treatmentStyleCss = $derived(
    buildTreatmentStyle({
      scope: `.${treatmentScopeClass}`,
      fillSource: barFillSource,
      stripSource: barStripSource,
      palettes: {
        status: statusColors,
        priority: priorityColors,
        calendar: $data.calendarPalette ?? [],
      },
    }),
  );

  // The view root, used to host the generated treatment stylesheet.
  let rootEl: HTMLElement | undefined = $state();
  $effect(() => {
    const css = treatmentStyleCss;
    if (!rootEl) return;
    let styleEl = rootEl.querySelector('style[data-og-treatment]') as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.setAttribute('data-og-treatment', '');
      rootEl.appendChild(styleEl);
    }
    styleEl.textContent = css;
  });

  // The calendar-shading stylesheet (same managed-element pattern as the
  // treatment sheet above): the per-date identity classes are static in the
  // DOM, so re-assigning this text is the entire live re-shade path.
  $effect(() => {
    const css = $data.calendarShadingCss ?? '';
    if (!rootEl) return;
    let styleEl = rootEl.querySelector('style[data-og-calendar]') as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.setAttribute('data-og-calendar', '');
      rootEl.appendChild(styleEl);
    }
    if (styleEl.textContent !== css) styleEl.textContent = css;
  });

  // Drive the Show-all context-bar opacity (U6) as a CSS custom property on the
  // view root; the `.og-context` rule reads `var(--og-context-opacity)`. Reactive
  // on the slider value so it re-tints live (rootEl is bound by the time this runs).
  $effect(() => {
    rootEl?.style.setProperty('--og-context-opacity', String(contextOpacity));
  });

  // Native interaction listeners on the chart root (U2): capture the last
  // pointer's ctrl/meta (show-editor carries none), and route a right-click on a
  // bar to the native TaskNotes task menu. Bars carry `data-id` (the instance
  // id); we map it to the source path and invoke onBarContextMenu.
  //
  // A native dblclick listener is also registered here so that double-click →
  // open-note works even when SVAR is in readonly mode (readonly blocks SVAR's
  // own ondblclick → show-editor path). We fire api.exec("show-editor") directly;
  // our show-editor intercept (below) catches it and routes to activateBar (R5).
  $effect(() => {
    const el = rootEl;
    if (!el) return;
    const onPointerDown = (e: MouseEvent) => {
      lastCtrlMeta = e.ctrlKey || e.metaKey;
      // A held mouse button marks a possible drag in flight. SVAR's reorder
      // gesture collapses a parent (startReorder -> open-task) mid-drag, while
      // the deliberate toggles fire open-task with the button already up: a
      // chevron click on `click` (after mouseup) and the keyboard hotkey with no
      // pointer at all. So the open-task intercept vetoes only while this is set.
      pointerButtonDown = true;
      // Piece-level click routing on recurring rows: remember which occupancy
      // piece (if any) this pointer went down on, paired with its bar's id so a
      // later activation of a DIFFERENT row can never borrow it. Captured here
      // because the activation paths (select-task / show-editor intercepts)
      // carry no DOM target. Only the PRIMARY button arms it — a right/middle
      // press opens a menu, not a piece activation — and every press elsewhere
      // (or with a non-primary button) clears it.
      const piece =
        e.button === 0 && e.target instanceof Element
          ? e.target.closest('[data-og-activate-path]')
          : null;
      const rawBarId = piece?.closest('[data-id]')?.getAttribute('data-id') ?? null;
      const activatePath = piece?.getAttribute('data-og-activate-path') ?? null;
      lastPieceActivation =
        rawBarId !== null && activatePath !== null
          ? // SVAR 2.6+ encodes string ids with a leading ":" (setID); strip it.
            { barId: rawBarId.startsWith(':') ? rawBarId.slice(1) : rawBarId, path: activatePath }
          : null;
    };
    const onPointerUp = () => {
      pointerButtonDown = false;
    };
    const onDblClick = (e: MouseEvent) => {
      // When SVAR is NOT in readonly mode its own ondblclick handler fires
      // show-editor; our show-editor intercept (below) catches that. Only
      // supplement with a native exec when SVAR's path is blocked by readonly —
      // prevents a double-fire (and double open-note) in write-capable mode.
      if (!svarReadonly) return;
      const target = e.target as HTMLElement | null;
      const barEl = target?.closest?.('[data-id]') as HTMLElement | null;
      const rawId = barEl?.getAttribute('data-id');
      if (!rawId) return;
      // SVAR 2.6+ encodes string ids with a leading ":" (setID); strip it.
      const id = rawId.startsWith(':') ? rawId.slice(1) : rawId;
      // Fire show-editor so our intercept catches it (R5). Returning false from
      // the intercept prevents SVAR's own inline editor from opening.
      api?.exec('show-editor', { id });
    };
    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      // Both chart bars and grid rows carry the task id as `data-id` (SVAR's
      // locateID convention), so match the nearest element with one — this
      // covers right-click on the grid rows, not just the bars.
      const el = target?.closest?.('[data-id]') as HTMLElement | null;
      const rawId = el?.getAttribute('data-id');
      if (!rawId) return;
      // SVAR 2.6+ encodes string ids in the DOM with a leading ":" (setID);
      // strip it to recover our raw instance id. No-op for un-prefixed ids.
      const id = rawId.startsWith(':') ? rawId.slice(1) : rawId;
      const path = idToSourcePath.get(id);
      // Only act on a known task row; unknown ids / empty space / header /
      // calendar-item event rows fall through to the default menu (an event
      // row's sourcePath is a synthetic id no task menu could act on).
      if (!path || !onBarContextMenu || !allowsTaskContextMenu(path)) return;
      // Suppress Obsidian's default editor context menu (the grid renders inside
      // editor content) and show the native TaskNotes task menu instead.
      e.preventDefault();
      e.stopPropagation();
      onBarContextMenu(path, e);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      // A keyboard activation (Enter → show-editor) acts on the SELECTED ROW,
      // never a pointer-targeted occupancy piece. Clear the pointer's piece
      // binding on any real keypress so it can never leak into a keyboard action
      // — captured on window, before SVAR's own key handler runs. A bare
      // modifier (Ctrl held for a ctrl+click) must NOT clear it, or it would
      // wipe the binding the modified pointer-click is about to use.
      if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta') {
        return;
      }
      lastPieceActivation = null;
    };
    el.addEventListener('mousedown', onPointerDown, true);
    // Reset on window so a drag that ends off the grid still clears the flag.
    window.addEventListener('mouseup', onPointerUp, true);
    window.addEventListener('keydown', onKeyDown, true);
    el.addEventListener('dblclick', onDblClick, true);
    el.addEventListener('contextmenu', onContextMenu, true);
    return () => {
      el.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('mouseup', onPointerUp, true);
      window.removeEventListener('keydown', onKeyDown, true);
      el.removeEventListener('dblclick', onDblClick, true);
      el.removeEventListener('contextmenu', onContextMenu, true);
    };
  });

  // Read-only is the absence of write capability (R5). Used to gate the
  // remaining surface SVAR's own `readonly` does not cover (drag/resize persist).
  const readOnly = $derived(!capabilities.write);

  // Read-only banner copy (U7 Design/UX spec). Distinguishes "install TaskNotes"
  // from "TaskNotes write access unavailable" when we can tell them apart.
  const readOnlyBannerText = $derived(
    taskNotesPresent
      ? 'Read-only — TaskNotes write access unavailable'
      : 'Read-only — install TaskNotes to edit'
  );

  // ── SVAR store seeding + targeted diff-sync (Bug B) ─────────────────────────
  // SVAR re-initialises its store whenever the `tasks` / `links` / `taskTypes` /
  // `zoom` props change reference, disturbing viewport state and making
  // selection behavior path-dependent. Plain refreshes therefore use targeted
  // `api.exec` actions. Only explicit column, bulk, and theme reseeds replace
  // the seed arrays; `svarReadonly` remains fixed for the mount.

  /** Project the dynamic render data into the pure SVAR-task builder inputs. */
  function toInputs(d: GanttData): SvarTaskInputs {
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
      // the count (#161). Toggling this re-runs buildSvarTasks via the $data → sync
      // path and diffs update-only, so the hatch flips live without churning.
      hideTopLevelSubtasks: d.hideTopLevelSubtasks ?? false,
      propertyValues: d.propertyValues,
      cellRenders: d.cellRenders,
      managedPaths: d.managedPaths,
      hiddenSources: sourceSwitcher?.hiddenSources(),
      // The live collapsed set (U7) — read here so the seed, the id-keyed diff,
      // and any reseed all compute `open` from the same source of truth.
      collapsedIds,
    };
  }

  const initialData = get(data);
  // Weekend shading (availability seam): the weekend set resolves ONCE at mount
  // from the assembly pass's display-locale snapshot — session-constant, the
  // same rationale as the grid date-locale context below. The closure handed to
  // <Gantt> is STABLE; the toggle gates visibility via CSS, never this prop.
  // The day/hour unit gate lives in calendarCellClass: SVAR's own min-unit
  // gate covers only the chart body, while the time-scale header calls this for
  // every cell at every zoom. The closure stamps the weekend class plus STATIC
  // per-date identity classes; what the identity classes mean (which dates are
  // calendar-shaded) lives entirely in the injected calendar stylesheet, which
  // regenerates per refresh — shading stays live with zero SVAR repaints.
  const weekendAvailability = buildAvailability([
    localeWeekendSource(resolveWeekendDays(initialData.dateLocale)),
  ]);
  const svarHighlightTime = (date: Date, unit: string): string =>
    calendarCellClass(date, unit, weekendAvailability);
  // The assembly pass's display-locale snapshot, handed to grid cells for their
  // fallback formatting (SVAR can't pass cell props). Context is init-time by
  // design: the locale is session-constant (the Intl default can't change
  // without an app restart).
  setContext(GRID_DATE_LOCALE_CONTEXT_KEY, initialData.dateLocale);
  // Collapsed instance ids (U7) — EPHEMERAL session state, not persisted. Drives
  // the collapse-all toggle's icon/decision and seeds SVAR's `open` via toInputs
  // so a collapse survives data refreshes/reseeds within the session. Starts
  // empty (all expanded) on every mount; the user re-adjusts with the toggle or
  // the row chevrons. Updated by the `open-task` intercept and toggleAllCollapse.
  let collapsedIds: Set<string> = $state(new Set());
  // Active ephemeral column sort (plan 2026-06-22-002) — EPHEMERAL session state,
  // not persisted. `null` = the Base toolbar sort is in effect (the default).
  // A non-null value means the user clicked a column header to override it; the
  // floating reset pill (U3) and the asc→desc→clear cycle (U2) drive it back to
  // null. Recorded by the `sort-tasks` interceptor below.
  let ephemeralSort: EphemeralSort | null = $state(null);
  // The mount-time editor-attach set, used for the seed's flat-key alignment
  // and the applied-attach baseline before the $derived live sets exist.
  const initialEditorColumnIds = editorAttachedColumnIds(
    initialData.gridColumns,
    shippedEditorKinds(initialData.cellEditors),
  );
  // The same canonical objects seed both SVAR and the applied-state baseline.
  const initialSeed = createGanttSeedSnapshot({
    tasks: buildSvarTasks(toInputs(initialData)),
    links: initialData.links,
    cellEditColumnIds: initialEditorColumnIds,
  });
  // Seed props handed to `<Gantt>`. Explicit column, bulk, and theme reseeds
  // intentionally replace them and re-init the SVAR store; a plain data refresh
  // leaves them untouched and flows through the targeted diff-sync below.
  let initialTasks: SvarTask[] = $state(initialSeed.tasks);
  let initialLinks: RenderLink[] = $state(initialSeed.links);
  // SVAR's own `readonly` is fixed at mount: capability is resolved once when the
  // controller selects its source and does not change for the view's lifetime.
  // The reactive `readOnly` above still drives the banner and the persist gate.
  const svarReadonly = !initialData.capabilities.write;
  // Persisted divider width (plan 002 U3). The `gridWidth` prop alone is NOT
  // enough to restore it: SVAR's gantt-store has a recompute action
  // (in:["displayMode","columns"]) that, when every column has a fixed width,
  // forces gridWidth = sum(column widths) — clobbering the seeded prop right
  // after mount. So we seed the prop AND re-assert via api.exec("resize-grid")
  // once the column recompute has settled (see applyPersistedGridWidth). That
  // recompute only fires on column changes (mount + a column-config reseed),
  // never on a plain task refresh, so a re-assert sticks. In-session dragging is
  // SVAR's own Resizer; we capture it to persist (see wireGridWidthPersistence).
  const initialGridWidth: number | undefined = initialData.gridWidth;
  // The last width we know about (mount-persisted, then updated on each drag) —
  // what we re-assert after a column recompute.
  let lastGridWidth: number | undefined = initialGridWidth;
  // The effective width last applied to SVAR, tracked so a settings-panel edit
  // of "Table width (px)" (which changes only `d.gridWidth` — tasks/columns
  // unchanged, so syncToGantt takes the content-NOOP path) still re-asserts the
  // new width live instead of waiting for a resize/reseed/remount.
  let appliedGridWidth: number | undefined = initialGridWidth;

  // Registered custom task-type superset (date-status flag + every color-treatment
  // class), derived from BOTH palettes (status + priority) plus the og-parent theme
  // role — not the present tasks or the active source. FIXED at mount and never
  // reassigned: changing any prop SVAR reads re-inits its store (reverting our
  // incremental updates to the seed), so this stays a const. Registering both
  // palettes lets the color-source option switch live (status↔priority↔theme)
  // without re-registering; a palette *content* change needs a reopen — rare.
  const treatmentTaskTypes = buildTreatmentTaskTypes({
    status: initialData.statusColors ?? [],
    priority: initialData.priorityColors ?? [],
    // Whole-vault calendars, so switching the display selection (or the colour
    // source itself) never needs a re-register. A calendar note CREATED while
    // the view is open is not in this set, so its bars stay on the default
    // treatment until reopen — the same reopen-to-pick-up rule the status and
    // priority palettes carry.
    calendar: initialData.calendarPalette ?? [],
  });
  const svarTaskTypes = [
    ...defaultTaskTypes,
    ...treatmentTaskTypes,
    // Instance cues (U6) cross the date-status/treatment combos, so a bar can
    // carry both a treatment class and a replicated/context cue and still match a
    // registered whole `type` string.
    ...buildInstanceCueTaskTypes(treatmentTaskTypes.map((t) => t.id)),
  ];

  // Last-applied SVAR state, diffed against each incoming GanttData. Seeded from
  // the initial render so the first diff after mount is a no-op.
  const appliedSyncState: AppliedGanttSyncState = createAppliedGanttSyncState(
    initialSeed,
    // Last-applied Base toolbar sort descriptor. While an ephemeral column sort
    // is active, this distinguishes a Base re-sort from a plain data refresh.
    baseSortDescriptor(config?.getSort?.()),
  );

  // True only while we push our own programmatic actions into SVAR, so the
  // update-task persist intercept ignores any echo they trigger (the OG_ECHO_SOURCE
  // tag covers our own writes; this also covers SVAR-internal echoes such as
  // summary-date recomputation fired during an add/move).
  let syncing = false;

  // The switcher's hidden-source set lives OUTSIDE Svelte state (a per-view
  // session object owned by the host), so a revision counter bridges its change
  // notifications into both task shaping and the display-filter effect.
  let switcherRevision = $state(0);
  $effect(() =>
    sourceSwitcher?.subscribe(() => {
      switcherRevision += 1;
    }),
  );

  // Apply each store or switcher update as the minimal set of SVAR actions instead of
  // replacing the tasks array — so zoom and scroll survive writes, drags,
  // external TaskNotes edits, and Bases filter changes. A recurring-source
  // switch reshapes only its occupancy geometry; the stable instance set is
  // unchanged. Re-runs on every `store.set` (register.ts) and once `api` is ready.
  $effect(() => {
    const d = $data; // reactive dependency: re-run on every store update
    void switcherRevision; // re-shape recurring geometry when its source is hidden/shown
    if (!api) return;
    syncToGantt(d);
  });

  /**
   * Apply ALL row-visibility concerns (Hide-top ∧ Show-undated ∧ Show-partial ∧
   * switcher-hidden sources) as ONE composed SVAR `filter-tasks` DISPLAY filter
   * over the stable task array (#161). The shared {@link shouldHideRow}
   * predicate reads each row's `custom` (`isTopLevelPlacement` + `dateStatus` +
   * the source identity). `filter-tasks` recomputes SVAR's visible set WITHOUT
   * touching the `tasks` array (no add/delete diff) and preserves scroll/zoom —
   * so a toggle (or a Bases config oscillation) is cheap and can never churn
   * the chart. When every option is show-everything, clear with no predicate.
   * `open: false` so it never force-expands collapsed branches.
   *
   * The predicate is ALWAYS passed as `filter` (a function), never as a
   * `{key, value}` column filter — keeping the clear-path semantics intact (KTD4).
   */
  function applyDisplayFilters(): void {
    if (!api?.exec) return;
    const flags = {
      hideTopLevel,
      showUndated,
      showPartial,
      hiddenSources: sourceSwitcher?.hiddenSources(),
    };
    if (anyRowFilterActive(flags)) {
      api.exec('filter-tasks', {
        filter: (t: {
          custom?: { isTopLevelPlacement?: boolean; dateStatus?: DateStatus } & SwitcherRowSource;
        }) =>
          !shouldHideRow(
            {
              isTopLevelPlacement: !!t?.custom?.isTopLevelPlacement,
              dateStatus: t?.custom?.dateStatus ?? 'complete',
              source: {
                calendarItemFamily: t?.custom?.calendarItemFamily,
                hasRecurringOccupancy: t?.custom?.hasRecurringOccupancy,
              },
            },
            flags,
          ),
        open: false,
      });
    } else {
      api.exec('filter-tasks', { open: false });
    }
  }

  // Dedicated effect: re-applies the composed filter on ANY row-visibility toggle,
  // any switcher change, AND after any data refresh (so newly-added rows are
  // filtered too). Created AFTER the sync effect so it runs after the diff lands.
  // A display-only change is a content-NOOP for the sync (the task set is
  // identical), so this is the path that actually toggles row visibility.
  $effect(() => {
    void $data; // re-run after every store update (post-sync)
    void hideTopLevel; // re-run when any row-visibility toggle flips
    void showUndated;
    void showPartial;
    void switcherRevision; // re-run when a source is hidden/shown in the switcher
    if (api) applyDisplayFilters();
  });

  function reseedColumnsIfNeeded(d: GanttData): boolean {
    const editorAttachKey = cellEditColumnIds.join('|');
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

  function applyChangedGridWidth(d: GanttData): void {
    if (d.gridWidth === appliedGridWidth) return;
    appliedGridWidth = d.gridWidth;
    applyPersistedGridWidth();
  }

  function planSyncFromData(d: GanttData): GanttSyncPlan {
    return planGanttSync({
      next: buildSvarTasks(toInputs(d)),
      links: d.links,
      applied: appliedSyncState,
      baseSortKey: baseSortDescriptor(config?.getSort?.()),
    });
  }

  function clearEphemeralSortForBaseChange(baseSortChanged: boolean): void {
    if (!ephemeralSort || !baseSortChanged) return;
    ephemeralSort = null;
    clearSvarSortArrow();
  }

  function applyBulkReseedIfNeeded(d: GanttData, plan: GanttSyncPlan): boolean {
    const { taskPlan, linkPlan } = plan;
    if (!shouldBulkReseed(taskPlan, linkPlan)) return false;

    dlog(
      `[OGDBG] sync BULK-RESEED ops=${structuralOpCount(taskPlan, linkPlan)}` +
        ` (adds=${taskPlan.adds.length} deletes=${taskPlan.deletes.length} moves=${taskPlan.moves.length} linkAdds=${linkPlan.adds.length} linkDeletes=${linkPlan.deletes.length})`,
    );
    syncing = true;
    try {
      // Clear a stale override first so the reseed cannot reassert it.
      clearEphemeralSortForBaseChange(plan.baseSortChanged);
      reseedSeedsFromData(d);
      applyPersistedGridWidth();
    } finally {
      syncing = false;
    }
    // SVAR clears its display filter during reinit, after Svelte's synchronous
    // data effect can run, so restore the filter after the reseed settles.
    setTimeout(() => applyDisplayFilters(), 0);
    return true;
  }

  function applyIncrementalSync(plan: GanttSyncPlan): void {
    const { taskPlan, linkPlan } = plan;
    dlog(
      `[OGDBG] sync DIFF moves=${taskPlan.moves.length} updates=${taskPlan.updates.length}` +
        ` adds=${taskPlan.adds.length} deletes=${taskPlan.deletes.length}` +
        ` linkAdds=${linkPlan.adds.length} linkDeletes=${linkPlan.deletes.length}` +
        ` orderChanged=${plan.orderKey !== appliedSyncState.orderKey} baseSortChanged=${plan.baseSortChanged}`,
    );

    const syncPort = createSvarGanttAdapter(api, {
      echoSource: OG_ECHO_SOURCE,
      cellEditColumnIds,
    });
    syncing = true;
    const tSyncStart = performance.now();
    let tAfterExec = tSyncStart;
    try {
      const { reorderMoves } = applyIncrementalGanttSync({
        plan,
        port: syncPort,
        state: appliedSyncState,
        ephemeralSort: {
          isActive: () => ephemeralSort !== null,
          reassert: reassertEphemeralSort,
          clear: () => {
            ephemeralSort = null;
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
      syncing = false;
    }
  }

  function syncToGantt(d: GanttData): void {
    if (reseedColumnsIfNeeded(d)) return;
    applyChangedGridWidth(d);

    const plan = planSyncFromData(d);
    if (isGanttSyncNoop(plan, appliedSyncState)) {
      dlog('[OGDBG] sync NOOP');
      return;
    }
    if (applyBulkReseedIfNeeded(d, plan)) return;
    applyIncrementalSync(plan);
  }

  /**
   * Re-apply the active ephemeral column sort over SVAR's current rows (R8).
   * Echo-guarded (`OG_ECHO_SOURCE`) so it never re-enters the `sort-tasks`
   * recording interceptor (U2). A no-op when no ephemeral sort is active or the
   * api isn't ready. Called from the data-only sync branch (synchronously, inside
   * the `syncing` block) and, deferred a tick, after a reseed remount (see
   * `reseedSeedsFromData`).
   */
  function reassertEphemeralSort(): void {
    if (!ephemeralSort || !api?.exec) return;
    api.exec('sort-tasks', {
      key: ephemeralSort.column,
      order: ephemeralSort.direction,
      eventSource: OG_ECHO_SOURCE,
    });
  }

  /**
   * Clear SVAR's lit column-header sort arrow by nulling its internal `_sort`
   * state. There is no `sort-tasks` payload that resets `_sort` to null (verified
   * vs `@svar-ui/gantt-store` 2.7.0), so reach the data store directly — the same
   * internal-but-reachable class as the gridWidth recompute workaround. Centralised
   * here so a SVAR upgrade that renames `_sort`/`setState` has a single site to fix.
   */
  function clearSvarSortArrow(): void {
    api?.getStores?.().data?.setState?.({ _sort: null });
  }

  /**
   * Restore the Base row order after an ephemeral sort is cleared (plan
   * 2026-06-22-002, U2 third click + U3 reset button). SVAR's `tree.sort` mutated
   * the row order in place, so this resets `_sort` (drops the lit header arrow)
   * then replays the Base-order `move-task` steps so the rows return to the Base
   * order. Echo-guarded + `syncing`-wrapped so the moves don't re-enter our
   * interceptors. Does NOT touch `ephemeralSort` — the caller sets it null first
   * (so the reset pill hides immediately).
   */
  function restoreBaseOrder(): void {
    if (!api?.exec) return;
    syncing = true;
    try {
      clearSvarSortArrow();
      const next = buildSvarTasks(toInputs(get(data)));
      for (const m of planReorder(next)) {
        api.exec('move-task', { id: m.id, target: m.after, mode: 'after', eventSource: OG_ECHO_SOURCE });
      }
      appliedSyncState.orderKey = ganttOrderFingerprint(next);
    } catch {
      /* a move-task threw mid-restore (e.g. store torn down); the stale
         applied order key forces the next sync to replay the full reorder */
    } finally {
      syncing = false;
    }
  }

  /**
   * Shared clear path for the floating reset pill (U3): drop the ephemeral sort
   * and restore the Base order. The third-click cancel (U2) clears inline instead
   * (it must return falsy to cancel SVAR's toggle), but funnels into the same
   * `restoreBaseOrder`.
   */
  function clearEphemeralSort(): void {
    ephemeralSort = null;
    restoreBaseOrder();
  }

  /**
   * Reseed the SVAR `columns`/`tasks`/`links` props from the current data on a
   * column-config change, and resync the applied maps so the next incremental
   * diff is a no-op. Reassigning these `$state` seeds re-inits SVAR's store once
   * (the only correct way to change the column set).
   */
  function reseedForColumnChange(d: GanttData): void {
    appliedColumnsKey = d.gridColumnsKey;
    columns = buildSvarColumns(d.gridColumns);

    reseedSeedsFromData(d);

    // The re-init triggers the column recompute (gridWidth → column-sum); re-
    // assert the user's persisted divider width afterward so a column-config
    // change doesn't silently reset it.
    applyPersistedGridWidth();
  }

  /**
   * Refresh the `<Gantt>` seed props (tasks/links) from the current data and
   * resync the applied-state maps so the next incremental diff is a no-op.
   * Shared by the column-config reseed and the theme-flip reseed: a theme flip
   * remounts the <Gantt> (the {#if effectiveIsDark} swap), which re-reads these
   * seeds — without this the post-flip chart would show the stale mount-time
   * seed instead of the current data.
   */
  function reseedSeedsFromData(d: GanttData): void {
    const seed = createGanttSeedSnapshot({
      tasks: buildSvarTasks(toInputs(d)),
      links: d.links,
      cellEditColumnIds,
    });
    initialTasks = seed.tasks;
    initialLinks = seed.links;
    replaceAppliedGanttData(appliedSyncState, seed);
    // The reseed re-inits SVAR from `tasks` (already in Base order), so the
    // applied order key tracks it — the next diff won't re-issue reorder moves.
    // Re-baseline the Base sort descriptor too (symmetry with the order key): a
    // reseed coinciding with a toolbar-sort change must not leave the next sync
    // comparing against a stale descriptor.
    appliedSyncState.baseSortKey = baseSortDescriptor(config?.getSort?.());

    // A reseed re-inits the store in Base order and wipes SVAR's `_sort`. If an
    // ephemeral column sort is active (plan 2026-06-22-002, R8), re-apply it once
    // the store's column recompute settles — deferred a tick like
    // applyPersistedGridWidth, since a theme-flip reseed remounts <Gantt> (fresh
    // api/store). Echo-guarded inside reassertEphemeralSort.
    if (ephemeralSort) {
      setTimeout(() => {
        if (!ephemeralSort) return;
        syncing = true;
        try {
          reassertEphemeralSort();
        } catch {
          /* exec threw on a torn-down / freshly-remounted store — skip */
        } finally {
          syncing = false;
        }
      }, 0);
    }
  }

  // The slice of SVAR's `update-task` event payload the drag/resize persistence
  // path reads. `inProgress` marks mid-gesture frames; `eventSource` carries our
  // own echo tag on programmatic writes.
  // SVAR Gantt API - using unknown with type assertions for third-party API
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type GanttAPI = any;

  let api: GanttAPI = $state();

  // SVAR suppresses every tooltip on hardware reporting any touch points —
  // which includes a touchscreen laptop whose reader is hovering with a mouse.
  // A tooltip is a hover affordance, so it is enabled exactly where hovering is
  // possible; a touch-only device keeps the library's suppression. Tracked
  // live, so docking or undocking a convertible flips it without a remount.
  const hoverCapableQuery = window.matchMedia('(any-hover: hover)');
  let tooltipHoverCapable = $state(hoverCapableQuery.matches);
  $effect(() => {
    const follow = (ev: MediaQueryListEvent): void => {
      tooltipHoverCapable = ev.matches;
    };
    hoverCapableQuery.addEventListener('change', follow);
    return () => hoverCapableQuery.removeEventListener('change', follow);
  });

  // Bumped when the SVAR api re-binds (initGantt) and on teardown. The executor
  // treats a bump alone as a REMOUNT (post-persist data work continues), so
  // teardown also sets `destroyed` — `api` stays assigned, alive-looking.
  let hostGeneration = 0;
  let destroyed = false;

  interface DiagnosticVisibleArea {
    from?: unknown;
    to?: unknown;
    start?: unknown;
    end?: unknown;
  }

  interface DiagnosticScaleCell {
    start?: unknown;
    value?: unknown;
  }

  interface DiagnosticScales {
    start?: unknown;
    end?: unknown;
    lengthUnit?: unknown;
    minUnit?: unknown;
    lengthUnitWidth?: unknown;
    width?: unknown;
    rows?: Array<{ cells?: DiagnosticScaleCell[] }>;
    diff?: (end: Date, start: Date, lengthUnit?: string) => number;
  }

  interface DiagnosticSvarState {
    scrollLeft?: unknown;
    xArea?: DiagnosticVisibleArea;
    _scales?: DiagnosticScales;
    selected?: unknown;
  }

  function finiteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  function dateMillis(value: unknown): number | null {
    return value instanceof Date && Number.isFinite(value.getTime()) ? value.getTime() : null;
  }

  function captureLifecycle(
    event: string,
    facts?: GanttLifecycleFacts,
    phase?: string,
    svarGeneration: number = hostGeneration,
  ): void {
    if (!isGanttLifecycleCaptureActive()) return;
    const generation = controllerGeneration?.() ?? null;
    captureGanttLifecycle({
      scope: treatmentScopeClass,
      mountToken,
      controllerStarted: generation?.started ?? null,
      controllerDelivered: generation?.delivered ?? null,
      svarGeneration,
      event,
      phase,
      facts,
    });
  }

  function captureLifecycleAfterTick(event: string, readFacts: () => GanttLifecycleFacts): void {
    const captureGeneration = currentGanttLifecycleCaptureGeneration();
    const capturePhase = currentGanttLifecyclePhase();
    const captureHostGeneration = hostGeneration;
    if (captureGeneration === null || capturePhase === null) return;
    void (async () => {
      try {
        await tick();
        if (
          destroyed ||
          hostGeneration !== captureHostGeneration ||
          currentGanttLifecycleCaptureGeneration() !== captureGeneration
        ) return;
        captureLifecycle(event, readFacts(), capturePhase, captureHostGeneration);
      } catch {
        // Diagnostics must never change product control flow.
      }
    })();
  }

  function readViewportDiagnostics(): {
    observation: ViewportObservation;
    facts: GanttLifecycleFacts;
  } {
    try {
      const state = api?.getState?.() as DiagnosticSvarState | undefined;
      const xArea = state?.xArea;
      const scales = state?._scales;
      const chart = rootEl?.querySelector<HTMLElement>('.wx-chart') ?? null;
      const scaleRows = rootEl?.querySelectorAll<HTMLElement>('.wx-scale .wx-row');
      const renderedCell = scaleRows?.[scaleRows.length - 1]?.querySelector<HTMLElement>('.wx-cell') ?? null;
      const logicalCellIndex = finiteNumber(xArea?.start);
      const logicalCell = logicalCellIndex === null
        ? undefined
        : scales?.rows?.[scales.rows.length - 1]?.cells?.[logicalCellIndex];
      const renderedBounds = renderedCell?.getBoundingClientRect();
      const scalesStart = scales?.start instanceof Date ? scales.start : null;
      const scalesEnd = scales?.end instanceof Date ? scales.end : null;
      const lengthUnit = typeof scales?.lengthUnit === 'string' ? scales.lengthUnit : null;
      let scaleDiff: number | null = null;
      if (scalesStart && scalesEnd && lengthUnit && typeof scales?.diff === 'function') {
        scaleDiff = finiteNumber(scales.diff(scalesEnd, scalesStart, lengthUnit));
      }
      const storeScrollLeft = finiteNumber(state?.scrollLeft);
      const authoritativeScrollLeft = finiteNumber(xArea?.from);
      const domScrollLeft = finiteNumber(chart?.scrollLeft);
      const selected = Array.isArray(state?.selected) ? state.selected : [];
      const observation: ViewportObservation = {
        authoritativeScrollLeft,
        storeScrollLeft,
        domScrollLeft,
        xFrom: finiteNumber(xArea?.from),
        xTo: finiteNumber(xArea?.to),
        xStart: finiteNumber(xArea?.start),
        xEnd: finiteNumber(xArea?.end),
        scalesStart: dateMillis(scales?.start),
        scalesEnd: dateMillis(scales?.end),
        scalesLengthUnit: lengthUnit,
        scalesMinUnit: typeof scales?.minUnit === 'string' ? scales.minUnit : null,
        scalesLengthUnitWidth: finiteNumber(scales?.lengthUnitWidth),
        scalesWidth: finiteNumber(scales?.width),
        scalesDiff: scaleDiff,
        logicalScaleCellIndex: logicalCellIndex,
        logicalScaleCellValue: dateMillis(logicalCell?.start) ??
          (typeof logicalCell?.value === 'string' || typeof logicalCell?.value === 'number'
            ? logicalCell.value
            : null),
        renderedScaleCellIdentity: renderedCell?.dataset.id ?? renderedCell?.className.slice(0, 80) ?? null,
        renderedScaleCellLabel: renderedCell?.textContent?.trim().slice(0, 80) ?? null,
        renderedScaleCellLeft: finiteNumber(renderedBounds?.left),
        renderedScaleCellWidth: finiteNumber(renderedBounds?.width),
      };
      return {
        observation,
        facts: {
          ...observation,
          selectedCount: selected.length,
          selectedFirst: typeof selected[0] === 'string' || typeof selected[0] === 'number'
            ? String(selected[0])
            : null,
        },
      };
    } catch {
      return {
        observation: {
          authoritativeScrollLeft: null,
          storeScrollLeft: null,
          domScrollLeft: null,
          xFrom: null,
          xTo: null,
          xStart: null,
          xEnd: null,
          scalesStart: null,
          scalesEnd: null,
          scalesLengthUnit: null,
          scalesMinUnit: null,
          scalesLengthUnitWidth: null,
          scalesWidth: null,
          scalesDiff: null,
          logicalScaleCellIndex: null,
          logicalScaleCellValue: null,
          renderedScaleCellIdentity: null,
          renderedScaleCellLabel: null,
          renderedScaleCellLeft: null,
          renderedScaleCellWidth: null,
        },
        facts: { snapshotFailure: true },
      };
    }
  }

  interface ViewportSourceInvocation {
    generation: number;
    action: string;
    phase: string;
    hostGeneration: number;
    captureGeneration: number;
  }

  interface ViewportSourceMatch {
    source: ViewportSourceInvocation | null;
    stale: boolean;
  }

  let viewportGeneration = 0;
  let latestViewportDeliveryGeneration = 0;
  let viewportObservationPending = false;
  let latestViewportAction = '';
  let latestViewportPhase = '';
  let latestViewportHostGeneration = 0;
  let viewportDiagnosticsDisposed = false;
  let viewportObservationRerunRequested = false;
  let pendingViewportFrameHandle: number | null = null;
  let resolvePendingViewportFrame: ((value: ReturnType<typeof readViewportDiagnostics> | null) => void) | null = null;
  const pendingViewportSources = new Map<string, ViewportSourceInvocation>();
  const maxViewportSettlementFrames = 8;
  const maxPendingViewportSourceActions = 16;

  function captureUndeliveredViewportSource(
    source: ViewportSourceInvocation,
    facts: GanttLifecycleFacts,
  ): void {
    if (source.captureGeneration !== currentGanttLifecycleCaptureGeneration()) return;
    captureLifecycle('viewport-pending', {
      ...facts,
      action: source.action,
      viewportGeneration: source.generation,
      deliveryMissing: true,
    }, source.phase, source.hostGeneration);
  }

  function evictOldestPendingViewportSource(): void {
    if (pendingViewportSources.size <= maxPendingViewportSourceActions) return;
    let oldestAction: string | null = null;
    let oldestSource: ViewportSourceInvocation | null = null;
    for (const [action, source] of pendingViewportSources) {
      if (oldestSource === null || source.generation < oldestSource.generation) {
        oldestAction = action;
        oldestSource = source;
      }
    }
    if (oldestAction === null || oldestSource === null) return;
    pendingViewportSources.delete(oldestAction);
    captureUndeliveredViewportSource(oldestSource, { sourceEvicted: true });
  }

  function captureViewportSource(action: string, facts: GanttLifecycleFacts = {}): number | null {
    if (viewportDiagnosticsDisposed || !isGanttLifecycleCaptureActive()) return null;
    const phase = currentGanttLifecyclePhase();
    const captureGeneration = currentGanttLifecycleCaptureGeneration();
    if (phase === null || captureGeneration === null) return null;
    viewportGeneration += 1;
    const source: ViewportSourceInvocation = {
      generation: viewportGeneration,
      action,
      phase,
      hostGeneration,
      captureGeneration,
    };
    const previousSource = pendingViewportSources.get(action);
    if (previousSource) {
      captureUndeliveredViewportSource(previousSource, {
        supersededBySource: true,
        supersedingViewportGeneration: source.generation,
      });
    }
    pendingViewportSources.set(action, source);
    evictOldestPendingViewportSource();
    captureLifecycle('viewport-source-invoked', {
      ...facts,
      action,
      viewportGeneration: source.generation,
    }, source.phase, source.hostGeneration);
    return source.generation;
  }

  function takeViewportSource(
    action: string,
    originatingHostGeneration: number,
  ): ViewportSourceMatch {
    const source = pendingViewportSources.get(action);
    const captureGeneration = currentGanttLifecycleCaptureGeneration();
    if (!source || captureGeneration === null) return { source: null, stale: false };
    pendingViewportSources.delete(action);
    const matchesCurrentCapture = source.captureGeneration === captureGeneration &&
      source.hostGeneration === originatingHostGeneration;
    return {
      source: matchesCurrentCapture ? source : null,
      stale: !matchesCurrentCapture,
    };
  }

  function abortPendingViewportSources(facts: GanttLifecycleFacts): void {
    const captureGeneration = currentGanttLifecycleCaptureGeneration();
    for (const source of pendingViewportSources.values()) {
      if (source.captureGeneration !== captureGeneration) continue;
      captureLifecycle('viewport-pending', {
        ...facts,
        action: source.action,
        viewportGeneration: source.generation,
        deliveryMissing: true,
        observationAborted: true,
      }, source.phase, source.hostGeneration);
    }
    pendingViewportSources.clear();
  }

  function nextViewportFrame(): Promise<ReturnType<typeof readViewportDiagnostics> | null> {
    return new Promise((resolve) => {
      if (viewportDiagnosticsDisposed) {
        resolve(null);
        return;
      }
      resolvePendingViewportFrame = resolve;
      pendingViewportFrameHandle = requestAnimationFrame(() => {
        pendingViewportFrameHandle = null;
        resolvePendingViewportFrame = null;
        resolve(viewportDiagnosticsDisposed ? null : readViewportDiagnostics());
      });
    });
  }

  function cancelPendingViewportFrame(): void {
    if (pendingViewportFrameHandle !== null) {
      cancelAnimationFrame(pendingViewportFrameHandle);
      pendingViewportFrameHandle = null;
    }
    const resolve = resolvePendingViewportFrame;
    resolvePendingViewportFrame = null;
    resolve?.(null);
  }

  function canContinueViewportCapture(
    captureGeneration: number,
    originatingHostGeneration: number,
    viewportDeliveryGeneration: number,
    action: string,
    phase: string,
  ): boolean {
    if (viewportDiagnosticsDisposed ||
      currentGanttLifecycleCaptureGeneration() !== captureGeneration) return false;
    if (hostGeneration === originatingHostGeneration) return true;
    captureLifecycle('viewport-pending', {
      action,
      viewportGeneration: viewportDeliveryGeneration,
      observationAborted: true,
      hostGenerationChanged: true,
      currentHostGeneration: hostGeneration,
    }, phase, originatingHostGeneration);
    return false;
  }

  async function captureViewportSettlementGeneration(
    generation: number,
    captureGeneration: number,
    action: string,
    phase: string,
    originatingHostGeneration: number,
  ): Promise<void> {
    try {
      await tick();
      if (!canContinueViewportCapture(
        captureGeneration,
        originatingHostGeneration,
        generation,
        action,
        phase,
      )) return;
      captureLifecycle(
        'viewport-svelte-update',
        { action, viewportGeneration: generation },
        phase,
        originatingHostGeneration,
      );
      let previous = await nextViewportFrame();
      if (!previous || !canContinueViewportCapture(
        captureGeneration,
        originatingHostGeneration,
        generation,
        action,
        phase,
      )) return;
      captureLifecycle('viewport-frame', {
        ...previous.facts,
        action,
        frame: 1,
        viewportGeneration: generation,
      }, phase, originatingHostGeneration);
      for (let frame = 2; frame <= maxViewportSettlementFrames; frame += 1) {
        const current = await nextViewportFrame();
        if (!current || !canContinueViewportCapture(
          captureGeneration,
          originatingHostGeneration,
          generation,
          action,
          phase,
        )) return;
        captureLifecycle('viewport-frame', {
          ...current.facts,
          action,
          frame,
          viewportGeneration: generation,
        }, phase, originatingHostGeneration);
        const settlement = classifyViewportSettlement(
          generation,
          latestViewportDeliveryGeneration,
          previous.observation,
          current.observation,
        );
        if (settlement === 'terminal') {
          captureLifecycle('viewport-terminal', {
            ...current.facts,
            action,
            viewportGeneration: generation,
          }, phase, originatingHostGeneration);
          return;
        }
        if (generation !== latestViewportDeliveryGeneration || frame === maxViewportSettlementFrames) {
          captureLifecycle('viewport-pending', {
            ...current.facts,
            action,
            viewportGeneration: generation,
          }, phase, originatingHostGeneration);
          return;
        }
        previous = current;
      }
    } catch {
      if (!canContinueViewportCapture(
        captureGeneration,
        originatingHostGeneration,
        generation,
        action,
        phase,
      )) return;
      captureLifecycle('viewport-pending', {
        action,
        viewportGeneration: generation,
        observationFailure: true,
      }, phase, originatingHostGeneration);
    }
  }

  async function observeViewportSettlement(): Promise<void> {
    if (viewportObservationPending) {
      viewportObservationRerunRequested = true;
      return;
    }
    viewportObservationPending = true;
    let observedGeneration = latestViewportDeliveryGeneration;
    try {
      let observedCaptureGeneration: number | null;
      do {
        observedGeneration = latestViewportDeliveryGeneration;
        observedCaptureGeneration = currentGanttLifecycleCaptureGeneration();
        if (observedCaptureGeneration === null) return;
        await captureViewportSettlementGeneration(
          observedGeneration,
          observedCaptureGeneration,
          latestViewportAction,
          latestViewportPhase,
          latestViewportHostGeneration,
        );
      } while (
        !viewportDiagnosticsDisposed &&
        isGanttLifecycleCaptureActive() &&
        observedCaptureGeneration === currentGanttLifecycleCaptureGeneration() &&
        observedGeneration !== latestViewportDeliveryGeneration
      );
    } finally {
      viewportObservationPending = false;
      const rerunRequested = viewportObservationRerunRequested &&
        observedGeneration !== latestViewportDeliveryGeneration;
      viewportObservationRerunRequested = false;
      if (rerunRequested && !viewportDiagnosticsDisposed && isGanttLifecycleCaptureActive()) {
        void observeViewportSettlement();
      }
    }
  }

  function captureViewportDelivery(action: string, originatingHostGeneration: number): void {
    if (viewportDiagnosticsDisposed || !isGanttLifecycleCaptureActive()) return;
    if (originatingHostGeneration !== hostGeneration) return;
    const sourceMatch = takeViewportSource(action, originatingHostGeneration);
    if (sourceMatch.stale) return;
    const { source } = sourceMatch;
    const phase = source?.phase ?? currentGanttLifecyclePhase();
    if (phase === null) return;
    if (!source) viewportGeneration += 1;
    const generation = source?.generation ?? viewportGeneration;
    latestViewportDeliveryGeneration = generation;
    latestViewportAction = action;
    latestViewportPhase = phase;
    latestViewportHostGeneration = originatingHostGeneration;
    captureLifecycle('viewport-handler-delivered', {
      action,
      viewportGeneration: generation,
      sourceObserved: source !== null,
    }, phase, originatingHostGeneration);
    void observeViewportSettlement();
  }

  $effect(() => {
    const root = rootEl;
    if (!root) return;
    const captureCheckpoint = (event: Event): void => {
      if (!isGanttLifecycleCaptureActive()) return;
      const detail = (event as CustomEvent<{ checkpoint?: unknown }>).detail;
      const checkpoint = typeof detail?.checkpoint === 'string'
        ? detail.checkpoint.slice(0, 80)
        : 'unnamed';
      captureLifecycle('viewport-checkpoint', {
        checkpoint,
        pendingViewportSourceCount: pendingViewportSources.size,
        viewportObservationPending,
        latestViewportDeliveryGeneration,
        latestViewportGeneration: viewportGeneration,
        ...readViewportDiagnostics().facts,
      });
    };
    const captureChartScrollSource = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.matches('.wx-chart')) return;
      captureViewportSource('scroll-chart', {
        mechanism: 'renderer-scroll',
        source: 'dom-scroll',
      });
    };
    root.addEventListener('tn-gantt-lifecycle-checkpoint', captureCheckpoint);
    root.addEventListener('scroll', captureChartScrollSource, true);
    return () => {
      root.removeEventListener('tn-gantt-lifecycle-checkpoint', captureCheckpoint);
      root.removeEventListener('scroll', captureChartScrollSource, true);
    };
  });

  onDestroy(() => {
    viewportDiagnosticsDisposed = true;
    const viewportObservationWasPending = viewportObservationPending;
    cancelPendingViewportFrame();
    abortPendingViewportSources({ componentDestroyed: true });
    if (viewportObservationWasPending) {
      captureLifecycle('viewport-pending', {
        action: latestViewportAction,
        viewportGeneration: latestViewportDeliveryGeneration,
        observationAborted: true,
      }, latestViewportPhase, latestViewportHostGeneration);
    }
    captureLifecycle('component-cleanup', { legendOpen: legendSession.open, isMaximized });
    deactivateLegendEscapeScope();
    destroyed = true;
    hostGeneration += 1;
  });

  // ── Viewport height (plan 003 U2) ───────────────────────────────────────
  // SVAR has no auto-grow-to-content prop: the host must size itself. We mirror
  // SVAR's own height inputs from its reactive store — the collapse-aware
  // visible-row count (`_tasks`), the row height (`cellHeight`), and the
  // scale-header height (`_scales.height`) — and resolve a host height that fits
  // content up to `maxHeight`, then scrolls (R2/R3/R4). Driving this from the
  // STORE (not a DOM ResizeObserver) avoids both fighting SVAR's own observer and
  // the virtualization measure→set fixed-point. Applied as an explicit px height
  // on the root below.
  let rowCount = $state(0);
  let cellH = $state(SVAR_CELL_HEIGHT);
  let scaleAreaH = $state(SVAR_SCALE_HEIGHT);

  $effect(() => {
    // Re-subscribe whenever the SVAR api instance changes (e.g. the theme-flip
    // remount of <Gantt>). Each signal's subscribe fires immediately with the
    // current value and on every change, and returns a disposer for teardown.
    if (!api?.getReactiveState) return;
    const rs = api.getReactiveState();
    const disposers = [
      rs._tasks?.subscribe?.((t: unknown) => {
        rowCount = Array.isArray(t) ? t.length : 0;
      }),
      rs.cellHeight?.subscribe?.((v: unknown) => {
        cellH = typeof v === 'number' && v > 0 ? v : SVAR_CELL_HEIGHT;
      }),
      rs._scales?.subscribe?.((s: unknown) => {
        const h = (s as { height?: unknown } | undefined)?.height;
        scaleAreaH = typeof h === 'number' && h > 0 ? h : SVAR_SCALE_HEIGHT;
      }),
    ];
    return () => {
      for (const dispose of disposers) {
        if (typeof dispose === 'function') dispose();
      }
    };
  });

  // Resolved host height in px (R2/R3). `$derived` memoizes, so the inline style
  // re-applies only when the value actually changes — the no-op guard is free.
  const hostHeightPx = $derived(resolveHostHeight(rowCount, cellH, scaleAreaH, maxHeight, minHeight));

  // Full screen is "maximize within Obsidian" (plan 2026-06-30-002): the view
  // root (`.og-bases-gantt`) is promoted to fill the Obsidian window via the
  // `.is-maximized` class (CSS below), NOT the native browser Fullscreen API.
  // The native API promotes a subtree to the browser top layer and paints only
  // that subtree, hiding Obsidian's popups (Edit Modal, command palette, menus)
  // which live on `document.body`. Maximizing in Obsidian's own stacking context
  // — just below `--layer-modal` — lets those popups render above the chart.
  // The state machine (toggle + Esc-to-exit + teardown) is the injectable
  // `createMaximizeController` (unit-tested); this component owns only the DOM.
  let isMaximized = $state(false);
  let maximizeController: MaximizeController | undefined;
  // The node we promoted to `document.body` while maximized, plus where it sat
  // before, so exit/teardown restores it exactly. We capture the node itself (not
  // just rootEl) so the teardown restore still works if `bind:this` has already
  // nulled `rootEl` during unmount.
  let promotedEl: HTMLElement | null = null;
  let restoreParent: HTMLElement | null = null;
  let restoreNextSibling: Element | null = null;
  // Promote the view root to `document.body` while maximized, and restore it on
  // exit. A plain `position: fixed` overlay is trapped when an Obsidian ancestor
  // applies `transform`/`contain` (then fixed resolves against that ancestor, so
  // maximize would fill only the leaf, not the window — caught by the e2e). At
  // body level, fixed resolves against the viewport and the chart covers the
  // sidebars/tab bar/ribbon (R1). We move ONLY our own node — never Obsidian's
  // modal/popover DOM. On restore we skip re-inserting into a parent that was
  // detached while maximized (e.g. the leaf was closed) — Svelte's unmount then
  // removes the node, avoiding an orphan or an insertBefore into a stale parent.
  function applyMaximizeDom(max: boolean): void {
    if (max) {
      const el = rootEl;
      if (!el || promotedEl) return; // no node yet, or already promoted
      promotedEl = el;
      restoreParent = el.parentElement;
      restoreNextSibling = el.nextElementSibling;
      document.body.appendChild(el);
      captureLifecycle('maximize-dom-promoted', {
        parentIsBody: el.parentElement === document.body,
      });
    } else {
      const el = promotedEl;
      const parent = restoreParent;
      const next = restoreNextSibling;
      promotedEl = null;
      restoreParent = null;
      restoreNextSibling = null;
      if (el && parent && parent.isConnected) {
        parent.insertBefore(el, next);
      }
      captureLifecycle('maximize-dom-restored', {
        restored: !!el && !!parent && el.parentElement === parent,
        parentConnected: parent?.isConnected ?? false,
      });
    }
  }
  $effect(() => {
    const ctrl = createMaximizeController({
      onChange: (v) => {
        captureLifecycle('maximize-state-transition', { isMaximized: v });
        isMaximized = v;
        applyMaximizeDom(v);
        captureLifecycleAfterTick('maximize-rendered', () => ({
            isMaximized: v,
            renderedClass: rootEl?.classList.contains('is-maximized') ?? false,
            parentIsBody: rootEl?.parentElement === document.body,
          }));
      },
      // Obsidian-aware Escape policy (injected so the controller stays generic):
      // when a popup is open, let IT consume Escape — only exit maximize when
      // Escape would otherwise do nothing. This runs in the CAPTURE phase so it
      // fires BEFORE Obsidian's own handler closes (and removes) the popup: a
      // bubble-phase check is racy because `.modal-container` is already gone by
      // the time we'd look. At capture time the popup is still in the DOM, so the
      // selector check reliably stands us down and the event proceeds to the
      // popup's handler — one Escape closes the popup without dropping maximize.
      registerEscape: (onEscape) => {
        const handler = (e: KeyboardEvent): void => {
          if (e.key !== 'Escape') return;
          if (legendSession.open) return;
          if (document.querySelector(OBSIDIAN_OVERLAY_SELECTOR)) return;
          onEscape();
        };
        document.addEventListener('keydown', handler, true);
        return () => document.removeEventListener('keydown', handler, true);
      },
    });
    maximizeController = ctrl;
    return () => {
      // Restore the node to its original parent before unmount so neither Svelte
      // nor the Obsidian view is left removing an orphaned/relocated root.
      applyMaximizeDom(false);
      ctrl.destroy();
      maximizeController = undefined;
    };
  });
  // Deactivate transient UI when our leaf stops being active. A maximized root
  // lives on `document.body`, so it must be restored explicitly; an ordinary
  // hidden leaf also needs its Legend scope removed so it cannot consume Escape
  // or focus its hidden trigger from another leaf. Our origin container
  // (`restoreParent`) stays inside our leaf while maximized.
  $effect(() => {
    const ref = app.workspace.on('active-leaf-change', (leaf) => {
      const activeContainer = leaf?.view?.containerEl ?? null;
      // Null/transient leaf changes (Obsidian emits these when a modal opens or
      // during focus transitions) are NOT a real tab switch. Only deactivate UI
      // when a genuine OTHER leaf became active.
      if (!activeContainer) {
        captureLifecycle('active-leaf-classified', { classification: 'null' });
        return;
      }
      const owner = restoreParent ?? rootEl;
      if (owner && activeContainer.contains(owner)) {
        captureLifecycle('active-leaf-classified', { classification: 'owner' });
        return; // still our leaf
      }
      captureLifecycle('active-leaf-classified', { classification: 'other' });
      if (legendSession.open) void closeLegend({ restoreFocus: false });
      if (maximizeController?.isMaximized()) maximizeController.exit();
    });
    return () => app.workspace.offref(ref);
  });
  const toggleMaximize: MaximizeToggleAction = () => {
    captureLifecycle('maximize-handler-delivered', {
      wasMaximized: maximizeController?.isMaximized() ?? false,
    });
    maximizeController?.toggle();
  };

  // Native interaction state (U2). Map render-instance id → source note path so
  // a bar click resolves to the task the native TaskNotes action targets.
  const idToSourcePath = $derived.by(() => {
    const m = new Map<string, string>();
    for (const inst of instances) m.set(inst.id, inst.sourcePath);
    return m;
  });
  // Single/double-click disambiguation: the single-click action is deferred so a
  // following double-click can cancel it (SVAR fires select-task on the clicks
  // that make up a double-click too).
  let pendingSingleClick: ReturnType<typeof setTimeout> | null = null;
  // show-editor (double-click) carries no modifier keys, so we read the most
  // recent pointer event's ctrl/meta state, captured on the chart root.
  let lastCtrlMeta = false;
  // Whether a mouse button is currently held over the chart — true only during a
  // drag. The open-task intercept uses it to veto the mid-drag parent collapse
  // while leaving pointer-up toggles (chevron click, keyboard hotkey) alone.
  let pointerButtonDown = false;
  // Raised around the programmatic `select-task` that Focus issues so the
  // select-first interceptor skips scheduling activation — Focus highlights the
  // target without opening it, even when it was already selected (R9).
  let suppressSelectActivation = false;
  // The occupancy piece the most recent pointer press landed on (piece-level
  // click routing): its owning bar id plus the resolved activation path (a
  // materialized piece's note, else the recurring task). Null when the press
  // was anywhere else; set on the chart root's capture-phase mousedown.
  let lastPieceActivation: { barId: string; path: string } | null = null;

  /**
   * Resolve a bar id → source path and invoke the native-activate callback.
   * A click that went down on an occupancy piece of THIS bar routes to the
   * piece's own path instead (a materialized instance opens its backing note).
   */
  function activateBar(id: string, kind: 'single' | 'double', ctrlOrMeta: boolean): void {
    const path =
      lastPieceActivation?.barId === id ? lastPieceActivation.path : idToSourcePath.get(id);
    if (path) onBarActivate?.(path, { kind, ctrlOrMeta });
  }

  // Grid columns mirror the Base's configured columns (plan 2026-06-18-001).
  // The name/hierarchy column (id 'text') leads — SVAR pins the tree (indent +
  // expand/collapse) to the first column, rendered with its default cell so
  // task names appear — then one column per visible property, each rendered by
  // a generic type-aware PropertyCell.
  //
  // Seed-once: a NEW `columns` reference re-inits SVAR's whole store (resetting
  // zoom/scroll), so this is built once and reassigned ONLY when the column
  // config fingerprint changes (see the reseed in the diff-sync $effect). Each
  // rebuild constructs fresh objects — SVAR mutates column objects in place on
  // resize/fit, so reusing a prior element would carry stale width state.

  /** A SVAR grid column (the shape `<Gantt columns>` wants). */
  interface SvarGridColumn {
    id: string;
    header: string;
    width: number;
    align: 'left' | 'center' | 'right';
    resize: boolean;
    // Header-click sort is ENABLED (plan 2026-06-22-002, reverses R16): the Base
    // toolbar sort is the DEFAULT, an ephemeral column sort is an override. The
    // name column uses SVAR's default comparator (sorts by `task.text`); property
    // columns need an explicit comparator because their value lives in
    // `task.custom.properties[id]`, not as a flat `task[id]` field — SVAR's default
    // would read `undefined` and silently no-op (see columnSort.ts).
    sort: boolean | ((a: Record<string, unknown>, b: Record<string, unknown>) => 1 | -1 | 0);
    // SVAR cell component for property columns; the name column omits it (uses
    // the default cell, which renders the tree + row.text).
    cell?: typeof PropertyCell;
    // Per-row inline-editor gate (inline cell editing): SVAR's grid store calls
    // this at every editor open (double-click AND keyboard); `null` blocks the
    // open. Attached ONLY to columns with a shipped editor kind — an attached
    // editor suppresses the grid's `show-editor` double-click fallback, which
    // editor-less columns must keep (TaskNotes activation).
    editor?: (row?: SvarRowLike) => SvarEditorConfig | null;
    // Raw stored value for an opening editor (SVAR seeds the input from it);
    // without it SVAR falls back to the flat `row[column.id]`, which our rows
    // don't carry until a first commit.
    getter?: (row?: SvarRowLike) => unknown;
  }

  // Live per-column shipped editor kinds, from the assembly pass's resolved
  // descriptors. Consulted at editor-open/seed time (not only column-build
  // time) so an editability change reaches already-built columns.
  const editorKindByColumn = $derived(shippedEditorKinds($data.cellEditors));

  // Editor-attached column ids in grid display order (name column excluded) —
  // the id set `classifyUpdateGesture` diffs a committed task copy against.
  const cellEditColumnIds = $derived(editorAttachedColumnIds($data.gridColumns, editorKindByColumn));

  // The mapped start/end date columns (by role), from the same resolved
  // descriptors. Keys the cross-field start≤end check on a date-cell commit.
  const dateRoleByColumn = $derived(dateRoleColumns($data.cellEditors));

  // Live richselect option sets for the choice columns, from the TaskNotes
  // catalog threaded through the data store — an empty set offers no picker.
  const statusEditorOptions = $derived(choiceEditorOptions($data.choiceOptions?.status ?? []));
  const priorityEditorOptions = $derived(choiceEditorOptions($data.choiceOptions?.priority ?? []));

  // The suggest columns' channels (autosuggest filter + list shape), from the
  // same resolved descriptors as the editor kinds.
  const suggestChannelByColumn = $derived(suggestColumns($data.cellEditors));

  const cellEditCoordinator = createCellEditCoordinator({
    getPersistence: () => onMutateProperty,
    storedPropertiesOf,
    cellRendersOf,
    rawStoredValueOf,
    renderText: (value) => formatPropertyValue(value, initialData.dateLocale),
    refreshFlatCell(instanceId, columnId, value) {
      api?.exec('update-task', {
        id: instanceId,
        task: { [columnId]: value },
        eventSource: OG_ECHO_SOURCE,
      });
    },
    notify(message) {
      new Notice(message);
    },
    reportPersistenceFailure(error) {
      console.error('[GanttContainer] cell-edit persist failed:', error);
    },
    persistenceTimeoutMs: MUTATION_TIMEOUT_MS,
  });

  // Editable-cell cue (discoverability): PropertyCell combines this live column
  // set with its row's `custom.editable` to add `og-cell-editable`. A getter so
  // the cell's $derived tracks changes.
  setContext(GRID_EDITABLE_COLUMNS_CONTEXT_KEY, () => new Set(editorKindByColumn.keys()));

  /**
   * The per-row editor gate for an editor-attached column: only a
   * TaskNotes-managed row (`custom.editable`) in a write-capable view with no
   * pending write on it may open an editor; `null` blocks the open.
   */
  function resolveRowEditor(row: SvarRowLike | undefined, columnId: string): SvarEditorConfig | null {
    if (readOnly || !onMutateProperty) return null;
    if (row?.id != null && cellEditCoordinator.isPending(String(row.id))) return null;
    const kind = editorKindByColumn.get(columnId);
    const suggestChannel = suggestChannelByColumn.get(columnId);
    const config = rowEditorConfig(row, kind, {
      dateLocale: initialData.dateLocale,
      choiceOptions:
        kind === 'choice-status'
          ? statusEditorOptions
          : kind === 'choice-priority'
            ? priorityEditorOptions
            : undefined,
      suggest: suggestChannel ? { columnId, ...suggestChannel } : undefined,
    });
    if (!config) return null;
    // An editor is opening: cancel any deferred single-click activation. On an
    // already-selected row the double-click's first click schedules one, and
    // the show-editor intercept that normally cancels it never fires for an
    // editor-attached column — without this the TaskNotes action would open
    // over the just-opened editor.
    if (pendingSingleClick) {
      clearTimeout(pendingSingleClick);
      pendingSingleClick = null;
    }
    const sourcePath = (row?.custom as { sourceTaskId?: string } | undefined)?.sourceTaskId ?? '';
    const rowId = row?.id != null ? String(row.id) : null;
    return wireSvarCellEditorForOpen(config, {
      app,
      sourcePath,
      chips: rowId
        ? {
            readRawSeed: () => rawStoredValueOf(rowId, columnId),
            commitRawList: (raw) =>
              cellEditCoordinator.commitChips({
                instanceId: rowId,
                columnId,
                raw,
              }),
          }
        : undefined,
    });
  }

  /** Turn config-derived descriptors into SVAR columns (fresh objects). */
  function buildSvarColumns(descriptors: GridColumn[]): SvarGridColumn[] {
    const attachedKinds = editorKindByColumn;
    return descriptors.map((c) => {
      const col: SvarGridColumn = {
        id: c.id,
        header: c.header,
        width: c.width,
        align: c.align,
        resize: true,
        // Name column → SVAR default (task.text); property column → TypedValue-aware
        // comparator over custom.properties[propId]. Math.sign normalizes to the
        // 1|-1|0 SVAR's TSortFunction type wants (SVAR negates it for descending).
        sort: c.isName
          ? true
          : (a, b) => Math.sign(propertyColumnSort(c.propId)(a, b)) as 1 | -1 | 0,
      };
      if (!c.isName) {
        col.cell = PropertyCell;
        const buildKind = attachedKinds.get(c.id);
        if (buildKind) {
          col.editor = (row) => resolveRowEditor(row, c.id);
          col.getter = (row) =>
            editorSeedFor(
              editorKindByColumn.get(c.id) ?? buildKind,
              row?.custom?.properties?.[c.id],
              (row?.custom as { cellRenders?: Record<string, CellRender> } | undefined)?.cellRenders?.[
                c.id
              ],
            );
        }
      }
      return col;
    });
  }

  let columns: SvarGridColumn[] = $state(buildSvarColumns(initialData.gridColumns));
  // Last-applied column-config fingerprint; a change triggers a reseed (see the
  // diff-sync $effect). Plain `let` — read/written only inside the effect.
  let appliedColumnsKey = initialData.gridColumnsKey;
  // Last-applied editor-attach set. Which columns CARRY an editor/getter is
  // decided at column-build time, so an editability change with an unchanged
  // column config (e.g. a newly registered TaskNotes field) also needs a column
  // reseed — otherwise the new editor never attaches (or a dead one lingers).
  let appliedEditorAttachKey = initialEditorColumnIds.join('|');

  // NOTE: there is intentionally no toolbar. The only items it ever held were
  // Zoom In/Out, which are redundant with the floating +/- controls at the
  // bottom-right of the chart, so the toolbar was removed. ("Add Task" is also
  // not shown: task creation isn't yet routed through the controller/TaskNotes —
  // it returns, gated on `capabilities.write`, when a controller create op
  // exists.)

  /**
   * Persist a column's new width (U5/R8). The grid's `resize-column` action
   * lives on the inner TABLE store, not the Gantt store, so we reach it via
   * `api.getTable(true)` (a Gantt-store `api.on('resize-column')` never fires).
   * The committing frame (`inProgress` falsy) carries the final width; map the
   * SVAR column id back to its Bases property id (the name column reports its
   * name key, not `text`) and hand it to the binder.
   */
  function wireColumnResizePersistence(ganttApi: GanttAPI): void {
    if (!onColumnResize || typeof ganttApi?.getTable !== 'function') return;
    try {
      const result = ganttApi.getTable(true);
      void Promise.resolve(result)
        .then((tableApi: GanttAPI) => {
          tableApi?.on?.(
            'resize-column',
            (ev: { id?: string | number; width?: number; inProgress?: boolean }) => {
              if (!ev || ev.inProgress || ev.id == null || typeof ev.width !== 'number') return;
              const id = String(ev.id);
              const descriptor = get(data).gridColumns.find((c) => c.id === id);
              onColumnResize?.(descriptor?.propId ?? id, ev.width);
            },
          );
        })
        .catch(() => {
          /* table API not ready / unsupported — width persistence inert */
        });
    } catch {
      /* getTable threw — width persistence inert */
    }
  }

  /**
   * Persist the grid/timeline divider width (plan 002 U3). SVAR 2.7.0's Resizer
   * execs `resize-grid` on the Gantt api when the user drags the divider, so we
   * listen there (no getTable hop needed — unlike resize-column). Debounced so a
   * drag's continuous frames collapse to one write of the final width. Restore
   * is the `gridWidth` prop seeded at mount; this only saves changes.
   */
  function wireGridWidthPersistence(ganttApi: GanttAPI): void {
    if (typeof ganttApi?.on !== 'function') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: number | null = null;
    try {
      ganttApi.on('resize-grid', (ev: { width?: number }) => {
        if (!ev || typeof ev.width !== 'number') return;
        // Track the user's chosen width (also covers our own re-assert exec —
        // harmless, same value). The column recompute uses setState, not this
        // event, so its column-sum value never pollutes lastGridWidth.
        lastGridWidth = ev.width;
        if (!onGridWidthChange) return;
        pending = ev.width;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          if (pending != null) onGridWidthChange?.(pending);
        }, 300);
      });
    } catch {
      /* resize-grid unsupported — divider persistence inert */
    }
  }

  /**
   * Re-assert the persisted grid width after the column recompute (which forces
   * gridWidth = column-sum at mount/reseed) and on reveal/reattach (Bug B).
   * Deferred so it runs after that recompute settles; `resize-grid` doesn't
   * re-trigger the recompute (it keys on columns/displayMode), so the value
   * sticks until the next column change.
   *
   * Re-assert the CURRENT effective width from the data store — register
   * recomputes it every refresh (the persisted value, or the fresh first-column
   * fallback) and it equals the persist guard's `currentPersisted`, so a
   * re-assert is always an unchanged (no-op) write. Using the stale mount-time
   * `lastGridWidth` instead would let an unset view whose name column was later
   * resized re-assert — and, via the persist listener, write back — the old
   * fallback, pinning an auto view to a stale width. `lastGridWidth` remains the
   * fallback only until the first data value arrives.
   */
  function applyPersistedGridWidth(): void {
    const width = get(data)?.gridWidth ?? lastGridWidth;
    if (width == null || !api?.exec) return;
    setTimeout(() => {
      try {
        api?.exec?.('resize-grid', { width });
      } catch {
        /* exec unavailable — restore inert; in-session drag still works */
      }
    }, 0);
  }

  /** [OGDBG #161] monotonic SVAR (re)init counter — re-init storm detector. */
  let dbgInitCount = 0;

  // Every mutable binding crosses the interceptor seam as a live accessor
  // property closed over this component's scope — never a copied value — so a
  // handler's write is visible to the next handler, the sync coordinator, and
  // the template. Built once; initGantt re-registers per re-bound api.
  const interceptorAccess: InterceptorAccess = {
    get syncing() {
      return syncing;
    },
    get ephemeralSort() {
      return ephemeralSort;
    },
    set ephemeralSort(value) {
      ephemeralSort = value;
    },
    get collapsedIds() {
      return collapsedIds;
    },
    set collapsedIds(value) {
      collapsedIds = value;
    },
    get pendingSingleClick() {
      return pendingSingleClick;
    },
    set pendingSingleClick(value) {
      pendingSingleClick = value;
    },
    get lastCtrlMeta() {
      return lastCtrlMeta;
    },
    get pointerButtonDown() {
      return pointerButtonDown;
    },
    get suppressSelectActivation() {
      return suppressSelectActivation;
    },
  };
  const interceptorDeps: SvarInterceptorDeps = {
    echoSource: OG_ECHO_SOURCE,
    restoreBaseOrder,
    activateBar,
    notePathOf: (rowId: string) => instances.find((i) => i.id === rowId)?.calendarItem?.notePath,
    // Reads the live `api` binding, not a wiring-time parameter: a stale
    // registration must see the current instance's selection, exactly as the
    // pre-extraction closure did.
    getState: () => api?.getState?.(),
    // Live `$derived` reads: a capabilities flip or a grid-column edit changes
    // these without a SVAR re-init, so the handlers read them at event time.
    isReadOnly: () => readOnly,
    cellEditColumnIds: () => cellEditColumnIds,
    allowsRowMutation,
    refusesUserRowMutation,
    allowsLinkEndpoints,
    rowHasDerivedGeometry,
    linkTouchesDerivedGeometry,
    classifyUpdateEvent,
    classifyUpdateGesture,
    classifyLinkCreate,
    storedPropertiesOf,
    handleCellEditCommit,
    reseedRowFlatKeys,
    handleUserBarGesture,
    onMutate,
    onAddDependency,
    onRemoveDependency,
    lookupAppliedLink: (linkId: string) => appliedSyncState.links.get(linkId),
    notify: (message: string) => {
      new Notice(message);
    },
  };

  // Initialize API and intercept editor events
  function initGantt(ganttApi: GanttAPI) {
    // A re-bound api is a new host world: retire in-flight executor work.
    if (api && api !== ganttApi) {
      hostGeneration += 1;
      abortPendingViewportSources({
        hostGenerationChanged: true,
        currentHostGeneration: hostGeneration,
      });
    }
    api = ganttApi;
    captureLifecycle('svar-ready', {
      apiRebound: hostGeneration > 0,
    });
    wireColumnResizePersistence(ganttApi);
    wireGridWidthPersistence(ganttApi);
    wireMarkerRecompute(ganttApi);
    // Restore the persisted divider width after the initial column recompute.
    applyPersistedGridWidth();

    // [OGDBG #161] initGantt fires once per SVAR (re)initialization. Repeated
    // lines during a config toggle ⇒ a remount/reseed loop, not refresh-in-place.
    dbgInitCount += 1;
    dlog(`[OGDBG] initGantt #${dbgInitCount} svarTasks=${api?.getState?.()?.tasks?.length ?? '?'}`);

    // Native edit interaction: a bar's left/double-click routes to the
    // TaskNotes interaction service — TaskNotes performs the configured action
    // (open note / open its own edit modal); SVAR's own editor never opens.
    // Every interception policy — ephemeral sort, collapse persistence,
    // reorder blocking, show-editor routing, select-first activation, drag
    // vetoes, cell-edit routing, link authoring — lives in svarInterceptors.ts
    // and registers in the preserved order; only the registrations repeat per
    // re-bound api — the access/deps objects are component-lifetime.
    wireSvarInterceptors(ganttApi, interceptorAccess, interceptorDeps);

    // Fix initial scroll position - ensure the grid starts with first column
    // visible. SVAR Gantt sometimes initializes with horizontal scroll that hides
    // the first column. Best-effort + silent (the verbose diagnostic dump this
    // once carried enumerated every `wx-` node — catastrophic under the #161
    // re-init storm; never reinstate an all-elements console dump here).
    setTimeout(() => {
      try {
        const selectors = [
          '.og-bases-gantt .wx-grid',
          '.og-bases-gantt .wx-grid-area',
          '.og-bases-gantt .wx-grid-data',
          '.og-bases-gantt .wx-layout-grid',
          '.og-bases-gantt .wx-grid-body',
          '.og-bases-gantt [data-id="grid"]',
        ];
        for (const selector of selectors) {
          const element = document.querySelector(selector) as HTMLElement | null;
          if (element && element.scrollLeft > 0) element.scrollLeft = 0;
        }
      } catch {
        /* scroll reset is best-effort */
      }
    }, 200); // Increased delay to ensure DOM is fully ready
  }

  const resolvePrompt = createDragPromptResolver({
    openInferredDragPrompt: () => new InferredDragModal(app).openAndGetChoice(),
    openCascadePrompt: (options) =>
      new CascadeConfirmModal(app, options).openAndGetChoice(),
    persistInferredDragMode: (action) => onInferredDragModeChange?.(action),
  });

  // Runs planner-built commit plans with per-source serialization; every
  // echoed or reverted row goes through echoSourceGeometry (echo-guard source).
  const dragExecutor = createDragExecutor({
    canWrite: () => !destroyed && !readOnly && !!onMutate && !!api,
    isLive: () => !destroyed && !!api,
    generation: () => hostGeneration,
    persist: (write) =>
      onMutate ? onMutate(write.instanceId, plannedPatchToTaskPatch(write.patch)) : Promise.resolve(),
    echo: echoSourceGeometry,
    resolvePrompt,
    persistTimeoutMs: MUTATION_TIMEOUT_MS, onPersistTimeout: notifySlowSaveOnce, onWriteSettled: (write) => { slowSaveNoticed.delete(write.sourcePath); },
    refreshGeneration: () => $data.refreshGeneration?.() ?? { started: 0, delivered: 0 },
  });

  const CASCADE_FAILURE_NOTICE: Record<CascadePhase, string> = {
    subtree: "Couldn't move a child task — check TaskNotes is running.",
    shrink: "Couldn't adjust the parent date — check TaskNotes is running.",
    extend: "Couldn't update a parent date — check TaskNotes is running.",
  };

  /**
   * A committed user gesture on a task row (`update-task`, classified
   * user-gesture): route a progress-handle release to the progress writer,
   * refuse derived-geometry (occupancy) rows, submit everything else to the
   * drag executor. Returns the intercept verdict.
   */
  function handleUserBarGesture(ev: UpdateTaskEvent, id: string): boolean {
    const before = instances.find((i) => i.id === id);
    // Progress-handle drag: Property mode persists the new percentage on
    // release (TaskNotes mode hides the handle via progressReadonly).
    // Identify a progress gesture by the SVAR payload SHAPE, not just a
    // changed progress value: the marker emits `task: { progress }` with NO
    // start/end, whereas a date drag emits `task: { start, end }` (and may
    // echo `progress: 0`) — value-keying would misread a date drag as a 0-write.
    const t = ev.task ?? {};
    const isProgressGesture = 'progress' in t && !('start' in t) && !('end' in t);
    const newProgress = t.progress;
    if (
      !progressReadonly &&
      isProgressGesture &&
      typeof newProgress === 'number' &&
      newProgress !== (before?.progress ?? undefined)
    ) {
      const beforeProgress = before?.progress ?? 0;
      setTimeout(() => void persistProgress(id, newProgress, beforeProgress), 0);
      return true;
    }
    // Derived-geometry (occupancy) row: refuse the date gesture before it
    // reaches the drag planner — committing it would write absolute envelope
    // dates into scheduled/due. Cell edits and progress (above) stay
    // untouched. Belt to drag-task's braces: that intercept already aborts
    // pointer gestures at the first frame.
    if (rowHasDerivedGeometry(id)) return false;
    const beforeFacts = captureBarBefore(id, before);
    const echoSeqAtCapture = dragExecutor.echoSeqOf(before?.sourcePath ?? id);
    const name = before?.text ?? 'this task';
    // Deferred one tick so the SVAR store holds the committed post-drag span.
    setTimeout(() => submitBarGesture({ instanceId: id, name, before: beforeFacts, echoSeqAtCapture }), 0);
    return true;
  }

  /** Pre-drag bar facts: SPAN from the live SVAR row (a stale `instances` span turns a
   *  revert drag into a no-op plan); dateStatus/estimate from the snapshot, rebased over
   *  the executor's settled-facts ledger (self-writes skip recompute). */
  function captureBarBefore(id: string, before: (typeof instances)[number] | undefined) {
    const grabbed = api.getTask?.(id);
    return dragExecutor.rebaseSettledFacts(before?.sourcePath ?? id, {
      start: grabbed?.start instanceof Date ? grabbed.start : (before?.start ?? null),
      end: grabbed?.end instanceof Date ? grabbed.end : (before?.end ?? null),
      dateStatus: before?.dateStatus ?? null,
      estimateMinutes: before?.estimateMinutes ?? null,
    });
  }

  /**
   * Submit a committed bar drag/resize as one planned, executor-run gesture,
   * cascade included. `after` reads the SVAR store one tick post-commit;
   * `before` and the echo-seq baseline arrive from intercept time — an echo
   * landing inside that deferred tick must read as a predecessor's move. */
  function submitBarGesture(args: { instanceId: string; name: string; before: BarBefore; echoSeqAtCapture: number }): void {
    const { instanceId, name, before, echoSeqAtCapture } = args;
    if (!api) return;
    const moved = api.getState().tasks.byId(instanceId);
    if (!(moved?.start instanceof Date) || !(moved?.end instanceof Date)) return;
    const after: DateRange = { start: moved.start, end: moved.end };
    // Read at gesture time: a persisted "don't ask again" choice applies from the next drag.
    const inferredDragMode = $data.getInferredDragMode();
    const sourcePath = instances.find((i) => i.id === instanceId)?.sourcePath ?? instanceId;
    // Rebases once at dequeue: the span when a predecessor's echo moved the row
    // (even to exactly `after`); the authored facts always.
    const rebase = createDequeueBeforeRebase({
      gestureBefore: before, after,
      readLive: () => captureBarBefore(instanceId, instances.find((i) => i.id === instanceId)),
      movedByPredecessor: () => dragExecutor.echoSeqOf(sourcePath) !== echoSeqAtCapture,
    });
    const gesture = (): CommitGesture => ({
      kind: 'bar', instanceId, before: rebase.before(), after,
      estimateWritable: timeEstimateWriteEnabled && !readOnly, inferredDragMode,
    });
    const memo: DerivationMemo = new Map();
    void dragExecutor.submit({
      sourcePath,
      snapshot: () => {
        rebase.atDequeue();
        return overlayStoreGeometry(instances, (id) => api?.getTask?.(id), instanceId);
      },
      plan: (choice, snapshot) => planGestureCommit(gesture(), snapshot, choice, plannerDerivation(memo)),
      onFailure: (err) => {
        console.error('[GanttContainer] reschedule persist failed:', err);
        new Notice("Couldn't save date change — check TaskNotes is running.");
      },
      cascade: {
        // Pure moves only: a halted resize owes its subtree no displacement.
        get before() { return pureMoveBefore(rebase.before(), after); },
        plan: (settlement, answers, snapshot, laneBefore) =>
          planCascade(
            { instanceId, name, before: laneBefore ?? rebase.before(), after, settlement },
            snapshot,
            { cascadeMode: get(data).cascadeMode, ...answers },
            plannerDerivation(memo),
          ),
        onFailure: (err, phase) => {
          console.error(`[GanttContainer] ${phase} cascade persist failed:`, err);
          new Notice(CASCADE_FAILURE_NOTICE[phase]);
        },
      },
    });
  }

  function plannedPatchToTaskPatch({ start, end, estimate, progress }: PlannedPatch): TaskPatch {
    return {
      ...(start !== undefined && { start }),
      ...(end !== undefined && { end }),
      ...(estimate !== undefined && { estimate }),
      ...(progress !== undefined && { progress }),
    };
  }

  /** The sole executor echo emitter: rows re-enter SVAR tagged as our own,
   *  carrying FULL geometry — `custom.ghostRuns` advances with start/end — and
   *  every patch mirrors into the diff baseline: the baseline must see what
   *  the store sees, or the next refresh diffs the authoritative rebuild
   *  against pre-echo state and skips the re-issue that repaints it. */
  function echoSourceGeometry(echoes: SourceEchoes): void {
    if (!api) return;
    for (const row of echoes.rows) {
      const task = echoTaskPatch(row.payload, api.getTask?.(row.instanceId)?.custom);
      api.exec('update-task', { id: row.instanceId, task, eventSource: OG_ECHO_SOURCE });
      applyEchoToBaseline(appliedSyncState, row.instanceId, task);
    }
  }

  /** The derivation surface plans read — the write-path authority, memoized per gesture. */
  function plannerDerivation(memo: DerivationMemo): PlannerDerivation {
    return memoizePlannerDerivation({
      deriveEstimate: $data.deriveEstimate,
      deriveSpan: $data.deriveSpan,
      minutesToSpanDays,
      spanDaysToMinutes,
      inclusiveDaySpan,
      defaultDurationDays: $data.defaultDurationDays,
    }, memo);
  }

  /**
   * Persist a Property-mode progress-handle drag: one release = one planned,
   * executor-run write. `beforeProgress` is captured synchronously in the
   * intercept (pre-drag), so a late data refresh can't skew the revert baseline.
   */
  function persistProgress(
    instanceId: string,
    progress: number,
    beforeProgress: number,
  ): Promise<void> {
    const gesture: CommitGesture = { kind: 'progress', instanceId, progress, beforeProgress };
    return dragExecutor.submit({
      sourcePath: instances.find((i) => i.id === instanceId)?.sourcePath ?? instanceId,
      snapshot: () => instances,
      plan: (choice, snapshot) => planGestureCommit(gesture, snapshot, choice, plannerDerivation(new Map())),
      onFailure: (err) => {
        console.error('[GanttContainer] progress persist failed:', err);
        new Notice("Couldn't save progress — check TaskNotes is running.");
      },
    });
  }

  /**
   * The row's stored TypedValue record, read from the live SVAR task. This is
   * the SAME shared per-source record `buildSvarTasks` attached (and the diff
   * baseline fingerprints), so advancing it after a commit keeps every
   * instance of the source — and the next diff — in agreement.
   */
  function storedPropertiesOf(id: string | number | undefined): Record<string, TypedValue> | undefined {
    if (id == null) return undefined;
    try {
      return api?.getTask?.(String(id))?.custom?.properties as
        | Record<string, TypedValue>
        | undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Whether a row's bar geometry is derived from its occupancy (envelope or
   * overlay), resolved from the live SVAR task like {@link storedPropertiesOf}.
   * The mutating intercepts refuse such rows: a drag/resize would commit
   * envelope dates into scheduled/due.
   */
  function rowHasDerivedGeometry(id: string | number | undefined): boolean {
    if (id == null) return false;
    try {
      return hasDerivedBarGeometry(api?.getTask?.(String(id))?.custom);
    } catch {
      return false;
    }
  }

  /** Per-link {@link rowHasDerivedGeometry}: an edge may not touch such a row on either end. */
  function linkTouchesDerivedGeometry(source: unknown, target: unknown): boolean {
    const asId = (v: unknown): string | number | undefined =>
      typeof v === 'string' || typeof v === 'number' ? v : undefined;
    return rowHasDerivedGeometry(asId(source)) || rowHasDerivedGeometry(asId(target));
  }

  /**
   * The row's render-descriptor record (same shared-record semantics as
   * {@link storedPropertiesOf}) — advanced optimistically on a cell-edit commit
   * so the cell shows the committed value before the refresh confirms it.
   */
  function cellRendersOf(id: string): Record<string, CellRender> | undefined {
    try {
      return api?.getTask?.(id)?.custom?.cellRenders as Record<string, CellRender> | undefined;
    } catch {
      return undefined;
    }
  }

  function handleCellEditCommit(instanceId: string, columnId: string, rawValue: unknown): boolean {
    const kind = editorKindByColumn.get(columnId);
    if (!kind) return false;
    // Choice commits carry the configured value strings so a bridge-coerced
    // numeric-looking pick ("01" arriving as 1) recovers the exact catalog value.
    const choiceValues =
      kind === 'choice-status'
        ? ($data.choiceOptions?.status ?? []).map((o) => o.value)
        : kind === 'choice-priority'
          ? ($data.choiceOptions?.priority ?? []).map((o) => o.value)
          : undefined;
    const dateRole = dateRoleByColumn.get(columnId);
    return cellEditCoordinator.commitBridge({
      instanceId,
      columnId,
      kind,
      rawValue,
      choiceValues,
      dateRole,
      datedRow: dateRole ? instances.find((instance) => instance.id === instanceId) : undefined,
    });
  }

  /** The RAW frontmatter value behind a row's note property (entries verbatim). */
  function rawStoredValueOf(instanceId: string, columnId: string): unknown {
    const key = bareProperty(columnId);
    const sourcePath = instances.find((i) => i.id === instanceId)?.sourcePath;
    if (!key || !sourcePath) return undefined;
    const file = app.vault.getAbstractFileByPath(sourcePath);
    if (!(file instanceof TFile)) return undefined;
    return app.metadataCache.getFileCache(file)?.frontmatter?.[key];
  }

  /**
   * Re-align an ambiguous row's flat editor keys with its stored values (the
   * lightest per-row refresh: one echo-tagged exec, no source re-read), so the
   * stale committed key that caused the ambiguity stops diffing.
   */
  function reseedRowFlatKeys(instanceId: string): void {
    const properties = storedPropertiesOf(instanceId);
    const patch: Record<string, unknown> = {};
    for (const columnId of cellEditColumnIds) {
      patch[columnId] = storedFlatValue(properties?.[columnId]);
    }
    if (Object.keys(patch).length > 0) {
      api?.exec('update-task', { id: instanceId, task: patch, eventSource: OG_ECHO_SOURCE });
    }
  }

  // Seed the view option once. Changing the `zoom` prop reference re-inits
  // SVAR, so ordinary data refreshes must never rebuild this configuration or
  // overwrite a zoom level the user selected with the floating controls.
  const zoomConfig = buildZoomConfig(initialData.defaultScale);
  // Open the day scale at its narrowest day columns (see initialCellWidth); other
  // scales keep SVAR's default opening width (undefined → prop omitted).
  const seedCellWidth = initialCellWidth(initialData.defaultScale);

  // ── Focus on task (search → expand → zoom → scroll → highlight) ──────────
  // Best-effort track of the live zoom-ladder level so focus can step
  // `zoom-scale` toward a target level. Seeded from the configured default and
  // updated whenever we step zoom (buttons + focus). NOTE: SVAR's Ctrl/Cmd+wheel
  // zoom is NOT tracked here, so this can drift after a wheel-zoom; SVAR stays
  // authoritative for the actual zoom and the focus loop is guarded so any drift
  // can't hang (it just lands a level or two off — best-fit is approximate).
  let currentZoomLevel = $state(zoomConfig.level);

  /** Step the zoom ladder by `dir` (+1 in / −1 out), centered on `date`. */
  function stepZoom(dir: 1 | -1, date: Date = new Date()): void {
    captureViewportSource('zoom-scale', {
      direction: dir,
    });
    api?.exec('zoom-scale', { dir, date });
    currentZoomLevel = Math.max(0, Math.min(zoomConfig.levels.length - 1, currentZoomLevel + dir));
  }

  /** Navigate the chart to reveal and highlight the instance `id` (focus). */
  async function focusOnInstance(id: string): Promise<void> {
    if (!api) return;
    const chartEl = rootEl?.querySelector('.wx-chart') as HTMLElement | null;
    const chartWidthPx = chartEl?.clientWidth ?? rootEl?.clientWidth ?? 0;
    const plan = buildFocusPlan({
      instances,
      targetId: id,
      chartWidthPx,
      levels: zoomConfig.levels,
      isCollapsed: (iid) => collapsedIds.has(iid),
    });

    // 1. Expand only the necessary ancestors, root-first, AND keep our collapse
    //    state in sync. Mirror toggleAllCollapse: the echo-tagged open-task skips
    //    the collapse intercept's own collapsedIds update, so we must clear the
    //    opened ids ourselves — otherwise the next reseed reads a stale
    //    collapsedIds and re-closes the row (and collapse-all shows wrong state).
    //    Raise `syncing` first so the resulting diff treats our execs as echoes.
    if (plan.ancestorsToOpen.length > 0) {
      syncing = true;
      const nextCollapsed = new Set(collapsedIds);
      for (const ancestorId of plan.ancestorsToOpen) nextCollapsed.delete(ancestorId);
      collapsedIds = nextCollapsed;
      try {
        for (const ancestorId of plan.ancestorsToOpen) {
          api.exec('open-task', { id: ancestorId, mode: true, eventSource: OG_ECHO_SOURCE });
        }
      } finally {
        syncing = false;
      }
    }

    // 2. Best-fit zoom: step the ladder toward the target level, centered on the
    //    bar. Skipped for date-less/partial tasks (R8 — keep the current zoom).
    if (plan.fit && plan.targetLevel != null) {
      const center = plan.centerDate ?? new Date();
      let guard = zoomConfig.levels.length;
      while (currentZoomLevel !== plan.targetLevel && guard-- > 0) {
        stepZoom(currentZoomLevel < plan.targetLevel ? 1 : -1, center);
      }
    }

    // 3+4. Let expand/zoom re-layout settle, then scroll the bar into view on
    //      both axes and highlight it by selecting. The select is wrapped so the
    //      select-first interceptor skips activation — focus stays navigation-only
    //      even when the target was already selected (R9).
    await tick();
    suppressSelectActivation = true;
    try {
      api.exec('select-task', { id, show: 'xy' });
    } finally {
      suppressSelectActivation = false;
    }
    if (plan.centerDate) api.exec('scroll-chart', { date: plan.centerDate });
  }

  /** Open the fuzzy focus search over the chart's current instances (R1/R3). */
  function openFocusModal(): void {
    if (!instances || instances.length === 0) return;
    new FocusTaskModal(app, instances, (id) => { void focusOnInstance(id); }).open();
  }

  // Publish the focus opener to the binder (command wiring, R2) on mount; retract
  // on teardown so the plugin command only fires for a live Gantt view.
  $effect(() => {
    onFocusEntryReady?.(openFocusModal);
    return () => onFocusEntryReady?.(null);
  });

  // Expose the divider re-assert so the host can restore it on reveal/reattach
  // (register.onResize → Bug B). applyPersistedGridWidth re-asserts lastGridWidth
  // via a deferred resize-grid exec, and is idempotent (the persist loop-guard
  // skips an unchanged width), so calling it on resize never feeds a write loop.
  $effect(() => {
    onReassertGridWidthReady?.(applyPersistedGridWidth);
    return () => onReassertGridWidthReady?.(null);
  });
</script>

<!--
  Multi-parent duplicate-icon + has-dependencies grid-cell indicators (R24/R27
  visual cues) are DEFERRED: SVAR v2.3.0 does not render a Svelte snippet passed
  as a column `cell` (it expects a cell component), which left the grid name
  cells blank. Reverted to SVAR's default cell so task names render. The
  indicators need a dedicated SVAR cell component — tracked as follow-up work.
  The multi-parent BEHAVIOR (one row per visible parent) is unaffected and is
  verified by the E2E render spec.
-->

<div
  class="og-bases-gantt {treatmentScopeClass}"
  data-og-mount-token={mountToken}
  style={`--og-date-status-fill:${GANTT_DATE_STATUS_FILL_COLOR};`}
  class:is-maximized={isMaximized}
  class:og-progress-readonly={progressReadonly}
  class:og-weekends-off={!highlightWeekends}
  bind:this={rootEl}
>
  <!-- Per-view toolbar (plan 002 U4): rendered above the chart only when the
       tngantt_showToolbar toggle is on (R2). Lives in Obsidian's own surface
       (styled with Obsidian CSS vars), outside the SVAR theme wrapper. -->
  {#if showToolbar}
    <GanttToolbar
      mode={mode}
      onModeChange={handleThemeModeChange}
      {onOpenSourceSwitcher}
      {externalEventsLoading}
    />
  {/if}

  <!-- SVAR's real theme component (plan 002 U2): <Willow>/<WillowDark> render
       the full nested core → grid → gantt theme layers, set the load-bearing
       `wx-theme` context (so the dependency Tooltip's Portal themes correctly),
       and guarantee their CSS. Chosen reactively by effectiveIsDark; the {#if}
       only re-renders on an actual theme flip (effectiveIsDark is stable across
       data updates), and the flip reseeds the chart's data (see
       maybeReseedForThemeFlip) so the remounted <Gantt> shows current data.
       fonts={false} omits the font CDN <link> (CSP). -->
  <!-- The computed host height (plan 003 U2) is applied HERE, on the chart
       region — NOT the outer container — so the optional toolbar and notice
       banners add their height ABOVE the chart instead of subtracting from it.
       Applied to the outer container, chrome shrank the chart below its content
       height; collapsed to a single root that clipped the only row. This element
       is the definite-height ancestor SVAR's `height:100%` chain resolves against. -->
  <!-- While maximized the chart fills the REMAINING window height: we drop the
       inline px height (so it doesn't pin the area to a fixed size) and let the
       `.is-maximized .og-chart-area` flex rule (CSS below) take the space left
       after the optional toolbar/banners. Using height:100% here would make the
       area the full viewport AND leave the toolbar stacked above it, overflowing
       the bottom (timeline + zoom controls pushed off-screen). -->
  <div class="og-chart-area" style={isMaximized ? '' : `height: ${hostHeightPx}px;`}>
    {#if effectiveIsDark}
      <WillowDark fonts={false}>{@render chartBody()}</WillowDark>
    {:else}
      <Willow fonts={false}>{@render chartBody()}</Willow>
    {/if}
  </div>
</div>

{#snippet chartBody()}
  <!-- Read-only banner (R5/R11): shown whenever the active source has no
       write capability, regardless of which source is active. Copy varies on
       whether TaskNotes is present (see readOnlyBannerText). -->
  {#if readOnly}
    <div class="og-readonly-banner" role="status">
      <span class="og-readonly-icon" use:lucideIcon={'lock'}></span>
      <span class="og-readonly-text">{readOnlyBannerText}</span>
    </div>
  {/if}

  <!-- Marker overlay: date-anchored vertical lines (calendar markers + the
       generated today line), reparented into SVAR's own chart content area so
       they scroll with it and survive every zoom level. -->
  {#if markerEntries.length > 0}
    <div class="og-marker-overlay" {@attach hostInChartArea}>
      {#each markerEntries as entry (entry.id)}
        <div
          class="og-marker"
          class:og-marker-today={entry.isToday}
          style="left:{entry.xFraction * 100}%; --og-marker-color:{entry.color};"
          title={entry.title}
          data-og-marker={entry.isToday ? 'today' : entry.label}
        >
          <span class="og-marker-label" style="top:{entry.stackIndex * 26}px">{entry.label}</span>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Calendar-status banner: multi-calendar display, conflicts, invalid
       calendar notes, unresolved selection links. A button, not a passive
       status line — it is the picker's in-view shortcut. -->
  {#if calendarNotice && onOpenCalendarPicker}
    <button
      type="button"
      class="og-readonly-banner og-calendar-banner"
      onclick={() => onOpenCalendarPicker?.()}
    >
      <span class="og-readonly-icon" use:lucideIcon={'calendar-days'}></span>
      <span class="og-readonly-text">{calendarNotice} — click to manage</span>
    </button>
  {/if}

  <!-- Invalid date-mapping notice (U4/R-C): a configured start/end property
       isn't a writable TaskNotes date field, so it fell back to the default. -->
  {#if dateMappingNotice}
    <div class="og-readonly-banner" role="status">
      <span class="og-readonly-icon" use:lucideIcon={'alert-triangle'}></span>
      <span class="og-readonly-text">{dateMappingNotice}</span>
    </div>
  {/if}

  <!-- Retained incomplete-date-parent notice (#161 U8/R8): a date filter is OFF but
       some undated/partial-date parents stay visible because a dated child keeps them. -->
  {#if retainedAncestorNotice}
    <div class="og-readonly-banner" role="status">
      <span class="og-readonly-icon" use:lucideIcon={'info'}></span>
      <span class="og-readonly-text">{retainedAncestorNotice}</span>
    </div>
  {/if}

  <div class="gtcell" bind:this={chartHostEl}>
    <div
      class="og-chart-surface"
      inert={legendLayout === 'full'}
      aria-hidden={legendLayout === 'full' ? 'true' : undefined}
    >
    <!-- Full screen = "maximize within Obsidian" (plan 2026-06-30-002): the view
         root carries `.is-maximized` (CSS below) to fill the Obsidian window in
         Obsidian's own stacking context, so popups (Edit Modal, command palette,
         menus) render above the chart instead of being hidden behind the native
         top layer. The floating toggle + zoom controls are children of `.gtcell`
         (inside the maximized container), so they stay visible while maximized. -->
      <!-- tasks/links/taskTypes are seeded ONCE; data changes are applied as
           targeted api.exec actions (diff-sync $effect above) so SVAR never
           re-inits its store and the user's zoom/scroll/selection survive. -->
      <!-- Tooltip surfaces dependencies (reltype + gap) from custom.incomingDeps:
           every incoming edge on the dependent task, and the single edge a
           reader points at on that edge itself. Falls back to the task name for
           tasks with no dependencies. -->
      <Tooltip {api} content={DependencyTooltip} touch={tooltipHoverCapable}>
        <!-- taskTemplate renders the bar's content (text + optional icon chip via
             BarContent). Passed as a STABLE prop set once at mount — SVAR's
             reinitStore does not read taskTemplate, so this never re-inits the
             store. When barIcon is 'none' BarContent renders a pristine
             `.wx-content` (no chip), so the default path is visually unchanged. -->
        <Gantt
          init={initGantt}
          tasks={initialTasks}
          taskTypes={svarTaskTypes}
          taskTemplate={BarContent}
          links={initialLinks}
          {columns}
          gridWidth={initialGridWidth}
          zoom={zoomConfig}
          cellWidth={seedCellWidth}
          highlightTime={svarHighlightTime}
          readonly={svarReadonly}
        />
      </Tooltip>

    <!-- Floating controls (OG-81 zoom + U7 collapse-all). Two separate pills in a
         bottom-right stack with a small gap between them — the collapse/expand
         toggle is visually distinct from the zoom +/− set, while +/− stay flush. -->
    <div class="zoom-controls-stack">
      <!-- Focus on task (search → expand → zoom → scroll → highlight). Opens a
           fuzzy search over the chart's tasks; the same opener backs the
           "Gantt: Focus on task…" command. Lucide `crosshair` (wxi-* disabled). -->
      <div class="zoom-controls">
        <button
          class="zoom-btn og-focus-btn"
          onclick={openFocusModal}
          aria-label="Focus on task"
          title="Focus on task"
        >
          <span class="zoom-icon" use:lucideIcon={'crosshair'}></span>
        </button>
      </div>
      <!-- Reset ephemeral column sort (plan 2026-06-22-002, U3/R5). Shown ONLY
           while an ephemeral sort is active; clicking restores the Base order
           (same path as the third header click). SVAR's lit column-header arrow
           is the active-column cue, so no extra banner. Lucide `list-restart`
           (wxi-* fonts are disabled). -->
      {#if ephemeralSort}
        <div class="zoom-controls">
          <button
            class="zoom-btn reset-sort"
            onclick={clearEphemeralSort}
            aria-label="Reset to Base sort"
            title="Reset to Base sort"
          >
            <span class="zoom-icon" use:lucideIcon={'list-restart'}></span>
          </button>
        </div>
      {/if}
      <!-- Collapse-all / expand-all (U7). Hidden when the tree has no parents
           (nothing to collapse). Lucide icons render (wxi-* fonts are disabled). -->
      {#if parentInstanceIds.size > 0}
        <div class="zoom-controls">
          <button
            class="zoom-btn collapse-all"
            onclick={toggleAllCollapse}
            aria-label={allCollapsed ? 'Expand all' : 'Collapse all'}
            title={allCollapsed ? 'Expand all' : 'Collapse all'}
          >
            <span
              class="zoom-icon"
              use:lucideIcon={allCollapsed ? 'chevrons-up-down' : 'chevrons-down-up'}
            ></span>
          </button>
        </div>
      {/if}
      <div class="zoom-controls">
        <button
          class="zoom-btn zoom-in"
          onclick={() => stepZoom(1)}
          aria-label="Zoom in"
          title="Zoom in"
        >
          <span class="zoom-icon" use:lucideIcon={'plus'}></span>
        </button>
        <button
          class="zoom-btn zoom-out"
          onclick={() => stepZoom(-1)}
          aria-label="Zoom out"
          title="Zoom out"
        >
          <span class="zoom-icon" use:lucideIcon={'minus'}></span>
        </button>
      </div>
    </div>
    <!-- Floating full-screen toggle, rendered as a child of `.gtcell` so it stays
         visible while maximized (it used to be rendered by SVAR's <Fullscreen>). -->
    {@render maximizeToggle(toggleMaximize, isMaximized)}
    <button
      bind:this={legendTriggerEl}
      type="button"
      class="og-legend-toggle"
      onclick={openLegend}
      aria-label="Legend"
      title="Legend"
      aria-expanded={legendSession.open}
    >
      <span class="og-legend-toggle-icon" aria-hidden="true" use:lucideIcon={'book-open'}></span>
    </button>
    </div>

    {#if legendSession.open && legendLayout}
      <GanttLegend
        groups={legendGroups}
        layout={legendLayout}
        position={legendSession.position}
        onPositionChange={moveLegend}
        onDismiss={() => { void closeLegend(); }}
      />
    {/if}
  </div>

  <!-- Editing is delegated to native TaskNotes (U2): no custom editor modal.
       Left/double-click and right-click on bars route through onBarActivate /
       onBarContextMenu to the TaskNotes interaction service. -->
{/snippet}

<!-- Our floating full-screen button. `toggle` enters/exits maximize; `inFull`
     reflects state (icon + label, R5). The label stays "Full screen" — the mode
     is now window-maximize, not OS fullscreen, but the affordance is unchanged.
     Always visible on the chart, independent of the optional theme toolbar. -->
{#snippet maximizeToggle(toggle: MaximizeToggleAction, inFull: boolean)}
  <button
    class="og-fullscreen-toggle"
    onclick={toggle}
    aria-label={inFull ? 'Exit full screen' : 'Full screen'}
    title={inFull ? 'Exit full screen' : 'Full screen'}
    aria-pressed={inFull}
  >
    <span class="og-fullscreen-icon" use:lucideIcon={inFull ? 'minimize' : 'maximize'}></span>
  </button>
{/snippet}

<style>
  .og-bases-gantt {
    width: 100%;
    /* No explicit height here: the computed chart height is applied to
       `.og-chart-area` (plan 003 U2 / collapse-clip fix), so this outer container
       sizes to its content — the optional toolbar/banners plus the chart region.
       Applying the chart height here instead made chrome subtract from the chart,
       clipping a single collapsed root. (When maximized, the `.is-maximized` rule
       below makes this container fixed/full-window and `.og-chart-area`'s inline
       height switches to 100% so the chart fills it.) */
    /* Column layout so the toolbar stacks above the chart region. */
    display: flex;
    flex-direction: column;
    /* Use Obsidian's font stack since we disabled SVAR fonts */
    font-family: var(--font-interface), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }

  /* Maximize within Obsidian (plan 2026-06-30-002): the view root is promoted to
     fill the Obsidian window in Obsidian's OWN stacking context — NOT the native
     browser top layer — so Obsidian's popups (Edit Modal, command palette, menus,
     suggesters, Notices) render above it. The z-index is anchored to Obsidian's
     `--layer-modal` token and sits just beneath it, so modals/menus/notices/
     tooltips (all at or above --layer-modal) stay on top and the value tracks any
     theme override of the modal layer rather than a hardcoded literal. Removing
     the class fully restores the embedded layout (no residual style). */
  .og-bases-gantt.is-maximized {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    /* Fallback keeps a valid z-index if a theme leaves --layer-modal unset:
       calc() over an undefined var is invalid and collapses to `auto`, which (as
       the last body child) could paint ABOVE modals — the opposite of the goal. */
    z-index: calc(var(--layer-modal, 100) - 1);
    background-color: var(--background-primary);
  }

  /* SVAR theme component host: fills the remaining height below the toolbar
     (flex child, min-height:0 so it can shrink within the flex column rather
     than overflow). The <Willow>/<WillowDark> render their own
     `<div class="wx-theme wx-willow-theme" style="height:100%">` inside this. */
  .og-chart-area {
    /* Height is set inline (plan 003 U2 / collapse-clip fix): this region owns
       the computed chart height so the toolbar/banners sit above it rather than
       eating into it. `flex: none` so the flex column never shrinks it below the
       explicit height. */
    flex: none;
    min-height: 0;
  }

  /* While maximized the chart area takes the height LEFT after the optional
     toolbar/banners (not the full viewport), so the toolbar stacked above it
     can't push the timeline + zoom controls off the bottom. `flex: 1 1 0` in the
     fixed-height `.is-maximized` column gives it a definite computed height that
     SVAR's height:100% chain still resolves against. */
  .og-bases-gantt.is-maximized .og-chart-area {
    flex: 1 1 0;
    min-height: 0;
  }

  .gtcell {
    /* No toolbar to reserve space for — the chart fills the view. (Any banner
       sits above and pushes the chart down naturally.) */
    height: 100%;
    /* Position relative for floating zoom controls (OG-81) */
    position: relative;
  }

  .og-chart-surface {
    position: relative;
    width: 100%;
    height: 100%;
  }

  /* Row drag-reorder is vetoed at the store (move-task intercept), but SVAR's
     drag helper still builds a floating row clone at drag time — hide it so a
     blocked drag shows nothing instead of a ghost that snaps back. Only the
     clone ever carries this class here: the row variant is store-driven and the
     veto keeps it from being applied. */
  .og-bases-gantt :global(.wx-table .wx-reorder-task) {
    display: none !important;
  }

  /* OG-79: Touch device scroll fix for drag-and-drop */
  /* Chart container: allow normal scroll/pan on empty timeline space */
  .og-bases-gantt :global(.wx-chart) {
    touch-action: auto;
  }

  /* Bars: block browser gestures, let SVAR handle drag/resize */
  .og-bases-gantt :global(.wx-bar) {
    touch-action: none;
  }

  /* Floating controls stack (OG-81 zoom + U7 collapse-all), bottom-right. The
     `gap` separates the collapse/expand pill from the zoom pill; within each pill
     the buttons stay flush (so zoom +/− have no gap between them). */
  .zoom-controls-stack {
    position: absolute;
    bottom: 16px;
    right: 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    z-index: 100;
  }

  /* U5 — resizer chevron occlusion. SVAR's grid Resizer is z-index:10
     (Resizer.svelte), below this floating control stack (z-index:100), so when
     the divider sits near the right edge its expand/collapse chevron paints
     BEHIND the controls and can't be grabbed. Lift the resizer just above the
     controls so the chevron stays reachable. Trade-off: where the divider
     overlaps the stack the thin resizer bar sits on top — acceptable since the
     bar is a few px and the chevron is the interactive target. The three-class
     selector (.og-bases-gantt + .wx-resizer.wx-resizer-x) outranks SVAR's scoped
     .wx-resizer rule so no !important is needed. */
  .og-bases-gantt :global(.wx-resizer.wx-resizer-x) {
    z-index: 101;
  }

  /* Each control pill - Google Maps style (OG-81). */
  .zoom-controls {
    display: flex;
    flex-direction: column;
    border-radius: 4px;
    overflow: hidden;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }

  .zoom-btn {
    /* Force consistent square shape across all devices */
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    min-width: 40px;
    min-height: 40px;
    max-width: 40px;
    max-height: 40px;
    padding: 0;
    margin: 0;
    border: none;
    border-radius: 0;
    background-color: #ffffff;
    color: #5f6368;
    cursor: pointer;
    /* Remove all default styling that might cause circles */
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    box-sizing: border-box;
  }

  /* Only style change on click/active - no hover effects for mobile consistency */
  .zoom-btn:active {
    background-color: #e0e0e0;
  }

  /* Container for Lucide icon (OG-81) */
  .zoom-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    pointer-events: none;
  }

  /* Floating full-screen toggle (plan 003 U4): top-right, clear of the
     bottom-right zoom controls. Always visible on the chart. */
  .og-fullscreen-toggle {
    position: absolute;
    top: 16px;
    right: 16px;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    padding: 0;
    margin: 0;
    border: none;
    border-radius: 4px;
    background-color: #ffffff;
    color: #5f6368;
    cursor: pointer;
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    box-sizing: border-box;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }

  .og-fullscreen-toggle:active {
    background-color: #e0e0e0;
  }

  .og-fullscreen-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    pointer-events: none;
  }

  .og-legend-toggle {
    position: absolute;
    top: 64px;
    right: 16px;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    min-width: 40px;
    min-height: 40px;
    max-width: 40px;
    max-height: 40px;
    padding: 0;
    margin: 0;
    border: none;
    border-radius: 4px;
    background-color: #ffffff;
    color: #5f6368;
    cursor: pointer;
    appearance: none;
    box-sizing: border-box;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }

  .og-legend-toggle:active { background-color: #e0e0e0; }
  .og-legend-toggle:focus-visible {
    outline: 2px solid var(--interactive-accent);
    outline-offset: 2px;
  }
  .og-legend-toggle-icon { display: flex; width: 18px; height: 18px; pointer-events: none; }
  .og-legend-toggle-icon :global(svg) { width: 18px; height: 18px; stroke: currentColor; }

  /* Style the Lucide SVG injected by Obsidian's setIcon (OG-81) */
  .zoom-icon :global(svg) {
    width: 18px;
    height: 18px;
    stroke: #5f6368;
    fill: none;
    stroke-width: 2;
  }

  .zoom-in {
    border-bottom: 1px solid #dadce0;
  }

  /* OG-79: Touch device scroll fix for drag-and-drop */
  /* Chart container: allow normal scroll/pan on empty timeline space */
  .og-bases-gantt :global(.wx-chart) {
    touch-action: auto;
  }

  /* Bars: block browser gestures, let SVAR handle drag/resize */
  .og-bases-gantt :global(.wx-bar) {
    touch-action: none;
  }

  /* Replace SVAR icons with Lucide-style SVG icons */
  .og-bases-gantt :global(.wx-icon) {
    display: inline-block;
    width: 16px;
    height: 16px;
    vertical-align: middle;
    background-size: contain;
    background-repeat: no-repeat;
    background-position: center;
  }

  /* Common toolbar icons using CSS-based SVG */
  .og-bases-gantt :global(.wx-icon.wxi-plus)::before {
    content: "";
    display: block;
    width: 100%;
    height: 100%;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12h14'/%3E%3Cpath d='m12 5 0 14'/%3E%3C/svg%3E");
  }

  .og-bases-gantt :global(.wx-icon.wxi-edit)::before {
    content: "";
    display: block;
    width: 100%;
    height: 100%;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z'/%3E%3Cpath d='m15 5 4 4'/%3E%3C/svg%3E");
  }

  .og-bases-gantt :global(.wx-icon.wxi-delete)::before {
    content: "";
    display: block;
    width: 100%;
    height: 100%;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 6h18'/%3E%3Cpath d='M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6'/%3E%3Cpath d='M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2'/%3E%3C/svg%3E");
  }

  .og-bases-gantt :global(.wx-icon.wxi-zoom-in)::before {
    content: "";
    display: block;
    width: 100%;
    height: 100%;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cpath d='m21 21-4.35-4.35'/%3E%3Cpath d='M11 8v6'/%3E%3Cpath d='M8 11h6'/%3E%3C/svg%3E");
  }

  .og-bases-gantt :global(.wx-icon.wxi-zoom-out)::before {
    content: "";
    display: block;
    width: 100%;
    height: 100%;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cpath d='m21 21-4.35-4.35'/%3E%3Cpath d='M8 11h6'/%3E%3C/svg%3E");
  }

  /*
   * Link-delete button glyph. SVAR renders the dependency-delete control as
   * `<i class="wxi-close wx-delete-button-icon">` inside a danger Button
   * ([Bars.svelte] chart component). With `<Willow fonts={false}>` the wxi
   * webfont is disabled, and `wxi-close` is not among the `.wx-icon.wxi-*`
   * re-implementations above (the delete `<i>` carries no `.wx-icon` class), so
   * without this rule the button shows as a blank red square — the "no visible
   * X" delete bug. White stroke to read against the danger-red button fill.
   */
  .og-bases-gantt :global(.wx-delete-button-icon) {
    width: 14px;
    height: 14px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M18 6 6 18'/%3E%3Cpath d='m6 6 12 12'/%3E%3C/svg%3E");
    background-size: contain;
    background-repeat: no-repeat;
    background-position: center;
  }

  /* OG-82: Grid collapse/expand arrow icons for SVAR Resizer.
   *
   * SCOPED to `.wx-button-expand-content` — the Resizer's own container
   * ([Resizer.svelte]). Both the panel-collapse arrows AND the grid tree
   * expand/collapse toggle use the same `wxi-menu-right` class, so an unscoped
   * `.wxi-menu-right` selector would leak these rules onto the COLLAPSED tree
   * toggle (`<i class="wx-toggle-icon wxi-menu-right">`); scoping keeps the tree
   * toggle on its own themed `::before` path (see the `.wx-toggle-icon` /
   * `.wxi-menu-*::before` rules below).
   *
   * THEME-ADAPTIVE colour: the arrow sits on a chip painted
   * `background-color: var(--wx-gantt-border-color)`, which is light (#e6e6e6) in
   * Willow but dark (#384047) in WillowDark. A hardcoded gray stroke read fine on
   * the light chip but was ~1.74:1 (near-invisible) on the dark one. Stroke with
   * `currentColor` driven by `var(--text-normal)` (theme-adaptive: near-white in
   * dark, near-black in light; accent on hover) so the arrow reads clearly against
   * the chip in both — the same treatment as the tree toggle. */
  /* The chevron is painted on `::before` via an alpha MASK filled with
   * `background-color: currentColor` — NOT a `background-image` data-URI, whose
   * `currentColor` would paint black instead of inheriting `color`. The element
   * keeps SVAR's own chip background. `color` (below) drives the fill. */
  .og-bases-gantt :global(.wx-button-expand-content .wxi-menu-left) {
    display: inline-block;
    width: 20px;
    height: 20px;
    color: var(--text-normal);
  }
  .og-bases-gantt :global(.wx-button-expand-content .wxi-menu-left::before) {
    content: "";
    display: block;
    width: 20px;
    height: 20px;
    background-color: currentColor;
    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m15 18-6-6 6-6'/%3E%3C/svg%3E");
    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m15 18-6-6 6-6'/%3E%3C/svg%3E");
    -webkit-mask-size: contain;
    mask-size: contain;
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
    -webkit-mask-position: center;
    mask-position: center;
  }

  .og-bases-gantt :global(.wx-button-expand-content .wxi-menu-right) {
    display: inline-block;
    width: 20px;
    height: 20px;
    color: var(--text-normal);
  }
  .og-bases-gantt :global(.wx-button-expand-content .wxi-menu-right::before) {
    content: "";
    display: block;
    width: 20px;
    height: 20px;
    background-color: currentColor;
    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m9 18 6-6-6-6'/%3E%3C/svg%3E");
    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m9 18 6-6-6-6'/%3E%3C/svg%3E");
    -webkit-mask-size: contain;
    mask-size: contain;
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
    -webkit-mask-position: center;
    mask-position: center;
  }

  /* Hover recolours via currentColor — the ::before mask fill follows `color`. */
  .og-bases-gantt :global(.wx-button-expand-content .wxi-menu-left:hover),
  .og-bases-gantt :global(.wx-button-expand-content .wxi-menu-right:hover) {
    color: var(--interactive-accent);
  }

  /*
   * Grid header sort indicator (plan 2026-06-22-002): SVAR renders the active
   * sort direction as `<i class="wxi-arrow-up|down">` inside the header's
   * `.wx-sort`, but the wxi icon font is disabled (`fonts={false}`, CSP), so the
   * glyph is blank — the sort STATE is tracked (aria-sort flips) but there is no
   * visible cue. Render an inline-SVG chevron masked with the header text colour
   * (`currentColor`) so the active column + direction read in both light and dark
   * themes. Mask (not background-image) so it inherits the themed text colour;
   * Obsidian is Chromium, so `-webkit-mask` alpha masking is reliable.
   */
  .og-bases-gantt :global(.wx-sort .wxi-arrow-up),
  .og-bases-gantt :global(.wx-sort .wxi-arrow-down) {
    display: inline-block;
    width: 14px;
    height: 14px;
    background-color: currentColor;
    opacity: 0.8;
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
    -webkit-mask-position: center;
    mask-position: center;
    -webkit-mask-size: contain;
    mask-size: contain;
  }
  .og-bases-gantt :global(.wx-sort .wxi-arrow-up) {
    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m18 15-6-6-6 6'/%3E%3C/svg%3E");
    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m18 15-6-6-6 6'/%3E%3C/svg%3E");
  }
  .og-bases-gantt :global(.wx-sort .wxi-arrow-down) {
    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  }

  /* OG-82: Hide the decorative spike/arrow pseudo-elements from SVAR Resizer */
  .og-bases-gantt :global(.wx-button-expand-content::before),
  .og-bases-gantt :global(.wx-button-expand-content::after) {
    display: none !important;
  }

  /*
   * Bar-level date-status indicator. SVAR renders a custom task type as a bare
   * class on the bar element (`wx-bar … datestatus-flagged`), so we target
   * `.datestatus-flagged` directly. Swapped dates are its last consumer: an
   * accent fill so a bar that starts after it is due reads differently from a
   * sanely-dated one. The states describing an edge the user never authored are
   * signalled by the torn edge below instead, which composes with the bar's own
   * fill rather than replacing it.
   */
  .og-bases-gantt :global(.wx-bar.datestatus-flagged) {
    background-color: var(--og-date-status-fill) !important;
  }

  .og-bases-gantt :global(.wx-bar.datestatus-flagged .wx-content) {
    color: white !important;
  }

  /*
   * Non-authored-edge zigzag — a "torn" edge on the side whose date the user
   * never wrote. The teeth are cut OUT of the bar's painted body, so the signal
   * composes with any fill colour instead of competing with it.
   *
   * WHERE THE CUT LIVES. Never on `.wx-bar`. SVAR renders the dependency link
   * handles and the link-delete buttons as bar descendants positioned OUTSIDE
   * its border box, and paints hover/selection feedback on the host itself, so
   * a host-level mask would clip all of them away and break dependency
   * authoring. Instead a torn bar carries SVAR's own `wx-split` (stamped by
   * BarContent's token observer), so the host paints NOTHING by the library's
   * rule — no clipping, no clearing padding, no per-bar depth fitting. The
   * painted surface is whichever layer owns the bar's body under split
   * rendering: the `.og-bar-body` BarContent renders on a piece-less torn bar
   * (and on an occupancy overlay, where it is the plain span the recorded
   * pieces sit on), painting `--og-effective-fill`, or the outermost pieces of
   * a ghost/envelope bar, which carry their own fills. Each such surface takes
   * the teeth plus a solid middle; nothing paints beneath it, so no pixel
   * composites twice.
   *
   * HOW THE TEETH ARE DRAWN. One alpha-only conic-gradient tile per edge, as
   * wide as a tooth is deep and as tall as one period, repeated down that edge,
   * plus a solid layer over the untouched middle. The layers simply add up, so
   * an edge pair lists both tiles and needs no mask compositing.
   */
  .og-bases-gantt {
    /* The chip's clearance from the bar's leading edge, named so the torn
       inset can add to it instead of silently replacing it. */
    --og-bar-content-pad: 7px;
    --og-zigzag-period: 8px;
    /*
     * Half the period — how far the tile's 45° wedges reach into the body.
     * FIXED: nothing republishes it per bar. The host paints nothing under
     * split rendering, so there is no padding to fit inside a width budget;
     * narrow surfaces are held by the per-surface ceiling below instead.
     */
    --og-zigzag-depth: 4px;
    /*
     * A ceiling on how much of ONE SURFACE a single tooth may eat, applied
     * wherever the teeth are cut. Its only job is to keep a solid middle: a
     * split piece is narrower than the bar the depth was fitted to, and without
     * the ceiling its middle layer could size to zero and leave a column of
     * tooth tips. It sits above the share the bar template fits the depth by, so
     * on a full-width surface the fitted depth normally wins. It also engages on
     * a bar torn on a single side: those surfaces are placed against the padding
     * box while the depth is fitted to the border box, so once the bar narrows
     * to a few times its surviving border the ceiling cuts the shallower tooth —
     * sub-pixel territory, where erring shallow costs only a sliver of notch.
     * Percentages in `mask-size`
     * resolve against the element's own mask area, so it is genuinely per
     * surface — but ONLY when substituted there: a custom property holding
     * `min(var(--og-zigzag-depth), …)` would have the var() replaced on THIS
     * element, freezing the full-size depth into every descendant. So the
     * ceiling travels as a bare percentage and the `min()` is written at each
     * use site, where the per-bar depth is the one that gets substituted.
     */
    --og-zigzag-surface-ceiling: 40%;
    --og-zigzag-teeth-start: conic-gradient(
      from 0deg at 0px 50%,
      #0000 0deg 45deg,
      #000 45deg 135deg,
      #0000 135deg 360deg
    );
    --og-zigzag-teeth-end: conic-gradient(
      from 0deg at 100% 50%,
      #0000 0deg 225deg,
      #000 225deg 315deg,
      #0000 315deg 360deg
    );
    --og-zigzag-middle: linear-gradient(#000, #000);
  }

  .og-bases-gantt :global(.wx-bar > .og-bar-body) {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    /* The body only renders on a torn (wx-split) bar, whose host paints
       nothing — `inherit` would inherit that transparency. So it paints what
       the host WOULD have painted: the treatment's own body colour where one
       differs from the piece fill (strip modes, parent overrides), else the
       bar's published effective fill. */
    background-color: var(--og-host-body-fill, var(--og-effective-fill));
    border-radius: inherit;
  }

  /*
   * A border on the torn side would redraw the straight full-height edge the
   * cut just removed, and a rounded corner there rounds off the outermost
   * tooth tip. The split host's border is already zeroed below; the radius
   * zeroing still matters because the body inherits it.
   */
  .og-bases-gantt :global(.wx-bar:is(.datestatus-zigzag-start, .datestatus-zigzag-both)) {
    border-top-left-radius: 0 !important;
    border-bottom-left-radius: 0 !important;
  }
  .og-bases-gantt :global(.wx-bar:is(.datestatus-zigzag-end, .datestatus-zigzag-both)) {
    border-top-right-radius: 0 !important;
    border-bottom-right-radius: 0 !important;
  }

  /*
   * The host padding that used to inset the label past the teeth is gone, so a
   * torn bar insets its label itself. This reaches the label wherever the
   * branch puts it — a piece-bearing bar nests it inside the piece wrapper,
   * and the wrapper's mask does NOT stand in for the inset: a mask clips paint
   * at the notch but never moves the label, and the strip accent is a host
   * pseudo-element painted above the wrapper entirely. The clearance ADDS to
   * the ordinary chip inset (published as the content-pad property, so the
   * strip treatment's wider inset composes instead of competing) — a bare
   * depth would pull the chip closer to the edge than an untorn bar's.
   */
  .og-bases-gantt
    :global(.wx-bar:is(.datestatus-zigzag-start, .datestatus-zigzag-both) .wx-content) {
    padding-left: calc(
      var(--og-bar-content-pad) + min(var(--og-zigzag-depth), var(--og-zigzag-surface-ceiling))
    );
  }
  .og-bases-gantt
    :global(.wx-bar:is(.datestatus-zigzag-end, .datestatus-zigzag-both) .wx-content) {
    padding-right: min(var(--og-zigzag-depth), var(--og-zigzag-surface-ceiling));
  }

  /*
   * SVAR emits the progress wrapper before the bar template, so without a lift
   * the later body layer would paint over the progress fill.
   */
  .og-bases-gantt
    :global(
      .wx-bar:is(
          .datestatus-zigzag-start,
          .datestatus-zigzag-end,
          .datestatus-zigzag-both
        )
        > .wx-progress-wrapper
    ) {
    z-index: 1 !important;
  }
  .og-bases-gantt
    :global(
      .wx-bar:is(
          .datestatus-zigzag-start,
          .datestatus-zigzag-end,
          .datestatus-zigzag-both
        )
        > .og-ghost-runs.og-occupancy-overlay
    ) {
    /*
     * The overlay wrapper is cut with the bar below (see the whole-bar
     * surfaces), and a mask makes it a stacking context — so its children stop
     * competing individually with the bar's other layers. Lifting the whole
     * unit above SVAR's progress wrapper preserves the order they had while
     * they competed one by one: pieces and label over the progress fill.
     */
    z-index: 2;
  }

  /*
   * The strip treatment's accent is a host-level `::before`, so it sits outside
   * the masked layer and would paint straight over a leading torn edge. Start
   * it at the tooth depth instead; a bar with no strip has no `content` and is
   * unaffected.
   *
   * It is also a FIXED width while everything else here is fitted to the bar,
   * so on a bar too narrow to seat it the accent runs over the trailing notch
   * and out of the box SVAR laid out. Cap it at the room left between the teeth;
   * a negative result clamps to zero, which is the honest answer for a bar with
   * no room at all.
   */
  .og-bases-gantt
    :global(.wx-bar:is(.datestatus-zigzag-start, .datestatus-zigzag-both)::before) {
    left: min(var(--og-zigzag-depth), var(--og-zigzag-surface-ceiling)) !important;
  }
  /*
   * The accent and the duplicate-row hatch are host-level painters the piece
   * wrapper would otherwise cover: it became a stacking context when it took
   * the mask, and it sits later in tree order than the level the accent used to
   * win from. Lift both back above it, still under the link handles.
   */
  .og-bases-gantt
    :global(.wx-bar:is(.datestatus-zigzag-start, .datestatus-zigzag-end, .datestatus-zigzag-both)::before) {
    z-index: 3 !important;
  }
  .og-bases-gantt
    :global(.wx-bar:is(.datestatus-zigzag-start, .datestatus-zigzag-end, .datestatus-zigzag-both).og-replicated::after) {
    /*
     * The hatch only needs to beat the wrapper, and a generated `::after`
     * paints last within its own level — so matching the wrapper's level is
     * enough, and staying below the accent keeps the override dot and the
     * progress marker on top of the hatch rather than under it.
     */
    z-index: 2 !important;
  }
  .og-bases-gantt
    :global(.wx-bar:is(.datestatus-zigzag-start, .datestatus-zigzag-end)::before) {
    max-width: calc(100% - min(var(--og-zigzag-depth), var(--og-zigzag-surface-ceiling))) !important;
  }
  .og-bases-gantt :global(.wx-bar.datestatus-zigzag-both::before) {
    max-width: calc(100% - min(var(--og-zigzag-depth), var(--og-zigzag-surface-ceiling)) * 2) !important;
  }

  /*
   * THE PAINTED SURFACES take the teeth plus a solid middle, sized with the
   * per-surface ceiling: the torn body (plain and overlay bars), the progress
   * wrapper above it, the replication hatch — a host-level pseudo-element
   * spanning the bar, which would otherwise paint the notches back in exactly
   * as the strip accent would — the OUTERMOST piece of a ghost/envelope bar,
   * and the occupancy-overlay piece WRAPPER. The overlay's recorded pieces are
   * never cut individually (a piece's own edge is rarely the bar's — the cut
   * would grow a tooth column at the wrong x); its wrapper spans the bar, so
   * the teeth land at the bar's own x and everything inside (pieces, spine,
   * label) is held clear of the notch at once. The cut side also drops its
   * corner radius, or the outermost tooth tip is rounded off.
   *
   * `!important` throughout: SVAR's own styles are Svelte-hashed and out-specify
   * a plain injected rule, so an unweighted mask longhand can be switched off by
   * a library or theme rule and take the whole signal with it.
   */
  .og-bases-gantt :global(.wx-bar.datestatus-zigzag-start > .og-bar-body),
  .og-bases-gantt :global(.wx-bar.datestatus-zigzag-start > .wx-progress-wrapper),
  .og-bases-gantt :global(.wx-bar.datestatus-zigzag-start.og-replicated::after),
  .og-bases-gantt :global(.wx-bar.datestatus-zigzag-start > .og-ghost-runs.og-occupancy-overlay),
  .og-bases-gantt
    :global(
      .wx-bar.datestatus-zigzag-start.wx-split
        .og-ghost-runs:not(.og-occupancy-overlay)
        :is(.og-ghost-run, .og-instance).og-piece-first
    ),
  .og-bases-gantt
    :global(
      .wx-bar.datestatus-zigzag-both.wx-split
        .og-ghost-runs:not(.og-occupancy-overlay)
        :is(.og-ghost-run, .og-instance).og-piece-first:not(.og-piece-last)
    ) {
    -webkit-mask-image: var(--og-zigzag-teeth-start), var(--og-zigzag-middle) !important;
    mask-image: var(--og-zigzag-teeth-start), var(--og-zigzag-middle) !important;
    -webkit-mask-size: min(var(--og-zigzag-depth), var(--og-zigzag-surface-ceiling)) var(--og-zigzag-period),
      calc(100% - min(var(--og-zigzag-depth), var(--og-zigzag-surface-ceiling))) 100% !important;
    mask-size: min(var(--og-zigzag-depth), var(--og-zigzag-surface-ceiling)) var(--og-zigzag-period),
      calc(100% - min(var(--og-zigzag-depth), var(--og-zigzag-surface-ceiling))) 100% !important;
    -webkit-mask-position: left top, right top !important;
    mask-position: left top, right top !important;
    -webkit-mask-repeat: repeat-y, no-repeat !important;
    mask-repeat: repeat-y, no-repeat !important;
    border-top-left-radius: 0 !important;
    border-bottom-left-radius: 0 !important;
  }

  .og-bases-gantt :global(.wx-bar.datestatus-zigzag-end > .og-bar-body),
  .og-bases-gantt :global(.wx-bar.datestatus-zigzag-end > .wx-progress-wrapper),
  .og-bases-gantt :global(.wx-bar.datestatus-zigzag-end.og-replicated::after),
  .og-bases-gantt :global(.wx-bar.datestatus-zigzag-end > .og-ghost-runs.og-occupancy-overlay),
  .og-bases-gantt
    :global(
      .wx-bar.datestatus-zigzag-end.wx-split
        .og-ghost-runs:not(.og-occupancy-overlay)
        :is(.og-ghost-run, .og-instance).og-piece-last
    ),
  .og-bases-gantt
    :global(
      .wx-bar.datestatus-zigzag-both.wx-split
        .og-ghost-runs:not(.og-occupancy-overlay)
        :is(.og-ghost-run, .og-instance).og-piece-last:not(.og-piece-first)
    ) {
    -webkit-mask-image: var(--og-zigzag-teeth-end), var(--og-zigzag-middle) !important;
    mask-image: var(--og-zigzag-teeth-end), var(--og-zigzag-middle) !important;
    -webkit-mask-size: min(var(--og-zigzag-depth), var(--og-zigzag-surface-ceiling)) var(--og-zigzag-period),
      calc(100% - min(var(--og-zigzag-depth), var(--og-zigzag-surface-ceiling))) 100% !important;
    mask-size: min(var(--og-zigzag-depth), var(--og-zigzag-surface-ceiling)) var(--og-zigzag-period),
      calc(100% - min(var(--og-zigzag-depth), var(--og-zigzag-surface-ceiling))) 100% !important;
    -webkit-mask-position: right top, left top !important;
    mask-position: right top, left top !important;
    -webkit-mask-repeat: repeat-y, no-repeat !important;
    mask-repeat: repeat-y, no-repeat !important;
    border-top-right-radius: 0 !important;
    border-bottom-right-radius: 0 !important;
  }

  /* Both edges — including a split bar rendered as one single piece, which is
     simultaneously the first and the last piece. */
  .og-bases-gantt :global(.wx-bar.datestatus-zigzag-both > .og-bar-body),
  .og-bases-gantt :global(.wx-bar.datestatus-zigzag-both > .wx-progress-wrapper),
  .og-bases-gantt :global(.wx-bar.datestatus-zigzag-both.og-replicated::after),
  .og-bases-gantt :global(.wx-bar.datestatus-zigzag-both > .og-ghost-runs.og-occupancy-overlay),
  .og-bases-gantt
    :global(
      .wx-bar.datestatus-zigzag-both.wx-split
        .og-ghost-runs:not(.og-occupancy-overlay)
        :is(.og-ghost-run, .og-instance).og-piece-first.og-piece-last
    ) {
    -webkit-mask-image: var(--og-zigzag-teeth-start), var(--og-zigzag-teeth-end),
      var(--og-zigzag-middle) !important;
    mask-image: var(--og-zigzag-teeth-start), var(--og-zigzag-teeth-end),
      var(--og-zigzag-middle) !important;
    -webkit-mask-size: min(var(--og-zigzag-depth), var(--og-zigzag-surface-ceiling)) var(--og-zigzag-period),
      min(var(--og-zigzag-depth), var(--og-zigzag-surface-ceiling)) var(--og-zigzag-period),
      calc(100% - min(var(--og-zigzag-depth), var(--og-zigzag-surface-ceiling)) * 2) 100% !important;
    mask-size: min(var(--og-zigzag-depth), var(--og-zigzag-surface-ceiling)) var(--og-zigzag-period),
      min(var(--og-zigzag-depth), var(--og-zigzag-surface-ceiling)) var(--og-zigzag-period),
      calc(100% - min(var(--og-zigzag-depth), var(--og-zigzag-surface-ceiling)) * 2) 100% !important;
    -webkit-mask-position: left top, right top, center top !important;
    mask-position: left top, right top, center top !important;
    -webkit-mask-repeat: repeat-y, repeat-y, no-repeat !important;
    mask-repeat: repeat-y, repeat-y, no-repeat !important;
    border-radius: 0 !important;
  }

  /*
   * U5/R7: TaskNotes progress mode is a read-only computed value, so hide the
   * bar's progress drag handle (`.wx-progress-marker`) and make the progress
   * region non-interactive. Date drag/resize (a different handle) is unaffected.
   * Scoped to the `.og-progress-readonly` root class the view toggles from
   * GanttData.progressReadonly — property mode leaves the handle draggable.
   */
  .og-bases-gantt.og-progress-readonly :global(.wx-progress-marker) {
    display: none !important;
  }

  .og-bases-gantt.og-progress-readonly :global(.wx-progress-wrapper) {
    pointer-events: none;
  }

  /*
   * Read-only calendar-item event rows. SVAR emits the registered
   * `og-event` task type as a bare class on the bar, so hide the mutating
   * affordances the intercepts refuse anyway — link handles and the progress
   * drag handle — and keep the cursor honest: SVAR writes `cursor` inline on
   * hover, so only !important outranks it.
   */
  .og-bases-gantt :global(.wx-bar.og-event .wx-link) {
    display: none !important;
  }

  .og-bases-gantt :global(.wx-bar.og-event .wx-progress-marker) {
    display: none !important;
  }

  /*
   * The bar's effective fill, defined once; every surface that paints a bar's
   * body derives from it. Declared on the consuming elements themselves — NOT
   * on the root — because var() substitutes at the declaring element: a
   * root-level declaration would freeze the no-treatment default into every
   * bar, while each of these elements carries (or inherits from an ancestor
   * that carries) its own --og-ghost-fill. The piece selectors matter: legend
   * occurrence samples are .og-instance elements with their ghost fill inline
   * on themselves (bar-kind) or inherited from their pieces wrapper, with no
   * .wx-bar in their ancestry, so a bar-only definition would leave them
   * invalid-at-computed-value-time. Contract for
   * consumers: "the colour a surface paints when it paints this bar's body"
   * — valid only under .og-bases-gantt. Deliberate non-derivers: the series
   * spine (the accent fallback is its point), the legend bar-sample default
   * and the representative-colour string (tail-only values), and the legend
   * strip-only rule, which keeps a chart-equal fallback so a legend mounted
   * outside a chart still paints.
   */
  .og-bases-gantt :global(:is(.wx-bar, .og-ghost-run, .og-instance)) {
    --og-effective-fill: var(--og-ghost-fill, var(--wx-gantt-task-color, #3d8de6));
  }

  .og-bases-gantt :global(.wx-bar.og-event) {
    background-color: var(--og-event-color, var(--og-effective-fill)) !important;
    cursor: default !important;
  }

  .og-bases-gantt :global(.wx-bar.og-event[data-og-source-colored]) {
    color: var(--text-on-accent, #fff) !important;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  }

  /*
   * Occupancy (recurring) rows render DERIVED bar geometry — the envelope of
   * their instances — so the intercepts refuse drag/resize and link gestures.
   * Hide the link handles and keep the cursor honest, exactly like og-event
   * above; the progress marker stays (progress is not geometry).
   */
  .og-bases-gantt :global(.wx-bar.og-recurring .wx-link) {
    display: none !important;
  }

  .og-bases-gantt :global(.wx-bar.og-recurring) {
    cursor: default !important;
  }

  /*
   * Weekend shading off-state. The highlightTime seed fn always classifies
   * (swapping it would re-init SVAR's store); this class-gate suppresses the
   * visuals instead, so the toggle is live with zoom/scroll intact. SVAR's
   * scoped styles set BOTH background and color on `.wx-weekend` (chart-body
   * cells and scale-header cells) — reset both, or header labels stay tinted.
   */
  .og-bases-gantt.og-weekends-off :global(.wx-weekend) {
    background: transparent !important;
    color: inherit !important;
  }

  /*
   * Working-time ghost bars (shared substrate with the split-task follow-up).
   * The host bar carries SVAR's own `wx-split` class (stamped by BarContent),
   * which arms the library's transparent rule; the transparent override also
   * outranks any generated fill-treatment rule (higher specificity, both
   * !important), so the pieces below are the bar's only visible body. SVAR
   * suppresses its whole-bar progress wrapper only when its Pro splitTasks
   * flag is on, so the community build needs the explicit suppression rule.
   */
  .og-bases-gantt :global(.wx-bar.wx-split) {
    background-color: transparent !important;
  }
  /*
   * A strip-mode bar carries stripBodyRule's 1px border; on a ghost (split) host
   * the runs fill the content box inset by that border, leaving a 1px halo around
   * the pieces. Drop the border so the runs meet the bar's edge. A non-split
   * strip bar keeps its outline regardless. Knowingly suppressed as a side
   * effect: SVAR's split-bar selection feedback, which is drawn as a host
   * border-colour change and so has no width to paint here.
   */
  .og-bases-gantt :global(.wx-bar.wx-split) {
    border: 0 !important;
    /* SVAR supplies the label colour from the same `:not(.wx-split)` rule as
       the background it steps aside from, so a split bar with no treatment
       colour of its own would fall back to the chart's text colour on a
       coloured body. Unweighted, so every treatment's own `!important`
       colour still wins. */
    color: var(--wx-gantt-task-font-color);
  }
  /*
   * Ghost/envelope pieces replace the bar's body, so SVAR's full-span progress
   * fill painted across their gaps would lie — hide it there. A torn bar with
   * no piece surfaces (plain, or an occupancy OVERLAY whose pieces sit on the
   * painted body) keeps SVAR's own progress: it renders above the cut body and
   * carries the teeth mask like every whole-bar surface.
   */
  .og-bases-gantt
    :global(.wx-bars .wx-bar.wx-split:has(> .og-ghost-runs:not(.og-occupancy-overlay)) > .wx-progress-wrapper) {
    display: none;
  }
  /*
   * SVAR guards its hover shadow and selected border behind `:not(.wx-split)`,
   * and the split border is zeroed above — so a torn (split) bar would lose
   * both cues. Restore them from SVAR's own variable; the shadow needs no
   * border width, so it survives the zeroed border.
   */
  .og-bases-gantt
    :global(
      .wx-bar.wx-split:is(
          .datestatus-zigzag-start,
          .datestatus-zigzag-end,
          .datestatus-zigzag-both
        ):hover
    ),
  .og-bases-gantt
    :global(
      .wx-bar.wx-split:is(
          .datestatus-zigzag-start,
          .datestatus-zigzag-end,
          .datestatus-zigzag-both
        ).wx-selected
    ) {
    box-shadow: var(--wx-gantt-bar-shadow);
  }
  .og-bases-gantt :global(.og-ghost-runs) {
    position: relative;
    width: 100%;
    height: 100%;
  }
  .og-bases-gantt :global(.og-ghost-run) {
    position: absolute;
    top: 0;
    height: 100%;
    box-sizing: border-box;
    /* Inherit the fill treatment's colour when one applies (set as
       --og-ghost-fill on the treated bar); default task colour otherwise. */
    background-color: var(--og-effective-fill);
    border-radius: var(--wx-gantt-bar-border-radius, 2px);
  }
  /* Blocked stretches: the 15% ghost — the shaded background reads through. */
  .og-bases-gantt :global(.og-ghost-run.og-ghost-blocked) {
    opacity: 0.15;
  }
  .og-bases-gantt :global(.og-ghost-label) {
    position: relative;
    z-index: 2;
  }

  /*
   * Recurring-instance occupancy pieces (calendar-view union): one whole-day
   * piece per instance inside the row's envelope; the gaps stay unpainted so
   * the non-working shading reads through. Colours are theme variables
   * (accent + backgrounds), so every state reads in light and dark. The base
   * fill follows the bar's treatment (--og-ghost-fill) like the ghost pieces.
   */
  .og-bases-gantt :global(.og-instance) {
    position: absolute;
    top: 0;
    height: 100%;
    box-sizing: border-box;
    border-radius: var(--wx-gantt-bar-border-radius, 2px);
    background-color: var(--og-effective-fill);
    z-index: 1;
  }
  /* Next: the one upcoming instance — solid accent, the row's anchor. */
  .og-bases-gantt :global(.og-instance-next) {
    background-color: var(--interactive-accent);
  }
  /* Projected: future pattern instances — hollow dashed outline, no claim. The
     dashed pattern alone reads as tentative, so it stays at full strength (no
     dimming) for contrast; border-box keeps the 2px stroke inside the cell. */
  .og-bases-gantt :global(.og-instance-projected) {
    background-color: transparent;
    border: 2px dashed var(--interactive-accent);
  }
  /* Completed: dimmed with a horizontal strike through the piece. */
  .og-bases-gantt :global(.og-instance-completed) {
    opacity: 0.35;
    background-image: linear-gradient(
      to bottom,
      transparent 45%,
      var(--background-primary) 45%,
      var(--background-primary) 55%,
      transparent 55%
    );
  }
  /* Skipped: muted hatching — was on the pattern, deliberately not done. */
  .og-bases-gantt :global(.og-instance-skipped) {
    opacity: 0.3;
    background-image: repeating-linear-gradient(
      45deg,
      transparent 0 3px,
      var(--background-primary) 3px 5px
    );
  }
  /* Materialized: its own note exists — outlined, and clickable to open it. */
  .og-bases-gantt :global(.og-instance-materialized) {
    background-color: transparent;
    border: 1.5px solid var(--interactive-accent);
    cursor: pointer;
  }
  /*
   * Plain: the task's own scheduled→due span, kept beside out-of-span recorded
   * pieces (the host under wx-split is transparent, so this piece IS the bar).
   * Painted like a normal task bar — the fill treatment threads via
   * --og-ghost-fill exactly as on the ghost pieces.
   */
  .og-bases-gantt :global(.og-instance-plain) {
    background-color: var(--og-effective-fill);
  }
  /*
   * External: one occurrence of a multi-occurrence series event row — a plain
   * calendar fact, not a task state, so the piece paints exactly like the
   * event bar itself: whatever colours the bar threads via --og-ghost-fill
   * (the ghost-piece convention), defaulting to the task colour.
   */
  .og-bases-gantt :global(.og-instance-external) {
    background-color: var(--og-effective-fill);
  }
  /*
   * Coarse-zoom fallback: a dashed series spine spanning first→last
   * instance — explicitly not a solid bar claiming continuous occupancy.
   * Follows the bar's own feed colour (--og-ghost-fill, like the ghost pieces)
   * so a coloured external series keeps its identity at coarse zoom; a plain
   * recurring row (no ghost fill) falls back to the accent.
   */
  .og-bases-gantt :global(.og-series-spine) {
    position: absolute;
    top: calc(50% - 1px);
    height: 0;
    border-top: 2px dashed var(--og-ghost-fill, var(--interactive-accent));
    z-index: 1;
  }

  /*
   * Per-task override indicator (R11): a small filled dot in the upper-left
   * corner of a bar whose effective Estimate meaning differs from the view
   * default. BarContent appends the `.og-override-dot` element to the host
   * `.wx-bar` (a real element so it can carry its own hover `title`).
   *
   * Colour: the dot can't reliably contrast with the fill, strip, AND timeline
   * background (all arbitrary), so it doesn't try — a `--background-primary`
   * halo (box-shadow ring) separates it from whatever is behind it, and the dot
   * then only has to contrast with that ring. Both colours are theme variables,
   * so it's correct in light and dark. Direction (working vs calendar) stays in
   * the tooltip + grid column, never a second on-bar mark.
   */
  .og-bases-gantt :global(.wx-bar .og-override-dot) {
    position: absolute;
    /* Centre the dot ON the bar's top-left corner: pin to (0,0) then shift up-left
       by half its own size. Half the dot overhangs the bar, so this relies on the
       bar not clipping the overhang. */
    top: 0;
    left: 0;
    transform: translate(-50%, -50%);
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background-color: var(--interactive-accent);
    box-shadow: 0 0 0 1.5px var(--background-primary);
    /* Hoverable (the `title` tooltip needs pointer events) but its pointerdown is
       stopped in BarContent so dragging the dot never reaches SVAR's start-resize
       handler at this corner — hover-to-inspect can't accidentally change dates. */
    z-index: 3;
  }

  /*
   * Instance cues (U6). SVAR emits a registered task type as a bare class on the
   * bar, so we target `.og-replicated` / `.og-context` directly (same hook as
   * `.datestatus-flagged`). CSS-only — SVAR's icon fonts are disabled, so no
   * glyph badges. Both treatments are deliberately subtle and stack (a bar can
   * be replicated AND context); tune the exact look here.
   *
   * Replicated: the same note shown in more than one place. A faint diagonal
   * hatch overlays every duplicate equally — none is privileged — without
   * overriding the bar's status colour. The ::after fills the absolutely-
   * positioned bar and ignores pointer events so drag/click still hit the bar.
   */
  .og-bases-gantt :global(.wx-bar.og-replicated)::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    border-radius: inherit;
    background-image: repeating-linear-gradient(
      45deg,
      rgba(255, 255, 255, 0.3) 0,
      rgba(255, 255, 255, 0.3) 2px,
      transparent 2px,
      transparent 6px
    );
  }

  /*
   * Context: a Show-all descendant that does not itself match the Base filter —
   * pulled in only to show structure. Render it muted so matched rows stay
   * visually dominant.
   */
  .og-bases-gantt :global(.wx-bar.og-context) {
    /* Driven by the per-view "Context bar opacity" slider (U6); the fallback
       matches DEFAULT_CONTEXT_OPACITY. */
    opacity: var(--og-context-opacity, 0.55);
  }

  /* Bar content layout (U7): BarContent renders `.wx-content` as a left-aligned
     flex row — the icon chip (if any) then the task text. `padding-left` clears
     the 6px strip so the chip never overlaps it (strip color mode draws a
     generated `.wx-bar.<slug>::before` accent — see barTreatment). */
  .og-bases-gantt :global(.wx-bar .wx-content) {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-left: var(--og-bar-content-pad);
  }
  .og-bases-gantt :global(.og-bar-text) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Icon chip: a NEUTRAL rounded-square box with a subtle theme-adaptive border.
     It isolates its contents (status ring / priority dot / glyph) from the bar
     colour in every mode. `flex: 0 0 auto` keeps it from shrinking, so on a narrow
     bar the text truncates first, not the chip. */
  .og-bases-gantt :global(.og-bar-chip) {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: 20px;
    height: 20px;
    border-radius: 5px;
    /* Always a light-gray chip regardless of light/dark theme, so the glyph/ring
       stays isolated and readable on any bar colour. Fixed (not a theme var). */
    background: #e9e9ec;
    border: 1px solid rgba(0, 0, 0, 0.15);
  }
  /* No-icon status → hollow ring (TaskNotes 2px, 50%); border-color set inline. */
  .og-bases-gantt :global(.og-bar-ring) {
    box-sizing: border-box;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    border: 3px solid currentColor;
  }
  /* No-icon COMPLETED status → filled disc (TaskNotes fills the status dot for a
     completed status). Same 13px footprint as the ring, so the status visibly
     "fills in" on completion; background set inline. */
  .og-bases-gantt :global(.og-bar-disc) {
    box-sizing: border-box;
    width: 13px;
    height: 13px;
    border-radius: 50%;
  }
  /* No-icon priority → filled dot (TaskNotes); background set inline. */
  .og-bases-gantt :global(.og-bar-dot) {
    width: 11px;
    height: 11px;
    border-radius: 50%;
  }
  /* Icon glyph (setIcon SVG): a fixed soft near-black in both themes (the chip is
     always light gray), rather than tinted per status — cleaner, higher contrast.
     Lucide icons stroke with currentColor, so setting `color` recolors the glyph. */
  .og-bases-gantt :global(.og-bar-glyph) {
    display: inline-flex;
    color: #2b2b2b;
  }
  .og-bases-gantt :global(.og-bar-glyph svg) {
    width: 13px;
    height: 13px;
  }

  /* SVAR expand/collapse toggle icons - ensure visibility */
  .og-bases-gantt :global(.wx-toggle-icon) {
    display: inline-block !important;
    width: 16px !important;
    height: 16px !important;
    /* Obsidian's primary text colour — theme-adaptive (near-white #dadada in dark,
     * near-black in light), so the chevron reads clearly against the chart
     * background in both. (--text-muted / SVAR's #9fa1ae both sit too dark on the
     * WillowDark surface.) Hover lifts to the theme accent. */
    color: var(--text-normal) !important;
    opacity: 1 !important;
    visibility: visible !important;
    font-size: 16px !important;
    line-height: 16px !important;
  }

  .og-bases-gantt :global(.wx-toggle-icon:hover) {
    color: var(--interactive-accent) !important;
  }

  /* Align leaf rows with parent rows. SVAR sizes BOTH the toggle-icon (parents)
   * and the toggle-placeholder (leaves) at var(--wx-icon-size) = 20px, keeping
   * their text aligned. The plugin narrows `.wx-toggle-icon` to 16px above but
   * leaves the placeholder at 20px, so leaf text sat 4px RIGHT of parent text
   * (i.e. parents looked shifted left). Match the placeholder to the 16px box. */
  .og-bases-gantt :global(.wx-toggle-placeholder) {
    width: 16px !important;
    min-width: 16px !important;
    flex: 0 0 16px !important;
  }

  /* Ensure SVAR icon fonts are loaded and visible */
  .og-bases-gantt :global(.wx-toggle-icon::before) {
    opacity: 1 !important;
    visibility: visible !important;
    display: inline-block !important;
    font-size: 16px !important;
    line-height: 16px !important;
  }

  /* Inject offline-friendly Lucide chevron icons using inline SVG.
   *
   * SCOPED to `.wx-toggle-icon` — the grid tree toggle's own class. SVAR reuses
   * `wxi-menu-right` for the Resizer's panel arrow too (`.wx-button-expand-content
   * .wxi-menu-right`), so an unscoped `.wxi-menu-right::before` here leaks a SECOND
   * chevron onto the Resizer arrow (which already draws its own) — a duplicate
   * glyph. Scoping to `.wx-toggle-icon` keeps these tree-only, mirroring the
   * Resizer rules' scoping above. */
  .og-bases-gantt :global(.wx-toggle-icon.wxi-menu-down),
  .og-bases-gantt :global(.wx-toggle-icon.wxi-menu-right) {
    display: inline-block !important;
    width: 16px !important;
    height: 16px !important;
    opacity: 1 !important;
    visibility: visible !important;
  }

  /* Lucide chevron-down, MASKED so the glyph takes the element's themed colour.
   * `currentColor` inside a `background-image` data-URI does NOT inherit the host
   * `color` (it paints black); an alpha `-webkit-mask` + `background-color:
   * currentColor` does. See the `.wx-sort` arrows for the same technique. */
  .og-bases-gantt :global(.wx-toggle-icon.wxi-menu-down::before) {
    content: '' !important;
    display: inline-block !important;
    width: 16px !important;
    height: 16px !important;
    background-color: currentColor !important;
    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") !important;
    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") !important;
    -webkit-mask-size: contain !important;
    mask-size: contain !important;
    -webkit-mask-repeat: no-repeat !important;
    mask-repeat: no-repeat !important;
    -webkit-mask-position: center !important;
    mask-position: center !important;
    opacity: 1 !important;
    visibility: visible !important;
  }

  /* Lucide chevron-right, MASKED (see chevron-down above). */
  .og-bases-gantt :global(.wx-toggle-icon.wxi-menu-right::before) {
    content: '' !important;
    display: inline-block !important;
    width: 16px !important;
    height: 16px !important;
    background-color: currentColor !important;
    -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m9 18 6-6-6-6'/%3E%3C/svg%3E") !important;
    mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m9 18 6-6-6-6'/%3E%3C/svg%3E") !important;
    -webkit-mask-size: contain !important;
    mask-size: contain !important;
    -webkit-mask-repeat: no-repeat !important;
    mask-repeat: no-repeat !important;
    -webkit-mask-position: center !important;
    mask-position: center !important;
    opacity: 1 !important;
    visibility: visible !important;
  }

  /* U7: Read-only banner (between toolbar and chart). One fixed line. */
  .og-readonly-banner {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    font-size: 12px;
    line-height: 16px;
    color: var(--text-muted);
    background: var(--background-secondary);
    border-bottom: 1px solid var(--background-modifier-border);
  }

  /* Marker overlay: absolutely positioned inside SVAR's chart content area
     (reparented there on mount), so lines track content scroll and full width.
     Non-interactive — it must never intercept a bar drag or a cell click. */
  /* Matches SVAR's own marker treatment (2px filled line, chip inheriting the
     line's colour, marker font/colour from its theme variables) so the
     hand-rolled overlay is indistinguishable from the library's. The one
     deliberate difference: SVAR extends its chip leftward from the line via a
     double scaleX(-1); ours centres on the line instead. */
  .og-marker-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
    /* SVAR draws its own markers at 4 — above the bars. */
    z-index: 4;
  }

  .og-marker {
    position: absolute;
    top: 0;
    height: 100%;
    width: 2px;
    user-select: none;
    background: var(--og-marker-color, var(--wx-gantt-marker-color));
  }

  /* The generated today line rides above authored markers when they collide. */
  .og-marker-today {
    z-index: 1;
  }

  .og-marker-label {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    padding: 4px 8px;
    border-radius: 4px;
    font: var(--wx-gantt-marker-font);
    color: var(--wx-gantt-marker-font-color, #fff);
    /* Inherited from the line, so chip and line always share one colour. */
    background-color: inherit;
    white-space: nowrap;
    /* The layer is inert so it can never swallow a bar drag, but the label
       itself must be hoverable — its title is the only place a collapsed
       group's members are listed. */
    pointer-events: auto;
    /* Tooltips carry the full text, so a label may be clipped, never wrapped. */
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* The calendar banner is a real button (the picker's shortcut) — strip the
     native button chrome so it reads as the same banner strip, with a cursor
     affordance for its click-through. */
  .og-calendar-banner {
    width: 100%;
    border: none;
    border-bottom: 1px solid var(--background-modifier-border);
    border-radius: 0;
    box-shadow: none;
    cursor: pointer;
    text-align: left;
    /* font-family only: the `font` shorthand would reset the size/line-height
       the shared banner class sets, so the two banners would not match. */
    font-family: inherit;
    color: inherit;
  }

  .og-readonly-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    flex: 0 0 14px;
  }

  .og-readonly-icon :global(svg) {
    width: 14px;
    height: 14px;
  }

  /* NOTE: CSS for the multi-parent duplicate-icon / has-dependencies cell
     indicators was removed alongside the deferred snippet-cell (see the markup
     comment). It returns with the dedicated SVAR cell component (follow-up). */
</style>
