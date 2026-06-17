/**
 * Obsidian Bases API Registration for Gantt View
 *
 * Uses the official Obsidian Bases API (1.10.0+) via plugin.registerBasesView()
 *
 * Official Documentation:
 * - Guide: https://docs.obsidian.md/Plugins/Guides/Build+a+Bases+view
 *
 * TypeScript API References:
 * - BasesConfigFile: https://docs.obsidian.md/Reference/TypeScript+API/BasesConfigFile
 * - BasesConfigFileView: https://docs.obsidian.md/Reference/TypeScript+API/BasesConfigFileView
 * - BasesEntry: https://docs.obsidian.md/Reference/TypeScript+API/BasesEntry
 * - BasesEntryGroup: https://docs.obsidian.md/Reference/TypeScript+API/BasesEntryGroup
 * - BasesProperty: https://docs.obsidian.md/Reference/TypeScript+API/BasesProperty
 * - BasesQueryResult: https://docs.obsidian.md/Reference/TypeScript+API/BasesQueryResult
 * - BasesView: https://docs.obsidian.md/Reference/TypeScript+API/BasesView
 * - BasesViewConfig: https://docs.obsidian.md/Reference/TypeScript+API/BasesViewConfig
 * - BasesViewRegistration: https://docs.obsidian.md/Reference/TypeScript+API/BasesViewRegistration
 *
 * @module bases/register
 */

import { Component, type App, type Plugin } from 'obsidian';
import { mount, unmount } from 'svelte';
import GanttContainer from './GanttContainer.svelte';
import { GanttBasesView } from './GanttBasesView';
import { GanttTaskListView } from './views/GanttTaskListView';
import type { FieldMappings } from './types/field-mapping';
import { GanttController, type DatePolicyConfig } from '../controller/GanttController';
import type { LinkRewriteMode } from '../controller/InstanceExpansion';
import { readDatePolicyConfig } from './datePolicyConfig';

export { readDatePolicyConfig } from './datePolicyConfig';

// ============================================================================
// Type Definitions for Official Obsidian Bases API (1.10.0+)
// These types are based on the official Obsidian API documentation.
// They will be available in the official obsidian package in future versions.
//
// See TypeScript API references in module header for official documentation.
// ============================================================================

/** Property ID used by Bases to identify note properties */
export type BasesPropertyId = string;

/** Entry representing a single note in the Bases query result */
export interface BasesEntry {
  /** The TFile for this entry */
  file: { path: string; name: string; basename: string };
  /** Direct access to frontmatter properties (preferred for basic properties) */
  frontmatter?: Record<string, any>;
  /** Alternative property access (used by some Bases versions) */
  properties?: Record<string, any>;
  /** Get the evaluated value of a property for this entry (use for computed properties only) */
  getValue(propertyId: BasesPropertyId): BasesValue;
}

/** Value wrapper returned by BasesEntry.getValue() */
export interface BasesValue {
  /** Check if the value is empty/null */
  isEmpty(): boolean;
  /** Convert value to string representation */
  toString(): string;
  /** The underlying value */
  value?: unknown;
  /** Value type identifier */
  type?: string;
}

/** Group of entries when groupBy is configured */
export interface BasesEntryGroup {
  /** Entries in this group */
  entries: BasesEntry[];
  /** Group key value (null if no grouping) */
  key?: BasesValue;
  /** Check if group has a key */
  hasKey(): boolean;
}

/** Result of executing a Bases query */
export interface BasesQueryResult {
  /** Ungrouped data with sort/limit applied */
  data: BasesEntry[];
  /** Data grouped according to groupBy config */
  readonly groupedData: BasesEntryGroup[];
  /** Visible properties defined by user */
  readonly properties: BasesPropertyId[];
}

/** Configuration for a Bases view instance */
export interface BasesViewConfig {
  /** User-friendly name for this view */
  name: string;
  /** Get user-configured option value */
  get(key: string): unknown;
  /** Set configuration value */
  set(key: string, value: unknown): void;
  /** Get ordered list of properties to display */
  getOrder(): BasesPropertyId[];
  /** Get sort configuration */
  getSort(): Array<{ property: BasesPropertyId; direction: 'asc' | 'desc' }>;
  /** Get property as BasesPropertyId */
  getAsPropertyId(key: string): BasesPropertyId | null;
  /** Get display name for a property */
  getDisplayName(propertyId: BasesPropertyId): string;
}

/** Controller for query execution - extends Component */
export interface QueryController extends Component {
  // Inherited from Component: load, unload, register, etc.
}

/** View option types for configuration UI */
export type ViewOption =
  | TextViewOption
  | NumberViewOption
  | BooleanViewOption
  | DropdownViewOption
  | PropertyViewOption
  | FormulaViewOption;

interface BaseViewOption {
  /** Option type identifier */
  type: string;
  /** Display name shown in settings */
  displayName: string;
  /** Key used to store/retrieve value */
  key: string;
  /** Whether to hide this option based on current config */
  shouldHide?: (config: BasesViewConfig) => boolean;
}

interface TextViewOption extends BaseViewOption {
  type: 'text';
  default?: string;
  placeholder?: string;
}

interface NumberViewOption extends BaseViewOption {
  type: 'number';
  default?: number;
  min?: number;
  max?: number;
}

interface BooleanViewOption extends BaseViewOption {
  type: 'boolean';
  default?: boolean;
}

interface DropdownViewOption extends BaseViewOption {
  type: 'dropdown';
  default?: string;
  options: Array<{ value: string; display: string }>;
}

interface PropertyViewOption extends BaseViewOption {
  type: 'property';
  default?: string;
  placeholder?: string;
}

interface FormulaViewOption extends BaseViewOption {
  type: 'formula';
  default?: string;
  placeholder?: string;
}

/** Factory function type for creating Bases views */
export type BasesViewFactory = (
  controller: QueryController,
  containerEl: HTMLElement
) => GanttBasesView;

/** Registration options for a Bases view type */
export interface BasesViewRegistration {
  /** Display name for the view type */
  name: string;
  /** Icon ID (lucide icon name) */
  icon: string;
  /** Factory function to create view instances */
  factory: BasesViewFactory;
  /** Optional configuration options */
  options?: () => ViewOption[];
}

// Augment Plugin type to include registerBasesView
declare module 'obsidian' {
  interface Plugin {
    /**
     * Register a Bases view type (Obsidian 1.10.0+)
     * @param viewId - Unique identifier for the view type
     * @param registration - View registration options
     * @returns false if Bases is not enabled
     */
    registerBasesView(viewId: string, registration: BasesViewRegistration): boolean;
  }
}

// ============================================================================
// Gantt Bases View Implementation
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
class ObsidianGanttBasesView extends GanttBasesView {
  readonly type = VIEW_TYPE_ID;
  private containerEl: HTMLElement;
  private svelteComponent: ReturnType<typeof mount> | null = null;
  private ephemeralState: GanttEphemeralState = {};

  /** The action layer / source of truth (U6). Recreated per mount. */
  private ganttController: GanttController | null = null;

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
   * The current refresh pattern is unmount + remount. Because the controller is
   * the source of truth and re-reads the live Bases entries via the
   * `basesInput` provider at selection time, a remount re-queries instances and
   * links from scratch. (A future targeted prop-update is noted in the plan's
   * follow-up work.)
   */
  public onDataUpdated(): void {
    console.log('[Gantt] Data updated, remounting. Entries:', this.data?.data?.length || 0);
    this.unmountGantt();
    void this.mountGantt();
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

  /** Build the FieldMappings from the current view config (OG-87). */
  private buildFieldMappings(): FieldMappings {
    return {
      textProperty: (this.config.get('textProperty') as string) || '',
      startProperty: (this.config.get('startDateProperty') as string) || 'note.start',
      endProperty: (this.config.get('endDateProperty') as string) || 'note.due',
      progressProperty: (this.config.get('progressProperty') as string) || 'note.progress',
      parentProperty: (this.config.get('parentProperty') as string) || '',
      statusProperty: (this.config.get('statusProperty') as string) || '',
    };
  }

  /** Read the per-view dependency-arrow mode (R27), defaulting to `primary`. */
  private getArrowMode(): LinkRewriteMode {
    return this.config.get('dependencyArrowMode') === 'all' ? 'all' : 'primary';
  }

  /** Build the date-policy + visibility config from the per-view options (U3). */
  private buildDatePolicyConfig(): DatePolicyConfig {
    return readDatePolicyConfig((key) => this.config.get(key));
  }

  /** Read the per-view "show date-status indicators" toggle (R11); default on. */
  private getShowDateIndicators(): boolean {
    return this.config.get('showDateIndicators') !== false;
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
      const arrowMode = this.getArrowMode();

      const [instances, links, statusColors] = await Promise.all([
        controller.getInstances(),
        controller.getLinks(arrowMode),
        controller.getStatusColors(),
      ]);

      // Re-check after the second await window.
      if (token !== this.mountToken) {
        controller.dispose();
        return;
      }

      console.log('[Gantt] Mounting with:', {
        instanceCount: instances.length,
        linkCount: links.length,
        write: controller.capabilities.write,
        arrowMode,
      });

      this.svelteComponent = mount(GanttContainer, {
        target: this.containerEl,
        props: {
          instances,
          links,
          capabilities: controller.capabilities,
          arrowMode,
          showDateIndicators: this.getShowDateIndicators(),
          statusColors,
          app: this.app,
          config: this.config,
          // Drag/resize persistence (U8): the view calls this on a commit; the
          // controller resolves instance→source and writes through TaskNotes.
          // Bound to the controller captured in this mount.
          onMutate: (instanceId: string, patch) => controller.mutate(instanceId, patch),
        },
      });

      // Reactive capability/source refresh: re-check TaskNotes availability when
      // the data refreshes. A flip in availability re-selects the source and
      // changes capabilities; the resulting change triggers a remount via the
      // listener below. (Full plugin enable/disable reactivity — subscribing to
      // Obsidian's plugin lifecycle events — is wired in a later unit; here we
      // re-check on the data-update path, which is the cleanly available hook.)
      controller.onChange(() => {
        if (token === this.mountToken) {
          this.onDataUpdated();
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
  const sharedOptions = [
    {
      type: 'property' as const,
      displayName: 'Task Name Property',
      key: 'textProperty',
      default: '',
      placeholder: 'Select task name property (defaults to file name)',
    },
    {
      type: 'property' as const,
      displayName: 'Start Date Property',
      key: 'startDateProperty',
      default: 'note.start',
      placeholder: 'Select start date property',
    },
    {
      type: 'property' as const,
      displayName: 'End Date Property',
      key: 'endDateProperty',
      default: 'note.due',
      placeholder: 'Select end date property',
    },
    {
      type: 'property' as const,
      displayName: 'Progress Property',
      key: 'progressProperty',
      default: 'note.progress',
      placeholder: 'Select progress property (0-100)',
    },
    {
      type: 'property' as const,
      displayName: 'Parent Property',
      key: 'parentProperty',
      default: '',
      placeholder: 'Select parent task property (optional)',
    },
    {
      type: 'property' as const,
      displayName: 'Status Property',
      key: 'statusProperty',
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
    options: () => [
      ...sharedOptions,
      {
        type: 'dropdown',
        displayName: 'Default Scale',
        key: 'defaultScale',
        default: 'day',
        options: [
          { value: 'hour', display: 'Hours' },
          { value: 'day', display: 'Days' },
          { value: 'week', display: 'Weeks' },
          { value: 'month', display: 'Months' },
        ],
      },
      // R27: how dependency arrows render across duplicated multi-parent
      // instances. Persisted per-view via config.set/get; read in mountGantt.
      {
        type: 'dropdown',
        displayName: 'Dependency Arrows',
        key: 'dependencyArrowMode',
        default: 'primary',
        options: [
          { value: 'primary', display: 'Primary instance only' },
          { value: 'all', display: 'All instances' },
        ],
      },
      // Missing/partial-date handling (R6, R8, R9, R11). Read per-view in
      // buildDatePolicyConfig()/getShowDateIndicators(); consumed by the
      // controller's date policy + the view's bar-level indicators.
      {
        type: 'number',
        displayName: 'Default task duration (days)',
        key: 'defaultDuration',
        default: 1,
        min: 1,
      },
      {
        type: 'boolean',
        displayName: 'Show tasks with no dates',
        key: 'showUndatedTasks',
        default: true,
      },
      {
        type: 'boolean',
        displayName: 'Show tasks with only one date',
        key: 'showPartialDateTasks',
        default: true,
      },
      {
        type: 'boolean',
        displayName: 'Show date-status indicators on bars',
        key: 'showDateIndicators',
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
    options: () => sharedOptions,
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

