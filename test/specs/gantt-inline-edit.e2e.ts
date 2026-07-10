/* global HTMLInputElement */
import { browser, expect } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Inline cell-edit spec (cell editability, U5).
 *
 * Boots Obsidian against the `test/vaults/gantt-edit` fixture with BOTH
 * tasknotes-gantt and TaskNotes enabled, registers two TaskNotes user fields
 * at runtime (`effort`: text, `points`: number — TaskNotes' `model.config()`
 * reads live plugin settings, so no committed third-party data.json is
 * needed), opens the base, and asserts the editor attachment + commit/revert
 * behavior end-to-end against real Obsidian + SVAR:
 *   - (AE3) a row TaskNotes does NOT manage (no `#task` tag) never opens an
 *     inline editor, and carries no editable cue;
 *   - (AE4) a formula column never opens an inline editor (the double-click
 *     falls through to the preserved TaskNotes-activation path);
 *   - (happy) a text-field cell on the managed row opens SVAR's inline editor
 *     on double-click; typing a new value + Enter persists it to frontmatter
 *     and the cell re-renders the new value;
 *   - (AE6) committing non-numeric text into the number-field cell writes
 *     nothing (frontmatter unchanged) and the cell keeps showing the stored
 *     value.
 *
 * SELECTOR NOTES (verified against @svar-ui/svelte-grid 2.7.0 source):
 *  - grid body cells: `.wx-cell` carrying `data-row-id` (SVAR setID → leading
 *    ":" for string ids) and `data-col-id` — match with endsWith in-page;
 *  - an OPEN inline editor is `.wx-cell.wx-editor` with an `input.wx-text`
 *    (text editor); Enter commits (grid `update-cell` → gantt `update-task`);
 *  - our editable-cell cue is the `og-cell-editable` class on `.og-grid-cell`.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-edit");

const TASK_ROW = "Task Alpha.md";
const PLAIN_ROW = "Plain Note.md";
const EFFORT_COL = "note.effort";
const POINTS_COL = "note.points";
const FORMULA_COL = "formula.label";

interface EditGridState {
  mounted: boolean;
  effortHeader: boolean;
  /** `.wx-editor` currently open anywhere in the grid. */
  editorOpen: boolean;
  /** Cell text + editable-cue presence per probed cell ("" when absent). */
  cells: Record<string, { exists: boolean; text: string; editable: boolean }>;
}

/** Force the OG Gantt to be the active, visible leaf (self-healing vs the
 * TaskNotes starter-note leaf steal — see gantt-dependency-types.e2e.ts). */
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
      const file = app.vault.getAbstractFileByPath("Edit.base");
      if (!file) return;
      const leaf = ws.getLeaf(true);
      await leaf.openFile(file as never);
      baseLeaf = leaf as unknown as { detach?: () => void };
    }
    ws.setActiveLeaf(baseLeaf, { focus: true });
    ws.revealLeaf(baseLeaf);
  });
}

/** Read the grid's edit-relevant state (probed cells keyed "row|col"). */
async function readEditState(): Promise<EditGridState> {
  return browser.execute(
    (taskRow, plainRow, effortCol, pointsCol, formulaCol) => {
      const root = document.querySelector(".og-bases-gantt");
      const state: {
        mounted: boolean;
        effortHeader: boolean;
        editorOpen: boolean;
        cells: Record<string, { exists: boolean; text: string; editable: boolean }>;
      } = { mounted: !!root, effortHeader: false, editorOpen: false, cells: {} };
      if (!root) return state;
      const strip = (v: string): string => (v.startsWith(":") ? v.slice(1) : v);
      state.effortHeader = Array.from(root.querySelectorAll<HTMLElement>("[data-header-id]")).some(
        (el) => strip(el.getAttribute("data-header-id") ?? "") === effortCol,
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
          text: (span?.textContent ?? cell?.textContent ?? "").trim(),
          editable: !!span?.classList.contains("og-cell-editable"),
        };
      };
      probe(taskRow, effortCol);
      probe(taskRow, pointsCol);
      probe(taskRow, formulaCol);
      probe(plainRow, effortCol);
      return state;
    },
    TASK_ROW,
    PLAIN_ROW,
    EFFORT_COL,
    POINTS_COL,
    FORMULA_COL,
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

/** Type into the open inline editor and commit with Enter (in-page). */
async function commitEditorValue(value: string): Promise<boolean> {
  return browser.execute((v) => {
    const input = document.querySelector<HTMLInputElement>(".og-bases-gantt .wx-editor input");
    if (!input) return false;
    input.value = v;
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    return true;
  }, value);
}

/** A note's current frontmatter value, via the metadata cache. */
async function frontmatterValue(notePath: string, key: string): Promise<unknown> {
  return browser.executeObsidian(
    ({ app }, p, k) => {
      const file = app.vault.getAbstractFileByPath(p);
      if (!file) return "<no file>";
      const fm = app.metadataCache.getFileCache(file as never)?.frontmatter;
      return fm ? fm[k] : "<no frontmatter>";
    },
    notePath,
    key,
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

/**
 * Wait until the grid is mounted with both rows' effort cells present AND the
 * managed row is editable (the `og-cell-editable` cue) — editability needs
 * TaskNotes' task index (`tasks.get`) to have warmed, which lands via a normal
 * data refresh after readiness. Re-fronts the base leaf on every poll.
 */
async function ensureEditGridReady(): Promise<void> {
  let last = "<never polled>";
  try {
    await browser.waitUntil(
      async () => {
        await activateBaseLeaf();
        const state = await readEditState();
        last = JSON.stringify(state);
        return (
          state.mounted &&
          state.effortHeader &&
          state.cells[`${TASK_ROW}|${EFFORT_COL}`]?.exists === true &&
          state.cells[`${PLAIN_ROW}|${EFFORT_COL}`]?.exists === true &&
          state.cells[`${TASK_ROW}|${EFFORT_COL}`]?.editable === true
        );
      },
      { timeout: 90000, timeoutMsg: "Edit grid not ready (cells + editable cue)" },
    );
  } catch {
    throw new Error(`Edit grid not ready. Last observed: ${last}`);
  }
}

describe("Gantt (OG) inline cell editing", () => {
  before(async () => {
    // Hermetic: copy the in-repo fixture to a disposable temp dir.
    const tmpVault = path.join(os.tmpdir(), "og-gantt-inline-edit-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({
      vault: tmpVault,
      plugins: ["tasknotes-gantt", "tasknotes"],
    });

    // Bases core plugin must be ON to open the .base file.
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

    // Wait for the TaskNotes API, then register the user fields the fixture's
    // columns rely on BEFORE opening the base (config() reads live settings).
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
    await browser.executeObsidian(async ({ app }) => {
      const tn = (app as unknown as { plugins?: { getPlugin?: (id: string) => unknown } }).plugins?.getPlugin?.(
        "tasknotes",
      ) as
        | { settings?: { userFields?: unknown[] }; saveSettings?: () => Promise<void> }
        | undefined;
      if (!tn?.settings) throw new Error("TaskNotes plugin/settings unavailable");
      tn.settings.userFields = [
        { id: "effort", displayName: "Effort", key: "effort", type: "text" },
        { id: "points", displayName: "Points", key: "points", type: "number" },
      ];
      await tn.saveSettings?.();
    });

    await ensureEditGridReady();
  });

  beforeEach(async () => {
    await dismissAnyModal();
    await ensureEditGridReady();
  });

  it("marks only the managed row's user-field cells as editable (cue)", async () => {
    const state = await readEditState();
    expect(state.cells[`${TASK_ROW}|${EFFORT_COL}`]?.editable).toBe(true);
    expect(state.cells[`${TASK_ROW}|${POINTS_COL}`]?.editable).toBe(true);
    // The formula column resolves no editor; the plain note fails the row gate.
    expect(state.cells[`${TASK_ROW}|${FORMULA_COL}`]?.editable).toBe(false);
    expect(state.cells[`${PLAIN_ROW}|${EFFORT_COL}`]?.editable).toBe(false);
  });

  it("never opens an editor on a row TaskNotes does not manage (AE3)", async () => {
    expect(await doubleClickCell(PLAIN_ROW, EFFORT_COL)).toBe(true);
    // Poll-negative: give a would-be editor time to appear, then assert absence.
    await browser.pause(750);
    expect((await readEditState()).editorOpen).toBe(false);
  });

  it("never opens an editor on a formula column (AE4)", async () => {
    expect(await doubleClickCell(TASK_ROW, FORMULA_COL)).toBe(true);
    await browser.pause(750);
    expect((await readEditState()).editorOpen).toBe(false);
    // The editor-less double-click falls through to the preserved TaskNotes
    // activation path, which may open its edit modal — close it.
    await dismissAnyModal();
  });

  it("commits a text edit to frontmatter and re-renders the cell (happy path)", async () => {
    expect(await doubleClickCell(TASK_ROW, EFFORT_COL)).toBe(true);
    await browser.waitUntil(async () => (await readEditState()).editorOpen, {
      timeout: 10000,
      timeoutMsg: "Inline editor did not open on the managed effort cell",
    });
    expect(await commitEditorValue("Deep work")).toBe(true);

    let lastEffort: unknown = "<unread>";
    await browser.waitUntil(
      async () => {
        lastEffort = await frontmatterValue(TASK_ROW, "effort");
        return lastEffort === "Deep work";
      },
      {
        timeout: 15000,
        timeoutMsg: () => `frontmatter effort not updated; saw: ${JSON.stringify(lastEffort)}`,
      },
    );

    // The persisted write flows back through the normal refresh; the cell
    // re-renders the committed value.
    await browser.waitUntil(
      async () => {
        await activateBaseLeaf();
        const state = await readEditState();
        return state.cells[`${TASK_ROW}|${EFFORT_COL}`]?.text === "Deep work";
      },
      { timeout: 15000, timeoutMsg: "Effort cell did not re-render the committed value" },
    );
  });

  it("rejects non-numeric text in the number cell without writing (AE6)", async () => {
    const before = await frontmatterValue(TASK_ROW, "points");
    expect(before).toBe(3);

    expect(await doubleClickCell(TASK_ROW, POINTS_COL)).toBe(true);
    await browser.waitUntil(async () => (await readEditState()).editorOpen, {
      timeout: 10000,
      timeoutMsg: "Inline editor did not open on the managed points cell",
    });
    expect(await commitEditorValue("abc")).toBe(true);

    // The editor closes on commit; the reject blocks the store apply and no
    // write happens — poll a settle window, then assert nothing changed.
    await browser.waitUntil(async () => !(await readEditState()).editorOpen, {
      timeout: 10000,
      timeoutMsg: "Inline editor did not close after the rejected commit",
    });
    await browser.pause(1500);
    expect(await frontmatterValue(TASK_ROW, "points")).toBe(3);
    const state = await readEditState();
    expect(state.cells[`${TASK_ROW}|${POINTS_COL}`]?.text).toBe("3");
  });
});
