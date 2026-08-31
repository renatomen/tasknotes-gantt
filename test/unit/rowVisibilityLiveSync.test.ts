/**
 * Requirement: a live refresh never leaves the row-visibility filter deciding from
 * a value the store has stopped agreeing with.
 *
 * Each module is individually correct — the expander flags the duplicate, the shaper
 * copies the flag, the predicate hides a flagged row — and only the composition is
 * stale, so these specs drive expansion → shaping → diff → store → filter and assert
 * what the user is left looking at rather than a fingerprint.
 *
 * Two halves. A staleness property proves, per scenario, that the store holds what a
 * fresh reopen would compute. A routing table proves no field escapes that property
 * silently: it is keyed on the predicate input's own type, so a member added tomorrow
 * does not compile until its route to the store is recorded — folded into the
 * fingerprint, or borne by the row id with the reason a stale value is unreachable.
 *
 * The folded-field census in `ganttSync`'s spec is a weaker guarantee and does not stand
 * in for this one: it forces that SOME decision is recorded per `custom` field, never
 * that the decision suits the visibility filter — and `effect: 'ignored'`, which asserts
 * the fingerprint must NOT move, is precisely the wrong decision for a field the filter
 * reads. Measured: a filter-read field recorded there as ignored passes the whole suite.
 *
 * The route is recorded against a TYPE rather than discovered by running the projection.
 * Three successive runtime derivations were tried and each was evaded — by a nested
 * member, then by one the predicate consumed without the projection supplying it, then by
 * one read only behind a branch a probe never entered. A probe sees the fields some call
 * happens to touch; `keyof` sees the ones that exist.
 *
 * What a green run does NOT earn, in two parts. It stops at the coordinator's injected
 * port, so SVAR's own store and its `filter-tasks` walk over the updated row stay
 * unproven. And the completeness rule pins only what the PROJECTION reads: a member the
 * predicate consumes that the projection never supplies is invisible to it, because
 * nothing here observes that coupling. The predicate then reads `undefined` for that
 * member — an inert field rather than a stale one, so it is a different defect from the
 * one these specs exist for, but it is currently unguarded. Closing it means the
 * predicate taking the store's own record shape instead of a second hand-written one,
 * which deletes the coupling rather than asserting it.
 *
 * Both halves read the store through {@link toRowVisibilityInput}, the same projection
 * the view applies. Writing that mapping out again here would make this file a second
 * implementation of the thing under test — which is how an earlier guard stayed green
 * while the defect it named was live.
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
import { buildSvarTasks, taskStateKey, type SvarTask } from '../../src/bases/ganttSync';
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
  type RowVisibilitySource,
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
 * A vault edit that moves exactly one member of the visibility projection on a row the
 * diff treats as existing, driving the real expander and shaper for each state.
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
];

/** Every row's visibility projection, by row id. */
function projections(rows: Iterable<SvarTask>): Map<string, RowVisibilityInput> {
  return new Map([...rows].map((row) => [row.id, toRowVisibilityInput(row.custom)]));
}

/** How the store delivers a change to one field the visibility predicate's input carries. */
type FieldDelivery =
  | { delivery: 'fingerprint' }
  | { delivery: 'row-identity'; why: string };

/**
 * Every member of the projection's input, and the route by which a change to it reaches
 * the store.
 *
 * Keyed `Record<keyof RowVisibilitySource, ...>`, so a member added to that interface — or
 * to the switcher source it extends — does not COMPILE until its route is recorded. The
 * member list is the type's, never one kept here by hand.
 *
 * A type is the right instrument for this and runtime introspection is not: a probe can
 * only observe the fields some particular call happens to touch, so a field read behind a
 * branch, or reached through a copy, escapes it silently. `keyof` cannot be evaded that
 * way.
 */
const FIELD_DELIVERY: Record<keyof RowVisibilitySource, FieldDelivery> = {
  isTopLevelPlacement: { delivery: 'fingerprint' },
  dateStatus: { delivery: 'fingerprint' },
  hasRecurringOccupancy: { delivery: 'fingerprint' },
  calendarItemFamily: {
    delivery: 'row-identity',
    why: 'the row synthetic id embeds the family, so a change arrives as an add plus a delete and no row survives one in place',
  },
};

/**
 * `true` only while `keyof RowVisibilitySource` is a literal union.
 *
 * An index signature on that interface — or on the switcher source it extends — widens
 * `keyof` to `string`, which turns the table below into an index-signature record that
 * any set of entries satisfies. The completeness gate would then be off with nothing
 * failing, so the degeneration is caught here instead, at compile time.
 */
type LiteralKeys<T> = string extends keyof T ? never : true;
const SOURCE_KEYS_ARE_LITERAL: LiteralKeys<RowVisibilitySource> = true;

const fingerprinted = Object.entries(FIELD_DELIVERY)
  .filter(([, route]) => route.delivery === 'fingerprint')
  .map(([field]) => field);

/** A value guaranteed to differ from `current`, whatever shape the field holds. */
function perturbedValue(current: unknown): unknown {
  if (current === true) return false;
  if (current === false || current === undefined) return true;
  return '__og-perturbed__';
}

describe('every field the visibility filter reads reaches the store', () => {
  const baseRow = (): SvarTask => rowsFor([task({ path: 'X.md' })])[0]!;

  it('keys the routing table on a literal member list', () => {
    // Guards the guard: the assertion that matters is the type above, which stops
    // compiling if `keyof` widens. This case exists so the protection is visible in the
    // run rather than living only in a declaration nothing references.
    expect(SOURCE_KEYS_ARE_LITERAL).toBe(true);
  });

  it('routes every declared field, and has fields left to assert on', () => {
    // Falsifiable rather than a count of the record against itself: a third delivery kind
    // added to `FieldDelivery` would run no assertion, so its members would vanish from
    // the block below with nothing failing. The second expectation is the vacuity floor —
    // routing every field to `row-identity` would otherwise leave an empty table and a
    // green describe whose name still claims the fold is checked.
    const routed = Object.values(FIELD_DELIVERY).filter(
      (route) => route.delivery === 'fingerprint' || route.delivery === 'row-identity',
    );
    expect(routed).toHaveLength(Object.keys(FIELD_DELIVERY).length);
    expect(fingerprinted.length).toBeGreaterThan(0);
  });

  it.each(fingerprinted)('folds custom.%s, so a change to it re-issues the row', (field) => {
    const base = baseRow();
    const current = (base.custom as unknown as Record<string, unknown>)[field];
    const moved: SvarTask = {
      ...base,
      custom: { ...base.custom, [field]: perturbedValue(current) },
    };
    expect(perturbedValue(current)).not.toEqual(current);
    expect(taskStateKey(moved)).not.toBe(taskStateKey(base));
  });
});

describe('a live refresh leaves no row-visibility input stale', () => {
  describe.each(SCENARIOS)('$name', (scenario) => {
    const before = scenario.rows('before');
    const after = scenario.rows('after');

    it(`moves ${scenario.field} between the two vault states`, () => {
      // The floor. Without it the property below passes vacuously on a scenario that
      // stopped exercising the member it claims — the failure mode that let the Hide-top
      // guard above go green with the predicate entirely dead.
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
