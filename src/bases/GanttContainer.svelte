<script lang="ts">
  /* global HTMLElement, HTMLStyleElement, MouseEvent, setTimeout, clearTimeout, getComputedStyle */
  // Willow + WillowDark are imported only for their `:global` CSS side-effects
  // (each transitively pulls the core + grid + gantt theme layers), so BOTH
  // light and dark rule-sets ship in the bundle. We do NOT render them as
  // wrappers — the theme is applied via our own stable `wx-theme` wrapper below
  // (plan 002 U2), toggling its class/context with zero remount.
  import { Gantt, Tooltip, Willow, WillowDark, defaultTaskTypes } from '@svar-ui/svelte-gantt';
  import DependencyTooltip from './DependencyTooltip.svelte';
  import GanttToolbar from './GanttToolbar.svelte';
  import { Notice, setIcon } from 'obsidian';
  import { setContext } from 'svelte';
  import { get } from 'svelte/store';
  import {
    resolveThemeClass,
    resolveThemeContext,
    isObsidianDark,
    subscribeObsidianTheme,
    type ThemeMode,
  } from './themeResolver';
  import type { TaskPatch } from '../datasource/types';
  import type { GanttData } from './types/gantt-view-data';
  import type { RenderLink } from '../controller/InstanceExpansion';
  import { buildStatusStyleRules } from './statusColor';
  import {
    buildSvarTasks,
    buildStatusTaskTypes,
    planTaskSync,
    planLinkSync,
    type SvarTask,
    type SvarTaskInputs,
  } from './ganttSync';
  import {
    classifyUpdateEvent,
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
  import { CascadeConfirmModal } from './CascadeConfirmModal';
  import PropertyCell from './PropertyCell.svelte';
  import type { GridColumn } from './gridColumns';
  import { buildZoomConfig } from './zoomConfig';

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
    // eslint-disable-next-line no-unused-vars -- type-signature param names
    onMutate?: (instanceId: string, patch: TaskPatch) => Promise<void>;
    /**
     * Create a Finish-to-Start dependency from a drawn link (M2/U4): the task
     * behind `predecessorInstanceId` blocks the one behind `dependentInstanceId`.
     * Routed to the controller's `addDependency`. Absent in read-only contexts.
     */
    // eslint-disable-next-line no-unused-vars -- type-signature param names
    onAddDependency?: (predecessorInstanceId: string, dependentInstanceId: string) => Promise<void>;
    /**
     * Remove a dependency from a deleted link (M2/U3). Routed to the controller's
     * `removeDependency`. Absent in read-only contexts.
     */
    // eslint-disable-next-line no-unused-vars -- type-signature param names
    onRemoveDependency?: (predecessorInstanceId: string, dependentInstanceId: string) => Promise<void>;
    /**
     * Native edit interaction: invoked on a left/double-click of a bar with the
     * resolved note path, the click kind, and whether ctrl/meta was held. The
     * binder (register.ts) routes this to the TaskNotes interaction service
     * (open note / open native edit modal per TaskNotes settings).
     */
    // eslint-disable-next-line no-unused-vars -- type-signature param names
    onBarActivate?: (path: string, opts: { kind: 'single' | 'double'; ctrlOrMeta: boolean }) => void;
    /**
     * Native context menu: invoked on right-click of a bar with the resolved
     * note path and the mouse event, routed to TaskNotes' own task menu.
     */
    // eslint-disable-next-line no-unused-vars -- type-signature param names
    onBarContextMenu?: (path: string, event: MouseEvent) => void;
    /**
     * Persist a column's new width (U5/R8). Invoked on a resize commit with the
     * Bases property id the column maps to (the name column reports its name
     * key, not `text`). The binder writes it to the standard `columnSize` map.
     */
    // eslint-disable-next-line no-unused-vars -- type-signature param names
    onColumnResize?: (propId: string, width: number) => void;
    /**
     * Persist the grid/timeline divider width (plan 002 U3). Invoked on a
     * `resize-grid` commit with the new grid-pane width; the binder writes it to
     * the standard `obsidianGantt.tableWidth`. In-session dragging is SVAR's own
     * Resizer — this only persists the chosen width across reloads.
     */
    // eslint-disable-next-line no-unused-vars -- type-signature param names
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
    // eslint-disable-next-line no-unused-vars -- type-signature param names
    onThemeModeChange?: (mode: ThemeMode) => void;
  }

  // `config` remains part of the props contract (register.ts passes it) but the
  // controller owns the transform, so the view does not read it. `app` is used
  // to host the parent-date-cascade confirmation modal (U3/U4).
  let {
    data,
    app,
    onMutate,
    onAddDependency,
    onRemoveDependency,
    onBarActivate,
    onBarContextMenu,
    onColumnResize,
    onGridWidthChange,
    themeMode = 'auto',
    onThemeModeChange,
  }: Props = $props();

  // ── Theme (plan 002 U2) ─────────────────────────────────────────────────
  // Reference the theme components so their `:global` theme CSS is retained in
  // the bundle without rendering them as wrappers. Importing both guarantees
  // BOTH light + dark rule-sets ship across the core/grid/gantt layers; the
  // active theme is selected purely by the wrapper's class/context below.
  void Willow;
  void WillowDark;

  // Live theme mode (seeded from the per-view prop) + the current Obsidian
  // dark/light read. The wrapper's class + `wx-theme` context derive from these
  // via the pure resolvers (U1) — toggling them re-applies the SVAR CSS
  // variables instantly with NO remount of the Gantt/Tooltip subtree.
  // One-shot reads at init for seeding both the reactive state and the context
  // (the context is captured once; see setContext below).
  const initialMode: ThemeMode = themeMode;
  const initialDark = isObsidianDark();
  let mode = $state<ThemeMode>(initialMode);
  let obsidianIsDark = $state(initialDark);

  const effectiveThemeClass = $derived(resolveThemeClass(mode, obsidianIsDark));

  // Replicate SVAR's load-bearing `wx-theme` context (the core Willow/WillowDark
  // components set it). `Portal.svelte` reads it via getContext to theme
  // portalled content — the dependency Tooltip — so dropping it would render
  // that tooltip unthemed. `setContext` is one-shot: the value is captured ONCE
  // at mount and frozen for the view's session — SVAR's Portal re-reads it per
  // open but always gets that frozen string, so it is NOT re-themed live. The
  // chart itself DOES re-theme live (the wrapper's `wx-…-theme` class is
  // reactive via effectiveThemeClass), but an already-mounted view's dependency
  // tooltip renders at the mount-time theme for the whole session. Acceptable:
  // the tooltip is transient, and a fresh view mount picks up the current theme.
  // (A live-context fix isn't worth it — SVAR consumes a plain string, not a
  // store.) Computed from the initial mode/dark read (not the reactive $derived)
  // to make the one-shot capture explicit and avoid a misleading "state
  // referenced locally" warning.
  setContext('wx-theme', resolveThemeContext(initialMode, initialDark));

  // While in Auto, follow Obsidian's theme live (R1/R6) — independent of toolbar
  // visibility. Re-read `isObsidianDark()` on each `css-change` (MutationObserver
  // fallback inside the helper). Subscribe only in Auto; dispose on mode change
  // and on unmount.
  $effect(() => {
    if (mode !== 'auto') return;
    // Sync immediately in case the theme changed since mount/last subscription.
    obsidianIsDark = isObsidianDark();
    const dispose = subscribeObsidianTheme(app, () => {
      obsidianIsDark = isObsidianDark();
    });
    return dispose;
  });

  /**
   * Toolbar change handler: persist the chosen mode per-view (U3/U4). The live
   * `mode` state is owned by `bind:mode` on <GanttToolbar> — the toolbar already
   * wrote it before calling this — so this only persists; re-setting `mode` here
   * would be a redundant double-write (FIX C).
   */
  function handleThemeModeChange(next: ThemeMode): void {
    onThemeModeChange?.(next);
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
  const dateMappingNotice = $derived($data.dateMappingNotice);
  const taskNotesPresent = $derived($data.taskNotesPresent);
  // Toolbar visibility is store-driven (FIX A): reading it from the reactive
  // data — like showDateIndicators — makes the `tngantt_showToolbar` option a
  // LIVE toggle (show/hide without a remount). Default off (R6) is preserved by
  // register.getShowToolbar()'s `=== true` default-false read.
  const showToolbar = $derived($data.showToolbar ?? false);

  // Tags our own programmatic store writes (sibling mirror, revert) so the
  // update-task intercept ignores them and we never re-persist an echo (the
  // SVAR-store echo guard — KTD "two echo loops").
  const OG_ECHO_SOURCE = 'og-self';
  // A drag/resize write that never settles (TaskNotes hang/disabled mid-write)
  // still reverts the optimistic move within this window.
  const MUTATION_TIMEOUT_MS = 10000;

  // Generated stylesheet coloring each present status' bar by its configured
  // TaskNotes color (scoped under .og-bases-gantt). Injected via a managed
  // style element (see the $effect below) — a literal style tag in markup would
  // be compiled away as component CSS and cannot carry this dynamic content.
  const statusStyleCss = $derived(buildStatusStyleRules(instances, statusColors));

  // The view root, used to host the generated status-color stylesheet.
  let rootEl: HTMLElement | undefined = $state();
  $effect(() => {
    const css = statusStyleCss;
    if (!rootEl) return;
    let styleEl = rootEl.querySelector('style[data-og-status]') as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.setAttribute('data-og-status', '');
      rootEl.appendChild(styleEl);
    }
    styleEl.textContent = css;
  });

  // Native interaction listeners on the chart root (U2): capture the last
  // pointer's ctrl/meta (show-editor carries none), and route a right-click on a
  // bar to the native TaskNotes task menu. Bars carry `data-id` (the instance
  // id); we map it to the source path and invoke onBarContextMenu.
  $effect(() => {
    const el = rootEl;
    if (!el) return;
    const onPointerDown = (e: MouseEvent) => {
      lastCtrlMeta = e.ctrlKey || e.metaKey;
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
    el.addEventListener('contextmenu', onContextMenu, true);
    return () => {
      el.removeEventListener('mousedown', onPointerDown, true);
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
      showDateIndicators: d.showDateIndicators ?? true,
      arrowMode: d.arrowMode,
      propertyValues: d.propertyValues,
    };
  }

  const initialData = get(data);
  // Plain seed values, used both to seed the `$state` props below and the
  // applied-state maps further down (referencing the consts, not the $state,
  // avoids a spurious "state referenced locally" warning).
  const seedTasks0: SvarTask[] = buildSvarTasks(toInputs(initialData));
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

  // Registered custom task-type superset (date-status flag + status-color
  // classes), derived from the status palette rather than the present tasks.
  // FIXED at mount and never reassigned: changing any prop SVAR reads re-inits
  // its store (reverting our incremental updates to the seed), so this stays a
  // const. A status value added to TaskNotes config while the view is open won't
  // color until the view is reopened — rare, and acceptable.
  const svarTaskTypes = [
    ...defaultTaskTypes,
    ...buildStatusTaskTypes(initialData.statusColors ?? []),
  ];

  // Last-applied SVAR state, diffed against each incoming GanttData. Seeded from
  // the initial render so the first diff after mount is a no-op.
  const appliedTasks = new Map<string, SvarTask>();
  for (const t of seedTasks0) appliedTasks.set(t.id, t);
  const appliedLinks = new Map<string, RenderLink>();
  for (const l of seedLinks0) appliedLinks.set(l.id, l);

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

  function syncToGantt(d: GanttData): void {
    // A column-config change can't be applied incrementally — SVAR has no
    // per-column update action, and a new `columns` reference re-inits the whole
    // store from the seed props. So when the fingerprint changes, reseed columns
    // AND tasks/links to the current data together (a lone columns reseed would
    // re-init from the stale frozen task seed, dropping incremental updates),
    // resync the applied maps, and let the single re-init render it. Zoom/scroll
    // reset here — accepted, since this only fires on an actual column change.
    if (d.gridColumnsKey !== appliedColumnsKey) {
      reseedForColumnChange(d);
      return;
    }

    const taskPlan = planTaskSync(appliedTasks, buildSvarTasks(toInputs(d)));
    const linkPlan = planLinkSync(appliedLinks, d.links);

    const noop =
      !taskPlan.moves.length &&
      !taskPlan.updates.length &&
      !taskPlan.deletes.length &&
      !taskPlan.adds.length &&
      !linkPlan.deletes.length &&
      !linkPlan.adds.length;
    if (noop) return;

    syncing = true;
    try {
      // Order: reparent → field updates → remove links → remove tasks (leaf-first)
      // → add tasks (parent-first) → add links (endpoints now exist).
      for (const m of taskPlan.moves) {
        api.exec('move-task', { id: m.id, target: m.parent, mode: 'child', eventSource: OG_ECHO_SOURCE });
      }
      for (const u of taskPlan.updates) {
        api.exec('update-task', { id: u.id, task: u.task, eventSource: OG_ECHO_SOURCE });
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
    } finally {
      syncing = false;
    }
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

    const tasks = buildSvarTasks(toInputs(d));
    initialTasks = tasks;
    initialLinks = d.links;

    appliedTasks.clear();
    for (const t of tasks) appliedTasks.set(t.id, t);
    appliedLinks.clear();
    for (const l of d.links) appliedLinks.set(l.id, l);

    // The re-init triggers the column recompute (gridWidth → column-sum); re-
    // assert the user's persisted divider width afterward so a column-config
    // change doesn't silently reset it.
    applyPersistedGridWidth();
  }

  // Svelte action to set Obsidian/Lucide icons (OG-81)
  function lucideIcon(node: HTMLElement, iconName: string) {
    setIcon(node, iconName);
    return {
      update(newIconName: string) {
        node.empty();
        setIcon(node, newIconName);
      }
    };
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
    // SVAR cell component for property columns; the name column omits it (uses
    // the default cell, which renders the tree + row.text).
    cell?: typeof PropertyCell;
  }

  /** Turn config-derived descriptors into SVAR columns (fresh objects). */
  function buildSvarColumns(descriptors: GridColumn[]): SvarGridColumn[] {
    return descriptors.map((c) => {
      const col: SvarGridColumn = {
        id: c.id,
        header: c.header,
        width: c.width,
        align: c.align,
        resize: true,
      };
      if (!c.isName) col.cell = PropertyCell;
      return col;
    });
  }

  let columns: SvarGridColumn[] = $state(buildSvarColumns(initialData.gridColumns));
  // Last-applied column-config fingerprint; a change triggers a reseed (see the
  // diff-sync $effect). Plain `let` — read/written only inside the effect.
  let appliedColumnsKey = initialData.gridColumnsKey;

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
   * gridWidth = column-sum at mount/reseed). Deferred so it runs after that
   * recompute settles; `resize-grid` doesn't re-trigger the recompute (it keys
   * on columns/displayMode), so the value sticks until the next column change.
   */
  function applyPersistedGridWidth(): void {
    if (lastGridWidth == null || !api?.exec) return;
    const width = lastGridWidth;
    setTimeout(() => {
      try {
        api?.exec?.('resize-grid', { width });
      } catch {
        /* exec unavailable — restore inert; in-session drag still works */
      }
    }, 0);
  }

  // Initialize API and intercept editor events
  function initGantt(ganttApi: GanttAPI) {
    api = ganttApi;
    wireColumnResizePersistence(ganttApi);
    wireGridWidthPersistence(ganttApi);
    // Restore the persisted divider width after the initial column recompute.
    applyPersistedGridWidth();

    // Log the state SVAR received
    console.log('[GanttContainer] SVAR Gantt initialized');
    if (api && api.getState) {
      const state = api.getState();
      console.log('[GanttContainer] SVAR state:', state);
      console.log('[GanttContainer] SVAR tasks count:', state?.tasks?.length || 0);
      if (state?.tasks && state.tasks.length > 0) {
        console.log('[GanttContainer] First SVAR task:', state.tasks[0]);
      }
    }

    // Native edit interaction (U2): a bar's left/double-click routes to the
    // TaskNotes interaction service (via onBarActivate) instead of a custom
    // modal — TaskNotes performs the configured action (open note / open its own
    // edit modal). Single vs double is disambiguated with a short debounce.
    //
    // Double-click → SVAR fires `show-editor` (no modifier info; we use the
    // last pointer's ctrl/meta). We always return false so SVAR's own editor
    // never opens — editing is fully delegated to TaskNotes.
    api.intercept("show-editor", ({ id }: { id: string }) => {
      if (pendingSingleClick) {
        clearTimeout(pendingSingleClick);
        pendingSingleClick = null;
      }
      if (id) {
        activateBar(String(id), 'double', lastCtrlMeta);
      }
      return false;
    });

    // Single-click → SVAR fires `select-task` (carries `toggle` = ctrl/meta).
    // Defer the action so a following double-click can cancel it. Allow SVAR's
    // own selection to proceed (return true) — we only add the native action.
    api.intercept("select-task", (ev: { id?: string | number; toggle?: boolean }) => {
      const id = ev?.id != null ? String(ev.id) : null;
      if (id) {
        const ctrlOrMeta = ev.toggle === true;
        if (pendingSingleClick) {
          clearTimeout(pendingSingleClick);
        }
        pendingSingleClick = setTimeout(() => {
          pendingSingleClick = null;
          activateBar(id, 'single', ctrlOrMeta);
        }, 250);
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
      const cls = classifyUpdateEvent(ev, { echoSource: OG_ECHO_SOURCE, syncing });
      if (cls === 'user-gesture' && !readOnly && !!onMutate && ev.id != null) {
        const id = String(ev.id);
        const before = instances.find((i) => i.id === id);
        // Capture pre-drag dates synchronously (instances is still the pre-drag
        // snapshot now) for the subtree-shift delta.
        activeDrag = {
          id,
          name: before?.text ?? 'this task',
          beforeStart: before?.start ?? null,
          beforeEnd: before?.end ?? null,
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

    // Fix initial scroll position - ensure the grid starts with first column visible
    // SVAR Gantt sometimes initializes with horizontal scroll that hides the first column
    setTimeout(() => {
      try {
        console.log('[GanttContainer] Attempting to reset grid scroll position...');

        // Try multiple possible selectors for the scrollable grid container
        const selectors = [
          '.og-bases-gantt .wx-grid',
          '.og-bases-gantt .wx-grid-area',
          '.og-bases-gantt .wx-grid-data',
          '.og-bases-gantt .wx-layout-grid',
          '.og-bases-gantt .wx-grid-body',
          '.og-bases-gantt [data-id="grid"]',
        ];

        let foundScrollable = false;
        for (const selector of selectors) {
          const element = document.querySelector(selector) as HTMLElement;
          if (element) {
            console.log(`[GanttContainer] Found element with selector "${selector}"`, {
              scrollLeft: element.scrollLeft,
              scrollWidth: element.scrollWidth,
              clientWidth: element.clientWidth,
              overflowX: getComputedStyle(element).overflowX,
            });

            // Reset scroll if this element has scrollLeft > 0
            if (element.scrollLeft > 0) {
              console.log(`[GanttContainer] Resetting scrollLeft from ${element.scrollLeft} to 0`);
              element.scrollLeft = 0;
              foundScrollable = true;
            }
          }
        }

        if (!foundScrollable) {
          console.warn('[GanttContainer] Could not find grid element with scroll to reset');
          // Log all elements with wx- classes for debugging
          const wxElements = document.querySelectorAll('[class*="wx-"]');
          console.log('[GanttContainer] Found elements with wx- classes:', Array.from(wxElements).map(el => el.className));
        } else {
          console.log('[GanttContainer] Successfully reset grid scroll position');
        }
      } catch (error) {
        console.error('[GanttContainer] Error resetting grid scroll:', error);
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

    try {
      await withTimeout(onMutate(instanceId, { start: newStart, end: newEnd }), MUTATION_TIMEOUT_MS);
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
  let activeDrag: { id: string; name: string; beforeStart: Date | null; beforeEnd: Date | null } | null = null;
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

<div class="og-bases-gantt" bind:this={rootEl}>
  <!-- Per-view toolbar (plan 002 U4): rendered above the chart only when the
       tngantt_showToolbar toggle is on (R2). Lives in Obsidian's own surface
       (styled with Obsidian CSS vars), outside the SVAR theme wrapper. -->
  {#if showToolbar}
    <GanttToolbar bind:mode onModeChange={handleThemeModeChange} />
  {/if}

  <!-- Our own stable theme wrapper (plan 002 U2): replaces SVAR's <Willow>.
       The class toggles wx-willow-theme ↔ wx-willow-dark-theme reactively
       (effectiveThemeClass) with NO remount of the <Gantt>/<Tooltip> subtree.
       Both themes' CSS is bundled via the Willow/WillowDark imports above. The
       matching wx-theme context (set in the script) themes the dependency
       tooltip's Portal. The font CDN <link> that <Willow> emitted is
       intentionally omitted (the prior `fonts={false}` intent). -->
  <div class="wx-theme og-theme-wrapper {effectiveThemeClass}">
    <!-- Read-only banner (R5/R11): shown whenever the active source has no
         write capability, regardless of which source is active. Copy varies on
         whether TaskNotes is present (see readOnlyBannerText). -->
    {#if readOnly}
      <div class="og-readonly-banner" role="status">
        <span class="og-readonly-icon" use:lucideIcon={'lock'}></span>
        <span class="og-readonly-text">{readOnlyBannerText}</span>
      </div>
    {/if}

    <!-- Invalid date-mapping notice (U4/R-C): a configured start/end property
         isn't a writable TaskNotes date field, so it fell back to the default. -->
    {#if dateMappingNotice}
      <div class="og-readonly-banner" role="status">
        <span class="og-readonly-icon" use:lucideIcon={'alert-triangle'}></span>
        <span class="og-readonly-text">{dateMappingNotice}</span>
      </div>
    {/if}

    <div class="gtcell">
      <!-- tasks/links/taskTypes are seeded ONCE; data changes are applied as
           targeted api.exec actions (diff-sync $effect above) so SVAR never
           re-inits its store and the user's zoom/scroll/selection survive. -->
      <!-- Tooltip surfaces each task's incoming dependencies (reltype + gap)
           from custom.incomingDeps (U3); SVAR has no native link tooltip, so the
           dependent task's tooltip is the surface. Falls back to the task name
           for tasks with no dependencies. -->
      <Tooltip {api} content={DependencyTooltip}>
        <Gantt
          init={initGantt}
          tasks={initialTasks}
          taskTypes={svarTaskTypes}
          links={initialLinks}
          {columns}
          gridWidth={initialGridWidth}
          zoom={zoomConfig}
          readonly={svarReadonly}
        />
      </Tooltip>

      <!-- Floating Zoom Controls (OG-81) -->
      <div class="zoom-controls">
        <button
          class="zoom-btn zoom-in"
          onclick={() => api?.exec("zoom-scale", { dir: 1, date: new Date() })}
          aria-label="Zoom in"
          title="Zoom in"
        >
          <span class="zoom-icon" use:lucideIcon={'plus'}></span>
        </button>
        <button
          class="zoom-btn zoom-out"
          onclick={() => api?.exec("zoom-scale", { dir: -1, date: new Date() })}
          aria-label="Zoom out"
          title="Zoom out"
        >
          <span class="zoom-icon" use:lucideIcon={'minus'}></span>
        </button>
      </div>
    </div>

    <!-- Editing is delegated to native TaskNotes (U2): no custom editor modal.
         Left/double-click and right-click on bars route through onBarActivate /
         onBarContextMenu to the TaskNotes interaction service. -->
  </div>
</div>

<style>
  .og-bases-gantt {
    height: 400px;
    width: 100%;
    min-height: 400px;
    /* Column layout so the optional toolbar takes its natural height and the
       chart fills the remaining space — without this the toolbar + a height:100%
       chart overflow the fixed-height view, clipping the toolbar or the floating
       zoom buttons on scroll. */
    display: flex;
    flex-direction: column;
    /* Use Obsidian's font stack since we disabled SVAR fonts */
    font-family: var(--font-interface), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }

  /* SVAR theme wrapper: fills the remaining height below the toolbar (flex child,
     min-height:0 so it can shrink within the flex column rather than overflow). */
  .og-theme-wrapper {
    flex: 1 1 auto;
    min-height: 0;
  }

  .gtcell {
    /* No toolbar to reserve space for — the chart fills the view. (Any banner
       sits above and pushes the chart down naturally.) */
    height: 100%;
    /* Position relative for floating zoom controls (OG-81) */
    position: relative;
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

  /* Floating Zoom Controls - Google Maps style (OG-81) */
  .zoom-controls {
    position: absolute;
    bottom: 16px;
    right: 16px;
    display: flex;
    flex-direction: column;
    z-index: 100;
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

  .og-bases-gantt :global(.wx-icon.wxi-fullscreen)::before {
    content: "";
    display: block;
    width: 100%;
    height: 100%;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 7V5a2 2 0 0 1 2-2h2'/%3E%3Cpath d='M17 3h2a2 2 0 0 1 2 2v2'/%3E%3Cpath d='M21 17v2a2 2 0 0 1-2 2h-2'/%3E%3Cpath d='M7 21H5a2 2 0 0 1-2-2v-2'/%3E%3C/svg%3E");
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

  /* OG-82: Grid collapse/expand arrow icons for SVAR Resizer */
  /* These icons are used by SVAR's built-in Resizer component for panel toggle */
  .og-bases-gantt :global(.wxi-menu-left) {
    display: inline-block;
    width: 20px;
    height: 20px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%235f6368' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m15 18-6-6 6-6'/%3E%3C/svg%3E");
    background-size: contain;
    background-repeat: no-repeat;
    background-position: center;
  }

  .og-bases-gantt :global(.wxi-menu-left:hover) {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%237c3aed' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m15 18-6-6 6-6'/%3E%3C/svg%3E");
  }

  .og-bases-gantt :global(.wxi-menu-right) {
    display: inline-block;
    width: 20px;
    height: 20px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%235f6368' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m9 18 6-6-6-6'/%3E%3C/svg%3E");
    background-size: contain;
    background-repeat: no-repeat;
    background-position: center;
  }

  .og-bases-gantt :global(.wxi-menu-right:hover) {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%237c3aed' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m9 18 6-6-6-6'/%3E%3C/svg%3E");
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

  /* SVAR expand/collapse toggle icons - ensure visibility */
  .og-bases-gantt :global(.wx-toggle-icon) {
    display: inline-block !important;
    width: 16px !important;
    height: 16px !important;
    color: var(--text-muted) !important;
    opacity: 1 !important;
    visibility: visible !important;
    font-size: 16px !important;
    line-height: 16px !important;
  }

  .og-bases-gantt :global(.wx-toggle-icon:hover) {
    color: var(--text-normal) !important;
  }

  /* Ensure SVAR icon fonts are loaded and visible */
  .og-bases-gantt :global(.wx-toggle-icon::before) {
    opacity: 1 !important;
    visibility: visible !important;
    display: inline-block !important;
    font-size: 16px !important;
    line-height: 16px !important;
  }

  /* Inject offline-friendly Lucide chevron icons using inline SVG */
  .og-bases-gantt :global(.wxi-menu-down),
  .og-bases-gantt :global(.wxi-menu-right) {
    display: inline-block !important;
    width: 16px !important;
    height: 16px !important;
    opacity: 1 !important;
    visibility: visible !important;
  }

  /* Lucide chevron-down icon as inline SVG data URI */
  .og-bases-gantt :global(.wxi-menu-down::before) {
    content: '' !important;
    display: inline-block !important;
    width: 16px !important;
    height: 16px !important;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") !important;
    background-size: contain !important;
    background-repeat: no-repeat !important;
    background-position: center !important;
    opacity: 0.7 !important;
    visibility: visible !important;
  }

  /* Lucide chevron-right icon as inline SVG data URI */
  .og-bases-gantt :global(.wxi-menu-right::before) {
    content: '' !important;
    display: inline-block !important;
    width: 16px !important;
    height: 16px !important;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m9 18 6-6-6-6'/%3E%3C/svg%3E") !important;
    background-size: contain !important;
    background-repeat: no-repeat !important;
    background-position: center !important;
    opacity: 0.7 !important;
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
