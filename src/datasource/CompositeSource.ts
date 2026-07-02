/**
 * CompositeSource — a Bases-scoped task set enriched by TaskNotes.
 *
 * The Gantt is hosted as a Bases custom view, so the **Obsidian Base** defines
 * WHICH tasks are in scope (its filter/query) and the configured field mappings
 * define their dates/text/parents — that is the `base` source (a read-only
 * {@link import('./BasesSource').BasesSource}). **TaskNotes**, when installed, is
 * layered on as an *enrichment* source addressed by note path: it supplies
 * dependency edges now and the write path later (U8), without owning the task
 * set.
 *
 * This composition is what lets a Bases view behave like a Bases view — the Base
 * filter and the start/due/parent property mappings are honored, and multi-parent
 * duplication resolves from the parent property — while still drawing TaskNotes
 * dependency arrows and, in U8, persisting edits through TaskNotes. When TaskNotes
 * is absent the `enrichment` is `null` and the composite degrades cleanly to the
 * read-only base (no dependencies, no writes).
 *
 * Capabilities (and, in U8, the mutation methods) are delegated to the enrichment
 * source so the {@link DataSource} invariant — `capabilities.write === true`
 * implies `mutate` is present — is preserved: both come from the same object.
 *
 * Why a composite rather than a TaskNotes-first source: TaskNotes' confirmed JS
 * API (2026-06-16) lists *all* tasks (`api.tasks.list()`), independent of any
 * Base, and exposes no parent/project edge resolvable to note paths — so using it
 * as the set source bypasses the Base's filter and yields no multi-parenting.
 * Bases owns the set + parents; TaskNotes owns dependencies + writes.
 *
 * @module datasource/CompositeSource
 */

import type {
  DataSource,
  DataSourceCapabilities,
  DependencyRelType,
  FieldConfig,
  MutationContext,
  PriorityColor,
  SourceDependency,
  SourceTask,
  StatusColor,
  TaskPatch,
} from './types';

/** Structural slice for the optional event-subscription hook (TaskNotes has it). */
interface Subscribable {
  subscribe(handler: () => void): () => void;
}

/**
 * Composes a base task source (Bases) with an optional enrichment source
 * (TaskNotes). Reads the task set from `base`; reads dependencies, capabilities,
 * and change events from `enrichment` when present.
 */
export class CompositeSource implements DataSource {
  /**
   * @param base - Authoritative source for the task set, dates, text, and
   *   parents (the Bases query result + field mappings). Always present.
   * @param enrichment - Optional path-keyed enrichment (TaskNotes): dependencies,
   *   write capability, and change events. `null` when TaskNotes is unavailable.
   */
  /**
   * @param base - Authoritative source for the task set, dates, text, and
   *   parents (the Bases query result + field mappings). Always present.
   * @param enrichment - Optional path-keyed enrichment (TaskNotes): dependencies,
   *   write capability, and change events. `null` when TaskNotes is unavailable.
   * @param options.writable - When `false`, the composite is forced read-only
   *   even if the enrichment is write-capable. The controller sets this when it
   *   cannot resolve safe date write targets (TaskNotes field config
   *   unavailable), so a write can't land in a different field than the one read
   *   (R-F / #70). Enrichment is still used for dependencies. Defaults to `true`.
   */
  constructor(
    private readonly base: DataSource,
    private readonly enrichment: DataSource | null,
    private readonly options: { writable?: boolean } = {},
  ) {}

  /**
   * Capabilities come from the enrichment source (TaskNotes owns writes), gated
   * by `options.writable`. With no enrichment, or when writes are force-disabled,
   * the composite is read-only — mirroring a bare Bases source.
   */
  public get capabilities(): DataSourceCapabilities {
    const enrichmentWritable = this.enrichment?.capabilities.write ?? false;
    return { write: this.options.writable !== false && enrichmentWritable };
  }

  /** The task set is always the Base's (filtered, mapped) result. */
  public getTasks(): Promise<SourceTask[]> {
    return this.base.getTasks();
  }

  /**
   * Dependency edges come from the enrichment source (TaskNotes `blockedBy`),
   * keyed by note path. With no enrichment there are no edges (Bases has no
   * dependency model), so this yields `[]`.
   */
  public getDependencies(path: string): Promise<SourceDependency[]> {
    return this.enrichment
      ? this.enrichment.getDependencies(path)
      : Promise.resolve([]);
  }

  /**
   * Status→color palette comes from the enrichment (TaskNotes). With no
   * enrichment, or an enrichment that exposes no palette, this yields `[]` —
   * the view then applies no status colors.
   */
  public getStatusColors(): Promise<StatusColor[]> {
    return this.enrichment?.getStatusColors?.() ?? Promise.resolve([]);
  }

  /**
   * Priority→color palette comes from the enrichment (TaskNotes). With no
   * enrichment, or an enrichment that exposes no palette, this yields `[]` —
   * the view then applies no priority colors. Mirrors {@link getStatusColors}.
   */
  public getPriorityColors(): Promise<PriorityColor[]> {
    return this.enrichment?.getPriorityColors?.() ?? Promise.resolve([]);
  }

  /**
   * The TaskNotes field-config (scheduled/due property names + custom date
   * fields) comes from the enrichment. Yields `null` when there is no
   * enrichment or it exposes none — the view then has no field mapping to
   * resolve and stays on Bases defaults / read-only.
   */
  public getFieldConfig(): Promise<FieldConfig | null> {
    return this.enrichment?.getFieldConfig?.() ?? Promise.resolve(null);
  }

  /**
   * Subscribe to enrichment change events (TaskNotes), so external task edits
   * refresh the chart. Base (filter/query) changes are delivered separately by
   * the view's data-update → remount path, not here. Returns a no-op disposer
   * when the enrichment is absent or exposes no `subscribe`.
   */
  public subscribe(handler: () => void): () => void {
    const enr = this.enrichment as (Partial<Subscribable> | null);
    if (enr && typeof enr.subscribe === 'function') {
      return enr.subscribe(handler);
    }
    return () => {};
  }

  /**
   * Persist a field patch by delegating to the enrichment (TaskNotes), addressed
   * by the note `path` that Bases and TaskNotes share. `capabilities.write`
   * tracks the enrichment, so a caller that respects the capability gate only
   * reaches this when the enrichment is writable. Throws if there is no writable
   * enrichment (read-only composite) — a defensive backstop for the contract.
   *
   * @param path - The shared note path (Bases entry === TaskNotes task).
   * @param patch - The fields to change.
   * @param context - Echo-suppression context (forwarded to TaskNotes).
   */
  public mutate(
    path: string,
    patch: TaskPatch,
    context?: MutationContext,
  ): Promise<void> {
    if (!this.capabilities.write || !this.enrichment?.mutate) {
      return Promise.reject(
        new Error('CompositeSource is read-only: no writable/resolvable enrichment source'),
      );
    }
    return this.enrichment.mutate(path, patch, context);
  }

  /**
   * Delete a task (and its note) by delegating to the enrichment (TaskNotes).
   * Throws if there is no enrichment that supports deletion.
   *
   * @param path - The shared note path to delete.
   * @param context - Echo-suppression context (forwarded to TaskNotes).
   */
  public deleteTask(path: string, context?: MutationContext): Promise<void> {
    if (!this.capabilities.write || !this.enrichment?.deleteTask) {
      return Promise.reject(
        new Error('CompositeSource is read-only: no writable/resolvable enrichment source'),
      );
    }
    return this.enrichment.deleteTask(path, context);
  }

  /**
   * Add a dependency edge by delegating to the enrichment (TaskNotes), addressed
   * by the shared note path. Throws if there is no writable enrichment.
   */
  public addDependency(
    dependentPath: string,
    predecessorPath: string,
    reltype: DependencyRelType,
    context?: MutationContext,
  ): Promise<void> {
    if (!this.capabilities.write || !this.enrichment?.addDependency) {
      return Promise.reject(
        new Error('CompositeSource is read-only: no writable/resolvable enrichment source'),
      );
    }
    return this.enrichment.addDependency(dependentPath, predecessorPath, reltype, context);
  }

  /**
   * Remove a dependency edge by delegating to the enrichment (TaskNotes). Throws
   * if there is no writable enrichment.
   */
  public removeDependency(
    dependentPath: string,
    predecessorPath: string,
    context?: MutationContext,
  ): Promise<void> {
    if (!this.capabilities.write || !this.enrichment?.removeDependency) {
      return Promise.reject(
        new Error('CompositeSource is read-only: no writable/resolvable enrichment source'),
      );
    }
    return this.enrichment.removeDependency(dependentPath, predecessorPath, context);
  }
}
