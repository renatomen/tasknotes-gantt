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
import type { AnyBranded, Branded } from '../brandedValue';
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

type AssertTrue<T extends true> = T;

/**
 * Every assertion below routes through `AssertTrue`, so a one-token widening of
 * its constraint to `boolean` — or dropping the constraint — disables all of
 * them at once, silently. This observes that it still rejects a false answer;
 * under either weakening the directive stops being used and the build fails.
 *
 * It does not observe `never`, which satisfies `extends true` and cannot be
 * excluded by a constraint. That is inert only because every operand reaching
 * here is a conditional resolving to `true` or `false`; an assertion written
 * over a naked type parameter would reopen it.
 */
// @ts-expect-error the assertion primitive must reject a false answer
type _AssertTrueRejectsFalse = AssertTrue<false>;

/**
 * Mutual assignability. A one-directional `extends` accepts a wider right-hand
 * side, so it cannot see a name listed there that does not belong.
 *
 * Sound for the key unions it is used on, where mutual assignability is set
 * equality. It is not a general type-equality operator: `any` satisfies it in
 * both directions, and for object types an optional extra property is mutually
 * assignable and so reads as equal.
 */
type Exact<A, B> = IsAny<A> extends true
  ? false
  : IsAny<B> extends true
    ? false
    : [A] extends [B]
      ? [B] extends [A]
        ? true
        : false
      : false;

type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * `T` is exactly `V`, admitting no supertype and no degenerate answer. Every
 * comparison of a derived RESULT in this file goes through it, because the
 * looser phrasings all accept something: `T extends false` accepts `never`, and
 * a single-direction `[false] extends [T]` accepts `boolean`, `unknown` and
 * `any` — each of which a plausibly wrong comparison actually returns.
 *
 * It cannot rescue an assertion whose degenerate value sits in the OPERAND
 * rather than the result: a subset check is vacuously true on an empty left
 * side, whatever wraps its answer. Those two are guarded by a companion
 * assertion each, below, rather than by rerouting them through here.
 */
type IsExactly<T, V> = IsAny<T> extends true
  ? false
  : [V] extends [T]
    ? [T] extends [V]
      ? true
      : false
    : false;

/**
 * `IsExactly` is itself a guard, so it needs the same treatment it exists to
 * apply. These answers are compared against a literal tuple rather than through
 * `IsExactly`, which would be circular: a rewrite that always answers `true`,
 * always `false`, always `never`, or that keeps only one direction — the
 * phrasing this file previously used and deleted — is rejected here, as is one
 * that drops the `IsAny` probe.
 */
type IsExactlyAnswers = [
  IsExactly<false, false>,
  IsExactly<true, false>,
  IsExactly<boolean, false>,
  IsExactly<never, false>,
  IsExactly<unknown, false>,
  IsExactly<true, true>,
  IsExactly<ReturnType<typeof JSON.parse>, false>,
  IsExactly<false, true>,
];
/**
 * ...and none of those answers may be `any`, which the tuple comparison below
 * cannot see: `any` is assignable in both directions, so a rewrite returning it
 * would satisfy the very check written to reject it. Breaking `IsAny` the other
 * way is caught by the tuple instead, since its last element would flip.
 */
type _IsExactlyAnswersAreNotAny = AssertTrue<
  IsAny<IsExactlyAnswers[number]> extends true ? false : true
>;
type _IsExactlyAnswersCorrectly = AssertTrue<
  [IsExactlyAnswers] extends [[true, false, false, false, false, true, false, false]]
    ? [[true, false, false, false, false, true, false, false]] extends [IsExactlyAnswers]
      ? true
      : false
    : false
>;

/**
 * A guard nothing can observe failing is not a guard. Both directions are
 * needed: either alone is satisfied by a comparison written in the opposite
 * single direction, which is the failure being guarded against.
 */
type _ExactRejectsAWiderRightHandSide = AssertTrue<IsExactly<Exact<'a', 'a' | 'b'>, false>>;
type _ExactRejectsAWiderLeftHandSide = AssertTrue<IsExactly<Exact<'a' | 'b', 'a'>, false>>;
/**
 * ...and rejects `any` on either side. Without this, a derived operand that
 * degenerated to `any` would make `Exact` answer `true` and the coverage
 * assertion below would pass with the derivation corrupted.
 */
type _ExactRejectsAnyOnTheLeft = AssertTrue<
  IsExactly<Exact<ReturnType<typeof JSON.parse>, 'a'>, false>
>;
type _ExactRejectsAnyOnTheRight = AssertTrue<
  IsExactly<Exact<'a', ReturnType<typeof JSON.parse>>, false>
>;

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
 * Compile-time proof that every named key is a field of the contract.
 *
 * `Omit` and `Exclude` both accept a key their subject does not declare, so a
 * stale or misspelled entry above would otherwise produce no diagnostic at
 * all: the field it was meant to name would fall silently into the passthrough
 * group and become host-supplied instead of projected.
 */
type _NamedKeysAreContractFields = AssertTrue<
  [NamedContractKeys] extends [keyof GanttData] ? true : false
>;

/** ...and non-empty, since the subset check above is vacuous on an empty union. */
type _NamedKeysAreNonEmpty = AssertTrue<
  IsExactly<[NamedContractKeys] extends [never] ? true : false, false>
>;

/**
 * Every contract field the projection copies without inspecting, carried as one
 * group so a new inert view option costs no edit here — the group's type is
 * derived from `GanttData`, not enumerated.
 *
 * The intersection is deliberate and both halves are load-bearing: `Omit`
 * preserves the real value types, and the mapped half re-declares every key as
 * REQUIRED. A plain `Omit` would keep optionality, letting the host drop an
 * optional field — `gridWidth` is the demonstrated case, and a view that
 * lost it reverts its divider to SVAR's column-sum default.
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

/**
 * Compile-time proof that no two fields of the input are interchangeable, so
 * the branding stays complete without a hand-kept list of pairs: a field added
 * that could be passed where an existing one belongs fails this assertion until
 * it is branded apart.
 */
type _NoInterchangeableInputFields = AssertTrue<
  IsExactly<InterchangeableFieldPairs<RenderContractInput>, never>
>;

/**
 * A derivation that can never find anything proves nothing by staying silent.
 * This model has one field assignable to another, so the derivation must report
 * that pair; without this, breaking it would leave the assertion above green.
 */
interface InterchangeabilityProbe {
  wide: { a: string; b: string };
  narrow: { a: string };
}
type _PairDerivationCanFindAPair = AssertTrue<
  IsExactly<InterchangeableFieldPairs<InterchangeabilityProbe>, ['wide', 'narrow']>
>;

/** The input fields carrying no brand, derived from the input's own types. */
type UnbrandedInputFields = {
  [K in keyof RenderContractInput]: RenderContractInput[K] extends AnyBranded ? never : K;
}[keyof RenderContractInput];

/**
 * Compile-time proof that no input field has quietly lost its brand.
 *
 * Only a few of the projection's inputs are legitimately unbranded: values the
 * host is the rightful producer of, and values whose own type already makes a
 * substitute obvious. Every other field must carry a brand, and removing one
 * moves that field into the derived set above and fails this assertion.
 *
 * A pairwise collision or an `@ts-expect-error` case catches most such
 * removals, but not all: a brand whose underlying type is interchangeable with
 * nothing else and which no fabricate case names would otherwise disappear in
 * silence. Listing the deliberate exceptions rather than the brands is what
 * makes a NEW branded field cost no edit here, while removing a brand cannot
 * pass.
 *
 * The assertion is mutual on purpose. A one-directional `extends` passes
 * whenever the derived set is a SUBSET of the list, so a field that is both
 * branded and named below could lose its brand in silence, and a name that is
 * no key of the input at all could sit here unnoticed.
 */
type _OnlyTheseInputFieldsAreUnbranded = AssertTrue<
  IsExactly<
    Exact<
      UnbrandedInputFields,
      | 'instances'
      | 'gridColumns'
      | 'calendarShading'
      | 'taskNotesFieldType'
      | 'estimateMeaning'
      | 'nonWorkingRendering'
      | 'calendarItems'
      | 'externalCalendars'
      | 'passthrough'
    >,
    true
  >
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
