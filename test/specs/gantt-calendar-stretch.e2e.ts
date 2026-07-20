import { browser, expect, $, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * U7 — working-time stretch + 15%-ghost rendering spec.
 *
 * Boots Obsidian against the `test/vaults/gantt-calendar` fixture with the
 * stretch-mode base: a start-only three-working-day task anchored on the
 * Friday holiday of a Mon-Fri calendar. End to end against real Obsidian +
 * SVAR this asserts:
 *   1. the stretched bar renders as pieces — a blocked ghost at 15% computed
 *      opacity (holiday + weekend) and a solid working piece (AE2's render
 *      half: the shaded background reads through the ghost);
 *   2. the host bar carries SVAR's own `wx-split` class (the transparency
 *      condition) — no fill contest;
 *   3. the split-task segment vocabulary never appears on a calendar-ghost
 *      bar (AE6: calendar gaps and occurrence gaps stay distinct languages);
 *   4. a task without an associated calendar renders as a plain continuous
 *      bar with no ghost pieces (upgrade-invisible regression).
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-calendar");

async function enableBases(): Promise<void> {
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
}

async function openBase(basePath: string): Promise<void> {
  await browser.executeObsidian(async ({ app }, p) => {
    app.workspace.detachLeavesOfType("bases");
    const file = app.vault.getAbstractFileByPath(p);
    if (file) {
      await app.workspace.getLeaf(true).openFile(file as never);
    }
  }, basePath);

  await browser.waitUntil(
    async () => (await $$(".og-bases-gantt .wx-bar")).length > 0,
    { timeout: 60000, timeoutMsg: `Gantt did not render bars for ${basePath}` }
  );
}

const STRETCH_BAR = '.og-bases-gantt .wx-bar[data-id$="Task Stretch.md"]';
const PLAIN_BAR = '.og-bases-gantt .wx-bar[data-id$="Task Plain.md"]';

describe("Gantt (OG) working-time stretch ghost rendering", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-gantt-calendar-stretch-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({ vault: tmpVault, plugins: ["tasknotes-gantt"] });
    await enableBases();
    await openBase("CalendarStretch.base");
  });

  it("renders the stretched bar as pieces with a 15%-opacity blocked ghost", async () => {
    await browser.waitUntil(
      async () => (await $$(`${STRETCH_BAR} .og-ghost-run`)).length > 0,
      { timeout: 30000, timeoutMsg: "ghost pieces never rendered" }
    );
    const opacity = await browser.execute((selector: string) => {
      const ghost = document.querySelector(`${selector} .og-ghost-run.og-ghost-blocked`);
      return ghost ? window.getComputedStyle(ghost).opacity : null;
    }, STRETCH_BAR);
    expect(opacity).toBe("0.15");
    const workingPieces = await $$(`${STRETCH_BAR} .og-ghost-run:not(.og-ghost-blocked)`);
    expect(workingPieces.length).toBeGreaterThan(0);
  });

  it("stamps SVAR's own wx-split class on the host bar", async () => {
    const barClass = await browser.execute((selector: string) => {
      return document.querySelector(selector)?.className ?? null;
    }, STRETCH_BAR);
    expect(barClass).toContain("wx-split");
  });

  it("never uses the split-task segment vocabulary for calendar ghosts (AE6)", async () => {
    const segments = await $$(".og-bases-gantt .wx-segment");
    expect(segments.length).toBe(0);
  });

  it("leaves an unassociated task as a plain continuous bar", async () => {
    await expect($(PLAIN_BAR)).toExist();
    const ghosts = await $$(`${PLAIN_BAR} .og-ghost-run`);
    expect(ghosts.length).toBe(0);
    const plainClass = await browser.execute((selector: string) => {
      return document.querySelector(selector)?.className ?? null;
    }, PLAIN_BAR);
    expect(plainClass).not.toContain("wx-split");
  });

  it("keeps the inferred-date border visible on a stretched bar", async () => {
    // DELIBERATE, and pinned so it cannot be quietly removed: a stretched task's
    // end is derived from its estimate, and the date-status border is currently
    // the only cue that a date was computed rather than authored. It is visually
    // heavy — it boxes the whole authored span, blocked days included — but the
    // annoyance stays until a provenance-aware cue replaces it. Removing this
    // border without a replacement leaves derived dates indistinguishable from
    // authored ones.
    await openBase("CalendarStretchStrip.base");
    await browser.waitUntil(
      async () => (await $$(`${STRETCH_BAR} .og-ghost-run`)).length > 0,
      { timeout: 30000, timeoutMsg: "ghost pieces never rendered in strip mode" }
    );
    const borderColor = await browser.execute((selector: string) => {
      const bar = document.querySelector(selector);
      return bar ? window.getComputedStyle(bar).borderTopColor : null;
    }, STRETCH_BAR);
    expect(borderColor).not.toBeNull();
    expect(borderColor).not.toBe("rgba(0, 0, 0, 0)");
  });
});
