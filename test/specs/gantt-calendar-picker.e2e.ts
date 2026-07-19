/* global HTMLInputElement */
import { browser, expect, $, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * U10 — union shading, conflict stripes, calendar-status banner, picker.
 *
 * Boots the `gantt-calendar` fixture with a base whose stored display
 * selection shows TWO disagreeing calendars (NZ Holidays: Mon–Fri week;
 * Sun Thu: Sun–Thu week) and asserts against real Obsidian + SVAR:
 *   1. the calendar-status banner reports the multi-calendar display and the
 *      disagreement;
 *   2. a disagreement day (Sunday: NZ blocks, Sun Thu covers) paints the
 *      conflict stripes;
 *   3. the banner opens the picker (AE7's always-reachable front door);
 *   4. AE8: deselecting one calendar changes the background while a task
 *      bar's geometry is untouched.
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

async function cellBackgroundImage(dateClass: string): Promise<string | null> {
  return browser.execute((cls: string) => {
    const cell = document.querySelector(`.og-bases-gantt .wx-gantt-holidays .${cls}`);
    return cell ? window.getComputedStyle(cell).backgroundImage : null;
  }, dateClass);
}

describe("Gantt (OG) calendar picker + union shading", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-gantt-picker-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({ vault: tmpVault, plugins: ["tasknotes-gantt"] });
    await enableBases();
    await openBase("CalendarPicker.base");
  });

  it("shows the calendar-status banner for the two-calendar display", async () => {
    const banner = await $(".og-calendar-banner");
    await expect(banner).toExist();
    const text = await banner.getText();
    expect(text).toContain("Displaying 2 calendars");
    expect(text).toContain("in conflict");
  });

  it("paints conflict stripes on a disagreement day (Sunday)", async () => {
    await browser.waitUntil(
      async () => {
        const image = await cellBackgroundImage("og-d-2026-04-12");
        return image !== null && image.includes("repeating-linear-gradient");
      },
      { timeout: 30000, timeoutMsg: "Sunday disagreement never painted conflict stripes" }
    );
    // Saturday: both calendars block — agreement, plain shade, no stripes.
    const saturday = await cellBackgroundImage("og-d-2026-04-11");
    expect(saturday === null || !saturday.includes("repeating-linear-gradient")).toBe(true);
  });

  async function openPickerFromBanner(): Promise<void> {
    await (await $(".og-calendar-banner")).click();
    await browser.waitUntil(
      async () => (await $$(".modal .og-cal-picker-row")).length > 0,
      { timeout: 15000, timeoutMsg: "banner click never opened the calendar picker" }
    );
  }

  it("opens the picker from the banner", async () => {
    await openPickerFromBanner();
    const modalText = await (await $(".modal")).getText();
    expect(modalText).toContain("NZ Holidays");
    expect(modalText).toContain("Sun Thu");
    await browser.keys(["Escape"]);
  });

  it("AE8: deselecting a calendar changes the background, not the bar geometry", async () => {
    const barBefore = await browser.execute(() => {
      const bar = document.querySelector(".og-bases-gantt .wx-bar");
      const rect = bar?.getBoundingClientRect();
      return rect ? { width: rect.width, left: rect.left } : null;
    });
    expect(barBefore).not.toBeNull();

    // Own the picker's open state rather than inheriting it from a prior test.
    await openPickerFromBanner();
    await browser.execute(() => {
      const rows = Array.from(document.querySelectorAll(".modal .og-cal-picker-row"));
      const row = rows.find((candidate) => candidate.textContent?.includes("Sun Thu"));
      const checkbox = row?.querySelector<HTMLInputElement>("input[type='checkbox']");
      checkbox?.click();
    });
    await browser.keys(["Escape"]);

    // The Sunday disagreement is gone (single calendar → no conflict) …
    await browser.waitUntil(
      async () => {
        const image = await cellBackgroundImage("og-d-2026-04-12");
        return image === null || !image.includes("repeating-linear-gradient");
      },
      { timeout: 30000, timeoutMsg: "deselection never removed the conflict stripes" }
    );

    // … and the banner no longer reports two calendars.
    await browser.waitUntil(
      async () => {
        const banners = await $$(".og-calendar-banner");
        if (banners.length === 0) return true;
        const text = await banners[0].getText();
        return !text.includes("Displaying 2 calendars");
      },
      { timeout: 30000, timeoutMsg: "banner still reports two calendars after deselection" }
    );

    // Bar geometry untouched (dates never move on selection change).
    const barAfter = await browser.execute(() => {
      const bar = document.querySelector(".og-bases-gantt .wx-bar");
      const rect = bar?.getBoundingClientRect();
      return rect ? { width: rect.width, left: rect.left } : null;
    });
    expect(barAfter).not.toBeNull();
    expect(Math.abs((barAfter as { width: number }).width - (barBefore as { width: number }).width)).toBeLessThan(1.5);
    expect(Math.abs((barAfter as { left: number }).left - (barBefore as { left: number }).left)).toBeLessThan(1.5);
  });
});
