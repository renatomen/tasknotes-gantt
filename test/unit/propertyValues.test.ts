/**
 * propertyValues unit tests (plan 2026-06-18-001, U1).
 *
 * - classifyTypedValue: tags each raw shape by display kind. Covers the
 *   heterogeneity that broke the naive `instanceof Date` assumption — a
 *   frontmatter date *string* and a computed *ISO string* both tag as `date`.
 * - buildEntryProperties: keys by sourcePath, scopes to the visible columns,
 *   tolerates entries without a path, and is empty when no columns are visible.
 */

import { describe, it, expect } from '@jest/globals';
import {
  classifyTypedValue,
  buildEntryProperties,
  buildFetchedEntryProperties,
  type PropertyExtractor,
  type TypedValue,
} from '../../src/bases/propertyValues';
import { BasesDataAdapter } from '../../src/bases/services/BasesDataAdapter';

describe('classifyTypedValue', () => {
  it('tags a frontmatter date string (YYYY-MM-DD) as date with a Date value', () => {
    const tv = classifyTypedValue('2026-06-17');
    expect(tv.kind).toBe('date');
    expect(tv.value).toBeInstanceOf(Date);
  });

  it('tags a computed ISO date string as date', () => {
    const tv = classifyTypedValue('2026-06-17T00:00:00.000Z');
    expect(tv.kind).toBe('date');
    expect(tv.value).toBeInstanceOf(Date);
  });

  it('tags a real Date instance as date', () => {
    const tv = classifyTypedValue(new Date(2026, 5, 17));
    expect(tv.kind).toBe('date');
  });

  it('parses a date-only string as LOCAL midnight (no UTC day-shift west of UTC)', () => {
    // new Date("2026-06-17") would be UTC midnight; with local getters that
    // renders 2026-06-16 for negative-offset zones. Local construction keeps
    // the calendar date stable in any timezone.
    const d = classifyTypedValue('2026-06-17').value as Date;
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 6, 17]);
  });

  it('tags numbers and booleans by primitive type', () => {
    expect(classifyTypedValue(42)).toEqual<TypedValue>({ kind: 'number', value: 42 });
    expect(classifyTypedValue(true)).toEqual<TypedValue>({ kind: 'boolean', value: true });
    expect(classifyTypedValue(false)).toEqual<TypedValue>({ kind: 'boolean', value: false });
  });

  it('tags an array as a list of display strings', () => {
    const tv = classifyTypedValue(['a', 'b', 'c']);
    expect(tv.kind).toBe('list');
    expect(tv.value).toEqual(['a', 'b', 'c']);
  });

  it('resolves wikilink and path strings to link display text (basename / alias)', () => {
    expect(classifyTypedValue('[[Alice]]')).toEqual<TypedValue>({ kind: 'link', value: 'Alice' });
    expect(classifyTypedValue('[[people/Bob|Bobby]]')).toEqual<TypedValue>({ kind: 'link', value: 'Bobby' });
    expect(classifyTypedValue('[[people/Carol]]')).toEqual<TypedValue>({ kind: 'link', value: 'Carol' });
    expect(classifyTypedValue('projects/Plan.md')).toEqual<TypedValue>({ kind: 'link', value: 'Plan' });
    // Root-level note path (no folder) — still a link, extension stripped.
    expect(classifyTypedValue('Note.md')).toEqual<TypedValue>({ kind: 'link', value: 'Note' });
  });

  it('resolves FileValue-shaped objects and link list items to basenames', () => {
    expect(classifyTypedValue({ file: { path: 'people/Dave.md' } })).toEqual<TypedValue>({
      kind: 'link',
      value: 'Dave',
    });
    const list = classifyTypedValue(['[[people/Eve]]', { file: { path: 'people/Frank.md' } }]);
    expect(list).toEqual<TypedValue>({ kind: 'list', value: ['Eve', 'Frank'] });
  });

  it('tags a plain string as text and does not coerce non-date strings', () => {
    expect(classifyTypedValue('in-progress')).toEqual<TypedValue>({ kind: 'text', value: 'in-progress' });
    expect(classifyTypedValue('Meeting 2026 notes')).toEqual<TypedValue>({
      kind: 'text',
      value: 'Meeting 2026 notes',
    });
  });

  it('falls back to text when an ISO-shaped string is not a parseable date', () => {
    // Matches ISO_DATE_RE (digit shape) but `new Date(...)` is Invalid, so the
    // date branch declines and the value is tagged as plain text (characterization).
    expect(classifyTypedValue('2026-13-45T99:99')).toEqual<TypedValue>({
      kind: 'text',
      value: '2026-13-45T99:99',
    });
  });

  it('tags a plain object without a string file.path as text via String()', () => {
    // No `file.path` string → not a link object → final String(raw) fallback
    // (characterization of the unknown-shape branch).
    expect(classifyTypedValue({ foo: 1 })).toEqual<TypedValue>({
      kind: 'text',
      value: String({ foo: 1 }),
    });
  });

  it('tags null/undefined/empty-string/empty-array/NaN as empty', () => {
    expect(classifyTypedValue(null).kind).toBe('empty');
    expect(classifyTypedValue(undefined).kind).toBe('empty');
    expect(classifyTypedValue('').kind).toBe('empty');
    expect(classifyTypedValue([]).kind).toBe('empty');
    expect(classifyTypedValue(NaN).kind).toBe('empty');
  });
});

describe('buildEntryProperties', () => {
  const extractor: PropertyExtractor = {
    // Stub: read from a flat record keyed `${path}|${propId}`.
    extractValue(entry: unknown, propertyId: string): unknown {
      const e = entry as { file: { path: string }; vals: Record<string, unknown> };
      return e.vals[propertyId] ?? null;
    },
  };

  const entry = (path: string, vals: Record<string, unknown>) => ({ file: { path }, vals });

  it('keys by sourcePath and scopes to the visible columns only', () => {
    const entries = [
      entry('a.md', { 'note.status': 'wip', 'note.start': '2026-06-17', 'note.hidden': 'x' }),
    ];
    const map = buildEntryProperties(entries, ['note.status', 'note.start'], extractor);
    const rec = map.get('a.md')!;
    expect(Object.keys(rec).sort((a, b) => a.localeCompare(b))).toEqual(['note.start', 'note.status']);
    expect(rec['note.status']).toEqual({ kind: 'text', value: 'wip' });
    expect(rec['note.start'].kind).toBe('date');
  });

  it('yields an empty record entry for a task missing the visible props', () => {
    const map = buildEntryProperties([entry('b.md', {})], ['note.status'], extractor);
    expect(map.get('b.md')).toEqual({ 'note.status': { kind: 'empty', value: null } });
  });

  it('skips entries without a string file path', () => {
    const bad = { vals: {} } as unknown;
    const map = buildEntryProperties([bad], ['note.status'], extractor);
    expect(map.size).toBe(0);
  });

  it('returns an empty map when there are no visible columns', () => {
    const map = buildEntryProperties([entry('a.md', { 'note.status': 'wip' })], [], extractor);
    expect(map.size).toBe(0);
  });
});

describe('buildFetchedEntryProperties', () => {
  // Integration: uses the REAL extractor so the synthetic-entry shape is proven
  // against the same code path matched rows use.
  const adapter = new BasesDataAdapter();
  const metas = [
    { path: 'Sub.md', basename: 'Sub', frontmatter: { status: 'open', scheduled: '2026-03-03' } },
  ];

  it('resolves note.* columns from a fetched path frontmatter', () => {
    const map = buildFetchedEntryProperties(metas, ['note.status', 'note.scheduled'], adapter);
    const rec = map.get('Sub.md')!;
    expect(rec['note.status']).toEqual({ kind: 'text', value: 'open' });
    expect(rec['note.scheduled'].kind).toBe('date');
  });

  it('resolves file.* columns from the synthetic file', () => {
    const map = buildFetchedEntryProperties(metas, ['file.basename'], adapter);
    expect(map.get('Sub.md')!['file.basename']).toEqual({ kind: 'text', value: 'Sub' });
  });

  it('falls back to empty for Base formula/computed columns (R5: no formula engine)', () => {
    const map = buildFetchedEntryProperties(metas, ['formula.foo'], adapter);
    expect(map.get('Sub.md')!['formula.foo']).toEqual({ kind: 'empty', value: null });
  });

  it('tolerates a fetched note with no frontmatter', () => {
    const map = buildFetchedEntryProperties(
      [{ path: 'X.md', basename: 'X', frontmatter: null }],
      ['note.status'],
      adapter,
    );
    expect(map.get('X.md')!['note.status'].kind).toBe('empty');
  });
});
