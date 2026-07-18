/**
 * Spike proof: a hand-rolled bar template renders SVAR-style split-task segments
 * — spaced sub-bars in one row — against the MIT build, with no Obsidian.
 * Captures a screenshot so the result can be judged visually.
 */
import { test, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, server } from 'vitest/browser';
import SegmentsProbeHost from './SegmentsProbeHost.svelte';

/* eslint-disable @typescript-eslint/no-explicit-any */
/* global Element, getComputedStyle */

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

function boxOf(el: Element): { left: number; width: number } {
  const style = (el as HTMLElement).style;
  return { left: parseFloat(style.left || '0'), width: parseFloat(style.width || '0') };
}

test('a split task renders one sub-bar per segment inside a single row', async () => {
  const container = await mount(SPLIT_TASK);

  const rows = container.querySelectorAll('.wx-row');
  const outerBars = container.querySelectorAll('.wx-bars > .wx-bar');
  const segments = container.querySelectorAll('.wx-segment');

  console.log(
    `[SPIKE] rows=${rows.length} outerBars=${outerBars.length} segments=${segments.length}`,
  );

  expect(outerBars.length).toBe(1); // one row, one bar
  expect(segments.length).toBe(2); // drawn as two pieces
});

test('segments are index-addressable and visibly spaced', async () => {
  const container = await mount(SPLIT_TASK);
  const segments = Array.from(container.querySelectorAll('.wx-segment'));

  expect(segments.map((s) => s.getAttribute('data-segment'))).toEqual(['0', '1']);

  const first = boxOf(segments[0]);
  const second = boxOf(segments[1]);
  console.log(`[SPIKE] segment boxes: ${JSON.stringify([first, second])}`);

  expect(first.width).toBeGreaterThan(0);
  expect(second.width).toBeGreaterThan(0);
  // The gap is the whole point: piece two starts after piece one ends.
  expect(second.left).toBeGreaterThan(first.left + first.width);
});

test('the dashed connector runs behind the segments', async () => {
  const container = await mount(SPLIT_TASK);
  const segmentsBox = container.querySelector('.wx-segments') as HTMLElement;
  expect(segmentsBox).not.toBeNull();

  const before = getComputedStyle(segmentsBox, '::before');
  console.log(`[SPIKE] connector borderTop=${before.borderTopStyle} ${before.borderTopWidth}`);
  expect(before.borderTopStyle).toBe('dashed');
});

test('the outer bar is blanked while the segments keep their fill', async () => {
  const container = await mount(SPLIT_TASK);
  const outer = container.querySelector('.wx-bars > .wx-bar') as HTMLElement;
  const segment = container.querySelector('.wx-segment') as HTMLElement;

  const outerBg = getComputedStyle(outer).backgroundColor;
  const segmentBg = getComputedStyle(segment).backgroundColor;
  console.log(`[SPIKE] outerBg=${outerBg} segmentBg=${segmentBg}`);

  // Fully transparent outer body, opaque segments.
  expect(outerBg === 'rgba(0, 0, 0, 0)' || outerBg === 'transparent').toBe(true);
  expect(segmentBg).not.toBe('rgba(0, 0, 0, 0)');
});

test("SVAR's own whole-bar progress fill is suppressed on a segmented bar", async () => {
  const container = await mount(SPLIT_TASK);
  const outer = container.querySelector('.wx-bars > .wx-bar') as HTMLElement;

  // SVAR renders this because `splitTasks` is forced false in the MIT build; it
  // would otherwise paint a fill spanning the WHOLE bar under our segments.
  const outerFill = outer.querySelector(':scope > .wx-progress-wrapper');
  const visible = outerFill ? getComputedStyle(outerFill).display !== 'none' : false;
  console.log(`[SPIKE] outer progress wrapper present=${!!outerFill} visible=${visible}`);
  expect(visible).toBe(false);

  // The per-segment fills must survive.
  expect(container.querySelectorAll('.wx-segment .wx-progress-percent').length).toBe(2);
});

test('progress fills the earlier segment before the later one', async () => {
  const container = await mount(SPLIT_TASK);
  const fills = Array.from(container.querySelectorAll('.wx-segment .wx-progress-percent'));
  const widths = fills.map((f) => (f as HTMLElement).style.width);
  console.log(`[SPIKE] progress fills=${JSON.stringify(widths)}`);

  expect(fills.length).toBe(2);
  // 40% of 10 duration units = 4 units = exactly the first segment.
  expect(parseFloat(widths[0])).toBe(100);
  expect(parseFloat(widths[1])).toBe(0);
});

test('an unsegmented task is untouched — one ordinary bar, no segments container', async () => {
  const container = await mount(PLAIN_TASK);

  expect(container.querySelectorAll('.wx-bar').length).toBe(1);
  expect(container.querySelector('.wx-segments')).toBeNull();
  expect(container.querySelector('.wx-segment')).toBeNull();

  const outer = container.querySelector('.wx-bar') as HTMLElement;
  // The :has() rule must not blank an ordinary bar.
  expect(getComputedStyle(outer).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
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
