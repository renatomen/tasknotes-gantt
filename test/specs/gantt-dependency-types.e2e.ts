/* global MouseEvent -- used inside an in-browser execute() callback */
import { browser, expect, $$ } from "@wdio/globals";
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

const ARROWS = ".og-bases-gantt svg.wx-links g.wx-line";

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

    // Open the base; Obsidian renders it with the registered Gantt view.
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getAbstractFileByPath("Dependencies.base");
      if (file) {
        await app.workspace.getLeaf(true).openFile(file as never);
      }
    });

    // Wait for the STABLE, COMPLETE end state — every one of the five NAMED task
    // bars AND all four arrows. Bars + TaskNotes deps render progressively, and
    // the Bases filter also admits Obsidian's auto-created "Start Here" note, so
    // a bare bars>=5 count can pass before a specific task bar has rendered.
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const root = document.querySelector(".og-bases-gantt");
          if (!root) return false;
          const ids = Array.from(root.querySelectorAll(".wx-bar")).map(
            (b) => b.getAttribute("data-id") ?? ""
          );
          const names = ["Spec.md", "Build FS.md", "Build SS.md", "Build FF.md", "Build SF.md"];
          const haveBars = names.every((n) => ids.some((id) => id.endsWith(n)));
          const arrows = root.querySelectorAll("svg.wx-links g.wx-line").length;
          return haveBars && arrows >= 4;
        }),
      // The Step-2 gate above already guarantees the dependencies resolve before
      // open, so this should settle quickly; the generous budget is a backstop
      // for slow render/paint under CI load, not the dependency race itself.
      { timeout: 90000, timeoutMsg: "Gantt did not reach all five task bars + four arrows" }
    );
  });

  it("renders a bar for each task note (Spec + four dependents)", async () => {
    // Assert the five expected task bars by id rather than a total count — the
    // Bases filter (file.ext == "md") may also include Obsidian's auto-created
    // "Start Here" welcome note, which is irrelevant to this test. Queried
    // in-page (data-id values carry a `:` prefix and spaces, which the wdio CSS
    // selector engine matches unreliably; endsWith in-page is exact).
    const missing = await browser.execute(() => {
      const root = document.querySelector(".og-bases-gantt");
      const ids = root
        ? Array.from(root.querySelectorAll(".wx-bar")).map((b) => b.getAttribute("data-id") ?? "")
        : [];
      const names = ["Spec.md", "Build FS.md", "Build SS.md", "Build FF.md", "Build SF.md"];
      return names.filter((n) => !ids.some((id) => id.endsWith(n)));
    });
    expect(missing).toEqual([]);
  });

  it("renders one dependency arrow per blockedBy edge", async () => {
    // Four blockedBy edges (FS/SS/FF/SF), distinct dependents, primary arrow
    // mode → four arrows. Proves the read path end-to-end: TaskNotes blockedBy
    // → CompositeSource enrichment → controller reltype→SVAR-type → SVAR links.
    const arrows = await $$(ARROWS);
    expect(arrows.length).toBe(4);
  });

  it("renders each of the four RFC 9253 reltypes with its correct SVAR link type", async () => {
    // Read the arrows' data-link-id in-page (robust vs. wdio element-array
    // mapping). data-link-id: ":<src>-><tgt>:<type>:<gap>" — assert each SVAR
    // type appears: e2s=FINISHTOSTART, s2s=STARTTOSTART, e2e=FINISHTOFINISH,
    // s2e=STARTTOFINISH.
    const joined = await browser.execute(() => {
      const root = document.querySelector(".og-bases-gantt");
      const arrows = root ? Array.from(root.querySelectorAll("svg.wx-links g.wx-line")) : [];
      return arrows.map((a) => a.getAttribute("data-link-id") ?? "").join("|");
    });
    expect(joined).toContain(":e2s:");
    expect(joined).toContain(":s2s:");
    expect(joined).toContain(":e2e:");
    expect(joined).toContain(":s2e:");
  });

  it("shows a visible delete glyph when a link is selected (guards the wxi-close icon)", async () => {
    // Regression guard for the "no visible X" delete bug. `<Willow
    // fonts={false}>` disables SVAR's wxi webfont, so the link-delete button's
    // `wxi-close` glyph is supplied entirely by our own CSS rule
    // (`.wx-delete-button-icon` background-image in GanttContainer.svelte).
    // Without that rule the danger button renders as a blank red square and the
    // user cannot tell a selected link is deletable. Selecting a link (UI state,
    // not an intercepted action) must surface a delete button whose icon has a
    // non-empty background-image. We assert the glyph only — actually firing
    // delete would mutate the fixture's blockedBy, out of scope for this
    // read-fidelity spec.
    const clicked = await browser.execute(() => {
      const arrow = document.querySelector(
        '.og-bases-gantt svg.wx-links g.wx-line[data-link-id*=":e2s:"]'
      );
      if (!arrow) return false;
      // SVAR's onSelectLink is bound to the <g>'s onclick (gated on !readonly);
      // a bubbling synthetic click drives the same selection path as a user tap.
      arrow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return true;
    });
    expect(clicked).toBe(true);

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const icon = document.querySelector(
            ".og-bases-gantt .wx-delete-button-icon"
          );
          if (!icon) return false;
          const bg = window.getComputedStyle(icon).backgroundImage;
          return typeof bg === "string" && bg !== "none" && bg.length > 0;
        }),
      {
        timeout: 10000,
        timeoutMsg:
          "Selected-link delete button icon rendered no background-image (wxi-close glyph missing)",
      }
    );
  });

  // NOTE: the U3 dependency tooltip is intentionally NOT asserted here. SVAR's
  // tooltip is debounced and portal-rendered, making its popup DOM brittle to
  // assert headlessly. The tooltip's content (reltype labels, gap formatting,
  // ordering, empty state) is fully unit-covered in
  // test/unit/dependencyTooltip.test.ts, and the link→task data wiring in
  // test/unit/ganttSync.test.ts. The rendered popup is a manual in-vault check.
});
