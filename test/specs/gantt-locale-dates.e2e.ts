import { browser, expect } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Locale-aware grid date rendering spec.
 *
 * Boots Obsidian against the `test/vaults/gantt-locale` fixture with the
 * locale override forced to `de-DE` BEFORE the view assembles data, and proves
 * the runtime layer unit tests can't: the snapshot taken in `buildGanttData`
 * reaches the SVAR-mounted property cell, so the `due` column renders the
 * regional day-first form instead of the stored `YYYY-MM-DD`.
 *
 * SELECTOR NOTES:
 *  - property cells are `.og-grid-cell` (text mode).
 *  - grid header cells carry `data-header-id` = the SVAR column id (Bases prop
 *    id, prefixed with `:` for string ids — match the stripped value).
 *  - the locale override hook is `window.__tnGanttDebug.localeOverride`,
 *    consumed once per data-assembly pass.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-locale");

const DUE_COLUMN_ID = "note.due";
/** de-DE numeric form of the fixture's due date 2026-03-20 (leading zero optional). */
const DE_DUE_PATTERN = /20\.0?3\.2026/;
const ISO_DUE = "2026-03-20";

interface GridState {
  mounted: boolean;
  dueHeader: boolean;
  cellTexts: string[];
}

/** Force the OG Gantt to be the active, visible leaf and (re)open the Base. */
async function activateBaseLeaf(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    const ws = app.workspace as unknown as {
      iterateAllLeaves: (cb: (l: { view?: { getViewType?: () => string }; detach?: () => void }) => void) => void;
      getLeavesOfType: (t: string) => Array<{ detach?: () => void }>;
      getLeaf: (newLeaf?: boolean) => { openFile: (f: unknown) => Promise<void> };
      setActiveLeaf: (l: unknown, opts?: { focus?: boolean }) => void;
      revealLeaf: (l: unknown) => void;
    };
    const markdownLeaves: Array<{ detach?: () => void }> = [];
    ws.iterateAllLeaves((l) => {
      if (l.view?.getViewType?.() === "markdown") markdownLeaves.push(l);
    });
    markdownLeaves.forEach((l) => l.detach?.());

    let baseLeaf = ws.getLeavesOfType("bases")[0];
    if (!baseLeaf) {
      const file = app.vault.getAbstractFileByPath("Locale.base");
      if (!file) return;
      const leaf = ws.getLeaf(true);
      await leaf.openFile(file as never);
      baseLeaf = leaf as unknown as { detach?: () => void };
    }
    ws.setActiveLeaf(baseLeaf, { focus: true });
    ws.revealLeaf(baseLeaf);
  });
}

async function readGridState(): Promise<GridState> {
  return browser.execute(() => {
    const root = document.querySelector(".og-bases-gantt");
    if (!root) return { mounted: false, dueHeader: false, cellTexts: [] };
    const strip = (v: string): string => (v.startsWith(":") ? v.slice(1) : v);
    const dueHeader = Array.from(root.querySelectorAll<HTMLElement>("[data-header-id]")).some(
      (el) => strip(el.getAttribute("data-header-id") ?? "") === "note.due",
    );
    const cellTexts = Array.from(root.querySelectorAll<HTMLElement>(".og-grid-cell")).map(
      (c) => c.textContent ?? "",
    );
    return { mounted: true, dueHeader, cellTexts };
  });
}

async function forceLocaleOverride(): Promise<void> {
  await browser.execute(() => {
    (window as unknown as { __tnGanttDebug?: unknown }).__tnGanttDebug = { localeOverride: "de-DE" };
  });
}

/** Wait until the grid is mounted, the due column exists, and a date rendered. */
async function ensureLocaleGridReady(): Promise<void> {
  let last = "<never polled>";
  try {
    await browser.waitUntil(
      async () => {
        await forceLocaleOverride();
        await activateBaseLeaf();
        const state = await readGridState();
        last = JSON.stringify(state);
        return state.mounted && state.dueHeader && state.cellTexts.some((t) => t.trim().length > 0);
      },
      { timeout: 90000, timeoutMsg: `Locale grid not ready (column "${DUE_COLUMN_ID}" + rendered cells)` },
    );
  } catch {
    throw new Error(`Locale grid not ready. Last observed: ${last}`);
  }
}

describe("Gantt (OG) locale-aware grid dates", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-gantt-locale-dates-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({ vault: tmpVault, plugins: ["tasknotes-gantt"] });

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

    await ensureLocaleGridReady();
  });

  it("renders the due column in the forced de-DE regional format (AE1)", async () => {
    const state = await readGridState();
    const dueCells = state.cellTexts.filter((t) => DE_DUE_PATTERN.test(t));
    expect(dueCells.length).toBeGreaterThan(0);
  });

  it("shows no ISO-formatted date cell while the locale override is active", async () => {
    const state = await readGridState();
    const isoCells = state.cellTexts.filter((t) => t.includes(ISO_DUE));
    expect(isoCells.length).toBe(0);
  });
});
