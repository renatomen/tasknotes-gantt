/**
 * Requirement: with "Hide top-level subtasks" ON, the removable top-level copy of a
 * note whose parenting changes WHILE THE VIEW IS OPEN stops occupying a row — and
 * comes back when the note is un-nested again.
 *
 * Each module is individually correct — the expander flags the duplicate, the shaper
 * copies the flag, the predicate hides a flagged row — and only the composition is
 * stale, so this spec drives expansion → shaping → diff → store → filter and asserts
 * the VISIBLE ROW SET rather than a fingerprint.
 *
 * What a green run here does NOT earn: it stops at the coordinator's injected port, so
 * SVAR's own store and filter walk are unproven, and so is the view's hand-written
 * mapping from a row's `custom` record to the predicate's input — dropping a field from
 * THAT literal reintroduces this defect with this spec still green.
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
  // C is matched by the Base throughout; the ONLY thing an edit changes is whether it
  // has a parent. Gaining one turns its existing root row into the removable top-level
  // DUPLICATE of the newly nested copy — and the duplicate keeps the row id the genuine
  // root had, so the diff sees an existing row rather than a new one. `alsoTopLevel` is
  // set only on the nested shape because the resolver derives it from having a displayed
  // parent; a parentless task never carries it.
  const P = task({ path: 'P.md' });
  const G = task({ path: 'G.md', parents: ['C.md'] });
  const unNested = [P, task({ path: 'C.md' }), G];
  const nested = [P, { ...task({ path: 'C.md', parents: ['P.md'] }), alsoTopLevel: true }, G];

  /** Every row of the duplicate placement is gone; the genuine nesting remains. */
  const NESTED_VISIBLE = ['C.md#parent-P.md', 'G.md#parent-C.md#parent-P.md', 'P.md'];
  /** Un-nested, nothing is a duplicate, so Hide-top hides nothing. */
  const UN_NESTED_VISIBLE = ['C.md', 'G.md#parent-C.md', 'P.md'];

  it('hides the whole duplicate placement — its root row AND its subtree', () => {
    expect(visibleAfterLiveRefresh(unNested, nested)).toEqual(NESTED_VISIBLE);
  });

  it('restores the rows again when the note is un-nested', () => {
    // The opposite direction rides the same fold, and its failure is worse: the rows
    // stay FLAGGED and therefore stay hidden, so the data is invisible rather than
    // merely duplicated.
    expect(visibleAfterLiveRefresh(nested, unNested)).toEqual(UN_NESTED_VISIBLE);
  });

  it('hides the duplicate on a fresh reopen too, with no diff involved', () => {
    // The path the user reaches by closing and reopening the view. A fresh seed carries
    // no stale rows, so it owes the same answer without the diff — which is what makes
    // the two cases above a bug rather than the design.
    const reopened = new Map(rowsFor(nested).map((row) => [row.id, row]));
    expect(visibleIds(reopened)).toEqual(NESTED_VISIBLE);
  });
});
