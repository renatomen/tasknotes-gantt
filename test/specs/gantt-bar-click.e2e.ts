/* global MouseEvent */
import { browser, expect } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Select-first bar-click spec (R1/R4/R5).
 *
 * Boots Obsidian against `test/vaults/gantt-readonly` (Bases-only, real task
 * bars with dates) with TaskNotes DISABLED (only `tasknotes-gantt` is enabled),
 * so a bar activation falls back to opening the note. That makes the
 * select-first differential observable through the active file:
 *   - first single-click on an unselected bar → `.wx-selected`, the active file
 *     does NOT change (nothing opened) — R1;
 *   - a second single-click on the now-selected bar → the note opens — R4;
 *   - a double-click on an unselected bar → the note opens in one gesture — R5.
 *
 * SELECTOR NOTE: `.og-bases-gantt` (plugin-owned) + SVAR `.wx-bar` / `.wx-selected`
 * (task + selected-state hooks). If SVAR's DOM differs at runtime, adjust the
 * `wx-*` selectors; `.og-bases-gantt` is stable and owned by this plugin.
 *
 * CLICK TECHNIQUE: Use `browser.execute(() => el.click())` rather than
 * WebDriver elementClick — SVAR bars may have no visible size/location
 * in the viewport when Obsidian renders the gantt chart in a non-focused leaf,
 * causing WebDriver to refuse the click. JS-dispatch bypasses that check.
 *
 * DOUBLE-CLICK: `dblclick` DOM event bubbles up to SVAR's `.wx-bars` container
 * which fires `show-editor`. The bar itself carries `data-id`; SVAR's
 * `locateID(e.target)` traverses to it. A plain `MouseEvent('dblclick')` is
 * sufficient since SVAR uses standard DOM dblclick.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-readonly");

/** The active file path, or null (read inside the Obsidian renderer). */
async function activeFilePath(): Promise<string | null> {
  return browser.executeObsidian(({ app }) => app.workspace.getActiveFile()?.path ?? null);
}

/** Click the first `.wx-bar` inside the Gantt chart via JS dispatch (avoids viewport interactability requirement). */
async function clickFirstBar(): Promise<boolean> {
  return browser.execute(() => {
    const bar = document.querySelector(".og-bases-gantt .wx-bar") as HTMLElement | null;
    if (!bar) return false;
    bar.click();
    return true;
  });
}

/** Double-click the first `.wx-bar` via JS dispatch. */
async function dblClickFirstBar(): Promise<boolean> {
  return browser.execute(() => {
    const bar = document.querySelector(".og-bases-gantt .wx-bar") as HTMLElement | null;
    if (!bar) return false;
    bar.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    return true;
  });
}

/** Whether at least one `.wx-selected` element exists inside the Gantt. */
async function hasSelection(): Promise<boolean> {
  return browser.execute(() => !!document.querySelector(".og-bases-gantt .wx-selected"));
}

/**
 * Open the Gantt.base in the active leaf and wait for bars to render.
 * Navigate away to a markdown file first (if a gantt is already open) to force
 * a full Svelte remount — clearing SVAR's ephemeral selection state.
 */
async function openFreshGantt(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    const ws = app.workspace as unknown as {
      getLeaf: (mode: false) => { openFile: (f: unknown) => Promise<void> };
      setActiveLeaf: (l: unknown, opts?: { focus?: boolean }) => void;
      revealLeaf: (l: unknown) => void;
    };

    const ganttFile = app.vault.getAbstractFileByPath("Gantt.base");
    // Navigate away first (to a markdown file) if we're already on the base —
    // this forces Obsidian to unmount and remount the Gantt view on the next
    // openFile call, clearing SVAR ephemeral selection state.
    const pingFile = app.vault.getAbstractFileByPath("Phase A.md");
    if (pingFile) {
      const leaf = ws.getLeaf(false);
      await leaf.openFile(pingFile as never);
    }
    if (ganttFile) {
      const leaf = ws.getLeaf(false);
      await leaf.openFile(ganttFile as never);
      ws.setActiveLeaf(leaf, { focus: true });
      ws.revealLeaf(leaf);
    }
  });

  // Wait for bars to appear with no selection (fresh mount).
  await browser.waitUntil(
    async () => browser.execute(() => document.querySelectorAll(".og-bases-gantt .wx-bar").length > 0),
    { timeout: 60000, timeoutMsg: "Gantt chart did not render any task bars" }
  );
  // Confirm no selection left from a prior test.
  await browser.waitUntil(
    async () => browser.execute(() => !document.querySelector(".og-bases-gantt .wx-selected")),
    { timeout: 5000, timeoutMsg: "Gantt did not reach a clean no-selection state after remount" }
  );
}

describe("Gantt (OG) bar click — select-first", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-gantt-bar-click-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({ vault: tmpVault, plugins: ["tasknotes-gantt"] });

    // Bases core plugin must be ON to open the `.base` file.
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
  });

  beforeEach(async () => {
    // Open a fresh Gantt with empty selection for each test.
    await openFreshGantt();
  });

  it("first single-click on an unselected bar selects + highlights, opens nothing (R1)", async () => {
    const before = await activeFilePath();
    expect(await hasSelection()).toBe(false);

    await clickFirstBar();

    // Row becomes highlighted...
    await browser.waitUntil(hasSelection, { timeout: 5000, timeoutMsg: "Bar did not get the .wx-selected highlight on first click" });
    // ...and the select-first gate held: nothing opened (active file unchanged),
    // even after the 250ms single-action defer window.
    await browser.pause(400);
    expect(await activeFilePath()).toBe(before);
  });

  it("second single-click on the now-selected bar opens the note (R4)", async () => {
    const before = await activeFilePath();

    await clickFirstBar(); // selects only
    await browser.waitUntil(hasSelection, { timeout: 5000, timeoutMsg: "First click did not select the bar" });

    await clickFirstBar(); // already selected → activates (falls back to open-note)
    await browser.waitUntil(
      async () => {
        const p = await activeFilePath();
        return !!p && p !== before && p.endsWith(".md");
      },
      { timeout: 5000, timeoutMsg: "Second click did not open the note" }
    );
    // Explicit assertion on the resolved state (a note opened on the 2nd click).
    expect(await activeFilePath()).toMatch(/\.md$/);
  });

  it("double-click on an unselected bar opens the note in one gesture (R5)", async () => {
    const before = await activeFilePath();

    await dblClickFirstBar();
    await browser.waitUntil(
      async () => {
        const p = await activeFilePath();
        return !!p && p !== before && p.endsWith(".md");
      },
      { timeout: 5000, timeoutMsg: "Double-click did not open the note" }
    );
    // Explicit assertion on the resolved state (a note opened on double-click).
    expect(await activeFilePath()).toMatch(/\.md$/);
  });
});
