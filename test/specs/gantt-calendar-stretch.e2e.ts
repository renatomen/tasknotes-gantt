import { browser, expect, $, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * U7 — working-time stretch + 15%-ghost rendering spec.
 *
 * Boots Obsidian against the `test/vaults/gantt-calendar` fixture with the
 * stretch-mode base: a start-only three-working-day task anchored on the
 * Friday holiday of a Mon-Fri calendar. End to end against real Obsidian +
 * SVAR this asserts:
 *   1. the stretched bar renders as pieces — a blocked ghost at 15% computed
 *      opacity (holiday + weekend) and a solid working piece (AE2's render
 *      half: the shaded background reads through the ghost);
 *   2. the host bar carries SVAR's own `wx-split` class (the transparency
 *      condition) — no fill contest;
 *   3. the split-task segment vocabulary never appears on a calendar-ghost
 *      bar (AE6: calendar gaps and occurrence gaps stay distinct languages);
 *   3b. the derived (non-authored) end renders as a zigzag torn edge cut into
 *      the OUTERMOST piece — the split half of the non-authored-edge signal;
 *   4. a task without an associated calendar renders as a plain continuous
 *      bar with no ghost pieces (upgrade-invisible regression);
 *   5. SVAR's whole-span progress fill is HIDDEN on the piece-bearing bar (the
 *      gaps between pieces are days the bar does not claim) — the preserved
 *      half of a rule that deliberately keeps the fill on a torn bar carrying
 *      no pieces of its own.
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
    async () => (await $$(".og-bases-gantt .wx-bar").length) > 0,
    { timeout: 60000, timeoutMsg: `Gantt did not render bars for ${basePath}` }
  );
}

const STRETCH_BAR = '.og-bases-gantt .wx-bar[data-id$="Task Stretch.md"]';
const PLAIN_BAR = '.og-bases-gantt .wx-bar[data-id$="Task Plain.md"]';

describe("Gantt (OG) working-time stretch ghost rendering", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-gantt-calendar-stretch-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({ vault: tmpVault, plugins: ["tasknotes-gantt"] });
    await enableBases();
    await openBase("CalendarStretch.base");
  });

  it("renders the stretched bar as pieces with a 15%-opacity blocked ghost", async () => {
    await browser.waitUntil(
      async () => (await $$(`${STRETCH_BAR} .og-ghost-run`).length) > 0,
      { timeout: 30000, timeoutMsg: "ghost pieces never rendered" }
    );
    const opacity = await browser.execute((selector: string) => {
      const ghost = document.querySelector(`${selector} .og-ghost-run.og-ghost-blocked`);
      return ghost ? window.getComputedStyle(ghost).opacity : null;
    }, STRETCH_BAR);
    expect(opacity).toBe("0.15");
    const workingPieces = await $$(`${STRETCH_BAR} .og-ghost-run:not(.og-ghost-blocked)`);
    expect(workingPieces.length).toBeGreaterThan(0);
  });

  it("paints ghost pieces the host bar's effective fill", async () => {
    // Pins BOTH ends of the fill chain: the host .wx-bar must define
    // --og-effective-fill (a probe span inside the bar inherits it and paints
    // it), and the .og-ghost-run piece must paint that same value. Dropping
    // either element from the definition selector turns its side transparent
    // and breaks the equality — geometry-only assertions never see that.
    const fill = await browser.execute((selector: string) => {
      const bar = document.querySelector(selector) as HTMLElement | null;
      const piece = bar?.querySelector(".og-ghost-run:not(.og-ghost-blocked)");
      if (!bar || !piece) throw new Error(`bar or working piece not found: ${selector}`);
      const probe = document.createElement("span");
      probe.style.backgroundColor = "var(--og-effective-fill)";
      bar.appendChild(probe);
      const barFill = window.getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { barFill, pieceFill: window.getComputedStyle(piece).backgroundColor };
    }, STRETCH_BAR);

    expect(fill.barFill).not.toBe("rgba(0, 0, 0, 0)");
    expect(fill.pieceFill).toBe(fill.barFill);
  });

  it("stamps SVAR's own wx-split class on the host bar", async () => {
    const barClass = await browser.execute((selector: string) => {
      return document.querySelector(selector)?.className ?? null;
    }, STRETCH_BAR);
    expect(barClass).toContain("wx-split");
  });

  it("re-asserts wx-split after the bar's class list is reset (live Bar Fill regression)", async () => {
    // Reproduce what SVAR does on an update-task (e.g. a Bar Fill / Strip source
    // change re-issues the task with a new treatment class): it re-applies the
    // bar's whole class list from task.type, dropping the imperatively-stamped
    // wx-split. Without the MutationObserver in BarContent the split stays lost —
    // the body paints opaque and the 15%-opacity ghost pieces blend over it — until
    // a remount. The observer must re-assert it so the split survives live.
    await browser.execute((selector: string) => {
      document.querySelector(selector)?.classList.remove("wx-split");
    }, STRETCH_BAR);
    const hasSplit = async (): Promise<boolean> =>
      browser.execute(
        (selector: string) =>
          document.querySelector(selector)?.classList.contains("wx-split") ?? false,
        STRETCH_BAR,
      );
    await browser.waitUntil(hasSplit, {
      timeout: 5000,
      timeoutMsg: "wx-split was not re-asserted after the class list was reset",
    });

    expect(await hasSplit()).toBe(true);
  });

  it("re-converges both classes when the torn owner's stamp is stripped whole (R1 co-ownership)", async () => {
    // The stretched bar derives its end, so it is torn AND stretched: wx-split
    // has TWO owners — the token observer (which stamps the state class beside
    // it) and the ghost-run observer above. Stripping the token class and
    // wx-split together is the torn attach's teardown in miniature, and the
    // surviving owners must converge the bar back: either observer re-adds
    // wx-split (contains-guarded, so double ownership never fights), the
    // still-live token attach re-stamps its class, and the pieces stay
    // rendered throughout. The pre-strip read rides the same page turn, so
    // the guards prove the classes were really there to strip.
    const stripped = await browser.execute((selector: string) => {
      const bar = document.querySelector(selector);
      if (!bar) throw new Error(`bar not found: ${selector}`);
      const before = {
        torn: bar.classList.contains("datestatus-zigzag-end"),
        split: bar.classList.contains("wx-split"),
      };
      bar.classList.remove("datestatus-zigzag-end");
      bar.classList.remove("wx-split");
      return before;
    }, STRETCH_BAR);
    expect(stripped.torn).toBe(true);
    expect(stripped.split).toBe(true);

    const readConvergence = async (): Promise<{ torn: boolean; split: boolean; pieces: number }> =>
      browser.execute((selector: string) => {
        const bar = document.querySelector(selector);
        return {
          torn: bar?.classList.contains("datestatus-zigzag-end") ?? false,
          split: bar?.classList.contains("wx-split") ?? false,
          pieces: bar?.querySelectorAll(".og-ghost-run").length ?? 0,
        };
      }, STRETCH_BAR);
    await browser.waitUntil(
      async () => {
        const state = await readConvergence();
        return state.torn && state.split;
      },
      {
        timeout: 5000,
        timeoutMsg: "the surviving owners never converged the stripped classes back",
      },
    );

    const converged = await readConvergence();
    expect(converged.torn).toBe(true);
    expect(converged.split).toBe(true);
    expect(converged.pieces).toBeGreaterThan(0);
  });

  it("clears the teeth for a label nested inside the piece wrapper", async () => {
    // A piece-bearing bar renders its label inside .og-ghost-runs, not as a
    // direct child of the bar. The wrapper's mask clips PAINT at the notch but
    // never moves the label, and the strip accent is a host pseudo-element
    // painted above the wrapper — so the nested label needs the same tooth
    // clearance a plain torn bar gets, or it sits under the cut edge.
    const inset = await browser.execute((selector: string) => {
      const bar = document.querySelector(selector);
      const content = bar?.querySelector(".og-ghost-runs .wx-content");
      if (!content) throw new Error(`nested bar content not found: ${selector}`);
      const style = window.getComputedStyle(content);
      return { paddingRight: style.paddingRight, nested: true };
    }, STRETCH_BAR);

    // This bar derives its END, so the trailing edge is the torn one.
    expect(inset.nested).toBe(true);
    expect(inset.paddingRight).toBe("4px");
  });

  it("cuts the torn edge into the outermost piece only (AE6)", async () => {
    // The stretched task authors a start and derives its end from the estimate,
    // so its bar carries the trailing-edge tear. Under Split rendering the host
    // paints nothing, so the cut has to land on the LAST piece — and only that
    // one, or an inner piece boundary would grow a second tooth column in the
    // middle of the bar. The piece hooks are stamped by the piece loop, so this
    // also pins that the loop marks first/last at all.
    const pieces = await browser.execute((selector: string) => {
      const bar = document.querySelector(selector);
      if (!bar) throw new Error(`bar not found: ${selector}`);
      return Array.from(bar.querySelectorAll(".og-ghost-run")).map((piece) => {
        const style = window.getComputedStyle(piece);
        return {
          classes: piece.className,
          maskImage: style.maskImage,
          topRightRadius: style.borderTopRightRadius,
          topLeftRadius: style.borderTopLeftRadius,
        };
      });
    }, STRETCH_BAR);

    expect(pieces.length).toBeGreaterThan(1);
    const last = pieces[pieces.length - 1]!;
    expect(last.classes).toContain("og-piece-last");
    expect(last.maskImage).toContain("conic-gradient");
    // A rounded corner on the cut side would round off the outermost tooth tip,
    // so the tear reads differently on a split bar than on a continuous one.
    expect(last.topRightRadius).toBe("0px");
    expect(last.topLeftRadius).not.toBe("0px");
    // Every piece that is not the outer one stays whole.
    for (const piece of pieces.slice(0, -1)) {
      expect(piece.classes).not.toContain("og-piece-last");
      expect(piece.maskImage).toBe("none");
    }
    expect(pieces[0]!.classes).toContain("og-piece-first");
  });

  it("hides SVAR's whole-span progress fill on a piece-bearing bar", async () => {
    // The pieces ARE the bar's body, and gaps between them are days the bar
    // does not claim — so SVAR's full-span progress fill painted straight
    // across those gaps would lie. The suppression is one half of a rule whose
    // other half deliberately KEEPS the progress on a torn bar that carries no
    // pieces of its own (a plain bar, or an occupancy overlay); without a pin
    // on this half the `:has(> .og-ghost-runs:not(.og-occupancy-overlay))`
    // guard could be widened to everything and nothing would notice.
    const progress = await browser.execute((selector: string) => {
      const bar = document.querySelector(selector);
      if (!bar) throw new Error(`bar not found: ${selector}`);
      const wrapper = bar.querySelector(".wx-progress-wrapper");
      return {
        // SVAR renders the wrapper only for a task that HAS progress, so its
        // presence is what makes `display: none` a suppression rather than an
        // assertion about an element that was never going to exist.
        rendered: wrapper !== null,
        display: wrapper ? window.getComputedStyle(wrapper).display : "<not rendered>",
        pieces: bar.querySelectorAll(".og-ghost-run").length,
        overlayWrappers: bar.querySelectorAll(".og-ghost-runs.og-occupancy-overlay").length,
      };
    }, STRETCH_BAR);

    expect(progress.rendered).toBe(true);
    expect(progress.pieces).toBeGreaterThan(0);
    // The wrapper this bar carries is a piece wrapper, NOT an occupancy
    // overlay — the case the same rule exempts.
    expect(progress.overlayWrappers).toBe(0);
    expect(progress.display).toBe("none");
  });

  it("never uses the split-task segment vocabulary for calendar ghosts (AE6)", async () => {
    const segments = await $$(".og-bases-gantt .wx-segment");
    expect(segments).toHaveLength(0);
  });

  it("leaves an unassociated task as a plain continuous bar", async () => {
    await expect($(PLAIN_BAR)).toExist();
    const ghosts = await $$(`${PLAIN_BAR} .og-ghost-run`);
    expect(ghosts).toHaveLength(0);
    const plainClass = await browser.execute((selector: string) => {
      return document.querySelector(selector)?.className ?? null;
    }, PLAIN_BAR);
    expect(plainClass).not.toContain("wx-split");
  });

  it("keeps the inferred date of a stretched strip bar visible, now as the tear", async () => {
    // DELIBERATE, and pinned so it cannot be quietly removed: a stretched task's
    // end is derived from its estimate, and that provenance has to stay visible.
    // The cue used to be the date-status border, which was visually heavy — it
    // boxed the whole authored span, blocked days included — and this assertion
    // held it in place until a provenance-aware cue replaced it. That cue is the
    // tear, so the pin moved to it rather than lapsing. Strip mode is the case
    // worth pinning: the neutral strip body is the fill the teeth have to read
    // against, and it is a different surface from the fill-mode ghost above.
    await openBase("CalendarStretchStrip.base");
    await browser.waitUntil(
      async () => (await $$(`${STRETCH_BAR} .og-ghost-run`).length) > 0,
      { timeout: 30000, timeoutMsg: "ghost pieces never rendered in strip mode" }
    );
    const cue = await browser.execute((selector: string) => {
      const bar = document.querySelector(selector);
      if (!bar) throw new Error(`bar not found: ${selector}`);
      return {
        torn: bar.classList.contains("datestatus-zigzag-end"),
        pieces: Array.from(bar.querySelectorAll(".og-ghost-run")).map((piece) => ({
          classes: piece.className,
          maskImage: window.getComputedStyle(piece).maskImage,
        })),
      };
    }, STRETCH_BAR);

    expect(cue.torn).toBe(true);
    expect(cue.pieces.length).toBeGreaterThan(0);
    const last = cue.pieces[cue.pieces.length - 1]!;
    expect(last.classes).toContain("og-piece-last");
    expect(last.maskImage).toContain("conic-gradient");
    // Only the outermost piece — an inner boundary would grow a second tooth
    // column in the middle of the span.
    for (const piece of cue.pieces.slice(0, -1)) expect(piece.maskImage).toBe("none");
  });
});
