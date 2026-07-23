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
import type { ChoiceOption, PriorityColor, StatusColor } from '../../datasource/types';
import type { BarColorMode, BarColorSource, BarIconSource } from '../barTreatment';
import type { CascadeMode } from '../cascadeGate';
import type { InferredDragMode } from '../inferredDragGate';
import type { CellEditorDescriptor } from '../cellEditability';
import type { TypedValue } from '../propertyValues';
import type { CellRender } from '../cellRender';
import type { GridColumn } from '../gridColumns';
import type { MarkerInput } from '../markerOverlay';
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
   * Per-view "Highlight weekends" toggle. Flows through the reactive data path
   * (not a static mount prop) so toggling the option live shows/hides the
   * weekend shading without a remount — same treatment as {@link showToolbar}.
   * The view reflects it as a root CSS class; the `highlightTime` seed prop
   * itself stays fixed at mount. Default on.
   */
  highlightWeekends: boolean;
  /**
   * The generated calendar-shading stylesheet (layout base rule + one grouped
   * shade rule per refresh). Flows through the reactive data path so a
   * calendar edit re-shades already-rendered cells via CSS alone — the
   * `highlightTime` seed prop stays fixed at mount and stamps only static
   * per-date identity classes. Empty/absent = base rule only (today's look).
   */
  calendarShadingCss?: string;
  /**
   * Calendar-status banner line (multi-calendar display, conflicts, invalid
   * notes, unresolved selection links); null/absent = no banner. Clicking the
   * banner opens the calendar picker.
   */
  calendarNotice?: string | null;
  /**
   * Flagged calendar events for the marker overlay. Markers render as
   * date-anchored vertical lines (never column shading), so they stay visible
   * at zoom levels where SVAR creates no per-column cells.
   */
  calendarMarkers?: MarkerInput[];
  /**
   * The vault's calendars as a bar-colour palette, for the `calendar` colour
   * source. Whole-vault (not just displayed) because the treatment classes are
   * registered with SVAR once at mount.
   */
  calendarPalette?: { value: string; color: string }[];
  /** Each associated task's calendar identity, keyed by its source path. */
  calendarBySource?: Map<string, string>;
  /**
   * Working-day counter for the resize write path under working-time stretch:
   * the estimate persists the WORKING days of the resized span. Absent (or a
   * null return for a task with no associated calendar) = plain calendar days.
   */
  countWorkingDays?: (taskPath: string, start: Date, end: Date) => number | null;
  /**
   * Per-view "Hide top-level subtasks" toggle (#161). Flows through the reactive
   * data path — NOT the instance derivation — so it's a pure DISPLAY filter: the
   * view applies SVAR `filter-tasks` to hide the also-top-level duplicate rows
   * (`SvarTask.custom.isTopLevelPlacement`) without changing the task set. Because
   * the instance set is identical whether this is on or off, a Bases config
   * toggle (even an oscillating one) cannot churn the chart.
   */
  hideTopLevelSubtasks: boolean;
  /**
   * Per-view "Show tasks with no dates" toggle (#161). Flows through the reactive
   * data path like {@link hideTopLevelSubtasks}: when `false`, the view hides
   * `placeholder` rows via SVAR `filter-tasks` over the stable instance set —
   * never by re-derivation — so a Bases config oscillation cannot churn the chart.
   * Reads the same `tngantt_showUndatedTasks` key (R4); defaults to shown.
   */
  showUndatedTasks: boolean;
  /**
   * Per-view "Show tasks with only one date" toggle (#161). Same presentation-filter
   * treatment as {@link showUndatedTasks}: when `false`, the view hides partial-date
   * (`inferred-start`/`inferred-end`) rows via `filter-tasks`. Reads the same
   * `tngantt_showPartialDateTasks` key (R4); defaults to shown.
   */
  showPartialDateTasks: boolean;
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
  /** Priority→color palette (TaskNotes); `[]` when the companion exposes none (U4). */
  priorityColors: PriorityColor[];
  /**
   * Per-view bar color mode/source and task-icon source (U5). Flow through the
   * reactive data path (not mount props) so changing an option re-renders the
   * bars live without a remount — same treatment as {@link showDateIndicators}.
   */
  barColorMode: BarColorMode;
  barColorSource: BarColorSource;
  barIcon: BarIconSource;
  /**
   * Whether the bar's progress is read-only (TaskNotes progress mode, U5/R7).
   * Flows through the reactive data path like {@link barColorMode} so switching
   * Progress mode hides/shows the drag handle live without a remount. The view
   * toggles a root class that hides `.wx-progress-marker`; date drag is
   * unaffected. `false` in property mode (the handle persists on release).
   */
  progressReadonly: boolean;
  /**
   * Whether a bar resize should write the Time Estimate back (U6/R13–R15). True
   * in a write-enabled mode (`TaskNotes field` / `Property` with a mapped
   * property); `false` in `Don't update`. Flows through the reactive data path
   * like {@link progressReadonly} so switching the mode takes effect without a
   * remount. The container additionally gates the write on read-only, so a
   * standalone timeline never writes regardless of this flag (R17).
   */
  timeEstimateWriteEnabled: boolean;
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
   * Per-view behavior when a resize moves an inferred (estimate-derived) bar
   * edge: `ask` (prompt to grow the estimate or write dates), `estimate-only`,
   * `estimate-and-dates`. Defaults to `ask`.
   */
  inferredDragMode: InferredDragMode;
  /** Per-view scale used only to seed SVAR's initial zoom level. */
  defaultScale: DefaultScale;
  /**
   * Per-task type-tagged values for the grid's visible property columns,
   * keyed by source path (U1). Resolved at assembly time from the Bases
   * entries; the grid cell looks values up by each instance's `sourcePath`.
   */
  propertyValues: Map<string, Record<string, TypedValue>>;
  /**
   * Per-task render descriptors for the grid's visible property columns, keyed by
   * source path. Built in the same pass as {@link propertyValues}; drives whether
   * a cell renders Obsidian markdown (wikilinks, tag pills) or conventional text.
   */
  cellRenders: Map<string, Record<string, CellRender>>;
  /**
   * The display-locale snapshot taken for this assembly pass. Every date the
   * pass formatted (the `cellRenders` text) used it; the view hands it to grid
   * cells (context) so their fallback formatting agrees with the pass.
   */
  dateLocale: string;
  /**
   * Source paths TaskNotes manages, resolved per assembly pass (inline cell
   * editing). Rides `buildSvarTasks` onto each row as `custom.editable` so the
   * grid offers editors only where TaskNotes can persist. Empty when TaskNotes
   * is unavailable — every row read-only.
   */
  managedPaths: ReadonlySet<string>;
  /**
   * The configured restricted-choice value sets (TaskNotes statuses/priorities),
   * resolved per assembly pass alongside the color palettes. The view builds the
   * status/priority cell pickers from them; empty sets offer no picker (the
   * cell stays read-only rather than opening an unconstrained editor). Optional
   * so data assembled without a choice-capable source omits it cleanly.
   */
  choiceOptions?: { status: ChoiceOption[]; priority: ChoiceOption[] };
  /**
   * Per-column inline editor descriptors (inline cell editing), keyed by grid
   * column id. Resolved per assembly pass from the field mappings + registered
   * TaskNotes user fields ({@link import('../cellEditability').resolveCellEditor});
   * a column absent here is read-only. The view attaches SVAR editors for the
   * kinds it ships and gates each open on the row's `custom.editable`.
   */
  cellEditors: Map<string, CellEditorDescriptor>;
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
   * The effective grid/timeline divider width (px) to seed at mount: the
   * persisted `tngantt_tableWidth` when set, else the first (name) column's width
   * (the R4 fallback, resolved in `register.getTableWidth` via
   * `resolveInitialGridWidth`). Always a number now — the fallback is applied
   * upstream rather than deferring an unset view to SVAR's column-sum default.
   * Seeds the `gridWidth` prop and is re-asserted after each column recompute.
   */
  gridWidth?: number;
}
