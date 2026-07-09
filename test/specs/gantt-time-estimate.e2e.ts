import { browser, expect, $, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * U7 — Time Estimate inference render spec (AE1, AE2).
 *
 * Boots Obsidian against the `test/vaults/gantt-estimate` fixture (standalone
 * Bases mode — no TaskNotes) and asserts the estimate-driven date inference
 * end-to-end against real Obsidian + SVAR:
 *   1. a start-only task with a 2880-min (2-day) estimate renders a bar WIDER
 *      than an otherwise-identical start-only task with no estimate (which falls
 *      back to the 1-day default) — the estimate overrides the default duration
 *      (AE1);
 *   2. a dateless task with a 120-min estimate renders a single-day placeholder
 *      at today (right of the April tasks), carrying the inferred indicator (AE2).
 *
 * Standalone Bases mode reads the estimate from the mapped "Time Estimate"
 * property (R6), so this needs no TaskNotes companion. The write round-trip
 * (Property-mode resize → estimate write, AE4) is contract-covered by unit tests
 * and verified manually in the vault; drag simulation is not scripted here.
 *
 * SELECTOR NOTE: bars are SVAR `.wx-bar` elements carrying `data-id` = the note
 * path, DOM-encoded with a leading ":" (SVAR `setID`), so we target with the
 * ends-with form `[data-id$="X.md"]`. See gantt-date-handling.e2e.ts.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-estimate");

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

describe("Gantt (OG) time-estimate inference", () => {
  before(async () => {
    // Hermetic: copy the in-repo fixture vault to a disposable temp dir.
    const tmpVault = path.join(os.tmpdir(), "og-gantt-estimate-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({ vault: tmpVault, plugins: ["tasknotes-gantt"] });
    await enableBases();
    await openBase("Estimate.base");
  });

  it("renders all three tasks (start+estimate, start-default, dateless+estimate)", async () => {
    const bars = await $$(".og-bases-gantt .wx-bar");
    expect(bars).toHaveLength(3);
    await expect($(`.og-bases-gantt .wx-bar[data-id$="Start Estimate.md"]`)).toBeExisting();
    await expect($(`.og-bases-gantt .wx-bar[data-id$="Start Default.md"]`)).toBeExisting();
    await expect($(`.og-bases-gantt .wx-bar[data-id$="Dateless Estimate.md"]`)).toBeExisting();
  });

  it("makes the estimate-driven bar wider than the default-duration bar (AE1)", async () => {
    // Same start date; the 2-day estimate must render a wider bar than the 1-day
    // default, proving the estimate overrides defaultDuration in inference.
    const withEstimate = await $(`.og-bases-gantt .wx-bar[data-id$="Start Estimate.md"]`);
    const withDefault = await $(`.og-bases-gantt .wx-bar[data-id$="Start Default.md"]`);
    const estWidth = (await withEstimate.getSize()).width;
    const defWidth = (await withDefault.getSize()).width;
    expect(estWidth).toBeGreaterThan(defWidth);
  });

  it("places the dateless+estimate task as a flagged placeholder at today (AE2)", async () => {
    const dateless = await $(`.og-bases-gantt .wx-bar[data-id$="Dateless Estimate.md"]`);
    const aprilTask = await $(`.og-bases-gantt .wx-bar[data-id$="Start Estimate.md"]`);
    // Placeholder at today sits to the RIGHT of the April tasks.
    expect((await dateless.getLocation()).x).toBeGreaterThan((await aprilTask.getLocation()).x);
    // A dateless (placeholder) row carries the inferred date-status indicator.
    expect((await dateless.getAttribute("class")).includes("datestatus-flagged")).toBe(true);
  });
});
