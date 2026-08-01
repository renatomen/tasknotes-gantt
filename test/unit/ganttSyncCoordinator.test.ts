import type { RenderLink } from '../../src/controller/InstanceExpansion';
import type { SvarTask } from '../../src/bases/ganttSync';
import type { GanttSyncPort } from '../../src/bases/ganttSyncPort';
import {
  applyIncrementalGanttSync,
  createAppliedGanttSyncState,
  createGanttSeedSnapshot,
  ganttOrderFingerprint,
  replaceAppliedGanttData,
  type AppliedGanttSyncState,
  type GanttSyncPlan,
} from '../../src/bases/ganttSyncCoordinator';

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

function link(id: string, source = `${id}-source`, target = `${id}-target`): RenderLink {
  return {
    id,
    source,
    target,
    type: 'e2s',
    reltype: 'FINISHTOSTART',
    gap: null,
  };
}

function plan(overrides: Partial<GanttSyncPlan> = {}): GanttSyncPlan {
  return {
    next: [],
    taskPlan: { moves: [], updates: [], deletes: [], adds: [] },
    linkPlan: { deletes: [], adds: [] },
    orderKey: 'applied-order',
    baseSortKey: 'applied-base-sort',
    baseSortChanged: false,
    ...overrides,
  };
}

function appliedState(
  tasks: ReadonlyArray<SvarTask> = [],
  links: ReadonlyArray<RenderLink> = [],
): AppliedGanttSyncState {
  return {
    tasks: new Map(tasks.map((value) => [value.id, value])),
    links: new Map(links.map((value) => [value.id, value])),
    orderKey: 'applied-order',
    baseSortKey: 'applied-base-sort',
  };
}

function recordingPort(
  events: string[],
  existingTaskIds: ReadonlySet<string> | null = null,
): GanttSyncPort {
  return {
    hasTask(id): boolean {
      events.push(`has-task:${id}`);
      return existingTaskIds?.has(id) ?? true;
    },
    moveTaskToParent(id, parentId): void {
      events.push(`move-parent:${id}:${parentId}`);
    },
    updateTask(id): void {
      events.push(`update-task:${id}`);
    },
    deleteLink(id): void {
      events.push(`delete-link:${id}`);
    },
    deleteTask(id): void {
      events.push(`delete-task:${id}`);
    },
    addTask(value): void {
      events.push(`add-task:${value.id}`);
    },
    addLink(value): void {
      events.push(`add-link:${value.id}`);
    },
    moveTaskAfter(id, previousSiblingId): void {
      events.push(`move-after:${id}:${previousSiblingId}`);
    },
  };
}

function sortPort(events: string[], initiallyActive = false) {
  let active = initiallyActive;
  return {
    isActive(): boolean {
      return active;
    },
    reassert(): void {
      events.push('reassert-sort');
    },
    clear(): void {
      events.push('clear-sort');
      active = false;
    },
  };
}

describe('Gantt reseed state', () => {
  it('aligns editable flat keys with their stored typed values', () => {
    const original = task('alpha');
    original.custom.properties = {
      'note.owner': { kind: 'text', value: 'Grace' },
    };

    const seed = createGanttSeedSnapshot({
      tasks: [original],
      links: [],
      cellEditColumnIds: ['note.owner'],
    });

    expect((seed.tasks[0] as SvarTask & Record<string, unknown>)['note.owner']).toBe('Grace');
  });

  it('retains the exact link array as the canonical seed', () => {
    const links = [link('alpha-beta')];

    const seed = createGanttSeedSnapshot({
      tasks: [],
      links,
      cellEditColumnIds: [],
    });

    expect(seed.links).toBe(links);
  });

  it('creates applied state from the exact canonical seed objects', () => {
    const first = task('first');
    const second = task('second', first.id);
    const dependency = link('first-second', first.id, second.id);
    const seed = { tasks: [first, second], links: [dependency] };

    const state = createAppliedGanttSyncState(seed, 'base-sort');

    expect(state.tasks.get(first.id)).toBe(first);
    expect(state.tasks.get(second.id)).toBe(second);
    expect(state.links.get(dependency.id)).toBe(dependency);
    expect(state.orderKey).toBe('>first|first>second');
    expect(state.baseSortKey).toBe('base-sort');
  });

  it('rebases the existing map containers in seed order without changing the Base-sort key', () => {
    const staleTask = task('stale');
    const staleLink = link('stale-link');
    const state = appliedState([staleTask], [staleLink]);
    const taskMap = state.tasks;
    const linkMap = state.links;
    const second = task('second');
    const first = task('first');
    const replacementLink = link('second-first', second.id, first.id);

    replaceAppliedGanttData(state, {
      tasks: [second, first],
      links: [replacementLink],
    });

    expect(state.tasks).toBe(taskMap);
    expect(state.links).toBe(linkMap);
    expect([...state.tasks.keys()]).toEqual([second.id, first.id]);
    expect([...state.links.keys()]).toEqual([replacementLink.id]);
    expect(state.tasks.get(second.id)).toBe(second);
    expect(state.tasks.get(first.id)).toBe(first);
    expect(state.links.get(replacementLink.id)).toBe(replacementLink);
    expect(state.orderKey).toBe('>second|>first');
    expect(state.baseSortKey).toBe('applied-base-sort');
  });

  it('fingerprints parent and row order without serializing task content', () => {
    expect(ganttOrderFingerprint([task('first'), task('second', 'first')])).toBe(
      '>first|first>second',
    );
  });
});

describe('applyIncrementalGanttSync', () => {
  it('executes the plan in the existing command sequence', () => {
    const events: string[] = [];
    const updated = task('moved', 'new-parent');
    const addedParent = task('new-parent');
    const syncPlan = plan({
      next: [task('existing-root'), addedParent, updated],
      orderKey: '>existing-root|>new-parent|new-parent>moved',
      taskPlan: {
        moves: [{ id: updated.id, parent: addedParent.id }],
        updates: [{ id: updated.id, task: updated }],
        deletes: ['deleted'],
        adds: [addedParent],
      },
      linkPlan: {
        deletes: ['old-link'],
        adds: [link('new-link', updated.id, addedParent.id)],
      },
    });

    applyIncrementalGanttSync({
      plan: syncPlan,
      port: recordingPort(events),
      state: appliedState(
        [task('existing-root'), task('moved'), task('deleted')],
        [link('old-link', updated.id, 'deleted')],
      ),
      ephemeralSort: sortPort(events),
      onTaskAndLinkChangesApplied: () => events.push('task-link-phase-complete'),
    });

    expect(events).toEqual([
      'move-parent:moved:new-parent',
      'update-task:moved',
      'delete-link:old-link',
      'has-task:deleted',
      'delete-task:deleted',
      'add-task:new-parent',
      'add-link:new-link',
      'task-link-phase-complete',
      'move-after:new-parent:existing-root',
    ]);
  });

  it('removes cascaded tasks from applied state without issuing another delete', () => {
    const events: string[] = [];
    const state = appliedState([task('already-cascaded')]);

    applyIncrementalGanttSync({
      plan: plan({
        taskPlan: {
          moves: [],
          updates: [],
          deletes: ['already-cascaded'],
          adds: [],
        },
        orderKey: state.orderKey,
      }),
      port: recordingPort(events, new Set()),
      state,
      ephemeralSort: sortPort(events),
    });

    expect(events).toEqual(['has-task:already-cascaded']);
    expect(state.tasks.has('already-cascaded')).toBe(false);
  });

  it('commits canonical planned values and both baselines after success', () => {
    const events: string[] = [];
    const before = task('updated');
    const canonical = { ...before, text: 'canonical' };
    const added = task('added');
    const addedLink = link('added-link', canonical.id, added.id);
    const state = appliedState(
      [before, task('deleted')],
      [link('deleted-link', canonical.id, 'deleted')],
    );
    const syncPlan = plan({
      next: [canonical, added],
      taskPlan: {
        moves: [],
        updates: [{ id: canonical.id, task: canonical }],
        deletes: ['deleted'],
        adds: [added],
      },
      linkPlan: { deletes: ['deleted-link'], adds: [addedLink] },
      orderKey: '>updated|>added',
      baseSortKey: 'next-base-sort',
      baseSortChanged: true,
    });

    const result = applyIncrementalGanttSync({
      plan: syncPlan,
      port: recordingPort(events),
      state,
      ephemeralSort: sortPort(events),
    });

    expect(result).toEqual({ reorderMoves: 1 });
    expect(state.tasks.get(canonical.id)).toBe(canonical);
    expect(state.tasks.has('deleted')).toBe(false);
    expect(state.tasks.get(added.id)).toBe(added);
    expect(state.links.has('deleted-link')).toBe(false);
    expect(state.links.get(addedLink.id)).toBe(addedLink);
    expect(state.orderKey).toBe(syncPlan.orderKey);
    expect(state.baseSortKey).toBe(syncPlan.baseSortKey);
  });

  it('reasserts an active ephemeral sort instead of replaying Base order', () => {
    const events: string[] = [];
    const state = appliedState();

    applyIncrementalGanttSync({
      plan: plan({
        next: [task('first'), task('second')],
        orderKey: '>first|>second',
      }),
      port: recordingPort(events),
      state,
      ephemeralSort: sortPort(events, true),
    });

    expect(events).toEqual(['reassert-sort']);
    expect(state.orderKey).toBe('>first|>second');
  });

  it('clears an active ephemeral sort before replaying changed Base order', () => {
    const events: string[] = [];

    const result = applyIncrementalGanttSync({
      plan: plan({
        next: [task('first'), task('second')],
        orderKey: '>first|>second',
        baseSortKey: 'next-base-sort',
        baseSortChanged: true,
      }),
      port: recordingPort(events),
      state: appliedState(),
      ephemeralSort: sortPort(events, true),
    });

    expect(events).toEqual(['clear-sort', 'move-after:second:first']);
    expect(result).toEqual({ reorderMoves: 1 });
  });

  it('clears an active ephemeral sort when the Base descriptor changes without reordering', () => {
    const events: string[] = [];
    const state = appliedState();
    state.orderKey = '>first|>second';
    const syncPlan = plan({
      next: [task('first'), task('second')],
      orderKey: state.orderKey,
      baseSortKey: 'next-base-sort',
      baseSortChanged: true,
    });

    const result = applyIncrementalGanttSync({
      plan: syncPlan,
      port: recordingPort(events),
      state,
      ephemeralSort: sortPort(events, true),
    });

    expect(events).toEqual(['clear-sort']);
    expect(result).toEqual({ reorderMoves: 0 });
    expect(state.orderKey).toBe(syncPlan.orderKey);
    expect(state.baseSortKey).toBe(syncPlan.baseSortKey);
  });

  it('skips reorder when the planned order is already applied', () => {
    const events: string[] = [];
    const state = appliedState();
    state.orderKey = '>first|>second';
    const syncPlan = plan({
      next: [task('first'), task('second')],
      orderKey: state.orderKey,
      baseSortKey: 'next-base-sort',
      baseSortChanged: true,
    });

    applyIncrementalGanttSync({
      plan: syncPlan,
      port: recordingPort(events),
      state,
      ephemeralSort: sortPort(events),
    });

    expect(events).toEqual([]);
    expect(state.baseSortKey).toBe(syncPlan.baseSortKey);
  });

  it('preserves only completed bookkeeping after a synchronous command failure', () => {
    const events: string[] = [];
    const firstBefore = task('first');
    const secondBefore = task('second', 'old-parent');
    const firstAfter = { ...firstBefore, text: 'first updated' };
    const secondAfter = {
      ...secondBefore,
      parent: 'new-parent',
      text: 'second updated',
    };
    const state = appliedState([firstBefore, secondBefore], [link('old-link')]);
    const port = recordingPort(events);
    const failure = new Error('update failed');
    port.updateTask = (id): void => {
      events.push(`update-task:${id}`);
      if (id === secondAfter.id) throw failure;
    };

    expect(() =>
      applyIncrementalGanttSync({
        plan: plan({
          taskPlan: {
            moves: [{ id: secondAfter.id, parent: 'new-parent' }],
            updates: [
              { id: firstAfter.id, task: firstAfter },
              { id: secondAfter.id, task: secondAfter },
            ],
            deletes: [],
            adds: [],
          },
          linkPlan: { deletes: ['old-link'], adds: [] },
        }),
        port,
        state,
        ephemeralSort: sortPort(events),
        onTaskAndLinkChangesApplied: () => events.push('task-link-phase-complete'),
      }),
    ).toThrow(failure);

    expect(events).toEqual([
      'move-parent:second:new-parent',
      'update-task:first',
      'update-task:second',
    ]);
    expect(state.tasks.get(firstAfter.id)).toBe(firstAfter);
    expect(state.tasks.get(secondAfter.id)).toBe(secondBefore);
    expect(state.links.has('old-link')).toBe(true);
    expect(state.orderKey).toBe('applied-order');
    expect(state.baseSortKey).toBe('applied-base-sort');
  });

  it('keeps data bookkeeping but leaves baselines stale when reorder fails', () => {
    const events: string[] = [];
    const before = task('updated');
    const after = { ...before, text: 'updated' };
    const state = appliedState([before]);
    const port = recordingPort(events);
    const failure = new Error('reorder failed');
    port.moveTaskAfter = (id, previousSiblingId): void => {
      events.push(`move-after:${id}:${previousSiblingId}`);
      throw failure;
    };

    expect(() =>
      applyIncrementalGanttSync({
        plan: plan({
          next: [task('first'), task('second')],
          orderKey: '>first|>second',
          taskPlan: {
            moves: [],
            updates: [{ id: after.id, task: after }],
            deletes: [],
            adds: [],
          },
        }),
        port,
        state,
        ephemeralSort: sortPort(events),
      }),
    ).toThrow(failure);

    expect(state.tasks.get(after.id)).toBe(after);
    expect(state.orderKey).toBe('applied-order');
    expect(state.baseSortKey).toBe('applied-base-sort');
  });
});
