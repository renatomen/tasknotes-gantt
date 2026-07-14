/**
 * Unit tests for the #161 reuseTasks entry-signature (extracted from GanttView glue).
 *
 * The signature must change iff the matched entry SET changes (count or paths) and
 * must never read entry values — so a config-only echo notify (same entries) yields
 * an identical signature and the view reuses cached tasks.
 */

import { jest } from '@jest/globals';
import {
  entriesSignature,
  frontmatterSignatureKeys,
  progressModeSignatureTag,
  entryValueSignature,
  watchedMappingValues,
  mappingSignatureTag,
  composeEntrySignature,
  type SignatureEntry,
} from '../../src/bases/entrySignature';

const e = (path?: string): SignatureEntry => ({ file: path === undefined ? {} : { path } });

describe('mappingSignatureTag', () => {
  it('changes when a role is unmapped even though the watched frontmatter keys do not', () => {
    // Two roles on the SAME property: start and end both read note.date. Unmapping end
    // (standalone — no backing system to fall back to) leaves `date` still watched for
    // start, so the frontmatter-key set is identical before and after. Without the
    // mapping identity in the signature, the config change looks like no change at all:
    // reuseTasks stays true, the Base is never re-read, and the bar keeps its old end.
    const before = watchedMappingValues(
      { startProperty: 'note.date', endProperty: 'note.date' },
      { startProperty: 'note.date', endProperty: 'note.date' },
      null,
    );
    const after = watchedMappingValues(
      { startProperty: 'note.date' },
      { startProperty: 'note.date' },
      null,
    );

    expect(frontmatterSignatureKeys(after)).toEqual(frontmatterSignatureKeys(before));
    expect(mappingSignatureTag(after)).not.toBe(mappingSignatureTag(before));
  });

  it('changes when a role moves between two already-watched properties (a swap)', () => {
    const before = watchedMappingValues(
      { startProperty: 'note.a', endProperty: 'note.b' },
      { startProperty: 'note.a', endProperty: 'note.b' },
      null,
    );
    const swapped = watchedMappingValues(
      { startProperty: 'note.b', endProperty: 'note.a' },
      { startProperty: 'note.b', endProperty: 'note.a' },
      null,
    );

    expect(mappingSignatureTag(swapped)).not.toBe(mappingSignatureTag(before));
  });

  it('changes when a non-frontmatter mapping is re-pointed (no frontmatter key exists to watch)', () => {
    // A formula/file mapping contributes NO frontmatter key, so the key set cannot see
    // this change at all — only the mapping identity can.
    const before = watchedMappingValues({ statusProperty: 'formula.a' }, {}, null);
    const after = watchedMappingValues({ statusProperty: 'formula.b' }, {}, null);

    expect(frontmatterSignatureKeys(before)).toEqual([]);
    expect(frontmatterSignatureKeys(after)).toEqual([]);
    expect(mappingSignatureTag(after)).not.toBe(mappingSignatureTag(before));
  });

  it('is stable while the mappings are unchanged (a config-only notify must still reuse)', () => {
    const mappings = { startProperty: 'note.scheduled', statusProperty: 'note.status' };
    const a = watchedMappingValues(mappings, mappings, null);
    const b = watchedMappingValues(mappings, mappings, null);

    expect(mappingSignatureTag(a)).toBe(mappingSignatureTag(b));
  });
});

describe('watchedMappingValues', () => {
  it('watches the property an unset field resolves to', () => {
    const keys = frontmatterSignatureKeys(
      watchedMappingValues({}, { statusProperty: 'note.status' }, null),
    );

    expect(keys).toContain('status');
  });

  it('still watches the re-mapped property while the resolved mapping lags a refresh behind', () => {
    // The signature is compared BEFORE the source is re-selected, so the resolved
    // mappings still name the OLD property. Watching only those would fingerprint the
    // old key, leave the signature unchanged, and reuse the cached tasks — the bars
    // would keep rendering the previous mapping's values.
    const keys = frontmatterSignatureKeys(
      watchedMappingValues(
        { statusProperty: 'note.workflow_state' },
        { statusProperty: 'note.status' },
        null,
      ),
    );

    expect(keys).toContain('workflow_state');
    expect(keys).toContain('status');
  });

  it('prefers the resolved estimate read key over the view mapping', () => {
    const keys = frontmatterSignatureKeys(
      watchedMappingValues({ timeEstimateProperty: 'note.old' }, {}, 'note.estimate'),
    );

    expect(keys).toContain('estimate');
    expect(keys).not.toContain('old');
  });

  it('folds a key once when the view and resolved mappings agree', () => {
    const keys = frontmatterSignatureKeys(
      watchedMappingValues({ statusProperty: 'note.status' }, { statusProperty: 'note.status' }, null),
    );

    expect(keys).toEqual(['status']);
  });
});

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

describe('progressModeSignatureTag', () => {
  it('tags the resolved Progress mode, defaulting an absent mode to property', () => {
    expect(progressModeSignatureTag('tasknotes')).toBe('pm:tasknotes|');
    expect(progressModeSignatureTag('property')).toBe('pm:property|');
    expect(progressModeSignatureTag(undefined)).toBe('pm:property|');
  });

  it('differs across modes so a mode switch always flips the signature', () => {
    expect(progressModeSignatureTag('property')).not.toBe(progressModeSignatureTag('tasknotes'));
  });
});

describe('entryValueSignature', () => {
  const topLevel = (task: string) => ({ task, parent: -1 });

  it('joins the mapped frontmatter values in property mode', () => {
    const sig = entryValueSignature(['status', 'pct'], { status: 'open', pct: 40 }, undefined, false);
    expect(sig).toContain('"open"');
    expect(sig).toContain('40');
  });

  it('appends the checklist fingerprint in tasknotes mode', () => {
    const withChecklist = entryValueSignature([], null, [topLevel('x'), topLevel(' ')], true);
    const noChecklist = entryValueSignature([], null, [], true);
    expect(withChecklist).toBe('1/2');
    expect(noChecklist).toBe('');
  });

  it('is IDENTICAL across modes for a checklist-less note (why the mode tag is required)', () => {
    // A note with no checklist contributes an empty checklist fingerprint, and the
    // same frontmatter value is read in both modes — so entryValueSignature alone
    // can't distinguish the modes. progressModeSignatureTag is what forces the
    // re-read on a mode switch.
    const fm = { pct: 35 };
    const property = entryValueSignature(['pct'], fm, [], false);
    const tasknotes = entryValueSignature(['pct'], fm, [], true);
    expect(property).toBe(tasknotes);
  });

  it('changes when a checklist item is toggled (live refresh, R5)', () => {
    const before = entryValueSignature([], null, [topLevel('x'), topLevel(' '), topLevel(' ')], true);
    const after = entryValueSignature([], null, [topLevel('x'), topLevel('x'), topLevel(' ')], true);
    expect(after).not.toBe(before);
  });

  it('returns empty for an entry with no frontmatter in property mode', () => {
    expect(entryValueSignature(['pct'], null, undefined, false)).toBe('');
  });
});

describe('composeEntrySignature', () => {
  const entry = (path: string): SignatureEntry => ({ file: { path } });
  const cacheOf =
    (fm: Record<string, Record<string, unknown>>) =>
    (e: SignatureEntry) => {
      const path = e.file?.path;
      return path && fm[path] ? { frontmatter: fm[path]! } : null;
    };

  it('re-reads when a role is unmapped even though the watched key stays (the shared-property case)', () => {
    // start and end BOTH on note.date; unmapping end leaves `date` watched for start,
    // so the value fingerprint cannot see the change — only the mapping identity can.
    const entries = [entry('a.md')];
    const noteCacheOf = cacheOf({ 'a.md': { date: '2026-01-01' } });

    const before = composeEntrySignature({
      entries,
      viewMappings: { startProperty: 'note.date', endProperty: 'note.date' },
      resolvedMappings: { startProperty: 'note.date', endProperty: 'note.date' },
      estimateReadKey: null,
      noteCacheOf,
    });
    const afterUnmappingEnd = composeEntrySignature({
      entries,
      viewMappings: { startProperty: 'note.date' },
      resolvedMappings: { startProperty: 'note.date' },
      estimateReadKey: null,
      noteCacheOf,
    });

    expect(afterUnmappingEnd).not.toBe(before);
  });

  it('reuses when nothing changed (a config-only / echo notify must not re-read)', () => {
    const inputs = {
      entries: [entry('a.md'), entry('b.md')],
      viewMappings: { startProperty: 'note.scheduled', progressMode: 'property' as const },
      resolvedMappings: { startProperty: 'note.scheduled' },
      estimateReadKey: null,
      noteCacheOf: cacheOf({ 'a.md': { scheduled: '2026-01-01' }, 'b.md': { scheduled: '2026-02-02' } }),
    };

    expect(composeEntrySignature(inputs)).toBe(composeEntrySignature(inputs));
  });

  it('re-reads when a watched frontmatter value is edited', () => {
    const entries = [entry('a.md')];
    const base = {
      entries,
      viewMappings: { statusProperty: 'note.status' },
      resolvedMappings: { statusProperty: 'note.status' },
      estimateReadKey: null,
    };

    const open = composeEntrySignature({ ...base, noteCacheOf: cacheOf({ 'a.md': { status: 'open' } }) });
    const done = composeEntrySignature({ ...base, noteCacheOf: cacheOf({ 'a.md': { status: 'done' } }) });

    expect(done).not.toBe(open);
  });

  it('watches the property an unset field resolves to, so editing it re-reads', () => {
    const entries = [entry('a.md')];
    const base = {
      entries,
      viewMappings: {},
      resolvedMappings: { statusProperty: 'note.status' },
      estimateReadKey: null,
    };

    const open = composeEntrySignature({ ...base, noteCacheOf: cacheOf({ 'a.md': { status: 'open' } }) });
    const done = composeEntrySignature({ ...base, noteCacheOf: cacheOf({ 'a.md': { status: 'done' } }) });

    expect(done).not.toBe(open);
  });

  it('re-reads when the Progress mode is switched', () => {
    const entries = [entry('a.md')];
    const noteCacheOf = cacheOf({ 'a.md': {} });

    const property = composeEntrySignature({
      entries,
      viewMappings: { progressMode: 'property' },
      resolvedMappings: {},
      estimateReadKey: null,
      noteCacheOf,
    });
    const tasknotes = composeEntrySignature({
      entries,
      viewMappings: { progressMode: 'tasknotes' },
      resolvedMappings: {},
      estimateReadKey: null,
      noteCacheOf,
    });

    expect(tasknotes).not.toBe(property);
  });

  it('skips the per-entry read when nothing value-bearing is watched', () => {
    const noteCacheOf = jest.fn(() => null);

    const sig = composeEntrySignature({
      entries: [entry('a.md')],
      viewMappings: {},
      resolvedMappings: {},
      estimateReadKey: null,
      noteCacheOf,
    });

    expect(noteCacheOf).not.toHaveBeenCalled();
    expect(sig).toContain('a.md');
  });

  it('re-reads when the matched entry set changes', () => {
    const inputs = {
      viewMappings: {},
      resolvedMappings: {},
      estimateReadKey: null,
      noteCacheOf: () => null,
    };

    const one = composeEntrySignature({ ...inputs, entries: [entry('a.md')] });
    const two = composeEntrySignature({ ...inputs, entries: [entry('a.md'), entry('b.md')] });

    expect(two).not.toBe(one);
  });
});
