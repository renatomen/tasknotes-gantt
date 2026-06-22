import { browser, expect } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Companion expansion + sorting spec (plan 2026-06-22-001 U8).
 *
 * Boots Obsidian against the `test/vaults/gantt-companion` fixture with BOTH
 * tasknotes-gantt and TaskNotes enabled, opens a Base whose toolbar sort is
 * file.name and whose view is in companion **Show all** mode, and asserts the
 * companion behaviors that unit tests can't prove end-to-end:
 *
 *  - Show-all expands subtasks RECURSIVELY (AE2): Project A → Sub A1 → Sub A1a
 *    (two levels) all render, sourced from TaskNotes `projects` relationships.
 *  - A multi-parent task (Shared, child of Project A AND Project B) renders one
 *    instance under each parent, each carrying the replicated-instance cue
 *    (`.wx-bar.og-replicated`).
 *  - Fetched (out-of-filter) rows carry the context cue (`.wx-bar.og-context`);
 *    matched rows (the projects) do not.
 *  - Row order follows the Base toolbar sort (file.name → Project A before B).
 *
 * A second describe boots WITHOUT TaskNotes to prove standalone mode does NOT
 * expand (only the two filter-matched projects render).
 *
 * Why TaskNotes: subtask edges come only from TaskNotes (Bases has no parent/
 * child model for this). TaskNotes is installed from a pinned release by the
 * harness (see test/wdio/wdio.conf.mts), so this runs for any developer/CI with
 * no personal vault. The fixture relies on TaskNotes' DEFAULT task identification
 * (`#task` tag) and DEFAULT `projects` field, so no committed settings are needed.
 *
 * SELECTOR NOTES (verified against @svar-ui/svelte-gantt 2.7.0):
 *  - chart bars: `.wx-bar`, each with a `data-id` of the INSTANCE id. SVAR 2.7.0
 *    prefixes string ids with `:`. Root instance id == source path
 *    (`:Project A.md`); a nested instance chains its parents
 *    (`:Sub A1a.md#parent-Sub A1.md#parent-Project A.md`). So match a source by
 *    the STRIPPED id's `startsWith(path)` — not `endsWith` (nested ids end with
 *    the parent chain) and not `includes` (a path can appear in another's chain).
 *  - instance cues: `.wx-bar.og-replicated`, `.wx-bar.og-context` (U6 emits the
 *    registered task-type tokens as bare classes on the bar).
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
  "Shared.md": 2, // child of both projects → one instance per parent
};

/**
 * Force the OG Gantt to be the ACTIVE, visible leaf — the same self-healing
 * helper as the dependency spec (TaskNotes' first-run "Start Here" note opens
 * asynchronously and can steal the active leaf at any time, unmounting the Bases
 * view). Idempotent and cheap once the base is front, so it is safe to call on
 * every poll of every wait.
 */
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

interface GanttState {
  mounted: boolean;
  /** Stripped (no leading `:`) instance ids of every rendered bar, in DOM order. */
  ids: string[];
  /** Count of bars carrying the replicated cue. */
  replicated: number;
  /** Count of bars carrying the context cue. */
  context: number;
  /** Whether either matched project bar carries the (wrong) context cue. */
  projectHasContext: boolean;
  /** Host (chart region) height in px, for the min-height regression guard. */
  hostHeight: number;
}

/** Read the current Gantt render state in-page (robust vs. wdio CSS quirks). */
async function readGanttState(): Promise<GanttState> {
  return browser.execute(() => {
    const root = document.querySelector(".og-bases-gantt");
    if (!root) {
      return { mounted: false, ids: [], replicated: 0, context: 0, projectHasContext: false, hostHeight: 0 };
    }
    const bars = Array.from(root.querySelectorAll(".wx-bar"));
    const strip = (id: string): string => (id.startsWith(":") ? id.slice(1) : id);
    const ids = bars.map((b) => strip(b.getAttribute("data-id") ?? ""));
    const replicated = bars.filter((b) => b.classList.contains("og-replicated")).length;
    const context = bars.filter((b) => b.classList.contains("og-context")).length;
    const projectHasContext = bars.some(
      (b) =>
        b.classList.contains("og-context") &&
        (strip(b.getAttribute("data-id") ?? "").startsWith("Project A.md") ||
          strip(b.getAttribute("data-id") ?? "").startsWith("Project B.md")),
    );
    const chart = root.querySelector(".og-chart-area") as HTMLElement | null;
    const hostHeight = chart ? chart.getBoundingClientRect().height : 0;
    return { mounted: true, ids, replicated, context, projectHasContext, hostHeight };
  });
}

/** Count rendered instances whose stripped id starts with a source path. */
function instancesOf(ids: string[], sourcePath: string): number {
  return ids.filter((id) => id.startsWith(sourcePath)).length;
}

/** Names whose rendered instance count doesn't match the Show-all expectation. */
function missingNames(ids: string[]): string[] {
  return Object.entries(EXPECTED_INSTANCES)
    .filter(([name, n]) => instancesOf(ids, name) !== n)
    .map(([name, n]) => `${name} (want ${n}, saw ${instancesOf(ids, name)})`);
}

/**
 * Wait until the Gantt is active AND fully expanded (all six instances), re-
 * activating the base leaf on every poll so a starter-note steal can't stall it.
 */
async function ensureGanttReady(): Promise<void> {
  let last = "<never polled>";
  try {
    await browser.waitUntil(
      async () => {
        await activateBaseLeaf();
        const state = await readGanttState();
        last = JSON.stringify({ ids: state.ids, replicated: state.replicated, context: state.context });
        return state.mounted && missingNames(state.ids).length === 0;
      },
      { timeout: 90000, timeoutMsg: "Companion Gantt did not reach all six expected instances" },
    );
  } catch {
    throw new Error(`Companion Gantt not ready. Last observed: ${last}`);
  }
}

describe("Gantt (OG) companion expansion + sorting", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-gantt-companion-e2e");
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

    // Wait for the TaskNotes API to come up.
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

    // De-flake gate: `lifecycle.ready()` resolving does NOT mean the `projects`
    // wikilinks are resolved yet (Obsidian's metadata cache finishes building
    // asynchronously). The Gantt's open-time snapshot reads subtasks via
    // api.relationships.subtasks; if the base opens before the links resolve it
    // reads an unexpanded tree. Gate on the real signal: Project A resolves its
    // two subtasks AND Sub A1 resolves its nested subtask.
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
  });

  it("expands subtasks recursively under Show-all (AE2)", async () => {
    let missing: string[] = ["<unobserved>"];
    await browser.waitUntil(
      async () => {
        await activateBaseLeaf();
        const state = await readGanttState();
        missing = missingNames(state.ids);
        return state.mounted && missing.length === 0;
      },
      { timeout: 15000, timeoutMsg: () => `Instances missing/miscounted: ${JSON.stringify(missing)}` },
    );
    expect(missing).toEqual([]);
  });

  it("renders a multi-parent task once per parent, each with the replicated cue", async () => {
    let state: GanttState | null = null;
    await browser.waitUntil(
      async () => {
        await activateBaseLeaf();
        state = await readGanttState();
        return state.mounted && instancesOf(state.ids, "Shared.md") === 2 && state.replicated === 2;
      },
      {
        timeout: 15000,
        timeoutMsg: () =>
          `Expected 2 Shared instances + 2 replicated bars; saw ${state ? instancesOf(state.ids, "Shared.md") : "?"} / ${state?.replicated ?? "?"}`,
      },
    );
    // Exactly the two Shared instances are the replicated ones (nothing else dups).
    expect(instancesOf(state!.ids, "Shared.md")).toBe(2);
    expect(state!.replicated).toBe(2);
  });

  it("marks fetched (out-of-filter) rows as context, but not the matched projects", async () => {
    // Fetched under Show-all: Sub A1, Sub A1a, Shared×2 = 4 context bars.
    // Project A and Project B match the `project` filter → never context.
    let state: GanttState | null = null;
    await browser.waitUntil(
      async () => {
        await activateBaseLeaf();
        state = await readGanttState();
        return state.mounted && state.context === 4 && !state.projectHasContext;
      },
      {
        timeout: 15000,
        timeoutMsg: () => `Expected 4 context bars and no project context; saw ${state?.context ?? "?"} / projectHasContext=${state?.projectHasContext}`,
      },
    );
    expect(state!.context).toBe(4);
    expect(state!.projectHasContext).toBe(false);
  });

  it("orders top-level rows by the Base toolbar sort (file.name → A before B)", async () => {
    const state = await readGanttState();
    const idxA = state.ids.findIndex((id) => id.startsWith("Project A.md"));
    const idxB = state.ids.findIndex((id) => id.startsWith("Project B.md"));
    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxB).toBeGreaterThan(idxA);
  });

  it("keeps the chart at/above the minimum height (collapse-clip regression guard)", async () => {
    // The host (chart region) must never be a sliver — regression guard for the
    // collapse-clip fix (height applied to .og-chart-area) and the min-height
    // floor (GANTT_MIN_HEIGHT = 112).
    const state = await readGanttState();
    expect(state.hostHeight).toBeGreaterThanOrEqual(112);
  });
});

describe("Gantt (OG) standalone mode does not expand", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-gantt-companion-standalone-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    // No TaskNotes — standalone Bases datasource. Companion expansion is inert.
    await browser.reloadObsidian({ vault: tmpVault, plugins: ["tasknotes-gantt"] });

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
  });

  it("renders only the two filter-matched projects (no fetched subtasks)", async () => {
    let ids: string[] = [];
    await browser.waitUntil(
      async () => {
        await activateBaseLeaf();
        const state = await readGanttState();
        ids = state.ids;
        return (
          state.mounted &&
          instancesOf(ids, "Project A.md") === 1 &&
          instancesOf(ids, "Project B.md") === 1
        );
      },
      { timeout: 60000, timeoutMsg: () => `Standalone projects did not render; saw ${JSON.stringify(ids)}` },
    );
    // Standalone shows ONLY matched rows — no subtasks were fetched.
    expect(instancesOf(ids, "Sub A1.md")).toBe(0);
    expect(instancesOf(ids, "Sub A1a.md")).toBe(0);
    expect(instancesOf(ids, "Shared.md")).toBe(0);
  });
});
