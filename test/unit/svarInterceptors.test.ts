/**
 * Interaction-cluster interceptor policies.
 *
 * Every scenario drives the extracted handler factories through a fake SVAR
 * api that records `intercept` registrations and replays events, with a
 * mutable backing object behind the live-access interface — so guard
 * discrimination, liveness, and registration order are all provable without
 * Obsidian.
 */
import {
  INTERACTION_INTERCEPT_ACTIONS,
  SVAR_INTERCEPT_ACTIONS,
  wireInteractionInterceptors,
  wireSvarInterceptors,
  type InteractionInterceptorDeps,
  type InterceptorAccess,
  type SvarInterceptorDeps,
} from '../../src/bases/svarInterceptors';
import type { EphemeralSort } from '../../src/bases/sortCycle';
import {
  classifyLinkCreate,
  classifyUpdateEvent,
  classifyUpdateGesture,
} from '../../src/bases/cascadeGate';
import {
  allowsLinkEndpoints,
  allowsRowMutation,
  refusesUserRowMutation,
} from '../../src/bases/eventRowGuards';
import type { TypedValue } from '../../src/bases/propertyValues';
import { flushMicrotasks } from './dragExecutorTestKit';
import * as fs from 'fs';
import * as path from 'path';

const ECHO = 'og-self';
const CAL_ID = 'og-calendar://feed/item-1';

/**
 * The global setTimeout pinned to the handle type the interceptor access seam
 * stores (`ReturnType<typeof setTimeout>`) — the merged DOM/Node overloads
 * otherwise resolve the bare call to the wrong member of the overload set.
 */
const scheduleTimeout: (callback: () => void, ms: number) => ReturnType<typeof setTimeout> =
  setTimeout;

interface Registration {
  action: string;
  handler: (ev: unknown) => boolean | void;
}

class FakeInterceptApi {
  registrations: Registration[] = [];
  intercept<E>(action: string, handler: (ev: E) => boolean | void): void {
    this.registrations.push({ action, handler: handler as (ev: unknown) => boolean | void });
  }
  fire(action: string, ev: unknown): boolean | void {
    const found = this.registrations.find((r) => r.action === action);
    if (!found) throw new Error(`no handler registered for ${action}`);
    return found.handler(ev);
  }
}

interface Backing {
  syncing: boolean;
  ephemeralSort: EphemeralSort | null;
  collapsedIds: Set<string>;
  pendingSingleClick: ReturnType<typeof setTimeout> | null;
  lastCtrlMeta: boolean;
  pointerButtonDown: boolean;
  suppressSelectActivation: boolean;
}

function makeAccess(overrides: Partial<Backing> = {}): { backing: Backing; access: InterceptorAccess } {
  const backing: Backing = {
    syncing: false,
    ephemeralSort: null,
    collapsedIds: new Set<string>(),
    pendingSingleClick: null,
    lastCtrlMeta: false,
    pointerButtonDown: false,
    suppressSelectActivation: false,
    ...overrides,
  };
  const access: InterceptorAccess = {
    get syncing() {
      return backing.syncing;
    },
    get ephemeralSort() {
      return backing.ephemeralSort;
    },
    set ephemeralSort(v) {
      backing.ephemeralSort = v;
    },
    get collapsedIds() {
      return backing.collapsedIds;
    },
    set collapsedIds(v) {
      backing.collapsedIds = v;
    },
    get pendingSingleClick() {
      return backing.pendingSingleClick;
    },
    set pendingSingleClick(v) {
      backing.pendingSingleClick = v;
    },
    get lastCtrlMeta() {
      return backing.lastCtrlMeta;
    },
    get pointerButtonDown() {
      return backing.pointerButtonDown;
    },
    get suppressSelectActivation() {
      return backing.suppressSelectActivation;
    },
  };
  return { backing, access };
}

function makeFixture(overrides: Partial<Backing> = {}) {
  const { backing, access } = makeAccess(overrides);
  const restoreBaseOrder = jest.fn();
  const activateBar = jest.fn();
  const notePaths = new Map<string, string>();
  let selected: Array<string | number> = [];
  const deps: InteractionInterceptorDeps = {
    echoSource: ECHO,
    restoreBaseOrder,
    activateBar,
    notePathOf: (rowId) => notePaths.get(rowId),
    getState: () => ({ selected }),
  };
  const api = new FakeInterceptApi();
  wireInteractionInterceptors(api, access, deps);
  return {
    api,
    backing,
    restoreBaseOrder,
    activateBar,
    notePaths,
    setSelected: (ids: Array<string | number>) => {
      selected = ids;
    },
  };
}

describe('wireInteractionInterceptors registration contract (R10)', () => {
  it('registers the ten interaction actions in the preserved order', () => {
    const { api } = makeFixture();
    expect(api.registrations.map((r) => r.action)).toEqual([
      'sort-tasks',
      'open-task',
      'move-task',
      'move-task:up',
      'move-task:down',
      'reorder-tasks',
      'move-up',
      'move-down',
      'show-editor',
      'select-task',
    ]);
    expect([...INTERACTION_INTERCEPT_ACTIONS]).toEqual(api.registrations.map((r) => r.action));
  });
});

describe('sort-tasks interceptor', () => {
  it('passes an echo-sourced event through untouched while syncing is false (R5: echo guard alone)', () => {
    const { api, backing } = makeFixture();
    const result = api.fire('sort-tasks', { key: 'col', eventSource: ECHO });
    expect(result).toBe(true);
    expect(backing.ephemeralSort).toBeNull();
  });

  it('passes any event through untouched while syncing is true with no echo source (R5: syncing guard alone)', () => {
    const { api, backing } = makeFixture({ syncing: true });
    const result = api.fire('sort-tasks', { key: 'col' });
    expect(result).toBe(true);
    expect(backing.ephemeralSort).toBeNull();
  });

  it('ignores an event without a string key', () => {
    const { api, backing } = makeFixture();
    expect(api.fire('sort-tasks', {})).toBe(true);
    expect(backing.ephemeralSort).toBeNull();
  });

  it('cycles a header click asc then desc', () => {
    const { api, backing } = makeFixture();
    expect(api.fire('sort-tasks', { key: 'col' })).toBe(true);
    expect(backing.ephemeralSort).toEqual({ column: 'col', direction: 'asc' });
    expect(api.fire('sort-tasks', { key: 'col' })).toBe(true);
    expect(backing.ephemeralSort).toEqual({ column: 'col', direction: 'desc' });
  });

  it('clears synchronously on the third click and defers the Base-order restore one tick', () => {
    jest.useFakeTimers();
    try {
      const { api, backing, restoreBaseOrder } = makeFixture({
        ephemeralSort: { column: 'col', direction: 'desc' },
      });
      expect(api.fire('sort-tasks', { key: 'col' })).toBe(false);
      expect(backing.ephemeralSort).toBeNull();
      expect(restoreBaseOrder).not.toHaveBeenCalled();
      jest.advanceTimersByTime(0);
      expect(restoreBaseOrder).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('skips the deferred restore when a new sort starts within the tick', () => {
    jest.useFakeTimers();
    try {
      const { api, backing, restoreBaseOrder } = makeFixture({
        ephemeralSort: { column: 'col', direction: 'desc' },
      });
      api.fire('sort-tasks', { key: 'col' });
      backing.ephemeralSort = { column: 'other', direction: 'asc' };
      jest.advanceTimersByTime(0);
      expect(restoreBaseOrder).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('open-task interceptor', () => {
  it('passes an echo-sourced toggle through without recording it (R5: echo guard alone)', () => {
    const { api, backing } = makeFixture();
    expect(api.fire('open-task', { id: 'a', mode: false, eventSource: ECHO })).toBe(true);
    expect(backing.collapsedIds.has('a')).toBe(false);
  });

  it('passes a toggle through without recording it while syncing (R5: syncing guard alone)', () => {
    const { api, backing } = makeFixture({ syncing: true });
    expect(api.fire('open-task', { id: 'a', mode: false })).toBe(true);
    expect(backing.collapsedIds.has('a')).toBe(false);
  });

  it('vetoes the mid-drag collapse while the pointer button is held', () => {
    const { api, backing } = makeFixture({ pointerButtonDown: true });
    expect(api.fire('open-task', { id: 'a', mode: false })).toBe(false);
    expect(backing.collapsedIds.has('a')).toBe(false);
  });

  it('records a collapse through the access setter when the pointer is up', () => {
    const { api, backing } = makeFixture();
    expect(api.fire('open-task', { id: 'a', mode: false })).toBe(true);
    expect(backing.collapsedIds.has('a')).toBe(true);
  });

  it('removes the id again on expand', () => {
    const { api, backing } = makeFixture({ collapsedIds: new Set(['a']) });
    expect(api.fire('open-task', { id: 'a', mode: true })).toBe(true);
    expect(backing.collapsedIds.has('a')).toBe(false);
  });

  it('ignores a toggle without an id or boolean mode', () => {
    const { api, backing } = makeFixture();
    expect(api.fire('open-task', { id: 'a' })).toBe(true);
    expect(api.fire('open-task', { mode: false })).toBe(true);
    expect(backing.collapsedIds.size).toBe(0);
  });
});

describe('reorder blocking', () => {
  const actions = ['move-task', 'move-task:up', 'move-task:down', 'reorder-tasks', 'move-up', 'move-down'];

  it.each(actions)('blocks an untagged user %s', (action) => {
    const { api } = makeFixture();
    expect(api.fire(action, {})).toBe(false);
  });

  it.each(actions)('lets an echo-tagged %s pass while syncing is false (R5: echo guard alone)', (action) => {
    const { api } = makeFixture();
    expect(api.fire(action, { eventSource: ECHO })).toBe(true);
  });

  it.each(actions)('lets %s pass while syncing with no echo source (R5: syncing guard alone)', (action) => {
    const { api } = makeFixture({ syncing: true });
    expect(api.fire(action, {})).toBe(true);
  });
});

describe('show-editor interceptor', () => {
  it('refuses programmatic show-editor while syncing', () => {
    const { api, activateBar } = makeFixture({ syncing: true });
    expect(api.fire('show-editor', { id: 't1' })).toBe(false);
    expect(activateBar).not.toHaveBeenCalled();
  });

  it('clears a pending single-click before routing', () => {
    jest.useFakeTimers();
    try {
      const stale = jest.fn();
      const pending = scheduleTimeout(stale, 250);
      const { api, backing } = makeFixture({ pendingSingleClick: pending });
      api.fire('show-editor', { id: 't1' });
      expect(backing.pendingSingleClick).toBeNull();
      jest.runAllTimers();
      expect(stale).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('cancels the single activation a real earlier click scheduled, running only the double action', () => {
    jest.useFakeTimers();
    try {
      const { api, backing, activateBar, setSelected } = makeFixture();
      setSelected(['t1']);
      api.fire('select-task', { id: 't1' });
      expect(backing.pendingSingleClick).not.toBeNull();
      api.fire('show-editor', { id: 't1' });
      expect(backing.pendingSingleClick).toBeNull();
      jest.runAllTimers();
      expect(activateBar).toHaveBeenCalledTimes(1);
      expect(activateBar).toHaveBeenCalledWith('t1', 'double', false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('routes a calendar-item row with a backing note to a double open-note activation', () => {
    const { api, activateBar, notePaths } = makeFixture({ lastCtrlMeta: true });
    notePaths.set(CAL_ID, 'Notes/feed item.md');
    expect(api.fire('show-editor', { id: CAL_ID })).toBe(false);
    expect(activateBar).toHaveBeenCalledWith(CAL_ID, 'double', true);
  });

  it('is a no-op for a calendar-item row without a backing note', () => {
    const { api, activateBar } = makeFixture();
    expect(api.fire('show-editor', { id: CAL_ID })).toBe(false);
    expect(activateBar).not.toHaveBeenCalled();
  });

  it('runs the configured double action for a task row and always returns false', () => {
    const { api, activateBar } = makeFixture();
    expect(api.fire('show-editor', { id: 't1' })).toBe(false);
    expect(activateBar).toHaveBeenCalledWith('t1', 'double', false);
  });
});

describe('select-task interceptor', () => {
  it('passes a programmatic re-selection through without scheduling while syncing', () => {
    jest.useFakeTimers();
    try {
      const { api, backing, activateBar, setSelected } = makeFixture({ syncing: true });
      // The row is already selected — without the syncing guard this exact
      // event would schedule the deferred single activation.
      setSelected(['t1']);
      expect(api.fire('select-task', { id: 't1' })).toBe(true);
      expect(backing.pendingSingleClick).toBeNull();
      jest.runAllTimers();
      expect(activateBar).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('applies the highlight but never schedules while activation is suppressed, dropping any stale pending click', () => {
    jest.useFakeTimers();
    try {
      const stale = jest.fn();
      const pending = scheduleTimeout(stale, 250);
      const { api, backing, activateBar, setSelected } = makeFixture({
        suppressSelectActivation: true,
        pendingSingleClick: pending,
      });
      // The row is already selected — without the suppression gate this exact
      // event would schedule the deferred single activation.
      setSelected(['t1']);
      expect(api.fire('select-task', { id: 't1' })).toBe(true);
      expect(backing.pendingSingleClick).toBeNull();
      jest.runAllTimers();
      expect(stale).not.toHaveBeenCalled();
      expect(activateBar).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('only selects on the first click of an unselected row (select-first gate)', () => {
    jest.useFakeTimers();
    try {
      const { api, backing, activateBar, setSelected } = makeFixture();
      setSelected([]);
      expect(api.fire('select-task', { id: 't1' })).toBe(true);
      expect(backing.pendingSingleClick).toBeNull();
      jest.runAllTimers();
      expect(activateBar).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('schedules the deferred single activation for an already-selected row', () => {
    jest.useFakeTimers();
    try {
      const { api, backing, activateBar, setSelected } = makeFixture();
      setSelected(['t1']);
      expect(api.fire('select-task', { id: 't1' })).toBe(true);
      expect(backing.pendingSingleClick).not.toBeNull();
      jest.advanceTimersByTime(250);
      expect(activateBar).toHaveBeenCalledWith('t1', 'single', false);
      expect(backing.pendingSingleClick).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('clears the SVAR toggle flag and carries the modifier into the deferred activation', () => {
    jest.useFakeTimers();
    try {
      const { api, activateBar, setSelected } = makeFixture();
      setSelected(['t1']);
      const ev = { id: 't1', toggle: true };
      api.fire('select-task', ev);
      expect(ev.toggle).toBe(false);
      jest.advanceTimersByTime(250);
      expect(activateBar).toHaveBeenCalledWith('t1', 'single', true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('falls back to the pointer-captured modifier when the event carries no toggle', () => {
    jest.useFakeTimers();
    try {
      const { api, activateBar, setSelected } = makeFixture({ lastCtrlMeta: true });
      setSelected(['t1']);
      api.fire('select-task', { id: 't1' });
      jest.advanceTimersByTime(250);
      expect(activateBar).toHaveBeenCalledWith('t1', 'single', true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('drops a stale pending click from a previous click before deciding', () => {
    jest.useFakeTimers();
    try {
      const stale = jest.fn();
      const pending = scheduleTimeout(stale, 250);
      const { api, activateBar, setSelected } = makeFixture({ pendingSingleClick: pending });
      setSelected([]);
      api.fire('select-task', { id: 't1' });
      jest.runAllTimers();
      expect(stale).not.toHaveBeenCalled();
      expect(activateBar).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('liveness of the access seam (R6)', () => {
  it('observes a syncing flip made after wiring', () => {
    const { api, backing } = makeFixture();
    backing.syncing = true;
    expect(api.fire('sort-tasks', { key: 'col' })).toBe(true);
    expect(backing.ephemeralSort).toBeNull();
    backing.syncing = false;
    expect(api.fire('sort-tasks', { key: 'col' })).toBe(true);
    expect(backing.ephemeralSort).toEqual({ column: 'col', direction: 'asc' });
  });

  it('observes a lastCtrlMeta flip made after wiring', () => {
    const { api, backing, activateBar } = makeFixture();
    backing.lastCtrlMeta = true;
    api.fire('show-editor', { id: 't1' });
    expect(activateBar).toHaveBeenLastCalledWith('t1', 'double', true);
    backing.lastCtrlMeta = false;
    api.fire('show-editor', { id: 't2' });
    expect(activateBar).toHaveBeenLastCalledWith('t2', 'double', false);
  });

  it('observes a pointerButtonDown flip made after wiring', () => {
    const { api, backing } = makeFixture();
    backing.pointerButtonDown = true;
    expect(api.fire('open-task', { id: 'a', mode: false })).toBe(false);
    backing.pointerButtonDown = false;
    expect(api.fire('open-task', { id: 'a', mode: false })).toBe(true);
  });

  it('observes a suppressSelectActivation flip made after wiring', () => {
    jest.useFakeTimers();
    try {
      const { api, backing, setSelected } = makeFixture();
      setSelected(['t1']);
      backing.suppressSelectActivation = true;
      api.fire('select-task', { id: 't1' });
      expect(backing.pendingSingleClick).toBeNull();
      backing.suppressSelectActivation = false;
      api.fire('select-task', { id: 't1' });
      expect(backing.pendingSingleClick).not.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('reads selection state live through getState between events (select-first gate)', () => {
    jest.useFakeTimers();
    try {
      const { api, backing, setSelected } = makeFixture();
      setSelected([]);
      api.fire('select-task', { id: 't1' });
      expect(backing.pendingSingleClick).toBeNull();
      setSelected(['t1']);
      api.fire('select-task', { id: 't1' });
      expect(backing.pendingSingleClick).not.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('observes collapse writes from one event in the next event', () => {
    const { api, backing } = makeFixture();
    api.fire('open-task', { id: 'a', mode: false });
    api.fire('open-task', { id: 'b', mode: false });
    expect(backing.collapsedIds.has('a')).toBe(true);
    expect(backing.collapsedIds.has('b')).toBe(true);
  });

  it('observes an external collapsedIds replacement made after wiring (collapse-all)', () => {
    const { api, backing } = makeFixture();
    backing.collapsedIds = new Set(['external']);
    api.fire('open-task', { id: 'a', mode: false });
    expect(backing.collapsedIds.has('external')).toBe(true);
    expect(backing.collapsedIds.has('a')).toBe(true);
  });
});

// ── Data-mutation cluster (drag-task / update-task / add-link / delete-link) ──
//
// The syncing/echo guards for this cluster live inside the pure classifiers
// (`classifyUpdateEvent`, `classifyUpdateGesture`, `refusesUserRowMutation`),
// which are already unit-tested — so the fixture passes the REAL classifiers,
// wrapped in recording spies. A fake that reimplemented a guard would let a
// deleted handler plumb pass vacuously; the real classifier plus a verdict
// assertion fails instead: dropping the live `syncing` read or the
// `echoSource` tag changes the recorded verdict.

const text = (value: string): TypedValue => ({ kind: 'text', value }) as TypedValue;

interface DataFixtureOptions {
  backing?: Partial<Backing>;
  readOnly?: boolean;
  cellEditColumnIds?: string[];
  withoutOnMutate?: boolean;
  withoutOnAddDependency?: boolean;
  withoutOnRemoveDependency?: boolean;
}

function makeDataFixture(options: DataFixtureOptions = {}) {
  const { backing, access } = makeAccess(options.backing);
  const live = {
    readOnly: options.readOnly ?? false,
    cellEditColumnIds: options.cellEditColumnIds ?? ['status'],
  };
  const derivedGeometryIds = new Set<string>();
  const storedProperties = new Map<string, Record<string, TypedValue>>();
  const appliedLinks = new Map<string, { source: string; target: string }>();
  const notify = jest.fn();
  const handleCellEditCommit = jest.fn((): boolean => true);
  const reseedRowFlatKeys = jest.fn();
  const handleUserBarGesture = jest.fn((): boolean => true);
  const onMutate = options.withoutOnMutate ? undefined : jest.fn(async () => {});
  const onAddDependency = options.withoutOnAddDependency ? undefined : jest.fn(async () => {});
  const onRemoveDependency = options.withoutOnRemoveDependency ? undefined : jest.fn(async () => {});
  const classifyUpdateEventSpy = jest.fn(classifyUpdateEvent);
  const classifyUpdateGestureSpy = jest.fn(classifyUpdateGesture);
  const deps: SvarInterceptorDeps = {
    echoSource: ECHO,
    restoreBaseOrder: jest.fn(),
    activateBar: jest.fn(),
    notePathOf: () => undefined,
    getState: () => ({ selected: [] }),
    isReadOnly: () => live.readOnly,
    cellEditColumnIds: () => live.cellEditColumnIds,
    allowsRowMutation,
    refusesUserRowMutation,
    allowsLinkEndpoints,
    rowHasDerivedGeometry: (id) => id != null && derivedGeometryIds.has(String(id)),
    linkTouchesDerivedGeometry: (source, target) =>
      derivedGeometryIds.has(String(source)) || derivedGeometryIds.has(String(target)),
    classifyUpdateEvent: classifyUpdateEventSpy,
    classifyUpdateGesture: classifyUpdateGestureSpy,
    classifyLinkCreate,
    storedPropertiesOf: (id) => (id == null ? undefined : storedProperties.get(String(id))),
    handleCellEditCommit,
    reseedRowFlatKeys,
    handleUserBarGesture,
    onMutate,
    onAddDependency,
    onRemoveDependency,
    lookupAppliedLink: (linkId) => appliedLinks.get(linkId),
    notify,
  };
  const api = new FakeInterceptApi();
  wireSvarInterceptors(api, access, deps);
  return {
    api,
    backing,
    live,
    derivedGeometryIds,
    storedProperties,
    appliedLinks,
    notify,
    handleCellEditCommit,
    reseedRowFlatKeys,
    handleUserBarGesture,
    onAddDependency,
    onRemoveDependency,
    classifyUpdateEventSpy,
    classifyUpdateGestureSpy,
  };
}

describe('wireSvarInterceptors registration contract (R10)', () => {
  it('registers all fourteen actions in the preserved order — interaction cluster first, data cluster last', () => {
    const { api } = makeDataFixture();
    expect(api.registrations.map((r) => r.action)).toEqual([
      'sort-tasks',
      'open-task',
      'move-task',
      'move-task:up',
      'move-task:down',
      'reorder-tasks',
      'move-up',
      'move-down',
      'show-editor',
      'select-task',
      'drag-task',
      'update-task',
      'add-link',
      'delete-link',
    ]);
    expect([...SVAR_INTERCEPT_ACTIONS]).toEqual(api.registrations.map((r) => r.action));
  });
});

describe('drag-task interceptor', () => {
  it('refuses a drag on a row that disallows mutation', () => {
    const { api } = makeDataFixture();
    expect(api.fire('drag-task', { id: CAL_ID })).toBe(false);
  });

  it('refuses a drag on a derived-geometry row', () => {
    const { api, derivedGeometryIds } = makeDataFixture();
    derivedGeometryIds.add('t1');
    expect(api.fire('drag-task', { id: 't1' })).toBe(false);
  });

  it('allows a drag on an ordinary writable row', () => {
    const { api } = makeDataFixture();
    expect(api.fire('drag-task', { id: 't1' })).toBe(true);
  });
});

describe('update-task interceptor', () => {
  it('passes inProgress frames through without committing', () => {
    const { api, handleCellEditCommit, handleUserBarGesture } = makeDataFixture();
    expect(api.fire('update-task', { id: 't1', inProgress: true, task: { status: 'done' } })).toBe(true);
    expect(handleCellEditCommit).not.toHaveBeenCalled();
    expect(handleUserBarGesture).not.toHaveBeenCalled();
  });

  it('passes any event through while syncing with no echo source (R5: syncing guard alone)', () => {
    const { api, backing, handleCellEditCommit, handleUserBarGesture, classifyUpdateGestureSpy } =
      makeDataFixture();
    backing.syncing = true;
    // Without the live syncing read this exact event classifies as a cell edit.
    expect(api.fire('update-task', { id: 't1', task: { status: 'done' } })).toBe(true);
    expect(classifyUpdateGestureSpy.mock.results[0]?.value).toEqual({ kind: 'syncing' });
    expect(handleCellEditCommit).not.toHaveBeenCalled();
    expect(handleUserBarGesture).not.toHaveBeenCalled();
  });

  it('passes an echo-tagged event through while syncing is false (R5: echo guard alone)', () => {
    const { api, handleCellEditCommit, handleUserBarGesture, classifyUpdateGestureSpy } =
      makeDataFixture();
    expect(api.fire('update-task', { id: 't1', eventSource: ECHO, task: { status: 'done' } })).toBe(true);
    // 'echo', not 'ignore': a dropped echoSource plumb fails here.
    expect(classifyUpdateGestureSpy.mock.results[0]?.value).toEqual({ kind: 'echo' });
    expect(handleCellEditCommit).not.toHaveBeenCalled();
    expect(handleUserBarGesture).not.toHaveBeenCalled();
  });

  it('keeps an echo-tagged update on a calendar-item row passing so the diff-sync applies (R5: echo guard alone)', () => {
    const { api } = makeDataFixture();
    expect(api.fire('update-task', { id: CAL_ID, eventSource: ECHO, task: { status: 'done' } })).toBe(true);
  });

  it('keeps a syncing-window update on a calendar-item row passing (R5: syncing guard alone)', () => {
    const { api, backing } = makeDataFixture();
    backing.syncing = true;
    expect(api.fire('update-task', { id: CAL_ID, task: { status: 'done' } })).toBe(true);
  });

  it('refuses an untagged user update on a calendar-item row', () => {
    const { api, handleCellEditCommit, handleUserBarGesture } = makeDataFixture();
    expect(api.fire('update-task', { id: CAL_ID, task: { status: 'done' } })).toBe(false);
    expect(handleCellEditCommit).not.toHaveBeenCalled();
    expect(handleUserBarGesture).not.toHaveBeenCalled();
  });

  it('routes a committed cell edit to the commit handler with column and value', () => {
    const { api, storedProperties, handleCellEditCommit } = makeDataFixture();
    storedProperties.set('t1', { status: text('todo') });
    expect(api.fire('update-task', { id: 't1', task: { status: 'done', start: 1, end: 2 } })).toBe(true);
    expect(handleCellEditCommit).toHaveBeenCalledWith('t1', 'status', 'done');
  });

  it('returns the commit handler verdict for a refused cell edit', () => {
    const { api, storedProperties, handleCellEditCommit } = makeDataFixture();
    handleCellEditCommit.mockReturnValue(false);
    storedProperties.set('t1', { status: text('todo') });
    expect(api.fire('update-task', { id: 't1', task: { status: 'done' } })).toBe(false);
  });

  it('returns false for a cell edit without a row id', () => {
    const { api, handleCellEditCommit } = makeDataFixture();
    expect(api.fire('update-task', { task: { status: 'done' } })).toBe(false);
    expect(handleCellEditCommit).not.toHaveBeenCalled();
  });

  it('returns false for a cell-edit no-op without committing', () => {
    const { api, storedProperties, handleCellEditCommit } = makeDataFixture();
    storedProperties.set('t1', { status: text('done') });
    expect(api.fire('update-task', { id: 't1', task: { status: 'done' } })).toBe(false);
    expect(handleCellEditCommit).not.toHaveBeenCalled();
  });

  it('reseeds the row flat keys, notifies, and returns false for an ambiguous cell edit', () => {
    const { api, storedProperties, reseedRowFlatKeys, notify, handleCellEditCommit } = makeDataFixture({
      cellEditColumnIds: ['status', 'priority'],
    });
    storedProperties.set('t1', { status: text('todo'), priority: text('low') });
    expect(api.fire('update-task', { id: 't1', task: { status: 'done', priority: 'high' } })).toBe(false);
    expect(reseedRowFlatKeys).toHaveBeenCalledWith('t1');
    expect(notify).toHaveBeenCalledWith("Couldn't save — the row changed externally; try again.");
    expect(handleCellEditCommit).not.toHaveBeenCalled();
  });

  it('routes a user bar gesture to the gesture handler when writable', () => {
    const { api, handleUserBarGesture } = makeDataFixture();
    const ev = { id: 't1', task: { start: 1, end: 2 } };
    expect(api.fire('update-task', ev)).toBe(true);
    expect(handleUserBarGesture).toHaveBeenCalledWith(ev, 't1');
  });

  it('returns the gesture handler verdict for a refused bar gesture', () => {
    const { api, handleUserBarGesture } = makeDataFixture();
    handleUserBarGesture.mockReturnValue(false);
    expect(api.fire('update-task', { id: 't1', task: { start: 1, end: 2 } })).toBe(false);
  });

  it('passes a user bar gesture through untouched while read-only', () => {
    const { api, handleUserBarGesture } = makeDataFixture({ readOnly: true });
    expect(api.fire('update-task', { id: 't1', task: { start: 1, end: 2 } })).toBe(true);
    expect(handleUserBarGesture).not.toHaveBeenCalled();
  });

  it('passes a user bar gesture through untouched without an onMutate handler', () => {
    const { api, handleUserBarGesture } = makeDataFixture({ withoutOnMutate: true });
    expect(api.fire('update-task', { id: 't1', task: { start: 1, end: 2 } })).toBe(true);
    expect(handleUserBarGesture).not.toHaveBeenCalled();
  });
});

describe('add-link interceptor', () => {
  const validLink = { source: 't1', target: 't2', type: 'e2s' };

  it('passes inProgress frames through', () => {
    const { api, onAddDependency } = makeDataFixture();
    expect(api.fire('add-link', { inProgress: true, link: validLink })).toBe(true);
    expect(onAddDependency).not.toHaveBeenCalled();
  });

  it('passes any event through while syncing with no echo source (R5: syncing guard alone)', () => {
    const { api, backing, onAddDependency, classifyUpdateEventSpy } = makeDataFixture();
    backing.syncing = true;
    expect(api.fire('add-link', { link: validLink })).toBe(true);
    expect(classifyUpdateEventSpy.mock.results[0]?.value).toBe('syncing');
    expect(onAddDependency).not.toHaveBeenCalled();
  });

  it('passes an echo-tagged event through while syncing is false (R5: echo guard alone)', () => {
    const { api, onAddDependency, classifyUpdateEventSpy } = makeDataFixture();
    expect(api.fire('add-link', { eventSource: ECHO, link: validLink })).toBe(true);
    // 'echo', not 'ignore': a dropped echoSource plumb fails here.
    expect(classifyUpdateEventSpy.mock.results[0]?.value).toBe('echo');
    expect(onAddDependency).not.toHaveBeenCalled();
  });

  it('returns false without invoking the callback while read-only', () => {
    const { api, onAddDependency } = makeDataFixture({ readOnly: true });
    expect(api.fire('add-link', { link: validLink })).toBe(false);
    expect(onAddDependency).not.toHaveBeenCalled();
  });

  it('returns false without an add-dependency callback', () => {
    const { api } = makeDataFixture({ withoutOnAddDependency: true });
    expect(api.fire('add-link', { link: validLink })).toBe(false);
  });

  it('returns false without a link payload', () => {
    const { api, onAddDependency } = makeDataFixture();
    expect(api.fire('add-link', {})).toBe(false);
    expect(onAddDependency).not.toHaveBeenCalled();
  });

  it('returns false for a link touching a disallowed endpoint', () => {
    const { api, onAddDependency } = makeDataFixture();
    expect(api.fire('add-link', { link: { source: CAL_ID, target: 't2', type: 'e2s' } })).toBe(false);
    expect(onAddDependency).not.toHaveBeenCalled();
  });

  it('returns false for a link touching a derived-geometry endpoint', () => {
    const { api, derivedGeometryIds, onAddDependency } = makeDataFixture();
    derivedGeometryIds.add('t2');
    expect(api.fire('add-link', { link: validLink })).toBe(false);
    expect(onAddDependency).not.toHaveBeenCalled();
  });

  it('notifies and returns false for a non-finish-to-start geometry', () => {
    const { api, notify, onAddDependency } = makeDataFixture();
    expect(api.fire('add-link', { link: { source: 't1', target: 't2', type: 's2s' } })).toBe(false);
    expect(notify).toHaveBeenCalledWith('Only Finish-to-Start links can be created for now.');
    expect(onAddDependency).not.toHaveBeenCalled();
  });

  it('invokes the add callback with predecessor and dependent for a valid link and returns false', () => {
    const { api, onAddDependency } = makeDataFixture();
    expect(api.fire('add-link', { link: validLink })).toBe(false);
    expect(onAddDependency).toHaveBeenCalledWith('t1', 't2');
  });

  it('notifies when the add callback rejects', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { api, notify, onAddDependency } = makeDataFixture();
      onAddDependency?.mockRejectedValue(new Error('offline'));
      api.fire('add-link', { link: validLink });
      await flushMicrotasks();
      expect(notify).toHaveBeenCalledWith("Couldn't create the dependency — check TaskNotes is running.");
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('delete-link interceptor', () => {
  it('passes a missing event through', () => {
    const { api } = makeDataFixture();
    expect(api.fire('delete-link', undefined)).toBe(true);
  });

  it('passes any event through while syncing with no echo source (R5: syncing guard alone)', () => {
    const { api, backing, appliedLinks, onRemoveDependency, classifyUpdateEventSpy } = makeDataFixture();
    appliedLinks.set('L1', { source: 't1', target: 't2' });
    backing.syncing = true;
    expect(api.fire('delete-link', { id: 'L1' })).toBe(true);
    expect(classifyUpdateEventSpy.mock.results[0]?.value).toBe('syncing');
    expect(onRemoveDependency).not.toHaveBeenCalled();
  });

  it('passes an echo-tagged event through while syncing is false (R5: echo guard alone)', () => {
    const { api, appliedLinks, onRemoveDependency, classifyUpdateEventSpy } = makeDataFixture();
    appliedLinks.set('L1', { source: 't1', target: 't2' });
    expect(api.fire('delete-link', { id: 'L1', eventSource: ECHO })).toBe(true);
    // 'echo', not 'ignore': a dropped echoSource plumb fails here.
    expect(classifyUpdateEventSpy.mock.results[0]?.value).toBe('echo');
    expect(onRemoveDependency).not.toHaveBeenCalled();
  });

  it('returns false while read-only', () => {
    const { api, appliedLinks, onRemoveDependency } = makeDataFixture({ readOnly: true });
    appliedLinks.set('L1', { source: 't1', target: 't2' });
    expect(api.fire('delete-link', { id: 'L1' })).toBe(false);
    expect(onRemoveDependency).not.toHaveBeenCalled();
  });

  it('returns false without a remove-dependency callback', () => {
    const { api, appliedLinks } = makeDataFixture({ withoutOnRemoveDependency: true });
    appliedLinks.set('L1', { source: 't1', target: 't2' });
    expect(api.fire('delete-link', { id: 'L1' })).toBe(false);
  });

  it('returns false without an id', () => {
    const { api, onRemoveDependency } = makeDataFixture();
    expect(api.fire('delete-link', {})).toBe(false);
    expect(onRemoveDependency).not.toHaveBeenCalled();
  });

  it('resolves a leading-colon id through the applied-links lookup', () => {
    const { api, appliedLinks, onRemoveDependency } = makeDataFixture();
    appliedLinks.set('L1', { source: 't1', target: 't2' });
    expect(api.fire('delete-link', { id: ':L1' })).toBe(false);
    expect(onRemoveDependency).toHaveBeenCalledWith('t1', 't2');
  });

  it('returns false for an unresolvable id without invoking the callback', () => {
    const { api, onRemoveDependency } = makeDataFixture();
    expect(api.fire('delete-link', { id: 'missing' })).toBe(false);
    expect(onRemoveDependency).not.toHaveBeenCalled();
  });

  it('returns false when the resolved edge touches a disallowed endpoint', () => {
    const { api, appliedLinks, onRemoveDependency } = makeDataFixture();
    appliedLinks.set('L1', { source: CAL_ID, target: 't2' });
    expect(api.fire('delete-link', { id: 'L1' })).toBe(false);
    expect(onRemoveDependency).not.toHaveBeenCalled();
  });

  it('returns false when the resolved edge touches a derived-geometry endpoint', () => {
    const { api, appliedLinks, derivedGeometryIds, onRemoveDependency } = makeDataFixture();
    appliedLinks.set('L1', { source: 't1', target: 't2' });
    derivedGeometryIds.add('t2');
    expect(api.fire('delete-link', { id: 'L1' })).toBe(false);
    expect(onRemoveDependency).not.toHaveBeenCalled();
  });

  it('invokes the remove callback for a valid resolution and returns false', () => {
    const { api, appliedLinks, onRemoveDependency } = makeDataFixture();
    appliedLinks.set('L1', { source: 't1', target: 't2' });
    expect(api.fire('delete-link', { id: 'L1' })).toBe(false);
    expect(onRemoveDependency).toHaveBeenCalledWith('t1', 't2');
  });

  it('notifies when the remove callback rejects', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { api, appliedLinks, notify, onRemoveDependency } = makeDataFixture();
      appliedLinks.set('L1', { source: 't1', target: 't2' });
      onRemoveDependency?.mockRejectedValue(new Error('offline'));
      api.fire('delete-link', { id: 'L1' });
      await flushMicrotasks();
      expect(notify).toHaveBeenCalledWith("Couldn't remove the dependency — check TaskNotes is running.");
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('liveness of the data-cluster getter deps (R6)', () => {
  it('update-task observes a syncing flip made after wiring', () => {
    const { api, backing, storedProperties, handleCellEditCommit } = makeDataFixture();
    storedProperties.set('t1', { status: text('todo') });
    backing.syncing = true;
    expect(api.fire('update-task', { id: 't1', task: { status: 'done' } })).toBe(true);
    expect(handleCellEditCommit).not.toHaveBeenCalled();
    backing.syncing = false;
    api.fire('update-task', { id: 't1', task: { status: 'done' } });
    expect(handleCellEditCommit).toHaveBeenCalledWith('t1', 'status', 'done');
  });

  it('update-task observes a readOnly flip made after wiring', () => {
    const { api, live, handleUserBarGesture } = makeDataFixture();
    live.readOnly = true;
    api.fire('update-task', { id: 't1', task: { start: 1, end: 2 } });
    expect(handleUserBarGesture).not.toHaveBeenCalled();
    live.readOnly = false;
    api.fire('update-task', { id: 't1', task: { start: 1, end: 2 } });
    expect(handleUserBarGesture).toHaveBeenCalledTimes(1);
  });

  it('add-link observes a readOnly flip made after wiring', () => {
    const { api, live, onAddDependency } = makeDataFixture();
    live.readOnly = true;
    expect(api.fire('add-link', { link: { source: 't1', target: 't2', type: 'e2s' } })).toBe(false);
    expect(onAddDependency).not.toHaveBeenCalled();
    live.readOnly = false;
    api.fire('add-link', { link: { source: 't1', target: 't2', type: 'e2s' } });
    expect(onAddDependency).toHaveBeenCalledTimes(1);
  });

  it('update-task classifies against cellEditColumnIds values changed after wiring', () => {
    const { api, live, storedProperties, handleCellEditCommit, handleUserBarGesture } =
      makeDataFixture({ cellEditColumnIds: [] });
    storedProperties.set('t1', { status: text('todo') });
    // No configured columns: the same payload is a user gesture, not a cell edit.
    api.fire('update-task', { id: 't1', task: { status: 'done' } });
    expect(handleCellEditCommit).not.toHaveBeenCalled();
    expect(handleUserBarGesture).toHaveBeenCalledTimes(1);
    live.cellEditColumnIds = ['status'];
    api.fire('update-task', { id: 't1', task: { status: 'done' } });
    expect(handleCellEditCommit).toHaveBeenCalledWith('t1', 'status', 'done');
  });

  it('delete-link resolves through the applied-links map as it changes after wiring', () => {
    const { api, appliedLinks, onRemoveDependency } = makeDataFixture();
    expect(api.fire('delete-link', { id: 'L1' })).toBe(false);
    expect(onRemoveDependency).not.toHaveBeenCalled();
    appliedLinks.set('L1', { source: 't1', target: 't2' });
    api.fire('delete-link', { id: 'L1' });
    expect(onRemoveDependency).toHaveBeenCalledWith('t1', 't2');
  });
});

describe('view-side wiring shape (R6 accessor-property check, R1 grep gate)', () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), 'src', 'bases', 'GanttContainer.svelte'),
    'utf8',
  );

  it('GanttContainer passes an access object whose census members are accessor properties', () => {
    const literalStart = source.indexOf('const interceptorAccess: InterceptorAccess = {');
    expect(literalStart).toBeGreaterThan(-1);
    const literalEnd = source.indexOf('};', literalStart);
    expect(literalEnd).toBeGreaterThan(literalStart);
    const accessLiteral = source.slice(literalStart, literalEnd);
    for (const member of [
      'syncing',
      'ephemeralSort',
      'collapsedIds',
      'pendingSingleClick',
      'lastCtrlMeta',
      'pointerButtonDown',
      'suppressSelectActivation',
    ]) {
      // The getter body must return the same-named component binding — a
      // wiring-time snapshot or a differently-named source would pass a
      // shape-only check while killing liveness.
      expect(accessLiteral).toMatch(new RegExp(`get ${member}\\(\\)\\s*\\{\\s*return ${member};`));
    }
    for (const written of ['ephemeralSort', 'collapsedIds', 'pendingSingleClick']) {
      // The setter body must assign to the same-named component binding.
      expect(accessLiteral).toMatch(
        new RegExp(`set ${written}\\(value\\)\\s*\\{\\s*${written} = value;`),
      );
    }
    // The call site must pass the accessor object itself — a spread or copy
    // (`{ ...interceptorAccess }`) would snapshot values and kill liveness.
    expect(source).toMatch(/wireSvarInterceptors\(\s*ganttApi,\s*interceptorAccess,\s*interceptorDeps\s*\)/);
  });

  it('GanttContainer passes the reactive $derived reads as live getter-valued deps', () => {
    const literalStart = source.indexOf('const interceptorDeps: SvarInterceptorDeps = {');
    expect(literalStart).toBeGreaterThan(-1);
    const depsLiteral = source.slice(literalStart, source.indexOf('wireSvarInterceptors', literalStart));
    // Arrow bodies reading the same-named `$derived` binding at event time —
    // `isReadOnly: readOnly` (a value) would freeze the policy at wiring.
    expect(depsLiteral).toMatch(/isReadOnly:\s*\(\)\s*=>\s*readOnly\b/);
    expect(depsLiteral).toMatch(/cellEditColumnIds:\s*\(\)\s*=>\s*cellEditColumnIds\b/);
  });

  it('GanttContainer contains no intercept call site (R1 grep gate)', () => {
    // Any receiver counts — `initGantt` holds the api as `ganttApi`, so a
    // literal 'api.intercept' check would let `ganttApi.intercept(...)`
    // silently escape the centralized seam.
    expect(/\.intercept\s*\(/.test(source)).toBe(false);
  });
});
