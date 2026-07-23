<script lang="ts">
  /* global HTMLElement, HTMLStyleElement, Element, MouseEvent, KeyboardEvent, setTimeout, clearTimeout */
  // Willow / WillowDark are SVAR's real theme components: each renders the full
  // nested core → grid → gantt theme layers, sets the load-bearing `wx-theme`
  // context, and guarantees its CSS. We render the one chosen by the effective
  // theme around the chart (plan 002 U2) so the theme applies completely.
  import { Gantt, Tooltip, Willow, WillowDark, defaultTaskTypes, type IApi } from '@svar-ui/svelte-gantt';
  import { createMaximizeController, type MaximizeController } from './maximizeController';
  import DependencyTooltip from './DependencyTooltip.svelte';
  import GanttToolbar from './GanttToolbar.svelte';
  import { Notice, TFile } from 'obsidian';
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
  import { buildMarkerOverlay } from './markerOverlay';
  import { chartSpanSnapshot } from '../render/svarContract';
  import { lucideIcon } from './lucideIconAction';
  import BarContent from './BarContent.svelte';
  import { resolveClickActivation } from './taskNotesInteractions';
  import { setContext, tick } from 'svelte';
  import {
    GRID_APP_CONTEXT_KEY,
    GRID_DATE_LOCALE_CONTEXT_KEY,
    GRID_EDITABLE_COLUMNS_CONTEXT_KEY,
  } from './gridContext';
  import { buildFocusPlan } from './focusController';
  import { FocusTaskModal } from './FocusTaskModal';
  import {
    buildSvarTasks,
    buildTreatmentTaskTypes,
    buildInstanceCueTaskTypes,
    planTaskSync,
    planLinkSync,
    planReorder,
    baseSortDescriptor,
    shouldBulkReseed,
    structuralOpCount,
    type SvarTask,
    type SvarTaskInputs,
  } from './ganttSync';
  import {
    classifyUpdateEvent,
    classifyUpdateGesture,
    classifyLinkCreate,
    computeMoveDelta,
    computeMoveExtensions,
    computeSubtreeMove,
    computeShrinkFit,
    normalizeCascadeMode,
    type DateRange,
    type ExtensionNode,
    type SubtreeShift,
  } from './cascadeGate';
  import {
    normalizeInferredDragMode,
    classifyDraggedEdge,
    resolveInferredEdge,
    resolveInferredDragOutcome,
    buildInferredDragPatch,
    type InferredDragAction,
  } from './inferredDragGate';
  import { InferredDragModal } from './InferredDragModal';
  import {
    choiceEditorOptions,
    counterpartDate,
    dateRoleColumns,
    editorAttachedColumnIds,
    editorSeedFor,
    OG_CHIPS_EDITOR_TYPE,
    OG_TEXT_EDITOR_TYPE,
    resolveCellEditCommit,
    rowEditorConfig,
    shippedEditorKinds,
    storedFlatValue,
    suggestColumns,
    violatesDateOrder,
    withAlignedFlatKeys,
    type ChipsEditorConfig,
    type SvarEditorConfig,
    type SvarRowLike,
    type TextEditorConfig,
  } from './cellEditCommit';
  import { normalizeStoredList } from './taskNotesSuggest';
  import { createVaultWikilinkFetcher } from './vaultWikilinkSuggest';
  import type { FileFilterConfig } from './fileFilter';
  import { bareProperty } from '../datasource/dateFieldMapping';
  import { ensureInlineEditorsRegistered } from './inlineEditors';
  import {
    classifyTypedValue,
    EMPTY_TYPED_VALUE,
    type TypedValue,
  } from './propertyValues';
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
  import { cycleNext, type EphemeralSort } from './sortCycle';
  import { shouldHideRow, anyRowFilterActive } from './rowVisibility';
  import { buildRetainedAncestorNotice } from './retainedAncestorNotice';
  import type { DateStatus } from '../controller/datePolicy';
  import { spanDaysToMinutes, inclusiveDaySpan } from '../controller/durationConversion';
  import { dlog } from '../debugLog';

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
     * ask again" in the prompt (R6). register.ts closes it over `config.set`.
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
    onReassertGridWidthReady,
  }: Props = $props();

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
  const barColorMode = $derived($data.barColorMode ?? 'fill');
  const barColorSource = $derived($data.barColorSource ?? 'default');
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
    for (const event of ['zoom-scale', 'scroll-chart', 'resize-chart']) {
      ganttApi.on(event, () => refreshMarkerGeometry());
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

  // Tags our own programmatic store writes (sibling mirror, revert) so the
  // update-task intercept ignores them and we never re-persist an echo (the
  // SVAR-store echo guard — KTD "two echo loops").
  const OG_ECHO_SOURCE = 'og-self';
  // A drag/resize write that never settles (TaskNotes hang/disabled mid-write)
  // still reverts the optimistic move within this window.
  const MUTATION_TIMEOUT_MS = 10000;

  // Generated stylesheet applying the per-view color treatment (fill/strip by
  // status/priority, or theme CSS-variable rules) scoped under .og-bases-gantt.
  // Injected via a managed style element (see the $effect below) — a literal
  // style tag in markup would be compiled away as component CSS and cannot carry
  // this dynamic content. Reactive on mode/source/palettes/instances so the
  // options re-color live without a remount.
  const treatmentStyleCss = $derived(
    buildTreatmentStyle({
      mode: barColorMode,
      source: barColorSource,
      palettes: {
        status: statusColors,
        priority: priorityColors,
        calendar: $data.calendarPalette ?? [],
      },
      instances: instances.map((inst) => ({
        ...inst,
        calendarId: $data.calendarBySource?.get(inst.sourcePath) ?? null,
      })),
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
      // Only act on a known task row; unknown ids / empty space / header fall
      // through to the default menu.
      if (!path || !onBarContextMenu) return;
      // Suppress Obsidian's default editor context menu (the grid renders inside
      // editor content) and show the native TaskNotes task menu instead.
      e.preventDefault();
      e.stopPropagation();
      onBarContextMenu(path, e);
    };
    el.addEventListener('mousedown', onPointerDown, true);
    // Reset on window so a drag that ends off the grid still clears the flag.
    window.addEventListener('mouseup', onPointerUp, true);
    el.addEventListener('dblclick', onDblClick, true);
    el.addEventListener('contextmenu', onContextMenu, true);
    return () => {
      el.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('mouseup', onPointerUp, true);
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
  // SVAR re-initialises its ENTIRE store (resetting zoom level, scroll, and
  // selection) whenever the `tasks` / `links` / `taskTypes` / `zoom` props change
  // reference — its internal `$effect(reinitStore)`. So we seed those props ONCE
  // from the initial store value and thereafter apply every data change as
  // targeted `api.exec` actions (the SVAR-sanctioned path; see ganttSync). The
  // arrays and `svarReadonly` handed to `<Gantt>` below must NEVER be reassigned.

  /** Project the dynamic render data into the pure SVAR-task builder inputs. */
  function toInputs(d: GanttData): SvarTaskInputs {
    return {
      instances: d.instances,
      links: d.links,
      statusColors: d.statusColors ?? [],
      priorityColors: d.priorityColors ?? [],
      barColorSource: d.barColorSource ?? 'default',
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
  // Plain seed values, used both to seed the `$state` props below and the
  // applied-state maps further down (referencing the consts, not the $state,
  // avoids a spurious "state referenced locally" warning). Seeds carry aligned
  // flat editor keys, like every diff-sync update (see withAlignedFlatKeys).
  const seedTasks0: SvarTask[] = buildSvarTasks(toInputs(initialData)).map((t) =>
    withAlignedFlatKeys(t, initialEditorColumnIds),
  );
  const seedLinks0: RenderLink[] = initialData.links;
  // Seed props handed to `<Gantt>`. Reassigned ONLY on a column-config change
  // (which intentionally re-inits the SVAR store, resetting zoom/scroll); a
  // plain data refresh leaves them untouched and flows through the targeted
  // diff-sync below. `$state` so the reassignment reaches `<Gantt>`.
  let initialTasks: SvarTask[] = $state(seedTasks0);
  let initialLinks: RenderLink[] = $state(seedLinks0);
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
  const appliedTasks = new Map<string, SvarTask>();
  for (const t of seedTasks0) appliedTasks.set(t.id, t);
  const appliedLinks = new Map<string, RenderLink>();
  for (const l of seedLinks0) appliedLinks.set(l.id, l);

  // Fingerprint of the rendered row ORDER (parent + id sequence). The
  // incremental diff is keyed by id and cannot reorder existing rows, so a
  // pure reorder — e.g. a Base toolbar sort change with the same task set —
  // leaves SVAR in the prior order. We detect an order change and apply it via
  // `move-task` (mode `after`) inside the syncing block (zoom/scroll survive;
  // the syncing guard suppresses the echo/select that would otherwise open the
  // edit modal). Seeded so the first diff after mount is a no-op.
  function orderFingerprint(tasks: readonly SvarTask[]): string {
    return tasks.map((t) => `${t.parent ?? ''}>${t.id}`).join('|');
  }
  let appliedOrderKey = orderFingerprint(seedTasks0);
  // Last-applied Base toolbar sort descriptor (plan 2026-06-22-002, U4/U5, KTD4).
  // While an ephemeral column sort is active, the sync $effect compares this to
  // `config.getSort()` to tell a Base re-sort (descriptor changed → clear the
  // override, R6) from a plain data refresh (unchanged → keep & re-assert, R8).
  // Tracking the descriptor — not a row-position fingerprint — is the deliberate
  // fix: adding/removing a row shifts positions without a toolbar-sort change.
  let appliedBaseSortKey = baseSortDescriptor(config?.getSort?.());

  // True only while we push our own programmatic actions into SVAR, so the
  // update-task persist intercept ignores any echo they trigger (the OG_ECHO_SOURCE
  // tag covers our own writes; this also covers SVAR-internal echoes such as
  // summary-date recomputation fired during an add/move).
  let syncing = false;

  /** Whether a task id currently exists in SVAR's store (guards cascade deletes). */
  function taskExists(id: string): boolean {
    try {
      return !!api?.getTask?.(id);
    } catch {
      return false;
    }
  }

  // Apply each store update as the minimal set of SVAR actions instead of
  // replacing the tasks array — so zoom and scroll survive writes, drags,
  // external TaskNotes edits, and Bases filter changes. Re-runs on every
  // `store.set` (register.ts) and once `api` is ready.
  $effect(() => {
    const d = $data; // reactive dependency: re-run on every store update
    if (!api) return;
    syncToGantt(d);
  });

  /**
   * Apply ALL row-visibility options (Hide-top ∧ Show-undated ∧ Show-partial) as
   * ONE composed SVAR `filter-tasks` DISPLAY filter over the stable task array
   * (#161, U4). The shared {@link shouldHideRow} predicate reads each row's
   * `custom` (`isTopLevelPlacement` + `dateStatus`). `filter-tasks` recomputes
   * SVAR's visible set WITHOUT touching the `tasks` array (no add/delete diff) and
   * preserves scroll/zoom — so a toggle (or a Bases config oscillation) is cheap
   * and can never churn the chart. When every option is show-everything, clear with
   * no predicate. `open: false` so it never force-expands collapsed branches.
   *
   * The predicate is ALWAYS passed as `filter` (a function), never as a
   * `{key, value}` column filter — keeping the clear-path semantics intact (KTD4).
   */
  function applyDisplayFilters(): void {
    if (!api?.exec) return;
    const flags = { hideTopLevel, showUndated, showPartial };
    if (anyRowFilterActive(flags)) {
      api.exec('filter-tasks', {
        filter: (t: { custom?: { isTopLevelPlacement?: boolean; dateStatus?: DateStatus } }) =>
          !shouldHideRow(
            {
              isTopLevelPlacement: !!t?.custom?.isTopLevelPlacement,
              dateStatus: t?.custom?.dateStatus ?? 'complete',
            },
            flags,
          ),
        open: false,
      });
    } else {
      api.exec('filter-tasks', { open: false });
    }
  }

  // Dedicated effect: re-applies the composed filter on ANY row-visibility toggle
  // AND after any data refresh (so newly-added rows are filtered too). Created AFTER
  // the sync effect so it runs after the diff lands. A display-only change is a
  // content-NOOP for the sync (the task set is identical), so this is the path that
  // actually toggles row visibility.
  $effect(() => {
    void $data; // re-run after every store update (post-sync)
    void hideTopLevel; // re-run when any row-visibility toggle flips
    void showUndated;
    void showPartial;
    if (api) applyDisplayFilters();
  });

  function syncToGantt(d: GanttData): void {
    // A column-config change can't be applied incrementally — SVAR has no
    // per-column update action, and a new `columns` reference re-inits the whole
    // store from the seed props. So when the fingerprint changes, reseed columns
    // AND tasks/links to the current data together (a lone columns reseed would
    // re-init from the stale frozen task seed, dropping incremental updates),
    // resync the applied maps, and let the single re-init render it. Zoom/scroll
    // reset here — accepted, since this only fires on an actual column change.
    const editorAttachKey = cellEditColumnIds.join('|');
    if (d.gridColumnsKey !== appliedColumnsKey || editorAttachKey !== appliedEditorAttachKey) {
      dlog(`[OGDBG] sync RESEED columns "${appliedColumnsKey}" -> "${d.gridColumnsKey}"`);
      appliedGridWidth = d.gridWidth; // reseed re-asserts the width itself
      appliedEditorAttachKey = editorAttachKey;
      reseedForColumnChange(d);
      return;
    }

    // Apply a divider width changed via the settings panel (the "Table width
    // (px)" option) even when nothing else changed — that refresh otherwise
    // takes the content-NOOP path below and the new width would not show until
    // a resize/reseed. Re-assert reads the fresh effective width from the store.
    if (d.gridWidth !== appliedGridWidth) {
      appliedGridWidth = d.gridWidth;
      applyPersistedGridWidth();
    }

    const next = buildSvarTasks(toInputs(d));
    const taskPlan = planTaskSync(appliedTasks, next);
    const linkPlan = planLinkSync(appliedLinks, d.links);
    const orderKey = orderFingerprint(next);
    // Base toolbar sort descriptor (U4/U5, KTD4). Compared against the last
    // applied value to drive R6 (Base re-sort clears the ephemeral override) vs
    // R8 (data-only refresh keeps it).
    const baseSortKey = baseSortDescriptor(config?.getSort?.());
    const baseSortChanged = baseSortKey !== appliedBaseSortKey;

    const contentNoop =
      !taskPlan.moves.length &&
      !taskPlan.updates.length &&
      !taskPlan.deletes.length &&
      !taskPlan.adds.length &&
      !linkPlan.deletes.length &&
      !linkPlan.adds.length;
    // Nothing changed at all (content, order, or Base sort) → no work. The Base
    // sort term keeps an R6 clear from being skipped when a toolbar re-sort
    // happens to leave the row order identical (e.g. a single-row tree).
    if (contentNoop && orderKey === appliedOrderKey && !baseSortChanged) {
      dlog('[OGDBG] sync NOOP');
      return;
    }
    // #161 U6: a WHOLESALE set replacement (search clear / filter change re-expands
    // the whole companion tree → hundreds–thousands of add/delete execs) costs a DOM
    // mutation storm per swing; a burst of those is the ~25s churn. Above the op
    // threshold, apply the change as ONE virtualized re-init (reuse the column/theme
    // reseed path) instead of the per-instance diff. Zoom/scroll reset is the correct
    // trade-off here — the displayed set changed entirely, so prior view state is
    // meaningless. Small diffs fall through to the incremental path below, which
    // preserves zoom/scroll. The decision is the pure, unit-tested shouldBulkReseed.
    if (shouldBulkReseed(taskPlan, linkPlan)) {
      dlog(
        `[OGDBG] sync BULK-RESEED ops=${structuralOpCount(taskPlan, linkPlan)}` +
          ` (adds=${taskPlan.adds.length} deletes=${taskPlan.deletes.length} moves=${taskPlan.moves.length} linkAdds=${linkPlan.adds.length} linkDeletes=${linkPlan.deletes.length})`,
      );
      syncing = true;
      try {
        // R6 (mirror the incremental path): if the user changed the Base toolbar sort
        // in the same swing, newest explicit sort wins — drop an active ephemeral sort
        // first so reseedSeedsFromData doesn't re-assert a now-stale override.
        if (ephemeralSort && baseSortChanged) {
          ephemeralSort = null;
          clearSvarSortArrow();
        }
        // Re-init tasks/links in one operation (re-syncs applied maps + Base order +
        // an active ephemeral sort), then re-assert the persisted divider width (a
        // store re-init can recompute it). Columns are untouched (no column change).
        reseedSeedsFromData(d);
        applyPersistedGridWidth();
      } finally {
        syncing = false;
      }
      // A reinit CLEARS SVAR's filter-tasks state, and SVAR's own reinit effect can
      // run AFTER the synchronous `$data` display-filter effect — so that effect's
      // re-apply would be wiped and hidden rows (Hide-top / Show-undated off) flash
      // back until the next refresh. Re-assert the active row-visibility filter once
      // the reseed settles (deferred like the ephemeral-sort / grid-width restores).
      setTimeout(() => applyDisplayFilters(), 0);
      return;
    }

    dlog(
      `[OGDBG] sync DIFF moves=${taskPlan.moves.length} updates=${taskPlan.updates.length}` +
        ` adds=${taskPlan.adds.length} deletes=${taskPlan.deletes.length}` +
        ` linkAdds=${linkPlan.adds.length} linkDeletes=${linkPlan.deletes.length}` +
        ` orderChanged=${orderKey !== appliedOrderKey} baseSortChanged=${baseSortChanged}`,
    );

    syncing = true;
    const tSyncStart = performance.now(); // [OGDBG #161]
    try {
      // Order: reparent → field updates → remove links → remove tasks (leaf-first)
      // → add tasks (parent-first) → add links (endpoints now exist).
      for (const m of taskPlan.moves) {
        api.exec('move-task', { id: m.id, target: m.parent, mode: 'child', eventSource: OG_ECHO_SOURCE });
      }
      for (const u of taskPlan.updates) {
        // Re-assert the flat editor keys with every update: SVAR applies the
        // payload as a shallow spread, so a flat key committed by an earlier
        // inline edit would otherwise go stale against the refreshed
        // custom.properties — and a later commit on another column would
        // misattribute the edit to the stale key and write the old value back.
        api.exec('update-task', {
          id: u.id,
          task: withAlignedFlatKeys(u.task, cellEditColumnIds),
          eventSource: OG_ECHO_SOURCE,
        });
        appliedTasks.set(u.id, u.task);
      }
      for (const id of linkPlan.deletes) {
        api.exec('delete-link', { id, eventSource: OG_ECHO_SOURCE });
        appliedLinks.delete(id);
      }
      for (const id of taskPlan.deletes) {
        if (taskExists(id)) api.exec('delete-task', { id, eventSource: OG_ECHO_SOURCE });
        appliedTasks.delete(id);
      }
      for (const t of taskPlan.adds) {
        api.exec('add-task', { task: t, eventSource: OG_ECHO_SOURCE });
        appliedTasks.set(t.id, t);
      }
      for (const l of linkPlan.adds) {
        api.exec('add-link', { link: l, eventSource: OG_ECHO_SOURCE });
        appliedLinks.set(l.id, l);
      }
      const tAfterExec = performance.now(); // [OGDBG #161]
      let reorderMoves = 0; // [OGDBG #161]
      // Reconcile sibling ORDER. Three cases (plan 2026-06-22-002, U4/U5):
      if (ephemeralSort && !baseSortChanged) {
        // R8 — an ephemeral column sort is active and the Base toolbar sort is
        // unchanged (a plain data refresh). Keep the user's sort: re-assert it
        // over the new row set instead of snapping back to Base order, and SKIP
        // planReorder. Echo-guarded so it doesn't re-enter the sort-tasks
        // interceptor (U2). `appliedOrderKey` still advances to the Base order of
        // `next` below: the display is under ephemeral control, but the later
        // clear/R6 reorder diffs against this baseline (a stale key would issue
        // duplicate/missing moves).
        reassertEphemeralSort();
      } else {
        // Default path (no ephemeral sort) OR R6 (the user changed the Base
        // toolbar sort while a sort was active → newest explicit sort wins: drop
        // the override and show the new Base order). The id-keyed diff above never
        // reorders existing rows, so a pure reorder (toolbar sort) or a
        // position-shifting add needs explicit `move-task` (mode `after`) steps —
        // these keep each task under its parent so zoom/scroll survive.
        if (ephemeralSort && baseSortChanged) {
          ephemeralSort = null;
          clearSvarSortArrow();
        }
        if (orderKey !== appliedOrderKey) {
          for (const m of planReorder(next)) {
            reorderMoves += 1;
            api.exec('move-task', {
              id: m.id,
              target: m.after,
              mode: 'after',
              eventSource: OG_ECHO_SOURCE,
            });
          }
        }
      }
      // Commit the applied order + Base sort descriptor INSIDE the try, after the
      // moves land. If a move-task exec throws mid-sequence, these are skipped so
      // the stale keys force the next sync to replay the work (rather than diffing
      // against state we never finished applying).
      appliedOrderKey = orderKey;
      appliedBaseSortKey = baseSortKey;
      // [OGDBG #161] split timing: exec loop (add/update/delete) vs reorder pass
      // (planReorder + per-row move-task). A large reorderMoves with a big total
      // is the O(N²) suspect for the refresh freeze.
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
      appliedOrderKey = orderFingerprint(next);
    } catch {
      /* a move-task threw mid-restore (e.g. store torn down); the stale
         appliedOrderKey forces the next sync to replay the full reorder */
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
    // Aligned flat editor keys, like the incremental update path — a reseed
    // must leave every row's flat keys matching its stored values too.
    const tasks = buildSvarTasks(toInputs(d)).map((t) =>
      withAlignedFlatKeys(t, cellEditColumnIds),
    );
    initialTasks = tasks;
    initialLinks = d.links;

    appliedTasks.clear();
    for (const t of tasks) appliedTasks.set(t.id, t);
    appliedLinks.clear();
    for (const l of d.links) appliedLinks.set(l.id, l);
    // The reseed re-inits SVAR from `tasks` (already in Base order), so the
    // applied order key tracks it — the next diff won't re-issue reorder moves.
    // Re-baseline the Base sort descriptor too (symmetry with appliedOrderKey): a
    // reseed coinciding with a toolbar-sort change must not leave the next sync
    // comparing against a stale descriptor.
    appliedOrderKey = orderFingerprint(tasks);
    appliedBaseSortKey = baseSortDescriptor(config?.getSort?.());

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
  interface UpdateTaskEvent {
    id?: string | number;
    inProgress?: boolean;
    eventSource?: string;
    task?: Record<string, unknown>;
  }

  // The slice of SVAR's `add-link`/`delete-link` event payloads the dependency
  // authoring path reads. `delete-link` carries `{ id }`; `add-link` carries
  // `{ link: { source, target, type } }` (a user-drawn link has no id until SVAR
  // assigns one after the intercept). `eventSource` is our echo tag.
  interface LinkEvent {
    id?: string | number;
    inProgress?: boolean;
    eventSource?: string;
    link?: { source?: string | number; target?: string | number; type?: string };
  }

  // SVAR Gantt API - using unknown with type assertions for third-party API
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type GanttAPI = any;

  // Note: SVAR Gantt may generate console warnings:
  // - Non-passive event listeners for touch/wheel (required for drag functionality)
  // - Performance violations during chart rendering (expected for complex UI)
  // CSP violations for external fonts are prevented by fonts={false} and custom icon implementation

  let api: GanttAPI = $state();

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
    }
  }
  $effect(() => {
    const ctrl = createMaximizeController({
      onChange: (v) => { isMaximized = v; applyMaximizeDom(v); },
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
  // Auto-exit maximize when our leaf stops being the active one. Because the
  // maximized root lives on `document.body` (not in the leaf), Obsidian's normal
  // hide-the-inactive-leaf behavior no longer covers it — without this, switching
  // tabs would leave the full-window chart painted over a different tab. Exiting
  // also keeps only one view maximized at a time. Our origin container
  // (`restoreParent`) stays inside our leaf; if the now-active leaf doesn't
  // contain it, the active leaf isn't ours.
  $effect(() => {
    const ref = app.workspace.on('active-leaf-change', (leaf) => {
      if (!maximizeController?.isMaximized()) return;
      const activeContainer = leaf?.view?.containerEl ?? null;
      // Null/transient leaf changes (Obsidian emits these when a modal opens or
      // during focus transitions) are NOT a real tab switch — staying maximized
      // is correct. Only exit when a genuine OTHER leaf became active.
      if (!activeContainer) return;
      const owner = restoreParent;
      if (owner && activeContainer.contains(owner)) return; // still our leaf
      maximizeController.exit();
    });
    return () => app.workspace.offref(ref);
  });
  const toggleMaximize: MaximizeToggleAction = () => maximizeController?.toggle();

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

  /** Resolve a bar id → source path and invoke the native-activate callback. */
  function activateBar(id: string, kind: 'single' | 'double', ctrlOrMeta: boolean): void {
    const path = idToSourcePath.get(id);
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

  // Rows with an in-flight cell-edit write: the editor gate returns null for
  // them, so a second edit can't race the pending persistence/revert.
  const pendingCellEdits = new Set<string>();

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
    if (row?.id != null && pendingCellEdits.has(String(row.id))) return null;
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
    return withChipsWiring(withTextEditorWiring(config, row), row, columnId);
  }

  /**
   * Attach the vault `[[` fetcher to a text editor config per open (parallel to
   * {@link withSuggestWiring}): the fetcher enumerates the vault relative to the
   * row's note path, scoped by the field's autosuggest filter when the config
   * carries one (a single-value suggest field; plain text is unfiltered), so the
   * component gets a fresh source each open. Non-text configs pass through.
   */
  function withTextEditorWiring(
    config: SvarEditorConfig,
    row: SvarRowLike | undefined,
  ): SvarEditorConfig {
    if (typeof config === 'string' || config.type !== OG_TEXT_EDITOR_TYPE) return config;
    const sourcePath = (row?.custom as { sourceTaskId?: string } | undefined)?.sourceTaskId ?? '';
    const filter = (config.config as TextEditorConfig).autosuggestFilter as
      | FileFilterConfig
      | undefined;
    return {
      type: OG_TEXT_EDITOR_TYPE,
      config: { fetchSuggestions: createVaultWikilinkFetcher(app, sourcePath, filter) },
    };
  }

  /**
   * Attach the per-open view callbacks to a chips list editor config: the
   * add-input's `[[` fetcher (scoped by the field filter when present), the RAW
   * stored list to seed chips from (verbatim entries — the grid's TypedValues
   * carry only display forms), and the whole-list direct commit closure over
   * this row. List commits never ride the bridge.
   */
  function withChipsWiring(
    config: SvarEditorConfig,
    row: SvarRowLike | undefined,
    columnId: string,
  ): SvarEditorConfig {
    if (typeof config === 'string' || config.type !== OG_CHIPS_EDITOR_TYPE) return config;
    const rowId = row?.id != null ? String(row.id) : null;
    if (!rowId) return config;
    const sourcePath = (row?.custom as { sourceTaskId?: string } | undefined)?.sourceTaskId ?? '';
    const filter = (config.config as ChipsEditorConfig).autosuggestFilter as
      | FileFilterConfig
      | undefined;
    return {
      type: OG_CHIPS_EDITOR_TYPE,
      config: {
        fetchSuggestions: createVaultWikilinkFetcher(app, sourcePath, filter),
        seed: normalizeStoredList(rawStoredValueOf(rowId, columnId)),
        commitList: (raw: string[]) => handleChipsCommit(rowId, columnId, raw),
      },
    };
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

  // Initialize API and intercept editor events
  function initGantt(ganttApi: GanttAPI) {
    api = ganttApi;
    wireColumnResizePersistence(ganttApi);
    wireGridWidthPersistence(ganttApi);
    wireMarkerRecompute(ganttApi);
    // Restore the persisted divider width after the initial column recompute.
    applyPersistedGridWidth();

    // [OGDBG #161] initGantt fires once per SVAR (re)initialization. Repeated
    // lines during a config toggle ⇒ a remount/reseed loop, not refresh-in-place.
    dbgInitCount += 1;
    dlog(`[OGDBG] initGantt #${dbgInitCount} svarTasks=${api?.getState?.()?.tasks?.length ?? '?'}`);

    // Native edit interaction (U2): a bar's left/double-click routes to the
    // TaskNotes interaction service (via onBarActivate) instead of a custom
    // modal — TaskNotes performs the configured action (open note / open its own
    // edit modal). Single vs double is disambiguated with a short debounce.
    //
    // Double-click → SVAR fires `show-editor` (no modifier info; we use the
    // last pointer's ctrl/meta). We always return false so SVAR's own editor
    // never opens — editing is fully delegated to TaskNotes.
    // Ephemeral column sort (plan 2026-06-22-002, reverses R16): a user header
    // click cycles the column asc → desc → cleared (cycleNext, U2). SVAR's native
    // header click is an infinite asc↔desc toggle with no "clear" state, so we
    // drive the cycle off OUR `ephemeralSort` and inject the third (clear) state
    // ourselves. For asc/desc we let SVAR perform the sort (its `order` matches
    // the cycle, since both go no-sort→asc→desc); for the clear we CANCEL SVAR's
    // toggle-back-to-asc (return falsy) and restore the Base order. Echo-guarded
    // (mirrors the open-task interceptor) so U4/U5's re-asserts can't re-enter.
    api.intercept(
      "sort-tasks",
      (ev: { key?: string; order?: string; eventSource?: string }) => {
        if (syncing || ev?.eventSource === OG_ECHO_SOURCE) return true;
        if (typeof ev?.key !== 'string') return true;
        const nextSort = cycleNext(ephemeralSort, ev.key);
        if (nextSort === null) {
          // Third click on the active column → clear. Hide the reset pill now
          // (synchronous state), and restore the Base order on a deferred tick so
          // the store finishes cancelling THIS action before we reset `_sort` +
          // replay the Base-order moves (avoids re-entrancy inside the intercept).
          // Bail if a new sort started within the tick (a fast re-click) — that
          // sort now owns the display (mirrors the reseed re-assert's guard).
          ephemeralSort = null;
          setTimeout(() => {
            if (ephemeralSort) return;
            restoreBaseOrder();
          }, 0);
          return false;
        }
        ephemeralSort = nextSort;
        return true;
      },
    );

    // Persist user collapse/expand (U7). SVAR fires open-task on a toggle-icon
    // click — mode=true expands, mode=false collapses. Let it proceed (return
    // true) and record the change so it survives reload. Ignore our own bulk
    // collapse-all execs (tagged eventSource) and any event during a reseed.
    // Veto only the mid-drag collapse: SVAR's reorder gesture folds a parent
    // (startReorder) before dragging it, so a drag begun on a cell would collapse
    // the row by surprise. That is the only open-task that fires with a button
    // held; the deliberate toggles (chevron click, keyboard hotkey) fire with the
    // pointer already up, so they pass.
    api.intercept(
      "open-task",
      (ev: { id?: string | number; mode?: boolean; eventSource?: string }) => {
        if (syncing || ev?.eventSource === OG_ECHO_SOURCE) return true;
        if (pointerButtonDown) return false;
        const id = ev?.id != null ? String(ev.id) : null;
        if (!id || typeof ev.mode !== 'boolean') return true;
        const next = new Set(collapsedIds);
        if (ev.mode) next.delete(id);
        else next.add(id);
        collapsedIds = next;
        return true;
      },
    );

    // Row reordering is disabled. SVAR ships no reorder-toggle prop in this
    // version (readonly is too broad — it also kills editing and double-click
    // editor opening), so the documented lever is api.intercept returning false.
    // A user reorder would not persist (the next data pass rebuilds order) and
    // its drag-start collapses parents and swallows in-editor text selection.
    // Our own ordering moves are echo-tagged and pass through. The keyboard
    // actions and the newer semantic aliases are blocked too so a SVAR bump
    // can't silently re-enable reordering.
    const blockUserReorder = (ev?: { eventSource?: string }): boolean =>
      syncing || ev?.eventSource === OG_ECHO_SOURCE;
    for (const reorderAction of [
      "move-task",
      "move-task:up",
      "move-task:down",
      "reorder-tasks",
      "move-up",
      "move-down",
    ]) {
      api.intercept(reorderAction, blockUserReorder);
    }

    api.intercept("show-editor", ({ id }: { id: string }) => {
      // Ignore programmatic selection/editor events emitted while we reseed the
      // store (add/delete/update during diff-sync) — those are not user clicks.
      // Without this, a per-view settings change that reseeds the chart would
      // spuriously open the TaskNotes edit modal. Same guard as update-task.
      if (syncing) return false;
      if (pendingSingleClick) {
        clearTimeout(pendingSingleClick);
        pendingSingleClick = null;
      }
      // Double-click runs the configured action regardless of selection (R5).
      if (id && resolveClickActivation({ kind: 'double' }) === 'activateDouble') {
        activateBar(String(id), 'double', lastCtrlMeta);
      }
      return false;
    });

    // Single-click → SVAR fires `select-task` (carries `toggle` = ctrl/meta).
    // SVAR applies its own `.wx-selected` highlight when we return true; we add
    // the select-first gate on top: only an already-selected row activates.
    api.intercept("select-task", (ev: { id?: string | number; toggle?: boolean }) => {
      // Ignore programmatic re-selection emitted during a store reseed (a
      // deleted/re-added selected task makes SVAR fire select-task with
      // syncing=true). Only genuine user clicks drive selection/activation.
      if (syncing) return true;
      // Focus's programmatic select: apply the highlight (return true) but never
      // schedule activation, so focusing keeps navigation-only even when the
      // target was already selected (R9). Drop any stale pending single action.
      if (suppressSelectActivation) {
        if (pendingSingleClick) {
          clearTimeout(pendingSingleClick);
          pendingSingleClick = null;
        }
        return true;
      }
      const id = ev?.id != null ? String(ev.id) : null;
      if (id) {
        // Select-first gate (R1/R2): the intercept runs BEFORE SVAR applies this
        // selection, so getState().selected still holds the pre-click set.
        const selectedBefore = (api.getState()?.selected ?? []).map(String);
        const wasSelected = selectedBefore.includes(id);

        // Ctrl/Cmd is the new-tab modifier (R7), NOT multi-select (out of scope).
        // SVAR maps ctrl/meta to `toggle` (add-to-selection); clear it so a
        // modified click can never leave a lingering multi-selection (AE7). Read
        // the modifier from the pointer event — the same source the double-click
        // (show-editor) path uses.
        const ctrlOrMeta = ev.toggle === true || lastCtrlMeta;
        if (ev.toggle) ev.toggle = false;

        // Drop any stale deferred action from a previous click.
        if (pendingSingleClick) {
          clearTimeout(pendingSingleClick);
          pendingSingleClick = null;
        }

        if (resolveClickActivation({ kind: 'single', wasSelected }) === 'activateSingle') {
          // Second click of an already-selected row → run the configured action,
          // deferred so a following double-click can cancel it (R4/R6).
          pendingSingleClick = setTimeout(() => {
            pendingSingleClick = null;
            activateBar(id, 'single', ctrlOrMeta);
          }, 250);
        }
        // else: first click of an unselected row → select + highlight only (R1).
        // We return true so SVAR applies `.wx-selected`; no action is scheduled.
      }
      return true;
    });

    // Unified drag wiring (plan U4). Parents are ordinary (non-summary) tasks,
    // so dragging one moves only that bar — SVAR fires a single committing
    // `update-task` (no eventSource) for the dragged task D and no cascade. We:
    //   - persist D's own move (existing persistReschedule), and
    //   - on a deferred tick, if D is a parent and the gesture was a *move*,
    //     shift its descendants by the same delta (and persist them), then offer
    //     the gated ancestor extend if the moved subtree now exceeds an ancestor.
    // `inProgress` frames and our own echoes / refreshes are ignored. No
    // moveSummaryKids/resetSummaryDates fire for non-summary rows, so `action`
    // events are not expected and are left as a no-op.
    api.intercept("update-task", (ev: UpdateTaskEvent) => {
      if (!ev || ev.inProgress) return true;
      // Cell edits fold into the same event stream: the grid's update-cell
      // bridge re-emits a committed inline edit as an untagged `update-task`
      // whose task copy carries a flat `[columnId]` key. classifyUpdateGesture
      // tells those apart from drag/resize gestures by diffing the copy's flat
      // keys against the row's stored values.
      const gesture = classifyUpdateGesture(ev, {
        echoSource: OG_ECHO_SOURCE,
        syncing,
        cellEditColumnIds,
        storedProperties: storedPropertiesOf(ev.id),
      });
      if (gesture.kind === 'cell-edit') {
        return ev.id != null
          ? handleCellEditCommit(String(ev.id), gesture.columnId, gesture.value)
          : false;
      }
      // Re-committing the current value: nothing to write, nothing to revert.
      if (gesture.kind === 'cell-edit-noop') return false;
      // More than one flat key diffs (a stale committed key over an externally
      // changed note): writing either could clobber the external change, so
      // block the apply, re-align the row's flat keys with the stored truth,
      // and tell the user the silently-dropped edit needs a retry.
      if (gesture.kind === 'cell-edit-ambiguous') {
        if (ev.id != null) reseedRowFlatKeys(String(ev.id));
        new Notice("Couldn't save — the row changed externally; try again.");
        return false;
      }
      const cls = gesture.kind;
      if (cls === 'user-gesture' && !readOnly && !!onMutate && ev.id != null) {
        const id = String(ev.id);
        const before = instances.find((i) => i.id === id);
        // Progress-handle drag (U6): in Property mode, persist the new percentage
        // on release. TaskNotes mode hides the handle (progressReadonly), so this
        // only fires in Property mode.
        //
        // Identify a progress gesture by the SVAR payload SHAPE, not just a
        // changed progress value: the progress marker emits `task: { progress }`
        // with NO start/end, whereas a date drag/resize emits `task: { start, end }`
        // (and SVAR may echo the task's current `progress: 0` for a blank-progress
        // task). Keying only on `progress !== before` would then misread a date
        // drag as a progress write — writing 0 to the property and dropping the
        // date edit. Requiring progress present AND start/end absent avoids that.
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
        // Capture pre-drag dates synchronously (instances is still the pre-drag
        // snapshot now) for the subtree-shift delta.
        activeDrag = {
          id,
          name: before?.text ?? 'this task',
          beforeStart: before?.start ?? null,
          beforeEnd: before?.end ?? null,
          beforeDateStatus: before?.dateStatus ?? null,
        };
        setTimeout(() => void persistReschedule(id), 0);
        scheduleSubtreeAndExtend();
      }
      return true;
    });

    // Drag-to-create an FS dependency (M2/U4). SVAR fires `add-link` on drop; a
    // user-drawn link has no id yet (SVAR assigns a temp id in the router AFTER
    // this intercept), so we return `false` and let the controller write drive
    // the arrow via the diff-sync (KTD4) — no optimistic add, no temp-id revert.
    // Only `e2s` (finish→start) is accepted; other geometries / self-links are
    // rejected. Our own echo / programmatic refresh (cls !== 'user-gesture')
    // passes through so the diff-sync's add-link applies.
    api.intercept("add-link", (ev: LinkEvent) => {
      if (!ev || ev.inProgress) return true;
      if (classifyUpdateEvent(ev, { echoSource: OG_ECHO_SOURCE, syncing }) !== 'user-gesture') {
        return true;
      }
      if (readOnly || !onAddDependency || !ev.link) return false;
      const roles = classifyLinkCreate({
        source: String(ev.link.source ?? ''),
        target: String(ev.link.target ?? ''),
        type: String(ev.link.type ?? ''),
      });
      if (!roles) {
        new Notice('Only Finish-to-Start links can be created for now.');
        return false;
      }
      void onAddDependency(roles.predecessor, roles.dependent).catch((err) => {
        console.error('[GanttContainer] add-dependency failed:', err);
        new Notice("Couldn't create the dependency — check TaskNotes is running.");
      });
      return false;
    });

    // Delete a dependency (M2/U3). SVAR fires `delete-link { id }` from its
    // native select-and-delete. Resolve the link's endpoints from the applied-
    // links map (its id may carry SVAR's leading `:`), remove the edge via the
    // controller, and return `false` so the diff-sync removal — not SVAR's
    // optimistic one — drives the arrow's disappearance. No confirm; no revert
    // needed (nothing removed locally).
    api.intercept("delete-link", (ev: LinkEvent) => {
      if (!ev) return true;
      if (classifyUpdateEvent(ev, { echoSource: OG_ECHO_SOURCE, syncing }) !== 'user-gesture') {
        return true;
      }
      if (readOnly || !onRemoveDependency || ev.id == null) return false;
      const rawId = String(ev.id);
      const link = appliedLinks.get(rawId.startsWith(':') ? rawId.slice(1) : rawId);
      if (!link) return false;
      void onRemoveDependency(link.source, link.target).catch((err) => {
        console.error('[GanttContainer] remove-dependency failed:', err);
        new Notice("Couldn't remove the dependency — check TaskNotes is running.");
      });
      return false;
    });

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

  /**
   * Persist a committed drag/resize for `instanceId` (U8). Reads the
   * authoritative new dates from the SVAR store (the event payload is
   * heterogeneous — diff-only on some gestures), resolves the source identity,
   * optimistically mirrors the dates onto sibling instances of the same source
   * so multi-parent rows never diverge (AE7), then persists via the controller.
   * On failure (or timeout) every mirrored row — and the dragged row — reverts
   * to its pre-drag dates and a Notice is shown.
   */
  /**
   * Persist a Property-mode progress-handle drag (U6). Fires on release only (the
   * intercept discards `inProgress` frames), so one gesture = one write — no
   * debounce. On failure, revert the bar's progress to the pre-drag value and
   * notify. The controller resolves the write target and the source clamps/rounds.
   */
  async function persistProgress(
    instanceId: string,
    progress: number,
    beforeProgress: number,
  ): Promise<void> {
    if (!onMutate || !api) return;
    // `beforeProgress` is captured synchronously in the intercept (pre-drag),
    // like persistReschedule's activeDrag capture — so a data refresh landing
    // before this deferred callback can't skew the revert baseline.
    // Progress is deliberately NOT mirrored onto multi-parent sibling rows the
    // way persistReschedule mirrors dates: the source write triggers a refresh
    // that reconciles every instance, and interim progress divergence is a
    // transient visual-only effect (dates diverging mid-drag is far more jarring).
    try {
      await withTimeout(onMutate(instanceId, { progress }), MUTATION_TIMEOUT_MS);
    } catch (err) {
      console.error('[GanttContainer] progress persist failed:', err);
      api.exec('update-task', {
        id: instanceId,
        task: { progress: beforeProgress },
        eventSource: OG_ECHO_SOURCE,
      });
      new Notice("Couldn't save progress — check TaskNotes is running.");
    }
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

  /**
   * Handle a committed inline cell edit: cast the bridged value back per the
   * column's editor kind, then either block the apply (noop/reject, with a
   * Notice on reject) or let SVAR's optimistic apply stand and persist through
   * the controller — reverting (+Notice) if the write rejects or times out.
   * The stored baseline advances synchronously so a quick follow-up edit diffs
   * against what is being persisted, and rolls back with a failed write.
   */
  function handleCellEditCommit(instanceId: string, columnId: string, rawValue: unknown): boolean {
    const persist = onMutateProperty;
    const kind = editorKindByColumn.get(columnId);
    if (!persist || !kind) return false;
    const properties = storedPropertiesOf(instanceId);
    const stored = properties?.[columnId] ?? EMPTY_TYPED_VALUE;
    // Choice commits carry the configured value strings so a bridge-coerced
    // numeric-looking pick ("01" arriving as 1) recovers the exact catalog value.
    const choiceValues =
      kind === 'choice-status'
        ? ($data.choiceOptions?.status ?? []).map((o) => o.value)
        : kind === 'choice-priority'
          ? ($data.choiceOptions?.priority ?? []).map((o) => o.value)
          : undefined;
    const outcome = resolveCellEditCommit(kind, rawValue, stored, { choiceValues });
    if (outcome.action === 'noop') return false;
    if (outcome.action === 'reject') {
      new Notice(`Couldn't save — ${outcome.reason}`);
      return false;
    }
    // Cross-field date order: a mapped start (end) commit must not pass the
    // row's real end (start). Single-edge semantics otherwise — one field
    // write, no reshuffle of the counterpart, no subtree cascade.
    const dateRole = outcome.value instanceof Date ? dateRoleByColumn.get(columnId) : undefined;
    if (dateRole) {
      const row = instances.find((i) => i.id === instanceId);
      if (violatesDateOrder(dateRole, outcome.value as Date, counterpartDate(row, dateRole))) {
        new Notice(
          dateRole === 'start'
            ? "Couldn't save — the start date must not be after the end date."
            : "Couldn't save — the end date must not be before the start date.",
        );
        return false;
      }
    }
    applyAndPersistCellEdit(instanceId, columnId, outcome.value);
    return true;
  }

  /**
   * The shared optimistic-apply + persist tail of a cell edit — used by both
   * the bridge-classified commits above and the suggest editor's direct list
   * commits. Advances the stored baseline and the rendered cell text
   * synchronously (rolled back with a failed write), marks the row pending,
   * and persists through the controller. `refreshRow` additionally re-execs
   * the row's flat key (echo-tagged) so SVAR re-renders when no store apply
   * preceded the call — the direct path, which returns `false` to the bridge.
   */
  function applyAndPersistCellEdit(
    instanceId: string,
    columnId: string,
    value: unknown,
    opts: { refreshRow?: boolean } = {},
  ): void {
    const persist = onMutateProperty;
    if (!persist) return;
    const properties = storedPropertiesOf(instanceId);
    const stored = properties?.[columnId] ?? EMPTY_TYPED_VALUE;
    const typed = classifyTypedValue(value);
    if (properties) properties[columnId] = typed;
    // Optimistic display: the cell renders custom.cellRenders[columnId].text,
    // not the flat key SVAR just applied — advance it (text mode; a markdown
    // descriptor is refreshed by the confirming data pass) so the committed
    // value shows immediately. Rolled back with the baseline on failure.
    const renders = cellRendersOf(instanceId);
    const previousRender = renders?.[columnId];
    if (renders) {
      renders[columnId] = { mode: 'text', text: formatPropertyValue(typed, initialData.dateLocale) };
    }
    pendingCellEdits.add(instanceId);
    if (opts.refreshRow) {
      api?.exec('update-task', {
        id: instanceId,
        task: { [columnId]: storedFlatValue(typed) },
        eventSource: OG_ECHO_SOURCE,
      });
    }
    void persistCellEdit(persist, { instanceId, columnId, value, previous: stored, previousRender });
  }

  /**
   * Direct commit for a chips list column: persist the whole edited RAW list once
   * (compared against the current raw frontmatter so an unchanged session writes
   * nothing). Reads the raw value at commit time because the grid's TypedValues
   * carry only display forms — rebuilding from them would strip wikilink brackets.
   */
  function handleChipsCommit(instanceId: string, columnId: string, raw: string[]): void {
    if (pendingCellEdits.has(instanceId)) return;
    const current = normalizeStoredList(rawStoredValueOf(instanceId, columnId));
    if (current.length === raw.length && current.every((v, i) => v === raw[i])) return;
    applyAndPersistCellEdit(instanceId, columnId, raw, { refreshRow: true });
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

  async function persistCellEdit(
    persist: (instanceId: string, propertyId: string, value: unknown) => Promise<void>,
    edit: {
      instanceId: string;
      columnId: string;
      value: unknown;
      previous: TypedValue;
      previousRender: CellRender | undefined;
    },
  ): Promise<void> {
    try {
      await withTimeout(persist(edit.instanceId, edit.columnId, edit.value), MUTATION_TIMEOUT_MS);
    } catch (err) {
      console.error('[GanttContainer] cell-edit persist failed:', err);
      const properties = storedPropertiesOf(edit.instanceId);
      if (properties) properties[edit.columnId] = edit.previous;
      const renders = cellRendersOf(edit.instanceId);
      if (renders) {
        if (edit.previousRender) {
          renders[edit.columnId] = edit.previousRender;
        } else {
          delete renders[edit.columnId];
        }
      }
      api?.exec('update-task', {
        id: edit.instanceId,
        task: { [edit.columnId]: storedFlatValue(edit.previous) },
        eventSource: OG_ECHO_SOURCE,
      });
      new Notice("Couldn't save the change — check TaskNotes is running.");
    } finally {
      pendingCellEdits.delete(edit.instanceId);
    }
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

  async function persistReschedule(instanceId: string): Promise<void> {
    if (!onMutate || !api) return;

    const moved = api.getState().tasks.byId(instanceId);
    if (!moved || !(moved.start instanceof Date) || !(moved.end instanceof Date)) {
      return;
    }
    const newStart: Date = moved.start;
    const newEnd: Date = moved.end;

    // Resolve source identity → sibling instances (same source, other rows).
    const sourcePath =
      (moved.custom?.sourceTaskId as string | undefined) ??
      instances.find((i) => i.id === instanceId)?.sourcePath;

    // Capture pre-drag dates for the dragged row + every sibling, for revert.
    const originals = new Map<string, { start: Date; end: Date }>();
    for (const inst of instances) {
      if (inst.sourcePath === sourcePath && inst.start && inst.end) {
        originals.set(inst.id, { start: inst.start, end: inst.end });
      }
    }

    // Optimistic mirror: move sibling rows immediately (tagged as our own write).
    for (const inst of instances) {
      if (inst.sourcePath === sourcePath && inst.id !== instanceId) {
        api.exec("update-task", {
          id: inst.id,
          task: { start: newStart, end: newEnd },
          eventSource: OG_ECHO_SOURCE,
        });
      }
    }

    // In a write-enabled Time Estimate mode, the new span persists as the estimate
    // (minutes). Gated by `readOnly` so a standalone timeline never writes. Under
    // working-time stretch the estimate counts WORKING days of the resized span (a
    // stretched bar includes blocked days that carry no work), keeping the
    // read/write round-trip honest; without an associated calendar the count falls
    // back to plain calendar days.
    const estimateWritable = timeEstimateWriteEnabled && !readOnly;
    const estimateMinutes = estimateWritable
      ? spanDaysToMinutes(
          (sourcePath ? $data.countWorkingDays?.(sourcePath, newStart, newEnd) : undefined) ??
            inclusiveDaySpan(newStart, newEnd),
        )
      : undefined;

    // Default commit (as today): dates + estimate. The estimate is NOT mirrored
    // onto sibling rows (it isn't a rendered bar property).
    let patch: TaskPatch = { start: newStart, end: newEnd };
    if (estimateMinutes !== undefined) patch.estimate = estimateMinutes;

    // Inferred-edge drag gate (plan U4): when the dragged edge is inferred from
    // the estimate (a derived end/start), ask — or auto-apply the per-view mode —
    // whether to grow the estimate only (leave the date computed) or grow the
    // estimate AND materialise the dragged edge. `activeDrag` carries the pre-drag
    // provenance, read synchronously before the modal await (processSubtreeAndExtend
    // clears it on the next tick). Authored edges and whole-bar moves fall through
    // to the default commit above (R2).
    const before = activeDrag;
    if (
      before?.id === instanceId &&
      before.beforeStart &&
      before.beforeEnd &&
      estimateMinutes !== undefined
    ) {
      const inferredEdge = resolveInferredEdge(
        classifyDraggedEdge(before.beforeStart, before.beforeEnd, newStart, newEnd),
        before.beforeDateStatus ?? 'complete',
      );
      const outcome = resolveInferredDragOutcome({
        inferredEdge,
        mode: normalizeInferredDragMode($data.inferredDragMode),
        estimateWritable: true,
      });
      if (inferredEdge && outcome !== 'write-as-today') {
        let action: InferredDragAction;
        if (outcome === 'prompt') {
          const choice = await new InferredDragModal(app).openAndGetChoice();
          if (!choice) {
            // R7: cancel reverts the bar (+ mirrored siblings) and writes nothing.
            for (const [id, original] of originals) {
              api.exec("update-task", {
                id,
                task: { start: original.start, end: original.end },
                eventSource: OG_ECHO_SOURCE,
              });
            }
            return;
          }
          action = choice.action;
          if (choice.dontAskAgain) onInferredDragModeChange?.(action);
        } else {
          action = outcome;
        }
        const fields = buildInferredDragPatch({
          action,
          inferredEdge,
          newStart,
          newEnd,
          estimateMinutes,
        });
        patch = { estimate: fields.estimateMinutes };
        if (fields.materialise) {
          if (fields.materialise.edge === 'end') patch.end = fields.materialise.date;
          else patch.start = fields.materialise.date;
        }
      }
    }

    try {
      await withTimeout(onMutate(instanceId, patch), MUTATION_TIMEOUT_MS);
    } catch (err) {
      console.error('[GanttContainer] reschedule persist failed:', err);
      // Revert the dragged row and all mirrored siblings to pre-drag dates.
      for (const [id, original] of originals) {
        api.exec("update-task", {
          id,
          task: { start: original.start, end: original.end },
          eventSource: OG_ECHO_SOURCE,
        });
      }
      new Notice("Couldn't save date change — check TaskNotes is running.");
    }
  }

  /** Reject after `ms` if `p` has not settled (so a hung write still reverts). */
  function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('write timed out')), ms);
      p.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  // ── Subtree-move drag + gated ancestor extend (plan U4) ─────────────────────
  // The drag in flight: the dragged task's id, name, and its pre-drag dates
  // (captured synchronously so the subtree-shift delta is exact).
  let activeDrag: {
    id: string;
    name: string;
    beforeStart: Date | null;
    beforeEnd: Date | null;
    beforeDateStatus: DateStatus | null;
  } | null = null;
  let dragScheduled = false;

  /** Schedule the deferred subtree-shift + extend pass once per drag. */
  function scheduleSubtreeAndExtend(): void {
    if (dragScheduled) return;
    dragScheduled = true;
    setTimeout(() => void processSubtreeAndExtend(), 0);
  }

  /**
   * After a drag settles: if the dragged task is a parent and the gesture was a
   * pure *move* (both edges shifted by the same delta), shift every descendant
   * by that delta and persist it — children follow the parent, intervals
   * preserved. Then, if the moved subtree now exceeds an ancestor's window,
   * offer the gated extend (Ask/Auto/Never). A leaf/resize has no descendant
   * shift. All writes go through `onMutate` (→ TaskNotes) plus an optimistic
   * `api.exec` echo for the bar; the follow-up refresh runs under `syncing`.
   */
  async function processSubtreeAndExtend(): Promise<void> {
    dragScheduled = false;
    const drag = activeDrag;
    activeDrag = null;
    if (!api || !onMutate || readOnly || !drag) return;

    const moved = api.getState().tasks.byId(drag.id);
    if (!(moved?.start instanceof Date) || !(moved?.end instanceof Date)) return;

    // Pure move iff both edges shifted by the same whole-day delta (resize moves
    // one edge only → no subtree shift). Compared at day granularity so the
    // date-policy end-of-day (23:59:59.999) vs SVAR day-boundary snapping (00:00)
    // mismatch doesn't misread a move as a resize.
    const delta = computeMoveDelta(drag.beforeStart, drag.beforeEnd, moved.start, moved.end);

    // The new date window of every moved task, keyed by source note. Seeded with
    // the dragged task; for a pure move, each descendant is shifted by the same
    // delta (and persisted). A move that shifts a multi-parent task records that
    // task's source once — every placement of it (incl. alternate parents) then
    // counts toward its ancestors' extend check.
    const movedRanges = new Map<string, DateRange>();
    const addRange = (src: string, start: Date, end: Date) => {
      const prev = movedRanges.get(src);
      if (!prev) movedRanges.set(src, { start, end });
      else {
        if (start < prev.start) prev.start = start;
        if (end > prev.end) prev.end = end;
      }
    };
    const dSource = instances.find((i) => i.id === drag.id)?.sourcePath;
    if (dSource) addRange(dSource, moved.start, moved.end);

    if (delta !== 0) {
      // Every instance to shift: the dragged subtree's descendants AND their
      // multi-parent siblings under other parents (so duplicates stay in sync —
      // the self-write echo is suppressed, so an un-mirrored sibling would go
      // stale until a manual refresh and repeated drags would compound the gap).
      const shifts = computeSubtreeMove(drag.id, delta, instances);

      // Optimistically move every instance now (tagged as our own write).
      for (const s of shifts) {
        api.exec('update-task', { id: s.id, task: { start: s.start, end: s.end }, eventSource: OG_ECHO_SOURCE });
      }

      // Persist once per source note (its instances share one date); time-bounded
      // so a hung write still settles. Only a successful shift counts toward the
      // ancestor-extend calc; on failure revert every instance of that source.
      const bySource = new Map<string, SubtreeShift[]>();
      for (const s of shifts) {
        const arr = bySource.get(s.sourcePath) ?? [];
        arr.push(s);
        bySource.set(s.sourcePath, arr);
      }
      for (const [src, group] of bySource) {
        const rep = group[0];
        if (!rep) continue;
        try {
          await withTimeout(onMutate(rep.id, { start: rep.start, end: rep.end }), MUTATION_TIMEOUT_MS);
          addRange(src, rep.start, rep.end);
        } catch (err) {
          console.error('[GanttContainer] subtree-move persist failed:', err);
          for (const s of group) {
            const orig = instances.find((i) => i.id === s.id);
            if (orig?.start && orig?.end) {
              api.exec('update-task', { id: s.id, task: { start: orig.start, end: orig.end }, eventSource: OG_ECHO_SOURCE });
            }
          }
          new Notice("Couldn't move a child task — check TaskNotes is running.");
        }
      }
    } else if (drag.beforeStart && drag.beforeEnd) {
      // Parent-shrink guard: a *resize* (no subtree shift) that newly leaves D
      // smaller than its direct children. Offer to adjust D to wrap them, or
      // undo the resize — per the per-view mode. A pure move (delta !== 0) can't
      // orphan children (they moved with D), so this only runs for resizes.
      const childRanges: DateRange[] = instances
        .filter((i) => i.parent === drag.id && i.start && i.end)
        .map((i) => ({ start: i.start as Date, end: i.end as Date }));
      const fit = computeShrinkFit(
        { start: drag.beforeStart, end: drag.beforeEnd },
        { start: moved.start, end: moved.end },
        childRanges,
      );
      if (fit) {
        const mode = normalizeCascadeMode(get(data).cascadeMode);
        if (mode === 'never') return; // allow the overflow
        let adjust = true;
        if (mode === 'ask') {
          adjust = await new CascadeConfirmModal(app, {
            title: 'Parent is smaller than its children',
            body: `Resizing "${drag.name}" leaves it smaller than the tasks inside it. Adjust it to wrap its children, or undo the resize.`,
            confirmText: 'Adjust to fit',
            cancelText: 'Undo resize',
            rows: [{ name: drag.name, oldStart: moved.start, oldEnd: moved.end, newStart: fit.start, newEnd: fit.end }],
          }).openAndGetChoice();
        }
        const target = adjust ? fit : { start: drag.beforeStart, end: drag.beforeEnd };
        api.exec('update-task', { id: drag.id, task: { start: target.start, end: target.end }, eventSource: OG_ECHO_SOURCE });
        try {
          await withTimeout(onMutate(drag.id, { start: target.start, end: target.end }), MUTATION_TIMEOUT_MS);
        } catch (err) {
          console.error('[GanttContainer] shrink-fit persist failed:', err);
          // Revert the bar to the resize persistReschedule already saved.
          api.exec('update-task', { id: drag.id, task: { start: moved.start, end: moved.end }, eventSource: OG_ECHO_SOURCE });
          new Notice("Couldn't adjust the parent date — check TaskNotes is running.");
        }
        return; // shrink handled; don't also run the extend gate
      }
    }

    // Gated ancestor extend: every non-moved ancestor (across the whole tree,
    // including a moved task's alternate parents) that the moved tasks exceed.
    const mode = normalizeCascadeMode(get(data).cascadeMode);
    if (mode === 'never') return;

    const nodes: ExtensionNode[] = instances.map((i) => ({
      id: i.id,
      sourcePath: i.sourcePath,
      name: i.text,
      parent: i.parent,
      start: i.start,
      end: i.end,
    }));
    const extensions = computeMoveExtensions(movedRanges, nodes);
    if (extensions.length === 0) return;

    if (mode === 'ask') {
      const approved = await new CascadeConfirmModal(app, {
        title: 'Extend parent dates?',
        body:
          `Moving "${drag.name}" carries it outside the planned window of the task(s) below. ` +
          `Its new dates are already saved — this only extends them to include it, and can't be undone.`,
        confirmText: 'Extend all',
        rows: extensions,
      }).openAndGetChoice();
      if (!approved) return; // move already persisted; leave the overflow
    }

    for (const ext of extensions) {
      try {
        await withTimeout(onMutate(ext.instanceId, { start: ext.newStart, end: ext.newEnd }), MUTATION_TIMEOUT_MS);
      } catch (err) {
        console.error('[GanttContainer] ancestor extend persist failed:', err);
        new Notice("Couldn't update a parent date — check TaskNotes is running.");
      }
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
  class="og-bases-gantt"
  class:is-maximized={isMaximized}
  class:og-progress-readonly={progressReadonly}
  class:og-weekends-off={!highlightWeekends}
  bind:this={rootEl}
>
  <!-- Per-view toolbar (plan 002 U4): rendered above the chart only when the
       tngantt_showToolbar toggle is on (R2). Lives in Obsidian's own surface
       (styled with Obsidian CSS vars), outside the SVAR theme wrapper. -->
  {#if showToolbar}
    <GanttToolbar mode={mode} onModeChange={handleThemeModeChange} />
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

  <div class="gtcell">
    <!-- Full screen = "maximize within Obsidian" (plan 2026-06-30-002): the view
         root carries `.is-maximized` (CSS below) to fill the Obsidian window in
         Obsidian's own stacking context, so popups (Edit Modal, command palette,
         menus) render above the chart instead of being hidden behind the native
         top layer. The floating toggle + zoom controls are children of `.gtcell`
         (inside the maximized container), so they stay visible while maximized. -->
      <!-- tasks/links/taskTypes are seeded ONCE; data changes are applied as
           targeted api.exec actions (diff-sync $effect above) so SVAR never
           re-inits its store and the user's zoom/scroll/selection survive. -->
      <!-- Tooltip surfaces each task's incoming dependencies (reltype + gap)
           from custom.incomingDeps (U3); SVAR has no native link tooltip, so the
           dependent task's tooltip is the surface. Falls back to the task name
           for tasks with no dependencies. -->
      <Tooltip {api} content={DependencyTooltip}>
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
   * Bar-level date-status indicator (U4). SVAR renders a custom task type as a
   * bare class on the bar element (`wx-bar … datestatus-flagged`), so we target
   * `.datestatus-flagged` directly. One treatment covers every non-`complete`
   * state (placeholder / inferred / swapped): a distinct accent fill so an
   * incompletely-dated bar reads differently from a fully-dated one.
   */
  .og-bases-gantt :global(.wx-bar.datestatus-flagged) {
    background-color: #e67e22 !important;
    border-color: #c0392b !important;
  }

  .og-bases-gantt :global(.wx-bar.datestatus-flagged .wx-content) {
    color: white !important;
  }

  .og-bases-gantt :global(.wx-bar.datestatus-flagged .wx-progress-percent) {
    background-color: #c0392b !important;
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
  .og-bases-gantt :global(.wx-bars .wx-bar.wx-split > .wx-progress-wrapper) {
    display: none;
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
    background-color: var(--og-ghost-fill, var(--wx-gantt-task-color, #3d8de6));
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
    padding-left: 8px;
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
