import { browser, expect, $, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Plan 003 U2 viewport-sizing spec (fit-to-content up to a max, then scroll).
 *
 * Boots Obsidian against the `test/vaults/gantt-viewport` fixture — one parent
 * ("Project Roadmap") with 12 children and `tngantt_maxHeight: 400` — opens the
 * base, and drives the SVAR grid's expand/collapse toggle to assert the host
 * (`.og-bases-gantt`) height tracks the *visible* row set:
 *
 *   1. Expanded (13 rows) exceeds the 400px cap → the host caps at ~400 and the
 *      chart scrolls internally (R2 tall case / F2).
 *   2. Collapsing the parent (→ 1 visible row) shrinks the host well below the
 *      cap (R2 short case / R3 floor / F1 — no empty 400px box).
 *   3. Expanding again grows the host back to the cap.
 *
 * Steps 2↔3 prove the height is driven by SVAR's *collapse-aware* visible-row
 * store (`_tasks`), not the fully-expanded controller list — the core KTD of
 * the plan. Exact pixel values depend on the scale-row count, so assertions use
 * ranges + relative direction, not exact px (the precise math is unit-tested in
 * `ganttHeight.test.ts`).
 *
 * SELECTOR NOTE: `.og-bases-gantt` is owned by this plugin and stable;
 * `.wx-bar` is SVAR's chart bar and `.wx-toggle-icon[data-action="open-task"]`
 * is SVAR's grid expand/collapse control (verified against
 * @svar-ui/svelte-gantt's TextCell.svelte).
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-viewport");

const MAX_HEIGHT = 400;

/** Rendered height (px) of the Gantt host. */
async function hostHeight(): Promise<number> {
  const el = await $(".og-bases-gantt");
  const size = await el.getSize();
  return size.height;
}

describe("Gantt (OG) viewport sizing", () => {
  before(async () => {
    // Hermetic: copy the in-repo fixture vault to a disposable temp dir (ignores
    // OBSIDIAN_TEST_VAULT; CI points it at an empty runner vault).
    const tmpVault = path.join(os.tmpdir(), "og-gantt-viewport-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({
      vault: tmpVault,
      plugins: ["tasknotes-gantt"],
    });

    // Rendering a `.base` requires the Bases core plugin enabled.
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

    // Open the .base file; Obsidian renders it with the registered Gantt view.
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getAbstractFileByPath("Roadmap.base");
      if (file) {
        await app.workspace.getLeaf(true).openFile(file as never);
      }
    });

    // Wait for our Svelte root + SVAR chart to mount.
    await browser.waitUntil(
      async () => (await $$(".og-bases-gantt .wx-bar")).length > 0,
      { timeout: 60000, timeoutMsg: "Gantt chart did not render any task bars" }
    );
  });

  it("caps the host at the configured max-height when content is taller (R2/F2)", async () => {
    // 13 expanded rows exceed the 400px cap → host pinned at ~400.
    await browser.waitUntil(async () => (await hostHeight()) >= MAX_HEIGHT - 5, {
      timeout: 10000,
      timeoutMsg: "host did not reach the max-height cap while expanded",
    });
    const h = await hostHeight();
    expect(h).toBeGreaterThanOrEqual(MAX_HEIGHT - 5);
    expect(h).toBeLessThanOrEqual(MAX_HEIGHT + 5);
  });

  it("fits-to-content (shrinks well below the cap) when the parent is collapsed (R2/R3/F1)", async () => {
    const expanded = await hostHeight();

    // Collapse the single parent row via SVAR's grid toggle.
    const toggle = await $(".og-bases-gantt .wx-toggle-icon[data-action='open-task']");
    await expect(toggle).toBeExisting();
    await toggle.click();

    // The collapse-aware store now reports 1 visible row → host shrinks far below
    // the 400 cap (down to the ~2-row floor region).
    await browser.waitUntil(async () => (await hostHeight()) < 250, {
      timeout: 10000,
      timeoutMsg: "host did not shrink after collapsing the parent",
    });
    const collapsed = await hostHeight();
    expect(collapsed).toBeLessThan(250);
    expect(collapsed).toBeLessThan(expanded);
  });

  it("grows the host back to the cap when the parent is expanded again (R4)", async () => {
    const collapsed = await hostHeight();

    const toggle = await $(".og-bases-gantt .wx-toggle-icon[data-action='open-task']");
    await toggle.click();

    await browser.waitUntil(async () => (await hostHeight()) >= MAX_HEIGHT - 5, {
      timeout: 10000,
      timeoutMsg: "host did not grow back after expanding the parent",
    });
    const reExpanded = await hostHeight();
    expect(reExpanded).toBeGreaterThan(collapsed);
    expect(reExpanded).toBeGreaterThanOrEqual(MAX_HEIGHT - 5);
  });
});
