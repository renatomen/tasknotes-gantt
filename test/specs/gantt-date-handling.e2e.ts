/* global Image, requestAnimationFrame, CSSStyleDeclaration */
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
 *   3. the legacy colour indicator `.datestatus-flagged` is down to its last
 *      consumer — the swapped bar — while every non-authored-edge bar is left
 *      the ordinary fill its torn edge composes with;
 *   4. each non-`complete` bar carries the per-state class for its concrete date
 *      status, so the four states are stylable apart from one another;
 *   5. the three non-authored-edge states render as a zigzag "torn" edge cut
 *      out of the bar's body on the side whose date was never authored — in the
 *      computed mask AND in the pixels the chart actually paints, at day zoom
 *      and at a month zoom where the placeholder is narrower than its teeth; and
 *   6. with "hide undated" on, the dateless tasks disappear; and with the
 *      date-status indicator option off, no bar carries any date-status class
 *      and no bar is torn.
 *
 * SELECTOR NOTE: bars are SVAR `.wx-bar` elements carrying `data-id` = the note
 * path (our instance id for these single-parent roots). SVAR 2.6+ encodes a
 * string id in the DOM with a leading ":" (its `setID`), so the rendered
 * attribute is `:X.md`; we use the ends-with form `[data-id$="X.md"]` to target
 * a task's bar robustly across that encoding. The custom date-status type
 * renders as the bare `.datestatus-flagged` class on the swapped bar (SVAR only
 * `wx-`-prefixes the built-in task/summary/milestone types). The per-state
 * `.datestatus-*` classes are NOT task types — the bar template stamps them
 * from per-instance data — but they land as bare classes on the same element.
 *
 * MECHANISM NOTE: a torn bar rides SVAR's own split rendering. The observer
 * that stamps the state class stamps `wx-split` beside it, so the host paints
 * nothing by the library's rule — transparent, no border, no padding, and
 * never masked, because SVAR hangs the dependency link handles and hover
 * feedback off it. The painted surface is the inner `.og-bar-body` the bar
 * template renders (on piece-less torn bars and occupancy overlays), which
 * paints the published `--og-effective-fill` under a teeth-plus-middle mask:
 * one tooth tile per torn edge at the fixed 4px depth, capped per surface by
 * the 40% ceiling, plus a solid layer over the intact middle. SVAR's progress
 * wrapper stays visible above the body and carries the same mask. Hover and
 * selection cues are restored by our own `box-shadow` rule (SVAR guards its
 * cues behind `:not(.wx-split)`), and the label steps clear of the notches
 * via a `.wx-content` inset on each torn side.
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

/** The due date `Due Only.md` ships with; the live-edit test must restore it. */
const DUE_ONLY_FIXTURE_DUE = "2026-04-20";

/**
 * The orange fill the swapped bar still carries — the one survivor of the
 * legacy colour treatment, interim until schedule validation's error badge.
 * The red border half is retired entirely.
 */
const SWAPPED_FILL = "rgb(230, 126, 34)";

/**
 * Tooth period and full-size depth (half the period) the view stylesheet
 * publishes — fixed on the chart root; nothing republishes them per bar. Every
 * cut surface sizes its teeth as `min(depth, ceiling)`: the 40% per-surface
 * ceiling keeps a solid middle on a surface narrower than two full teeth.
 * Percentages in `mask-size` resolve against each surface at paint time, so
 * the computed longhands keep the `min()`/`calc()` unresolved — the strings
 * below are the exact serializations Chromium reports, which normalize each
 * math argument to a mixed `<percent> + <length>` pair. (The `.wx-content`
 * label inset uses the same `min()`, but padding longhands compute to the
 * USED length, so those pins are plain pixels instead.)
 */
const ZIGZAG_PERIOD = "8px";
const ZIGZAG_DEPTH = "4px";
const ZIGZAG_SURFACE_CEILING = "40%";
const ZIGZAG_TOOTH = `min(0% + ${ZIGZAG_DEPTH}, ${ZIGZAG_SURFACE_CEILING} + 0px)`;
const ZIGZAG_TOOTH_SIZE = `${ZIGZAG_TOOTH} ${ZIGZAG_PERIOD}`;
const ZIGZAG_MIDDLE_SIZE_ONE = `calc(100% + 0px - ${ZIGZAG_TOOTH}) 100%`;
const ZIGZAG_MIDDLE_SIZE_BOTH = `calc(100% + 0px - (${ZIGZAG_TOOTH} * 2)) 100%`;

/**
 * The ordinary chip inset EVERY bar's `.wx-content` carries
 * (`--og-bar-content-pad`), and the leading inset of a torn one. The tooth
 * clearance ADDS to the ordinary inset rather than replacing it, so the chip on
 * a torn bar never sits closer to the leading edge than an untorn bar's — the
 * relation is asserted alongside the value, since only the relation survives a
 * future change to either term.
 */
const BAR_CONTENT_PAD = "7px";
const ZIGZAG_LABEL_PAD_LEFT = `${
  Number.parseFloat(BAR_CONTENT_PAD) + Number.parseFloat(ZIGZAG_DEPTH)
}px`;

/** Computed facts for a bar under the split-rendered torn treatment. */
interface ZigzagProbe {
  /** Whether the bar renders the inner mask-carrying body layer at all. */
  body: boolean;
  bodyMaskImage: string;
  bodyMaskSize: string;
  bodyMaskPosition: string;
  bodyMaskRepeat: string;
  /** The body paints the published effective fill — the host paints nothing. */
  bodyBackgroundColor: string;
  /** `var(--og-effective-fill)` resolved on the host, as an rgb colour. */
  effectiveFill: string;
  /** Transparent on a torn bar: `wx-split` hands the painting to the body. */
  hostBackgroundColor: string;
  hostBackgroundClip: string;
  hostPaddingLeft: string;
  hostPaddingRight: string;
  hostBorderLeftWidth: string;
  hostBorderRightWidth: string;
  /** The host must never be masked — SVAR hangs link handles off it. */
  hostMaskImage: string;
  /** A rounded corner on a torn side would round off the outermost tooth tip. */
  hostRadiusTopLeft: string;
  hostRadiusTopRight: string;
  /** `.wx-content` insets — how the label steps clear of the notches. */
  labelPaddingLeft: string;
  labelPaddingRight: string;
  period: string;
}

/** Read the torn-treatment state of the bar whose `data-id` ends with `note`. */
async function readZigzag(note: string): Promise<ZigzagProbe> {
  return browser.execute((selector: string) => {
    const bar = document.querySelector(selector);
    if (!bar) throw new Error(`bar not found: ${selector}`);
    const host = window.getComputedStyle(bar);
    const body = bar.querySelector(".og-bar-body");
    const bodyStyle = body ? window.getComputedStyle(body) : null;
    const label = bar.querySelector(".wx-content");
    const labelStyle = label ? window.getComputedStyle(label) : null;
    // The custom property computes to a token stream, not an rgb() colour, so
    // resolve it the way the body does: paint it on a scratch child of the
    // host and read the colour the browser derives there.
    const scratch = document.createElement("div");
    scratch.style.backgroundColor = "var(--og-effective-fill)";
    bar.appendChild(scratch);
    const effectiveFill = window.getComputedStyle(scratch).backgroundColor;
    scratch.remove();
    return {
      body: body !== null,
      bodyMaskImage: bodyStyle?.maskImage ?? "",
      bodyMaskSize: bodyStyle?.maskSize ?? "",
      bodyMaskPosition: bodyStyle?.maskPosition ?? "",
      bodyMaskRepeat: bodyStyle?.maskRepeat ?? "",
      bodyBackgroundColor: bodyStyle?.backgroundColor ?? "",
      effectiveFill,
      hostBackgroundColor: host.backgroundColor,
      hostBackgroundClip: host.backgroundClip,
      hostPaddingLeft: host.paddingLeft,
      hostPaddingRight: host.paddingRight,
      hostBorderLeftWidth: host.borderLeftWidth,
      hostBorderRightWidth: host.borderRightWidth,
      hostMaskImage: host.maskImage,
      hostRadiusTopLeft: host.borderTopLeftRadius,
      hostRadiusTopRight: host.borderTopRightRadius,
      labelPaddingLeft: labelStyle?.paddingLeft ?? "",
      labelPaddingRight: labelStyle?.paddingRight ?? "",
      period: host.getPropertyValue("--og-zigzag-period").trim(),
    };
  }, `.og-bases-gantt .wx-bar[data-id$="${note}"]`);
}

/** The mask layers of `probe`, as their computed positions (one per layer). */
function maskLayerPositions(probe: ZigzagProbe): string[] {
  return probe.bodyMaskPosition.split(", ");
}

/**
 * One vertical column of RENDERED pixels through a bar, as `#rrggbb` strings.
 *
 * Every other assertion in this block reads a style string, which an inverted
 * or fully-opaque mask tile would satisfy just as happily as a correct one.
 * This reads what is actually on screen: the viewport is screenshotted over the
 * wire, then decoded by the page's own image pipeline onto a canvas so the
 * pixels can be sampled. `xFromLeft` is a CSS-pixel offset from the bar's left
 * edge; the top and bottom rows are skipped so a border or antialiased edge
 * never enters the sample.
 */
async function sampleBarColumn(note: string, xFromLeft: number): Promise<string[]> {
  const selector = `.og-bases-gantt .wx-bar[data-id$="${note}"]`;
  const screenshot = await browser.takeScreenshot();
  return browser.executeObsidian(
    async (_obsidian, png: string, sel: string, dx: number) => {
      const bar = document.querySelector(sel);
      if (!bar) throw new Error(`bar not found: ${sel}`);
      const rect = bar.getBoundingClientRect();
      // A mask never affects hit testing, so the bar answers at the sample point
      // whenever that point is genuinely on screen — the guard against sampling a
      // scrolled-out bar and reading whatever else happens to be at those pixels.
      const atSample = document.elementFromPoint(rect.left + dx, rect.top + rect.height / 2);
      if (rect.height < 6 || !(atSample === bar || bar.contains(atSample))) {
        throw new Error(`bar is not on screen to sample: ${JSON.stringify(rect)}`);
      }
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const scale = image.width / window.innerWidth;
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d canvas context");
      ctx.drawImage(image, 0, 0);
      const column = ctx.getImageData(
        Math.floor((rect.left + dx) * scale),
        Math.round(rect.top * scale) + 2,
        1,
        Math.max(1, Math.round(rect.height * scale) - 4),
      ).data;
      const pixels: string[] = [];
      for (let i = 0; i < column.length; i += 4) {
        pixels.push(
          `#${[column[i], column[i + 1], column[i + 2]]
            .map((v) => (v ?? 0).toString(16).padStart(2, "0"))
            .join("")}`,
        );
      }
      return pixels;
    },
    screenshot,
    selector,
    xFromLeft,
  );
}

/** `rgb(230, 126, 34)` → `#e67e22`, so a computed fill compares to a sampled pixel. */
function toHex(rgb: string): string {
  const parts = rgb.match(/\d+/g) ?? [];
  return `#${parts
    .slice(0, 3)
    .map((v) => Number(v).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Scroll the chart so `note`'s bar is fully inside the viewport, ready to sample. */
async function bringBarIntoView(note: string): Promise<void> {
  await browser.executeObsidian(async (_obsidian, sel: string) => {
    const bar = document.querySelector(sel);
    if (!bar) throw new Error(`bar not found: ${sel}`);
    bar.scrollIntoView({ block: "nearest", inline: "center" });
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  }, `.og-bases-gantt .wx-bar[data-id$="${note}"]`);
}

/** The `class` attribute of the bar whose `data-id` ends with `note`. */
async function barClass(note: string): Promise<string> {
  const bar = await $(`.og-bases-gantt .wx-bar[data-id$="${note}"]`);
  return await bar.getAttribute("class");
}

/**
 * Rewrite a note's start/due frontmatter through Obsidian's own API, so the
 * edit reaches the view the way a user's edit would. `undefined` removes a key.
 */
async function setDates(
  note: string,
  dates: { start?: string; due?: string },
): Promise<void> {
  await browser.executeObsidian(async ({ app }, p, d) => {
    const file = app.vault.getAbstractFileByPath(p);
    if (!file) throw new Error(`fixture note not found: ${p}`);
    await app.fileManager.processFrontMatter(file as never, (fm: Record<string, unknown>) => {
      for (const key of ["start", "due"] as const) {
        const value = (d as Record<string, string | undefined>)[key];
        if (value === undefined) delete fm[key];
        else fm[key] = value;
      }
    });
  }, note, dates);
}

/** Wait for a note's bar to carry `stateClass`. */
async function waitForStamp(note: string, stateClass: string): Promise<void> {
  await browser.waitUntil(async () => (await barClass(note)).includes(stateClass), {
    timeout: 20000,
    timeoutMsg: `${note} never carried ${stateClass}`,
  });
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

/**
 * One round-trip paint read per bar: host fill, the inner body's fill (null
 * when the bar renders no body — a torn bar's painted surface under split
 * rendering), top border (all three parts), progress fill.
 */
async function readBarPaint(notes: string[]): Promise<
  Array<{
    note: string;
    backgroundColor: string;
    bodyBackgroundColor: string | null;
    borderTopColor: string;
    borderTopStyle: string;
    borderTopWidth: string;
    progressColor: string | null;
  }>
> {
  return browser.execute(
    (names: string[]) =>
      names.map((note) => {
        const bar = document.querySelector(`.og-bases-gantt .wx-bar[data-id$="${note}"]`);
        if (!bar) throw new Error(`bar not found: ${note}`);
        const style = window.getComputedStyle(bar);
        const body = bar.querySelector(".og-bar-body");
        const progress = bar.querySelector(".wx-progress-percent");
        return {
          note,
          backgroundColor: style.backgroundColor,
          bodyBackgroundColor: body ? window.getComputedStyle(body).backgroundColor : null,
          borderTopColor: style.borderTopColor,
          borderTopStyle: style.borderTopStyle,
          borderTopWidth: style.borderTopWidth,
          progressColor: progress ? window.getComputedStyle(progress).backgroundColor : null,
        };
      }),
    notes,
  );
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

    it("flags the swapped bar only, leaving every torn and complete bar unflagged (R10)", async () => {
      // The colour flag is down to its last consumer. A bar whose signal is the
      // torn edge must not also carry it: the fill it forces is exactly what the
      // cut was chosen to compose with rather than replace.
      expect(await barClass("Complete.md")).not.toContain("datestatus-flagged");
      expect(await barClass("Due Only.md")).not.toContain("datestatus-flagged");
      expect(await barClass("Start Only.md")).not.toContain("datestatus-flagged");
      expect(await barClass("Dateless One.md")).not.toContain("datestatus-flagged");
      expect(await barClass("Swapped.md")).toContain("datestatus-flagged");

      // Exactly one flagged bar — the swapped one, and nothing else.
      const flagged = await $$(".og-bases-gantt .wx-bar.datestatus-flagged");
      expect(flagged).toHaveLength(1);
    });

    it("leaves a torn bar the ordinary fill instead of the date-status colours (AE1)", async () => {
      // An accent fill would compete with the very fill channels the cut was
      // chosen to compose with — so a torn bar's painted surface (its body,
      // since the split host paints nothing) has to show exactly the colour a
      // fully-dated bar's host does.
      const paint = await readBarPaint([
        "Complete.md",
        "Due Only.md",
        "Start Only.md",
        "Dateless One.md",
      ]);

      const complete = paint[0]!;
      // The reference bar really paints something, so "the same as complete" is
      // a claim about a colour rather than about two transparent surfaces.
      expect(complete.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
      for (const bar of paint.slice(1)) {
        expect(bar.bodyBackgroundColor).toBe(complete.backgroundColor);
        expect(bar.bodyBackgroundColor).not.toBe(SWAPPED_FILL);
      }
      // Read the progress fill on the one torn bar that HAS one; the others
      // render no such element and would compare a colour against nothing.
      const withProgress = paint.find((bar) => bar.note === "Start Only.md");
      expect(withProgress?.progressColor).not.toBeNull();
      expect(withProgress?.progressColor).toBe(complete.progressColor);
    });

    it("keeps the orange fill, and only the fill, on the swapped bar", async () => {
      // Swapped dates are the flag's last consumer, and the fill is now the
      // whole treatment: border and progress paint exactly as an ordinary
      // bar's, asserted as equalities against the complete bar so a surviving
      // border-width or repaint declaration fails the value comparison rather
      // than slipping past a not-red check.
      const [complete, swapped] = await readBarPaint(["Complete.md", "Swapped.md"]);
      expect(swapped!.backgroundColor).toBe(SWAPPED_FILL);
      expect(swapped!.borderTopColor).toBe(complete!.borderTopColor);
      expect(swapped!.borderTopStyle).toBe(complete!.borderTopStyle);
      expect(swapped!.borderTopWidth).toBe(complete!.borderTopWidth);
      expect(swapped!.progressColor).not.toBeNull();
      expect(swapped!.progressColor).toBe(complete!.progressColor);
    });

    it("stamps each flagged bar with the per-state class for its own date status", async () => {
      // The per-state classes are stamped by a post-mount bar attachment, not
      // emitted with the element, so bar presence alone does not mean they have
      // landed. Wait for the pair that must exist before counting.
      await browser.waitUntil(
        async () =>
          // One page-side snapshot of the whole mapping: summing separate
          // queries could let a missing stamp be offset by a stray one.
          await browser.executeObsidian((_obsidian, pairs: [string, string][]) =>
            pairs.every(([note, stateClass]) => {
              const bar = document.querySelector(
                `.og-bases-gantt .wx-bar[data-id$="${note}"]`,
              );
              return bar !== null && bar.classList.contains(stateClass);
            }),
          Object.entries(STATE_CLASS_BY_NOTE) as [string, string][]),
        { timeout: 20000, timeoutMsg: "per-state date-status classes were never stamped" },
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

    it("cuts teeth into an inner body layer on the leading edge of a due-only bar (AE1)", async () => {
      const probe = await readZigzag("Due Only.md");

      expect(probe.body).toBe(true);
      expect(probe.bodyMaskImage).toContain("conic-gradient");
      expect(probe.period).toBe(ZIGZAG_PERIOD);
      // Two layers: the teeth tile pinned to the leading edge, plus the solid
      // middle over everything past the tooth depth — the split host paints
      // nothing, so the body must cover the intact area itself.
      expect(maskLayerPositions(probe)).toEqual(["0% 0%", "100% 0%"]);
      expect(probe.bodyMaskSize).toBe(`${ZIGZAG_TOOTH_SIZE}, ${ZIGZAG_MIDDLE_SIZE_ONE}`);
      expect(probe.bodyMaskRepeat).toBe("repeat-y, no-repeat");
      // The cut shows the row because the host paints nothing at all — SVAR's
      // own split transparency, with no clearing padding left on either side.
      expect(probe.hostBackgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(probe.hostPaddingLeft).toBe("0px");
      expect(probe.hostPaddingRight).toBe("0px");
      // The label steps clear of the notches by the same min() the mask cuts
      // by — resolved here to the full depth, since a day-zoom bar is wide —
      // ADDED to the ordinary chip inset every bar already carries.
      expect(probe.labelPaddingLeft).toBe(ZIGZAG_LABEL_PAD_LEFT);
      // The relation, not just the sum: an untorn bar is the baseline, and the
      // torn one has to clear the notch on top of it. A future change that
      // swapped the addition back for a bare depth would shrink the torn inset
      // BELOW the untorn one and fail here even if both pins were re-fitted.
      const untorn = await readZigzag("Complete.md");
      expect(untorn.labelPaddingLeft).toBe(BAR_CONTENT_PAD);
      expect(Number.parseFloat(probe.labelPaddingLeft)).toBeGreaterThan(
        Number.parseFloat(untorn.labelPaddingLeft),
      );
    });

    it("paints the cut body in the bar's published effective fill", async () => {
      // The split host paints nothing, so `inherit` would inherit transparency:
      // the body must re-read the fill every treatment publishes through
      // --og-effective-fill, and really paint it.
      const probe = await readZigzag("Due Only.md");

      expect(probe.bodyBackgroundColor).toBe(probe.effectiveFill);
      expect(probe.bodyBackgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    });

    it("cuts teeth on the trailing edge of a start-only bar (AE2)", async () => {
      const probe = await readZigzag("Start Only.md");

      expect(probe.body).toBe(true);
      expect(probe.bodyMaskImage).toContain("conic-gradient");
      expect(maskLayerPositions(probe)).toEqual(["100% 0%", "0% 0%"]);
      expect(probe.bodyMaskSize).toBe(`${ZIGZAG_TOOTH_SIZE}, ${ZIGZAG_MIDDLE_SIZE_ONE}`);
      expect(probe.bodyMaskRepeat).toBe("repeat-y, no-repeat");
      expect(probe.hostBackgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(probe.labelPaddingRight).toBe(ZIGZAG_DEPTH);
    });

    it("cuts both edges of a one-cell dateless bar at the standard tooth size (AE3, AE7)", async () => {
      // Dateless One is a single-day placeholder, so this is also the one-cell
      // case: at day zoom the cell is wider than 10px, so the 4px depth still
      // beats the 40% ceiling and the teeth keep their absolute size.
      const probe = await readZigzag("Dateless One.md");

      expect(probe.body).toBe(true);
      expect(maskLayerPositions(probe)).toEqual(["0% 0%", "100% 0%", "50% 0%"]);
      expect(probe.bodyMaskSize).toBe(
        `${ZIGZAG_TOOTH_SIZE}, ${ZIGZAG_TOOTH_SIZE}, ${ZIGZAG_MIDDLE_SIZE_BOTH}`,
      );
      expect(probe.bodyMaskRepeat).toBe("repeat-y, repeat-y, no-repeat");
      expect(probe.hostBackgroundColor).toBe("rgba(0, 0, 0, 0)");
      // Leading side: tooth clearance ADDED to the ordinary chip inset;
      // trailing side: the bare clearance (nothing is seated against that edge).
      expect(probe.labelPaddingLeft).toBe(ZIGZAG_LABEL_PAD_LEFT);
      expect(probe.labelPaddingRight).toBe(ZIGZAG_DEPTH);
    });

    it("never masks the host bar, so its hover and selection feedback stays whole", async () => {
      // The host paints SVAR's hover/selection box-shadow and outline, and hosts
      // the link handles that sit OUTSIDE its border box, so a host-level mask
      // would cut all of them. The tear has to live on the inner layer, only.
      // (Handles need an editable view; the dependency spec asserts those.)
      const torn = await readZigzag("Dateless One.md");
      const complete = await readZigzag("Complete.md");

      expect(torn.body).toBe(true);
      expect(torn.hostMaskImage).toBe("none");
      expect(complete.hostMaskImage).toBe("none");
    });

    it("keeps the label and the progress fill painted above the cut body", async () => {
      // Start Only carries progress, so SVAR renders its progress wrapper as a
      // SIBLING of the body layer: it has to stay above the carrier (or the
      // fill vanishes) and start at the bar's edge (or the host padding that
      // clears the teeth shifts it out of place).
      const painted = await browser.execute((selector: string) => {
        const bar = document.querySelector(selector);
        if (!bar) throw new Error(`bar not found: ${selector}`);
        const wrapper = bar.querySelector(".wx-progress-wrapper");
        const label = bar.querySelector(".og-bar-text");
        const body = bar.querySelector(".og-bar-body");
        const wrapperStyle = wrapper ? window.getComputedStyle(wrapper) : null;
        const content = bar.querySelector(".wx-content");
        const contentStyle = content ? window.getComputedStyle(content) : null;
        return {
          labelWidth: (label as HTMLElement | null)?.offsetWidth ?? 0,
          fillWidth: (bar.querySelector(".wx-progress-percent") as HTMLElement | null)?.offsetWidth ?? 0,
          wrapperLeft: wrapperStyle?.left ?? "",
          wrapperZIndex: wrapperStyle?.zIndex ?? "",
          wrapperMaskImage: wrapperStyle?.maskImage ?? "",
          bodyZIndex: body ? window.getComputedStyle(body).zIndex : "",
          contentPosition: contentStyle?.position ?? "",
          contentZIndex: contentStyle?.zIndex ?? "",
        };
      }, `.og-bases-gantt .wx-bar[data-id$="Start Only.md"]`);

      expect(painted.labelWidth).toBeGreaterThan(0);
      expect(painted.fillWidth).toBeGreaterThan(0);
      expect(painted.wrapperLeft).toBe("0px");
      expect(painted.wrapperZIndex).toBe("1");
      expect(painted.bodyZIndex).toBe("0");
      // A measurable label is not a VISIBLE one: the body is an opaque,
      // absolutely-positioned layer covering the whole bar, so the label only
      // survives because SVAR positions .wx-content and lifts it above. That is
      // a borrowed library guarantee — pin it here, or a SVAR change silently
      // paints the body over every torn bar's text.
      expect(painted.contentPosition).toBe("relative");
      expect(painted.contentZIndex).toBe("2");
      // The progress fill reaches the same edge as the body, so it carries the
      // same cut — otherwise it would paint over the teeth.
      expect(painted.wrapperMaskImage).toContain("conic-gradient");
    });

    it("renders no body layer on the complete bar or the swapped bar", async () => {
      // Only the three non-authored-edge states are torn; a complete bar has
      // nothing to signal and a swapped bar gets its own treatment.
      expect((await readZigzag("Complete.md")).body).toBe(false);
      expect((await readZigzag("Swapped.md")).body).toBe(false);
    });

    it("squares the torn corners and keeps the intact side rounded", async () => {
      // The split host paints no border on EITHER side, so the straight-edge
      // threat left is the corner radius: the body inherits it, and a rounded
      // torn corner would round off the outermost tooth tip. Only the torn
      // side gives up its rounding.
      const complete = await readZigzag("Complete.md");
      const dueOnly = await readZigzag("Due Only.md");
      const startOnly = await readZigzag("Start Only.md");
      const dateless = await readZigzag("Dateless One.md");

      // The reference bar really is rounded, so the "0px" pins are removals.
      expect(Number.parseFloat(complete.hostRadiusTopLeft)).toBeGreaterThan(0);
      expect(dueOnly.hostRadiusTopLeft).toBe("0px");
      expect(dueOnly.hostRadiusTopRight).toBe(complete.hostRadiusTopRight);
      expect(startOnly.hostRadiusTopRight).toBe("0px");
      expect(startOnly.hostRadiusTopLeft).toBe(complete.hostRadiusTopLeft);
      expect(dateless.hostRadiusTopLeft).toBe("0px");
      expect(dateless.hostRadiusTopRight).toBe("0px");
    });

    it("keeps every mask longhand weighted against SVAR's own scoped styles", async () => {
      // SVAR's styles are Svelte-hashed and out-specify a plain injected rule, so
      // an unweighted mask longhand can be switched off by a library or theme
      // rule and take the whole signal with it. A more specific competitor
      // without `!important` stands in for that here — and it contests EVERY
      // longhand the treatment relies on, because the tile only reads as teeth
      // when its image, size, position and repeat all survive together: a
      // full-bleed size or a stray `repeat` paints the notches straight back in.
      const contested = await browser.executeObsidian(async (_obsidian, selector: string) => {
        const sheet = document.createElement("style");
        // Repeated classes are the portable way to out-specify the view's own
        // scoped rule without an id, standing in for a library or theme rule.
        sheet.textContent =
          ".og-bases-gantt.og-bases-gantt.og-bases-gantt .wx-bar.wx-bar.wx-bar.wx-bar " +
          ".og-bar-body.og-bar-body.og-bar-body {" +
          "  mask-image: none; -webkit-mask-image: none;" +
          "  mask-size: auto; -webkit-mask-size: auto;" +
          "  mask-position: center center; -webkit-mask-position: center center;" +
          "  mask-repeat: repeat; -webkit-mask-repeat: repeat;" +
          "}";
        document.head.appendChild(sheet);
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
        const body = document.querySelector(`${selector} .og-bar-body`);
        const style = body ? window.getComputedStyle(body) : null;
        const survived = {
          maskImage: style?.maskImage ?? "",
          maskSize: style?.maskSize ?? "",
          maskPosition: style?.maskPosition ?? "",
          maskRepeat: style?.maskRepeat ?? "",
        };
        sheet.remove();
        return survived;
      }, `.og-bases-gantt .wx-bar[data-id$="Dateless One.md"]`);

      expect(contested.maskImage).toContain("conic-gradient");
      expect(contested.maskSize).toBe(
        `${ZIGZAG_TOOTH_SIZE}, ${ZIGZAG_TOOTH_SIZE}, ${ZIGZAG_MIDDLE_SIZE_BOTH}`,
      );
      expect(contested.maskPosition).toBe("0% 0%, 100% 0%, 50% 0%");
      expect(contested.maskRepeat).toBe("repeat-y, repeat-y, no-repeat");
    });

    it("leaves no torn-state residue once a bar's dates are authored", async () => {
      // The state class, SVAR's `wx-split` and the mask-carrying body are all
      // stamped onto a bar SVAR owns; authoring both dates makes the status
      // complete and every one of them has to go, or the bar keeps a
      // transparent host with nothing left painting its body.
      try {
        // The split really was on, so its absence below is the teardown's work.
        expect(await barClass("Dateless Two.md")).toContain("wx-split");
        await setDates("Dateless Two.md", { start: "2026-04-10", due: "2026-04-12" });
        await browser.waitUntil(
          async () => !(await barClass("Dateless Two.md")).includes("datestatus-zigzag-both"),
          { timeout: 20000, timeoutMsg: "the torn state outlived the authored dates" },
        );
        const cleared = await readZigzag("Dateless Two.md");
        expect(cleared.body).toBe(false);
        expect(await barClass("Dateless Two.md")).not.toContain("wx-split");
        // Un-split, the host paints its own fill again.
        expect(cleared.hostBackgroundColor).not.toBe("rgba(0, 0, 0, 0)");
      } finally {
        await setDates("Dateless Two.md", { start: undefined, due: undefined });
      }
      await waitForStamp("Dateless Two.md", "datestatus-zigzag-both");
    });

    it("leaves an untorn bar's own background painting untouched", async () => {
      // The clip + padding that clear the teeth are scoped to torn bars. A rule
      // leaking onto every `.wx-bar` would pass every assertion above while
      // silently insetting the fill of every complete bar in the chart.
      const complete = await readZigzag("Complete.md");

      expect(complete.hostBackgroundClip).toBe("border-box");
      expect(complete.hostPaddingLeft).toBe("0px");
      expect(complete.hostPaddingRight).toBe("0px");
      // Whatever border SVAR gives an ordinary bar, it stays symmetric — the
      // torn-side border removal must not reach a bar with nothing torn.
      expect(complete.hostBorderLeftWidth).toBe(complete.hostBorderRightWidth);
    });

    it("keeps a torn bar split so the cut rides its one body layer", async () => {
      // Torn ⇒ split, unconditionally: the token observer stamps SVAR's own
      // `wx-split` beside the state class, the host stops painting by the
      // library's rule, and exactly one body layer carries the cut in its
      // place — a second carrier would cut a second tooth column at its own
      // edge. (Piece surfaces cut only inside piece wrappers; the coarse-zoom
      // split-piece test pins that side.)
      const probe = await browser.execute((selector: string) => {
        const bar = document.querySelector(selector);
        if (!bar) throw new Error(`bar not found: ${selector}`);
        const bodies = bar.querySelectorAll(".og-bar-body");
        return {
          hostClass: bar.getAttribute("class") ?? "",
          hostBackgroundColor: window.getComputedStyle(bar).backgroundColor,
          bodyCount: bodies.length,
          bodyMaskImage: bodies[0] ? window.getComputedStyle(bodies[0]).maskImage : "",
        };
      }, `.og-bases-gantt .wx-bar[data-id$="Dateless One.md"]`);

      expect(probe.hostClass).toContain("wx-split");
      expect(probe.hostBackgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(probe.bodyCount).toBe(1);
      expect(probe.bodyMaskImage).toContain("conic-gradient");
    });

    it("cuts a mid-bar recorded-piece overlay at the wrapper, never the piece", async () => {
      // The occupancy overlay (envelope off) is the plain span the recorded
      // pieces sit on: the teeth belong to the BAR's edges, so the cut lands
      // on the piece WRAPPER — a recorded piece's own edge is rarely the
      // bar's, and cutting a mid-bar piece would grow a tooth column at the
      // wrong x. The same piece inside a plain pieces wrapper (the
      // ghost/envelope path) DOES take the cut, and that contrast is what
      // makes the overlay exclusion detectable rather than a selector that
      // matches nothing. Both wrappers are stamped and removed in one page
      // turn, prepended because a split bar lays out block and the template's
      // wrapper owns the bar's box.
      const masks = await browser.execute((selector: string) => {
        const bar = document.querySelector(selector);
        if (!bar) throw new Error(`bar not found: ${selector}`);
        const probeWrapper = (overlay: boolean) => {
          const wrapper = document.createElement("div");
          wrapper.className = overlay ? "og-ghost-runs og-occupancy-overlay" : "og-ghost-runs";
          const piece = document.createElement("div");
          piece.className = "og-instance og-piece-first og-piece-last";
          // Mid-bar: the recorded piece reaches neither edge of the span.
          piece.style.cssText = "left:30%;width:40%;";
          wrapper.appendChild(piece);
          bar.prepend(wrapper);
          const read = {
            wrapperMaskImage: window.getComputedStyle(wrapper).maskImage,
            wrapperMaskSize: window.getComputedStyle(wrapper).maskSize,
            pieceMaskImage: window.getComputedStyle(piece).maskImage,
          };
          wrapper.remove();
          return read;
        };
        return { overlay: probeWrapper(true), plain: probeWrapper(false) };
      }, `.og-bases-gantt .wx-bar[data-id$="Due Only.md"]`);

      // Overlay: the wrapper carries the bar's own leading cut at full span…
      expect(masks.overlay.wrapperMaskImage).toContain("conic-gradient");
      expect(masks.overlay.wrapperMaskSize).toBe(
        `${ZIGZAG_TOOTH_SIZE}, ${ZIGZAG_MIDDLE_SIZE_ONE}`,
      );
      // …and its recorded piece stays whole: no mid-bar tooth column.
      expect(masks.overlay.pieceMaskImage).toBe("none");
      // Without the overlay class the roles swap: the wrapper stays whole and
      // the outermost piece takes the cut, exactly the ghost/envelope rule.
      expect(masks.plain.wrapperMaskImage).toBe("none");
      expect(masks.plain.pieceMaskImage).toContain("conic-gradient");
    });

    it("cuts the replicated hatch overlay along the same teeth", async () => {
      // The hatch is a host-level `::after` spanning `inset: 0`, so like the
      // strip accent it paints OUTSIDE the masked body and would fill the
      // notches straight back in. Stamping the replication cue here composes the
      // two treatments on one bar; it is removed inside the same page turn.
      const hatch = await browser.execute((selector: string) => {
        const bar = document.querySelector(selector);
        if (!bar) throw new Error(`bar not found: ${selector}`);
        bar.classList.add("og-replicated");
        const style = window.getComputedStyle(bar, "::after");
        const cued = {
          backgroundImage: style.backgroundImage,
          maskImage: style.maskImage,
          maskPosition: style.maskPosition,
        };
        bar.classList.remove("og-replicated");
        return cued;
      }, `.og-bases-gantt .wx-bar[data-id$="Dateless One.md"]`);

      // The hatch really paints (an uncued bar draws no overlay at all)…
      expect(hatch.backgroundImage).toContain("repeating-linear-gradient");
      // …and it carries the same both-edge cut as the body underneath it, over a
      // solid middle so the hatch still reads across the rest of the bar.
      expect(hatch.maskImage).toContain("conic-gradient");
      expect(hatch.maskPosition.split(", ")).toEqual(["0% 0%", "100% 0%", "50% 0%"]);
    });

    // The live-edit test below mutates the vault. Restoring inline is not
    // enough: a failed assertion would skip the restore and cascade into every
    // later block, so an idempotent hook guarantees the fixture state.
    after(async () => {
      await setDates("Due Only.md", { start: undefined, due: DUE_ONLY_FIXTURE_DUE });
    });

    it("re-stamps the per-state class in place when a task's dates change", async () => {
      // The interesting case is an UPDATE, not a mount: the bar element survives
      // while SVAR re-applies its class list from the task type, which drops an
      // imperatively-stamped class unless it is re-asserted. Flipping Due Only
      // from due-only to start-only moves it inferred-start -> inferred-end
      // without touching its type, so the stamp is the only thing that changes.
      try {
        await setDates("Due Only.md", { start: "2026-04-08", due: undefined });
        await waitForStamp("Due Only.md", "datestatus-zigzag-end");

        expect(await barClass("Due Only.md")).not.toContain("datestatus-zigzag-start");
        expect(await $$(`.og-bases-gantt .wx-bar.datestatus-zigzag-start`)).toHaveLength(0);
        expect(await $$(`.og-bases-gantt .wx-bar.datestatus-zigzag-end`)).toHaveLength(2);
      } finally {
        // Restore here, not just in the hook: a failed assertion above would
        // otherwise hand the next test a mutated note and fail it too.
        await setDates("Due Only.md", { start: undefined, due: DUE_ONLY_FIXTURE_DUE });
      }

      // The reverse transition is worth asserting in its own right.
      await waitForStamp("Due Only.md", "datestatus-zigzag-start");
      expect(await barClass("Due Only.md")).not.toContain("datestatus-zigzag-end");
      expect(await $$(`.og-bases-gantt .wx-bar.datestatus-zigzag-end`)).toHaveLength(1);
    });

    it("restores the stamp when the bar's class list is rewritten under it", async () => {
      // The stamp is imperative, so any host re-render that rebuilds the class
      // list from the task type erases it — and when the date status itself has
      // not changed, nothing re-runs the stamp. Stripping the class directly is
      // that rewrite in miniature: the guard is that it comes back on its own.
      // Strip and re-read within a single page turn: a re-render would also
      // re-add the class, so polling from the test side could pass with the
      // observer gone entirely.
      const [presentBefore, restoredInPlace] = await browser.executeObsidian(
        async (_obsidian, selector: string, stateClass: string) => {
          const bar = document.querySelector(selector);
          if (!bar) throw new Error(`bar not found: ${selector}`);
          // Reading before the strip matters: without it a stamp that merely
          // arrived late would look like a restore.
          const before = bar.classList.contains(stateClass);
          bar.classList.remove(stateClass);
          // Observer callbacks are delivered on the microtask queued by the
          // mutation itself, so one microtask hop lands after it and before any
          // later task — a timer hop would also let a re-render restore the
          // class and mask a broken observer.
          await Promise.resolve();
          return [before, bar.classList.contains(stateClass)];
        },
        `.og-bases-gantt .wx-bar[data-id$="Due Only.md"]`,
        "datestatus-zigzag-start",
      );

      expect(presentBefore).toBe(true);
      expect(restoredInPlace).toBe(true);
      expect(await $$(`.og-bases-gantt .wx-bar.datestatus-zigzag-start`)).toHaveLength(1);
    });
  });

  describe("teeth as rendered pixels", () => {
    before(async () => {
      await openBase("Dates.base");
      await bringBarIntoView("Due Only.md");
    });

    it("lets the row show through the notches instead of painting a straight edge", async () => {
      // Every other zigzag assertion reads a style string, which a fully-opaque
      // or inverted tile satisfies just as well. This one reads the screen: at
      // the bar's leading edge the mask leaves only the tooth tips, so that
      // column is mostly NOT the bar's fill, while a column past the tooth depth
      // is solid fill. The comparison catches both failure modes at once. The
      // reference colour is the BODY's — the split host paints nothing. The
      // label is hidden while sampling: its inset is exactly the tooth depth,
      // so glyph pixels would land in the inside column and read as "not fill"
      // when the claim under test is the mask geometry alone.
      const fill = toHex((await readZigzag("Due Only.md")).bodyBackgroundColor);
      const setLabelHidden = (selector: string, hidden: string) => {
        const label = document.querySelector(`${selector} .wx-content`);
        if (label) (label as HTMLElement).style.visibility = hidden;
      };
      const barSelector = `.og-bases-gantt .wx-bar[data-id$="Due Only.md"]`;
      await browser.execute(setLabelHidden, barSelector, "hidden");
      const edge = await sampleBarColumn("Due Only.md", 0.5);
      const inside = await sampleBarColumn("Due Only.md", 8);
      await browser.execute(setLabelHidden, barSelector, "");

      const countFill = (column: string[]): number =>
        column.filter((pixel) => pixel === fill).length;
      expect(edge.length).toBeGreaterThan(8);
      // The interior really is the bar (so the sample is aimed correctly)…
      expect(countFill(inside)).toBeGreaterThan(inside.length * 0.6);
      // …and the leading edge is mostly cut away.
      expect(countFill(edge)).toBeLessThan(countFill(inside) * 0.5);
    });

    it("paints a translucent fill at one strength across the whole bar", async () => {
      // The teeth tile and the solid middle are two mask LAYERS on one body,
      // and mask layers composite by adding their alphas. If their bands
      // overlapped, a fill with alpha would come out stronger where they do —
      // invisible under an opaque fill today, and a trap for every alpha
      // palette colour. Each layer has to own its own band: the tile the tooth
      // depth, the middle everything past it.
      //
      // The alpha must arrive through the channel the BODY reads or the test
      // proves nothing. The body paints
      // `var(--og-host-body-fill, var(--og-effective-fill))` and the default
      // fill treatment publishes --og-host-body-fill on every bar, so clear
      // that first (a custom property set to `initial` is guaranteed-invalid,
      // and the var() falls through to its fallback) and drive --og-ghost-fill,
      // which the effective fill derives from. An inline HOST background would
      // be painted straight over by the body and make both columns agree by
      // construction. The label is hidden while sampling: its glyphs would land
      // in the middle column and skew the dominant colour.
      const barSelector = `.og-bases-gantt .wx-bar[data-id$="Due Only.md"]`;
      const staged = await browser.execute((selector: string) => {
        const bar = document.querySelector(selector) as HTMLElement;
        if (!bar) throw new Error(`bar not found: ${selector}`);
        bar.style.setProperty("--og-host-body-fill", "initial");
        bar.style.setProperty("--og-ghost-fill", "rgba(0, 0, 255, 0.5)");
        const label = bar.querySelector(".wx-content") as HTMLElement | null;
        if (label) label.style.visibility = "hidden";
        const body = bar.querySelector(".og-bar-body");
        return {
          bodyBackgroundColor: body ? window.getComputedStyle(body).backgroundColor : null,
          hostBackgroundColor: window.getComputedStyle(bar).backgroundColor,
        };
      }, barSelector);

      // The body really took the translucent fill through that channel, and the
      // split host still paints nothing — so the two columns below differ only
      // by which mask layer covers them.
      expect(staged.bodyBackgroundColor).toBe("rgba(0, 0, 255, 0.5)");
      expect(staged.hostBackgroundColor).toBe("rgba(0, 0, 0, 0)");

      // Just inside the tooth depth the tooth is opaque for most of its period,
      // so the column's dominant colour is the fill under the TILE; well past
      // it, the fill under the MIDDLE layer.
      const dominant = (column: string[]): string =>
        [...column].sort(
          (a, b) =>
            column.filter((p) => p === b).length - column.filter((p) => p === a).length,
        )[0]!;
      const strip = dominant(await sampleBarColumn("Due Only.md", 3.5));
      const middle = dominant(await sampleBarColumn("Due Only.md", 12));

      await browser.execute((selector: string) => {
        const bar = document.querySelector(selector) as HTMLElement;
        bar.style.removeProperty("--og-host-body-fill");
        bar.style.removeProperty("--og-ghost-fill");
        const label = bar.querySelector(".wx-content") as HTMLElement | null;
        if (label) label.style.removeProperty("visibility");
      }, barSelector);

      // The translucent fill really reached the screen — the row shows through
      // it, so a doubled alpha would be visible at all…
      expect(strip).not.toBe("#0000ff");
      // …and the two bands came out the same strength, so neither composited twice.
      expect(middle).toBe(strip);
    });

    it("keeps the notch open under occupancy pieces that reach the bar's edge", async () => {
      // Recurring occupancy pieces paint above the torn bar's cut body. A piece
      // whose span reaches the torn edge would fill the notch straight back in,
      // so the row stops showing through and the bar reads whole again — unless
      // the piece surface carries the same cut. Only the pixels can prove the
      // composition: every per-surface style read would look correct while an
      // uncut surface above repaints the notch.
      const OVERLAY = "#ff00ff";
      await browser.execute(
        (selector: string, color: string) => {
          const bar = document.querySelector(selector);
          if (!bar) throw new Error(`bar not found: ${selector}`);
          const wrapper = document.createElement("div");
          wrapper.className = "og-ghost-runs";
          wrapper.id = "og-notch-probe";
          const piece = document.createElement("div");
          piece.className = "og-instance og-piece-first og-piece-last";
          // Real edge geometry: the piece spans the whole bar, so it covers both
          // the middle and the strip the teeth were cut from.
          piece.style.cssText = `left:0;width:100%;border:0;background-color:${color};`;
          wrapper.appendChild(piece);
          // Prepended: a split bar lays out block, and the template's real
          // wrapper owns the bar's box (the content renders inside it) — an
          // appended sibling would stack BELOW `.wx-content`, outside the bar.
          bar.prepend(wrapper);
        },
        `.og-bases-gantt .wx-bar[data-id$="Due Only.md"]`,
        OVERLAY,
      );

      const edge = await sampleBarColumn("Due Only.md", 0.5);
      const inside = await sampleBarColumn("Due Only.md", 8);
      await browser.execute(() => document.getElementById("og-notch-probe")?.remove());

      const countOverlay = (column: string[]): number =>
        column.filter((pixel) => pixel === OVERLAY).length;
      // The piece really did paint over the bar (otherwise the edge check below
      // would pass on a bar the overlay never reached)…
      expect(countOverlay(inside)).toBeGreaterThan(inside.length * 0.6);
      // …and the leading notch still shows the row rather than the piece.
      expect(countOverlay(edge)).toBeLessThan(countOverlay(inside) * 0.5);
    });
  });

  describe("selection on a torn bar", () => {
    before(async () => {
      await openBase("Dates.base");
      await waitForStamp("Dateless One.md", "datestatus-zigzag-both");
    });

    it("signals selection distinctly from hover on a bar torn on both sides", async () => {
      // A both-torn placeholder is exactly the row a user clicks to fill its
      // dates in, and it is the bar with the least border left to signal with:
      // the tear removes the border on BOTH sides. So the selection cue has to
      // stay legible without one, and stay distinguishable from the plain hover
      // feedback that the same pointer produces on its way to the click.
      const selector = `.og-bases-gantt .wx-bar[data-id$="Dateless One.md"]`;
      const bar = await $(selector);
      const cue = async (): Promise<{
        barShadow: string;
        borderTotal: number;
        bands: Array<{ isBar: boolean; background: string; left: number; width: number }>;
      }> =>
        browser.execute((selector: string) => {
          const target = document.querySelector(selector) as HTMLElement;
          const style = window.getComputedStyle(target);
          const px = (v: string): number => Number.parseFloat(v) || 0;
          return {
            barShadow: style.boxShadow,
            borderTotal: px(style.borderLeftWidth) + px(style.borderRightWidth),
            bands: [...document.querySelectorAll(".og-bases-gantt .wx-chart .wx-selected")].map(
              (band) => ({
                isBar: band.classList.contains("wx-bar"),
                background: window.getComputedStyle(band).backgroundColor,
                left: band.getBoundingClientRect().left,
                width: band.getBoundingClientRect().width,
              }),
            ),
          };
        }, selector);

      // Park the pointer off every bar so the baseline carries no hover cue.
      await browser.action("pointer").move({ x: 3, y: 3 }).perform();
      const idle = await cue();
      await bar.moveTo();
      const hovered = await cue();
      // JS-dispatched: SVAR bars can sit where WebDriver refuses an element click.
      await browser.execute((s: string) => (document.querySelector(s) as HTMLElement).click(), selector);
      await browser.waitUntil(async () => (await cue()).bands.length > 0, {
        timeout: 5000,
        timeoutMsg: "clicking the torn bar produced no selection cue",
      });
      const selected = await cue();

      // The bar really is the hard case: no border on either side to signal with.
      expect(idle.borderTotal).toBe(0);
      // Hover paints on the bar and nothing else…
      expect(idle.barShadow).toBe("none");
      expect(hovered.barShadow).not.toBe("none");
      expect(hovered.bands).toHaveLength(0);
      // …while selection paints a band the hover cue never produces, in its own
      // colour, spanning far beyond the bar — so the two can never be confused.
      const band = selected.bands[0]!;
      expect(band.isBar).toBe(false);
      expect(band.background).not.toBe("rgba(0, 0, 0, 0)");
      const barBox = await bar.getSize();
      expect(band.width).toBeGreaterThan(barBox.width * 2);

      // The cue rule restores BOTH of the cues SVAR guards behind
      // `:not(.wx-split)`, but only the hover half can fire from a pointer
      // here: the chart marks the row BAND selected, never the bar. So stage
      // the class the rule names — the way the dependency spec stages
      // `wx-selected` on a link handle — and pin the second half by value.
      // The pointer is parked off the bar first, so `:hover` cannot supply the
      // shadow and let a deleted `.wx-selected` selector pass unnoticed.
      await browser.action("pointer").move({ x: 3, y: 3 }).perform();
      const staged = await browser.execute((selector: string) => {
        const target = document.querySelector(selector) as HTMLElement;
        if (!target) throw new Error(`bar not found: ${selector}`);
        const read = (): string => window.getComputedStyle(target).boxShadow;
        const before = read();
        target.classList.add("wx-selected");
        const withClass = read();
        target.classList.remove("wx-selected");
        return { before, withClass, after: read() };
      }, selector);

      // Unhovered and unselected the bar carries no shadow, so the value below
      // is the staged class's own doing…
      expect(staged.before).toBe("none");
      // …it is a real shadow, identical to the hover cue the same rule paints…
      expect(staged.withClass).not.toBe("none");
      expect(staged.withClass).toBe(hovered.barShadow);
      // …and the staging left nothing behind for the next test.
      expect(staged.after).toBe("none");
    });
  });

  describe("coarse zoom", () => {
    before(async () => {
      await openBase("DatesCoarse.base");
    });

    it("keeps a narrow placeholder's box exactly the width SVAR laid out", async () => {
      // A dateless placeholder is a one-day bar, so at month zoom it is only a
      // few pixels wide. SVAR keeps positioning dependency arrows, link handles
      // and drag maths from the width it laid out, and nothing of ours may
      // widen the box: the treatment spends no host padding and no host border
      // at all — the narrow case is held inside the mask, not the box model.
      const geometry = await browser.execute((selector: string) => {
        const bar = document.querySelector(selector) as HTMLElement;
        if (!bar) throw new Error(`bar not found: ${selector}`);
        const style = window.getComputedStyle(bar);
        return {
          rendered: bar.getBoundingClientRect().width,
          laidOut: Number.parseFloat(bar.style.width),
          boxSizing: style.boxSizing,
          paddingLeft: style.paddingLeft,
          paddingRight: style.paddingRight,
          borderLeftWidth: style.borderLeftWidth,
          borderRightWidth: style.borderRightWidth,
        };
      }, `.og-bases-gantt .wx-bar[data-id$="Dateless One.md"]`);

      // The bar really is narrower than two full teeth, or the case is untested.
      expect(geometry.laidOut).toBeLessThan(8);
      expect(geometry.boxSizing).toBe("border-box");
      expect(geometry.paddingLeft).toBe("0px");
      expect(geometry.paddingRight).toBe("0px");
      expect(geometry.borderLeftWidth).toBe("0px");
      expect(geometry.borderRightWidth).toBe("0px");
      expect(geometry.rendered).toBeCloseTo(geometry.laidOut, 1);
    });

    it("caps the teeth by the surface ceiling so a solid middle survives", async () => {
      // A both-torn bar narrower than two full teeth would mask down to a
      // column of tooth tips if each tooth kept its absolute 4px. The ceiling
      // is per surface — each tooth tile sizes to min(4px, 40%), so the middle
      // layer keeps calc(100% - 40% * 2) = a fifth of the surface, solid.
      // (Pixels are not sampled here — a placeholder sits under the today
      // marker, and a three-pixel bar is mostly antialiasing.)
      const probe = await readZigzag("Dateless One.md");
      const laidOut = await browser.execute(
        (selector: string) =>
          Number.parseFloat((document.querySelector(selector) as HTMLElement).style.width),
        `.og-bases-gantt .wx-bar[data-id$="Dateless One.md"]`,
      );

      // The ceiling really is the binding term: 40% of this bar is under 4px.
      expect(laidOut * 0.4).toBeLessThan(Number.parseFloat(ZIGZAG_DEPTH));
      expect(probe.body).toBe(true);
      expect(probe.bodyMaskImage).toContain("conic-gradient");
      // Percentages in mask-size resolve against the surface at paint time, so
      // the computed tile keeps the min() — the same declaration serves every
      // width, and no script ever measures this bar.
      expect(probe.bodyMaskSize).toBe(
        `${ZIGZAG_TOOTH_SIZE}, ${ZIGZAG_TOOTH_SIZE}, ${ZIGZAG_MIDDLE_SIZE_BOTH}`,
      );
    });

    it("spends no box-model width on a bar torn on one side only", async () => {
      // A single-torn bar KEEPS an intact side, which under the old opaque-host
      // mechanism kept a border that competed with the tooth for the bar's few
      // pixels. Under split rendering the host paints no border on either side
      // and no padding anywhere, so the box is exactly SVAR's — the intact
      // side's straight edge is the body's own unmasked edge.
      const geometry = await browser.execute((selector: string) => {
        const bar = document.querySelector(selector) as HTMLElement;
        if (!bar) throw new Error(`bar not found: ${selector}`);
        const style = window.getComputedStyle(bar);
        return {
          rendered: bar.getBoundingClientRect().width,
          laidOut: Number.parseFloat(bar.style.width),
          paddingLeft: style.paddingLeft,
          paddingRight: style.paddingRight,
          borderLeftWidth: style.borderLeftWidth,
          borderRightWidth: style.borderRightWidth,
          maskSize: (() => {
            const body = bar.querySelector(".og-bar-body");
            return body ? window.getComputedStyle(body).maskSize : "";
          })(),
        };
      }, `.og-bases-gantt .wx-bar[data-id$="Due Only.md"]`);

      // The bar really is in the narrow regime where the old budget overflowed.
      expect(geometry.laidOut).toBeLessThan(10);
      expect(geometry.paddingLeft).toBe("0px");
      expect(geometry.paddingRight).toBe("0px");
      expect(geometry.borderLeftWidth).toBe("0px");
      expect(geometry.borderRightWidth).toBe("0px");
      expect(geometry.rendered).toBeCloseTo(geometry.laidOut, 1);
      // The single torn edge is held by the same ceiling-held tile.
      expect(geometry.maskSize).toBe(`${ZIGZAG_TOOTH_SIZE}, ${ZIGZAG_MIDDLE_SIZE_ONE}`);
    });

    it("cuts a split piece with the same ceiling-held tooth as the bar's body", async () => {
      // Every surface that carries the tear cuts by the same declaration:
      // min(4px, 40%), resolved against ITS OWN width at paint time. A wide
      // recorded piece on this narrow bar therefore cuts full-size 4px teeth
      // while the bar's own three-pixel body is held by the 40% ceiling — no
      // script fits either of them, so the computed serialization must keep
      // the min() rather than any inline-fitted length. The piece is stamped
      // inside a piece wrapper (where the piece cuts are scoped) and removed
      // in the same page turn.
      const probe = await browser.execute((selector: string) => {
        const bar = document.querySelector(selector) as HTMLElement;
        if (!bar) throw new Error(`bar not found: ${selector}`);
        const wrapper = document.createElement("div");
        wrapper.className = "og-ghost-runs";
        const piece = document.createElement("div");
        piece.className = "og-instance og-piece-first og-piece-last";
        piece.style.cssText = "position:absolute;left:0;top:0;width:40px;height:10px";
        wrapper.appendChild(piece);
        bar.appendChild(wrapper);
        const pieceStyle = window.getComputedStyle(piece);
        const result = {
          maskImage: pieceStyle.maskImage,
          maskSize: pieceStyle.maskSize,
          hostInlineDepth: bar.style.getPropertyValue("--og-zigzag-depth"),
        };
        wrapper.remove();
        return result;
      }, `.og-bases-gantt .wx-bar[data-id$="Dateless One.md"]`);

      expect(probe.maskImage).toContain("conic-gradient");
      expect(probe.maskSize).toBe(
        `${ZIGZAG_TOOTH_SIZE}, ${ZIGZAG_TOOTH_SIZE}, ${ZIGZAG_MIDDLE_SIZE_BOTH}`,
      );
      // Nothing writes a per-bar depth any more; the min() above is the whole
      // narrow-bar story.
      expect(probe.hostInlineDepth).toBe("");
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

    it("cuts no teeth into any bar when showDateIndicators is off (AE5)", async () => {
      const bodies = await $$(".og-bases-gantt .wx-bar .og-bar-body");
      expect(bodies).toHaveLength(0);
      // Rows that WOULD be torn are on screen, so the empty count reports the
      // toggle rather than an empty chart.
      expect((await readZigzag("Due Only.md")).body).toBe(false);
      expect((await readZigzag("Start Only.md")).body).toBe(false);
    });
  });

  describe("strip treatment over a torn edge", () => {
    before(async () => {
      await openBase("DatesStrip.base");
    });

    it("offsets the strip accent clear of the leading teeth", async () => {
      // The strip accent is a host-level `::before`, so it sits OUTSIDE the
      // masked body layer and would otherwise paint straight over the teeth.
      // The offset arrives with the per-state class, which a post-mount
      // attachment stamps — reading before that lands sees the un-offset value.
      await waitForStamp("Due Only.md", "datestatus-zigzag-start");
      const readAccent = (selector: string) => {
        const bar = document.querySelector(selector);
        if (!bar) throw new Error(`bar not found: ${selector}`);
        const before = window.getComputedStyle(bar, "::before");
        const host = window.getComputedStyle(bar);
        return {
          left: before.left,
          backgroundColor: before.backgroundColor,
          hostBorderLeftWidth: host.borderLeftWidth,
          hostBorderRightWidth: host.borderRightWidth,
          torn: bar.querySelector(".og-bar-body") !== null,
        };
      };
      const accent = await browser.execute(
        readAccent,
        `.og-bases-gantt .wx-bar[data-id$="Due Only.md"]`,
      );
      const untorn = await browser.execute(
        readAccent,
        `.og-bases-gantt .wx-bar[data-id$="Complete.md"]`,
      );

      expect(accent.torn).toBe(true);
      // The accent is really painted (a stripless bar would report no colour),
      // and it starts at the tooth depth instead of the bar's edge.
      expect(accent.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
      expect(accent.left).toBe(ZIGZAG_DEPTH);
      // The split host paints no border on EITHER side — a border across the
      // torn side would redraw the straight edge the teeth removed. The untorn
      // bar beside it keeps its theme border, so the zeroes are the split
      // rule's own work rather than a theme without bar borders.
      expect(untorn.torn).toBe(false);
      expect(Number.parseFloat(untorn.hostBorderLeftWidth)).toBeGreaterThan(0);
      expect(accent.hostBorderLeftWidth).toBe("0px");
      expect(accent.hostBorderRightWidth).toBe("0px");
    });

    it("holds the strip accent inside a bar too narrow to seat it", async () => {
      // The accent is a fixed-width block offset by the fixed tooth depth, so
      // on a bar narrower than offset + accent it would run off the end of the
      // box SVAR laid out — a calc cap trims it to the room left past the
      // leading teeth. Narrowing the inline width directly is SVAR's own zoom
      // rewrite in miniature; pure CSS re-fits, no script runs.
      await waitForStamp("Due Only.md", "datestatus-zigzag-start");
      const narrow = await browser.execute((selector: string) => {
        const bar = document.querySelector(selector) as HTMLElement;
        if (!bar) throw new Error(`bar not found: ${selector}`);
        const px = (v: string): number => Number.parseFloat(v) || 0;
        const wideWidth = px(window.getComputedStyle(bar, "::before").width);
        const original = bar.style.width;
        bar.style.width = "8px";
        const accent = window.getComputedStyle(bar, "::before");
        const result = {
          wideWidth,
          depth: window.getComputedStyle(bar).getPropertyValue("--og-zigzag-depth").trim(),
          accentLeft: px(accent.left),
          accentWidth: px(accent.width),
          barWidth: bar.getBoundingClientRect().width,
        };
        bar.style.width = original;
        return result;
      }, `.og-bases-gantt .wx-bar[data-id$="Due Only.md"]`);

      // The depth is the fixed stylesheet value resolved from the chart root —
      // no bar republishes it.
      expect(narrow.depth).toBe(ZIGZAG_DEPTH);
      // The bar really is too narrow to seat the accent as authored…
      expect(narrow.accentLeft + narrow.wideWidth).toBeGreaterThan(narrow.barWidth);
      // …and it is narrow enough that the per-surface ceiling, not the depth,
      // decides the offset — the same `min()` the teeth are cut by, so the
      // accent starts exactly where this bar's shallower tooth ends rather
      // than at the full depth it has no room for.
      // (Tolerances are a twentieth of a pixel — device-pixel snapping moves
      // a used length by hundredths here, while dropping the ceiling would
      // move the offset by the better part of a pixel.)
      expect(narrow.accentLeft).toBeLessThan(Number.parseFloat(ZIGZAG_DEPTH));
      expect(narrow.accentLeft).toBeCloseTo(
        narrow.barWidth * (Number.parseFloat(ZIGZAG_SURFACE_CEILING) / 100),
        1,
      );
      // The cap then trims the accent to exactly the room left past it, so the
      // pair fills the bar and overflows nothing.
      expect(narrow.accentWidth).toBeCloseTo(narrow.barWidth - narrow.accentLeft, 1);
      expect(narrow.accentLeft + narrow.accentWidth).toBeLessThanOrEqual(narrow.barWidth + 0.01);
    });
  });

  describe("strip-ONLY treatment over a torn edge", () => {
    // The strip channel alone (`tngantt_barFillSource: none`) is the only
    // config where the bar's body colour and its PIECE colour differ: the
    // neutral strip surface is published as --og-host-body-fill while the
    // pieces are deliberately left on the default task colour. With both
    // channels lit (DatesStrip.base) the fill rule publishes the same colour
    // through both properties, so a body reading the wrong one still looks
    // right — this fixture is what makes the two distinguishable.
    before(async () => {
      await openBase("DatesStripOnly.base");
      await waitForStamp("Due Only.md", "datestatus-zigzag-start");
    });

    it("paints the torn body the neutral strip surface, not the piece colour", async () => {
      const paint = await browser.execute((selector: string, untornSelector: string) => {
        const bar = document.querySelector(selector) as HTMLElement;
        if (!bar) throw new Error(`bar not found: ${selector}`);
        const untorn = document.querySelector(untornSelector);
        if (!untorn) throw new Error(`bar not found: ${untornSelector}`);
        const widths = (style: CSSStyleDeclaration): string[] => [
          style.borderTopWidth,
          style.borderRightWidth,
          style.borderBottomWidth,
          style.borderLeftWidth,
        ];
        const body = bar.querySelector(".og-bar-body");
        if (!body) throw new Error("torn bar rendered no body layer");
        // Both custom properties compute to token streams, not rgb() colours,
        // so resolve each the way a painter would: on a scratch child of the
        // bar, which inherits whatever the bar publishes.
        const resolve = (value: string): string => {
          const scratch = document.createElement("div");
          scratch.style.backgroundColor = value;
          bar.appendChild(scratch);
          const color = window.getComputedStyle(scratch).backgroundColor;
          scratch.remove();
          return color;
        };
        const bodyStyle = window.getComputedStyle(body);
        const hostStyle = window.getComputedStyle(bar);
        return {
          bodyBackgroundColor: bodyStyle.backgroundColor,
          stripBodyFill: resolve("var(--og-host-body-fill)"),
          pieceFill: resolve("var(--og-effective-fill)"),
          bodyBorderWidths: widths(bodyStyle),
          // The outline an UNTORN strip bar wears on its host: the same 1px
          // declaration, so it snaps to device pixels identically and gives
          // the body's outline a reference to match instead of a raw "1px"
          // that only holds at one device-pixel ratio.
          untornHostBorderWidths: widths(window.getComputedStyle(untorn)),
          bodyBorderStyle: bodyStyle.borderTopStyle,
          bodyBorderColor: bodyStyle.borderTopColor,
          hostBorderTopWidth: hostStyle.borderTopWidth,
          hostBackgroundColor: hostStyle.backgroundColor,
        };
      },
      `.og-bases-gantt .wx-bar[data-id$="Due Only.md"]`,
      `.og-bases-gantt .wx-bar[data-id$="Complete.md"]`);

      // The two channels really are distinguishable here — otherwise the
      // equality below would hold no matter which property the body read.
      expect(paint.stripBodyFill).not.toBe("rgba(0, 0, 0, 0)");
      expect(paint.pieceFill).not.toBe(paint.stripBodyFill);
      // The split host paints nothing, so the body IS the bar's surface, and it
      // has to be the neutral strip one.
      expect(paint.hostBackgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(paint.bodyBackgroundColor).toBe(paint.stripBodyFill);
      // Strip mode's visibility guarantee is its outline, and the split host's
      // border is zeroed — so the outline has to live on the body, where it
      // takes the same cut as the surface it bounds.
      expect(paint.hostBorderTopWidth).toBe("0px");
      // The reference outline is really painted, so matching it is a claim
      // about a border rather than about two absent ones.
      expect(Number.parseFloat(paint.untornHostBorderWidths[0]!)).toBeGreaterThan(0);
      expect(paint.bodyBorderWidths).toEqual(paint.untornHostBorderWidths);
      expect(paint.bodyBorderStyle).toBe("solid");
      expect(paint.bodyBorderColor).not.toBe("rgba(0, 0, 0, 0)");
    });
  });
});
