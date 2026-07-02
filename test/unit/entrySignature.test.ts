/**
 * Unit tests for the #161 reuseTasks entry-signature (extracted from GanttView glue).
 *
 * The signature must change iff the matched entry SET changes (count or paths) and
 * must never read entry values — so a config-only echo notify (same entries) yields
 * an identical signature and the view reuses cached tasks.
 */

import { entriesSignature, frontmatterSignatureKeys, type SignatureEntry } from '../../src/bases/entrySignature';

const e = (path?: string): SignatureEntry => ({ file: path === undefined ? {} : { path } });

describe('frontmatterSignatureKeys', () => {
  it('strips the note. (dot) prefix from mapped properties', () => {
    expect(frontmatterSignatureKeys(['note.status', 'note.priority'])).toEqual(['status', 'priority']);
  });

  it('strips the note: (colon) prefix form too', () => {
    expect(frontmatterSignatureKeys(['note:status', 'note:due'])).toEqual(['status', 'due']);
  });

  it('excludes non-frontmatter mappings (formula/file/computed) and empty entries', () => {
    expect(frontmatterSignatureKeys(['formula.x', 'file.name', '', undefined, 'note.ok'])).toEqual(['ok']);
  });

  it('returns an empty list when no field is frontmatter-backed (→ path-only signature)', () => {
    expect(frontmatterSignatureKeys(['formula.a', undefined])).toEqual([]);
  });
});

describe('entriesSignature', () => {
  it('encodes the entry count for an empty set', () => {
    expect(entriesSignature([])).toBe('0');
  });

  it('appends each entry file.path after the count', () => {
    expect(entriesSignature([e('a.md'), e('b.md')])).toBe('2|a.md|b.md');
  });

  it('is identical for the same entries (a config-only echo notify reuses tasks)', () => {
    const entries = [e('a.md'), e('b.md')];
    expect(entriesSignature(entries)).toBe(entriesSignature([e('a.md'), e('b.md')]));
  });

  it('changes when an entry is added/removed (count differs)', () => {
    expect(entriesSignature([e('a.md')])).not.toBe(entriesSignature([e('a.md'), e('b.md')]));
  });

  it('changes when the set is reordered (path order is part of the signature)', () => {
    expect(entriesSignature([e('a.md'), e('b.md')])).not.toBe(
      entriesSignature([e('b.md'), e('a.md')]),
    );
  });

  it('treats a missing file.path as an empty segment (never throws)', () => {
    expect(entriesSignature([e(undefined), e('b.md')])).toBe('2||b.md');
  });

  describe('value-sensitive signature (reuseTasks value gate)', () => {
    const values = new Map<string, string>([
      ['a.md', 'todo'],
      ['b.md', 'high'],
    ]);
    const valueOf = (entry: { file?: { path?: string } }) =>
      values.get(entry.file?.path ?? '') ?? '';

    it('appends each entry value after a ~ so identical values reuse', () => {
      const before = entriesSignature([e('a.md'), e('b.md')], valueOf);
      const again = entriesSignature([e('a.md'), e('b.md')], valueOf);
      expect(before).toBe(again);
      expect(before).toContain('~todo');
      expect(before).toContain('~high');
    });

    it('changes when an entry value changes (bar treatment must refresh)', () => {
      const before = entriesSignature([e('a.md'), e('b.md')], valueOf);
      values.set('a.md', 'done'); // simulate a status edit
      const after = entriesSignature([e('a.md'), e('b.md')], valueOf);
      expect(after).not.toBe(before);
    });
  });
});
