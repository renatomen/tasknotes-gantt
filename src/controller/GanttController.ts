/**
 * GanttController — the action layer / single source of truth for the view (U6).
 *
 * Milestone 1 scope: **read-only**. The controller selects the active
 * {@link DataSource} (TaskNotes when installed and ready, else Bases), exposes
 * query operations that expand source tasks into SVAR render instances and
 * rewrite dependency links to instance ids (via {@link ExpansionResult}),
 * exposes the active source's {@link DataSourceCapabilities} so surfaces can
 * gate themselves, and refreshes a coherent source-graph snapshot on source
 * change events.
 *
 * It owns the snapshot: no surface mutates chart state directly (R8). Writes
 * (`mutate`/`deleteTask`) and the full correlationId/eventSource echo-loop
 * machinery are **U8** and are intentionally absent here — see the U8 seams
 * marked below.
 *
 * ## Reactive source selection
 * Selection is reactive, not a construction-time snapshot (KTD "Capability
 * gating ... reactive"). {@link GanttController.refreshSource} re-runs source
 * selection per the configured {@link SourceStrategy}:
 * - `'bases-scoped'` (the view): the Base owns the task set — a `BasesSource`
 *   built from the current entries/mappings, composed (via {@link
 *   import('../datasource/CompositeSource').CompositeSource}) with a TaskNotes
 *   enrichment source (or `null` when TaskNotes is unavailable). The Base's
 *   filter + field mappings drive the tasks/dates/parents; TaskNotes adds
 *   dependencies and (U8) writes.
 * - `'tasknotes-first'` (default, non-Base callers): prefers
 *   `TaskNotesSource.create(app)` (resolves, awaits readiness, version-checks,
 *   returning `null` when unavailable), falling back to a fresh `BasesSource`.
 *
 * When TaskNotes availability flips (enable/disable, lifecycle readiness) the
 * active source's capabilities change (and, in `'bases-scoped'`, its enrichment)
 * and listeners are notified.
 *
 * Obsidian's plugin enable/disable signalling is environment-specific and not
 * in the public typings, so the controller does **not** hard-depend on
 * undocumented internals. Instead it exposes
 * {@link GanttController.onExternalSourceChange}, an explicit trigger the
 * view/tests call when TaskNotes availability may have changed. **U7 wires the
 * real Obsidian lifecycle trigger** (plugin enable/disable + `lifecycle`
 * readiness) to this method.
 *
 * ## Refresh + idempotent backstop
 * {@link GanttController.onChange} subscribes a listener to snapshot changes.
 * While the active source is TaskNotes, the controller subscribes via
 * `source.subscribe(...)`; each change event recomputes the snapshot and
 * notifies listeners. Recomputation is guarded by an **idempotent backstop**:
 * if the freshly computed instance/link set is value-equal to the current
 * snapshot, no notification fires (a no-op). This is the cheap guard that makes
 * a future stray self-event harmless — full correlationId/eventSource echo
 * control lands in U8 (KTD "Two echo loops, two guards"); this backstop is the
 * "makes the guards non-correctness-critical" layer.
 *
 * @module controller/GanttController
 */

/* global clearTimeout */
import type { App, BasesEntry } from 'obsidian';
import type { FieldMappings } from '../bases/types/field-mapping';
import {
  BasesSource,
  CompositeSource,
  TaskNotesSource,
  resolveDateMapping,
  bareProperty,
  toNoteProperty,
  type DataSource,
  type DataSourceCapabilities,
  type DateWrite,
  type DateWriteTarget,
  type FieldConfig,
  type MutationContext,
  type SourceDependency,
  type SourceTask,
  type StatusColor,
  type TaskPatch,
} from '../datasource';
import {
  expandInstances,
  ExpansionResult,
  type ExpandableTask,
  type LinkRewriteMode,
  type RenderInstance,
  type RenderLink,
  type SourceLink,
} from './InstanceExpansion';
import { applyDatePolicy, type DateStatus } from './datePolicy';
import {
  resolveCompanionTree,
  type CompanionAccessor,
  type CompanionResolveOptions,
} from '../datasource/companionResolve';

/**
 * Date-policy + visibility configuration the controller applies when building a
 * snapshot. Supplied per-view by U3; defaults ({@link DEFAULT_DATE_POLICY_CONFIG})
 * apply when absent so the controller behaves sensibly before the view wires it.
 */
export interface DatePolicyConfig {
  /** Bar length (days) for partial/placeholder tasks; `1` → single-day bars. */
  defaultDuration: number;
  /** When `false`, undated (placeholder) tasks are filtered out entirely. */
  showUndatedTasks: boolean;
  /** When `false`, partial-date (inferred) tasks are filtered out entirely. */
  showPartialDateTasks: boolean;
}

/** Default policy config: single-day partials, show everything (R6/R7). */
export const DEFAULT_DATE_POLICY_CONFIG: DatePolicyConfig = {
  defaultDuration: 1,
  showUndatedTasks: true,
  showPartialDateTasks: true,
};

/**
 * Default TTL (ms) for an in-flight write's `correlationId` in the
 * self-suppression set. The matching echo event normally removes it sooner
 * (removal-on-first-match); this is the backstop if the event is dropped or
 * never arrives, after which the idempotent recompute backstop covers any late
 * self-event (KTD "two echo loops, two guards").
 */
export const DEFAULT_CORRELATION_TTL_MS = 5000;

/** `source` tag attached to every write's {@link MutationContext}. */
const GANTT_MUTATION_SOURCE = 'obsidian-gantt';

/** `dateStatus` values produced by partial (one-date-only) tasks. */
const PARTIAL_STATUSES: ReadonlySet<DateStatus> = new Set([
  'inferred-start',
  'inferred-end',
]);

/**
 * The Bases fallback inputs the controller needs to construct a
 * {@link BasesSource} when TaskNotes is unavailable.
 *
 * Supplied as a callback so the controller always reads the *current* Bases
 * query result and mappings at (re-)selection time — the view's Bases entries
 * change as the user edits filters, and re-selection may happen long after
 * construction. U7 supplies the real provider from the `mountGantt` seam; tests
 * pass a fake.
 */
export type BasesInputProvider = () => {
  entries: BasesEntry[];
  mappings: FieldMappings;
};

/**
 * Injection seam for the source-selection strategy, so unit tests can supply
 * fake sources without a real Obsidian app or TaskNotes plugin.
 *
 * Both hooks are optional; the production defaults call
 * `TaskNotesSource.create(app)` and `new BasesSource(app, entries, mappings)`
 * respectively.
 */
export interface GanttControllerDeps {
  /**
   * Resolve a write/read TaskNotes source, or `null` when TaskNotes is
   * unavailable/incompatible. Defaults to {@link TaskNotesSource.create}.
   */
  createTaskNotesSource?: (app: App) => Promise<DataSource | null>;
  /**
   * Construct the read-only Bases source (the task set in `'bases-scoped'`
   * strategy; the fallback in `'tasknotes-first'`). Defaults to
   * `new BasesSource(app, entries, mappings)`.
   */
  createBasesSource?: (
    app: App,
    entries: BasesEntry[],
    mappings: FieldMappings,
  ) => DataSource;
  /**
   * Compose a Bases task set with optional TaskNotes enrichment (the
   * `'bases-scoped'` strategy). `options.writable` lets the controller force the
   * composite read-only when it can't resolve safe date write targets. Defaults
   * to `new CompositeSource(base, enrichment, options)`.
   */
  createCompositeSource?: (
    base: DataSource,
    enrichment: DataSource | null,
    options?: { writable?: boolean },
  ) => DataSource;
}

/**
 * How the controller picks its active source:
 *
 * - `'bases-scoped'` — the **Base** owns the task set (its filter/query + field
 *   mappings drive which tasks, their dates, and their parents); **TaskNotes**,
 *   when present, is layered on as enrichment (dependencies + write). This is
 *   what makes a Bases custom view honor its own filter and resolve
 *   multi-parenting. Used by the view (U7).
 * - `'tasknotes-first'` — TaskNotes (all tasks) when available, else the Bases
 *   source. For non-Base contexts (e.g. future commands / JS API, M3) that want
 *   every task regardless of any Base. The default, preserving prior behavior.
 */
export type SourceStrategy = 'bases-scoped' | 'tasknotes-first';

/** Construction options for {@link GanttController}. */
export interface GanttControllerOptions {
  /** The Obsidian app (passed to source factories). */
  app: App;
  /** Provider for the Bases inputs (read at selection time). */
  basesInput: BasesInputProvider;
  /**
   * Source-selection strategy ({@link SourceStrategy}). The view passes
   * `'bases-scoped'`; defaults to `'tasknotes-first'` to preserve prior behavior
   * for non-Base callers and existing tests.
   */
  sourceStrategy?: SourceStrategy;
  /**
   * Date-policy + visibility config (per-view). Accepts a static value or a
   * **provider closure** read fresh at each snapshot build — pass a closure so a
   * per-view option change applies on the next recompute (onDataUpdated →
   * refreshSource) without a remount, consistent with {@link basesInput} and
   * {@link companionConfig}. Defaults to {@link DEFAULT_DATE_POLICY_CONFIG}.
   */
  policyConfig?: DatePolicyConfig | (() => DatePolicyConfig);
  /**
   * Provider for the companion settings (expanded-relationships mode +
   * hide-top-level). Read **fresh at each snapshot build** — a closure (like
   * {@link basesInput}), so a per-view option change applies on the next
   * recompute without a remount. Defaults to Inherit + hide-off.
   */
  companionConfig?: () => CompanionResolveOptions;
  /** Optional injected source factories (tests). */
  deps?: GanttControllerDeps;
  /**
   * Injected clock for the date policy's placeholder anchor, so tests are
   * deterministic. Defaults to `() => new Date()`.
   */
  now?: () => Date;
  /**
   * How long (ms) an in-flight write's `correlationId` stays in the
   * self-suppression set as a backstop, in case the echo event is dropped or
   * never arrives. Defaults to {@link DEFAULT_CORRELATION_TTL_MS}.
   */
  correlationTtlMs?: number;
  /**
   * Factory for a unique per-write `correlationId`. Injected so tests are
   * deterministic. Defaults to `crypto.randomUUID()` with a counter fallback.
   */
  newCorrelationId?: () => string;
}

/** A listener notified whenever the controller's snapshot changes. */
export type ChangeListener = () => void;

/**
 * The resolved date-field mapping state for the active source (bases-scoped).
 * Surfaces whether each role's configured property was a valid TaskNotes date
 * target (so the view can show an "invalid mapping" notice) and the effective
 * read property used. All-`false`/`null` when there is no field config.
 */
export interface DateMappingInfo {
  startInvalid: boolean;
  endInvalid: boolean;
  startReadProp: string | null;
  endReadProp: string | null;
}

/**
 * An immutable snapshot of the controller's coherent source graph: the expanded
 * render instances plus the rewritten dependency links for each rewrite mode,
 * with the raw source-level links retained so a mode switch is a cheap re-derive
 * and value-equality comparisons don't need to re-query the source.
 */
interface Snapshot {
  /** Expansion result (instances + identity maps). */
  expansion: ExpansionResult;
  /** Source-level dependency links gathered across all tasks. */
  sourceLinks: SourceLink[];
}

/** Maps a TaskNotes reltype to the SVAR link type. */
const RELTYPE_TO_SVAR: Readonly<Record<SourceDependency['reltype'], string>> = {
  FINISHTOSTART: 'e2s',
  STARTTOSTART: 's2s',
  FINISHTOFINISH: 'e2e',
  STARTTOFINISH: 's2e',
};

/**
 * Action layer / single source of truth for the Gantt view (read-only, M1).
 *
 * Construct, then `await init()` once. Surfaces call {@link getInstances} /
 * {@link getLinks} to render, read {@link capabilities} to gate affordances,
 * and {@link onChange} to react to refreshes. The view (U7) drives reactivity
 * by calling {@link onExternalSourceChange} when TaskNotes availability changes.
 */
export class GanttController {
  private readonly app: App;
  private readonly basesInput: BasesInputProvider;
  private readonly sourceStrategy: SourceStrategy;
  /** Provider for the date-policy config, read fresh at each snapshot build. */
  private readonly policyConfigProvider: () => DatePolicyConfig;
  /**
   * Provider for the companion settings, read fresh at each snapshot build so
   * an option change applies on the next recompute (no remount).
   */
  private readonly companionConfig: () => CompanionResolveOptions;
  /**
   * Companion relationship accessor — set in {@link selectSource} when
   * bases-scoped AND the enrichment source exposes `getSubtasks`/`getParents`
   * (TaskNotes present). `null` in standalone mode → no companion expansion.
   */
  private companionAccessor: CompanionAccessor | null = null;
  /**
   * Monotonic recompute token. Each {@link recompute} captures the current
   * value; if a newer recompute starts while it awaits the async build, the
   * stale result is discarded (latest-wins) — guards against overlapping async
   * snapshot builds clobbering each other.
   */
  private recomputeSeq = 0;
  private readonly now: () => Date;
  private readonly createTaskNotesSource: (app: App) => Promise<DataSource | null>;
  private readonly createBasesSource: (
    app: App,
    entries: BasesEntry[],
    mappings: FieldMappings,
  ) => DataSource;
  private readonly createCompositeSource: (
    base: DataSource,
    enrichment: DataSource | null,
    options?: { writable?: boolean },
  ) => DataSource;

  /** The currently selected source. `null` until {@link init}. */
  private activeSource: DataSource | null = null;

  /** Disposer for the active TaskNotes event subscription, if any. */
  private sourceUnsubscribe: (() => void) | null = null;

  /** The current coherent source-graph snapshot. `null` until first compute. */
  private snapshot: Snapshot | null = null;

  /** Registered snapshot-change listeners. */
  private readonly listeners = new Set<ChangeListener>();

  /** Guards against overlapping recompute/select runs clobbering each other. */
  private disposed = false;

  /**
   * `correlationId`s of writes this controller has in flight, each with a TTL
   * timer. A source change event whose correlationId is in this set is the echo
   * of our own write and is suppressed (removed on first match). See KTD "two
   * echo loops, two guards".
   */
  private readonly inFlightCorrelations = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly correlationTtlMs: number;
  private readonly newCorrelationId: () => string;

  /**
   * Resolved date write targets for the active source (bases-scoped + TaskNotes
   * field config). `null` when there is no field config — writes then pass
   * `start`/`end` through to the source's canonical scheduled/due mapping.
   */
  private startWriteTarget: DateWriteTarget | null = null;
  private endWriteTarget: DateWriteTarget | null = null;
  /** Validity/read-prop info for the resolved date mapping (for surfaces). */
  private dateMappingInfo: DateMappingInfo | null = null;

  constructor(options: GanttControllerOptions) {
    this.app = options.app;
    this.basesInput = options.basesInput;
    this.sourceStrategy = options.sourceStrategy ?? 'tasknotes-first';
    const pc = options.policyConfig ?? DEFAULT_DATE_POLICY_CONFIG;
    this.policyConfigProvider = typeof pc === 'function' ? pc : () => pc;
    this.companionConfig =
      options.companionConfig ?? (() => ({ mode: 'inherit', hideTopLevel: false }));
    this.now = options.now ?? (() => new Date());
    this.correlationTtlMs = options.correlationTtlMs ?? DEFAULT_CORRELATION_TTL_MS;
    this.newCorrelationId = options.newCorrelationId ?? defaultCorrelationId;
    this.createTaskNotesSource =
      options.deps?.createTaskNotesSource ??
      ((app) => TaskNotesSource.create(app));
    this.createBasesSource =
      options.deps?.createBasesSource ??
      ((app, entries, mappings) => new BasesSource(app, entries, mappings));
    this.createCompositeSource =
      options.deps?.createCompositeSource ??
      ((base, enrichment, opts) => new CompositeSource(base, enrichment, opts));
  }

  /**
   * Select the active source, compute the initial snapshot, and wire change
   * subscriptions. Call once after construction. Idempotent-safe to call again
   * (delegates to {@link refreshSource}).
   */
  public async init(): Promise<void> {
    await this.refreshSource();
  }

  /**
   * Re-run source selection: prefer a ready TaskNotes source, else the Bases
   * fallback. If the selected source *kind* or instance changes, the old
   * subscription is torn down, the new source is subscribed (when it is
   * TaskNotes), the snapshot is recomputed, and listeners are notified.
   *
   * This is the reactive selection entry point: call it whenever TaskNotes
   * availability may have flipped.
   */
  public async refreshSource(): Promise<void> {
    if (this.disposed) {
      return;
    }

    const next = await this.selectSource();

    // Tear down the previous source's subscription before swapping.
    this.teardownSubscription();
    this.activeSource = next;

    // Subscribe to change events when the active source supports it (TaskNotes).
    this.subscribeToSource(next);

    // Recompute the snapshot from the new source and notify (selection changed
    // the capability surface and possibly the data, so always notify here).
    await this.recompute({ forceNotify: true });
  }

  /**
   * Explicit reactive trigger: the view/tests call this when TaskNotes
   * availability may have changed (plugin enable/disable, lifecycle readiness).
   *
   * The controller does not hard-depend on undocumented Obsidian plugin
   * lifecycle events; **U7 wires the real Obsidian signal to this method.**
   */
  public async onExternalSourceChange(): Promise<void> {
    await this.refreshSource();
  }

  /**
   * The active source's capabilities (notably `write`). Surfaces read this to
   * gate mutation affordances (R5). Reports read-only (`write: false`) before
   * {@link init} or if no source is selected.
   */
  public get capabilities(): DataSourceCapabilities {
    return this.activeSource?.capabilities ?? { write: false };
  }

  /**
   * The expanded render instances for the current snapshot. Recomputes lazily if
   * no snapshot exists yet (e.g. called before an explicit refresh).
   */
  public async getInstances(): Promise<RenderInstance[]> {
    const snap = await this.ensureSnapshot();
    return [...snap.expansion.instances];
  }

  /**
   * The dependency links for the current snapshot, rewritten to instance-id
   * endpoints for the requested mode (R27: `'primary'` | `'all'`).
   *
   * Bases sources expose no dependencies, so this yields `[]` for them.
   *
   * @param mode - Endpoint cardinality for link rewriting.
   */
  public async getLinks(mode: LinkRewriteMode): Promise<RenderLink[]> {
    const snap = await this.ensureSnapshot();
    return snap.expansion.rewriteLinks(snap.sourceLinks, mode);
  }

  /**
   * The active source's status→color palette (TaskNotes), or `[]` when the
   * source exposes none or before {@link init}. The view reads this to color
   * bars by status. Source-agnostic: surfaces from a `tasknotes-first`
   * TaskNotesSource or, in `bases-scoped`, the composite's TaskNotes enrichment.
   */
  public async getStatusColors(): Promise<StatusColor[]> {
    return (await this.activeSource?.getStatusColors?.()) ?? [];
  }

  /**
   * Subscribe to snapshot changes. The listener fires whenever a recompute
   * produces a snapshot that differs (value-inequality) from the previous one —
   * source change events and reactive re-selection both flow through here.
   *
   * @param listener - Invoked (with no arguments) on each effective change.
   * @returns A disposer that removes the listener.
   */
  public onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Tear down all subscriptions and listeners and abort in-flight write
   * tracking. After disposal, refresh and mutate calls are no-ops/rejections.
   */
  public dispose(): void {
    this.disposed = true;
    this.teardownSubscription();
    for (const timer of this.inFlightCorrelations.values()) {
      clearTimeout(timer);
    }
    this.inFlightCorrelations.clear();
    this.listeners.clear();
  }

  /**
   * Persist a field patch to the source task behind a render instance (U8).
   *
   * Resolves `instanceId` → source path via the expansion map (so a drag on any
   * one instance of a multi-parent task writes to the single shared source —
   * R25/R26), tags the write with a self {@link MutationContext} whose
   * `correlationId` is tracked for echo suppression, and delegates to the active
   * source's `mutate`. Rejects (without writing) when the active source is
   * read-only or the instance is unknown. On write failure the correlationId is
   * released and the error propagates so the caller can revert + notify.
   *
   * @param instanceId - The render-row id being edited.
   * @param patch - The fields to change (drag → dates only; modal → explicit).
   */
  public async mutate(instanceId: string, patch: TaskPatch): Promise<void> {
    const { source, path } = await this.resolveWritable(instanceId);
    const context = this.beginWrite('mutate');
    try {
      await source.mutate!(path, this.toTargetedPatch(patch), context);
    } catch (err) {
      this.clearInFlight(context.correlationId);
      throw err;
    }
  }

  /**
   * Translate a `{start,end}` patch into resolved `dateWrites` using the active
   * source's write targets (R-D), so a start drag persists to the mapped field
   * (canonical scheduled/due or a custom userField) rather than always
   * scheduled/due. With no resolved targets (no field config / tasknotes-first),
   * the patch passes through and the source applies its canonical mapping.
   */
  private toTargetedPatch(patch: TaskPatch): TaskPatch {
    if (!this.startWriteTarget && !this.endWriteTarget) {
      return patch;
    }
    const dateWrites: DateWrite[] = patch.dateWrites ? [...patch.dateWrites] : [];
    const rest: TaskPatch = { ...patch };
    if (patch.start !== undefined && this.startWriteTarget) {
      dateWrites.push({ target: this.startWriteTarget, value: patch.start ?? null });
      delete rest.start;
    }
    if (patch.end !== undefined && this.endWriteTarget) {
      dateWrites.push({ target: this.endWriteTarget, value: patch.end ?? null });
      delete rest.end;
    }
    if (dateWrites.length > 0) {
      rest.dateWrites = dateWrites;
    }
    return rest;
  }

  /**
   * Delete the source task (and its note) behind a render instance (U8) — all of
   * its render instances disappear. Resolution, context, and failure handling
   * mirror {@link GanttController.mutate}.
   *
   * @param instanceId - A render-row id of the task to delete.
   */
  public async deleteTask(instanceId: string): Promise<void> {
    const { source, path } = await this.resolveWritable(instanceId);
    if (typeof source.deleteTask !== 'function') {
      throw new TypeError('Active source does not support deletion');
    }
    const context = this.beginWrite('delete');
    try {
      await source.deleteTask(path, context);
    } catch (err) {
      this.clearInFlight(context.correlationId);
      throw err;
    }
  }

  /**
   * Resolve an instance id to its `{ source, path }` for a write, enforcing the
   * capability gate (R11 — no bypass). Throws when disposed, read-only, the
   * source lacks `mutate`, or the instance id is unknown.
   */
  private async resolveWritable(
    instanceId: string,
  ): Promise<{ source: DataSource; path: string }> {
    if (this.disposed) {
      throw new Error('GanttController is disposed');
    }
    const source = this.activeSource;
    if (!source || !source.capabilities.write || typeof source.mutate !== 'function') {
      throw new Error('Active source is read-only');
    }
    const snap = await this.ensureSnapshot();
    const path = snap.expansion.getSourcePath(instanceId);
    if (!path) {
      throw new Error(`Unknown render instance: ${instanceId}`);
    }
    return { source, path };
  }

  /**
   * Create a Finish-to-Start dependency from a drawn link: the task behind
   * `dependentInstanceId` becomes blocked by the task behind
   * `predecessorInstanceId`. Resolves both render instances to their source
   * notes, enforces the write-capability gate, and delegates to the source's
   * `addDependency` (read-modify-write of `blockedBy`). M2 is FS-only. Failure
   * releases the correlationId and propagates so the view can notify.
   *
   * @param predecessorInstanceId - The blocking task's render-row id.
   * @param dependentInstanceId - The blocked task's render-row id.
   */
  public async addDependency(
    predecessorInstanceId: string,
    dependentInstanceId: string,
  ): Promise<void> {
    const { source, paths } = await this.resolveWritablePair(
      dependentInstanceId,
      predecessorInstanceId,
    );
    if (typeof source.addDependency !== 'function') {
      throw new TypeError('Active source does not support dependency writes');
    }
    const context = this.beginWrite('add-dependency');
    try {
      await source.addDependency(paths.dependent, paths.predecessor, 'FINISHTOSTART', context);
    } catch (err) {
      this.clearInFlight(context.correlationId);
      throw err;
    }
  }

  /**
   * Remove the dependency where the task behind `dependentInstanceId` is blocked
   * by the task behind `predecessorInstanceId`. Resolution, gating, context, and
   * failure handling mirror {@link GanttController.addDependency}.
   */
  public async removeDependency(
    predecessorInstanceId: string,
    dependentInstanceId: string,
  ): Promise<void> {
    const { source, paths } = await this.resolveWritablePair(
      dependentInstanceId,
      predecessorInstanceId,
    );
    if (typeof source.removeDependency !== 'function') {
      throw new TypeError('Active source does not support dependency writes');
    }
    const context = this.beginWrite('remove-dependency');
    try {
      await source.removeDependency(paths.dependent, paths.predecessor, context);
    } catch (err) {
      this.clearInFlight(context.correlationId);
      throw err;
    }
  }

  /**
   * Resolve a dependent + predecessor instance id to their `{ source, paths }`
   * for a dependency write, enforcing the capability gate (no bypass). Throws
   * when disposed, read-only, or either instance id is unknown.
   */
  private async resolveWritablePair(
    dependentInstanceId: string,
    predecessorInstanceId: string,
  ): Promise<{ source: DataSource; paths: { dependent: string; predecessor: string } }> {
    if (this.disposed) {
      throw new Error('GanttController is disposed');
    }
    const source = this.activeSource;
    if (!source?.capabilities.write) {
      throw new Error('Active source is read-only');
    }
    const snap = await this.ensureSnapshot();
    const dependent = snap.expansion.getSourcePath(dependentInstanceId);
    const predecessor = snap.expansion.getSourcePath(predecessorInstanceId);
    if (!dependent) {
      throw new Error(`Unknown render instance: ${dependentInstanceId}`);
    }
    if (!predecessor) {
      throw new Error(`Unknown render instance: ${predecessorInstanceId}`);
    }
    return { source, paths: { dependent, predecessor } };
  }

  /** Mint a self mutation context and start tracking its correlationId (TTL). */
  private beginWrite(reason: string): MutationContext {
    const correlationId = this.newCorrelationId();
    const timer = setTimeout(() => {
      this.inFlightCorrelations.delete(correlationId);
    }, this.correlationTtlMs);
    // Don't keep the event loop alive on this backstop timer (node/tests).
    (timer as { unref?: () => void }).unref?.();
    this.inFlightCorrelations.set(correlationId, timer);
    return { source: GANTT_MUTATION_SOURCE, correlationId, reason };
  }

  /** Remove a correlationId from the in-flight set and cancel its TTL timer. */
  private clearInFlight(correlationId: string): void {
    const timer = this.inFlightCorrelations.get(correlationId);
    if (timer) {
      clearTimeout(timer);
    }
    this.inFlightCorrelations.delete(correlationId);
  }

  /**
   * Select the active source per {@link SourceStrategy}.
   *
   * - `'bases-scoped'`: the Base owns the task set — build a {@link BasesSource}
   *   from the current entries/mappings and compose it with a TaskNotes
   *   enrichment source (or `null` when TaskNotes is unavailable). The Base's
   *   filter and field mappings drive which tasks appear and their dates/parents;
   *   TaskNotes adds dependencies + write. This is read reactively: the entries
   *   are re-read here on every (re-)selection.
   * - `'tasknotes-first'`: TaskNotes (all tasks) when available, else the Bases
   *   source — for non-Base callers that want every task.
   */
  private async selectSource(): Promise<DataSource> {
    // Reset resolved date targets; the bases-scoped branch repopulates them.
    this.startWriteTarget = null;
    this.endWriteTarget = null;
    this.dateMappingInfo = null;
    // Reset companion accessor; the bases-scoped branch repopulates it when
    // TaskNotes (enrichment) exposes the relationship reads.
    this.companionAccessor = null;

    if (this.sourceStrategy === 'bases-scoped') {
      // Official BasesEntry is structurally assignable to the adapter's BasesEntryLike (see bases-entry.ts / plan KTD 4).
      const { entries, mappings } = this.basesInput();
      // Create the enrichment first so its field config can resolve the
      // effective read properties + write targets before the base is built.
      const enrichment = await this.createTaskNotesSource(this.app);
      // Companion expansion (Inherit/Show-all + hide) runs only when TaskNotes
      // is present and exposes the relationship reads; in companion mode its
      // `projects` edges supersede the configured parentProperty (KTD1).
      this.companionAccessor = toCompanionAccessor(enrichment);
      const fieldConfig = enrichment
        ? (await enrichment.getFieldConfig?.()) ?? null
        : null;
      const effectiveMappings = this.applyDateFieldMapping(mappings, fieldConfig);
      const base = this.createBasesSource(this.app, entries, effectiveMappings);
      // Force read-only when we have no resolvable field config: without write
      // targets, a date edit would fall through to canonical scheduled/due and
      // could land in a different field than the Base reads (R-F / #70). Deps
      // from the enrichment still flow; only writes are gated off.
      return this.createCompositeSource(base, enrichment, {
        writable: fieldConfig != null,
      });
    }

    const taskNotes = await this.createTaskNotesSource(this.app);
    if (taskNotes) {
      return taskNotes;
    }
    const { entries, mappings } = this.basesInput();
    // Apply the same legacy read defaults the bases-scoped no-config path uses.
    return this.createBasesSource(this.app, entries, this.applyDateFieldMapping(mappings, null));
  }

  /**
   * Resolve the Base's start/end property mappings against TaskNotes' field
   * config: store the write targets, record validity/read-prop info, and return
   * field mappings whose start/end **read** properties match the resolved
   * targets (round-trip symmetry — R-D). With no field config, mappings pass
   * through unchanged and no targets are set (writes pass start/end through).
   */
  private applyDateFieldMapping(
    mappings: FieldMappings,
    fieldConfig: FieldConfig | null,
  ): FieldMappings {
    if (!fieldConfig) {
      this.dateMappingInfo = {
        startInvalid: false,
        endInvalid: false,
        startReadProp: null,
        endReadProp: null,
      };
      // No TaskNotes field config (TaskNotes absent): no write targets, and the
      // read falls back to the legacy note.start/note.due when unset, preserving
      // the pre-TaskNotes Bases behavior.
      return {
        ...mappings,
        startProperty: mappings.startProperty || 'note.start',
        endProperty: mappings.endProperty || 'note.due',
      };
    }

    const startRes = resolveDateMapping(
      bareProperty(mappings.startProperty),
      'start',
      fieldConfig,
    );
    const endRes = resolveDateMapping(
      bareProperty(mappings.endProperty),
      'end',
      fieldConfig,
    );

    this.startWriteTarget = startRes.writeTarget;
    this.endWriteTarget = endRes.writeTarget;
    this.dateMappingInfo = {
      startInvalid: startRes.invalid,
      endInvalid: endRes.invalid,
      startReadProp: startRes.readProp,
      endReadProp: endRes.readProp,
    };

    return {
      ...mappings,
      startProperty: toNoteProperty(startRes.readProp),
      endProperty: toNoteProperty(endRes.readProp),
    };
  }

  /**
   * The resolved date-mapping validity/read-prop info for the active source.
   * Surfaces (register/view) read this to render an invalid-mapping notice.
   * All-`false`/`null` before {@link init} or when there is no field config.
   */
  public getDateMappingInfo(): DateMappingInfo {
    return (
      this.dateMappingInfo ?? {
        startInvalid: false,
        endInvalid: false,
        startReadProp: null,
        endReadProp: null,
      }
    );
  }

  /**
   * Subscribe to a source's change events when it supports subscription (only
   * the TaskNotes source does). On each event, recompute and notify (subject to
   * the idempotent backstop).
   */
  private subscribeToSource(source: DataSource): void {
    const subscribe = (source as { subscribe?: unknown }).subscribe;
    if (typeof subscribe !== 'function') {
      return;
    }
    // TaskNotesSource/CompositeSource invoke the handler as (eventName, payload);
    // the structural signature is typed as `() => void`, so the extra args still
    // flow at runtime and we read the payload's correlationId for echo control.
    this.sourceUnsubscribe = (
      subscribe as (handler: (eventName?: string, payload?: unknown) => void) => () => void
    ).call(source, (_eventName?: string, payload?: unknown) => {
      const correlationId = extractCorrelationId(payload);
      if (correlationId && this.inFlightCorrelations.has(correlationId)) {
        // Self-write echo: drop the correlationId (removal-on-first-match) and
        // suppress the recompute entirely (U8 guard 1). A genuinely external
        // edit arriving during our in-flight window carries a different/no
        // correlationId and falls through to recompute — suppression keys on
        // correlationId, never on `source === self`.
        this.clearInFlight(correlationId);
        return;
      }
      // Fire-and-forget recompute; the idempotent backstop suppresses
      // notification when nothing actually changed (covers a late self-event
      // whose correlationId TTL already expired).
      void this.recompute({ forceNotify: false });
    });
  }

  /** Dispose the active source subscription, if any. */
  private teardownSubscription(): void {
    if (this.sourceUnsubscribe) {
      try {
        this.sourceUnsubscribe();
      } catch {
        // Best-effort teardown.
      }
      this.sourceUnsubscribe = null;
    }
  }

  /** Compute a snapshot on demand if one does not exist yet. */
  private async ensureSnapshot(): Promise<Snapshot> {
    if (!this.snapshot) {
      await this.recompute({ forceNotify: false });
    }
    // recompute always assigns this.snapshot (even for an empty source).
    return this.snapshot as Snapshot;
  }

  /**
   * Recompute the coherent source-graph snapshot from the active source:
   * `getTasks()` → `expandInstances(...)`, plus `getDependencies(path)` per task
   * → `SourceLink[]`. Notifies listeners when the new snapshot differs from the
   * previous (the idempotent backstop), or when `forceNotify` is set (selection
   * changed the capability surface even if data is value-equal).
   */
  private async recompute(opts: { forceNotify: boolean }): Promise<void> {
    if (this.disposed) {
      return;
    }

    // Latest-wins guard: capture a token before the async build; if a newer
    // recompute starts while we await, discard our (now-stale) result.
    const seq = ++this.recomputeSeq;
    const source = this.activeSource;
    const next: Snapshot = source
      ? await this.buildSnapshot(source)
      : emptySnapshot();

    if (this.disposed || seq !== this.recomputeSeq) {
      return;
    }

    const changed = !this.snapshot || !snapshotsEqual(this.snapshot, next);
    this.snapshot = next;

    if (opts.forceNotify || changed) {
      this.notify();
    }
  }

  /** Build a fresh snapshot by querying the source for tasks and dependencies. */
  private async buildSnapshot(source: DataSource): Promise<Snapshot> {
    const rawTasks = await source.getTasks();
    // Companion stage (bases-scoped + TaskNotes): resolve the displayed set
    // (Inherit/Show-all), override parents from `projects`, and flag
    // isFetched/alsoTopLevel. Standalone (no accessor) passes tasks through
    // unchanged (parents from the Base's parentProperty).
    const displayedTasks = this.companionAccessor
      ? await resolveCompanionTree(rawTasks, this.companionConfig(), this.companionAccessor)
      : rawTasks;
    const tasks = this.resolveAndFilter(displayedTasks);
    const expansion = expandInstances(tasks);

    const sourceLinks: SourceLink[] = [];
    for (const t of tasks) {
      const deps = await source.getDependencies(t.path);
      for (const dep of deps) {
        sourceLinks.push({
          // The dependency edge belongs to `t` (an entry in t's blockedBy):
          // predecessor → this task.
          sourcePath: dep.predecessorPath,
          targetPath: t.path,
          type: RELTYPE_TO_SVAR[dep.reltype],
          reltype: dep.reltype,
          gap: dep.gap,
        });
      }
    }

    return { expansion, sourceLinks };
  }

  /**
   * Resolve each raw task's display dates via the date policy and drop tasks
   * hidden by the visibility toggles — **before** expansion, so a hidden
   * multi-parent task produces no instances at all. Returns resolved tasks
   * (non-null dates + `dateStatus`) ready for {@link expandInstances}.
   *
   * Note: hiding an *interior* parent reparents its visible children to the
   * root (expansion drops parent paths not in the visible set) — accepted
   * behaviour, not a silent surprise (see plan U2).
   */
  private resolveAndFilter(rawTasks: readonly ExpandableTask[]): ExpandableTask[] {
    const today = this.now();
    const { defaultDuration, showUndatedTasks, showPartialDateTasks } = this.policyConfigProvider();

    const resolved: ExpandableTask[] = [];
    for (const task of rawTasks) {
      const { start, end, dateStatus } = applyDatePolicy(
        { start: task.start, end: task.end },
        { defaultDuration, today },
      );
      if (!showUndatedTasks && dateStatus === 'placeholder') continue;
      if (!showPartialDateTasks && PARTIAL_STATUSES.has(dateStatus)) continue;
      resolved.push({ ...task, start, end, dateStatus });
    }
    return resolved;
  }

  /** Notify all registered listeners of a snapshot change. */
  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // A throwing listener must not break the notification fan-out.
      }
    }
  }
}

/** An empty snapshot (no active source / empty source). */
function emptySnapshot(): Snapshot {
  return { expansion: expandInstances([]), sourceLinks: [] };
}

/**
 * Build a {@link CompanionAccessor} from a source that exposes the TaskNotes
 * relationship reads (`getSubtasks`/`getParents`), or `null` when it doesn't
 * (standalone / non-TaskNotes enrichment). Duck-typed because the enrichment is
 * declared as the capability-typed {@link DataSource}, which doesn't surface the
 * relationship reads.
 */
function toCompanionAccessor(source: DataSource | null): CompanionAccessor | null {
  const candidate = source as unknown as Partial<CompanionAccessor> | null;
  if (
    candidate &&
    typeof candidate.getSubtasks === 'function' &&
    typeof candidate.getParents === 'function'
  ) {
    const accessor = candidate as CompanionAccessor;
    return {
      getSubtasks: (path) => accessor.getSubtasks(path),
      getParents: (path) => accessor.getParents(path),
    };
  }
  return null;
}

/**
 * Extract the `correlationId` a TaskNotes change-event payload carries for a
 * write the controller originated. TaskNotes (4.11.0) surfaces it on the
 * normalized event; defensively we also accept a nested `context.correlationId`.
 * Returns `undefined` for external edits (no recognizable correlationId).
 */
function extractCorrelationId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }
  const p = payload as {
    correlationId?: unknown;
    context?: { correlationId?: unknown } | null;
  };
  if (typeof p.correlationId === 'string') {
    return p.correlationId;
  }
  if (p.context && typeof p.context.correlationId === 'string') {
    return p.context.correlationId;
  }
  return undefined;
}

/** Monotonic fallback counter for {@link defaultCorrelationId}. */
let correlationCounter = 0;

/**
 * Default `correlationId` factory: `crypto.randomUUID()` when available
 * (Electron/modern runtimes), else a timestamp+counter fallback. Injected in
 * tests for determinism.
 */
function defaultCorrelationId(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  correlationCounter += 1;
  return `og-${Date.now()}-${correlationCounter}`;
}

/**
 * Value-equality between two snapshots — the idempotent backstop's comparator.
 *
 * Two snapshots are equal when their render instances (id, sourcePath, text,
 * dates, parent, virtual/collapsed flags, progress) and their source-level
 * links are element-wise equal in order. Expansion is deterministic (stable
 * sort), so order is a reliable basis for comparison.
 */
function snapshotsEqual(a: Snapshot, b: Snapshot): boolean {
  return (
    instancesEqual(a.expansion.instances, b.expansion.instances) &&
    sourceLinksEqual(a.sourceLinks, b.sourceLinks)
  );
}

/** Element-wise value equality over render instances. */
function instancesEqual(
  a: readonly RenderInstance[],
  b: readonly RenderInstance[],
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (!x || !y) {
      return false;
    }
    if (
      x.id !== y.id ||
      x.sourcePath !== y.sourcePath ||
      x.text !== y.text ||
      x.progress !== y.progress ||
      x.parent !== y.parent ||
      x.isVirtual !== y.isVirtual ||
      x.isCollapsed !== y.isCollapsed ||
      x.dateStatus !== y.dateStatus ||
      x.status !== y.status ||
      !datesEqual(x.start, y.start) ||
      !datesEqual(x.end, y.end)
    ) {
      return false;
    }
  }
  return true;
}

/** Element-wise value equality over source-level links. */
function sourceLinksEqual(a: readonly SourceLink[], b: readonly SourceLink[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (!x || !y) {
      return false;
    }
    if (
      x.sourcePath !== y.sourcePath ||
      x.targetPath !== y.targetPath ||
      x.type !== y.type ||
      x.reltype !== y.reltype ||
      x.gap !== y.gap
    ) {
      return false;
    }
  }
  return true;
}

/** Null-safe `Date` value equality (compares epoch millis). */
function datesEqual(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.getTime() === b.getTime();
}
