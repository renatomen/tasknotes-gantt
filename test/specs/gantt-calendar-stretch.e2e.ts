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
 *      bar with no ghost pieces (upgrade-invisible regression).
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
    async () => (await $$(".og-bases-gantt .wx-bar")).length > 0,
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
      async () => (await $$(`${STRETCH_BAR} .og-ghost-run`)).length > 0,
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

  it("drops the split host's own border on the torn side (AE6)", async () => {
    // The host of a split bar paints no fill, but it still paints a BORDER — and
    // on a date-status-flagged bar that border is deliberately kept as the only
    // cue an otherwise transparent host can show. Kept across the torn side it
    // draws the straight full-height edge the teeth just cut out of the piece
    // beneath it, so the silhouette reads as a boxed-in rectangle again. The
    // torn side has to lose it on a split host exactly as on a continuous one,
    // while the intact side keeps it.
    const host = await browser.execute((selector: string) => {
      const bar = document.querySelector(selector);
      if (!bar) throw new Error(`bar not found: ${selector}`);
      const style = window.getComputedStyle(bar);
      return {
        split: bar.classList.contains("wx-split"),
        torn: bar.classList.contains("datestatus-zigzag-end"),
        borderLeftWidth: style.borderLeftWidth,
        borderRightWidth: style.borderRightWidth,
        topRightRadius: style.borderTopRightRadius,
        bottomRightRadius: style.borderBottomRightRadius,
      };
    }, STRETCH_BAR);

    // The case only exists on a split host carrying a trailing tear.
    expect(host.split).toBe(true);
    expect(host.torn).toBe(true);
    expect(host.borderRightWidth).toBe("0px");
    expect(host.topRightRadius).toBe("0px");
    expect(host.bottomRightRadius).toBe("0px");
    // …and the intact side still carries the border this bar is entitled to, so
    // the removal is the torn side's, not a blanket erase.
    expect(Number.parseFloat(host.borderLeftWidth)).toBeGreaterThan(0);
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

  it("keeps the inferred-date border visible on a stretched bar", async () => {
    // DELIBERATE, and pinned so it cannot be quietly removed: a stretched task's
    // end is derived from its estimate, and the date-status border is currently
    // the only cue that a date was computed rather than authored. It is visually
    // heavy — it boxes the whole authored span, blocked days included — but the
    // annoyance stays until a provenance-aware cue replaces it. Removing this
    // border without a replacement leaves derived dates indistinguishable from
    // authored ones.
    await openBase("CalendarStretchStrip.base");
    await browser.waitUntil(
      async () => (await $$(`${STRETCH_BAR} .og-ghost-run`)).length > 0,
      { timeout: 30000, timeoutMsg: "ghost pieces never rendered in strip mode" }
    );
    const border = await browser.execute((selector: string) => {
      const bar = document.querySelector(selector);
      if (!bar) return null;
      const style = window.getComputedStyle(bar);
      return { color: style.borderTopColor, width: style.borderTopWidth, style: style.borderTopStyle };
    }, STRETCH_BAR);
    expect(border).not.toBeNull();
    expect(border!.color).not.toBe("rgba(0, 0, 0, 0)");
    // Not just colour: on a ghost host the datestatus fill is gone, so the cue is
    // the border — it must have real width and style, not a 0px/none border that
    // only carries a colour (which a colour-only check would wrongly accept).
    expect(border!.width).not.toBe("0px");
    expect(border!.style).not.toBe("none");
  });
});
