import { browser, expect, $, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Plan 003 U3/U4 full-screen spec.
 *
 * Boots Obsidian against the `test/vaults/gantt-viewport` fixture (no theme
 * toolbar) and exercises the floating full-screen toggle + CSS-in-place overlay:
 *
 *   1. The toggle is visible without enabling the theme toolbar (R5).
 *   2. Clicking it expands `.og-bases-gantt` to FILL the Obsidian window
 *      (rect ≈ window inner size) — proving the `position:fixed` overlay isn't
 *      trapped by an ancestor containing block (R6) — and the host is taller
 *      than the 400px max-height cap, i.e. the cap is ignored full-screen (R8).
 *      The toggle's aria-label flips to the exit affordance (R7).
 *   3. Esc exits and restores the in-note (capped ~400px) size; a marker set on
 *      a chart bar BEFORE toggling survives the round-trip, proving the chart
 *      was not remounted (R9 — CSS class toggle, no DOM reparent).
 *   4. A second click on the toggle also exits (R7).
 *
 * SELECTOR NOTE: `.og-bases-gantt`, `.og-fullscreen`, and `.og-fullscreen-toggle`
 * are owned by this plugin and stable; `.wx-bar` is SVAR's chart bar.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-viewport");

const MAX_HEIGHT = 400;

async function hostHeight(): Promise<number> {
  const el = await $(".og-bases-gantt");
  return (await el.getSize()).height;
}

describe("Gantt (OG) full-screen", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-gantt-fullscreen-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({ vault: tmpVault, plugins: ["tasknotes-gantt"] });

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

    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getAbstractFileByPath("Roadmap.base");
      if (file) await app.workspace.getLeaf(true).openFile(file as never);
    });

    await browser.waitUntil(
      async () => (await $$(".og-bases-gantt .wx-bar")).length > 0,
      { timeout: 60000, timeoutMsg: "Gantt chart did not render any task bars" }
    );
  });

  it("shows the floating full-screen toggle without the theme toolbar (R5)", async () => {
    // The fixture does not enable tngantt_showToolbar, so no .og-gantt-toolbar.
    expect(await $$(".og-bases-gantt .og-gantt-toolbar")).toHaveLength(0);
    const toggle = await $(".og-bases-gantt .og-fullscreen-toggle");
    await expect(toggle).toBeExisting();
    await expect(toggle).toHaveAttribute("aria-label", "Full screen");
  });

  it("fills the Obsidian window and ignores the max-height cap when toggled on (R6/R8/R7)", async () => {
    const toggle = await $(".og-bases-gantt .og-fullscreen-toggle");
    await toggle.click();

    // Overlay class applied + host grows past the cap.
    await browser.waitUntil(async () => (await hostHeight()) > MAX_HEIGHT + 50, {
      timeout: 10000,
      timeoutMsg: "host did not expand beyond the cap on full-screen",
    });

    const win = await browser.execute(() => ({ w: window.innerWidth, h: window.innerHeight }));
    const el = await $(".og-bases-gantt");
    const size = await el.getSize();
    // Fills the window (within a few px) — proves position:fixed reaches the
    // viewport (no ancestor containing-block trap).
    expect(Math.abs(size.width - win.w)).toBeLessThanOrEqual(4);
    expect(Math.abs(size.height - win.h)).toBeLessThanOrEqual(4);
    expect(size.height).toBeGreaterThan(MAX_HEIGHT);

    // Icon/label now reflect the exit affordance (R7).
    await expect(toggle).toHaveAttribute("aria-label", "Exit full screen");
  });

  it("exits via Esc and restores the in-note size without remounting the chart (R7/R9)", async () => {
    // Mark a bar before exiting; a remount would recreate the DOM and lose it.
    await browser.execute(() => {
      const bar = document.querySelector('.og-bases-gantt .wx-bar');
      if (bar) bar.setAttribute('data-e2e-marker', '1');
    });

    await browser.keys(["Escape"]);

    await browser.waitUntil(async () => (await hostHeight()) <= MAX_HEIGHT + 5, {
      timeout: 10000,
      timeoutMsg: "host did not return to the capped size after Esc",
    });
    expect(await $$(".og-bases-gantt.og-fullscreen")).toHaveLength(0);

    // The marked bar still exists → the chart was restyled in place, not remounted.
    const survived = await browser.execute(
      () => !!document.querySelector('.og-bases-gantt .wx-bar[data-e2e-marker="1"]')
    );
    expect(survived).toBe(true);

    const toggle = await $(".og-bases-gantt .og-fullscreen-toggle");
    await expect(toggle).toHaveAttribute("aria-label", "Full screen");
  });

  it("also exits when the toggle is clicked a second time (R7)", async () => {
    const toggle = await $(".og-bases-gantt .og-fullscreen-toggle");
    await toggle.click();
    await browser.waitUntil(async () => (await $$(".og-bases-gantt.og-fullscreen")).length === 1, {
      timeout: 10000,
      timeoutMsg: "did not enter full-screen on click",
    });

    await toggle.click();
    await browser.waitUntil(async () => (await $$(".og-bases-gantt.og-fullscreen")).length === 0, {
      timeout: 10000,
      timeoutMsg: "did not exit full-screen on second click",
    });
  });
});
