/**
 * Canonical task-graph types + invariants for the perf harness (U1, #161 perf
 * plan). A single in-memory graph is the shared source of truth: the vault
 * emitter (U2) serializes it to notes + a `.base`, and the source adapter (U3)
 * turns it into the in-memory `DataSource` + relationship index the controller
 * consumes — so both measurement layers measure the same shape (KD6).
 *
 * The shapes mirror the production downstream contracts so the adapters are thin:
 * a {@link GraphTask}'s `parents` are vault paths (like `SourceTask.parents`),
 * and a {@link GraphDependency} mirrors `SourceDependency` (`predecessorPath` /
 * `reltype` / `gap`). This module is pure and Obsidian-free so it runs under
 * jest's `node` env (U1 `Dependencies: none`).
 *
 * @module test/perf/generator/graph
 */
import type { DependencyRelType } from '../../../src/datasource/types';

export type { DependencyRelType };

/** A `blockedBy` dependency edge (mirrors `SourceDependency`). */
export interface GraphDependency {
  /** Path of the predecessor (blocking) task. */
  predecessorPath: string;
  /** Relationship type. */
  reltype: DependencyRelType;
  /** ISO-8601 duration gap (e.g. `"P2D"`), or `null`. */
  gap: string | null;
}

/**
 * A canonical task node. `path` is the stable identity (note path); `parents`
 * holds parent task paths (the `projects` edges that drive multi-parent
 * expansion); `matched` marks membership in the Base filter subset (the ~261).
 * Parent/dependency edges from a matched task may point at non-matched tasks —
 * the boundary crossing (R4) that Show-all expansion pulls back in.
 */
export interface GraphTask {
  /** Stable identity: the note path (e.g. `"Tasks/task-00001.md"`). */
  path: string;
  /** Display title (basename without extension). */
  title: string;
  /** Parent task paths (`projects` edges). */
  parents: string[];
  /** `blockedBy` dependency edges. */
  deps: GraphDependency[];
  /** Start date, or `null` when unscheduled. */
  start: Date | null;
  /** Due date, or `null` when unscheduled. */
  due: Date | null;
  /** Status string. */
  status: string;
  /** Whether this task is in the Base filter subset (the matched ~261). */
  matched: boolean;
}

/** A non-task filler note, written only to reach the total-note count (R2). */
export interface FillerNote {
  path: string;
  title: string;
}

/** Proportions of the date-coverage mix (need not sum to exactly 1; normalized). */
export interface DateMix {
  /** Both start and due present. */
  dated: number;
  /** Neither present (placeholder tasks). */
  undated: number;
  /** Start present, due absent. */
  startOnly: number;
  /** Due present, start absent. */
  endOnly: number;
}

/** One bucket of the multi-parent distribution: `count` tasks with `parents` parents. */
export interface MultiParentBucket {
  /** Number of parents each task in this bucket has (e.g. 2, 4, 7). */
  parents: number;
  /** How many tasks have exactly this many parents. */
  count: number;
}

/**
 * Generator parameters. The seed makes the output deterministic (no
 * `Date.now()`/`Math.random()`); every other field shapes the structural mix.
 */
export interface GenerateParams {
  /** PRNG seed — same seed + params → byte-identical graph. */
  seed: number;
  /** Total notes to emit (tasks + fillers), ~10k (R2). */
  totalNotes: number;
  /** Task notes, ~5k (R2). */
  taskCount: number;
  /** Matched (Base filter) subset size, ~261 (R4). */
  matchedCount: number;
  /** Multi-parent distribution buckets (R3 wide fan-out / R5). */
  multiParentDist: MultiParentBucket[];
  /** Maximum `projects` nesting depth to guarantee (≥5, R3). */
  maxDepth: number;
  /** Fraction of tasks (0–1) that get a `blockedBy` dependency edge (R3). */
  depDensity: number;
  /** Date-coverage proportions (R3). */
  dateMix: DateMix;
  /** Reciprocal `projects` cycles to inject (exercises the cycle-break path, R3). */
  cycleCount: number;
  /** Dangling parent/dep refs pointing at non-existent paths (R3). */
  orphanCount: number;
}

/** The canonical graph plus the params that produced it (echoed for the emitter). */
export interface TaskGraph {
  tasks: GraphTask[];
  fillers: FillerNote[];
  params: GenerateParams;
}

/** Aggregate statistics over a graph, for verification + test assertions. */
export interface GraphStats {
  taskCount: number;
  fillerCount: number;
  totalNotes: number;
  matchedCount: number;
  /** parents-count → number of tasks with exactly that many parents. */
  multiParentHistogram: Record<number, number>;
  maxDepth: number;
  /** Fraction (0–1) of matched tasks with ≥1 parent or dep outside the matched set. */
  boundaryCrossingFraction: number;
  dateMix: { dated: number; undated: number; startOnly: number; endOnly: number };
  dependencyCount: number;
}

/** All four dependency reltypes, in a stable order (for seeded selection). */
export const REL_TYPES: readonly DependencyRelType[] = [
  'FINISHTOSTART',
  'FINISHTOFINISH',
  'STARTTOSTART',
  'STARTTOFINISH',
];

/**
 * Longest `projects`-ancestor chain length over the graph (1 = a root with no
 * parents). Cycle-guarded so an injected reciprocal cycle can't make it diverge.
 */
export function maxChainDepth(tasks: readonly GraphTask[]): number {
  const byPath = new Map(tasks.map((t) => [t.path, t]));
  const memo = new Map<string, number>();

  const depthOf = (path: string, onStack: Set<string>): number => {
    const cached = memo.get(path);
    if (cached !== undefined) return cached;
    if (onStack.has(path)) return 0; // cycle guard
    const task = byPath.get(path);
    if (!task || task.parents.length === 0) {
      memo.set(path, 1);
      return 1;
    }
    onStack.add(path);
    let best = 0;
    for (const parent of task.parents) {
      if (!byPath.has(parent)) continue; // orphan ref doesn't extend depth
      best = Math.max(best, depthOf(parent, onStack));
    }
    onStack.delete(path);
    const depth = best + 1;
    memo.set(path, depth);
    return depth;
  };

  let max = 0;
  for (const t of tasks) max = Math.max(max, depthOf(t.path, new Set()));
  return max;
}

/** Compute aggregate {@link GraphStats} for verification + assertions. */
export function graphStats(graph: TaskGraph): GraphStats {
  const { tasks, fillers } = graph;
  const matchedPaths = new Set(tasks.filter((t) => t.matched).map((t) => t.path));

  const multiParentHistogram: Record<number, number> = {};
  let dated = 0;
  let undated = 0;
  let startOnly = 0;
  let endOnly = 0;
  let dependencyCount = 0;
  let boundaryCrossers = 0;

  for (const t of tasks) {
    const n = t.parents.length;
    multiParentHistogram[n] = (multiParentHistogram[n] ?? 0) + 1;

    if (t.start && t.due) dated += 1;
    else if (t.start) startOnly += 1;
    else if (t.due) endOnly += 1;
    else undated += 1;

    dependencyCount += t.deps.length;

    if (t.matched) {
      const crossesViaParent = t.parents.some((p) => !matchedPaths.has(p));
      const crossesViaDep = t.deps.some((d) => !matchedPaths.has(d.predecessorPath));
      if (crossesViaParent || crossesViaDep) boundaryCrossers += 1;
    }
  }

  const matchedCount = matchedPaths.size;
  return {
    taskCount: tasks.length,
    fillerCount: fillers.length,
    totalNotes: tasks.length + fillers.length,
    matchedCount,
    multiParentHistogram,
    maxDepth: maxChainDepth(tasks),
    boundaryCrossingFraction: matchedCount === 0 ? 0 : boundaryCrossers / matchedCount,
    dateMix: { dated, undated, startOnly, endOnly },
    dependencyCount,
  };
}
