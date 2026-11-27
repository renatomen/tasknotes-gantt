/**
 * TaskNotes 5 status glyphs on the bar and in the mapped status column.
 *
 * Stock TaskNotes draws `in-progress` as a progress pie and `done` as a
 * complete mark. The bar and the mapped status cell expose that state on
 * `data-og-glyph`. The name column, which is not the mapped status, does not.
 */
import { browser, expect } from "@wdio/globals";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-tasknotes-glyphs");

interface GlyphProbe {
  bars: { text: string; glyph: string | null }[];
  cells: { row: string; col: string; text: string; glyph: string | null }[];
}

let currentBase = "";

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
      if (!file) throw new Error(`Base fixture not found: ${basePath}`);
      const leaf = ws.getLeaf(false);
      await leaf.openFile(file as never);
      baseLeaf = leaf;
    }
    ws.setActiveLeaf(baseLeaf, { focus: true });
    ws.revealLeaf(baseLeaf);
  }, currentBase);
}

async function openBase(basePath: string): Promise<void> {
  currentBase = basePath;
  await browser.executeObsidian(({ app }) => app.workspace.detachLeavesOfType("bases"));
  await browser.waitUntil(async () => {
    await activateBaseLeaf();
    return browser.executeObsidian(({ app }) => {
      const root = (app.workspace.activeLeaf?.view as { containerEl?: HTMLElement } | undefined)?.containerEl;
      return (root?.querySelectorAll(".og-bases-gantt .wx-bar").length ?? 0) > 0;
    });
  }, { timeout: 60000, timeoutMsg: `Gantt did not render bars for ${basePath}` });
}

async function readGlyphs(): Promise<GlyphProbe> {
  await activateBaseLeaf();
  return browser.executeObsidian(({ app }) => {
    const root = (app.workspace.activeLeaf?.view as { containerEl?: HTMLElement } | undefined)?.containerEl;
    const strip = (value: string): string => (value.startsWith(":") ? value.slice(1) : value);
    const bars = Array.from(root?.querySelectorAll<HTMLElement>(".og-bases-gantt .wx-bar") ?? []).map((bar) => ({
      text: (bar.querySelector(".og-bar-text")?.textContent ?? "").trim(),
      glyph: bar.querySelector("[data-og-glyph]")?.getAttribute("data-og-glyph") ?? null,
    }));
    const cells = Array.from(root?.querySelectorAll<HTMLElement>("[data-row-id][data-col-id]") ?? []).map((cell) => ({
      row: cell.getAttribute("data-row-id") ?? "",
      col: strip(cell.getAttribute("data-col-id") ?? ""),
      text: (cell.querySelector(".og-grid-cell")?.textContent ?? "").trim(),
      glyph: cell.querySelector("[data-og-glyph]")?.getAttribute("data-og-glyph") ?? null,
    }));
    return { bars, cells };
  });
}

function barGlyph(probe: GlyphProbe, name: string): string | null {
  return probe.bars.find((bar) => bar.text === name)?.glyph ?? null;
}

function cellGlyph(probe: GlyphProbe, rowName: string, columnId: string): string | null | undefined {
  const cell = probe.cells.find((entry) => entry.row.endsWith(rowName) && entry.col === columnId);
  return cell ? cell.glyph : undefined;
}

describe("TaskNotes 5 status glyphs", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-gantt-tasknotes-glyphs-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({ vault: tmpVault, plugins: ["tasknotes-gantt", "tasknotes"] });
    await enableBases();
    await waitForTaskNotesReady();
    await waitForMetadataCacheReady();
    await openBase("Glyphs.base");
  });

  it("draws a progress pie on a mid-workflow bar and a complete mark on a done bar", async () => {
    let probe: GlyphProbe = { bars: [], cells: [] };
    try {
      await browser.waitUntil(
        async () => {
          probe = await readGlyphs();
          return barGlyph(probe, "Glyph Mid") === "progress" && barGlyph(probe, "Glyph Done") === "complete";
        },
        { timeout: 30000, timeoutMsg: "status glyphs did not settle on the bars" },
      );
    } catch (error) {
      throw new Error(`status glyphs did not settle: ${JSON.stringify(probe)}`, { cause: error });
    }

    expect(barGlyph(probe, "Glyph Mid")).toBe("progress");
    expect(barGlyph(probe, "Glyph Done")).toBe("complete");
  });

  it("draws the status glyph only in the mapped status column", async () => {
    let probe: GlyphProbe = { bars: [], cells: [] };
    try {
      await browser.waitUntil(
        async () => {
          probe = await readGlyphs();
          return (
            cellGlyph(probe, "Glyph Mid.md", "note.status") === "progress" &&
            cellGlyph(probe, "Glyph Done.md", "note.status") === "complete"
          );
        },
        { timeout: 30000, timeoutMsg: "status glyphs did not settle in the grid" },
      );
    } catch (error) {
      throw new Error(`status glyphs did not settle in the grid: ${JSON.stringify(probe)}`, { cause: error });
    }

    const markedColumns = probe.cells.filter((cell) => cell.glyph !== null).map((cell) => cell.col);
    expect(markedColumns).toEqual(["note.status", "note.status"]);
  });
});
