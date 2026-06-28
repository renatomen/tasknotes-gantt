/**
 * Unit tests for the #161 reuseTasks entry-signature (extracted from GanttView glue).
 *
 * The signature must change iff the matched entry SET changes (count or paths) and
 * must never read entry values — so a config-only echo notify (same entries) yields
 * an identical signature and the view reuses cached tasks.
 */

import { entriesSignature, type SignatureEntry } from '../../src/bases/entrySignature';

const e = (path?: string): SignatureEntry => ({ file: path === undefined ? {} : { path } });

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
});
