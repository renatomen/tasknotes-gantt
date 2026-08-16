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
 * is pure CSS (`--wx-gantt-holiday-background`), so the assertions ask the
 * browser how much paint each cell ended up carrying.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-calendar");

/**
 * How much paint a cell carries, 0 to 255, or null when the cell is absent.
 *
 * Asks the browser to resolve the colour rather than comparing the text it
 * prints. A set of known transparent spellings looks equivalent and is not:
 * CSS Color 4 keeps `oklch()` and `color(srgb ...)` in their own notation and
 * serialises a zero alpha as written, so `oklch(60% 0.1 240 / 0)` is invisible
 * and matches no such set — a cell with nothing on it would have counted as
 * shaded, and the case asserting it would have passed. Painting the colour and
 * reading the pixel back settles it in whatever notation it arrives in.
 *
 * The canvas begins transparent and is left that way if the colour will not
 * parse, so an unreadable value reads as unpainted and fails a case that
 * expected shading, rather than the reverse.
 */
async function cellPaint(scope: string, dateClass: string): Promise<number | null> {
  return browser.execute(
    (containerClass: string, cls: string) => {
      const cell = document.querySelector(`.og-bases-gantt .${containerClass} .${cls}`);
      if (!cell) return null;
      const context = document.createElement("canvas").getContext("2d");
      if (!context) return null;
      context.fillStyle = "rgba(0, 0, 0, 0)";
      context.fillStyle = window.getComputedStyle(cell).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return context.getImageData(0, 0, 1, 1).data[3] ?? null;
    },
    scope,
    dateClass
  );
}

const bodyPaint = (dateClass: string): Promise<number | null> =>
  cellPaint("wx-gantt-holidays", dateClass);

const headerPaint = (dateClass: string): Promise<number | null> => cellPaint("wx-scale", dateClass);

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
    async () => (await $$(".og-bases-gantt .wx-bar").length) > 0,
    { timeout: 60000, timeoutMsg: `Gantt did not render bars for ${basePath}` }
  );
}

/**
 * Poll a body cell until it carries paint, and return how much.
 *
 * Returning it is the point. Waiting proves only that the cell settled, so a
 * case ending at the wait asserts nothing; handing the settled value back leaves
 * the caller something it can assert on directly.
 */
async function paintedBody(dateClass: string): Promise<number> {
  let settled = 0;
  await browser.waitUntil(
    async () => {
      const paint = await bodyPaint(dateClass);
      if (paint === null || paint === 0) return false;
      settled = paint;
      return true;
    },
    { timeout: 30000, timeoutMsg: `${dateClass} never shaded` }
  );
  return settled;
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
    expect(await paintedBody("og-d-2026-04-10")).toBeGreaterThan(0);
  });

  it("shades the holiday's scale-header cell to match the body column", async () => {
    await browser.waitUntil(async () => ((await headerPaint("og-d-2026-04-10")) ?? 0) > 0, {
      timeout: 30000,
      timeoutMsg: "holiday header cell never shaded",
    });

    expect(await headerPaint("og-d-2026-04-10")).toBeGreaterThan(0);
    expect(await headerPaint("og-d-2026-04-08")).toBe(0);
  });

  it("leaves an ordinary weekday identity cell unpainted (upgrade-invisible)", async () => {
    expect(await bodyPaint("og-d-2026-04-08")).toBe(0);
  });

  it("keeps locale weekend shading alongside calendar shading", async () => {
    const weekend = await $(".og-bases-gantt .wx-gantt-holidays .wx-weekend");
    await expect(weekend).toExist();
  });

  it("re-shades live when the calendar note gains a holiday (watch liveness)", async () => {
    // The precondition belongs to this case rather than to the order the file
    // happens to run in. Without it, a cell already shaded would satisfy the
    // wait on arrival and the case would report liveness having observed none.
    expect(await bodyPaint("og-d-2026-04-08")).toBe(0);

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

    expect(await paintedBody("og-d-2026-04-08")).toBeGreaterThan(0);
  });
});
