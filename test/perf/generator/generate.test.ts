/**
 * U1 generator unit tests (#161 perf plan): determinism + structural invariants.
 * Pure jest/node — no Obsidian. These are precise, checkable contracts, so U1 is
 * built test-first (plan Execution note).
 */
import { describe, it, expect } from '@jest/globals';
import { generate } from './generate';
import { graphStats, maxChainDepth, REL_TYPES } from './graph';
import type { GenerateParams } from './graph';

/**
 * A small-but-representative param set: fast to generate, yet exercises every
 * structural feature. Scale-shape (10k/5k/261) is asserted separately with the
 * production-size params to keep the bulk of the suite quick.
 */
function baseParams(overrides: Partial<GenerateParams> = {}): GenerateParams {
  return {
    seed: 1234,
    totalNotes: 600,
    taskCount: 300,
    matchedCount: 40,
    multiParentDist: [
      { parents: 2, count: 10 },
      { parents: 4, count: 5 },
      { parents: 7, count: 2 },
    ],
    maxDepth: 5,
    depDensity: 0.3,
    dateMix: { dated: 0.5, undated: 0.2, startOnly: 0.15, endOnly: 0.15 },
    cycleCount: 3,
    orphanCount: 4,
    ...overrides,
  };
}

describe('generate — determinism', () => {
  it('produces a byte-identical graph for the same seed + params', () => {
    const a = generate(baseParams());
    const b = generate(baseParams());
    expect(b).toEqual(a);
  });

  it('produces a different graph for a different seed', () => {
    const a = generate(baseParams({ seed: 1 }));
    const b = generate(baseParams({ seed: 2 }));
    expect(b).not.toEqual(a);
  });
});

describe('generate — scale', () => {
  it('produces the requested task and total note counts (within tolerance)', () => {
    const graph = generate(baseParams({ totalNotes: 600, taskCount: 300 }));
    const stats = graphStats(graph);
    expect(stats.taskCount).toBe(300);
    // Total notes = tasks + fillers; orphan refs may add a few phantom paths but
    // fillers fill the rest exactly.
    expect(stats.totalNotes).toBe(600);
  });

  it('scales to production shape (~10k notes / ~5k tasks / ~261 matched)', () => {
    const graph = generate(
      baseParams({
        totalNotes: 10000,
        taskCount: 5000,
        matchedCount: 261,
        multiParentDist: [
          { parents: 2, count: 400 },
          { parents: 4, count: 120 },
          { parents: 7, count: 40 },
        ],
      }),
    );
    const stats = graphStats(graph);
    expect(stats.taskCount).toBe(5000);
    expect(stats.totalNotes).toBe(10000);
    expect(stats.matchedCount).toBe(261);
  });
});

describe('generate — structural mix', () => {
  it('produces the requested multi-parent distribution', () => {
    const graph = generate(baseParams());
    const stats = graphStats(graph);
    expect(stats.multiParentHistogram[2]).toBe(10);
    expect(stats.multiParentHistogram[4]).toBe(5);
    expect(stats.multiParentHistogram[7]).toBe(2);
  });

  it('reaches the requested nesting depth (≥5)', () => {
    const graph = generate(baseParams({ maxDepth: 5 }));
    expect(maxChainDepth(graph.tasks)).toBeGreaterThanOrEqual(5);
  });

  it('crosses the filter boundary: a measurable fraction of matched tasks have a non-matched parent or dep (R4)', () => {
    const graph = generate(baseParams());
    const stats = graphStats(graph);
    expect(stats.boundaryCrossingFraction).toBeGreaterThan(0.1);
  });

  it('injects the requested number of reciprocal projects cycles', () => {
    const graph = generate(baseParams({ cycleCount: 3 }));
    const byPath = new Map(graph.tasks.map((t) => [t.path, t]));
    let cycles = 0;
    for (const t of graph.tasks) {
      for (const parent of t.parents) {
        const p = byPath.get(parent);
        // A 2-cycle: t lists parent, and parent lists t back. Count each once.
        if (p && p.parents.includes(t.path) && t.path < parent) cycles += 1;
      }
    }
    expect(cycles).toBe(3);
  });

  it('keeps cycles well-formed so maxChainDepth still terminates', () => {
    const graph = generate(baseParams({ cycleCount: 3 }));
    // Would infinite-loop / blow the stack if the cycle guard were missing.
    expect(() => maxChainDepth(graph.tasks)).not.toThrow();
  });

  it('injects the requested number of orphan (dangling) references', () => {
    const graph = generate(baseParams({ orphanCount: 4 }));
    const taskPaths = new Set(graph.tasks.map((t) => t.path));
    let dangling = 0;
    for (const t of graph.tasks) {
      for (const parent of t.parents) if (!taskPaths.has(parent)) dangling += 1;
      for (const d of t.deps) if (!taskPaths.has(d.predecessorPath)) dangling += 1;
    }
    expect(dangling).toBe(4);
  });

  it('matches the requested date-coverage proportions (within tolerance)', () => {
    const graph = generate(
      baseParams({
        taskCount: 1000,
        totalNotes: 1500,
        dateMix: { dated: 0.5, undated: 0.2, startOnly: 0.15, endOnly: 0.15 },
      }),
    );
    const stats = graphStats(graph);
    const total = stats.taskCount;
    expect(stats.dateMix.dated / total).toBeCloseTo(0.5, 1);
    expect(stats.dateMix.undated / total).toBeCloseTo(0.2, 1);
    expect(stats.dateMix.startOnly / total).toBeCloseTo(0.15, 1);
    expect(stats.dateMix.endOnly / total).toBeCloseTo(0.15, 1);
  });

  it('throws when the disjoint role pools cannot fit in taskCount (no silent count truncation)', () => {
    // chain(5) + multiParent(20) + cycles(2*5) + orphans(10) = 45 > taskCount 30.
    expect(() =>
      generate(
        baseParams({
          taskCount: 30,
          totalNotes: 60,
          matchedCount: 5,
          multiParentDist: [{ parents: 2, count: 20 }],
          maxDepth: 5,
          cycleCount: 5,
          orphanCount: 10,
        }),
      ),
    ).toThrow(/role pools .* exceed taskCount/);
  });

  it('emits dependency edges with valid reltypes at roughly the requested density', () => {
    const graph = generate(baseParams({ taskCount: 1000, totalNotes: 1500, depDensity: 0.3 }));
    const stats = graphStats(graph);
    // ~0.3 of 1000 tasks carry an edge; allow generous tolerance.
    expect(stats.dependencyCount).toBeGreaterThan(150);
    expect(stats.dependencyCount).toBeLessThan(450);
    for (const t of graph.tasks) {
      for (const d of t.deps) {
        expect(REL_TYPES).toContain(d.reltype);
      }
    }
  });
});
