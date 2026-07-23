import { browser, expect, $, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * U5 — the decoupled Estimate-meaning × Non-working-day-rendering axes, end to
 * end against real Obsidian + SVAR. The old single `calendarMode` fused two
 * knobs; these specs drive the combinations that fusion left unreachable:
 *
 *   - AE2 `calendar-days` + `split`: an AUTHORED start+due bar keeps its span
 *     (no re-projection) yet reveals the non-working days inside it as dimmed
 *     segments — the previously-impossible "elapsed dates with the gaps drawn."
 *   - AE3 `calendar-days` + `shaded`: the same bar stays continuous, the
 *     non-working days living only in the background tint (no segments).
 *   - AE4/AE7 `working-days` default + one `calendar-days` per-task override:
 *     the overridden bar carries the top-edge tick; the defaulted one does not.
 *
 * AE1 (`working-days` + `split` stretch + ghosts) is covered by
 * `gantt-calendar-stretch.e2e.ts`; AE8 (fully-blocked degrade) is a deterministic
 * unit concern (`isSpanFullyBlocked` + the controller suppression test), not a
 * today-dependent placeholder e2e.
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

const CONCRETE_BAR = '.og-bases-gantt .wx-bar[data-id$="Task Associated.md"]';
const OVERRIDE_BAR = '.og-bases-gantt .wx-bar[data-id$="Task Override.md"]';
const STRETCH_BAR = '.og-bases-gantt .wx-bar[data-id$="Task Stretch.md"]';

describe("Gantt (OG) decoupled calendar axes", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-gantt-calendar-axes-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({ vault: tmpVault, plugins: ["tasknotes-gantt"] });
    await enableBases();
  });

  it("calendar-days + split: an authored bar keeps its span but shows blocked segments (AE2)", async () => {
    await openBase("CalendarAxesConcreteSplit.base");
    // The concrete (authored start+due) task reveals segments — impossible under
    // the old fused knob, where only inferred/stretched bars ever ghosted.
    await browser.waitUntil(
      async () => (await $$(`${CONCRETE_BAR} .og-ghost-run`)).length > 0,
      { timeout: 30000, timeoutMsg: "concrete bar never rendered segments under split" }
    );
    const opacity = await browser.execute((selector: string) => {
      const ghost = document.querySelector(`${selector} .og-ghost-run.og-ghost-blocked`);
      return ghost ? window.getComputedStyle(ghost).opacity : null;
    }, CONCRETE_BAR);
    expect(opacity).toBe("0.15");
    // The host bar carries SVAR's own wx-split class (transparency, no fill contest).
    const barClass = await browser.execute((selector: string) => {
      return document.querySelector(selector)?.className ?? null;
    }, CONCRETE_BAR);
    expect(barClass).toContain("wx-split");
  });

  it("calendar-days + shaded: the same bar stays continuous with no segments (AE3)", async () => {
    await openBase("CalendarAxesShaded.base");
    await expect($(CONCRETE_BAR)).toExist();
    const ghosts = await $$(`${CONCRETE_BAR} .og-ghost-run`);
    expect(ghosts.length).toBe(0);
    const barClass = await browser.execute((selector: string) => {
      return document.querySelector(selector)?.className ?? null;
    }, CONCRETE_BAR);
    expect(barClass).not.toContain("wx-split");
  });

  it("working-days default + calendar-days override: only the overridden bar carries the tick (AE4/AE7)", async () => {
    await openBase("CalendarAxesOverride.base");
    await expect($(OVERRIDE_BAR)).toExist();
    await expect($(STRETCH_BAR)).toExist();
    // The overridden task (effective calendar-days ≠ the working-days default)
    // shows the top-edge tick, hoverable for the interpretation.
    await browser.waitUntil(
      async () => (await $$(`${OVERRIDE_BAR} .og-override-tick`)).length > 0,
      { timeout: 30000, timeoutMsg: "override tick never rendered on the overridden bar" }
    );
    const tickTitle = await browser.execute((selector: string) => {
      return document.querySelector(`${selector} .og-override-tick`)?.getAttribute("title") ?? null;
    }, OVERRIDE_BAR);
    expect(tickTitle).toContain("calendar days");
    // A task following the view default carries no tick.
    const defaultTicks = await $$(`${STRETCH_BAR} .og-override-tick`);
    expect(defaultTicks.length).toBe(0);
  });
});
