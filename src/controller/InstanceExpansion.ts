/**
 * Source → render-instance expansion and a bidirectional instance↔source
 * identity map (U5).
 *
 * A single source task with multiple *visible* parents must render once under
 * each parent, because SVAR's `parent` field is single-valued — duplication is
 * the only mechanism. This module is a **pure, dependency-free transform**: it
 * takes `SourceTask[]` and yields SVAR-shaped {@link RenderInstance} rows plus
 * the maps the controller needs to translate instance ids ⇄ source paths.
 *
 * Identity is tracked **explicitly** through maps built during expansion — never
 * by parsing instance ids. The `#parent-` delimiter embedded in ids is a
 * human-readable convenience only; a note path containing `#` still round-trips
 * because identity is resolved via `sourcePath`, not by splitting the id string.
 *
 * @module controller/InstanceExpansion
 */

import type { SourceTask } from '../datasource/types';
import type { DateStatus } from './datePolicy';

/**
 * A source task whose display dates have already been resolved by the date
 * policy (start/end non-null, `dateStatus` set). The controller maps raw
 * `SourceTask`s through {@link import('./datePolicy').applyDatePolicy} before
 * expansion, so the expander only ever sees resolved tasks.
 */
export type ExpandableTask = SourceTask & { dateStatus?: DateStatus };

/**
 * A single SVAR render row produced from a source task. One source task yields
 * one instance per distinct root-to-node ancestry path (subject to the
 * fan-out guard). All instances of a source task share `sourcePath`.
 */
export interface RenderInstance {
  /**
   * Unique render-row id. Roots use the bare `sourcePath`; descendants embed
   * their parent instance id recursively
   * (`${sourcePath}#parent-${parentInstanceId}`) so the id chains the full
   * ancestry and is unique per ancestry path. Do **not** parse this to recover
   * identity — use {@link sourcePath} and the maps instead.
   */
  id: string;
  /** The source task path this instance renders (shared by all siblings). */
  sourcePath: string;
  /** Display text (task name). */
  text: string;
  /** Start date, or `null` when unscheduled. */
  start: Date | null;
  /** End/due date, or `null` when unscheduled. */
  end: Date | null;
  /** Progress percentage 0–100, or `null` when unknown. */
  progress: number | null;
  /**
   * The parent's *instance id* under the same ancestry (not the bare parent
   * path). `undefined` for root instances.
   */
  parent?: string;
  /**
   * `true` when the source task has more than one visible parent (so it appears
   * in multiple places); else `false`. Mirrors the plan's `custom.isVirtual`.
   */
  isVirtual: boolean;
  /**
   * `true` when this task tripped the fan-out guard and was collapsed to a
   * single primary instance with the rest of its ancestries suppressed. The
   * view shows an indicator so the user knows instances were collapsed.
   */
  isCollapsed: boolean;
  /**
   * How the resolved `start`/`end` were derived by the date policy. The view
   * keys its bar-level indicator off this (placeholder/inferred/swapped get a
   * distinct treatment from `complete`). Defaults to `complete` for tasks that
   * bypassed the policy (e.g. the empty-source path).
   */
  dateStatus: DateStatus;
}

/** A source-level dependency link between two note paths. */
export interface SourceLink {
  /** Path of the dependency source (predecessor / "from"). */
  sourcePath: string;
  /** Path of the dependency target (dependent / "to"). */
  targetPath: string;
  /** SVAR link type (e.g. `e2s`, `s2s`, `e2e`, `s2e`). */
  type: string;
}

/** A rewritten link whose endpoints are concrete render-instance ids. */
export interface RenderLink {
  /** Stable, deterministic link id. */
  id: string;
  /** Render-instance id of the source endpoint. */
  source: string;
  /** Render-instance id of the target endpoint. */
  target: string;
  /** SVAR link type, carried through unchanged. */
  type: string;
}

/** Endpoint cardinality for {@link InstanceExpansion.rewriteLinks}. */
export type LinkRewriteMode = 'primary' | 'all';

/** Options controlling expansion behaviour. */
export interface ExpansionOptions {
  /**
   * Maximum number of instances a single source task may produce before the
   * fan-out guard trips and collapses it to a single primary instance.
   * Defaults to {@link DEFAULT_FANOUT_CAP}.
   */
  fanOutCap?: number;
}

/** Default per-source-task instance cap before the fan-out guard collapses. */
export const DEFAULT_FANOUT_CAP = 50;

/** The delimiter embedded in descendant instance ids. */
const PARENT_DELIMITER = '#parent-';

/**
 * The result of expanding a set of source tasks: the render instances plus the
 * bidirectional identity maps and collapse bookkeeping. Maps are built
 * explicitly during expansion so identity never depends on parsing ids.
 */
export class ExpansionResult {
  /** All render instances, in deterministic (stable-sorted) order. */
  readonly instances: readonly RenderInstance[];

  /** instanceId → sourcePath. */
  private readonly instanceToSource: Map<string, string>;

  /** sourcePath → instanceId[] (in deterministic order; primary is `[0]`). */
  private readonly sourceToInstances: Map<string, string[]>;

  /** Source paths whose expansion tripped the fan-out guard. */
  readonly collapsedSourcePaths: ReadonlySet<string>;

  constructor(
    instances: RenderInstance[],
    instanceToSource: Map<string, string>,
    sourceToInstances: Map<string, string[]>,
    collapsedSourcePaths: Set<string>,
  ) {
    this.instances = instances;
    this.instanceToSource = instanceToSource;
    this.sourceToInstances = sourceToInstances;
    this.collapsedSourcePaths = collapsedSourcePaths;
  }

  /** Resolve an instance id to its source path, or `undefined` if unknown. */
  getSourcePath(instanceId: string): string | undefined {
    return this.instanceToSource.get(instanceId);
  }

  /**
   * All instance ids for a source path (in deterministic order), or an empty
   * array if the path produced no instances.
   */
  getInstanceIds(sourcePath: string): string[] {
    return this.sourceToInstances.get(sourcePath) ?? [];
  }

  /**
   * The primary (first, stable-sorted) instance id for a source path, or
   * `undefined` if the path produced no instances.
   */
  getPrimaryInstanceId(sourcePath: string): string | undefined {
    return this.sourceToInstances.get(sourcePath)?.[0];
  }

  /** Whether a source path tripped the fan-out guard. */
  wasCollapsed(sourcePath: string): boolean {
    return this.collapsedSourcePaths.has(sourcePath);
  }

  /**
   * Rewrite source-level dependency links (path → path) into SVAR links whose
   * endpoints are concrete instance ids.
   *
   * - `'primary'`: one link per source link, endpoints = each side's primary
   *   instance id.
   * - `'all'`: the cartesian product over both endpoints' instances.
   *
   * Links whose source **or** target path produced no instances are dropped
   * (a link to a non-existent row id silently fails to render in SVAR). Link
   * ids are stable and deterministic.
   *
   * @param sourceLinks - source-level links to rewrite
   * @param mode - endpoint cardinality
   * @returns rewritten links with concrete instance-id endpoints
   */
  rewriteLinks(sourceLinks: readonly SourceLink[], mode: LinkRewriteMode): RenderLink[] {
    const result: RenderLink[] = [];

    for (const link of sourceLinks) {
      const sources =
        mode === 'primary'
          ? singletonOrEmpty(this.getPrimaryInstanceId(link.sourcePath))
          : this.getInstanceIds(link.sourcePath);
      const targets =
        mode === 'primary'
          ? singletonOrEmpty(this.getPrimaryInstanceId(link.targetPath))
          : this.getInstanceIds(link.targetPath);

      // Drop links whose endpoint path has no instances.
      if (sources.length === 0 || targets.length === 0) continue;

      for (const src of sources) {
        for (const tgt of targets) {
          result.push({
            id: makeLinkId(src, tgt, link.type),
            source: src,
            target: tgt,
            type: link.type,
          });
        }
      }
    }

    return result;
  }
}

/**
 * Pure source → render-instance expander.
 *
 * @param tasks - the source tasks; their `path`s form the **visible set**
 * @param options - expansion options (notably the fan-out cap)
 * @returns an {@link ExpansionResult} with instances, identity maps and
 *   collapse bookkeeping
 */
export function expandInstances(
  tasks: readonly ExpandableTask[],
  options: ExpansionOptions = {},
): ExpansionResult {
  const fanOutCap = options.fanOutCap ?? DEFAULT_FANOUT_CAP;

  // Stable, deterministic order so primaries and link ids are reproducible.
  const sorted = [...tasks].sort((a, b) => compareStr(a.path, b.path));

  const byPath = new Map<string, ExpandableTask>();
  for (const t of sorted) byPath.set(t.path, t);

  // visibleParents(task) = the subset of task.parents present in the visible set,
  // de-duplicated while preserving the (stable) declaration order.
  const visibleParentsOf = (task: SourceTask): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of task.parents) {
      if (byPath.has(p) && !seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    }
    return out;
  };

  // ---------------------------------------------------------------------------
  // Phase 1 — deterministic cycle breaking.
  //
  // A parent edge that would create a cycle is a back-edge; we drop it so the
  // remaining parent graph is a DAG. Cycle detection is a stable DFS over the
  // sorted task order, so which edge is dropped is reproducible regardless of
  // input order. `effectiveParents` holds the cycle-free parent set per path.
  // ---------------------------------------------------------------------------
  const effectiveParents = new Map<string, string[]>();
  const dfsState = new Map<string, 'visiting' | 'done'>();

  const breakCycles = (path: string): void => {
    if (dfsState.get(path) === 'done') return;
    dfsState.set(path, 'visiting');

    const task = byPath.get(path);
    const kept: string[] = [];
    for (const parentPath of task ? visibleParentsOf(task) : []) {
      // A parent currently on the DFS stack is a back-edge → drop it.
      if (dfsState.get(parentPath) === 'visiting') continue;
      breakCycles(parentPath);
      kept.push(parentPath);
    }
    effectiveParents.set(path, kept);
    dfsState.set(path, 'done');
  };

  for (const task of sorted) breakCycles(task.path);

  // ---------------------------------------------------------------------------
  // Phase 2 — pure memoized DAG expansion (the parent graph is now acyclic).
  // Because the graph is acyclic, instance sets are independent of traversal
  // order, so per-path memoization is sound and deterministic.
  // ---------------------------------------------------------------------------
  const instancesByPath = new Map<string, RenderInstance[]>();

  const computeInstances = (path: string): RenderInstance[] => {
    const memo = instancesByPath.get(path);
    if (memo) return memo;

    const task = byPath.get(path);
    if (!task) return [];

    const parents = effectiveParents.get(path) ?? [];
    const isVirtual = parents.length > 1;

    let instances: RenderInstance[];

    if (parents.length === 0) {
      // No visible (cycle-free) parents → a single root instance keyed by the
      // bare path. This is also the safety net that guarantees a task caught in
      // a cycle still materializes rather than being silently dropped.
      instances = [makeInstance(task, task.path, undefined, isVirtual)];
    } else {
      const built: RenderInstance[] = [];
      for (const parentPath of parents) {
        // Partial ancestry: only materialize children for parent instances that
        // actually exist — never dangle to a non-existent ancestry.
        for (const parentInstance of computeInstances(parentPath)) {
          const id = `${task.path}${PARENT_DELIMITER}${parentInstance.id}`;
          built.push(makeInstance(task, id, parentInstance.id, isVirtual));
        }
      }
      // A child whose every parent edge was cycle-broken (so `parents` is
      // non-empty but no ancestry materialized) still must not vanish: fall
      // back to a root instance.
      instances =
        built.length > 0
          ? built
          : [makeInstance(task, task.path, undefined, isVirtual)];
    }

    // Fan-out guard: collapse to a single primary instance (first by stable
    // ancestry order) rather than silently dropping the task.
    const primary = instances[0];
    if (primary && instances.length > fanOutCap && instances.length > 1) {
      instances = [{ ...primary, isCollapsed: true }];
    }

    instancesByPath.set(path, instances);
    return instances;
  };

  // Drive expansion over every visible task (order is stable via `sorted`).
  for (const task of sorted) {
    computeInstances(task.path);
  }

  // Assemble outputs in the deterministic task order, then by instance order.
  const allInstances: RenderInstance[] = [];
  const instanceToSource = new Map<string, string>();
  const sourceToInstances = new Map<string, string[]>();
  const collapsedSourcePaths = new Set<string>();

  for (const task of sorted) {
    const instances = instancesByPath.get(task.path) ?? [];
    const ids: string[] = [];
    for (const inst of instances) {
      allInstances.push(inst);
      instanceToSource.set(inst.id, inst.sourcePath);
      ids.push(inst.id);
      if (inst.isCollapsed) collapsedSourcePaths.add(inst.sourcePath);
    }
    sourceToInstances.set(task.path, ids);
  }

  return new ExpansionResult(
    allInstances,
    instanceToSource,
    sourceToInstances,
    collapsedSourcePaths,
  );
}

/** Build a render instance from a source task and resolved id/parent. */
function makeInstance(
  task: ExpandableTask,
  id: string,
  parent: string | undefined,
  isVirtual: boolean,
): RenderInstance {
  return {
    id,
    sourcePath: task.path,
    text: task.text,
    start: task.start,
    end: task.end,
    progress: task.progress,
    parent,
    isVirtual,
    isCollapsed: false,
    dateStatus: task.dateStatus ?? 'complete',
  };
}

/** A deterministic, collision-resistant link id. */
function makeLinkId(source: string, target: string, type: string): string {
  return `${source}->${target}:${type}`;
}

/** `[value]` when defined, else `[]` — for uniform cartesian iteration. */
function singletonOrEmpty(value: string | undefined): string[] {
  return value === undefined ? [] : [value];
}

/** Stable string comparison (locale-independent). */
function compareStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
