import { browser, expect, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * The DYNAMIC #161 trigger (P1 re-render LOOP) in the real Electron embed.
 *
 * The perf harness (isolated U4 + full-stack U5) proves a one-shot STATIC render
 * of the expanded set is fine even past production scale. By construction it
 * cannot exercise a re-render LOOP driven by a resultset-changing view-option
 * toggle — Bases re-running `onDataUpdated` in a burst (with the persisted value
 * momentarily oscillating) while it persists+reloads its config. That dynamic
 * feedback is the trigger #161 actually rode; this spec drives it and asserts the
 * view SETTLES instead of running away. (See
 * docs/solutions/developer-experience/match-harness-execution-model-to-bug-trigger.md.)
 *
 * Loop ≠ scale: the feedback that loops is independent of instance count, so this
 * runs on the small `gantt-companion` fixture (fast, no multi-minute cold index)
 * rather than a generated production vault — the right level for the loop
 * regression (test-at-the-fastest-level). The "is the freeze dynamic at scale"
 * question is separate and belongs to the perf layer.
 *
 * Counter discipline mirrors `gantt-theme-toggle-loop.e2e.ts`: count the plugin's
 * `[OGDBG]` recompute/coalescer lines after the toggle. Pre-fix these climbed
 * unbounded; post-fix the 500ms debounce + `isConnected` skip + idempotent
 * recompute collapse each toggle's burst into a bounded handful. The DOM-settle
 * assertion is the black-box "did not freeze" half — a loop never quiesces.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-companion");

/**
 * Force the OG Gantt to be the ACTIVE, visible leaf (self-healing — TaskNotes'
 * first-run "Start Here" note can steal the active leaf and unmount the Bases
 * view). Mirror of the expansion-sorting/dependency specs; idempotent + cheap.
 */
async function activateBaseLeaf(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    const ws = app.workspace as unknown as {
      iterateAllLeaves: (cb: (l: { view?: { getViewType?: () => string }; detach?: () => void }) => void) => void;
      getLeavesOfType: (t: string) => unknown[];
      getLeaf: (newLeaf?: boolean) => { openFile: (f: unknown) => Promise<void> };
      setActiveLeaf: (l: unknown, opts?: { focus?: boolean }) => void;
      revealLeaf: (l: unknown) => void;
    };
    const markdownLeaves: Array<{ detach?: () => void }> = [];
    ws.iterateAllLeaves((l) => {
      if (l.view?.getViewType?.() === "markdown") markdownLeaves.push(l);
    });
    markdownLeaves.forEach((l) => l.detach?.());

    let baseLeaf = ws.getLeavesOfType("bases")[0];
    if (!baseLeaf) {
      const file = app.vault.getAbstractFileByPath("Companion.base");
      if (!file) return;
      const leaf = ws.getLeaf(true);
      await leaf.openFile(file as never);
      baseLeaf = leaf;
    }
    ws.setActiveLeaf(baseLeaf, { focus: true });
    ws.revealLeaf(baseLeaf);
  });
}

/** Count rendered Gantt bars (the chart's liveness signal). */
async function barCount(): Promise<number> {
  return (await $$(".og-bases-gantt .wx-bar")).length;
}

/** Wait until the bar count is stable across consecutive samples (settled DOM). */
async function waitSettled(timeout = 20000): Promise<number> {
  let prev = -1;
  let stable = 0;
  await browser.waitUntil(
    async () => {
      const n = await barCount();
      const ok = n > 0 && n === prev;
      stable = ok ? stable + 1 : 0;
      prev = n;
      return stable >= 2;
    },
    { timeout, interval: 250, timeoutMsg: "Gantt bar count never stabilized (a sign of a re-render loop)" },
  );
  return barCount();
}

/**
 * Drive a rapid resultset-change BURST on the LIVE gantt view, faithfully
 * reproducing the #161 trigger. A bare `config.set` does NOT make Bases re-run
 * (the loop came from Bases' OWN persist/reload firing `onDataUpdated`), so for
 * each step we set the option the view reads AND call the view's `onDataUpdated`
 * — exactly what Bases does on a toolbar toggle, and the same refresh entry the
 * column-sort spec drives. The whole burst runs INSIDE one renderer call so every
 * fire lands within the 500ms debounce window (separate WDIO round-trips are
 * >500ms apart and would never collapse), letting us replay the documented value
 * oscillation (e.g. `true→true→false`) as one burst.
 *
 * `getLeavesOfType("bases")` returns the outer container leaf; our `obsidianGantt`
 * BasesView (which owns `config.set` + `onDataUpdated`) is found by a bounded BFS
 * for that shape. Returns how many views we drove (0 ⇒ wiring broke) + a structure
 * dump, so a wiring regression fails loudly instead of passing vacuously.
 */
async function driveBurst(
  key: string,
  values: unknown[],
): Promise<{ count: number; structure: unknown }> {
  return browser.executeObsidian(
    ({ app }, k, vals) => {
      const ws = app.workspace as unknown as {
        getLeavesOfType: (t: string) => Array<{ view?: Record<string, unknown> }>;
      };
      const SKIP = new Set([
        "app", "vault", "workspace", "containerEl", "contentEl", "scope",
        "leaf", "headerEl", "navigation", "owner", "metadataCache",
      ]);
      const structure: Array<{ depth: number; key: string; hasConfigSet: boolean; hasOnDataUpdated: boolean; viewType?: string }> = [];
      let count = 0;
      const seen = new Set<unknown>();

      // Bounded BFS for our gantt BasesView: it exposes both `config.set` and
      // `onDataUpdated`. Skips DOM nodes + the known-huge app/vault/workspace
      // graphs so it never traverses the whole app.
      const findView = (obj: unknown, depth: number, label: string): Record<string, unknown> | null => {
        if (!obj || typeof obj !== "object" || seen.has(obj) || depth > 5) return null;
        if ((obj as { nodeType?: number }).nodeType !== undefined) return null; // DOM node
        seen.add(obj);
        const rec = obj as Record<string, unknown>;
        const cfg = rec.config as { set?: unknown } | undefined;
        const hasConfigSet = !!cfg && typeof cfg.set === "function";
        const hasOnDataUpdated = typeof rec.onDataUpdated === "function";
        const viewType = typeof rec.getViewType === "function" ? (rec.getViewType as () => string)() : undefined;
        structure.push({ depth, key: label, hasConfigSet, hasOnDataUpdated, viewType });
        if (hasConfigSet && hasOnDataUpdated) return rec;
        for (const childKey of Object.keys(rec)) {
          if (SKIP.has(childKey)) continue;
          let child: unknown;
          try {
            child = rec[childKey];
          } catch {
            continue;
          }
          if (child && typeof child === "object") {
            const found = findView(child, depth + 1, `${label}.${childKey}`);
            if (found) return found;
          }
        }
        return null;
      };

      for (const leaf of ws.getLeavesOfType("bases")) {
        if (!leaf.view) continue;
        const view = findView(leaf.view, 0, "leaf.view");
        if (!view) continue;
        const set = (view.config as { set: (kk: string, vv: unknown) => void }).set;
        const onDataUpdated = view.onDataUpdated as () => void;
        // The burst: set + notify per value, synchronously (one debounce window).
        for (const v of vals as unknown[]) {
          set.call(view.config, k, v);
          onDataUpdated.call(view);
        }
        count += 1;
      }
      return { count, structure };
    },
    key,
    values,
  );
}

/** Install a counter over the plugin's `[OGDBG]` loop-diagnostic logs. */
async function installCounter(): Promise<void> {
  await browser.executeObsidian(() => {
    const w = window as unknown as {
      __ogCounts?: Record<string, number>;
      __ogOrigLog?: (...a: unknown[]) => void;
    };
    w.__ogCounts = { onDataUpdated: 0, recompute: 0, coalescer: 0, mount: 0 };
    const orig = console.log.bind(console);
    w.__ogOrigLog = orig;
    console.log = (...args: unknown[]) => {
      try {
        const s = args.map((a) => (typeof a === "string" ? a : "")).join(" ");
        if (s.includes("[OGDBG] onDataUpdated")) w.__ogCounts!.onDataUpdated++;
        else if (s.includes("[OGDBG] recompute seq")) w.__ogCounts!.recompute++;
        else if (s.includes("[OGDBG] coalescer fired")) w.__ogCounts!.coalescer++;
        else if (s.includes("First data event")) w.__ogCounts!.mount++;
      } catch {
        /* ignore */
      }
      orig(...args);
    };
  });
}

async function readCounts(): Promise<Record<string, number>> {
  return browser.executeObsidian(
    () => (window as unknown as { __ogCounts: Record<string, number> }).__ogCounts,
  );
}

async function restoreLog(): Promise<void> {
  await browser.executeObsidian(() => {
    const w = window as unknown as { __ogOrigLog?: (...a: unknown[]) => void };
    if (w.__ogOrigLog) console.log = w.__ogOrigLog;
  });
}

/**
 * Upper bound on debounced refreshes for a test that does two view-option
 * toggles. Each `config.set` makes Bases persist+reload and REMOUNT the view, so
 * a handful of debounced refreshes per toggle is the expected (bounded) cost —
 * observed ~4/toggle. The #161 LOOP was *unbounded* continuous re-rendering, so
 * any bounded count passes; this bound only fails a runaway. The PRIMARY loop
 * detector is `waitSettled` (a runaway never quiesces); this is the secondary,
 * deliberately generous, runaway-vs-bounded discriminator.
 */
const BOUNDED_REFRESH_MAX = 20;

/**
 * Assert the dynamic resultset change settled without looping: the DOM quiesced
 * (already awaited by the caller via `waitSettled` — the hard gate), the path
 * actually executed (≥1 recompute), and the refresh count stayed bounded (no
 * runaway). Counts are logged for the trend regardless of pass/fail.
 */
function assertBoundedNoLoop(counts: Record<string, number>, label: string): void {
  console.log(`[RESULTSET-LOOP] ${label}: ${JSON.stringify(counts)}`);
  expect(counts.recompute).toBeGreaterThanOrEqual(1); // the dynamic path ran
  expect(counts.coalescer).toBeLessThanOrEqual(BOUNDED_REFRESH_MAX);
  expect(counts.recompute).toBeLessThanOrEqual(BOUNDED_REFRESH_MAX);
}

describe("Gantt (OG) resultset-change — no re-render loop (#161 P1)", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-resultset-loop-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({ vault: tmpVault, plugins: ["tasknotes-gantt", "tasknotes"] });

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

    // TaskNotes API up.
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
      { timeout: 60000, interval: 1000, timeoutMsg: "TaskNotes API did not become ready" },
    );

    // De-flake gate: subtask relationships resolved (the open-time snapshot reads
    // them; opening before they resolve renders an unexpanded tree).
    await browser.waitUntil(
      async () =>
        browser.executeObsidian(async ({ app }) => {
          const tn = (app as unknown as { plugins?: { getPlugin?: (id: string) => unknown } }).plugins?.getPlugin?.("tasknotes") as
            | { api?: { relationships?: { subtasks?: (p: string) => Promise<Array<{ path?: string }>> | Array<{ path?: string }> } } }
            | undefined;
          const subtasks = tn?.api?.relationships?.subtasks;
          if (!subtasks) return false;
          try {
            const a = await subtasks("Project A.md");
            return Array.isArray(a) && a.length >= 2;
          } catch {
            return false;
          }
        }),
      { timeout: 60000, interval: 1000, timeoutMsg: "TaskNotes subtask relationships did not resolve" },
    );

    // Open + render the Gantt (Show-all → the expanded set is present).
    await browser.waitUntil(
      async () => {
        await activateBaseLeaf();
        return (await barCount()) > 0;
      },
      { timeout: 90000, interval: 500, timeoutMsg: "Companion Gantt did not render any bars" },
    );
    await waitSettled();
  });

  it("collapses a hide-top-level oscillation burst into a settled, bounded refresh (the documented #161 trigger)", async () => {
    const baselineBars = await waitSettled();
    expect(baselineBars).toBeGreaterThan(0);

    await installCounter();

    // Replay the documented oscillation burst (bug report §14): true→true→false
    // fired rapidly within one debounce window, exactly as Bases re-runs the view
    // during a view-option persist+reload. The 500ms debounce must collapse the
    // whole burst into ONE trailing refresh against the settled value.
    const burst = await driveBurst("tngantt_hideTopLevelSubtasks", [true, true, false]);
    if (burst.count === 0) {
      console.log(`[RESULTSET-LOOP] could not reach gantt view: ${JSON.stringify(burst.structure)}`);
    }
    expect(burst.count).toBeGreaterThan(0); // wiring: we drove the live view
    await browser.pause(4000); // > debounce; generous window for any runaway

    // PRIMARY loop gate: the DOM re-settles within budget (a runaway never
    // quiesces → waitSettled throws "never stabilized") and the chart is alive.
    const settledBars = await waitSettled();
    expect(settledBars).toBeGreaterThan(0);

    // SECONDARY: a 3-fire burst collapsed to a bounded refresh count (no runaway).
    assertBoundedNoLoop(await readCounts(), "hide-top oscillation burst");

    await restoreLog();
  });

  it("applies an expanded-relationships flip and settles without looping (inherit↔show-all)", async () => {
    const showAllBars = await waitSettled();
    expect(showAllBars).toBeGreaterThan(0);

    await installCounter();

    // show-all → inherit drops the fetched subtasks (the rendered set shrinks):
    // proves the dynamic resultset change actually APPLIED, not just "didn't loop".
    const toInherit = await driveBurst("tngantt_expandedRelationships", ["inherit"]);
    expect(toInherit.count).toBeGreaterThan(0);
    await browser.pause(3000);
    const inheritBars = await waitSettled();
    // Inherit shows only the matched projects → strictly fewer bars than show-all.
    expect(inheritBars).toBeLessThan(showAllBars);

    // Flip back: the set grows again and re-settles (round-trip, still bounded).
    const toShowAll = await driveBurst("tngantt_expandedRelationships", ["show-all"]);
    expect(toShowAll.count).toBeGreaterThan(0);
    await browser.pause(3000);
    const backBars = await waitSettled();
    expect(backBars).toBeGreaterThan(inheritBars);

    assertBoundedNoLoop(await readCounts(), "expanded-relationships flip");

    await restoreLog();
  });
});
