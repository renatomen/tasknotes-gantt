/**
 * U3 pipeline-parity tests (#161 perf plan): the graph → in-memory sources →
 * real controller → GanttData pipeline produces the expected expansion, with no
 * double-counting, and is deterministic. Pure jest/node — the headless mount +
 * sentinel live in the browser harness (`*.perf.ts`); these prove the data
 * feeding is correct. This is the cross-layer instance-count check U1 defers (R5).
 */
import { describe, it, expect } from '@jest/globals';
import { buildGanttData, makePerfController } from './buildGanttData';
import { generate } from './generate';
import type { GraphTask, TaskGraph } from './graph';

function t(overrides: Partial<GraphTask> & { path: string }): GraphTask {
  return {
    title: overrides.path.replace(/^.*\//, '').replace(/\.md$/, ''),
    parents: [],
    deps: [],
    start: new Date(2026, 2, 1),
    due: new Date(2026, 2, 10),
    status: 'open',
    matched: false,
    ...overrides,
  };
}

function graphOf(tasks: GraphTask[]): TaskGraph {
  return {
    tasks,
    fillers: [],
    params: {
      seed: 0,
      totalNotes: tasks.length,
      taskCount: tasks.length,
      matchedCount: tasks.filter((x) => x.matched).length,
      multiParentDist: [],
      maxDepth: 1,
      depDensity: 0,
      dateMix: { dated: 1, undated: 0, startOnly: 0, endOnly: 0 },
      cycleCount: 0,
      orphanCount: 0,
    },
  };
}

describe('buildGanttData — pipeline parity', () => {
  it('expands a Show-all chain (P→C→G) to one instance per displayed task', async () => {
    const graph = graphOf([
      t({ path: 'Tasks/P.md', matched: true }),
      t({ path: 'Tasks/C.md', parents: ['Tasks/P.md'] }),
      t({ path: 'Tasks/G.md', parents: ['Tasks/C.md'] }),
    ]);
    const { controller, data } = await buildGanttData(graph, { mode: 'show-all' });

    expect(data.instances).toHaveLength(3);
    expect(new Set(data.instances.map((i) => i.sourcePath))).toEqual(
      new Set(['Tasks/P.md', 'Tasks/C.md', 'Tasks/G.md']),
    );
    // No double-count: the assembled data equals the controller's own view.
    expect(data.instances).toHaveLength((await controller.getInstances()).length);
  });

  it('multiplies a 2-parent task into one instance per parent (fan-out → R5)', async () => {
    const graph = graphOf([
      t({ path: 'Tasks/A.md', matched: true }),
      t({ path: 'Tasks/B.md', matched: true }),
      t({ path: 'Tasks/child.md', matched: true, parents: ['Tasks/A.md', 'Tasks/B.md'] }),
    ]);
    // The matched child renders once per displayed parent PLUS the also-top-level
    // duplicate root (Hide-top is a view filter now, not a data change — the
    // instance set is the same regardless of the toggle).
    const { data } = await buildGanttData(graph, { mode: 'inherit' });

    // A, B (roots) + child under A + child under B + child root duplicate = 5.
    expect(data.instances).toHaveLength(5);
    expect(data.instances.filter((i) => i.sourcePath === 'Tasks/child.md')).toHaveLength(3);
  });

  it('is read-only (no write affordances in the harness)', async () => {
    const graph = graphOf([t({ path: 'Tasks/P.md', matched: true })]);
    const { data } = await buildGanttData(graph);
    expect(data.capabilities.write).toBe(false);
  });
});

describe('buildGanttData — instance-count targeting (R5 sanity)', () => {
  function targetingParams(multiParentCount: number) {
    return {
      seed: 99,
      totalNotes: 800,
      taskCount: 500,
      matchedCount: 60,
      multiParentDist: [{ parents: 4, count: multiParentCount }],
      maxDepth: 5,
      depDensity: 0.1,
      dateMix: { dated: 0.7, undated: 0.1, startOnly: 0.1, endOnly: 0.1 },
      cycleCount: 0,
      orphanCount: 0,
    };
  }

  it('Show-all pulls in more instances than the matched subset (expansion happens)', async () => {
    const graph = generate(targetingParams(40));
    const { controller, data } = await buildGanttData(graph, { mode: 'show-all' });
    const matched = graph.tasks.filter((x) => x.matched).length;
    expect(data.instances.length).toBeGreaterThan(matched);
    // Deterministic: the same graph re-built yields the same count.
    const again = await makePerfController(graph, { mode: 'show-all' });
    await again.init();
    expect(await again.getInstances()).toHaveLength((await controller.getInstances()).length);
  });

  it('heavier multi-parent fan-out yields at least as many instances (tunable target)', async () => {
    const light = await buildGanttData(generate(targetingParams(10)), { mode: 'show-all' });
    const heavy = await buildGanttData(generate(targetingParams(80)), { mode: 'show-all' });
    expect(heavy.data.instances.length).toBeGreaterThanOrEqual(light.data.instances.length);
  });
});
