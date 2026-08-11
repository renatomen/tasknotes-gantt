import { browser, expect, $, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import { waitUntilOrExplain } from "./helpers/waitReady";

/**
 * U14 — calendar-note editor routing shell.
 *
 * The routing is a `setViewState` interception, so the guarantees that matter
 * are behavioural and only observable in real Obsidian: a marked note opens as
 * the editor with no markdown flash; a note that loses its marker heals back;
 * "Open as markdown" always works; and disabling the plugin leaves every
 * calendar note opening as ordinary markdown — the floor.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-calendar");

const EDITOR_VIEW = "tngantt-calendar-editor";

/**
 * In-page instrumentation for the offset hint's minutely heartbeat: the ticks the
 * form armed (so a test can fire one), the ids disposed, and the untouched
 * originals to restore. Declared out here because both the arming and the
 * assertion run in separate `browser.execute` calls.
 */
interface OffsetProbe {
  armed: { id: number; fire: () => void }[];
  cleared: number[];
  realSetInterval: typeof window.setInterval;
  realClearInterval: typeof window.clearInterval;
  RealDate: DateConstructor;
}
type ProbedWindow = typeof window & { __ogOffsetProbe?: OffsetProbe; __ogClockSkewMs?: number };

// Both ends of the DST crossing are FIXED instants, so the case reads the same
// offsets whatever the real date is: Auckland is UTC+12:00 in July and UTC+13:00
// in January. Leaving either end on the real clock would make the assertions
// seasonal — the spec would time out for the half of the year that already sits
// on the other side of the transition.
const NZ_STANDARD_INSTANT = "2026-07-15T00:00:00Z";
const NZ_DAYLIGHT_INSTANT = "2027-01-15T00:00:00Z";

/** The view type of the active leaf, as Obsidian itself reports it. */
async function activeViewType(): Promise<string | null> {
  return browser.executeObsidian(({ app }) => {
    const leaf = app.workspace.activeLeaf;
    return leaf ? leaf.getViewState().type : null;
  });
}

interface EditorConflictState {
  yearConflicts: number;
  /** Conflicts per weekday row; the grid lays Mon..Sun out as rows 1..7. */
  conflictsByRow: Record<number, number>;
  /** The year the grid is rendering, read from it rather than from the clock. */
  year: number;
  /** Total rendered day cells — zero means the grid is absent, not clean. */
  yearCells: number;
  text: string;
  cls: string;
}

/** The year grid's rows for weekdays, its Mon-first layout being 1-based. */
const FRIDAY_ROW = 5;
const SUNDAY_ROW = 7;

/**
 * How often a weekday falls in a year. Asserting the COUNT per weekday is what
 * pins recurrence: a set of distinct rows is satisfied by a single cell per row,
 * so a broken expansion that produced one Friday would pass it.
 */
function weekdayOccurrences(year: number, mondayBasedRow: number): number {
  const jsDay = mondayBasedRow === 7 ? 0 : mondayBasedRow; // grid row 7 is Sunday
  let count = 0;
  for (
    const day = new Date(Date.UTC(year, 0, 1));
    day.getUTCFullYear() === year;
    day.setUTCDate(day.getUTCDate() + 1)
  ) {
    if (day.getUTCDay() === jsDay) count += 1;
  }
  return count;
}

/**
 * The year grid's conflict count and the status banner, read from the ACTIVE
 * editor leaf in one shot — a global selector can match a stale background leaf,
 * decoupling the banner (one leaf) from the year stripes (another). Scoping to
 * the active leaf's container keeps them the same instance. The conflict cells
 * use `.og-year-cell.og-year-conflict` so the legend swatch (also
 * `.og-year-conflict`, but not a grid cell) is not counted.
 */
async function readConflictState(): Promise<EditorConflictState | null> {
  return browser.executeObsidian(({ app }) => {
    const root = (app.workspace.activeLeaf?.view as { containerEl?: HTMLElement } | undefined)
      ?.containerEl;
    if (!root) return null;
    const banner = root.querySelector(".og-cal-status");
    const conflicted = Array.from(
      root.querySelectorAll<HTMLElement>(".og-year-cell.og-year-conflict"),
    );
    const byRow: Record<number, number> = {};
    for (const cell of conflicted) {
      // Read the style PROPERTY, not the attribute: Svelte compiles an
      // interpolated style into direct property assignments, so the attribute
      // can be absent while the value is plainly there.
      const raw = cell.style.gridRow || cell.style.gridRowStart;
      const row = Number(/(\d+)/.exec(raw ?? "")?.[1]);
      if (Number.isFinite(row)) byRow[row] = (byRow[row] ?? 0) + 1;
    }
    const label = root.querySelector(".og-year-grid")?.getAttribute("aria-label") ?? "";
    return {
      yearConflicts: conflicted.length,
      yearCells: root.querySelectorAll(".og-year-cell").length,
      conflictsByRow: byRow,
      year: Number(/(\d{4})/.exec(label)?.[1] ?? 0),
      text: banner?.textContent ?? "",
      cls: banner?.className ?? "",
    };
  });
}

/** Put the calendar marker back, whatever a previous test did to it. */
async function restoreMarker(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    const file = app.vault.getAbstractFileByPath("NZ Holidays.md");
    if (!file) throw new Error("fixture calendar missing");
    const body = await app.vault.read(file as never);
    await app.vault.modify(file as never, (body as string).replace("tngantt: none", "tngantt: calendar"));
  });
  await browser.pause(300);
}

async function openNote(notePath: string): Promise<void> {
  await browser.executeObsidian(async ({ app }, p) => {
    const file = app.vault.getAbstractFileByPath(p);
    if (!file) return;
    // Close prior tabs so the opened note is the single active, laid-out leaf.
    // Stale background leaves keep their DOM but render display:none, so their
    // controls exist yet are not interactable.
    app.workspace.detachLeavesOfType("tngantt-calendar-editor");
    app.workspace.detachLeavesOfType("markdown");
    const leaf = app.workspace.getLeaf(true);
    await leaf.openFile(file as never);
    await app.workspace.revealLeaf(leaf);
    app.workspace.setActiveLeaf(leaf, { focus: true });
  }, notePath);
  await browser.pause(400);
}

describe("Gantt (OG) calendar editor routing", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-gantt-editor-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });
    await browser.reloadObsidian({ vault: tmpVault, plugins: ["tasknotes-gantt"] });
  });

  it("opens a marked calendar note in the editor view", async () => {
    await openNote("NZ Holidays.md");
    await browser.waitUntil(async () => (await activeViewType()) === EDITOR_VIEW, {
      timeout: 20000,
      timeoutMsg: "calendar note did not route to the editor view",
    });
    expect((await $$(".og-calendar-editor")).length).toBeGreaterThan(0);
  });

  it("leaves an unmarked note as markdown", async () => {
    await openNote("Task Plain.md");
    expect(await activeViewType()).toBe("markdown");
  });

  it("routes a calendar-set note the same way", async () => {
    // Written here rather than shipped as a fixture: the other calendar specs
    // resolve set members, and an extra set note would change their unions.
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create(
        "Team Set.md",
        '---\ntngantt: calendar-set\ncalendars:\n  - "[[NZ Holidays]]"\n---\n'
      );
    });
    await openNote("Team Set.md");
    await browser.waitUntil(async () => (await activeViewType()) === EDITOR_VIEW, {
      timeout: 20000,
      timeoutMsg: "calendar-set note did not route to the editor view",
    });
    expect(await activeViewType()).toBe(EDITOR_VIEW);
  });

  it("heals back to markdown when the marker is removed", async () => {
    await openNote("NZ Holidays.md");
    await browser.waitUntil(async () => (await activeViewType()) === EDITOR_VIEW, {
      timeout: 20000,
      timeoutMsg: "editor never opened before the marker edit",
    });

    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getAbstractFileByPath("NZ Holidays.md");
      if (!file) throw new Error("fixture calendar missing");
      const body = await app.vault.read(file as never);
      await app.vault.modify(file as never, (body as string).replace("tngantt: calendar", "tngantt: none"));
    });

    // Re-opening is what a user does; the view heals itself on setState.
    await openNote("NZ Holidays.md");
    await browser.waitUntil(async () => (await activeViewType()) === "markdown", {
      timeout: 20000,
      timeoutMsg: "a markerless note did not heal back to markdown",
    });
    expect(await activeViewType()).toBe("markdown");
  });

  it("heals WHILE OPEN when the marker is removed under it", async () => {
    // Obsidian does not re-invoke setState when a note's frontmatter changes,
    // so healing has to watch the metadata cache. Without that the editor
    // stays open on a note that is no longer a calendar.
    await restoreMarker();
    await openNote("NZ Holidays.md");
    await browser.waitUntil(async () => (await activeViewType()) === EDITOR_VIEW, {
      timeout: 20000,
      timeoutMsg: "editor never opened",
    });

    // Edit the marker away WITHOUT reopening the note.
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getAbstractFileByPath("NZ Holidays.md");
      if (!file) throw new Error("fixture calendar missing");
      const body = await app.vault.read(file as never);
      await app.vault.modify(file as never, (body as string).replace("tngantt: calendar", "tngantt: none"));
    });

    await browser.waitUntil(async () => (await activeViewType()) === "markdown", {
      timeout: 20000,
      timeoutMsg: "the open editor did not heal when its marker was removed",
    });
    expect(await activeViewType()).toBe("markdown");
  });

  it("'Open as markdown' escapes the editor even though the marker is still there", async () => {
    // The regression this exists for: the interceptor re-routed the escape
    // hatch straight back to the editor, so it silently did nothing.
    //
    // Owns its own precondition rather than inheriting the previous test's
    // vault state — the healing test above deliberately strips the marker.
    await restoreMarker();
    await openNote("NZ Holidays.md");
    await browser.waitUntil(async () => (await activeViewType()) === EDITOR_VIEW, {
      timeout: 20000,
      timeoutMsg: "editor never opened",
    });

    await browser.executeObsidian(async ({ app }) => {
      const view = app.workspace.activeLeaf?.view as unknown as {
        openAsMarkdown?: () => Promise<void>;
      };
      await view?.openAsMarkdown?.();
    });

    await browser.waitUntil(async () => (await activeViewType()) === "markdown", {
      timeout: 20000,
      timeoutMsg: "'Open as markdown' did not reach the markdown view",
    });

    // And the note still routes to the editor next time it is opened — the
    // escape hatch is per-open, not a persistent opt-out.
    await openNote("Task Plain.md");
    await openNote("NZ Holidays.md");
    await browser.waitUntil(async () => (await activeViewType()) === EDITOR_VIEW, {
      timeout: 20000,
      timeoutMsg: "routing did not resume after an explicit markdown open",
    });
    expect(await activeViewType()).toBe(EDITOR_VIEW);
  });

  it("offers 'View as calendar' on a calendar note opened as markdown, routing back", async () => {
    await restoreMarker();
    await openNote("NZ Holidays.md");
    await browser.waitUntil(async () => (await activeViewType()) === EDITOR_VIEW, {
      timeout: 20000,
      timeoutMsg: "editor never opened",
    });

    // Drop to markdown via the escape hatch.
    await browser.executeObsidian(async ({ app }) => {
      const view = app.workspace.activeLeaf?.view as unknown as {
        openAsMarkdown?: () => Promise<void>;
      };
      await view?.openAsMarkdown?.();
    });
    await browser.waitUntil(async () => (await activeViewType()) === "markdown", {
      timeout: 20000,
      timeoutMsg: "did not drop to markdown",
    });

    // The pane 'more options' menu (source 'more-options') must offer the way back.
    const offered = await browser.executeObsidian(({ app }) => {
      const leaf = app.workspace.activeLeaf;
      const file = app.vault.getAbstractFileByPath("NZ Holidays.md");
      let clickBack: (() => void) | null = null;
      let title: string | null = null;
      const menu = {
        addItem(cb: (item: unknown) => void) {
          const item = {
            setTitle(t: string) {
              title = t;
              return item;
            },
            setIcon() {
              return item;
            },
            onClick(handler: () => void) {
              clickBack = handler;
              return item;
            },
          };
          cb(item);
        },
      };
      app.workspace.trigger("file-menu", menu, file, "more-options", leaf);
      if (title === "View as calendar" && clickBack) (clickBack as () => void)();
      return title;
    });
    expect(offered).toBe("View as calendar");

    await browser.waitUntil(async () => (await activeViewType()) === EDITOR_VIEW, {
      timeout: 20000,
      timeoutMsg: "'View as calendar' did not route back to the editor",
    });
  });

  it("exposes the escape hatch as a command too", async () => {
    const command = await browser.executeObsidian(({ app }) => {
      const commands = (app as unknown as {
        commands: { commands: Record<string, unknown> };
      }).commands.commands;
      return Object.keys(commands).find((id) => id.includes("open-calendar-as-markdown")) ?? null;
    });
    expect(command).not.toBeNull();
  });

  it("saves a form edit back to frontmatter, preserving a hand-authored comment", async () => {
    await restoreMarker();
    // Seed a comment we can prove survives a form save.
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getAbstractFileByPath("NZ Holidays.md");
      if (!file) throw new Error("fixture calendar missing");
      const body = await app.vault.read(file as never);
      if (!(body as string).includes("# hand comment")) {
        await app.vault.modify(
          file as never,
          (body as string).replace("tngantt: calendar", "tngantt: calendar\n# hand comment")
        );
      }
    });

    await openNote("NZ Holidays.md");
    const textarea = await $(".og-cal-form textarea");
    await textarea.waitForClickable({ timeout: 20000, timeoutMsg: "editor form never became interactable" });

    // Drive the field through real typing so Svelte's binding sees the change
    // (a programmatic value-set does not update a two-way bound input).
    await textarea.setValue("Edited by the form");

    // The Save button enables only once the form is dirty; that gates the click.
    const save = await $('.og-cal-form button.mod-cta');
    await save.waitForEnabled({ timeout: 10000, timeoutMsg: "Save never enabled after an edit" });
    await save.click();

    await browser.waitUntil(
      async () => {
        const text = await browser.executeObsidian(async ({ app }) => {
          const file = app.vault.getAbstractFileByPath("NZ Holidays.md");
          return file ? ((await app.vault.read(file as never)) as string) : "";
        });
        return text.includes("description: Edited by the form");
      },
      { timeout: 20000, timeoutMsg: "the form save never reached the frontmatter" }
    );

    const saved = await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getAbstractFileByPath("NZ Holidays.md");
      return file ? ((await app.vault.read(file as never)) as string) : "";
    });
    expect(saved).toContain("description: Edited by the form");
    // The hand-authored comment survived the save.
    expect(saved).toContain("# hand comment");
  });

  it("rejects a name that strips to just the extension and keeps Save disabled", async () => {
    await restoreMarker();
    await openNote("NZ Holidays.md");
    await (await $(".og-cal-form")).waitForExist({ timeout: 20000 });

    const nameInput = await $('.og-cal-form input[aria-label="Calendar name"]');
    await nameInput.waitForClickable({ timeout: 20000, timeoutMsg: "name field never became interactable" });

    // Typing just the extension strips to an empty basename — the same empty-name
    // error as a blank name — so Save must stay disabled (no rename to a dotfile).
    await nameInput.setValue(".md");

    // Scope to the Name field's own error (its sibling) — the form also renders a
    // generic 'fix the flagged fields' header error with the same class.
    const error = await $('.og-cal-form input[aria-label="Calendar name"] ~ span.og-cal-error');
    await error.waitForDisplayed({ timeout: 10000, timeoutMsg: "no empty-name error surfaced for '.md'" });
    expect(await error.getText()).toMatch(/empty/i);

    const save = await $(".og-cal-form button.mod-cta");
    expect(await save.isEnabled()).toBe(false);
  });

  it("edits the working pattern visually and round-trips to RRULE", async () => {
    await restoreMarker();
    await openNote("NZ Holidays.md");
    await (await $(".og-cal-form")).waitForExist({ timeout: 20000 });

    // The visual builder shows a weekday toggle per day — no raw RRULE.
    expect(await $$(".og-rrule-day")).toHaveLength(7);

    // Turn Saturday on, then reveal the underlying rule via the escape hatch.
    await (await $(".og-rrule-day=Sat")).click();
    await (await $(".og-rrule-text-toggle")).click();
    const raw = await $(".og-rrule input.og-cal-mono");
    await raw.waitForDisplayed({ timeout: 5000, timeoutMsg: "raw pattern field did not appear" });
    expect(await raw.getValue()).toContain("SA");
  });

  it("picks a CSS3 colour from the collapsed colour field and saves the name", async () => {
    await restoreMarker();
    await openNote("NZ Holidays.md");
    await (await $(".og-cal-form")).waitForExist({ timeout: 20000 });

    // Collapsed by default: the summary shows; the picker panel does not exist.
    const summary = await $(".og-color-summary");
    await summary.waitForDisplayed({ timeout: 20000, timeoutMsg: "colour field never rendered" });
    expect(await $$(".og-color-panel")).toHaveLength(0);

    // Expand, search, and pick a named colour.
    await summary.click();
    const search = await $(".og-color-search");
    await search.waitForDisplayed({ timeout: 10000, timeoutMsg: "colour picker did not expand" });
    await search.setValue("cornflower");
    const option = await $(".og-color-item*=cornflowerblue");
    await option.waitForDisplayed({ timeout: 10000, timeoutMsg: "the search did not surface cornflowerblue" });
    await option.click();

    // Picking collapses the field and shows the chosen name.
    await browser.waitUntil(async () => (await (await $(".og-color-val")).getText()) === "cornflowerblue", {
      timeout: 10000,
      timeoutMsg: "the summary did not reflect the picked colour",
    });
    expect(await $$(".og-color-panel")).toHaveLength(0);

    // Save writes the CSS3 name straight to frontmatter.
    const save = await $(".og-cal-form button.mod-cta");
    await save.waitForEnabled({ timeout: 10000, timeoutMsg: "Save never enabled after picking a colour" });
    await save.click();
    await browser.waitUntil(
      async () => {
        const text = await browser.executeObsidian(async ({ app }) => {
          const file = app.vault.getAbstractFileByPath("NZ Holidays.md");
          return file ? ((await app.vault.read(file as never)) as string) : "";
        });
        return /^color:\s*cornflowerblue\s*$/m.test(text);
      },
      { timeout: 20000, timeoutMsg: "the picked colour name never reached the frontmatter" },
    );
  });

  it("renames the calendar from the Name field on save", async () => {
    // A throwaway note with no backlinks, so the rename exercises the field, not
    // Obsidian's own "update links?" prompt (which fires for a linked note).
    await browser.executeObsidian(async ({ app }) => {
      for (const path of ["Rename Me.md", "Renamed Cal.md"]) {
        const stale = app.vault.getAbstractFileByPath(path);
        if (stale) await app.vault.delete(stale as never);
      }
      await app.vault.create("Rename Me.md", "---\ntngantt: calendar\n---\n");
    });
    await openNote("Rename Me.md");

    const nameInput = await $('.og-cal-form input[aria-label="Calendar name"]');
    await nameInput.waitForDisplayed({ timeout: 20000, timeoutMsg: "the Name field never rendered" });
    expect(await nameInput.getValue()).toBe("Rename Me");

    await nameInput.setValue("Renamed Cal");
    const save = await $(".og-cal-form button.mod-cta");
    await save.waitForEnabled({ timeout: 10000, timeoutMsg: "Save never enabled after a name edit" });
    await save.click();

    await browser.waitUntil(
      async () => {
        const [renamed, original] = await browser.executeObsidian(({ app }) => [
          app.vault.getAbstractFileByPath("Renamed Cal.md") !== null,
          app.vault.getAbstractFileByPath("Rename Me.md") !== null,
        ]);
        return renamed && !original;
      },
      { timeout: 20000, timeoutMsg: "the note was not renamed on disk" },
    );
    // The editor stays open on the renamed note.
    expect(await activeViewType()).toBe(EDITOR_VIEW);

    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getAbstractFileByPath("Renamed Cal.md");
      if (file) await app.vault.delete(file as never);
    });
    await browser.pause(300);
  });

  it("offers a searchable timezone picker on the timezone field", async () => {
    await restoreMarker();
    await openNote("NZ Holidays.md");
    const tz = await $('.og-cal-form input[placeholder^="Search a timezone"]');
    await tz.waitForClickable({ timeout: 20000, timeoutMsg: "timezone field never became interactable" });
    await tz.click();
    await tz.setValue("Auckland");

    const suggestion = await $(".suggestion-container .suggestion-item");
    await suggestion.waitForDisplayed({ timeout: 10000, timeoutMsg: "no timezone suggestions appeared" });
    const suggestionText = await suggestion.getText();
    expect(suggestionText).toContain("Auckland");
    // Each zone shows its live UTC offset, so similar names are distinguishable.
    expect(suggestionText).toMatch(/UTC[+-]\d{2}:\d{2}/);

    await suggestion.click();
    await browser.waitUntil(async () => (await tz.getValue()) === "Pacific/Auckland", {
      timeout: 10000,
      timeoutMsg: "picking a suggestion did not fill the field",
    });
  });

  it("refreshes the 'Currently' offset hint on its heartbeat, and disposes it on close", async () => {
    // The hint says "Currently", so a form left open across a DST transition must
    // not fossilise the pre-transition offset. Only the real component proves that:
    // the derivation's time dependency, the effect that arms the minutely tick, and
    // the teardown that disposes it are all component wiring the unit tests can't see.
    // So: record minutely intervals, make the renderer's clock skewable, then cross a
    // boundary by firing the recorded tick — the hint can only move if the wiring holds.
    // Restores the marker itself (and before the clock moves) so it runs standalone.
    await restoreMarker();
    await browser.execute((standardInstant: string) => {
      const w = window as ProbedWindow;
      const probe: OffsetProbe = {
        armed: [],
        cleared: [],
        realSetInterval: window.setInterval.bind(window),
        realClearInterval: window.clearInterval.bind(window),
        RealDate: Date,
      };
      w.__ogOffsetProbe = probe;
      // Open the form on a fixed July instant, so the pre-transition offset the
      // hint must show does not depend on today's date.
      w.__ogClockSkewMs = new probe.RealDate(standardInstant).getTime() - probe.RealDate.now();
      w.setInterval = ((fire: () => void, ms?: number) => {
        const id = probe.realSetInterval(fire, ms) as unknown as number;
        if (ms === 60_000) probe.armed.push({ id, fire });
        return id;
      }) as typeof window.setInterval;
      w.clearInterval = ((id: number) => {
        probe.cleared.push(id);
        probe.realClearInterval(id);
      }) as typeof window.clearInterval;
      // The bundle resolves `Date` off the global at call time, so the hint's
      // `new Date()` lands on this skewable clock.
      w.Date = class extends probe.RealDate {
        constructor(...args: unknown[]) {
          if (args.length === 0) super(probe.RealDate.now() + (w.__ogClockSkewMs ?? 0));
          else super(...(args as []));
        }
        static now(): number {
          return probe.RealDate.now() + (w.__ogClockSkewMs ?? 0);
        }
      } as unknown as DateConstructor;
    }, NZ_STANDARD_INSTANT);
    try {
      await openNote("NZ Holidays.md");
      const tz = await $('.og-cal-form input[placeholder^="Search a timezone"]');
      await tz.waitForClickable({ timeout: 20000, timeoutMsg: "timezone field never became interactable" });
      await tz.click();
      await tz.setValue("Auckland");
      const suggestion = await $(".suggestion-container .suggestion-item");
      await suggestion.waitForDisplayed({ timeout: 10000, timeoutMsg: "no timezone suggestions appeared" });
      await suggestion.click();

      // The pinned July instant is New Zealand standard time.
      const hint = await $(".og-cal-hint*=Currently");
      await browser.waitUntil(async () => (await hint.getText()).includes("UTC+12:00"), {
        timeout: 10000,
        timeoutMsg: "the hint never showed the chosen zone's standard-time offset",
      });

      const armedIds: number[] = await browser.execute(
        () => ((window as ProbedWindow).__ogOffsetProbe as OffsetProbe).armed.map((tick) => tick.id),
      );
      expect(armedIds.length).toBeGreaterThan(0);

      // Cross into New Zealand daylight time WITHOUT touching the form, then fire
      // the recorded tick: nothing else can carry the new offset into the hint.
      await browser.execute((daylightInstant: string) => {
        const w = window as ProbedWindow;
        const probe = w.__ogOffsetProbe as OffsetProbe;
        w.__ogClockSkewMs = new probe.RealDate(daylightInstant).getTime() - probe.RealDate.now();
        for (const tick of probe.armed) tick.fire();
      }, NZ_DAYLIGHT_INSTANT);
      await browser.waitUntil(async () => (await hint.getText()).includes("UTC+13:00"), {
        timeout: 10000,
        timeoutMsg: "the heartbeat did not refresh the offset hint across the DST boundary",
      });

      // Restore the clock before closing, so teardown never runs on a 2027 date.
      await browser.execute(() => {
        (window as ProbedWindow).__ogClockSkewMs = 0;
      });
      await browser.executeObsidian(({ app }) => {
        app.workspace.detachLeavesOfType("tngantt-calendar-editor");
      });
      // `some`, not `every`: a minutely interval armed elsewhere in this window is
      // not the editor's to clear. The claim is that closing disposed one of ITS ticks.
      await browser.waitUntil(
        async () =>
          browser.execute(
            (ids: number[]) =>
              ids.some((id) =>
                ((window as ProbedWindow).__ogOffsetProbe as OffsetProbe).cleared.includes(id),
              ),
            armedIds,
          ),
        { timeout: 10000, timeoutMsg: "closing the editor did not dispose its offset heartbeat" },
      );
    } finally {
      await browser.execute(() => {
        const w = window as ProbedWindow;
        const probe = w.__ogOffsetProbe;
        if (probe) {
          w.setInterval = probe.realSetInterval;
          w.clearInterval = probe.realClearInterval;
          w.Date = probe.RealDate;
        }
        delete w.__ogOffsetProbe;
        delete w.__ogClockSkewMs;
      });
    }
  });

  it("previews the working week on the Week tab", async () => {
    await restoreMarker();
    await openNote("NZ Holidays.md");
    await (await $(".og-cal-form")).waitForExist({ timeout: 20000 });

    await (await $(".og-cal-tab=Week")).click();
    const week = await $(".og-week-grid");
    await week.waitForDisplayed({ timeout: 10000, timeoutMsg: "the week grid did not render" });
    // Seven day columns, Monday through Sunday.
    expect(await $$(".og-week-col")).toHaveLength(7);
  });

  it("previews the shading strip on the Gantt strip tab", async () => {
    await restoreMarker();
    await openNote("NZ Holidays.md");
    await (await $(".og-cal-form")).waitForExist({ timeout: 20000 });

    await (await $(".og-cal-tab=Gantt strip")).click();
    const track = await $(".og-strip-track");
    await track.waitForDisplayed({ timeout: 10000, timeoutMsg: "the gantt strip did not render" });
    // A day cell per day of the multi-month window.
    expect((await $$(".og-strip-cell")).length).toBeGreaterThan(60);
  });

  it("keeps a hostile marker colour out of the strip's inline style", async () => {
    // The strip marker inlines the calendar colour; an unpaintable value must
    // fall back to the theme accent, never reach the style as url()/injection.
    await createNote(
      "Strip Marker Cal.md",
      '---\ntngantt: calendar\ncolor: "url(https://example.invalid/x.png)"\nevents:\n  - date: "2026-06-15"\n    name: "Ship"\n    marker: true\n---\n',
    );
    await openNote("Strip Marker Cal.md");
    await (await $(".og-cal-form")).waitForExist({ timeout: 20000 });
    await (await $(".og-cal-tab=Gantt strip")).click();
    const marker = await $(".og-strip-marker");
    await marker.waitForDisplayed({ timeout: 10000, timeoutMsg: "the strip marker did not render" });
    const style = (await marker.getAttribute("style")) ?? "";
    expect(style).not.toContain("url(");
    // Hostile colour rejected, so no inline background — the CSS theme accent wins.
    expect(style).not.toContain("background");

    await deleteNotes(["Strip Marker Cal.md"]);
  });

  it("previews the year on the Year tab and keeps the unsaved form on return", async () => {
    await restoreMarker();
    await openNote("NZ Holidays.md");

    const textarea = await $(".og-cal-form textarea");
    await textarea.waitForClickable({ timeout: 20000, timeoutMsg: "editor form never became interactable" });
    await textarea.setValue("Edited then previewed");

    await (await $(".og-cal-tab=Year")).click();
    const grid = await $(".og-year-grid");
    await grid.waitForDisplayed({ timeout: 10000, timeoutMsg: "the year grid did not render" });
    // A full year of day cells plus the padding of the partial end weeks.
    expect((await $$(".og-year-cell")).length).toBeGreaterThan(300);

    // Back to Edit: the tabs share one component, so the unsaved edit survives.
    await (await $(".og-cal-tab=Edit")).click();
    expect(await (await $(".og-cal-form textarea")).getValue()).toBe("Edited then previewed");
  });

  it("warns and offers reload when the note changes on disk under an unsaved edit", async () => {
    // An external write (sync, a hand edit, another editor) can land while the
    // form holds unsaved edits. Saving then would apply the change set to the
    // new disk contents and silently clobber the external write, so the editor
    // must surface a reload-or-keep choice instead.
    await restoreMarker();
    await openNote("NZ Holidays.md");

    const textarea = await $(".og-cal-form textarea");
    await textarea.waitForClickable({ timeout: 20000, timeoutMsg: "editor form never became interactable" });
    await textarea.setValue("Half-typed local edit");

    // Simulate an external write to the same note WITHOUT going through the form.
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getAbstractFileByPath("NZ Holidays.md");
      if (!file) throw new Error("fixture calendar missing");
      const body = await app.vault.read(file as never);
      await app.vault.modify(file as never, `${body as string}\nExternal edit line.\n`);
    });

    const notice = await $(".og-cal-notice");
    await notice.waitForDisplayed({
      timeout: 20000,
      timeoutMsg: "no reload-or-keep notice appeared after an external change under a dirty edit",
    });

    // Reload discards the in-progress edit and picks up the disk state.
    await (await $(".og-cal-notice-btn")).click();
    await browser.waitUntil(
      async () => (await (await $(".og-cal-form textarea")).getValue()) !== "Half-typed local edit",
      { timeout: 20000, timeoutMsg: "the form did not reload from disk after discarding edits" },
    );
    expect(await (await $(".og-cal-notice")).isDisplayed()).toBe(false);
  });

  it("preserves a concurrent external edit when the dirty form is saved", async () => {
    // Keeping edits and saving must merge, not clobber: the save writes only the
    // fields the form changed onto the freshest disk contents, so an unrelated
    // external edit survives rather than being overwritten by a stale snapshot.
    await restoreMarker();
    await openNote("NZ Holidays.md");

    const textarea = await $(".og-cal-form textarea");
    await textarea.waitForClickable({ timeout: 20000, timeoutMsg: "editor form never became interactable" });
    await textarea.setValue("Kept local edit");

    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getAbstractFileByPath("NZ Holidays.md");
      if (!file) throw new Error("fixture calendar missing");
      const body = await app.vault.read(file as never);
      await app.vault.modify(file as never, `${body as string}\nExternal-only marker line.\n`);
    });

    await (await $(".og-cal-notice")).waitForDisplayed({
      timeout: 20000,
      timeoutMsg: "no notice appeared for the concurrent external edit",
    });

    const save = await $(".og-cal-form button.mod-cta");
    await save.waitForEnabled({ timeout: 10000, timeoutMsg: "Save never enabled" });
    await save.click();

    const readNote = async (): Promise<string> =>
      browser.executeObsidian(async ({ app }) => {
        const file = app.vault.getAbstractFileByPath("NZ Holidays.md");
        return file ? ((await app.vault.read(file as never)) as string) : "";
      });

    await browser.waitUntil(async () => (await readNote()).includes("description: Kept local edit"), {
      timeout: 20000,
      timeoutMsg: "the local edit never reached the frontmatter",
    });
    const saved = await readNote();
    expect(saved).toContain("description: Kept local edit"); // the form's edit applied
    expect(saved).toContain("External-only marker line."); // the concurrent external edit survived
  });

  it("refreshes silently when the note changes on disk and the form is clean", async () => {
    // With no unsaved edits, a clean form must pick up the disk state at once —
    // not nag, and not keep showing (or later save from) stale values.
    await restoreMarker();
    await openNote("NZ Holidays.md");
    await (await $(".og-cal-form textarea")).waitForExist({ timeout: 20000 });

    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getAbstractFileByPath("NZ Holidays.md");
      if (!file) throw new Error("fixture calendar missing");
      const body = await app.vault.read(file as never);
      const next = /^description:.*$/m.test(body as string)
        ? (body as string).replace(/^description:.*$/m, "description: Externally set value")
        : (body as string).replace("tngantt: calendar", "tngantt: calendar\ndescription: Externally set value");
      await app.vault.modify(file as never, next);
    });

    await browser.waitUntil(
      async () => (await (await $(".og-cal-form textarea")).getValue()) === "Externally set value",
      { timeout: 20000, timeoutMsg: "the clean form did not refresh to the external value" },
    );
    expect(await (await $(".og-cal-notice")).isDisplayed()).toBe(false);
  });

  it("keeps an unsaved edit when the note is renamed under it, and saves to the new path", async () => {
    await restoreMarker();
    await openNote("NZ Holidays.md");

    const textarea = await $(".og-cal-form textarea");
    await textarea.waitForClickable({ timeout: 20000, timeoutMsg: "editor form never became interactable" });
    await textarea.setValue("Edited then renamed");

    // Rename the note while the edit is unsaved (vault.rename fires the same
    // rename event the view listens to, without fileManager's link rewriting).
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getAbstractFileByPath("NZ Holidays.md");
      if (!file) throw new Error("fixture calendar missing");
      await app.vault.rename(file as never, "NZ Holidays Renamed.md");
    });
    await browser.pause(500);

    // The form was not rebuilt, so the in-progress edit survives.
    expect(await textarea.getValue()).toBe("Edited then renamed");

    // And Save now targets the renamed note.
    const save = await $(".og-cal-form button.mod-cta");
    await save.waitForEnabled({ timeout: 10000, timeoutMsg: "Save never enabled" });
    await save.click();

    await browser.waitUntil(
      async () => {
        const text = await browser.executeObsidian(async ({ app }) => {
          const file = app.vault.getAbstractFileByPath("NZ Holidays Renamed.md");
          return file ? ((await app.vault.read(file as never)) as string) : "";
        });
        return text.includes("description: Edited then renamed");
      },
      { timeout: 20000, timeoutMsg: "the save did not reach the renamed note" },
    );

    // Restore the fixture name for the tests that follow.
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getAbstractFileByPath("NZ Holidays Renamed.md");
      if (file) await app.vault.rename(file as never, "NZ Holidays.md");
    });
    await browser.pause(300);
  });

  it("keeps the edit and does not clear dirty when the note is deleted before saving", async () => {
    // A save that cannot find its file must fail, not silently succeed: the
    // form has to keep the unsaved edit rather than advance its baseline.
    await restoreMarker();
    await openNote("NZ Holidays.md");

    const textarea = await $(".og-cal-form textarea");
    await textarea.waitForClickable({ timeout: 20000, timeoutMsg: "editor form never became interactable" });
    await textarea.setValue("Edit before delete");

    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getAbstractFileByPath("NZ Holidays.md");
      if (!file) throw new Error("fixture calendar missing");
      await app.vault.delete(file as never);
    });
    await browser.pause(400);

    const save = await $(".og-cal-form button.mod-cta");
    await save.click();
    await browser.pause(600);

    // The save failed, so the form is still dirty — Save stays enabled.
    expect(await save.isEnabled()).toBe(true);

    // Recreate the fixture for the tests that follow.
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create("NZ Holidays.md", "---\ntngantt: calendar\ndescription: Recreated\n---\n");
    });
    await browser.pause(300);
  });

  it("guards a single-tab close of a note with unsaved edits, then discards", async () => {
    // Closing a tab calls leaf.detach() directly; the guard fires there. A "Go
    // back" keeps the editor open, a "Discard" lets the close through. (Bulk
    // detaches route through detachLeavesOfType and are deliberately silent —
    // openNote itself relies on that, so it never trips this modal.)
    await restoreMarker();
    await openNote("NZ Holidays.md");

    const textarea = await $(".og-cal-form textarea");
    await textarea.waitForClickable({ timeout: 20000, timeoutMsg: "editor form never became interactable" });
    await textarea.setValue("Unsaved before close");

    const detachActiveEditor = async (): Promise<void> => {
      await browser.executeObsidian(({ app }) => {
        const leaf = app.workspace.getLeavesOfType("tngantt-calendar-editor")[0];
        leaf?.detach();
      });
    };

    // First close attempt → the guard modal appears. "Go back" keeps it open.
    await detachActiveEditor();
    const goBack = await (await $(".modal")).$("button=Go back");
    await goBack.waitForDisplayed({ timeout: 10000, timeoutMsg: "the unsaved-changes guard did not appear" });
    await goBack.click();
    await browser.waitUntil(async () => (await activeViewType()) === EDITOR_VIEW, {
      timeout: 10000,
      timeoutMsg: "'Go back' did not keep the editor open",
    });
    expect(await (await $(".og-cal-form textarea")).getValue()).toBe("Unsaved before close");

    // Second attempt → "Discard" lets the close through, dropping the editor leaf.
    await detachActiveEditor();
    const discard = await (await $(".modal")).$("button=Discard");
    await discard.waitForDisplayed({ timeout: 10000, timeoutMsg: "the guard did not reappear on a second close" });
    await discard.click();
    await browser.waitUntil(
      async () =>
        (await browser.executeObsidian(({ app }) => app.workspace.getLeavesOfType("tngantt-calendar-editor").length)) ===
        0,
      { timeout: 10000, timeoutMsg: "'Discard' did not close the editor leaf" },
    );
  });

  it("disables Discard while a save is in flight, so an unmounting write is never dropped", async () => {
    // The in-flight close path: canSave is false during a save, but Discard was
    // still honored — yet the started vault.process can land after the leaf is
    // gone, so discarding then would not actually discard. Hold the write
    // pending and assert the guard offers a DISABLED Discard (Go back only).
    await restoreMarker();
    await openNote("NZ Holidays.md");

    const textarea = await $(".og-cal-form textarea");
    await textarea.waitForClickable({ timeout: 20000, timeoutMsg: "editor form never became interactable" });
    await textarea.setValue("Edited while a save hangs");

    // Patch vault.process to never settle until released — the form stays saving.
    await browser.executeObsidian(({ app }) => {
      const vault = app.vault as unknown as {
        process: (...args: unknown[]) => Promise<unknown>;
        __origProcess?: (...args: unknown[]) => Promise<unknown>;
      };
      vault.__origProcess = vault.process.bind(vault);
      vault.process = (...args: unknown[]) =>
        new Promise((resolve) => {
          (window as unknown as { __releaseSave?: () => void }).__releaseSave = () =>
            resolve(vault.__origProcess!(...args));
        });
    });

    // Start the save; it hangs inside the patched process, so saving stays true.
    const save = await $(".og-cal-form button.mod-cta");
    await save.waitForEnabled({ timeout: 10000, timeoutMsg: "Save never enabled after an edit" });
    await save.click();

    // Close the tab mid-save → the guard appears with Discard disabled.
    await browser.executeObsidian(({ app }) => {
      const leaf = app.workspace.getLeavesOfType("tngantt-calendar-editor")[0];
      leaf?.detach();
    });
    const modal = await $(".modal");
    const discard = await modal.$("button=Discard");
    await discard.waitForDisplayed({ timeout: 10000, timeoutMsg: "the guard did not appear during an in-flight save" });
    expect(await discard.isEnabled()).toBe(false);

    // Go back keeps the editor open; then release the held save and restore process.
    await (await modal.$("button=Go back")).click();
    await browser.waitUntil(async () => (await activeViewType()) === EDITOR_VIEW, {
      timeout: 10000,
      timeoutMsg: "'Go back' did not keep the editor open during an in-flight save",
    });
    await browser.executeObsidian(({ app }) => {
      (window as unknown as { __releaseSave?: () => void }).__releaseSave?.();
      const vault = app.vault as unknown as {
        process: (...args: unknown[]) => Promise<unknown>;
        __origProcess?: (...args: unknown[]) => Promise<unknown>;
      };
      if (vault.__origProcess) vault.process = vault.__origProcess;
    });
    await browser.pause(300);
  });

  const runCommand = async (id: string): Promise<void> => {
    await browser.executeObsidian(({ app }, commandId) => {
      (app as unknown as { commands: { executeCommandById: (id: string) => boolean } }).commands.executeCommandById(
        commandId,
      );
    }, id);
  };

  const readNoteOrNull = async (path: string): Promise<string | null> =>
    browser.executeObsidian(async ({ app }, p) => {
      const file = app.vault.getAbstractFileByPath(p);
      return file ? ((await app.vault.read(file as never)) as string) : null;
    }, path);

  /** What the create folder actually holds — the diagnostic for a note that never landed. */
  const listCreateFolder = async (): Promise<string> =>
    browser.executeObsidian(({ app }) =>
      app.vault
        .getFiles()
        .map((f) => f.path)
        .filter((p) => p.startsWith("Calendars/"))
        .join(", ") || "<no files under Calendars/>",
    );

  /**
   * Run a create command and wait until ITS note is both written and showing.
   *
   * The command writes before it opens (`vault.create` then `leaf.openFile`), so
   * the note existing is not the racy part — the view check was. An editor leaf
   * left open by an earlier test satisfies "an editor is active" on the first
   * tick, before this command has done anything, so the old wait proved nothing
   * and the read that followed raced the write. Closing the editors first makes
   * the active leaf necessarily this command's, and waiting for that leaf to be
   * showing this path ties the assertion to the command's own output.
   *
   * The editor TYPE belongs inside the wait, not after it: when indexing
   * outruns the command's own wait the note opens as Markdown and reroutes
   * asynchronously, so a single check after the path matches fails a reroute
   * that was still on its way. A timeout reports which of the three conditions
   * was unmet, and what the folder held while the note was still missing.
   */
  /** The path the active leaf is showing, or null when no leaf is active. */
  const activeLeafPath = async (): Promise<string | null> =>
    browser.executeObsidian(({ app }) => {
      const state = app.workspace.activeLeaf?.getViewState() as
        | { state?: { file?: string } }
        | undefined;
      return state?.state?.file ?? null;
    });

  const runCreateCommand = async (commandId: string, notePath: string): Promise<string> => {
    // Reuse openNote's reason for detaching: a leaf left over from an earlier
    // test is indistinguishable from one this command opened.
    await browser.executeObsidian(({ app }) => {
      app.workspace.detachLeavesOfType("tngantt-calendar-editor");
      app.workspace.detachLeavesOfType("markdown");
    });
    await runCommand(commandId);

    let body: string | null = null;
    let showing: string | null = null;
    let viewType: string | null = null;
    let folder = "";
    await waitUntilOrExplain(
      async () => {
        body = await readNoteOrNull(notePath);
        showing = await activeLeafPath();
        viewType = await activeViewType();
        // Only meaningful while the note is missing, and it costs a round trip
        // per tick — refreshed exactly when it is the thing worth reporting.
        folder = body === null ? await listCreateFolder() : "";
        return body !== null && showing === notePath && viewType === EDITOR_VIEW;
      },
      () =>
        `${notePath}: readable=${body !== null} showing=${showing} view=${viewType}` +
        (body === null ? `; Calendars/ held: ${folder}` : ""),
      { timeout: 20000 },
    );
    return body as unknown as string;
  };

  it("creates a calendar via the command and opens it in the editor", async () => {
    const created = await runCreateCommand(
      "tasknotes-gantt:create-calendar",
      "Calendars/New Calendar.md",
    );
    // The newline discriminates: "tngantt: calendar" is a prefix of the SET
    // marker, so without it the set skeleton would satisfy this too.
    expect(created).toContain("tngantt: calendar\n");
  });

  it("creates a calendar set via the command and opens it in the editor", async () => {
    const created = await runCreateCommand(
      "tasknotes-gantt:create-calendar-set",
      "Calendars/New Calendar Set.md",
    );
    expect(created).toContain("tngantt: calendar-set");
  });

  /** Make every `Calendars/*` note look unindexed to the routing interception. */
  const hideCalendarsFromCache = async (): Promise<void> => {
    await browser.executeObsidian(({ app }) => {
      const cache = app.metadataCache as unknown as {
        getFileCache: (f: unknown) => unknown;
        __origGetFileCache?: (f: unknown) => unknown;
      };
      if (cache.__origGetFileCache) return; // already patched
      cache.__origGetFileCache = cache.getFileCache.bind(app.metadataCache);
      cache.getFileCache = (file: unknown) =>
        (file as { path?: string })?.path?.startsWith("Calendars/")
          ? null
          : cache.__origGetFileCache!(file);
    });
  };

  /** Undo {@link hideCalendarsFromCache}; safe to call when it was never applied. */
  const restoreCalendarCache = async (): Promise<void> => {
    await browser.executeObsidian(({ app }) => {
      const cache = app.metadataCache as unknown as {
        getFileCache: (f: unknown) => unknown;
        __origGetFileCache?: (f: unknown) => unknown;
      };
      if (!cache.__origGetFileCache) return;
      cache.getFileCache = cache.__origGetFileCache;
      delete cache.__origGetFileCache;
    });
  };

  it("re-routes a created calendar to the editor when its marker indexes late", async () => {
    // The cold-vault race: routing reads the marker synchronously during
    // setViewState, so a note whose frontmatter is not indexed yet opens as plain
    // markdown — and a later cache update re-routes nothing on its own. Hiding
    // Calendars/* from the metadata cache reproduces that here; the note must
    // still reach the editor once the marker becomes visible.
    // The patch is global to this Obsidian session, so it is restored in a finally:
    // a failure part-way through would otherwise leave every later test seeing all
    // Calendars/* notes as unindexed, turning one failure into a cascade.
    await hideCalendarsFromCache();
    let openedPath: string | null = null;
    try {
      await runCommand("tasknotes-gantt:create-calendar");

      // The pre-open wait gives up (2s), so the note opens unrouted as markdown.
      openedPath = (await browser.waitUntil(
        async () => {
          const info = await browser.executeObsidian(({ app }) => {
            const leaf = app.workspace.activeLeaf;
            const state = leaf?.getViewState();
            const file = state?.state?.["file"];
            return { type: state?.type ?? null, file: typeof file === "string" ? file : null };
          });
          return info.type === "markdown" && info.file?.startsWith("Calendars/") ? info.file : false;
        },
        { timeout: 20000, timeoutMsg: "the created calendar never opened while its marker was hidden" },
      )) as string;
    } finally {
      await restoreCalendarCache();
    }

    // Announce the index now the cache tells the truth — the leaf must re-route.
    await browser.executeObsidian(({ app }, p) => {
      const file = app.vault.getAbstractFileByPath(p);
      if (file) app.metadataCache.trigger("changed", file as never);
    }, openedPath);

    await browser.waitUntil(async () => (await activeViewType()) === EDITOR_VIEW, {
      timeout: 20000,
      timeoutMsg: "a late-indexed calendar note never re-routed to the editor",
    });

    // Both halves of the claim, and the link between them: it is not enough that
    // A calendar reached the editor — it must be the one whose marker indexed
    // late, or a reroute of some other note would satisfy this.
    expect(openedPath).toMatch(/^Calendars\//);
    const routed = await browser.executeObsidian(({ app }) => {
      const state = app.workspace.activeLeaf?.getViewState();
      const file = state?.state?.["file"];
      return { type: state?.type ?? null, file: typeof file === "string" ? file : null };
    });
    expect(routed.type).toBe(EDITOR_VIEW);
    expect(routed.file).toBe(openedPath);

    await deleteNotes([openedPath]);
  });

  // ---- U5: calendar-set union preview tabs + conflict surfacing ------------
  // The two fixture calendars disagree: NZ Holidays works Mon–Fri, Sun Thu works
  // Sun–Thu, so a set of both conflicts on Fridays and Sundays across the year.

  const createNote = async (notePath: string, content: string): Promise<void> => {
    await browser.executeObsidian(
      async ({ app }, args) => {
        const stale = app.vault.getAbstractFileByPath(args.notePath);
        if (stale) await app.vault.delete(stale as never);
        await app.vault.create(args.notePath, args.content);
      },
      { notePath, content },
    );
    // Wait for the metadata cache to index the new note's frontmatter, so a set
    // that references it resolves the member on the form's first render (the
    // union preview reads the cache, not a reactive source).
    await browser.waitUntil(
      async () =>
        browser.executeObsidian(({ app }, p) => {
          const file = app.vault.getAbstractFileByPath(p);
          return file ? Boolean(app.metadataCache.getFileCache(file as never)?.frontmatter) : false;
        }, notePath),
      { timeout: 10000, timeoutMsg: `${notePath} was not indexed` },
    );
  };

  const deleteNotes = async (paths: string[]): Promise<void> => {
    await browser.executeObsidian(async ({ app }, ps) => {
      for (const p of ps) {
        const file = app.vault.getAbstractFileByPath(p);
        if (file) await app.vault.delete(file as never);
      }
    }, paths);
  };

  it("shows the union preview tabs on a calendar-set and each renders", async () => {
    await createNote(
      "Union Set.md",
      '---\ntngantt: calendar-set\ncalendars:\n  - "[[NZ Holidays]]"\n  - "[[Sun Thu]]"\n---\n',
    );
    await openNote("Union Set.md");
    await (await $(".og-cal-form")).waitForExist({ timeout: 20000 });

    // Week: the union renders seven day columns.
    await (await $(".og-cal-tab=Week")).click();
    await (await $(".og-week-grid")).waitForDisplayed({
      timeout: 10000,
      timeoutMsg: "the union week grid did not render",
    });
    expect(await $$(".og-week-col")).toHaveLength(7);

    // Gantt strip: a day cell per day of the content-spanning window.
    await (await $(".og-cal-tab=Gantt strip")).click();
    await (await $(".og-strip-track")).waitForDisplayed({
      timeout: 10000,
      timeoutMsg: "the union gantt strip did not render",
    });
    expect((await $$(".og-strip-cell")).length).toBeGreaterThan(60);

    // Year: a full year of day cells plus the padding of the partial end weeks.
    await (await $(".og-cal-tab=Year")).click();
    await (await $(".og-year-grid")).waitForDisplayed({
      timeout: 10000,
      timeoutMsg: "the union year grid did not render",
    });
    expect((await $$(".og-year-cell")).length).toBeGreaterThan(300);

    await deleteNotes(["Union Set.md"]);
  });

  it("renders a hostile frontmatter colour as transparent in both inline-style sinks", async () => {
    // A shared/downloaded calendar note could carry a colour that, painted
    // unsanitised into the swatch and bar inline styles, becomes a remote fetch
    // (url(...)) on open or a CSS-injection overlay. Both sinks must render
    // 'transparent', never the raw value — the real-Obsidian gate the pure
    // paintableColor unit test cannot provide (AGENTS.md testing rule).
    await createNote(
      "Hostile Colour.md",
      '---\ntngantt: calendar\ncolor: "url(https://example.invalid/pixel.png)"\n---\n',
    );
    await openNote("Hostile Colour.md");
    await (await $(".og-cal-form")).waitForExist({ timeout: 20000 });
    await (await $(".og-color-sw")).waitForDisplayed({
      timeout: 20000,
      timeoutMsg: "colour swatch never rendered",
    });

    for (const selector of [".og-color-sw", ".og-color-bar"]) {
      const style = (await (await $(selector)).getAttribute("style")) ?? "";
      expect(style).not.toContain("url(");
      expect(style).toContain("transparent");
    }

    await deleteNotes(["Hostile Colour.md"]);
  });

  it("marks conflict days and shows a conflict banner for disagreeing members", async () => {
    // Dedicated members so the test does not depend on the shared NZ Holidays
    // fixture, which earlier tests mutate. A Mon–Fri member disagrees with a
    // Sun–Thu member on Fridays and Sundays across the year.
    await createNote(
      "Weekdays Cal.md",
      '---\ntngantt: calendar\npattern: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"\n---\n',
    );
    await createNote(
      "Sun Thu.md",
      '---\ntngantt: calendar\npattern: "FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH"\n---\n',
    );
    await createNote(
      "Conflict Set.md",
      '---\ntngantt: calendar-set\ncalendars:\n  - "[[Weekdays Cal]]"\n  - "[[Sun Thu]]"\n---\n',
    );
    await openNote("Conflict Set.md");
    await (await $(".og-cal-form")).waitForExist({ timeout: 20000 });
    await (await $(".og-cal-tab=Year")).click();

    let seen: EditorConflictState | null = null;
    await browser.waitUntil(
      async () => {
        seen = await readConflictState();
        return (
          seen !== null &&
          seen.yearConflicts > 0 &&
          seen.year > 0 &&
          seen.text.includes("conflict") &&
          seen.cls.includes("og-cal-status-warn")
        );
      },
      {
        timeout: 15000,
        timeoutMsg: "the active set editor did not surface conflict days and a warning banner",
      },
    );

    // A Mon-Fri member and a Sun-Thu member disagree on Fridays AND Sundays, on
    // EVERY one of them. The per-weekday counts are the claim: a set of rows is
    // satisfied by a single cell per row, so a broken expansion producing one
    // Friday and one Sunday would pass it.
    const state = seen as unknown as EditorConflictState;
    expect(state.conflictsByRow).toEqual({
      [FRIDAY_ROW]: weekdayOccurrences(state.year, FRIDAY_ROW),
      [SUNDAY_ROW]: weekdayOccurrences(state.year, SUNDAY_ROW),
    });
    expect(state.text).toContain("conflict");
    expect(state.cls).toContain("og-cal-status-warn");

    await deleteNotes(["Conflict Set.md", "Sun Thu.md", "Weekdays Cal.md"]);
  });

  it("honours a member's availability blocks in the union (no top-level pattern)", async () => {
    // A member defined ONLY by availability blocks (works Mon–Thu) is off Fridays;
    // a Mon–Fri member works them → the union must show conflicts. This exercises
    // the whole path: YAML availability parsing → shared engine → year grid.
    await createNote(
      "Weekdays Cal.md",
      '---\ntngantt: calendar\npattern: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"\n---\n',
    );
    await createNote(
      "Avail Mon Thu.md",
      '---\ntngantt: calendar\navailability:\n  - pattern: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH"\n    hours: ["09:00-17:00"]\n---\n',
    );
    await createNote(
      "Avail Set.md",
      '---\ntngantt: calendar-set\ncalendars:\n  - "[[Weekdays Cal]]"\n  - "[[Avail Mon Thu]]"\n---\n',
    );
    await openNote("Avail Set.md");
    await (await $(".og-cal-form")).waitForExist({ timeout: 20000 });
    await (await $(".og-cal-tab=Year")).click();

    let seen: EditorConflictState | null = null;
    await browser.waitUntil(
      async () => {
        seen = await readConflictState();
        return (seen?.yearConflicts ?? 0) > 0;
      },
      { timeout: 15000, timeoutMsg: "the availability-only member produced no conflicts in the union" },
    );

    // Not merely "some conflict", and not merely a plausible count: the two
    // members disagree on Fridays and ONLY Fridays. A count alone would accept
    // any single-weekday disagreement — a member misparsed as Tue-Fri differs on
    // Mondays and lands on the same tally — so the day itself is what pins it.
    const state = seen as unknown as EditorConflictState;
    expect(state.conflictsByRow).toEqual({
      [FRIDAY_ROW]: weekdayOccurrences(state.year, FRIDAY_ROW),
    });

    await deleteNotes(["Avail Set.md", "Avail Mon Thu.md", "Weekdays Cal.md"]);
  });

  it("updates the conflict banner live as a member is added, without saving", async () => {
    // Dedicated members (not the shared, mutated NZ Holidays fixture): a Mon–Fri
    // member alone has nothing to conflict with, so no banner shows until a
    // disagreeing Sun–Thu member is added.
    await createNote(
      "Weekdays Cal.md",
      '---\ntngantt: calendar\npattern: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"\n---\n',
    );
    await createNote(
      "Sun Thu.md",
      '---\ntngantt: calendar\npattern: "FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH"\n---\n',
    );
    await createNote(
      "Live Set.md",
      '---\ntngantt: calendar-set\ncalendars:\n  - "[[Weekdays Cal]]"\n---\n',
    );
    await openNote("Live Set.md");
    await (await $(".og-cal-form")).waitForExist({ timeout: 20000 });

    // Read the banner from the ACTIVE leaf (a global selector can catch stale
    // background leaves). A single-member set has nothing to conflict with.
    const activeBanner = (): Promise<string | null> =>
      browser.executeObsidian(({ app }) => {
        const root = (app.workspace.activeLeaf?.view as { containerEl?: HTMLElement } | undefined)
          ?.containerEl;
        return root?.querySelector(".og-cal-status")?.textContent ?? null;
      });
    expect(await activeBanner()).toBeNull();

    // Add a second, disagreeing member through the Member calendars field.
    await (await $(".og-cal-add")).click();
    const memberInputs = await $$(".og-cal-entry-member input");
    await memberInputs[memberInputs.length - 1].setValue("[[Sun Thu]]");

    // The banner now reports conflicts — driven purely by the live member edit.
    await browser.waitUntil(async () => (await activeBanner())?.includes("conflict") ?? false, {
      timeout: 10000,
      timeoutMsg: "the conflict banner did not update after adding a member",
    });

    // Nothing was saved: the form is still dirty and the note holds one member.
    const disk = await readNoteOrNull("Live Set.md");
    expect(disk).not.toContain("Sun Thu");

    await deleteNotes(["Live Set.md", "Sun Thu.md"]);
  });

  it("warns when a conflict falls outside the counted year, though the year grid is clean", async () => {
    // A Mon–Fri member covers weekdays every year; a member that blocks one past
    // Monday (no pattern) disagrees only on that day. The Strip tab (content
    // window) shows the conflict; the Year grid (current year) does not — so the
    // banner must still warn rather than read "all clear".
    await createNote(
      "Weekdays Cal.md",
      '---\ntngantt: calendar\npattern: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"\n---\n',
    );
    await createNote(
      "Past Holiday.md",
      '---\ntngantt: calendar\nnon_working:\n  - 2020-01-06\n---\n',
    );
    await createNote(
      "Off Year Set.md",
      '---\ntngantt: calendar-set\ncalendars:\n  - "[[Weekdays Cal]]"\n  - "[[Past Holiday]]"\n---\n',
    );
    await openNote("Off Year Set.md");
    await (await $(".og-cal-form")).waitForExist({ timeout: 20000 });
    await (await $(".og-cal-tab=Year")).click();

    let seen: EditorConflictState | null = null;
    await browser.waitUntil(
      async () => {
        seen = await readConflictState();
        return (
          seen !== null &&
          seen.year > 0 && // the grid actually rendered
          seen.yearConflicts === 0 && // the counted year has none
          seen.text.includes("conflict") && // but the banner still warns
          seen.cls.includes("og-cal-status-warn")
        );
      },
      {
        timeout: 15000,
        timeoutMsg: "the banner did not warn about a conflict outside the counted year",
      },
    );

    // A grid that never rendered also reports zero conflicts, and the banner
    // shows on every tab — so "clean" only means anything once the grid is
    // known to be there.
    const state = seen as unknown as EditorConflictState;
    expect(state.year).toBeGreaterThan(0);
    expect(state.yearCells).toBeGreaterThan(300);
    expect(state.yearConflicts).toBe(0); // the counted year is clean
    expect(state.text).toContain("conflict"); // and the banner still warns
    expect(state.cls).toContain("og-cal-status-warn");

    await deleteNotes(["Off Year Set.md", "Past Holiday.md", "Weekdays Cal.md"]);
  });

  it("names the disagreeing members in a conflict day's tooltip", async () => {
    // A Mon–Fri member covers Fri 2026-07-10; a holiday member blocks that day as
    // "Matariki". The conflict cell's tooltip lists both: the holiday by its name,
    // the covering member by the date (it has no label of its own).
    await createNote(
      "Weekdays Cal.md",
      '---\ntngantt: calendar\npattern: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"\n---\n',
    );
    await createNote(
      "Holiday Cal.md",
      "---\ntngantt: calendar\nnon_working:\n  - date: 2026-07-10\n    name: Matariki\n---\n",
    );
    await createNote(
      "Tooltip Set.md",
      '---\ntngantt: calendar-set\ncalendars:\n  - "[[Weekdays Cal]]"\n  - "[[Holiday Cal]]"\n---\n',
    );
    await openNote("Tooltip Set.md");
    await (await $(".og-cal-form")).waitForExist({ timeout: 20000 });
    await (await $(".og-cal-tab=Year")).click();

    const tooltip = await browser.waitUntil(
      async () => {
        const title = await browser.executeObsidian(({ app }) => {
          const root = (app.workspace.activeLeaf?.view as { containerEl?: HTMLElement } | undefined)
            ?.containerEl;
          const cell = root?.querySelector(".og-year-cell.og-year-conflict");
          return cell?.getAttribute("title") ?? null;
        });
        return title && title.includes("Matariki") ? title : false;
      },
      { timeout: 15000, timeoutMsg: "the conflict tooltip never named the disagreeing members" },
    );

    // Date header, the holiday by name, and the covering member by the date.
    expect(tooltip).toContain("2026-07-10");
    expect(tooltip).toContain("- Matariki (Holiday Cal)");
    expect(tooltip).toContain("- 2026-07-10 (Weekdays Cal)");

    await deleteNotes(["Tooltip Set.md", "Holiday Cal.md", "Weekdays Cal.md"]);
  });

  it("shows the same conflict tooltip on the Week and Gantt-strip tabs", async () => {
    // Two members with opposing weekly patterns conflict on Fri and Sun of every
    // week, so a conflict shows on the representative week and the strip alike.
    await createNote(
      "Weekdays Cal.md",
      '---\ntngantt: calendar\npattern: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"\n---\n',
    );
    await createNote(
      "Sun Thu.md",
      '---\ntngantt: calendar\npattern: "FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH"\n---\n',
    );
    await createNote(
      "Tabs Set.md",
      '---\ntngantt: calendar-set\ncalendars:\n  - "[[Weekdays Cal]]"\n  - "[[Sun Thu]]"\n---\n',
    );
    await openNote("Tabs Set.md");
    await (await $(".og-cal-form")).waitForExist({ timeout: 20000 });

    const conflictTitle = (selector: string): Promise<string | false> =>
      browser.waitUntil(
        async () => {
          const title = await browser.executeObsidian(
            ({ app }, sel) => {
              const root = (
                app.workspace.activeLeaf?.view as { containerEl?: HTMLElement } | undefined
              )?.containerEl;
              return root?.querySelector(sel)?.getAttribute("title") ?? null;
            },
            selector,
          );
          // A conflict tooltip is multi-line and names both members.
          return title && title.includes("(Weekdays Cal)") && title.includes("(Sun Thu)")
            ? title
            : false;
        },
        { timeout: 15000, timeoutMsg: `no conflict tooltip on ${selector}` },
      );

    await (await $(".og-cal-tab=Week")).click();
    expect(await conflictTitle(".og-week-conflict")).toContain("\n");

    await (await $(".og-cal-tab=Gantt strip")).click();
    expect(await conflictTitle(".og-strip-conflict")).toContain("\n");

    await deleteNotes(["Tabs Set.md", "Sun Thu.md", "Weekdays Cal.md"]);
  });

  it("counts an unresolved link and a nested set separately, still rendering the preview", async () => {
    await createNote(
      "Nested Set.md",
      '---\ntngantt: calendar-set\ncalendars:\n  - "[[NZ Holidays]]"\n---\n',
    );
    await createNote(
      "Degrade Set.md",
      '---\ntngantt: calendar-set\ncalendars:\n  - "[[NZ Holidays]]"\n  - "[[Does Not Exist]]"\n  - "[[Nested Set]]"\n---\n',
    );
    await openNote("Degrade Set.md");
    await (await $(".og-cal-form")).waitForExist({ timeout: 20000 });

    // The valid member still previews despite the two degraded members.
    await (await $(".og-cal-tab=Year")).click();
    await (await $(".og-year-grid")).waitForDisplayed({
      timeout: 10000,
      timeoutMsg: "the union year grid did not render with degraded members",
    });
    expect((await $$(".og-year-cell")).length).toBeGreaterThan(300);

    // The banner names the two degradation categories distinctly: the unresolved
    // link (flagged) and the nested set that is not a valid calendar (invalid).
    const banner = await $(".og-cal-status");
    await banner.waitForDisplayed({
      timeout: 10000,
      timeoutMsg: "no attention banner appeared for the degraded members",
    });
    const text = await banner.getText();
    expect(text).toContain("unresolved");
    expect(text).toContain("invalid");

    await deleteNotes(["Degrade Set.md", "Nested Set.md"]);
  });

  it("shows guidance, not a working grid, for a set with no resolved members", async () => {
    await createNote("Empty Set.md", "---\ntngantt: calendar-set\n---\n");
    await openNote("Empty Set.md");
    await (await $(".og-cal-form")).waitForExist({ timeout: 20000 });

    await (await $(".og-cal-tab=Week")).click();
    const guidance = await $(".og-cal-empty");
    await guidance.waitForDisplayed({
      timeout: 10000,
      timeoutMsg: "the empty-set guidance copy did not appear",
    });
    expect(await guidance.getText()).toContain("Add member calendars");
    // No working union grid masquerades as a real calendar.
    expect(await $$(".og-week-grid")).toHaveLength(0);

    await deleteNotes(["Empty Set.md"]);
  });

  it("keeps markdown as the floor when the plugin is disabled", async () => {
    await browser.executeObsidian(async ({ app }) => {
      const plugins = (app as unknown as {
        plugins: { disablePlugin: (id: string) => Promise<void> };
      }).plugins;
      await plugins.disablePlugin("tasknotes-gantt");
    });
    await browser.pause(500);

    // Restore the marker, then confirm it still opens as plain markdown.
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getAbstractFileByPath("NZ Holidays.md");
      if (!file) throw new Error("fixture calendar missing");
      const body = await app.vault.read(file as never);
      await app.vault.modify(file as never, (body as string).replace("tngantt: none", "tngantt: calendar"));
    });
    await openNote("NZ Holidays.md");
    expect(await activeViewType()).toBe("markdown");
  });
});
