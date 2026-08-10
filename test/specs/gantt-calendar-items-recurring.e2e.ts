/* global MouseEvent, EventTarget */
import { browser, expect } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { waitUntilOrExplain } from "./helpers/waitReady";

/**
 * Calendar-item slice-1 spec: recurring-instance occupancy + time-entry event
 * rows, end to end against real Obsidian + TaskNotes + SVAR.
 *
 * Boots the `test/vaults/gantt-calendar-items` fixture with BOTH tasknotes-gantt
 * and TaskNotes enabled (the calendar-item families read the raw TaskNotes task
 * list: recurrence state and time entries have no Bases representation). The
 * fixture pins fixed 2026-03 dates — the derivation window anchors at the task
 * spans, so the run date never moves the bars.
 *
 * Journeys (ordered; each toggle persists into the disposable temp vault):
 *  1. defaults        → dataset parity with the TaskNotes calendar: recorded
 *                       (completed/skipped) and materialized instances render
 *                       as pieces on the union envelope with the plain-span
 *                       piece, recurring toggle OFF included; NO virtual
 *                       (next/projected) pieces, NO event rows, NO spines —
 *                       the opt-in-off promise for every other family;
 *  2. recurring ON    → instance pieces with distinct state classes, the
 *                       materialized dual representation, and the occupancy
 *                       envelope replacing the plain scheduled→due bar;
 *  3. recurring OFF   → the union envelope is RETAINED: the plain-span piece
 *                       (`og-instance-plain`) joins the recorded pieces;
 *                       projected/next pieces are gone;
 *  4. overlay editing → with recorded pieces inside the authored task span and
 *                       recurring OFF, resizing the task writes its due date;
 *  5. time entries ON → read-only `og-event` rows; a drag gesture on one leaves
 *                       its geometry unchanged and its mutating affordances hidden;
 *  6. month scale     → the recurring row shows the dashed series spine, no
 *                       per-day pieces (separate base pinned at month zoom).
 *
 * SELECTOR NOTES (owned by this plugin unless stated):
 *  - `.wx-bar` (SVAR) carries our cue classes: `og-recurring` (occupancy
 *    present), `og-event` (calendar-item event row), and SVAR's own `wx-split`
 *    when the occupancy ENVELOPE replaced the plain bar's fill.
 *  - instance pieces: `.og-instance.og-instance-<state>` inside the host bar
 *    (states: next | projected | completed | skipped | materialized).
 *  - coarse-zoom fallback: `.og-series-spine` inside the host bar.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-calendar-items");

const DAY_BASE = "CalendarItems.base";
const MONTH_BASE = "CalendarItemsMonth.base";
const RECURRING_NOTE = "Weekly Standup.md";
const OCCURRENCE_NOTE = "Standup 2026-03-23.md";
const TRACKED_NOTE = "Tracked Work.md";
const TASK_NOTES = [RECURRING_NOTE, OCCURRENCE_NOTE, TRACKED_NOTE];

let currentBase = DAY_BASE;

/**
 * Force the OG Gantt to be the ACTIVE, visible leaf.
 *
 * TaskNotes creates and opens a "Start Here" starter note asynchronously on
 * first install, and that open can steal the active leaf at any moment; a Bases
 * view unmounts its content while its leaf is backgrounded, so the Gantt DOM
 * vanishes until the leaf is re-fronted (the dependency-types spec's healed
 * flake). Detaching markdown leaves and re-asserting the base leaf is
 * idempotent and cheap, so every wait below calls it on every poll.
 */
async function activateBaseLeaf(): Promise<void> {
  await browser.executeObsidian(async ({ app }, basePath) => {
    const ws = app.workspace as unknown as {
      iterateAllLeaves: (cb: (l: { view?: { getViewType?: () => string }; detach?: () => void }) => void) => void;
      getLeavesOfType: (t: string) => unknown[];
      getLeaf: (newLeaf?: boolean) => { openFile: (f: unknown) => Promise<void> };
      setActiveLeaf: (l: unknown, opts?: { focus?: boolean }) => void;
      revealLeaf: (l: unknown) => void;
    };
    let baseLeaf = ws.getLeavesOfType("bases")[0];
    if (!baseLeaf) {
      const file = app.vault.getAbstractFileByPath(basePath);
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
  }, currentBase);
}

/** Which of the fixture's three task bars are missing from the rendered chart. */
async function missingBars(): Promise<string[]> {
  return browser.execute((names: string[]) => {
    const root = document.querySelector(".og-bases-gantt");
    if (!root) return ["<.og-bases-gantt absent>"];
    // Matched in-page by endsWith: `data-id` carries a ":" prefix and spaces,
    // which the wdio CSS selector engine handles unreliably.
    const ids = Array.from(root.querySelectorAll(".wx-bar")).map((b) => b.getAttribute("data-id") ?? "");
    return names.filter((n) => !ids.some((id) => id.endsWith(n)));
  }, TASK_NOTES);
}

/** Wait until the base leaf is front and every fixture task bar is rendered. */
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

/** Point the spec at the other base file and wait for its Gantt. */
async function switchBase(basePath: string): Promise<void> {
  currentBase = basePath;
  await browser.executeObsidian(({ app }) => {
    app.workspace.detachLeavesOfType("bases");
  });
  await ensureGanttReady();
}

/**
 * Set a per-view option the way the live options panel does — `config.set` on
 * the mounted gantt view plus the QueryController's `onConfigChanged` (external
 * `.base` file edits are ignored by a live view; this pair is the real reload
 * path, proven by the perf spec's toggle-storm repro). Found by bounded BFS —
 * Bases owns where it parks the view instance. Returns whether both halves were
 * reached, so a wiring break fails loudly instead of silently doing nothing.
 */
async function fireConfigToggle(
  key: string,
  value: unknown,
): Promise<{ set: boolean; configChanged: boolean }> {
  return browser.executeObsidian(
    ({ app }, k, v) => {
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
      return { set, configChanged };
    },
    key,
    value,
  );
}

/** The recurring row's occupancy render state, read in-page in one pass. */
interface RecurringRowState {
  found: boolean;
  hasRecurringCue: boolean;
  hasEnvelope: boolean;
  pieceStates: string[];
  spineCount: number;
}

async function recurringRowState(): Promise<RecurringRowState> {
  return browser.execute((noteName: string) => {
    const root = document.querySelector(".og-bases-gantt");
    const bar = (Array.from(root?.querySelectorAll(".wx-bar") ?? []) as HTMLElement[]).find((b) =>
      (b.getAttribute("data-id") ?? "").endsWith(noteName),
    );
    if (!bar) {
      return { found: false, hasRecurringCue: false, hasEnvelope: false, pieceStates: [], spineCount: 0 };
    }
    const pieceStates = (Array.from(bar.querySelectorAll(".og-instance")) as HTMLElement[]).map(
      (piece) =>
        Array.from(piece.classList).find((cls) => cls.startsWith("og-instance-")) ?? "og-instance",
    );
    return {
      found: true,
      hasRecurringCue: bar.classList.contains("og-recurring"),
      hasEnvelope: bar.classList.contains("wx-split"),
      pieceStates,
      spineCount: bar.querySelectorAll(".og-series-spine").length,
    };
  }, RECURRING_NOTE);
}

/** Whole-chart calendar-item footprint (the default-off assertion's subject). */
async function calendarItemFootprint(): Promise<{ pieces: number; events: number; spines: number }> {
  return browser.execute(() => {
    const root = document.querySelector(".og-bases-gantt");
    return {
      pieces: root?.querySelectorAll(".og-instance").length ?? 0,
      events: root?.querySelectorAll(".wx-bar.og-event").length ?? 0,
      spines: root?.querySelectorAll(".og-series-spine").length ?? 0,
    };
  });
}

/** Make every recorded occurrence fall inside the task's authored span. */
async function setRecurringDue(due: string): Promise<void> {
  await browser.executeObsidian(async ({ app }, args) => {
    const file = app.vault.getAbstractFileByPath(args.notePath);
    if (!file) throw new Error(`${args.notePath} missing`);
    await app.fileManager.processFrontMatter(file as never, (frontmatter: Record<string, unknown>) => {
      frontmatter.due = args.due;
    });
  }, { notePath: RECURRING_NOTE, due });
}

/** Read the persisted due value from the note cache. */
async function recurringDue(): Promise<string | null> {
  return browser.executeObsidian(({ app }, notePath) => {
    const file = app.vault.getAbstractFileByPath(notePath);
    if (!file) return null;
    const cache = app.metadataCache.getFileCache(file as never);
    const value = cache?.frontmatter?.due;
    return typeof value === "string" ? value : null;
  }, RECURRING_NOTE);
}

/** Resize the recurring task's authored end edge through SVAR's real mouse path. */
async function resizeRecurringEnd(days: number): Promise<{ pxPerDay: number; beforeWidth: number }> {
  return browser.execute((args) => {
    const root = document.querySelector(".og-bases-gantt");
    const bar = (Array.from(root?.querySelectorAll(".wx-bar") ?? []) as HTMLElement[]).find((candidate) =>
      (candidate.getAttribute("data-id") ?? "").endsWith(args.notePath),
    );
    if (!bar) throw new Error(`no bar for ${args.notePath}`);
    const bars = bar.closest(".wx-bars") as HTMLElement | null;
    if (!bars) throw new Error("recurring bar is not inside .wx-bars");
    const scaleRows = root?.querySelectorAll(".wx-scale .wx-row") ?? [];
    const dayCell = scaleRows[scaleRows.length - 1]?.querySelector(".wx-cell") as HTMLElement | null;
    const pxPerDay = dayCell?.getBoundingClientRect().width ?? 0;
    if (pxPerDay <= 0) throw new Error("could not measure a day column");

    const rect = bar.getBoundingClientRect();
    const startX = rect.right - 2;
    const y = rect.top + rect.height / 2;
    const occupancyTarget = bar.querySelector(".og-instance") as HTMLElement | null;
    if (!occupancyTarget) throw new Error("recurring bar has no occupancy overlay target");
    const dx = args.days * pxPerDay;
    const send = (target: EventTarget, type: string, clientX: number): void => {
      target.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY: y }),
      );
    };
    send(occupancyTarget, "mousedown", startX);
    send(bars, "mousemove", startX + Math.sign(dx) * Math.max(Math.abs(dx), 21));
    send(bars, "mousemove", startX + dx);
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return { pxPerDay, beforeWidth: rect.width };
  }, { notePath: RECURRING_NOTE, days });
}

describe("Gantt (OG) calendar items — recurring occupancy + time-entry rows", () => {
  before(async () => {
    // Hermetic: copy the in-repo fixture to a disposable temp dir (Obsidian and
    // the toggle journeys write config; copying keeps the fixture pristine).
    const tmpVault = path.join(os.tmpdir(), "og-gantt-calendar-items-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({
      vault: tmpVault,
      plugins: ["tasknotes-gantt", "tasknotes"],
    });

    // Bases core plugin must be ON to open the .base files.
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

    // Gate 1: the TaskNotes API is up.
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

    // Gate 2 — keyed on the EXACT facts the journeys consume: `lifecycle.ready()`
    // does not mean the metadata-cache-backed task list is complete. Wait until
    // TaskNotes serves the recurring task's recurrence + recorded instance dates,
    // the materialized occurrence's parent reference, and both FINISHED time
    // entries. Once these hold, every assertion below reads settled facts.
    let lastTaskFacts = "<never polled>";
    await waitUntilOrExplain(
      async () => {
        lastTaskFacts = await browser.executeObsidian(async ({ app }, names) => {
          const tn = (app as unknown as { plugins?: { getPlugin?: (id: string) => unknown } }).plugins?.getPlugin?.("tasknotes") as
            | { api?: { tasks?: { list?: () => Promise<unknown[]> | unknown[] } } }
            | undefined;
          const list = await tn?.api?.tasks?.list?.();
          if (!Array.isArray(list)) return "no task list";
          type Info = {
            path?: string; recurrence?: unknown; complete_instances?: unknown;
            skipped_instances?: unknown; recurrence_parent?: unknown;
            occurrence_date?: unknown; timeEntries?: Array<{ endTime?: unknown }>;
          };
          const byPath = new Map((list as Info[]).map((t) => [t.path, t]));
          const weekly = byPath.get(names.recurring);
          const occurrence = byPath.get(names.occurrence);
          const tracked = byPath.get(names.tracked);
          const facts = {
            recurrence: typeof weekly?.recurrence === "string" && weekly.recurrence.includes("FREQ=WEEKLY"),
            completed: Array.isArray(weekly?.complete_instances) && (weekly.complete_instances as unknown[]).some((d) => String(d).startsWith("2026-03-09")),
            skipped: Array.isArray(weekly?.skipped_instances) && (weekly.skipped_instances as unknown[]).some((d) => String(d).startsWith("2026-03-16")),
            parentRef: typeof occurrence?.recurrence_parent === "string" && (occurrence.recurrence_parent as string).length > 0,
            occurrenceDate: String(occurrence?.occurrence_date ?? "").startsWith("2026-03-23"),
            finishedEntries: Array.isArray(tracked?.timeEntries) && tracked.timeEntries.filter((e) => !!e?.endTime).length === 2,
          };
          return Object.values(facts).every(Boolean) ? "ok" : JSON.stringify(facts);
        }, { recurring: RECURRING_NOTE, occurrence: OCCURRENCE_NOTE, tracked: TRACKED_NOTE });
        return lastTaskFacts === "ok";
      },
      () => `TaskNotes never served the fixture's calendar-item facts; last: ${lastTaskFacts}`,
      { timeout: 60000 },
    );

    await ensureGanttReady();
  });

  // A starter-note leaf-steal can fire between tests; re-front + re-assert the
  // three task bars ahead of every journey.
  beforeEach(async () => {
    await ensureGanttReady();
  });

  it("renders the recorded pieces on the union envelope by default, and nothing for opted-out families", async () => {
    // Dataset parity: the TaskNotes calendar renders recorded (completed/
    // skipped) and materialized instances with its recurring toggle OFF, so the
    // fresh default view must too — same toggles, same dataset. The first
    // render churns (the union attaches once TaskNotes enrichment delivers the
    // recurrence facts, flipping the row plain→union-envelope in place), so
    // wait for the settled post-enrichment state: the envelope carrying the
    // recorded/materialized pieces plus the plain-span piece.
    const wanted = [
      "og-instance-plain",
      "og-instance-completed",
      "og-instance-skipped",
      "og-instance-materialized",
    ];
    let row: RecurringRowState = { found: false, hasRecurringCue: false, hasEnvelope: false, pieceStates: [], spineCount: 0 };
    await waitUntilOrExplain(
      async () => {
        await activateBaseLeaf();
        row = await recurringRowState();
        return row.found && row.hasEnvelope && wanted.every((state) => row.pieceStates.includes(state));
      },
      () => `default-view recorded pieces never settled; last: ${JSON.stringify(row)}`,
      { timeout: 20000 },
    );
    expect(row.hasRecurringCue).toBe(true);
    expect(row.hasEnvelope).toBe(true);
    for (const state of wanted) expect(row.pieceStates).toContain(state);
    // Family toggle off: no VIRTUAL instances.
    expect(row.pieceStates).not.toContain("og-instance-next");
    expect(row.pieceStates).not.toContain("og-instance-projected");

    // The plain-span piece paints the bar's effective fill — a real colour
    // that matches the piece's own resolved --og-effective-fill, painted
    // through a probe span so the comparison is colour-to-colour.
    const plainPaint = await browser.execute(() => {
      const piece = document.querySelector(
        ".og-bases-gantt .wx-bar .og-instance.og-instance-plain",
      ) as HTMLElement | null;
      if (!piece) return null;
      const background = window.getComputedStyle(piece).backgroundColor;
      const resolved = window.getComputedStyle(piece).getPropertyValue("--og-effective-fill").trim();
      const probe = document.createElement("span");
      probe.style.backgroundColor = resolved;
      document.body.append(probe);
      const resolvedColor = window.getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { background, resolvedColor };
    });
    expect(plainPaint).not.toBeNull();
    expect(plainPaint!.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(plainPaint!.background).toBe(plainPaint!.resolvedColor);

    // The opt-in-off promise for everything else: no time-entry event rows, no
    // spines (day zoom), and every piece on the chart belongs to the recurring
    // row. A late refresh can repaint the pieces between reads, so the
    // footprint is waited into agreement rather than read once mid-transient.
    let footprint = { pieces: -1, events: -1, spines: -1 };
    try {
      await browser.waitUntil(
        async () => {
          await activateBaseLeaf();
          footprint = await calendarItemFootprint();
          return (
            footprint.events === 0 &&
            footprint.spines === 0 &&
            footprint.pieces === row.pieceStates.length
          );
        },
        { timeout: 10000 },
      );
    } catch {
      throw new Error(`footprint never settled; last: ${JSON.stringify(footprint)}`);
    }
    expect(footprint.events).toBe(0);
    expect(footprint.spines).toBe(0);
    expect(footprint.pieces).toBe(row.pieceStates.length);

    // Dual representation holds by default too: the materialized occurrence
    // note keeps its own task row alongside its piece on the envelope.
    expect(await missingBars()).toEqual([]);
  });

  it("renders instance pieces with state classes and the envelope when Show recurring is enabled", async () => {
    const fired = await fireConfigToggle("tngantt_showRecurring", true);
    expect(fired.set && fired.configChanged).toBe(true);

    // Readiness keyed on the exact pieces the assertions consume: all four
    // recorded/derived states on the recurring row (completed 03-09, skipped
    // 03-16, next 03-02, materialized 03-23), plus at least one projected
    // pattern Monday.
    let row: RecurringRowState = { found: false, hasRecurringCue: false, hasEnvelope: false, pieceStates: [], spineCount: 0 };
    const wanted = [
      "og-instance-next",
      "og-instance-projected",
      "og-instance-completed",
      "og-instance-skipped",
      "og-instance-materialized",
    ];
    await waitUntilOrExplain(
      async () => {
        await activateBaseLeaf();
        row = await recurringRowState();
        return row.found && wanted.every((state) => row.pieceStates.includes(state));
      },
      () => `recurring instance pieces never settled; last: ${JSON.stringify(row)}`,
      { timeout: 20000 },
    );
    for (const state of wanted) expect(row.pieceStates).toContain(state);

    // The plain scheduled→due bar is replaced by the occupancy envelope: the
    // host carries the og-recurring cue and SVAR's wx-split (transparent fill).
    expect(row.hasRecurringCue).toBe(true);
    expect(row.hasEnvelope).toBe(true);

    // Dual representation: the materialized occurrence note ALSO renders as its
    // own task row (its bar was part of ensureGanttReady's anchor; re-assert it
    // against the post-toggle DOM).
    expect(await missingBars()).toEqual([]);
  });

  it("keeps the envelope with the plain-span piece and recorded pieces when Show recurring is disabled", async () => {
    const fired = await fireConfigToggle("tngantt_showRecurring", false);
    expect(fired.set && fired.configChanged).toBe(true);

    // Readiness keyed on the disable's own positive signature: the plain-span
    // piece appears (it exists only with the family off — suppression ends)
    // and the virtual (next/projected) pieces are gone. Recorded pieces sit
    // outside the plain scheduled→due span, so the row RETAINS the union
    // envelope; only the suppression — and with it the virtual pieces — ends.
    let row: RecurringRowState = { found: false, hasRecurringCue: false, hasEnvelope: false, pieceStates: [], spineCount: 0 };
    await waitUntilOrExplain(
      async () => {
        await activateBaseLeaf();
        row = await recurringRowState();
        return (
          row.found
          && row.pieceStates.includes("og-instance-plain")
          && !row.pieceStates.includes("og-instance-next")
          && !row.pieceStates.includes("og-instance-projected")
        );
      },
      () => `recurring disable never settled; last: ${JSON.stringify(row)}`,
      { timeout: 20000 },
    );

    // The union envelope stays (wx-split): the plain scheduled→due bar rides
    // as the og-instance-plain piece while the RECORDED instances keep
    // rendering — completed/skipped are gated only by their own sub-toggles,
    // and the materialized occurrence keeps its marked piece.
    expect(row.hasEnvelope).toBe(true);
    expect(row.hasRecurringCue).toBe(true);
    expect(row.pieceStates).toContain("og-instance-plain");
    expect(row.pieceStates).toContain("og-instance-completed");
    expect(row.pieceStates).toContain("og-instance-skipped");
    expect(row.pieceStates).toContain("og-instance-materialized");
    expect(row.pieceStates).not.toContain("og-instance-next");
    expect(row.pieceStates).not.toContain("og-instance-projected");
  });

  it("keeps an authored recurring overlay row editable while the family is disabled", async () => {
    // Put every recorded occurrence inside the authored scheduled→due span.
    // The pieces must become overlays on the ordinary task bar: no derived
    // envelope, but occupancyRuns still present — the exact regression case.
    await setRecurringDue("2026-03-24");
    let row: RecurringRowState = { found: false, hasRecurringCue: false, hasEnvelope: true, pieceStates: [], spineCount: 0 };
    await waitUntilOrExplain(
      async () => {
        await activateBaseLeaf();
        row = await recurringRowState();
        return (
          row.found
          && !row.hasEnvelope
          && row.pieceStates.includes("og-instance-completed")
          && row.pieceStates.includes("og-instance-skipped")
          && row.pieceStates.includes("og-instance-materialized")
        );
      },
      () => `recorded pieces never became authored-span overlays; last: ${JSON.stringify(row)}`,
      { timeout: 20000 },
    );
    expect(await recurringDue()).toBe("2026-03-24");

    const drag = await resizeRecurringEnd(2);
    expect(drag.pxPerDay).toBeGreaterThan(0);
    expect(drag.beforeWidth).toBeGreaterThan(0);
    let due: string | null = null;
    await waitUntilOrExplain(
      async () => {
        due = await recurringDue();
        return due === "2026-03-26";
      },
      () => `authored overlay resize did not persist: due=${JSON.stringify(due)}`,
      { timeout: 15000, interval: 300 },
    );
    expect(due).toBe("2026-03-26");
  });

  it("renders read-only time-entry event rows that refuse a drag", async () => {
    const fired = await fireConfigToggle("tngantt_showTimeEntries", true);
    expect(fired.set && fired.configChanged).toBe(true);

    // Readiness keyed on the exact rows this journey consumes: the fixture's two
    // FINISHED entries, each a `.wx-bar.og-event` row.
    let events = -1;
    await waitUntilOrExplain(
      async () => {
        await activateBaseLeaf();
        events = (await calendarItemFootprint()).events;
        return events === 2;
      },
      () => `expected 2 og-event rows, saw ${events}`,
      { timeout: 20000 },
    );
    expect(events).toBe(2);

    // Read-only affordances on the event bar: the link handles are hidden and
    // the cursor stays default (the CSS backing the intercept refusals).
    const affordances = await browser.execute(() => {
      const bar = document.querySelector(".og-bases-gantt .wx-bar.og-event") as HTMLElement | null;
      if (!bar) return null;
      const link = bar.querySelector(".wx-link") as HTMLElement | null;
      const style = window.getComputedStyle(bar);
      return {
        cursor: style.cursor,
        backgroundColor: style.backgroundColor,
        sourceColor: bar.style.getPropertyValue("--og-event-color"),
        linkDisplay: link ? window.getComputedStyle(link).display : "<no handle rendered>",
      };
    });
    expect(affordances).not.toBeNull();
    expect(affordances!.cursor).toBe("default");
    expect(affordances!.sourceColor).toBe("");
    expect(affordances!.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(["none", "<no handle rendered>"]).toContain(affordances!.linkDisplay);

    // Drive a real move gesture (the events SVAR's Bars.svelte binds) on the
    // first event bar and assert its geometry does not move: the per-row
    // `drag-task` intercept refuses calendar-item rows at the first frame.
    const before = await browser.execute(() => {
      const bar = document.querySelector(".og-bases-gantt .wx-bar.og-event") as HTMLElement | null;
      if (!bar) return null;
      const rect = bar.getBoundingClientRect();
      const bars = bar.closest(".wx-bars");
      const y = rect.top + rect.height / 2;
      const startX = rect.left + rect.width / 2; // mid-bar = move zone, not a resize handle
      const send = (target: EventTarget, type: string, clientX: number): void => {
        target.dispatchEvent(
          new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY: y }),
        );
      };
      send(bar, "mousedown", startX);
      if (bars) {
        send(bars, "mousemove", startX + 30); // past SVAR's 20px dead zone
        send(bars, "mousemove", startX + 90);
      }
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return { left: rect.left, width: rect.width };
    });
    expect(before).not.toBeNull();

    // Give any (wrongly accepted) drag time to paint, then require the geometry
    // to be EXACTLY where it was for two consecutive reads.
    let stableReads = 0;
    let after: { left: number; width: number } | null = null;
    await waitUntilOrExplain(
      async () => {
        after = await browser.execute(() => {
          const bar = document.querySelector(".og-bases-gantt .wx-bar.og-event") as HTMLElement | null;
          if (!bar) return null;
          const rect = bar.getBoundingClientRect();
          return { left: rect.left, width: rect.width };
        });
        const unchanged =
          after !== null
          && Math.abs(after.left - before!.left) < 1
          && Math.abs(after.width - before!.width) < 1;
        stableReads = unchanged ? stableReads + 1 : 0;
        return stableReads >= 2;
      },
      () =>
        `event bar moved after a drag gesture: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
      { timeout: 10000, interval: 400 },
    );
    expect(after).toEqual(before);
  });

  it("renders the series spine instead of pieces at month scale", async () => {
    // The month base pins `tngantt_defaultScale: month` + `tngantt_showRecurring:
    // true` in its own view config, so the coarse-zoom fallback is deterministic
    // (no zoom-gesture simulation).
    await switchBase(MONTH_BASE);

    // Readiness keyed on the spine itself — the exact element this assertion
    // consumes — then assert pieces are absent on the same observed state.
    let row: RecurringRowState = { found: false, hasRecurringCue: false, hasEnvelope: false, pieceStates: [], spineCount: 0 };
    await waitUntilOrExplain(
      async () => {
        await activateBaseLeaf();
        row = await recurringRowState();
        return row.found && row.spineCount > 0;
      },
      () => `series spine never rendered at month scale; last: ${JSON.stringify(row)}`,
      { timeout: 20000 },
    );
    expect(row.spineCount).toBeGreaterThan(0);
    expect(row.pieceStates).toEqual([]);
    expect(row.hasRecurringCue).toBe(true);
  });
});
