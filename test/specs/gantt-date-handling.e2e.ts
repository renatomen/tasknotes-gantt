import { browser, expect, $, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * U5 — missing/partial-date handling render spec.
 *
 * Boots Obsidian against the `test/vaults/gantt-dates` fixture (a complete task,
 * a due-only task, a start-only task, a swapped task, and TWO dateless tasks)
 * and asserts the date-policy end-to-end against real Obsidian + SVAR:
 *   1. default visibility renders every task regardless of date completeness
 *      (R7), including both dateless placeholders (the "today pile");
 *   2. the due-only task is placed at its deadline (left of the dateless
 *      placeholders at today), NOT spanning from today (AE1);
 *   3. non-`complete` bars carry the `.datestatus-flagged` indicator while the
 *      complete bar does not (R10);
 *   4. each flagged bar also carries the per-state class for its concrete date
 *      status, so the four states are stylable apart from one another;
 *   5. with "hide undated" on, the dateless tasks disappear; and with the
 *      date-status indicator option off, no bar carries any date-status class.
 *
 * SELECTOR NOTE: bars are SVAR `.wx-bar` elements carrying `data-id` = the note
 * path (our instance id for these single-parent roots). SVAR 2.6+ encodes a
 * string id in the DOM with a leading ":" (its `setID`), so the rendered
 * attribute is `:X.md`; we use the ends-with form `[data-id$="X.md"]` to target
 * a task's bar robustly across that encoding. The custom date-status type
 * renders as the bare `.datestatus-flagged` class on the bar (SVAR only
 * `wx-`-prefixes the built-in task/summary/milestone types). The per-state
 * `.datestatus-*` classes are NOT task types — the bar template stamps them
 * from per-instance data — but they land as bare classes on the same element.
 * Verified against @svar-ui/svelte-gantt v2.7.0.
 *
 * PLACEMENT NOTE: the fixture's dated tasks sit in April 2026, before any
 * realistic test-run date, so a placeholder anchored at "today" is always to
 * their right on the timeline — the basis for the date-agnostic position check.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-dates");

/** The per-state date-status classes, keyed by the note that produces each state. */
const STATE_CLASS_BY_NOTE = {
  "Due Only.md": "datestatus-zigzag-start",
  "Start Only.md": "datestatus-zigzag-end",
  "Dateless One.md": "datestatus-zigzag-both",
  "Dateless Two.md": "datestatus-zigzag-both",
  "Swapped.md": "datestatus-swapped",
} as const;

const STATE_CLASSES = [...new Set(Object.values(STATE_CLASS_BY_NOTE))];

/** The `class` attribute of the bar whose `data-id` ends with `note`. */
async function barClass(note: string): Promise<string> {
  const bar = await $(`.og-bases-gantt .wx-bar[data-id$="${note}"]`);
  return await bar.getAttribute("class");
}

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
    // Also clear generic leaves holding a prior base render.
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

describe("Gantt (OG) missing/partial-date handling", () => {
  before(async () => {
    // Hermetic: copy the in-repo fixture vault to a disposable temp dir (ignores
    // OBSIDIAN_TEST_VAULT; CI points it at an empty runner vault).
    const tmpVault = path.join(os.tmpdir(), "og-gantt-dates-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({ vault: tmpVault, plugins: ["tasknotes-gantt"] });
    await enableBases();
  });

  describe("default visibility (show everything)", () => {
    before(async () => {
      await openBase("Dates.base");
    });

    it("renders every task regardless of date completeness, incl. both dateless (R7, AE3)", async () => {
      // 6 source notes, all roots → 6 bars: Complete, Due Only, Start Only,
      // Swapped, Dateless One/Two.
      const bars = await $$(".og-bases-gantt .wx-bar");
      expect(bars).toHaveLength(6);
      await expect($(`.og-bases-gantt .wx-bar[data-id$="Dateless One.md"]`)).toBeExisting();
      await expect($(`.og-bases-gantt .wx-bar[data-id$="Dateless Two.md"]`)).toBeExisting();
      await expect($(`.og-bases-gantt .wx-bar[data-id$="Start Only.md"]`)).toBeExisting();
      await expect($(`.og-bases-gantt .wx-bar[data-id$="Swapped.md"]`)).toBeExisting();
    });

    it("places the due-only task at its deadline, not spanning from today (AE1)", async () => {
      // The due-only bar (April) must sit LEFT of a dateless placeholder
      // (anchored at today, which is well after April 2026).
      const dueOnly = await $(`.og-bases-gantt .wx-bar[data-id$="Due Only.md"]`);
      const dateless = await $(`.og-bases-gantt .wx-bar[data-id$="Dateless One.md"]`);
      const dueX = (await dueOnly.getLocation()).x;
      const datelessX = (await dateless.getLocation()).x;
      expect(dueX).toBeLessThan(datelessX);
    });

    it("shades weekend day columns by default at the day scale (weekend AE1/AE6)", async () => {
      // The fixture sets no tngantt_defaultScale, so the view mounts at the day
      // default where day cells render. Weekend shading defaults ON and this
      // vault has no TaskNotes, so presence here is also the standalone proof.
      // `.wx-weekend` appears on chart-body holiday cells and day-scale header
      // cells; any ≥7-day visible window contains at least one weekend day.
      const weekendCells = await $$(".og-bases-gantt .wx-weekend");
      expect(weekendCells.length).toBeGreaterThan(0);
    });

    it("flags non-complete bars and leaves the complete bar unflagged (R10)", async () => {
      const complete = await $(`.og-bases-gantt .wx-bar[data-id$="Complete.md"]`);
      const dueOnly = await $(`.og-bases-gantt .wx-bar[data-id$="Due Only.md"]`);
      const dateless = await $(`.og-bases-gantt .wx-bar[data-id$="Dateless One.md"]`);

      expect((await complete.getAttribute("class")).includes("datestatus-flagged")).toBe(false);
      expect((await dueOnly.getAttribute("class")).includes("datestatus-flagged")).toBe(true);
      expect((await dateless.getAttribute("class")).includes("datestatus-flagged")).toBe(true);

      // Exactly 5 flagged (due-only + start-only + swapped + two dateless).
      const flagged = await $$(".og-bases-gantt .wx-bar.datestatus-flagged");
      expect(flagged).toHaveLength(5);
    });

    it("stamps each flagged bar with the per-state class for its own date status", async () => {
      // The per-state classes are stamped by a post-mount bar attachment, not
      // emitted with the element, so bar presence alone does not mean they have
      // landed. Wait for the pair that must exist before counting.
      await browser.waitUntil(
        async () => (await $$(".og-bases-gantt .wx-bar.datestatus-zigzag-both")).length === 2,
        { timeout: 5000, timeoutMsg: "per-state date-status classes were never stamped" },
      );
      for (const [note, stateClass] of Object.entries(STATE_CLASS_BY_NOTE)) {
        expect(await barClass(note)).toContain(stateClass);
      }
      // Each state class lands on exactly the bars in that state — no bleed.
      expect(await $$(`.og-bases-gantt .wx-bar.datestatus-zigzag-start`)).toHaveLength(1);
      expect(await $$(`.og-bases-gantt .wx-bar.datestatus-zigzag-end`)).toHaveLength(1);
      expect(await $$(`.og-bases-gantt .wx-bar.datestatus-zigzag-both`)).toHaveLength(2);
      expect(await $$(`.og-bases-gantt .wx-bar.datestatus-swapped`)).toHaveLength(1);
    });

    it("leaves the complete bar without any per-state date-status class", async () => {
      const complete = await barClass("Complete.md");
      for (const stateClass of STATE_CLASSES) expect(complete).not.toContain(stateClass);
    });
  });

  describe("weekend highlighting off", () => {
    before(async () => {
      await openBase("DatesWeekendsOff.base");
    });

    it("suppresses weekend shading when the toggle is off (weekend AE4 off-state)", async () => {
      // The off state is the CSS-specificity path: highlightTime still
      // classifies (the fn is a seed-once prop), so `.wx-weekend` cells remain
      // in the DOM, but the `og-weekends-off` root class + scoped override must
      // beat SVAR's compiled `.wx-weekend` styles. Assert both halves.
      await expect($(".og-bases-gantt.og-weekends-off")).toBeExisting();
      const weekendCells = await $$(".og-bases-gantt .wx-weekend");
      expect(weekendCells.length).toBeGreaterThan(0);
      const background = await browser.execute(() => {
        const cell = document.querySelector(".og-bases-gantt .wx-weekend");
        return cell ? window.getComputedStyle(cell).backgroundColor : null;
      });
      // transparent computes to rgba(0, 0, 0, 0); any shading means the
      // override lost the specificity contest against SVAR's scoped styles.
      expect(background).toBe("rgba(0, 0, 0, 0)");
    });
  });

  describe("hide-undated + indicators off", () => {
    before(async () => {
      await openBase("DatesHidden.base");
    });

    it("removes dateless tasks while complete + partial remain (AE5)", async () => {
      // Dateless One/Two hidden → 4 bars: Complete, Due Only, Start Only, Swapped.
      const bars = await $$(".og-bases-gantt .wx-bar");
      expect(bars).toHaveLength(4);
      await expect($(`.og-bases-gantt .wx-bar[data-id$="Dateless One.md"]`)).not.toBeExisting();
      await expect($(`.og-bases-gantt .wx-bar[data-id$="Due Only.md"]`)).toBeExisting();
    });

    it("applies no indicator treatment when showDateIndicators is off (R11)", async () => {
      const flagged = await $$(".og-bases-gantt .wx-bar.datestatus-flagged");
      expect(flagged).toHaveLength(0);
    });

    it("stamps no per-state date-status class when showDateIndicators is off (R11)", async () => {
      for (const stateClass of STATE_CLASSES) {
        expect(await $$(`.og-bases-gantt .wx-bar.${stateClass}`)).toHaveLength(0);
      }
      // The rows that WOULD carry one are on screen, so the empty counts above
      // report the indicator toggle, not an empty chart.
      const swapped = await barClass("Swapped.md");
      const startOnly = await barClass("Start Only.md");
      for (const stateClass of STATE_CLASSES) {
        expect(swapped).not.toContain(stateClass);
        expect(startOnly).not.toContain(stateClass);
      }
    });
  });
});
