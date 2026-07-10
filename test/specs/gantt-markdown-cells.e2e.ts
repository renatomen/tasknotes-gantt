import { browser, expect } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Markdown grid-cell rendering spec (grid markdown cell rendering, U7).
 *
 * Boots Obsidian against the `test/vaults/gantt-markdown` fixture and proves the
 * runtime layer that unit tests can't: the property grid cell renders Obsidian
 * markdown via MarkdownRenderer (fed through Svelte context), so an `assignee`
 * column of wikilinks becomes clickable internal links and a `tags` column
 * becomes tag pills.
 *
 * This is also the empirical answer to U6's load-bearing assumptions:
 *  - Svelte `setContext` in GanttContainer reaches the SVAR-mounted PropertyCell
 *    (if it didn't, `app` would be undefined and the cell would fall back to
 *    plain text — no `a.internal-link` would appear).
 *  - MarkdownRenderer output carries Obsidian's native link/tag elements
 *    (`a.internal-link`, `a.tag`) that its global handlers wire for click/hover.
 *
 * SELECTOR NOTES:
 *  - property cells are `.og-grid-cell` (text) / `.og-grid-cell--md` (markdown).
 *  - Obsidian renders a wikilink as `<a class="internal-link">` and a tag as
 *    `<a class="tag" href="#...">`.
 *  - grid header cells carry `data-header-id` = the SVAR column id (Bases prop id,
 *    prefixed with `:` for string ids — match the stripped value).
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-markdown");

const ASSIGNEE_COLUMN_ID = "note.assignee";

interface GridState {
  mounted: boolean;
  assigneeHeader: boolean;
  /** Text of every rendered internal-link anchor in the property cells. */
  internalLinks: string[];
  /** Text of every rendered tag-pill anchor in the property cells. */
  tags: string[];
  /** Any property cell still showing raw `[[` markup (the bug this feature fixes). */
  rawBrackets: boolean;
  cellCount: number;
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
      const file = app.vault.getAbstractFileByPath("Markdown.base");
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
    if (!root) {
      return { mounted: false, assigneeHeader: false, internalLinks: [], tags: [], rawBrackets: false, cellCount: 0 };
    }
    const strip = (v: string): string => (v.startsWith(":") ? v.slice(1) : v);
    const assigneeHeader = Array.from(root.querySelectorAll<HTMLElement>("[data-header-id]")).some(
      (el) => strip(el.getAttribute("data-header-id") ?? "") === "note.assignee",
    );
    const cells = Array.from(root.querySelectorAll<HTMLElement>(".og-grid-cell"));
    const internalLinks = Array.from(root.querySelectorAll<HTMLElement>(".og-grid-cell a.internal-link")).map(
      (a) => a.textContent ?? "",
    );
    const tags = Array.from(root.querySelectorAll<HTMLElement>(".og-grid-cell a.tag")).map(
      (a) => a.textContent ?? "",
    );
    const rawBrackets = cells.some((c) => (c.textContent ?? "").includes("[["));
    return { mounted: true, assigneeHeader, internalLinks, tags, rawBrackets, cellCount: cells.length };
  });
}

/** Wait until the grid is mounted, the assignee column exists, and markdown rendered. */
async function ensureMarkdownGridReady(): Promise<void> {
  let last = "<never polled>";
  try {
    await browser.waitUntil(
      async () => {
        await activateBaseLeaf();
        const state = await readGridState();
        last = JSON.stringify(state);
        // internalLinks > 0 proves context reached the cell AND MarkdownRenderer ran.
        return state.mounted && state.assigneeHeader && state.internalLinks.length > 0;
      },
      { timeout: 90000, timeoutMsg: `Markdown grid not ready (column "${ASSIGNEE_COLUMN_ID}" + rendered links)` },
    );
  } catch {
    throw new Error(`Markdown grid not ready. Last observed: ${last}`);
  }
}

describe("Gantt (OG) markdown grid cells", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-gantt-markdown-cells-e2e");
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

    await ensureMarkdownGridReady();
  });

  it("renders assignee wikilinks as clickable internal links (AE2)", async () => {
    const state = await readGridState();
    // Both link targets exist in the vault, so both resolve as internal links.
    expect(state.internalLinks).toContain("Justin");
    expect(state.internalLinks).toContain("Hayden");
    // Every rendered link is a real anchor Obsidian's global handlers wire for
    // click/hover — the interactivity requirement (R2/R8).
    const hrefs = await browser.execute(() =>
      Array.from(document.querySelectorAll<HTMLElement>(".og-bases-gantt .og-grid-cell a.internal-link")).map(
        (a) => a.getAttribute("data-href") ?? a.getAttribute("href") ?? "",
      ),
    );
    expect(hrefs.every((h) => h.length > 0)).toBe(true);
  });

  it("renders tag values as tag pills with the injected # (AE1)", async () => {
    const state = await readGridState();
    // `tags` frontmatter stores values without `#`; the cell injects it so
    // MarkdownRenderer emits a tag pill.
    expect(state.tags.length).toBeGreaterThan(0);
    expect(state.tags.some((t) => t.replace(/^#/, "") === "t/note")).toBe(true);
  });

  it("does not leave raw wikilink markup in any cell (R1)", async () => {
    const state = await readGridState();
    expect(state.rawBrackets).toBe(false);
    expect(state.cellCount).toBeGreaterThan(0);
  });
});
