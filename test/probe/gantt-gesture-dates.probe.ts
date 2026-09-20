/* global Element */
import { test, expect, vi } from 'vitest';
import { performGanttGesture } from '../helpers/ganttGesture';
import { render } from 'vitest-browser-svelte';
import type { TaskPatch } from '../../src/datasource/types';
import { buildTaskUpdates } from '../../src/datasource/TaskNotesSource';
import GanttPerfHost from '../perf/isolated/GanttPerfHost.svelte';
import { buildGanttData } from '../perf/generator/buildGanttData';
import type { TaskGraph } from '../perf/generator/graph';

function graph(first = 21, last = 23): TaskGraph {
  return {
    tasks: [
      { path: 'Parent.md', title: 'Parent', parents: [], deps: [], start: new Date(2026, 8, 18), due: new Date(2026, 8, 26), status: 'open', matched: true },
      { path: 'Child.md', title: 'Child', parents: ['Parent.md'], deps: [], start: new Date(2026, 8, first), due: new Date(2026, 8, last), status: 'open', matched: true },
    ],
    fillers: [],
    params: { seed: 1, totalNotes: 2, taskCount: 2, matchedCount: 2, multiParentDist: [], maxDepth: 1, depDensity: 0, dateMix: { dated: 1, undated: 0, startOnly: 0, endOnly: 0 }, cycleCount: 0, orphanCount: 0 },
  };
}

async function writableData(first = 21, last = 23) {
  const { data, controller } = await buildGanttData(graph(first, last));
  return {
    ...data,
    defaultScale: 'day' as const,
    capabilities: { write: true },
    managedPaths: new Set(['Parent.md', 'Child.md']),
    deriveEstimate: controller.buildDeriveEstimate(),
    deriveSpan: controller.buildDeriveSpan(),
  };
}

function childBars(root: HTMLElement): Element[] {
  return Array.from(root.querySelectorAll('.wx-bars > .wx-bar'))
    .filter(el => el.getAttribute('data-id')?.includes('Child.md'));
}

function dayWidth(root: HTMLElement): number {
  const rows = root.querySelectorAll('.wx-scale .wx-row');
  const cell = rows[rows.length - 1]?.querySelector('.wx-cell');
  if (!cell) throw new Error('Missing day scale');
  return cell.getBoundingClientRect().width;
}

test.each(['root', 'nested'] as const)('moves and both resize edges from the %s placement keep sibling bars aligned with saved dates before and after refresh', async placement => {
  let settleWrite = () => {};
  const onMutate = vi.fn((_id: string, _patch: TaskPatch) => new Promise<void>(resolve => { settleWrite = resolve; }));
  const screen = render(GanttPerfHost, { props: { data: await writableData(), onMutate } });
  const root = screen.container as HTMLElement;
  const host = root.querySelector<HTMLElement>('.og-perf-host');
  if (!host) throw new Error('Missing component host');
  host.style.width = '1200px';
  await vi.waitFor(() => expect(root.querySelector('[data-render-complete="true"]')).not.toBeNull());
  expect(childBars(root)).toHaveLength(2);
  const origin = childBars(root)[0].getBoundingClientRect().left;
  const width = dayWidth(root);
  const instanceId = childBars(root).find(bar =>
    bar.getAttribute('data-id')?.endsWith('Child.md') === (placement === 'root'),
  )?.getAttribute('data-id');
  if (!instanceId) throw new Error(`Missing ${placement} child placement`);

  const expectSpan = (first: number, last: number) => {
    expect(childBars(root)).toHaveLength(2);
    for (const bar of childBars(root)) {
      const rect = bar.getBoundingClientRect();
      expect(rect.left).toBeCloseTo(origin + (first - 21) * width, 0);
      expect(rect.width).toBeCloseTo((last - first + 1) * width, 0);
    }
  };

  let writes = 0;
  for (const [edge, days, first, last] of [
    ['move', -1, 20, 22], ['move', 1, 21, 23], ['move', -1, 20, 22],
    ['start', 1, 21, 22], ['start', -1, 20, 22], ['end', 1, 20, 23], ['end', -1, 20, 22],
  ] as const) {
    performGanttGesture({ notePath: 'Child.md', instanceId, edge, days }, root);
    writes += 1;
    await vi.waitFor(() => expect(onMutate).toHaveBeenCalledTimes(writes));
    try {
      await vi.waitFor(() => expectSpan(first, last));
      expect(buildTaskUpdates(onMutate.mock.calls[writes - 1][1])).toEqual({ scheduled: `2026-09-${first}`, due: `2026-09-${last}` });
    } finally {
      settleWrite();
    }
  }

  await screen.rerender({ data: await writableData(20, 22) });
  await vi.waitFor(() => expectSpan(20, 22));
  expect(onMutate).toHaveBeenCalledTimes(7);
});
