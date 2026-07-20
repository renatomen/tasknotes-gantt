import { browser, expect, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * U12 — calendar as a bar-colour source (R20).
 *
 * The fixture vault holds two coloured calendars (NZ Holidays #2a9d8f, Sun Thu
 * #e76f51) with one task associated to each, plus an unassociated task. This
 * spec asserts against real Obsidian + SVAR that the two associated bars take
 * their own calendar's colour in both fill and strip modes, and that the
 * unassociated task falls back to the default treatment rather than rendering
 * untreated.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/**
 * Its OWN vault, deliberately. Adding a second associated task to the shared
 * calendar vault silently turned the shading spec's view into a two-calendar
 * display, where a newly-blocked day becomes a CONFLICT painted with stripes
 * (a background-image) — quietly breaking an assertion that reads
 * background-color. Colour fixtures stay isolated so specs can't reshape each
 * other's semantics.
 */
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-calendar-colour");

const NZ_COLOR = "rgb(42, 157, 143)";
const SUN_THU_COLOR = "rgb(231, 111, 81)";

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

/** Bar body colour (fill mode) keyed by the bar's visible text. */
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

/** Strip accent colour (the ::before pseudo-element) keyed by bar text. */
async function stripColors(): Promise<Record<string, string>> {
  return browser.execute(() => {
    const out: Record<string, string> = {};
    for (const bar of Array.from(document.querySelectorAll(".og-bases-gantt .wx-bar"))) {
      const text = (bar.textContent ?? "").trim();
      if (text) out[text] = window.getComputedStyle(bar, "::before").backgroundColor;
    }
    return out;
  });
}

const forTask = (colors: Record<string, string>, name: string): string | undefined =>
  Object.entries(colors).find(([text]) => text.includes(name))?.[1];

describe("Gantt (OG) calendar bar-colour source", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-gantt-colour-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({ vault: tmpVault, plugins: ["tasknotes-gantt"] });
    await enableBases();
    await openBase("CalendarColour.base");
  });

  it("fill: two tasks on differently-coloured calendars render distinct bar colours", async () => {
    await browser.waitUntil(
      async () => forTask(await barColors(), "Task Associated") === NZ_COLOR,
      { timeout: 30000, timeoutMsg: "associated bar never took its calendar colour" }
    );
    const colors = await barColors();
    expect(forTask(colors, "Task Associated")).toBe(NZ_COLOR);
    expect(forTask(colors, "Task Sun Thu")).toBe(SUN_THU_COLOR);
  });

  it("fill: an unassociated task falls back to the default treatment, not a bare bar", async () => {
    const colors = await barColors();
    const plain = forTask(colors, "Task Plain");
    expect(plain).toBeDefined();
    expect(plain).not.toBe(NZ_COLOR);
    expect(plain).not.toBe(SUN_THU_COLOR);
    // The default role treatment paints a real colour, never a transparent body.
    expect(plain).not.toBe("rgba(0, 0, 0, 0)");
  });

  it("strip: the accent strip takes each task's calendar colour", async () => {
    await openBase("CalendarColourStrip.base");
    await browser.waitUntil(
      async () => forTask(await stripColors(), "Task Associated") === NZ_COLOR,
      { timeout: 30000, timeoutMsg: "strip accent never took the calendar colour" }
    );
    const strips = await stripColors();
    expect(forTask(strips, "Task Associated")).toBe(NZ_COLOR);
    expect(forTask(strips, "Task Sun Thu")).toBe(SUN_THU_COLOR);
  });
});
