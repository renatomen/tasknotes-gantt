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
}
