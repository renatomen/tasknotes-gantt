/**
 * The dynamic data the Gantt view renders, refreshed in place via a Svelte
 * store rather than by remounting the component — so the persistent SVAR
 * instance keeps its view state (zoom, scroll, selection) across data changes.
 *
 * `register.ts` owns a `writable<GanttData>`; on each controller change it
 * recomputes and `set`s this, and `GanttContainer` derives its render inputs
 * from the store. Static inputs (app, config, interaction callbacks) stay
 * ordinary props.
 *
 * @module bases/types/gantt-view-data
 */

import type {
  RenderInstance,
  RenderLink,
  LinkRewriteMode,
} from '../../controller/InstanceExpansion';
import type { StatusColor } from '../../datasource/types';
import type { CascadeMode } from '../cascadeGate';
import type { TypedValue } from '../propertyValues';
import type { GridColumn } from '../gridColumns';
import type { DefaultScale } from '../zoomConfig';

export interface GanttData {
  /** Expanded render instances from the controller. */
  instances: RenderInstance[];
  /** Dependency links rewritten to instance-id endpoints. */
  links: RenderLink[];
  /** Active source capabilities (read-only truth). */
  capabilities: { write: boolean };
  /** Per-view dependency-arrow mode. */
  arrowMode: LinkRewriteMode;
  /** Per-view bar-level date-status indicator toggle. */
  showDateIndicators: boolean;
  /**
   * Per-view "show toolbar" toggle (plan 002 R2). Flows through the reactive
   * data path (not a static mount prop) so toggling the option live shows/hides
   * the toolbar without a remount — same treatment as {@link showDateIndicators}.
   */
  showToolbar: boolean;
  /**
   * Per-view max-height (px) cap for the chart host (plan 003 R1). Flows through
   * the reactive data path so changing the option re-fits the host live without
   * a remount — same treatment as {@link showToolbar}. The host fits its content
   * up to this cap, then scrolls internally.
   */
  maxHeight: number;
  /**
   * Per-view min-height (px) floor for the chart host. Flows through the reactive
   * data path like {@link maxHeight} so the slider re-sizes live without a
   * remount; clamped to the absolute ~2-row floor in the reader.
   */
  minHeight: number;
  /**
   * Opacity (fraction 0–1) for Show-all context bars (U6). Flows through the
   * reactive data path so the slider re-tints bars live without a remount — same
   * treatment as {@link maxHeight}. Applied as a CSS custom property in the view.
   */
  contextOpacity: number;
  /** Status→color palette (TaskNotes). */
  statusColors: StatusColor[];
  /** Invalid date-mapping notice, when a start/end mapping fell back. */
  dateMappingNotice?: string;
  /** Whether TaskNotes is present (distinguishes read-only banner copy). */
  taskNotesPresent?: boolean;
  /**
   * Per-view behavior for the parent/ancestor date cascade on a child
   * drag/resize: `ask` (confirm before writing ancestors), `auto` (write
   * silently), `never`. Defaults to `ask`.
   */
  cascadeMode: CascadeMode;
  /** Per-view scale used only to seed SVAR's initial zoom level. */
  defaultScale: DefaultScale;
  /**
   * Per-task type-tagged values for the grid's visible property columns,
   * keyed by source path (U1). Resolved at assembly time from the Bases
   * entries; the grid cell looks values up by each instance's `sourcePath`.
   */
  propertyValues: Map<string, Record<string, TypedValue>>;
  /**
   * Grid column descriptors derived from the Base config (U2): name column
   * first, then the visible properties in order. The view turns these into SVAR
   * columns.
   */
  gridColumns: GridColumn[];
  /**
   * Stable fingerprint of {@link gridColumns}. The view rebuilds the SVAR
   * columns array (which re-inits the store, resetting zoom/scroll) only when
   * this changes — never on a plain data refresh.
   */
  gridColumnsKey: string;
  /**
   * Persisted grid/timeline divider width (px) from the standard
   * `obsidianGantt.tableWidth`, or `undefined` when unset (→ SVAR's default).
   * Seeds the `gridWidth` prop once at mount so a reload restores the user's
   * chosen pane width (plan 002 U3).
   */
  gridWidth?: number;
}
