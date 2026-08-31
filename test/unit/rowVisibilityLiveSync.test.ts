/**
 * Requirement (#469): with "Hide top-level subtasks" ON, the removable top-level
 * copy of a note that gains a parent WHILE THE VIEW IS OPEN stops occupying a row.
 *
 * The view never re-seeds SVAR's `tasks` array on a refresh — that would re-init the
 * store and throw away zoom/scroll. It diffs (`planGanttSync`), execs the resulting
 * ops (`applyIncrementalGanttSync`), and then re-applies the composed `filter-tasks`
 * predicate over whatever the store now holds. So a field the predicate READS is only
 * ever as fresh as the diff that carried it there: a field the fingerprint does not
 * fold produces no `update-task`, and the filter keeps deciding on the state the row
 * was seeded with.
 *
 * That staleness is invisible to every module on its own — the expander flags the
 * duplicate correctly, the shaper copies the flag correctly, and the predicate hides
 * a flagged row correctly. Only the composition is wrong. So this spec drives the real
 * chain: expansion → SVAR shaping → diff → store → filter. It asserts the VISIBLE ROW
 * SET, never a fingerprint, so it cannot be satisfied by any particular fold shape.
 *
 * It stays at the fastest tier — no SVAR, no Obsidian — because the coordinator
 * takes an injected port, and that port IS the view's real apply path: the test
 * drives the mechanism rather than standing a second plan applier up beside it.
 */

import { describe, it, expect } from '@jest/globals';
import { expandInstances } from '../../src/controller/InstanceExpansion';
import type { RenderLink } from '../../src/controller/InstanceExpansion';
import type { SourceTask } from '../../src/datasource/types';
import { buildSvarTasks, type SvarTask } from '../../src/bases/ganttSync';
import {
  applyIncrementalGanttSync,
  createAppliedGanttSyncState,
  createGanttSeedSnapshot,
  planGanttSync,
} from '../../src/bases/ganttSyncCoordinator';
import type { GanttSyncPort } from '../../src/bases/ganttSyncPort';
import { shouldHideRow, type RowVisibilityFlags } from '../../src/bases/rowVisibility';

/** The toggle under test is ON; the other row-visibility options show everything. */
const HIDE_TOP_ON: RowVisibilityFlags = {
  hideTopLevel: true,
  showUndated: true,
  showPartial: true,
};

/** Concise SourceTask factory, matching `InstanceExpansion.test.ts`. */
function task(partial: Partial<SourceTask> & { path: string }): SourceTask {
  return {
    text: partial.path,
    start: new Date(2026, 0, 1),
    end: new Date(2026, 0, 2),
    progress: null,
    status: null,
    priority: null,
    parents: [],
    ...partial,
  };
}

/**
 * The rows SVAR is actually holding. Separate from the coordinator's diff baseline
 * on purpose: the defect is that the two agree while both trail reality, so a test
 * that read the baseline could not tell a fresh screen from a stale one.
 */
function storeBackedPort(store: Map<string, SvarTask>): GanttSyncPort {
  return {
    hasTask: (id) => store.has(id),
    moveTaskToParent(id, parentId): void {
      const current = store.get(id);
      if (current) store.set(id, { ...current, parent: parentId === 0 ? undefined : parentId });
    },
    updateTask(id, value): void {
      store.set(id, value);
    },
    deleteLink(): void {},
    deleteTask(id): void {
      store.delete(id);
    },
    addTask(value): void {
      store.set(value.id, value);
    },
    addLink(): void {},
    moveTaskAfter(): void {},
  };
}

const INERT_SORT = { isActive: () => false, reassert: (): void => {}, clear: (): void => {} };

/** Expand + shape one vault state into the rows a refresh would hand the chart. */
function rowsFor(tasks: readonly SourceTask[]): SvarTask[] {
  return buildSvarTasks({
    instances: [...expandInstances(tasks).instances],
    links: [],
    statusColors: [],
    showDateIndicators: true,
    arrowMode: 'primary',
    hideTopLevelSubtasks: HIDE_TOP_ON.hideTopLevel,
  });
}

/** The ids left on screen once the composed row-visibility filter has run. */
function visibleIds(store: ReadonlyMap<string, SvarTask>): string[] {
  return [...store.values()]
    .filter((row) => !shouldHideRow(row.custom, HIDE_TOP_ON))
    .map((row) => row.id)
    .sort();
}

/**
 * Open the view on `before`, then refresh it with `after` exactly as the view does,
 * and report what the user is left looking at.
 */
function visibleAfterLiveRefresh(
  before: readonly SourceTask[],
  after: readonly SourceTask[],
): string[] {
  const seeded = rowsFor(before);
  const store = new Map(seeded.map((row) => [row.id, row]));
  const links: RenderLink[] = [];

  const applied = createAppliedGanttSyncState(
    createGanttSeedSnapshot({ tasks: seeded, links, cellEditColumnIds: [] }),
    '',
  );

  applyIncrementalGanttSync({
    plan: planGanttSync({ next: rowsFor(after), links, applied, baseSortKey: '' }),
    port: storeBackedPort(store),
    state: applied,
    ephemeralSort: INERT_SORT,
  });

  return visibleIds(store);
}

describe('Hide top-level subtasks — a live parenting edit', () => {
  // C is matched by the Base throughout; the ONLY thing the edit changes is that it
  // gains a parent. That turns its existing root row into the removable top-level
  // DUPLICATE of the newly nested copy — and the duplicate keeps the row id the
  // genuine root had, so the diff sees an existing row rather than a new one.
  const P = task({ path: 'P.md' });
  const G = task({ path: 'G.md', parents: ['C.md'] });
  const beforeEdit = [P, { ...task({ path: 'C.md' }), alsoTopLevel: true }, G];
  const afterEdit = [P, { ...task({ path: 'C.md', parents: ['P.md'] }), alsoTopLevel: true }, G];

  it('hides the whole duplicate placement — its root row AND its subtree', () => {
    expect(visibleAfterLiveRefresh(beforeEdit, afterEdit)).toEqual([
      'C.md#parent-P.md',
      'G.md#parent-C.md#parent-P.md',
      'P.md',
    ]);
  });

  it('reopening the view on the same data shows exactly what the live refresh should', () => {
    // The self-heal path: a fresh seed has no stale rows to carry, so it is the
    // independent statement of what the live refresh above owes the user. If these
    // two disagree, the chart depends on how the user got there.
    const reopened = new Map(rowsFor(afterEdit).map((row) => [row.id, row]));
    expect(visibleAfterLiveRefresh(beforeEdit, afterEdit)).toEqual(visibleIds(reopened));
  });
});
