import { browser, expect } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Divergent status mapping — the field is READ-ONLY.
 *
 * `Divergent.base` maps the status field to `note.assignee`, which is NOT the property
 * TaskNotes persists status to. TaskNotes writes status through its own configured
 * field, so an inline edit here could only land somewhere the edited column does not
 * show — the picker would appear to save and change nothing. The field is therefore
 * offered no editor at all.
 *
 * The scheduled cell is asserted editable in the same view as a control: it proves the
 * status cell's read-only state is the mapping rule, not a view that is read-only
 * wholesale (which would make the assertion pass for the wrong reason).
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-edit");

const BASE_FILE = "Divergent.base";
const TASK_ROW = "Task Alpha.md";
const ASSIGNEE_COL = "note.assignee";
const STATUS_COL = "note.status";
const SCHEDULED_COL = "note.scheduled";

interface GridState {
  mounted: boolean;
  scheduledHeader: boolean;
  editorOpen: boolean;
  cells: Record<string, { exists: boolean; editable: boolean }>;
}

/** Force the OG Gantt to be the active, visible leaf. TaskNotes' starter note steals
 * the active leaf on boot, so this re-fronts the base leaf on every readiness poll. */
async function activateBaseLeaf(): Promise<void> {
  await browser.executeObsidian(async ({ app }, baseFile) => {
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
      const file = app.vault.getAbstractFileByPath(baseFile);
      if (!file) return;
      const leaf = ws.getLeaf(true);
      await leaf.openFile(file as never);
      baseLeaf = leaf as unknown as { detach?: () => void };
    }
    ws.setActiveLeaf(baseLeaf, { focus: true });
    ws.revealLeaf(baseLeaf);
  }, BASE_FILE);
}

/** Read the grid's edit-relevant state (probed cells keyed "row|col"). */
async function readGridState(): Promise<GridState> {
  return browser.execute(
    (taskRow, assigneeCol, statusCol, scheduledCol) => {
      const root = document.querySelector(".og-bases-gantt");
      const state: {
        mounted: boolean;
        scheduledHeader: boolean;
        editorOpen: boolean;
        cells: Record<string, { exists: boolean; editable: boolean }>;
      } = { mounted: !!root, scheduledHeader: false, editorOpen: false, cells: {} };
      if (!root) return state;
      const strip = (v: string): string => (v.startsWith(":") ? v.slice(1) : v);
      state.scheduledHeader = Array.from(root.querySelectorAll<HTMLElement>("[data-header-id]")).some(
        (el) => strip(el.getAttribute("data-header-id") ?? "") === scheduledCol,
      );
      state.editorOpen = !!root.querySelector(".wx-editor");
      const probe = (row: string, col: string): void => {
        const cell = Array.from(root.querySelectorAll<HTMLElement>("[data-row-id][data-col-id]")).find(
          (el) =>
            (el.getAttribute("data-row-id") ?? "").endsWith(row) &&
            strip(el.getAttribute("data-col-id") ?? "") === col,
        );
        const span = cell?.querySelector<HTMLElement>(".og-grid-cell");
        state.cells[`${row}|${col}`] = {
          exists: !!cell,
          editable: !!span?.classList.contains("og-cell-editable"),
        };
      };
      probe(taskRow, assigneeCol);
      probe(taskRow, statusCol);
      probe(taskRow, scheduledCol);
      return state;
    },
    TASK_ROW,
    ASSIGNEE_COL,
    STATUS_COL,
    SCHEDULED_COL,
  );
}

/** Double-click a grid cell located by row/column id suffix (in-page). */
async function doubleClickCell(rowSuffix: string, columnId: string): Promise<boolean> {
  return browser.execute(
    (row, col) => {
      const root = document.querySelector(".og-bases-gantt");
      if (!root) return false;
      const strip = (v: string): string => (v.startsWith(":") ? v.slice(1) : v);
      const cell = Array.from(root.querySelectorAll<HTMLElement>("[data-row-id][data-col-id]")).find(
        (el) =>
          (el.getAttribute("data-row-id") ?? "").endsWith(row) &&
          strip(el.getAttribute("data-col-id") ?? "") === col,
      );
      if (!cell) return false;
      cell.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true, cancelable: true }));
      return true;
    },
    rowSuffix,
    columnId,
  );
}

/** Close any TaskNotes modal a fall-through double-click activation opened. */
async function dismissAnyModal(): Promise<void> {
  await browser.execute(() => {
    if (document.querySelector(".modal-container")) {
      document.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    }
  });
}

/** Wait until the grid is mounted and the managed row's scheduled cell is editable —
 * editability needs TaskNotes' task index to have warmed. */
async function ensureGridReady(): Promise<void> {
  let last = "<never polled>";
  try {
    await browser.waitUntil(
      async () => {
        await activateBaseLeaf();
        const state = await readGridState();
        last = JSON.stringify(state);
        return (
          state.mounted &&
          state.scheduledHeader &&
          state.cells[`${TASK_ROW}|${ASSIGNEE_COL}`]?.exists === true &&
          state.cells[`${TASK_ROW}|${SCHEDULED_COL}`]?.editable === true
        );
      },
      { timeout: 90000, timeoutMsg: "Divergent grid not ready (cells + editable scheduled cue)" },
    );
  } catch {
    throw new Error(`Divergent grid not ready. Last observed: ${last}`);
  }
}

describe("Gantt (OG) status mapped away from TaskNotes' field is read-only", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-gantt-divergent-status-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({
      vault: tmpVault,
      plugins: ["tasknotes-gantt", "tasknotes"],
    });

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

    await ensureGridReady();
  });

  beforeEach(async () => {
    await dismissAnyModal();
    await ensureGridReady();
  });

  it("marks the divergently-mapped status cell read-only while dates stay editable", async () => {
    const state = await readGridState();

    expect(state.cells[`${TASK_ROW}|${ASSIGNEE_COL}`]?.editable).toBe(false);
    // TaskNotes' own status property is not this view's status field either, so it is
    // no more editable than any other unmapped property.
    expect(state.cells[`${TASK_ROW}|${STATUS_COL}`]?.editable).toBe(false);
    // Control: the view itself is writable — only the status field is withheld.
    expect(state.cells[`${TASK_ROW}|${SCHEDULED_COL}`]?.editable).toBe(true);
  });

  it("opens no editor on the divergently-mapped status cell", async () => {
    expect(await doubleClickCell(TASK_ROW, ASSIGNEE_COL)).toBe(true);
    await browser.pause(750);

    expect((await readGridState()).editorOpen).toBe(false);
  });
});
