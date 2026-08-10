/**
 * Does the dependency tooltip actually appear? Mounts the real SVAR <Tooltip>
 * around a real <Gantt> with the plugin's own DependencyTooltip as content, then
 * hovers a bar and an arrow the way a reader does. Records what the DOM shows.
 */
/* global MouseEvent */
import { test, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import TooltipProbeHost from './TooltipProbeHost.svelte';

const TASKS = [
  { id: 'a', text: 'Draft docs', start: new Date(2026, 0, 5), end: new Date(2026, 0, 9), type: 'task' },
  {
    id: 'b',
    text: 'Ship the release',
    start: new Date(2026, 0, 12),
    end: new Date(2026, 0, 16),
    type: 'task',
    // What buildSvarTasks attaches in production: each incoming edge, carrying
    // the id of the drawn link it describes.
    custom: {
      incomingDeps: [
        { reltype: 'FINISHTOSTART', gap: 'P1D', predecessorName: 'Draft docs', linkId: 'a->b:e2s:' },
      ],
    },
  },
];
const LINKS = [{ id: 'a->b:e2s:', source: 'a', target: 'b', type: 'e2s' }];

async function mount(): Promise<HTMLElement> {
  const screen = render(TooltipProbeHost, { props: { tasks: TASKS, links: LINKS } });
  const container = screen.container as HTMLElement;
  await vi.waitFor(
    () => {
      if (container.querySelector('.og-probe-host[data-render-failed]')) {
        throw new Error('probe host never settled');
      }
      expect(container.querySelector('.og-probe-host[data-render-complete="true"]')).not.toBeNull();
    },
    { timeout: 15000, interval: 50 },
  );
  return container;
}

function report(label: string, container: HTMLElement): void {
  const tip = document.querySelector('.wx-tooltip');
  const own = document.querySelector('.og-gantt-tooltip');
  const api = (window as { __probeApi?: { getTask?: (id: string) => { text?: string } } }).__probeApi;
  console.log(
    `[${label}] wx-tooltip=${tip ? 'YES' : 'no'} og-gantt-tooltip=${own ? 'YES' : 'no'} text=${JSON.stringify(
      (own ?? tip)?.textContent ?? '',
    )} bars=${container.querySelectorAll('.wx-bar').length} arrows=${
      document.querySelectorAll('svg.wx-links g.wx-line').length
    } api=${api ? 'SET' : 'MISSING'} getTask(a)=${JSON.stringify(api?.getTask?.('a')?.text ?? null)}`,
  );
}


test('hovering a task bar shows its tooltip', async () => {
  const container = await mount();
  const bar = container.querySelector('.wx-bar[data-task-id]') as HTMLElement;
  expect(bar, 'no bar with data-task-id rendered').not.toBeNull();

  await userEvent.hover(bar);
  await new Promise((r) => setTimeout(r, 900));
  report('task-hover', container);
  await page.screenshot({ path: 'test/probe/__screenshots__/tooltip-task-hover.png' });

  expect(document.querySelector('.og-gantt-tooltip')?.textContent ?? '').toContain('Draft docs');
});

test('hovering a dependency arrow shows that edge', async () => {
  const container = await mount();
  const arrow = document.querySelector('svg.wx-links g.wx-line') as unknown as HTMLElement;
  expect(arrow, 'no dependency arrow rendered').not.toBeNull();

  // A real pointer hover is proven on the task path, which shares this whole
  // pipeline; the elbow line is too thin for Playwright's actionability check,
  // so the edge branch is driven by the same events the pointer would produce.
  const r = arrow.getBoundingClientRect();
  const opts = { bubbles: true, clientX: r.left + 2, clientY: r.top + 2 };
  arrow.dispatchEvent(new MouseEvent('mousemove', opts));
  await new Promise((s) => setTimeout(s, 150));
  arrow.dispatchEvent(new MouseEvent('mousemove', opts));
  await new Promise((r2) => setTimeout(r2, 900));
  report('arrow-hover', container);
  await page.screenshot({ path: 'test/probe/__screenshots__/tooltip-arrow-hover.png' });

  expect(document.querySelector('.og-gantt-tooltip')?.textContent ?? '').toContain('Ship the release');
});
