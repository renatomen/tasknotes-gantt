/**
 * The Gantt view's render-contract projection: one value in, `GanttData` out.
 *
 * Pure by construction — no `this`, no Obsidian, no Bases config, no clock, no
 * globals — so its measurement point is its own exported signature: construct
 * an input, call, assert the contract. The host keeps every read, in its
 * current order, and passes the values it holds; purity does not make that
 * ordering safe, and a host that built this input before its own fan-out would
 * hand a stale value to a perfectly correct function.
 *
 * The input has two halves, disjoint by construction. **Named** is every
 * contract field this projection computes, reads, or must not let the host
 * fabricate. **Passthrough** is everything else, `Omit`-ed over exactly the
 * named set and derived from `GanttData` itself, so a new inert view option
 * costs no edit here.
 *
 * @module bases/ganttRenderContract
 */

import { isSafeColor } from './barTreatment';
import { resolveGridCellEditors } from './cellEditability';
import { gridColumnsKey, type GridColumn } from './gridColumns';
import { hasNonAuthoredEdgeInstance } from './visualSemantics';
import type { Branded } from '../brandedValue';
import type { CellData } from './cellRender';
import type { TaskNotesFieldMeta } from './cellRenderType';
import type { MarkerInput } from './markerOverlay';
import type { BarFillChannel, BarIconChannel, BarStripChannel } from './viewOptions';
import type { EffectiveFieldMappings, RawFieldMappings } from './types/field-mapping';
import type { GanttData, GanttLegendContext } from './types/gantt-view-data';
import { isProgressReadonly, isTimeEstimateWriteEnabled } from './viewOptions';
import {
  hasRecordedRecurringOccurrences,
  type EstimateMeaning,
  type NonWorkingRendering,
  type RenderInstance,
} from '../controller/InstanceExpansion';
import type {
  ChoiceCatalog,
  EstimateDerivation,
  ManagedTaskPaths,
  PriorityColorCatalog,
  PriorityWritable,
  RefreshGenerationReader,
  RenderLinkSet,
  SourceCapabilities,
  SpanDerivation,
  StatusColorCatalog,
  StatusWritable,
} from '../controller/GanttController';

/**
 * Two host reads whose brands are declared here rather than beside their
 * readers, because those readers live in the view class that consumes this
 * module and a brand declared there could not be named in this input. The cast
 * that mints each one still lives in that single reader.
 */

/** Whether the TaskNotes companion is present with an exposed API. */
export type TaskNotesPresence = Branded<boolean, 'view.taskNotesPresent'>;

/** The per-view "show date-status indicators" toggle. */
export type DateIndicatorToggle = Branded<boolean, 'view.showDateIndicators'>;

/** A TaskNotes custom-field lookup for a bare frontmatter key. */
export type TaskNotesFieldTypeLookup = (propertyKey: string) => TaskNotesFieldMeta | null;

/**
 * The calendar-shading values the projection republishes. The builder that
 * produces them also registers watched paths and associations — side effects
 * this contract never exposes — so it stays host-side and hands its values on.
 */
export interface CalendarShadingContribution {
  css: string;
  notice: string | null;
  markers: MarkerInput[];
  calendarPalette: { value: string; color: string }[];
  calendarBySource: Map<string, string>;
  calendarMarkerColor: string | undefined;
}

/** Contract fields this projection produces. */
type ComputedContractKeys =
  | 'links'
  | 'arrowMode'
  | 'propertyValues'
  | 'cellRenders'
  | 'dateLocale'
  | 'choiceOptions'
  | 'calendarShadingCss'
  | 'calendarNotice'
  | 'calendarMarkers'
  | 'calendarPalette'
  | 'calendarBySource'
  | 'legendContext'
  | 'cellEditors'
  | 'gridColumnsKey';

/** Contract fields this projection inspects on its way to a computed one. */
type ReadContractKeys =
  | 'instances'
  | 'statusColors'
  | 'priorityColors'
  | 'showDateIndicators'
  | 'barFillSource'
  | 'barStripSource'
  | 'barIcon'
  | 'taskNotesPresent'
  | 'gridColumns';

/** Contract fields whose value only a collaborator may answer. */
type GuardedContractKeys =
  | 'capabilities'
  | 'managedPaths'
  | 'refreshGeneration'
  | 'deriveEstimate'
  | 'deriveSpan';

type NamedContractKeys = ComputedContractKeys | ReadContractKeys | GuardedContractKeys;

/**
 * Every contract field the projection copies without inspecting, carried as one
 * group so a new inert view option costs no edit here — the group's type is
 * derived from `GanttData`, not enumerated.
 *
 * The intersection is deliberate and both halves are load-bearing: `Omit`
 * preserves the real value types, and the mapped half re-declares every key as
 * REQUIRED. A plain `Omit` would keep optionality, letting the host drop an
 * optional field — `choiceOptions` is the demonstrated case, and a view that
 * lost it offers pickers that refuse to open.
 *
 * Two same-typed fields INSIDE this group can still be crossed: the group
 * carries the contract's own unbranded types, and closing that would mean
 * branding `GanttData` itself. The host writes those same fields into one
 * literal today with the same exposure, so this neither introduces nor closes
 * it. A field that turns out to be read leaves the group for the named half and
 * is branded there.
 */
export type RenderContractPassthrough = Omit<GanttData, NamedContractKeys> & {
  [K in Exclude<keyof GanttData, NamedContractKeys>]-?: unknown;
};

/** The one value the projection is a function of. */
export interface RenderContractInput {
  instances: RenderInstance[];
  /** The links and the arrow mode they were rewritten for, minted together. */
  linkSet: RenderLinkSet;
  capabilities: SourceCapabilities;
  managedPaths: ManagedTaskPaths;
  statusChoices: ChoiceCatalog<'status'>;
  priorityChoices: ChoiceCatalog<'priority'>;
  statusColors: StatusColorCatalog;
  priorityColors: PriorityColorCatalog;
  gridColumns: GridColumn[];
  /** The cell pass's maps together with the locale they were formatted with. */
  cellData: CellData;
  calendarShading: CalendarShadingContribution;
  /** The user's own mapping choices — the progress and estimate write gates. */
  rawMappings: RawFieldMappings;
  /** The mappings as resolved — which property IS each field. */
  effectiveMappings: EffectiveFieldMappings;
  taskNotesFieldType: TaskNotesFieldTypeLookup;
  statusWritable: StatusWritable;
  priorityWritable: PriorityWritable;
  taskNotesPresent: TaskNotesPresence;
  showDateIndicators: DateIndicatorToggle;
  barFillSource: BarFillChannel;
  barStripSource: BarStripChannel;
  barIconSource: BarIconChannel;
  estimateMeaning: EstimateMeaning;
  nonWorkingRendering: NonWorkingRendering;
  calendarItems: { showRecurring: boolean };
  externalCalendars: { enabled: boolean; representativeColor: string | null };
  refreshGeneration: RefreshGenerationReader;
  deriveEstimate: EstimateDerivation;
  deriveSpan: SpanDerivation;
  passthrough: RenderContractPassthrough;
}

/**
 * Every ordered pair of distinct fields where one is assignable to the other —
 * the miswires the host can make silently.
 *
 * The test is one-directional over every ordered pair, never mutual: the status
 * palette carries every priority-palette field plus `isCompleted`, so it is
 * assignable to a bare priority slot while the reverse is not, and a mutual
 * test passes that pair.
 */
type InterchangeableFieldPairs<T> = {
  [K in keyof T]: {
    [L in Exclude<keyof T, K>]: T[K] extends T[L] ? [K, L] : never;
  }[Exclude<keyof T, K>];
}[keyof T];

type AssertTrue<T extends true> = T;

/**
 * Compile-time proof that no two fields of the input are interchangeable, so
 * the branding stays complete without a hand-kept list of pairs: a field added
 * that could be passed where an existing one belongs fails this assertion until
 * it is branded apart.
 */
type _NoInterchangeableInputFields = AssertTrue<
  [InterchangeableFieldPairs<RenderContractInput>] extends [never] ? true : false
>;

/** The row-independent view facts the presentation-only legend catalogue reads. */
function projectLegendContext(input: RenderContractInput): GanttLegendContext {
  const { instances, calendarShading, externalCalendars } = input;
  const firstSafeColor = (candidates: ReadonlyArray<RenderInstance>): string | null =>
    candidates.map((instance) => instance.calendarItem?.color).find(isSafeColor) ?? null;

  return {
    taskNotesPresent: input.taskNotesPresent,
    barFillSource: input.barFillSource,
    barStripSource: input.barStripSource,
    barIconSource: input.barIconSource,
    statusColors: input.statusColors,
    priorityColors: input.priorityColors,
    calendarPalette: calendarShading.calendarPalette,
    calendarMarkerColor: calendarShading.calendarMarkerColor,
    hasRecordedRecurringOccurrences: hasRecordedRecurringOccurrences(instances),
    showDateIndicators: input.showDateIndicators,
    hasNonAuthoredEdges: hasNonAuthoredEdgeInstance(
      instances.map((instance) => instance.dateStatus),
    ),
    calendarEventColor: firstSafeColor(instances) ?? externalCalendars.representativeColor,
    externalOccurrenceColor:
      firstSafeColor(
        instances.filter((instance) => instance.calendarItem?.family === 'external-event'),
      ) ?? externalCalendars.representativeColor,
    estimateMeaning: input.estimateMeaning,
    nonWorkingRendering: input.nonWorkingRendering,
    calendarItems: { showRecurring: input.calendarItems.showRecurring },
    externalCalendarsEnabled: externalCalendars.enabled,
  };
}

/**
 * Project the render contract the view renders from.
 *
 * The per-column inline editors take their IDENTITY from the resolved mappings
 * (a field the user left unset offers the same editor as an explicitly selected
 * one) and their progress and estimate WRITE GATES from the raw view config,
 * because a resolved estimate property is a read fallback with no write target
 * and gating on it would offer an editor the write path then refuses.
 *
 * @param input - The one value this projection is a function of.
 * @returns The contract, with the passthrough group spread in unchanged.
 */
export function projectRenderContract(input: RenderContractInput): GanttData {
  const { cellData, calendarShading, gridColumns, linkSet } = input;

  const cellEditors = resolveGridCellEditors(gridColumns, {
    taskNotesFieldType: input.taskNotesFieldType,
    mappings: input.effectiveMappings,
    progressWritable: !isProgressReadonly(input.rawMappings),
    estimateWritable: isTimeEstimateWriteEnabled(input.rawMappings),
    statusWritable: input.statusWritable,
    priorityWritable: input.priorityWritable,
  });

  return {
    ...input.passthrough,
    instances: input.instances,
    links: linkSet.links,
    arrowMode: linkSet.mode,
    capabilities: input.capabilities,
    showDateIndicators: input.showDateIndicators,
    statusColors: input.statusColors,
    priorityColors: input.priorityColors,
    choiceOptions: { status: input.statusChoices, priority: input.priorityChoices },
    barFillSource: input.barFillSource,
    barStripSource: input.barStripSource,
    barIcon: input.barIconSource,
    taskNotesPresent: input.taskNotesPresent,
    propertyValues: cellData.propertyValues,
    cellRenders: cellData.cellRenders,
    dateLocale: cellData.dateLocale,
    managedPaths: input.managedPaths,
    cellEditors,
    gridColumns,
    gridColumnsKey: gridColumnsKey(gridColumns),
    calendarShadingCss: calendarShading.css,
    calendarNotice: calendarShading.notice,
    calendarMarkers: calendarShading.markers,
    calendarPalette: calendarShading.calendarPalette,
    calendarBySource: calendarShading.calendarBySource,
    legendContext: projectLegendContext(input),
    deriveEstimate: input.deriveEstimate,
    deriveSpan: input.deriveSpan,
    refreshGeneration: input.refreshGeneration,
  };
}
