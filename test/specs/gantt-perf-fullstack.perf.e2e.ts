import { browser, expect, $, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { generate } from "../perf/generator/generate";
import { emitVault } from "../perf/generator/emitVault";
import { paramsForScale } from "../perf/generator/presets";
import type { GenerateParams } from "../perf/generator/graph";

/**
 * U5 — Full-stack perf spec (Layer 2, #161 perf plan). The slow/fidelity layer:
 * GENERATES a large production-shaped vault (U1/U2) into a temp dir, boots real
 * Obsidian with TaskNotes enabled, opens the generated `.base`, and asserts the
 * SAME deterministic virtualization verdict the isolated gate (U4) reaches — but
 * in the real Electron embed, where the production freeze (and the F2 `Illegal
 * invocation` bug) actually live. A green isolated gate is strong-but-not-final;
 * THIS layer is the only one that confirms the real-embed verdict.
 *
 * Marked `.perf.e2e.ts` so it is EXCLUDED from the per-PR `e2e` run (wdio.conf
 * exclude) and runs only via the scheduled perf job (wdio.perf.conf, KD5).
 *
 * Assertions are structural (row count, host size) + a logged wall-clock — never
 * pixel/feel/timing-precise (WDIO can't measure feel; wall-clock is noisy).
 *
 * FIRST-RUN FINDING (2026-06-25): on its first real local runs (400 and 2000
 * tasks, Node 20), the generated vault did NOT render any `.wx-bar` within a
 * generous 150–240s in real Obsidian + TaskNotes — far beyond indexing latency,
 * while the 5-note companion fixture renders the same Show-all+TaskNotes path
 * fine. The generated vault is structurally correct (verified), so the cost is
 * the real-embed render / TaskNotes-relationship resolution at scale over the
 * generated graph (cycles/orphans/multi-parent) — i.e. either the Electron-
 * specific #161 freeze this harness exists to surface, or a generator-fidelity
 * gap. Root-causing it is the deferred "fix #161 / P2" follow-up (plan Scope
 * Boundaries); this spec is the instrument that surfaces it, run on a schedule.
 *
 * SELECTOR NOTE: `.og-bases-gantt` is this plugin's stable root; `.wx-bar` /
 * `.wx-row` are SVAR's chart bar / row.
 */

// Vault scale — overridable so the scheduled job can push to the full ~10k/~5k
// production shape; defaults stay CI-runnable without a 10-minute index wait.
const TASK_COUNT = Number(process.env.PERF_TASK_COUNT ?? 2000);
const TOTAL_NOTES = Number(process.env.PERF_TOTAL_NOTES ?? 4000);
const MATCHED_COUNT = Number(process.env.PERF_MATCHED_COUNT ?? 70);

/** Default chart-host cap (the emitter's `.base` omits the override → 400). */
const MAX_HEIGHT = 400;
/** Upper bound on materialized rows: a healthy window is ~15; way below any scale. */
const WINDOW_ROW_BOUND = 60;

/**
 * Indexing a multi-thousand-note vault before Bases can open plausibly needs
 * 2–5× the 60s `.wx-bar` wait the smaller fixtures use; fail fast with a clear
 * message if it blows past.
 */
const RENDER_TIMEOUT_MS = Number(process.env.PERF_RENDER_TIMEOUT_MS ?? 240000);

function perfParams(): GenerateParams {
  // The calibrated #161-explosion shape (shared with the isolated gate), with the
  // scale env-overridable so the scheduled job can push to the full ~10k/~5k shape.
  return paramsForScale("large", {
    totalNotes: TOTAL_NOTES,
    taskCount: TASK_COUNT,
    matchedCount: MATCHED_COUNT,
  });
}

/**
 * Poll the materialized `.wx-row` count until it is stable across two consecutive
 * samples (the real-embed analogue of GanttPerfHost's settle sentinel), so the
 * virtualization verdict is taken on the settled DOM rather than a transient
 * mid-expansion count. Returns the settled count.
 */
async function settledRowCount(): Promise<number> {
  let prev = -1;
  let stable = 0;
  await browser.waitUntil(
    async () => {
      const n = (await $$(".og-bases-gantt .wx-row")).length;
      const ok = n > 0 && n === prev;
      stable = ok ? stable + 1 : 0;
      prev = n;
      return stable >= 2;
    },
    { timeout: 30000, interval: 250, timeoutMsg: "row count never stabilized" }
  );
  return (await $$(".og-bases-gantt .wx-row")).length;
}

describe("Gantt (OG) full-stack perf — generated large vault", () => {
  let firstRenderMs = 0;

  before(async () => {
    // Generate a fresh production-shaped vault into a disposable temp dir.
    const tmpVault = path.join(os.tmpdir(), "og-gantt-perf-fullstack");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    const result = await emitVault(generate(perfParams()), { outDir: tmpVault });
    console.log(`[PERF-E2E] generated ${result.notesWritten} notes → ${tmpVault}`);

    // Boot Obsidian with TaskNotes ENABLED (companion relationships drive the
    // Show-all explosion the spec reproduces).
    await browser.reloadObsidian({
      vault: tmpVault,
      plugins: ["tasknotes-gantt", "tasknotes"],
    });

    // Rendering a `.base` requires the Bases core plugin enabled.
    await browser.executeObsidian(async ({ app }) => {
      const ip = (app as unknown as { internalPlugins?: {
        getPluginById?: (id: string) => { enabled?: boolean; enable?: (o?: unknown) => unknown } | undefined;
        enablePluginAndSave?: (id: string) => unknown;
      } }).internalPlugins;
      const bases = ip?.getPluginById?.("bases");
      if (bases && !bases.enabled) {
        await (ip?.enablePluginAndSave?.("bases") ?? bases.enable?.({ reloadApp: false }));
      }
    });

    const start = Date.now();
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getAbstractFileByPath("Generated.base");
      if (file) {
        await app.workspace.getLeaf(true).openFile(file as never);
      }
    });

    // A 10k-note vault needs TaskNotes to finish indexing before Bases opens —
    // generous wait, clear failure message if indexing exceeds it.
    await browser.waitUntil(
      async () => (await $$(".og-bases-gantt .wx-bar")).length > 0,
      {
        timeout: RENDER_TIMEOUT_MS,
        timeoutMsg: `Generated .base did not render any task bars within ${RENDER_TIMEOUT_MS}ms (TaskNotes indexing too slow?)`,
      }
    );
    firstRenderMs = Date.now() - start;
    console.log(`[PERF-E2E] time-to-first-render: ${firstRenderMs}ms`);
  });

  it("opens the generated base and shows the matched set without freezing", async () => {
    const bars = (await $$(".og-bases-gantt .wx-bar")).length;
    expect(bars).toBeGreaterThan(0);
  });

  it("virtualization HOLDS in the real embed: materialized rows stay bounded, not scaling with instances", async () => {
    // The production-faithful verdict (U4's isolated check, now in Electron). If
    // the embed defeated virtualization the row count would scale into the
    // hundreds/thousands — the prime P2 suspect.
    //
    // Take the verdict on the SETTLED DOM, not the first paint: companion Show-all
    // expansion + SVAR windowing populate incrementally, so reading immediately
    // after the first bar could sample a transient low count and pass falsely.
    // Mirror the isolated host's sentinel — poll until the row count is stable
    // across consecutive samples before asserting the bound.
    const rows = await settledRowCount();
    console.log(`[PERF-E2E] settled materialized .wx-row count: ${rows}`);
    expect(rows).toBeGreaterThan(0);
    expect(rows).toBeLessThanOrEqual(WINDOW_ROW_BOUND);
  });

  it("resolves the host to the bounded max-height, not 0 or content-height", async () => {
    const el = await $(".og-bases-gantt");
    const size = await el.getSize();
    expect(size.height).toBeGreaterThan(0);
    expect(size.height).toBeLessThanOrEqual(MAX_HEIGHT + 5);
  });

  it("captures time-to-first-render for the trend (not gated)", () => {
    expect(firstRenderMs).toBeGreaterThan(0);
  });
});
