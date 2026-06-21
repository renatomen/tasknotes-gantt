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

  // --- Plan 004: theme flip restyles in place (no remount) ---

  /** Class list of the stable theme wrapper that gets the willow class swapped. */
  async function wrapperClass(): Promise<string> {
    const el = await $(".og-bases-gantt .og-chart-area .wx-theme");
    return (await el.getAttribute("class")) ?? "";
  }
  /** Click an in-chart toolbar theme button by its label. */
  async function clickTheme(label: "Auto" | "Light" | "Dark"): Promise<void> {
    const btn = await (await $(".og-bases-gantt .og-gantt-toolbar")).$(`button=${label}`);
    await btn.click();
  }
  /** Drive Obsidian's appearance via the body theme class (the auto-follow path). */
  async function setBodyTheme(dark: boolean): Promise<void> {
    await browser.execute((d) => {
      document.body.classList.remove(d ? "theme-light" : "theme-dark");
      document.body.classList.add(d ? "theme-dark" : "theme-light");
    }, dark);
  }

  it("auto-follow: flipping Obsidian's body theme swaps the wrapper class in place (R5)", async () => {
    // Fixture mode defaults to Auto, so the chart follows Obsidian. Drive it via
    // the body theme class — the plugin's isObsidianDark/MutationObserver path.
    await setBodyTheme(true);
    await browser.waitUntil(async () => (await wrapperClass()).includes("wx-willow-dark-theme"), {
      timeout: 8000, timeoutMsg: "wrapper did not follow body→dark",
    });
    await setBodyTheme(false);
    await browser.waitUntil(async () => {
      const c = await wrapperClass();
      return c.includes("wx-willow-theme") && !c.includes("wx-willow-dark-theme");
    }, { timeout: 8000, timeoutMsg: "wrapper did not follow body→light" });
  });

  it("toolbar: clicking Dark/Light swaps the wrapper class (R1/R5)", async () => {
    await clickTheme("Dark");
    await browser.waitUntil(async () => (await wrapperClass()).includes("wx-willow-dark-theme"), {
      timeout: 8000, timeoutMsg: "toolbar Dark did not apply",
    });
    await clickTheme("Light");
    await browser.waitUntil(async () => !(await wrapperClass()).includes("wx-willow-dark-theme"), {
      timeout: 8000, timeoutMsg: "toolbar Light did not apply",
    });
  });

  it("toggling theme does NOT remount the chart — a bar marker survives (R1/R4)", async () => {
    await clickTheme("Light");
    await browser.waitUntil(async () => !(await wrapperClass()).includes("wx-willow-dark-theme"), { timeout: 8000 });
    // Mark a bar; a remount would recreate the DOM and lose the attribute.
    await browser.execute(() => {
      const bar = document.querySelector(".og-bases-gantt .wx-bar");
      if (bar) bar.setAttribute("data-e2e-marker", "1");
    });
    await clickTheme("Dark");
    await browser.waitUntil(async () => (await wrapperClass()).includes("wx-willow-dark-theme"), { timeout: 8000 });
    const survived = await browser.execute(
      () => !!document.querySelector('.og-bases-gantt .wx-bar[data-e2e-marker="1"]')
    );
    expect(survived).toBe(true);
  });

  it("swaps the gantt-layer theme variable on toggle — no default bleed (R3)", async () => {
    const readGanttBorderVar = () =>
      browser.execute(() =>
        getComputedStyle(
          document.querySelector(".og-bases-gantt .og-chart-area .wx-theme") as Element
        ).getPropertyValue("--wx-gantt-border-color").trim()
      );
    await clickTheme("Light");
    await browser.waitUntil(async () => !(await wrapperClass()).includes("wx-willow-dark-theme"), { timeout: 8000 });
    const lightVar = await readGanttBorderVar();
    await clickTheme("Dark");
    await browser.waitUntil(async () => (await wrapperClass()).includes("wx-willow-dark-theme"), { timeout: 8000 });
    const darkVar = await readGanttBorderVar();
    // The gantt-LAYER variable (the layer that caused the prior "heavy lines")
    // must actually be present and swap — not fall back to a default.
    expect(lightVar).not.toBe("");
    expect(darkVar).not.toBe("");
    expect(darkVar).not.toBe(lightVar);
  });

  // NOTE (KTD 3 — portaled tooltip theming): the SVAR dependency Tooltip renders
  // through a Portal mounted at <body>, outside this wrapper's cascade, and themes
  // from the `wx-theme` context read per hover — which is why the context is
  // provided as a reactive value (so a tooltip opened after a flip is themed
  // correctly). This is NOT covered here because the DependencyTooltip only
  // renders content when dependency edges exist, and this Bases-only fixture has
  // no TaskNotes deps, so no tooltip ever mounts to hover. It is covered by manual
  // verification (plan 004 Verification Strategy) and by code: Portal.svelte reads
  // getContext("wx-theme") freshly on each `{#if shouldRender}` mount.
});
