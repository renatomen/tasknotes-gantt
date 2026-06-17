/**
 * TaskNotesSource — read + capability + events `DataSource` over the TaskNotes
 * JS API.
 *
 * Wraps the in-process TaskNotes JS API (`app.plugins.getPlugin('tasknotes')
 * ?.api`) behind the capability-typed {@link DataSource} contract. It produces
 * raw {@link SourceTask} values (native `Date`/`string`/`null` — never formatted
 * strings, per `.augment/rules/data-formatting-separation.md`), reads source
 * dependency edges from TaskNotes' `blockedBy` relationships, and exposes an
 * event-subscription hook so the controller (U6) can refresh on TaskNotes
 * changes.
 *
 * Every cross-plugin call is guarded (try/catch with graceful fallback): a
 * separately-versioned sibling plugin may be absent, mid-upgrade, or expose a
 * drifted surface, and the Gantt must degrade to the read-only Bases source
 * rather than throw (R1/R2). Construction goes through the async factory
 * {@link TaskNotesSource.create}, which resolves the api, awaits readiness, and
 * verifies the api version — returning `null` (not throwing) when TaskNotes is
 * unavailable or incompatible so the caller can fall back to {@link BasesSource}.
 *
 * Write support (U8): `capabilities.write` is set at construction from
 * {@link TaskNotesSource.supportsWrite} (TaskNotes' own
 * `hasCapability('tasks.write')`), and {@link TaskNotesSource.mutate} /
 * {@link TaskNotesSource.deleteTask} delegate to `api.tasks.update` /
 * `api.tasks.delete` — never direct frontmatter writes (R6). Capability is read
 * at construction; the controller re-creates the source when TaskNotes
 * availability flips, so a disable/enable re-derives `write`. Unlike the read
 * paths (which swallow errors to degrade gracefully), the write methods
 * **propagate failures** so the controller can revert the optimistic move and
 * surface a Notice.
 *
 * @module datasource/TaskNotesSource
 */

import type { App } from 'obsidian';
import type {
  DataSource,
  DataSourceCapabilities,
  DependencyRelType,
  MutationContext,
  SourceDependency,
  SourceTask,
  StatusColor,
  TaskPatch,
} from './types';

/**
 * The lowest TaskNotes `apiVersion` this source is built against. TaskNotes is
 * separately versioned; an older/incompatible surface causes {@link
 * TaskNotesSource.create} to return `null` so the caller falls back to Bases.
 */
export const MIN_TASKNOTES_API_VERSION = 1;

/**
 * TaskNotes change-event names this source subscribes to. Carried as a constant
 * so the controller (U6) and tests reference one canonical list.
 */
export const TASKNOTES_CHANGE_EVENTS = [
  'task.updated',
  'task.scheduled.changed',
  'task.due.changed',
  'task.dependencies.changed',
  'task.created',
  'task.deleted',
] as const;

/** Handler invoked when a subscribed TaskNotes change event fires. */
export type TaskNotesEventHandler = (eventName: string, payload?: unknown) => void;

// ---------------------------------------------------------------------------
// Minimal structural typings for the TaskNotes JS API surface.
//
// These mirror only the slice this unit consumes (read + capability + events),
// confirmed against the TaskNotes API surface documented in the origin
// brainstorm (2026-06-16). They are intentionally narrow and local: the full
// TaskNotes types are not published to this plugin, and typing the consumed
// surface explicitly keeps the code free of `any` (per typescript.md).
// ---------------------------------------------------------------------------

/** A TaskNotes task record (only the fields this source reads). */
export interface TaskNotesTaskInfo {
  /** Stable identity: the note path. */
  path: string;
  /** Task title. */
  title?: string | null;
  /** Status string. */
  status?: string | null;
  /** Scheduled date (start), as a `Date` or ISO/`yyyy-MM-dd` string. */
  scheduled?: Date | string | null;
  /** Due date (end), as a `Date` or ISO/`yyyy-MM-dd` string. */
  due?: Date | string | null;
}

/** A TaskNotes custom-status definition (the slice consumed for bar coloring). */
export interface TaskNotesStatusConfig {
  /** The status value (matches a task's `status`). */
  value?: string | null;
  /** Display label. */
  label?: string | null;
  /** Configured color (CSS color string, typically hex). */
  color?: string | null;
  /** Whether this status represents completion. */
  isCompleted?: boolean | null;
}

/** A resolved `blockedBy` dependency edge for a task. */
export interface TaskNotesDependencyEdge {
  /** Predecessor (blocking task) path. May arrive as `path` or `uid`. */
  path?: string | null;
  /** Alternative predecessor identifier some payloads use. */
  uid?: string | null;
  /** Relationship type (FINISHTOSTART | FINISHTOFINISH | STARTTOSTART | STARTTOFINISH). */
  reltype?: string | null;
  /** Optional ISO-8601 duration gap (e.g. `"P1D"`). */
  gap?: string | null;
}

/** Opaque reference returned by `events.on`, passed back to `events.off`. */
export type TaskNotesEventRef = unknown;

/** The TaskNotes JS API object (consumed slice). */
export interface TaskNotesApi {
  /** Numeric api version for compatibility gating. */
  apiVersion?: number;
  lifecycle?: {
    /** Resolves once TaskNotes has finished initialising. */
    ready(): Promise<void>;
  };
  tasks?: {
    list(query?: unknown): Promise<TaskNotesTaskInfo[]> | TaskNotesTaskInfo[];
    get(path: string): Promise<TaskNotesTaskInfo | null> | TaskNotesTaskInfo | null;
    /**
     * Atomically apply a field patch to a task (TaskNotes 4.11.0:
     * `update(path, updates, options)` → `withMutationContext`). The third
     * `options` arg carries the {@link MutationContext}; TaskNotes tags the
     * emitted change event with `context.correlationId` for echo suppression.
     */
    update?(
      path: string,
      updates: Record<string, unknown>,
      options?: unknown,
    ): Promise<unknown> | unknown;
    /** Delete a task and its note (`delete(path, options)`). */
    delete?(path: string, options?: unknown): Promise<unknown> | unknown;
  };
  relationships?: {
    dependencies(
      path: string
    ): Promise<TaskNotesDependencyEdge[]> | TaskNotesDependencyEdge[];
  };
  events?: {
    on(name: string, handler: (payload?: unknown) => void): TaskNotesEventRef;
    off(ref: TaskNotesEventRef): void;
  };
  hasCapability?(capability: string): boolean;
  /**
   * Configured status palette. TaskNotes exposes it via `catalog.statuses()`
   * (preferred) or `model.config().statuses`; each entry carries
   * value/label/color/isCompleted. Both guarded/optional (shape varies by
   * TaskNotes version).
   */
  catalog?: { statuses?(): TaskNotesStatusConfig[] | null | undefined };
  model?: { config?(): { statuses?: TaskNotesStatusConfig[] } | null | undefined };
}

/** Minimal shape of `app.plugins` needed to resolve the TaskNotes plugin. */
interface PluginsRegistry {
  getPlugin(id: string): { api?: TaskNotesApi } | undefined | null;
}

/** Maps TaskNotes reltype strings to the {@link DependencyRelType} union. */
const RELTYPE_MAP: Readonly<Record<string, DependencyRelType>> = {
  FINISHTOSTART: 'FINISHTOSTART',
  FINISHTOFINISH: 'FINISHTOFINISH',
  STARTTOSTART: 'STARTTOSTART',
  STARTTOFINISH: 'STARTTOFINISH',
};

/** TaskNotes plugin id used for resolution via `app.plugins.getPlugin`. */
const TASKNOTES_PLUGIN_ID = 'tasknotes';

/**
 * Read-capable data source backed by the TaskNotes JS API.
 *
 * Construct via {@link TaskNotesSource.create}; the constructor is `private` so
 * callers cannot build an instance around an unresolved/unready api.
 */
export class TaskNotesSource implements DataSource {
  /**
   * Write capability, derived at construction from TaskNotes'
   * `hasCapability('tasks.write')` (via {@link TaskNotesSource.supportsWrite}).
   * `mutate`/`deleteTask` are always present on this class; the contract
   * invariant (`write === true` ⇒ mutation methods present) holds because the
   * methods exist whenever `write` is true. Re-derived whenever the controller
   * re-creates the source (reactive availability — KTD).
   */
  public readonly capabilities: DataSourceCapabilities;

  private readonly app: App;
  private readonly api: TaskNotesApi;

  private constructor(app: App, api: TaskNotesApi) {
    this.app = app;
    this.api = api;
    this.capabilities = { write: this.supportsWrite() };
  }

  /**
   * Resolve, await readiness, and version-check the TaskNotes api, returning a
   * usable {@link TaskNotesSource} or `null` when TaskNotes is absent or
   * incompatible (so the caller falls back to {@link BasesSource}).
   *
   * Never throws — every step is guarded; any failure resolves to `null`.
   *
   * @param app - The Obsidian app (used to reach the plugin registry).
   * @returns A ready source, or `null` if TaskNotes is unavailable/incompatible.
   */
  public static async create(app: App): Promise<TaskNotesSource | null> {
    const api = TaskNotesSource.resolveApi(app);
    if (!api) {
      return null;
    }

    try {
      // Coordinate startup: wait for TaskNotes to finish initialising.
      if (api.lifecycle && typeof api.lifecycle.ready === 'function') {
        await api.lifecycle.ready();
      }
    } catch {
      return null;
    }

    if (!TaskNotesSource.isCompatibleVersion(api.apiVersion)) {
      return null;
    }

    return new TaskNotesSource(app, api);
  }

  /**
   * Resolve the TaskNotes api object via the plugin registry, guarded.
   *
   * `app.plugins` is not in the public Obsidian typings, so it is reached
   * through a narrow local interface rather than `any`.
   *
   * @returns The api object, or `null` if TaskNotes is not installed/enabled.
   */
  private static resolveApi(app: App): TaskNotesApi | null {
    try {
      const plugins = (app as unknown as { plugins?: PluginsRegistry }).plugins;
      const api = plugins?.getPlugin(TASKNOTES_PLUGIN_ID)?.api;
      return api ?? null;
    } catch {
      return null;
    }
  }

  /** Whether the resolved api version meets the minimum this source targets. */
  private static isCompatibleVersion(version: number | undefined): boolean {
    return typeof version === 'number' && version >= MIN_TASKNOTES_API_VERSION;
  }

  /**
   * List all TaskNotes tasks as raw {@link SourceTask} values.
   *
   * Maps each TaskInfo: `path` → identity, `title` → `text`, `scheduled` →
   * `start`, `due` → `end`, `status` → `status`, and `progress` → `null`
   * (TaskNotes has no native numeric progress field). Dates are parsed to raw
   * `Date`/`null` with no formatting. Returns `[]` on any failure (graceful
   * fallback — a transient api error must not crash the chart).
   */
  public async getTasks(): Promise<SourceTask[]> {
    try {
      if (!this.api.tasks || typeof this.api.tasks.list !== 'function') {
        return [];
      }
      const tasks = await this.api.tasks.list();
      if (!Array.isArray(tasks)) {
        return [];
      }
      return tasks.map((task) => this.toSourceTask(task));
    } catch {
      return [];
    }
  }

  /**
   * Read the `blockedBy` dependency edges for a task and map them to
   * {@link SourceDependency}.
   *
   * Each edge's predecessor (`path`/`uid`) becomes `predecessorPath`, the
   * TaskNotes reltype string maps to the {@link DependencyRelType} union, and
   * `gap` is carried verbatim (or `null`). Edges with an unknown reltype or no
   * resolvable predecessor are dropped. Returns `[]` on any failure.
   *
   * @param path - The task whose `blockedBy` edges to read.
   */
  public async getDependencies(path: string): Promise<SourceDependency[]> {
    try {
      if (
        !this.api.relationships ||
        typeof this.api.relationships.dependencies !== 'function'
      ) {
        return [];
      }
      const edges = await this.api.relationships.dependencies(path);
      if (!Array.isArray(edges)) {
        return [];
      }
      const deps: SourceDependency[] = [];
      for (const edge of edges) {
        const mapped = this.toSourceDependency(edge);
        if (mapped) {
          deps.push(mapped);
        }
      }
      return deps;
    } catch {
      return [];
    }
  }

  /**
   * Read TaskNotes' configured custom-status palette as {@link StatusColor}s.
   *
   * Sources `api.catalog.statuses()` (preferred) or `api.model.config().statuses`
   * — each `{ value, label, color, isCompleted }` — keeping only entries with a
   * usable value + color. Guarded: a missing/throwing accessor or an unexpected
   * shape yields `[]`, so the view renders no status colors rather than failing.
   */
  public async getStatusColors(): Promise<StatusColor[]> {
    try {
      const raw =
        this.api.catalog?.statuses?.() ?? this.api.model?.config?.()?.statuses;
      if (!Array.isArray(raw)) {
        return [];
      }
      const colors: StatusColor[] = [];
      for (const s of raw) {
        if (s && typeof s.value === 'string' && typeof s.color === 'string') {
          colors.push({
            value: s.value,
            color: s.color,
            isCompleted: s.isCompleted === true,
          });
        }
      }
      return colors;
    } catch {
      return [];
    }
  }

  /**
   * Whether TaskNotes currently grants write access.
   *
   * Delegates to TaskNotes' own `hasCapability('tasks.write')` rather than
   * inventing a parallel capability model. U8 will set
   * {@link TaskNotesSource.capabilities}.`write` from this. Guarded: a missing
   * or throwing `hasCapability` reports `false`.
   */
  public supportsWrite(): boolean {
    try {
      if (typeof this.api.hasCapability !== 'function') {
        return false;
      }
      return this.api.hasCapability('tasks.write') === true;
    } catch {
      return false;
    }
  }

  /**
   * Persist a field patch to the task at `path` via `api.tasks.update` (R6 — no
   * direct frontmatter writes; R17 — schedule edits only, progress deferred).
   *
   * Maps {@link TaskPatch} → TaskNotes update fields: `start`→`scheduled`,
   * `end`→`due` (formatted `yyyy-MM-dd`, or `null` to clear), `text`→`title`,
   * `status`→`status`. `progress` is intentionally dropped (milestone 1: derived
   * from status, not persisted). Only fields **present** in the patch are
   * written, so a drag commit (dates only) never clobbers `text`/`status`.
   *
   * The write is **atomic** — one `tasks.update` rather than separate
   * `setScheduled`/`setDue` — so a reschedule cannot leave a half-updated note.
   * `context` is forwarded as the third arg; TaskNotes tags the emitted change
   * event with `context.correlationId` so the controller suppresses the echo.
   *
   * Unlike the read paths, this does **not** swallow errors: a rejected write
   * propagates so the controller can revert the optimistic move and notify.
   *
   * @param path - The note path (source identity) to update.
   * @param patch - The fields to change.
   * @param context - Echo-suppression context riding the change event.
   */
  public async mutate(
    path: string,
    patch: TaskPatch,
    context?: MutationContext,
  ): Promise<void> {
    const tasks = this.api.tasks;
    if (!tasks || typeof tasks.update !== 'function') {
      throw new Error('TaskNotes API does not support task updates');
    }

    const updates: Record<string, unknown> = {};
    if (patch.start !== undefined) {
      updates.scheduled = patch.start === null ? null : toYmd(patch.start);
    }
    if (patch.end !== undefined) {
      updates.due = patch.end === null ? null : toYmd(patch.end);
    }
    if (patch.text !== undefined) {
      updates.title = patch.text;
    }
    if (patch.status !== undefined) {
      updates.status = patch.status;
    }
    // `patch.progress` is intentionally not written (milestone 1, R17).

    await tasks.update(path, updates, context);
  }

  /**
   * Delete the task (and its note) at `path` via `api.tasks.delete`. Removes the
   * single source — every render instance of it disappears. Propagates failures
   * (see {@link TaskNotesSource.mutate}).
   *
   * @param path - The note path to delete.
   * @param context - Echo-suppression context riding the change event.
   */
  public async deleteTask(path: string, context?: MutationContext): Promise<void> {
    const tasks = this.api.tasks;
    if (!tasks || typeof tasks.delete !== 'function') {
      throw new Error('TaskNotes API does not support task deletion');
    }
    await tasks.delete(path, context);
  }

  /**
   * Subscribe to TaskNotes change events and return an unsubscribe disposer.
   *
   * Registers `handler` for every event in {@link TASKNOTES_CHANGE_EVENTS} via
   * `api.events.on`, returning a function that calls `api.events.off` for each
   * registered ref. The caller (controller/U6) owns the disposer's lifecycle;
   * no Obsidian `Component` is assumed here. Registration is guarded — a failure
   * to register any single event does not abort the rest, and the returned
   * disposer is always safe to call.
   *
   * @param handler - Invoked with `(eventName, payload)` on each change event.
   * @returns A disposer that unsubscribes all registered handlers.
   */
  public subscribe(handler: TaskNotesEventHandler): () => void {
    const refs: TaskNotesEventRef[] = [];

    const events = this.api.events;
    if (events && typeof events.on === 'function') {
      for (const eventName of TASKNOTES_CHANGE_EVENTS) {
        try {
          const ref = events.on(eventName, (payload?: unknown) => {
            try {
              handler(eventName, payload);
            } catch {
              // A throwing consumer handler must not break the event bridge.
            }
          });
          refs.push(ref);
        } catch {
          // Skip this event; continue registering the rest.
        }
      }
    }

    return () => {
      if (!events || typeof events.off !== 'function') {
        return;
      }
      for (const ref of refs) {
        try {
          events.off(ref);
        } catch {
          // Best-effort teardown; ignore off() failures.
        }
      }
    };
  }

  /** Convert a TaskNotes TaskInfo into a raw {@link SourceTask}. */
  private toSourceTask(task: TaskNotesTaskInfo): SourceTask {
    return {
      path: task.path,
      text: task.title ?? '',
      start: this.toDate(task.scheduled),
      end: this.toDate(task.due),
      // TaskNotes has no native numeric progress field; progress is derived
      // from status in the view layer, never stored here (KTD: progress is
      // derived/read-only in milestone 1).
      progress: null,
      status: task.status ?? null,
      // TODO(U5/multi-parent): TaskNotes' confirmed surface (2026-06-16) exposes
      // no parent/project relationship resolvable to note paths, so parents are
      // empty for now. Wire this once a TaskNotes parent/project edge is
      // confirmed; do not invent an API.
      parents: [],
    };
  }

  /** Map a TaskNotes dependency edge to a {@link SourceDependency}, or `null`. */
  private toSourceDependency(
    edge: TaskNotesDependencyEdge
  ): SourceDependency | null {
    const predecessorPath = edge.path ?? edge.uid ?? null;
    if (!predecessorPath) {
      return null;
    }

    const reltype = edge.reltype ? RELTYPE_MAP[edge.reltype] : undefined;
    if (!reltype) {
      return null;
    }

    return {
      predecessorPath,
      reltype,
      gap: edge.gap ?? null,
    };
  }

  /**
   * Parse a raw scheduled/due value into a `Date` or `null` (no formatting).
   *
   * Accepts a `Date` (returned as-is when valid) or a date string; anything
   * unparseable yields `null` so the data layer never fabricates a date.
   */
  private toDate(value: Date | string | null | undefined): Date | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
}

/**
 * Format a `Date` as a `yyyy-MM-dd` calendar string using its **local**
 * components.
 *
 * The write path receives day-snapped, local-midnight `Date`s (from a SVAR drag
 * commit or a `yyyy-MM-dd` date input parsed locally). Using UTC here would
 * shift the day by one for users west of UTC, so local Y/M/D is the correct
 * basis — TaskNotes stores `scheduled`/`due` as calendar dates.
 */
function toYmd(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
