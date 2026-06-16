import { browser, expect, $, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * U5 — missing/partial-date handling render spec.
 *
 * Boots Obsidian against the `test/vaults/gantt-dates` fixture (a complete
 * task, a due-only task, and TWO dateless tasks) and asserts the date-policy
 * end-to-end against real Obsidian + SVAR:
 *   1. default visibility renders every task regardless of date completeness
 *      (R7), including both dateless placeholders (the "today pile");
 *   2. the due-only task is placed at its deadline (left of the dateless
 *      placeholders at today), NOT spanning from today (AE1);
 *   3. non-`complete` bars carry the `.datestatus-flagged` indicator while the
 *      complete bar does not (R10);
 *   4. with "hide undated" on, the dateless tasks disappear (AE5); and with
 *      indicators off, no bar is flagged (R11).
 *
 * SELECTOR NOTE: bars are SVAR `.wx-bar` elements carrying `data-id` = the note
 * path (our instance id for these single-parent roots), so `[data-id="X.md"]`
 * targets a specific task's bar. The custom date-status type renders as the
 * bare `.datestatus-flagged` class on the bar (SVAR only `wx-`-prefixes the
 * built-in task/summary/milestone types). Verified against
 * @svar-ui/svelte-gantt v2.3.0.
 *
 * PLACEMENT NOTE: the fixture's dated tasks sit in April 2026, before any
 * realistic test-run date, so a placeholder anchored at "today" is always to
 * their right on the timeline — the basis for the date-agnostic position check.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-dates");

/** Enable the Bases core plugin (required to open a `.base`). */
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

/** Detach any open leaves and open the named base in a fresh leaf. */
async function openBase(basePath: string): Promise<void> {
  await browser.executeObsidian(async ({ app }, p) => {
    app.workspace.detachLeavesOfType("bases");
    // Also clear generic leaves holding a prior base render.
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

describe("Gantt (OG) missing/partial-date handling", () => {
  before(async () => {
    // Hermetic: copy the in-repo fixture vault to a disposable temp dir (ignores
    // OBSIDIAN_TEST_VAULT; CI points it at an empty runner vault).
    const tmpVault = path.join(os.tmpdir(), "og-gantt-dates-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({ vault: tmpVault, plugins: ["obsidian-gantt"] });
    await enableBases();
  });

  describe("default visibility (show everything)", () => {
    before(async () => {
      await openBase("Dates.base");
    });

    it("renders every task regardless of date completeness, incl. both dateless (R7, AE3)", async () => {
      // 4 source notes, all roots → 4 bars: Complete, Due Only, Dateless One/Two.
      const bars = await $$(".og-bases-gantt .wx-bar");
      expect(bars.length).toBe(4);
      await expect($(`.og-bases-gantt .wx-bar[data-id="Dateless One.md"]`)).toBeExisting();
      await expect($(`.og-bases-gantt .wx-bar[data-id="Dateless Two.md"]`)).toBeExisting();
    });

    it("places the due-only task at its deadline, not spanning from today (AE1)", async () => {
      // The due-only bar (April) must sit LEFT of a dateless placeholder
      // (anchored at today, which is well after April 2026).
      const dueOnly = await $(`.og-bases-gantt .wx-bar[data-id="Due Only.md"]`);
      const dateless = await $(`.og-bases-gantt .wx-bar[data-id="Dateless One.md"]`);
      const dueX = (await dueOnly.getLocation()).x;
      const datelessX = (await dateless.getLocation()).x;
      expect(dueX).toBeLessThan(datelessX);
    });

    it("flags non-complete bars and leaves the complete bar unflagged (R10)", async () => {
      const complete = await $(`.og-bases-gantt .wx-bar[data-id="Complete.md"]`);
      const dueOnly = await $(`.og-bases-gantt .wx-bar[data-id="Due Only.md"]`);
      const dateless = await $(`.og-bases-gantt .wx-bar[data-id="Dateless One.md"]`);

      expect((await complete.getAttribute("class")).includes("datestatus-flagged")).toBe(false);
      expect((await dueOnly.getAttribute("class")).includes("datestatus-flagged")).toBe(true);
      expect((await dateless.getAttribute("class")).includes("datestatus-flagged")).toBe(true);

      // Exactly 3 flagged (due-only + two dateless).
      const flagged = await $$(".og-bases-gantt .wx-bar.datestatus-flagged");
      expect(flagged.length).toBe(3);
    });
  });

  describe("hide-undated + indicators off", () => {
    before(async () => {
      await openBase("DatesHidden.base");
    });

    it("removes dateless tasks while complete + partial remain (AE5)", async () => {
      // Dateless One/Two hidden → 2 bars: Complete + Due Only.
      const bars = await $$(".og-bases-gantt .wx-bar");
      expect(bars.length).toBe(2);
      await expect($(`.og-bases-gantt .wx-bar[data-id="Dateless One.md"]`)).not.toBeExisting();
      await expect($(`.og-bases-gantt .wx-bar[data-id="Due Only.md"]`)).toBeExisting();
    });

    it("applies no indicator treatment when showDateIndicators is off (R11)", async () => {
      const flagged = await $$(".og-bases-gantt .wx-bar.datestatus-flagged");
      expect(flagged.length).toBe(0);
    });
  });
});
