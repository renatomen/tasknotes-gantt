/* global HTMLInputElement, Event */
import { browser, expect } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import type { GanttLifecycleControl } from "../../src/debugLog";
import {
  attemptSourcesFailureDiagnostics,
  captureSourcesCheckpoint,
  captureSourcesReadinessPoll,
  noteSourcesOriginalFailure,
  reportSourcesLifecycle,
  startSourcesLifecycleCapture,
  stopSourcesLifecycleCapture,
  verifySourcesDiagnosticEnvelope,
  writeSourcesRetrievalFailure,
} from "./helpers/calendarItemsSourcesLifecycle";
import { attemptDiagnosticOperation } from "./helpers/lifecycleTrace";
import { waitUntilOrExplain } from "./helpers/waitReady";

/**
 * Calendar-item sources spec: property-based events, timeblocks, the quick
 * source switcher, and Bases toolbar search — end to end against real
 * Obsidian + TaskNotes + SVAR.
 *
 * Boots the `test/vaults/gantt-calendar-items` fixture (copied to a disposable
 * temp vault) with tasknotes-gantt + TaskNotes enabled and BOTH the `bases`
 * and `daily-notes` core plugins on (the timeblock family resolves daily notes
 * from the daily-notes plugin's own folder/format options — default: vault
 * root, `YYYY-MM-DD`, matching the fixture's `2026-03-11.md`).
 *
 * Journeys (ordered; toggles persist into the temp vault's live view):
 *  1. property events → nothing renders with the family ON but the start
 *     picker unset; pointing the picker at `note.eventStart` renders exactly
 *     the query-scoped Conference event (title from the title picker) and
 *     never the query-EXCLUDED note carrying the same property;
 *  2. timeblocks      → the daily note's two valid blocks render as one-day
 *     read-only event rows; a live frontmatter edit adding a third block
 *     repaints within the watch-settle + refresh-debounce budget;
 *  3. quick switcher  → the registered command opens the modal listing the
 *     active sources; unchecking Timeblocks hides its rows instantly and
 *     display-only (config read-back unchanged, other sources untouched);
 *     re-checking restores them;
 *  4. toolbar search  → the Bases search narrows ENTRY-derived rows (task
 *     bars, property events) while vault-walk-derived timeblock rows stay;
 *     clearing restores everything (settle, no storm).
 *
 * SELECTOR NOTES:
 *  - event rows: `.wx-bar.og-event` with `data-id` carrying the synthetic
 *    calendar-item id (`og-calendar://<family>/<encoded-series>[@<encoded-qualifier>]`), so
 *    family and backing note are both read off `data-id`.
 *  - switcher modal: `.modal .og-source-switcher-row` (label text in
 *    `.og-source-switcher-name`, native checkbox input).
 *  - Bases toolbar search (maintainer-confirmed DOM): magnifier
 *    `.bases-toolbar-search`, input `.document-search-input input[type=search]`,
 *    clear `.search-input-clear-button`.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-calendar-items");

const DAY_BASE = "CalendarItems.base";
const RECURRING_NOTE = "Weekly Standup.md";
const OCCURRENCE_NOTE = "Standup 2026-03-23.md";
const TRACKED_NOTE = "Tracked Work.md";
const TASK_NOTES = [RECURRING_NOTE, OCCURRENCE_NOTE, TRACKED_NOTE];
const DAILY_NOTE = "2026-03-11.md";

/** Watch settle (500ms) + refresh debounce (500ms) + index/render overhead. */
const REPAINT_BUDGET_MS = 10000;
type SourcesRunnerFailureReporter = (testTitle: string, error: unknown) => Promise<void>;

interface SourcesDiagnosticNodeGlobal {
  __tnGanttLegendRunnerFailureReporter?: SourcesRunnerFailureReporter;
}

let sourcesBeforeEachSequence = 0;
let sourcesSuitePrimaryError: unknown = null;
const sourcesPrimaryErrors = new WeakMap<object, unknown>();

function rememberSourcesPrimaryError(error: unknown): void {
  if (sourcesSuitePrimaryError === null || sourcesSuitePrimaryError === undefined) {
    sourcesSuitePrimaryError = error;
  }
}

async function captureSourcesDiagnostic(
  origin: string,
  operation: () => Promise<unknown>,
): Promise<void> {
  const diagnosticFailure = await attemptDiagnosticOperation(operation);
  if (diagnosticFailure !== null) {
    writeSourcesRetrievalFailure(origin, diagnosticFailure, null);
  }
}

const CALENDAR_CONFIG_KEYS = [
  "tngantt_showRecurring",
  "tngantt_showCompletedRecurringInstances",
  "tngantt_showSkippedRecurringInstances",
  "tngantt_showTimeEntries",
  "tngantt_showTimeblocks",
  "tngantt_showPropertyBasedEvents",
  "tngantt_propertyEventStart",
  "tngantt_propertyEventEnd",
  "tngantt_propertyEventTitle",
];

/** Force the OG Gantt to be the ACTIVE, visible leaf (starter-note steal heal). */
async function activateBaseLeaf(diagnosticCheckpoint?: string): Promise<void> {
  await browser.executeObsidian(async ({ app }, args) => {
    const ws = app.workspace as unknown as {
      iterateAllLeaves: (cb: (l: { view?: { getViewType?: () => string }; detach?: () => void }) => void) => void;
      getLeavesOfType: (t: string) => unknown[];
      getLeaf: (newLeaf?: boolean) => { openFile: (f: unknown) => Promise<void> };
      setActiveLeaf: (l: unknown, opts?: { focus?: boolean }) => void;
      revealLeaf: (l: unknown) => void;
    };
    let baseLeaf = ws.getLeavesOfType("bases")[0];
    if (!baseLeaf) {
      const file = app.vault.getAbstractFileByPath(args.basePath);
      if (!file) return;
      const leaf = ws.getLeaf(false);
      await leaf.openFile(file as never);
      baseLeaf = leaf;
    }
    const markdownLeaves: Array<{ detach?: () => void }> = [];
    ws.iterateAllLeaves((l) => {
      if (l.view?.getViewType?.() === "markdown") markdownLeaves.push(l);
    });
    markdownLeaves.forEach((l) => l.detach?.());
    ws.setActiveLeaf(baseLeaf, { focus: true });
    ws.revealLeaf(baseLeaf);
    if (args.diagnosticCheckpoint) {
      const diagnosticGlobal = globalThis as typeof globalThis & {
        __tnGanttLifecycle?: GanttLifecycleControl;
        __tnGanttSourcesPhaseCheckpoint?: string;
      };
      if (diagnosticGlobal.__tnGanttSourcesPhaseCheckpoint === args.diagnosticCheckpoint) return;
      diagnosticGlobal.__tnGanttSourcesPhaseCheckpoint = args.diagnosticCheckpoint;
      const control = diagnosticGlobal.__tnGanttLifecycle;
      control?.setPhase("before-each");
      control?.record({
        scope: "calendar-items-sources",
        mountToken: 0,
        controllerStarted: null,
        controllerDelivered: null,
        svarGeneration: null,
        event: "sources-phase",
        facts: { checkpoint: args.diagnosticCheckpoint },
      });
    }
  }, { basePath: DAY_BASE, diagnosticCheckpoint });
}

/** Which of the fixture's three task bars are missing from the rendered chart. */
async function missingBars(): Promise<string[]> {
  return browser.execute((names: string[]) => {
    const root = document.querySelector(".og-bases-gantt");
    if (!root) return ["<.og-bases-gantt absent>"];
    const ids = Array.from(root.querySelectorAll(".wx-bar")).map((b) => b.getAttribute("data-id") ?? "");
    return names.filter((n) => !ids.some((id) => id.endsWith(n)));
  }, TASK_NOTES);
}

/** Wait until the base leaf is front and every fixture task bar is rendered. */
async function ensureGanttReady(diagnosticCheckpoint?: string): Promise<void> {
  let missing: string[] = ["<never polled>"];
  await waitUntilOrExplain(
    async () => {
      await activateBaseLeaf(diagnosticCheckpoint);
      missing = diagnosticCheckpoint
        ? await captureSourcesReadinessPoll(diagnosticCheckpoint, TASK_NOTES)
        : await missingBars();
      return missing.length === 0;
    },
    () => `Gantt bars missing: ${JSON.stringify(missing)}`,
    { timeout: 90000 },
  );
}

/** Set a per-view option the way the live options panel does (proven pattern). */
async function fireConfigToggle(
  key: string,
  value: unknown,
): Promise<{ set: boolean; configChanged: boolean }> {
  return browser.executeObsidian(
    ({ app }, k, v) => {
      const diagnosticGlobal = globalThis as typeof globalThis & {
        __tnGanttLifecycle?: GanttLifecycleControl;
        __tnGanttSourcesActionHistory?: string[];
      };
      const lifecycle = diagnosticGlobal.__tnGanttLifecycle;
      diagnosticGlobal.__tnGanttSourcesActionHistory?.push(`${k}:start`);
      lifecycle?.setPhase("config-action-start");
      lifecycle?.record({
        scope: "calendar-items-sources",
        mountToken: 0,
        controllerStarted: null,
        controllerDelivered: null,
        svarGeneration: null,
        event: "sources-config-action-start",
        facts: { action: k },
      });
      const ws = app.workspace as unknown as {
        getLeavesOfType: (t: string) => Array<{ view?: Record<string, unknown> }>;
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
      diagnosticGlobal.__tnGanttSourcesActionHistory?.push(`${k}:observed`);
      lifecycle?.setPhase("config-action-observed");
      lifecycle?.record({
        scope: "calendar-items-sources",
        mountToken: 0,
        controllerStarted: null,
        controllerDelivered: null,
        svarGeneration: null,
        event: "sources-config-action-observed",
        facts: { action: k, set, configChanged },
      });
      return { set, configChanged };
    },
    key,
    value,
  );
}

/** Read per-view option values off the SAME mounted view `fireConfigToggle` writes. */
async function readViewConfig(keys: readonly string[]): Promise<Record<string, unknown> | null> {
  return browser.executeObsidian(
    ({ app }, ks) => {
      const ws = app.workspace as unknown as {
        getLeavesOfType: (t: string) => Array<{ view?: Record<string, unknown> }>;
      };
      const SKIP = new Set([
        "app", "vault", "workspace", "containerEl", "contentEl", "scope",
        "leaf", "headerEl", "navigation", "owner", "metadataCache",
      ]);
      const seen = new Set<unknown>();
      let result: Record<string, unknown> | null = null;
      const shouldSkipTraversal = (obj: unknown, depth: number): boolean =>
        !obj
        || typeof obj !== "object"
        || seen.has(obj)
        || depth > 6
        || (obj as { nodeType?: number }).nodeType !== undefined;
      const visit = (obj: unknown, depth: number): void => {
        if (result || shouldSkipTraversal(obj, depth)) return;
        seen.add(obj);
        const rec = obj as Record<string, unknown>;
        const cfg = rec.config as { get?: (kk: string) => unknown } | undefined;
        if (cfg && typeof cfg.get === "function" && typeof rec.onDataUpdated === "function") {
          result = Object.fromEntries(ks.map((k) => [k, cfg.get!(k)]));
          return;
        }
        for (const childKey of Object.keys(rec)) {
          if (SKIP.has(childKey)) continue;
          let child: unknown;
          try { child = rec[childKey]; } catch { continue; }
          if (child && typeof child === "object") visit(child, depth + 1);
        }
      };
      for (const leaf of ws.getLeavesOfType("bases")) if (leaf.view) visit(leaf.view, 0);
      return result;
    },
    keys as string[],
  );
}

/** Census of rendered calendar-item EVENT bars, split by family via data-id. */
interface EventBarCensus {
  propertyIds: string[];
  timeblockIds: string[];
  externalIds: string[];
  total: number;
}

async function eventBars(): Promise<EventBarCensus> {
  return browser.execute(() => {
    const root = document.querySelector(".og-bases-gantt");
    const ids = Array.from(root?.querySelectorAll(".wx-bar.og-event") ?? []).map(
      (b) => b.getAttribute("data-id") ?? "",
    );
    return {
      propertyIds: ids.filter((id) => id.includes("property-event/")),
      timeblockIds: ids.filter((id) => id.includes("timeblock/")),
      externalIds: ids.filter((id) => id.includes("external-event/")),
      total: ids.length,
    };
  });
}

/** Which of the given task-note names currently have a rendered bar. */
async function presentTaskBars(): Promise<string[]> {
  return browser.execute((names: string[]) => {
    const root = document.querySelector(".og-bases-gantt");
    const ids = Array.from(root?.querySelectorAll(".wx-bar") ?? []).map(
      (b) => b.getAttribute("data-id") ?? "",
    );
    return names.filter((n) => ids.some((id) => id.endsWith(n)));
  }, TASK_NOTES);
}

/** Run the registered quick-source-switcher command; true = it executed. */
async function runQuickSwitcherCommand(): Promise<boolean> {
  return browser.executeObsidian(({ app }) => {
    const commands = (app as unknown as {
      commands?: { executeCommandById?: (id: string) => boolean };
    }).commands;
    return commands?.executeCommandById?.("tasknotes-gantt:quick-source-switcher") === true;
  });
}

/** The switcher modal's row labels (empty when the modal is not open). */
async function switcherRowLabels(): Promise<string[]> {
  return browser.execute(() =>
    Array.from(
      document.querySelectorAll(".modal .og-source-switcher-row .og-source-switcher-name"),
    ).map((el) => el.textContent ?? ""),
  );
}

/** Click the checkbox of the switcher row with this label; true = clicked. */
async function toggleSwitcherRow(label: string): Promise<boolean> {
  return browser.execute((wanted: string) => {
    for (const row of Array.from(document.querySelectorAll(".modal .og-source-switcher-row"))) {
      const name = row.querySelector(".og-source-switcher-name")?.textContent ?? "";
      if (name !== wanted) continue;
      const checkbox = row.querySelector("input[type='checkbox']") as HTMLInputElement | null;
      if (!checkbox) return false;
      checkbox.click();
      return true;
    }
    return false;
  }, label);
}

async function closeModal(): Promise<void> {
  await browser.execute(() => {
    (document.querySelector(".modal-container .modal-close-button") as HTMLElement | null)?.click();
  });
}

/** Reveal the Bases toolbar search (if hidden) and type a term char-by-char. */
async function revealSearchAndType(term: string): Promise<void> {
  await activateBaseLeaf();
  const hasInput = (): Promise<boolean> =>
    browser.execute(() => !!document.querySelector(".document-search-input input[type='search']"));
  if (!(await hasInput())) {
    await browser.execute(() => {
      const mag = document.querySelector(
        ".bases-toolbar-search .text-icon-button, .bases-toolbar-search",
      ) as HTMLElement | null;
      mag?.click();
    });
  }
  await browser.waitUntil(hasInput, {
    timeout: 10000,
    timeoutMsg: "Bases toolbar search input never appeared",
  });
  // Per-char typing (the probe-proven gesture: Obsidian's search component
  // tracks keystrokes, a single synthetic input with a pre-set value is not
  // reliably observed).
  await browser.execute((t: string) => {
    const el = document.querySelector(
      ".document-search-input input[type='search']",
    ) as HTMLInputElement | null;
    if (!el) return;
    el.focus();
    el.value = "";
    for (const ch of t) {
      el.value += ch;
      el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: ch }));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, term);
}

async function clearSearch(): Promise<void> {
  await browser.execute(() => {
    const btn = document.querySelector(".search-input-clear-button") as HTMLElement | null;
    btn?.click();
    const el = document.querySelector(
      ".document-search-input input[type='search']",
    ) as HTMLInputElement | null;
    if (!el) return;
    el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The live search UI state, for failure diagnostics. */
async function searchState(): Promise<{ value: string; count: string }> {
  return browser.execute(() => ({
    value:
      (document.querySelector(".document-search-input input[type='search']") as HTMLInputElement | null)
        ?.value ?? "<no input>",
    count:
      (document.querySelector(".document-search-count") as HTMLElement | null)?.textContent ?? "",
  }));
}

describe("Gantt (OG) calendar items — property events, timeblocks, switcher, search", () => {
  before(async () => {
    sourcesSuitePrimaryError = null;
    try {
    // Hermetic: copy the in-repo fixture to a disposable temp dir.
    const tmpVault = path.join(os.tmpdir(), "og-gantt-calendar-sources-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({
      vault: tmpVault,
      plugins: ["tasknotes-gantt", "tasknotes"],
    });
    sourcesBeforeEachSequence = 0;
    await captureSourcesDiagnostic("collector-start", startSourcesLifecycleCapture);
    (globalThis as SourcesDiagnosticNodeGlobal).__tnGanttLegendRunnerFailureReporter =
      async (testTitle, error) => {
        rememberSourcesPrimaryError(error);
        noteSourcesOriginalFailure();
        const origin = `afterTest:${testTitle}`;
        const diagnosticFailure = await attemptSourcesFailureDiagnostics(origin, error);
        if (diagnosticFailure !== null) {
          writeSourcesRetrievalFailure(origin, diagnosticFailure, error);
        }
      };

    // Core plugins: `bases` opens the .base files; `daily-notes` makes the
    // fixture's `2026-03-11.md` a daily note (default folder/format).
    await browser.executeObsidian(async ({ app }) => {
      const ip = (app as unknown as { internalPlugins?: {
        getPluginById?: (id: string) => { enabled?: boolean; enable?: (o?: unknown) => unknown } | undefined;
        enablePluginAndSave?: (id: string) => unknown;
      } }).internalPlugins;
      for (const id of ["bases", "daily-notes"]) {
        const plugin = ip?.getPluginById?.(id);
        if (plugin && !plugin.enabled) {
          await (ip?.enablePluginAndSave?.(id) ?? plugin.enable?.({ reloadApp: false }));
        }
      }
    });

    // Gate: the TaskNotes API is up (the default recurring source lists tasks
    // through it; gating avoids first-render churn racing the journeys).
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

    await ensureGanttReady();
    await captureSourcesDiagnostic("initial-readiness", () =>
      captureSourcesCheckpoint("initial-readiness", "initial-readiness"));
    } catch (error) {
      rememberSourcesPrimaryError(error);
      noteSourcesOriginalFailure();
      const diagnosticFailure = await attemptSourcesFailureDiagnostics("before-hook", error);
      if (diagnosticFailure !== null) {
        writeSourcesRetrievalFailure("before-hook", diagnosticFailure, error);
      }
      throw error;
    }
  });

  beforeEach(async function () {
    const currentTest = this.currentTest as {
      title?: string;
      fn?: (this: unknown, ...args: unknown[]) => unknown;
    } | undefined;
    const originalTest = currentTest?.fn;
    if (currentTest && originalTest) {
      currentTest.fn = async function (this: unknown, ...args: unknown[]): Promise<unknown> {
        try {
          return await originalTest.apply(this, args);
        } catch (error) {
          rememberSourcesPrimaryError(error);
          sourcesPrimaryErrors.set(currentTest, error);
          throw error;
        }
      };
    }
    sourcesBeforeEachSequence += 1;
    const checkpoint = `before-each:${sourcesBeforeEachSequence}:${currentTest?.title ?? "unknown"}`;
    try {
      await ensureGanttReady(checkpoint);
      await captureSourcesDiagnostic(checkpoint, () =>
        captureSourcesCheckpoint("before-each", checkpoint));
    } catch (error) {
      rememberSourcesPrimaryError(error);
      if (currentTest) sourcesPrimaryErrors.set(currentTest, error);
      noteSourcesOriginalFailure();
      const origin = `beforeEach:${checkpoint}`;
      const diagnosticFailure = await attemptSourcesFailureDiagnostics(origin, error);
      if (diagnosticFailure !== null) {
        writeSourcesRetrievalFailure(origin, diagnosticFailure, error);
      }
      throw error;
    }
  });

  afterEach(async function () {
    const currentTest = this.currentTest as { title?: string; err?: unknown } | undefined;
    const primaryError = (currentTest ? sourcesPrimaryErrors.get(currentTest) : undefined) ?? currentTest?.err;
    if (primaryError === null || primaryError === undefined) return;
    rememberSourcesPrimaryError(primaryError);
    noteSourcesOriginalFailure();
    const origin = `test:${currentTest?.title ?? "unknown"}`;
    const diagnosticFailure = await attemptSourcesFailureDiagnostics(origin, primaryError);
    if (diagnosticFailure !== null) {
      writeSourcesRetrievalFailure(origin, diagnosticFailure, primaryError);
    }
  });

  after(async function () {
    this.timeout(60000);
    if (sourcesSuitePrimaryError !== null && sourcesSuitePrimaryError !== undefined) {
      const diagnosticFailure = await attemptSourcesFailureDiagnostics(
        "suite-after",
        sourcesSuitePrimaryError,
      );
      if (diagnosticFailure !== null) {
        writeSourcesRetrievalFailure("suite-after", diagnosticFailure, sourcesSuitePrimaryError);
      }
    } else {
      await captureSourcesDiagnostic("suite-after", async () => {
        await captureSourcesCheckpoint("suite-after", "suite-after");
        await reportSourcesLifecycle("suite-after", null);
        await stopSourcesLifecycleCapture();
      });
    }
    delete (globalThis as SourcesDiagnosticNodeGlobal).__tnGanttLegendRunnerFailureReporter;
  });

  it("renders property events only when the family is on AND the start picker is set, scoped by the query", async () => {
    // Family ON, start picker UNSET: emission requires both, so nothing may
    // appear. Give the toggle a full refresh cycle to (wrongly) emit, then
    // assert zero — the picker step below proves the same pipeline is live
    // (mutation check: a broken gate would render rows right here).
    const toggled = await fireConfigToggle("tngantt_showPropertyBasedEvents", true);
    expect(toggled.set && toggled.configChanged).toBe(true);
    await browser.pause(2500);
    await activateBaseLeaf();
    const beforePicker = await eventBars();
    expect(beforePicker.propertyIds).toEqual([]);

    // Point the pickers at the fixture's mapped properties (never hardcoded
    // names in product code — the pickers ARE the mapping).
    for (const [key, value] of [
      ["tngantt_propertyEventStart", "note.eventStart"],
      ["tngantt_propertyEventEnd", "note.eventEnd"],
      ["tngantt_propertyEventTitle", "note.eventTitle"],
    ] as const) {
      const fired = await fireConfigToggle(key, value);
      expect(fired.set && fired.configChanged).toBe(true);
    }

    // Readiness keyed on the exact rows the assertions consume: exactly the
    // Conference event, never the query-excluded note.
    let census: EventBarCensus = { propertyIds: [], timeblockIds: [], externalIds: [], total: -1 };
    await waitUntilOrExplain(
      async () => {
        await activateBaseLeaf();
        census = await eventBars();
        return census.propertyIds.some((id) => id.endsWith("property-event/Conference.md"));
      },
      () => `Conference property event never rendered; last: ${JSON.stringify(census)}`,
      { timeout: 20000 },
    );
    expect(census.propertyIds).toHaveLength(1);
    expect(census.propertyIds[0].endsWith("property-event/Conference.md")).toBe(true);
    // Query scoping: the excluded note carries the same start property but is
    // filtered out of this view's query, so it must contribute nothing.
    expect(census.propertyIds.some((id) => id.includes("Excluded Event.md"))).toBe(false);

    // The title picker resolved `eventTitle` (not the file basename). The
    // resolution can land a beat after the bar itself renders, so the check
    // waits for the title rather than racing it — three CI runs and one local
    // run lost that race before this settled.
    let showsTitle = false;
    await browser.waitUntil(
      async () => {
        showsTitle = await browser.execute(
          () =>
            (document.querySelector(".og-bases-gantt") as HTMLElement | null)?.textContent?.includes(
              "March Conference",
            ) ?? false,
        );
        return showsTitle;
      },
      { timeout: 10000, timeoutMsg: "property event title never resolved into the view" },
    );
    expect(showsTitle).toBe(true);
  });

  it("captures a complete property-event diagnostic envelope without a causal verdict", async () => {
    const verification = await verifySourcesDiagnosticEnvelope("property-events-diagnostic");

    expect(verification.diagnosticOutcome).toBe("captured");
    expect(verification.originalOutcome).toBe("passed");
    expect(verification.expectedMarkersPresent).toBe(true);
    expect(verification.snapshot.completeness.configActions).toBe(true);
    expect(verification.snapshot.completeness.targetFileAndCache).toBe(true);
    expect(verification.snapshot.completeness.taskNotesFacts).toBe(true);
    expect(verification.snapshot.disqualifiers.collectorFailure).toBe(false);
    expect(verification.snapshot.disqualifiers.overflow).toBe(false);
    expect(verification.verdict).toEqual({ status: "open" });
  });

  it("renders daily-note timeblocks when enabled and repaints on a live frontmatter edit", async () => {
    const fired = await fireConfigToggle("tngantt_showTimeblocks", true);
    expect(fired.set && fired.configChanged).toBe(true);

    // Readiness keyed on the exact rows: both fixture blocks of 2026-03-11.
    let census: EventBarCensus = { propertyIds: [], timeblockIds: [], externalIds: [], total: -1 };
    await waitUntilOrExplain(
      async () => {
        await activateBaseLeaf();
        census = await eventBars();
        return (
          census.timeblockIds.some((id) => id.endsWith("@tb-morning"))
          && census.timeblockIds.some((id) => id.endsWith("@tb-afternoon"))
        );
      },
      () => `fixture timeblocks never rendered; last: ${JSON.stringify(census)}`,
      { timeout: 20000 },
    );
    expect(census.timeblockIds).toHaveLength(2);
    expect(census.timeblockIds.every((id) => id.includes(`timeblock/${DAILY_NOTE}`))).toBe(true);

    // Live frontmatter edit through the real Obsidian API: add a third block.
    const edited = await browser.executeObsidian(async ({ app }, dailyNote) => {
      const file = app.vault.getAbstractFileByPath(dailyNote);
      if (!file) return false;
      const fileManager = (app as unknown as {
        fileManager: {
          processFrontMatter: (f: unknown, fn: (fm: Record<string, unknown>) => void) => Promise<void>;
        };
      }).fileManager;
      await fileManager.processFrontMatter(file, (fm) => {
        const blocks = Array.isArray(fm.timeblocks) ? fm.timeblocks : [];
        fm.timeblocks = [
          ...blocks,
          { id: "tb-added", title: "Added block", startTime: "15:00", endTime: "16:00" },
        ];
      });
      return true;
    }, DAILY_NOTE);
    expect(edited).toBe(true);

    // The repaint budget: metadata index + watch settle (500ms) + refresh
    // debounce (500ms) + render. The waitUntil timeout IS the budget.
    const editStarted = Date.now();
    await waitUntilOrExplain(
      async () => {
        await activateBaseLeaf();
        census = await eventBars();
        return census.timeblockIds.some((id) => id.endsWith("@tb-added"));
      },
      () =>
        `edited timeblock never repainted within ${REPAINT_BUDGET_MS}ms; last: ${JSON.stringify(census)}`,
      { timeout: REPAINT_BUDGET_MS },
    );
    const repaintMs = Date.now() - editStarted;
    expect(repaintMs).toBeLessThanOrEqual(REPAINT_BUDGET_MS);
    expect(census.timeblockIds).toHaveLength(3);
  });

  it("hides a source's rows instantly via the quick switcher command, leaving view options untouched", async () => {
    // Preconditions from the prior journeys: 2+ timeblock rows, 1 property row.
    const preCensus = await eventBars();
    expect(preCensus.timeblockIds.length).toBeGreaterThanOrEqual(2);
    expect(preCensus.propertyIds).toHaveLength(1);
    const configBefore = await readViewConfig(CALENDAR_CONFIG_KEYS);
    expect(configBefore).not.toBeNull();
    expect(configBefore!["tngantt_showTimeblocks"]).toBe(true);

    // Drive the REGISTERED command (the palette path), not the toolbar button.
    expect(await runQuickSwitcherCommand()).toBe(true);
    let labels: string[] = [];
    await browser.waitUntil(
      async () => {
        labels = await switcherRowLabels();
        return labels.length > 0;
      },
      { timeout: 10000, timeoutMsg: "switcher modal never opened via the command" },
    );
    expect(labels).toContain("Timeblocks");
    expect(labels).toContain("Property-based events");

    // Uncheck Timeblocks: rows must hide INSTANTLY (display filter, no
    // refresh cycle) while the property event and the task bars stay.
    expect(await toggleSwitcherRow("Timeblocks")).toBe(true);
    let census: EventBarCensus = { propertyIds: [], timeblockIds: [], externalIds: [], total: -1 };
    await waitUntilOrExplain(
      async () => {
        census = await eventBars();
        return census.timeblockIds.length === 0;
      },
      () => `timeblock rows did not hide instantly; last: ${JSON.stringify(census)}`,
      { timeout: 3000 },
    );
    expect(census.timeblockIds).toEqual([]);
    expect(census.propertyIds).toHaveLength(1);
    expect(await missingBars()).toEqual([]);

    // Display-only by construction: EVERY per-view option is byte-identical.
    const configAfter = await readViewConfig(CALENDAR_CONFIG_KEYS);
    expect(configAfter).toEqual(configBefore);
    expect(configAfter!["tngantt_showTimeblocks"]).toBe(true);

    // Re-check restores the rows (same instant path), then close the modal.
    expect(await toggleSwitcherRow("Timeblocks")).toBe(true);
    await waitUntilOrExplain(
      async () => {
        census = await eventBars();
        return census.timeblockIds.length === 3;
      },
      () => `timeblock rows did not restore; last: ${JSON.stringify(census)}`,
      { timeout: 3000 },
    );
    await closeModal();
  });

  it("filters entry-derived rows via Bases toolbar search while timeblock rows stay visible", async () => {
    await revealSearchAndType("Tracked");

    // Entry-derived rows narrow: only the matching task bar survives and the
    // property event (scoped by the query) drops; the timeblock rows derive
    // from the daily-note walk, not the entry set, so they STAY.
    let tasks: string[] = [];
    let census: EventBarCensus = { propertyIds: [], timeblockIds: [], externalIds: [], total: -1 };
    let search = { value: "<never read>", count: "" };
    await waitUntilOrExplain(
      async () => {
        await activateBaseLeaf();
        tasks = await presentTaskBars();
        census = await eventBars();
        search = await searchState();
        return tasks.length === 1 && census.propertyIds.length === 0;
      },
      () =>
        `search never narrowed entry-derived rows; tasks=${JSON.stringify(tasks)} census=${JSON.stringify(census)} search=${JSON.stringify(search)}`,
      {
        // The R-changing search path settles through readiness re-checks with
        // backoff, so it lands well after a plain config refresh would.
        timeout: 45000,
      },
    );
    expect(tasks).toEqual([TRACKED_NOTE]);
    expect(census.propertyIds).toEqual([]);
    expect(census.timeblockIds).toHaveLength(3);

    // Clearing restores every entry-derived row (settled, no storm).
    await clearSearch();
    await waitUntilOrExplain(
      async () => {
        await activateBaseLeaf();
        tasks = await presentTaskBars();
        census = await eventBars();
        search = await searchState();
        return tasks.length === TASK_NOTES.length && census.propertyIds.length === 1;
      },
      () =>
        `clear never restored rows; tasks=${JSON.stringify(tasks)} census=${JSON.stringify(census)} search=${JSON.stringify(search)}`,
      { timeout: 45000 },
    );
    expect(tasks).toEqual(TASK_NOTES);
    expect(census.timeblockIds).toHaveLength(3);
  });
});
