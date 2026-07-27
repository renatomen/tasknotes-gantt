/* global MouseEvent, EventTarget */
import { browser, expect, $, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Inferred-date drag WRITE spec — the round-trip the read-only provenance spec
 * (`gantt-inferred-date-drag.e2e.ts`) deliberately stops short of.
 *
 * Boots Obsidian against `test/vaults/gantt-inferred-drag-write` WITH TaskNotes,
 * so the timeline is write-enabled (`capabilities.write`) and the estimate-driven
 * prompt can actually fire, and drives a real SVAR end-edge resize through the
 * mouse events SVAR itself listens for (`mousedown` on the bar's end zone,
 * `mousemove` past its 20px dead zone, `mouseup` on window). What that commits —
 * modal, choice, and the note write — is then asserted against the vault:
 *
 *   1. "Estimate only" writes the grown estimate and NO date;
 *   2. "Estimate and dates" writes the estimate AND materialises the dragged end;
 *   3. cancelling writes nothing and puts the bar back;
 *   4. "Don't ask again" applies to the VERY NEXT drag, with no second prompt;
 *   5. the parent/ancestor cascade still runs after an inferred-edge decision.
 *
 * SELECTOR NOTE: bars are SVAR `.wx-bar` elements carrying `data-id` = the note
 * path with a leading ":" (SVAR `setID`), so we target with the ends-with form
 * `[data-id$="X.md"]`.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-inferred-drag-write");

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

// The spec drives two bases: the main one (cascade `auto`) and a second view with
// cascade `ask`, which is the only way to reach the shrink prompt s "Undo resize".
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

  it("renders the writable fixture with the inferred bars flagged", async () => {
    // Write-enabled: no read-only banner, so SVAR bars are draggable at all.
    await expect($$(".og-readonly-text")).toBeElementsArrayOfSize(0);
    const solo = await waitForBar("Solo Inferred.md");
    expect(solo?.classes).toContain("datestatus-flagged");
  });

  it("writes only the grown estimate for 'Estimate only', leaving the date derived", async () => {
    // Apr 6 + 2880min (2 days) → end Apr 7; dragging the end out 3 days makes the
    // span 5 days, so the estimate grows to 7200 and NO due date is stamped.
    const geometry = await dragEndEdge("Solo Inferred.md", 3);
    expect(geometry.pxPerDay).toBeGreaterThan(0);

    await (await waitForPrompt()).click();

    await browser.waitUntil(async () => (await readNote("Solo Inferred.md")).includes("timeEstimate: 7200"), {
      timeout: 20000,
      timeoutMsg: `the grown estimate never reached the note (drag geometry: ${JSON.stringify(geometry)})`,
    });
    const saved = await readNote("Solo Inferred.md");
    expect(saved).toContain("timeEstimate: 7200");
    expect(saved).not.toContain("due:"); // the end stays derived
  });

  it("materialises the dragged end date for 'Estimate and dates'", async () => {
    await dragEndEdge("Materialise Me.md", 3);
    await waitForPrompt(lastDragged);
    await chooseAction('Estimate and dates');

    await browser.waitUntil(async () => (await readNote("Materialise Me.md")).includes("due:"), {
      timeout: 20000,
      timeoutMsg: "the materialised due date never reached the note",
    });
    const saved = await readNote("Materialise Me.md");
    expect(saved).toContain("timeEstimate: 7200");
    expect(saved).toMatch(/due:\s*'?2026-04-10'?/);
  });

  it("writes nothing and restores the bar when the prompt is cancelled", async () => {
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
    expect(await readNote("Cancel Me.md")).toBe(before); // nothing written
  });

  it("still extends the parent window after an inferred-edge decision", async () => {
    // The cascade used to be dropped entirely whenever the gate engaged, leaving
    // the parent smaller than the child it contains.
    expect(await readNote("Parent Window.md")).toMatch(/due:\s*'?2026-04-07'?/);

    await dragEndEdge("Inferred Child.md", 3);
    await waitForPrompt(lastDragged);
    await chooseAction("Estimate and dates");

    await browser.waitUntil(
      async () => /due:\s*'?2026-04-10'?/.test(await readNote("Parent Window.md")),
      {
        timeout: 20000,
        timeoutMsg: "the ancestor extend never ran after the inferred-edge decision",
      },
    );
  });

  it("keeps an estimate-only choice derived when the shrink cascade would fire", async () => {
    // An inferred-end PARENT pulled inward past its child triggers shrink-fit, whose
    // outcomes both write the parent's own start AND end. After "Estimate only" that
    // would materialise the edge the user chose to leave derived, so the overflow is
    // allowed instead: only the estimate changes.
    const before = await readNote("Inferred Parent.md");
    expect(before).not.toContain("due:");

    await dragEndEdge("Inferred Parent.md", -2); // 4-day derived end pulled in to 2 days
    await waitForPrompt(lastDragged);
    await chooseAction("Estimate only");

    await browser.waitUntil(
      async () => (await readNote("Inferred Parent.md")).includes("timeEstimate: 2880"),
      { timeout: 20000, timeoutMsg: "the shrunk estimate never reached the parent note" },
    );
    const saved = await readNote("Inferred Parent.md");
    expect(saved).not.toContain("due:"); // the derived end stayed derived
    expect(saved).toMatch(/scheduled:\s*'?2026-04-06'?/); // and the authored start is untouched
    // The child keeps its own authored window — the cascade wrote nothing to it.
    expect(await readNote("Fixed Child.md")).toMatch(/due:\s*'?2026-04-09'?/);
  });

  // LAST, deliberately: this is the only case that changes the per-view mode, and
  // it persists — every earlier case needs the default `ask` to see a prompt at all.
  it("applies a 'Don't ask again' choice to the very next drag, with no second prompt", async () => {
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
    const saved = await readNote("Ask Twice.md");
    expect(saved).toContain("timeEstimate: 7200");
    expect(saved).toMatch(/due:\s*'?2026-04-10'?/);
  });

  // VERY last: this one drives the other base (cascade `ask`), so it leaves the
  // spec pointed elsewhere.
  it("restores the estimate, not just the dates, when the shrink cascade is undone", async () => {
    // With cascade `ask`, an inferred-edge resize that orphans a child prompts
    // twice: the inferred-edge gate writes the span's estimate, then the shrink
    // prompt offers "Undo resize". Undoing has to put the estimate back too, or the
    // note is left claiming a duration the user just rejected.
    await switchBase("InferredDragAsk.base", [
      "Undo Parent.md",
      "Undo Child.md",
      "Adjust Parent.md",
      "Adjust Child.md",
    ]);
    expect(await readNote("Undo Parent.md")).toContain("timeEstimate: 5760");

    await dragEndEdge("Undo Parent.md", -2);
    await waitForPrompt(lastDragged);
    await chooseAction("Estimate and dates");

    const undo = await (await $(".modal")).$("button=Undo resize");
    await undo.waitForDisplayed({
      timeout: 20000,
      timeoutMsg: "the shrink-fit prompt never offered an undo",
    });
    await undo.click();

    await browser.waitUntil(
      async () => (await readNote("Undo Parent.md")).includes("timeEstimate: 5760"),
      { timeout: 20000, timeoutMsg: "undoing the resize did not restore the estimate" },
    );
    // The authored start is untouched; only the estimate round-tripped. (Whether an
    // undo should also un-author the date the choice materialised is a separate
    // provenance question, deliberately not decided by this spec.)
    expect(await readNote("Undo Parent.md")).toMatch(/scheduled:\s*'?2026-04-06'?/);
  });

  it("recomputes the estimate when the shrink cascade adjusts the span instead", async () => {
    // Same two prompts, other choice: "Adjust to fit" widens the dates back to
    // wrap the child, so the estimate saved from the shrunken span must be
    // recomputed from the fitted one — dates and duration must not contradict.
    // Its own parent/child pair: the undo case above authors its parent due date
    // on the way back, and a fully-authored task would not prompt again. Selects
    // the ask-mode base itself, so it runs standalone — cascade `auto` (the main
    // base) would adjust silently and the second modal would never appear.
    await switchBase("InferredDragAsk.base", [
      "Undo Parent.md",
      "Undo Child.md",
      "Adjust Parent.md",
      "Adjust Child.md",
    ]);
    expect(await readNote("Adjust Parent.md")).toContain("timeEstimate: 5760");

    // Give the dragged parent a SECOND placement (nested under Undo Parent) in the
    // session's disposable vault copy: the shrink correction must reach EVERY
    // instance of the source note, and a single-placement parent cannot observe a
    // miss. The matched-and-nested note renders both at top level and under its
    // parent, so the source now has two rows sharing one geometry.
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
        frontmatter.projects = ["[[Undo Parent]]"];
      });
    }, "Adjust Parent.md");
    const duplicateId = "Adjust Parent.md#parent-Undo Parent.md";
    await waitForBar(duplicateId);

    const fittedWidth = (await waitForBar("Adjust Parent.md")).width;
    const pxPerDay = (await dragEndEdge("Adjust Parent.md", -2)).pxPerDay;
    await waitForPrompt(lastDragged);
    await chooseAction("Estimate and dates");

    const modal = await $(".modal");
    const adjust = await modal.$("button=Adjust to fit");
    await adjust.waitForDisplayed({
      timeout: 20000,
      timeoutMsg: "the shrink-fit prompt never offered an adjust",
    });
    await adjust.click();

    // Fitted back to wrap the child (ends 04-09): 4 calendar days again.
    await browser.waitUntil(
      async () => {
        const note = await readNote("Adjust Parent.md");
        return note.includes("timeEstimate: 5760") && /due:\s*'?2026-04-09'?/.test(note);
      },
      {
        timeout: 20000,
        timeoutMsg: async () =>
          `adjust-to-fit left dates and estimate apart — note is now: ${await readNote("Adjust Parent.md")}`,
      },
    );

    // The drag mirrored its optimistic shrunken span to the duplicate placement;
    // the correction must bring BOTH placements back to the fitted span, not just
    // the dragged row.
    await browser.waitUntil(
      async () => {
        const dragged = await barInfo("Adjust Parent.md");
        const duplicate = await barInfo(duplicateId);
        return (
          dragged !== null &&
          duplicate !== null &&
          Math.abs(dragged.width - fittedWidth) < pxPerDay / 2 &&
          Math.abs(duplicate.width - fittedWidth) < pxPerDay / 2
        );
      },
      {
        timeout: 15000,
        timeoutMsg: async () =>
          `adjust-to-fit left an instance at the rejected span — expected ~${fittedWidth}px, ` +
          `dragged ${JSON.stringify(await barInfo("Adjust Parent.md"))}, ` +
          `duplicate ${JSON.stringify(await barInfo(duplicateId))}`,
      },
    );
  });

  it("persists the working-day estimate and authors no date for an estimate-only seam drag", async () => {
    await switchBase("InferredDragSeam.base", ["Seam Only.md", "Blocked Parent.md", "Blocked Child.md"]);
    // Mon 05-04 + 2 working days → the bar ends Tue 05-05.
    await waitForBar("Seam Only.md");
    await dragEndEdge("Seam Only.md", 5);
    await waitForPrompt(lastDragged);
    await chooseAction("Estimate only");

    // Dragging the end 5 days out spans Mon..Sun — 5 working days, since Sat and
    // Sun carry no work. The persisted estimate must be those 5 working days, not
    // the 7 calendar days just drawn.
    await browser.waitUntil(
      async () => /timeEstimate:\s*7200/.test(await readNote("Seam Only.md")),
      {
        timeout: 20000,
        timeoutMsg: async () =>
          `the working-day estimate was not saved — note is now: ${await readNote("Seam Only.md")}`,
      },
    );
    expect(await readNote("Seam Only.md")).toMatch(/timeEstimate:\s*7200/);
    // And no date was authored — the edge stays derived.
    expect(await readNote("Seam Only.md")).not.toMatch(/due:/);
  });
});
