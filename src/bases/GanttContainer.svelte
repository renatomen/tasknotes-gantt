<script lang="ts">
  /* global HTMLElement, HTMLStyleElement, MouseEvent, setTimeout, clearTimeout, getComputedStyle */
  import { Gantt, Willow, defaultTaskTypes } from '@svar-ui/svelte-gantt';
  import { Toolbar } from '@svar-ui/svelte-toolbar';
  import { Notice, setIcon } from 'obsidian';
  import type { RenderInstance, RenderLink, LinkRewriteMode } from '../controller/InstanceExpansion';
  import type { StatusColor, TaskPatch } from '../datasource/types';
  import { statusSlug, buildStatusStyleRules } from './statusColor';

  // Component props (U7): the controller now owns the transform. The view
  // receives expanded render instances + rewritten links + the active source's
  // capabilities, and no longer does its own `data`/`fieldMappings` transform.
  interface Props {
    /** Expanded SVAR render instances from the controller (U5/U6). */
    instances: RenderInstance[];
    /** Dependency links rewritten to instance-id endpoints (U5/U6). */
    links: RenderLink[];
    /** Active source capabilities — the single source of read-only truth (R5). */
    capabilities: { write: boolean };
    /** Per-view dependency-arrow mode (R27): 'primary' | 'all'. */
    arrowMode: LinkRewriteMode;
    /**
     * Per-view toggle for bar-level date-status indicators (R10/R11); default
     * on. When on, non-`complete` instances (placeholder/inferred/swapped) get a
     * distinct bar treatment; when off, no flagging is applied.
     */
    showDateIndicators?: boolean;
    app: import('obsidian').App;
    config?: import('./register').BasesViewConfig;
    /**
     * Optional flag distinguishing "no TaskNotes installed" from "TaskNotes
     * present but write capability off" for the read-only banner copy. When
     * absent we default to the install-TaskNotes copy (see banner below).
     * TODO: thread this from the controller/source once it surfaces TaskNotes
     * presence independently of write capability.
     */
    taskNotesPresent?: boolean;
    /**
     * Status→color palette from the source layer (TaskNotes). Bars are colored
     * by their task's status using these. Empty ⇒ no status coloring.
     */
    statusColors?: StatusColor[];
    /**
     * Persist a field patch for a render instance through the controller (U8).
     * The view calls this on a drag/resize commit (dates-only patch). Absent in
     * read-only contexts / older callers — drag persistence is then inert.
     */
    // eslint-disable-next-line no-unused-vars -- type-signature param names
    onMutate?: (instanceId: string, patch: TaskPatch) => Promise<void>;
    /**
     * One-line notice shown when a start/end date mapping fell back to the
     * default because the configured property isn't a writable TaskNotes date
     * field (U4/R-C). Absent when both mappings are valid.
     */
    dateMappingNotice?: string;
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
  }

  // `app` and `config` remain part of the props contract (register.ts passes
  // them) but the controller now owns the transform, so the view does not read
  // them. Only the controller-derived data + capabilities drive rendering.
  let {
    instances,
    links,
    capabilities,
    arrowMode,
    showDateIndicators = true,
    taskNotesPresent,
    statusColors = [],
    onMutate,
    dateMappingNotice,
    onBarActivate,
    onBarContextMenu,
  }: Props = $props();

  // Tags our own programmatic store writes (sibling mirror, revert) so the
  // update-task intercept ignores them and we never re-persist an echo (the
  // SVAR-store echo guard — KTD "two echo loops").
  const OG_ECHO_SOURCE = 'og-self';
  // A drag/resize write that never settles (TaskNotes hang/disabled mid-write)
  // still reverts the optimistic move within this window.
  const MUTATION_TIMEOUT_MS = 10000;

  // Custom SVAR task type used to flag bars whose dates were inferred,
  // swapped, or placeholdered (one indicator state for all non-`complete`
  // values — origin R10 only distinguishes "not fully dated" from complete).
  // Registered in `taskTypes` so SVAR emits its class on the bar element.
  const DATE_STATUS_TYPE = 'datestatus-flagged';

  // Status values that have a configured color are eligible for a status class.
  const coloredStatuses = $derived(new Set(statusColors.map((c) => c.value)));

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
      const bar = target?.closest?.('.wx-bar[data-id]') as HTMLElement | null;
      const id = bar?.getAttribute('data-id');
      if (!id) return;
      const path = idToSourcePath.get(id);
      if (path && onBarContextMenu) {
        e.preventDefault();
        onBarContextMenu(path, e);
      }
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

  // Set of instance ids that are the *primary* instance for their source path.
  // In 'primary' arrow mode, arrows are drawn only on the primary instance, so
  // non-primary instances of a task that has dependencies get a lightweight
  // "has dependencies" indicator instead (U7 Design/UX spec).
  const linkedSourcePaths = $derived.by(() => {
    const paths = new Set<string>();
    // Map instance id → sourcePath for endpoint resolution.
    const idToSource = new Map<string, string>();
    for (const inst of instances) {
      idToSource.set(inst.id, inst.sourcePath);
    }
    for (const link of links) {
      const s = idToSource.get(link.source);
      const t = idToSource.get(link.target);
      if (s) paths.add(s);
      if (t) paths.add(t);
    }
    return paths;
  });

  // The primary (first-in-order) instance id for each source path. Mirrors the
  // controller's "primary = first stable-sorted instance" rule.
  const primaryInstanceIdBySource = $derived.by(() => {
    const primary = new Map<string, string>();
    for (const inst of instances) {
      if (!primary.has(inst.sourcePath)) {
        primary.set(inst.sourcePath, inst.id);
      }
    }
    return primary;
  });

  // Map RenderInstance[] → SVAR tasks. Parents are marked summary/open for
  // hierarchy, exactly as the previous transform did. The controller's
  // date-policy transform (U1/U2) has already resolved every instance's
  // start/end to concrete dates, so the view applies no missing-date fallback —
  // it renders the resolved dates directly and styles the bar off `dateStatus`.
  const tasks = $derived.by(() => {
    // Which instance ids are referenced as a parent → mark them summary/open.
    const parentIds = new Set<string>();
    for (const inst of instances) {
      if (inst.parent) {
        parentIds.add(inst.parent);
      }
    }

    return instances.map((inst) => {
      const isParent = parentIds.has(inst.id);
      const isPrimary = primaryInstanceIdBySource.get(inst.sourcePath) === inst.id;
      const hasDeps = linkedSourcePaths.has(inst.sourcePath);

      // A summary (parent) bar always stays a summary; only leaf bars can be
      // flagged. Flag when indicators are on and the dates aren't `complete`.
      const flagged = showDateIndicators && !isParent && inst.dateStatus !== 'complete';

      // Compose the bar's SVAR `type` from the state classes it needs: the
      // date-status flag (when flagged) plus the status color class (when the
      // status has a configured color). Parents stay `summary`. SVAR's
      // taskTypeCss emits each space-joined, registered type id as bare classes.
      let type = 'task';
      if (isParent) {
        type = 'summary';
      } else {
        const classes: string[] = [];
        if (flagged) classes.push(DATE_STATUS_TYPE);
        if (inst.status && coloredStatuses.has(inst.status)) {
          classes.push(statusSlug(inst.status));
        }
        if (classes.length > 0) type = classes.join(' ');
      }

      const task: Record<string, unknown> = {
        id: inst.id,
        text: inst.text,
        start: inst.start,
        end: inst.end,
        progress: inst.progress ?? 0,
        type,
        // Carry render-instance metadata so the grid cell can render indicators
        // (multi-parent duplicate icon, has-dependencies badge) without any
        // heavy per-row logic.
        custom: {
          sourceTaskId: inst.sourcePath,
          isVirtual: inst.isVirtual,
          isCollapsed: inst.isCollapsed,
          // In 'primary' mode, a non-primary instance of a task that owns a
          // dependency shows the "has dependencies" indicator (no arrow drawn).
          showHasDeps: arrowMode === 'primary' && hasDeps && !isPrimary,
        },
      };

      if (inst.parent) {
        task.parent = inst.parent;
      }
      if (isParent) {
        task.open = true;
      }

      return task;
    });
  });

  // Register every composed custom type id the bars actually use (date-status
  // flag and/or status color classes) so SVAR's taskTypeCss emits them as bar
  // classes; built-in task/summary/milestone need no registration.
  const taskTypes = $derived.by(() => {
    const custom = new Set<string>();
    for (const t of tasks) {
      const id = t.type as string;
      if (id && id !== 'task' && id !== 'summary' && id !== 'milestone') {
        custom.add(id);
      }
    }
    return [...defaultTaskTypes, ...[...custom].map((id) => ({ id, label: id }))];
  });

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

  // Single text column for the grid. The controller owns the transform now, so
  // the column set is no longer derived from Bases visible properties — we show
  // the task-name column (required first for SVAR hierarchy: indentation +
  // expand/collapse chevrons), rendered with SVAR's default cell so task names
  // appear.
  //
  // NOTE (deferred follow-up): the multi-parent duplicate icon + has-dependencies
  // indicator (R24/R27 visual cues) were attempted via a Svelte `snippet` passed
  // as the column `cell`, but SVAR v2.3.0 does not render a snippet there (it
  // expects a cell *component*), which left the grid name cells blank. Reverted
  // to the default cell; the indicators need a dedicated SVAR cell component and
  // are tracked as follow-up work. The underlying multi-parent BEHAVIOR (a task
  // rendering as one row per visible parent) works — verified via E2E.
  const columns = $derived([
    {
      id: 'text',
      header: 'Task',
      width: 300,
      align: 'left' as const,
    },
  ]);

  // Custom toolbar items using Obsidian-style actions.
  // The "Add Task" item is gated on write capability (R11 — SVAR's own
  // `readonly` prop does NOT cover the custom toolbar), so it is omitted
  // entirely in read-only mode. Zoom controls are always available.
  const toolbarItems = $derived.by(() => {
    const items: Array<Record<string, unknown>> = [];

    // NOTE: "Add Task" is intentionally NOT shown, even in write mode. Task
    // creation is not yet wired through the controller/TaskNotes — the old
    // handler only called SVAR's `api.exec('add-task')`, producing an in-memory
    // row with no source path that has no persistence and vanishes on the next
    // refresh. Creation returns once it routes through a controller create op
    // (a future unit), gated on `capabilities.write` like the other surfaces.

    items.push(
      {
        comp: "button",
        text: "Zoom In",
        handler: () => {
          if (api) {
            api.exec("zoom-scale", { dir: "in" });
          }
        }
      },
      {
        comp: "button",
        text: "Zoom Out",
        handler: () => {
          if (api) {
            api.exec("zoom-scale", { dir: "out" });
          }
        }
      }
    );

    return items;
  });

  // Initialize API and intercept editor events
  function initGantt(ganttApi: GanttAPI) {
    api = ganttApi;

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

    // Persist drag-to-reschedule and resize via the controller (U8). SVAR fires
    // `update-task` per-frame during a gesture (inProgress truthy) and once on
    // drop with the committed dates (inProgress falsy). We persist only on the
    // committing call, and never on our own echo writes (OG_ECHO_SOURCE) or in
    // read-only mode (R11 — SVAR's `readonly` already blocks drag; this is the
    // no-bypass backstop). Returning true lets SVAR apply the optimistic move;
    // we read the applied dates and persist on the next tick.
    api.intercept("update-task", (ev: UpdateTaskEvent) => {
      if (
        !readOnly &&
        !!onMutate &&
        ev &&
        !ev.inProgress &&
        ev.eventSource !== OG_ECHO_SOURCE &&
        ev.id != null
      ) {
        const id = String(ev.id);
        // Defer so SVAR's store has applied the move; read the authoritative
        // committed dates from the store rather than the heterogeneous event.
        setTimeout(() => void persistReschedule(id), 0);
      }
      return true;
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

  // Zoom configuration with defined levels for proper zoom-scale action (OG-81)
  // Each level defines the scales to display at that zoom level
  const zoomConfig = {
    level: 3, // Start at month/day level
    minCellWidth: 40,
    maxCellWidth: 300,
    levels: [
      // Level 0: Year overview
      {
        minCellWidth: 100,
        maxCellWidth: 300,
        scales: [{ unit: "year", step: 1, format: "yyyy" }],
      },
      // Level 1: Year + Quarter
      {
        minCellWidth: 80,
        maxCellWidth: 200,
        scales: [
          { unit: "year", step: 1, format: "yyyy" },
          { unit: "quarter", step: 1, format: "QQQ" },
        ],
      },
      // Level 2: Quarter + Month
      {
        minCellWidth: 60,
        maxCellWidth: 150,
        scales: [
          { unit: "quarter", step: 1, format: "QQQ yyyy" },
          { unit: "month", step: 1, format: "MMM" },
        ],
      },
      // Level 3: Month + Week (default)
      {
        minCellWidth: 50,
        maxCellWidth: 120,
        scales: [
          { unit: "month", step: 1, format: "MMMM yyyy" },
          { unit: "week", step: 1, format: "'W'w" },
        ],
      },
      // Level 4: Month + Day
      {
        minCellWidth: 30,
        maxCellWidth: 80,
        scales: [
          { unit: "month", step: 1, format: "MMMM yyyy" },
          { unit: "day", step: 1, format: "d" },
        ],
      },
      // Level 5: Week + Day (detailed)
      {
        minCellWidth: 25,
        maxCellWidth: 60,
        scales: [
          { unit: "week", step: 1, format: "'Week' w, MMM yyyy" },
          { unit: "day", step: 1, format: "EEE d" },
        ],
      },
    ],
  };
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
  <Willow fonts={false}>
    <Toolbar items={toolbarItems} />

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
      <Gantt
        init={initGantt}
        {tasks}
        {taskTypes}
        {links}
        {columns}
        zoom={zoomConfig}
        readonly={readOnly}
      />

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
  </Willow>
</div>

<style>
  .og-bases-gantt {
    height: 400px;
    width: 100%;
    min-height: 400px;
    /* Use Obsidian's font stack since we disabled SVAR fonts */
    font-family: var(--font-interface), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }

  .gtcell {
    height: calc(100% - 50px);
    border-top: var(--wx-gantt-border);
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

