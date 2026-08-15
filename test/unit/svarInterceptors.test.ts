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
  wireInteractionInterceptors,
  type InteractionInterceptorDeps,
  type InterceptorAccess,
} from '../../src/bases/svarInterceptors';
import type { EphemeralSort } from '../../src/bases/sortCycle';
import * as fs from 'fs';
import * as path from 'path';

const ECHO = 'og-self';
const CAL_ID = 'og-calendar://feed/item-1';

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

function makeFixture(overrides: Partial<Backing> = {}) {
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
      const pending = setTimeout(() => undefined, 250);
      const { api, backing } = makeFixture({ pendingSingleClick: pending });
      api.fire('show-editor', { id: 't1' });
      expect(backing.pendingSingleClick).toBeNull();
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
      const pending = setTimeout(() => undefined, 250);
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
      const pending = setTimeout(stale, 250);
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
});

describe('view-side wiring shape (R6 accessor-property check)', () => {
  it('GanttContainer passes an access object whose census members are accessor properties', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'src', 'bases', 'GanttContainer.svelte'),
      'utf8',
    );
    const literalStart = source.indexOf('const interactionAccess: InterceptorAccess = {');
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
      expect(accessLiteral).toMatch(new RegExp(`get ${member}\\(\\)`));
    }
    for (const written of ['ephemeralSort', 'collapsedIds', 'pendingSingleClick']) {
      expect(accessLiteral).toMatch(new RegExp(`set ${written}\\(`));
    }
    // The call site must pass the accessor object itself — a spread or copy
    // (`{ ...interactionAccess }`) would snapshot values and kill liveness.
    expect(source).toMatch(/wireInteractionInterceptors\(\s*ganttApi,\s*interactionAccess,\s*interactionDeps\s*\)/);
  });
});
