/**
 * cellEditCommit unit tests (inline cell editing — commit casting + editor seeds).
 *
 * Verifies the pure commit resolver that sits between SVAR's update-cell bridge
 * (which coerces numeric strings / true / [] via `v *= 1`) and
 * `controller.mutateProperty`: every cast, reject, and noop path per shipped
 * editor kind, plus the editor seed values (what the column getter hands the
 * opening editor), the flat-baseline restore/alignment values, and the
 * editor-attachment helpers the grid columns are built from.
 */

import { describe, it, expect } from '@jest/globals';
import {
  BOOLEAN_EDITOR_OPTIONS,
  counterpartDate,
  dateRoleColumns,
  editorAttachedColumnIds,
  editorSeedValue,
  resolveCellEditCommit,
  rowEditorConfig,
  shippedEditorKind,
  shippedEditorKinds,
  storedFlatValue,
  svarEditorConfigFor,
  violatesDateOrder,
  withAlignedFlatKeys,
} from '../../src/bases/cellEditCommit';
import type { CellEditorDescriptor } from '../../src/bases/cellEditability';
import { classifyCellEdit } from '../../src/bases/cascadeGate';
import type { TypedValue } from '../../src/bases/propertyValues';

const empty: TypedValue = { kind: 'empty', value: null };
const text = (v: string): TypedValue => ({ kind: 'text', value: v });
const num = (v: number): TypedValue => ({ kind: 'number', value: v });
const bool = (v: boolean): TypedValue => ({ kind: 'boolean', value: v });
const list = (v: string[]): TypedValue => ({ kind: 'list', value: v });
const date = (v: Date): TypedValue => ({ kind: 'date', value: v });

describe('shippedEditorKind', () => {
  it('ships text, number, boolean, list, and date', () => {
    expect(shippedEditorKind('text')).toBe('text');
    expect(shippedEditorKind('number')).toBe('number');
    expect(shippedEditorKind('boolean')).toBe('boolean');
    expect(shippedEditorKind('list')).toBe('list');
    expect(shippedEditorKind('date')).toBe('date');
  });

  it('resolves no shipped editor for choice and suggest kinds', () => {
    expect(shippedEditorKind('choice-status')).toBeNull();
    expect(shippedEditorKind('choice-priority')).toBeNull();
    expect(shippedEditorKind('suggest')).toBeNull();
  });
});

describe('resolveCellEditCommit — number kind', () => {
  it('commits a finite number', () => {
    expect(resolveCellEditCommit('number', 42, num(3))).toEqual({ action: 'commit', value: 42 });
  });

  it('commits a numeric string as a number', () => {
    expect(resolveCellEditCommit('number', '7.5', num(3))).toEqual({ action: 'commit', value: 7.5 });
  });

  it('rejects non-numeric text', () => {
    const outcome = resolveCellEditCommit('number', 'abc', num(3));
    expect(outcome.action).toBe('reject');
  });

  it('rejects a non-finite number', () => {
    expect(resolveCellEditCommit('number', Number.POSITIVE_INFINITY, num(3)).action).toBe('reject');
    expect(resolveCellEditCommit('number', Number.NaN, num(3)).action).toBe('reject');
  });

  it('clears with null on an empty string', () => {
    expect(resolveCellEditCommit('number', '', num(3))).toEqual({ action: 'commit', value: null });
  });

  it('treats clearing an already-empty value as a noop', () => {
    expect(resolveCellEditCommit('number', '', empty)).toEqual({ action: 'noop' });
  });

  it('treats re-committing the stored number as a noop', () => {
    expect(resolveCellEditCommit('number', 3, num(3))).toEqual({ action: 'noop' });
  });

  it('treats a bridge-coerced number matching a stored numeric STRING as a noop', () => {
    expect(resolveCellEditCommit('number', 2026, text('2026'))).toEqual({ action: 'noop' });
  });
});

describe('resolveCellEditCommit — boolean kind', () => {
  it('commits a raw boolean', () => {
    expect(resolveCellEditCommit('boolean', false, bool(true))).toEqual({ action: 'commit', value: false });
  });

  it('casts the bridge-coerced 1/0 back to booleans', () => {
    expect(resolveCellEditCommit('boolean', 1, bool(false))).toEqual({ action: 'commit', value: true });
    expect(resolveCellEditCommit('boolean', 0, bool(true))).toEqual({ action: 'commit', value: false });
  });

  it("casts 'true'/'false' strings (any case) to booleans", () => {
    expect(resolveCellEditCommit('boolean', 'True', bool(false))).toEqual({ action: 'commit', value: true });
    expect(resolveCellEditCommit('boolean', 'false', bool(true))).toEqual({ action: 'commit', value: false });
  });

  it('rejects any other value', () => {
    expect(resolveCellEditCommit('boolean', 'yes please', bool(true)).action).toBe('reject');
    expect(resolveCellEditCommit('boolean', 2, bool(true)).action).toBe('reject');
  });

  it('clears with null on an empty string', () => {
    expect(resolveCellEditCommit('boolean', '', bool(true))).toEqual({ action: 'commit', value: null });
  });

  it('treats re-committing the stored boolean as a noop', () => {
    expect(resolveCellEditCommit('boolean', 1, bool(true))).toEqual({ action: 'noop' });
    expect(resolveCellEditCommit('boolean', false, bool(false))).toEqual({ action: 'noop' });
  });
});

describe('resolveCellEditCommit — list kind', () => {
  it('splits a comma-separated string into trimmed non-empty entries', () => {
    expect(resolveCellEditCommit('list', ' a, b ,, c ', list(['x']))).toEqual({
      action: 'commit',
      value: ['a', 'b', 'c'],
    });
  });

  it('commits an all-separator string as an empty list', () => {
    expect(resolveCellEditCommit('list', ' , ,', list(['x']))).toEqual({ action: 'commit', value: [] });
  });

  it('clears with null on an empty string', () => {
    expect(resolveCellEditCommit('list', '', list(['x']))).toEqual({ action: 'commit', value: null });
  });

  it('wraps a bridge-coerced lone number as a single entry', () => {
    expect(resolveCellEditCommit('list', 12, list(['x']))).toEqual({ action: 'commit', value: ['12'] });
  });

  it('treats re-committing the stored items as a noop', () => {
    expect(resolveCellEditCommit('list', 'a, b', list(['a', 'b']))).toEqual({ action: 'noop' });
  });

  it('treats re-committing the seeded string of an item containing a comma as a noop', () => {
    // A frontmatter [[Doe, John]] classifies to the display item 'Doe, John';
    // the editor seeds that string. Re-committing it unchanged must not split
    // it into two entries (the no-change-corrupts case).
    expect(resolveCellEditCommit('list', 'Doe, John', list(['Doe, John']))).toEqual({
      action: 'noop',
    });
  });

  it('treats re-committing a seeded wikilink item as a noop', () => {
    expect(
      resolveCellEditCommit('list', '[[Doe, John]]', list(['[[Doe, John]]'])),
    ).toEqual({ action: 'noop' });
  });

  it('keeps [[...]] entries whole when splitting', () => {
    expect(resolveCellEditCommit('list', '[[Doe, John]], other', list(['x']))).toEqual({
      action: 'commit',
      value: ['[[Doe, John]]', 'other'],
    });
  });

  it('splits an unbalanced [[ as plain text', () => {
    expect(resolveCellEditCommit('list', '[[Doe, John', list(['x']))).toEqual({
      action: 'commit',
      value: ['[[Doe', 'John'],
    });
  });

  it('treats clearing an already-empty value as a noop', () => {
    expect(resolveCellEditCommit('list', '', empty)).toEqual({ action: 'noop' });
  });

  it('rejects a non-scalar value', () => {
    expect(resolveCellEditCommit('list', { odd: true }, list(['x'])).action).toBe('reject');
  });
});

describe('resolveCellEditCommit — date kind', () => {
  const stored = date(new Date(2026, 3, 3));

  it('commits a Date (the bridge passes Dates through uncoerced)', () => {
    const picked = new Date(2026, 3, 10);
    expect(resolveCellEditCommit('date', picked, stored)).toEqual({ action: 'commit', value: picked });
  });

  it('commits a Date onto an empty stored value', () => {
    const picked = new Date(2026, 3, 10);
    expect(resolveCellEditCommit('date', picked, empty)).toEqual({ action: 'commit', value: picked });
  });

  it('treats re-committing the stored calendar day as a noop (time-of-day ignored)', () => {
    expect(resolveCellEditCommit('date', new Date(2026, 3, 3), stored)).toEqual({ action: 'noop' });
    expect(resolveCellEditCommit('date', new Date(2026, 3, 3, 14, 30), stored)).toEqual({ action: 'noop' });
  });

  it('clears with null on an empty string', () => {
    expect(resolveCellEditCommit('date', '', stored)).toEqual({ action: 'commit', value: null });
  });

  it('treats clearing an already-empty value as a noop', () => {
    expect(resolveCellEditCommit('date', '', empty)).toEqual({ action: 'noop' });
  });

  it('rejects an invalid Date', () => {
    expect(resolveCellEditCommit('date', new Date('nonsense'), stored).action).toBe('reject');
  });

  it('rejects any non-Date value', () => {
    expect(resolveCellEditCommit('date', 'tomorrow', stored).action).toBe('reject');
    expect(resolveCellEditCommit('date', 20260403, stored).action).toBe('reject');
  });
});

describe('dateRoleColumns', () => {
  it('maps only the columns whose descriptor carries a date role', () => {
    const descriptors = new Map<string, CellEditorDescriptor>([
      ['note.scheduled', { kind: 'date', dateRole: 'start' }],
      ['note.due', { kind: 'date', dateRole: 'end' }],
      ['note.review', { kind: 'date' }],
      ['note.effort', { kind: 'text' }],
    ]);
    expect([...dateRoleColumns(descriptors)]).toEqual([
      ['note.scheduled', 'start'],
      ['note.due', 'end'],
    ]);
  });

  it('yields an empty map for absent descriptors', () => {
    expect(dateRoleColumns(undefined).size).toBe(0);
  });
});

describe('counterpartDate', () => {
  const start = new Date(2026, 3, 1);
  const end = new Date(2026, 3, 5, 23, 59, 59, 999);

  it('returns the other edge of a complete-dated row', () => {
    const row = { start, end, dateStatus: 'complete' } as const;
    expect(counterpartDate(row, 'start')).toBe(end);
    expect(counterpartDate(row, 'end')).toBe(start);
  });

  it('returns the real counterpart when the EDITED edge was the inferred one', () => {
    expect(counterpartDate({ start, end, dateStatus: 'inferred-start' }, 'start')).toBe(end);
    expect(counterpartDate({ start, end, dateStatus: 'inferred-end' }, 'end')).toBe(start);
  });

  it('returns null when the counterpart edge was inferred from the edited one', () => {
    expect(counterpartDate({ start, end, dateStatus: 'inferred-end' }, 'start')).toBeNull();
    expect(counterpartDate({ start, end, dateStatus: 'inferred-start' }, 'end')).toBeNull();
  });

  it('returns null for placeholder/swapped rows and missing rows', () => {
    expect(counterpartDate({ start, end, dateStatus: 'placeholder' }, 'start')).toBeNull();
    expect(counterpartDate({ start, end, dateStatus: 'swapped' }, 'end')).toBeNull();
    expect(counterpartDate(undefined, 'start')).toBeNull();
  });

  it('returns null when the counterpart date is absent', () => {
    expect(counterpartDate({ start, end: null, dateStatus: 'complete' }, 'start')).toBeNull();
  });
});

describe('violatesDateOrder', () => {
  const end = new Date(2026, 3, 5, 23, 59, 59, 999);
  const start = new Date(2026, 3, 5);

  it('rejects a start edited past the end', () => {
    expect(violatesDateOrder('start', new Date(2026, 3, 6), end)).toBe(true);
  });

  it('rejects an end edited before the start', () => {
    expect(violatesDateOrder('end', new Date(2026, 3, 4), start)).toBe(true);
  });

  it('passes equal calendar days (the end is normalized to end-of-day)', () => {
    expect(violatesDateOrder('start', new Date(2026, 3, 5), end)).toBe(false);
    expect(violatesDateOrder('end', new Date(2026, 3, 5), start)).toBe(false);
  });

  it('passes an in-order edit', () => {
    expect(violatesDateOrder('start', new Date(2026, 3, 2), end)).toBe(false);
    expect(violatesDateOrder('end', new Date(2026, 3, 9), start)).toBe(false);
  });

  it('passes when there is no counterpart date', () => {
    expect(violatesDateOrder('start', new Date(2026, 3, 6), null)).toBe(false);
  });
});

describe('resolveCellEditCommit — text kind', () => {
  it('commits the string', () => {
    expect(resolveCellEditCommit('text', 'Draft v2', text('Draft'))).toEqual({
      action: 'commit',
      value: 'Draft v2',
    });
  });

  it('stringifies a bridge-coerced number (preserving stored-type intent)', () => {
    expect(resolveCellEditCommit('text', 99, text('Draft'))).toEqual({ action: 'commit', value: '99' });
  });

  it('clears with null on an empty string', () => {
    expect(resolveCellEditCommit('text', '', text('Draft'))).toEqual({ action: 'commit', value: null });
  });

  it('treats re-committing the stored text as a noop', () => {
    expect(resolveCellEditCommit('text', 'Draft', text('Draft'))).toEqual({ action: 'noop' });
  });

  it('treats a bridge-coerced number matching stored numeric text as a noop', () => {
    expect(resolveCellEditCommit('text', 2026, text('2026'))).toEqual({ action: 'noop' });
  });

  it('treats clearing an already-empty value as a noop', () => {
    expect(resolveCellEditCommit('text', '', empty)).toEqual({ action: 'noop' });
  });
});

describe('editorSeedValue', () => {
  it('seeds text editors with the stored string', () => {
    expect(editorSeedValue('text', text('Draft'))).toBe('Draft');
  });

  it('seeds an empty stored value as an empty string', () => {
    expect(editorSeedValue('text', empty)).toBe('');
    expect(editorSeedValue('number', empty)).toBe('');
    expect(editorSeedValue('boolean', empty)).toBe('');
    expect(editorSeedValue('list', empty)).toBe('');
  });

  it('seeds number editors with the raw number', () => {
    expect(editorSeedValue('number', num(42))).toBe(42);
  });

  it('seeds a number column whose stored value is numeric text with that text', () => {
    expect(editorSeedValue('number', text('42'))).toBe('42');
  });

  it("seeds boolean editors with the 'true'/'false' richselect option id", () => {
    expect(editorSeedValue('boolean', bool(true))).toBe('true');
    expect(editorSeedValue('boolean', bool(false))).toBe('false');
  });

  it('seeds list editors with the comma-joined items (what the text editor shows)', () => {
    expect(editorSeedValue('list', list(['a', 'b']))).toBe('a, b');
  });

  it('seeds a stored date as its local YYYY-MM-DD form on a TEXT column', () => {
    expect(editorSeedValue('text', { kind: 'date', value: new Date(2026, 5, 17) })).toBe('2026-06-17');
  });

  it('seeds a DATE column with the raw stored Date (the custom editor formats it)', () => {
    const d = new Date(2026, 5, 17);
    expect(editorSeedValue('date', date(d))).toBe(d);
  });

  it('seeds an empty date column as an empty string', () => {
    expect(editorSeedValue('date', empty)).toBe('');
  });
});

describe('storedFlatValue', () => {
  it('restores the raw scalar for text/number/boolean', () => {
    expect(storedFlatValue(text('Draft'))).toBe('Draft');
    expect(storedFlatValue(num(3))).toBe(3);
    expect(storedFlatValue(bool(true))).toBe(true);
  });

  it('restores an empty value as an empty string', () => {
    expect(storedFlatValue(empty)).toBe('');
  });

  it('restores a list as a fresh string array', () => {
    const stored = list(['a', 'b']);
    const flat = storedFlatValue(stored) as string[];
    expect(flat).toEqual(['a', 'b']);
    expect(flat).not.toBe(stored.value);
  });

  it('restores a date as its Date instance', () => {
    const d = new Date(2026, 5, 17);
    expect(storedFlatValue({ kind: 'date', value: d })).toBe(d);
  });
});

describe('withAlignedFlatKeys', () => {
  const columnIds = ['note.priority', 'note.points'];

  it('sets each editor-attached column key to the stored flat value', () => {
    const task = {
      id: 't1',
      custom: { properties: { 'note.priority': text('high'), 'note.points': num(3) } },
    };
    const aligned = withAlignedFlatKeys(task, columnIds) as Record<string, unknown>;
    expect(aligned['note.priority']).toBe('high');
    expect(aligned['note.points']).toBe(3);
  });

  it('returns the task unchanged when no columns carry editors', () => {
    const task = { id: 't1', custom: { properties: {} } };
    expect(withAlignedFlatKeys(task, [])).toBe(task);
  });

  it('flat-key-aligns an absent stored value to the empty string', () => {
    const task = { id: 't1', custom: { properties: {} } };
    const aligned = withAlignedFlatKeys(task, columnIds) as Record<string, unknown>;
    expect(aligned['note.priority']).toBe('');
  });

  it('heals a stale committed flat key so a later commit cannot write it back over an external edit', () => {
    // An earlier inline edit left the flat key 'note.priority' = 'high' on the
    // SVAR store row (the grid bridge copies the whole row, so committed flat
    // keys persist).
    const staleStoreRow = {
      id: 't1',
      'note.priority': 'high',
      custom: { properties: { 'note.priority': text('high'), 'note.points': num(3) } },
    };
    // An external edit changes the note to 'low'; the refresh's diff-sync
    // update carries fresh custom.properties.
    const freshProperties = { 'note.priority': text('low'), 'note.points': num(3) };
    const updatePayload = { id: 't1', custom: { properties: freshProperties } };

    // WITHOUT alignment, SVAR's shallow-spread apply keeps the stale flat key;
    // a later no-change commit on note.points (the bridge copies the whole
    // row) then single-diffs on the STALE key — attributing the edit to
    // note.priority with the OLD value, which would overwrite the external
    // edit. This is the failure mode being prevented.
    const unalignedRow = { ...staleStoreRow, ...updatePayload };
    expect(classifyCellEdit({ ...unalignedRow, 'note.points': 3 }, columnIds, freshProperties)).toEqual({
      kind: 'cell-edit',
      columnId: 'note.priority',
      value: 'high',
    });

    // WITH the update payload aligned, the spread refreshes the flat key too:
    // the same commit classifies as a noop — no write, external edit intact.
    const alignedRow = { ...staleStoreRow, ...withAlignedFlatKeys(updatePayload, columnIds) };
    expect(classifyCellEdit({ ...alignedRow, 'note.points': 3 }, columnIds, freshProperties)).toEqual({
      kind: 'cell-edit-noop',
    });
  });
});

describe('shippedEditorKinds', () => {
  it('keeps only descriptors whose kind has a shipped editor', () => {
    const descriptors = new Map<string, CellEditorDescriptor>([
      ['note.effort', { kind: 'text' }],
      ['note.points', { kind: 'number' }],
      ['note.done', { kind: 'boolean' }],
      ['note.tags', { kind: 'list' }],
      ['note.due', { kind: 'date' }],
      ['note.status', { kind: 'choice-status' }],
      ['note.owner', { kind: 'suggest' }],
    ]);
    expect([...shippedEditorKinds(descriptors)]).toEqual([
      ['note.effort', 'text'],
      ['note.points', 'number'],
      ['note.done', 'boolean'],
      ['note.tags', 'list'],
      ['note.due', 'date'],
    ]);
  });

  it('yields an empty map for absent descriptors', () => {
    expect(shippedEditorKinds(undefined).size).toBe(0);
  });
});

describe('editorAttachedColumnIds', () => {
  it('attaches only non-name columns whose kind has a shipped editor', () => {
    const columns = [
      { id: 'text', isName: true },
      { id: 'note.effort', isName: false },
      { id: 'formula.label', isName: false },
      { id: 'note.points', isName: false },
    ];
    const kinds = new Map<string, 'text' | 'number'>([
      ['text', 'text'],
      ['note.effort', 'text'],
      ['note.points', 'number'],
    ]);
    expect(editorAttachedColumnIds(columns, kinds)).toEqual(['note.effort', 'note.points']);
  });
});

describe('svarEditorConfigFor', () => {
  it("maps boolean to a richselect with 'true'/'false' string option ids", () => {
    const config = svarEditorConfigFor('boolean', 'en-US');
    expect(config).toEqual({
      type: 'richselect',
      config: { options: [{ id: 'true', label: 'true' }, { id: 'false', label: 'false' }] },
    });
  });

  it('maps text, number, and list to the text editor', () => {
    expect(svarEditorConfigFor('text', 'en-US')).toBe('text');
    expect(svarEditorConfigFor('number', 'en-US')).toBe('text');
    expect(svarEditorConfigFor('list', 'en-US')).toBe('text');
  });

  it('maps date to the registered custom editor, carrying the display locale', () => {
    expect(svarEditorConfigFor('date', 'de-DE')).toEqual({
      type: 'og-date',
      config: { locale: 'de-DE' },
    });
  });
});

describe('rowEditorConfig', () => {
  it('returns null for a row that is not editable', () => {
    expect(rowEditorConfig({ id: 't1', custom: { editable: false } }, 'text', 'en-US')).toBeNull();
    expect(rowEditorConfig(undefined, 'text', 'en-US')).toBeNull();
  });

  it('returns null when the column resolved no shipped kind', () => {
    expect(rowEditorConfig({ id: 't1', custom: { editable: true } }, undefined, 'en-US')).toBeNull();
  });

  it('returns the kind config for an editable row', () => {
    expect(rowEditorConfig({ id: 't1', custom: { editable: true } }, 'text', 'en-US')).toBe('text');
  });

  it('returns the locale-carrying date config for an editable row', () => {
    expect(rowEditorConfig({ id: 't1', custom: { editable: true } }, 'date', 'de-DE')).toEqual({
      type: 'og-date',
      config: { locale: 'de-DE' },
    });
  });
});

describe('BOOLEAN_EDITOR_OPTIONS', () => {
  it("carries 'true'/'false' option ids with readable labels (SVAR IOption ids are string|number)", () => {
    expect(BOOLEAN_EDITOR_OPTIONS.map((o) => o.id)).toEqual(['true', 'false']);
    expect(BOOLEAN_EDITOR_OPTIONS.every((o) => typeof o.label === 'string' && o.label.length > 0)).toBe(true);
  });

  it('round-trips: every option id casts back to its boolean on commit', () => {
    expect(resolveCellEditCommit('boolean', 'true', bool(false))).toEqual({ action: 'commit', value: true });
    expect(resolveCellEditCommit('boolean', 'false', bool(true))).toEqual({ action: 'commit', value: false });
  });
});
