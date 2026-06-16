import { browser, expect, $, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * U7 read-only render spec.
 *
 * Boots Obsidian against the `test/vaults/gantt-readonly` fixture (sample task
 * notes + a `.base` configured to use the Gantt (OG) view with a `parent`
 * property where one task — "Shared Task" — has TWO parents), opens the base,
 * and asserts:
 *   1. the Gantt view renders REAL task bars (`.og-bases-gantt .wx-bar` > 0),
 *      not the removed dummy data;
 *   2. the multi-parent task renders as TWO rows (virtual duplication, R24);
 *   3. read-only affordances in Bases mode (R3/R11): the read-only banner is
 *      present and no "Add Task" toolbar item exists.
 *
 * SELECTOR NOTE: these target the stable `.og-bases-gantt` root plus SVAR's
 * `wx-*` classes (verified against @svar-ui/svelte-gantt v2.3.0 — `.wx-bar`
 * for chart bars, `.wx-text` for grid task-name cells). The multi-parent row
 * count is asserted via the grid text cells (`.og-task-text`) we render. If the
 * SVAR DOM differs at runtime, adjust the `wx-*` selectors here; the
 * `.og-bases-gantt`, `.og-readonly-banner`, and `.og-task-text` selectors are
 * owned by this plugin and are stable.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-readonly");

describe("Gantt (OG) read-only render", () => {
  before(async () => {
    // Hermetic: copy the in-repo fixture vault to a disposable temp dir and run
    // against that. This ignores OBSIDIAN_TEST_VAULT on purpose — this spec
    // needs its specific notes + .base, and CI points that env var at an empty
    // runner vault. Copying also avoids polluting the repo fixture with the
    // .obsidian config Obsidian writes on open.
    const tmpVault = path.join(os.tmpdir(), "og-gantt-readonly-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({
      vault: tmpVault,
      plugins: ["obsidian-gantt"],
    });

    // Rendering a `.base` requires the Bases core plugin enabled. Our Gantt
    // view registers via plugin.registerBasesView (available regardless), but
    // Bases must be ON to open the base file.
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

    // Open the .base file via the Obsidian API; Obsidian renders it with the
    // registered Gantt view (first view in the base).
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getAbstractFileByPath("Gantt.base");
      if (file) {
        await app.workspace.getLeaf(true).openFile(file as never);
      }
    });

    // Wait for our Svelte root + SVAR chart to mount.
    await browser.waitUntil(
      async () => (await $$(".og-bases-gantt .wx-bar")).length > 0,
      {
        timeout: 60000,
        timeoutMsg: "Gantt chart did not render any task bars",
      }
    );
  });

  it("renders real fixture data, not the removed dummy dataset", async () => {
    // The removed dummy dataset had 22 tasks; the fixture has 4 source notes.
    // A bar count in the single digits proves real data is rendering and the
    // dummy fallback is gone.
    const bars = await $$(".og-bases-gantt .wx-bar");
    expect(bars.length).toBeGreaterThan(0);
    expect(bars.length).toBeLessThan(10);
  });

  it("renders a multi-parent task as duplicated rows (one per visible parent)", async () => {
    // 4 source notes: Phase A, Phase B, Task A1 (parent Phase A), and
    // Shared Task (parents Phase A + Phase B). Virtual duplication renders
    // Shared Task once under EACH visible parent, so the instance count is 5,
    // not 4 — that extra bar is the multi-parent duplication (R24).
    const bars = await $$(".og-bases-gantt .wx-bar");
    expect(bars.length).toBe(5);
  });

  it("shows read-only affordances in Bases mode", async () => {
    // The read-only banner is rendered whenever the active source has no write
    // capability (Bases is always read-only).
    const banner = await $(".og-bases-gantt .og-readonly-banner");
    await expect(banner).toBeExisting();
    await expect(banner).toHaveText(expect.stringContaining("Read-only"));

    // No "Add Task" affordance: the toolbar item is omitted in read-only mode.
    const toolbarText = await $(".og-bases-gantt").getText();
    expect(toolbarText).not.toContain("Add Task");
  });
});
