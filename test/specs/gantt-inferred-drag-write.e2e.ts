/* global MouseEvent, EventTarget, Node */
import { browser, expect, $, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Inferred-date drag WRITE spec — three smoke journeys, deliberately not a matrix.
 *
 * Boots Obsidian against `test/vaults/gantt-inferred-drag-write` WITH TaskNotes,
 * so the timeline is write-enabled (`capabilities.write`) and the estimate-driven
 * prompt can actually fire, and drives a real SVAR end-edge resize through the
 * mouse events SVAR itself listens for (`mousedown` on the bar's end zone,
 * `mousemove` past its 20px dead zone, `mouseup` on window).
 *
 * The outcome matrix — choice x gesture x instances x tree role x cascade mode x
 * persist result — belongs to the planner and derivation unit tables, which reach
 * it in milliseconds. What survives here is only what a real Obsidian proves:
 *
 *   1. REVERT — a cancelled prompt writes nothing and puts the bar back;
 *   2. PROMPT — the gate engages, its choice writes and cascades, and a
 *      "Don't ask again" reaches the very next gesture through the view config;
 *   3. ECHO — an estimate-only drag across a blocked weekend mirrors the DERIVED
 *      geometry, not the geometry the gesture drew, to every placement of the
 *      source — without re-poking the entry signature into a re-notify storm.
 *
 * ORDER IS LOAD-BEARING: journey 2 ends by persisting "Don't ask again" on the
 * main base, which suppresses the prompt for every later gesture on that view.
 * Any case needing a prompt there must run before it.
 *
 * SELECTOR NOTE: bars are SVAR `.wx-bar` elements carrying `data-id` = the note
 * path with a leading ":" (SVAR `setID`), so we target with the ends-with form
 * `[data-id$="X.md"]`.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-inferred-drag-write");

/**
 * Ceiling on the view updates one committed drag may cause. Measured at ONE on a
 * clean run — the frontmatter write itself — because the echoes ride under the
 * echo-guard and stay invisible to the entry signature. The headroom here absorbs
 * ordinary timing jitter while staying an order of magnitude below the storm this
 * exists to catch. A bound loose enough to always pass would test nothing: raise
 * it only with evidence, and treat a failure as a real regression.
 */
const MAX_UPDATES_PER_COMMIT = 5;

/** Enable the Bases core plugin (required to open a `.base`). */
async function enableBases(): Promise<void> {
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
}

// The spec drives two bases: the main one (cascade `auto`) and the seam view,
// whose calendar-bearing fixtures own the echo journey.
let currentBase = "InferredDragWrite.base";
let expectedBars: string[] = [];
const TASK_NOTES = [
  "Solo Inferred.md",
  "Materialise Me.md",
  "Cancel Me.md",
  "Ask Once.md",
  "Ask Twice.md",
  "Inferred Child.md",
  "Parent Window.md",
  "Inferred Parent.md",
  "Fixed Child.md",
];
const SEAM_NOTES = [
  "Seam Only.md",
  "Seam Container.md",
  "Blocked Parent.md",
  "Blocked Child.md",
];

/**
 * Force the OG Gantt to be the ACTIVE, visible leaf.
 *
 * TaskNotes creates and opens a "Start Here" starter note asynchronously on first
 * install, and that open can steal the active leaf at any moment — after the base
 * is opened, or even mid-test. A Bases view unmounts its content while its leaf is
 * backgrounded, so the whole Gantt DOM vanishes until the leaf is re-fronted — the
 * same failure the dependency-types spec heals this way. Detaching markdown leaves
 * and re-asserting the base leaf is idempotent and cheap, so every wait below
 * calls it on every poll and heals against a steal rather than racing it.
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
    const markdownLeaves: Array<{ detach?: () => void }> = [];
    ws.iterateAllLeaves((l) => {
      if (l.view?.getViewType?.() === "markdown") markdownLeaves.push(l);
    });
    markdownLeaves.forEach((l) => l.detach?.());

    let baseLeaf = ws.getLeavesOfType("bases")[0];
    if (!baseLeaf) {
      const file = app.vault.getAbstractFileByPath(basePath);
      if (!file) return;
      const leaf = ws.getLeaf(true);
      await leaf.openFile(file as never);
      baseLeaf = leaf;
    }
    ws.setActiveLeaf(baseLeaf, { focus: true });
    ws.revealLeaf(baseLeaf);
  }, currentBase);
}

/** Which of the fixture's task bars are missing from the rendered chart. */
async function missingBars(): Promise<string[]> {
  return browser.execute((names: string[]) => {
    const root = document.querySelector(".og-bases-gantt");
    if (!root) return ["<.og-bases-gantt absent>"];
    // Matched in-page by endsWith: `data-id` carries a ":" prefix and spaces,
    // which the wdio CSS selector engine handles unreliably.
    const ids = Array.from(root.querySelectorAll(".wx-bar")).map((b) => b.getAttribute("data-id") ?? "");
    return names.filter((n) => !ids.some((id) => id.endsWith(n)));
  }, expectedBars);
}

/**
 * Wait until the base leaf is front and every fixture bar is rendered. SVAR
 * virtualizes rows, so the fixture base raises `tngantt_maxHeight` above the
 * 400px default — otherwise the last rows never enter the DOM to be dragged.
 */
async function ensureGanttReady(): Promise<void> {
  let missing: string[] = ["<never polled>"];
  await browser.waitUntil(
    async () => {
      await activateBaseLeaf();
      missing = await missingBars();
      return missing.length === 0;
    },
    { timeout: 90000, timeoutMsg: () => `Gantt bars missing: ${JSON.stringify(missing)}` },
  );
}

/** Point the spec at a base and wait for exactly the bars that view renders. */
async function switchBase(basePath: string, bars: string[]): Promise<void> {
  currentBase = basePath;
  expectedBars = bars;
  await browser.executeObsidian(({ app }) => {
    app.workspace.detachLeavesOfType("bases");
  });
  await ensureGanttReady();
}

const readNote = async (notePath: string): Promise<string> =>
  browser.executeObsidian(async ({ app }, p) => {
    const file = app.vault.getAbstractFileByPath(p);
    return file ? ((await app.vault.read(file as never)) as string) : "";
  }, notePath);

/**
 * The live view's own `onDataUpdated` tally. The counter advances on every update
 * that reaches a mounted view — only its debug log is gated off — so its delta
 * across a committed write reads the re-notify storm directly.
 *
 * Found by bounded search rather than a fixed property path: Bases owns where it
 * parks the view instance, and a hardcoded path would break silently on an
 * internals change, reporting a calm counter it never actually located. Returns
 * -1 when no counter is reachable, which the caller asserts against.
 */
async function dataUpdateCount(): Promise<number> {
  return browser.executeObsidian(({ app }) => {
    const ws = app.workspace as unknown as {
      getLeavesOfType: (t: string) => Array<{ view?: unknown }>;
    };
    const seen = new Set<unknown>();
    let frontier: unknown[] = ws.getLeavesOfType("bases").map((leaf) => leaf.view);
    for (let depth = 0; depth < 4 && frontier.length > 0; depth += 1) {
      const next: unknown[] = [];
      for (const node of frontier) {
        // DOM subtrees are enormous and hold no view instance.
        if (node === null || typeof node !== "object" || node instanceof Node) continue;
        if (seen.has(node) || seen.size > 2000) continue;
        seen.add(node);
        const tally = (node as { dbgDataUpdates?: unknown }).dbgDataUpdates;
        if (typeof tally === "number") return tally;
        next.push(...Object.values(node as Record<string, unknown>));
      }
      frontier = next;
    }
    return -1;
  });
}

/**
 * Resize a bar's END edge by `days`, using the mouse events SVAR's `Bars.svelte`
 * binds (`mousedown`/`mousemove` on `.wx-bars`, `mouseup` on window). The press
 * lands in the end-resize zone (SVAR treats the outer ~20% of a bar as a handle)
 * and the first move clears its 20px "is this a drag?" dead zone. Returns the
 * geometry it used, so a failure says why rather than just "nothing happened".
 */
let lastDragged: string | undefined;

async function dragEndEdge(
  notePath: string,
  days: number,
): Promise<{ pxPerDay: number; barWidth: number; moved: number }> {
  await waitForBar(notePath);
  lastDragged = notePath;
  return browser.executeObsidian(({ app }, args) => {
    void app;
    const root = document.querySelector(".og-bases-gantt");
    const bar = (Array.from(root?.querySelectorAll(".wx-bar") ?? []) as HTMLElement[]).find((b) =>
      (b.getAttribute("data-id") ?? "").endsWith(args.notePath),
    );
    if (!bar) throw new Error(`no bar for ${args.notePath}`);
    const bars = bar.closest(".wx-bars") as HTMLElement | null;
    if (!bars) throw new Error("bar is not inside .wx-bars");

    // One day in pixels, read off the finest time-scale row (day columns).
    const rows = root?.querySelectorAll(".wx-scale .wx-row") ?? [];
    const dayCell = rows[rows.length - 1]?.querySelector(".wx-cell") as HTMLElement | null;
    const pxPerDay = dayCell?.getBoundingClientRect().width ?? 0;
    if (pxPerDay <= 0) throw new Error("could not measure a day column");

    const rect = bar.getBoundingClientRect();
    const y = rect.top + rect.height / 2;
    const startX = rect.right - 2; // inside the end-resize zone
    const dx = args.days * pxPerDay;
    const send = (target: EventTarget, type: string, clientX: number): void => {
      target.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY: y }),
      );
    };

    send(bar, "mousedown", startX);
    // First move must exceed SVAR's 20px dead zone before the drag engages.
    send(bars, "mousemove", startX + Math.sign(dx) * Math.max(Math.abs(dx), 21));
    send(bars, "mousemove", startX + dx);
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return { pxPerDay, barWidth: rect.width, moved: dx };
  }, { notePath, days });
}

/** A rendered bar's geometry + classes, read in-page (endsWith on `data-id`). */
async function barInfo(notePath: string): Promise<{ width: number; classes: string } | null> {
  return browser.execute((name: string) => {
    const root = document.querySelector(".og-bases-gantt");
    const bar = (Array.from(root?.querySelectorAll(".wx-bar") ?? []) as HTMLElement[]).find((b) =>
      (b.getAttribute("data-id") ?? "").endsWith(name),
    );
    if (!bar) return null;
    return { width: bar.getBoundingClientRect().width, classes: bar.className };
  }, notePath);
}

/**
 * Wait for a bar to be rendered AND settled, re-fronting the base leaf on every
 * poll so a starter-note steal mid-test is healed rather than raced. Never called
 * while the prompt is open: re-activating a leaf would pull focus off the modal.
 *
 * Settled matters as much as rendered: a drag committed while the chart is still
 * diff-syncing is classified as our own echo and dropped, so the gesture would
 * silently do nothing. Two consecutive polls reporting the same width is the
 * cheapest available proxy for "the initial sync has finished".
 */
async function waitForBar(notePath: string): Promise<{ width: number; classes: string }> {
  let info: { width: number; classes: string } | null = null;
  let previousWidth = -1;
  await browser.waitUntil(
    async () => {
      await activateBaseLeaf();
      info = await barInfo(notePath);
      if (info === null) return false;
      const stable = info.width === previousWidth;
      previousWidth = info.width;
      return stable;
    },
    {
      timeout: 30000,
      interval: 400,
      timeoutMsg: `the bar for ${notePath} never rendered and settled`,
    },
  );
  return info as unknown as { width: number; classes: string };
}

/**
 * The inferred-drag prompt, once SVAR's committed resize reaches the gate.
 * The action buttons are matched by text, which WDIO only supports as a
 * standalone selector — hence the chained `.$()` off the modal.
 */
async function waitForPrompt(notePath?: string) {
  const modal = await $(".modal");
  await modal.waitForDisplayed({
    timeout: 20000,
    // A silent write means the gate did not engage (dropped gesture, or a
    // non-inferred edge); an unchanged note means the drag never committed at all.
    timeoutMsg: async () =>
      `the inferred-edge drag prompt never opened${
        notePath ? ` — ${notePath} is now: ${await readNote(notePath)}` : ""
      }`,
  });
  const button = await modal.$("button=Estimate only");
  await button.waitForDisplayed({ timeout: 10000, timeoutMsg: "the prompt has no action buttons" });
  return button;
}

/** Click one of the prompt's actions by its label. */
async function chooseAction(label: string): Promise<void> {
  await (await (await $(".modal")).$(`button=${label}`)).click();
}

/** Whether a prompt appears within `ms` (used to assert one does NOT). */
async function promptAppears(ms: number): Promise<boolean> {
  try {
    await (await $(".modal")).waitForDisplayed({ timeout: ms });
    return true;
  } catch {
    return false;
  }
}

/**
 * The text of any modal that surfaces within `ms`, or null when none does. Used
 * where a second prompt would be a real finding: the text names which gate fired,
 * which a bare boolean would leave the reader to guess at.
 */
async function unexpectedModalText(ms: number): Promise<string | null> {
  if (!(await promptAppears(ms))) return null;
  return (await (await $(".modal")).getText()).replace(/\s+/g, " ").trim();
}

describe("Gantt (OG) inferred-date drag writes", () => {
  before(async () => {
    // Hermetic: copy the in-repo fixture vault to a disposable temp dir.
    const tmpVault = path.join(os.tmpdir(), "og-gantt-inferred-drag-write-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({
      vault: tmpVault,
      plugins: ["tasknotes-gantt", "tasknotes"],
    });
    await enableBases();
    await switchBase("InferredDragWrite.base", TASK_NOTES);
  });

  // The starter-note steal can fire at any point, so re-front the base leaf and
  // re-confirm the chart before every test rather than trusting the last one.
  beforeEach(async () => {
    await ensureGanttReady();
  });

  // FIRST: needs the main base's prompt, which journey 2 switches off for good.
  it("writes nothing and puts the bar back when the inferred-edge prompt is cancelled", async () => {
    const before = await readNote("Cancel Me.md");
    const widthBefore = (await waitForBar("Cancel Me.md")).width;
    expect(widthBefore).toBeGreaterThan(0);

    await dragEndEdge("Cancel Me.md", 3);
    await waitForPrompt(lastDragged);
    await browser.keys(["Escape"]); // cancel = Escape / backdrop, by design

    // Re-front the base first: the starter-note steal can unmount the chart while
    // the prompt holds focus, and an unmounted chart has no bar to measure.
    await ensureGanttReady();
    await browser.waitUntil(async () => (await barInfo("Cancel Me.md"))?.width === widthBefore, {
      timeout: 20000,
      timeoutMsg: "a cancelled inferred drag did not restore the bar",
    });
    expect(await readNote("Cancel Me.md")).toBe(before); // byte-identical: nothing written
  });

  it("prompts on an inferred edge, writes the choice with its cascade, then stops asking once told to", async () => {
    // Write-enabled: no read-only banner, so SVAR bars are draggable at all.
    await expect($$(".og-readonly-text")).toBeElementsArrayOfSize(0);
    expect((await waitForBar("Solo Inferred.md")).classes).toContain("datestatus-flagged");
    expect(await readNote("Parent Window.md")).toMatch(/due:\s*'?2026-04-07'?/);

    // Apr 6 + 2880min (2 days) ends Apr 7; dragging the end out 3 days makes the
    // span 5 days, so the estimate grows to 7200 and the end is materialised.
    await dragEndEdge("Inferred Child.md", 3);
    await waitForPrompt(lastDragged);
    await chooseAction("Estimate and dates");

    await browser.waitUntil(async () => (await readNote("Inferred Child.md")).includes("due:"), {
      timeout: 20000,
      timeoutMsg: "the materialised due date never reached the note",
    });
    const child = await readNote("Inferred Child.md");
    expect(child).toContain("timeEstimate: 7200");
    expect(child).toMatch(/due:\s*'?2026-04-10'?/);

    // The cascade used to be dropped entirely whenever the gate engaged, leaving
    // the parent smaller than the child it contains.
    await browser.waitUntil(
      async () => /due:\s*'?2026-04-10'?/.test(await readNote("Parent Window.md")),
      {
        timeout: 20000,
        timeoutMsg: "the ancestor extend never ran after the inferred-edge decision",
      },
    );

    // The choice persists through the Bases view config, whose refresh round-trips
    // asynchronously — so the gesture that follows it is exactly the one that used
    // to see the stale `ask` and prompt again.
    await dragEndEdge("Ask Once.md", 3);
    await waitForPrompt(lastDragged);
    await (await $(".modal .checkbox-container")).click(); // Don't ask again
    await chooseAction("Estimate and dates");
    await browser.waitUntil(async () => (await $$(".modal")).length === 0, {
      timeout: 10000,
      timeoutMsg: "the prompt did not close after choosing",
    });

    // Immediately — deliberately without waiting for the config refresh.
    await dragEndEdge("Ask Twice.md", 3);
    expect(await promptAppears(2500)).toBe(false);

    await browser.waitUntil(async () => (await readNote("Ask Twice.md")).includes("due:"), {
      timeout: 20000,
      timeoutMsg: "the auto-applied choice never wrote the second task",
    });
    const askTwice = await readNote("Ask Twice.md");
    expect(askTwice).toContain("timeEstimate: 7200");
    expect(askTwice).toMatch(/due:\s*'?2026-04-10'?/);
  });

  // LAST: drives the seam base, so it leaves the spec pointed elsewhere.
  it("mirrors an estimate-only drag over blocked days to every placement without a re-notify storm", async () => {
    await switchBase("InferredDragSeam.base", SEAM_NOTES);
    // `Seam Only` starts Mon 05-04 with a two-working-day estimate on a calendar
    // whose weekends are blocked, and no authored end — so its end is the inferred
    // edge and its span is a working-day walk, not the days a drag draws.
    expect(await readNote("Seam Only.md")).toContain("timeEstimate: 2880");

    // Give the dragged note a SECOND placement in the session's disposable vault
    // copy: the correction must reach EVERY instance of the source, and a
    // single-placement note cannot observe a miss.
    await browser.executeObsidian(async ({ app }, p) => {
      const file = app.vault.getAbstractFileByPath(p);
      if (!file) throw new Error(`no fixture note at ${p}`);
      const fileManager = (app as unknown as {
        fileManager: {
          processFrontMatter: (
            f: unknown,
            fn: (frontmatter: Record<string, unknown>) => void,
          ) => Promise<void>;
        };
      }).fileManager;
      await fileManager.processFrontMatter(file, (frontmatter) => {
        frontmatter.projects = ["[[Seam Container]]"];
      });
    }, "Seam Only.md");
    const duplicateId = "Seam Only.md#parent-Seam Container.md";
    await waitForBar(duplicateId);

    const updatesBefore = await dataUpdateCount();
    expect(updatesBefore).toBeGreaterThanOrEqual(0); // the counter was actually found

    // Drag the end 5 days out: the gesture draws Mon..Sun, but Sat and Sun carry
    // no work, so the authority derives five WORKING days (Mon..Fri) instead. Both
    // placements must end up on that derived span, never the one drawn.
    const { pxPerDay } = await dragEndEdge("Seam Only.md", 5);
    await waitForPrompt(lastDragged);
    await chooseAction("Estimate only");

    await browser.waitUntil(
      async () => /timeEstimate:\s*7200/.test(await readNote("Seam Only.md")),
      {
        timeout: 20000,
        timeoutMsg: async () =>
          `the working-day estimate was not saved — note is now: ${await readNote("Seam Only.md")}`,
      },
    );
    const saved = await readNote("Seam Only.md");
    expect(saved).not.toMatch(/due:/); // the derived end stayed derived
    expect(saved).toMatch(/scheduled:\s*'?2026-05-04'?/); // the authored start is untouched

    // "Estimate only" writes no dates, and the container is roomy enough that the
    // derived span never outgrows it — so no cascade is reachable and the ancestor
    // keeps its authored window untouched.
    expect(await unexpectedModalText(2500)).toBeNull();
    expect(await readNote("Seam Container.md")).toMatch(/due:\s*'?2026-05-31'?/);

    // Both placements land on the derived five-day span — the echo carries the
    // authority's geometry to every instance, not just the dragged row.
    const derivedWidth = 5 * pxPerDay;
    await browser.waitUntil(
      async () => {
        const dragged = await barInfo("Seam Only.md");
        const duplicate = await barInfo(duplicateId);
        return (
          dragged !== null &&
          duplicate !== null &&
          Math.abs(dragged.width - derivedWidth) < pxPerDay / 2 &&
          Math.abs(duplicate.width - derivedWidth) < pxPerDay / 2
        );
      },
      {
        timeout: 15000,
        timeoutMsg: async () =>
          `an instance is not on the derived span — expected ~${derivedWidth}px, ` +
          `dragged ${JSON.stringify(await barInfo("Seam Only.md"))}, ` +
          `duplicate ${JSON.stringify(await barInfo(duplicateId))}`,
      },
    );

    // The echo is written under the echo-guard and must stay invisible to the
    // entry signature; a re-notify storm would run the tally far past this.
    //
    // Bracketed, not capped. The committed write MUST advance the live view's
    // tally, so a lower bound is what proves the counter being read is the one
    // under test: an unlocated counter reports -1 and a stale view never moves,
    // and either would satisfy a ceiling alone while observing nothing.
    const updatesAfter = await dataUpdateCount();
    const updates = updatesAfter - updatesBefore;
    expect(updates).toBeGreaterThanOrEqual(1);
    expect(updates).toBeLessThanOrEqual(MAX_UPDATES_PER_COMMIT);
  });
});
