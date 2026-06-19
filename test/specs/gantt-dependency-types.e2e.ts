import { browser, expect } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Dependency read-fidelity spec (plan 004, M1; closes the e2e gap from #93).
 *
 * Boots Obsidian against the `test/vaults/gantt-dependencies` fixture with BOTH
 * obsidian-gantt and TaskNotes enabled, opens the base, and asserts that the
 * Gantt renders real dependency arrows sourced from TaskNotes' `blockedBy`
 * relationships — one per RFC 9253 reltype, with the correct SVAR link type.
 *
 * Why TaskNotes: dependency edges come only from TaskNotes (Bases has no
 * dependency model). TaskNotes is installed from a pinned GitHub release by the
 * harness (see test/wdio/wdio.conf.mts) so this runs for any developer/CI with
 * no personal vault. The fixture relies on TaskNotes' DEFAULT task
 * identification (`#task` tag), so no committed TaskNotes settings are needed.
 *
 * SELECTOR NOTES (verified against @svar-ui/svelte-gantt 2.7.0 via this spec):
 *  - chart bars: `.wx-bar`
 *  - dependency ARROWS: `svg.wx-links g.wx-line` (one per link), each carrying a
 *    `data-link-id` of the form `:<src>-><tgt>:<type>:<gap>` where <type> is the
 *    SVAR link type (e2s/s2s/e2e/s2e). NOTE `.wx-link` (no `s`) is the per-bar
 *    drag handle, NOT an arrow — do not count it.
 *  - SVAR 2.7.0 prefixes string ids with `:` in the DOM.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-dependencies");

/**
 * Force the OG Gantt to be the ACTIVE, visible leaf.
 *
 * ROOT CAUSE of the historical #98 flake (diagnosed via a deep dump showing
 * `.og-bases-gantt-root` present but `.og-bases-gantt` absent, with the active
 * view being `TaskNotes/Start Here.md`, not the base): this is the only spec
 * that enables TaskNotes, and on first install TaskNotes creates+opens a "Start
 * Here" starter note ASYNCHRONOUSLY. That open can land at ANY time — after we
 * open the base, after the `before` hook, even between a `beforeEach` and a test
 * body — and steal the active leaf. A Bases view unmounts its content while its
 * leaf is backgrounded, so the Gantt DOM vanishes until the leaf is re-fronted.
 *
 * This helper detaches any markdown leaves (the starter note) and re-asserts the
 * base leaf as active+revealed. It is idempotent and cheap once the base is
 * already front (no markdown leaves to detach, active/reveal are no-ops), so it
 * is safe to call on EVERY poll of EVERY wait — which is what makes the waits
 * self-healing against a steal that fires mid-test, not just before it.
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
    // Collect-then-detach to avoid mutating the leaf set mid-iteration.
    const markdownLeaves: Array<{ detach?: () => void }> = [];
    ws.iterateAllLeaves((l) => {
      if (l.view?.getViewType?.() === "markdown") markdownLeaves.push(l);
    });
    markdownLeaves.forEach((l) => l.detach?.());

    let baseLeaf = ws.getLeavesOfType("bases")[0];
    if (!baseLeaf) {
      const file = app.vault.getAbstractFileByPath("Dependencies.base");
      if (!file) return;
      const leaf = ws.getLeaf(true);
      await leaf.openFile(file as never);
      baseLeaf = leaf;
    }
    ws.setActiveLeaf(baseLeaf, { focus: true });
    ws.revealLeaf(baseLeaf);
  });
}

/** Read the current Gantt render state (mounted? which named bars? arrows?). */
async function readGanttState(): Promise<{ mounted: boolean; bars: number; arrows: number; missing: string[] }> {
  return browser.execute(() => {
    const root = document.querySelector(".og-bases-gantt");
    if (!root) {
      return { mounted: false, bars: 0, arrows: 0, missing: ["<.og-bases-gantt absent>"] };
    }
    const ids = Array.from(root.querySelectorAll(".wx-bar")).map((b) => b.getAttribute("data-id") ?? "");
    const names = ["Spec.md", "Build FS.md", "Build SS.md", "Build FF.md", "Build SF.md"];
    const missing = names.filter((n) => !ids.some((id) => id.endsWith(n)));
    const arrows = root.querySelectorAll("svg.wx-links g.wx-line").length;
    return { mounted: true, bars: ids.length, arrows, missing };
  });
}

/**
 * Wait until the OG Gantt is the active leaf AND fully rendered (five named bars
 * + four arrows), re-activating the base leaf on every poll so a starter-note
 * steal can never stall the wait. Rethrows the last observed state on timeout.
 */
async function ensureGanttReady(): Promise<void> {
  let lastObserved = "<never polled>";
  try {
    await browser.waitUntil(
      async () => {
        await activateBaseLeaf();
        const state = await readGanttState();
        lastObserved = JSON.stringify(state);
        return state.mounted && state.missing.length === 0 && state.arrows >= 4;
      },
      { timeout: 90000, timeoutMsg: "Gantt did not reach all five task bars + four arrows" }
    );
  } catch {
    throw new Error(
      `Gantt not ready (active base leaf + 5 bars + 4 arrows). Last observed: ${lastObserved}`
    );
  }
}

describe("Gantt (OG) dependency read fidelity", () => {
  before(async () => {
    // Hermetic: copy the in-repo fixture to a disposable temp dir (Obsidian
    // writes config on open; copying keeps the committed fixture pristine).
    const tmpVault = path.join(os.tmpdir(), "og-gantt-dependencies-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    // Enable obsidian-gantt AND TaskNotes (the dependency-edge source).
    await browser.reloadObsidian({
      vault: tmpVault,
      plugins: ["obsidian-gantt", "tasknotes"],
    });

    // Bases core plugin must be ON to open the .base file.
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

    // Step 1: wait for the TaskNotes API to come up.
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
      { timeout: 60000, timeoutMsg: "TaskNotes API did not become ready" }
    );

    // Step 2 — the de-flake gate. `lifecycle.ready()` resolving does NOT mean the
    // blockedBy edges are queryable yet: each edge's predecessor is a wikilink
    // (`uid: "[[Spec]]"`) that TaskNotes resolves to a note path via Obsidian's
    // metadata cache, which finishes building ASYNCHRONOUSLY after the API reports
    // ready. If the base opens before that, the Gantt's one-shot open-time
    // snapshot reads zero dependencies and must race late
    // `task.dependencies.changed` events to backfill arrows — the historical
    // flake (timed out at 90s under CI load, see #98). Gate on the real signal:
    // every dependent's blockedBy edge has RESOLVED to a predecessor path. Once
    // this holds, the open-time snapshot is deterministic and arrows render on
    // first paint.
    await browser.waitUntil(
      async () =>
        browser.executeObsidian(async ({ app }) => {
          const tn = (app as unknown as { plugins?: { getPlugin?: (id: string) => unknown } }).plugins?.getPlugin?.("tasknotes") as
            | { api?: { relationships?: { dependencies?: (path: string) => Promise<Array<{ path?: string | null }>> | Array<{ path?: string | null }> } } }
            | undefined;
          const dependencies = tn?.api?.relationships?.dependencies;
          if (!dependencies) return false;
          // The four dependents each carry exactly one blockedBy edge on Spec.
          const dependents = ["Build FS.md", "Build SS.md", "Build FF.md", "Build SF.md"];
          try {
            for (const path of dependents) {
              const edges = await dependencies(path);
              if (!Array.isArray(edges) || !edges.some((e) => !!e?.path)) {
                return false;
              }
            }
            return true;
          } catch {
            return false;
          }
        }),
      { timeout: 60000, timeoutMsg: "TaskNotes blockedBy edges did not resolve to predecessor paths" }
    );

    // Open the base and confirm the Gantt mounts (5 bars + 4 arrows). The
    // activation/visibility race is handled by `ensureGanttReady` (see its
    // docstring) — also re-run before every test via `beforeEach`.
    await ensureGanttReady();
  });

  // The starter-note leaf-steal can fire AFTER `before`, so re-assert the base
  // leaf is active + mounted ahead of each test (not just once). See
  // `ensureGanttReady`.
  beforeEach(async () => {
    await ensureGanttReady();
  });

  it("renders a bar for each task note (Spec + four dependents)", async () => {
    // Assert the five expected task bars by id rather than a total count — the
    // Bases filter (file.ext == "md") may also admit unrelated notes. Queried
    // in-page (data-id values carry a `:` prefix and spaces, which the wdio CSS
    // selector engine matches unreliably; endsWith in-page is exact).
    //
    // waitUntil (not a one-shot read): `beforeEach` guarantees the view is
    // mounted, but the chart still re-derives on late TaskNotes/Bases settling
    // events, so a single read can land on a transient frame with a bar briefly
    // absent. Retrying absorbs that without weakening the assertion — it still
    // fails if a bar never appears.
    let missing: string[] = ["<unobserved>"];
    await browser.waitUntil(
      async () => {
        await activateBaseLeaf(); // re-front the base in case a steal fired mid-test
        const state = await readGanttState();
        missing = state.missing;
        return state.mounted && missing.length === 0;
      },
      { timeout: 15000, timeoutMsg: () => `Task bars missing: ${JSON.stringify(missing)}` }
    );
    expect(missing).toEqual([]);
  });

  it("renders one dependency arrow per blockedBy edge", async () => {
    // Four blockedBy edges (FS/SS/FF/SF), distinct dependents, primary arrow
    // mode → four arrows. Proves the read path end-to-end: TaskNotes blockedBy
    // → CompositeSource enrichment → controller reltype→SVAR-type → SVAR links.
    // waitUntil for the same transient-re-render reason as the bar-count test.
    let arrowCount = -1;
    await browser.waitUntil(
      async () => {
        await activateBaseLeaf();
        const state = await readGanttState();
        arrowCount = state.arrows;
        return state.mounted && arrowCount === 4;
      },
      { timeout: 15000, timeoutMsg: () => `Expected 4 arrows, saw ${arrowCount}` }
    );
    expect(arrowCount).toBe(4);
  });

  it("renders each of the four RFC 9253 reltypes with its correct SVAR link type", async () => {
    // Read the arrows' data-link-id in-page (robust vs. wdio element-array
    // mapping). data-link-id: ":<src>-><tgt>:<type>:<gap>" — assert each SVAR
    // type appears: e2s=FINISHTOSTART, s2s=STARTTOSTART, e2e=FINISHTOFINISH,
    // s2e=STARTTOFINISH. waitUntil for the same transient-re-render reason.
    let joined = "";
    await browser.waitUntil(
      async () => {
        await activateBaseLeaf();
        joined = await browser.execute(() => {
          const root = document.querySelector(".og-bases-gantt");
          const arrows = root ? Array.from(root.querySelectorAll("svg.wx-links g.wx-line")) : [];
          return arrows.map((a) => a.getAttribute("data-link-id") ?? "").join("|");
        });
        return [":e2s:", ":s2s:", ":e2e:", ":s2e:"].every((t) => joined.includes(t));
      },
      { timeout: 15000, timeoutMsg: () => `Missing reltype(s); saw: ${joined}` }
    );
    expect(joined).toContain(":e2s:");
    expect(joined).toContain(":s2s:");
    expect(joined).toContain(":e2e:");
    expect(joined).toContain(":s2e:");
  });

  it("renders a non-empty delete-button glyph (guards the wxi-close icon CSS)", async () => {
    // Regression guard for the "no visible X" delete bug. `<Willow
    // fonts={false}>` disables SVAR's wxi webfont, so the link-delete button's
    // `wxi-close` glyph is supplied entirely by our own scoped CSS rule
    // (`.og-bases-gantt :global(.wx-delete-button-icon)` background-image in
    // GanttContainer.svelte). Without that rule the danger button renders as a
    // blank red square and the user cannot tell a selected link is deletable.
    //
    // We verify the CSS rule directly by probing the computed style of a
    // throwaway element carrying the exact class SVAR puts on the delete button
    // (`<i class="wxi-close wx-delete-button-icon">`, per @svar-ui/svelte-gantt
    // chart/Bars.svelte), appended inside the Gantt scope. This targets the
    // thing that actually regressed — the CSS — without depending on the
    // link-selection gesture, which is timing-racy headlessly (the button only
    // exists while a link is selected). The class→button linkage is fixed in
    // SVAR's source, so probing the class is a faithful guard.
    //
    // Wrapped in a wait that re-fronts the base leaf each poll: a starter-note
    // steal could unmount `.og-bases-gantt` between `beforeEach` and this body,
    // leaving nothing to probe. activateBaseLeaf re-mounts it.
    let bg: string | null = null;
    await browser.waitUntil(
      async () => {
        await activateBaseLeaf();
        bg = await browser.execute(() => {
          const root = document.querySelector(".og-bases-gantt");
          if (!root) return null;
          const probe = document.createElement("i");
          probe.className = "wxi-close wx-delete-button-icon";
          root.appendChild(probe);
          const value = window.getComputedStyle(probe).backgroundImage;
          probe.remove();
          return value;
        });
        return typeof bg === "string" && bg !== "none" && bg.length > 0;
      },
      { timeout: 15000, timeoutMsg: () => `delete-button glyph background-image not applied; saw: ${bg}` }
    );
    expect(bg).toBeTruthy();
    expect(bg).not.toBe("none");
  });

  // NOTE: the U3 dependency tooltip is intentionally NOT asserted here. SVAR's
  // tooltip is debounced and portal-rendered, making its popup DOM brittle to
  // assert headlessly. The tooltip's content (reltype labels, gap formatting,
  // ordering, empty state) is fully unit-covered in
  // test/unit/dependencyTooltip.test.ts, and the link→task data wiring in
  // test/unit/ganttSync.test.ts. The rendered popup is a manual in-vault check.
});
