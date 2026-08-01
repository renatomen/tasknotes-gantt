/**
 * The property→field mapping configuration — the user's choice of which
 * Obsidian properties fill each Gantt field. Layer-neutral leaf types: the
 * data-source layer extracts raw values through them, the controller resolves
 * writes against them, and the Bases view reads/persists them as view config —
 * so they live here, importable by every layer without touching the view.
 *
 * @module datasource/fieldMappings
 */

/**
 * The two Progress-mode sources. `tasknotes` mirrors TaskNotes' computed
 * checklist progress (read-only); `property` reads/persists a numeric 0–100
 * property. Defined here (the leaf types module) so `FieldMappings` below and
 * the view-options readers reference one definition without an import cycle.
 */
export type ProgressMode = 'tasknotes' | 'property';

/**
 * The three Time-Estimate write modes. `dont-update` (the default) never writes
 * the estimate on a resize; `tasknotes` writes it through TaskNotes' own
 * `timeEstimate` field; `property` writes it to the mapped "Time Estimate"
 * property. The mode gates only writes — the estimate is always READ to drive
 * date inference. Defined here (the leaf types module) so `FieldMappings`
 * below and the view-options readers reference one definition without an
 * import cycle.
 */
export type TimeEstimateMode = 'dont-update' | 'tasknotes' | 'property';

/**
 * Configuration for mapping Obsidian properties to Gantt task fields
 */
export interface FieldMappings {
  /** Property ID for task name (empty string = use file.basename) */
  textProperty: string;
  /** Property ID for task start date */
  startProperty: string;
  /** Property ID for task end/due date */
  endProperty: string;
  /** Property ID for task progress (0-100) */
  progressProperty: string;
  /** Property ID for parent task reference (empty string = no parent) */
  parentProperty?: string;
  /** Property ID for task status (empty string / unset = no status) */
  statusProperty?: string;
  /** Property ID for task priority (empty string / unset = no priority) */
  priorityProperty?: string;
  /**
   * Progress source (see {@link ProgressMode}). `tasknotes` computes the
   * bar's progress from the note's checklist (read-only); `property` reads the
   * `progressProperty`. Absent = legacy `property` behavior. Resolved per view by
   * `readProgressMode` and threaded here so `BasesSource` reads the right source.
   */
  progressMode?: ProgressMode;
  /**
   * Time Estimate write mode (see {@link TimeEstimateMode}). Absent = legacy
   * `dont-update` behavior. Resolved per view by `readTimeEstimateMode`
   * (companion-gated) and threaded here so the write path knows whether — and
   * where — to persist the estimate on a resize. Reading is mode-independent.
   */
  timeEstimateMode?: TimeEstimateMode;
  /**
   * Property ID for the task Time Estimate (minutes). Drives date inference when
   * a date is missing and is the write target in `property` mode. Empty
   * string = unset; in `tasknotes` mode the read/write target falls back to
   * TaskNotes' configured `timeEstimate` field.
   */
  timeEstimateProperty?: string;
  /**
   * Property ID for the task's calendar association — a wikilink to a calendar
   * or calendar-set note. Empty string / unset = the built-in display-only
   * default. Authored on the task note itself; never a hardcoded name.
   */
  calendarProperty?: string;
  /**
   * Property ID for the task's per-task Estimate-meaning override — a value of
   * `working-days` or `calendar-days` on the task note. Empty string / unset =
   * the task follows the view's Estimate meaning. Authored on the task note;
   * never a hardcoded name.
   */
  estimateMeaningProperty?: string;
}
