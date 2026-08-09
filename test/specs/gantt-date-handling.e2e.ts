/* global Image, requestAnimationFrame */
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
 * renders as the bare `.datestatus-flagged` class on the bar (SVAR only
 * `wx-`-prefixes the built-in task/summary/milestone types). The per-state
 * `.datestatus-*` classes are NOT task types — the bar template stamps them
 * from per-instance data — but they land as bare classes on the same element.
 * The teeth themselves are read off `.og-bar-body`, the inner layer the bar
 * template renders to take the mask — the host must stay unmasked, because SVAR
 * hangs the dependency link handles and hover feedback off it.
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
 * Tooth period the view stylesheet publishes, and the full-size depth — half the
 * period. The bar template republishes the depth per bar, never letting one
 * tooth take more than this share of the bar's own width.
 */
const ZIGZAG_PERIOD = "8px";
const ZIGZAG_DEPTH = "4px";
const ZIGZAG_TOOTH_MAX_WIDTH_SHARE = 0.3;
const ZIGZAG_TOOTH_SIZE = `${ZIGZAG_DEPTH} ${ZIGZAG_PERIOD}`;

/** Computed mask facts for a bar: the inner body layer plus its host. */
interface ZigzagProbe {
  /** Whether the bar renders the inner mask carrier at all. */
  body: boolean;
  bodyMaskImage: string;
  bodyMaskSize: string;
  bodyMaskPosition: string;
  /** The body layer mirrors the host's fill instead of re-deriving it. */
  bodyBackgroundColor: string;
  hostBackgroundColor: string;
  /** How the host stops painting behind the teeth it just cut. */
  hostBackgroundClip: string;
  hostPaddingLeft: string;
  hostPaddingRight: string;
  /** A border across a torn side would re-draw the straight edge the cut removed. */
  hostBorderLeftWidth: string;
  hostBorderRightWidth: string;
  /** The host must never be masked — SVAR hangs link handles off it. */
  hostMaskImage: string;
  period: string;
}

/** Read the zigzag mask state of the bar whose `data-id` ends with `note`. */
async function readZigzag(note: string): Promise<ZigzagProbe> {
  return browser.execute((selector: string) => {
    const bar = document.querySelector(selector);
    if (!bar) throw new Error(`bar not found: ${selector}`);
    const host = window.getComputedStyle(bar);
    const body = bar.querySelector(".og-bar-body");
    const bodyStyle = body ? window.getComputedStyle(body) : null;
    return {
      body: body !== null,
      bodyMaskImage: bodyStyle?.maskImage ?? "",
      bodyMaskSize: bodyStyle?.maskSize ?? "",
      bodyMaskPosition: bodyStyle?.maskPosition ?? "",
      bodyBackgroundColor: bodyStyle?.backgroundColor ?? "",
      hostBackgroundColor: host.backgroundColor,
      hostBackgroundClip: host.backgroundClip,
      hostPaddingLeft: host.paddingLeft,
      hostPaddingRight: host.paddingRight,
      hostBorderLeftWidth: host.borderLeftWidth,
      hostBorderRightWidth: host.borderRightWidth,
      hostMaskImage: host.maskImage,
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
      // One layer: the teeth tile pinned to the leading edge, and nothing else —
      // the body paints only the strip the host's clip gave up, so a middle
      // layer would repaint the host's own middle a second time.
      const layers = maskLayerPositions(probe);
      expect(layers).toHaveLength(1);
      expect(layers[0]).toBe("0% 0%");
      expect(probe.bodyMaskSize.split(", ")[0]).toBe(ZIGZAG_TOOTH_SIZE);
      // Cutting the body only shows through if the host stops painting behind
      // the teeth: it clips its own background to a content box inset by the
      // tooth depth on the torn side, and by nothing on the intact side.
      expect(probe.hostBackgroundClip).toBe("content-box");
      expect(probe.hostPaddingLeft).toBe(ZIGZAG_DEPTH);
      expect(probe.hostPaddingRight).toBe("0px");
    });

    it("paints the cut body in the host's own fill rather than re-deriving it", async () => {
      // The body layer inherits its colour, so every fill source — here the
      // date-status fill — reaches it without the treatment code knowing.
      const probe = await readZigzag("Due Only.md");

      expect(probe.bodyBackgroundColor).toBe(probe.hostBackgroundColor);
      expect(probe.bodyBackgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    });

    it("cuts teeth on the trailing edge of a start-only bar (AE2)", async () => {
      const probe = await readZigzag("Start Only.md");

      expect(probe.body).toBe(true);
      expect(probe.bodyMaskImage).toContain("conic-gradient");
      const layers = maskLayerPositions(probe);
      expect(layers).toHaveLength(1);
      expect(layers[0]).toBe("100% 0%");
      expect(probe.bodyMaskSize.split(", ")[0]).toBe(ZIGZAG_TOOTH_SIZE);
      expect(probe.hostBackgroundClip).toBe("content-box");
      expect(probe.hostPaddingRight).toBe(ZIGZAG_DEPTH);
      expect(probe.hostPaddingLeft).toBe("0px");
    });

    it("cuts both edges of a one-cell dateless bar at the standard tooth size (AE3, AE7)", async () => {
      // Dateless One is a single-day placeholder, so this is also the one-cell
      // case: the teeth keep their absolute size instead of scaling with width.
      const probe = await readZigzag("Dateless One.md");

      expect(probe.body).toBe(true);
      const layers = maskLayerPositions(probe);
      expect(layers).toHaveLength(2);
      expect(layers[0]).toBe("0% 0%");
      expect(layers[1]).toBe("100% 0%");
      const sizes = probe.bodyMaskSize.split(", ");
      expect(sizes[0]).toBe(ZIGZAG_TOOTH_SIZE);
      expect(sizes[1]).toBe(ZIGZAG_TOOTH_SIZE);
      expect(probe.hostBackgroundClip).toBe("content-box");
      expect(probe.hostPaddingLeft).toBe(ZIGZAG_DEPTH);
      expect(probe.hostPaddingRight).toBe(ZIGZAG_DEPTH);
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
        return {
          labelWidth: (label as HTMLElement | null)?.offsetWidth ?? 0,
          fillWidth: (bar.querySelector(".wx-progress-percent") as HTMLElement | null)?.offsetWidth ?? 0,
          wrapperLeft: wrapperStyle?.left ?? "",
          wrapperZIndex: wrapperStyle?.zIndex ?? "",
          wrapperMaskImage: wrapperStyle?.maskImage ?? "",
          bodyZIndex: body ? window.getComputedStyle(body).zIndex : "",
        };
      }, `.og-bases-gantt .wx-bar[data-id$="Start Only.md"]`);

      expect(painted.labelWidth).toBeGreaterThan(0);
      expect(painted.fillWidth).toBeGreaterThan(0);
      expect(painted.wrapperLeft).toBe("0px");
      expect(painted.wrapperZIndex).toBe("1");
      expect(painted.bodyZIndex).toBe("0");
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

    it("drops the bar's border on the torn side and keeps it on the intact side", async () => {
      // Clipping the background to the content box stops the FILL behind the
      // teeth but not the border, so a bordered bar would still outline all four
      // sides and the sawtooth would sit behind a straight full-height line —
      // the silhouette stays rectangular and the cut says nothing.
      const dueOnly = await readZigzag("Due Only.md");
      const startOnly = await readZigzag("Start Only.md");
      const dateless = await readZigzag("Dateless One.md");

      // Device-pixel snapping makes the kept border's own width theme- and
      // DPI-dependent, so the assertion is gone vs present, not an exact px.
      expect(dueOnly.hostBorderLeftWidth).toBe("0px");
      expect(Number.parseFloat(dueOnly.hostBorderRightWidth)).toBeGreaterThan(0);
      expect(startOnly.hostBorderRightWidth).toBe("0px");
      expect(Number.parseFloat(startOnly.hostBorderLeftWidth)).toBeGreaterThan(0);
      expect(dateless.hostBorderLeftWidth).toBe("0px");
      expect(dateless.hostBorderRightWidth).toBe("0px");
    });

    it("keeps the mask weighted against SVAR's own scoped styles", async () => {
      // SVAR's styles are Svelte-hashed and out-specify a plain injected rule, so
      // an unweighted mask longhand can be switched off by a library or theme
      // rule and take the whole signal with it. A more specific competitor
      // without `!important` stands in for that here.
      const contested = await browser.executeObsidian(async (_obsidian, selector: string) => {
        const sheet = document.createElement("style");
        // Repeated classes are the portable way to out-specify the view's own
        // scoped rule without an id, standing in for a library or theme rule.
        sheet.textContent =
          ".og-bases-gantt.og-bases-gantt.og-bases-gantt .wx-bar.wx-bar.wx-bar.wx-bar " +
          ".og-bar-body.og-bar-body.og-bar-body { mask-image: none; -webkit-mask-image: none; }";
        document.head.appendChild(sheet);
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
        const body = document.querySelector(`${selector} .og-bar-body`);
        const survived = body ? window.getComputedStyle(body).maskImage : "";
        sheet.remove();
        return survived;
      }, `.og-bases-gantt .wx-bar[data-id$="Dateless One.md"]`);

      expect(contested).toContain("conic-gradient");
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

    it("cuts the teeth once when pieces render on a host that never went split", async () => {
      // Occupancy pieces render over an OPAQUE host whenever the envelope did
      // not replace the plain bar, and there the host's own body carries the
      // tear. A piece that cut a second sawtooth at its own edge would show two
      // tooth columns at different x. The piece cut belongs to split hosts only,
      // so the piece is stamped here and removed inside the same page turn.
      const masks = await browser.execute((selector: string) => {
        const bar = document.querySelector(selector);
        if (!bar) throw new Error(`bar not found: ${selector}`);
        const piece = document.createElement("div");
        piece.className = "og-instance og-piece-first og-piece-last";
        bar.appendChild(piece);
        const opaqueHost = window.getComputedStyle(piece).maskImage;
        bar.classList.add("wx-split");
        const splitHost = window.getComputedStyle(piece).maskImage;
        bar.classList.remove("wx-split");
        piece.remove();
        const body = bar.querySelector(".og-bar-body");
        return {
          opaqueHost,
          splitHost,
          bodyMaskImage: body ? window.getComputedStyle(body).maskImage : "",
        };
      }, `.og-bases-gantt .wx-bar[data-id$="Dateless One.md"]`);

      // The host's own body is cut, so the piece must not be.
      expect(masks.bodyMaskImage).toContain("conic-gradient");
      expect(masks.opaqueHost).toBe("none");
      // On a split host the host paints nothing, so the piece takes the cut.
      expect(masks.splitHost).toContain("conic-gradient");
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
      // is solid fill. The comparison catches both failure modes at once.
      const fill = toHex((await readZigzag("Due Only.md")).hostBackgroundColor);
      const edge = await sampleBarColumn("Due Only.md", 0.5);
      const inside = await sampleBarColumn("Due Only.md", 8);

      const countFill = (column: string[]): number =>
        column.filter((pixel) => pixel === fill).length;
      expect(edge.length).toBeGreaterThan(8);
      // The interior really is the bar (so the sample is aimed correctly)…
      expect(countFill(inside)).toBeGreaterThan(inside.length * 0.6);
      // …and the leading edge is mostly cut away.
      expect(countFill(edge)).toBeLessThan(countFill(inside) * 0.5);
    });

    it("paints a translucent fill at one strength across the whole bar", async () => {
      // The host and the inner body both paint the bar. If they overlapped, a
      // fill with alpha would composite TWICE where they do and the middle would
      // come out darker than the torn strip — invisible under an opaque fill
      // today, and a trap for every alpha palette colour. Each has to own its
      // own area: the host the content box, the body the strip the clip gave up.
      await browser.execute((selector: string) => {
        const bar = document.querySelector(selector) as HTMLElement;
        if (!bar) throw new Error(`bar not found: ${selector}`);
        // `!important` because the date-status fill rule carries it too.
        bar.style.setProperty("background-color", "rgba(0, 0, 255, 0.5)", "important");
      }, `.og-bases-gantt .wx-bar[data-id$="Due Only.md"]`);

      // Just inside the tooth depth the tooth is opaque for most of its period,
      // so the column's dominant colour is the fill as the BODY paints it; well
      // past it, the fill as the HOST paints it.
      const dominant = (column: string[]): string =>
        [...column].sort(
          (a, b) =>
            column.filter((p) => p === b).length - column.filter((p) => p === a).length,
        )[0]!;
      const strip = dominant(await sampleBarColumn("Due Only.md", 3.5));
      const middle = dominant(await sampleBarColumn("Due Only.md", 12));

      await browser.execute((selector: string) => {
        (document.querySelector(selector) as HTMLElement).style.removeProperty(
          "background-color",
        );
      }, `.og-bases-gantt .wx-bar[data-id$="Due Only.md"]`);

      // The translucent fill really reached the screen (a doubled composite is
      // only interesting if the row shows through at all)…
      expect(strip).not.toBe("#0000ff");
      // …and the two areas came out the same colour, so neither was painted twice.
      expect(middle).toBe(strip);
    });
  });

  describe("coarse zoom", () => {
    before(async () => {
      await openBase("DatesCoarse.base");
    });

    it("never renders a placeholder wider than the width SVAR laid out", async () => {
      // A dateless placeholder is a one-day bar, so at month zoom it is only a
      // few pixels wide — narrower than the padding that clears its two teeth.
      // Padding wider than the bar grows the rendered box (border-box floors the
      // CONTENT at zero, not the box), and SVAR keeps positioning dependency
      // arrows, link handles and drag maths from its own width, so the rendered
      // box must never exceed it: the tooth depth is fitted to the bar instead.
      const geometry = await browser.execute((selector: string) => {
        const bar = document.querySelector(selector) as HTMLElement;
        if (!bar) throw new Error(`bar not found: ${selector}`);
        const style = window.getComputedStyle(bar);
        return {
          rendered: bar.getBoundingClientRect().width,
          laidOut: Number.parseFloat(bar.style.width),
          boxSizing: style.boxSizing,
          padding:
            Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight),
        };
      }, `.og-bases-gantt .wx-bar[data-id$="Dateless One.md"]`);

      // The bar really is narrower than two full teeth, or the case is untested.
      expect(geometry.laidOut).toBeLessThan(8);
      expect(geometry.boxSizing).toBe("border-box");
      expect(geometry.rendered).toBeCloseTo(geometry.laidOut, 0);
      // And the middle survives: the two teeth together leave the bar something
      // solid to be, instead of collapsing it into a column of tooth tips.
      expect(geometry.padding).toBeCloseTo(
        geometry.laidOut * ZIGZAG_TOOTH_MAX_WIDTH_SHARE * 2,
        0,
      );
      expect(geometry.padding).toBeLessThan(geometry.laidOut);
    });

    it("shrinks the teeth to match, rather than dropping them", async () => {
      // Fitting the depth must scale the teeth down, not switch them off: the
      // computed tile resolves the fitted depth, so it says what is on screen.
      // (Pixels are not sampled here — a placeholder sits under the today
      // marker, and a three-pixel bar is mostly antialiasing.)
      const probe = await readZigzag("Dateless One.md");
      const laidOut = await browser.execute(
        (selector: string) =>
          Number.parseFloat((document.querySelector(selector) as HTMLElement).style.width),
        `.og-bases-gantt .wx-bar[data-id$="Dateless One.md"]`,
      );

      expect(probe.body).toBe(true);
      expect(probe.bodyMaskImage).toContain("conic-gradient");
      const [toothWidth, toothHeight] = probe.bodyMaskSize.split(", ")[0]!.split(" ");
      expect(Number.parseFloat(toothWidth!)).toBeCloseTo(
        laidOut * ZIGZAG_TOOTH_MAX_WIDTH_SHARE,
        1,
      );
      expect(toothHeight).toBe(ZIGZAG_PERIOD);
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
      const accent = await browser.execute((selector: string) => {
        const bar = document.querySelector(selector);
        if (!bar) throw new Error(`bar not found: ${selector}`);
        const before = window.getComputedStyle(bar, "::before");
        const host = window.getComputedStyle(bar);
        return {
          left: before.left,
          backgroundColor: before.backgroundColor,
          borderLeftWidth: host.borderLeftWidth,
          borderRightWidth: host.borderRightWidth,
          torn: bar.querySelector(".og-bar-body") !== null,
        };
      }, `.og-bases-gantt .wx-bar[data-id$="Due Only.md"]`);

      expect(accent.torn).toBe(true);
      // The accent is really painted (a stripless bar would report no colour),
      // and it starts at the tooth depth instead of the bar's edge.
      expect(accent.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
      expect(accent.left).toBe(ZIGZAG_DEPTH);
      // Strip mode outlines the bar body, and that outline would redraw the
      // straight leading edge the teeth just removed — so the torn side loses
      // it while the intact side keeps it.
      expect(accent.borderLeftWidth).toBe("0px");
      expect(Number.parseFloat(accent.borderRightWidth)).toBeGreaterThan(0);
    });
  });
});
