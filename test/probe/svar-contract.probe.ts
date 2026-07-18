/**
 * Contract probe: the SVAR internals split-task rendering stands on.
 *
 * `SegmentBar.svelte` reproduces a Pro-gated feature by using SVAR's own layout
 * data, scale primitives, class names, and DOM structure — none of which SVAR
 * promises as public API (`$`- and `_`-prefixed members are internal by
 * convention). If an upgrade moves any of them, the rendering probe would still
 * pass, because it only asserts OUR markup. These tests are the canary: each one
 * fails loudly and names exactly which assumption broke.
 *
 * Treat a failure here as "re-verify the port against the new SVAR", not as a
 * flaky test.
 */
import { test, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { get } from 'svelte/store';
import SegmentsProbeHost from './SegmentsProbeHost.svelte';
import { segmentBox } from './segmentLayout';

/* eslint-disable @typescript-eslint/no-explicit-any */
/* global Element, getComputedStyle */

const d = (day: number): Date => new Date(2026, 3, day);

/** A plain task whose geometry SVAR computes itself — our oracle. */
const PLAIN_TASK = [
  { id: 1, text: 'Oracle', type: 'task', start: d(4), end: d(10), progress: 50 },
];

const SPLIT_TASK = [
  {
    id: 1,
    text: 'Split',
    type: 'task',
    start: d(2),
    end: d(24),
    progress: 40,
    segments: [
      { start: d(2), duration: 4 },
      { start: d(16), duration: 6 },
    ],
  },
];

async function mount(tasks: any[]): Promise<{ container: HTMLElement; api: any }> {
  let api: any = null;
  const screen = render(SegmentsProbeHost, {
    props: { tasks, init: (a: any) => { api = a; } },
  });
  const container = screen.container as HTMLElement;
  await vi.waitFor(
    () => {
      expect(container.querySelector('.og-segments-host[data-render-complete="true"]')).not.toBeNull();
      expect(api).not.toBeNull();
    },
    { timeout: 10000, interval: 50 },
  );
  return { container, api };
}

test('CONTRACT: getReactiveState still exposes _scales, cellWidth and durationUnit as stores', async () => {
  const { api } = await mount(PLAIN_TASK);
  const rs = api.getReactiveState();

  for (const key of ['_scales', 'cellWidth', 'durationUnit'] as const) {
    expect(typeof rs[key]?.subscribe, `reactive state lost "${key}"`).toBe('function');
  }
});

test('CONTRACT: _scales still provides diff(), start and lengthUnit', async () => {
  const { api } = await mount(PLAIN_TASK);
  const scales: any = get(api.getReactiveState()._scales);

  expect(typeof scales.diff, '_scales.diff is gone').toBe('function');
  expect(scales.start instanceof Date, '_scales.start is not a Date').toBe(true);
  expect(typeof scales.lengthUnit, '_scales.lengthUnit is gone').toBe('string');
  // The signature we rely on: diff(a, b, unit, inclusive?) -> number in `unit`.
  expect(typeof scales.diff(d(10), d(4), scales.lengthUnit)).toBe('number');
});

test('CONTRACT: a laid-out task still carries numeric $x and $w', async () => {
  const { api } = await mount(PLAIN_TASK);
  const task: any = api.getTask(1);

  expect(typeof task.$x, 'task.$x is gone — segment offsets cannot be rebased').toBe('number');
  expect(typeof task.$w, 'task.$w is gone').toBe('number');
});

test('ORACLE: our geometry reproduces SVAR’s own $x/$w for the same dates', async () => {
  // The load-bearing canary. We reimplement SVAR's date->pixel formula; if SVAR
  // ever changes its rounding or units, this diverges and segments would drift
  // silently. Feeding our helper the TASK's own span must reproduce the layout
  // SVAR computed for that task.
  const { api } = await mount(PLAIN_TASK);
  const rs = api.getReactiveState();
  const scales: any = get(rs._scales);
  const cellWidth: number = get(rs.cellWidth) as number;
  const durationUnit: any = get(rs.durationUnit);
  const task: any = api.getTask(1);

  const ours = segmentBox(
    { start: task.start, duration: task.duration },
    0, // absolute, not bar-relative, so it is directly comparable to task.$x
    scales,
    cellWidth,
    durationUnit,
  );

  console.log(
    `[CONTRACT] svar={x:${task.$x},w:${task.$w}} ours={left:${ours.left},width:${ours.width}} unit=${durationUnit}/${scales.lengthUnit}`,
  );

  // Allow a single pixel of rounding slack; anything more is a real divergence.
  expect(Math.abs(ours.left - task.$x)).toBeLessThanOrEqual(1);
  expect(Math.abs(ours.width - task.$w)).toBeLessThanOrEqual(1);
});

test('CONTRACT: the task template renders as a DIRECT child of .wx-bar', async () => {
  // `segments.css` keys every rule on `:has(> .wx-segments)`. If SVAR ever wraps
  // the template in an intermediate element, the child combinator stops matching
  // and both the transparency and the progress suppression silently die.
  const { container } = await mount(SPLIT_TASK);
  const direct = container.querySelector('.wx-bar > .wx-segments');
  expect(direct, 'template is no longer a direct child of .wx-bar').not.toBeNull();
});

test('CONTRACT: SVAR still renders its whole-bar progress wrapper we suppress', async () => {
  // Our suppression rule targets `.wx-bar > .wx-progress-wrapper`. Confirm SVAR
  // still emits exactly that on a progressed bar (it does, because `splitTasks`
  // is forced false in the MIT build). If SVAR stops, the rule is dead weight;
  // if SVAR moves it, the fill reappears under the segments.
  const { container } = await mount(SPLIT_TASK);
  const outer = container.querySelector('.wx-bars > .wx-bar') as HTMLElement;
  const wrapper = outer.querySelector(':scope > .wx-progress-wrapper');

  expect(wrapper, 'SVAR no longer emits a direct-child progress wrapper').not.toBeNull();
  // ...and our rule must be what hides it.
  expect(getComputedStyle(wrapper as Element).display).toBe('none');
});

test('CONTRACT: the transparency rule beats SVAR’s own background', async () => {
  // Equal-specificity collision with `.wx-task:not(.wx-split)`; this proves our
  // declaration actually wins in the built stylesheet rather than by luck of
  // source order.
  const { container } = await mount(SPLIT_TASK);
  const outer = container.querySelector('.wx-bars > .wx-bar') as HTMLElement;
  const segment = container.querySelector('.wx-segment') as HTMLElement;

  expect(getComputedStyle(outer).backgroundColor).toBe('rgba(0, 0, 0, 0)');
  // The same rule must NOT reach the segments — they carry `wx-bar` too.
  expect(getComputedStyle(segment).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
});
