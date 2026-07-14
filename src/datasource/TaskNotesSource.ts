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
import type { RelationshipIndex } from './companionResolve';
import { toYmd } from './dateFieldMapping';
import type {
  ChoiceOption,
  ChoiceRole,
  CustomDateField,
  DataSource,
  DataSourceCapabilities,
  DateWrite,
  DependencyRelType,
  FieldConfig,
  MutationContext,
  PriorityColor,
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
  // Project-edge changes re-key the companion hierarchy (Show-all / nesting):
  // a re-parent or new child must refresh the expanded tree (plan U2/R7).
  'task.projects.changed',
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

/**
 * A `blockedBy` entry as TaskNotes stores it: a bare wikilink string, or an
 * object carrying the link `uid` plus `reltype`/`gap`. Read verbatim and written
 * back unchanged for edges we don't touch, so a dependency edit never clobbers
 * sibling edges (incl. ones whose reltype the read path doesn't recognize).
 */
export type TaskNotesBlockedByEntry =
  | string
  | { uid?: string | null; reltype?: string | null; gap?: string | null };

/** A TaskNotes task record (only the fields this source reads). */
export interface TaskNotesTaskInfo {
  /** Stable identity: the note path. */
  path: string;
  /** Task title. */
  title?: string | null;
  /** Status string. */
  status?: string | null;
  /** Priority string. */
  priority?: string | null;
  /** Scheduled date (start), as a `Date` or ISO/`yyyy-MM-dd` string. */
  scheduled?: Date | string | null;
  /** Due date (end), as a `Date` or ISO/`yyyy-MM-dd` string. */
  due?: Date | string | null;
  /** Raw dependency edges (predecessors), verbatim. */
  blockedBy?: ReadonlyArray<TaskNotesBlockedByEntry> | null;
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
  /** Optional icon name (`setIcon`-accepted); absent in many TaskNotes builds. */
  icon?: string | null;
}

/**
 * A TaskNotes custom-priority definition (the slice consumed for bar coloring).
 * Priorities carry a sort `weight` rather than an `isCompleted` flag; only
 * `value`/`color`/`icon` are consumed here.
 */
export interface TaskNotesPriorityConfig {
  /** The priority value (matches a task's `priority`). */
  value?: string | null;
  /** Display label. */
  label?: string | null;
  /** Configured color (CSS color string, typically hex). */
  color?: string | null;
  /** Optional icon name (`setIcon`-accepted); absent in many TaskNotes builds. */
  icon?: string | null;
}

/**
 * A resolved `blockedBy` dependency edge for a task, as returned by TaskNotes'
 * `relationships.dependencies(path)`.
 *
 * The live API (verified against TaskNotes 4.11.0 via the dependency e2e) nests
 * the relationship under `dependency` and puts the resolved predecessor at the
 * top-level `path`: `{ dependency: { uid, reltype, gap }, path, task }`. Older/
 * flat shapes (`{ path|uid, reltype, gap }`) are still accepted as a fallback.
 */
export interface TaskNotesDependencyEdge {
  /** Resolved predecessor (blocking task) note path. */
  path?: string | null;
  /** Alternative predecessor identifier some payloads use. */
  uid?: string | null;
  /** Relationship type (FINISHTOSTART | FINISHTOFINISH | STARTTOSTART | STARTTOFINISH). */
  reltype?: string | null;
  /** Optional ISO-8601 duration gap (e.g. `"P1D"`). */
  gap?: string | null;
  /** Nested relationship payload used by the live TaskNotes API. */
  dependency?: {
    uid?: string | null;
    reltype?: string | null;
    gap?: string | null;
  } | null;
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
    ): unknown;
    /** Delete a task and its note (`delete(path, options)`). */
    delete?(path: string, options?: unknown): unknown;
  };
  relationships?: {
    dependencies(
      path: string
    ): Promise<TaskNotesDependencyEdge[]> | TaskNotesDependencyEdge[];
    /**
     * Direct subtasks of `path` (tasks whose `projects` field links to it).
     * TaskNotes 4.11.0: `relationships.subtasks` → `getSubtasks`, returning
     * resolved `TaskInfo[]`. Optional/guarded (older versions lack it).
     */
    subtasks?(
      path: string
    ): Promise<TaskNotesTaskInfo[]> | TaskNotesTaskInfo[];
    /**
     * Direct parents of `path` (the tasks its `projects` field references).
     * TaskNotes 4.11.0: `relationships.parents` → `getParentTasks`, returning
     * resolved `TaskInfo[]`. Optional/guarded.
     */
    parents?(
      path: string
    ): Promise<TaskNotesTaskInfo[]> | TaskNotesTaskInfo[];
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
  catalog?: {
    statuses?(): TaskNotesStatusConfig[] | null | undefined;
    priorities?(): TaskNotesPriorityConfig[] | null | undefined;
  };
  /**
   * `model.config()` (getModelConfig) carries the configured field surface:
   * `fieldMapping` (logical field → frontmatter property name, incl.
   * `scheduled`/`due`), `userFields` (custom fields), and `statuses`.
   */
  model?: {
    config?(): TaskNotesModelConfig | null | undefined;
  };
}

/** The slice of TaskNotes' `model.config()` this source reads. */
export interface TaskNotesModelConfig {
  statuses?: TaskNotesStatusConfig[];
  /** Configured custom priorities (fallback path for the priority palette). */
  priorities?: TaskNotesPriorityConfig[];
  /** Logical field → frontmatter property name (incl. `scheduled`, `due`). */
  fieldMapping?: Record<string, string> | null;
  /** Custom user fields. */
  userFields?: TaskNotesUserField[] | null;
}

/** A TaskNotes custom user-field definition (the slice consumed here). */
export interface TaskNotesUserField {
  enabled?: boolean | null;
  displayName?: string | null;
  /** Frontmatter property key. */
  key?: string | null;
  /** Internal field id. */
  id?: string | null;
  /** Field type (e.g. `date`, `text`, `number`). */
  type?: string | null;
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

/** The uid string of a raw `blockedBy` entry (bare string or `{ uid }` object). */
function extractEdgeUid(entry: TaskNotesBlockedByEntry): string {
  if (typeof entry === 'string') return entry;
  return typeof entry.uid === 'string' ? entry.uid : '';
}

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

  /**
   * Resolves a companion-fetched task's progress (0–100) from its note path,
   * mode-aware. Set by the controller each recompute (it knows the resolved
   * Progress mode + property key). `null` → no resolver (e.g. tasknotes-first
   * strategy), so progress stays `null`. Without this, relationship-expanded
   * tasks that aren't matched Base entries render 0 progress (they never touch
   * BasesSource's read path).
   */
  private progressResolver: ((path: string) => number | null) | null = null;

  /**
   * Resolves a companion-fetched task's Time Estimate (minutes) by note path,
   * installed by the controller (mirrors {@link progressResolver}). `null` when
   * unset (no estimate for expanded tasks).
   */
  private estimateResolver: ((path: string) => number | null) | null = null;

  private constructor(app: App, api: TaskNotesApi) {
    this.app = app;
    this.api = api;
    this.capabilities = { write: this.supportsWrite() };
  }

  /**
   * Install (or clear) the progress resolver used by {@link toSourceTask} for
   * companion-fetched tasks. Idempotent; the controller re-sets it per recompute
   * so a Progress-mode/property change applies without re-creating the source.
   */
  public setProgressResolver(resolver: ((path: string) => number | null) | null): void {
    this.progressResolver = resolver;
  }

  /**
   * Install (or clear) the estimate resolver used by {@link toSourceTask} for
   * companion-fetched tasks (U4). Idempotent; the controller re-sets it per
   * recompute so a mode/property change applies without re-creating the source.
   */
  public setEstimateResolver(resolver: ((path: string) => number | null) | null): void {
    this.estimateResolver = resolver;
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
   * The note paths TaskNotes identifies as tasks. Identification is
   * user-configurable (task tag OR a chosen property+value) and computed by
   * TaskNotes — this consumes `api.tasks.list()` verbatim, never inferring
   * taskness from tags or frontmatter. Empty set on any failure.
   */
  public async getManagedPaths(): Promise<ReadonlySet<string>> {
    try {
      if (!this.api.tasks || typeof this.api.tasks.list !== 'function') {
        return new Set();
      }
      const tasks = await this.api.tasks.list();
      if (!Array.isArray(tasks)) {
        return new Set();
      }
      const paths = new Set<string>();
      for (const task of tasks) {
        const path = (task as { path?: unknown }).path;
        if (typeof path === 'string' && path !== '') paths.add(path);
      }
      return paths;
    } catch {
      return new Set();
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
   * Build the bulk {@link RelationshipIndex} in ONE pass (plan #161, U1/KTD2) —
   * the O(N) replacement for the per-node `getSubtasks` scan that made Show-all
   * expansion O(N²) and froze the view.
   *
   * Strategy (KTD2 — parity-safe, no `taskReferenceMatches` replication): list
   * every vault task once, resolve each task's parents via {@link getParents}
   * (parallelized), then **invert** that relation into `childrenByPath` while
   * recording `parentsByPath`. This is equivalent to N× `getSubtasks` because
   * `getSubtasks(P)` includes child C iff `resolveTaskReferencePath(C.projectRef)
   * === P`, the very resolution `getParents(C)` performs — and the companion BFS
   * only ever expands real parent tasks, so the two relations agree on every
   * edge the BFS can traverse (dangling/alias refs that resolve to no real task
   * are dropped by both).
   *
   * Readiness signal (cache-poisoning guard #161): returns `null` (never throws)
   * when the task list is empty or the read fails — i.e. TaskNotes' metadataCache
   * scan has not warmed yet, so an index built now would be spuriously empty and
   * must not be cached. A non-null index — even with empty maps — means the task
   * list was non-empty (authoritative; the vault just has no parent/child edges),
   * so the controller caches it and skips the full-vault scan on later notifies.
   */
  public async getRelationshipIndex(): Promise<RelationshipIndex | null> {
    try {
      const tasks = await this.getTasks();
      if (tasks.length === 0) {
        // Cold / empty: not-ready. Do not let the controller cache this — Show-all
        // would stick at the matched-only count until a TaskNotes data-change.
        return null;
      }
      // Resolve every task's parents concurrently (each is an O(1) TaskNotes
      // cache read upstream); a single failed lookup degrades to no parents
      // rather than aborting the whole index.
      const parentLists = await Promise.all(
        tasks.map((t) => this.getParents(t.path)),
      );

      const childrenByPath = new Map<string, SourceTask[]>();
      const parentsByPath = new Map<string, string[]>();
      for (let i = 0; i < tasks.length; i += 1) {
        const child = tasks[i]!;
        const parents = parentLists[i] ?? [];
        if (parents.length > 0) {
          parentsByPath.set(child.path, parents);
        }
        for (const parentPath of parents) {
          const bucket = childrenByPath.get(parentPath);
          if (bucket) {
            bucket.push(child);
          } else {
            childrenByPath.set(parentPath, [child]);
          }
        }
      }
      return { childrenByPath, parentsByPath };
    } catch {
      // Read failed → treat as not-ready (retry next build) rather than caching
      // a spurious empty index.
      return null;
    }
  }

  /**
   * Read the resolved vault paths of the direct parents of `path` (the tasks its
   * `projects` field references), via `api.relationships.parents(path)`
   * (TaskNotes 4.11.0). Returns `[]` when the accessor is absent or on failure.
   *
   * @param path - The task whose direct parents to read.
   */
  public async getParents(path: string): Promise<string[]> {
    try {
      if (
        !this.api.relationships ||
        typeof this.api.relationships.parents !== 'function'
      ) {
        return [];
      }
      const parents = await this.api.relationships.parents(path);
      if (!Array.isArray(parents)) {
        return [];
      }
      return parents
        .map((t) => t?.path)
        .filter((p): p is string => typeof p === 'string' && p.length > 0);
    } catch {
      return [];
    }
  }

  /**
   * Shared palette reader: guard that `raw` is an array, keep only entries with a
   * string `value` + `color`, and build each result via `mapEntry`. Pure and
   * non-throwing; the public wrappers own the try/catch around the (possibly
   * throwing) accessor call. Optional-icon spread is applied by each wrapper.
   */
  private mapPalette<E extends { value?: string | null; color?: string | null }, T>(
    raw: E[] | null | undefined,
    mapEntry: (entry: E & { value: string; color: string }) => T,
  ): T[] {
    if (!Array.isArray(raw)) {
      return [];
    }
    const out: T[] = [];
    for (const e of raw) {
      if (e && typeof e.value === 'string' && typeof e.color === 'string') {
        out.push(mapEntry(e as E & { value: string; color: string }));
      }
    }
    return out;
  }

  /**
   * Read TaskNotes' configured custom-status palette as {@link StatusColor}s.
   *
   * Sources `api.catalog.statuses()` (preferred) or `api.model.config().statuses`
   * — each `{ value, label, color, isCompleted, icon? }` — keeping only entries
   * with a usable value + color. Guarded: a missing/throwing accessor or an
   * unexpected shape yields `[]`, so the view renders no status colors.
   */
  public async getStatusColors(): Promise<StatusColor[]> {
    try {
      const raw = this.api.catalog?.statuses?.() ?? this.api.model?.config?.()?.statuses;
      return this.mapPalette(raw, (s) => ({
        value: s.value,
        color: s.color,
        isCompleted: s.isCompleted === true,
        ...(typeof s.icon === 'string' && s.icon.length > 0 ? { icon: s.icon } : {}),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Read TaskNotes' configured custom-priority palette as {@link PriorityColor}s.
   *
   * Mirrors {@link TaskNotesSource.getStatusColors} (no `isCompleted` — priorities
   * carry a sort `weight`): sources `api.catalog.priorities()` (preferred) or
   * `api.model.config().priorities` (fallback). Guarded → `[]` on any failure.
   */
  public async getPriorityColors(): Promise<PriorityColor[]> {
    try {
      const raw = this.api.catalog?.priorities?.() ?? this.api.model?.config?.()?.priorities;
      return this.mapPalette(raw, (p) => ({
        value: p.value,
        color: p.color,
        ...(typeof p.icon === 'string' && p.icon.length > 0 ? { icon: p.icon } : {}),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Read TaskNotes' configured value set for a restricted-choice role as
   * {@link ChoiceOption}s — the SAME catalog the color palettes come from
   * (`api.catalog.statuses()`/`priorities()`, `model.config()` fallback), but
   * keeping every entry with a usable `value` (a color is not required to be
   * pickable) and carrying the display `label` (value fallback). Guarded → `[]`
   * on any failure, so pickers degrade to "no editor offered".
   */
  public async getChoiceOptions(role: ChoiceRole): Promise<ChoiceOption[]> {
    try {
      const raw =
        role === 'status'
          ? this.api.catalog?.statuses?.() ?? this.api.model?.config?.()?.statuses
          : this.api.catalog?.priorities?.() ?? this.api.model?.config?.()?.priorities;
      if (!Array.isArray(raw)) {
        return [];
      }
      const options: ChoiceOption[] = [];
      for (const entry of raw) {
        if (entry && typeof entry.value === 'string' && entry.value.length > 0) {
          options.push({
            value: entry.value,
            label:
              typeof entry.label === 'string' && entry.label.length > 0
                ? entry.label
                : entry.value,
          });
        }
      }
      return options;
    } catch {
      return [];
    }
  }

  /**
   * Map one TaskNotes userField to a {@link CustomDateField}, or `null` when it
   * is not an enabled, keyed `date` field. A falsy entry (defensive against the
   * API) is dropped; a missing `enabled` flag means active.
   */
  private toCustomDateField(f: TaskNotesUserField | null | undefined): CustomDateField | null {
    if (!f || f.enabled === false || f.type !== 'date' || typeof f.key !== 'string' || f.key.length === 0) {
      return null;
    }
    return {
      key: f.key,
      id: typeof f.id === 'string' ? f.id : f.key,
      displayName:
        typeof f.displayName === 'string' && f.displayName.length > 0 ? f.displayName : f.key,
    };
  }

  /**
   * Read TaskNotes' configured field surface as a {@link FieldConfig}: the
   * frontmatter property names for the canonical fields the Gantt maps
   * (`scheduled`/`due`/`status`/`priority`/`timeEstimate`, from
   * `model.config().fieldMapping`) and the enabled custom fields of type `date`
   * (from `model.config().userFields`). Custom fields without a `key` are
   * dropped (the key is how the property is addressed). Guarded: a missing or
   * throwing `model.config()` yields `null` so callers degrade to read-only.
   */
  public async getFieldConfig(): Promise<FieldConfig | null> {
    try {
      const config = this.api.model?.config?.();
      if (!config) {
        return null;
      }
      const fieldMapping = config.fieldMapping ?? {};
      const dateFields: CustomDateField[] = [];
      for (const f of config.userFields ?? []) {
        const field = this.toCustomDateField(f);
        if (field) dateFields.push(field);
      }
      const configuredProp = (name: string): string | null =>
        typeof fieldMapping[name] === 'string' ? fieldMapping[name] : null;
      return {
        scheduledProp: configuredProp('scheduled'),
        dueProp: configuredProp('due'),
        dateFields,
        timeEstimateProp: configuredProp('timeEstimate'),
        statusProp: configuredProp('status'),
        priorityProp: configuredProp('priority'),
      };
    } catch {
      return null;
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

    // Row gate: a fieldWrite grafts frontmatter onto whatever note
    // `tasks.update` touches, so it may only land on a TaskNotes-managed row.
    // Fails closed when task info cannot be resolved at all.
    if (patch.fieldWrite) {
      const info = typeof tasks.get === 'function' ? await tasks.get(path) : null;
      if (!info) {
        throw new Error(`Refusing field write: no TaskNotes task at ${path}`);
      }
    }

    const updates = buildTaskUpdates(patch);

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
   * Add a Finish-to-Start (or given reltype) dependency: `dependentPath` becomes
   * blocked by `predecessorPath`. Read-modify-write of the dependent's raw
   * `blockedBy` (via `tasks.get`, preserving every existing edge verbatim — incl.
   * ones with reltypes the read path doesn't recognize), appending one new edge,
   * then `tasks.update({ blockedBy })`. A no-op when an equivalent edge already
   * exists (its uid resolves to `predecessorPath`). Propagates write failures.
   */
  public async addDependency(
    dependentPath: string,
    predecessorPath: string,
    reltype: DependencyRelType,
    context?: MutationContext,
  ): Promise<void> {
    const tasks = this.api.tasks;
    if (!tasks || typeof tasks.update !== 'function' || typeof tasks.get !== 'function') {
      throw new Error('TaskNotes API does not support dependency writes');
    }
    const current = await this.readBlockedBy(dependentPath);
    // Dedup: skip when an existing edge already points at the predecessor.
    if (current.some((e) => this.resolveEdgePath(extractEdgeUid(e), dependentPath) === predecessorPath)) {
      return;
    }
    const next: TaskNotesBlockedByEntry[] = [
      ...current,
      { uid: this.toWikilink(predecessorPath), reltype },
    ];
    await tasks.update(dependentPath, { blockedBy: next }, context);
  }

  /**
   * Remove the dependency edge where `dependentPath` is blocked by
   * `predecessorPath`, preserving every other edge verbatim. Writes `undefined`
   * when no edges remain (TaskNotes' clear convention). Propagates failures.
   */
  public async removeDependency(
    dependentPath: string,
    predecessorPath: string,
    context?: MutationContext,
  ): Promise<void> {
    const tasks = this.api.tasks;
    if (!tasks || typeof tasks.update !== 'function' || typeof tasks.get !== 'function') {
      throw new Error('TaskNotes API does not support dependency writes');
    }
    const current = await this.readBlockedBy(dependentPath);
    const next = current.filter(
      (e) => this.resolveEdgePath(extractEdgeUid(e), dependentPath) !== predecessorPath,
    );
    if (next.length === current.length) return; // nothing matched — no-op
    await tasks.update(
      dependentPath,
      { blockedBy: next.length > 0 ? next : undefined },
      context,
    );
  }

  /** Read the dependent task's raw `blockedBy` array (or `[]`). */
  private async readBlockedBy(path: string): Promise<TaskNotesBlockedByEntry[]> {
    const task = await this.api.tasks?.get?.(path);
    const raw = task?.blockedBy;
    return Array.isArray(raw) ? [...raw] : [];
  }

  /**
   * Resolve a `blockedBy` entry's `uid` (a wikilink/path string) to a vault note
   * path, relative to the dependent note. Returns `null` when unresolvable.
   * Mirrors TaskNotes' own `resolveDependencyEntry` link resolution.
   */
  private resolveEdgePath(uid: string, fromPath: string): string | null {
    if (!uid) return null;
    // Strip wikilink brackets, then take the link target before any #subpath or
    // |alias (avoids a runtime `obsidian` value import — `parseLinktext` is not
    // available in unit tests; the path-before-`#|` is all we need).
    const inner = uid.replace(/^\[\[/, '').replace(/\]\]$/, '');
    const target = inner.split(/[#|]/)[0]?.trim();
    if (!target) return null;
    const dest = this.app.metadataCache.getFirstLinkpathDest(target, fromPath);
    return dest ? dest.path : null;
  }

  /** A note path → `[[Basename]]` wikilink, matching TaskNotes' stored uid form. */
  private toWikilink(path: string): string {
    const base = path.split('/').pop()?.replace(/\.md$/i, '') ?? path;
    return `[[${base}]]`;
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
      // Companion-fetched tasks have no Bases entry, so progress is resolved from
      // the note by path (checklist compute or frontmatter property, mode-aware)
      // via the controller-installed resolver. `null` when no resolver is set
      // (e.g. tasknotes-first strategy) — TaskNotes has no native progress field.
      progress: this.progressResolver ? this.progressResolver(task.path) : null,
      // Companion-fetched tasks have no Bases entry; the estimate is resolved from
      // the note's frontmatter by path via the controller-installed resolver (U4).
      estimate: this.estimateResolver ? this.estimateResolver(task.path) : null,
      status: task.status ?? null,
      priority: task.priority ?? null,
      // Limitation (multi-parent): TaskNotes' confirmed surface (2026-06-16)
      // exposes no parent/project relationship resolvable to note paths, so
      // parents stay empty in milestone 1. Revisit when a TaskNotes
      // parent/project edge is confirmed — do not invent an API.
      parents: [],
    };
  }

  /** Map a TaskNotes dependency edge to a {@link SourceDependency}, or `null`. */
  private toSourceDependency(
    edge: TaskNotesDependencyEdge
  ): SourceDependency | null {
    // The live API nests reltype/gap/uid under `dependency`; fall back to the
    // flat shape for older payloads.
    const rel = edge.dependency ?? edge;
    const predecessorPath = edge.path ?? rel.uid ?? edge.uid ?? null;
    if (!predecessorPath) {
      return null;
    }

    const rawReltype = rel.reltype ?? edge.reltype;
    const reltype = rawReltype ? RELTYPE_MAP[rawReltype] : undefined;
    if (!reltype) {
      return null;
    }

    return {
      predecessorPath,
      reltype,
      gap: rel.gap ?? edge.gap ?? null,
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
 * Progress persistence: write only when a resolved `progressWrite` target is
 * present AND a value is supplied. A bare `progress` with no target is never
 * written — that guards TaskNotes progress mode (read-only/computed) and any
 * no-target caller. The value is coalesced to an integer 0–100, written to the
 * top-level frontmatter key, matching the custom user-field write path.
 */
function applyProgressWrite(updates: Record<string, unknown>, patch: TaskPatch): void {
  if (patch.progressWrite && typeof patch.progress === 'number' && Number.isFinite(patch.progress)) {
    updates[patch.progressWrite.key] = clampProgressPercent(patch.progress);
  }
}

/**
 * Time Estimate persistence: write only when a resolved `estimateWrite` target
 * is present AND a value is supplied — a bare `estimate` with no target is never
 * written (guards `dont-update` mode). The value is a rounded, non-negative
 * integer (minutes). `tasknotesField` writes through TaskNotes' canonical
 * `timeEstimate`; `property` writes the resolved frontmatter key.
 */
function applyEstimateWrite(updates: Record<string, unknown>, patch: TaskPatch): void {
  if (patch.estimateWrite && typeof patch.estimate === 'number' && Number.isFinite(patch.estimate)) {
    const minutes = Math.max(0, Math.round(patch.estimate));
    if (patch.estimateWrite.kind === 'tasknotesField') {
      updates.timeEstimate = minutes;
    } else {
      updates[patch.estimateWrite.key] = minutes;
    }
  }
}

/**
 * Build the TaskNotes `tasks.update` field map from a {@link TaskPatch}.
 *
 * Only fields **present** in the patch are written, so a partial patch (e.g. a
 * drag commit carrying dates only) never clobbers `text`/`status`. `progress`
 * is intentionally dropped (milestone 1, R17). Resolved `dateWrites` and the
 * direct `start`/`end` shorthands both target the canonical `scheduled`/`due`;
 * when both are present the direct fields win (applied last), matching the
 * original ordering.
 */
export function buildTaskUpdates(patch: TaskPatch): Record<string, unknown> {
  const updates: Record<string, unknown> = {};

  // Resolved date targets (the bases-scoped path, U8b): each routes to its
  // canonical field or to userFields keyed by the field key.
  if (patch.dateWrites) {
    for (const write of patch.dateWrites) {
      applyDateWrite(updates, write);
    }
  }

  // Direct start/end (non-resolved callers, e.g. tasknotes-first) map to the
  // canonical scheduled/due. The bases-scoped view uses dateWrites instead.
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
  if (patch.priority !== undefined) {
    updates.priority = patch.priority;
  }
  applyProgressWrite(updates, patch);
  applyEstimateWrite(updates, patch);
  // Generic field write: verbatim under the resolved bare frontmatter key,
  // top-level — TaskNotes' frontmatter writer reads custom user fields from
  // `task[key]`, never a nested `userFields` object (confirmed vs 4.11.0).
  // `null` clears the property (matching the date-clear convention).
  if (patch.fieldWrite) {
    updates[patch.fieldWrite.key] = patch.fieldWrite.value;
  }

  return updates;
}

/** Coalesce a progress value to an integer percentage in [0, 100] (R9). */
function clampProgressPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * Route a single resolved {@link DateWrite} into the `updates` map: canonical
 * `scheduled`/`due`, or a custom user field.
 *
 * Custom user fields: TaskNotes' frontmatter writer (mapToFrontmatter) reads
 * each user field's value from the TOP LEVEL of the updates object, keyed by the
 * field's frontmatter `key` — NOT from a `userFields` object and NOT by field id
 * (confirmed vs 4.11.0 main.js). Write it under the key accordingly.
 */
function applyDateWrite(updates: Record<string, unknown>, write: DateWrite): void {
  const value = write.value === null ? null : toYmd(write.value);
  if (write.target.kind === 'scheduled') {
    updates.scheduled = value;
  } else if (write.target.kind === 'due') {
    updates.due = value;
  } else {
    updates[write.target.key] = value;
  }
}
