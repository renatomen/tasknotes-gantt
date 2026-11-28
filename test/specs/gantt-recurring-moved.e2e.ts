import { browser, expect } from "@wdio/globals";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { performGanttGesture } from "../helpers/ganttGesture";
import { waitUntilOrExplain } from "./helpers/waitReady";

/**
 * Moved-occurrence journey against real Obsidian + TaskNotes 5.0.5.
 *
 * Boots `test/vaults/gantt-recurring-moved`. Dates are pinned in March 2026 so
 * the run date never moves the bars. Journeys are ordered: the drag writes the
 * Daily Check note, and the drag-back journey reads that write.
 *
 * Show recurring stays off for every drag — an occupancy envelope swallows
 * pointerdown, so the bar is only movable as a plain scheduled→due span whose
 * recorded pieces sit inside it (none do, here).
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-recurring-moved");

const BASE = "Moved.base";
const MOVED_NOTE = "Moved Occurrence.md";
const DRAG_NOTE = "Daily Check.md";
const RANGE_NOTE = "Range Anchor.md";
const TASK_NOTES = [MOVED_NOTE, DRAG_NOTE, RANGE_NOTE];

const FIXTURE_NEW_DAY = "2026-03-12";
const ORIGINAL_DAY = "2026-03-18";
/** Negative so both the first drag and the return stay on a visible day column. */
const DRAG_DAYS = -4;
const DRAG_NEW_DAY = "2026-03-14";

interface RowPieces {
  found: boolean;
  envelope: boolean;
  days: string[];
}

async function enableBases(): Promise<void> {
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
}

async function activateBaseLeaf(): Promise<void> {
  await browser.executeObsidian(async ({ app }, basePath) => {
    const ws = app.workspace as unknown as {
      iterateAllLeaves: (cb: (leaf: { view?: { getViewType?: () => string }; detach?: () => void }) => void) => void;
      getLeavesOfType: (type: string) => unknown[];
      getLeaf: (newLeaf?: boolean) => { openFile: (file: unknown) => Promise<void> };
      setActiveLeaf: (leaf: unknown, opts?: { focus?: boolean }) => void;
      revealLeaf: (leaf: unknown) => void;
    };
    const markdownLeaves: Array<{ detach?: () => void }> = [];
    ws.iterateAllLeaves((leaf) => {
      if (leaf.view?.getViewType?.() === "markdown") markdownLeaves.push(leaf);
    });
    markdownLeaves.forEach((leaf) => leaf.detach?.());

    let baseLeaf = ws.getLeavesOfType("bases")[0];
    if (!baseLeaf) {
      const file = app.vault.getAbstractFileByPath(basePath);
      if (!file) return;
      const leaf = ws.getLeaf(false);
      await leaf.openFile(file as never);
      baseLeaf = leaf;
    }
    ws.setActiveLeaf(baseLeaf, { focus: true });
    ws.revealLeaf(baseLeaf);
  }, BASE);
}

async function missingBars(): Promise<string[]> {
  return browser.execute((names: string[]) => {
    const root = document.querySelector(".og-bases-gantt");
    if (!root) return ["<.og-bases-gantt absent>"];
    const ids = Array.from(root.querySelectorAll(".wx-bar")).map((bar) => bar.getAttribute("data-id") ?? "");
    return names.filter((name) => !ids.some((id) => id.endsWith(name)));
  }, TASK_NOTES);
}

async function ensureGanttReady(): Promise<void> {
  let missing: string[] = ["<never polled>"];
  await waitUntilOrExplain(
    async () => {
      await activateBaseLeaf();
      missing = await missingBars();
      return missing.length === 0;
    },
    () => `Gantt bars missing: ${JSON.stringify(missing)}`,
    { timeout: 90000 },
  );
}

async function fireConfigToggle(
  key: string,
  value: unknown,
): Promise<{ set: boolean; configChanged: boolean }> {
  return browser.executeObsidian(
    ({ app }, k, v) => {
      const ws = app.workspace as unknown as {
        getLeavesOfType: (type: string) => Array<{ view?: Record<string, unknown> }>;
      };
      const SKIP = new Set([
        "app", "vault", "workspace", "containerEl", "contentEl", "scope",
        "leaf", "headerEl", "navigation", "owner", "metadataCache",
      ]);
      const seen = new Set<unknown>();
      let set = false;
      let configChanged = false;
      const shouldSkipTraversal = (obj: unknown, depth: number): boolean =>
        !obj
        || typeof obj !== "object"
        || seen.has(obj)
        || depth > 6
        || (obj as { nodeType?: number }).nodeType !== undefined;
      const visit = (obj: unknown, depth: number): void => {
        if (shouldSkipTraversal(obj, depth)) return;
        seen.add(obj);
        const rec = obj as Record<string, unknown>;
        const cfg = rec.config as { set?: (kk: string, vv: unknown) => void } | undefined;
        if (!set && cfg && typeof cfg.set === "function" && typeof rec.onDataUpdated === "function") {
          cfg.set(k, v);
          set = true;
        }
        if (!configChanged && typeof rec.onConfigChanged === "function") {
          try { (rec.onConfigChanged as () => void).call(rec); configChanged = true; } catch { /* ignore */ }
        }
        for (const childKey of Object.keys(rec)) {
          if (SKIP.has(childKey)) continue;
          let child: unknown;
          try { child = rec[childKey]; } catch { continue; }
          if (child && typeof child === "object") visit(child, depth + 1);
        }
      };
      for (const leaf of ws.getLeavesOfType("bases")) if (leaf.view) visit(leaf.view, 0);
      return { set, configChanged };
    },
    key,
    value,
  );
}

async function setShowRecurring(on: boolean): Promise<void> {
  const fired = await fireConfigToggle("tngantt_showRecurring", on);
  expect(fired.set && fired.configChanged).toBe(true);
}

async function rowPieces(noteName: string): Promise<RowPieces> {
  return browser.execute((name: string) => {
    const root = document.querySelector(".og-bases-gantt");
    const bar = (Array.from(root?.querySelectorAll(".wx-bar") ?? []) as HTMLElement[]).find((el) =>
      (el.getAttribute("data-id") ?? "").endsWith(name),
    );
    if (!bar) return { found: false, envelope: false, days: [] };
    const days = (Array.from(bar.querySelectorAll(".og-instance")) as HTMLElement[])
      .map((piece) => piece.getAttribute("data-og-instance") ?? "")
      .filter((day) => day.length > 0);
    return { found: true, envelope: bar.classList.contains("wx-split"), days };
  }, noteName);
}

async function waitForRowPieces(
  noteName: string,
  requiredDay: string,
  forbiddenDay: string,
): Promise<RowPieces> {
  let row: RowPieces = { found: false, envelope: false, days: [] };
  await waitUntilOrExplain(
    async () => {
      await activateBaseLeaf();
      row = await rowPieces(noteName);
      return row.found && row.days.includes(requiredDay) && !row.days.includes(forbiddenDay);
    },
    () => `${noteName} pieces never settled; last: ${JSON.stringify(row)}`,
    { timeout: 20000 },
  );
  return row;
}

async function barWidth(noteName: string): Promise<number> {
  return browser.execute((name: string) => {
    const root = document.querySelector(".og-bases-gantt");
    const bar = (Array.from(root?.querySelectorAll(".wx-bar") ?? []) as HTMLElement[]).find((el) =>
      (el.getAttribute("data-id") ?? "").endsWith(name),
    );
    return bar?.getBoundingClientRect().width ?? 0;
  }, noteName);
}

async function waitForPlainBar(noteName: string): Promise<void> {
  let row: RowPieces = { found: false, envelope: true, days: [] };
  let previousWidth = -1;
  await waitUntilOrExplain(
    async () => {
      await activateBaseLeaf();
      row = await rowPieces(noteName);
      const width = await barWidth(noteName);
      const stable = width > 0 && width === previousWidth;
      previousWidth = width;
      return row.found && !row.envelope && stable;
    },
    () => `${noteName} never settled as a plain bar; last: ${JSON.stringify(row)} width=${previousWidth}`,
    { timeout: 20000, interval: 400 },
  );
}

async function noteYaml(notePath: string): Promise<string> {
  return browser.executeObsidian(async ({ app }, filePath) => {
    const file = app.vault.getAbstractFileByPath(filePath);
    if (!file) return "";
    return app.vault.read(file as never);
  }, notePath);
}

function yamlDate(text: string, key: string): string | null {
  const match = text.match(new RegExp(`^${key}:\\s*"?(\\d{4}-\\d{2}-\\d{2})`, "m"));
  return match?.[1] ?? null;
}

function yamlHasKey(text: string, key: string): boolean {
  return new RegExp(`^${key}\\s*:`, "m").test(text);
}

async function waitForMovedFrontmatter(scheduled: string, original: string | null): Promise<string> {
  let yaml = "";
  await waitUntilOrExplain(
    async () => {
      yaml = await noteYaml(DRAG_NOTE);
      const scheduledDay = yamlDate(yaml, "scheduled");
      const hasOriginal = yamlHasKey(yaml, "recurrence_original_date");
      if (original === null) return scheduledDay === scheduled && !hasOriginal;
      return scheduledDay === scheduled && yamlDate(yaml, "recurrence_original_date") === original;
    },
    () => `Daily Check frontmatter never settled; last yaml:\n${yaml}`,
    { timeout: 15000, interval: 300 },
  );
  return yaml;
}

describe("Gantt (OG) recurring moved occurrences", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-gantt-recurring-moved-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({
      vault: tmpVault,
      plugins: ["tasknotes-gantt", "tasknotes"],
    });
    await enableBases();

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

    let lastTaskFacts = "<never polled>";
    await waitUntilOrExplain(
      async () => {
        lastTaskFacts = await browser.executeObsidian(async ({ app }, names) => {
          const tn = (app as unknown as { plugins?: { getPlugin?: (id: string) => unknown } }).plugins?.getPlugin?.(
            "tasknotes",
          ) as { api?: { tasks?: { list?: () => Promise<unknown[]> | unknown[] } } } | undefined;
          const list = await tn?.api?.tasks?.list?.();
          if (!Array.isArray(list)) return "no task list";
          type Info = { path?: string; recurrence?: unknown; scheduled?: unknown; recurrence_original_date?: unknown };
          const byPath = new Map((list as Info[]).map((task) => [task.path, task]));
          const moved = byPath.get(names.moved);
          const drag = byPath.get(names.drag);
          const facts = {
            movedRecurrence: typeof moved?.recurrence === "string" && String(moved.recurrence).includes("FREQ=DAILY"),
            movedOriginal: String(moved?.recurrence_original_date ?? "").startsWith("2026-03-18"),
            movedScheduled: String(moved?.scheduled ?? "").startsWith("2026-03-12"),
            dragRecurrence: typeof drag?.recurrence === "string" && String(drag.recurrence).includes("FREQ=DAILY"),
            dragScheduled: String(drag?.scheduled ?? "").startsWith("2026-03-18"),
          };
          return Object.values(facts).every(Boolean) ? "ok" : JSON.stringify(facts);
        }, { moved: MOVED_NOTE, drag: DRAG_NOTE });
        return lastTaskFacts === "ok";
      },
      () => `TaskNotes never served the fixture's moved-occurrence facts; last: ${lastTaskFacts}`,
      { timeout: 60000 },
    );

    await ensureGanttReady();
  });

  beforeEach(async () => {
    await ensureGanttReady();
  });

  it("renders the fixture's moved occurrence once on its new day", async () => {
    await setShowRecurring(true);
    const row = await waitForRowPieces(MOVED_NOTE, FIXTURE_NEW_DAY, ORIGINAL_DAY);
    expect(row.days).toContain(FIXTURE_NEW_DAY);
    expect(row.days).not.toContain(ORIGINAL_DAY);
  });

  it("records a TaskNotes moved occurrence when the recurring bar is dragged", async () => {
    await setShowRecurring(false);
    await waitForPlainBar(DRAG_NOTE);
    const drag = await browser.execute(performGanttGesture, {
      notePath: DRAG_NOTE,
      edge: "move" as const,
      days: DRAG_DAYS,
    });
    expect(drag.pxPerDay).toBeGreaterThan(0);

    const yaml = await waitForMovedFrontmatter(DRAG_NEW_DAY, ORIGINAL_DAY);
    expect(yamlDate(yaml, "scheduled")).toBe(DRAG_NEW_DAY);
    expect(yamlDate(yaml, "recurrence_original_date")).toBe(ORIGINAL_DAY);

    await setShowRecurring(true);
    const row = await waitForRowPieces(DRAG_NOTE, DRAG_NEW_DAY, ORIGINAL_DAY);
    expect(row.days).toContain(DRAG_NEW_DAY);
    expect(row.days).not.toContain(ORIGINAL_DAY);
  });

  it("clears the moved occurrence when the bar is dragged back to its original day", async () => {
    await setShowRecurring(false);
    await waitForPlainBar(DRAG_NOTE);
    const drag = await browser.execute(performGanttGesture, {
      notePath: DRAG_NOTE,
      edge: "move" as const,
      days: -DRAG_DAYS,
    });
    expect(drag.pxPerDay).toBeGreaterThan(0);

    const yaml = await waitForMovedFrontmatter(ORIGINAL_DAY, null);
    expect(yamlDate(yaml, "scheduled")).toBe(ORIGINAL_DAY);
    expect(yamlHasKey(yaml, "recurrence_original_date")).toBe(false);

    await setShowRecurring(true);
    const row = await waitForRowPieces(DRAG_NOTE, ORIGINAL_DAY, DRAG_NEW_DAY);
    expect(row.days).toContain(ORIGINAL_DAY);
    expect(row.days).not.toContain(DRAG_NEW_DAY);
  });
});
