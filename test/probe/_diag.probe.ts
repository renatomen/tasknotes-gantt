/**
 * Diagnostic (spike, throwaway): dumps SVAR store state for the segments case to
 * pinpoint why BarSegments does not render. Not part of the verdict battery.
 */
import { test, expect, vi, afterAll } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { server } from 'vitest/browser';
import { get } from 'svelte/store';
import { Gantt } from '@svar-ui/svelte-gantt';
import SvarFeatureProbeHost from './SvarFeatureProbeHost.svelte';
import { SEGMENTS_WITH_FLAG } from './fixtures';

/* eslint-disable @typescript-eslint/no-explicit-any */

let dump: any = {};

test('DIAG: dump store state for segments+splitTasks', async () => {
  let api: any = null;
  const screen = render(SvarFeatureProbeHost, {
    props: {
      tasks: SEGMENTS_WITH_FLAG.tasks,
      links: [],
      splitTasks: true,
      init: (a: any) => {
        api = a;
      },
    },
  });
  const container = screen.container as HTMLElement;
  await vi.waitFor(
    () => {
      expect(container.querySelector('.og-probe-host[data-render-complete="true"]')).not.toBeNull();
    },
    { timeout: 10000, interval: 50 },
  );

  const state: any = api?.getState?.() ?? {};
  const reactive: any = api?.getReactiveState?.() ?? {};

  const reactiveKeys = Object.keys(reactive);
  let splitTasksReactive: unknown = 'MISSING';
  try {
    if (reactive.splitTasks) splitTasksReactive = get(reactive.splitTasks);
  } catch (e) {
    splitTasksReactive = `ERR:${String(e)}`;
  }

  // Find the split task in whatever collection the state exposes.
  const collections = ['_tasks', 'tasks'];
  const taskDumps: any = {};
  for (const key of collections) {
    const coll = state[key];
    let arr: any[] = [];
    if (Array.isArray(coll)) arr = coll;
    else if (coll && typeof coll.map === 'function') {
      try { arr = coll.map((x: any) => x); } catch { arr = []; }
    } else if (coll && typeof coll.byId === 'function') {
      const t = coll.byId(1);
      if (t) arr = [t];
    }
    const t = arr.find((x: any) => x && (x.id === 1 || x.$id === 1));
    if (t) {
      taskDumps[key] = {
        keys: Object.keys(t),
        hasSegments: !!t.segments,
        segmentsLen: t.segments?.length ?? null,
        segment0: t.segments?.[0]
          ? { keys: Object.keys(t.segments[0]), $x: t.segments[0].$x, $w: t.segments[0].$w }
          : null,
        $x: t.$x,
        $w: t.$w,
        $skip: t.$skip,
      };
    } else {
      taskDumps[key] = `no task id=1 (collectionType=${coll?.constructor?.name ?? typeof coll})`;
    }
  }

  dump = {
    stateSplitTasks: state.splitTasks,
    reactiveKeys,
    splitTasksReactive,
    hasSplitTasksInReactive: reactiveKeys.includes('splitTasks'),
    taskDumps,
    domHasSegments: container.querySelector('.wx-segments') !== null,
    domHasSplitClass: container.querySelector('.wx-split') !== null,
    barCount: container.querySelectorAll('.wx-bar').length,
  };
  // eslint-disable-next-line no-console
  console.log('[DIAG]', JSON.stringify(dump, null, 2));
  expect(api).not.toBeNull();
});

test('DIAG2: mount Gantt DIRECTLY (no host) and read splitTasks state', async () => {
  let api: any = null;
  const screen = render(Gantt, {
    props: {
      tasks: SEGMENTS_WITH_FLAG.tasks,
      splitTasks: true,
      init: (a: any) => {
        api = a;
      },
    },
  });
  const container = screen.container as HTMLElement;
  // Give the raw Gantt a measurable box (no host wrapper here).
  container.style.height = '400px';
  container.style.width = '900px';
  container.style.position = 'relative';

  await vi.waitFor(
    () => {
      expect(api).not.toBeNull();
    },
    { timeout: 5000, interval: 25 },
  );
  // Let layout settle after the height was applied.
  await new Promise<void>((r) => setTimeout(r, 300));

  const state: any = api?.getState?.() ?? {};
  const reactive: any = api?.getReactiveState?.() ?? {};
  let splitTasksReactive: unknown = 'MISSING';
  try {
    if (reactive.splitTasks) splitTasksReactive = get(reactive.splitTasks);
  } catch (e) {
    splitTasksReactive = `ERR:${String(e)}`;
  }

  dump.direct = {
    stateSplitTasks: state.splitTasks,
    splitTasksReactive,
    domHasSegments: container.querySelector('.wx-segments') !== null,
    domHasSplitClass: container.querySelector('.wx-split') !== null,
    barCount: container.querySelectorAll('.wx-bar').length,
    segmentCount: container.querySelectorAll('.wx-segment').length,
  };
  // eslint-disable-next-line no-console
  console.log('[DIAG2-direct]', JSON.stringify(dump.direct, null, 2));
  expect(api).not.toBeNull();
});

afterAll(async () => {
  try {
    await server.commands.writeFile('test/probe/.results/diag.json', `${JSON.stringify(dump, null, 2)}\n`);
  } catch {
    /* best-effort */
  }
});
