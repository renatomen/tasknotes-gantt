/* global HTMLButtonElement, getComputedStyle */
import { browser, expect, $, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-legend");

async function enableBases(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    const internalPlugins = (app as unknown as { internalPlugins?: {
      getPluginById?: (id: string) => { enabled?: boolean; enable?: (options?: unknown) => unknown } | undefined;
      enablePluginAndSave?: (id: string) => unknown;
    } }).internalPlugins;
    const bases = internalPlugins?.getPluginById?.("bases");
    if (bases && !bases.enabled) {
      await (internalPlugins?.enablePluginAndSave?.("bases") ?? bases.enable?.({ reloadApp: false }));
    }
  });
}

async function waitForTaskNotesReady(): Promise<void> {
  await browser.waitUntil(
    async () => browser.executeObsidian(async ({ app }) => {
      const taskNotes = (app as unknown as { plugins?: { getPlugin?: (id: string) => unknown } })
        .plugins?.getPlugin?.("tasknotes") as { api?: { lifecycle?: { ready?: () => Promise<void> } } } | undefined;
      if (!taskNotes?.api) return false;
      await taskNotes.api.lifecycle?.ready?.();
      return true;
    }),
    { timeout: 60000, timeoutMsg: "TaskNotes API did not become ready for the legend fixture" },
  );
}

async function openLegend(): Promise<void> {
  const trigger = await $(".og-bases-gantt .og-legend-toggle");
  await trigger.click();
  await browser.waitUntil(async () => (await $$(".og-gantt-legend")).length === 1, {
    timeout: 8000,
    timeoutMsg: "Legend panel did not open",
  });
}

async function closeLegend(): Promise<void> {
  await browser.execute(() => {
    (document.querySelector(".og-gantt-legend .og-legend-dismiss") as HTMLButtonElement | null)?.click();
  });
  await browser.waitUntil(async () => (await $$(".og-gantt-legend")).length === 0, {
    timeout: 8000,
    timeoutMsg: "Legend panel did not close",
  });
}

async function legendLayout(): Promise<string | null> {
  return browser.execute(() => document.querySelector(".og-gantt-legend")?.getAttribute("data-layout") ?? null);
}

async function chooseBottom(): Promise<void> {
  await browser.execute(() => {
    const button = [...document.querySelectorAll<HTMLButtonElement>(".og-gantt-legend [role='radio']")]
      .find((candidate) => candidate.textContent?.trim() === "Bottom");
    button?.click();
  });
}

async function openFixtureBase(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    const workspace = app.workspace as unknown as {
      detachLeavesOfType: (type: string) => void;
      iterateAllLeaves: (callback: (leaf: { view?: { getViewType?: () => string }; detach?: () => void }) => void) => void;
      getLeaf: (newLeaf?: boolean) => { openFile: (file: unknown) => Promise<void> };
    };
    const markdownLeaves: Array<{ detach?: () => void }> = [];
    workspace.iterateAllLeaves((leaf) => {
      if (leaf.view?.getViewType?.() === "markdown") markdownLeaves.push(leaf);
    });
    markdownLeaves.forEach((leaf) => leaf.detach?.());
    workspace.detachLeavesOfType("bases");
    const file = app.vault.getAbstractFileByPath("Legend.base");
    if (file) await workspace.getLeaf(true).openFile(file as never);
  });
}

describe("Gantt (OG) context-aware legend", () => {
  before(async () => {
    const tmpVault = path.join(os.tmpdir(), "og-gantt-legend-e2e");
    fs.rmSync(tmpVault, { recursive: true, force: true });
    fs.cpSync(fixtureVault, tmpVault, { recursive: true });

    await browser.reloadObsidian({
      vault: tmpVault,
      plugins: ["tasknotes-gantt", "tasknotes"],
    });
    await enableBases();
    await waitForTaskNotesReady();
    await openFixtureBase();
    try {
      await browser.waitUntil(async () => (await $$(".og-bases-gantt")).length > 0, { timeout: 15000 });
    } catch {
      // TaskNotes can finish its startup navigation after lifecycle.ready and
      // steal the active leaf once. Reopen the fixture after that bounded race.
      await openFixtureBase();
      await browser.waitUntil(async () => (await $$(".og-bases-gantt")).length > 0, {
        timeout: 60000,
        timeoutMsg: "Gantt legend fixture did not mount the plugin view after reopening",
      });
    }
    try {
      await browser.waitUntil(
        async () => (await $$(".og-bases-gantt .wx-bar")).length > 0,
        { timeout: 30000, timeoutMsg: "Gantt legend fixture did not render a task bar" },
      );
    } catch (error) {
      const diagnostic = await browser.execute(() => {
        const root = document.querySelector(".og-bases-gantt") as HTMLElement | null;
        const chart = root?.querySelector(".og-chart-area") as HTMLElement | null;
        const surface = root?.querySelector(".og-chart-surface") as HTMLElement | null;
        return {
          rootText: root?.innerText.slice(0, 300),
          chartHeight: chart?.getBoundingClientRect().height,
          surfaceHeight: surface?.getBoundingClientRect().height,
          ganttCount: root?.querySelectorAll(".wx-gantt").length,
        };
      });
      throw new Error(`${String(error)}; diagnostic=${JSON.stringify(diagnostic)}`);
    }
    await $(".og-bases-gantt .og-fullscreen-toggle").click();
    await browser.waitUntil(async () => (await $$(".og-bases-gantt.is-maximized")).length === 1, {
      timeout: 8000,
      timeoutMsg: "Gantt did not maximize for the overlay scenarios",
    });
  });

  afterEach(async () => {
    if ((await $$(".og-gantt-legend")).length > 0) await closeLegend();
    if ((await $$(".modal-container")).length > 0) await browser.keys(["Escape"]);
    await browser.execute(() => {
      const host = document.querySelector(".og-bases-gantt .gtcell") as HTMLElement | null;
      if (host) host.style.width = "";
    });
  });

  it("keeps Legend available and opens the default right panel without the optional toolbar (AE10)", async () => {
    expect(await $$(".og-bases-gantt .og-gantt-toolbar")).toHaveLength(0);
    const trigger = await $(".og-bases-gantt .og-legend-toggle");
    await expect(trigger).toBeExisting();
    await expect(trigger).toHaveAttribute("aria-label", "Legend");

    await trigger.click();
    const panel = await $(".og-bases-gantt .og-gantt-legend[data-layout='right']");
    await expect(panel).toBeExisting();
    await expect(panel).toHaveAttribute("aria-label", "Gantt legend");
    await expect($(".og-gantt-legend .og-legend-dismiss")).toBeFocused();
    expect(await $$(".og-gantt-legend .og-legend-sample:not([aria-hidden='true'])")).toHaveLength(0);
  });

  it("paints the dark composite sample with the chart's production treatment channels (AE1)", async () => {
    const isDark = await browser.execute(() => document.body.classList.contains("theme-dark"));
    if (!isDark) {
      await browser.executeObsidian(async ({ app }) => {
        (app as unknown as { commands: { executeCommandById: (id: string) => unknown } })
          .commands.executeCommandById("theme:toggle-light-dark");
      });
      await browser.waitUntil(
        async () => browser.execute(() => document.body.classList.contains("theme-dark")),
        { timeout: 10000, timeoutMsg: "Obsidian did not switch to dark theme" },
      );
      await browser.waitUntil(async () => (await $$(".og-bases-gantt .wx-bar")).length > 0, { timeout: 30000 });
    }

    await openLegend();
    const paint = await browser.execute(() => {
      const chartBar = document.querySelector('.og-bases-gantt .wx-bar[data-id$="Legend Task.md"]') as HTMLElement | null;
      const chartPaint = chartBar?.querySelector<HTMLElement>(".og-ghost-run:not(.og-ghost-blocked)") ?? chartBar;
      const sample = document.querySelector('[data-semantic-id="bar-treatment"] .og-legend-bar') as HTMLElement | null;
      return {
        chartBackground: chartPaint ? getComputedStyle(chartPaint).backgroundColor : null,
        sampleBackground: sample ? getComputedStyle(sample).backgroundColor : null,
        sampleClass: sample?.className ?? "",
        hasIcon: !!sample?.querySelector(".og-bar-chip"),
      };
    });
    expect(paint.sampleClass).toContain("og-calendar-");
    expect(paint.sampleClass).toContain("og-prio-");
    expect(paint.hasIcon).toBe(true);
    expect(paint.sampleBackground).toBe(paint.chartBackground);
  });

  it("contains right vertical overflow under a fixed header without scrolling the chart (AE3)", async () => {
    await openLegend();
    const result = await browser.execute(() => {
      const scroll = document.querySelector(".og-gantt-legend .og-legend-scroll") as HTMLElement;
      const header = document.querySelector(".og-gantt-legend .og-legend-header") as HTMLElement;
      const chart = document.querySelector(".og-bases-gantt .wx-chart") as HTMLElement;
      const before = { headerTop: header.getBoundingClientRect().top, chartTop: chart.scrollTop, chartLeft: chart.scrollLeft };
      scroll.scrollTop = Math.max(1, scroll.scrollHeight - scroll.clientHeight);
      return {
        overflowY: getComputedStyle(scroll).overflowY,
        didScroll: scroll.scrollTop > 0,
        headerFixed: Math.abs(header.getBoundingClientRect().top - before.headerTop) < 1,
        chartUnchanged: chart.scrollTop === before.chartTop && chart.scrollLeft === before.chartLeft,
      };
    });
    expect(result.overflowY).toBe("auto");
    expect(result.didScroll).toBe(true);
    expect(result.headerFixed).toBe(true);
    expect(result.chartUnchanged).toBe(true);
  });

  it("switches live to bottom with horizontal overflow, preserves chart DOM/state, then reopens at the Appearance default (AE4/AE5)", async () => {
    await browser.execute(() => {
      const chart = document.querySelector(".og-bases-gantt .wx-chart") as HTMLElement | null;
      const bar = document.querySelector('.og-bases-gantt .wx-bar[data-id$="Legend Task.md"]');
      if (chart) chart.scrollLeft = Math.min(25, chart.scrollWidth - chart.clientWidth);
      bar?.setAttribute("data-legend-state-marker", "preserved");
    });
    await openLegend();
    const beforeScroll = await browser.execute(() => (document.querySelector(".wx-chart") as HTMLElement)?.scrollLeft ?? 0);
    await chooseBottom();
    await browser.waitUntil(async () => (await legendLayout()) === "bottom", {
      timeout: 8000,
      timeoutMsg: "Legend did not move to the bottom",
    });
    const bottom = await browser.execute(() => {
      const scroll = document.querySelector(".og-gantt-legend .og-legend-scroll") as HTMLElement;
      const header = document.querySelector(".og-gantt-legend .og-legend-header") as HTMLElement;
      const chart = document.querySelector(".wx-chart") as HTMLElement;
      const headerTop = header.getBoundingClientRect().top;
      scroll.scrollLeft = Math.max(1, scroll.scrollWidth - scroll.clientWidth);
      return {
        overflowX: getComputedStyle(scroll).overflowX,
        didScroll: scroll.scrollLeft > 0,
        verticalContentFits: scroll.scrollHeight <= scroll.clientHeight + 1,
        headerFixed: Math.abs(header.getBoundingClientRect().top - headerTop) < 1,
        chartScroll: chart.scrollLeft,
        markerSurvived: !!document.querySelector('[data-legend-state-marker="preserved"]'),
      };
    });
    expect(bottom.overflowX).toBe("auto");
    expect(bottom.didScroll).toBe(true);
    expect(bottom.verticalContentFits).toBe(true);
    expect(bottom.headerFixed).toBe(true);
    expect(bottom.chartScroll).toBe(beforeScroll);
    expect(bottom.markerSurvived).toBe(true);

    await closeLegend();
    await openLegend();
    expect(await legendLayout()).toBe("right");
  });

  it("leaves an uncovered bar interactive and keeps panel clicks out of the chart (R8)", async () => {
    await openLegend();
    const clickedUncoveredBar = await browser.execute(() => {
      const bar = document.querySelector('.og-bases-gantt .wx-bar[data-id$="Legend Task.md"]') as HTMLElement | null;
      if (!bar) return false;
      const bounds = bar.getBoundingClientRect();
      for (let y = bounds.top + 2; y < bounds.bottom - 1; y += 4) {
        for (let x = bounds.left + 2; x < bounds.right - 1; x += 4) {
          const target = document.elementFromPoint(x, y) as HTMLElement | null;
          if (!target?.closest('.wx-bar[data-id$="Legend Task.md"]')) continue;
          target.click();
          return true;
        }
      }
      return false;
    });
    expect(clickedUncoveredBar).toBe(true);
    await browser.waitUntil(async () => (await $$(".og-bases-gantt .wx-selected")).length > 0, {
      timeout: 8000,
      timeoutMsg: "Uncovered chart bar was not selectable through the overlay",
    });
    const selectedBefore = await $$(".og-bases-gantt .wx-selected");
    await $(".og-gantt-legend .og-legend-title-block").click();
    const selectedAfter = await $$(".og-bases-gantt .wx-selected");
    expect(selectedAfter).toHaveLength(selectedBefore.length);
  });

  it("uses an opaque full-view panel over an inert mounted chart and Return restores the same chart node (AE6)", async () => {
    await openLegend();
    await browser.execute(() => {
      const bar = document.querySelector('.og-bases-gantt .wx-bar[data-id$="Legend Task.md"]');
      const host = document.querySelector(".og-bases-gantt .gtcell") as HTMLElement | null;
      bar?.setAttribute("data-full-state-marker", "preserved");
      if (host) host.style.width = "400px";
    });
    await browser.waitUntil(async () => (await legendLayout()) === "full", {
      timeout: 8000,
      timeoutMsg: "Constrained legend did not enter full mode",
    });
    await expect($(".og-chart-surface")).toHaveAttribute("inert");
    await expect($(".og-chart-surface")).toHaveAttribute("aria-hidden", "true");
    expect(await $$(".og-gantt-legend [role='radiogroup']")).toHaveLength(0);
    const returnButton = await $(".og-gantt-legend .og-legend-dismiss");
    await expect(returnButton).toHaveText(expect.stringContaining("Return"));
    expect(await $$('.og-bases-gantt .wx-bar[data-full-state-marker="preserved"]')).toHaveLength(1);

    await returnButton.click();
    await browser.execute(() => {
      const host = document.querySelector(".og-bases-gantt .gtcell") as HTMLElement | null;
      if (host) host.style.width = "";
    });
    expect(await $$('.og-bases-gantt .wx-bar[data-full-state-marker="preserved"]')).toHaveLength(1);
    await expect($(".og-legend-toggle")).toBeFocused();
  });

  it("repaints live with the Obsidian theme without closing or losing session position (AE8)", async () => {
    await openLegend();
    await chooseBottom();
    await browser.waitUntil(async () => (await legendLayout()) === "bottom", { timeout: 8000 });
    const wasDark = await browser.execute(() => document.body.classList.contains("theme-dark"));
    await browser.executeObsidian(async ({ app }) => {
      (app as unknown as { commands: { executeCommandById: (id: string) => unknown } })
        .commands.executeCommandById("theme:toggle-light-dark");
    });
    await browser.waitUntil(
      async () => (await browser.execute(() => document.body.classList.contains("theme-dark"))) !== wasDark,
      { timeout: 10000, timeoutMsg: "Theme did not repaint while legend was open" },
    );
    expect(await legendLayout()).toBe("bottom");
    expect(await $$(".og-gantt-legend")).toHaveLength(1);
    const colors = await browser.execute(() => {
      const chart = document.querySelector('.wx-bar[data-id$="Legend Task.md"]') as HTMLElement | null;
      const chartPaint = chart?.querySelector<HTMLElement>(".og-ghost-run:not(.og-ghost-blocked)") ?? chart;
      const sample = document.querySelector('[data-semantic-id="bar-treatment"] .og-legend-bar') as HTMLElement | null;
      return [chartPaint && getComputedStyle(chartPaint).backgroundColor, sample && getComputedStyle(sample).backgroundColor];
    });
    expect(colors[1]).toBe(colors[0]);
  });

  it("supports keyboard open, live move, scroll focus, Escape close, and trigger focus restoration (AE9)", async () => {
    const trigger = await $(".og-legend-toggle");
    await trigger.click();
    await browser.waitUntil(async () => (await $$(".og-gantt-legend")).length === 1, { timeout: 8000 });
    await expect($(".og-legend-dismiss")).toBeFocused();
    await browser.execute(() => {
      const bottom = [...document.querySelectorAll<HTMLButtonElement>(".og-gantt-legend [role='radio']")]
        .find((button) => button.textContent?.trim() === "Bottom");
      bottom?.focus();
    });
    await browser.keys(["Space"]);
    await browser.waitUntil(async () => (await legendLayout()) === "bottom", { timeout: 8000 });
    const scroll = await $(".og-gantt-legend .og-legend-scroll");
    await scroll.click();
    await browser.keys(["ArrowRight"]);
    await browser.keys(["Escape"]);
    await browser.waitUntil(async () => (await $$(".og-gantt-legend")).length === 0, { timeout: 8000 });
    await expect(trigger).toBeFocused();
  });

  it("closes Legend before maximize or an unrelated Obsidian modal on Escape", async () => {
    await openLegend();
    await browser.executeObsidian(async ({ app }) => {
      (app as unknown as { commands: { executeCommandById: (id: string) => unknown } })
        .commands.executeCommandById("command-palette:open");
    });
    await browser.waitUntil(async () => (await $$(".modal-container .prompt")).length === 1, { timeout: 8000 });
    await browser.keys(["Escape"]);
    const outcome = await browser.execute(() => {
      return {
        legendOpen: !!document.querySelector(".og-gantt-legend"),
        maximized: !!document.querySelector(".og-bases-gantt.is-maximized"),
        modalOpen: !!document.querySelector(".modal-container .prompt"),
      };
    });
    expect(outcome).toEqual({ legendOpen: false, maximized: true, modalOpen: true });
  });
});
