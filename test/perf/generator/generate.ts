/**
 * Seeded deterministic task-graph generator (U1, #161 perf plan). Pure: a seeded
 * PRNG (no `Date.now()`/`Math.random()`) turns {@link GenerateParams} into a
 * canonical {@link TaskGraph} reproducing the production shape — ~10k notes /
 * ~5k tasks, a ~261 matched subset whose `projects`/dependency edges cross the
 * filter boundary into non-matched tasks (R4), deep nesting, multi-parent
 * fan-out, cycles, and orphans.
 *
 * ## Determinism + exactness
 * Every random choice draws from one `mulberry32` PRNG seeded by `params.seed`,
 * consumed in a fixed order, so the same seed + params yields a byte-identical
 * graph. Distributions that must hit exact counts (multi-parent buckets, date
 * mix, dependency density) are *allocated* by count rather than sampled
 * per-item, so the structural invariants hold precisely, not just on average.
 *
 * ## Role pools keep counts disjoint
 * Task indices are partitioned into disjoint role pools — a depth chain,
 * multi-parent buckets, cycle pairs, orphans, then general tasks. Cycles and
 * orphans each add exactly one parent edge to their own tasks, so they never
 * perturb the multi-parent histogram. Every non-cycle parent edge points at an
 * *earlier* index, which guarantees the only reciprocal `projects` cycles are
 * the injected ones (R3 cycle-count exactness).
 *
 * @module test/perf/generator/generate
 */
import type {
  DependencyRelType,
  FillerNote,
  GenerateParams,
  GraphDependency,
  GraphTask,
  TaskGraph,
} from './graph';
import { REL_TYPES } from './graph';

/** Statuses a generated task can carry (drives status-color coverage). */
const STATUSES: readonly string[] = ['open', 'in-progress', 'done', 'blocked'];

/** Base date for all generated dates — fixed so output is deterministic. */
const BASE_YEAR = 2026;

/** A small, fast, seedable PRNG (mulberry32). Deterministic for a given seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in `[0, n)` from the PRNG. */
function randInt(rng: () => number, n: number): number {
  return Math.floor(rng() * n);
}

/** Fisher–Yates shuffle of `0..n-1` using the PRNG (does not mutate input). */
function shuffledIndices(rng: () => number, n: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = randInt(rng, i + 1);
    const tmp = arr[i] as number;
    arr[i] = arr[j] as number;
    arr[j] = tmp;
  }
  return arr;
}

/** Zero-padded task note path, e.g. `Tasks/task-00042.md`. */
function taskPath(index: number): string {
  return `Tasks/task-${String(index + 1).padStart(5, '0')}.md`;
}

/** A date `days` after the fixed base (Jan 1 of {@link BASE_YEAR}). */
function dayOffset(days: number): Date {
  return new Date(BASE_YEAR, 0, 1 + days);
}

/** Pick `count` distinct indices from `[0, ceiling)` using the PRNG. */
function distinctEarlier(rng: () => number, ceiling: number, count: number): number[] {
  const picked = new Set<number>();
  const target = Math.min(count, ceiling);
  // Bounded retries are fine: ceiling >= count by pool layout, so collisions are rare.
  while (picked.size < target) picked.add(randInt(rng, ceiling));
  return [...picked];
}

/**
 * Generate a deterministic canonical task graph from `params`. See the module
 * doc for the determinism + role-pool invariants this upholds.
 */
export function generate(params: GenerateParams): TaskGraph {
  const rng = mulberry32(params.seed);
  const n = params.taskCount;

  // 1. Task shells (paths/titles/status), no edges or dates yet.
  const tasks: GraphTask[] = [];
  for (let i = 0; i < n; i += 1) {
    const path = taskPath(i);
    tasks.push({
      path,
      title: path.slice('Tasks/'.length, -'.md'.length),
      parents: [],
      deps: [],
      start: null,
      due: null,
      status: STATUSES[randInt(rng, STATUSES.length)] as string,
      matched: false,
    });
  }

  // 2. Lay out disjoint role pools (ascending multi-parent count so a 7-parent
  //    task always sits at a high-enough index to have 7 earlier candidates).
  const buckets = [...params.multiParentDist].sort((p, q) => p.parents - q.parents);
  let cursor = 0;
  const take = (k: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < k && cursor < n; i += 1, cursor += 1) out.push(cursor);
    return out;
  };
  const chainPool = take(Math.min(params.maxDepth, n));
  const multiPool = buckets.map((b) => ({ parents: b.parents, idx: take(b.count) }));
  const cyclePool = take(params.cycleCount * 2);
  const orphanPool = take(params.orphanCount);
  // The remainder are general tasks.
  const generalPool: number[] = [];
  for (let i = cursor; i < n; i += 1) generalPool.push(i);

  // 3. Depth chain: chain[k]'s only parent is chain[k-1] → depth = chain length.
  for (let k = 1; k < chainPool.length; k += 1) {
    const child = tasks[chainPool[k] as number] as GraphTask;
    child.parents = [taskPath(chainPool[k - 1] as number)];
  }

  // 4. Multi-parent buckets: each task gets exactly `parents` distinct EARLIER
  //    parents (earlier ⇒ no reciprocal cycle introduced here).
  for (const bucket of multiPool) {
    for (const idx of bucket.idx) {
      const parents = distinctEarlier(rng, idx, bucket.parents).map(taskPath);
      (tasks[idx] as GraphTask).parents = parents;
    }
  }

  // 5. Reciprocal `projects` cycles: pair (a,b) → a parents b, b parents a. The
  //    only forward-pointing edges in the graph, so cycle count stays exact.
  for (let c = 0; c + 1 < cyclePool.length; c += 2) {
    const a = cyclePool[c] as number;
    const b = cyclePool[c + 1] as number;
    (tasks[a] as GraphTask).parents = [taskPath(b)];
    (tasks[b] as GraphTask).parents = [taskPath(a)];
  }

  // 6. Orphans: a single dangling parent ref at a non-existent path.
  for (let o = 0; o < orphanPool.length; o += 1) {
    const idx = orphanPool[o] as number;
    (tasks[idx] as GraphTask).parents = [`Tasks/orphan-ref-${String(o + 1).padStart(5, '0')}.md`];
  }

  // 7. General tasks: ~70% get one earlier real parent → a connected hierarchy.
  for (const idx of generalPool) {
    if (idx > 0 && rng() < 0.7) {
      (tasks[idx] as GraphTask).parents = [taskPath(randInt(rng, idx))];
    }
  }

  // 8. Dates: allocate EXACT counts per the normalized date mix, then assign to
  //    a shuffled task order so date-category doesn't correlate with role.
  assignDates(rng, tasks, params);

  // 9. Dependencies: allocate EXACT count = round(depDensity * taskCount); each
  //    points at a real (non-self) predecessor so no dangling deps are created.
  assignDependencies(rng, tasks, params);

  // 10. Matched subset: prefer tasks that CAN cross the boundary (have a parent
  //     or dep), so the ~261 matched set's edges span into non-matched tasks.
  assignMatched(rng, tasks, params);

  // 11. Filler notes to reach the total note count (R2).
  const fillers = buildFillers(params);

  return { tasks, fillers, params };
}

/** Allocate exact date-mix counts and assign them across a shuffled task order. */
function assignDates(rng: () => number, tasks: GraphTask[], params: GenerateParams): void {
  const n = tasks.length;
  const mix = params.dateMix;
  const sum = mix.dated + mix.undated + mix.startOnly + mix.endOnly || 1;
  let nDated = Math.round((mix.dated / sum) * n);
  let nStartOnly = Math.round((mix.startOnly / sum) * n);
  let nEndOnly = Math.round((mix.endOnly / sum) * n);
  // Undated absorbs any rounding remainder so the counts sum to exactly n.
  let nUndated = n - nDated - nStartOnly - nEndOnly;
  if (nUndated < 0) {
    nDated += nUndated; // shrink the largest bucket back into range
    nUndated = 0;
  }

  const order = shuffledIndices(rng, n);
  let cur = 0;
  const assign = (count: number, fn: (t: GraphTask) => void): void => {
    for (let i = 0; i < count; i += 1, cur += 1) fn(tasks[order[cur] as number] as GraphTask);
  };
  assign(nDated, (t) => {
    const start = randInt(rng, 365);
    t.start = dayOffset(start);
    t.due = dayOffset(start + 1 + randInt(rng, 30));
  });
  assign(nStartOnly, (t) => {
    t.start = dayOffset(randInt(rng, 365));
  });
  assign(nEndOnly, (t) => {
    t.due = dayOffset(randInt(rng, 365));
  });
  assign(nUndated, () => {
    /* left undated */
  });
}

/** Allocate exact dependency count; each edge targets a real, non-self predecessor. */
function assignDependencies(
  rng: () => number,
  tasks: GraphTask[],
  params: GenerateParams,
): void {
  const n = tasks.length;
  if (n < 2) return;
  const nDeps = Math.round(params.depDensity * n);
  const order = shuffledIndices(rng, n);
  for (let i = 0; i < nDeps; i += 1) {
    const dependent = tasks[order[i] as number] as GraphTask;
    const selfIdx = order[i] as number;
    let predIdx = randInt(rng, n);
    if (predIdx === selfIdx) predIdx = (predIdx + 1) % n;
    const reltype: DependencyRelType = REL_TYPES[randInt(rng, REL_TYPES.length)] as DependencyRelType;
    const gap = rng() < 0.4 ? `P${1 + randInt(rng, 5)}D` : null;
    const dep: GraphDependency = { predecessorPath: taskPath(predIdx), reltype, gap };
    dependent.deps.push(dep);
  }
}

/**
 * Mark exactly `matchedCount` tasks matched, preferring tasks that have a parent
 * or dependency (so their edges cross into the non-matched majority — R4). Since
 * matched is a small minority, those parents/predecessors are overwhelmingly
 * non-matched, so boundary crossing is high regardless of seed.
 */
function assignMatched(rng: () => number, tasks: GraphTask[], params: GenerateParams): void {
  const canCross = (t: GraphTask): boolean => t.parents.length > 0 || t.deps.length > 0;
  const order = shuffledIndices(rng, tasks.length);
  // Crossers first (in shuffled order), then the rest — deterministic + crossing-biased.
  const sorted = order.sort((a, b) => {
    const ca = canCross(tasks[a] as GraphTask) ? 0 : 1;
    const cb = canCross(tasks[b] as GraphTask) ? 0 : 1;
    return ca - cb;
  });
  const target = Math.min(params.matchedCount, tasks.length);
  for (let i = 0; i < target; i += 1) (tasks[sorted[i] as number] as GraphTask).matched = true;
}

/** Build filler notes to pad the vault to `totalNotes` (R2). */
function buildFillers(params: GenerateParams): FillerNote[] {
  const count = Math.max(0, params.totalNotes - params.taskCount);
  const fillers: FillerNote[] = [];
  for (let i = 0; i < count; i += 1) {
    const title = `note-${String(i + 1).padStart(5, '0')}`;
    fillers.push({ path: `Notes/${title}.md`, title });
  }
  return fillers;
}
