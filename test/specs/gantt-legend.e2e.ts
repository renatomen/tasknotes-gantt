/* global HTMLButtonElement, getComputedStyle */
import { browser, expect, $, $$ } from "@wdio/globals";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixtureVault = path.resolve(__dirname, "../vaults/gantt-legend");
const FIXTURE_RESTORE_ATTEMPTS = 2;

let fixtureNonWorkingRenderingNeedsReset = false;

interface ElementRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ChartGeometry {
  surface: ElementRect;
  chart: ElementRect;
}

interface ChartViewState {
  selectedCount: number;
  scrollLeft: number;
  scaleCellWidth: number;
  scaleLabel: string;
}

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

async function chartGeometry(): Promise<ChartGeometry> {
  return browser.execute(() => {
    const surface = document.querySelector(".og-bases-gantt .og-chart-surface") as HTMLElement;
    const chart = document.querySelector(".og-bases-gantt .wx-chart") as HTMLElement;
    const snapshot = (element: HTMLElement): ElementRect => {
      const bounds = element.getBoundingClientRect();
      return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
    };
    return { surface: snapshot(surface), chart: snapshot(chart) };
  });
}

function expectGeometryUnchanged(actual: ChartGeometry, expected: ChartGeometry): void {
  for (const part of ["surface", "chart"] as const) {
    for (const edge of ["left", "top", "width", "height"] as const) {
      expect(Math.abs(actual[part][edge] - expected[part][edge])).toBeLessThan(1);
    }
  }
}

async function chartViewState(): Promise<ChartViewState> {
  return browser.execute(() => {
    const chart = document.querySelector(".og-bases-gantt .wx-chart") as HTMLElement;
    const scaleRows = document.querySelectorAll(".og-bases-gantt .wx-scale .wx-row");
    const scaleCell = scaleRows[scaleRows.length - 1]?.querySelector(".wx-cell") as HTMLElement;
    return {
      selectedCount: document.querySelectorAll(".og-bases-gantt .wx-selected").length,
      scrollLeft: chart.scrollLeft,
      scaleCellWidth: scaleCell.getBoundingClientRect().width,
      scaleLabel: scaleCell.textContent?.trim() ?? "",
    };
  });
}

async function ensureRealChartSelection(): Promise<void> {
  if ((await $$(".og-bases-gantt .wx-selected")).length === 0) {
    const clicked = await browser.execute(() => {
      const bar = document.querySelector(".og-bases-gantt .wx-bar.og-event") as HTMLElement | null;
      if (!bar) return false;
      const bounds = bar.getBoundingClientRect();
      for (let y = bounds.top + 2; y < bounds.bottom - 1; y += 4) {
        for (let x = bounds.left + 2; x < bounds.right - 1; x += 4) {
          const target = document.elementFromPoint(x, y) as HTMLElement | null;
          if (!target?.closest(".wx-bar.og-event")) continue;
          target.click();
          return true;
        }
      }
      return false;
    });
    expect(clicked).toBe(true);
    await browser.waitUntil(async () => (await $$(".og-bases-gantt .wx-selected")).length > 0, {
      timeout: 8000,
      timeoutMsg: "Legend fixture bar did not become selected",
    });
  }
}

async function openFixtureBase(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    const workspace = app.workspace as unknown as {
      detachLeavesOfType: (type: string) => void;
      iterateAllLeaves: (callback: (leaf: {
        view?: { getViewType?: () => string };
        detach?: () => void;
        openFile: (file: unknown) => Promise<void>;
      }) => void) => void;
      getLeaf: (newLeaf?: boolean) => {
        view?: { getViewType?: () => string };
        detach?: () => void;
        openFile: (file: unknown) => Promise<void>;
      };
    };
    const targetLeaf = workspace.getLeaf(true);
    const markdownLeaves: Array<{ detach?: () => void }> = [];
    workspace.iterateAllLeaves((leaf) => {
      if (leaf !== targetLeaf && leaf.view?.getViewType?.() === "markdown") markdownLeaves.push(leaf);
    });
    markdownLeaves.forEach((leaf) => leaf.detach?.());
    workspace.detachLeavesOfType("bases");
    const file = app.vault.getAbstractFileByPath("Legend.base");
    if (file) await targetLeaf.openFile(file as never);
  });
}

async function restoreTaskNotesLegendStatuses(): Promise<boolean> {
  return browser.executeObsidian(async ({ app }) => {
    interface PatchedCatalog {
      statuses?: () => unknown[];
      __legendOriginalStatuses?: () => unknown[];
    }
    const taskNotes = (app as unknown as {
      plugins?: { getPlugin?: (id: string) => { api?: { catalog?: PatchedCatalog } } | undefined };
    }).plugins?.getPlugin?.("tasknotes");
    const catalog = taskNotes?.api?.catalog;
    if (!catalog?.__legendOriginalStatuses) return false;
    catalog.statuses = catalog.__legendOriginalStatuses;
    delete catalog.__legendOriginalStatuses;
    return true;
  });
}

async function remountMaximizedFixture(): Promise<void> {
  await openFixtureBase();
  await browser.waitUntil(async () => (await $$(".og-bases-gantt .og-fullscreen-toggle")).length === 1, {
    timeout: 15000,
    timeoutMsg: "Gantt fixture did not remount",
  });
  await $(".og-bases-gantt .og-fullscreen-toggle").click();
  await browser.waitUntil(async () => (await $$(".og-bases-gantt.is-maximized")).length === 1, {
    timeout: 8000,
  });
}

async function setFixtureNonWorkingRendering(rendering: "shaded" | "split"): Promise<void> {
  const updated = await browser.executeObsidian(async ({ app }, nextRendering) => {
    const file = app.vault.getAbstractFileByPath("Legend.base");
    if (!file) return false;
    const body = await app.vault.read(file as never) as string;
    const nextBody = body.replace(
      /tngantt_nonWorkingRendering: (?:shaded|split)/,
      `tngantt_nonWorkingRendering: ${nextRendering}`,
    );
    if (nextBody === body && !body.includes(`tngantt_nonWorkingRendering: ${nextRendering}`)) return false;
    if (nextBody !== body) await app.vault.modify(file as never, nextBody);
    return true;
  }, rendering);
  expect(updated).toBe(true);
  await remountMaximizedFixture();
}

async function restoreFixtureNonWorkingRendering(): Promise<void> {
  let lastFailure: unknown;
  for (let attempt = 0; attempt < FIXTURE_RESTORE_ATTEMPTS; attempt += 1) {
    try {
      await setFixtureNonWorkingRendering("split");
      await browser.waitUntil(
        async () =>
          (await $$(
            '.og-bases-gantt .wx-bar[data-id$="Legend Task.md"] .og-ghost-run.og-ghost-blocked',
          )).length > 0,
        {
          timeout: 8000,
          timeoutMsg: "Gantt legend fixture did not render its restored split extension",
        },
      );
      fixtureNonWorkingRenderingNeedsReset = false;
      return;
    } catch (error) {
      lastFailure = error;
    }
  }
  throw lastFailure ?? new Error("Gantt legend fixture split restoration failed");
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
    const cleanupFailures: unknown[] = [];
    const attemptCleanup = async (cleanup: () => Promise<void>): Promise<void> => {
      try {
        await cleanup();
      } catch (error) {
        cleanupFailures.push(error);
      }
    };

    await attemptCleanup(async () => {
      if ((await $$(".og-gantt-legend")).length > 0) await closeLegend();
    });
    await attemptCleanup(async () => {
      if ((await $$(".modal-container")).length > 0) await browser.keys(["Escape"]);
    });
    await attemptCleanup(async () => {
      if (await restoreTaskNotesLegendStatuses()) {
        try {
          await remountMaximizedFixture();
        } catch {
          await remountMaximizedFixture();
        }
      }
    });
    await attemptCleanup(async () => {
      if (fixtureNonWorkingRenderingNeedsReset) await restoreFixtureNonWorkingRendering();
    });
    await attemptCleanup(async () => {
      await browser.execute(() => {
        const host = document.querySelector(".og-bases-gantt .gtcell") as HTMLElement | null;
        if (host) host.style.width = "";
      });
    });

    if (cleanupFailures.length === 1) throw cleanupFailures[0];
    if (cleanupFailures.length > 1) {
      throw new AggregateError(cleanupFailures, "Multiple Gantt legend fixture cleanups failed");
    }
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

  it("reuses production shading and treatment paint for secondary semantics", async () => {
    await openLegend();
    const paint = await browser.execute(() => {
      const chartBar = document.querySelector('.og-bases-gantt .wx-bar[data-id$="Legend Task.md"]') as HTMLElement | null;
      const chartPaint = chartBar?.querySelector<HTMLElement>(".og-ghost-run:not(.og-ghost-blocked)") ?? chartBar;
      const replicated = document.querySelector('[data-semantic-id="replicated-task"] .og-legend-bar') as HTMLElement | null;
      const completed = document.querySelector('[data-semantic-id="occurrence-completed"] .og-legend-bar') as HTMLElement | null;
      const weekend = document.querySelector('[data-semantic-id="weekend-shading"] .og-legend-shading') as HTMLElement | null;
      const weekendCell = document.querySelector('.og-bases-gantt .wx-weekend') as HTMLElement | null;
      return {
        chartBackground: chartPaint ? getComputedStyle(chartPaint).backgroundColor : null,
        replicatedBackground: replicated ? getComputedStyle(replicated).backgroundColor : null,
        replicatedHatch: replicated ? getComputedStyle(replicated, '::after').backgroundImage : null,
        completedBackground: completed ? getComputedStyle(completed).backgroundColor : null,
        weekendBackground: weekend ? getComputedStyle(weekend).backgroundColor : null,
        weekendCellBackground: weekendCell ? getComputedStyle(weekendCell).backgroundColor : null,
      };
    });
    expect(paint.replicatedBackground).toBe(paint.chartBackground);
    expect(paint.replicatedHatch).toContain("repeating-linear-gradient");
    expect(paint.completedBackground).toBe(paint.chartBackground);
    expect(paint.weekendBackground).toBe(paint.weekendCellBackground);
  });

  it("keeps composite sample hosts transparent while nested pieces own their paint", async () => {
    await openLegend();
    const ownership = await browser.execute(() => {
      const sample = (semanticId: string): HTMLElement | null =>
        document.querySelector(`[data-semantic-id="${semanticId}"] .og-legend-sample > div`);
      const split = sample("working-time-split");
      const extension = sample("working-time-extension");
      const occupancy = sample("occurrence-occupancy");
      const progress = sample("progress");
      const occupancyPainted = [
        ...(occupancy?.querySelectorAll<HTMLElement>(".og-piece-painted") ?? []),
      ];
      const splitPainted = [
        ...(split?.querySelectorAll<HTMLElement>(".og-piece-painted.og-ghost-run") ?? []),
      ];
      const extensionPainted = [
        ...(extension?.querySelectorAll<HTMLElement>(".og-piece-painted.og-ghost-run") ?? []),
      ];
      const occupancyGap = occupancy?.querySelector<HTMLElement>(".og-piece-gap");
      const ownsVisiblePaint = (pieces: HTMLElement[]): boolean =>
        pieces.length === 2 &&
        pieces.every((piece) => getComputedStyle(piece).backgroundColor !== "rgba(0, 0, 0, 0)");
      return {
        splitHostOwnsPaint:
          split?.classList.contains("og-ghost-run") || split?.classList.contains("og-ghost-blocked"),
        splitHasBlockedPiece: !!split?.querySelector(".og-ghost-run.og-ghost-blocked"),
        splitPaintedPiecesOwnPaint: ownsVisiblePaint(splitPainted),
        extensionHostOwnsPaint: extension?.classList.contains("og-ghost-run") ?? false,
        extensionHasBlockedPiece: !!extension?.querySelector(".og-ghost-run.og-ghost-blocked"),
        extensionPaintedPiecesOwnPaint: ownsVisiblePaint(extensionPainted),
        occupancyHostOwnsPaint:
          occupancy?.classList.contains("wx-bar") || occupancy?.classList.contains("og-instance"),
        occupancyPiecesOwnPaint:
          ownsVisiblePaint(occupancyPainted) &&
          occupancyPainted.every(
            (piece) => piece.classList.contains("wx-bar") && piece.classList.contains("og-instance"),
          ),
        occupancyGapBackground: occupancyGap ? getComputedStyle(occupancyGap).backgroundColor : null,
        progressHostOwnsNestedClasses:
          progress?.classList.contains("wx-progress-wrapper") ||
          progress?.classList.contains("wx-progress-percent"),
        progressHasNestedClasses:
          !!progress?.querySelector(".wx-progress-wrapper > .wx-progress-percent"),
      };
    });

    expect(ownership).toEqual({
      splitHostOwnsPaint: false,
      splitHasBlockedPiece: true,
      splitPaintedPiecesOwnPaint: true,
      extensionHostOwnsPaint: false,
      extensionHasBlockedPiece: true,
      extensionPaintedPiecesOwnPaint: true,
      occupancyHostOwnsPaint: false,
      occupancyPiecesOwnPaint: true,
      occupancyGapBackground: "rgba(0, 0, 0, 0)",
      progressHostOwnsNestedClasses: false,
      progressHasNestedClasses: true,
    });
  });

  it("renders a shaded working-time extension as one continuous bar over blocked-day shading", async () => {
    fixtureNonWorkingRenderingNeedsReset = true;
    await setFixtureNonWorkingRendering("shaded");
    await openLegend();
    const extension = await browser.execute(() => {
      const sample = document.querySelector<HTMLElement>(
        '[data-semantic-id="working-time-extension"] .og-legend-sample',
      );
      return {
        hasShadedClass: sample?.classList.contains("og-legend-extension-shaded") ?? false,
        backgroundImage: sample ? getComputedStyle(sample).backgroundImage : "none",
        shadingVariable: sample
          ? getComputedStyle(sample).getPropertyValue("--og-legend-shading-background").trim()
          : "",
        barCount: sample?.querySelectorAll(".og-legend-bar").length ?? 0,
        pieceCount: sample?.querySelectorAll(".og-legend-pieces").length ?? 0,
      };
    });

    expect(extension.hasShadedClass).toBe(true);
    expect(extension.backgroundImage).toContain("linear-gradient");
    expect(extension.shadingVariable).not.toBe("");
    expect(extension.barCount).toBe(1);
    expect(extension.pieceCount).toBe(0);
  });

  it("keeps more than four configured icon samples visible by wrapping them", async () => {
    const patched = await browser.executeObsidian(async ({ app }) => {
      interface StatusEntry {
        value: string;
        color: string;
        isCompleted?: boolean;
        icon?: string;
      }
      interface PatchedCatalog {
        statuses?: () => StatusEntry[];
        __legendOriginalStatuses?: () => StatusEntry[];
      }
      const taskNotes = (app as unknown as {
        plugins?: { getPlugin?: (id: string) => { api?: { catalog?: PatchedCatalog } } | undefined };
      }).plugins?.getPlugin?.("tasknotes");
      const catalog = taskNotes?.api?.catalog;
      if (!catalog?.statuses) return false;
      catalog.__legendOriginalStatuses ??= catalog.statuses.bind(catalog);
      const configured = catalog.__legendOriginalStatuses();
      catalog.statuses = () => [
        ...configured,
        { value: "legend-one", color: "#2563eb", icon: "circle" },
        { value: "legend-two", color: "#7c3aed", icon: "square" },
        { value: "legend-three", color: "#db2777", icon: "triangle" },
        { value: "legend-four", color: "#ea580c", icon: "diamond" },
        { value: "legend-five", color: "#16a34a", icon: "star" },
      ];
      return true;
    });
    expect(patched).toBe(true);

    await remountMaximizedFixture();
    await openLegend();

    const layout = await browser.execute(() => {
      const icons = document.querySelector<HTMLElement>(
        '[data-semantic-id="bar-icon"] .og-legend-icons',
      );
      const chips = [...(icons?.querySelectorAll<HTMLElement>(".og-bar-chip") ?? [])];
      const bounds = icons?.getBoundingClientRect();
      const sampleBounds = icons?.closest<HTMLElement>(".og-legend-sample")?.getBoundingClientRect();
      const rows = new Set(chips.map((chip) => Math.round(chip.getBoundingClientRect().top)));
      return {
        count: chips.length,
        flexWrap: icons ? getComputedStyle(icons).flexWrap : null,
        overflow: icons ? getComputedStyle(icons).overflow : null,
        wrappedRows: rows.size,
        sampleHeight: sampleBounds?.height ?? 0,
        allContained:
          !!bounds &&
          !!sampleBounds &&
          chips.every((chip) => {
            const rect = chip.getBoundingClientRect();
            return (
              rect.left >= bounds.left - 1 &&
              rect.right <= bounds.right + 1 &&
              rect.top >= sampleBounds.top - 1 &&
              rect.bottom <= sampleBounds.bottom + 1
            );
          }),
      };
    });

    expect(layout.count).toBeGreaterThan(4);
    expect(layout.flexWrap).toBe("wrap");
    expect(layout.overflow).toBe("visible");
    expect(layout.wrappedRows).toBeGreaterThan(1);
    expect(layout.sampleHeight).toBeGreaterThan(34);
    expect(layout.allContained).toBe(true);

    await chooseBottom();
    await browser.waitUntil(async () => (await legendLayout()) === "bottom", { timeout: 8000 });
    const bottomReachability = await browser.execute(() => {
      const panel = document.querySelector<HTMLElement>(".og-gantt-legend");
      const scroll = document.querySelector<HTMLElement>(".og-gantt-legend .og-legend-scroll");
      const chips = [...document.querySelectorAll<HTMLElement>(
        '[data-semantic-id="bar-icon"] .og-bar-chip',
      )];
      if (!panel || !scroll || chips.length === 0) return null;
      panel.style.height = "100px";
      const hasOverflow = scroll.scrollHeight > scroll.clientHeight;
      scroll.scrollTop = scroll.scrollHeight;
      chips[chips.length - 1].scrollIntoView({ block: "nearest", inline: "nearest" });
      const viewport = scroll.getBoundingClientRect();
      const finalIcon = chips[chips.length - 1].getBoundingClientRect();
      return {
        ariaLabel: scroll.getAttribute("aria-label"),
        overflowY: getComputedStyle(scroll).overflowY,
        hasOverflow,
        scrollTop: scroll.scrollTop,
        scrollLeft: scroll.scrollLeft,
        finalIconReachable:
          finalIcon.top >= viewport.top - 1 && finalIcon.bottom <= viewport.bottom + 1,
      };
    });
    expect(bottomReachability).toEqual({
      ariaLabel: "Legend entries, horizontal and vertical scrolling",
      overflowY: "auto",
      hasOverflow: true,
      scrollTop: expect.any(Number),
      scrollLeft: expect.any(Number),
      finalIconReachable: true,
    });
    expect(bottomReachability?.scrollTop).toBeGreaterThan(0);
  });

  it("explains enabled read-only calendar-event bars with their production paint", async () => {
    await browser.waitUntil(async () => (await $$(".og-bases-gantt .wx-bar.og-event")).length > 0, {
      timeout: 10000,
      timeoutMsg: "Property-event fixture did not render its read-only event bar",
    });
    await openLegend();
    const paint = await browser.execute(() => {
      const eventBar = document.querySelector('.og-bases-gantt .wx-bar.og-event') as HTMLElement | null;
      const sample = document.querySelector('[data-semantic-id="calendar-event"] .og-legend-bar') as HTMLElement | null;
      return {
        eventBackground: eventBar ? getComputedStyle(eventBar).backgroundColor : null,
        sampleBackground: sample ? getComputedStyle(sample).backgroundColor : null,
        sampleClasses: sample?.className ?? "",
      };
    });
    expect(paint.sampleClasses).toContain("og-event");
    expect(paint.sampleBackground).toBe(paint.eventBackground);
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

  it("switches live without reflow, preserves selection/zoom/scroll, then reopens at the Appearance default (AE4/AE5)", async () => {
    await ensureRealChartSelection();
    const beforeZoom = await chartViewState();
    await $(".og-bases-gantt .zoom-in").click();
    await browser.waitUntil(async () => {
      const current = await chartViewState();
      return current.scaleCellWidth !== beforeZoom.scaleCellWidth || current.scaleLabel !== beforeZoom.scaleLabel;
    }, {
      timeout: 8000,
      timeoutMsg: "Zoom control did not visibly change the real Gantt scale",
    });
    const scrollRange = await browser.execute(() => {
      const chart = document.querySelector(".og-bases-gantt .wx-chart") as HTMLElement | null;
      if (!chart) return 0;
      const maximum = chart.scrollWidth - chart.clientWidth;
      chart.scrollLeft = Math.min(80, maximum);
      return maximum;
    });
    expect(scrollRange).toBeGreaterThan(0);
    const expectedGeometry = await chartGeometry();
    const expectedState = await chartViewState();
    expect(expectedState.selectedCount).toBeGreaterThan(0);
    expect(expectedState.scrollLeft).toBeGreaterThan(0);

    await openLegend();
    expectGeometryUnchanged(await chartGeometry(), expectedGeometry);
    expect(await chartViewState()).toEqual(expectedState);

    await chooseBottom();
    await browser.waitUntil(async () => (await legendLayout()) === "bottom", {
      timeout: 8000,
      timeoutMsg: "Legend did not move to the bottom",
    });
    expectGeometryUnchanged(await chartGeometry(), expectedGeometry);
    expect(await chartViewState()).toEqual(expectedState);
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
      };
    });
    expect(bottom.overflowX).toBe("auto");
    expect(bottom.didScroll).toBe(true);
    expect(bottom.verticalContentFits).toBe(true);
    expect(bottom.headerFixed).toBe(true);
    expect(bottom.chartScroll).toBe(expectedState.scrollLeft);

    await closeLegend();
    expectGeometryUnchanged(await chartGeometry(), expectedGeometry);
    expect(await chartViewState()).toEqual(expectedState);
    await openLegend();
    expect(await legendLayout()).toBe("right");
    expectGeometryUnchanged(await chartGeometry(), expectedGeometry);
    expect(await chartViewState()).toEqual(expectedState);
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

  it("automatically leaves full view when space returns and preserves real chart state through Return (AE6)", async () => {
    await ensureRealChartSelection();
    let scrollRange = 0;
    for (let attempt = 0; attempt < 4 && scrollRange < 300; attempt += 1) {
      const beforeZoom = await chartViewState();
      await $(".og-bases-gantt .zoom-in").click();
      await browser.waitUntil(async () => {
        const current = await chartViewState();
        return current.scaleCellWidth !== beforeZoom.scaleCellWidth || current.scaleLabel !== beforeZoom.scaleLabel;
      }, {
        timeout: 8000,
        timeoutMsg: "Zoom control did not visibly change the real Gantt scale",
      });
      scrollRange = await browser.execute(() => {
        const chart = document.querySelector(".og-bases-gantt .wx-chart") as HTMLElement | null;
        return chart ? chart.scrollWidth - chart.clientWidth : 0;
      });
    }
    expect(scrollRange).toBeGreaterThanOrEqual(300);
    await browser.execute(() => {
      const chart = document.querySelector(".og-bases-gantt .wx-chart") as HTMLElement | null;
      if (chart) chart.scrollLeft = 60;
    });

    await openLegend();
    await chooseBottom();
    await browser.waitUntil(async () => (await legendLayout()) === "bottom", { timeout: 8000 });
    const expectedState = await chartViewState();
    expect(expectedState.selectedCount).toBeGreaterThan(0);
    expect(expectedState.scrollLeft).toBeGreaterThan(0);
    const focusedPositionControl = await browser.execute(() => {
      const bottom = [...document.querySelectorAll<HTMLButtonElement>(".og-gantt-legend [role='radio']")]
        .find((button) => button.textContent?.trim() === "Bottom");
      bottom?.focus({ preventScroll: true });
      return document.activeElement === bottom;
    });
    expect(focusedPositionControl).toBe(true);

    await browser.execute(() => {
      const host = document.querySelector(".og-bases-gantt .gtcell") as HTMLElement | null;
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
    await expect(returnButton).toBeFocused();
    expect(await chartViewState()).toEqual(expectedState);

    await browser.execute(() => {
      const host = document.querySelector(".og-bases-gantt .gtcell") as HTMLElement | null;
      if (host) host.style.width = "";
    });
    await browser.waitUntil(async () => (await legendLayout()) === "bottom", {
      timeout: 8000,
      timeoutMsg: "Legend did not automatically restore its session position when space returned",
    });
    expect(await $$(".og-gantt-legend [role='radiogroup']")).toHaveLength(1);
    const restoredAccessibility = await browser.execute(() => {
      const surface = document.querySelector(".og-bases-gantt .og-chart-surface");
      return {
        inert: surface?.hasAttribute("inert") ?? false,
        ariaHidden: surface?.getAttribute("aria-hidden"),
      };
    });
    expect(restoredAccessibility).toEqual({ inert: false, ariaHidden: null });
    await expect($(".og-gantt-legend .og-legend-dismiss")).toHaveText(expect.stringContaining("Close"));
    const automaticallyRestoredState = await chartViewState();
    expect(automaticallyRestoredState.selectedCount).toBe(expectedState.selectedCount);
    expect(automaticallyRestoredState.scaleCellWidth).toBe(expectedState.scaleCellWidth);
    expect(automaticallyRestoredState.scaleLabel).toBe(expectedState.scaleLabel);
    expect(automaticallyRestoredState.scrollLeft).toBeGreaterThan(0);

    const focusedScrollRegion = await browser.execute(() => {
      const scroll = document.querySelector<HTMLElement>(".og-gantt-legend .og-legend-scroll");
      scroll?.focus({ preventScroll: true });
      return document.activeElement === scroll;
    });
    expect(focusedScrollRegion).toBe(true);

    await browser.execute(() => {
      const host = document.querySelector(".og-bases-gantt .gtcell") as HTMLElement | null;
      if (host) host.style.width = "400px";
    });
    await browser.waitUntil(async () => (await legendLayout()) === "full", { timeout: 8000 });
    const restoredReturnButton = await $(".og-gantt-legend .og-legend-dismiss");
    await expect(restoredReturnButton).toHaveText(expect.stringContaining("Return"));
    await expect($(".og-gantt-legend .og-legend-scroll")).toBeFocused();

    await restoredReturnButton.click();
    await browser.execute(() => {
      const host = document.querySelector(".og-bases-gantt .gtcell") as HTMLElement | null;
      if (host) host.style.width = "";
    });
    const returnedState = await chartViewState();
    expect(returnedState.selectedCount).toBe(expectedState.selectedCount);
    expect(returnedState.scaleCellWidth).toBe(expectedState.scaleCellWidth);
    expect(returnedState.scaleLabel).toBe(expectedState.scaleLabel);
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

  it("lets an Obsidian popup close before Legend, then restores Legend trigger focus", async () => {
    const trigger = await $(".og-legend-toggle");
    await openLegend();
    await browser.executeObsidian(async ({ app }) => {
      (app as unknown as { commands: { executeCommandById: (id: string) => unknown } })
        .commands.executeCommandById("command-palette:open");
    });
    await browser.waitUntil(async () => (await $$(".modal-container .prompt")).length === 1, { timeout: 8000 });
    await browser.keys(["Escape"]);
    await browser.waitUntil(async () => (await $$(".modal-container .prompt")).length === 0, {
      timeout: 8000,
      timeoutMsg: "First Escape did not close the Obsidian popup",
    });
    const firstEscape = await browser.execute(() => {
      return {
        legendOpen: !!document.querySelector(".og-gantt-legend"),
        maximized: !!document.querySelector(".og-bases-gantt.is-maximized"),
        modalOpen: !!document.querySelector(".modal-container .prompt"),
      };
    });
    expect(firstEscape).toEqual({ legendOpen: true, maximized: true, modalOpen: false });

    await browser.keys(["Escape"]);
    await browser.waitUntil(async () => (await $$(".og-gantt-legend")).length === 0, {
      timeout: 8000,
      timeoutMsg: "Second Escape did not close Legend",
    });
    expect(await $$(".og-bases-gantt.is-maximized")).toHaveLength(1);
    await expect(trigger).toBeFocused();
  });

  // LAST test: it deliberately leaves another leaf active.
  it("deactivates Legend without focusing its hidden trigger when another leaf becomes active", async () => {
    await openLegend();
    await browser.executeObsidian(async ({ app }) => {
      app.workspace.getLeaf(true);
    });
    await browser.waitUntil(async () => (await $$(".og-gantt-legend")).length === 0, {
      timeout: 8000,
      timeoutMsg: "Legend stayed active after its owning leaf became inactive",
    });
    expect(await $$(".og-bases-gantt.is-maximized")).toHaveLength(0);
    const hiddenTriggerFocused = await browser.execute(
      () => document.activeElement?.classList.contains("og-legend-toggle") ?? false,
    );
    expect(hiddenTriggerFocused).toBe(false);
  });
});
