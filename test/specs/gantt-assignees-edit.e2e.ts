/* global HTMLInputElement */
import { browser, expect } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { waitUntilOrExplain } from "./helpers/waitReady";

/**
 * Assignees edits on TaskNotes 5: the view leaves the property unset, TaskNotes'
 * Assignees field is pointed at `assignee`, and the cell saves a list through
 * that field.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-edit");

const TASK_ROW = "Task Alpha.md";
const ASSIGNEE_COL = "note.assignee";

async function activateBaseLeaf(reopen = false): Promise<void> {
  await browser.executeObsidian(async ({ app }, shouldReopen: boolean) => {
    const ws = app.workspace as unknown as {
      iterateAllLeaves: (cb: (l: { view?: { getViewType?: () => string }; detach?: () => void }) => void) => void;
      getLeavesOfType: (t: string) => Array<{
        detach?: () => void;
        openFile?: (f: unknown) => Promise<void>;
      }>;
      getLeaf: (newLeaf?: boolean) => { openFile: (f: unknown) => Promise<void> };
      setActiveLeaf: (l: unknown, opts?: { focus?: boolean }) => void;
      revealLeaf: (l: unknown) => void;
    };
    const markdownLeaves: Array<{ detach?: () => void }> = [];
    ws.iterateAllLeaves((l) => {
      if (l.view?.getViewType?.() === "markdown") markdownLeaves.push(l);
    });
    markdownLeaves.forEach((l) => l.detach?.());

    const file = app.vault.getAbstractFileByPath("Edit.base");
    if (!file) return;
    const existing = ws.getLeavesOfType("bases")[0];
    if (existing) {
      if (shouldReopen && existing.openFile) await existing.openFile(file);
      ws.setActiveLeaf(existing, { focus: true });
      ws.revealLeaf(existing);
      return;
    }
    const leaf = ws.getLeaf(true);
    await leaf.openFile(file as never);
    ws.setActiveLeaf(leaf, { focus: true });
    ws.revealLeaf(leaf);
  }, reopen);
}

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

async function readChipLabels(): Promise<string[]> {
  return browser.execute(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(".og-bases-gantt .wx-editor .og-chip-label"),
    ).map((el) => (el.textContent ?? "").trim()),
  );
}

async function removeChipByLabel(label: string): Promise<boolean> {
  return browser.execute((wanted) => {
    const chip = Array.from(
      document.querySelectorAll<HTMLElement>(".og-bases-gantt .wx-editor .og-chip"),
    ).find((el) => (el.querySelector(".og-chip-label")?.textContent ?? "").trim() === wanted);
    const button = chip?.querySelector<HTMLElement>(".og-chip-remove");
    if (!button) return false;
    button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    return true;
  }, label);
}

async function typeEditorToken(value: string): Promise<boolean> {
  return browser.execute((v) => {
    const input = document.querySelector<HTMLInputElement>(".og-bases-gantt .wx-editor input");
    if (!input) return false;
    input.focus();
    input.value = v;
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    return true;
  }, value);
}

async function pressEnterInEditor(): Promise<void> {
  await browser.execute(() => {
    document
      .querySelector<HTMLInputElement>(".og-bases-gantt .wx-editor input")
      ?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

async function clickOutsideEditor(): Promise<void> {
  await browser.execute(() => {
    document.body.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    document.body.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
}

async function readCellText(rowSuffix: string, columnId: string): Promise<string | null> {
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

async function cellIsEditable(): Promise<boolean> {
  const editable = await browser.execute((row, col) => {
    const root = document.querySelector(".og-bases-gantt");
    if (!root) return false;
    const strip = (v: string): string => (v.startsWith(":") ? v.slice(1) : v);
    const cell = Array.from(root.querySelectorAll<HTMLElement>("[data-row-id][data-col-id]")).find(
      (el) =>
        (el.getAttribute("data-row-id") ?? "").endsWith(row) &&
        strip(el.getAttribute("data-col-id") ?? "") === col,
    );
    return !!cell?.querySelector(".og-grid-cell")?.classList.contains("og-cell-editable");
  }, TASK_ROW, ASSIGNEE_COL);
  return editable;
}

describe("Gantt assignees edit", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-gantt-assignees-e2e");
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

    await browser.executeObsidian(async ({ app }) => {
      const tn = (app as unknown as { plugins?: { getPlugin?: (id: string) => unknown } }).plugins?.getPlugin?.(
        "tasknotes",
      ) as
        | {
            settings?: { fieldMapping?: Record<string, string> };
            saveSettings?: () => Promise<void>;
          }
        | undefined;
      if (!tn?.settings?.fieldMapping) throw new Error("TaskNotes field mapping unavailable");
      tn.settings.fieldMapping.assignees = "assignee";
      await tn.saveSettings?.();

      const file = app.vault.getAbstractFileByPath("Task Alpha.md");
      if (!file) throw new Error("Task Alpha.md missing");
      await app.fileManager.processFrontMatter(file as never, (fm: Record<string, unknown>) => {
        fm.assignee = ["[[Alice]]"];
      });
    });

    await activateBaseLeaf(true);
    let last = "<never>";
    await browser.waitUntil(
      async () => {
        await activateBaseLeaf();
        const editable = await cellIsEditable();
        last = String(await readCellText(TASK_ROW, ASSIGNEE_COL));
        return editable && last.includes("Alice");
      },
      { timeout: 90000, timeoutMsg: `Assignees cell not ready. Last text: ${last}` },
    );
  });

  it("adds one assignee and removes another, writing the list back to the note", async () => {
    expect(await frontmatterValue(TASK_ROW, "assignee")).toEqual(["[[Alice]]"]);

    expect(await doubleClickCell(TASK_ROW, ASSIGNEE_COL)).toBe(true);
    await browser.waitUntil(async () => (await readChipLabels()).includes("Alice"), {
      timeout: 10000,
      timeoutMsg: "Existing assignee did not seed as a chip",
    });

    expect(await typeEditorToken("Bob")).toBe(true);
    await pressEnterInEditor();
    await browser.waitUntil(async () => (await readChipLabels()).includes("Bob"), {
      timeout: 5000,
      timeoutMsg: "Enter did not add the typed assignee",
    });

    await clickOutsideEditor();
    let stored: unknown = "<unread>";
    await waitUntilOrExplain(
      async () => {
        stored = await frontmatterValue(TASK_ROW, "assignee");
        return JSON.stringify(stored) === JSON.stringify(["[[Alice]]", "Bob"]);
      },
      () => `assignee list was not written; saw: ${JSON.stringify(stored)}`,
      { timeout: 15000 },
    );

    await browser.waitUntil(async () => (await readCellText(TASK_ROW, ASSIGNEE_COL))?.includes("Bob") === true, {
      timeout: 10000,
      timeoutMsg: "The cell did not re-render the added assignee",
    });

    expect(await doubleClickCell(TASK_ROW, ASSIGNEE_COL)).toBe(true);
    await browser.waitUntil(async () => (await readChipLabels()).includes("Alice"), {
      timeout: 10000,
      timeoutMsg: "Chips editor did not reopen",
    });
    expect(await removeChipByLabel("Alice")).toBe(true);
    await clickOutsideEditor();
    await waitUntilOrExplain(
      async () => {
        stored = await frontmatterValue(TASK_ROW, "assignee");
        return JSON.stringify(stored) === JSON.stringify(["Bob"]);
      },
      () => `removing Alice did not rewrite the list; saw: ${JSON.stringify(stored)}`,
      { timeout: 15000 },
    );
  });

  it("writes an empty list when every assignee is removed", async () => {
    expect(await doubleClickCell(TASK_ROW, ASSIGNEE_COL)).toBe(true);
    await browser.waitUntil(async () => (await readChipLabels()).includes("Bob"), {
      timeout: 10000,
      timeoutMsg: "Remaining assignee did not seed",
    });
    expect(await removeChipByLabel("Bob")).toBe(true);
    await clickOutsideEditor();
    let stored: unknown = "<unread>";
    await waitUntilOrExplain(
      async () => {
        stored = await frontmatterValue(TASK_ROW, "assignee");
        return JSON.stringify(stored) === JSON.stringify([]);
      },
      () => `clearing assignees did not leave an empty list; saw: ${JSON.stringify(stored)}`,
      { timeout: 15000 },
    );
  });
});
