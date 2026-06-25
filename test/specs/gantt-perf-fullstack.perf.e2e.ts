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
 * COLD-INDEX NOTE: the vault is regenerated every run (rmSync below), so
 * Obsidian's metadataCache scan + TaskNotes' index build are ALWAYS cold —
 * minutes for a multi-thousand-note vault. An earlier version started the render
 * clock before indexing finished and timed out mid-scan, which looked like (but
 * was NOT) a render freeze. The `before` hook now waits out indexing
 * (TaskNotes `lifecycle.ready()` + every markdown file resolved in the
 * metadataCache) SEPARATELY, then measures render against a tight budget — so a
 * render-budget timeout here is a real render problem (the #161 freeze), cleanly
 * distinguished from cold-scan latency. Root-causing any genuine render hang at
 * scale remains the deferred "fix #161 / P2" follow-up.
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
 * Cold-index budget. The vault is regenerated every run (rmSync below), so
 * Obsidian's metadataCache scan + TaskNotes' index build are ALWAYS cold —
 * minutes for a multi-thousand-note vault, sub-second once warm (which never
 * happens here). We wait out the cold scan SEPARATELY from the render so the
 * render measurement isn't contaminated by index latency.
 */
const INDEX_TIMEOUT_MS = Number(process.env.PERF_INDEX_TIMEOUT_MS ?? 420000);

/**
 * Render budget — TIGHT, because indexing is already complete when the render
 * clock starts. A hang here is a real render problem (the #161 freeze), not a
 * cold scan. This is the measurement that actually means something.
 */
const RENDER_TIMEOUT_MS = Number(process.env.PERF_RENDER_TIMEOUT_MS ?? 60000);

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

    // ---- Wait out COLD indexing BEFORE the render clock (the fix) ----
    // The vault is regenerated every run, so the metadataCache scan + TaskNotes
    // index build are always cold. If we opened the base now and timed it, we'd
    // be measuring the cold scan, not the render. Gate on indexing-complete
    // first, then measure render against a tight budget.
    const indexStart = Date.now();

    // Step 1: TaskNotes API up (pattern from gantt-dependency-types.e2e.ts).
    await browser.waitUntil(
      async () =>
        browser.executeObsidian(async ({ app }) => {
          const tn = (app as unknown as { plugins?: { getPlugin?: (id: string) => unknown } }).plugins?.getPlugin?.("tasknotes") as
            | { api?: { lifecycle?: { ready?: () => Promise<void> } } }
            | undefined;
          if (!tn?.api) return false;
          try {
            await tn.api.lifecycle?.ready?.();
            return true;
          } catch {
            return false;
          }
        }),
      { timeout: INDEX_TIMEOUT_MS, interval: 1000, timeoutMsg: "TaskNotes API did not become ready" }
    );

    // Step 2: Obsidian's cold metadataCache scan finished — every markdown file
    // has a resolved cache entry (getFileCache stays null until indexed). This is
    // the multi-minute cold scan; bars cannot resolve until it completes.
    await browser.waitUntil(
      async () =>
        browser.executeObsidian(({ app }) => {
          const files = app.vault.getMarkdownFiles();
          if (files.length === 0) return false;
          return files.every((f) => app.metadataCache.getFileCache(f) !== null);
        }),
      { timeout: INDEX_TIMEOUT_MS, interval: 1000, timeoutMsg: "metadataCache cold scan did not finish in time" }
    );
    const indexMs = Date.now() - indexStart;
    console.log(`[PERF-E2E] cold index complete in ${indexMs}ms (${result.notesWritten} notes)`);

    // ---- Now measure RENDER against a tight budget ----
    const renderStart = Date.now();
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getAbstractFileByPath("Generated.base");
      if (file) {
        await app.workspace.getLeaf(true).openFile(file as never);
      }
    });
    await browser.waitUntil(
      async () => (await $$(".og-bases-gantt .wx-bar")).length > 0,
      {
        timeout: RENDER_TIMEOUT_MS,
        timeoutMsg: `Indexing finished but the Gantt rendered no bars within ${RENDER_TIMEOUT_MS}ms — a real render problem (the #161 freeze), not a cold scan.`,
      }
    );
    firstRenderMs = Date.now() - renderStart;
    console.log(`[PERF-E2E] time-to-first-render (post-index): ${firstRenderMs}ms`);
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
