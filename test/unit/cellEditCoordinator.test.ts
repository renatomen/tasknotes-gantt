import { describe, expect, it, jest } from '@jest/globals';
import {
  commitBridgeCellEdit,
  createCellEditCoordinator,
} from '../../src/bases/cellEditCoordinator';
import type { CellRender } from '../../src/bases/cellRender';
import type { TypedValue } from '../../src/bases/propertyValues';

const numberValue = (value: number): TypedValue => ({ kind: 'number', value });
const textValue = (value: string): TypedValue => ({ kind: 'text', value });
const dateValue = (value: Date): TypedValue => ({ kind: 'date', value });

function makeActions() {
  return {
    applyAndPersist: jest.fn<(instanceId: string, columnId: string, value: unknown) => void>(),
    notify: jest.fn<(message: string) => void>(),
  };
}

type PersistCellEdit = (
  instanceId: string,
  columnId: string,
  value: unknown,
) => Promise<void>;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushPersistence(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function makeCoordinatorHarness() {
  const taskOneProperties: Record<string, TypedValue> = {
    'note.summary': textValue('Draft'),
  };
  const taskTwoProperties: Record<string, TypedValue> = {
    'note.summary': textValue('Second'),
  };
  const taskOneRenders: Record<string, CellRender> = {
    'note.summary': { mode: 'markdown', source: '**Draft**' },
  };
  const taskTwoRenders: Record<string, CellRender> = {
    'note.summary': { mode: 'text', text: 'Second' },
  };
  const properties = new Map([
    ['task-1', taskOneProperties],
    ['task-2', taskTwoProperties],
  ]);
  const renders = new Map([
    ['task-1', taskOneRenders],
    ['task-2', taskTwoRenders],
  ]);
  const rawValues = new Map<string, unknown>();
  const persist = jest.fn<PersistCellEdit>().mockResolvedValue(undefined);
  const rawStoredValueOf = jest.fn(
    (instanceId: string, columnId: string): unknown =>
      rawValues.get(`${instanceId}:${columnId}`),
  );
  const refreshFlatCell = jest.fn(
    (_instanceId: string, _columnId: string, _value: unknown): void => undefined,
  );
  const notify = jest.fn<(message: string) => void>();
  const reportPersistenceFailure = jest.fn<(error: unknown) => void>();
  let currentPersistence: PersistCellEdit | undefined = persist;

  const coordinator = createCellEditCoordinator({
    getPersistence: () => currentPersistence,
    storedPropertiesOf: (instanceId) => properties.get(instanceId),
    cellRendersOf: (instanceId) => renders.get(instanceId),
    rawStoredValueOf,
    renderText: (value) => `render:${String(value.value ?? '')}`,
    refreshFlatCell,
    notify,
    reportPersistenceFailure,
    persistenceTimeoutMs: 10_000,
  });

  return {
    coordinator,
    properties,
    renders,
    rawValues,
    persist,
    rawStoredValueOf,
    refreshFlatCell,
    notify,
    reportPersistenceFailure,
    setPersistence(next: PersistCellEdit | undefined): void {
      currentPersistence = next;
    },
  };
}

function bridgeTextEdit(rawValue: string) {
  return {
    instanceId: 'task-1',
    columnId: 'note.summary',
    kind: 'text' as const,
    rawValue,
  };
}

describe('commitBridgeCellEdit', () => {
  it('returns false without side effects for an unchanged commit', () => {
    const actions = makeActions();

    const committed = commitBridgeCellEdit(
      {
        instanceId: 'task-1',
        columnId: 'note.points',
        kind: 'number',
        rawValue: 3,
        storedValue: numberValue(3),
      },
      actions,
    );

    expect(committed).toBe(false);
    expect(actions.notify).not.toHaveBeenCalled();
    expect(actions.applyAndPersist).not.toHaveBeenCalled();
  });

  it('reports the exact cast rejection without applying the edit', () => {
    const actions = makeActions();

    const committed = commitBridgeCellEdit(
      {
        instanceId: 'task-1',
        columnId: 'note.points',
        kind: 'number',
        rawValue: 'abc',
        storedValue: numberValue(3),
      },
      actions,
    );

    expect(committed).toBe(false);
    expect(actions.notify).toHaveBeenCalledWith("Couldn't save — This field needs a number.");
    expect(actions.applyAndPersist).not.toHaveBeenCalled();
  });

  it('applies a valid scalar commit exactly once', () => {
    const actions = makeActions();

    const committed = commitBridgeCellEdit(
      {
        instanceId: 'task-1',
        columnId: 'note.summary',
        kind: 'text',
        rawValue: 'Draft v2',
        storedValue: textValue('Draft'),
      },
      actions,
    );

    expect(committed).toBe(true);
    expect(actions.notify).not.toHaveBeenCalled();
    expect(actions.applyAndPersist).toHaveBeenCalledTimes(1);
    expect(actions.applyAndPersist).toHaveBeenCalledWith(
      'task-1',
      'note.summary',
      'Draft v2',
    );
  });

  it('recovers a bridge-coerced choice from configured values', () => {
    const actions = makeActions();

    const committed = commitBridgeCellEdit(
      {
        instanceId: 'task-1',
        columnId: 'note.status',
        kind: 'choice-status',
        rawValue: 1,
        storedValue: textValue('open'),
        choiceValues: ['01', 'open'],
      },
      actions,
    );

    expect(committed).toBe(true);
    expect(actions.applyAndPersist).toHaveBeenCalledWith('task-1', 'note.status', '01');
  });

  it('rejects a mapped start after the real end', () => {
    const actions = makeActions();
    const editedStart = new Date(2026, 3, 6);

    const committed = commitBridgeCellEdit(
      {
        instanceId: 'task-1',
        columnId: 'note.scheduled',
        kind: 'date',
        rawValue: editedStart,
        storedValue: dateValue(new Date(2026, 3, 1)),
        dateRole: 'start',
        datedRow: {
          start: new Date(2026, 3, 1),
          end: new Date(2026, 3, 5, 23, 59, 59, 999),
          dateStatus: 'complete',
        },
      },
      actions,
    );

    expect(committed).toBe(false);
    expect(actions.notify).toHaveBeenCalledWith(
      "Couldn't save — the start date must not be after the end date.",
    );
    expect(actions.applyAndPersist).not.toHaveBeenCalled();
  });

  it('rejects a mapped end before the real start', () => {
    const actions = makeActions();
    const editedEnd = new Date(2026, 3, 4);

    const committed = commitBridgeCellEdit(
      {
        instanceId: 'task-1',
        columnId: 'note.due',
        kind: 'date',
        rawValue: editedEnd,
        storedValue: dateValue(new Date(2026, 3, 8)),
        dateRole: 'end',
        datedRow: {
          start: new Date(2026, 3, 5),
          end: new Date(2026, 3, 8, 23, 59, 59, 999),
          dateStatus: 'complete',
        },
      },
      actions,
    );

    expect(committed).toBe(false);
    expect(actions.notify).toHaveBeenCalledWith(
      "Couldn't save — the end date must not be before the start date.",
    );
    expect(actions.applyAndPersist).not.toHaveBeenCalled();
  });

  it('clears a mapped date without cross-field validation', () => {
    const actions = makeActions();

    const committed = commitBridgeCellEdit(
      {
        instanceId: 'task-1',
        columnId: 'note.scheduled',
        kind: 'date',
        rawValue: '',
        storedValue: dateValue(new Date(2026, 3, 1)),
        dateRole: 'start',
        datedRow: {
          start: new Date(2026, 3, 1),
          end: new Date(2026, 3, 5, 23, 59, 59, 999),
          dateStatus: 'complete',
        },
      },
      actions,
    );

    expect(committed).toBe(true);
    expect(actions.notify).not.toHaveBeenCalled();
    expect(actions.applyAndPersist).toHaveBeenCalledWith(
      'task-1',
      'note.scheduled',
      null,
    );
  });

  it('allows equal-day mapped dates', () => {
    const actions = makeActions();
    const editedStart = new Date(2026, 3, 5, 8);

    const committed = commitBridgeCellEdit(
      {
        instanceId: 'task-1',
        columnId: 'note.scheduled',
        kind: 'date',
        rawValue: editedStart,
        storedValue: dateValue(new Date(2026, 3, 1)),
        dateRole: 'start',
        datedRow: {
          start: new Date(2026, 3, 1),
          end: new Date(2026, 3, 5, 23, 59, 59, 999),
          dateStatus: 'complete',
        },
      },
      actions,
    );

    expect(committed).toBe(true);
    expect(actions.applyAndPersist).toHaveBeenCalledWith(
      'task-1',
      'note.scheduled',
      editedStart,
    );
  });

  it('does not apply cross-field validation to an unmapped date', () => {
    const actions = makeActions();
    const editedDate = new Date(2026, 3, 6);

    const committed = commitBridgeCellEdit(
      {
        instanceId: 'task-1',
        columnId: 'note.reviewed',
        kind: 'date',
        rawValue: editedDate,
        storedValue: dateValue(new Date(2026, 3, 1)),
        datedRow: {
          start: new Date(2026, 3, 9),
          end: new Date(2026, 3, 12, 23, 59, 59, 999),
          dateStatus: 'complete',
        },
      },
      actions,
    );

    expect(committed).toBe(true);
    expect(actions.applyAndPersist).toHaveBeenCalledWith(
      'task-1',
      'note.reviewed',
      editedDate,
    );
  });
});

describe('createCellEditCoordinator', () => {
  it('rejects a bridge commit without persistence before changing local state', () => {
    const harness = makeCoordinatorHarness();
    const previousValue = harness.properties.get('task-1')?.['note.summary'];
    const previousRender = harness.renders.get('task-1')?.['note.summary'];
    harness.setPersistence(undefined);

    const committed = harness.coordinator.commitBridge(bridgeTextEdit('Draft v2'));

    expect(committed).toBe(false);
    expect(harness.properties.get('task-1')?.['note.summary']).toBe(previousValue);
    expect(harness.renders.get('task-1')?.['note.summary']).toBe(previousRender);
    expect(harness.persist).not.toHaveBeenCalled();
    expect(harness.refreshFlatCell).not.toHaveBeenCalled();
    expect(harness.notify).not.toHaveBeenCalled();
    expect(harness.coordinator.isPending('task-1')).toBe(false);
  });

  it('reports a bridge cast rejection without changing local state', () => {
    const harness = makeCoordinatorHarness();
    const previousValue = numberValue(3);
    const previousRender: CellRender = { mode: 'text', text: '3' };
    harness.properties.get('task-1')!['note.points'] = previousValue;
    harness.renders.get('task-1')!['note.points'] = previousRender;

    const committed = harness.coordinator.commitBridge({
      instanceId: 'task-1',
      columnId: 'note.points',
      kind: 'number',
      rawValue: 'abc',
    });

    expect(committed).toBe(false);
    expect(harness.notify).toHaveBeenCalledWith(
      "Couldn't save — This field needs a number.",
    );
    expect(harness.properties.get('task-1')?.['note.points']).toBe(previousValue);
    expect(harness.renders.get('task-1')?.['note.points']).toBe(previousRender);
    expect(harness.persist).not.toHaveBeenCalled();
    expect(harness.refreshFlatCell).not.toHaveBeenCalled();
    expect(harness.reportPersistenceFailure).not.toHaveBeenCalled();
    expect(harness.coordinator.isPending('task-1')).toBe(false);
  });

  it('reports a bridge date-order rejection without changing local state', () => {
    const harness = makeCoordinatorHarness();
    const previousValue = dateValue(new Date(2026, 3, 1));
    const previousRender: CellRender = {
      mode: 'text',
      text: '01/04/2026',
    };
    harness.properties.get('task-1')!['note.scheduled'] = previousValue;
    harness.renders.get('task-1')!['note.scheduled'] = previousRender;

    const committed = harness.coordinator.commitBridge({
      instanceId: 'task-1',
      columnId: 'note.scheduled',
      kind: 'date',
      rawValue: new Date(2026, 3, 6),
      dateRole: 'start',
      datedRow: {
        start: new Date(2026, 3, 1),
        end: new Date(2026, 3, 5, 23, 59, 59, 999),
        dateStatus: 'complete',
      },
    });

    expect(committed).toBe(false);
    expect(harness.notify).toHaveBeenCalledWith(
      "Couldn't save — the start date must not be after the end date.",
    );
    expect(harness.properties.get('task-1')?.['note.scheduled']).toBe(
      previousValue,
    );
    expect(harness.renders.get('task-1')?.['note.scheduled']).toBe(
      previousRender,
    );
    expect(harness.persist).not.toHaveBeenCalled();
    expect(harness.refreshFlatCell).not.toHaveBeenCalled();
    expect(harness.reportPersistenceFailure).not.toHaveBeenCalled();
    expect(harness.coordinator.isPending('task-1')).toBe(false);
  });

  it('reads the current stored value when suppressing an unchanged bridge commit', () => {
    const harness = makeCoordinatorHarness();

    const committed = harness.coordinator.commitBridge(bridgeTextEdit('Draft'));

    expect(committed).toBe(false);
    expect(harness.persist).not.toHaveBeenCalled();
    expect(harness.refreshFlatCell).not.toHaveBeenCalled();
    expect(harness.coordinator.isPending('task-1')).toBe(false);
  });

  it('optimistically applies an accepted bridge edit without refreshing the flat cell', async () => {
    const harness = makeCoordinatorHarness();
    const pendingWrite = deferred<void>();
    harness.persist.mockReturnValueOnce(pendingWrite.promise);

    const committed = harness.coordinator.commitBridge(bridgeTextEdit('Draft v2'));

    expect(committed).toBe(true);
    expect(harness.properties.get('task-1')?.['note.summary']).toEqual(
      textValue('Draft v2'),
    );
    expect(harness.renders.get('task-1')?.['note.summary']).toEqual({
      mode: 'text',
      text: 'render:Draft v2',
    });
    expect(harness.coordinator.isPending('task-1')).toBe(true);
    expect(harness.persist).toHaveBeenCalledWith(
      'task-1',
      'note.summary',
      'Draft v2',
    );
    expect(harness.refreshFlatCell).not.toHaveBeenCalled();
    pendingWrite.resolve();
    await flushPersistence();
  });

  it('retains the optimistic bridge value and releases pending state after success', async () => {
    const harness = makeCoordinatorHarness();

    harness.coordinator.commitBridge(bridgeTextEdit('Draft v2'));
    await flushPersistence();

    expect(harness.properties.get('task-1')?.['note.summary']).toEqual(
      textValue('Draft v2'),
    );
    expect(harness.renders.get('task-1')?.['note.summary']).toEqual({
      mode: 'text',
      text: 'render:Draft v2',
    });
    expect(harness.coordinator.isPending('task-1')).toBe(false);
    expect(harness.notify).not.toHaveBeenCalled();
  });

  it('restores the previous typed value and render identity after persistence fails', async () => {
    const harness = makeCoordinatorHarness();
    const error = new Error('write failed');
    const previousValue = harness.properties.get('task-1')?.['note.summary'];
    const previousRender = harness.renders.get('task-1')?.['note.summary'];
    harness.persist.mockRejectedValueOnce(error);

    harness.coordinator.commitBridge(bridgeTextEdit('Draft v2'));
    await flushPersistence();

    expect(harness.properties.get('task-1')?.['note.summary']).toBe(previousValue);
    expect(harness.renders.get('task-1')?.['note.summary']).toBe(previousRender);
    expect(harness.refreshFlatCell).toHaveBeenCalledWith(
      'task-1',
      'note.summary',
      'Draft',
    );
    expect(harness.reportPersistenceFailure).toHaveBeenCalledWith(error);
    expect(harness.notify).toHaveBeenCalledWith(
      "Couldn't save the change — check TaskNotes is running.",
    );
    expect(harness.coordinator.isPending('task-1')).toBe(false);
  });

  it('removes an optimistic render after failure when no previous render existed', async () => {
    const harness = makeCoordinatorHarness();
    delete harness.renders.get('task-1')?.['note.summary'];
    harness.persist.mockRejectedValueOnce(new Error('write failed'));

    harness.coordinator.commitBridge(bridgeTextEdit('Draft v2'));
    await flushPersistence();

    expect(harness.renders.get('task-1')).not.toHaveProperty('note.summary');
  });

  it('does nothing when a chips list is unchanged from raw storage', () => {
    const harness = makeCoordinatorHarness();
    harness.rawValues.set(
      'task-1:note.related',
      ['[[Alpha|Alias]]', 'Plain'],
    );

    harness.coordinator.commitChips({
      instanceId: 'task-1',
      columnId: 'note.related',
      raw: ['[[Alpha|Alias]]', 'Plain'],
    });

    expect(harness.rawStoredValueOf).toHaveBeenCalledTimes(1);
    expect(harness.persist).not.toHaveBeenCalled();
    expect(harness.refreshFlatCell).not.toHaveBeenCalled();
    expect(harness.coordinator.isPending('task-1')).toBe(false);
  });

  it('rejects a changed chips commit without persistence before changing local state', () => {
    const harness = makeCoordinatorHarness();
    const previousValue: TypedValue = {
      kind: 'list',
      value: ['Alpha'],
    };
    const previousRender: CellRender = {
      mode: 'markdown',
      source: '[[Alpha]]',
    };
    harness.properties.get('task-1')!['note.related'] = previousValue;
    harness.renders.get('task-1')!['note.related'] = previousRender;
    harness.rawValues.set('task-1:note.related', ['[[Alpha]]']);
    harness.setPersistence(undefined);

    harness.coordinator.commitChips({
      instanceId: 'task-1',
      columnId: 'note.related',
      raw: ['[[Beta]]'],
    });

    expect(harness.properties.get('task-1')?.['note.related']).toBe(
      previousValue,
    );
    expect(harness.renders.get('task-1')?.['note.related']).toBe(previousRender);
    expect(harness.persist).not.toHaveBeenCalled();
    expect(harness.refreshFlatCell).not.toHaveBeenCalled();
    expect(harness.notify).not.toHaveBeenCalled();
    expect(harness.reportPersistenceFailure).not.toHaveBeenCalled();
    expect(harness.coordinator.isPending('task-1')).toBe(false);
  });

  it('persists the exact changed chips array after one optimistic flat refresh', async () => {
    const harness = makeCoordinatorHarness();
    const pendingWrite = deferred<void>();
    const events: string[] = [];
    const raw = ['[[Alpha|Alias]]', '[[Beta]]'];
    harness.rawValues.set('task-1:note.related', ['[[Alpha|Alias]]']);
    harness.refreshFlatCell.mockImplementation(() => {
      events.push('refresh');
    });
    harness.persist.mockImplementationOnce(async () => {
      events.push('persist');
      return pendingWrite.promise;
    });

    harness.coordinator.commitChips({
      instanceId: 'task-1',
      columnId: 'note.related',
      raw,
    });

    expect(events).toEqual(['refresh', 'persist']);
    expect(harness.persist).toHaveBeenCalledTimes(1);
    expect(harness.persist.mock.calls[0]?.[2]).toBe(raw);
    expect(harness.refreshFlatCell).toHaveBeenCalledWith(
      'task-1',
      'note.related',
      ['Alias', 'Beta'],
    );
    expect(harness.coordinator.isPending('task-1')).toBe(true);
    pendingWrite.resolve();
    await flushPersistence();
  });

  it('restores a changed chips edit after persistence fails', async () => {
    const harness = makeCoordinatorHarness();
    const error = new Error('write failed');
    const events: string[] = [];
    const previousValue: TypedValue = {
      kind: 'list',
      value: ['Alpha'],
    };
    const previousRender: CellRender = {
      mode: 'markdown',
      source: '[[Alpha|Alias]]',
    };
    harness.properties.get('task-1')!['note.related'] = previousValue;
    harness.renders.get('task-1')!['note.related'] = previousRender;
    harness.rawValues.set('task-1:note.related', ['[[Alpha|Alias]]']);
    harness.refreshFlatCell.mockImplementation(() => {
      events.push('refresh');
    });
    harness.persist.mockImplementationOnce(() => {
      events.push('persist');
      return Promise.reject(error);
    });
    harness.reportPersistenceFailure.mockImplementation(() => {
      events.push('report');
    });
    harness.notify.mockImplementation(() => {
      events.push('notify');
    });

    harness.coordinator.commitChips({
      instanceId: 'task-1',
      columnId: 'note.related',
      raw: ['[[Beta]]'],
    });
    expect(events).toEqual(['refresh', 'persist']);
    await flushPersistence();

    expect(events).toEqual([
      'refresh',
      'persist',
      'report',
      'refresh',
      'notify',
    ]);
    expect(harness.properties.get('task-1')?.['note.related']).toBe(
      previousValue,
    );
    expect(harness.renders.get('task-1')?.['note.related']).toBe(previousRender);
    expect(harness.refreshFlatCell).toHaveBeenCalledTimes(2);
    expect(harness.refreshFlatCell).toHaveBeenNthCalledWith(
      1,
      'task-1',
      'note.related',
      ['Beta'],
    );
    expect(harness.refreshFlatCell).toHaveBeenNthCalledWith(
      2,
      'task-1',
      'note.related',
      ['Alpha'],
    );
    expect(harness.notify).toHaveBeenCalledWith(
      "Couldn't save the change — check TaskNotes is running.",
    );
    expect(harness.coordinator.isPending('task-1')).toBe(false);
  });

  it('rolls back through the empty baseline when a row is absent from local state', async () => {
    const harness = makeCoordinatorHarness();
    const error = new Error('write failed');
    harness.persist.mockRejectedValueOnce(error);

    const committed = harness.coordinator.commitBridge({
      instanceId: 'missing-task',
      columnId: 'note.summary',
      kind: 'text',
      rawValue: 'Draft',
    });

    expect(committed).toBe(true);
    expect(harness.persist).toHaveBeenCalledWith(
      'missing-task',
      'note.summary',
      'Draft',
    );
    expect(harness.coordinator.isPending('missing-task')).toBe(true);
    await flushPersistence();

    expect(harness.refreshFlatCell).toHaveBeenCalledWith(
      'missing-task',
      'note.summary',
      '',
    );
    expect(harness.reportPersistenceFailure).toHaveBeenCalledWith(error);
    expect(harness.notify).toHaveBeenCalledWith(
      "Couldn't save the change — check TaskNotes is running.",
    );
    expect(harness.coordinator.isPending('missing-task')).toBe(false);
  });

  it('ignores a same-instance chips commit while persistence is pending', async () => {
    const harness = makeCoordinatorHarness();
    const pendingWrite = deferred<void>();
    harness.persist.mockReturnValueOnce(pendingWrite.promise);
    harness.coordinator.commitBridge(bridgeTextEdit('Draft v2'));
    harness.rawStoredValueOf.mockClear();

    harness.coordinator.commitChips({
      instanceId: 'task-1',
      columnId: 'note.related',
      raw: ['[[Alpha]]'],
    });

    expect(harness.rawStoredValueOf).not.toHaveBeenCalled();
    expect(harness.persist).toHaveBeenCalledTimes(1);
    expect(harness.refreshFlatCell).not.toHaveBeenCalled();
    pendingWrite.resolve();
    await flushPersistence();
  });

  it('allows a different source task to commit while the first is pending', async () => {
    const harness = makeCoordinatorHarness();
    const firstWrite = deferred<void>();
    const secondWrite = deferred<void>();
    harness.persist
      .mockReturnValueOnce(firstWrite.promise)
      .mockReturnValueOnce(secondWrite.promise);
    harness.rawValues.set('task-2:note.related', []);
    harness.coordinator.commitBridge(bridgeTextEdit('Draft v2'));

    harness.coordinator.commitChips({
      instanceId: 'task-2',
      columnId: 'note.related',
      raw: ['[[Other]]'],
    });

    expect(harness.persist).toHaveBeenCalledTimes(2);
    expect(harness.coordinator.isPending('task-1')).toBe(true);
    expect(harness.coordinator.isPending('task-2')).toBe(true);
    firstWrite.resolve();
    secondWrite.resolve();
    await flushPersistence();
  });

  it('preserves sibling rollback clobber after concurrent shared-source commits', async () => {
    const harness = makeCoordinatorHarness();
    const firstWrite = deferred<void>();
    const secondWrite = deferred<void>();
    const sharedProperties = harness.properties.get('task-1')!;
    const sharedRenders = harness.renders.get('task-1')!;
    const originalValue = sharedProperties['note.summary'];
    const originalRender = sharedRenders['note.summary'];
    const firstError = new Error('first write failed');
    harness.properties.set('task-1-sibling', sharedProperties);
    harness.renders.set('task-1-sibling', sharedRenders);
    harness.persist
      .mockReturnValueOnce(firstWrite.promise)
      .mockReturnValueOnce(secondWrite.promise);

    const firstCommitted = harness.coordinator.commitBridge(
      bridgeTextEdit('Draft v2'),
    );
    expect(harness.coordinator.isPending('task-1-sibling')).toBe(false);
    const secondCommitted = harness.coordinator.commitBridge({
      instanceId: 'task-1-sibling',
      columnId: 'note.summary',
      kind: 'text',
      rawValue: 'Draft v3',
    });

    expect(firstCommitted).toBe(true);
    expect(secondCommitted).toBe(true);
    expect(harness.persist).toHaveBeenCalledTimes(2);
    expect(sharedProperties['note.summary']).toEqual(textValue('Draft v3'));
    expect(harness.coordinator.isPending('task-1')).toBe(true);
    expect(harness.coordinator.isPending('task-1-sibling')).toBe(true);
    secondWrite.resolve();
    await flushPersistence();
    expect(harness.coordinator.isPending('task-1-sibling')).toBe(false);
    expect(sharedProperties['note.summary']).toEqual(textValue('Draft v3'));

    firstWrite.reject(firstError);
    await flushPersistence();

    expect(sharedProperties['note.summary']).toBe(originalValue);
    expect(sharedRenders['note.summary']).toBe(originalRender);
    expect(harness.refreshFlatCell).toHaveBeenCalledWith(
      'task-1',
      'note.summary',
      'Draft',
    );
    expect(harness.reportPersistenceFailure).toHaveBeenCalledWith(firstError);
    expect(harness.coordinator.isPending('task-1')).toBe(false);
  });

  it.each(['resolve', 'reject'] as const)(
    'preserves timeout rollback and ignores a late %s from the underlying write',
    async (lateOutcome) => {
      jest.useFakeTimers();
      try {
        const harness = makeCoordinatorHarness();
        const pendingWrite = deferred<void>();
        const previousValue = harness.properties.get('task-1')?.['note.summary'];
        const previousRender = harness.renders.get('task-1')?.['note.summary'];
        harness.persist.mockReturnValueOnce(pendingWrite.promise);
        harness.coordinator.commitBridge(bridgeTextEdit('Draft v2'));

        await jest.advanceTimersByTimeAsync(9_999);
        expect(harness.coordinator.isPending('task-1')).toBe(true);
        expect(harness.notify).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(1);
        expect(harness.coordinator.isPending('task-1')).toBe(false);
        expect(harness.properties.get('task-1')?.['note.summary']).toBe(previousValue);
        expect(harness.renders.get('task-1')?.['note.summary']).toBe(previousRender);
        expect(harness.notify).toHaveBeenCalledTimes(1);
        expect(harness.refreshFlatCell).toHaveBeenCalledTimes(1);

        if (lateOutcome === 'resolve') {
          pendingWrite.resolve();
        } else {
          pendingWrite.reject(new Error('late write failure'));
        }
        await flushPersistence();

        expect(harness.notify).toHaveBeenCalledTimes(1);
        expect(harness.refreshFlatCell).toHaveBeenCalledTimes(1);
        expect(harness.reportPersistenceFailure).toHaveBeenCalledWith(
          expect.objectContaining({ message: 'write timed out' }),
        );
      } finally {
        jest.useRealTimers();
      }
    },
  );
});
