import { browser, expect } from "@wdio/globals";
import { waitUntilOrExplain } from "./helpers/waitReady";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Calendar colour on a Show-all FETCHED row.
 *
 * A companion-expanded descendant reaches the chart without a Bases entry of its
 * own, and calendar associations used to be read from those entries alone — so a
 * fetched bar took the default role colour even when its note named a calendar.
 * Only real Obsidian can show this: it needs TaskNotes present (companion
 * expansion is companion-only), a Base that matches the project but NOT the
 * subtask, and the computed bar colour.
 *
 * Its own vault, deliberately: adding a calendar to a shared fixture changes what
 * the other calendar specs display (a second calendar turns days into conflicts).
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-calendar-context");

const NZ_COLOR = "rgb(42, 157, 143)";
const AU_COLOR = "rgb(231, 111, 81)";
const BASE_PATH = "ContextColour.base";

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

/**
 * Force the Gantt to be the active, visible leaf. TaskNotes opens a "Start Here"
 * note asynchronously on first install and a backgrounded Bases view unmounts its
 * DOM, so every wait re-fronts the base rather than racing that steal.
 */
async function activateBaseLeaf(): Promise<void> {
  await browser.executeObsidian(async ({ app }, basePath) => {
    const ws = app.workspace as unknown as {
      iterateAllLeaves: (cb: (l: { view?: { getViewType?: () => string }; detach?: () => void }) => void) => void;
      getLeavesOfType: (t: string) => unknown[];
      getLeaf: (newLeaf?: boolean) => { openFile: (f: unknown) => Promise<void> };
      setActiveLeaf: (l: unknown, opts?: { focus?: boolean }) => void;
      revealLeaf: (l: unknown) => void;
    };
    const markdownLeaves: Array<{ detach?: () => void }> = [];
    ws.iterateAllLeaves((l) => {
      if (l.view?.getViewType?.() === "markdown") markdownLeaves.push(l);
    });
    markdownLeaves.forEach((l) => l.detach?.());

    let baseLeaf = ws.getLeavesOfType("bases")[0];
    if (!baseLeaf) {
      const file = app.vault.getAbstractFileByPath(basePath);
      if (!file) return;
      const leaf = ws.getLeaf(true);
      await leaf.openFile(file as never);
      baseLeaf = leaf;
    }
    ws.setActiveLeaf(baseLeaf, { focus: true });
    ws.revealLeaf(baseLeaf);
  }, BASE_PATH);
}

/** Bar body colour keyed by the bar's visible text. */
async function barColors(): Promise<Record<string, string>> {
  return browser.execute(() => {
    const out: Record<string, string> = {};
    for (const bar of Array.from(document.querySelectorAll(".og-bases-gantt .wx-bar"))) {
      const text = (bar.textContent ?? "").trim();
      if (text) out[text] = window.getComputedStyle(bar).backgroundColor;
    }
    return out;
  });
}

const forTask = (colors: Record<string, string>, name: string): string | undefined =>
  Object.entries(colors).find(([text]) => text.includes(name))?.[1];

describe("Gantt (OG) calendar colour on fetched context rows", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-gantt-calendar-context-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({
      vault: tmpVault,
      plugins: ["tasknotes-gantt", "tasknotes"],
    });
    await enableBases();

    // Both rows must be present: the matched project and its fetched subtask.
    await browser.waitUntil(
      async () => {
        await activateBaseLeaf();
        return (await barColors()) && Object.keys(await barColors()).length >= 2;
      },
      { timeout: 90000, timeoutMsg: "the project and its fetched subtask never both rendered" },
    );
  });

  it("gives a fetched subtask its own calendar's colour, not the default", async () => {
    // The subtask has no Bases entry — its association is only visible through the
    // rendered instance, which is what the shading now reads.
    let lastColors: Record<string, string> = {};
    await waitUntilOrExplain(
      async () => {
        lastColors = await barColors();
        return forTask(lastColors, "Sub A1") === NZ_COLOR;
      },
      () => `fetched bar never took the calendar colour; saw ${JSON.stringify(lastColors)}`,
      { timeout: 30000 },
    );
    expect(forTask(await barColors(), "Sub A1")).toBe(NZ_COLOR);
  });

  it("leaves the unassociated matched project on a different colour", async () => {
    const colors = await barColors();
    expect(forTask(colors, "Project A")).not.toBe(NZ_COLOR);
  });

  it("re-colours the fetched bar when its association is edited mid-session", async () => {
    // The fetched note is no calendar and no Bases entry, so neither the calendar
    // watch's marker probe nor a Bases notify sees this edit — and the controller
    // snapshot compares dates/text, not associations. Only the association watch
    // refreshes it; without that the bar (and the auto shading union) stays stale
    // until an unrelated refresh.
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getAbstractFileByPath("Sub A1.md");
      if (!file) throw new Error("Sub A1.md missing");
      await (app as unknown as {
        fileManager: { processFrontMatter(f: unknown, fn: (fm: Record<string, unknown>) => void): Promise<void> };
      }).fileManager.processFrontMatter(file, (fm) => {
        fm["calendar"] = ['[[AU Holidays]]'];
      });
    });

    let lastColors: Record<string, string> = {};
    await waitUntilOrExplain(
      async () => {
        lastColors = await barColors();
        return forTask(lastColors, "Sub A1") === AU_COLOR;
      },
      () => `the fetched bar never followed its edited association; saw ${JSON.stringify(lastColors)}`,
      { timeout: 30000 },
    );
    expect(forTask(await barColors(), "Sub A1")).toBe(AU_COLOR);
  });
});
