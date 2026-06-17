import { browser, expect, $, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * U6 status-coloring spec — graceful path (R5).
 *
 * Boots Obsidian against the `gantt-readonly` fixture (no TaskNotes plugin
 * installed) and asserts that status coloring degrades gracefully: bars render
 * normally, NO bar carries a status class (`og-status-*`), and the managed
 * status stylesheet holds no rules. This is the realistic "TaskNotes absent"
 * case — `getStatusColors()` returns `[]`, so the view applies no status class
 * or color.
 *
 * The bar-coloring LOGIC (slug generation, rule building, the CSS-injection
 * guard) is covered exhaustively by `test/unit/statusColor.test.ts`, and the
 * value→color mapping by `test/unit/TaskNotesSource.test.ts`.
 *
 * DEFERRED follow-up: an actual-color E2E that asserts a bar receives its
 * configured background color requires a status-color source in the harness
 * (a stub TaskNotes plugin exposing `api.config().statuses`, or injecting a fake
 * `app.plugins.plugins.tasknotes.api`). Tracked in the status-coloring plan.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-readonly");

describe("Gantt (OG) status coloring — graceful path (no TaskNotes)", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-gantt-status-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({
      vault: tmpVault,
      plugins: ["obsidian-gantt"],
    });

    await browser.executeObsidian(async ({ app }) => {
      const ip = (app as unknown as {
        internalPlugins?: {
          getPluginById?: (id: string) => { enabled?: boolean; enable?: (o?: unknown) => unknown } | undefined;
          enablePluginAndSave?: (id: string) => unknown;
        };
      }).internalPlugins;
      const bases = ip?.getPluginById?.("bases");
      if (bases && !bases.enabled) {
        await (ip?.enablePluginAndSave?.("bases") ?? bases.enable?.({ reloadApp: false }));
      }
    });

    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getAbstractFileByPath("Gantt.base");
      if (file) {
        await app.workspace.getLeaf(true).openFile(file as never);
      }
    });

    await browser.waitUntil(
      async () => (await $$(".og-bases-gantt .wx-bar")).length > 0,
      { timeout: 60000, timeoutMsg: "Gantt chart did not render any task bars" },
    );
  });

  it("renders bars without any status class when TaskNotes is absent", async () => {
    const bars = await $$(".og-bases-gantt .wx-bar");
    expect(bars.length).toBeGreaterThan(0);

    // No status coloring without a color source: no bar carries an og-status-* class.
    const colored = await $$('.og-bases-gantt .wx-bar[class*="og-status-"]');
    expect(colored.length).toBe(0);
  });

  it("injects no status color rules when there are no status colors", async () => {
    const ruleCount = await browser.executeObsidian(() => {
      const styles = Array.from(
        document.querySelectorAll(".og-bases-gantt style[data-og-status]"),
      );
      // Graceful: the managed style element (if created) carries no rules.
      return styles.reduce((n, s) => n + (s.textContent?.trim() ? 1 : 0), 0);
    });
    expect(ruleCount).toBe(0);
  });
});
