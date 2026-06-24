/**
 * U3 isolated-harness smoke (#161 perf plan): the `GanttPerfHost` mounts the real
 * `GanttContainer` over GENERATED data (graph → in-memory sources → real
 * controller → GanttData), renders bars in headless Chromium, and raises the
 * `data-render-complete` sentinel. Proves the obsidian shim + runes + alias +
 * the U3 pipeline feed the component correctly; the perf ASSERTIONS live in U4.
 */
import { test, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import GanttPerfHost from './GanttPerfHost.svelte';
import { buildGanttData } from '../generator/buildGanttData';
import { generate } from '../generator/generate';
import type { GenerateParams } from '../generator/graph';

/** A tiny graph: a handful of matched roots with Show-all children. */
function tinyParams(): GenerateParams {
  return {
    seed: 5,
    totalNotes: 60,
    taskCount: 40,
    matchedCount: 8,
    multiParentDist: [{ parents: 2, count: 3 }],
    maxDepth: 4,
    depDensity: 0.2,
    dateMix: { dated: 0.7, undated: 0.1, startOnly: 0.1, endOnly: 0.1 },
    cycleCount: 0,
    orphanCount: 1,
  };
}

async function mountTinyHost() {
  const { data } = await buildGanttData(generate(tinyParams()), { mode: 'show-all' });
  const screen = render(GanttPerfHost, { props: { data } });
  return screen.container as HTMLElement;
}

test('SMOKE: GanttPerfHost mounts generated data, renders bars, raises the sentinel', async () => {
  const container = await mountTinyHost();

  await vi.waitFor(
    () => {
      expect(container.querySelector('.og-perf-host[data-render-complete="true"]')).not.toBeNull();
    },
    { timeout: 10000, interval: 50 },
  );

  const bars = container.querySelectorAll('.wx-bar').length;
  const rows = container.querySelectorAll('.wx-row').length;
  console.log(`[U3 smoke] sentinel raised with .wx-bar=${bars} .wx-row=${rows}`);
  expect(bars).toBeGreaterThan(0);
});

test('read-only: the read-only banner renders (capabilities write=false)', async () => {
  const container = await mountTinyHost();

  await vi.waitFor(
    () => {
      expect(container.querySelector('.og-perf-host[data-render-complete="true"]')).not.toBeNull();
    },
    { timeout: 10000, interval: 50 },
  );

  expect(container.querySelector('.og-readonly-banner')).not.toBeNull();
});
