import { browser, expect, $, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Full-screen spec — SVAR's official <Fullscreen> component (svelte-core),
 * adopted per https://docs.svar.dev/svelte/gantt/guides/fullscreen/.
 *
 * Boots the `test/vaults/gantt-viewport` fixture (no theme toolbar) and asserts:
 *   1. The chart is wrapped in the official `.wx-fullscreen` node, and our
 *      floating toggle (passed via the component's `toggleButton` slot) is
 *      visible WITHOUT the theme toolbar (R5).
 *   2. Clicking the toggle enters NATIVE browser fullscreen — `document
 *      .fullscreenElement` becomes the `.wx-fullscreen` node — and the toggle's
 *      label flips to the exit affordance (R6/R7).
 *   3. A marker set on a chart bar survives the enter→exit round-trip, so the
 *      chart is not remounted (R9).
 *   4. Clicking the toggle again exits native fullscreen (R7).
 *
 * SELECTOR NOTE: `.og-bases-gantt` / `.og-fullscreen-toggle` are owned by this
 * plugin; `.wx-fullscreen` is SVAR's <Fullscreen> root and `.wx-bar` its chart
 * bar (verified against @svar-ui/svelte-core + svelte-gantt).
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-viewport");

async function fullscreenElementIsChart(): Promise<boolean> {
  return browser.execute(
    () => document.fullscreenElement?.classList.contains("wx-fullscreen") ?? false
  );
}

describe("Gantt (OG) full-screen (official <Fullscreen> component)", () => {
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
      if (bases && !bases.enabled) await (ip?.enablePluginAndSave?.("bases") ?? bases.enable?.({ reloadApp: false }));
    });
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getAbstractFileByPath("Roadmap.base");
      if (file) await app.workspace.getLeaf(true).openFile(file as never);
    });
    await browser.waitUntil(async () => (await $$(".og-bases-gantt .wx-bar")).length > 0, {
      timeout: 60000, timeoutMsg: "Gantt chart did not render any task bars",
    });
  });

  afterEach(async () => {
    // Leave no test in fullscreen (would skew the next one).
    await browser.execute(() => { if (document.fullscreenElement) void document.exitFullscreen(); });
    await browser.waitUntil(async () => !(await fullscreenElementIsChart()), { timeout: 5000 }).catch(() => {});
  });

  it("wraps the chart in the official <Fullscreen> and shows the toggle without the theme toolbar (R5)", async () => {
    expect(await $$(".og-bases-gantt .og-gantt-toolbar")).toHaveLength(0); // fixture has no toolbar
    await expect($(".og-bases-gantt .wx-fullscreen")).toBeExisting();
    const toggle = await $(".og-bases-gantt .og-fullscreen-toggle");
    await expect(toggle).toBeExisting();
    await expect(toggle).toHaveAttribute("aria-label", "Full screen");
  });

  it("enters native fullscreen on toggle and flips the label (R6/R7)", async () => {
    const toggle = await $(".og-bases-gantt .og-fullscreen-toggle");
    await toggle.click();
    await browser.waitUntil(fullscreenElementIsChart, {
      timeout: 8000, timeoutMsg: "clicking the toggle did not enter native fullscreen",
    });
    expect(await fullscreenElementIsChart()).toBe(true);
    await expect(toggle).toHaveAttribute("aria-label", "Exit full screen");
  });

  it("does not remount the chart across an enter/exit cycle (R9)", async () => {
    await browser.execute(() => {
      const bar = document.querySelector(".og-bases-gantt .wx-bar");
      if (bar) bar.setAttribute("data-e2e-marker", "1");
    });
    const toggle = await $(".og-bases-gantt .og-fullscreen-toggle");
    await toggle.click();
    await browser.waitUntil(fullscreenElementIsChart, { timeout: 8000 });
    await toggle.click();
    await browser.waitUntil(async () => !(await fullscreenElementIsChart()), {
      timeout: 8000, timeoutMsg: "did not exit native fullscreen",
    });
    const survived = await browser.execute(
      () => !!document.querySelector('.og-bases-gantt .wx-bar[data-e2e-marker="1"]')
    );
    expect(survived).toBe(true);
  });

  it("exits native fullscreen when the toggle is clicked again (R7)", async () => {
    const toggle = await $(".og-bases-gantt .og-fullscreen-toggle");
    await toggle.click();
    await browser.waitUntil(fullscreenElementIsChart, { timeout: 8000 });
    await toggle.click();
    await browser.waitUntil(async () => !(await fullscreenElementIsChart()), {
      timeout: 8000, timeoutMsg: "did not exit native fullscreen on second click",
    });
    expect(await fullscreenElementIsChart()).toBe(false);
    await expect(toggle).toHaveAttribute("aria-label", "Full screen");
  });
});
