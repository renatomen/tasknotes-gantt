/**
 * U3 go/no-go SPIKE (#161 perf plan): can the REAL `GanttContainer` compile +
 * mount + render in headless Chromium via Vitest browser mode, with the
 * `obsidian` shim and Svelte-5 runes? If a `.wx-bar` appears, the whole
 * isolated-layer toolchain bet (KD1) is validated and U1–U7 can build on it.
 * If this fails, fall back to plain-Playwright-over-Vite-preview (KD1 reject)
 * or revisit KD5 — before investing in the generator + gate.
 *
 * This is a spike, not the U4 gate: it hand-builds a tiny GanttData (no
 * generator, no controller) and only asserts the component renders.
 */
import { test, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { writable } from 'svelte/store';
import GanttContainer from '../../../src/bases/GanttContainer.svelte';
import type { GanttData } from '../../../src/bases/types/gantt-view-data';
import type { RenderInstance } from '../../../src/controller/InstanceExpansion';
import { buildGridColumns, gridColumnsKey } from '../../../src/bases/gridColumns';

function minimalData(): GanttData {
  const instances: RenderInstance[] = [
    {
      id: 'a.md',
      sourcePath: 'a.md',
      text: 'Task A',
      start: new Date(2026, 0, 1),
      end: new Date(2026, 0, 10),
      progress: 50,
      isVirtual: false,
      isCollapsed: false,
      dateStatus: 'complete',
      status: null,
      isFetched: false,
    },
    {
      id: 'b.md',
      sourcePath: 'b.md',
      text: 'Task B',
      start: new Date(2026, 0, 5),
      end: new Date(2026, 0, 15),
      progress: 0,
      isVirtual: false,
      isCollapsed: false,
      dateStatus: 'complete',
      status: null,
      isFetched: false,
    },
  ];
  const gridColumns = buildGridColumns([], (id) => id, undefined, 'file.name');
  return {
    instances,
    links: [],
    capabilities: { write: false },
    arrowMode: 'primary',
    showDateIndicators: true,
    showToolbar: false,
    maxHeight: 400,
    minHeight: 112,
    contextOpacity: 0.5,
    statusColors: [],
    cascadeMode: 'ask',
    defaultScale: 'month',
    propertyValues: new Map(),
    gridColumns,
    gridColumnsKey: gridColumnsKey(gridColumns),
  };
}

test('SPIKE: real GanttContainer mounts and renders bars in headless Chromium', async () => {
  const data = writable(minimalData());

  const screen = render(GanttContainer, {
    props: {
      data,
      // Minimal app stub — themeMode:'light' skips the auto-theme subscription
      // that would otherwise touch the Obsidian workspace.
      app: {} as never,
      themeMode: 'light',
    },
  });

  const container = screen.container as HTMLElement;

  // SVAR's row window is set by an async effect after the clientHeight binding
  // flushes, so poll rather than reading synchronously.
  await vi.waitFor(
    () => {
      const bars = container.querySelectorAll('.wx-bar').length;
      expect(bars).toBeGreaterThan(0);
    },
    { timeout: 8000, interval: 100 },
  );

  const bars = container.querySelectorAll('.wx-bar').length;
  const rows = container.querySelectorAll('.wx-row').length;
  console.log(`[SPIKE] rendered .wx-bar=${bars} .wx-row=${rows} for 2 instances`);
  expect(bars).toBeGreaterThan(0);
});
