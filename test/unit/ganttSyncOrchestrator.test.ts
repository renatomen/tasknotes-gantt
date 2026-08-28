/**
 * Diff-sync orchestrator seam: ephemeral-sort coordination cluster, reseed
 * family, and the sync orchestration (`syncToGantt` with its plan/apply
 * branches).
 *
 * Every scenario drives the factory through a spy access object (counting
 * getters, recording setters) and a recording fake api, so guard behavior,
 * clear-vs-replay ordering, echo tagging, the `syncing` bracket, branch-scoped
 * accessor reads, and accessor liveness are all provable without Obsidian or a
 * mounted component. The counting getters double as the read census (KTD-style
 * dependency calipers): what the module reads inside one synchronous call frame
 * is exactly what the view's sync $effect depends on.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  createGanttSyncOrchestrator,
  type GanttSyncSource,
  type SyncOrchestratorAccess,
  type SyncOrchestratorApi,
  type SyncOrchestratorInit,
} from '../../src/bases/ganttSyncOrchestrator';
import type { BaseSortEntry, SvarTask } from '../../src/bases/ganttSync';
import {
  applyEchoToBaseline,
  type AppliedGanttSyncState,
} from '../../src/bases/ganttSyncCoordinator';
import type { GridColumn } from '../../src/bases/gridColumns';
import type { RenderInstance, RenderLink } from '../../src/controller/InstanceExpansion';
import type { EphemeralSort } from '../../src/bases/sortCycle';
import {
  makeCalendarItemId,
  type CalendarItemFamily,
  type CalendarOccupancy,
} from '../../src/datasource/calendarItems';
import type { TypedValue } from '../../src/bases/propertyValues';

const ECHO = 'og-self';
const INITIAL_ORDER_KEY = 'initial-order';

/** Minimal RenderInstance factory with sane defaults (`sourcePath` = `<id>.md`). */
function inst(id: string, over: Partial<RenderInstance> = {}): RenderInstance {
  return {
    id,
    sourcePath: `${id}.md`,
    text: id,
    start: new Date(2026, 0, 1),
    end: new Date(2026, 0, 2),
    progress: 0,
    isVirtual: false,
    isCollapsed: false,
    dateStatus: 'complete',
    estimateMinutes: null,
    status: null,
    priority: null,
    isFetched: false,
    isTopLevelPlacement: false,
    ...over,
  };
}

function link(id: string, source: string, target: string): RenderLink {
  return {
    id,
    source,
    target,
    type: 'e2s',
    reltype: 'FINISHTOSTART',
    gap: null,
  };
}

/**
 * One entry per observable emission, in call order: SVAR execs, the internal
 * `_sort` reset, every `ephemeralSort` setter write, seed writes, and the two
 * view-closure deps (grid width, display filters) share a single log so
 * ordering contracts ("null the override before the restore replays", "the
 * reassert timer fires before the display-filter timer") are assertable
 * directly. `syncingDuring` snapshots the backing flag at the moment the
 * emission landed.
 */
interface LoggedEvent {
  kind:
    | 'exec'
    | 'set-state'
    | 'set-ephemeral-sort'
    | 'set-columns'
    | 'set-initial-tasks'
    | 'set-initial-links'
    | 'apply-persisted-grid-width'
    | 'apply-display-filters';
  apiLabel?: string;
  action?: string;
  payload?: Record<string, unknown>;
  state?: Record<string, unknown>;
  value?: EphemeralSort | null;
  columnsValue?: TestColumn[];
  tasksValue?: SvarTask[];
  linksValue?: RenderLink[];
  syncingDuring?: boolean;
}

/** The opaque column shape crossing the generic seam in these tests. */
interface TestColumn {
  id: string;
  builtFrom: string;
}

interface Backing {
  syncing: boolean;
  ephemeralSort: EphemeralSort | null;
  api: SyncOrchestratorApi | undefined;
  columns: TestColumn[];
  initialTasks: SvarTask[];
  initialLinks: RenderLink[];
  collapsedIds: Set<string>;
  /**
   * Component-side teardown state. Deliberately NOT exposed through the access
   * bridge: the module's raw scheduling carries no destroy gate, so the
   * teardown test pins that a pending timer ignores this flag entirely.
   */
  destroyed: boolean;
}

interface FixtureOptions {
  ephemeralSort?: EphemeralSort | null;
  /** Api starts unbound (the pre-init window). */
  withoutApi?: boolean;
  /** Throw synchronously from the exec whose ordinal (1-based) matches. */
  throwOnExecNumber?: number;
  /**
   * Every exec returns a rejected Promise (the real SVAR failure shape: exec
   * is async, so a failing action rejects rather than throwing). Rejections
   * are pre-swallowed inside the fake so jest sees no unhandled rejection.
   */
  execsReject?: boolean;
  /** Live editor-attach set the `cellEditColumnIds` dep supplies. */
  cellEditColumnIds?: string[];
  /** What the `getSort` supplier returns (the Base toolbar sort). */
  baseSort?: BaseSortEntry[];
  /** What the `currentData` supplier returns (a restore replays this live data). */
  currentData?: GanttSyncSource;
  /** Session-hidden source families the `hiddenSources` supplier returns. */
  hiddenSources?: ReadonlySet<CalendarItemFamily>;
  /** The view's collapsed-instance set behind the access getter. */
  collapsedIds?: Set<string>;
  /** Overrides for the factory's immutable mount-time init argument. */
  init?: Partial<SyncOrchestratorInit>;
}

function gridColumn(id: string): GridColumn {
  return { id, propId: id, header: id, width: 140, align: 'left', isName: id === 'text' };
}

/** The GanttData slice the sync orchestration reads; defaults match the fixture's init. */
function syncSource(overrides: Partial<GanttSyncSource> = {}): GanttSyncSource {
  return {
    instances: [inst('a'), inst('b'), inst('c')],
    links: [],
    statusColors: [],
    priorityColors: [],
    barFillSource: 'default',
    barStripSource: 'none',
    barIcon: 'none',
    showDateIndicators: true,
    arrowMode: 'primary',
    hideTopLevelSubtasks: false,
    propertyValues: new Map<string, Record<string, TypedValue>>(),
    cellRenders: new Map(),
    managedPaths: new Set<string>(),
    gridColumnsKey: 'cols-v1',
    gridWidth: 400,
    gridColumns: [gridColumn('text'), gridColumn('status')],
    ...overrides,
  };
}

function makeFixture(options: FixtureOptions = {}) {
  const events: LoggedEvent[] = [];
  const backing: Backing = {
    syncing: false,
    ephemeralSort: options.ephemeralSort ?? null,
    api: undefined,
    columns: [],
    initialTasks: [],
    initialLinks: [],
    collapsedIds: options.collapsedIds ?? new Set<string>(),
    destroyed: false,
  };
  const reads = {
    syncing: 0,
    ephemeralSort: 0,
    api: 0,
    columns: 0,
    initialTasks: 0,
    initialLinks: 0,
    collapsedIds: 0,
  };
  const syncingWrites: boolean[] = [];
  let armedThrow = options.throwOnExecNumber ?? 0;
  let execCount = 0;

  const makeApi = (label: string): SyncOrchestratorApi => ({
    exec(action: string, payload: object): unknown {
      execCount += 1;
      events.push({
        kind: 'exec',
        apiLabel: label,
        action,
        payload: payload as Record<string, unknown>,
        syncingDuring: backing.syncing,
      });
      if (armedThrow > 0 && execCount === armedThrow) {
        throw new Error(`exec ${execCount} refused`);
      }
      if (options.execsReject) {
        const rejection = Promise.reject(new Error(`exec ${execCount} rejected`));
        rejection.catch(() => {});
        return rejection;
      }
      return Promise.resolve();
    },
    getStores: () => ({
      data: {
        setState: (state: object): void => {
          events.push({
            kind: 'set-state',
            apiLabel: label,
            state: state as Record<string, unknown>,
            syncingDuring: backing.syncing,
          });
        },
      },
    }),
  });

  if (!options.withoutApi) backing.api = makeApi('primary');

  const access: SyncOrchestratorAccess<TestColumn> = {
    get syncing() {
      reads.syncing += 1;
      return backing.syncing;
    },
    set syncing(value) {
      syncingWrites.push(value);
      backing.syncing = value;
    },
    get ephemeralSort() {
      reads.ephemeralSort += 1;
      return backing.ephemeralSort;
    },
    set ephemeralSort(value) {
      events.push({ kind: 'set-ephemeral-sort', value });
      backing.ephemeralSort = value;
    },
    get api() {
      reads.api += 1;
      return backing.api;
    },
    get columns() {
      reads.columns += 1;
      return backing.columns;
    },
    set columns(value) {
      events.push({ kind: 'set-columns', columnsValue: value, syncingDuring: backing.syncing });
      backing.columns = value;
    },
    get initialTasks() {
      reads.initialTasks += 1;
      return backing.initialTasks;
    },
    set initialTasks(value) {
      events.push({ kind: 'set-initial-tasks', tasksValue: value, syncingDuring: backing.syncing });
      backing.initialTasks = value;
    },
    get initialLinks() {
      reads.initialLinks += 1;
      return backing.initialLinks;
    },
    set initialLinks(value) {
      events.push({ kind: 'set-initial-links', linksValue: value, syncingDuring: backing.syncing });
      backing.initialLinks = value;
    },
    get collapsedIds() {
      reads.collapsedIds += 1;
      return backing.collapsedIds;
    },
  };

  const appliedSyncState: AppliedGanttSyncState = {
    tasks: new Map<string, SvarTask>(),
    links: new Map(),
    orderKey: INITIAL_ORDER_KEY,
    baseSortKey: 'initial-base-sort',
  };
  let liveCurrentData: GanttSyncSource = options.currentData ?? syncSource();
  const currentData = jest.fn(() => liveCurrentData);
  const buildSvarColumns = jest.fn(
    (descriptors: ReadonlyArray<GridColumn>): TestColumn[] =>
      descriptors.map((c) => ({ id: c.id, builtFrom: c.propId })),
  );
  const applyPersistedGridWidth = jest.fn((): void => {
    events.push({ kind: 'apply-persisted-grid-width', syncingDuring: backing.syncing });
  });
  const applyDisplayFilters = jest.fn((): void => {
    events.push({ kind: 'apply-display-filters', syncingDuring: backing.syncing });
  });
  let liveCellEditColumnIds: string[] = options.cellEditColumnIds ?? [];
  const cellEditColumnIds = jest.fn(() => liveCellEditColumnIds);
  let liveHiddenSources = options.hiddenSources;
  const hiddenSources = jest.fn(() => liveHiddenSources);
  let liveBaseSort = options.baseSort;
  const getSort = jest.fn(() => liveBaseSort);
  const init: SyncOrchestratorInit = {
    columnsKey: 'cols-v1',
    editorAttachKey: (options.cellEditColumnIds ?? []).join('|'),
    gridWidth: 400,
    ...options.init,
  };
  const orchestrator = createGanttSyncOrchestrator(
    access,
    {
      echoSource: ECHO,
      currentData,
      appliedSyncState,
      buildSvarColumns,
      applyPersistedGridWidth,
      applyDisplayFilters,
      cellEditColumnIds,
      hiddenSources,
      getSort,
    },
    init,
  );

  const disarmThrow = (): void => {
    armedThrow = 0;
  };
  const setCellEditColumnIds = (ids: string[]): void => {
    liveCellEditColumnIds = ids;
  };
  const setHiddenSources = (value: ReadonlySet<CalendarItemFamily> | undefined): void => {
    liveHiddenSources = value;
  };
  const setBaseSort = (value: BaseSortEntry[] | undefined): void => {
    liveBaseSort = value;
  };
  const setCurrentData = (value: GanttSyncSource): void => {
    liveCurrentData = value;
  };
  /** Reset every log, counter, and mock between a baseline pass and the scenario. */
  const clearLog = (): void => {
    events.length = 0;
    syncingWrites.length = 0;
    for (const key of Object.keys(reads) as Array<keyof typeof reads>) reads[key] = 0;
    currentData.mockClear();
    buildSvarColumns.mockClear();
    applyPersistedGridWidth.mockClear();
    applyDisplayFilters.mockClear();
    cellEditColumnIds.mockClear();
    hiddenSources.mockClear();
    getSort.mockClear();
  };
  return {
    orchestrator,
    events,
    backing,
    reads,
    syncingWrites,
    appliedSyncState,
    currentData,
    buildSvarColumns,
    applyPersistedGridWidth,
    applyDisplayFilters,
    hiddenSources,
    makeApi,
    disarmThrow,
    setCellEditColumnIds,
    setHiddenSources,
    setBaseSort,
    setCurrentData,
    clearLog,
    execEvents: () => events.filter((e) => e.kind === 'exec'),
    gridWidthAsserts: () => events.filter((e) => e.kind === 'apply-persisted-grid-width'),
  };
}

const activeSort: EphemeralSort = { column: 'text', direction: 'asc' };

describe('restoreBaseOrder', () => {
  it('clears SVAR _sort first, then replays echo-tagged Base-order moves and advances the order key', () => {
    const f = makeFixture();

    f.orchestrator.restoreBaseOrder();

    expect(f.events[0]).toMatchObject({ kind: 'set-state', state: { _sort: null } });
    expect(f.execEvents().map((e) => ({ action: e.action, payload: e.payload }))).toEqual([
      {
        action: 'move-task',
        payload: { id: 'b', target: 'a', mode: 'after', eventSource: ECHO },
      },
      {
        action: 'move-task',
        payload: { id: 'c', target: 'b', mode: 'after', eventSource: ECHO },
      },
    ]);
    expect(f.appliedSyncState.orderKey).toBe('>a|>b|>c');
  });

  it('holds syncing true across the clear and every replayed move, releasing it after', () => {
    const f = makeFixture();

    f.orchestrator.restoreBaseOrder();

    expect(f.events.every((e) => e.kind === 'set-ephemeral-sort' || e.syncingDuring === true)).toBe(
      true,
    );
    expect(f.syncingWrites).toEqual([true, false]);
    expect(f.backing.syncing).toBe(false);
  });

  it('returns early — no syncing raise, no data read — when no api is bound', () => {
    const f = makeFixture({ withoutApi: true });

    f.orchestrator.restoreBaseOrder();

    expect(f.events).toEqual([]);
    expect(f.syncingWrites).toEqual([]);
    expect(f.currentData).not.toHaveBeenCalled();
    expect(f.appliedSyncState.orderKey).toBe(INITIAL_ORDER_KEY);
  });

  it('never reads ephemeralSort during a replay — the override belongs to its callers', () => {
    const f = makeFixture();

    f.orchestrator.restoreBaseOrder();

    expect(f.execEvents().length).toBeGreaterThanOrEqual(1);
    expect(f.reads.ephemeralSort).toBe(0);
  });

  it('replays the live current data read at call time, not a wiring-time capture', () => {
    const f = makeFixture();
    f.orchestrator.restoreBaseOrder();
    f.setCurrentData(syncSource({ instances: [inst('x'), inst('y')] }));

    f.orchestrator.restoreBaseOrder();

    const lastMove = f.execEvents().at(-1);
    expect(lastMove).toMatchObject({ action: 'move-task', payload: { id: 'y', target: 'x' } });
    expect(f.appliedSyncState.orderKey).toBe('>x|>y');
  });

  it('leaves the order key stale but still releases syncing when a move throws synchronously mid-replay', () => {
    const f = makeFixture({ throwOnExecNumber: 2 });

    f.orchestrator.restoreBaseOrder();

    expect(f.appliedSyncState.orderKey).toBe(INITIAL_ORDER_KEY);
    expect(f.syncingWrites).toEqual([true, false]);
    expect(f.backing.syncing).toBe(false);
  });

  it('replays the full reorder on a later call over unchanged data after a synchronous-throw replay failure', () => {
    const f = makeFixture({ throwOnExecNumber: 2 });
    f.orchestrator.restoreBaseOrder();
    const execsBefore = f.execEvents().length;
    f.disarmThrow();

    f.orchestrator.restoreBaseOrder();

    expect(f.execEvents().length - execsBefore).toBe(2);
    expect(f.appliedSyncState.orderKey).toBe('>a|>b|>c');
  });

  it('treats rejected exec promises as outside the catch-path recovery contract: every move attempted, order key advanced, syncing released', () => {
    const f = makeFixture({ execsReject: true });

    f.orchestrator.restoreBaseOrder();

    expect(f.execEvents().map((e) => e.action)).toEqual(['move-task', 'move-task']);
    expect(f.appliedSyncState.orderKey).toBe('>a|>b|>c');
    expect(f.syncingWrites).toEqual([true, false]);
    expect(f.backing.syncing).toBe(false);
  });
});

describe('clearEphemeralSort', () => {
  it('nulls ephemeralSort through the setter before the restore emits anything', () => {
    const f = makeFixture({ ephemeralSort: activeSort });

    f.orchestrator.clearEphemeralSort();

    expect(f.events[0]).toEqual({ kind: 'set-ephemeral-sort', value: null });
    expect(f.backing.ephemeralSort).toBeNull();
    expect(f.events[1]).toMatchObject({ kind: 'set-state', state: { _sort: null } });
    expect(f.execEvents().length).toBeGreaterThan(0);
  });
});

describe('clearEphemeralSortForBaseChange', () => {
  it('nulls the override via the setter and clears _sort, without replaying any moves', () => {
    const f = makeFixture({ ephemeralSort: activeSort });

    f.orchestrator.clearEphemeralSortForBaseChange(true);

    expect(f.events).toEqual([
      { kind: 'set-ephemeral-sort', value: null },
      expect.objectContaining({ kind: 'set-state', state: { _sort: null } }),
    ]);
    expect(f.backing.ephemeralSort).toBeNull();
    expect(f.execEvents()).toEqual([]);
  });

  it('does nothing when the base sort is unchanged', () => {
    const f = makeFixture({ ephemeralSort: activeSort });

    f.orchestrator.clearEphemeralSortForBaseChange(false);

    expect(f.events).toEqual([]);
    expect(f.backing.ephemeralSort).toBe(activeSort);
  });

  it('does nothing when no ephemeral sort is active', () => {
    const f = makeFixture({ ephemeralSort: null });

    f.orchestrator.clearEphemeralSortForBaseChange(true);

    expect(f.events).toEqual([]);
  });

  it('unchanged base sort: reads the override, never the api, and never calls the override setter', () => {
    const f = makeFixture({ ephemeralSort: activeSort });

    f.orchestrator.clearEphemeralSortForBaseChange(false);

    expect(f.reads.ephemeralSort).toBeGreaterThanOrEqual(1);
    expect(f.reads.api).toBe(0);
    expect(f.events.filter((e) => e.kind === 'set-ephemeral-sort')).toEqual([]);
  });
});

describe('reassertEphemeralSort', () => {
  it('execs one echo-tagged sort-tasks carrying the active column and direction', () => {
    const f = makeFixture({ ephemeralSort: { column: 'priority', direction: 'desc' } });

    f.orchestrator.reassertEphemeralSort();

    expect(f.events).toEqual([
      expect.objectContaining({
        kind: 'exec',
        action: 'sort-tasks',
        payload: { key: 'priority', order: 'desc', eventSource: ECHO },
      }),
    ]);
  });

  it('is a no-op when no ephemeral sort is active', () => {
    const f = makeFixture({ ephemeralSort: null });

    f.orchestrator.reassertEphemeralSort();

    expect(f.events).toEqual([]);
  });

  it('never writes syncing on a standalone call — callers own the bracket', () => {
    const f = makeFixture({ ephemeralSort: activeSort });

    f.orchestrator.reassertEphemeralSort();

    expect(f.execEvents()).toHaveLength(1);
    expect(f.syncingWrites).toEqual([]);
  });

  it('guards on the override first: the no-override short-circuit never reads the api', () => {
    const f = makeFixture({ ephemeralSort: null });

    f.orchestrator.reassertEphemeralSort();

    expect(f.reads.ephemeralSort).toBeGreaterThanOrEqual(1);
    expect(f.reads.api).toBe(0);
  });

  it('is a no-op when the api is not bound', () => {
    const f = makeFixture({ ephemeralSort: activeSort, withoutApi: true });

    expect(() => f.orchestrator.reassertEphemeralSort()).not.toThrow();
    expect(f.events).toEqual([]);
  });
});

describe('clearSvarSortArrow', () => {
  it('resets the internal _sort state through getStores', () => {
    const f = makeFixture();

    f.orchestrator.clearSvarSortArrow();

    expect(f.events).toEqual([
      expect.objectContaining({ kind: 'set-state', state: { _sort: null } }),
    ]);
  });

  it('never writes syncing on a standalone call — callers own the bracket', () => {
    const f = makeFixture();

    f.orchestrator.clearSvarSortArrow();

    expect(f.events).toHaveLength(1);
    expect(f.syncingWrites).toEqual([]);
  });

  it('tolerates an api without getStores', () => {
    const f = makeFixture();
    f.backing.api = { exec: () => undefined };

    expect(() => f.orchestrator.clearSvarSortArrow()).not.toThrow();
    expect(f.events).toEqual([]);
  });
});

describe('accessor liveness', () => {
  it('reassert execs land on the api read at call time, not the wiring-time one', () => {
    const f = makeFixture({ ephemeralSort: activeSort });

    f.orchestrator.reassertEphemeralSort();
    f.backing.api = f.makeApi('rebound');
    f.orchestrator.reassertEphemeralSort();

    expect(f.execEvents().map((e) => e.apiLabel)).toEqual(['primary', 'rebound']);
  });

  it('restoreBaseOrder replays against the api read at call time after a swap', () => {
    const f = makeFixture();

    f.orchestrator.restoreBaseOrder();
    f.backing.api = f.makeApi('rebound');
    f.orchestrator.restoreBaseOrder();

    const labels = new Set(f.execEvents().slice(2).map((e) => e.apiLabel));
    expect(labels).toEqual(new Set(['rebound']));
  });

  it('a cleared override between scheduling contexts is seen live: reassert after clearing is a no-op', () => {
    const f = makeFixture({ ephemeralSort: activeSort });
    f.backing.ephemeralSort = null;

    f.orchestrator.reassertEphemeralSort();

    expect(f.events).toEqual([]);
  });
});

describe('reseed family', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['performance'] });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('factory construction', () => {
    it('reads no accessors at construction — applied keys come only from the immutable init argument', () => {
      const f = makeFixture();

      expect(f.reads).toEqual({
        syncing: 0,
        ephemeralSort: 0,
        api: 0,
        columns: 0,
        initialTasks: 0,
        initialLinks: 0,
        collapsedIds: 0,
      });
      expect(f.events).toEqual([]);
      expect(f.currentData).not.toHaveBeenCalled();
      expect(f.hiddenSources).not.toHaveBeenCalled();
    });
  });

  describe('reseedColumnsIfNeeded', () => {
    it('returns false and touches nothing when columns key and editor-attach set match the applied keys', () => {
      const f = makeFixture();

      expect(f.orchestrator.reseedColumnsIfNeeded(syncSource())).toBe(false);

      expect(f.events).toEqual([]);
      expect(f.buildSvarColumns).not.toHaveBeenCalled();
    });

    it('a width-only change is not a column reseed', () => {
      const f = makeFixture();

      expect(f.orchestrator.reseedColumnsIfNeeded(syncSource({ gridWidth: 512 }))).toBe(false);

      expect(f.events).toEqual([]);
    });

    it('columns-key change: fresh columns from the dep, seeds rewritten, width re-asserted, no diff execs', () => {
      const f = makeFixture();
      const d = syncSource({ gridColumnsKey: 'cols-v2', links: [link('a-b', 'a', 'b')] });

      expect(f.orchestrator.reseedColumnsIfNeeded(d)).toBe(true);

      expect(f.execEvents()).toEqual([]);
      expect(f.buildSvarColumns).toHaveBeenCalledWith(d.gridColumns);
      expect(f.backing.columns).toEqual([
        { id: 'text', builtFrom: 'text' },
        { id: 'status', builtFrom: 'status' },
      ]);
      expect(f.backing.initialTasks.map((t) => t.id)).toEqual(['a', 'b', 'c']);
      expect(f.backing.initialLinks).toBe(d.links);
      expect(f.gridWidthAsserts()).toHaveLength(1);
    });

    it('advances all applied keys: repeating the same changed data is a no-op', () => {
      const f = makeFixture();
      const d = syncSource({ gridColumnsKey: 'cols-v2', gridWidth: 512 });
      f.orchestrator.reseedColumnsIfNeeded(d);
      const eventCount = f.events.length;

      expect(f.orchestrator.reseedColumnsIfNeeded(d)).toBe(false);

      expect(f.events).toHaveLength(eventCount);
    });

    it('adopts the incoming grid width before reseeding: a follow-up width check does not re-assert', () => {
      const f = makeFixture();
      const d = syncSource({ gridColumnsKey: 'cols-v2', gridWidth: 512 });
      f.orchestrator.reseedColumnsIfNeeded(d);
      const widthAsserts = f.gridWidthAsserts().length;

      f.orchestrator.applyChangedGridWidth(d);

      expect(f.gridWidthAsserts()).toHaveLength(widthAsserts);
    });

    it('an editor-attach change alone (columns key unchanged) triggers the same column reseed', () => {
      const f = makeFixture({ cellEditColumnIds: [], init: { editorAttachKey: 'status' } });

      expect(f.orchestrator.reseedColumnsIfNeeded(syncSource())).toBe(true);

      expect(f.execEvents()).toEqual([]);
      expect(f.backing.columns).toHaveLength(2);
      expect(f.gridWidthAsserts()).toHaveLength(1);
      expect(f.orchestrator.reseedColumnsIfNeeded(syncSource())).toBe(false);
    });

    it('reads the editor-attach set live: a supplier change between calls triggers the reseed', () => {
      const f = makeFixture();
      expect(f.orchestrator.reseedColumnsIfNeeded(syncSource())).toBe(false);

      f.setCellEditColumnIds(['status']);

      expect(f.orchestrator.reseedColumnsIfNeeded(syncSource())).toBe(true);
      expect(f.backing.columns).toHaveLength(2);
      expect(f.gridWidthAsserts()).toHaveLength(1);
      expect(f.orchestrator.reseedColumnsIfNeeded(syncSource())).toBe(false);
    });
  });

  describe('applyChangedGridWidth', () => {
    it('is a no-op when the incoming width equals the applied width', () => {
      const f = makeFixture();

      f.orchestrator.applyChangedGridWidth(syncSource());

      expect(f.applyPersistedGridWidth).not.toHaveBeenCalled();
    });

    it('re-asserts through the dep on a width change, then adopts it: a repeat is a no-op', () => {
      const f = makeFixture();
      const d = syncSource({ gridWidth: 512 });

      f.orchestrator.applyChangedGridWidth(d);
      f.orchestrator.applyChangedGridWidth(d);

      expect(f.applyPersistedGridWidth).toHaveBeenCalledTimes(1);
    });
  });

  describe('reseedSeedsFromData', () => {
    it('flows one seed snapshot to both the seed setters and the applied baseline (no-clone identity)', () => {
      const f = makeFixture();
      const stateBefore = f.appliedSyncState;
      const tasksMapBefore = f.appliedSyncState.tasks;
      const linksMapBefore = f.appliedSyncState.links;
      const seedLink = link('a-b', 'a', 'b');
      const d = syncSource({ links: [seedLink] });

      f.orchestrator.reseedSeedsFromData(d);

      expect(f.appliedSyncState).toBe(stateBefore);
      expect(f.appliedSyncState.tasks).toBe(tasksMapBefore);
      expect(f.appliedSyncState.links).toBe(linksMapBefore);
      expect(f.backing.initialTasks.map((t) => t.id)).toEqual(['a', 'b', 'c']);
      expect(f.appliedSyncState.tasks.get('a')).toBe(f.backing.initialTasks[0]);
      expect(f.backing.initialLinks).toBe(d.links);
      expect(f.appliedSyncState.links.get('a-b')).toBe(seedLink);
      expect(f.appliedSyncState.orderKey).toBe('>a|>b|>c');
    });

    it('derives tasks and links from the same data argument — a restore-side supplier never feeds a reseed', () => {
      const f = makeFixture();
      f.setCurrentData(syncSource({ instances: [inst('x')] }));

      f.orchestrator.reseedSeedsFromData(syncSource());

      expect(f.currentData).not.toHaveBeenCalled();
      expect(f.backing.initialTasks.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    });

    it('re-baselines the Base sort descriptor from the getSort supplier', () => {
      const f = makeFixture({ baseSort: [{ property: 'due', direction: 'ASC' }] });

      f.orchestrator.reseedSeedsFromData(syncSource());

      expect(f.appliedSyncState.baseSortKey).toBe('due:ASC');
    });

    it('schedules no reassert when no ephemeral sort is active', () => {
      const f = makeFixture();

      f.orchestrator.reseedSeedsFromData(syncSource());

      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('post-reseed reassert timer', () => {
    it('defers the reassert and wraps it in its own syncing raise (true during, false after)', () => {
      const f = makeFixture({ ephemeralSort: activeSort });

      f.orchestrator.reseedSeedsFromData(syncSource());
      expect(f.execEvents()).toEqual([]);
      jest.runAllTimers();

      expect(f.execEvents()).toEqual([
        expect.objectContaining({
          action: 'sort-tasks',
          payload: { key: 'text', order: 'asc', eventSource: ECHO },
          syncingDuring: true,
        }),
      ]);
      expect(f.syncingWrites).toEqual([true, false]);
      expect(f.backing.syncing).toBe(false);
    });

    it('fire-time guard: an override cleared before fire produces no exec and no syncing raise', () => {
      const f = makeFixture({ ephemeralSort: activeSort });

      f.orchestrator.reseedSeedsFromData(syncSource());
      f.backing.ephemeralSort = null;
      jest.runAllTimers();

      expect(f.execEvents()).toEqual([]);
      expect(f.syncingWrites).toEqual([]);
    });

    it('lands on the api bound at fire time after a remount swap — no cancellation added', () => {
      const f = makeFixture({ ephemeralSort: activeSort });

      f.orchestrator.reseedSeedsFromData(syncSource());
      f.backing.api = f.makeApi('rebound');
      jest.runAllTimers();

      expect(f.execEvents().map((e) => e.apiLabel)).toEqual(['rebound']);
    });

    it('swallows a reassert throw at fire time and still releases syncing', () => {
      const f = makeFixture({ ephemeralSort: activeSort, throwOnExecNumber: 1 });

      f.orchestrator.reseedSeedsFromData(syncSource());

      expect(() => jest.runAllTimers()).not.toThrow();
      expect(f.syncingWrites).toEqual([true, false]);
      expect(f.backing.syncing).toBe(false);
    });

    it('keeps raw scheduling: back-to-back reseeds leave both pending reasserts to fire', () => {
      const f = makeFixture({ ephemeralSort: activeSort });

      f.orchestrator.reseedSeedsFromData(syncSource());
      f.orchestrator.reseedSeedsFromData(syncSource());

      expect(jest.getTimerCount()).toBe(2);
      jest.runAllTimers();
      expect(f.execEvents().filter((e) => e.action === 'sort-tasks')).toHaveLength(2);
    });

    it('fires without throwing after component teardown while the api stays assigned — no destroy gate', () => {
      const f = makeFixture({ ephemeralSort: activeSort });
      f.orchestrator.reseedSeedsFromData(syncSource());

      f.backing.destroyed = true;

      expect(() => jest.runAllTimers()).not.toThrow();
      expect(f.execEvents().map((e) => e.action)).toEqual(['sort-tasks']);
      expect(f.syncingWrites).toEqual([true, false]);
      expect(f.backing.syncing).toBe(false);
    });
  });
});

describe('syncToGantt', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['performance'] });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  /** Baseline the applied state to `d` without leaving pending timers or log noise. */
  function baselined(options: FixtureOptions = {}, d: GanttSyncSource = syncSource()) {
    const f = makeFixture(options);
    f.orchestrator.reseedSeedsFromData(d);
    f.clearLog();
    return f;
  }

  it('identical data twice is a NOOP: zero execs, zero syncing toggles, zero ephemeralSort reads', () => {
    const f = makeFixture();
    const d = syncSource();
    f.orchestrator.syncToGantt(d);
    f.clearLog();

    f.orchestrator.syncToGantt(d);

    expect(f.events).toEqual([]);
    expect(f.syncingWrites).toEqual([]);
    expect(f.reads.ephemeralSort).toBe(0);
    expect(f.reads.collapsedIds).toBeGreaterThanOrEqual(1);
  });

  it('reads collapsedIds and the hidden-sources supplier synchronously within the sync call frame', () => {
    const f = makeFixture();
    // Zero the construction-time log first: a factory that eagerly read and
    // cached these would otherwise satisfy the counts without any per-call
    // read, silently breaking the effect's dependency tracking.
    f.clearLog();

    f.orchestrator.syncToGantt(syncSource());

    expect(f.reads.collapsedIds).toBeGreaterThanOrEqual(1);
    expect(f.hiddenSources).toHaveBeenCalledTimes(1);
  });

  it('one changed task takes the incremental path: an echo-tagged update inside the syncing window, applied state advanced', () => {
    const f = baselined();

    f.orchestrator.syncToGantt(
      syncSource({ instances: [inst('a'), inst('b', { progress: 50 }), inst('c')] }),
    );

    const updates = f.execEvents().filter((e) => e.action === 'update-task');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      payload: expect.objectContaining({ id: 'b', eventSource: ECHO }),
      syncingDuring: true,
    });
    expect(f.syncingWrites).toEqual([true, false]);
    expect(f.backing.syncing).toBe(false);
    expect(f.appliedSyncState.tasks.get('b')?.progress).toBe(50);
  });

  it('structural ops over the threshold bulk-reseed: bare seed writes, same state object, sort rebaselined, display filter deferred exactly once', () => {
    const f = baselined();
    const stateBefore = f.appliedSyncState;
    const tasksMapBefore = f.appliedSyncState.tasks;
    f.setBaseSort([{ property: 'due', direction: 'ASC' }]);
    const bulk = syncSource({
      instances: [
        inst('a'),
        inst('b'),
        inst('c'),
        ...Array.from({ length: 151 }, (_, i) => inst(`n${i}`)),
      ],
    });

    f.orchestrator.syncToGantt(bulk);

    expect(f.execEvents()).toEqual([]);
    const seedWrites = f.events.filter((e) => e.kind === 'set-initial-tasks');
    expect(seedWrites).toHaveLength(1);
    expect(seedWrites[0]?.syncingDuring).toBe(true);
    expect(f.appliedSyncState).toBe(stateBefore);
    expect(f.appliedSyncState.tasks).toBe(tasksMapBefore);
    expect(f.appliedSyncState.tasks.size).toBe(154);
    expect(f.appliedSyncState.baseSortKey).toBe('due:ASC');
    expect(f.syncingWrites).toEqual([true, false]);
    expect(f.applyDisplayFilters).not.toHaveBeenCalled();
    jest.runAllTimers();
    expect(f.applyDisplayFilters).toHaveBeenCalledTimes(1);
  });

  it('sort active + data change with unchanged base sort: the reassert stays bare inside the already-raised syncing window', () => {
    const f = baselined();
    f.backing.ephemeralSort = activeSort;
    f.clearLog();

    f.orchestrator.syncToGantt(
      syncSource({ instances: [inst('a'), inst('b', { progress: 50 }), inst('c')] }),
    );

    const actions = f.execEvents().map((e) => e.action);
    expect(actions).toEqual(['update-task', 'sort-tasks']);
    expect(f.execEvents()[1]).toMatchObject({
      payload: { key: 'text', order: 'asc', eventSource: ECHO },
      syncingDuring: true,
    });
    // Bare convention: one raise for the whole incremental pass — a wrapped
    // reassert would interleave its own raise/release here.
    expect(f.syncingWrites).toEqual([true, false]);
    expect(f.execEvents().filter((e) => e.action === 'move-task')).toEqual([]);
  });

  it('sort active + base sort changed: override cleared, _sort reset, reorder replayed, keys advanced', () => {
    const f = baselined();
    f.backing.ephemeralSort = activeSort;
    f.setBaseSort([{ property: 'due', direction: 'ASC' }]);
    f.clearLog();

    f.orchestrator.syncToGantt(
      syncSource({ instances: [inst('b'), inst('a'), inst('c')] }),
    );

    expect(f.events.filter((e) => e.kind === 'set-ephemeral-sort')).toEqual([
      { kind: 'set-ephemeral-sort', value: null },
    ]);
    expect(f.backing.ephemeralSort).toBeNull();
    expect(f.events.some((e) => e.kind === 'set-state')).toBe(true);
    expect(f.execEvents().map((e) => e.action)).toEqual(['move-task', 'move-task']);
    expect(f.appliedSyncState.orderKey).toBe('>b|>a|>c');
    expect(f.appliedSyncState.baseSortKey).toBe('due:ASC');
  });

  it('an echo applied to the shared baseline makes the matching refresh a NOOP, while pre-echo data re-issues', () => {
    const f = baselined();
    const start = new Date(2026, 0, 5);
    const end = new Date(2026, 0, 6);
    applyEchoToBaseline(f.appliedSyncState, 'b', { start, end });

    f.orchestrator.syncToGantt(
      syncSource({ instances: [inst('a'), inst('b', { start, end }), inst('c')] }),
    );
    expect(f.events).toEqual([]);

    f.orchestrator.syncToGantt(syncSource());
    const updates = f.execEvents().filter((e) => e.action === 'update-task');
    expect(updates).toHaveLength(1);
    expect(updates[0]?.payload).toMatchObject({ id: 'b' });
  });

  it('sees a hidden-sources change between calls through the live supplier, and a same-content repeat is a NOOP', () => {
    const standup = (): RenderInstance =>
      inst('Standup', {
        start: new Date(2026, 0, 6),
        end: new Date(2026, 0, 6, 23, 59, 59, 999),
        occupancy: [occ('2026-01-06', 'next'), occ('2026-01-13', 'projected')],
        plainBarSuppressed: true,
      });
    const f = makeFixture();
    f.orchestrator.syncToGantt(syncSource({ instances: [standup()] }));
    f.clearLog();

    f.setHiddenSources(new Set<CalendarItemFamily>(['recurring-instance']));
    f.orchestrator.syncToGantt(syncSource({ instances: [standup()] }));

    const updates = f.execEvents().filter((e) => e.action === 'update-task');
    expect(updates).toHaveLength(1);
    expect(updates[0]?.payload).toMatchObject({ id: 'Standup' });

    f.clearLog();
    f.orchestrator.syncToGantt(syncSource({ instances: [standup()] }));
    expect(f.events).toEqual([]);
  });

  it('post-reseed cell-edit agreement: an in-place custom.properties advance makes the matching refresh a NOOP', () => {
    const propsOf = (value: string): Map<string, Record<string, TypedValue>> =>
      new Map([['b.md', { status: { kind: 'text', value } }]]);
    const f = makeFixture({ cellEditColumnIds: ['status'] });
    f.orchestrator.reseedSeedsFromData(syncSource({ propertyValues: propsOf('todo') }));
    f.clearLog();

    const applied = f.appliedSyncState.tasks.get('b');
    applied!.custom.properties = { status: { kind: 'text', value: 'done' } };
    f.orchestrator.syncToGantt(syncSource({ propertyValues: propsOf('done') }));

    expect(f.events).toEqual([]);
  });

  it('fires the post-reseed reassert timer before the post-bulk display-filter timer', () => {
    const f = baselined();
    f.backing.ephemeralSort = activeSort;
    f.clearLog();
    const bulk = syncSource({
      instances: [
        inst('a'),
        inst('b'),
        inst('c'),
        ...Array.from({ length: 151 }, (_, i) => inst(`n${i}`)),
      ],
    });

    f.orchestrator.syncToGantt(bulk);
    jest.runAllTimers();

    const reassertAt = f.events.findIndex((e) => e.kind === 'exec' && e.action === 'sort-tasks');
    const displayFilterAt = f.events.findIndex((e) => e.kind === 'apply-display-filters');
    expect(reassertAt).toBeGreaterThanOrEqual(0);
    expect(displayFilterAt).toBeGreaterThan(reassertAt);
  });

  it('a column-key change short-circuits into the column reseed: no plan, no diff execs', () => {
    const f = baselined();

    f.orchestrator.syncToGantt(syncSource({ gridColumnsKey: 'cols-v2' }));

    expect(f.execEvents()).toEqual([]);
    expect(f.buildSvarColumns).toHaveBeenCalledTimes(1);
    expect(f.gridWidthAsserts()).toHaveLength(1);
  });

  it('a width-only change re-asserts the width on the content-NOOP path', () => {
    const f = baselined();

    f.orchestrator.syncToGantt(syncSource({ gridWidth: 512 }));

    expect(f.applyPersistedGridWidth).toHaveBeenCalledTimes(1);
    expect(f.execEvents()).toEqual([]);
  });
});

const STANDUP_PATH = 'Standup.md';

/** One recurring-instance occupancy entry for a day. */
function occ(day: string, stateClass: string): CalendarOccupancy {
  return {
    family: 'recurring-instance',
    itemId: makeCalendarItemId('recurring-instance', STANDUP_PATH, day),
    day,
    minutes: null,
    stateClass,
  };
}
