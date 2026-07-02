import { browser, expect, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * U8 bar-treatments spec — the DOM wiring for per-view bar color/icon treatments.
 *
 * Boots the `gantt-readonly` fixture (no TaskNotes plugin). Two views:
 *  - `Gantt.base` uses the defaults (Default / Default / None) → pristine bars:
 *    no treatment class, no injected rules, no icon chip.
 *  - `GanttThemed.base` sets `tngantt_barColorSource: theme` → bars take the
 *    Obsidian-theme treatment: the parent bar carries `og-parent` and the injected
 *    stylesheet references the theme CSS variables. Theme needs no palette, so it
 *    is the one active-treatment path exercisable without TaskNotes.
 *
 * The treatment LOGIC (fill/strip/theme rule building, slug generation, icon-spec
 * selection, the CSS-injection guard) is covered exhaustively by
 * `test/unit/barTreatment.test.ts` and `test/unit/ganttSync.test.ts`. A real
 * status/priority color + glyph E2E needs a stub TaskNotes palette and stays
 * DEFERRED (same as the status-coloring spec).
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-readonly");

/** Enable the Bases core plugin, then open a `.base` file and wait for bars. */
async function openBase(baseFile: string): Promise<void> {
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

  await browser.executeObsidian(async ({ app }, file: string) => {
    const f = app.vault.getAbstractFileByPath(file);
    if (f) {
      await app.workspace.getLeaf(true).openFile(f as never);
    }
  }, baseFile);

  await browser.waitUntil(
    async () => (await $$(".og-bases-gantt .wx-bar")).length > 0,
    { timeout: 60000, timeoutMsg: `Gantt chart did not render any task bars for ${baseFile}` },
  );
}

describe("Gantt (OG) bar treatments", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-gantt-bar-treatments-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });
    await browser.reloadObsidian({ vault: tmpVault, plugins: ["tasknotes-gantt"] });
  });

  describe("default (Default / Default / None)", () => {
    before(async () => {
      await openBase("Gantt.base");
    });

    it("renders pristine bars: no treatment class and no icon chip", async () => {
      const bars = await $$(".og-bases-gantt .wx-bar");
      expect(bars.length).toBeGreaterThan(0);

      const treated = await $$(
        '.og-bases-gantt .wx-bar[class*="og-status-"], .og-bases-gantt .wx-bar[class*="og-prio-"], .og-bases-gantt .wx-bar.og-parent',
      );
      expect(treated).toHaveLength(0);

      const chips = await $$(".og-bases-gantt .og-bar-chip");
      expect(chips).toHaveLength(0);
    });

    it("injects no treatment rules under the default source", async () => {
      const ruleCount = await browser.executeObsidian(() => {
        const styles = Array.from(document.querySelectorAll(".og-bases-gantt style[data-og-status]"));
        return styles.reduce((n, s) => n + (s.textContent?.trim() ? 1 : 0), 0);
      });
      expect(ruleCount).toBe(0);
    });
  });

  describe("Obsidian theme source", () => {
    before(async () => {
      await openBase("GanttThemed.base");
    });

    it("marks the parent bar with og-parent", async () => {
      const parents = await $$(".og-bases-gantt .wx-bar.og-parent");
      expect(parents.length).toBeGreaterThan(0);
    });

    it("injects theme rules referencing Obsidian CSS variables", async () => {
      const css = await browser.executeObsidian(() => {
        const style = document.querySelector(".og-bases-gantt style[data-og-status]");
        return style?.textContent ?? "";
      });
      expect(css).toContain("--interactive-accent");
    });
  });
});
