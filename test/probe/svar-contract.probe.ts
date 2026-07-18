/**
 * Contract probe: everything split-task rendering borrows from SVAR that SVAR
 * does not promise, pinned so an upgrade fails loudly instead of silently.
 *
 * The borrowed surface is deliberately tiny (see svarContract.ts):
 *   1. `getState()._scales.diff` / `.lengthUnit` — validated here and at runtime.
 *   2. Our template rendering as a DIRECT child of `.wx-bar` — the structural
 *      assumption behind every `:has(> .wx-segments)` rule in segments.css.
 *   3. SVAR still emitting the whole-bar progress wrapper we suppress.
 *   4. The `.wx-*` class vocabulary both sides share.
 *
 * The centrepiece is a RENDERING ORACLE: a segment covering dates D must land
 * exactly where SVAR itself draws a plain bar covering dates D. That checks the
 * entire chain — snapshot, fractions, percent positioning — against SVAR's own
 * output, with no knowledge of its formula, so a change to SVAR's rounding or
 * unit semantics cannot drift our segments unnoticed.
 *
 * Treat a failure here as "re-verify the port against the new SVAR", never as
 * a flaky test.
 */
import { test, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { IApi } from '@svar-ui/svelte-gantt';
import SegmentsProbeHost from './SegmentsProbeHost.svelte';
import { scaleSnapshot } from './svarContract';

/* eslint-disable @typescript-eslint/no-explicit-any */
/* global DOMRect, Element, getComputedStyle */

const d = (day: number): Date => new Date(2026, 3, day);

/**
 * Row 1: a plain task — SVAR's own rendering of Apr 16..22 is the ground truth.
 * Row 2: a longer split task with one segment covering exactly Apr 16..22.
 */
const ORACLE_TASKS = [
  { id: 1, text: 'Reference', type: 'task', start: d(16), end: d(22) },
  {
    id: 2,
    text: 'Split',
    type: 'task',
    start: d(2),
    end: d(24),
    segments: [{ start: d(16), duration: 6 }],
  },
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

const FULL_SPAN_TASK = [
  {
    id: 1,
    text: 'Full',
    type: 'task',
    start: d(2),
    end: d(10),
    segments: [{ start: d(2), duration: 8 }],
  },
];

async function mount(
  tasks: any[],
  cellWidth = 40,
): Promise<{ container: HTMLElement; api: IApi }> {
  let api: IApi | null = null;
  const screen = render(SegmentsProbeHost, {
    props: { tasks, cellWidth, init: (a: IApi) => { api = a; } },
  });
  const container = screen.container as HTMLElement;
  await vi.waitFor(
    () => {
      expect(container.querySelector('.og-segments-host[data-render-complete="true"]')).not.toBeNull();
      expect(api).not.toBeNull();
    },
    { timeout: 10000, interval: 50 },
  );
  return { container, api: api! };
}

const rect = (el: Element): DOMRect => el.getBoundingClientRect();

test('CONTRACT: scaleSnapshot finds diff and lengthUnit on the real store', async () => {
  const { api } = await mount(ORACLE_TASKS);
  const snap = scaleSnapshot(api);

  expect(snap, 'scaleSnapshot returned null against the real SVAR store').not.toBeNull();
  expect(typeof snap!.diff).toBe('function');
  expect(typeof snap!.diff(d(10), d(4), snap!.lengthUnit)).toBe('number');
});

test('CONTRACT: scaleSnapshot degrades to null, without throwing, when internals move', () => {
  const moved = { getState: () => ({}) } as unknown as IApi;
  expect(scaleSnapshot(moved)).toBeNull();
  expect(scaleSnapshot(moved)).toBeNull(); // warn-once path stays quiet and safe
});

test('ORACLE: a segment covering dates D lands where SVAR draws a bar covering D', async () => {
  const { container } = await mount(ORACLE_TASKS);
  const bars = container.querySelectorAll('.wx-bars > .wx-bar');
  expect(bars.length).toBe(2);

  const reference = rect(bars[0]!); // SVAR's own ground truth for Apr 16..22
  const segment = rect(container.querySelector('.wx-segment')!);

  console.log(
    `[CONTRACT] reference={x:${reference.left.toFixed(1)},w:${reference.width.toFixed(1)}} ` +
      `segment={x:${segment.left.toFixed(1)},w:${segment.width.toFixed(1)}}`,
  );

  // ≤1.5px: one rounding on SVAR's side, sub-pixel percentages on ours.
  expect(Math.abs(segment.left - reference.left)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(segment.width - reference.width)).toBeLessThanOrEqual(1.5);
});

test('ORACLE: a segment spanning the whole task is exactly the whole bar', async () => {
  const { container } = await mount(FULL_SPAN_TASK);
  const bar = container.querySelector('.wx-bars > .wx-bar') as HTMLElement;
  const segment = rect(container.querySelector('.wx-segment')!);

  // Compare against the bar's CONTENT box: segments render inside the bar's
  // border, exactly as SVAR Pro's own BarSegments do.
  const contentLeft = rect(bar).left + bar.clientLeft;
  expect(Math.abs(segment.left - contentLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(segment.width - bar.clientWidth)).toBeLessThanOrEqual(1);
});

test('CONTRACT: zoom rescales segments in lockstep with their bar', async () => {
  // Percent positioning makes this a CSS guarantee; the assertion pins the
  // segment/bar ratio as invariant across cell widths.
  const ratioAt = async (cellWidth: number): Promise<number> => {
    const { container } = await mount(SPLIT_TASK, cellWidth);
    const bar = rect(container.querySelector('.wx-bars > .wx-bar')!);
    const segment = rect(container.querySelector('.wx-segment')!);
    return segment.width / bar.width;
  };

  const narrow = await ratioAt(40);
  const wide = await ratioAt(80);
  expect(Math.abs(narrow - wide)).toBeLessThanOrEqual(0.02);
});

test('CONTRACT: the task template renders as a DIRECT child of .wx-bar', async () => {
  // Both the wx-split stamping (parentElement) and the progress-suppression
  // child combinator assume the template's root sits directly inside the bar.
  // If SVAR ever wraps the template in an intermediate element, both silently
  // die — this pins the structure.
  const { container } = await mount(SPLIT_TASK);
  expect(container.querySelector('.wx-bar > .wx-segments')).not.toBeNull();
});

test('CONTRACT: SVAR still renders the whole-bar progress wrapper we suppress', async () => {
  const { container } = await mount(SPLIT_TASK);
  const outer = container.querySelector('.wx-bars > .wx-bar') as HTMLElement;
  const wrapper = outer.querySelector(':scope > .wx-progress-wrapper');

  expect(wrapper, 'SVAR no longer emits a direct-child progress wrapper').not.toBeNull();
  expect(getComputedStyle(wrapper as Element).display).toBe('none');
});

test('CONTRACT: stamping SVAR’s own wx-split class makes SVAR blank the bar itself', async () => {
  // No transparency CSS of ours and no !important: the template adds `wx-split`
  // — the class Pro's own `class:wx-split={$splitTasks && task.segments}` would
  // bind — so SVAR's fill rule `.wx-task:not(.wx-split)` steps aside and its
  // `.wx-bars .wx-split.wx-bar { background: transparent }` applies. This test
  // pins that pair of SVAR rules as the mechanism.
  const { container } = await mount(SPLIT_TASK);
  const outer = container.querySelector('.wx-bars > .wx-bar') as HTMLElement;
  const segment = container.querySelector('.wx-segment') as HTMLElement;

  expect(outer.classList.contains('wx-split')).toBe(true);
  expect(getComputedStyle(outer).backgroundColor).toBe('rgba(0, 0, 0, 0)');
  // Segments carry `.wx-bar` too but never `wx-split`, so SVAR's fill styles
  // them normally.
  expect(segment.classList.contains('wx-split')).toBe(false);
  expect(getComputedStyle(segment).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
});
