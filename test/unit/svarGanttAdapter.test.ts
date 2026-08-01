import type { RenderLink } from '../../src/controller/InstanceExpansion';
import type { SvarTask } from '../../src/bases/ganttSync';
import { createSvarGanttAdapter } from '../../src/bases/svarGanttAdapter';

const ECHO_SOURCE = 'og-self';
const DEFAULT_OPTIONS = {
  echoSource: ECHO_SOURCE,
  cellEditColumnIds: [],
};

function task(id = 'Tasks/Alpha.md'): SvarTask {
  return {
    id,
    text: 'Alpha',
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

function link(): RenderLink {
  return {
    id: 'alpha-beta',
    source: 'Tasks/Alpha.md',
    target: 'Tasks/Beta.md',
    type: 'e2s',
    reltype: 'FINISHTOSTART',
    gap: null,
  };
}

function commandApi(taskResult: unknown = undefined) {
  return {
    exec: jest.fn(
      async (_action: string, _params?: unknown): Promise<unknown> => undefined,
    ),
    getTask: jest.fn((_id: string): unknown => taskResult),
  };
}

describe('createSvarGanttAdapter', () => {
  it('moves a task under its planned parent', () => {
    const api = commandApi();
    const adapter = createSvarGanttAdapter(api, DEFAULT_OPTIONS);

    adapter.moveTaskToParent('Tasks/Child.md', 0);

    expect(api.exec).toHaveBeenCalledWith('move-task', {
      id: 'Tasks/Child.md',
      target: 0,
      mode: 'child',
      eventSource: ECHO_SOURCE,
    });
  });

  it('updates a task with the supplied SVAR row', () => {
    const api = commandApi();
    const adapter = createSvarGanttAdapter(api, DEFAULT_OPTIONS);
    const updatedTask = task();

    adapter.updateTask(updatedTask.id, updatedTask);

    expect(api.exec).toHaveBeenCalledWith('update-task', {
      id: updatedTask.id,
      task: updatedTask,
      eventSource: ECHO_SOURCE,
    });
  });

  it('aligns editable flat keys before updating a task', () => {
    const api = commandApi();
    const adapter = createSvarGanttAdapter(api, {
      echoSource: ECHO_SOURCE,
      cellEditColumnIds: ['note.owner'],
    });
    const updatedTask = task();
    updatedTask.custom.properties = {
      'note.owner': { kind: 'text', value: 'Grace' },
    };

    adapter.updateTask(updatedTask.id, updatedTask);

    expect(api.exec).toHaveBeenCalledWith('update-task', {
      id: updatedTask.id,
      task: { ...updatedTask, 'note.owner': 'Grace' },
      eventSource: ECHO_SOURCE,
    });
  });

  it('returns immediately when an update command rejects asynchronously', async () => {
    const api = commandApi();
    const failure = new Error('store unavailable');
    const completion = Promise.reject(failure);
    const observedRejection = completion.catch((error: unknown) => error);
    api.exec.mockReturnValue(completion);
    const adapter = createSvarGanttAdapter(api, DEFAULT_OPTIONS);
    const updatedTask = task();

    const result = adapter.updateTask(updatedTask.id, updatedTask);

    expect(result).toBeUndefined();
    await expect(observedRejection).resolves.toBe(failure);
  });

  it('deletes a link by id', () => {
    const api = commandApi();
    const adapter = createSvarGanttAdapter(api, DEFAULT_OPTIONS);

    adapter.deleteLink('alpha-beta');

    expect(api.exec).toHaveBeenCalledWith('delete-link', {
      id: 'alpha-beta',
      eventSource: ECHO_SOURCE,
    });
  });

  it('deletes a task by id', () => {
    const api = commandApi();
    const adapter = createSvarGanttAdapter(api, DEFAULT_OPTIONS);

    adapter.deleteTask('Tasks/Alpha.md');

    expect(api.exec).toHaveBeenCalledWith('delete-task', {
      id: 'Tasks/Alpha.md',
      eventSource: ECHO_SOURCE,
    });
  });

  it('adds a task without waiting for the SVAR command', () => {
    const api = commandApi();
    const completion = Promise.resolve();
    api.exec.mockReturnValue(completion);
    const adapter = createSvarGanttAdapter(api, DEFAULT_OPTIONS);
    const addedTask = task();

    const result = adapter.addTask(addedTask);

    expect(result).toBeUndefined();
    expect(api.exec).toHaveBeenCalledWith('add-task', {
      task: addedTask,
      eventSource: ECHO_SOURCE,
    });
  });

  it('adds a link without waiting for the SVAR command', () => {
    const api = commandApi();
    const completion = Promise.resolve();
    api.exec.mockReturnValue(completion);
    const adapter = createSvarGanttAdapter(api, DEFAULT_OPTIONS);
    const addedLink = link();

    const result = adapter.addLink(addedLink);

    expect(result).toBeUndefined();
    expect(api.exec).toHaveBeenCalledWith('add-link', {
      link: addedLink,
      eventSource: ECHO_SOURCE,
    });
  });

  it('moves a task after its planned sibling', () => {
    const api = commandApi();
    const adapter = createSvarGanttAdapter(api, DEFAULT_OPTIONS);

    adapter.moveTaskAfter('Tasks/Beta.md', 'Tasks/Alpha.md');

    expect(api.exec).toHaveBeenCalledWith('move-task', {
      id: 'Tasks/Beta.md',
      target: 'Tasks/Alpha.md',
      mode: 'after',
      eventSource: ECHO_SOURCE,
    });
  });

  it('reports an existing SVAR task', () => {
    const api = commandApi(task());
    const adapter = createSvarGanttAdapter(api, DEFAULT_OPTIONS);

    const exists = adapter.hasTask('Tasks/Alpha.md');

    expect(exists).toBe(true);
    expect(api.getTask).toHaveBeenCalledWith('Tasks/Alpha.md');
  });

  it('reports a missing SVAR task', () => {
    const api = commandApi();
    const adapter = createSvarGanttAdapter(api, DEFAULT_OPTIONS);

    const exists = adapter.hasTask('Tasks/Missing.md');

    expect(exists).toBe(false);
  });

  it('reports a missing task when the SVAR lookup is unavailable', () => {
    const api = { exec: commandApi().exec };
    const adapter = createSvarGanttAdapter(api, DEFAULT_OPTIONS);

    const exists = adapter.hasTask('Tasks/Missing.md');

    expect(exists).toBe(false);
  });

  it('reports a missing task when the SVAR lookup throws', () => {
    const api = commandApi();
    api.getTask.mockImplementation(() => {
      throw new Error('store unavailable');
    });
    const adapter = createSvarGanttAdapter(api, DEFAULT_OPTIONS);

    const exists = adapter.hasTask('Tasks/Alpha.md');

    expect(exists).toBe(false);
  });

  it('does not hide a synchronous injected command failure', () => {
    const api = commandApi();
    const failure = new Error('store unavailable');
    api.exec.mockImplementation(() => {
      throw failure;
    });
    const adapter = createSvarGanttAdapter(api, DEFAULT_OPTIONS);

    expect(() => adapter.deleteLink('alpha-beta')).toThrow(failure);
  });
});
