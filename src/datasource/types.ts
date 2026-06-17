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
  /** Status string, or `null` when unset. */
  status: string | null;
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
 * The backing system's (TaskNotes') configured date-field surface, used to map
 * the Gantt's start/end roles to concrete write targets and to populate/validate
 * the Bases config. `scheduledProp`/`dueProp` are the frontmatter property names
 * TaskNotes is configured to use for its canonical scheduled/due fields (or
 * `null` when unconfigured); `dateFields` are the enabled custom fields of type
 * `date`.
 */
export interface FieldConfig {
  scheduledProp: string | null;
  dueProp: string | null;
  dateFields: CustomDateField[];
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
 * A patch of mutable task fields for the write path. `dateWrites` carry resolved
 * date targets (the controller resolves start/end → targets via {@link FieldConfig});
 * `text`/`status` are written verbatim. `start`/`end`/`progress` remain for
 * non-resolved callers but the bases-scoped view uses `dateWrites`.
 */
export interface TaskPatch {
  start?: Date | null;
  end?: Date | null;
  progress?: number | null;
  text?: string;
  status?: string;
  /** Resolved date targets (preferred over start/end for field-mapped writes). */
  dateWrites?: DateWrite[];
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
}
