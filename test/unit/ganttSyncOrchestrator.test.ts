/**
 * Ephemeral-sort coordination cluster of the diff-sync orchestrator seam.
 *
 * Every scenario drives the factory through a spy access object (counting
 * getters, recording setters) and a recording fake api, so guard behavior,
 * clear-vs-replay ordering, echo tagging, the `syncing` bracket, and accessor
 * liveness are all provable without Obsidian or a mounted component.
 */
import { describe, expect, it, jest } from '@jest/globals';
import {
  createGanttSyncOrchestrator,
  type SyncOrchestratorAccess,
  type SyncOrchestratorApi,
} from '../../src/bases/ganttSyncOrchestrator';
import type { SvarTask } from '../../src/bases/ganttSync';
import type { AppliedGanttSyncState } from '../../src/bases/ganttSyncCoordinator';
import type { EphemeralSort } from '../../src/bases/sortCycle';

const ECHO = 'og-self';
const INITIAL_ORDER_KEY = 'initial-order';

function task(id: string, parent?: string): SvarTask {
  return {
    id,
    parent,
    text: id,
    start: new Date(2026, 0, 1),
    end: new Date(2026, 0, 2),
    progress: 0,
    type: 'task',
    custom: {
      sourceTaskId: id,
      isVirtual: false,
      isCollapsed: false,
      isReplicated: false,
      isContext: false,
      isTopLevelPlacement: false,
      dateStatus: 'complete',
      showHasDeps: false,
      barIcon: null,
      incomingDeps: [],
      editable: true,
    },
  };
}

/**
 * One entry per observable emission, in call order: SVAR execs, the internal
 * `_sort` reset, and every `ephemeralSort` setter write share a single log so
 * ordering contracts ("null the override before the restore replays") are
 * assertable directly. `syncingDuring` snapshots the backing flag at the
 * moment the api call landed.
 */
interface LoggedEvent {
  kind: 'exec' | 'set-state' | 'set-ephemeral-sort';
  apiLabel?: string;
  action?: string;
  payload?: Record<string, unknown>;
  state?: Record<string, unknown>;
  value?: EphemeralSort | null;
  syncingDuring?: boolean;
}

interface Backing {
  syncing: boolean;
  ephemeralSort: EphemeralSort | null;
  api: SyncOrchestratorApi | undefined;
}

interface FixtureOptions {
  ephemeralSort?: EphemeralSort | null;
  tasks?: SvarTask[];
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
}

function makeFixture(options: FixtureOptions = {}) {
  const events: LoggedEvent[] = [];
  const backing: Backing = {
    syncing: false,
    ephemeralSort: options.ephemeralSort ?? null,
    api: undefined,
  };
  const reads = { syncing: 0, ephemeralSort: 0, api: 0 };
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

  const access: SyncOrchestratorAccess = {
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
  };

  const appliedSyncState: AppliedGanttSyncState = {
    tasks: new Map<string, SvarTask>(),
    links: new Map(),
    orderKey: INITIAL_ORDER_KEY,
    baseSortKey: 'initial-base-sort',
  };
  const currentTasks = jest.fn(() => options.tasks ?? [task('a'), task('b'), task('c')]);
  const orchestrator = createGanttSyncOrchestrator(access, {
    echoSource: ECHO,
    currentTasks,
    appliedSyncState,
  });

  const disarmThrow = (): void => {
    armedThrow = 0;
  };
  return {
    orchestrator,
    events,
    backing,
    reads,
    syncingWrites,
    appliedSyncState,
    currentTasks,
    makeApi,
    disarmThrow,
    execEvents: () => events.filter((e) => e.kind === 'exec'),
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

  it('returns early — no syncing raise, no task read — when no api is bound', () => {
    const f = makeFixture({ withoutApi: true });

    f.orchestrator.restoreBaseOrder();

    expect(f.events).toEqual([]);
    expect(f.syncingWrites).toEqual([]);
    expect(f.currentTasks).not.toHaveBeenCalled();
    expect(f.appliedSyncState.orderKey).toBe(INITIAL_ORDER_KEY);
  });

  it('never reads ephemeralSort during a replay — the override belongs to its callers', () => {
    const f = makeFixture();

    f.orchestrator.restoreBaseOrder();

    expect(f.execEvents().length).toBeGreaterThanOrEqual(1);
    expect(f.reads.ephemeralSort).toBe(0);
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
