import { browser, expect } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Ephemeral column-sort spec (plan 2026-06-22-002, U7).
 *
 * Boots Obsidian against the `test/vaults/gantt-companion` fixture with both
 * tasknotes-gantt and TaskNotes enabled (same harness as the expansion spec),
 * and exercises the ephemeral column-sort lifecycle that unit tests can't prove
 * end-to-end — the SVAR header-click interceptor, the asc→desc→clear cycle, the
 * floating reset pill, the `_sort` reset, and diff-sync coexistence:
 *
 *  - AE1 / custom-sort-fn guard: clicking the `note.due` PROPERTY column header
 *    re-sorts matched + fetched rows (a property column whose value lives in
 *    `custom.properties` — proves the per-column comparator runs, not a silent
 *    no-op). Top-level Project A (due 2026-03-20) and B (2026-03-25) flip to B,A
 *    on descending; nesting is preserved (all six instances still render).
 *  - AE2: three clicks cycle asc → desc → cleared; the reset pill is visible for
 *    asc/desc and hidden on the third click; the lit header sort arrow is gone
 *    after the clear (guards the `_sort` reset), and the Base order is restored.
 *  - R5: the floating reset pill clears an active sort back to the Base order.
 *  - AE6 / R8: with a sort active, an external data refresh (`onDataUpdated`)
 *    keeps the sort (rows don't snap back to Base) and the host stays ≥ min
 *    height (no clip).
 *
 * SELECTOR NOTES (verified against @svar-ui/svelte-gantt 2.7.0):
 *  - grid header cells carry `data-header-id` = the SVAR column id; for a property
 *    column that id is the Bases property id (`note.due`). Clicking it fires
 *    `sort-tasks`.
 *  - the lit sort indicator is `.wx-sort` inside the sorted header.
 *  - the reset pill is our own `.zoom-btn.reset-sort` (rendered only while a sort
 *    is active).
 *  - chart bars: `.wx-bar` with a `data-id` of the instance id (SVAR prefixes
 *    string ids with `:`; root id == source path). Match a source by the STRIPPED
 *    id's `startsWith(path)` (a nested id chains its parents).
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-companion");

/** The five source notes; their expected displayed-instance counts under Show-all. */
const EXPECTED_INSTANCES: Record<string, number> = {
  "Project A.md": 1,
  "Project B.md": 1,
  "Sub A1.md": 1,
  "Sub A1a.md": 1,
  "Shared.md": 2,
};

/** Force the OG Gantt to be the ACTIVE, visible leaf (self-healing vs starter-note steal). */
async function activateBaseLeaf(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    const ws = app.workspace as unknown as {
      iterateAllLeaves: (cb: (l: { view?: { getViewType?: () => string }; detach?: () => void }) => void) => void;
      getLeavesOfType: (t: string) => unknown[];
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
      const file = app.vault.getAbstractFileByPath("Companion.base");
      if (!file) return;
      const leaf = ws.getLeaf(true);
      await leaf.openFile(file as never);
      baseLeaf = leaf;
    }
    ws.setActiveLeaf(baseLeaf, { focus: true });
    ws.revealLeaf(baseLeaf);
  });
}

interface SortState {
  mounted: boolean;
  /** Stripped (no leading `:`) instance ids of every rendered bar, in DOM order. */
  ids: string[];
  /** Whether the floating reset pill (active-sort affordance) is in the DOM. */
  resetPill: boolean;
  /** Whether any grid header is actively sorted (aria-sort asc/desc — SVAR's lit cue). */
  sorted: boolean;
  /** Host (chart region) height in px, for the min-height regression guard. */
  hostHeight: number;
}

async function readSortState(): Promise<SortState> {
  return browser.execute(() => {
    const root = document.querySelector(".og-bases-gantt");
    if (!root) return { mounted: false, ids: [], resetPill: false, sorted: false, hostHeight: 0 };
    const strip = (id: string): string => (id.startsWith(":") ? id.slice(1) : id);
    const ids = Array.from(root.querySelectorAll(".wx-bar")).map((b) => strip(b.getAttribute("data-id") ?? ""));
    const resetPill = !!root.querySelector(".zoom-btn.reset-sort");
    // SVAR's HeaderCell sets aria-sort="ascending"/"descending" only when actively
    // sorted, else "none" — the reliable lit-sort signal (the `.wx-sort` container
    // is always present; only its arrow `<i>` is conditional). Guards the _sort reset.
    const sorted = !!root.querySelector('[aria-sort="ascending"], [aria-sort="descending"]');
    const chart = root.querySelector(".og-chart-area") as HTMLElement | null;
    const hostHeight = chart ? chart.getBoundingClientRect().height : 0;
    return { mounted: true, ids, resetPill, sorted, hostHeight };
  });
}

/**
 * Click a grid column header by its SVAR column id (= Bases property id). The
 * header cell carries `data-header-id = setID(column.id)`, which prefixes string
 * ids with `:` (same as bar `data-id`), so match by the STRIPPED value. The cell
 * div owns the sort onclick; click it directly (not the `.wx-grip` resize handle,
 * which stops propagation). Returns true if the header was found + clicked.
 */
async function clickColumnHeader(columnId: string): Promise<boolean> {
  return browser.execute((id: string) => {
    const root = document.querySelector(".og-bases-gantt");
    if (!root) return false;
    const strip = (v: string): string => (v.startsWith(":") ? v.slice(1) : v);
    const header = Array.from(root.querySelectorAll<HTMLElement>("[data-header-id]")).find(
      (el) => strip(el.getAttribute("data-header-id") ?? "") === id,
    );
    if (!header) return false;
    header.click();
    return true;
  }, columnId);
}

function idx(ids: string[], sourcePath: string): number {
  return ids.findIndex((id) => id.startsWith(sourcePath));
}
function instancesOf(ids: string[], sourcePath: string): number {
  return ids.filter((id) => id.startsWith(sourcePath)).length;
}
function missingNames(ids: string[]): string[] {
  return Object.entries(EXPECTED_INSTANCES)
    .filter(([name, n]) => instancesOf(ids, name) !== n)
    .map(([name, n]) => `${name} (want ${n}, saw ${instancesOf(ids, name)})`);
}

/** Wait until the Gantt is active AND fully expanded (all six instances). */
async function ensureGanttReady(): Promise<void> {
  let last = "<never polled>";
  try {
    await browser.waitUntil(
      async () => {
        await activateBaseLeaf();
        const state = await readSortState();
        last = JSON.stringify(state.ids);
        return state.mounted && missingNames(state.ids).length === 0;
      },
      { timeout: 90000, timeoutMsg: "Companion Gantt did not reach all six expected instances" },
    );
  } catch {
    throw new Error(`Companion Gantt not ready. Last observed: ${last}`);
  }
}

/** Restore the Base order between tests: if a sort is active, clear it via the reset pill. */
async function resetSortIfActive(): Promise<void> {
  const state = await readSortState();
  if (!state.resetPill) return;
  await browser.execute(() => {
    (document.querySelector(".og-bases-gantt .zoom-btn.reset-sort") as HTMLElement | null)?.click();
  });
  await browser.waitUntil(async () => !(await readSortState()).resetPill, {
    timeout: 10000,
    timeoutMsg: "Reset pill did not clear between tests",
  });
}

describe("Gantt (OG) ephemeral column sort", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-gantt-column-sort-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({ vault: tmpVault, plugins: ["tasknotes-gantt", "tasknotes"] });

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

    await browser.waitUntil(
      async () =>
        browser.executeObsidian(async ({ app }) => {
          const tn = (app as unknown as { plugins?: { getPlugin?: (id: string) => unknown } }).plugins?.getPlugin?.("tasknotes") as
            | { api?: { lifecycle?: { ready?: () => Promise<void> } } }
            | undefined;
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

    await browser.waitUntil(
      async () =>
        browser.executeObsidian(async ({ app }) => {
          const tn = (app as unknown as { plugins?: { getPlugin?: (id: string) => unknown } }).plugins?.getPlugin?.("tasknotes") as
            | { api?: { relationships?: { subtasks?: (p: string) => Promise<Array<{ path?: string }>> | Array<{ path?: string }> } } }
            | undefined;
          const subtasks = tn?.api?.relationships?.subtasks;
          if (!subtasks) return false;
          try {
            const a = await subtasks("Project A.md");
            const sub = await subtasks("Sub A1.md");
            return Array.isArray(a) && a.length >= 2 && Array.isArray(sub) && sub.length >= 1;
          } catch {
            return false;
          }
        }),
      { timeout: 60000, timeoutMsg: "TaskNotes subtask relationships did not resolve" },
    );

    await ensureGanttReady();
  });

  beforeEach(async () => {
    await ensureGanttReady();
    await resetSortIfActive();
  });

  it("sorts matched + fetched rows when a property column header is clicked (AE1, custom-sort-fn guard)", async () => {
    // Base order (file.name) is Project A before Project B. Two clicks on the
    // `note.due` property column → descending → B (2026-03-25) before A
    // (2026-03-20). A reorder here can ONLY happen if the property-column
    // comparator runs (the value lives in custom.properties, not task.note.due).
    const found1 = await clickColumnHeader("note.due");
    expect(found1).toBe(true);
    await clickColumnHeader("note.due"); // second click → descending

    let state: SortState | null = null;
    await browser.waitUntil(
      async () => {
        state = await readSortState();
        return state.mounted && idx(state.ids, "Project B.md") >= 0 &&
          idx(state.ids, "Project B.md") < idx(state.ids, "Project A.md");
      },
      {
        timeout: 15000,
        timeoutMsg: () =>
          `Expected B before A on due-desc; saw A@${state ? idx(state.ids, "Project A.md") : "?"} B@${state ? idx(state.ids, "Project B.md") : "?"}`,
      },
    );
    // Nesting preserved: all six instances still render after the sort.
    expect(missingNames(state!.ids)).toEqual([]);
  });

  it("cycles asc → desc → cleared, toggling the reset pill and the sort arrow (AE2)", async () => {
    // No sort active initially (beforeEach reset): no reset pill.
    expect((await readSortState()).resetPill).toBe(false);

    // First click → ascending: reset pill appears, header reads as sorted.
    await clickColumnHeader("note.due");
    await browser.waitUntil(async () => (await readSortState()).resetPill, {
      timeout: 10000,
      timeoutMsg: "Reset pill did not appear on the first sort click",
    });
    expect((await readSortState()).sorted).toBe(true);

    // Second click → descending: pill still present.
    await clickColumnHeader("note.due");
    await browser.waitUntil(async () => (await readSortState()).resetPill, {
      timeout: 10000,
      timeoutMsg: "Reset pill should remain for the descending state",
    });

    // Third click → cleared: pill hidden, sort cue gone, Base order restored (A before B).
    await clickColumnHeader("note.due");
    let state: SortState | null = null;
    await browser.waitUntil(
      async () => {
        state = await readSortState();
        return !state.resetPill && !state.sorted &&
          idx(state.ids, "Project A.md") < idx(state.ids, "Project B.md");
      },
      {
        timeout: 15000,
        timeoutMsg: () =>
          `Third click should clear to Base order; saw resetPill=${state?.resetPill} sorted=${state?.sorted} A@${state ? idx(state.ids, "Project A.md") : "?"} B@${state ? idx(state.ids, "Project B.md") : "?"}`,
      },
    );
    expect(state!.resetPill).toBe(false);
  });

  it("clears an active sort back to the Base order via the reset pill (R5)", async () => {
    // Sort descending (B before A), then click the reset pill → Base order (A before B).
    await clickColumnHeader("note.due");
    await clickColumnHeader("note.due");
    await browser.waitUntil(
      async () => {
        const s = await readSortState();
        return s.resetPill && idx(s.ids, "Project B.md") < idx(s.ids, "Project A.md");
      },
      { timeout: 15000, timeoutMsg: "Did not reach the descending sorted state before reset" },
    );

    await browser.execute(() => {
      (document.querySelector(".og-bases-gantt .zoom-btn.reset-sort") as HTMLElement | null)?.click();
    });

    let state: SortState | null = null;
    await browser.waitUntil(
      async () => {
        state = await readSortState();
        return !state.resetPill && idx(state.ids, "Project A.md") < idx(state.ids, "Project B.md");
      },
      {
        timeout: 15000,
        timeoutMsg: () =>
          `Reset pill should restore Base order; saw resetPill=${state?.resetPill} A@${state ? idx(state.ids, "Project A.md") : "?"} B@${state ? idx(state.ids, "Project B.md") : "?"}`,
      },
    );
    expect(state!.resetPill).toBe(false);
  });

  it("keeps an active sort across a data refresh and stays above min height (AE6/R8)", async () => {
    // Sort descending (B before A).
    await clickColumnHeader("note.due");
    await clickColumnHeader("note.due");
    await browser.waitUntil(
      async () => {
        const s = await readSortState();
        return s.resetPill && idx(s.ids, "Project B.md") < idx(s.ids, "Project A.md");
      },
      { timeout: 15000, timeoutMsg: "Did not reach the descending sorted state before refresh" },
    );

    // Trigger an in-place data refresh through the registered Bases view's
    // onDataUpdated (the same path Obsidian calls on a metadata change). The Base
    // toolbar sort is unchanged, so R8 must keep the ephemeral sort.
    await browser.executeObsidian(async ({ app }) => {
      const ws = app.workspace as unknown as {
        getLeavesOfType: (t: string) => Array<{ view?: { onDataUpdated?: () => void } }>;
      };
      for (const leaf of ws.getLeavesOfType("bases")) leaf.view?.onDataUpdated?.();
    });

    // The sort must hold (B still before A) and the host must not clip.
    let state: SortState | null = null;
    await browser.waitUntil(
      async () => {
        state = await readSortState();
        return state.mounted && state.resetPill &&
          idx(state.ids, "Project B.md") < idx(state.ids, "Project A.md");
      },
      {
        timeout: 15000,
        timeoutMsg: () =>
          `Sort should survive a refresh; saw resetPill=${state?.resetPill} A@${state ? idx(state.ids, "Project A.md") : "?"} B@${state ? idx(state.ids, "Project B.md") : "?"}`,
      },
    );
    expect(state!.hostHeight).toBeGreaterThanOrEqual(112);
  });
});
