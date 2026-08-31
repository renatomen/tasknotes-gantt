/**
 * Requirement: a live refresh never leaves the row-visibility filter deciding from
 * a value the store has stopped agreeing with.
 *
 * Each module is individually correct — the expander flags the duplicate, the shaper
 * copies the flag, the predicate hides a flagged row — and only the composition is
 * stale, so these specs drive expansion → shaping → diff → store → filter and assert
 * what the user is left looking at rather than a fingerprint.
 *
 * The first block is the Hide-top example, asserted as a VISIBLE ROW SET (#469). The
 * second is the general rule the example is one case of (#470): for EVERY member of
 * `RowVisibilityInput`, the projection the store holds after a live refresh equals the
 * projection a fresh reopen would compute. It is stated over the members
 * {@link toRowVisibilityInput} actually produces, so a member added tomorrow is covered
 * without editing a list — and a member added with no scenario fails the coverage
 * check rather than passing silently.
 *
 * Both blocks read the store through {@link toRowVisibilityInput}, the same projection
 * the view applies. Writing that mapping out again here would make this file a second
 * implementation of the thing under test, which is how #469's guard passed while the
 * defect it named was live.
 */

import { describe, it, expect } from '@jest/globals';
import {
  expandInstances,
  type ExpandableTask,
  type RenderInstance,
} from '../../src/controller/InstanceExpansion';
import type { RenderLink } from '../../src/controller/InstanceExpansion';
import { applyDatePolicy } from '../../src/controller/datePolicy';
import type { SourceTask } from '../../src/datasource/types';
import type { CalendarOccupancy } from '../../src/datasource/calendarItems/types';
import { buildSvarTasks, type SvarTask } from '../../src/bases/ganttSync';
import {
  applyIncrementalGanttSync,
  createAppliedGanttSyncState,
  createGanttSeedSnapshot,
  planGanttSync,
} from '../../src/bases/ganttSyncCoordinator';
import type { GanttSyncPort } from '../../src/bases/ganttSyncPort';
import {
  shouldHideRow,
  toRowVisibilityInput,
  type RowVisibilityFlags,
  type RowVisibilityInput,
} from '../../src/bases/rowVisibility';

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

/** Shape resolved instances into rows exactly as a refresh would. */
function shape(
  instances: readonly RenderInstance[],
  options: { showDateIndicators?: boolean; hideTopLevel?: boolean } = {},
): SvarTask[] {
  return buildSvarTasks({
    instances: [...instances],
    links: [],
    statusColors: [],
    showDateIndicators: options.showDateIndicators ?? true,
    arrowMode: 'primary',
    hideTopLevelSubtasks: options.hideTopLevel ?? false,
  });
}

/** Expand + shape one vault state into the rows a refresh would hand the chart. */
function rowsFor(
  tasks: readonly ExpandableTask[],
  options: { showDateIndicators?: boolean; hideTopLevel?: boolean } = {},
): SvarTask[] {
  return shape(expandInstances(tasks).instances, options);
}

/** Open the view on `before`, then refresh it with `after` exactly as the view does. */
function liveRefresh(before: readonly SvarTask[], after: readonly SvarTask[]): Map<string, SvarTask> {
  const store = new Map(before.map((row) => [row.id, row]));
  const links: RenderLink[] = [];
  const applied = createAppliedGanttSyncState(
    createGanttSeedSnapshot({ tasks: [...before], links, cellEditColumnIds: [] }),
    '',
  );
  applyIncrementalGanttSync({
    plan: planGanttSync({ next: [...after], links, applied, baseSortKey: '' }),
    port: storeBackedPort(store),
    state: applied,
    ephemeralSort: INERT_SORT,
  });
  return store;
}

/** The ids left on screen once the composed row-visibility filter has run. */
function visibleIds(rows: Iterable<SvarTask>): string[] {
  return [...rows]
    .filter((row) => !shouldHideRow(toRowVisibilityInput(row.custom), HIDE_TOP_ON))
    .map((row) => row.id)
    .sort();
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

  const visibleAfterLiveRefresh = (
    before: readonly ExpandableTask[],
    after: readonly ExpandableTask[],
  ): string[] =>
    visibleIds(
      liveRefresh(
        rowsFor(before, { hideTopLevel: true }),
        rowsFor(after, { hideTopLevel: true }),
      ).values(),
    );

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
    expect(visibleIds(rowsFor(nested, { hideTopLevel: true }))).toEqual(NESTED_VISIBLE);
  });
});

/**
 * A scenario moves exactly one member of the visibility projection between two vault
 * states, driving the real expander and shaper for each.
 */
interface StalenessScenario {
  /** The `RowVisibilityInput` member this scenario moves. */
  field: keyof RowVisibilityInput;
  name: string;
  rows: (phase: 'before' | 'after') => SvarTask[];
}

/** A due-only task and the same task once its inferred start is authored. */
function datedTask(start: Date | null, end: Date | null): ExpandableTask {
  const resolved = applyDatePolicy({ start, end }, { defaultDuration: 1, today: new Date(2026, 0, 1) });
  return {
    ...task({ path: 'D.md' }),
    start: resolved.start,
    end: resolved.end,
    dateStatus: resolved.dateStatus,
  };
}

/** One recorded recurring-instance occupancy, the switcher's `hasRecurringOccupancy` input. */
function recurringOccupancy(day: string): CalendarOccupancy {
  return {
    family: 'recurring-instance',
    itemId: `recurring-instance::R.md::${day}`,
    day,
    minutes: null,
    stateClass: 'completed',
  };
}

const DUE = new Date(2026, 3, 20);

const SCENARIOS: StalenessScenario[] = [
  {
    field: 'isTopLevelPlacement',
    name: 'a note gains a parent, turning its root row into a duplicate placement',
    rows: (phase) =>
      rowsFor(
        phase === 'before'
          ? [task({ path: 'P.md' }), task({ path: 'C.md' })]
          : [task({ path: 'P.md' }), { ...task({ path: 'C.md', parents: ['P.md'] }), alsoTopLevel: true }],
        { hideTopLevel: true },
      ),
  },
  {
    field: 'dateStatus',
    name: 'a due-only task has its inferred start authored, with indicators off',
    // The span the policy already inferred is authored verbatim, so start, end and the
    // composed `type` are byte-identical across the edit. With indicators off the state
    // token is `undefined` on both sides too, which leaves `dateStatus` itself as the
    // only thing that moved — the row re-issues only if it is folded.
    rows: (phase) =>
      rowsFor([phase === 'before' ? datedTask(null, DUE) : datedTask(DUE, DUE)], {
        showDateIndicators: false,
      }),
  },
  {
    field: 'source',
    name: 'a recurring family starts occupying a task row',
    // Occupancy is merged onto instances AFTER expansion (the controller's calendar-item
    // stage), so the scenario attaches it at the shaper's input, where the real one does.
    rows: (phase) => {
      const instances = [...expandInstances([task({ path: 'R.md' })]).instances];
      return shape(
        phase === 'before'
          ? instances
          : instances.map((instance) => ({ ...instance, occupancy: [recurringOccupancy('2026-01-01')] })),
      );
    },
  },
];

/** Every row's visibility projection, by row id. */
function projections(rows: Iterable<SvarTask>): Map<string, RowVisibilityInput> {
  return new Map([...rows].map((row) => [row.id, toRowVisibilityInput(row.custom)]));
}

describe('a live refresh leaves no row-visibility input stale', () => {
  it('has a scenario for every member of the visibility projection', () => {
    // Derived from the projection itself, not from a list kept by hand: a member added
    // to `RowVisibilityInput` and `toRowVisibilityInput` fails here until it has a
    // scenario proving a live refresh carries it.
    const members = Object.keys(toRowVisibilityInput(undefined)).sort();
    expect([...new Set(SCENARIOS.map((scenario) => scenario.field))].sort()).toEqual(members);
  });

  describe.each(SCENARIOS)('$name', (scenario) => {
    const before = scenario.rows('before');
    const after = scenario.rows('after');

    it(`moves ${scenario.field} between the two vault states`, () => {
      // The floor. Without it the property below passes vacuously on a scenario that
      // stopped exercising the member it claims — the failure mode that let #469's
      // first guard go green with the predicate entirely dead.
      //
      // Only rows present in BOTH states count. A scenario that merely ADDS rows says
      // nothing about whether the named member can go stale: a fresh row reaches the
      // store through the add path carrying whatever the shaper just computed, so
      // counting additions would let this pass with the member never changing at all.
      const from = projections(before);
      const to = projections(after);
      const moved = [...to].some(
        ([id, projection]) =>
          from.has(id) &&
          JSON.stringify(from.get(id)?.[scenario.field]) !== JSON.stringify(projection[scenario.field]),
      );
      expect(moved).toBe(true);
    });

    it('leaves the store holding exactly what a fresh reopen would compute', () => {
      expect(projections(liveRefresh(before, after).values())).toEqual(projections(after));
    });
  });
});
