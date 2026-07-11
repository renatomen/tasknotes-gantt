/* global HTMLInputElement */
import { browser, expect } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Inline cell-edit spec (cell editability).
 *
 * Boots Obsidian against the `test/vaults/gantt-edit` fixture with BOTH
 * tasknotes-gantt and TaskNotes enabled, registers two TaskNotes user fields
 * at runtime (`effort`: text, `points`: number — TaskNotes' `model.config()`
 * reads live plugin settings, so no committed third-party data.json is
 * needed), opens the base, and asserts the editor attachment + commit/revert
 * behavior end-to-end against real Obsidian + SVAR:
 *   - a row TaskNotes does NOT manage (no `#task` tag) never opens an
 *     inline editor, and carries no editable cue;
 *   - a formula column never opens an inline editor (the double-click
 *     falls through to the preserved TaskNotes-activation path);
 *   - a text-field cell on the managed row opens SVAR's inline editor
 *     on double-click; typing a new value + Enter persists it to frontmatter
 *     and the cell shows the committed value IMMEDIATELY (optimistic apply,
 *     before the TaskNotes echo/refresh) and never flips back to the
 *     pre-edit value across the settle window;
 *   - committing non-numeric text into the number-field cell writes
 *     nothing (frontmatter unchanged) and the cell keeps showing the stored
 *     value;
 *   - a mapped due-date cell opens the CUSTOM locale-aware date editor
 *     (seeded in the forced de-DE regional form); typing a de-DE date + Enter
 *     persists the canonical YYYY-MM-DD to frontmatter and the cell
 *     re-renders the regional form;
 *   - typing a start date past the due date is rejected by the cross-field
 *     gate (frontmatter unchanged);
 *   - the mapped status cell opens a richselect picker listing ONLY TaskNotes'
 *     configured statuses, and a pick persists the configured value string;
 *   - a list-shaped user field with an autosuggestFilter opens the custom
 *     suggest editor; against TaskNotes 4.11.0 (no reachable FileSuggestHelper)
 *     it renders the DEGRADED free-text state, and an Enter commit APPENDS the
 *     entry to the raw stored list via the direct (bridge-bypassing) path;
 *   - a text-field cell opens the custom text editor: typing `[[Q3` surfaces
 *     VAULT-sourced note suggestions (the fixture's Q3 notes, not TaskNotes),
 *     and a mouse pick splices `[[Q3 Roadmap]]` at the caret preserving the
 *     surrounding text WITHOUT being lost to the editor's clickOutside;
 *   - committing markdown (`**ship**`) into a text cell re-renders decorated
 *     (bold) after the confirming data pass (raw text shows optimistically);
 *   - the managed text cell carries a view-mode edit-in-modal affordance that
 *     opens TaskNotes' edit modal; a non-managed row's text cell has none.
 *
 * The display locale is forced to de-DE via `window.__tnGanttDebug.localeOverride`
 * BEFORE the view assembles data (and re-asserted on every readiness poll),
 * exactly like gantt-locale-dates.e2e.ts.
 *
 * SELECTOR NOTES (verified against @svar-ui/svelte-grid 2.7.0 source):
 *  - grid body cells: `.wx-cell` carrying `data-row-id` (SVAR setID → leading
 *    ":" for string ids) and `data-col-id` — match with endsWith in-page;
 *  - an OPEN inline editor is `.wx-cell.wx-editor` with an `input.wx-text`
 *    (text editor); Enter commits (grid `update-cell` → gantt `update-task`);
 *  - our editable-cell cue is the `og-cell-editable` class on `.og-grid-cell`;
 *  - the text editor's `[[` dropdown is PORTAL'd to the body: its rows are
 *    `.og-suggest-item` (queried document-wide, like the richselect picker);
 *  - the edit-in-modal affordance is a `.og-cell-edit-modal` button inside the
 *    cell (opacity-hidden until hover, but present in the DOM + clickable).
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-edit");

const TASK_ROW = "Task Alpha.md";
const PLAIN_ROW = "Plain Note.md";
const EFFORT_COL = "note.effort";
const POINTS_COL = "note.points";
const FORMULA_COL = "formula.label";
const SCHEDULED_COL = "note.scheduled";
const DUE_COL = "note.due";
const STATUS_COL = "note.status";
const WORKSTREAM_COL = "note.workstream";
/** Any de-DE numeric date (the fixture dates render dotted under the override). */
const DE_DATE_PATTERN = /\d{1,2}\.\d{1,2}\.\d{4}/;
/** Vault notes that back the `[[` autosuggest (excluded from the base rows). */
const ROADMAP_LABEL = "Q3 Roadmap";
const RETRO_LABEL = "Q3 Retro";

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
    (taskRow, plainRow, effortCol, pointsCol, formulaCol, scheduledCol, dueCol, statusCol, workstreamCol) => {
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
      probe(taskRow, scheduledCol);
      probe(taskRow, dueCol);
      probe(taskRow, statusCol);
      probe(taskRow, workstreamCol);
      probe(plainRow, effortCol);
      return state;
    },
    TASK_ROW,
    PLAIN_ROW,
    EFFORT_COL,
    POINTS_COL,
    FORMULA_COL,
    SCHEDULED_COL,
    DUE_COL,
    STATUS_COL,
    WORKSTREAM_COL,
  );
}

/** The open inline editor's input value, or null when none is open. */
async function readEditorInputValue(): Promise<string | null> {
  return browser.execute(() => {
    const input = document.querySelector<HTMLInputElement>(".og-bases-gantt .wx-editor input");
    return input ? input.value : null;
  });
}

/** Force the display-locale override the assembly pass snapshots. */
async function forceLocaleOverride(): Promise<void> {
  await browser.execute(() => {
    (window as unknown as { __tnGanttDebug?: unknown }).__tnGanttDebug = { localeOverride: "de-DE" };
  });
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

/** The labels of the open richselect picker's rows (portal'd out of the grid). */
async function readPickerLabels(): Promise<string[] | null> {
  return browser.execute(() => {
    if (!document.querySelector(".og-bases-gantt .wx-editor")) return null;
    const items = Array.from(document.querySelectorAll<HTMLElement>(".wx-list > .wx-item"));
    return items.map((el) => (el.textContent ?? "").trim());
  });
}

/** Pick the richselect row with the given label (mousemove arms SVAR's navIndex). */
async function pickPickerItem(label: string): Promise<boolean> {
  return browser.execute((wanted) => {
    const item = Array.from(document.querySelectorAll<HTMLElement>(".wx-list > .wx-item")).find(
      (el) => (el.textContent ?? "").trim() === wanted,
    );
    if (!item) return false;
    item.dispatchEvent(new window.MouseEvent("mousemove", { bubbles: true }));
    item.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    return true;
  }, label);
}

/** TaskNotes' live configured statuses ({value,label}), via its catalog api. */
async function readConfiguredStatuses(): Promise<Array<{ value: string; label: string }>> {
  return browser.executeObsidian(({ app }) => {
    const tn = (app as unknown as { plugins?: { getPlugin?: (id: string) => unknown } }).plugins?.getPlugin?.(
      "tasknotes",
    ) as
      | { api?: { catalog?: { statuses?: () => Array<{ value?: string; label?: string }> } } }
      | undefined;
    const raw = tn?.api?.catalog?.statuses?.() ?? [];
    return raw
      .filter((s) => typeof s?.value === "string" && s.value.length > 0)
      .map((s) => ({ value: s.value as string, label: (s.label as string) || (s.value as string) }));
  });
}

/** Whether the open suggest editor shows its degraded (free-text) hint. */
async function readSuggestDegradedHint(): Promise<boolean> {
  return browser.execute(() => !!document.querySelector(".og-suggest-degraded"));
}

/**
 * Set the open text editor's value and caret, then fire `input` so the editor
 * runs its `[[`-token detection at that caret (setting `.value` alone leaves the
 * caret at the end, which the mid-text cases need to override).
 */
async function typeEditorToken(value: string, caret: number): Promise<boolean> {
  return browser.execute(
    (v, c) => {
      const input = document.querySelector<HTMLInputElement>(".og-bases-gantt .wx-editor input");
      if (!input) return false;
      input.value = v;
      input.setSelectionRange(c, c);
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
      return true;
    },
    value,
    caret,
  );
}

/** The labels of the text editor's portal'd `[[` suggestion rows. */
async function readSuggestItems(): Promise<string[]> {
  return browser.execute(() =>
    Array.from(document.querySelectorAll<HTMLElement>(".og-suggest-item")).map((el) =>
      (el.textContent ?? "").trim(),
    ),
  );
}

/** Whether the text editor's `[[` suggestion panel is currently rendered. */
async function readSuggestPanelOpen(): Promise<boolean> {
  return browser.execute(() => !!document.querySelector(".og-suggest-panel"));
}

/**
 * Simulate a genuine click OUTSIDE the open editor: mousedown then click on the
 * document body (lib-dom's clickOutside arms on mousedown, fires on the click),
 * so the editor's outside-click commit runs.
 */
async function clickOutsideEditor(): Promise<void> {
  await browser.execute(() => {
    document.body.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    document.body.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
}

/** The rendered text of a grid cell (markdown flattened to text), or null. */
async function readCellRenderedText(rowSuffix: string, columnId: string): Promise<string | null> {
  return browser.execute(
    (row, col) => {
      const root = document.querySelector(".og-bases-gantt");
      if (!root) return null;
      const strip = (v: string): string => (v.startsWith(":") ? v.slice(1) : v);
      const cell = Array.from(root.querySelectorAll<HTMLElement>("[data-row-id][data-col-id]")).find(
        (el) =>
          (el.getAttribute("data-row-id") ?? "").endsWith(row) &&
          strip(el.getAttribute("data-col-id") ?? "") === col,
      );
      const span = cell?.querySelector<HTMLElement>(".og-grid-cell");
      return span ? (span.textContent ?? "").trim() : null;
    },
    rowSuffix,
    columnId,
  );
}

/**
 * Reposition the caret in the open editor and fire the caret key's keyup WITHOUT
 * changing the text — the path that must re-sync the `[[` token state so the
 * dropdown closes once the caret leaves the token.
 */
async function moveEditorCaret(caret: number, key: string): Promise<void> {
  await browser.execute(
    (c, k) => {
      const input = document.querySelector<HTMLInputElement>(".og-bases-gantt .wx-editor input");
      if (!input) return;
      input.setSelectionRange(c, c);
      input.dispatchEvent(new window.KeyboardEvent("keyup", { key: k, bubbles: true }));
    },
    caret,
    key,
  );
}

/**
 * Pick a `[[` suggestion by label with a realistic gesture (mousemove + mousedown
 * + click): the mousedown drives lib-dom's clickOutside bookkeeping so the pick's
 * click is correctly classified as INSIDE the editor (via the portal'd-dropdown
 * nested-listener exemption) and is not lost to a spurious commit.
 */
async function pickSuggestItem(label: string): Promise<boolean> {
  return browser.execute((wanted) => {
    const item = Array.from(document.querySelectorAll<HTMLElement>(".og-suggest-item")).find(
      (el) => (el.textContent ?? "").trim() === wanted,
    );
    if (!item) return false;
    item.dispatchEvent(new window.MouseEvent("mousemove", { bubbles: true }));
    item.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    item.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    return true;
  }, label);
}

/** Commit the open editor's CURRENT value with Enter (no value change). */
async function pressEnterInEditor(): Promise<void> {
  await browser.execute(() => {
    document
      .querySelector<HTMLInputElement>(".og-bases-gantt .wx-editor input")
      ?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

/** The text of a `<strong>` rendered inside a cell (markdown decoration), or null. */
async function readCellStrongText(rowSuffix: string, columnId: string): Promise<string | null> {
  return browser.execute(
    (row, col) => {
      const root = document.querySelector(".og-bases-gantt");
      if (!root) return null;
      const strip = (v: string): string => (v.startsWith(":") ? v.slice(1) : v);
      const cell = Array.from(root.querySelectorAll<HTMLElement>("[data-row-id][data-col-id]")).find(
        (el) =>
          (el.getAttribute("data-row-id") ?? "").endsWith(row) &&
          strip(el.getAttribute("data-col-id") ?? "") === col,
      );
      const strong = cell?.querySelector<HTMLElement>(".og-grid-cell strong");
      return strong ? (strong.textContent ?? "").trim() : null;
    },
    rowSuffix,
    columnId,
  );
}

/** Whether a cell carries the edit-in-modal affordance button. */
async function readAffordancePresent(rowSuffix: string, columnId: string): Promise<boolean> {
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
      return !!cell?.querySelector(".og-cell-edit-modal");
    },
    rowSuffix,
    columnId,
  );
}

/** Click a cell's edit-in-modal affordance (opens TaskNotes' edit modal). */
async function clickAffordance(rowSuffix: string, columnId: string): Promise<boolean> {
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
      const btn = cell?.querySelector<HTMLElement>(".og-cell-edit-modal");
      if (!btn) return false;
      btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
      return true;
    },
    rowSuffix,
    columnId,
  );
}

/** Whether the installed TaskNotes build exposes the internal edit-modal opener. */
async function taskNotesHasEditModal(): Promise<boolean> {
  return browser.executeObsidian(({ app }) => {
    const tn = (app as unknown as { plugins?: { getPlugin?: (id: string) => unknown } }).plugins?.getPlugin?.(
      "tasknotes",
    ) as { openTaskEditModal?: unknown } | undefined;
    return typeof tn?.openTaskEditModal === "function";
  });
}

/** Whether any Obsidian modal is currently open. */
async function isModalOpen(): Promise<boolean> {
  return browser.execute(() => !!document.querySelector(".modal-container"));
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
 * data refresh after readiness. Also gates on the due cell rendering in the
 * forced de-DE form (any dotted date — the value changes mid-suite), so the
 * assembly pass demonstrably consumed the locale override before any date-editor
 * assertion runs. Re-asserts the override + re-fronts the base leaf per poll.
 */
async function ensureEditGridReady(): Promise<void> {
  let last = "<never polled>";
  try {
    await browser.waitUntil(
      async () => {
        await forceLocaleOverride();
        await activateBaseLeaf();
        const state = await readEditState();
        last = JSON.stringify(state);
        return (
          state.mounted &&
          state.effortHeader &&
          state.cells[`${TASK_ROW}|${EFFORT_COL}`]?.exists === true &&
          state.cells[`${PLAIN_ROW}|${EFFORT_COL}`]?.exists === true &&
          state.cells[`${TASK_ROW}|${EFFORT_COL}`]?.editable === true &&
          state.cells[`${TASK_ROW}|${STATUS_COL}`]?.exists === true &&
          state.cells[`${TASK_ROW}|${WORKSTREAM_COL}`]?.exists === true &&
          DE_DATE_PATTERN.test(state.cells[`${TASK_ROW}|${DUE_COL}`]?.text ?? "")
        );
      },
      { timeout: 90000, timeoutMsg: "Edit grid not ready (cells + editable cue + de-DE dates)" },
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

    // Force the display locale BEFORE anything can mount the view: the editor
    // config snapshots the locale at mount, so the override must precede the
    // first assembly pass (ensureEditGridReady re-asserts it per poll).
    await forceLocaleOverride();

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
        {
          id: "workstream",
          displayName: "Workstream",
          key: "workstream",
          type: "list",
          autosuggestFilter: { requiredTags: ["ws"] },
        },
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

  it("never opens an editor on a row TaskNotes does not manage", async () => {
    expect(await doubleClickCell(PLAIN_ROW, EFFORT_COL)).toBe(true);
    // Poll-negative: give a would-be editor time to appear, then assert absence.
    await browser.pause(750);
    expect((await readEditState()).editorOpen).toBe(false);
  });

  it("never opens an editor on a formula column", async () => {
    expect(await doubleClickCell(TASK_ROW, FORMULA_COL)).toBe(true);
    await browser.pause(750);
    expect((await readEditState()).editorOpen).toBe(false);
    // The editor-less double-click falls through to the preserved TaskNotes
    // activation path, which may open its edit modal — close it.
    await dismissAnyModal();
  });

  it("commits a text edit to frontmatter and re-renders the cell (happy path, no flicker)", async () => {
    const preEditText = (await readEditState()).cells[`${TASK_ROW}|${EFFORT_COL}`]?.text;
    expect(preEditText).toBe("Draft");

    expect(await doubleClickCell(TASK_ROW, EFFORT_COL)).toBe(true);
    await browser.waitUntil(async () => (await readEditState()).editorOpen, {
      timeout: 10000,
      timeoutMsg: "Inline editor did not open on the managed effort cell",
    });
    expect(await commitEditorValue("Deep work")).toBe(true);

    // No-flicker pin: the optimistic apply advances the render descriptor on
    // the commit itself, so the cell must ALREADY show the committed value —
    // read immediately, with no wait, well before the TaskNotes echo/refresh.
    const immediateText = (await readEditState()).cells[`${TASK_ROW}|${EFFORT_COL}`]?.text;
    expect(immediateText).toBe("Deep work");

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

    // Poll-negative flicker guard: across the echo/refresh settle window the
    // cell keeps the committed value on every sample — the pre-edit value
    // ("Draft") must never reappear, not even transiently.
    const flickerDeadline = Date.now() + 1500;
    while (Date.now() < flickerDeadline) {
      const sampledText = (await readEditState()).cells[`${TASK_ROW}|${EFFORT_COL}`]?.text;
      expect(sampledText).toBe("Deep work");
      await browser.pause(100);
    }
  });

  it("rejects non-numeric text in the number cell without writing", async () => {
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

  it("commits a de-DE-typed due date as canonical YYYY-MM-DD and re-renders the cell", async () => {
    expect(await doubleClickCell(TASK_ROW, DUE_COL)).toBe(true);
    await browser.waitUntil(async () => (await readEditState()).editorOpen, {
      timeout: 10000,
      timeoutMsg: "Custom date editor did not open on the mapped due cell",
    });
    // The custom editor pre-fills the typed input with the stored due date in
    // the forced regional format (3.4.2026 — never the ISO form).
    expect(await readEditorInputValue()).toMatch(/^0?3\.0?4\.2026$/);

    expect(await commitEditorValue("10.04.2026")).toBe(true);

    let lastDue: unknown = "<unread>";
    await browser.waitUntil(
      async () => {
        lastDue = await frontmatterValue(TASK_ROW, "due");
        return lastDue === "2026-04-10";
      },
      {
        timeout: 15000,
        timeoutMsg: () => `frontmatter due not updated to 2026-04-10; saw: ${JSON.stringify(lastDue)}`,
      },
    );

    await browser.waitUntil(
      async () => {
        await activateBaseLeaf();
        const state = await readEditState();
        return /^10\.0?4\.2026$/.test(state.cells[`${TASK_ROW}|${DUE_COL}`]?.text ?? "");
      },
      { timeout: 15000, timeoutMsg: "Due cell did not re-render the committed date in de-DE form" },
    );
  });

  it("rejects a start date typed past the due date without writing (cross-field gate)", async () => {
    const before = await frontmatterValue(TASK_ROW, "scheduled");
    expect(before).toBe("2026-04-01");

    expect(await doubleClickCell(TASK_ROW, SCHEDULED_COL)).toBe(true);
    await browser.waitUntil(async () => (await readEditState()).editorOpen, {
      timeout: 10000,
      timeoutMsg: "Custom date editor did not open on the mapped scheduled cell",
    });
    // Past the due date whether or not the previous test advanced it
    // (2026-04-03 fixture value or 2026-04-10 after the commit test).
    expect(await commitEditorValue("20.04.2026")).toBe(true);

    // A conforming date closes the editor; the cross-field gate then rejects
    // the commit before any write. Settle, then assert nothing changed.
    await browser.waitUntil(async () => !(await readEditState()).editorOpen, {
      timeout: 10000,
      timeoutMsg: "Inline editor did not close after the rejected date commit",
    });
    await browser.pause(1500);
    expect(await frontmatterValue(TASK_ROW, "scheduled")).toBe("2026-04-01");
    const state = await readEditState();
    expect(state.cells[`${TASK_ROW}|${SCHEDULED_COL}`]?.text).toMatch(/^0?1\.0?4\.2026$/);
  });

  it("offers ONLY the configured statuses in the status picker and persists a pick", async () => {
    const configured = await readConfiguredStatuses();
    expect(configured.length).toBeGreaterThan(1);
    expect(configured.map((s) => s.value)).toContain("done");

    expect(await doubleClickCell(TASK_ROW, STATUS_COL)).toBe(true);
    await browser.waitUntil(async () => (await readEditState()).editorOpen, {
      timeout: 10000,
      timeoutMsg: "Status picker did not open on the managed status cell",
    });

    // The picker lists exactly TaskNotes' configured statuses (by label) — no
    // free-text row, nothing beyond the catalog.
    let labels: string[] | null = null;
    await browser.waitUntil(
      async () => {
        labels = await readPickerLabels();
        return (labels?.length ?? 0) > 0;
      },
      { timeout: 10000, timeoutMsg: "Status picker rows did not render" },
    );
    expect(labels).toEqual(configured.map((s) => s.label));

    expect(await pickPickerItem("Done")).toBe(true);

    let lastStatus: unknown = "<unread>";
    await browser.waitUntil(
      async () => {
        lastStatus = await frontmatterValue(TASK_ROW, "status");
        return lastStatus === "done";
      },
      {
        timeout: 15000,
        timeoutMsg: () => `frontmatter status not updated to 'done'; saw: ${JSON.stringify(lastStatus)}`,
      },
    );
  });

  it("renders the degraded suggest state (no reachable TaskNotes suggester) and appends a free-text entry to the list via the direct path", async () => {
    expect(await frontmatterValue(TASK_ROW, "workstream")).toEqual(["[[WS Alpha]]"]);

    expect(await doubleClickCell(TASK_ROW, WORKSTREAM_COL)).toBe(true);
    await browser.waitUntil(async () => (await readEditState()).editorOpen, {
      timeout: 10000,
      timeoutMsg: "Suggest editor did not open on the managed workstream cell",
    });

    // TaskNotes 4.11.0 exposes no reachable FileSuggestHelper, so the editor
    // must show its degraded hint (and behave as free text) rather than a
    // silent, empty dropdown.
    await browser.waitUntil(async () => readSuggestDegradedHint(), {
      timeout: 10000,
      timeoutMsg: "Suggest editor did not render the degraded (free-text) hint",
    });

    expect(await commitEditorValue("Manual entry")).toBe(true);

    // The direct commit APPENDS to the raw stored list, preserving the
    // existing wikilink entry verbatim (never the display-form round-trip).
    let lastWorkstream: unknown = "<unread>";
    await browser.waitUntil(
      async () => {
        lastWorkstream = await frontmatterValue(TASK_ROW, "workstream");
        return JSON.stringify(lastWorkstream) === JSON.stringify(["[[WS Alpha]]", "Manual entry"]);
      },
      {
        timeout: 15000,
        timeoutMsg: () =>
          `frontmatter workstream not appended; saw: ${JSON.stringify(lastWorkstream)}`,
      },
    );
  });

  it("keeps SVAR's editor value in sync so Tab commits the typed text", async () => {
    expect(await doubleClickCell(TASK_ROW, EFFORT_COL)).toBe(true);
    await browser.waitUntil(async () => (await readEditState()).editorOpen, {
      timeout: 10000,
      timeoutMsg: "Text editor did not open on the effort cell",
    });

    // Type (no `[[`, so no dropdown), then Tab — SVAR closes the editor and
    // commits its own store value, which the editor must have kept in sync.
    expect(await typeEditorToken("tabbed edit", 11)).toBe(true);
    await browser.keys(["Tab"]);

    let committed: unknown = "<unread>";
    await browser.waitUntil(
      async () => {
        committed = await frontmatterValue(TASK_ROW, "effort");
        return committed === "tabbed edit";
      },
      {
        timeout: 15000,
        timeoutMsg: () => `Tab did not commit the typed text; frontmatter effort: ${JSON.stringify(committed)}`,
      },
    );

    // Tab may have opened the next cell's editor — close it so the next test's
    // readiness gate starts clean.
    await browser.keys(["Escape"]);
    await browser.waitUntil(async () => !(await readEditState()).editorOpen, {
      timeout: 5000,
      timeoutMsg: "An editor stayed open after the Tab commit",
    });
  });

  it("commits the typed text on Enter when the `[[` token matches no notes", async () => {
    expect(await doubleClickCell(TASK_ROW, EFFORT_COL)).toBe(true);
    await browser.waitUntil(async () => (await readEditState()).editorOpen, {
      timeout: 10000,
      timeoutMsg: "Text editor did not open on the effort cell",
    });

    // A token that matches no vault note keeps the dropdown open on a "no
    // matches" state; Enter must still commit the typed text, not be swallowed.
    expect(await typeEditorToken("note [[Zzq", 10)).toBe(true);
    await browser.waitUntil(
      async () => (await readSuggestPanelOpen()) && (await readSuggestItems()).length === 0,
      {
        timeout: 10000,
        timeoutMsg: "`[[` dropdown did not reach the no-matches state",
      },
    );

    await pressEnterInEditor();
    await browser.waitUntil(async () => !(await readEditState()).editorOpen, {
      timeout: 5000,
      timeoutMsg: "Enter did not commit-and-close on the no-matches token",
    });

    let committed: unknown = "<unread>";
    await browser.waitUntil(
      async () => {
        committed = await frontmatterValue(TASK_ROW, "effort");
        return committed === "note [[Zzq";
      },
      {
        timeout: 15000,
        timeoutMsg: () => `no-match Enter did not commit the typed text; frontmatter: ${JSON.stringify(committed)}`,
      },
    );
  });

  it("closes the `[[` dropdown when the caret leaves the token so Enter commits instead of picking", async () => {
    expect(await doubleClickCell(TASK_ROW, EFFORT_COL)).toBe(true);
    await browser.waitUntil(async () => (await readEditState()).editorOpen, {
      timeout: 10000,
      timeoutMsg: "Text editor did not open on the effort cell",
    });

    // Open the dropdown with a mid-text token gesture.
    expect(await typeEditorToken("see [[Q3 later", 8)).toBe(true);
    await browser.waitUntil(async () => readSuggestPanelOpen(), {
      timeout: 10000,
      timeoutMsg: "`[[` dropdown did not open on the typed token",
    });

    // Move the caret to the start with a keyup that fires no `input` — the caret
    // no longer sits inside the `[[…` token, so the dropdown must close on its
    // own rather than staying open and hijacking the next Enter.
    await moveEditorCaret(0, "Home");
    await browser.waitUntil(async () => !(await readSuggestPanelOpen()), {
      timeout: 5000,
      timeoutMsg: "`[[` dropdown did not close after the caret left the token",
    });

    // Dropdown closed → Enter commits the current text verbatim (never force-picks
    // a suggestion) and the editor closes.
    expect(await readEditorInputValue()).toBe("see [[Q3 later");
    await pressEnterInEditor();
    await browser.waitUntil(async () => !(await readEditState()).editorOpen, {
      timeout: 5000,
      timeoutMsg: "Text editor did not commit-and-close on Enter with the dropdown closed",
    });
  });

  it("surfaces vault [[ suggestions in the text editor and a mouse pick splices at the caret (not lost to clickOutside)", async () => {
    expect(await doubleClickCell(TASK_ROW, EFFORT_COL)).toBe(true);
    await browser.waitUntil(async () => (await readEditState()).editorOpen, {
      timeout: 10000,
      timeoutMsg: "Text editor did not open on the effort cell",
    });

    // Mid-text token: caret sits right after "Q3" (offset 8) so a correct splice
    // must preserve BOTH the leading "see " and the trailing " later".
    expect(await typeEditorToken("see [[Q3 later", 8)).toBe(true);

    // Suggestions come from the VAULT (the fixture's Q3 notes), not TaskNotes —
    // TaskNotes' helper is unreachable in the harness, so this proves R2.
    let items: string[] = [];
    await browser.waitUntil(
      async () => {
        items = await readSuggestItems();
        return items.includes(ROADMAP_LABEL) && items.includes(RETRO_LABEL);
      },
      {
        timeout: 10000,
        timeoutMsg: () => `vault [[ suggestions did not appear; saw: ${JSON.stringify(items)}`,
      },
    );

    expect(await pickSuggestItem(ROADMAP_LABEL)).toBe(true);

    // The pick splices `[[Q3 Roadmap]]` at the token bounds (surrounding text
    // preserved) AND the editor is STILL OPEN — the portal'd-dropdown click was
    // not lost to the wrapper's clickOutside → commit.
    let inputValue: string | null = null;
    await browser.waitUntil(
      async () => {
        inputValue = await readEditorInputValue();
        return inputValue === "see [[Q3 Roadmap]] later";
      },
      {
        timeout: 5000,
        timeoutMsg: () => `pick did not splice at the caret; input: ${JSON.stringify(inputValue)}`,
      },
    );
    expect((await readEditState()).editorOpen).toBe(true);

    // Commit the spliced value with Enter (dropdown already closed) to close the
    // editor deterministically; the next test overwrites the effort value.
    await pressEnterInEditor();
    await browser.waitUntil(async () => !(await readEditState()).editorOpen, {
      timeout: 5000,
      timeoutMsg: "Text editor did not close after the Enter commit",
    });
  });

  it("re-renders committed markdown decorated (bold) after the confirming pass", async () => {
    expect(await doubleClickCell(TASK_ROW, EFFORT_COL)).toBe(true);
    await browser.waitUntil(async () => (await readEditState()).editorOpen, {
      timeout: 10000,
      timeoutMsg: "Text editor did not open on the effort cell",
    });

    expect(await commitEditorValue("**ship** it")).toBe(true);

    // KTD7: the optimistic apply shows RAW text on commit; the decorated
    // `<strong>` appears only after the async confirming data pass — so POLL for
    // it rather than asserting synchronously post-commit.
    let boldText: string | null = null;
    await browser.waitUntil(
      async () => {
        await activateBaseLeaf();
        boldText = await readCellStrongText(TASK_ROW, EFFORT_COL);
        return boldText === "ship";
      },
      {
        timeout: 15000,
        timeoutMsg: () => `effort cell did not render <strong>ship</strong>; saw: ${JSON.stringify(boldText)}`,
      },
    );
  });

  it("commits a mouse-picked wikilink splice when the click lands outside the editor", async () => {
    expect(await doubleClickCell(TASK_ROW, EFFORT_COL)).toBe(true);
    await browser.waitUntil(async () => (await readEditState()).editorOpen, {
      timeout: 10000,
      timeoutMsg: "Text editor did not open on the effort cell",
    });

    expect(await typeEditorToken("see [[Q3 later", 8)).toBe(true);
    await browser.waitUntil(async () => (await readSuggestItems()).includes(ROADMAP_LABEL), {
      timeout: 10000,
      timeoutMsg: "vault [[ suggestions did not appear for the outside-click case",
    });
    expect(await pickSuggestItem(ROADMAP_LABEL)).toBe(true);
    await browser.waitUntil(async () => (await readEditorInputValue()) === "see [[Q3 Roadmap]] later", {
      timeout: 5000,
      timeoutMsg: "pick did not splice before the outside click",
    });

    // Click elsewhere instead of pressing Enter — the spliced value must commit,
    // not be discarded back to the seed.
    await clickOutsideEditor();
    await browser.waitUntil(async () => !(await readEditState()).editorOpen, {
      timeout: 5000,
      timeoutMsg: "Text editor did not close on the outside click",
    });

    let rendered: string | null = null;
    await browser.waitUntil(
      async () => {
        await activateBaseLeaf();
        rendered = await readCellRenderedText(TASK_ROW, EFFORT_COL);
        return rendered !== null && rendered.includes("Q3 Roadmap");
      },
      {
        timeout: 15000,
        timeoutMsg: () => `outside click did not commit the splice; cell shows: ${JSON.stringify(rendered)}`,
      },
    );
  });

  it("opens TaskNotes' edit modal from the managed text cell's affordance", async function () {
    if (!(await taskNotesHasEditModal())) {
      // The installed TaskNotes build lacks the internal opener; the affordance
      // would fall back to opening the note. Skip rather than assert a modal.
      this.skip();
    }
    expect(await readAffordancePresent(TASK_ROW, EFFORT_COL)).toBe(true);
    expect(await clickAffordance(TASK_ROW, EFFORT_COL)).toBe(true);

    await browser.waitUntil(async () => isModalOpen(), {
      timeout: 10000,
      timeoutMsg: "TaskNotes' edit modal did not open from the affordance",
    });
    await dismissAnyModal();
  });

  it("shows no edit-in-modal affordance on a non-TaskNotes row's text cell", async () => {
    expect(await readAffordancePresent(TASK_ROW, EFFORT_COL)).toBe(true);
    expect(await readAffordancePresent(PLAIN_ROW, EFFORT_COL)).toBe(false);
  });
});
