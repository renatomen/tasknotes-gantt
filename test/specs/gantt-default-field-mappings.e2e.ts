import { browser, expect } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Default field-mapping spec — a view that maps NOTHING.
 *
 * `Defaults.base` carries no `tngantt_*` field-mapping keys at all: every field is
 * left unset, so each one resolves to TaskNotes' own configured property. This is
 * the case every other fixture misses (they all pin `tngantt_statusProperty` &
 * friends), and the one that regressed: an unset field was treated as "no property
 * at all", so its cells resolved no inline editor and a double-click fell through
 * to opening the note.
 *
 * Asserts, against real Obsidian + TaskNotes, that an unset field behaves exactly
 * as an explicitly selected one:
 *   - the status cell carries the editable cue and opens the configured-statuses
 *     picker; a pick persists to the note's frontmatter;
 *   - the priority cell carries the editable cue (its value is empty — editability
 *     is a property-identity question, not a value one);
 *   - the scheduled cell opens the date editor (start/end resolve from TaskNotes'
 *     scheduled/due).
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-edit");

const BASE_FILE = "Defaults.base";
const TASK_ROW = "Task Alpha.md";
const PLAIN_ROW = "Plain Note.md";
const STATUS_COL = "note.status";
const PRIORITY_COL = "note.priority";
const SCHEDULED_COL = "note.scheduled";

interface GridState {
  mounted: boolean;
  statusHeader: boolean;
  editorOpen: boolean;
  cells: Record<string, { exists: boolean; text: string; editable: boolean }>;
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
    (taskRow, plainRow, statusCol, priorityCol, scheduledCol) => {
      const root = document.querySelector(".og-bases-gantt");
      const state: {
        mounted: boolean;
        statusHeader: boolean;
        editorOpen: boolean;
        cells: Record<string, { exists: boolean; text: string; editable: boolean }>;
      } = { mounted: !!root, statusHeader: false, editorOpen: false, cells: {} };
      if (!root) return state;
      const strip = (v: string): string => (v.startsWith(":") ? v.slice(1) : v);
      state.statusHeader = Array.from(root.querySelectorAll<HTMLElement>("[data-header-id]")).some(
        (el) => strip(el.getAttribute("data-header-id") ?? "") === statusCol,
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
      probe(taskRow, statusCol);
      probe(taskRow, priorityCol);
      probe(taskRow, scheduledCol);
      probe(plainRow, statusCol);
      return state;
    },
    TASK_ROW,
    PLAIN_ROW,
    STATUS_COL,
    PRIORITY_COL,
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
 * Close an inline editor left open by a preceding test. An open editor REPLACES
 * the cell's `.og-grid-cell` span, so the readiness probe would never see the cell
 * again — a leaked editor deadlocks every later `ensureGridReady`.
 */
async function closeAnyEditor(): Promise<void> {
  await browser.execute(() => {
    const editor = document.querySelector<HTMLElement>(".og-bases-gantt .wx-editor");
    if (!editor) return;
    editor.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.body.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    document.body.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
}

/**
 * Wait until the grid is mounted with the status column rendered AND the managed
 * row editable — editability needs TaskNotes' task index (`tasks.get`) to have
 * warmed, which lands via a normal data refresh after readiness. Re-fronts the
 * base leaf per poll.
 */
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
          state.statusHeader &&
          state.cells[`${TASK_ROW}|${STATUS_COL}`]?.exists === true &&
          state.cells[`${TASK_ROW}|${STATUS_COL}`]?.editable === true
        );
      },
      { timeout: 90000, timeoutMsg: "Defaults grid not ready (status cell + editable cue)" },
    );
  } catch {
    throw new Error(`Defaults grid not ready. Last observed: ${last}`);
  }
}

describe("Gantt (OG) unset field mappings default to TaskNotes' properties", () => {
  before(async () => {
    // Hermetic: copy the in-repo fixture to a disposable temp dir.
    const tmpVault = path.join(os.tmpdir(), "og-gantt-default-mappings-e2e");
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
    await closeAnyEditor();
    await dismissAnyModal();
    await ensureGridReady();
  });

  it("colors and icons the bar by status though the status mapping is unset", async () => {
    // The user-visible half of the bug: with the field unset the status VALUE was never
    // read, so "Bar color source: status" silently did nothing. The treatment class and
    // icon chip prove the value now reaches the bar, not just the editor.
    const treated = await browser.execute(
      () =>
        document.querySelectorAll('.og-bases-gantt .wx-bar[class*="og-status-"]').length,
    );
    const chips = await browser.execute(
      () => document.querySelectorAll(".og-bases-gantt .og-bar-chip").length,
    );

    expect(treated).toBeGreaterThan(0);
    expect(chips).toBeGreaterThan(0);
  });

  it("marks the unmapped status/priority/scheduled cells editable on the managed row only", async () => {
    const state = await readGridState();
    expect(state.cells[`${TASK_ROW}|${STATUS_COL}`]?.editable).toBe(true);
    expect(state.cells[`${TASK_ROW}|${PRIORITY_COL}`]?.editable).toBe(true);
    expect(state.cells[`${TASK_ROW}|${SCHEDULED_COL}`]?.editable).toBe(true);
    // The row gate still holds: a note TaskNotes does not manage is never editable.
    expect(state.cells[`${PLAIN_ROW}|${STATUS_COL}`]?.editable).toBe(false);
  });

  it("opens the configured-statuses picker on the unmapped status cell", async () => {
    // Read the expectation BEFORE opening the editor, and capture the labels in the
    // same poll that observes them. An open editor is not a stable state — a refresh
    // closes it — so confirming "the editor is open" and then reading the picker in a
    // separate round-trip can find it already gone (the picker reads as null, which is
    // indistinguishable from "no picker was ever offered").
    const configured = await readConfiguredStatuses();
    expect(configured.length).toBeGreaterThan(0);

    expect(await doubleClickCell(TASK_ROW, STATUS_COL)).toBe(true);

    let labels: string[] | null = null;
    await browser.waitUntil(
      async () => {
        labels = await readPickerLabels();
        return (labels?.length ?? 0) > 0;
      },
      {
        timeout: 5000,
        timeoutMsg: "The status picker never listed any option (did the note open instead?)",
      },
    );

    expect(labels).toEqual(configured.map((s) => s.label));
  });

  it("persists a status pick from the unmapped status cell to frontmatter", async () => {
    const configured = await readConfiguredStatuses();
    const current = String(await frontmatterValue(TASK_ROW, "status"));
    const target = configured.find((s) => s.value !== current);
    if (!target) throw new Error("Fixture needs at least two configured statuses");

    expect(await doubleClickCell(TASK_ROW, STATUS_COL)).toBe(true);
    // Poll the PICK itself, not the picker's presence: an open editor is not a stable
    // state, so a pick issued in a later round-trip can arrive after the editor closed.
    // Retrying the click until it lands makes the wait and the action the same step.
    await browser.waitUntil(async () => pickPickerItem(target.label), {
      timeout: 5000,
      timeoutMsg: `The status picker never offered "${target.label}" to click`,
    });

    await browser.waitUntil(async () => (await frontmatterValue(TASK_ROW, "status")) === target.value, {
      timeout: 10000,
      timeoutMsg: `status did not persist as "${target.value}"`,
    });
  });

  it("opens the date editor on the unmapped scheduled cell", async () => {
    expect(await doubleClickCell(TASK_ROW, SCHEDULED_COL)).toBe(true);

    await browser.waitUntil(async () => (await readGridState()).editorOpen, {
      timeout: 5000,
      timeoutMsg: "No editor opened on the unmapped scheduled cell",
    });
  });
});
