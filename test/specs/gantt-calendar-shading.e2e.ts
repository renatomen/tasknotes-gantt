import { browser, expect, $, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * U5 — calendar-aware background shading spec.
 *
 * Boots Obsidian against the `test/vaults/gantt-calendar` fixture (a calendar
 * note with one Friday holiday, an associated task spanning it, an
 * unassociated task) at day zoom and asserts, end to end against real
 * Obsidian + SVAR:
 *   1. the associated calendar's holiday column is shaded (the injected
 *      calendar stylesheet paints the static `og-d-*` identity cell);
 *   2. an ordinary weekday identity cell stays unpainted (base layout rule
 *      only — upgrade-invisible);
 *   3. locale weekend shading is intact alongside calendar shading;
 *   4. LIVENESS: editing the calendar note (adding a holiday) re-shades the
 *      chart with no interaction — the calendar watch + epoch-signature path.
 *
 * SELECTOR NOTE: SVAR renders one overlay div per visible day cell inside
 * `.wx-gantt-holidays`, classed with our classifier's whole return string —
 * `og-cal-cell og-d-YYYY-MM-DD` plus `wx-weekend` on locale weekends. Shading
 * is pure CSS (`--wx-gantt-holiday-background`), so the assertions read
 * computed background colors.
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

async function cellBackground(dateClass: string): Promise<string | null> {
  return browser.execute((cls: string) => {
    const cell = document.querySelector(`.og-bases-gantt .wx-gantt-holidays .${cls}`);
    return cell ? window.getComputedStyle(cell).backgroundColor : null;
  }, dateClass);
}

describe("Gantt (OG) calendar-aware shading", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-gantt-calendar-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({ vault: tmpVault, plugins: ["tasknotes-gantt"] });
    await enableBases();
    await openBase("Calendar.base");
  });

  it("shades the associated calendar's holiday column", async () => {
    await browser.waitUntil(
      async () => {
        const background = await cellBackground("og-d-2026-04-10");
        return background !== null && !TRANSPARENT.has(background);
      },
      { timeout: 30000, timeoutMsg: "holiday column never shaded" }
    );
  });

  it("leaves an ordinary weekday identity cell unpainted (upgrade-invisible)", async () => {
    const background = await cellBackground("og-d-2026-04-08");
    expect(background).not.toBeNull();
    expect(TRANSPARENT.has(background as string)).toBe(true);
  });

  it("keeps locale weekend shading alongside calendar shading", async () => {
    const weekend = await $(".og-bases-gantt .wx-gantt-holidays .wx-weekend");
    await expect(weekend).toExist();
  });

  it("re-shades live when the calendar note gains a holiday (watch liveness)", async () => {
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getAbstractFileByPath("NZ Holidays.md");
      if (!file) throw new Error("fixture calendar missing");
      const body = await app.vault.read(file as never);
      await app.vault.modify(
        file as never,
        (body as string).replace(
          "non_working:",
          "non_working:\n  - date: 2026-04-08\n    name: Added Live"
        )
      );
    });

    await browser.waitUntil(
      async () => {
        const background = await cellBackground("og-d-2026-04-08");
        return background !== null && !TRANSPARENT.has(background);
      },
      { timeout: 30000, timeoutMsg: "live calendar edit never re-shaded the chart" }
    );
  });
});
