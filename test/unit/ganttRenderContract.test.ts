/**
 * Render-contract projection unit tests.
 *
 * The projection is a pure function from one typed value to `GanttData`, so
 * every test here constructs an input, calls, and asserts the contract — no
 * view instance, no factory harness, no access to private members. Before this
 * module existed the only observation of this projection was a WDIO run against
 * real Obsidian.
 *
 * Two guards live at the type level rather than here: the complete-field-set
 * fixture (`Record<keyof GanttData, …>`) fails typecheck when the contract
 * gains a field, and the input's pairwise guard fails typecheck when two of its
 * fields become interchangeable. The miswires no runtime tier can observe are
 * covered by the `@ts-expect-error` cases at the end.
 */

import { describe, it, expect } from '@jest/globals';
import {
  projectRenderContract,
  type RenderContractInput,
  type RenderContractPassthrough,
  type TaskNotesPresence,
  type DateIndicatorToggle,
} from '../../src/bases/ganttRenderContract';
import type { GanttData } from '../../src/bases/types/gantt-view-data';
import type {
  ChoiceCatalog,
  EstimateDerivation,
  ManagedTaskPaths,
  PriorityColorCatalog,
  PriorityWritable,
  RecomputeGeneration,
  RefreshGenerationReader,
  RenderLinkSet,
  SourceCapabilities,
  SpanDerivation,
  StatusColorCatalog,
  StatusWritable,
} from '../../src/controller/GanttController';
import type { RenderInstance } from '../../src/controller/InstanceExpansion';
import { gridColumnsKey, type GridColumn } from '../../src/bases/gridColumns';
import type { CellData } from '../../src/bases/cellRender';
import type { BarFillChannel, BarStripChannel, BarIconChannel } from '../../src/bases/viewOptions';
import type {
  EffectiveFieldMappings,
  RawFieldMappings,
} from '../../src/bases/types/field-mapping';
import type { FieldMappings } from '../../src/datasource';
import type { DerivedEstimate, DerivedGeometry } from '../../src/controller/calendar/derivation';
import type { InferredDragMode } from '../../src/bases/inferredDragGate';
import { RECORDED_RECURRING_STATE_CLASSES } from '../../src/datasource/calendarItems/recurringSource';
import type {
  CalendarItem,
  CalendarItemFamily,
  CalendarOccupancy,
  LocalDay,
} from '../../src/datasource/calendarItems/types';

/**
 * Stand in for a producer's mint. Each branded input is minted by exactly one
 * reader in production; a fixture has no reader to call, and the brand exists to
 * constrain the render HOST — which the `@ts-expect-error` cases cover.
 */
function mint<T>(value: unknown): T {
  return value as T;
}

const EMPTY_MAPPINGS: FieldMappings = {
  textProperty: 'file.name',
  startProperty: '',
  endProperty: '',
  progressProperty: '',
};

function makeInstance(overrides: Partial<RenderInstance> = {}): RenderInstance {
  return {
    id: 'Tasks/A.md',
    sourcePath: 'Tasks/A.md',
    text: 'A',
    start: new Date(2026, 0, 5),
    end: new Date(2026, 0, 9),
    progress: null,
    isVirtual: false,
    isCollapsed: false,
    dateStatus: 'complete',
    estimateMinutes: null,
    status: null,
    priority: null,
    isFetched: false,
    isTopLevelPlacement: true,
    ...overrides,
  };
}

function makeColumn(overrides: Partial<GridColumn> = {}): GridColumn {
  return {
    id: 'text',
    propId: 'file.name',
    header: 'Name',
    width: 240,
    align: 'left',
    isName: true,
    ...overrides,
  };
}

const NAME_COLUMN = makeColumn();

function calendarItemColored(family: CalendarItemFamily, color: string): CalendarItem {
  return {
    id: `${family}:Tasks/A.md`,
    family,
    title: 'An item',
    startDay: '2026-01-05' as LocalDay,
    endDay: '2026-01-09' as LocalDay,
    color,
  };
}

function makePassthrough(
  overrides: Partial<RenderContractPassthrough> = {},
): RenderContractPassthrough {
  return {
    showToolbar: true,
    defaultLegendPosition: 'bottom',
    highlightWeekends: false,
    externalEventsLoading: true,
    defaultDurationDays: 4,
    hideTopLevelSubtasks: true,
    showUndatedTasks: false,
    showPartialDateTasks: false,
    maxHeight: 812,
    minHeight: 137,
    contextOpacity: 0.31,
    progressReadonly: true,
    timeEstimateWriteEnabled: true,
    dateMappingNotice: 'a start mapping fell back',
    cascadeMode: 'never',
    getInferredDragMode: () => 'estimate-only' as InferredDragMode,
    defaultScale: 'month',
    gridWidth: 417,
    ...overrides,
  };
}

const SHADING = {
  css: '.scope { --shade: 1 }',
  notice: 'two calendars displayed',
  markers: [
    { date: '2026-01-07', name: 'Launch', calendarId: 'c1', calendarName: 'Team', color: '#abcdef' },
  ],
  calendarPalette: [{ value: 'Team', color: '#123456' }],
  calendarBySource: new Map([['Tasks/A.md', 'Team']]),
  calendarMarkerColor: '#fedcba',
};

function makeCellData(dateLocale = 'de-DE'): CellData {
  return mint<CellData>({
    cellRenders: new Map([['Tasks/A.md', { 'note.x': { mode: 'text', text: '5.1.2026' } }]]),
    propertyValues: new Map([['Tasks/A.md', { 'note.x': { kind: 'date', value: null } }]]),
    dateLocale,
  });
}

function makeInput(overrides: Partial<RenderContractInput> = {}): RenderContractInput {
  return {
    instances: [makeInstance()],
    linkSet: mint<RenderLinkSet>({ links: [], mode: 'all' }),
    capabilities: mint<SourceCapabilities>({ write: true }),
    managedPaths: mint<ManagedTaskPaths>(new Set(['Tasks/A.md'])),
    statusChoices: mint<ChoiceCatalog<'status'>>([{ value: 'open', label: 'Open' }]),
    priorityChoices: mint<ChoiceCatalog<'priority'>>([{ value: 'high', label: 'High' }]),
    statusColors: mint<StatusColorCatalog>([
      { value: 'open', color: '#001100', isCompleted: false },
    ]),
    priorityColors: mint<PriorityColorCatalog>([{ value: 'high', color: '#002200' }]),
    gridColumns: [NAME_COLUMN],
    cellData: makeCellData(),
    calendarShading: SHADING,
    rawMappings: mint<RawFieldMappings>(EMPTY_MAPPINGS),
    effectiveMappings: mint<EffectiveFieldMappings>(EMPTY_MAPPINGS),
    taskNotesFieldType: () => null,
    statusWritable: mint<StatusWritable>(true),
    priorityWritable: mint<PriorityWritable>(true),
    taskNotesPresent: mint<TaskNotesPresence>(true),
    // Distinguishable from taskNotesPresent on purpose: the two are branded
    // apart on the input, but the projection publishes them into GanttData's
    // unbranded booleans, where only differing values can catch a swap.
    showDateIndicators: mint<DateIndicatorToggle>(false),
    barFillSource: mint<BarFillChannel>('status'),
    barStripSource: mint<BarStripChannel>('calendar'),
    barIconSource: mint<BarIconChannel>('priority'),
    estimateMeaning: 'calendar-days',
    nonWorkingRendering: 'split',
    calendarItems: { showRecurring: true },
    externalCalendars: { enabled: true, representativeColor: '#0f0f0f' },
    refreshGeneration: mint<RefreshGenerationReader>(() => ({ started: 1, delivered: 1 })),
    deriveEstimate: mint<EstimateDerivation>(() => ({}) as DerivedEstimate),
    deriveSpan: mint<SpanDerivation>(() => ({}) as DerivedGeometry),
    passthrough: makePassthrough(),
    ...overrides,
  };
}

/**
 * The four function-valued contract members are pinned by CALL, never by value:
 * a bare method reference typechecks and loses its receiver, so comparing
 * references would pass on a broken one.
 */
const CALL_PINNED = [
  'deriveEstimate',
  'deriveSpan',
  'refreshGeneration',
  'getInferredDragMode',
] as const;
const PINNED_BY_CALL = Symbol('pinned by call');

/**
 * One distinguishing, non-default value per contract field. `Record<keyof
 * GanttData, …>` is the completeness guard: a field added to the contract fails
 * typecheck here until it is covered.
 */
function expectedContract(input: RenderContractInput): Record<keyof GanttData, unknown> {
  return {
    // The passthrough half is taken from the group the projection was given,
    // never restated: a new inert contract field then costs exactly ONE fixture
    // edit (makePassthrough, which the derived type forces), which is the
    // decomposition guardrail's permitted rise of one. Restating it here would
    // make every new option cost two.
    ...input.passthrough,
    instances: input.instances,
    links: [],
    arrowMode: 'all',
    capabilities: input.capabilities,
    showDateIndicators: false,
    statusColors: input.statusColors,
    priorityColors: input.priorityColors,
    choiceOptions: { status: input.statusChoices, priority: input.priorityChoices },
    barFillSource: 'status',
    barStripSource: 'calendar',
    barIcon: 'priority',
    taskNotesPresent: true,
    propertyValues: input.cellData.propertyValues,
    cellRenders: input.cellData.cellRenders,
    dateLocale: 'de-DE',
    managedPaths: input.managedPaths,
    cellEditors: new Map(),
    gridColumns: input.gridColumns,
    gridColumnsKey: gridColumnsKey(input.gridColumns),
    calendarShadingCss: SHADING.css,
    calendarNotice: SHADING.notice,
    calendarMarkers: SHADING.markers,
    calendarPalette: SHADING.calendarPalette,
    calendarBySource: SHADING.calendarBySource,
    legendContext: expect.any(Object),
    deriveEstimate: PINNED_BY_CALL,
    deriveSpan: PINNED_BY_CALL,
    refreshGeneration: PINNED_BY_CALL,
    // Spread in above as the live supplier; marked here so it is pinned by call.
    getInferredDragMode: PINNED_BY_CALL,
  };
}

describe('projectRenderContract: the complete field set', () => {
  it('publishes exactly the contract keys, no more and no fewer', () => {
    const input = makeInput();
    const contract = projectRenderContract(input);
    expect(Object.keys(contract).sort()).toEqual(Object.keys(expectedContract(input)).sort());
  });

  it('publishes the distinguishing value supplied for every non-callable field', () => {
    const input = makeInput();
    const contract = projectRenderContract(input) as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(expectedContract(input))) {
      if (value === PINNED_BY_CALL) continue;
      expect({ [key]: contract[key] }).toEqual({ [key]: value });
    }
  });

  it('marks exactly the callable members for by-call pinning', () => {
    const marked = Object.entries(expectedContract(makeInput()))
      .filter(([, value]) => value === PINNED_BY_CALL)
      .map(([key]) => key);
    expect(marked.sort()).toEqual([...CALL_PINNED].sort());
  });
});

describe('projectRenderContract: function-valued members answer when called', () => {
  it('answers through each derivation member invoked detached from the contract', () => {
    const estimateAnswer = {} as DerivedEstimate;
    const spanAnswer = {} as DerivedGeometry;
    const seen: unknown[] = [];
    const contract = projectRenderContract(
      makeInput({
        deriveEstimate: mint<EstimateDerivation>((path: string, span: unknown) => {
          seen.push(['estimate', path, span]);
          return estimateAnswer;
        }),
        deriveSpan: mint<SpanDerivation>((path: string) => {
          seen.push(['span', path]);
          return spanAnswer;
        }),
      }),
    );

    const { deriveEstimate, deriveSpan } = contract;
    const span = { start: new Date(2026, 0, 1), end: new Date(2026, 0, 3) };
    expect(deriveEstimate?.('Tasks/A.md', span)).toBe(estimateAnswer);
    expect(deriveSpan?.('Tasks/A.md', 'end', new Date(2026, 0, 3), 480)).toBe(spanAnswer);
    expect(seen).toEqual([
      ['estimate', 'Tasks/A.md', span],
      ['span', 'Tasks/A.md'],
    ]);
  });

  it('re-reads the refresh generation on each call rather than answering a captured one', () => {
    let generation: RecomputeGeneration = { started: 1, delivered: 1 };
    const contract = projectRenderContract(
      makeInput({ refreshGeneration: mint<RefreshGenerationReader>(() => generation) }),
    );

    const { refreshGeneration } = contract;
    expect(refreshGeneration?.()).toEqual({ started: 1, delivered: 1 });
    generation = { started: 2, delivered: 2 };
    expect(refreshGeneration?.()).toEqual({ started: 2, delivered: 2 });
  });

  it('keeps the drag-mode supplier live: the same supplier answers the new value without reassembly', () => {
    let mode: InferredDragMode = 'ask';
    const contract = projectRenderContract(
      makeInput({ passthrough: makePassthrough({ getInferredDragMode: () => mode }) }),
    );

    const supplier = contract.getInferredDragMode;
    expect(supplier()).toBe('ask');
    mode = 'estimate-and-dates';
    expect(supplier()).toBe('estimate-and-dates');
  });
});

describe('projectRenderContract: values the host resolved', () => {
  it('publishes the grid width the host supplied, unchanged', () => {
    const contract = projectRenderContract(
      makeInput({ passthrough: makePassthrough({ gridWidth: 923 }) }),
    );
    expect(contract.gridWidth).toBe(923);
  });

  it('derives the grid-columns key from the columns it was given, across differing orders', () => {
    const first = makeColumn({ id: 'note.a', propId: 'note.a', header: 'A', isName: false });
    const second = makeColumn({ id: 'note.b', propId: 'note.b', header: 'B', isName: false });

    const forward = projectRenderContract(makeInput({ gridColumns: [NAME_COLUMN, first, second] }));
    const reversed = projectRenderContract(makeInput({ gridColumns: [NAME_COLUMN, second, first] }));

    expect(forward.gridColumnsKey).toBe(gridColumnsKey([NAME_COLUMN, first, second]));
    expect(reversed.gridColumnsKey).toBe(gridColumnsKey([NAME_COLUMN, second, first]));
    expect(forward.gridColumnsKey).not.toBe(reversed.gridColumnsKey);
  });

  it('publishes the locale the cell pass formatted with, so the pass has one locale', () => {
    const contract = projectRenderContract(makeInput({ cellData: makeCellData('sv-SE') }));
    expect(contract.dateLocale).toBe('sv-SE');
  });

  it('publishes the links and the mode they were rewritten for as the pair it was given', () => {
    const links = [
      {
        id: 'l1',
        source: 'Tasks/A.md',
        target: 'Tasks/B.md',
        type: 'e2s',
        reltype: 'FINISHTOSTART' as const,
        gap: null,
      },
    ];
    const contract = projectRenderContract(
      makeInput({ linkSet: mint<RenderLinkSet>({ links, mode: 'primary' }) }),
    );
    expect(contract.links).toBe(links);
    expect(contract.arrowMode).toBe('primary');
  });
});

describe('projectRenderContract: the inline cell editors', () => {
  const PROGRESS_COLUMN = makeColumn({
    id: 'note.pct',
    propId: 'note.pct',
    header: 'Pct',
    isName: false,
  });
  const ESTIMATE_COLUMN = makeColumn({
    id: 'note.est',
    propId: 'note.est',
    header: 'Est',
    isName: false,
  });
  const START_COLUMN = makeColumn({
    id: 'note.begins',
    propId: 'note.begins',
    header: 'Begins',
    isName: false,
  });
  const WORKSTREAM_COLUMN = makeColumn({
    id: 'note.workstream',
    propId: 'note.workstream',
    header: 'Workstream',
    isName: false,
  });

  /** The resolved set: every field filled in, including one the raw set leaves unset. */
  const EFFECTIVE: FieldMappings = {
    ...EMPTY_MAPPINGS,
    startProperty: 'note.begins',
    progressProperty: 'note.pct',
    timeEstimateProperty: 'note.est',
  };

  /**
   * The raw view config the write gates read. Its progress property is unset and
   * its estimate mode is `dont-update`, so both refuse a write where the
   * resolved set above names a property for each — deriving either gate from the
   * resolved set would open an editor over no write target.
   */
  const RAW_REFUSING: FieldMappings = {
    ...EMPTY_MAPPINGS,
    progressMode: 'property',
    timeEstimateMode: 'dont-update',
  };
  const RAW_ALLOWING: FieldMappings = {
    ...EMPTY_MAPPINGS,
    progressProperty: 'note.pct',
    progressMode: 'property',
    timeEstimateProperty: 'note.est',
    timeEstimateMode: 'property',
  };

  function editorsFor(raw: FieldMappings) {
    return projectRenderContract(
      makeInput({
        gridColumns: [NAME_COLUMN, START_COLUMN, PROGRESS_COLUMN, ESTIMATE_COLUMN],
        rawMappings: mint<RawFieldMappings>(raw),
        effectiveMappings: mint<EffectiveFieldMappings>(EFFECTIVE),
      }),
    ).cellEditors;
  }

  it('takes each column editor identity from the resolved mappings', () => {
    expect(editorsFor(RAW_REFUSING).get('note.begins')).toEqual({ kind: 'date', dateRole: 'start' });
  });

  it('takes the progress and estimate write gates from the raw view config', () => {
    const refused = editorsFor(RAW_REFUSING);
    expect(refused.has('note.pct')).toBe(false);
    expect(refused.has('note.est')).toBe(false);

    const allowed = editorsFor(RAW_ALLOWING);
    expect(allowed.get('note.pct')).toEqual({ kind: 'number' });
    expect(allowed.get('note.est')).toEqual({ kind: 'number' });
  });

  it('resolves a TaskNotes custom field through the field-type lookup, not the render-type function', () => {
    const contract = projectRenderContract(
      makeInput({
        gridColumns: [NAME_COLUMN, WORKSTREAM_COLUMN],
        taskNotesFieldType: (key) =>
          key === 'workstream' ? { type: 'list', autosuggestFilter: { folder: 'Streams' } } : null,
      }),
    );
    // A list field with an autosuggest scope resolves to a filtered suggest
    // editor. The render-type function answers a CellRenderType and could not
    // produce this descriptor at all, so a swap of the two lookups shows here.
    expect(contract.cellEditors.get('note.workstream')).toEqual({
      kind: 'suggest',
      autosuggestFilter: { folder: 'Streams' },
      isList: true,
    });
  });

  it('gates the status and priority pickers on the writability answers it was given', () => {
    const mappings: FieldMappings = {
      ...EMPTY_MAPPINGS,
      statusProperty: 'note.s',
      priorityProperty: 'note.p',
    };
    const columns = [
      NAME_COLUMN,
      makeColumn({ id: 'note.s', propId: 'note.s', header: 'S', isName: false }),
      makeColumn({ id: 'note.p', propId: 'note.p', header: 'P', isName: false }),
    ];
    const editors = (statusWritable: boolean, priorityWritable: boolean) =>
      projectRenderContract(
        makeInput({
          gridColumns: columns,
          effectiveMappings: mint<EffectiveFieldMappings>(mappings),
          statusWritable: mint<StatusWritable>(statusWritable),
          priorityWritable: mint<PriorityWritable>(priorityWritable),
        }),
      ).cellEditors;

    expect(editors(true, false).get('note.s')).toEqual({ kind: 'choice-status' });
    expect(editors(true, false).has('note.p')).toBe(false);
    expect(editors(false, true).has('note.s')).toBe(false);
    expect(editors(false, true).get('note.p')).toEqual({ kind: 'choice-priority' });
  });
});

describe('projectRenderContract: the legend context', () => {
  it('carries the view facts the legend catalogue decides against', () => {
    const input = makeInput();
    const legend = projectRenderContract(input).legendContext;
    expect(legend).toMatchObject({
      taskNotesPresent: true,
      barFillSource: 'status',
      barStripSource: 'calendar',
      barIconSource: 'priority',
      statusColors: input.statusColors,
      priorityColors: input.priorityColors,
      calendarPalette: SHADING.calendarPalette,
      calendarMarkerColor: SHADING.calendarMarkerColor,
      showDateIndicators: false,
      estimateMeaning: 'calendar-days',
      nonWorkingRendering: 'split',
      calendarItems: { showRecurring: true },
      externalCalendarsEnabled: true,
    });
  });

  it('reports a recorded recurring occurrence only when a rendered instance carries one', () => {
    // Taken from the source list rather than restated, so a renamed state fails
    // here instead of quietly making this scenario unreachable.
    const recorded = RECORDED_RECURRING_STATE_CLASSES[0];
    const occupiedOn = (stateClass: string): CalendarOccupancy => ({
      family: 'recurring-instance',
      itemId: 'recurring:Tasks/A.md',
      day: '2026-01-07' as LocalDay,
      minutes: null,
      stateClass,
    });
    const withRecorded = makeInstance({ occupancy: [occupiedOn(recorded)] });
    const withVirtual = makeInstance({ occupancy: [occupiedOn('projected')] });

    expect(
      projectRenderContract(makeInput({ instances: [withRecorded] })).legendContext
        ?.hasRecordedRecurringOccurrences,
    ).toBe(true);
    expect(
      projectRenderContract(makeInput({ instances: [withVirtual] })).legendContext
        ?.hasRecordedRecurringOccurrences,
    ).toBe(false);
    expect(projectRenderContract(makeInput()).legendContext?.hasRecordedRecurringOccurrences).toBe(
      false,
    );
  });

  it('reports a torn edge only when a rendered instance carries a non-authored date status', () => {
    expect(
      projectRenderContract(makeInput({ instances: [makeInstance({ dateStatus: 'placeholder' })] }))
        .legendContext?.hasNonAuthoredEdges,
    ).toBe(true);
    expect(projectRenderContract(makeInput()).legendContext?.hasNonAuthoredEdges).toBe(false);
  });

  it('prefers a visible calendar-item colour over the external feed representative colour', () => {
    const instances = [
      makeInstance({ calendarItem: calendarItemColored('timeblock', '#aa0000') }),
    ];
    expect(projectRenderContract(makeInput({ instances })).legendContext?.calendarEventColor).toBe(
      '#aa0000',
    );
  });

  it('falls back to the external feed representative colour when no instance offers a safe one', () => {
    const instances = [
      makeInstance({ calendarItem: calendarItemColored('timeblock', 'javascript:alert(1)') }),
    ];
    expect(projectRenderContract(makeInput({ instances })).legendContext?.calendarEventColor).toBe(
      '#0f0f0f',
    );
  });

  it('scans the external-occurrence colour over the external-event family only', () => {
    const instances = [
      makeInstance({ id: 'a', calendarItem: calendarItemColored('timeblock', '#aa0000') }),
      makeInstance({ id: 'b', calendarItem: calendarItemColored('external-event', '#00bb00') }),
    ];
    const legend = projectRenderContract(makeInput({ instances })).legendContext;
    expect(legend?.calendarEventColor).toBe('#aa0000');
    expect(legend?.externalOccurrenceColor).toBe('#00bb00');
  });

  it('takes the first safe colour in instance order, skipping unsafe ones before it', () => {
    const instances = [
      makeInstance({ id: 'a', calendarItem: calendarItemColored('external-event', 'inherit') }),
      makeInstance({ id: 'b', calendarItem: calendarItemColored('external-event', '#00bb00') }),
      makeInstance({ id: 'c', calendarItem: calendarItemColored('external-event', '#00cc00') }),
    ];
    expect(
      projectRenderContract(makeInput({ instances })).legendContext?.externalOccurrenceColor,
    ).toBe('#00bb00');
  });
});

/**
 * The miswires no runtime tier can observe, rejected at compile time.
 *
 * These are declarations rather than a Jest case, deliberately. The only
 * runtime assertion available over them is that a list of object literals is
 * non-null — true by construction — so a green Jest result would claim a guard
 * Jest cannot see. `npm run typecheck` is what enforces them: an
 * `@ts-expect-error` that stops matching becomes an unused-directive error, so
 * dropping a brand fails the build instead of passing quietly.
 *
 * Each directive sits directly above the offending property, never above the
 * literal, because it suppresses the NEXT line only.
 */
const miswire = makeInput();

// Interchangeable siblings: the same underlying type from distinct producers.
const _crossedColors: RenderContractInput = {
  ...miswire,
  // @ts-expect-error the status palette is assignable to a bare priority slot (StatusColor carries every PriorityColor field plus isCompleted)
  priorityColors: miswire.statusColors,
};
// The crossing above is one-directional: PriorityColor lacks `isCompleted`, so the
// reverse assignment is not the same test, and the pairwise guard reports only the
// ordered pair. This covers the status slot's own fabrication.
const _fabricatedStatusColors: RenderContractInput = {
  ...miswire,
  // @ts-expect-error an empty palette resolves every status to the default colour
  statusColors: [],
};
const _crossedChoices: RenderContractInput = {
  ...miswire,
  // @ts-expect-error the two choice catalogs come from one role-parameterized reader
  priorityChoices: miswire.statusChoices,
};
const _crossedChannels: RenderContractInput = {
  ...miswire,
  // @ts-expect-error the bar-icon source is a strict subset of the fill/strip union
  barFillSource: miswire.barIconSource,
};
const _crossedFillStrip: RenderContractInput = {
  ...miswire,
  // @ts-expect-error the fill and strip channels are the same union
  barStripSource: miswire.barFillSource,
};
const _crossedMappings: RenderContractInput = {
  ...miswire,
  // @ts-expect-error the resolved mappings decide identity, the raw set decides the write gates
  rawMappings: miswire.effectiveMappings,
};
const _crossedFlags: RenderContractInput = {
  ...miswire,
  // @ts-expect-error TaskNotes presence and the date-indicator toggle are both plain booleans
  showDateIndicators: miswire.taskNotesPresent,
};
const _crossedWritability: RenderContractInput = {
  ...miswire,
  // @ts-expect-error the two writability answers are both plain booleans
  statusWritable: miswire.priorityWritable,
};

// Values only a collaborator can answer: uniquely typed, so no pairwise guard
// can see them, and a plausible stand-in compiles without a brand.
const _fakeCapabilities: RenderContractInput = {
  ...miswire,
  // @ts-expect-error a fabricated read-only capability silently seeds SVAR read-only
  capabilities: { write: false },
};
const _fakePaths: RenderContractInput = {
  ...miswire,
  // @ts-expect-error an empty managed-path set marks every row non-editable
  managedPaths: new Set<string>(),
};
const _fakeGeneration: RenderContractInput = {
  ...miswire,
  // @ts-expect-error a bare method reference loses its receiver and throws after a drag write
  refreshGeneration: () => ({ started: 0, delivered: 0 }),
};
const _fakeDerivation: RenderContractInput = {
  ...miswire,
  // @ts-expect-error the span derivation answers from the controller's blocking facts
  deriveSpan: () => ({}) as DerivedGeometry,
};
const _fakeEstimateDerivation: RenderContractInput = {
  ...miswire,
  // @ts-expect-error the estimate derivation answers from the controller's calendar facts
  deriveEstimate: () => ({}) as DerivedEstimate,
};
const _fakeLinkSet: RenderContractInput = {
  ...miswire,
  // @ts-expect-error the host cannot assemble the links/mode pair itself
  linkSet: { links: [], mode: 'primary' },
};
const _fakeCellData: RenderContractInput = {
  ...miswire,
  // @ts-expect-error the cell data carries the locale its own pass formatted with
  cellData: { cellRenders: new Map(), propertyValues: new Map(), dateLocale: 'en-GB' },
};
