/* global DOMMatrixReadOnly, getComputedStyle */
import { browser, expect, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * U5 — independent bar treatment channels (fill / strip / icon) in real Obsidian.
 *
 * Sibling to `gantt-bar-treatments.e2e.ts`, which is deliberately a no-TaskNotes,
 * `gantt-readonly` harness (its own header defers status/priority colour E2E for
 * lack of a palette). Status and priority colours come ONLY from the TaskNotes
 * companion (`getStatusColors`/`getPriorityColors`), so this spec loads the
 * `tasknotes` plugin — its default palette (status `open` #808080, `in-progress`
 * #0066cc; priority `high` #ff0000) supplies the colours. Rows still come from the
 * Base filter (`sourceStrategy: 'bases-scoped'`); TaskNotes only enriches, so the
 * fixture tasks are plain Bases notes.
 *
 * It reuses the `gantt-calendar-colour` fixture vault (isolated per the same
 * discipline as `gantt-calendar-colour.e2e.ts` — colour fixtures never share a
 * vault so specs can't reshape each other's semantics) plus the calendar
 * fixtures already there. New `.base` views drive each decoupled combination and
 * a new `begin`/`finish`-dated task pair keeps the new fixtures out of the legacy
 * `note.start || note.due` colour bases.
 *
 * Treatment assertions follow the bar-treatments pattern by inspecting the
 * injected stylesheet and bar classes. The one-cell alignment regression reads
 * rendered geometry because the live SVAR/Svelte cascade is the behavior under
 * test. The strip/fill coupling regressions remain pinned as "does NOT contain"
 * tripwires on the generated CSS.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-calendar-colour");

// TaskNotes default palette colours (src/settings/defaults.ts) and the vault's
// calendar colours — the exact literals the generated rules interpolate.
const CAL_NZ = "#2a9d8f"; // NZ Holidays calendar
const STATUS_OPEN = "#808080"; // status "open"
const PRIORITY_HIGH = "#ff0000"; // priority "high"
// Both alignment fixtures pin the day scale, whose configured opening width is
// authoritative even when SVAR omits off-screen scale-header cells.
const DAY_SCALE_CELL_WIDTH_PX = 30;
const BAR_CONTENT_GAP_PX = 6;
const BAR_ICON_CHIP_WIDTH_PX = 20;
// The neutral strip-mode body (mixNeutral(16) in barTreatment.ts): a strip laid
// over a calm body emits this, a fill never does.
const NEUTRAL_BODY = "var(--text-normal) 16%";

interface BarIconLayout {
  barWidth: number;
  chipTranslationX: number;
  contentPaddingLeft: number;
  contentGap: number;
  chipWidth: number;
  textInset: number;
}

interface BarIconLayoutProbe {
  layout: BarIconLayout | null;
  missing: string[];
}

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

/** Wait until the TaskNotes API is ready, so its status/priority palette is live. */
async function waitForTaskNotesReady(): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.executeObsidian(async ({ app }) => {
        const tn = (app as unknown as { plugins?: { getPlugin?: (id: string) => unknown } }).plugins?.getPlugin?.(
          "tasknotes",
        ) as { api?: { lifecycle?: { ready?: () => Promise<void> } } } | undefined;
        if (!tn?.api) return false;
        try {
          await tn.api.lifecycle?.ready?.();
          return true;
        } catch {
          return false;
        }
      }),
    { timeout: 60000, timeoutMsg: "TaskNotes API did not become ready" },
  );
}

async function waitForMetadataCacheReady(): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.executeObsidian(({ app }) => {
        const files = app.vault.getMarkdownFiles();
        return files.length > 0 && files.every((file) => app.metadataCache.getFileCache(file) !== null);
      }),
    { timeout: 60000, timeoutMsg: "metadataCache cold scan did not finish" },
  );
}

/**
 * Open a `.base` file and wait for bars. TaskNotes opens a starter markdown note
 * that steals the active leaf, so drop stray markdown leaves and any prior base
 * leaf first — the view under test stays the sole `.og-bases-gantt` (so a
 * document-wide stylesheet read can't catch a previously-opened view's `<style>`).
 */
async function openBase(basePath: string): Promise<void> {
  await browser.executeObsidian(async ({ app }, p) => {
    const ws = app.workspace as unknown as {
      detachLeavesOfType: (t: string) => void;
      iterateAllLeaves: (cb: (l: { view?: { getViewType?: () => string }; detach?: () => void }) => void) => void;
      getLeaf: (n?: boolean) => { openFile: (f: unknown) => Promise<void> };
    };
    const markdownLeaves: Array<{ detach?: () => void }> = [];
    ws.iterateAllLeaves((l) => {
      if (l.view?.getViewType?.() === "markdown") markdownLeaves.push(l);
    });
    markdownLeaves.forEach((l) => l.detach?.());
    ws.detachLeavesOfType("bases");
    const file = app.vault.getAbstractFileByPath(p);
    if (file) {
      await ws.getLeaf(true).openFile(file as never);
    }
  }, basePath);

  await browser.waitUntil(
    async () => (await $$(".og-bases-gantt .wx-bar")).length > 0,
    { timeout: 60000, timeoutMsg: `Gantt did not render bars for ${basePath}` },
  );
}

/** The active view's injected treatment stylesheet text (single `.og-bases-gantt`). */
async function treatmentCss(): Promise<string> {
  return browser.execute(() => {
    const style = document.querySelector(".og-bases-gantt style[data-og-treatment]");
    return style?.textContent ?? "";
  });
}

/**
 * Read the treatment stylesheet, waiting until it contains `mustContain`. The
 * status/priority palette warms AFTER first mount (a TaskNotes-driven refresh
 * re-injects the sheet), so gate the read on the palette-dependent token instead
 * of reading once — same readiness-gate pattern as the bar-treatments spec.
 */
async function waitForTreatmentCss(mustContain: string): Promise<string> {
  let css = "";
  await browser.waitUntil(
    async () => {
      css = await treatmentCss();
      return css.includes(mustContain);
    },
    { timeout: 30000, timeoutMsg: `treatment CSS never contained "${mustContain}"` },
  );
  return css;
}

/** Number of rendered bars matching a class selector, once at least one appears. */
async function waitForBars(selector: string): Promise<number> {
  await browser.waitUntil(async () => (await $$(selector)).length > 0, {
    timeout: 30000,
    timeoutMsg: `no bar matched "${selector}"`,
  });
  return (await $$(selector)).length;
}

async function readBarIconLayout(): Promise<BarIconLayoutProbe> {
  return browser.execute(() => {
    const chip = document.querySelector<HTMLElement>(
      ".og-bases-gantt .og-chart-surface .wx-bar .og-bar-chip",
    );
    const surface = chip?.closest<HTMLElement>(".og-chart-surface");
    const root = chip?.closest<HTMLElement>(".og-bases-gantt");
    const bar = chip?.closest<HTMLElement>(".wx-bar");
    const content = chip?.closest<HTMLElement>(".wx-content");
    const text = content?.querySelector<HTMLElement>(".og-bar-text");
    const missing = [
      !chip && "chart chip",
      !surface && "owning chart surface",
      !root && "owning Gantt root",
      !bar && "owning bar",
      !content && "owning content",
      !text && "bar text",
    ].filter((part): part is string => Boolean(part));
    if (missing.length > 0 || !bar || !content || !chip || !text) {
      return { layout: null, missing };
    }

    const contentStyle = getComputedStyle(content);
    const chipTransform = getComputedStyle(chip).transform;
    const transformMatrix = new DOMMatrixReadOnly(chipTransform === "none" ? undefined : chipTransform);
    const contentBounds = content.getBoundingClientRect();
    const textBounds = text.getBoundingClientRect();

    return {
      layout: {
        barWidth: bar.getBoundingClientRect().width,
        chipTranslationX: transformMatrix.m41,
        contentPaddingLeft: Number.parseFloat(contentStyle.paddingLeft),
        contentGap: Number.parseFloat(contentStyle.gap),
        chipWidth: chip.getBoundingClientRect().width,
        textInset: textBounds.left - contentBounds.left,
      },
      missing: [],
    };
  });
}

async function waitForBarIconLayout(): Promise<BarIconLayout> {
  let probe: BarIconLayoutProbe = { layout: null, missing: ["geometry probe"] };
  try {
    await browser.waitUntil(
      async () => {
        probe = await readBarIconLayout();
        return probe.layout !== null;
      },
      { timeout: 15000, timeoutMsg: "bar icon geometry did not settle" },
    );
  } catch (error) {
    throw new Error(`bar icon geometry did not settle; missing: ${probe.missing.join(", ")}`, {
      cause: error,
    });
  }
  if (!probe.layout) throw new Error("bar icon layout was unavailable");
  return probe.layout;
}

describe("Gantt (OG) independent bar treatment channels", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-gantt-bar-channels-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({ vault: tmpVault, plugins: ["tasknotes-gantt", "tasknotes"] });
    await enableBases();
    await waitForTaskNotesReady();
    await waitForMetadataCacheReady();
  });

  describe("AE1 — three channels at once (fill=calendar, strip=priority, icon=status)", () => {
    before(async () => {
      await openBase("ChannelsTriple.base");
    });

    it("carries a calendar class and a priority class on the same bar", async () => {
      expect(await waitForBars('.og-bases-gantt .wx-bar[class*="og-calendar-"]')).toBeGreaterThan(0);
      expect(await waitForBars('.og-bases-gantt .wx-bar[class*="og-prio-"]')).toBeGreaterThan(0);
    });

    it("injects a calendar background-color fill rule AND a priority ::before strip rule", async () => {
      const css = await waitForTreatmentCss(PRIORITY_HIGH); // priority strip is the palette-dependent token
      // Fill channel = calendar body (a `!important` background fill).
      expect(css).toContain(`${CAL_NZ} !important`);
      expect(css).toContain("background-color");
      // Strip channel = priority `::before` accent.
      expect(css).toContain("::before");
      expect(css).toContain(PRIORITY_HIGH);
    });

    it("renders a status icon chip", async () => {
      expect(await waitForBars(".og-bases-gantt .og-bar-chip")).toBeGreaterThan(0);
    });

    it("moves the status chip left with the adjusted one-cell content inset", async () => {
      const layout = await waitForBarIconLayout();

      expect(layout.barWidth).toBeCloseTo(DAY_SCALE_CELL_WIDTH_PX, 0);
      expect(layout.chipTranslationX).toBe(0);
      expect(layout.contentPaddingLeft).toBe(7);
      expect(layout.contentGap).toBe(BAR_CONTENT_GAP_PX);
      expect(layout.chipWidth).toBe(BAR_ICON_CHIP_WIDTH_PX);
      expect(layout.textInset).toBeCloseTo(
        layout.contentPaddingLeft + layout.chipWidth + layout.contentGap,
        0,
      );
    });
  });

  describe("one-cell priority icon alignment", () => {
    before(async () => {
      await openBase("ChannelsPriorityIcon.base");
    });

    it("moves the priority chip left with the adjusted strip-mode inset", async () => {
      await waitForTreatmentCss(STATUS_OPEN);
      const layout = await waitForBarIconLayout();

      expect(layout.barWidth).toBeCloseTo(DAY_SCALE_CELL_WIDTH_PX, 0);
      expect(layout.chipTranslationX).toBe(0);
      expect(layout.contentPaddingLeft).toBe(9);
      expect(layout.contentGap).toBe(BAR_CONTENT_GAP_PX);
      expect(layout.chipWidth).toBe(BAR_ICON_CHIP_WIDTH_PX);
      expect(layout.textInset).toBeCloseTo(
        layout.contentPaddingLeft + layout.chipWidth + layout.contentGap,
        0,
      );
    });
  });

  describe("AE2 — strip only paints the strip (fill=none, strip=status)", () => {
    before(async () => {
      await openBase("StripStatus.base");
    });

    it("emits a per-status ::before strip rule over the neutral body", async () => {
      const css = await waitForTreatmentCss(STATUS_OPEN);
      expect(await waitForBars('.og-bases-gantt .wx-bar[class*="og-status-"]')).toBeGreaterThan(0);
      expect(css).toContain("og-status-");
      expect(css).toContain("::before");
      expect(css).toContain(STATUS_OPEN);
      // The calm neutral body (strip shown + fill none), not a status-coloured body.
      expect(css).toContain(NEUTRAL_BODY);
    });

    it("does NOT fill the body with the status colour (regression: strip must not fill the body)", async () => {
      const css = await waitForTreatmentCss(STATUS_OPEN);
      // A body fill would carry `<color> !important` and a `--og-ghost-fill`; the
      // strip rule carries neither. Their absence proves the body stays neutral.
      expect(css).not.toContain(`${STATUS_OPEN} !important`);
      expect(css).not.toContain("--og-ghost-fill");
    });
  });

  describe("AE3 — fill draws no phantom strip (fill=calendar, strip=none)", () => {
    before(async () => {
      await openBase("FillCalendar.base");
    });

    it("emits a per-calendar background-color fill rule", async () => {
      const css = await waitForTreatmentCss(`${CAL_NZ} !important`);
      expect(await waitForBars('.og-bases-gantt .wx-bar[class*="og-calendar-"]')).toBeGreaterThan(0);
      expect(css).toContain("og-calendar-");
      expect(css).toContain(`${CAL_NZ} !important`);
    });

    it("draws NO ::before strip anywhere (regression: fill must not draw a strip)", async () => {
      const css = await waitForTreatmentCss(`${CAL_NZ} !important`);
      expect(css).not.toContain("::before");
    });

    it("uses the adjusted content inset without an icon", async () => {
      expect(await $$(".og-bases-gantt .og-chart-surface .wx-bar .og-bar-chip")).toHaveLength(0);
      const paddingLeft = await browser.execute(() => {
        const content = document.querySelector<HTMLElement>(
          ".og-bases-gantt .og-chart-surface .wx-bar .wx-content",
        );
        return content ? Number.parseFloat(getComputedStyle(content).paddingLeft) : null;
      });
      expect(paddingLeft).toBe(7);
    });
  });

  describe("AE7 — non-calendar status fill renders unchanged (fill=status, strip=none)", () => {
    before(async () => {
      await openBase("FillStatus.base");
    });

    it("emits a per-status body fill rule and no strip", async () => {
      const css = await waitForTreatmentCss(`${STATUS_OPEN} !important`);
      expect(await waitForBars('.og-bases-gantt .wx-bar[class*="og-status-"]')).toBeGreaterThan(0);
      expect(css).toContain("og-status-");
      expect(css).toContain(`${STATUS_OPEN} !important`);
      expect(css).toContain("--og-ghost-fill");
      expect(css).not.toContain("::before");
    });
  });
});
