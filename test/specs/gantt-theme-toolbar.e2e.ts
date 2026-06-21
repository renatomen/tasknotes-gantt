import { browser, expect, $, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Plan 002 theme + toolbar render spec.
 *
 * Boots Obsidian against the `test/vaults/gantt-theme-toolbar` fixture (two
 * dated task notes + a `.base` configured with `tngantt_showToolbar: true`),
 * opens the base, and asserts:
 *   1. the per-view Gantt toolbar renders (`.og-gantt-toolbar`) when the
 *      `tngantt_showToolbar` option is on (plan 002 R2);
 *   2. SVAR's real <Willow>/<WillowDark> theme component renders inside the
 *      view (its `.wx-willow-theme` / `.wx-willow-dark-theme` element), proving
 *      the chart is wrapped in a complete SVAR theme (plan 002 U2).
 *
 * The LIVE theme-switch case (clicking Auto/Light/Dark and asserting the
 * wrapper class flips) is left to MANUAL verification — driving Obsidian's
 * appearance and reading the reactive class transition is more harness
 * machinery than this minimal render check warrants.
 *
 * SELECTOR NOTE: `.og-bases-gantt` and `.og-gantt-toolbar` are owned by this
 * plugin and stable; `.wx-bar` is SVAR's chart bar and `.wx-willow-theme` /
 * `.wx-willow-dark-theme` are the theme-root classes SVAR's <Willow>/
 * <WillowDark> render (verified against @svar-ui/svelte-gantt).
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-theme-toolbar");

describe("Gantt (OG) theme + toolbar render", () => {
  before(async () => {
    // Hermetic: copy the in-repo fixture vault to a disposable temp dir (ignores
    // OBSIDIAN_TEST_VAULT; CI points it at an empty runner vault).
    const tmpVault = path.join(os.tmpdir(), "og-gantt-theme-toolbar-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({
      vault: tmpVault,
      plugins: ["tasknotes-gantt"],
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

    // Open the .base file; Obsidian renders it with the registered Gantt view.
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getAbstractFileByPath("Theme.base");
      if (file) {
        await app.workspace.getLeaf(true).openFile(file as never);
      }
    });

    // Wait for our Svelte root + SVAR chart to mount.
    await browser.waitUntil(
      async () => (await $$(".og-bases-gantt .wx-bar")).length > 0,
      { timeout: 60000, timeoutMsg: "Gantt chart did not render any task bars" }
    );
  });

  it("renders the per-view toolbar when tngantt_showToolbar is on (R2)", async () => {
    const toolbar = await $(".og-bases-gantt .og-gantt-toolbar");
    await expect(toolbar).toBeExisting();
    // The v1 toolbar holds the 3-state theme switch — its label proves content.
    await expect(toolbar).toHaveText(expect.stringContaining("Theme"));
  });

  it("renders SVAR's willow theme component inside the view (U2)", async () => {
    // SVAR's <Willow>/<WillowDark> render a theme-root element carrying one of
    // the willow theme classes; either proves the chart is wrapped in a
    // complete SVAR theme.
    const light = await $$(".og-bases-gantt .wx-willow-theme");
    const dark = await $$(".og-bases-gantt .wx-willow-dark-theme");
    expect(light.length + dark.length).toBeGreaterThan(0);
  });
});
