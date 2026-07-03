import { browser, expect, $, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Regression: the collapsed parent-task chevron must render identically to the
 * expanded one (dark-mode contrast bug).
 *
 * Root cause (fixed in GanttContainer.svelte): SVAR renders every tree toggle as
 * `<i class="wx-toggle-icon wxi-menu-{down|right}">` — `down` when expanded,
 * `right` when collapsed (TextCell.svelte). Separately, the plugin's "OG-82"
 * rule styling SVAR's grid *Resizer* panel arrows was written with an UNSCOPED
 * selector, `.og-bases-gantt :global(.wxi-menu-right)`, that paints a HARDCODED,
 * non-theme-adaptive gray (`stroke='%235f6368'`) as the element background. That
 * selector also matched the *collapsed tree toggle* (same `wxi-menu-right`
 * class), so the collapsed chevron picked up the hardcoded gray while the
 * expanded chevron (`wxi-menu-down`, which the Resizer never uses) rendered only
 * through its themed `::before`. On a dark background the hardcoded gray is
 * low-contrast → "almost indistinguishable", and different from the expanded
 * chevron; on light it coincidentally matched → symptom is dark-mode-only.
 *
 * The fix scopes the Resizer rules to `.wx-button-expand-content` (the Resizer's
 * own container), so the collapsed tree toggle renders through the SAME themed
 * `::before` path as the expanded one.
 *
 * This spec boots the standalone theme/toolbar fixture (no TaskNotes needed),
 * then injects both toggle glyphs as probes INTO the real `.og-bases-gantt`
 * element (so the component's global stylesheet cascades onto them exactly as it
 * would onto a real toggle) and asserts:
 *  - the collapsed element carries NO leaked hardcoded gray (`5f6368`), and
 *  - collapsed and expanded resolve to the SAME element background (symmetry),
 *    while the collapsed `::before` still paints a chevron (glyph not lost).
 * Pre-fix, the collapsed element background is the `5f6368` Resizer chevron and
 * the first two assertions fail.
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-theme-toolbar");

interface ChevronStyles {
  /** Element-level `background-image` for the collapsed (`wxi-menu-right`) glyph. */
  collapsedElem: string;
  /** Element-level `background-image` for the expanded (`wxi-menu-down`) glyph. */
  expandedElem: string;
  /** `::before` `background-image` for the collapsed glyph (the themed chevron). */
  collapsedBefore: string;
}

/**
 * Inject a collapsed + expanded tree-toggle glyph into the live `.og-bases-gantt`
 * root and read back their resolved styles, then clean up. Runs in-page so the
 * real component stylesheet (Svelte `:global` rules scoped under the hashed
 * `.og-bases-gantt`) cascades onto the probes exactly as onto SVAR's own toggle.
 */
async function readChevronStyles(): Promise<ChevronStyles | null> {
  return browser.execute(() => {
    const root = document.querySelector(".og-bases-gantt");
    if (!root) return null;
    const make = (dir: "down" | "right"): HTMLElement => {
      const i = document.createElement("i");
      i.className = `wx-toggle-icon wxi-menu-${dir}`;
      i.setAttribute("data-og-probe", "1");
      root.appendChild(i);
      return i;
    };
    const right = make("right");
    const down = make("down");
    const styles: {
      collapsedElem: string;
      expandedElem: string;
      collapsedBefore: string;
    } = {
      collapsedElem: window.getComputedStyle(right).backgroundImage,
      expandedElem: window.getComputedStyle(down).backgroundImage,
      collapsedBefore: window.getComputedStyle(right, "::before").backgroundImage,
    };
    right.remove();
    down.remove();
    return styles;
  });
}

describe("Gantt (OG) collapse chevron — contrast/theme parity", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-collapse-chevron-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({ vault: tmpVault, plugins: ["tasknotes-gantt"] });
    await browser.executeObsidian(async ({ app }) => {
      const ip = (app as unknown as { internalPlugins?: {
        getPluginById?: (id: string) => { enabled?: boolean; enable?: (o?: unknown) => unknown } | undefined;
        enablePluginAndSave?: (id: string) => unknown;
      } }).internalPlugins;
      const bases = ip?.getPluginById?.("bases");
      if (bases && !bases.enabled) await (ip?.enablePluginAndSave?.("bases") ?? bases.enable?.({ reloadApp: false }));
    });
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getAbstractFileByPath("Theme.base");
      if (file) await app.workspace.getLeaf(true).openFile(file as never);
    });
    await browser.waitUntil(async () => (await $$(".og-bases-gantt .wx-bar")).length > 0, {
      timeout: 60000, timeoutMsg: "chart did not render",
    });
  });

  it("renders the collapsed chevron with the same themed background as the expanded one (no leaked hardcoded gray)", async () => {
    const styles = await readChevronStyles();
    expect(styles).not.toBeNull();

    // The leaked OG-82 Resizer rule painted a hardcoded gray (#5f6368) chevron as
    // the collapsed toggle's element background. It must be gone.
    expect(styles!.collapsedElem.toLowerCase()).not.toContain("5f6368");

    // Collapsed and expanded must resolve to the SAME element background — the
    // asymmetry the user reported. With the leak removed, neither tree toggle
    // sets an element-level background (both paint via `::before`).
    expect(styles!.collapsedElem).toBe(styles!.expandedElem);

    // Guard against "fixed by hiding the glyph": the collapsed chevron must still
    // paint its themed inline-SVG chevron via `::before`.
    expect(styles!.collapsedBefore).toContain("data:image/svg+xml");
  });
});
