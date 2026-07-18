/**
 * Capability-typed data-source abstraction for the Gantt.
 *
 * A `DataSource` yields raw task data (no display formatting — see
 * `.augment/rules/data-formatting-separation.md`) and declares whether it
 * supports writes. Read-only sources (e.g. Bases) omit the mutation methods
 * and report `capabilities.write = false`; write-capable sources (e.g.
 * TaskNotes) implement them and report `capabilities.write = true`. Surfaces
 * derive available mutations from `capabilities` alone — read-only mode is the
 * structural absence of a capability, expressed in one place.
 *
 * @module datasource/types
 */

/**
 * Raw task data extracted from a data source.
 *
 * Values are native types (Date/number/string) or `null` — never formatted
 * strings. `path` is the stable identity (the note path); `parents` holds
 * resolved vault paths in the same namespace as `path`, so the instance
 * expansion layer can map a child to its parent unambiguously.
 */
export interface SourceTask {
  /** Stable identity: the note path. */
  path: string;
  /** Display text (task name). */
  text: string;
  /** Start date, or `null` when unscheduled. */
  start: Date | null;
  /** End/due date, or `null` when unscheduled. */
  end: Date | null;
  /** Progress percentage 0–100, or `null` when unknown. */
  progress: number | null;
  /**
   * Time Estimate in minutes, or `null`/absent when unset. Drives per-task date
   * inference (a missing date is filled from this duration). Absent is treated
   * as "no estimate" — inference falls back to the view's Default duration.
   */
  estimate?: number | null;
  /** Status string, or `null` when unset. */
  status: string | null;
  /** Priority string, or `null` when unset. */
  priority: string | null;
  /** Resolved vault paths of this task's parents (same namespace as `path`). */
  parents: string[];
}

/** Dependency relationship types (mirror TaskNotes' reltypes). */
export type DependencyRelType =
  | 'FINISHTOSTART'
  | 'FINISHTOFINISH'
  | 'STARTTOSTART'
  | 'STARTTOFINISH';

/**
 * A source-level dependency edge: `predecessorPath` blocks the task this edge
 * belongs to (i.e. an entry in the task's `blockedBy`).
 */
export interface SourceDependency {
  /** Path of the predecessor (blocking) task. */
  predecessorPath: string;
  /** Relationship type. */
  reltype: DependencyRelType;
  /** ISO-8601 duration gap (e.g. `"P1D"`), or `null` when none. */
  gap: string | null;
}

/**
 * A status value paired with its configured display color, sourced from the
 * backing system's status configuration (e.g. TaskNotes custom statuses). The
 * view colors a bar by its task's status. `value` matches {@link SourceTask.status}.
 */
export interface StatusColor {
  /** The status value (matches `SourceTask.status`). */
  value: string;
  /** The configured color (a CSS color string, typically hex). */
  color: string;
  /** Whether this status represents completion. */
  isCompleted: boolean;
  /**
   * Optional icon name (as accepted by Obsidian's `setIcon` — Lucide or any
   * plugin-registered icon). Absent when the status has no configured icon, in
   * which case the view falls back to a colored dot (mirroring TaskNotes).
   */
  icon?: string;
}

/**
 * A priority value paired with its configured display color, sourced from the
 * backing system's priority configuration (e.g. TaskNotes custom priorities).
 * The view colors a bar by its task's priority. `value` matches
 * {@link SourceTask.priority}. Unlike {@link StatusColor} there is no
 * `isCompleted` (priorities carry a sort `weight` instead, not consumed here).
 */
export interface PriorityColor {
  /** The priority value (matches `SourceTask.priority`). */
  value: string;
  /** The configured color (a CSS color string, typically hex). */
  color: string;
  /**
   * Optional icon name (as accepted by Obsidian's `setIcon`). Absent when the
   * priority has no configured icon (colored-dot fallback).
   */
  icon?: string;
}

/** The restricted-choice roles a backing system configures value sets for. */
export type ChoiceRole = 'status' | 'priority';

/**
 * One selectable value of a restricted-choice field (e.g. a TaskNotes custom
 * status), sourced from the backing system's configuration. `value` is what is
 * stored/persisted (matches {@link SourceTask.status}/{@link SourceTask.priority});
 * `label` is the human-readable form for pickers. Unlike {@link StatusColor}
 * this carries no color — it feeds editors, not bar styling.
 */
export interface ChoiceOption {
  /** The stored value string. */
  value: string;
  /** Display label (falls back to the value when unconfigured). */
  label: string;
}

/**
 * A custom (user-defined) date field exposed by the backing system, addressable
 * by its frontmatter `key`. `id` is the system's internal field id (some write
 * APIs key by `id` rather than `key`); `displayName` labels it in config UIs.
 */
export interface CustomDateField {
  /** Frontmatter property key (how the field is read/written by name). */
  key: string;
  /** Backing system's internal field id (alternative write key). */
  id: string;
  /** Human-readable label for config surfaces. */
  displayName: string;
}

/**
 * The backing system's (TaskNotes') configured field surface, used to resolve the
 * Gantt's roles (start/end/status/priority/estimate) to concrete read properties
 * and write targets, and to populate/validate the Bases config. Every `*Prop` is
 * the frontmatter property name TaskNotes is configured to use for that canonical
 * field (or `null` when unconfigured); `dateFields` are the enabled custom fields
 * of type `date`.
 *
 * A view mapping left empty resolves to the property named here, so an unset field
 * behaves exactly as if the user had selected TaskNotes' own property.
 */
export interface FieldConfig {
  scheduledProp: string | null;
  dueProp: string | null;
  dateFields: CustomDateField[];
  /**
   * The frontmatter property name TaskNotes is configured to use for its
   * `timeEstimate` field (minutes), or `null` when unconfigured. Used as the
   * read/write target for the Time Estimate feature when the view's "Time
   * Estimate" property is left empty (R2/R6).
   */
  timeEstimateProp: string | null;
  /** TaskNotes' configured `status` property; the unset "Status Property" fallback. */
  statusProp: string | null;
  /** TaskNotes' configured `priority` property; the unset "Priority Property" fallback. */
  priorityProp: string | null;
}

/**
 * Where a date value should be persisted. Canonical targets route through the
 * backing system's own scheduled/due mapping; a `userField` target writes a
 * custom field addressed by `key` (with `id` carried for APIs that key by id).
 */
export type DateWriteTarget =
  | { kind: 'scheduled' }
  | { kind: 'due' }
  | { kind: 'userField'; key: string; id: string };

/** A single resolved date write: a target paired with its value (or `null` to clear). */
export interface DateWrite {
  target: DateWriteTarget;
  value: Date | null;
}

/**
 * Where a Time Estimate value should be persisted (U6). `tasknotesField` writes
 * through TaskNotes' own canonical `timeEstimate` field (TaskNotes routes it to
 * its configured property); `property` writes the resolved bare frontmatter key
 * directly. The controller resolves which target applies from the write mode.
 */
export type EstimateWriteTarget =
  | { kind: 'tasknotesField' }
  | { kind: 'property'; key: string };

/**
 * A patch of mutable task fields for the write path. `dateWrites` carry resolved
 * date targets (the controller resolves start/end → targets via {@link FieldConfig});
 * `text`/`status` are written verbatim. `start`/`end`/`progress` remain for
 * non-resolved callers but the bases-scoped view uses `dateWrites`.
 */
export interface TaskPatch {
  start?: Date | null;
  end?: Date | null;
  progress?: number | null;
  /** Time Estimate in minutes to persist (U6); paired with {@link estimateWrite}. */
  estimate?: number;
  text?: string;
  status?: string;
  priority?: string;
  /** Resolved date targets (preferred over start/end for field-mapped writes). */
  dateWrites?: DateWrite[];
  /**
   * Resolved progress write target (U6): the bare frontmatter key to persist
   * `progress` under, in Property mode. The controller resolves it from the
   * mapped `progressProperty` (prefix stripped). A bare `progress` value with no
   * `progressWrite` is NOT written — the write only lands when a target is
   * resolved (so TaskNotes mode / no-target callers never persist progress).
   */
  progressWrite?: { key: string };
  /**
   * Resolved Time Estimate write target (U6). The controller resolves it from the
   * write mode: `tasknotesField` (TaskNotes-field mode) or `property` with a bare
   * key (Property mode). A bare `estimate` value with no `estimateWrite` is NOT
   * written — the write only lands when a target is resolved (so `dont-update`
   * mode and no-target callers never persist the estimate).
   */
  estimateWrite?: EstimateWriteTarget;
  /**
   * Resolved generic field write: persist `value` under the bare frontmatter
   * `key`, written verbatim as a TOP-LEVEL update key — TaskNotes' frontmatter
   * writer reads custom user fields from `task[key]`, never a nested `userFields`
   * object. `null` clears the property; `[]` writes an empty list. The controller
   * resolves the key from the edited property id (mapped fields route through
   * their dedicated members instead). Applied only to TaskNotes-managed rows —
   * the source refuses it when no task info resolves at the path.
   */
  fieldWrite?: { key: string; value: unknown };
}

/**
 * Context tag attached to every mutation so the controller can recognize and
 * suppress the change events its own writes generate (echo-loop control).
 */
export interface MutationContext {
  /** Originating surface/plugin id (e.g. the plugin id). */
  source: string;
  /** Unique id for this write, matched against the in-flight set. */
  correlationId: string;
  /** Optional human-readable reason for debuggability. */
  reason?: string;
}

/**
 * Capability descriptor — the single source of read-only truth. Surfaces read
 * this to decide which mutations to expose.
 */
export interface DataSourceCapabilities {
  /** Whether the source supports write operations. */
  write: boolean;
}

/**
 * Capability-typed data source. Read operations are always present; write
 * operations are present only when `capabilities.write` is `true`.
 */
export interface DataSource {
  /** Declares this source's capabilities (notably whether writes are supported). */
  readonly capabilities: DataSourceCapabilities;

  /** List all source tasks (raw values; `parents` resolved to vault paths). */
  getTasks(): Promise<SourceTask[]>;

  /** Read the `blockedBy` dependency edges for the given task path. */
  getDependencies(path: string): Promise<SourceDependency[]>;

  /**
   * The status→color palette the backing system has configured (e.g. TaskNotes
   * custom statuses), or `[]`. Present only on sources that expose one; the
   * controller and view treat its absence as "no status colors".
   */
  getStatusColors?(): Promise<StatusColor[]>;

  /**
   * The priority→color palette the backing system has configured (e.g. TaskNotes
   * custom priorities), or `[]`. Present only on sources that expose one; the
   * controller and view treat its absence as "no priority colors". Mirrors
   * {@link DataSource.getStatusColors}.
   */
  getPriorityColors?(): Promise<PriorityColor[]>;

  /**
   * The configured value set for a restricted-choice role (statuses/priorities),
   * or `[]`. Present only on sources that expose one (TaskNotes reads the same
   * catalog its palettes come from); the view then offers pickers restricted to
   * these values. Mirrors {@link DataSource.getStatusColors}.
   */
  getChoiceOptions?(role: ChoiceRole): Promise<ChoiceOption[]>;

  /**
   * The note paths the backing system identifies as tasks (e.g. TaskNotes,
   * whose task identification is user-configurable — by tag or by a chosen
   * property+value — and computed by TaskNotes itself), or an empty set.
   * Present only on sources that can answer; the view treats absence as
   * "no rows are managed". Mirrors {@link DataSource.getStatusColors}.
   */
  getManagedPaths?(): Promise<ReadonlySet<string>>;

  /**
   * The backing system's configured date-field surface ({@link FieldConfig}) —
   * the scheduled/due property names plus enabled custom date fields — or `null`
   * when unavailable (e.g. TaskNotes absent). Used to resolve start/end roles to
   * write targets and to populate/validate the Bases config.
   */
  getFieldConfig?(): Promise<FieldConfig | null>;

  /**
   * Apply a field patch to the task at `path`. Present only on write-capable
   * sources (`capabilities.write === true`). The `context` rides the emitted
   * change event for echo-loop suppression.
   */
  mutate?(path: string, patch: TaskPatch, context?: MutationContext): Promise<void>;

  /**
   * Delete the task (and its note) at `path`. Present only on write-capable
   * sources (`capabilities.write === true`).
   */
  deleteTask?(path: string, context?: MutationContext): Promise<void>;

  /**
   * Add a dependency edge — `dependentPath` becomes blocked by
   * `predecessorPath` with `reltype` — by read-modify-write of the dependent's
   * `blockedBy`. A no-op if an equivalent edge already exists. Present only on
   * write-capable sources (`capabilities.write === true`). The `context` rides
   * the emitted change event for echo-loop suppression.
   */
  addDependency?(
    dependentPath: string,
    predecessorPath: string,
    reltype: DependencyRelType,
    context?: MutationContext,
  ): Promise<void>;

  /**
   * Remove the dependency edge where `dependentPath` is blocked by
   * `predecessorPath`, preserving every other `blockedBy` edge. Present only on
   * write-capable sources (`capabilities.write === true`).
   */
  removeDependency?(
    dependentPath: string,
    predecessorPath: string,
    context?: MutationContext,
  ): Promise<void>;
}
