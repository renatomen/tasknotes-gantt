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
 *  - `GanttThemed.base` sets `tngantt_barFillSource: theme` → bars take the
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

/**
 * The injected treatment stylesheet text for the ACTIVE view. `openBase` opens each
 * base in its own split leaf without closing the prior one, so a document-wide query
 * could read a previously-opened view's `<style>`; scope to the active leaf's
 * container so we always read the base under test.
 */
async function activeTreatmentCss(): Promise<string> {
  return browser.executeObsidian(({ app }) => {
    const leaf = app.workspace.activeLeaf as unknown as {
      view?: { containerEl?: { querySelector(sel: string): { textContent?: string | null } | null } };
    } | null;
    const root = leaf?.view?.containerEl ?? document;
    const style = root.querySelector(".og-bases-gantt style[data-og-treatment]");
    return style?.textContent ?? "";
  });
}

/**
 * Read the active view's treatment stylesheet, waiting until it contains `mustContain`.
 *
 * `openBase` waits only for `.wx-bar` bars to render, but the treatment `<style>` is
 * injected by a SEPARATE reactive `$effect` that runs after mount — so an eager read
 * can catch the stylesheet empty/pre-injection (the flaky race: bars present ≠ CSS
 * injected, widened by the theme view opening in a second split leaf). Gate the read
 * on the specific expected token instead of reading once — same readiness-gate pattern
 * as the column-sort / dependency e2e flake fixes.
 */
async function waitForTreatmentCss(mustContain: string): Promise<string> {
  let css = "";
  await browser.waitUntil(
    async () => {
      css = await activeTreatmentCss();
      return css.includes(mustContain);
    },
    { timeout: 15000, timeoutMsg: `treatment CSS never contained "${mustContain}"` },
  );
  return css;
}

describe("Gantt (OG) bar treatments", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-gantt-bar-treatments-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });
    await browser.reloadObsidian({ vault: tmpVault, plugins: ["tasknotes-gantt"] });
  });

  describe("default source (green parent / blue children)", () => {
    before(async () => {
      await openBase("Gantt.base");
    });

    it("marks the parent bar with og-parent and shows no icon chip (icon None)", async () => {
      const bars = await $$(".og-bases-gantt .wx-bar");
      expect(bars.length).toBeGreaterThan(0);

      const parents = await $$(".og-bases-gantt .wx-bar.og-parent");
      expect(parents.length).toBeGreaterThan(0);

      // No palette-value classes (default is role-based, not status/priority) and
      // no chip (Task icon defaults to None).
      const valueClassed = await $$(
        '.og-bases-gantt .wx-bar[class*="og-status-"], .og-bases-gantt .wx-bar[class*="og-prio-"]',
      );
      expect(valueClassed).toHaveLength(0);
      const chips = await $$(".og-bases-gantt .og-bar-chip");
      expect(chips).toHaveLength(0);
    });

    it("injects the fixed green/blue role rules", async () => {
      const css = await waitForTreatmentCss("#1f6feb"); // wait for injection, then assert
      expect(css).toContain("#1f6feb"); // child (blue)
      expect(css).toContain("#2ea043"); // parent (green)
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

    it("injects theme rules driven by the theme's own accent (interactive-accent)", async () => {
      const css = await waitForTreatmentCss("var(--interactive-accent)"); // wait for injection
      // Theme source = the user's accent hue in two tones (raw child + shifted parent),
      // never a fixed named palette color. Mirrors the barTreatment.test.ts theme cases.
      expect(css).toContain("var(--interactive-accent)");
      expect(css).toContain("color-mix(in srgb, var(--interactive-accent)");
      expect(css).not.toContain("--color-");
    });
  });
});
