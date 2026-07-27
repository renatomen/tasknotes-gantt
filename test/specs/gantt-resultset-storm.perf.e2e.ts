import { browser, expect, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { generate } from "../perf/generator/generate";
import { emitVault } from "../perf/generator/emitVault";
import { paramsForScale } from "../perf/generator/presets";
import type { GenerateParams } from "../perf/generator/graph";

/**
 * #161 — Automated repro of the view-option TOGGLE STORM (the production bug).
 *
 * The bug only reproduces with a specific config shape (confirmed by maintainer
 * triangulation on the real vault): a base whose Gantt resolves parents via a
 * Bases LINK property (`parentProperty: note.in`), so our `getTasks` does a bulk
 * `entry.getValue()` over a link field on every refresh. THAT read is what
 * re-pokes Bases into an `onDataUpdated` re-notify storm: a config-only toggle
 * (e.g. Hide-top) ignites a self-sustaining ~15s loop. A plain `projects`-based
 * vault does NOT storm (different read path) — which is why earlier synthetic
 * repros missed it.
 *
 * This spec emits that exact shape (`parentField:'in'` + multi-view storm base),
 * drives the confirmed trigger (`config.set` + `controller.onConfigChanged`), and
 * measures re-render churn. PRE-FIX (or with `__OG_DISABLE_REUSE`) it storms;
 * with the fix it settles. Marked `.perf.e2e.ts` (scheduled job only).
 */
const TASK_COUNT = Number(process.env.PERF_TASK_COUNT ?? 2000);
const TOTAL_NOTES = Number(process.env.PERF_TOTAL_NOTES ?? 4000);
const MATCHED_COUNT = Number(process.env.PERF_MATCHED_COUNT ?? 240);
const INDEX_TIMEOUT_MS = Number(process.env.PERF_INDEX_TIMEOUT_MS ?? 420000);
/** Set to force pre-fix behavior (always re-read) — for the fails-first control. */
const DISABLE_FIX = process.env.PERF_STORM_DISABLE_FIX === "1";
/**
 * Whether to boot WITH TaskNotes. Default OFF (standalone): in companion mode the
 * Gantt resolves parents via TaskNotes `projects` (absent in this synthetic vault,
 * which uses `note.in`), leaving `note.in` inert. Standalone makes the Gantt read
 * parents from `note.in` DIRECTLY via Bases `getValue` — the suspected link-read
 * trigger — and makes the Hide-top toggle meaningful.
 */
const WITH_TASKNOTES = process.env.PERF_STORM_TASKNOTES === "1";

function perfParams(): GenerateParams {
  return paramsForScale("large", {
    totalNotes: TOTAL_NOTES,
    taskCount: TASK_COUNT,
    matchedCount: MATCHED_COUNT,
  });
}

/** Drive the confirmed toggle trigger on the live gantt view + controller. */
async function fireToggle(
  value: boolean,
  key = "tngantt_hideTopLevelSubtasks",
): Promise<{ set: boolean; configChanged: boolean }> {
  return browser.executeObsidian(
    ({ app }, k, v) => {
      const ws = app.workspace as unknown as { iterateAllLeaves: (cb: (l: { view?: Record<string, unknown> }) => void) => void };
      const SKIP = new Set(["app", "vault", "workspace", "containerEl", "contentEl", "scope", "leaf", "headerEl", "navigation", "owner", "metadataCache"]);
      const seen = new Set<unknown>();
      let set = false; let configChanged = false;
      const visit = (obj: unknown, depth: number): void => {
        if (!obj || typeof obj !== "object" || seen.has(obj) || depth > 7) return;
        if ((obj as { nodeType?: number }).nodeType !== undefined) return;
        seen.add(obj);
        const rec = obj as Record<string, unknown>;
        const cfg = rec.config as { set?: (kk: string, vv: unknown) => void } | undefined;
        if (!set && cfg && typeof cfg.set === "function" && typeof rec.onDataUpdated === "function") { cfg.set(k, v); set = true; }
        if (!configChanged && typeof rec.onConfigChanged === "function") { try { (rec.onConfigChanged as () => void).call(rec); configChanged = true; } catch { /* ignore */ } }
        for (const ck of Object.keys(rec)) { if (SKIP.has(ck)) continue; let c: unknown; try { c = rec[ck]; } catch { continue; } if (c && typeof c === "object") visit(c, depth + 1); }
      };
      ws.iterateAllLeaves((l) => { if (l.view) visit(l.view, 0); });
      return { set, configChanged };
    },
    key,
    value,
  );
}

/**
 * Install the storm detectors (MutationObserver + [OGDBG] recompute counter), fire
 * a config-toggle, watch the storm window, then return the measured churn. Shared by
 * every row-visibility toggle case so each option proves the same no-storm contract.
 */
async function measureToggleStorm(
  key: string,
  value: boolean,
): Promise<{ mutations: number; recomputes: number; fired: { set: boolean; configChanged: boolean } }> {
  await browser.executeObsidian(() => {
    const w = window as unknown as { __stormMut?: number; __stormRecompute?: number; __stormOrig?: (...a: unknown[]) => void; __stormObs?: MutationObserver };
    w.__stormMut = 0;
    w.__stormRecompute = 0;
    (window as unknown as { __tnGanttDebug?: boolean }).__tnGanttDebug = true; // #161: enable gated [OGDBG] markers
    const root = document.querySelector(".og-bases-gantt");
    if (root) {
      const obs = new MutationObserver((muts) => { w.__stormMut! += muts.length; });
      obs.observe(root, { subtree: true, childList: true, attributes: true });
      w.__stormObs = obs;
    }
    const orig = console.log.bind(console); w.__stormOrig = orig;
    console.log = (...a: unknown[]) => {
      const s = a.map((x) => (typeof x === "string" ? x : "")).join(" ");
      if (s.includes("[OGDBG] recompute seq")) w.__stormRecompute! += 1;
      orig(...a);
    };
  });

  const fired = await fireToggle(value, key);
  await browser.pause(15000); // production churned ~15s

  const counts = await browser.executeObsidian(() => {
    const w = window as unknown as { __stormMut: number; __stormRecompute: number; __stormObs?: MutationObserver; __stormOrig?: (...a: unknown[]) => void };
    w.__stormObs?.disconnect();
    if (w.__stormOrig) console.log = w.__stormOrig;
    return { mutations: w.__stormMut, recomputes: w.__stormRecompute };
  });
  return { ...counts, fired };
}

describe("Gantt (OG) #161 — view-option toggle storm repro (note.in / multi-view)", function () {
  this.timeout(900000);
  let matchedTaskCount = 0;

  before(async function () {
    this.timeout(900000);
    const tmpVault = path.join(os.tmpdir(), "og-gantt-storm-repro");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    const graph = generate(perfParams());
    matchedTaskCount = graph.tasks.filter((t) => t.matched).length;
    // parentField:'in' + stormBase → the production-shaped config that storms.
    const result = await emitVault(graph, { outDir: tmpVault, parentField: "in", stormBase: true });
    console.log(`[STORM] generated ${result.notesWritten} notes, ${matchedTaskCount} matched → ${tmpVault}`);

    const plugins = WITH_TASKNOTES ? ["tasknotes-gantt", "tasknotes"] : ["tasknotes-gantt"];
    await browser.reloadObsidian({ vault: tmpVault, plugins });
    await browser.executeObsidian(async ({ app }) => {
      const ip = (app as unknown as { internalPlugins?: { getPluginById?: (id: string) => { enabled?: boolean; enable?: (o?: unknown) => unknown } | undefined; enablePluginAndSave?: (id: string) => unknown } }).internalPlugins;
      const bases = ip?.getPluginById?.("bases");
      if (bases && !bases.enabled) await (ip?.enablePluginAndSave?.("bases") ?? bases.enable?.({ reloadApp: false }));
    });
    if (WITH_TASKNOTES) {
      await browser.waitUntil(
        async () => browser.executeObsidian(async ({ app }) => {
          const tn = (app as unknown as { plugins?: { getPlugin?: (id: string) => unknown } }).plugins?.getPlugin?.("tasknotes") as { api?: { lifecycle?: { ready?: () => Promise<void> } } } | undefined;
          if (!tn?.api) return false;
          try { await tn.api.lifecycle?.ready?.(); return true; } catch { return false; }
        }),
        { timeout: INDEX_TIMEOUT_MS, interval: 2000, timeoutMsg: "TaskNotes API not ready" },
      );
    }
    // Cold-index gate (stabilization, robust to never-cached files).
    let prevCached = -1; let stableC = 0;
    await browser.waitUntil(
      async () => {
        const cached = await browser.executeObsidian(({ app }) => {
          const files = app.vault.getMarkdownFiles();
          let n = 0; for (const f of files) if (app.metadataCache.getFileCache(f) !== null) n += 1;
          return n;
        });
        stableC = cached > 0 && cached === prevCached ? stableC + 1 : 0;
        prevCached = cached;
        return stableC >= 3;
      },
      { timeout: INDEX_TIMEOUT_MS, interval: 5000, timeoutMsg: "cold index never stabilized" },
    );
    console.log(`[STORM] index stabilized at ${prevCached} cached files`);

    // Open the storm base + settle on the full bar count.
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getAbstractFileByPath("Generated.base");
      if (file) await app.workspace.getLeaf(true).openFile(file as never);
    });
    await browser.waitUntil(async () => (await $$(".og-bases-gantt .wx-bar")).length > 0, { timeout: 120000, interval: 500, timeoutMsg: "gantt did not render bars" });
    let prev = -1; let stable = 0;
    await browser.waitUntil(async () => {
      const n = (await $$(".og-bases-gantt .wx-bar")).length;
      stable = n > 0 && n === prev ? stable + 1 : 0;
      prev = n;
      return stable >= 4;
    }, { timeout: 120000, interval: 1500, timeoutMsg: "bar count never stabilized" });
    console.log(`[STORM] settled bars=${prev}`);
  });

  it("a Hide-top toggle does NOT ignite a re-render storm (#161)", async () => {
    // Optionally force pre-fix behavior for the fails-first control.
    if (DISABLE_FIX) {
      await browser.executeObsidian(() => { (window as unknown as { __OG_DISABLE_REUSE?: boolean }).__OG_DISABLE_REUSE = true; });
    }
    // Storm detectors: (1) a MutationObserver on the chart (OGDBG-independent —
    // each refresh re-applies a SVAR diff that mutates the windowed rows), and
    // (2) the [OGDBG] recompute counter (diagnostic).
    await browser.executeObsidian(() => {
      const w = window as unknown as { __stormMut?: number; __stormRecompute?: number; __stormOrig?: (...a: unknown[]) => void; __stormObs?: MutationObserver };
      w.__stormMut = 0;
      w.__stormRecompute = 0;
      (window as unknown as { __tnGanttDebug?: boolean }).__tnGanttDebug = true; // #161: enable gated [OGDBG] markers
      const root = document.querySelector(".og-bases-gantt");
      if (root) {
        const obs = new MutationObserver((muts) => { w.__stormMut! += muts.length; });
        obs.observe(root, { subtree: true, childList: true, attributes: true });
        w.__stormObs = obs;
      }
      const orig = console.log.bind(console); w.__stormOrig = orig;
      console.log = (...a: unknown[]) => {
        const s = a.map((x) => (typeof x === "string" ? x : "")).join(" ");
        if (s.includes("[OGDBG] recompute seq")) w.__stormRecompute! += 1;
        orig(...a);
      };
    });

    // Fire the confirmed toggle trigger.
    const fired = await fireToggle(true);
    expect(fired.set && fired.configChanged).toBe(true); // wiring reached the view

    // Watch the storm window (production churned ~15s).
    await browser.pause(15000);

    const counts = await browser.executeObsidian(() => {
      const w = window as unknown as { __stormMut: number; __stormRecompute: number; __stormObs?: MutationObserver; __stormOrig?: (...a: unknown[]) => void };
      w.__stormObs?.disconnect();
      if (w.__stormOrig) console.log = w.__stormOrig;
      return { mutations: w.__stormMut, recomputes: w.__stormRecompute };
    });
    console.log(`[STORM] disableFix=${DISABLE_FIX} matched=${matchedTaskCount} → ${JSON.stringify(counts)}`);

    // A single toggle should yield a small bounded number of recomputes. The storm
    // produces dozens (re-notify loop for ~15s). These bounds fail on the storm —
    // so PRE-FIX (PERF_STORM_DISABLE_FIX=1) this MUST fail, proving the repro.
    expect(counts.recomputes).toBeLessThanOrEqual(8);
    // Chart still alive + bounded window (no freeze/crash).
    expect((await $$(".og-bases-gantt .wx-bar")).length).toBeGreaterThan(0);
  });

  it("a Show-undated toggle does NOT ignite a re-render storm (#161 U5 — same contract as Hide-top)", async () => {
    // The residual per-option loop: Show-undated used to be baked into the instance
    // derivation, so toggling it changed the array and churned even after Hide-top
    // was fixed. Now it's a presentation-layer filter-tasks predicate over the STABLE
    // array (U1–U4) — toggling it must be a content-NOOP for the sync, exactly like
    // Hide-top. This test fires the SAME trigger on the show-undated key and asserts
    // the SAME bounded-recompute / chart-alive contract.
    const { recomputes, fired } = await measureToggleStorm("tngantt_showUndatedTasks", false);
    expect(fired.set && fired.configChanged).toBe(true); // wiring reached the view
    expect(recomputes).toBeLessThanOrEqual(8);
    expect((await $$(".og-bases-gantt .wx-bar")).length).toBeGreaterThan(0);
  });
});
