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
 * Assertions follow the bar-treatments pattern: inspect the injected treatment
 * stylesheet text (`style[data-og-treatment]`) and the bar classes, rather than
 * brittle computed-style reads. The two P2e regressions (AE2/AE3) are pinned as
 * "does NOT contain" tripwires on the generated CSS.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-calendar-colour");

// TaskNotes default palette colours (src/settings/defaults.ts) and the vault's
// calendar colours — the exact literals the generated rules interpolate.
const CAL_NZ = "#2a9d8f"; // NZ Holidays calendar
const STATUS_OPEN = "#808080"; // status "open"
const PRIORITY_HIGH = "#ff0000"; // priority "high"
// The neutral strip-mode body (mixNeutral(16) in barTreatment.ts): a strip laid
// over a calm body emits this, a fill never does.
const NEUTRAL_BODY = "var(--text-normal) 16%";

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

describe("Gantt (OG) independent bar treatment channels", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-gantt-bar-channels-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({ vault: tmpVault, plugins: ["tasknotes-gantt", "tasknotes"] });
    await enableBases();
    await waitForTaskNotesReady();
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

    it("does NOT fill the body with the status colour (P2e bug 1 tripwire)", async () => {
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

    it("draws NO ::before strip anywhere (P2e bug 2 tripwire)", async () => {
      const css = await waitForTreatmentCss(`${CAL_NZ} !important`);
      expect(css).not.toContain("::before");
    });
  });

  describe("AE4 — legacy strip config migrates faithfully (barColorMode: strip)", () => {
    before(async () => {
      // The UNCHANGED legacy fixture: `barColorSource: calendar` + `barColorMode:
      // strip`, no new keys. Read-time migration must render it as strip-mode.
      await openBase("CalendarColourStrip.base");
    });

    it("renders neutral body + per-calendar ::before strip, not a calendar fill", async () => {
      const css = await waitForTreatmentCss(CAL_NZ);
      expect(css).toContain("::before");
      expect(css).toContain(CAL_NZ);
      expect(css).toContain(NEUTRAL_BODY);
      // Strip-mode never fills the body with the calendar colour — the migration
      // fidelity guarantee (identical to pre-change strip rendering).
      expect(css).not.toContain(`${CAL_NZ} !important`);
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
