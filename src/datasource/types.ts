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
 * A patch of mutable task fields for the write path. Date fields accept `Date`
 * or `null`; the write-capable source is responsible for converting to its
 * own canonical representation.
 */
export interface TaskPatch {
  start?: Date | null;
  end?: Date | null;
  progress?: number | null;
  text?: string;
  status?: string;
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
