import { browser, expect, $, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

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

/** The view type of the active leaf, as Obsidian itself reports it. */
async function activeViewType(): Promise<string | null> {
  return browser.executeObsidian(({ app }) => {
    const leaf = app.workspace.activeLeaf;
    return leaf ? leaf.getViewState().type : null;
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

  it("edits the working pattern visually and round-trips to RRULE", async () => {
    await restoreMarker();
    await openNote("NZ Holidays.md");
    await (await $(".og-cal-form")).waitForExist({ timeout: 20000 });

    // The visual builder shows a weekday toggle per day — no raw RRULE.
    expect((await $$(".og-rrule-day")).length).toBe(7);

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
    expect((await $$(".og-color-panel")).length).toBe(0);

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
    expect((await $$(".og-color-panel")).length).toBe(0);

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

  it("previews the working week on the Week tab", async () => {
    await restoreMarker();
    await openNote("NZ Holidays.md");
    await (await $(".og-cal-form")).waitForExist({ timeout: 20000 });

    await (await $(".og-cal-tab=Week")).click();
    const week = await $(".og-week-grid");
    await week.waitForDisplayed({ timeout: 10000, timeoutMsg: "the week grid did not render" });
    // Seven day columns, Monday through Sunday.
    expect((await $$(".og-week-col")).length).toBe(7);
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
