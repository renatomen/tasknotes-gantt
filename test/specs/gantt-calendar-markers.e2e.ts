/* global WheelEvent */
import { browser, expect, $, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * U11 — marker overlay + today line spec (covers AE9).
 *
 * SVAR's own marker feature is force-disabled in the MIT build, and cell-class
 * markers would vanish at week/month zoom (SVAR builds per-column cells only at
 * day/hour units), so markers are a plugin-owned overlay positioned from the
 * contract choke-point. This spec asserts, against real Obsidian + SVAR:
 *   1. a flagged calendar event renders as a labeled line in its calendar's
 *      colour, and its column is NOT shaded by that entry (markers are lines,
 *      never blocking time);
 *   2. the marker survives zooming out to week and month levels — the case
 *      cell-class markers could not serve;
 *   3. the generated today line renders.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-calendar");

const TRANSPARENT = new Set(["rgba(0, 0, 0, 0)", "transparent"]);

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

/** Zoom by driving SVAR's own public zoom-scale action. */
async function zoomOut(steps: number): Promise<void> {
  for (let i = 0; i < steps; i++) {
    await browser.execute(() => {
      const chart = document.querySelector(".og-bases-gantt .wx-chart");
      chart?.dispatchEvent(
        new WheelEvent("wheel", { deltaY: 120, ctrlKey: true, bubbles: true })
      );
    });
    await browser.pause(300);
  }
}

const markerCount = async (): Promise<number> =>
  (await $$(".og-bases-gantt .og-marker")).length;

const isoDay = (offsetDays: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
};

/**
 * The today line only renders when today falls inside the drawn chart span,
 * and the fixture's own tasks are fixed in April 2026. Write a task spanning
 * today into the temp vault so the span reaches it — dates must be computed at
 * run time, so this cannot be a static fixture file.
 */
function writeTaskSpanningToday(vaultPath: string): void {
  fs.writeFileSync(
    path.join(vaultPath, "Task Spanning Today.md"),
    `---\nstart: ${isoDay(-2)}\ndue: ${isoDay(2)}\n---\n\nExtends the chart span across today so the generated today line is drawn.\n`,
    "utf8"
  );
}

describe("Gantt (OG) calendar markers", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-gantt-markers-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });
    writeTaskSpanningToday(tmpVault);

    await browser.reloadObsidian({ vault: tmpVault, plugins: ["tasknotes-gantt"] });
    await enableBases();
    await openBase("Calendar.base");
  });

  it("renders a flagged event as a labeled line in the calendar's colour", async () => {
    await browser.waitUntil(async () => (await markerCount()) > 0, {
      timeout: 30000,
      timeoutMsg: "marker overlay never rendered",
    });

    const marker = await $('.og-bases-gantt .og-marker[data-og-marker="Release Cutoff"]');
    await expect(marker).toExist();

    // The line and its label chip share one colour, SVAR-style: the chip
    // inherits the line's background. The fixture calendar's colour is #2a9d8f.
    const colors = await browser.execute(() => {
      const line = document.querySelector<HTMLElement>(
        '.og-bases-gantt .og-marker[data-og-marker="Release Cutoff"]'
      );
      const chip = line?.querySelector<HTMLElement>(".og-marker-label");
      return {
        line: line ? window.getComputedStyle(line).backgroundColor : null,
        chip: chip ? window.getComputedStyle(chip).backgroundColor : null,
      };
    });
    expect(colors.line).toBe("rgb(42, 157, 143)");
    expect(colors.chip).toBe("rgb(42, 157, 143)");

    const label = await marker.$(".og-marker-label");
    expect(await label.getText()).toBe("Release Cutoff");
  });

  it("centres the label chip on its marker line", async () => {
    const offset = await browser.execute(() => {
      const line = document.querySelector(
        '.og-bases-gantt .og-marker[data-og-marker="Release Cutoff"]'
      );
      const chip = line?.querySelector(".og-marker-label");
      if (!line || !chip) return null;
      const lineBox = line.getBoundingClientRect();
      const chipBox = chip.getBoundingClientRect();
      return Math.abs(
        (chipBox.left + chipBox.width / 2) - (lineBox.left + lineBox.width / 2)
      );
    });
    expect(offset).not.toBeNull();
    expect(offset as number).toBeLessThan(1.5);
  });

  it("does not shade the marker's own column (markers are lines, not blocked time)", async () => {
    const background = await browser.execute(() => {
      const cell = document.querySelector(
        ".og-bases-gantt .wx-gantt-holidays .og-d-2026-04-14"
      );
      return cell ? window.getComputedStyle(cell).backgroundColor : null;
    });
    expect(background === null || TRANSPARENT.has(background)).toBe(true);
  });

  it("renders the generated today line inside the drawn span", async () => {
    await browser.waitUntil(
      async () => (await $$('.og-bases-gantt .og-marker[data-og-marker="today"]')).length > 0,
      { timeout: 30000, timeoutMsg: "today line never rendered" }
    );
    const today = await $('.og-bases-gantt .og-marker[data-og-marker="today"]');
    expect(await today.getAttribute("class")).toContain("og-marker-today");
  });

  it("keeps the marker visible after zooming out to coarser scales", async () => {
    const before = await markerCount();
    expect(before).toBeGreaterThan(0);

    await zoomOut(3);

    await browser.waitUntil(
      async () => {
        const marker = await $$(
          '.og-bases-gantt .og-marker[data-og-marker="Release Cutoff"]'
        );
        return marker.length > 0;
      },
      { timeout: 20000, timeoutMsg: "marker disappeared after zooming out" }
    );
  });
});
