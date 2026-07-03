import { browser, expect, $, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Regression: the grid Resizer's expand/collapse arrows (the divider `‹ ›`
 * control) must stay visible in dark mode.
 *
 * Root cause (fixed in GanttContainer.svelte): SVAR's grid Resizer renders its
 * panel-collapse arrows as `<i class="wxi-menu-{left|right}">` inside
 * `.wx-button-expand-content`, each sitting on a chip painted
 * `background-color: var(--wx-gantt-border-color)` (Resizer.svelte). The plugin's
 * OG-82 rules drew the arrow with a HARDCODED `stroke='%235f6368'` gray. That
 * variable is theme-dependent — `#e6e6e6` in Willow (light) but `#384047` in
 * WillowDark — so `#5f6368` on `#384047` is a ~1.74:1 contrast ratio (below the
 * 3:1 minimum for UI graphics): the arrows are nearly invisible in dark mode. The
 * fixed gray never adapts to the theme.
 *
 * The fix sets `color: var(--text-muted)` on the arrow and strokes the SVG with
 * `currentColor` (mirroring the tree-toggle treatment), so the arrow follows the
 * themed text colour and reads in both light and dark. Visibility follows from
 * `--text-muted` being theme-adaptive by construction.
 *
 * This spec injects a Resizer-arrow probe INTO the real `.og-bases-gantt` element
 * (so the component's global stylesheet cascades onto it exactly as onto SVAR's
 * own arrow, without depending on the Resizer's hover-only visibility) and
 * asserts the arrow carries no hardcoded `5f6368`, is stroked with `currentColor`,
 * and resolves `color` to a real themed value. Pre-fix, the background-image is
 * the `%235f6368` gray and the first two assertions fail.
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-theme-toolbar");

interface ArrowStyles {
  /** Resolved `color` for the right arrow (drives the ::before mask fill). */
  rightColor: string;
  /** `::before` `mask-image` for the right arrow — the masked chevron shape. */
  rightMask: string;
  /** `::before` `background-color` for the right arrow — the ACTUAL painted fill. */
  rightFill: string;
  /** `::before` `mask-image` for the left arrow. */
  leftMask: string;
}

/**
 * Inject a Resizer-arrow pair (`.wx-button-expand-content > i.wxi-menu-*`) into
 * the live `.og-bases-gantt` root, read back the resolved styles, and clean up.
 * Runs in-page so the real component stylesheet cascades onto the probes exactly
 * as onto the Resizer's own arrows. The chevron is painted on `::before` via an
 * alpha mask filled with `background-color: currentColor` (NOT a background-image
 * data-URI, whose currentColor paints black), so `backgroundColor` is the real
 * on-screen fill.
 */
async function readArrowStyles(): Promise<ArrowStyles | null> {
  return browser.execute(() => {
    const root = document.querySelector(".og-bases-gantt");
    if (!root) return null;
    const box = document.createElement("div");
    box.className = "wx-button-expand-content";
    box.setAttribute("data-og-probe", "1");
    const left = document.createElement("i");
    left.className = "wxi-menu-left";
    const right = document.createElement("i");
    right.className = "wxi-menu-right";
    box.appendChild(left);
    box.appendChild(right);
    root.appendChild(box);
    const rb = window.getComputedStyle(right, "::before");
    const lb = window.getComputedStyle(left, "::before");
    const styles = {
      rightColor: window.getComputedStyle(right).color,
      rightMask: rb.maskImage || (rb as unknown as { webkitMaskImage?: string }).webkitMaskImage || "none",
      rightFill: rb.backgroundColor,
      leftMask: lb.maskImage || (lb as unknown as { webkitMaskImage?: string }).webkitMaskImage || "none",
    };
    box.remove();
    return styles;
  });
}

describe("Gantt (OG) resizer arrows — dark-mode contrast", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-resizer-arrow-contrast-e2e");
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

  it("paints the resizer arrows in the themed colour via a mask, not a black background-image", async () => {
    const styles = await readArrowStyles();
    expect(styles).not.toBeNull();

    // Both arrows carry a masked chevron shape (the glyph), not the old
    // hardcoded-gray background-image.
    expect(styles!.rightMask).toContain("data:image/svg+xml");
    expect(styles!.leftMask).toContain("data:image/svg+xml");
    expect(styles!.rightMask.toLowerCase()).not.toContain("5f6368");

    // The element `color` resolves to a real themed value (var(--text-normal))…
    expect(styles!.rightColor).toMatch(/^rgba?\(/);
    expect(styles!.rightColor).not.toBe("rgba(0, 0, 0, 0)");

    // …and the ::before `background-color` — the ACTUAL painted fill — resolves
    // to that same non-transparent colour. This is the assertion the old
    // background-image approach could not make: it guarantees the glyph is filled
    // with the themed colour, not left black (currentColor in a background-image
    // data-URI paints black, which is what regressed the chevrons in dark mode).
    expect(styles!.rightFill).toMatch(/^rgb/);
    expect(styles!.rightFill).not.toBe("rgba(0, 0, 0, 0)");
    expect(styles!.rightFill).toBe(styles!.rightColor);
  });
});
