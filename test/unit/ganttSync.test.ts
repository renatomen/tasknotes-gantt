/**
 * ganttSync unit tests (Bug B — preserve zoom/scroll via targeted SVAR updates).
 *
 * Pure transform + diff layer driving `api.exec("update/add/move/delete-task")`
 * instead of replacing SVAR's tasks array (which re-inits the store and resets
 * the view). Covers:
 * - buildSvarTasks: parent→summary/open, leaf type composition (date-status flag
 *   + status-color class), custom metadata (showHasDeps by arrow mode).
 * - buildStatusTaskTypes: stable palette-derived superset (flag, slug, composed).
 * - planTaskSync: change detection, parent-first adds, leaf-first deletes, moves.
 * - planLinkSync: add/delete by id.
 */

import { describe, it, expect } from '@jest/globals';
import {
  buildSvarTasks,
  buildStatusTaskTypes,
  planTaskSync,
  planLinkSync,
  planReorder,
  taskStateKey,
  DATE_STATUS_TYPE,
  type SvarTask,
  type SvarTaskInputs,
} from '../../src/bases/ganttSync';
import { statusSlug } from '../../src/bases/statusColor';
import type { RenderInstance, RenderLink } from '../../src/controller/InstanceExpansion';
import type { StatusColor } from '../../src/datasource/types';
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
  };
}

function inputs(over: Partial<SvarTaskInputs>): SvarTaskInputs {
  return {
    instances: over.instances ?? [],
    links: over.links ?? [],
    statusColors: over.statusColors ?? [],
    showDateIndicators: over.showDateIndicators ?? true,
    arrowMode: over.arrowMode ?? 'primary',
    propertyValues: over.propertyValues,
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

describe('buildStatusTaskTypes', () => {
  it('always registers the date-status flag type', () => {
    const ids = buildStatusTaskTypes([]).map((t) => t.id);
    expect(ids).toContain(DATE_STATUS_TYPE);
  });

  it('registers slug and composed forms for each colored status', () => {
    const colors: StatusColor[] = [{ value: 'wip', color: '#abc', isCompleted: false }];
    const ids = buildStatusTaskTypes(colors).map((t) => t.id);
    expect(ids).toContain(statusSlug('wip'));
    expect(ids).toContain(`${DATE_STATUS_TYPE} ${statusSlug('wip')}`);
  });

  it('is stable (same ids) regardless of which tasks are present — palette-derived', () => {
    const colors: StatusColor[] = [
      { value: 'a', color: '#111', isCompleted: false },
      { value: 'b', color: '#222', isCompleted: true },
    ];
    expect(buildStatusTaskTypes(colors).map((t) => t.id)).toEqual(
      buildStatusTaskTypes(colors).map((t) => t.id),
    );
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
