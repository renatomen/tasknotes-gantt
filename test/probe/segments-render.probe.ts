/**
 * Behaviour probe: the hand-rolled split-task template renders SVAR-style
 * spaced segments — structure, gaps, connector, progress, fallback — against
 * the MIT build, with no Obsidian. Captures a screenshot for visual judgement.
 * (The private-API assumptions behind this live in svar-contract.probe.ts.)
 */
import { test, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, server } from 'vitest/browser';
import SegmentsProbeHost from './SegmentsProbeHost.svelte';

/* eslint-disable @typescript-eslint/no-explicit-any */
/* global DOMRect, Element, getComputedStyle */

const d = (day: number): Date => new Date(2026, 3, day);

/** One task, active in two bursts with a two-week gap between them. */
const SPLIT_TASK = [
  {
    id: 1,
    text: 'Design course',
    type: 'task',
    start: d(2),
    end: d(24),
    progress: 40,
    segments: [
      { start: d(2), duration: 4, text: 'Block 1' },
      { start: d(16), duration: 6, text: 'Block 2' },
    ],
  },
];

const PLAIN_TASK = [
  { id: 1, text: 'Ordinary task', type: 'task', start: d(2), end: d(10), progress: 40 },
];

/** A Pro build supplies segment $x/$w itself; the template must honour them. */
const PRO_LAID_OUT_TASK = [
  {
    id: 1,
    text: 'Pro',
    type: 'task',
    start: d(2),
    end: d(24),
    segments: [{ start: d(2), duration: 4, $x: 52, $w: 77 }],
  },
];

async function mount(tasks: any[]): Promise<HTMLElement> {
  const screen = render(SegmentsProbeHost, { props: { tasks } });
  const container = screen.container as HTMLElement;
  await vi.waitFor(
    () => {
      if (container.querySelector('.og-segments-host[data-render-failed]')) {
        throw new Error('host never settled');
      }
      expect(container.querySelector('.og-segments-host[data-render-complete="true"]')).not.toBeNull();
    },
    { timeout: 10000, interval: 50 },
  );
  return container;
}

const rect = (el: Element): DOMRect => el.getBoundingClientRect();

test('a split task renders one sub-bar per segment inside a single row', async () => {
  const container = await mount(SPLIT_TASK);

  expect(container.querySelectorAll('.wx-bars > .wx-bar').length).toBe(1);
  expect(container.querySelectorAll('.wx-segment').length).toBe(2);
});

test('segments are index-addressable and visibly spaced', async () => {
  const container = await mount(SPLIT_TASK);
  const segments = Array.from(container.querySelectorAll('.wx-segment'));

  expect(segments.map((s) => s.getAttribute('data-segment'))).toEqual(['0', '1']);

  const first = rect(segments[0]!);
  const second = rect(segments[1]!);
  console.log(
    `[SPIKE] segments: [${first.left.toFixed(1)}w${first.width.toFixed(1)}] [${second.left.toFixed(1)}w${second.width.toFixed(1)}]`,
  );

  expect(first.width).toBeGreaterThan(0);
  expect(second.width).toBeGreaterThan(0);
  // The gap is the whole point: piece two starts after piece one ends.
  expect(second.left).toBeGreaterThan(first.right);
});

test('the dashed connector runs behind the segments', async () => {
  const container = await mount(SPLIT_TASK);
  const segmentsBox = container.querySelector('.wx-segments') as HTMLElement;
  expect(segmentsBox).not.toBeNull();
  expect(getComputedStyle(segmentsBox, '::before').borderTopStyle).toBe('dashed');
});

test('the connector stops at the last segment — no dashed tail past it', async () => {
  // SPLIT_TASK deliberately ends Apr 24 while its last segment ends Apr 22.
  // SVAR Pro cannot produce that state (it derives the bar span from the
  // segments), so its `width:100%` connector is exact; ours measures the run.
  const container = await mount(SPLIT_TASK);
  const box = container.querySelector('.wx-segments') as HTMLElement;
  const segments = Array.from(container.querySelectorAll('.wx-segment'));
  const lastRight = Math.max(...segments.map((s) => rect(s).right));

  const before = getComputedStyle(box, '::before');
  const runRight = rect(box).left + Number.parseFloat(before.left) + Number.parseFloat(before.width);

  expect(Math.abs(runRight - lastRight)).toBeLessThanOrEqual(1.5);
  expect(runRight).toBeLessThan(rect(box).right - 1); // genuinely short of the bar end
});

test('the outer bar is blanked while the segments keep their fill', async () => {
  const container = await mount(SPLIT_TASK);
  const outer = container.querySelector('.wx-bars > .wx-bar') as HTMLElement;
  const segment = container.querySelector('.wx-segment') as HTMLElement;

  expect(getComputedStyle(outer).backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(getComputedStyle(segment).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
});

test("SVAR's own whole-bar progress fill is suppressed on a segmented bar", async () => {
  const container = await mount(SPLIT_TASK);
  const outer = container.querySelector('.wx-bars > .wx-bar') as HTMLElement;

  const outerFill = outer.querySelector(':scope > .wx-progress-wrapper');
  const visible = outerFill ? getComputedStyle(outerFill).display !== 'none' : false;
  expect(visible).toBe(false);

  // The per-segment fills must survive.
  expect(container.querySelectorAll('.wx-segment .wx-progress-percent').length).toBe(2);
});

test('progress fills the earlier segment before the later one', async () => {
  const container = await mount(SPLIT_TASK);
  const widths = Array.from(
    container.querySelectorAll('.wx-segment .wx-progress-percent'),
  ).map((f) => (f as HTMLElement).style.width);

  // 40% of 10 duration units = 4 units = exactly the first segment.
  expect(widths.map((w) => Number.parseFloat(w))).toEqual([100, 0]);
});

test('Pro-supplied segment $x/$w are honoured verbatim (drop-in path)', async () => {
  const container = await mount(PRO_LAID_OUT_TASK);
  const segment = container.querySelector('.wx-segment') as HTMLElement;

  expect(segment.style.left).toBe('52px');
  expect(segment.style.width).toBe('77px');
});

test('an unsegmented task is untouched — one ordinary bar, no segments container', async () => {
  const container = await mount(PLAIN_TASK);

  expect(container.querySelectorAll('.wx-bar').length).toBe(1);
  expect(container.querySelector('.wx-segments')).toBeNull();
  expect(container.querySelector('.wx-segment')).toBeNull();

  const outer = container.querySelector('.wx-bar') as HTMLElement;
  // The :has() rules must not blank an ordinary bar.
  expect(getComputedStyle(outer).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
});

test('a malformed segment is skipped while valid siblings render', async () => {
  const container = await mount([
    {
      id: 1,
      text: 'Mixed',
      type: 'task',
      start: d(2),
      end: d(24),
      segments: [
        { start: '2026-04-02', duration: 4 }, // not a Date — rejected
        { start: d(16), duration: 6 },
      ],
    },
  ]);
  expect(container.querySelectorAll('.wx-segment').length).toBe(1);
});

test('SCREENSHOT: capture the segmented render for visual judgement', async () => {
  await mount(SPLIT_TASK);
  let captured = 'not-captured';
  try {
    // Resolved relative to this spec's directory.
    const shot = await page.screenshot({ path: '.results/split-task-spike.png' });
    captured = typeof shot === 'string' ? shot : 'test/probe/.results/split-task-spike.png';
  } catch (e) {
    captured = `screenshot unavailable: ${String(e)}`;
  }
  console.log(`[SPIKE] screenshot -> ${captured}`);
  try {
    await server.commands.writeFile(
      'test/probe/.results/spike-summary.json',
      `${JSON.stringify({ screenshot: captured }, null, 2)}\n`,
    );
  } catch {
    /* best effort */
  }
  expect(true).toBe(true);
});
