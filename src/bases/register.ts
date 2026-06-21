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
  type Plugin,
  type BasesViewConfig,
  type BasesPropertyId,
  type BasesAllOptions,
  type QueryController,
} from 'obsidian';
import { mount, unmount } from 'svelte';
import { writable, type Writable } from 'svelte/store';
import GanttContainer from './GanttContainer.svelte';
import type { GanttData } from './types/gantt-view-data';
import { GanttTaskListView } from './views/GanttTaskListView';
import type { FieldMappings } from './types/field-mapping';
import { FIELD_MAPPING_KEYS, readFieldMappings } from './fieldMappingConfig';
import {
  GanttController,
  type DatePolicyConfig,
  type DateMappingInfo,
} from '../controller/GanttController';
import type { LinkRewriteMode } from '../controller/InstanceExpansion';
import { TaskNotesInteractions } from './taskNotesInteractions';
import { normalizeCascadeMode } from './cascadeGate';
import { buildEntryProperties } from './propertyValues';
import { buildGridColumns, gridColumnsKey, mergeColumnSize } from './gridColumns';
import { BasesDataAdapter } from './services/BasesDataAdapter';
import { asPropertyId } from './types/bases-entry';
import { normalizeDefaultScale } from './zoomConfig';

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
import { readDatePolicyConfig } from './datePolicyConfig';

export { readDatePolicyConfig } from './datePolicyConfig';

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
class ObsidianGanttBasesView extends BasesView {
  readonly type = VIEW_TYPE_ID;
  private readonly containerEl: HTMLElement;
  private svelteComponent: ReturnType<typeof mount> | null = null;
  private ephemeralState: GanttEphemeralState = {};

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

  constructor(controller: QueryController, parentEl: HTMLElement) {
    super(controller);
    this.containerEl = parentEl.createDiv({ cls: 'og-bases-gantt-root' });
    this.containerEl.style.height = '100%';
    this.containerEl.style.width = '100%';
  }

  override onload(): void {
    // Don't mount yet - wait for onDataUpdated() when config and data are ready
    console.log('[Gantt] View loaded, waiting for data...');
  }

  override onunload(): void {
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
    if (!this.svelteComponent || !this.ganttController) {
      console.log('[Gantt] First data event — mounting. Entries:', this.data?.data?.length || 0);
      void this.mountGantt();
      return;
    }
    console.log('[Gantt] Data updated, refreshing in place. Entries:', this.data?.data?.length || 0);
    // Re-read the live Bases entries (and re-resolve TaskNotes availability) by
    // re-selecting the source; the controller's change listener then refreshes
    // the store. No remount.
    void this.ganttController.refreshSource();
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
        policyConfig: this.buildDatePolicyConfig(),
      });

      await controller.init();

      // A newer mount or an unmount happened while we awaited init() — discard.
      if (token !== this.mountToken) {
        controller.dispose();
        return;
      }

      this.ganttController = controller;
      // Native edit interaction (plan 004): resolves bar clicks to TaskNotes
      // actions (open note / native edit modal / task menu). Holds only `app`.
      const interactions = new TaskNotesInteractions(this.app);

      const data = await this.buildGanttData(controller);

      // Re-check after the second await window.
      if (token !== this.mountToken) {
        controller.dispose();
        return;
      }

      console.log('[Gantt] Mounting (refresh-in-place):', {
        instanceCount: data.instances.length,
        linkCount: data.links.length,
        write: data.capabilities.write,
        arrowMode: data.arrowMode,
      });

      // One reactive store, mounted once; controller changes re-set it in place.
      this.dataStore = writable(data);
      this.svelteComponent = mount(GanttContainer, {
        target: this.containerEl,
        props: {
          data: this.dataStore,
          app: this.app,
          config: this.config,
          // Drag/resize persistence (U8): the view calls this on a commit; the
          // controller resolves instance→source and writes through TaskNotes.
          onMutate: (instanceId: string, patch) => controller.mutate(instanceId, patch),
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
          onGridWidthChange: (width: number) => {
            try {
              this.config.set('tngantt_tableWidth', Math.round(width));
            } catch (error) {
              console.warn('[Gantt] Failed to persist grid width:', error);
            }
          },
        },
      });

      // Controller snapshot changes (TaskNotes events, source re-selection on a
      // data update / capability flip) refresh the store in place — no remount,
      // so the SVAR view state (zoom, scroll, selection) is preserved.
      controller.onChange(() => {
        if (token === this.mountToken) {
          void this.refreshData();
        }
      });
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
    const [instances, links, statusColors] = await Promise.all([
      controller.getInstances(),
      controller.getLinks(arrowMode),
      controller.getStatusColors(),
    ]);
    // Resolve the visible property columns once; share between the per-task
    // value map (U1) and the column descriptors (U2).
    const visiblePropIds = this.getVisiblePropertyIds();
    const propertyValues = buildEntryProperties(
      this.data?.data ?? [],
      visiblePropIds,
      this.gridAdapter,
    );
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
      statusColors,
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

  // Shared field mapping options for both views
  const sharedOptions: BasesAllOptions[] = [
    {
      type: 'property' as const,
      displayName: 'Task Name Property',
      key: FIELD_MAPPING_KEYS.text,
      default: '',
      placeholder: 'Select task name property (defaults to file name)',
    },
    {
      type: 'property' as const,
      displayName: 'Start Date Property',
      key: FIELD_MAPPING_KEYS.start,
      default: '',
      placeholder: 'Defaults to TaskNotes Scheduled; or pick a TaskNotes date field',
    },
    {
      type: 'property' as const,
      displayName: 'End Date Property',
      key: FIELD_MAPPING_KEYS.end,
      default: '',
      placeholder: 'Defaults to TaskNotes Due; or pick a TaskNotes date field',
    },
    {
      type: 'property' as const,
      displayName: 'Progress Property',
      key: FIELD_MAPPING_KEYS.progress,
      default: 'note.progress',
      placeholder: 'Select progress property (0-100)',
    },
    {
      type: 'property' as const,
      displayName: 'Parent Property',
      key: FIELD_MAPPING_KEYS.parent,
      default: '',
      placeholder: 'Select parent task property (optional)',
    },
    {
      type: 'property' as const,
      displayName: 'Status Property',
      key: FIELD_MAPPING_KEYS.status,
      default: '',
      placeholder: 'Select status property (colors bars by TaskNotes status)',
    },
  ];

  // Register the Gantt chart view type
  const registeredGantt = plugin.registerBasesView(VIEW_TYPE_ID, {
    name: VIEW_NAME,
    icon: VIEW_ICON,
    factory: (controller: QueryController, containerEl: HTMLElement) => {
      return new ObsidianGanttBasesView(controller, containerEl);
    },
    options: (_config: BasesViewConfig): BasesAllOptions[] => [
      ...sharedOptions,
      {
        type: 'dropdown',
        displayName: 'Default Scale',
        key: 'tngantt_defaultScale',
        default: 'day',
        options: {
          hour: 'Hours',
          day: 'Days',
          week: 'Weeks',
          month: 'Months',
        },
      },
      // R27: how dependency arrows render across duplicated multi-parent
      // instances. Persisted per-view via config.set/get; read in mountGantt.
      {
        type: 'dropdown',
        displayName: 'Dependency Arrows',
        key: 'tngantt_dependencyArrowMode',
        default: 'primary',
        options: {
          primary: 'Primary instance only',
          all: 'All instances',
        },
      },
      // Parent/ancestor date-cascade behavior when a child drag/resize would
      // change ancestor spans. Read per-view in getCascadeMode(); consumed by
      // the GanttContainer drag-persistence gate.
      {
        type: 'dropdown',
        displayName: 'Parent date updates',
        key: 'tngantt_parentDateCascade',
        default: 'ask',
        options: {
          ask: 'Ask before updating parent dates',
          auto: 'Update parent dates automatically',
          never: 'Never update parent dates',
        },
      },
      // Missing/partial-date handling (R6, R8, R9, R11). Read per-view in
      // buildDatePolicyConfig()/getShowDateIndicators(); consumed by the
      // controller's date policy + the view's bar-level indicators.
      // Number → slider (the official Bases options union has no 'number'
      // control; 'slider' is the closest numeric input). Behavior-equivalent.
      {
        type: 'slider',
        displayName: 'Default task duration (days)',
        key: 'tngantt_defaultDuration',
        default: 1,
        min: 1,
      },
      // Boolean → toggle (the official options union has no 'boolean' control).
      {
        type: 'toggle',
        displayName: 'Show tasks with no dates',
        key: 'tngantt_showUndatedTasks',
        default: true,
      },
      {
        type: 'toggle',
        displayName: 'Show tasks with only one date',
        key: 'tngantt_showPartialDateTasks',
        default: true,
      },
      {
        type: 'toggle',
        displayName: 'Show date-status indicators on bars',
        key: 'tngantt_showDateIndicators',
        default: true,
      },
    ],
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
    options: (_config: BasesViewConfig): BasesAllOptions[] => sharedOptions,
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
