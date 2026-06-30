import { browser, expect, $, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Full-screen spec — "maximize within Obsidian" (plan 2026-06-30-002).
 *
 * The toggle no longer uses the native browser Fullscreen API (which promoted
 * the chart to the browser top layer and HID Obsidian's popups). Instead the
 * view root gets `.is-maximized` — `position: fixed`, full Obsidian window,
 * z-index anchored just below `--layer-modal` — so Obsidian popups render ABOVE
 * the maximized chart. This spec asserts:
 *   1. The chart is NOT wrapped in a native `.wx-fullscreen` node; our floating
 *      toggle is visible without the theme toolbar (R5).
 *   2. Clicking the toggle adds `.is-maximized`, fills the window, does NOT enter
 *      native fullscreen, and flips the toggle label (R1/R5).
 *   3. While maximized, the command palette (a body-appended modal, the proxy for
 *      every Obsidian popup) is the topmost element at the viewport centre — i.e.
 *      it renders above the chart (R2/R7).
 *   4. Esc and a second toggle click exit maximize and restore the embedded
 *      layout with no residual styling (R4).
 *   5. A marker on a chart bar survives an enter→exit cycle — the chart is not
 *      remounted (R6).
 *
 * SELECTOR NOTE: `.og-bases-gantt` / `.og-fullscreen-toggle` are owned by this
 * plugin; `.wx-bar` is SVAR's chart bar; `.modal-container` / `.prompt` are
 * Obsidian's modal host + command-palette surface.
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-viewport");

async function isMaximized(): Promise<boolean> {
  return (await $$(".og-bases-gantt.is-maximized")).length > 0;
}

/** No native fullscreen element should ever be created by this toggle. */
async function nativeFullscreenActive(): Promise<boolean> {
  return browser.execute(() => document.fullscreenElement !== null);
}

describe("Gantt (OG) full-screen (maximize within Obsidian)", () => {
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
    // Close any lingering modal first (the command palette has no close button →
    // Escape; while a modal is open our handler leaves maximize alone), then leave
    // no test maximized (would skew the next).
    if ((await $$(".modal-container")).length > 0) {
      await browser.keys(["Escape"]);
      await browser.waitUntil(async () => (await $$(".modal-container")).length === 0, { timeout: 5000 }).catch(() => {});
    }
    if (await isMaximized()) {
      await browser.keys(["Escape"]); // no modal now → our handler exits maximize
      await browser.waitUntil(async () => !(await isMaximized()), { timeout: 5000 }).catch(() => {});
    }
  });

  it("does not wrap the chart in a native fullscreen node and shows the toggle without the theme toolbar (R5)", async () => {
    expect(await $$(".og-bases-gantt .og-gantt-toolbar")).toHaveLength(0); // fixture has no toolbar
    expect(await $$(".og-bases-gantt .wx-fullscreen")).toHaveLength(0); // no native <Fullscreen>
    const toggle = await $(".og-bases-gantt .og-fullscreen-toggle");
    await expect(toggle).toBeExisting();
    await expect(toggle).toHaveAttribute("aria-label", "Full screen");
  });

  it("maximizes within Obsidian (fills the window, no native fullscreen) and flips the label (R1/R5)", async () => {
    const toggle = await $(".og-bases-gantt .og-fullscreen-toggle");
    await toggle.click();
    await browser.waitUntil(isMaximized, {
      timeout: 8000, timeoutMsg: "clicking the toggle did not add .is-maximized",
    });
    expect(await nativeFullscreenActive()).toBe(false); // window-maximize, not native fullscreen

    // The maximized container fills (≈) the Obsidian window.
    const fills = await browser.execute(() => {
      const el = document.querySelector(".og-bases-gantt.is-maximized") as HTMLElement | null;
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width >= window.innerWidth - 2 && r.height >= window.innerHeight - 2;
    });
    expect(fills).toBe(true);
    await expect(toggle).toHaveAttribute("aria-label", "Exit full screen");
  });

  it("renders the command palette ABOVE the maximized chart (R2/R7)", async () => {
    const toggle = await $(".og-bases-gantt .og-fullscreen-toggle");
    await toggle.click();
    await browser.waitUntil(isMaximized, { timeout: 8000 });

    // Open the command palette — a body-appended modal, the proxy for every
    // Obsidian popup. With native fullscreen it would have been unpaintable.
    await browser.executeObsidian(async ({ app }) => {
      (app as unknown as { commands: { executeCommandById: (id: string) => unknown } })
        .commands.executeCommandById("command-palette:open");
    });
    await browser.waitUntil(async () => (await $$(".modal-container .prompt")).length > 0, {
      timeout: 8000, timeoutMsg: "command palette did not open",
    });

    // The topmost element at the viewport centre belongs to the modal layer, not
    // the Gantt — direct evidence the popup paints above the maximized chart.
    const topmostIsModal = await browser.execute(() => {
      const el = document.elementFromPoint(
        Math.floor(window.innerWidth / 2),
        Math.floor(window.innerHeight / 2),
      );
      return !!el?.closest(".modal-container");
    });
    expect(topmostIsModal).toBe(true);
  });

  it("exits maximize on Esc and restores the embedded layout (R4)", async () => {
    const toggle = await $(".og-bases-gantt .og-fullscreen-toggle");
    await toggle.click();
    await browser.waitUntil(isMaximized, { timeout: 8000 });

    await browser.keys(["Escape"]);
    await browser.waitUntil(async () => !(await isMaximized()), {
      timeout: 8000, timeoutMsg: "Esc did not exit maximize",
    });
    // `.is-maximized` is the ONLY source of the fixed/full-window styling, so its
    // absence (awaited above) is the no-residual proof. The root no longer fills
    // the window, and the toggle label is restored.
    const stillFillsWindow = await browser.execute(() => {
      const el = document.querySelector(".og-bases-gantt") as HTMLElement | null;
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.height >= window.innerHeight - 2;
    });
    expect(stillFillsWindow).toBe(false);
    await expect(toggle).toHaveAttribute("aria-label", "Full screen");
  });

  it("does not remount the chart across an enter/exit cycle (R6)", async () => {
    await browser.execute(() => {
      const bar = document.querySelector(".og-bases-gantt .wx-bar");
      if (bar) bar.setAttribute("data-e2e-marker", "1");
    });
    const toggle = await $(".og-bases-gantt .og-fullscreen-toggle");
    await toggle.click();
    await browser.waitUntil(isMaximized, { timeout: 8000 });
    await toggle.click();
    await browser.waitUntil(async () => !(await isMaximized()), {
      timeout: 8000, timeoutMsg: "did not exit maximize",
    });
    const survived = await browser.execute(
      () => !!document.querySelector('.og-bases-gantt .wx-bar[data-e2e-marker="1"]')
    );
    expect(survived).toBe(true);
  });
});
