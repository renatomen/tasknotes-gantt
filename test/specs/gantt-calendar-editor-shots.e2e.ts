/* global HTMLInputElement */
import { browser, expect, $, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * The calendar editor scenes that `website/docs/features/calendar-editor.md`
 * shows in its screenshots: each scene is staged here and asserted to render the
 * controls and text the page's image of it depicts.
 *
 * Captures are opt-in. With `OG_SHOTS_DIR` set, each scene also saves an element
 * screenshot there (light, plus dark for the colour-carrying previews); without
 * it — as in CI — the spec only stages and asserts, and leaves the window size and
 * theme alone.
 *
 * Kept apart from gantt-calendar-editor.e2e.ts on purpose: that spec serially
 * mutates its own copy of the fixture, and this one works on a private
 * `mkdtemp` copy it removes afterwards, so neither can observe the other's writes
 * whichever runs first.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-calendar");
const shotsDir = process.env.OG_SHOTS_DIR ? path.resolve(process.env.OG_SHOTS_DIR) : null;

const TEAM_CALENDAR = "Auckland Team.md";
const TEAM_SET = "Delivery Set.md";
const PREVIEW_YEAR = 2026;
const CAPTURE_WIDTH = 1000;
const CAPTURE_HEIGHT = 1000;
/** The form's third group: Identity, Working schedule, then Exceptions. */
const EXCEPTIONS_SECTION = ".og-cal-form > section:nth-of-type(3)";

const TEAM_CALENDAR_TEXT = `---
tngantt: calendar
description: Auckland product team, Monday to Friday plus an on-call Saturday
color: teal
pattern: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
working_hours:
  - "09:00-12:30"
  - "13:30-17:30"
timezone: Pacific/Auckland
availability:
  - pattern: "FREQ=WEEKLY;BYDAY=SA"
    hours:
      - "10:00-14:00"
non_working:
  - date: 2026-04-03
    name: Good Friday
  - date: 2026-04-06
    name: Easter Monday
  - date: 2026-04-27
    name: ANZAC Day (observed)
  - start: 2026-05-18
    end: 2026-05-22
    name: Office move
  - date: 2026-06-01
    name: King's Birthday
events:
  - date: 2026-04-14
    name: Release cutoff
    marker: true
  - date: 2026-05-06
    name: Planning offsite
---

Working time for the Auckland product team.
`;

const TEAM_SET_TEXT = `---
tngantt: calendar-set
description: Everyone on the delivery project
calendars:
  - "[[NZ Holidays]]"
  - "[[Sun Thu]]"
---
`;

type Theme = "moonstone" | "obsidian";

async function setTheme(theme: Theme): Promise<void> {
  const bodyClass = theme === "moonstone" ? "theme-light" : "theme-dark";
  const isActive = () => browser.execute((cls: string) => document.body.classList.contains(cls), bodyClass);
  if (await isActive()) return;
  await browser.executeObsidian(async ({ app }, name) => {
    (app as unknown as { changeTheme?: (t: string) => void }).changeTheme?.(name);
  }, theme);
  await browser.waitUntil(isActive, { timeout: 10000, timeoutMsg: `theme never switched to ${theme}` });
  await browser.pause(500);
}

/**
 * Scroll the editor so `selector` sits just below its sticky header, which would
 * otherwise overlap the element's top in the capture. Also drops a form field's
 * focus caret, which is not part of what the page describes.
 */
async function bringIntoView(selector: string): Promise<void> {
  await browser.execute((sel: string) => {
    const el = document.querySelector<HTMLElement>(sel);
    // A popover or modal lives outside the editor and is left exactly as it is.
    const scroller = el?.closest<HTMLElement>(".view-content.og-calendar-editor");
    if (!el || !scroller) return;
    const header = scroller.querySelector<HTMLElement>(".og-cal-header");
    if (header === null || el.contains(header)) {
      scroller.scrollTop = 0;
    } else {
      scroller.scrollTop += el.getBoundingClientRect().top - header.getBoundingClientRect().bottom;
    }
    const active = document.activeElement as HTMLElement | null;
    if (active?.closest(".og-cal-form") && !active.closest(".og-color")) active.blur();
  }, selector);
  await browser.pause(300);
}

/** Size the real window through Electron: WDIO's setWindowSize is unsupported by this driver. */
async function resizeWindow(width: number, height: number): Promise<void> {
  await browser.execute((w: number, h: number) => {
    const req = (window as unknown as { require?: (m: string) => unknown }).require;
    type Win = { setSize?: (w: number, h: number) => void; unmaximize?: () => void };
    const electron = req?.("electron") as { remote?: { getCurrentWindow?: () => Win } } | undefined;
    const win = electron?.remote?.getCurrentWindow?.();
    win?.unmaximize?.();
    win?.setSize?.(w, h);
  }, width, height);
  await browser.pause(600);
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

/** Save an element screenshot when capturing; a no-op otherwise. */
async function capture(selector: string, file: string, theme: Theme = "moonstone"): Promise<void> {
  if (shotsDir === null) return;
  await setTheme(theme);
  await bringIntoView(selector);
  await (await $(selector)).saveScreenshot(path.join(shotsDir, file));
}

/** Capture light, and dark too when the scene's colours carry meaning. */
async function captureThemes(selector: string, stem: string): Promise<void> {
  if (shotsDir === null) return;
  await capture(selector, `${stem}-light.png`, "moonstone");
  await capture(selector, `${stem}-dark.png`, "obsidian");
  await setTheme("moonstone");
}

async function openInEditor(notePath: string): Promise<void> {
  await browser.executeObsidian(async ({ app }, p) => {
    app.workspace.detachLeavesOfType("tngantt-calendar-editor");
    const file = app.vault.getAbstractFileByPath(p);
    if (!file) throw new Error(`note not found: ${p}`);
    const leaf = app.workspace.getLeaf(true);
    await leaf.openFile(file as never);
    app.workspace.setActiveLeaf(leaf, { focus: true });
  }, notePath);
  await (await $(".og-cal-form")).waitForExist({
    timeout: 20000,
    timeoutMsg: `${notePath} did not open in the calendar editor`,
  });
  await browser.pause(300);
}

async function selectTab(label: string): Promise<void> {
  await (await $(`.og-cal-tab=${label}`)).click();
  await browser.pause(400);
}

async function formLabels(): Promise<string[]> {
  return browser.execute(() =>
    Array.from(document.querySelectorAll<HTMLElement>(".og-cal-form .og-cal-label")).map(
      (el) => el.textContent?.trim() ?? "",
    ),
  );
}

async function stepYearTo(target: number): Promise<void> {
  for (let guard = 0; guard < 50; guard++) {
    const shown = Number((await (await $(".og-year-label")).getText()).trim());
    if (shown === target) return;
    await (await $(shown > target ? ".og-year-step[aria-label='Previous year']" : ".og-year-step[aria-label='Next year']")).click();
    await browser.pause(150);
  }
  throw new Error(`year grid never reached ${target}`);
}

describe("calendar editor, as the documentation shows it", () => {
  let tmpVault = "";

  before(async () => {
    tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), "og-cal-editor-shots-"));
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });
    fs.writeFileSync(path.join(tmpVault, TEAM_CALENDAR), TEAM_CALENDAR_TEXT, "utf8");
    fs.writeFileSync(path.join(tmpVault, TEAM_SET), TEAM_SET_TEXT, "utf8");
    await browser.reloadObsidian({ vault: tmpVault, plugins: ["tasknotes-gantt"] });
    if (shotsDir !== null) {
      fs.mkdirSync(shotsDir, { recursive: true });
      await resizeWindow(CAPTURE_WIDTH, CAPTURE_HEIGHT);
      await collapseSidebars();
      await setTheme("moonstone");
    }
  });

  after(async () => {
    // A bulk detach bypasses the close guard, so a dirty form cannot hold the
    // session open for the next spec.
    await browser.executeObsidian(({ app }) => {
      app.workspace.detachLeavesOfType("tngantt-calendar-editor");
    });
    try {
      fs.rmSync(tmpVault, { recursive: true, force: true });
    } catch {
      /* the vault is still open in Obsidian; the OS temp sweep removes it */
    }
  });

  it("renders the calendar form's groups and fields", async () => {
    await openInEditor(TEAM_CALENDAR);
    expect(await formLabels()).toEqual([
      "Name",
      "Description",
      "Colour",
      "Working pattern",
      "Anchor date",
      "Working hours",
      "Timezone",
      "Non-working days",
      "Events",
    ]);
    expect(await $$(".og-cal-tab").map((tab) => tab.getText())).toEqual([
      "Edit",
      "Week",
      "Gantt strip",
      "Year",
    ]);
    await expect($(".og-cal-header .mod-cta")).toHaveText("Save");
    const groupTitles = await browser.execute(() =>
      Array.from(document.querySelectorAll(".og-cal-group-title")).map((el) => el.textContent?.trim()),
    );
    expect(groupTitles).toEqual(["Identity", "Working schedule", "Exceptions"]);
    const exceptions = $(EXCEPTIONS_SECTION);
    await expect(exceptions).toHaveText(expect.stringContaining("Availability blocks are set on this calendar"));
    await expect(exceptions.$$(".og-cal-readonly")).toBeElementsArrayOfSize(2);
    await expect(exceptions.$$(".og-cal-entry:not(.og-cal-entry-event)")).toBeElementsArrayOfSize(4);
    const markers = exceptions.$$(".og-cal-entry-event input[type='checkbox']");
    expect(await markers.map((box) => box.isSelected())).toEqual([true, false]);
    // The form outgrows the window, so its shot ends at the window's edge and
    // Exceptions gets a shot of its own.
    await capture(".og-cal-form", "calendar-editor-form.png");
    await capture(EXCEPTIONS_SECTION, "calendar-editor-exceptions.png");
  });

  it("shows the working pattern as a visual weekday builder", async () => {
    const pressed = await browser.execute(() =>
      Array.from(document.querySelectorAll<HTMLElement>(".og-rrule-day[aria-pressed='true']")).map(
        (el) => el.textContent?.trim(),
      ),
    );
    expect(pressed).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
  });

  it("offers timezones with their current UTC offset", async () => {
    await expect($(".og-cal-form")).toHaveText(expect.stringMatching(/Currently UTC\+1[23]:00/));
    const input = await $('.og-cal-form input[placeholder^="Search a timezone"]');
    await input.click();
    await input.setValue("Pacific");
    const container = await $(".suggestion-container");
    await container.waitForDisplayed({ timeout: 10000, timeoutMsg: "timezone suggestions never opened" });
    await expect(container).toHaveText(expect.stringMatching(/Pacific\/Auckland\s*UTC\+1[23]:00/));
    await capture(".suggestion-container", "calendar-editor-timezone.png");
    await browser.keys("Escape");
    await input.setValue("Pacific/Auckland");
    await browser.pause(300);
    await browser.keys("Escape");
  });

  it("opens the colour picker from the collapsed colour field", async () => {
    await (await $(".og-color-summary")).click();
    await expect($(".og-color-panel")).toBeDisplayed();
    await expect($(".og-color-search")).toBeDisplayed();
    await expect($(".og-color-clear")).toHaveText(expect.stringContaining("Default (theme colour)"));
    await expect($('.og-color-panel input[type="color"]')).toBeExisting();
    await expect($(".og-color-iname=aliceblue")).toBeExisting();
    await expect($(".og-color-ihex=#f0f8ff")).toBeExisting();
    await capture(".og-color", "calendar-editor-colour.png");
    await (await $(".og-color-summary")).click();
    await expect($(".og-color-panel")).not.toBeExisting();
  });

  it("flags unsaved edits in the sticky header", async () => {
    const description = await $(".og-cal-form textarea");
    await description.setValue("Auckland product team, edited");
    await expect($(".og-cal-unsaved")).toHaveText("Unsaved changes");
    await expect($(".og-cal-header .mod-cta")).toBeEnabled();
    const headerOffsetWhenScrolled = await browser.execute(() => {
      const scroller = document.querySelector<HTMLElement>(".view-content.og-calendar-editor");
      const header = document.querySelector<HTMLElement>(".og-cal-header");
      if (!scroller || !header) return null;
      scroller.scrollTop = scroller.scrollHeight;
      const offset = header.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      const scrolled = scroller.scrollTop > 0;
      scroller.scrollTop = 0;
      return scrolled ? Math.round(offset) : null;
    });
    expect(headerOffsetWhenScrolled).toBe(0);
    await capture(".og-cal-header", "calendar-editor-unsaved.png");
  });

  it("asks before closing a calendar with unsaved edits", async () => {
    await browser.executeObsidian(({ app }) => {
      app.workspace.getLeavesOfType("tngantt-calendar-editor")[0]?.detach();
    });
    const modal = await $(".modal");
    await modal.waitForDisplayed({ timeout: 10000, timeoutMsg: "close guard never opened" });
    await expect(modal).toHaveText(expect.stringContaining("Unsaved calendar changes"));
    await expect(modal.$("button=Discard")).toBeEnabled();
    await expect(modal.$("button=Save")).toBeEnabled();
    await capture(".modal", "calendar-editor-close-guard.png");
    const goBack = await $("button=Go back");
    await goBack.click();
    await modal.waitForDisplayed({ reverse: true, timeout: 5000 });
    await expect($(".og-cal-form textarea")).toHaveValue("Auckland product team, edited");
    await expect($(".og-cal-unsaved")).toHaveText("Unsaved changes");
  });

  it("previews authored hours on the Week tab", async () => {
    await selectTab("Week");
    const days = await browser.execute(() =>
      Array.from(document.querySelectorAll<HTMLElement>(".og-week-col")).map((col) => [
        col.querySelector(".og-week-label")?.textContent?.trim(),
        ...Array.from(col.querySelectorAll(".og-week-block, .og-week-none")).map((el) => el.textContent?.trim()),
      ]),
    );
    const split = ["09:00–12:30", "13:30–17:30"];
    expect(days).toEqual([
      ["Mon", ...split],
      ["Tue", ...split],
      ["Wed", ...split],
      ["Thu", ...split],
      ["Fri", ...split],
      ["Sat", "10:00–14:00"],
      ["Sun", "—"],
    ]);
    await captureThemes(".og-week", "calendar-editor-week");
  });

  it("previews shading and markers on the Gantt strip tab", async () => {
    await selectTab("Gantt strip");
    const shaded = async (date: string) =>
      (await $(`.og-strip-cell[title='${date}']`).getAttribute("class")).includes("og-strip-shaded");
    expect(await shaded("2026-04-03")).toBe(true); // Good Friday
    expect(await shaded("2026-04-05")).toBe(true); // a Sunday
    expect(await shaded("2026-05-19")).toBe(true); // inside the Office move range
    expect(await shaded("2026-04-04")).toBe(false); // the on-call Saturday
    expect(await shaded("2026-04-14")).toBe(false); // a marker is a line, not shading
    await expect($(".og-strip-marker-label")).toHaveText("Release cutoff");
    await captureThemes(".og-strip", "calendar-editor-strip");
  });

  it("previews the whole year on the Year tab", async () => {
    await selectTab("Year");
    await stepYearTo(PREVIEW_YEAR);
    const expectedClass: Record<string, string> = {
      "2026-04-03 — Good Friday": "og-year-blocking",
      "2026-04-04": "og-year-working",
      "2026-04-05": "og-year-blocking",
      "2026-05-19 — Office move": "og-year-blocking",
      "2026-04-14 — Release cutoff": "og-year-marker",
      "2026-05-06 — Planning offsite": "og-year-event",
    };
    for (const [title, dayClass] of Object.entries(expectedClass)) {
      await expect($(`.og-year-cell[title='${title}']`)).toHaveElementClass(dayClass);
    }
    await captureThemes(".og-year", "calendar-editor-year");
  });

  it("shows a calendar set's member calendars and conflict status", async () => {
    await openInEditor(TEAM_SET);
    expect(await formLabels()).toEqual(["Name", "Description", "Colour"]);
    const members = await browser.execute(() =>
      Array.from(document.querySelectorAll<HTMLInputElement>(".og-cal-entry-member input")).map((el) => el.value),
    );
    expect(members).toEqual(["[[NZ Holidays]]", "[[Sun Thu]]"]);
    await expect($(".og-cal-status")).toHaveText(expect.stringMatching(/days? in conflict/));
    await capture(".og-cal-form", "calendar-editor-set.png");
  });
});
