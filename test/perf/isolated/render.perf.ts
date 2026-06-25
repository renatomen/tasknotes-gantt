/**
 * U4 — Isolated render perf gate (Layer 1), the virtualization verdict (#161
 * perf plan). Mounts the REAL `GanttContainer` over generated data at increasing
 * instance counts in headless Chromium and measures the load-bearing metrics.
 *
 * Per KD4/KD7 the **primary hard-gate is the mount+settle TIMING ceiling** at
 * the production-scale (~2660) case — because 2.7.0 virtualizes in source, a
 * bounded window is the *expected* healthy result and cannot catch the predicted
 * model-build / per-instance-reactive freeze; only timing can. The DOM-node /
 * window-size check is retained as a **sanity assertion** (exact window, constant
 * across inputs) earning its power from the **negative control** (chart-area
 * height forced to 0 ⇒ the sentinel must refuse to fire, so a collapsed render
 * can never masquerade as a healthy bounded window).
 *
 * Seed 1 is calibrated (see the param sweep in the U4 build notes) to a clean
 * 31 / 980 / 3332-instance spread — the small / medium / #161-explosion points.
 */
import { test, expect, vi, beforeAll, afterAll } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { server } from 'vitest/browser';
import GanttPerfHost from './GanttPerfHost.svelte';
import { buildGanttData } from '../generator/buildGanttData';
import { generate } from '../generator/generate';
import { SVAR_CELL_HEIGHT } from '../../../src/bases/ganttHeight';
import { paramsForScale, type ScalePointName } from '../generator/presets';

/* global performance, requestAnimationFrame */

/**
 * ABSOLUTE mount+settle ceiling (ms) for the ~3332 case — the catastrophic
 * backstop. Calibrated from the first real runs (~520ms total in headless
 * Chromium for 3332 instances; virtualization holds, no freeze) at ~12× to
 * absorb slower CI runners while still failing the multi-second
 * model-build/reactive FREEZE this harness exists to catch. Finer
 * (e.g. 2×) regression detection is the U6 relative-trend gate's job, not this
 * absolute number's (KD4: two complementary gates).
 */
const SETTLE_CEILING_MS = 6000;

/**
 * Super-linear backstop: the largest case's total must stay within this multiple
 * of the MEDIUM case's total. Measured in the SAME run, so it is
 * environment-normalized (immune to runner speed). Medium (not small) is the
 * denominator deliberately — small is dominated by fixed mount cost, which
 * dilutes the ratio; medium's 980 instances have amortized that, so the ratio
 * tracks per-instance scaling between 980 and 3332. A linear regression is
 * mathematically capped near the 3332/980 ≈ 3.4 instance ratio, so this gate
 * fires only on SUPER-linear (≈O(N²) → ~11×) blowups; the bound sits between.
 * Constant-factor (linear) regressions in the sub-catastrophic band are the U6
 * relative-trend gate's job (compare to a stored baseline), inert until a
 * baseline exists — not something an in-run ratio or the absolute ceiling can
 * catch (KD4: two complementary gates).
 */
const SUPERLINEAR_RATIO = 6;

/**
 * Max overscan rows SVAR may materialize above the strict `ceil(chartHeight /
 * cellHeight)` window (2.7.0 keeps a small buffer — observed ~+4). The window
 * check stays robust to the exact buffer while still proving the row count is
 * bounded by the HOST, not the input (defeated virtualization would render
 * thousands).
 */
const WINDOW_OVERSCAN_MAX = 8;

/** Representative instance-count points (calibrated scale points, seed 1). */
const CASES: ReadonlyArray<{ label: ScalePointName }> = [
  { label: 'small' },
  { label: 'medium' },
  { label: 'large' },
];

/** The production-scale (#161 reproduction) case the timing gate fires on. */
const LARGE = CASES[2];

interface Measurement {
  label: string;
  instanceCount: number;
  rowCount: number;
  chartHeight: number;
  expectedWindow: number;
  buildMs: number;
  mountMs: number;
  settleMs: number;
  totalMs: number;
}

async function waitForSentinel(container: HTMLElement, timeout = 15000): Promise<void> {
  await vi.waitFor(
    () => {
      expect(
        container.querySelector('.og-perf-host[data-render-complete="true"]'),
      ).not.toBeNull();
    },
    { timeout, interval: 50 },
  );
}

/** Build → mount → settle one calibrated scale point, returning the metrics breakdown. */
async function measure(label: ScalePointName): Promise<Measurement> {
  const t0 = performance.now();
  const { data } = await buildGanttData(generate(paramsForScale(label)), { mode: 'show-all' });
  const tBuilt = performance.now();

  const screen = render(GanttPerfHost, { props: { data } });
  const container = screen.container as HTMLElement;
  const tMounted = performance.now();

  await waitForSentinel(container);
  const tSettled = performance.now();

  const chart = container.querySelector('.wx-chart') as HTMLElement | null;
  const chartHeight = chart?.clientHeight ?? 0;
  const rowCount = container.querySelectorAll('.og-bases-gantt .wx-row').length;
  const expectedWindow = Math.ceil(chartHeight / SVAR_CELL_HEIGHT) + 1;

  const m: Measurement = {
    label,
    instanceCount: data.instances.length,
    rowCount,
    chartHeight,
    expectedWindow,
    buildMs: tBuilt - t0,
    mountMs: tMounted - tBuilt,
    settleMs: tSettled - tMounted,
    totalMs: tSettled - t0,
  };
  // Structured line for the U6 trend artifact (asserted present, not thresholded
  // here beyond the absolute ceiling below).
  console.log(`[PERF-TREND] ${JSON.stringify(m)}`);
  return m;
}

let measured: Measurement[] = [];

beforeAll(async () => {
  measured = [];
  for (const c of CASES) measured.push(await measure(c.label));
}, 120000);

afterAll(async () => {
  // Best-effort wall-clock trend artifact for U6 (uploaded by CI, compared on a
  // future run for relative regression — inert until a baseline exists). A write
  // failure must never fail the gate, so swallow it.
  try {
    await server.commands.writeFile(
      'test/perf/.trend/isolated-latest.json',
      `${JSON.stringify({ measured }, null, 2)}\n`,
    );
  } catch {
    /* trend persistence is non-essential; the hard gates above are the real gate */
  }
});

test('PRIMARY: mount+settle cost at the ~3332 case stays under the absolute ceiling', () => {
  const large = measured.find((m) => m.label === LARGE.label) as Measurement;
  expect(large.instanceCount).toBeGreaterThan(2000); // production-scale (#161 explosion)
  console.log(
    `[PERF] large: ${large.instanceCount} instances, total ${large.totalMs.toFixed(0)}ms ` +
      `(build ${large.buildMs.toFixed(0)} / mount ${large.mountMs.toFixed(0)} / settle ${large.settleMs.toFixed(0)})`,
  );
  expect(large.totalMs).toBeLessThan(SETTLE_CEILING_MS);

  // Environment-normalized super-linear backstop (catches an O(N²) blowup that an
  // absolute ms ceiling tuned for a slow runner would let slip). Denominator is
  // the MEDIUM case — small is fixed-cost-dominated and dilutes the ratio.
  const medium = measured.find((m) => m.label === 'medium') as Measurement;
  expect(large.totalMs).toBeLessThan(medium.totalMs * SUPERLINEAR_RATIO);
});

test('SANITY: the materialized window is host-bounded and constant across 31/980/3332 inputs (virtualization holds)', () => {
  for (const m of measured) {
    // chartHeight>0 rules out the collapsed/num=1 transient masquerading as healthy
    // (the sentinel already enforces this; assert it as the measurement contract).
    expect(m.chartHeight).toBeGreaterThan(0);
    // Bounded by the HOST window (ceil(chartHeight/cell) + SVAR overscan), NOT the
    // input — a defeated virtualization would render ~instanceCount rows instead.
    const windowCeiling = Math.ceil(m.chartHeight / SVAR_CELL_HEIGHT) + WINDOW_OVERSCAN_MAX;
    expect(m.rowCount).toBeLessThanOrEqual(windowCeiling);
  }
  // The verdict: the row count does NOT scale with instance count — it stays within
  // a tiny band (SVAR's overscan buffer) across 31 / 980 / 3332 instances, not
  // byte-identical (the buffer can differ by a row between counts; coupling to
  // exact equality would flake without indicating a real regression).
  const windows = measured.map((m) => m.rowCount);
  expect(Math.max(...windows) - Math.min(...windows)).toBeLessThanOrEqual(WINDOW_OVERSCAN_MAX);
  // And it is genuinely a WINDOW: far below the materialized instance count.
  for (const m of measured.filter((x) => x.instanceCount > 100)) {
    expect(m.rowCount).toBeLessThan(m.instanceCount);
  }
  console.log(
    `[PERF] virtualization HOLDS — window=${windows[0]} rows constant across ` +
      `${measured.map((m) => m.instanceCount).join('/')} instances`,
  );
});

test('instance count is deterministic and matches the expected multi-parent expansion', async () => {
  const large = measured.find((m) => m.label === LARGE.label) as Measurement;
  // Re-build the same graph → identical count (catches expansion-multiplier regressions).
  const { data } = await buildGanttData(generate(paramsForScale(LARGE.label)), { mode: 'show-all' });
  expect(data.instances.length).toBe(large.instanceCount);
});

test('wall-clock trend metrics are present (captured for U6, not thresholded)', () => {
  for (const m of measured) {
    expect(m.totalMs).toBeGreaterThan(0);
    expect(Number.isFinite(m.buildMs + m.mountMs + m.settleMs)).toBe(true);
  }
});

test('NEGATIVE CONTROL: with chart-area height forced to 0, the sentinel never fires (the gate has power)', async () => {
  // Force the host region to collapse — the defeated-render failure mode. SVAR
  // then measures chartHeight=0 → num=1; the sentinel REQUIRES a non-zero height,
  // so it must refuse to fire. If it fired anyway, a collapsed render would pass
  // the window check as "healthy" — this proves it cannot.
  const style = document.createElement('style');
  style.textContent = '.og-chart-area { height: 0 !important; min-height: 0 !important; }';
  document.head.appendChild(style);
  try {
    const { data } = await buildGanttData(generate(paramsForScale(CASES[0].label)), {
      mode: 'show-all',
    });
    const screen = render(GanttPerfHost, { props: { data } });
    const container = screen.container as HTMLElement;

    // Give it ample time + frames; a healthy mount raises the sentinel in <1s.
    await new Promise<void>((resolve) => {
      let frames = 0;
      const spin = (): void => {
        frames += 1;
        if (frames > 60) resolve();
        else requestAnimationFrame(spin);
      };
      requestAnimationFrame(spin);
    });

    expect(
      container.querySelector('.og-perf-host[data-render-complete="true"]'),
    ).toBeNull();
    const chart = container.querySelector('.wx-chart') as HTMLElement | null;
    console.log(`[PERF] negative control: sentinel correctly withheld; chartHeight=${chart?.clientHeight ?? 0}`);
  } finally {
    style.remove();
  }
});
