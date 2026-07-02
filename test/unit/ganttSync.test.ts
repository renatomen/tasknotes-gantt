/**
 * ganttSync unit tests (Bug B — preserve zoom/scroll via targeted SVAR updates).
 *
 * Pure transform + diff layer driving `api.exec("update/add/move/delete-task")`
 * instead of replacing SVAR's tasks array (which re-inits the store and resets
 * the view). Covers:
 * - buildSvarTasks: parent→summary/open, leaf type composition (date-status flag
 *   + status-color class), custom metadata (showHasDeps by arrow mode).
 * - buildTreatmentTaskTypes: stable palette-derived superset (flag, treatment class, composed).
 * - planTaskSync: change detection, parent-first adds, leaf-first deletes, moves.
 * - planLinkSync: add/delete by id.
 */

import { describe, it, expect } from '@jest/globals';
import {
  buildSvarTasks,
  buildTreatmentTaskTypes,
  planTaskSync,
  planLinkSync,
  planReorder,
  baseSortDescriptor,
  taskStateKey,
  shouldBulkReseed,
  structuralOpCount,
  BULK_RESEED_OP_THRESHOLD,
  DATE_STATUS_TYPE,
  buildInstanceCueTaskTypes,
  REPLICATED_TYPE,
  CONTEXT_TYPE,
  type SvarTask,
  type SvarTaskInputs,
  type TaskSyncPlan,
  type LinkSyncPlan,
} from '../../src/bases/ganttSync';
import { statusSlug, prioritySlug, PARENT_ROLE_CLASS } from '../../src/bases/barTreatment';
import type { RenderInstance, RenderLink } from '../../src/controller/InstanceExpansion';
import type { PriorityColor, StatusColor } from '../../src/datasource/types';
import type { TypedValue } from '../../src/bases/propertyValues';

/** Minimal RenderInstance factory with sane defaults. */
function inst(over: Partial<RenderInstance> & { id: string }): RenderInstance {
  return {
    id: over.id,
    sourcePath: over.sourcePath ?? `${over.id}.md`,
    text: over.text ?? over.id,
    start: over.start ?? new Date(2026, 0, 1),
    end: over.end ?? new Date(2026, 0, 2),
    progress: over.progress ?? 0,
    parent: over.parent,
    isVirtual: over.isVirtual ?? false,
    isCollapsed: over.isCollapsed ?? false,
    dateStatus: over.dateStatus ?? 'complete',
    status: over.status ?? null,
    priority: over.priority ?? null,
    isFetched: over.isFetched ?? false,
    isTopLevelPlacement: over.isTopLevelPlacement ?? false,
  };
}

function inputs(over: Partial<SvarTaskInputs>): SvarTaskInputs {
  return {
    instances: over.instances ?? [],
    links: over.links ?? [],
    statusColors: over.statusColors ?? [],
    priorityColors: over.priorityColors,
    // Default to the status source so the pre-existing status-class assertions
    // (which pass statusColors without a source) keep their meaning; the new
    // per-source tests below override this explicitly.
    barColorSource: over.barColorSource ?? 'status',
    barIconSource: over.barIconSource,
    showDateIndicators: over.showDateIndicators ?? true,
    arrowMode: over.arrowMode ?? 'primary',
    hideTopLevelSubtasks: over.hideTopLevelSubtasks ?? false,
    propertyValues: over.propertyValues,
    collapsedIds: over.collapsedIds,
  };
}

function mapOf(tasks: SvarTask[]): Map<string, SvarTask> {
  return new Map(tasks.map((t) => [t.id, t]));
}

describe('buildSvarTasks', () => {
  it('renders a parent as an ordinary task at its own dates (not a summary) but keeps it open', () => {
    const start = new Date(2026, 0, 1);
    const end = new Date(2026, 0, 5);
    const tasks = buildSvarTasks(
      inputs({ instances: [inst({ id: 'p', start, end }), inst({ id: 'c', parent: 'p' })] }),
    );
    const parent = tasks.find((t) => t.id === 'p')!;
    const child = tasks.find((t) => t.id === 'c')!;
    // Not a summary — shows its own dates, fully draggable, clean date-writes.
    expect(parent.type).not.toBe('summary');
    expect(parent.start).toEqual(start);
    expect(parent.end).toEqual(end);
    expect(parent.open).toBe(true);
    expect(child.parent).toBe('p');
  });

  it('seeds a parent open by default but closed when in collapsedIds (U7)', () => {
    const instances = [inst({ id: 'p' }), inst({ id: 'c', parent: 'p' })];
    const open = buildSvarTasks(inputs({ instances }));
    expect(open.find((t) => t.id === 'p')!.open).toBe(true);
    const closed = buildSvarTasks(inputs({ instances, collapsedIds: new Set(['p']) }));
    expect(closed.find((t) => t.id === 'p')!.open).toBe(false);
  });

  it('applies the status-color class to a parent (parents are ordinary bars)', () => {
    const colors: StatusColor[] = [{ value: 'wip', color: '#abc', isCompleted: false }];
    const tasks = buildSvarTasks(
      inputs({
        instances: [inst({ id: 'p', status: 'wip' }), inst({ id: 'c', parent: 'p' })],
        statusColors: colors,
      }),
    );
    expect(tasks.find((t) => t.id === 'p')!.type).toContain(statusSlug('wip'));
  });

  it('flags a non-complete leaf with the date-status type only', () => {
    const [t] = buildSvarTasks(inputs({ instances: [inst({ id: 'a', dateStatus: 'inferred' })] }));
    expect(t.type).toBe(DATE_STATUS_TYPE);
  });

  it('does not flag when date indicators are off', () => {
    const [t] = buildSvarTasks(
      inputs({ instances: [inst({ id: 'a', dateStatus: 'inferred' })], showDateIndicators: false }),
    );
    expect(t.type).toBe('task');
  });

  it('composes the date-status flag with the status-color class (flag first)', () => {
    const colors: StatusColor[] = [{ value: 'wip', color: '#abc', isCompleted: false }];
    const [t] = buildSvarTasks(
      inputs({
        instances: [inst({ id: 'a', dateStatus: 'inferred', status: 'wip' })],
        statusColors: colors,
      }),
    );
    expect(t.type).toBe(`${DATE_STATUS_TYPE} ${statusSlug('wip')}`);
  });

  it('omits a status class when the status has no configured color', () => {
    const [t] = buildSvarTasks(
      inputs({ instances: [inst({ id: 'a', status: 'unmapped' })], statusColors: [] }),
    );
    expect(t.type).toBe('task');
  });

  it('applies the priority slug for source=priority', () => {
    const priorityColors: PriorityColor[] = [{ value: 'high', color: '#f00' }];
    const [t] = buildSvarTasks(
      inputs({
        instances: [inst({ id: 'a', priority: 'high' })],
        barColorSource: 'priority',
        priorityColors,
      }),
    );
    expect(t.type).toBe(prioritySlug('high'));
  });

  it('applies og-parent to a parent (not a child) for source=theme', () => {
    const tasks = buildSvarTasks(
      inputs({
        instances: [inst({ id: 'p' }), inst({ id: 'c', parent: 'p' })],
        barColorSource: 'theme',
      }),
    );
    expect(tasks.find((t) => t.id === 'p')!.type).toContain(PARENT_ROLE_CLASS);
    expect(tasks.find((t) => t.id === 'c')!.type).not.toContain(PARENT_ROLE_CLASS);
  });

  it('source=default applies og-parent to a parent, nothing to a leaf (role coloring)', () => {
    const colors: StatusColor[] = [{ value: 'wip', color: '#abc', isCompleted: false }];
    const tasks = buildSvarTasks(
      inputs({
        instances: [inst({ id: 'p', status: 'wip' }), inst({ id: 'c', parent: 'p' })],
        statusColors: colors,
        barColorSource: 'default',
      }),
    );
    // Role coloring keys off hierarchy, not the status palette.
    expect(tasks.find((t) => t.id === 'p')!.type).toContain(PARENT_ROLE_CLASS);
    expect(tasks.find((t) => t.id === 'c')!.type).toBe('task');
  });

  it('attaches custom.barIcon from the icon source, null when none', () => {
    const colors: StatusColor[] = [{ value: 'wip', color: '#abc', isCompleted: false, icon: 'circle' }];
    const withIcon = buildSvarTasks(
      inputs({ instances: [inst({ id: 'a', status: 'wip' })], statusColors: colors, barIconSource: 'status' }),
    )[0];
    expect(withIcon.custom.barIcon).toEqual({ kind: 'status', iconName: 'circle', color: '#abc' });

    const noIcon = buildSvarTasks(
      inputs({ instances: [inst({ id: 'a', status: 'wip' })], statusColors: colors, barIconSource: 'none' }),
    )[0];
    expect(noIcon.custom.barIcon).toBeNull();
  });

  it('taskStateKey changes when the icon source toggles (re-sync guard)', () => {
    const colors: StatusColor[] = [{ value: 'wip', color: '#abc', isCompleted: false, icon: 'circle' }];
    const keyOf = (barIconSource: 'none' | 'status') =>
      taskStateKey(
        buildSvarTasks(inputs({ instances: [inst({ id: 'a', status: 'wip' })], statusColors: colors, barIconSource }))[0],
      );
    expect(keyOf('none')).not.toBe(keyOf('status'));
  });

  it('taskStateKey changes when the icon kind flips with same color + no glyph (ring vs dot)', () => {
    // A status ring and a priority dot that share a color and have NO glyph differ
    // ONLY by kind; the fingerprint must still change so the toggle re-syncs.
    const statusColors: StatusColor[] = [{ value: 'v', color: '#abc', isCompleted: false }];
    const priorityColors: PriorityColor[] = [{ value: 'v', color: '#abc' }];
    const instance = inst({ id: 'a', status: 'v', priority: 'v' });
    const keyFor = (barIconSource: 'status' | 'priority') =>
      taskStateKey(
        buildSvarTasks(inputs({ instances: [instance], statusColors, priorityColors, barIconSource }))[0],
      );
    expect(keyFor('status')).not.toBe(keyFor('priority'));
  });

  it('carries dateStatus onto custom for the view filter predicate (U2)', () => {
    // The presentation-layer show-undated/show-partial filter reads custom.dateStatus
    // to decide row visibility (#161), so it must ride each instance onto the task.
    const [placeholder] = buildSvarTasks(
      inputs({ instances: [inst({ id: 'a', dateStatus: 'placeholder' })] }),
    );
    expect(placeholder.custom.dateStatus).toBe('placeholder');
    const [partial] = buildSvarTasks(
      inputs({ instances: [inst({ id: 'b', dateStatus: 'inferred-start' })] }),
    );
    expect(partial.custom.dateStatus).toBe('inferred-start');
  });

  it('sets showHasDeps only for a non-primary linked instance in primary mode', () => {
    // Two instances of the same source path c.md; the first is primary.
    const instances = [
      inst({ id: 'c#1', sourcePath: 'c.md' }),
      inst({ id: 'c#2', sourcePath: 'c.md' }),
      inst({ id: 'd', sourcePath: 'd.md' }),
    ];
    const links: RenderLink[] = [{ id: 'L1', source: 'c#1', target: 'd', type: 'e2s', reltype: 'FINISHTOSTART', gap: null }];
    const tasks = buildSvarTasks(inputs({ instances, links, arrowMode: 'primary' }));
    expect(tasks.find((t) => t.id === 'c#1')!.custom.showHasDeps).toBe(false); // primary
    expect(tasks.find((t) => t.id === 'c#2')!.custom.showHasDeps).toBe(true); // non-primary, has deps
  });

  it('never sets showHasDeps in "all" arrow mode', () => {
    const instances = [inst({ id: 'c#1', sourcePath: 'c.md' }), inst({ id: 'c#2', sourcePath: 'c.md' })];
    const links: RenderLink[] = [{ id: 'L1', source: 'c#1', target: 'c#2', type: 'e2s', reltype: 'FINISHTOSTART', gap: null }];
    const tasks = buildSvarTasks(inputs({ instances, links, arrowMode: 'all' }));
    expect(tasks.every((t) => t.custom.showHasDeps === false)).toBe(true);
  });

  it('attaches incoming dependency edges to the target task with the predecessor name resolved (U3)', () => {
    const instances = [
      inst({ id: 'pred', sourcePath: 'pred.md', text: 'Draft docs' }),
      inst({ id: 'dep', sourcePath: 'dep.md', text: 'Review docs' }),
    ];
    const links: RenderLink[] = [
      { id: 'L1', source: 'pred', target: 'dep', type: 's2s', reltype: 'STARTTOSTART', gap: 'P1D' },
    ];
    const tasks = buildSvarTasks(inputs({ instances, links }));
    expect(tasks.find((t) => t.id === 'dep')!.custom.incomingDeps).toEqual([
      { reltype: 'STARTTOSTART', gap: 'P1D', predecessorName: 'Draft docs' },
    ]);
    // The predecessor (source) task has no incoming edges.
    expect(tasks.find((t) => t.id === 'pred')!.custom.incomingDeps).toEqual([]);
  });

  it('taskStateKey changes when only an incoming dependency gap changes (re-sync guard)', () => {
    const instances = [
      inst({ id: 'pred', text: 'P' }),
      inst({ id: 'dep' }),
    ];
    const linkOf = (gap: string | null): RenderLink => ({
      id: `pred->dep:e2s:${gap ?? ''}`,
      source: 'pred',
      target: 'dep',
      type: 'e2s',
      reltype: 'FINISHTOSTART',
      gap,
    });
    const keyOf = (gap: string | null): string => {
      const dep = buildSvarTasks(inputs({ instances, links: [linkOf(gap)] })).find((t) => t.id === 'dep')!;
      return taskStateKey(dep);
    };
    expect(keyOf(null)).not.toBe(keyOf('P1D'));
  });
});

describe('buildTreatmentTaskTypes', () => {
  const palettes = {
    status: [{ value: 'wip', color: '#abc', isCompleted: false }] as StatusColor[],
    priority: [{ value: 'high', color: '#f00' }] as PriorityColor[],
  };

  it('registers date-status, og-parent, and status+priority slugs (alone and composed)', () => {
    const ids = buildTreatmentTaskTypes(palettes).map((t) => t.id);
    expect(ids).toContain(DATE_STATUS_TYPE);
    expect(ids).toContain(PARENT_ROLE_CLASS);
    expect(ids).toContain(statusSlug('wip'));
    expect(ids).toContain(prioritySlug('high'));
    expect(ids).toContain(`${DATE_STATUS_TYPE} ${prioritySlug('high')}`);
    expect(ids).toContain(`${DATE_STATUS_TYPE} ${PARENT_ROLE_CLASS}`);
  });

  it('covers every composed form a priority + cue bar can produce (whole-string contract)', () => {
    // A date-flagged, priority-colored, replicated, context bar — worst case.
    const tasks = buildSvarTasks(
      inputs({
        instances: [
          inst({ id: 'x', sourcePath: 's.md', dateStatus: 'inferred', priority: 'high', isFetched: true }),
          inst({ id: 'y', sourcePath: 's.md', dateStatus: 'inferred', priority: 'high', isFetched: true }),
        ],
        barColorSource: 'priority',
        priorityColors: palettes.priority,
      }),
    );
    const expected = `${DATE_STATUS_TYPE} ${prioritySlug('high')} ${REPLICATED_TYPE} ${CONTEXT_TYPE}`;
    expect(tasks[0]!.type).toBe(expected);
    const registered = buildInstanceCueTaskTypes(buildTreatmentTaskTypes(palettes).map((t) => t.id)).map(
      (t) => t.id,
    );
    expect(registered).toContain(expected);
  });
});

describe('instance cues (U6)', () => {
  it('marks both bars replicated when a source path appears more than once', () => {
    // Same note shown under two parents → two instances, distinct ids.
    const tasks = buildSvarTasks(
      inputs({
        instances: [
          inst({ id: 'p1', sourcePath: 'shared.md' }),
          inst({ id: 'p2', sourcePath: 'shared.md' }),
        ],
      }),
    );
    for (const t of tasks) {
      expect(t.type.split(' ')).toContain(REPLICATED_TYPE);
      expect(t.custom.isReplicated).toBe(true);
    }
  });

  it('carries isTopLevelPlacement onto the SVAR task custom (#161 — drives the Hide-top filter-tasks predicate)', () => {
    const tasks = buildSvarTasks(
      inputs({
        instances: [
          inst({ id: 'dup', isTopLevelPlacement: true }),
          inst({ id: 'real', isTopLevelPlacement: false }),
        ],
      }),
    );
    // The view's filter-tasks predicate reads exactly this flag to hide the
    // also-top-level duplicate placement while keeping the real nested copy.
    expect(tasks.find((t) => t.id === 'dup')!.custom.isTopLevelPlacement).toBe(true);
    expect(tasks.find((t) => t.id === 'real')!.custom.isTopLevelPlacement).toBe(false);
  });

  it('does not mark a unique source path replicated', () => {
    const [t] = buildSvarTasks(inputs({ instances: [inst({ id: 'a' })] }));
    expect(t.type.split(' ')).not.toContain(REPLICATED_TYPE);
    expect(t.custom.isReplicated).toBe(false);
  });

  // Replicated counts only VISIBLE instances: the always-emitted `alsoTopLevel`
  // duplicate top-level placement must not inflate the count when Hide-top is
  // suppressing it (else a single-parent note shown once is wrongly hatched).
  it('does NOT mark a single-parent note replicated when Hide-top hides its top-level twin', () => {
    const sourcePath = 'child.md';
    const tasks = buildSvarTasks(
      inputs({
        hideTopLevelSubtasks: true,
        instances: [
          inst({ id: 'child#parent-p', sourcePath, isTopLevelPlacement: false }),
          inst({ id: 'child', sourcePath, isTopLevelPlacement: true }),
        ],
      }),
    );
    const nested = tasks.find((t) => t.id === 'child#parent-p')!;
    expect(nested.custom.isReplicated).toBe(false);
    expect(nested.type.split(' ')).not.toContain(REPLICATED_TYPE);
  });

  it('DOES mark the same note replicated when Hide-top is off (root + nested both visible)', () => {
    const sourcePath = 'child.md';
    const tasks = buildSvarTasks(
      inputs({
        hideTopLevelSubtasks: false,
        instances: [
          inst({ id: 'child#parent-p', sourcePath, isTopLevelPlacement: false }),
          inst({ id: 'child', sourcePath, isTopLevelPlacement: true }),
        ],
      }),
    );
    for (const t of tasks) {
      expect(t.custom.isReplicated).toBe(true);
      expect(t.type.split(' ')).toContain(REPLICATED_TYPE);
    }
  });

  it('still marks a genuine multi-parent note replicated under Hide-top (both nested copies count)', () => {
    // Two nested placements (isTopLevelPlacement=false) plus the alsoTopLevel twin;
    // Hide-top suppresses only the twin, leaving 2 visible → replicated.
    const sourcePath = 'multi.md';
    const tasks = buildSvarTasks(
      inputs({
        hideTopLevelSubtasks: true,
        instances: [
          inst({ id: 'multi#parent-a', sourcePath, isTopLevelPlacement: false }),
          inst({ id: 'multi#parent-b', sourcePath, isTopLevelPlacement: false }),
          inst({ id: 'multi', sourcePath, isTopLevelPlacement: true }),
        ],
      }),
    );
    const nested = tasks.filter((t) => t.id !== 'multi');
    for (const t of nested) {
      expect(t.custom.isReplicated).toBe(true);
    }
  });

  it('does not mark a fan-out-collapsed source (single instance) replicated', () => {
    const [t] = buildSvarTasks(
      inputs({ hideTopLevelSubtasks: true, instances: [inst({ id: 'x', isCollapsed: true })] }),
    );
    expect(t.custom.isReplicated).toBe(false);
  });

  it('treats a missing hideTopLevelSubtasks as hide-off (buildSvarTasks default counts the twin)', () => {
    const sourcePath = 'child.md';
    // Omit hideTopLevelSubtasks entirely to exercise the `= false` destructure default.
    const tasks = buildSvarTasks({
      instances: [
        inst({ id: 'child#parent-p', sourcePath, isTopLevelPlacement: false }),
        inst({ id: 'child', sourcePath, isTopLevelPlacement: true }),
      ],
      links: [],
      statusColors: [],
      showDateIndicators: true,
      arrowMode: 'primary',
    });
    expect(tasks.every((t) => t.custom.isReplicated)).toBe(true);
  });

  it('marks a fetched (out-of-filter) instance as context', () => {
    const [t] = buildSvarTasks(inputs({ instances: [inst({ id: 'f', isFetched: true })] }));
    expect(t.type.split(' ')).toContain(CONTEXT_TYPE);
    expect(t.custom.isContext).toBe(true);
  });

  it('does not mark an in-filter instance as context', () => {
    const [t] = buildSvarTasks(inputs({ instances: [inst({ id: 'm', isFetched: false })] }));
    expect(t.type.split(' ')).not.toContain(CONTEXT_TYPE);
    expect(t.custom.isContext).toBe(false);
  });

  it('composes cues after state classes, replicated before context, in registration order', () => {
    // A date-flagged, status-colored, replicated, context bar — the worst case.
    const colors: StatusColor[] = [{ value: 'wip', color: '#abc', isCompleted: false }];
    const tasks = buildSvarTasks(
      inputs({
        instances: [
          inst({ id: 'x', sourcePath: 's.md', dateStatus: 'inferred', status: 'wip', isFetched: true }),
          inst({ id: 'y', sourcePath: 's.md', dateStatus: 'inferred', status: 'wip', isFetched: true }),
        ],
        statusColors: colors,
      }),
    );
    const expected = `${DATE_STATUS_TYPE} ${statusSlug('wip')} ${REPLICATED_TYPE} ${CONTEXT_TYPE}`;
    expect(tasks[0]!.type).toBe(expected);
    // The coupling contract: that exact whole string must be a registered type id,
    // or SVAR's whole-string match drops every cue/state class to plain "task".
    const registered = buildInstanceCueTaskTypes(
      buildTreatmentTaskTypes({ status: colors, priority: [] }).map((t) => t.id),
    ).map((t) => t.id);
    expect(registered).toContain(expected);
  });

  it('registers cue-only forms and the cross-product with base types', () => {
    const base = [DATE_STATUS_TYPE];
    const ids = buildInstanceCueTaskTypes(base).map((t) => t.id);
    // Cue-only (a plain bar that is replicated/context with no state class).
    expect(ids).toContain(REPLICATED_TYPE);
    expect(ids).toContain(CONTEXT_TYPE);
    expect(ids).toContain(`${REPLICATED_TYPE} ${CONTEXT_TYPE}`);
    // Crossed with each base id.
    expect(ids).toContain(`${DATE_STATUS_TYPE} ${REPLICATED_TYPE}`);
    expect(ids).toContain(`${DATE_STATUS_TYPE} ${REPLICATED_TYPE} ${CONTEXT_TYPE}`);
  });
});

describe('planTaskSync', () => {
  it('returns an empty plan when nothing changed', () => {
    const tasks = buildSvarTasks(inputs({ instances: [inst({ id: 'a' })] }));
    const plan = planTaskSync(mapOf(tasks), tasks);
    expect(plan).toEqual({ moves: [], updates: [], deletes: [], adds: [] });
  });

  it('emits an update only for a field-changed task', () => {
    const prev = buildSvarTasks(inputs({ instances: [inst({ id: 'a', progress: 0 })] }));
    const next = buildSvarTasks(inputs({ instances: [inst({ id: 'a', progress: 50 })] }));
    const plan = planTaskSync(mapOf(prev), next);
    expect(plan.updates.map((u) => u.id)).toEqual(['a']);
    expect(plan.adds).toHaveLength(0);
    expect(plan.deletes).toHaveLength(0);
  });

  // U2 guardrail (#161): flipping "Hide top-level subtasks" changes only the
  // replicated cue (a task `type`), never row membership — so the live re-sync on
  // the toggle is update-only, preserving scroll/zoom and never churning.
  it('flipping Hide-top yields an update-only plan (no add/delete/move) — churn-safe', () => {
    const sourcePath = 'child.md';
    const instances = [
      inst({ id: 'child#parent-p', sourcePath, isTopLevelPlacement: false }),
      inst({ id: 'child', sourcePath, isTopLevelPlacement: true }),
    ];
    const hideOff = buildSvarTasks(inputs({ instances, hideTopLevelSubtasks: false }));
    const hideOn = buildSvarTasks(inputs({ instances, hideTopLevelSubtasks: true }));
    const plan = planTaskSync(mapOf(hideOff), hideOn);
    expect(plan.updates.length).toBeGreaterThan(0);
    expect(plan.adds).toHaveLength(0);
    expect(plan.deletes).toHaveLength(0);
    expect(plan.moves).toHaveLength(0);
  });

  it('orders adds parent-first even when next lists the child before the parent', () => {
    const prev: SvarTask[] = [];
    // child appears before parent in the array
    const next = buildSvarTasks(
      inputs({ instances: [inst({ id: 'c', parent: 'p' }), inst({ id: 'p' })] }),
    );
    const plan = planTaskSync(mapOf(prev), next);
    const order = plan.adds.map((t) => t.id);
    expect(order.indexOf('p')).toBeLessThan(order.indexOf('c'));
  });

  it('orders deletes leaf-first (children before parents)', () => {
    const prev = buildSvarTasks(
      inputs({ instances: [inst({ id: 'p' }), inst({ id: 'c', parent: 'p' }), inst({ id: 'g', parent: 'c' })] }),
    );
    const plan = planTaskSync(mapOf(prev), []); // everything removed
    const order = plan.deletes;
    expect(order.indexOf('g')).toBeLessThan(order.indexOf('c'));
    expect(order.indexOf('c')).toBeLessThan(order.indexOf('p'));
  });

  it('emits a move (and an accompanying update) when a task is reparented', () => {
    const prev = buildSvarTasks(
      inputs({ instances: [inst({ id: 'p1' }), inst({ id: 'p2' }), inst({ id: 'c', parent: 'p1' })] }),
    );
    const next = buildSvarTasks(
      inputs({ instances: [inst({ id: 'p1' }), inst({ id: 'p2' }), inst({ id: 'c', parent: 'p2' })] }),
    );
    const plan = planTaskSync(mapOf(prev), next);
    expect(plan.moves).toEqual([{ id: 'c', parent: 'p2' }]);
    // parent change always alters the state key → an update is emitted too
    expect(plan.updates.map((u) => u.id)).toContain('c');
  });

  it('moves a task to root (target 0) when its parent is removed', () => {
    const prev = buildSvarTasks(inputs({ instances: [inst({ id: 'c', parent: 'p' })] }));
    const next = buildSvarTasks(inputs({ instances: [inst({ id: 'c' })] })); // no parent
    const plan = planTaskSync(mapOf(prev), next);
    expect(plan.moves).toEqual([{ id: 'c', parent: 0 }]);
  });

  it('handles simultaneous add, update, and delete in one diff', () => {
    const prev = buildSvarTasks(
      inputs({ instances: [inst({ id: 'keep', progress: 0 }), inst({ id: 'gone' })] }),
    );
    const next = buildSvarTasks(
      inputs({ instances: [inst({ id: 'keep', progress: 80 }), inst({ id: 'new' })] }),
    );
    const plan = planTaskSync(mapOf(prev), next);
    expect(plan.updates.map((u) => u.id)).toEqual(['keep']);
    expect(plan.adds.map((t) => t.id)).toEqual(['new']);
    expect(plan.deletes).toEqual(['gone']);
  });
});

describe('buildSvarTasks — grid property values (U4)', () => {
  const propsFor = (entries: Array<[string, Record<string, TypedValue>]>) =>
    new Map<string, Record<string, TypedValue>>(entries);

  it('attaches custom.properties by source path', () => {
    const pv = propsFor([['a.md', { 'note.status': { kind: 'text', value: 'wip' } }]]);
    const [t] = buildSvarTasks(inputs({ instances: [inst({ id: 'a', sourcePath: 'a.md' })], propertyValues: pv }));
    expect(t.custom.properties).toEqual({ 'note.status': { kind: 'text', value: 'wip' } });
  });

  it('defaults custom.properties to {} when the task has no resolved values', () => {
    const [t] = buildSvarTasks(inputs({ instances: [inst({ id: 'a', sourcePath: 'a.md' })] }));
    expect(t.custom.properties).toEqual({});
  });
});

describe('taskStateKey', () => {
  it('changes when a displayed property value changes, is stable for a date, and ignores unmapped props', () => {
    const pv = (status: string) =>
      new Map<string, Record<string, TypedValue>>([
        ['a.md', { 'note.status': { kind: 'text', value: status }, 'note.start': { kind: 'date', value: new Date(2026, 0, 1) } }],
      ]);
    const build = (status: string) =>
      buildSvarTasks(inputs({ instances: [inst({ id: 'a', sourcePath: 'a.md' })], propertyValues: pv(status) }))[0];

    // A displayed value change → different key.
    expect(taskStateKey(build('wip'))).not.toBe(taskStateKey(build('done')));
    // Same content (incl. a date-kind value) → identical key across rebuilds (no churn).
    expect(taskStateKey(build('wip'))).toBe(taskStateKey(build('wip')));
  });

  it('changes when a date moves', () => {
    const [a] = buildSvarTasks(inputs({ instances: [inst({ id: 'a', start: new Date(2026, 0, 1) })] }));
    const [b] = buildSvarTasks(inputs({ instances: [inst({ id: 'a', start: new Date(2026, 0, 5) })] }));
    expect(taskStateKey(a)).not.toBe(taskStateKey(b));
  });

  it('is identical for identical content', () => {
    const [a] = buildSvarTasks(inputs({ instances: [inst({ id: 'a' })] }));
    const [b] = buildSvarTasks(inputs({ instances: [inst({ id: 'a' })] }));
    expect(taskStateKey(a)).toBe(taskStateKey(b));
  });

  it('is identical regardless of custom.dateStatus (KTD3 diff-safety guard)', () => {
    // dateStatus rides into custom for the view filter but MUST NOT enter the
    // task-update fingerprint — otherwise a date-status change would inflate the
    // SVAR diff (#161). Same content, different dateStatus → same key.
    const [a] = buildSvarTasks(
      inputs({ instances: [inst({ id: 'a', dateStatus: 'complete' })], showDateIndicators: false }),
    );
    const [b] = buildSvarTasks(
      inputs({
        instances: [inst({ id: 'a', dateStatus: 'placeholder' })],
        showDateIndicators: false,
      }),
    );
    expect(a.custom.dateStatus).not.toBe(b.custom.dateStatus);
    expect(taskStateKey(a)).toBe(taskStateKey(b));
  });
});

describe('planLinkSync', () => {
  const link = (id: string, source = 's', target = 't'): RenderLink => ({ id, source, target, type: 'e2s', reltype: 'FINISHTOSTART', gap: null });

  it('adds new links and deletes removed ones by id', () => {
    const prev = new Map([['L1', link('L1')]]);
    const next = [link('L2')];
    const plan = planLinkSync(prev, next);
    expect(plan.adds.map((l) => l.id)).toEqual(['L2']);
    expect(plan.deletes).toEqual(['L1']);
  });

  it('is a no-op when the link set is unchanged', () => {
    const prev = new Map([['L1', link('L1')]]);
    const plan = planLinkSync(prev, [link('L1')]);
    expect(plan).toEqual({ deletes: [], adds: [] });
  });
});

describe('planReorder', () => {
  it('chains move-after within a root branch to match the desired order', () => {
    const moves = planReorder([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect(moves).toEqual([
      { id: 'b', after: 'a' },
      { id: 'c', after: 'b' },
    ]);
  });

  it('reorders each parent branch independently (tree-preserving)', () => {
    const moves = planReorder([
      { id: 'P' },
      { id: 'c1', parent: 'P' },
      { id: 'c2', parent: 'P' },
      { id: 'Q' },
      { id: 'd1', parent: 'Q' },
    ]);
    // Root branch [P, Q] → Q after P; P's children c1,c2 → c2 after c1; Q's lone child → no move.
    expect(moves).toEqual([
      { id: 'Q', after: 'P' },
      { id: 'c2', after: 'c1' },
    ]);
  });

  it('emits no moves for single-child branches or an empty set', () => {
    expect(planReorder([])).toEqual([]);
    expect(planReorder([{ id: 'only' }])).toEqual([]);
    expect(planReorder([{ id: 'P' }, { id: 'c', parent: 'P' }])).toEqual([]);
  });
});

describe('baseSortDescriptor', () => {
  it('is empty when there is no Base sort', () => {
    expect(baseSortDescriptor([])).toBe('');
    expect(baseSortDescriptor(undefined)).toBe('');
  });

  it('folds the property+direction pairs into a stable string', () => {
    expect(baseSortDescriptor([{ property: 'note.due', direction: 'ASC' }])).toBe('note.due:ASC');
    expect(
      baseSortDescriptor([
        { property: 'note.due', direction: 'ASC' },
        { property: 'file.name', direction: 'DESC' },
      ]),
    ).toBe('note.due:ASC|file.name:DESC');
  });

  it('is identical for two getSort() results with the same keys+directions (data-only refresh)', () => {
    const a = baseSortDescriptor([{ property: 'note.due', direction: 'ASC' }]);
    const b = baseSortDescriptor([{ property: 'note.due', direction: 'ASC' }]);
    expect(a).toBe(b);
  });

  it('changes when the direction changes (user re-sorted the Base)', () => {
    const asc = baseSortDescriptor([{ property: 'note.due', direction: 'ASC' }]);
    const desc = baseSortDescriptor([{ property: 'note.due', direction: 'DESC' }]);
    expect(asc).not.toBe(desc);
  });

  it('changes when the sort property changes', () => {
    const due = baseSortDescriptor([{ property: 'note.due', direction: 'ASC' }]);
    const name = baseSortDescriptor([{ property: 'file.name', direction: 'ASC' }]);
    expect(due).not.toBe(name);
  });

  it('preserves order significance (compound sort is order-sensitive)', () => {
    const ab = baseSortDescriptor([
      { property: 'a', direction: 'ASC' },
      { property: 'b', direction: 'ASC' },
    ]);
    const ba = baseSortDescriptor([
      { property: 'b', direction: 'ASC' },
      { property: 'a', direction: 'ASC' },
    ]);
    expect(ab).not.toBe(ba);
  });
});

describe('shouldBulkReseed (#161 U6 — large-diff bulk reseed decision)', () => {
  // The decision only reads array lengths, so plans are built with length-accurate
  // stub arrays (content is irrelevant to the structural-op count under test).
  const stub = <T>(n: number): T[] => Array.from({ length: n }, (_, i) => ({ id: `x${i}` } as unknown as T));
  function plan(c: { adds?: number; deletes?: number; moves?: number; updates?: number }): TaskSyncPlan {
    return {
      adds: stub<SvarTask>(c.adds ?? 0),
      deletes: Array.from({ length: c.deletes ?? 0 }, (_, i) => `d${i}`),
      moves: Array.from({ length: c.moves ?? 0 }, (_, i) => ({ id: `m${i}`, parent: 0 as const })),
      updates: Array.from({ length: c.updates ?? 0 }, (_, i) => ({ id: `u${i}`, task: { id: `u${i}` } as unknown as SvarTask })),
    };
  }
  function linkPlan(c: { adds?: number; deletes?: number }): LinkSyncPlan {
    return { adds: stub<RenderLink>(c.adds ?? 0), deletes: Array.from({ length: c.deletes ?? 0 }, (_, i) => `l${i}`) };
  }

  it('returns false for an empty plan (a NOOP sync is never a reseed)', () => {
    expect(shouldBulkReseed(plan({}), linkPlan({}))).toBe(false);
  });

  it('returns false for a small interactive edit (1 move + 2 updates)', () => {
    expect(shouldBulkReseed(plan({ moves: 1, updates: 2 }), linkPlan({}))).toBe(false);
  });

  it('keeps a large field-only refresh incremental (updates are excluded from the count)', () => {
    // 500 in-place updates, zero structural ops → stays incremental, preserving view state (R2).
    expect(shouldBulkReseed(plan({ updates: 500 }), linkPlan({}))).toBe(false);
  });

  it('returns true for a wholesale add of many tasks (search→clear re-expands the tree)', () => {
    expect(shouldBulkReseed(plan({ adds: 800 }), linkPlan({}))).toBe(true);
  });

  it('returns true for a wholesale delete of many tasks (search filters to empty)', () => {
    expect(shouldBulkReseed(plan({ deletes: 800 }), linkPlan({}))).toBe(true);
  });

  it('counts adds + deletes + moves together for a mixed swap', () => {
    const justOver = plan({
      adds: Math.ceil((BULK_RESEED_OP_THRESHOLD + 1) / 3),
      deletes: Math.ceil((BULK_RESEED_OP_THRESHOLD + 1) / 3),
      moves: Math.ceil((BULK_RESEED_OP_THRESHOLD + 1) / 3),
    });
    expect(shouldBulkReseed(justOver, linkPlan({}))).toBe(true);
  });

  it('returns false when structural ops EQUAL the threshold (not strictly over)', () => {
    expect(shouldBulkReseed(plan({ adds: BULK_RESEED_OP_THRESHOLD }), linkPlan({}))).toBe(false);
  });

  it('returns true when structural ops exceed the threshold by one (strict greater-than)', () => {
    expect(shouldBulkReseed(plan({ adds: BULK_RESEED_OP_THRESHOLD + 1 }), linkPlan({}))).toBe(true);
  });

  it('counts link adds + deletes toward the magnitude (0 task ops, many link ops)', () => {
    expect(shouldBulkReseed(plan({}), linkPlan({ adds: BULK_RESEED_OP_THRESHOLD, deletes: 1 }))).toBe(true);
  });

  it('applies strict greater-than to link ops too (link ops == threshold → false)', () => {
    expect(shouldBulkReseed(plan({}), linkPlan({ adds: BULK_RESEED_OP_THRESHOLD }))).toBe(false);
  });

  it('ignores updates even when they dwarf a sub-threshold structural count', () => {
    // 149 structural ops + 10000 updates → still incremental (updates excluded).
    expect(shouldBulkReseed(plan({ adds: 149, updates: 10000 }), linkPlan({}))).toBe(false);
  });

  it('honors an explicit threshold override', () => {
    const small = plan({ adds: 5 });
    expect(shouldBulkReseed(small, linkPlan({}), 100)).toBe(false);
    expect(shouldBulkReseed(small, linkPlan({}), 4)).toBe(true);
  });

  it('structuralOpCount sums task adds+deletes+moves and link adds+deletes, excluding updates', () => {
    expect(structuralOpCount(plan({}), linkPlan({}))).toBe(0);
    expect(structuralOpCount(plan({ adds: 3, deletes: 2, moves: 1, updates: 99 }), linkPlan({ adds: 4, deletes: 5 }))).toBe(15);
  });
});
