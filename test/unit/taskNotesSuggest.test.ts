/**
 * taskNotesSuggest unit tests — the shared suggestion helpers.
 *
 * `wikilinkEntry` is the `[[link]]` stored form a picked suggestion commits;
 * `normalizeStoredList` extracts a note's RAW frontmatter list value as verbatim
 * entries (scalar → one entry, empty → none, holes dropped) — the seed the chips
 * direct-commit path round-trips byte-identically.
 */

import { describe, it, expect } from '@jest/globals';
import { normalizeStoredList, wikilinkEntry } from '../../src/bases/taskNotesSuggest';

describe('wikilinkEntry', () => {
  it('wraps a resolved link text as a [[wikilink]] (the TaskNotes stored form)', () => {
    expect(wikilinkEntry('WS Alpha')).toBe('[[WS Alpha]]');
    expect(wikilinkEntry('folder/WS Alpha')).toBe('[[folder/WS Alpha]]');
  });
});

describe('normalizeStoredList', () => {
  it('keeps every array entry verbatim (wikilinks and plain text alike)', () => {
    expect(normalizeStoredList(['[[WS Alpha]]', 'Ad-hoc item'])).toEqual([
      '[[WS Alpha]]',
      'Ad-hoc item',
    ]);
  });

  it('wraps a scalar value into a one-entry list', () => {
    expect(normalizeStoredList('[[Solo]]')).toEqual(['[[Solo]]']);
    expect(normalizeStoredList(7)).toEqual(['7']);
  });

  it('returns no entries for empty, null, undefined, or blank values', () => {
    expect(normalizeStoredList([])).toEqual([]);
    expect(normalizeStoredList(null)).toEqual([]);
    expect(normalizeStoredList(undefined)).toEqual([]);
    expect(normalizeStoredList('')).toEqual([]);
  });

  it('drops null/undefined/empty holes while stringifying the rest', () => {
    expect(normalizeStoredList(['[[A]]', null, undefined, '', 3])).toEqual(['[[A]]', '3']);
  });

  it('drops an object-shaped scalar instead of storing "[object Object]"', () => {
    expect(normalizeStoredList({ nested: 'value' })).toEqual([]);
  });

  it('drops object entries within an array, keeping the displayable primitives', () => {
    expect(normalizeStoredList(['[[A]]', { nested: 'value' }, 5])).toEqual(['[[A]]', '5']);
  });
});
