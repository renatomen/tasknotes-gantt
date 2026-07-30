import { describe, expect, it, jest } from '@jest/globals';
import { commitBridgeCellEdit } from '../../src/bases/cellEditCoordinator';
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
