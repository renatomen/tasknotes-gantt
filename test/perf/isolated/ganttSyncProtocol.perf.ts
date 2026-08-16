/* global HTMLInputElement */
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import type {
  RenderInstance,
  RenderLink,
} from "../../../src/controller/InstanceExpansion";
import type { TaskPatch } from "../../../src/datasource/types";
import type { GanttData } from "../../../src/bases/types/gantt-view-data";
import { gridColumnsKey } from "../../../src/bases/gridColumns";
import { BULK_RESEED_OP_THRESHOLD } from "../../../src/bases/ganttSync";
import type { TaskGraph } from "../generator/graph";
import { buildGanttData } from "../generator/buildGanttData";
import GanttPerfHost from "./GanttPerfHost.svelte";

interface TaskOptions {
  parents?: string[];
  deps?: TaskGraph["tasks"][number]["deps"];
}

const task = (
  name: string,
  startMonth: number,
  dueMonth: number,
  options: TaskOptions = {}
): TaskGraph["tasks"][number] => ({
  path: `Tasks/${name}.md`,
  title: name,
  parents: options.parents ?? [],
  deps: options.deps ?? [],
  start: new Date(2026, startMonth, 1),
  due: new Date(2026, dueMonth, 15),
  status: "open",
  matched: true,
});

const GRAPH: TaskGraph = {
  tasks: [
    task("Alpha", 0, 1),
    task("Beta", 4, 5, {
      deps: [
        {
          predecessorPath: "Tasks/Alpha.md",
          reltype: "FINISHTOSTART",
          gap: null,
        },
      ],
    }),
    task("Charlie", 2, 3, { parents: ["Tasks/Alpha.md"] }),
    task("Delta", 7, 8),
    task("Foxtrot", 10, 11),
  ],
  fillers: [],
  params: {
    seed: 1,
    totalNotes: 5,
    taskCount: 5,
    matchedCount: 5,
    multiParentDist: [],
    maxDepth: 1,
    depDensity: 0.25,
    dateMix: { dated: 1, undated: 0, startOnly: 0, endOnly: 0 },
    cycleCount: 0,
    orphanCount: 0,
  },
};

const OWNER_COLUMN_ID = "note.owner";
const PHASE_COLUMN_ID = "note.phase";
const ECHO_PATH = "Tasks/Echo.md";
const INITIAL_PHASE = "Planned";
const REFRESHED_OWNER = "Owner refreshed";
// Leave a margin beyond the 300 ms callback debounce before asserting absence.
const DEBOUNCED_CALLBACK_OBSERVATION_MS = 350;

function callbackSpies() {
  return {
    onMutate: vi.fn<(instanceId: string, patch: TaskPatch) => Promise<void>>(
      async () => {}
    ),
    onMutateProperty: vi.fn<
      (instanceId: string, propertyId: string, value: unknown) => Promise<void>
    >(async () => {}),
    onAddDependency: vi.fn<
      (
        predecessorInstanceId: string,
        dependentInstanceId: string
      ) => Promise<void>
    >(async () => {}),
    onRemoveDependency: vi.fn<
      (
        predecessorInstanceId: string,
        dependentInstanceId: string
      ) => Promise<void>
    >(async () => {}),
    onBarActivate:
      vi.fn<
        (
          path: string,
          opts: { kind: "single" | "double"; ctrlOrMeta: boolean }
        ) => void
      >(),
    onGridWidthChange: vi.fn<(width: number) => void>(),
  };
}

type CallbackSpies = ReturnType<typeof callbackSpies>;

function clearCallbacks(spies: CallbackSpies): void {
  for (const spy of Object.values(spies)) spy.mockClear();
}

function expectNoTaskCallbacks(spies: CallbackSpies): void {
  for (const spy of [
    spies.onMutate,
    spies.onMutateProperty,
    spies.onAddDependency,
    spies.onRemoveDependency,
    spies.onBarActivate,
  ]) {
    expect(spy).not.toHaveBeenCalled();
  }
}

function decodeId(value: string): string {
  return value.startsWith(":") ? value.slice(1) : value;
}

function gridRows(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      ".wx-table .wx-data > .wx-row[data-id]"
    )
  );
}

function rowIds(container: HTMLElement): string[] {
  return gridRows(container).map((row) => decodeId(row.dataset.id ?? ""));
}

function linkIds(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(".wx-links [data-link-id]")
  ).map((link) => decodeId(link.dataset.linkId ?? ""));
}

function rowById(container: HTMLElement, id: string): HTMLElement {
  const row = gridRows(container).find(
    (candidate) => decodeId(candidate.dataset.id ?? "") === id
  );
  if (!row) throw new Error(`Missing grid row ${id}`);
  return row;
}

function cellById(
  container: HTMLElement,
  rowId: string,
  columnId: string
): HTMLElement {
  const cell = Array.from(
    container.querySelectorAll<HTMLElement>("[data-row-id][data-col-id]")
  ).find(
    (candidate) =>
      decodeId(candidate.dataset.rowId ?? "") === rowId &&
      decodeId(candidate.dataset.colId ?? "") === columnId
  );
  if (!cell) throw new Error(`Missing grid cell ${rowId}/${columnId}`);
  return cell;
}

function cellText(
  container: HTMLElement,
  rowId: string,
  columnId: string
): string {
  const cell = cellById(container, rowId, columnId);
  return (
    cell.querySelector<HTMLElement>(".og-grid-cell")?.textContent ??
    cell.textContent ??
    ""
  ).trim();
}

function barById(container: HTMLElement, id: string): HTMLElement | null {
  return (
    Array.from(
      container.querySelectorAll<HTMLElement>(".wx-bar[data-id]")
    ).find((candidate) => decodeId(candidate.dataset.id ?? "") === id) ?? null
  );
}

function hierarchyIndent(row: HTMLElement): number {
  const content = row.querySelector<HTMLElement>(".wx-content");
  if (!content) throw new Error("Missing hierarchy content");
  return Number.parseFloat(content.style.paddingLeft);
}

async function collapseRow(
  container: HTMLElement,
  parentId: string,
  childId: string
): Promise<void> {
  const toggle = rowById(container, parentId).querySelector<HTMLElement>(
    '[data-action="open-task"]'
  );
  if (!toggle) throw new Error(`Missing collapse toggle for ${parentId}`);
  toggle.click();
  await vi.waitFor(() => {
    expect(rowById(container, parentId).getAttribute("aria-expanded")).toBe(
      "false"
    );
    expect(rowIds(container)).not.toContain(childId);
  });
}

async function openTextEditor(
  container: HTMLElement,
  rowId: string,
  columnId: string
): Promise<HTMLInputElement> {
  // Open only the editor; activation timing is outside this sync contract.
  cellById(container, rowId, columnId).dispatchEvent(
    new window.MouseEvent("dblclick", { bubbles: true, cancelable: true })
  );
  await vi.waitFor(() => {
    expect(
      container.querySelector<HTMLInputElement>(".wx-editor input.wx-text")
    ).not.toBeNull();
  });
  const input = container.querySelector<HTMLInputElement>(
    ".wx-editor input.wx-text"
  );
  if (!input) throw new Error("Missing open text editor");
  return input;
}

function commitTextEditor(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  input.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })
  );
}

async function settleDebouncedBrowserEvents(): Promise<void> {
  await new Promise<void>((resolve) =>
    window.setTimeout(resolve, DEBOUNCED_CALLBACK_OBSERVATION_MS)
  );
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => resolve())
    );
  });
}

async function waitForRender(container: HTMLElement): Promise<void> {
  await vi.waitFor(
    () => {
      expect(
        container.querySelector('.og-perf-host[data-render-complete="true"]')
      ).not.toBeNull();
    },
    { timeout: 10000, interval: 50 }
  );
}

function useWideViewport(container: HTMLElement): void {
  container.style.width = "1200px";
}

async function selectRow(container: HTMLElement, id: string): Promise<void> {
  rowById(container, id).click();
  await vi.waitFor(() =>
    expect(rowById(container, id).classList.contains("wx-selected")).toBe(true)
  );
}

function expectHorizontalScrollingAvailable(chart: HTMLElement): void {
  expect(chart.scrollWidth).toBeGreaterThan(chart.clientWidth);
}

function scrollChartHorizontally(chart: HTMLElement): number {
  chart.scrollLeft = Math.min(120, chart.scrollWidth - chart.clientWidth);
  // Deliver the test's programmatic scroll to SVAR before reading view state.
  chart.dispatchEvent(new window.Event("scroll"));
  return chart.scrollLeft;
}

function cloneData(data: GanttData): GanttData {
  return {
    ...data,
    capabilities: { ...data.capabilities },
    instances: data.instances.map((instance) => ({ ...instance })),
    links: data.links.map((link) => ({ ...link })),
    propertyValues: new Map(
      [...data.propertyValues].map(([path, values]) => [path, { ...values }])
    ),
    cellRenders: new Map(
      [...data.cellRenders].map(([path, renders]) => [path, { ...renders }])
    ),
    managedPaths: new Set(data.managedPaths),
    cellEditors: new Map(data.cellEditors),
  };
}

async function initialData(): Promise<GanttData> {
  const { data } = await buildGanttData(GRAPH, { mode: "inherit" });
  const columns = [
    ...data.gridColumns,
    {
      id: OWNER_COLUMN_ID,
      propId: OWNER_COLUMN_ID,
      header: "Owner",
      width: 140,
      align: "left" as const,
      isName: false,
    },
    {
      id: PHASE_COLUMN_ID,
      propId: PHASE_COLUMN_ID,
      header: "Phase",
      width: 140,
      align: "left" as const,
      isName: false,
    },
  ];
  const propertyValues = new Map(
    data.instances.map((instance) => [
      instance.sourcePath,
      {
        [OWNER_COLUMN_ID]: {
          kind: "text" as const,
          value: `${instance.text} owner`,
        },
        [PHASE_COLUMN_ID]: { kind: "text" as const, value: INITIAL_PHASE },
      },
    ])
  );
  return {
    ...cloneData(data),
    capabilities: { write: true },
    gridColumns: columns,
    gridColumnsKey: gridColumnsKey(columns),
    gridWidth: 300,
    propertyValues,
    managedPaths: new Set(
      data.instances.map((instance) => instance.sourcePath)
    ),
    cellEditors: new Map([
      [OWNER_COLUMN_ID, { kind: "text" }],
      [PHASE_COLUMN_ID, { kind: "text" }],
    ]),
  };
}

function instanceByText(data: GanttData, text: string): RenderInstance {
  const instance = data.instances.find((candidate) => candidate.text === text);
  if (!instance) throw new Error(`Missing instance ${text}`);
  return instance;
}

function withTextProperty(
  data: GanttData,
  sourcePath: string,
  columnId: string,
  value: string
): GanttData {
  const next = cloneData(data);
  const properties = { ...(next.propertyValues.get(sourcePath) ?? {}) };
  properties[columnId] = { kind: "text", value };
  next.propertyValues.set(sourcePath, properties);
  return next;
}

function mixedData(data: GanttData): GanttData {
  const alpha = instanceByText(data, "Alpha");
  const beta = instanceByText(data, "Beta");
  const charlie = instanceByText(data, "Charlie");
  const delta = instanceByText(data, "Delta");
  const foxtrot = instanceByText(data, "Foxtrot");
  const echo: RenderInstance = {
    ...beta,
    id: ECHO_PATH,
    sourcePath: ECHO_PATH,
    text: "Echo",
  };
  const link: RenderLink = {
    id: "sync-new-link",
    source: foxtrot.id,
    target: echo.id,
    type: "e2s",
    reltype: "FINISHTOSTART",
    gap: null,
  };
  const next = withTextProperty(
    data,
    alpha.sourcePath,
    OWNER_COLUMN_ID,
    REFRESHED_OWNER
  );
  next.propertyValues.set(echo.sourcePath, {
    ...(next.propertyValues.get(beta.sourcePath) ?? {}),
  });
  const managedPaths = new Set(next.managedPaths);
  managedPaths.add(echo.sourcePath);
  return {
    ...next,
    instances: [
      { ...alpha, text: "Alpha refreshed" },
      { ...charlie, parent: alpha.id },
      { ...foxtrot },
      { ...delta, parent: foxtrot.id },
      echo,
    ],
    links: [link],
    managedPaths,
  };
}

function bulkAdditionData(data: GanttData): {
  next: GanttData;
  firstAdded: RenderInstance;
} {
  const template = instanceByText(data, "Beta");
  const additions = Array.from(
    { length: BULK_RESEED_OP_THRESHOLD + 1 },
    (_, index): RenderInstance => {
      const sourcePath = `Tasks/Bulk-${String(index).padStart(3, "0")}.md`;
      return {
        ...template,
        id: sourcePath,
        sourcePath,
        text: `Bulk ${index}`,
      };
    }
  );
  const next = cloneData(data);
  const templateProperties = next.propertyValues.get(template.sourcePath) ?? {};
  const managedPaths = new Set(next.managedPaths);
  for (const addition of additions) {
    next.propertyValues.set(addition.sourcePath, { ...templateProperties });
    managedPaths.add(addition.sourcePath);
  }
  const [firstExisting, ...remainingExisting] = next.instances;
  const [firstAdded] = additions;
  if (!firstExisting || !firstAdded) throw new Error("Missing bulk fixture row");
  return {
    next: {
      ...next,
      managedPaths,
      instances: [firstExisting, ...additions, ...remainingExisting],
    },
    firstAdded,
  };
}

async function mountHost() {
  const data = await initialData();
  const spies = callbackSpies();
  const screen = await render(GanttPerfHost, { props: { data, ...spies } });
  const container = screen.container as HTMLElement;
  useWideViewport(container);
  await waitForRender(container);

  const chart = container.querySelector<HTMLElement>(".wx-chart");
  const table = container.querySelector<HTMLElement>(".wx-table-container");
  if (!chart || !table) throw new Error("Missing mounted SVAR panes");
  await vi.waitFor(
    () => expect(spies.onGridWidthChange).toHaveBeenLastCalledWith(300),
    { timeout: 2000, interval: 25 }
  );
  clearCallbacks(spies);
  return { data, spies, screen, container, chart, table };
}

async function establishViewState(
  data: GanttData,
  container: HTMLElement,
  chart: HTMLElement
) {
  const alpha = instanceByText(data, "Alpha");
  await selectRow(container, alpha.id);
  expectHorizontalScrollingAvailable(chart);
  const scrollLeft = scrollChartHorizontally(chart);
  expect(scrollLeft).toBeGreaterThan(0);
  const links = linkIds(container);
  expect(links).toHaveLength(1);
  return {
    chart,
    selectedId: alpha.id,
    scrollLeft,
    rows: rowIds(container),
    links,
  };
}

function expectViewStatePreserved(
  container: HTMLElement,
  state: Awaited<ReturnType<typeof establishViewState>>
): void {
  expect(container.querySelector(".wx-chart")).toBe(state.chart);
  expect(rowIds(container)).toEqual(state.rows);
  expect(linkIds(container)).toEqual(state.links);
  expect(
    rowById(container, state.selectedId).classList.contains("wx-selected")
  ).toBe(true);
  expect(state.chart.scrollLeft).toBe(state.scrollLeft);
}

test("an identical refresh preserves rendered data and view state", async () => {
  const { data, spies, screen, container, chart } = await mountHost();
  const alpha = instanceByText(data, "Alpha");
  const primed = withTextProperty(
    data,
    alpha.sourcePath,
    OWNER_COLUMN_ID,
    REFRESHED_OWNER
  );

  await screen.rerender({ data: primed });
  await vi.waitFor(() =>
    expect(cellText(container, alpha.id, OWNER_COLUMN_ID)).toBe(REFRESHED_OWNER)
  );
  const state = await establishViewState(primed, container, chart);
  clearCallbacks(spies);

  await screen.rerender({ data: cloneData(primed) });
  await settleDebouncedBrowserEvents();
  expectViewStatePreserved(container, state);
  expectNoTaskCallbacks(spies);
  expect(spies.onGridWidthChange).not.toHaveBeenCalled();
});

test("a width-only refresh resizes without changing rendered data or view state", async () => {
  const { data, spies, screen, container, chart, table } = await mountHost();
  const state = await establishViewState(data, container, chart);
  clearCallbacks(spies);

  await screen.rerender({ data: { ...cloneData(data), gridWidth: 420 } });
  await vi.waitFor(() =>
    expect(
      Math.abs(table.getBoundingClientRect().width - 420)
    ).toBeLessThanOrEqual(1)
  );
  await vi.waitFor(
    () => expect(spies.onGridWidthChange).toHaveBeenLastCalledWith(420),
    { timeout: 2000, interval: 25 }
  );
  await settleDebouncedBrowserEvents();
  expectViewStatePreserved(container, state);
  expectNoTaskCallbacks(spies);
  expect(spies.onGridWidthChange).toHaveBeenCalledTimes(1);
});

test("a mixed refresh preserves collapsed state while applying the existing selection reset", async () => {
  const { data, spies, screen, container, chart } = await mountHost();
  const alpha = instanceByText(data, "Alpha");
  const beta = instanceByText(data, "Beta");
  const charlie = instanceByText(data, "Charlie");
  const delta = instanceByText(data, "Delta");
  const selected = instanceByText(data, "Foxtrot");
  await collapseRow(container, alpha.id, charlie.id);
  await selectRow(container, selected.id);
  expectHorizontalScrollingAvailable(chart);
  const scrollLeft = scrollChartHorizontally(chart);
  expect(scrollLeft).toBeGreaterThan(0);
  const oldLinkId = data.links[0]?.id;
  if (!oldLinkId) throw new Error("Missing fixture dependency");
  clearCallbacks(spies);

  const next = mixedData(data);
  const expectedOrder = [alpha.id, selected.id, delta.id, ECHO_PATH];
  await screen.rerender({ data: next });

  await vi.waitFor(
    () => {
      expect(rowIds(container)).toEqual(expectedOrder);
      expect(hierarchyIndent(rowById(container, delta.id))).toBeGreaterThan(
        hierarchyIndent(rowById(container, selected.id))
      );
      expect(rowById(container, alpha.id).getAttribute("aria-expanded")).toBe(
        "false"
      );
      expect(rowIds(container)).not.toContain(charlie.id);
      expect(barById(container, beta.id)).toBeNull();
      expect(barById(container, ECHO_PATH)).not.toBeNull();
      expect(
        barById(container, alpha.id)?.querySelector(".og-bar-text")?.textContent
      ).toBe("Alpha refreshed");
      expect(cellText(container, alpha.id, OWNER_COLUMN_ID)).toBe(
        REFRESHED_OWNER
      );
      expect(linkIds(container)).toContain("sync-new-link");
      expect(linkIds(container)).not.toContain(oldLinkId);
    },
    { timeout: 10000, interval: 50 }
  );

  await settleDebouncedBrowserEvents();
  expect(container.querySelector(".wx-chart")).toBe(chart);
  expect(chart.scrollLeft).toBe(scrollLeft);
  expect(
    rowById(container, selected.id).classList.contains("wx-selected")
  ).toBe(false);
  expectNoTaskCallbacks(spies);
  expect(spies.onGridWidthChange).not.toHaveBeenCalled();
});

test("a threshold-crossing structural addition preserves a surviving selection", async () => {
  const { data, spies, screen, container, chart } = await mountHost();
  const selected = instanceByText(data, "Alpha");
  await selectRow(container, selected.id);
  clearCallbacks(spies);
  const { next, firstAdded } = bulkAdditionData(data);

  await screen.rerender({ data: next });

  await vi.waitFor(
    () => expect(barById(container, firstAdded.id)).not.toBeNull(),
    { timeout: 10000, interval: 50 }
  );
  await settleDebouncedBrowserEvents();
  expect(container.querySelector(".wx-chart")).toBe(chart);
  expect(
    rowById(container, selected.id).classList.contains("wx-selected")
  ).toBe(true);
  expectNoTaskCallbacks(spies);
});

test("an external property refresh keeps a later edit attributable to its own column", async () => {
  const { data, spies, screen, container } = await mountHost();
  const alpha = instanceByText(data, "Alpha");
  const refreshed = withTextProperty(
    data,
    alpha.sourcePath,
    OWNER_COLUMN_ID,
    REFRESHED_OWNER
  );

  await screen.rerender({ data: refreshed });
  await vi.waitFor(() =>
    expect(cellText(container, alpha.id, OWNER_COLUMN_ID)).toBe(REFRESHED_OWNER)
  );
  await settleDebouncedBrowserEvents();
  expectNoTaskCallbacks(spies);
  expect(spies.onGridWidthChange).not.toHaveBeenCalled();
  clearCallbacks(spies);

  const input = await openTextEditor(container, alpha.id, PHASE_COLUMN_ID);
  expect(input.value).toBe(INITIAL_PHASE);
  commitTextEditor(input, "In progress");

  await vi.waitFor(() =>
    expect(spies.onMutateProperty).toHaveBeenCalledWith(
      alpha.id,
      PHASE_COLUMN_ID,
      "In progress"
    )
  );
  await settleDebouncedBrowserEvents();
  expect(spies.onMutateProperty).toHaveBeenCalledTimes(1);
  expect(spies.onMutate).not.toHaveBeenCalled();
  expect(spies.onAddDependency).not.toHaveBeenCalled();
  expect(spies.onRemoveDependency).not.toHaveBeenCalled();
  expect(spies.onBarActivate).not.toHaveBeenCalled();
  expect(spies.onGridWidthChange).not.toHaveBeenCalled();
});
