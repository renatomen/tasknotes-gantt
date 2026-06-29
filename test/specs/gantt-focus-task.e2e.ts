import { browser, expect, $, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Focus-on-task spec (R1/R3/R4/R7).
 *
 * Boots Obsidian against `test/vaults/gantt-readonly` (Bases-only; parents
 * Phase A / Phase B with children Task A1 + Shared Task). Exercises the focus
 * flow end-to-end through the crosshair button:
 *   - collapse all so a child (Task A1, under Phase A) is hidden;
 *   - open the focus search (crosshair button), type the child name, choose it;
 *   - assert the parent re-expanded (the child bar exists again) and the child
 *     is selected (`.wx-selected`) — i.e. focus expanded only the needed
 *     ancestor and highlighted the target (R4 + R7).
 * A second case focuses a top-level task (no ancestors) and asserts selection.
 *
 * The Obsidian FuzzySuggestModal renders at the document root (`.prompt`), not
 * inside `.og-bases-gantt`. SELECTOR NOTE: `.og-focus-btn` + `.collapse-all`
 * are plugin-owned floating controls; `.wx-bar`/`.wx-selected` are SVAR hooks.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-readonly");

async function openBaseAndWaitForBars(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    // Detach any prior Gantt leaf so there is exactly one `.og-bases-gantt` root
    // (a fresh mount per test; avoids a stale background button being matched).
    const stale: { detach(): void }[] = [];
    app.workspace.iterateAllLeaves((leaf: unknown) => {
      const el = (leaf as { view?: { containerEl?: HTMLElement } }).view?.containerEl;
      if (el?.querySelector?.(".og-bases-gantt")) stale.push(leaf as { detach(): void });
    });
    for (const leaf of stale) leaf.detach();

    const file = app.vault.getAbstractFileByPath("Gantt.base");
    if (file) {
      await app.workspace.getLeaf(true).openFile(file as never);
    }
  });
  await browser.waitUntil(
    async () => (await $$(".og-bases-gantt .wx-bar")).length > 0,
    { timeout: 60000, timeoutMsg: "Gantt chart did not render any task bars" }
  );
}

describe("Gantt (OG) focus on task", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-gantt-focus-task-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({ vault: tmpVault, plugins: ["tasknotes-gantt"] });

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
  });

  beforeEach(async () => {
    await openBaseAndWaitForBars();
  });

  it("focuses a collapsed child: expands its parent and selects it (R4/R7)", async () => {
    const initialBars = (await $$(".og-bases-gantt .wx-bar")).length;
    expect(initialBars).toBe(5); // Phase A, Phase B, Task A1, Shared Task ×2 (multi-parent)

    // Collapse all → Phase A/B collapse, hiding Task A1 (and Shared Task).
    const collapseBtn = await $(".og-bases-gantt .collapse-all");
    await collapseBtn.click();
    await browser.waitUntil(
      async () => (await $$(".og-bases-gantt .wx-bar")).length < initialBars,
      { timeout: 5000, timeoutMsg: "collapse-all did not hide child bars" }
    );
    // The Task A1 bar is gone while its parent is collapsed.
    expect((await $$('.og-bases-gantt .wx-bar[data-id*="Task A1.md"]')).length).toBe(0);

    // Open the focus search and choose Task A1.
    const focusBtn = await $(".og-bases-gantt .og-focus-btn");
    await focusBtn.click();
    const input = await $("input.prompt-input");
    await input.waitForExist({ timeout: 5000 });
    await input.setValue("Task A1");
    await browser.keys("Enter");

    // Parent re-expanded → the Task A1 bar exists again, and is selected.
    await browser.waitUntil(
      async () => (await $$('.og-bases-gantt .wx-bar[data-id*="Task A1.md"]')).length > 0,
      { timeout: 5000, timeoutMsg: "focus did not expand the parent to reveal Task A1" }
    );
    await browser.waitUntil(
      async () => (await $$(".og-bases-gantt .wx-selected")).length > 0,
      { timeout: 5000, timeoutMsg: "focus did not select/highlight a bar" }
    );
  });

  it("focuses a top-level task (no ancestors) and selects it", async () => {
    const focusBtn = await $(".og-bases-gantt .og-focus-btn");
    await focusBtn.click();
    const input = await $("input.prompt-input");
    await input.waitForExist({ timeout: 5000 });
    await input.setValue("Phase B");
    await browser.keys("Enter");

    await browser.waitUntil(
      async () => (await $$(".og-bases-gantt .wx-selected")).length > 0,
      { timeout: 5000, timeoutMsg: "focusing a top-level task did not select it" }
    );
    // No expansion was needed; the Phase B bar is present and selected.
    expect((await $$('.og-bases-gantt .wx-bar[data-id*="Phase B.md"]')).length).toBeGreaterThan(0);
  });
});
