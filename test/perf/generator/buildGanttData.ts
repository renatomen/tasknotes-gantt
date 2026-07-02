/**
 * Graph → GanttData pipeline (U3, #161 perf plan). Wires the **real**
 * {@link GanttController} (bases-scoped, fake app, in-memory sources from
 * {@link toSources}, companion config) and assembles a {@link GanttData} value
 * the harness host can mount.
 *
 * This is **harness-local assembly, NOT a mirror of `register.ts`'s private
 * `buildGanttData`** — that method reaches into `app.vault` /
 * `app.metadataCache` / `config.get`, which the in-memory harness lacks. Only
 * the perf-load-bearing fields are populated from the controller (instances,
 * links, capabilities, statusColors, height caps); the Obsidian-dependent fields
 * (`propertyValues`, `gridColumns`) are stubbed minimally because they don't
 * affect the row-count / timing metrics the gate measures.
 *
 * @module test/perf/generator/buildGanttData
 */
import type { App } from 'obsidian';
import { GanttController } from '../../../src/controller/GanttController';
import type { FieldMappings } from '../../../src/bases/types/field-mapping';
import { buildGridColumns, gridColumnsKey } from '../../../src/bases/gridColumns';
import type { GanttData } from '../../../src/bases/types/gantt-view-data';
import { DEFAULT_MAX_HEIGHT, GANTT_MIN_HEIGHT } from '../../../src/bases/ganttHeight';
import { toSources } from './toSources';
import type { TaskGraph } from './graph';

/** Options governing the perf controller + assembled data. */
export interface BuildOptions {
  /** Companion expanded-relationships mode (default `show-all` — the #161 repro). */
  mode?: 'inherit' | 'show-all';
  /** Chart-host max-height px cap — governs SVAR's row window (default production 400). */
  maxHeight?: number;
  /** Chart-host min-height px floor (default the absolute ~2-row floor). */
  minHeight?: number;
}

/** A fixed clock so undated-task placeholder placement is deterministic. */
const FIXED_NOW = (): Date => new Date(2026, 0, 1);

/**
 * Construct the bases-scoped perf controller for `graph`. Not yet initialized —
 * call `await controller.init()` (or use {@link buildGanttData}).
 */
export function makePerfController(graph: TaskGraph, options: BuildOptions = {}): GanttController {
  const { baseSource, enrichment } = toSources(graph);
  const mode = options.mode ?? 'show-all';
  return new GanttController({
    app: {} as App,
    sourceStrategy: 'bases-scoped',
    basesInput: () => ({ entries: [], mappings: {} as FieldMappings }),
    companionConfig: () => ({ mode }),
    now: FIXED_NOW,
    deps: {
      createBasesSource: () => baseSource,
      createTaskNotesSource: async () => enrichment,
    },
  });
}

/**
 * Assemble a {@link GanttData} from an initialized controller. Mirrors the field
 * shape the production `register.ts` builds (so `GanttContainer` renders
 * identically), but stubs the Obsidian-dependent `propertyValues`/`gridColumns`.
 */
export async function assembleGanttData(
  controller: GanttController,
  options: BuildOptions = {},
): Promise<GanttData> {
  const arrowMode = 'primary' as const;
  const [instances, links, statusColors] = await Promise.all([
    controller.getInstances(),
    controller.getLinks(arrowMode),
    controller.getStatusColors(),
  ]);
  // Name-only grid columns (the Obsidian-dependent property columns are stubbed —
  // they don't affect row-count / timing metrics).
  const gridColumns = buildGridColumns([], (id) => id, undefined, 'file.name');
  return {
    instances,
    links,
    capabilities: controller.capabilities,
    arrowMode,
    showDateIndicators: true,
    showToolbar: false,
    showUndatedTasks: true,
    showPartialDateTasks: true,
    maxHeight: options.maxHeight ?? DEFAULT_MAX_HEIGHT,
    minHeight: options.minHeight ?? GANTT_MIN_HEIGHT,
    contextOpacity: 0.5,
    statusColors,
    priorityColors: [],
    barColorMode: 'fill',
    barColorSource: 'default',
    barIcon: 'none',
    cascadeMode: 'ask',
    defaultScale: 'month',
    propertyValues: new Map(),
    gridColumns,
    gridColumnsKey: gridColumnsKey(gridColumns),
  };
}

/**
 * Full pipeline: build the controller, initialize it, and assemble the data.
 * Returns both so callers (the perf gate) can read controller-level metrics
 * (e.g. `getInstances()` for the parity check) alongside the mountable data.
 */
export async function buildGanttData(
  graph: TaskGraph,
  options: BuildOptions = {},
): Promise<{ controller: GanttController; data: GanttData }> {
  const controller = makePerfController(graph, options);
  await controller.init();
  const data = await assembleGanttData(controller, options);
  return { controller, data };
}
