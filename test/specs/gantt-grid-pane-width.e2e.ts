/**
 * Grid pane width contract.
 *
 * A view with no persisted `tngantt_tableWidth` opens its grid pane fitted to
 * the columns the Base renders — the unset fallback is the columns' combined
 * width, the same value SVAR's own column recompute forces, so the deferred
 * `resize-grid` re-assert can never race it back to a narrower pane (the
 * observed defect: property columns painting under the chart).
 */
import { browser, expect } from "@wdio/globals";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-appearance");

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
        const taskNotes = (app as unknown as { plugins?: { getPlugin?: (id: string) => unknown } })
          .plugins?.getPlugin?.("tasknotes") as { api?: { lifecycle?: { ready?: () => Promise<void> } } } | undefined;
        if (!taskNotes?.api) return false;
        await taskNotes.api.lifecycle?.ready?.();
        return true;
      }),
    { timeout: 60000, timeoutMsg: "TaskNotes API never became ready" },
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

describe("Grid pane width", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-gantt-grid-pane-width-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({ vault: tmpVault, plugins: ["tasknotes-gantt", "tasknotes"] });
    await enableBases();
    await waitForTaskNotesReady();
    await waitForMetadataCacheReady();
    await resizeWindow(1280, 820);
    await collapseSidebars();
  });

  async function resizeWindow(width: number, height: number): Promise<void> {
    const result = await browser.execute((w: number, h: number) => {
      const req = (window as unknown as { require?: (m: string) => unknown }).require;
      type Win = { setSize?: (w: number, h: number) => void; unmaximize?: () => void; getSize?: () => number[] };
      const win = (req?.("electron") as { remote?: { getCurrentWindow?: () => Win } } | undefined)?.remote?.getCurrentWindow?.();
      if (!win?.setSize || !win.getSize) return null;
      win.unmaximize?.();
      win.setSize(w, h);
      return win.getSize();
    }, width, height);
    if (result === null) throw new Error("electron window API missing");
    await browser.pause(800);
  }

  async function collapseSidebars(): Promise<void> {
    await browser.executeObsidian(async ({ app }) => {
      const ws = app.workspace as unknown as {
        leftSplit?: { collapse?: () => void };
        rightSplit?: { collapse?: () => void };
      };
      ws.leftSplit?.collapse?.();
      ws.rightSplit?.collapse?.();
    });
    await browser.pause(300);
  }




  /**
   * The clipping pane is `.wx-table-container` (SVAR's overflow-x:auto grid
   * wrapper); `.wx-grid` is its content and always measures the full column
   * sum, clipped or not. The last column's visible right edge decides whether
   * the columns fit the pane.
   */
  async function measurePane(): Promise<{ paneWidth: number; lastColumnRight: number }> {
    return browser.execute(() => {
      const root = document.querySelector(".og-bases-gantt");
      const pane = root?.querySelector(".wx-table-container");
      const paneRect = pane?.getBoundingClientRect();
      let lastColumnRight = 0;
      root?.querySelectorAll<HTMLElement>("[data-row-id][data-col-id]").forEach((cell) => {
        const right = cell.getBoundingClientRect().right;
        if (right > lastColumnRight) lastColumnRight = right;
      });
      return {
        paneWidth: paneRect?.width ?? 0,
        lastColumnRight: paneRect ? lastColumnRight - paneRect.left : 0,
      };
    });
  }

  /**
   * The inner Gantt view's stored `tngantt_tableWidth`, or throws when no view
   * with a config reader is mounted — an absent reader must not masquerade as
   * an unset key.
   */
  async function readPersistedTableWidth(): Promise<unknown> {
    const probe = await browser.executeObsidian(({ app }) => {
      const SKIP = new Set([
        "app", "vault", "workspace", "containerEl", "contentEl", "scope",
        "leaf", "headerEl", "navigation", "owner", "metadataCache",
      ]);
      const seen = new Set<unknown>();
      const visit = (obj: unknown, depth: number): { found: boolean; value: unknown } | undefined => {
        if (!obj || typeof obj !== "object" || seen.has(obj) || depth > 6) return undefined;
        if ((obj as { nodeType?: number }).nodeType !== undefined) return undefined;
        seen.add(obj);
        const rec = obj as Record<string, unknown>;
        const cfg = rec.config as { get?: (k: string) => unknown } | undefined;
        if (cfg && typeof cfg.get === "function" && typeof rec.onDataUpdated === "function") {
          return { found: true, value: cfg.get("tngantt_tableWidth") };
        }
        for (const [key, val] of Object.entries(rec)) {
          if (SKIP.has(key)) continue;
          const found = visit(val, depth + 1);
          if (found) return found;
        }
        return undefined;
      };
      return visit(app.workspace.activeLeaf?.view, 0);
    });
    if (!probe?.found) throw new Error("no mounted view exposes a Bases config reader");
    return probe.value;
  }

  async function expectFittedUnpinned(): Promise<void> {
    const { paneWidth, lastColumnRight } = await measurePane();
    expect(paneWidth).toBeGreaterThan(0);
    // Every rendered column ends inside the clipping pane — not under the chart.
    expect(lastColumnRight).toBeLessThanOrEqual(paneWidth + 1);
    // The columns-fit seed is a fallback, not a stored choice — a reseed's
    // re-assert must not pin it (that would defeat the unset-write guard).
    // Outwait the persist debounce (wireGridWidthPersistence writes 300ms
    // after resize-grid) so a pending pin can't land after the assertion.
    await browser.pause(500);
    expect(await readPersistedTableWidth()).toBeNull();
  }

  it("seeds the pane to fit the rendered columns without persisting the auto width", async () => {
    await openBase("GridIcons.base");
    await expectFittedUnpinned();
    await openBase("GridIcons.base");
    await expectFittedUnpinned();
    // Host shrink: onResize re-asserts the fallback resolved against the NEW
    // host — a stale-snapshot re-assert would diverge from the resolved width
    // and the persist listener would pin it as a stored choice.
    await resizeWindow(760, 820);
    await browser.pause(500);
    expect(await readPersistedTableWidth()).toBeNull();
  });
});
