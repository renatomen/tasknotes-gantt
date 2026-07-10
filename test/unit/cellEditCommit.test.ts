/**
 * cellEditCommit unit tests (inline cell editing — commit casting + editor seeds).
 *
 * Verifies the pure commit resolver that sits between SVAR's update-cell bridge
 * (which coerces numeric strings / true / [] via `v *= 1`) and
 * `controller.mutateProperty`: every cast, reject (AE6), and noop path per
 * shipped editor kind, plus the editor seed values (what the column getter
 * hands the opening editor) and the flat-baseline restore values.
 */

import { describe, it, expect } from '@jest/globals';
import {
  BOOLEAN_EDITOR_OPTIONS,
  editorSeedValue,
  resolveCellEditCommit,
  shippedEditorKind,
  storedFlatValue,
} from '../../src/bases/cellEditCommit';
import type { TypedValue } from '../../src/bases/propertyValues';

const empty: TypedValue = { kind: 'empty', value: null };
const text = (v: string): TypedValue => ({ kind: 'text', value: v });
const num = (v: number): TypedValue => ({ kind: 'number', value: v });
const bool = (v: boolean): TypedValue => ({ kind: 'boolean', value: v });
const list = (v: string[]): TypedValue => ({ kind: 'list', value: v });

describe('shippedEditorKind', () => {
  it('ships text, number, boolean, and list', () => {
    expect(shippedEditorKind('text')).toBe('text');
    expect(shippedEditorKind('number')).toBe('number');
    expect(shippedEditorKind('boolean')).toBe('boolean');
    expect(shippedEditorKind('list')).toBe('list');
  });

  it('defers date, choice, and suggest kinds to later units', () => {
    expect(shippedEditorKind('date')).toBeNull();
    expect(shippedEditorKind('choice-status')).toBeNull();
    expect(shippedEditorKind('choice-priority')).toBeNull();
    expect(shippedEditorKind('suggest')).toBeNull();
  });
});

describe('resolveCellEditCommit — number kind (AE6)', () => {
  it('commits a finite number', () => {
    expect(resolveCellEditCommit('number', 42, num(3))).toEqual({ action: 'commit', value: 42 });
  });

  it('commits a numeric string as a number', () => {
    expect(resolveCellEditCommit('number', '7.5', num(3))).toEqual({ action: 'commit', value: 7.5 });
  });

  it('rejects non-numeric text (AE6)', () => {
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

  it('treats clearing an already-empty value as a noop', () => {
    expect(resolveCellEditCommit('list', '', empty)).toEqual({ action: 'noop' });
  });

  it('rejects a non-scalar value', () => {
    expect(resolveCellEditCommit('list', { odd: true }, list(['x'])).action).toBe('reject');
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

  it('seeds a stored date as its local YYYY-MM-DD form', () => {
    expect(editorSeedValue('text', { kind: 'date', value: new Date(2026, 5, 17) })).toBe('2026-06-17');
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
