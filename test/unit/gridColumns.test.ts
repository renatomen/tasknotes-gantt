/**
 * gridColumns unit tests (plan 2026-06-18-001, U2).
 *
 * - buildGridColumns: name column first; name-like property maps onto it (no
 *   duplicate); order preserved; widths from columnSize with defaults; empty
 *   order → name column only.
 * - gridColumnsKey: stable for identical config, changes on order/header/width.
 */

import { describe, it, expect } from '@jest/globals';
import {
  buildGridColumns,
  gridColumnsKey,
  mergeColumnSize,
  DEFAULT_NAME_WIDTH,
  DEFAULT_COLUMN_WIDTH,
} from '../../src/bases/gridColumns';

// Display name stub: strips the prefix and title-cases the leaf.
const displayName = (id: string): string => {
  const leaf = id.split('.').pop() ?? id;
  return leaf.charAt(0).toUpperCase() + leaf.slice(1);
};

describe('buildGridColumns', () => {
  it('puts the name column first, then the properties in order (AE1/AE6)', () => {
    const cols = buildGridColumns(
      ['file.name', 'note.status', 'note.start', 'note.due'],
      displayName,
      undefined,
      'file.name',
    );
    expect(cols.map((c) => c.id)).toEqual(['text', 'note.status', 'note.start', 'note.due']);
    expect(cols[0]).toMatchObject({ id: 'text', isName: true });
    // name-like file.name mapped onto text, not duplicated as a 5th column
    expect(cols.filter((c) => c.id === 'file.name')).toHaveLength(0);
  });

  it('reorders to match the Base order (priority before status)', () => {
    const cols = buildGridColumns(
      ['file.name', 'note.priority', 'note.status'],
      displayName,
      undefined,
      'file.name',
    );
    expect(cols.map((c) => c.id)).toEqual(['text', 'note.priority', 'note.status']);
  });

  it('maps a configured file.basename name property onto the text column with its display name (AE7/AE2)', () => {
    const cols = buildGridColumns(['file.basename', 'note.status'], displayName, undefined, 'file.basename');
    expect(cols[0]).toMatchObject({ id: 'text', propId: 'file.basename', header: 'Basename', isName: true });
    expect(cols.map((c) => c.id)).toEqual(['text', 'note.status']);
  });

  it('uses columnSize widths when present and defaults otherwise (AE4)', () => {
    const cols = buildGridColumns(
      ['file.name', 'note.status', 'note.start'],
      displayName,
      { 'file.name': 320, 'note.status': 264 },
      'file.name',
    );
    const byId = Object.fromEntries(cols.map((c) => [c.id, c.width]));
    expect(byId['text']).toBe(320); // name column width from columnSize[file.name]
    expect(byId['note.status']).toBe(264);
    expect(byId['note.start']).toBe(DEFAULT_COLUMN_WIDTH); // no entry → default
  });

  it('returns only the name column when order is empty (AE5)', () => {
    const cols = buildGridColumns([], displayName, undefined, 'file.name');
    expect(cols).toHaveLength(1);
    expect(cols[0]).toMatchObject({ id: 'text', header: 'Task', width: DEFAULT_NAME_WIDTH, isName: true });
  });

  it('keeps a non-name name-like property as an ordinary column when another already maps to text', () => {
    // configured name = file.name (maps to text); file.basename also selected → stays a column
    const cols = buildGridColumns(['file.name', 'file.basename'], displayName, undefined, 'file.name');
    expect(cols.map((c) => c.id)).toEqual(['text', 'file.basename']);
  });
});

describe('gridColumnsKey', () => {
  it('is stable for identical configs and changes on order/header', () => {
    const a = buildGridColumns(['file.name', 'note.status'], displayName, undefined, 'file.name');
    const b = buildGridColumns(['file.name', 'note.status'], displayName, undefined, 'file.name');
    expect(gridColumnsKey(a)).toBe(gridColumnsKey(b));

    const reordered = buildGridColumns(['file.name', 'note.start', 'note.status'], displayName, undefined, 'file.name');
    expect(gridColumnsKey(a)).not.toBe(gridColumnsKey(reordered));
  });

  it('does NOT change on a width-only change (resize must not force a reseed)', () => {
    // A width change persists to columnSize but must not re-init SVAR (zoom
    // preservation, PR #73). Same structure + different widths → same key.
    const a = buildGridColumns(['file.name', 'note.status'], displayName, undefined, 'file.name');
    const resized = buildGridColumns(['file.name', 'note.status'], displayName, { 'note.status': 200 }, 'file.name');
    expect(gridColumnsKey(a)).toBe(gridColumnsKey(resized));
  });
});

describe('mergeColumnSize', () => {
  it('adds a new entry, rounding the width', () => {
    expect(mergeColumnSize(undefined, 'note.status', 263.6)).toEqual({ 'note.status': 264 });
  });

  it('overwrites an existing entry and preserves the others (no clobber)', () => {
    const merged = mergeColumnSize({ 'file.name': 320, 'note.status': 140 }, 'note.status', 200);
    expect(merged).toEqual({ 'file.name': 320, 'note.status': 200 });
  });
});
