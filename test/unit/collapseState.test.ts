/**
 * Unit tests for the pure collapse-state helpers (U7).
 *
 * Covers the serialize/parse round-trip, serialization stability (the no-op-write
 * guard depends on it), tolerant parsing of junk, and the collapse-all toggle.
 */
import { describe, it, expect } from '@jest/globals';
import {
  serializeCollapsed,
  parseCollapsed,
  toggleCollapseAll,
  persistCollapsed,
  COLLAPSED_KEY,
} from '../../src/bases/collapseState';

describe('serializeCollapsed', () => {
  it('round-trips through parseCollapsed', () => {
    const ids = new Set(['a', 'b', 'c']);
    expect(parseCollapsed(serializeCollapsed(ids))).toEqual(ids);
  });

  it('is stable regardless of insertion order or duplicates (no-op-guard contract)', () => {
    expect(serializeCollapsed(['b', 'a', 'b', 'c'])).toBe(serializeCollapsed(['c', 'b', 'a']));
  });

  it('serializes an empty set to an empty JSON array', () => {
    expect(serializeCollapsed([])).toBe('[]');
  });
});

describe('parseCollapsed', () => {
  it('accepts an already-parsed string array', () => {
    expect(parseCollapsed(['x', 'y'])).toEqual(new Set(['x', 'y']));
  });

  it('drops non-string entries', () => {
    expect(parseCollapsed(JSON.stringify(['ok', 1, null, 'good']))).toEqual(new Set(['ok', 'good']));
  });

  it('returns an empty set for junk / malformed / unset values', () => {
    expect(parseCollapsed(undefined)).toEqual(new Set());
    expect(parseCollapsed(null)).toEqual(new Set());
    expect(parseCollapsed('')).toEqual(new Set());
    expect(parseCollapsed('{not json')).toEqual(new Set());
    expect(parseCollapsed(42)).toEqual(new Set());
    expect(parseCollapsed('{"a":1}')).toEqual(new Set());
  });
});

describe('persistCollapsed', () => {
  it('writes the serialized set under the collapsed key when changed', () => {
    const writes: Array<[string, unknown]> = [];
    persistCollapsed((k, v) => writes.push([k, v]), '[]', new Set(['a', 'b']));
    expect(writes).toEqual([[COLLAPSED_KEY, serializeCollapsed(['a', 'b'])]]);
  });

  it('skips the write when the set is unchanged (no-op loop guard)', () => {
    const writes: Array<[string, unknown]> = [];
    const current = serializeCollapsed(['a', 'b']);
    // Same members, different order — must still be a no-op.
    persistCollapsed((k, v) => writes.push([k, v]), current, new Set(['b', 'a']));
    expect(writes).toEqual([]);
  });

  it('treats an unset current value as the empty set', () => {
    const writes: Array<[string, unknown]> = [];
    persistCollapsed((k, v) => writes.push([k, v]), undefined, new Set());
    expect(writes).toEqual([]);
  });

  it('swallows a failing write', () => {
    expect(() =>
      persistCollapsed(() => {
        throw new Error('boom');
      }, '[]', new Set(['x'])),
    ).not.toThrow();
  });
});

describe('toggleCollapseAll', () => {
  const parents = new Set(['p1', 'p2', 'p3']);

  it('collapses all parents when some are still expanded', () => {
    expect(toggleCollapseAll(parents, new Set(['p1']))).toEqual(parents);
  });

  it('expands all (empty) when every parent is already collapsed', () => {
    expect(toggleCollapseAll(parents, new Set(['p1', 'p2', 'p3']))).toEqual(new Set());
  });

  it('collapses all when nothing is collapsed yet', () => {
    expect(toggleCollapseAll(parents, new Set())).toEqual(parents);
  });

  it('resolves to expand-all when there are no collapsible parents', () => {
    expect(toggleCollapseAll(new Set(), new Set())).toEqual(new Set());
  });
});
