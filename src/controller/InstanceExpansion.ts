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

import type { SourceTask, DependencyRelType } from '../datasource/types';
import type { DateStatus } from './datePolicy';
import { isoDurationToDays } from './dateGap';

/**
 * A source task whose display dates have already been resolved by the date
 * policy (start/end non-null, `dateStatus` set). The controller maps raw
 * `SourceTask`s through {@link import('./datePolicy').applyDatePolicy} before
 * expansion, so the expander only ever sees resolved tasks.
 */
export type ExpandableTask = SourceTask & {
  dateStatus?: DateStatus;
  /**
   * Blocked stretches inside a working-time-stretched span (whole local days),
   * carried to the bar template's 15%-ghost rendering. Absent = solid bar.
   */
  ghostRuns?: ReadonlyArray<{ startDate: string; days: number }>;
  /** True when the stretch scan hit its ceiling and fell back to calendar days. */
  stretchFlagged?: boolean;
  /**
   * The task's effective Estimate meaning when it OVERRIDES the view default
   * (differs from it); undefined when the task follows the default. Drives the
   * on-bar override tick and its tooltip (R11).
   */
  interpretationOverridden?: 'working-days' | 'calendar-days';
  /**
   * When true, the expander emits an extra **root** instance in addition to the
   * per-parent nested instances — a matched, also-nested task under hide-off, so
   * it appears both at top level and under its parent (origin AE1). Produced by
   * {@link import('../datasource/companionResolve').resolveCompanionTree}.
   */
  alsoTopLevel?: boolean;
  /**
   * When true, this source task is a Show-all fetched descendant (outside the
   * matched set). Carried onto every {@link RenderInstance} for the view's
   * "context" cue.
   */
  isFetched?: boolean;
};

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
  /** Raw task status string (drives status coloring); `null` when unset. */
  status: string | null;
  /** Raw task priority string (drives priority coloring); `null` when unset. */
  priority: string | null;
  /**
   * `true` when the source task is a Show-all fetched descendant (outside the
   * matched set) — drives the view's "context" cue (origin R18). `false` for
   * matched rows and for tasks that bypassed companion resolution.
   */
  isFetched: boolean;
  /**
   * `true` when this instance belongs to an **also-top-level DUPLICATE placement**
   * — the extra root copy of an already-nested task (origin AE1) plus everything
   * rendered under that root copy. The view hides these via SVAR `filter-tasks`
   * when "Hide top-level subtasks" is on, so the toggle is a pure DISPLAY filter
   * over a STABLE instance set (it never changes which instances exist) — the
   * #161 fix that stops a config toggle from churning the chart. `false` for the
   * real nested copies and for genuine roots (tasks with no visible parent).
   */
  isTopLevelPlacement: boolean;
  /** Blocked stretches inside a working-time-stretched span (ghost rendering). */
  ghostRuns?: ReadonlyArray<{ startDate: string; days: number }>;
  /** True when the stretch scan hit its ceiling and fell back to calendar days. */
  stretchFlagged?: boolean;
  /** Effective Estimate meaning when it overrides the view default; drives the tick (R11). */
  interpretationOverridden?: 'working-days' | 'calendar-days';
}

/** A source-level dependency link between two note paths. */
export interface SourceLink {
  /** Path of the dependency source (predecessor / "from"). */
  sourcePath: string;
  /** Path of the dependency target (dependent / "to"). */
  targetPath: string;
  /** SVAR link type (e.g. `e2s`, `s2s`, `e2e`, `s2e`). */
  type: string;
  /** Relationship type (RFC 9253), for display alongside the SVAR `type`. */
  reltype: DependencyRelType;
  /** ISO-8601 duration gap (e.g. `"P1D"`), or `null` when none. */
  gap: string | null;
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
  /** Relationship type (RFC 9253), carried through for display. */
  reltype: DependencyRelType;
  /** ISO-8601 duration gap, carried through for display, or `null`. */
  gap: string | null;
  /**
   * SVAR's native numeric link `lag` (days), derived from {@link gap}. Omitted
   * when there is no gap or it isn't convertible to an exact day count.
   * Best-effort visual offset; the authoritative gap surface is the tooltip.
   */
  lag?: number;
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
      const sources = this.resolveEndpointInstances(link.sourcePath, mode);
      const targets = this.resolveEndpointInstances(link.targetPath, mode);

      // Drop links whose endpoint path has no instances.
      if (sources.length === 0 || targets.length === 0) continue;

      result.push(...renderLinkProduct(link, sources, targets));
    }

    return result;
  }

  /**
   * Resolve one endpoint path to the instance ids the link should attach to:
   * just the primary in `'primary'` mode, or every instance in `'all'` mode.
   */
  private resolveEndpointInstances(path: string, mode: LinkRewriteMode): string[] {
    return mode === 'primary'
      ? singletonOrEmpty(this.getPrimaryInstanceId(path))
      : this.getInstanceIds(path);
  }
}

/**
 * Build the cartesian product of `sources × targets` for one source link,
 * carrying type/reltype/gap through and deriving SVAR's numeric `lag` from the
 * gap (omitted when not convertible to an exact day count).
 */
function renderLinkProduct(
  link: SourceLink,
  sources: readonly string[],
  targets: readonly string[],
): RenderLink[] {
  const lag = isoDurationToDays(link.gap);
  const rendered: RenderLink[] = [];
  for (const src of sources) {
    for (const tgt of targets) {
      const renderLink: RenderLink = {
        id: makeLinkId(src, tgt, link.type, link.gap),
        source: src,
        target: tgt,
        type: link.type,
        reltype: link.reltype,
        gap: link.gap,
      };
      if (lag !== null) renderLink.lag = lag;
      rendered.push(renderLink);
    }
  }
  return rendered;
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

  // Preserve the INPUT order so the Obsidian Base's toolbar sort drives row
  // order. The Base hands `data.data` already sorted by the toolbar sort, and
  // BasesSource → companionResolve → resolveAndFilter all keep that order, so
  // the desired order is already encoded in `tasks`. The previous path-only sort
  // discarded it (the "Base sort makes no difference" bug). Determinism now
  // comes from input stability (Bases keeps `data.data` stable for the same
  // query + sort) rather than from an input-order-independent path sort; row
  // order, primary selection ([0]), link ids, and cycle-break edge choice all
  // follow this stable input order. `compareStr` is retained only as a final
  // tie-break against a degenerate duplicate-path input (positions are unique,
  // so it is normally dormant).
  const orderIndex = new Map<string, number>();
  tasks.forEach((t, i) => {
    if (!orderIndex.has(t.path)) orderIndex.set(t.path, i);
  });
  const sorted = [...tasks].sort((a, b) => {
    const ia = orderIndex.get(a.path) ?? 0;
    const ib = orderIndex.get(b.path) ?? 0;
    return ia === ib ? compareStr(a.path, b.path) : ia - ib;
  });

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

  // Build a task's instances from its cycle-free parents: one per parent instance,
  // plus an extra root for an also-top-level matched task. Falls back to a single
  // root when every parent edge was cycle-broken, so the task never vanishes.
  const buildParentedInstances = (
    task: ExpandableTask,
    parents: readonly string[],
    isVirtual: boolean,
  ): RenderInstance[] => {
    const built: RenderInstance[] = [];
    for (const parentPath of parents) {
      // Partial ancestry: only materialize children for parent instances that exist.
      for (const parentInstance of computeInstances(parentPath)) {
        const id = `${task.path}${PARENT_DELIMITER}${parentInstance.id}`;
        // Propagate the placement flag DOWN: a child built under a top-level
        // duplicate placement is itself part of that (hideable) duplicate subtree.
        built.push(makeInstance(task, id, parentInstance.id, isVirtual, parentInstance.isTopLevelPlacement));
      }
    }
    // Matched, also-nested task: ALSO render an extra ROOT copy — the also-top-level
    // DUPLICATE placement. Always emitted (hide-on/off no longer changes the set);
    // flagged so the view hides it via filter-tasks under "Hide top-level subtasks".
    if (task.alsoTopLevel && built.length > 0) {
      built.push(makeInstance(task, task.path, undefined, isVirtual, true));
    }
    return built.length > 0 ? built : [makeInstance(task, task.path, undefined, isVirtual)];
  };

  const computeInstances = (path: string): RenderInstance[] => {
    const memo = instancesByPath.get(path);
    if (memo) return memo;

    const task = byPath.get(path);
    if (!task) return [];

    const parents = effectiveParents.get(path) ?? [];
    const isVirtual = parents.length > 1;

    // One root instance with no visible parents (also the cycle safety net), or
    // one instance per parent ancestry (see buildParentedInstances).
    let instances =
      parents.length === 0
        ? [makeInstance(task, task.path, undefined, isVirtual)]
        : buildParentedInstances(task, parents, isVirtual);

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
  isTopLevelPlacement = false,
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
    status: task.status,
    priority: task.priority,
    isFetched: task.isFetched ?? false,
    isTopLevelPlacement,
    ghostRuns: task.ghostRuns,
    stretchFlagged: task.stretchFlagged,
    interpretationOverridden: task.interpretationOverridden,
  };
}

/**
 * A deterministic, collision-resistant link id. Includes `gap` so a gap-only
 * change (same endpoints + type) yields a new id — `planLinkSync` is delete/add
 * on id with no in-place update, so without this a gap edit would never
 * re-issue the SVAR link (its `lag`). See plan 004 KTD6.
 */
function makeLinkId(
  source: string,
  target: string,
  type: string,
  gap: string | null,
): string {
  return `${source}->${target}:${type}:${gap ?? ''}`;
}

/** `[value]` when defined, else `[]` — for uniform cartesian iteration. */
function singletonOrEmpty(value: string | undefined): string[] {
  return value === undefined ? [] : [value];
}

/** Stable string comparison (locale-independent). */
function compareStr(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}
