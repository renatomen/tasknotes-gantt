import { describe, expect, it } from '@jest/globals';
import {
  effectiveDisplayPaths,
  materializeSelection,
  readDisplaySelection,
  reconcileLegacyFlip,
  serializeSelection,
  setDefaultRow,
  setEntryEnabled,
  setMemberEnabled,
  type DisplaySelection,
  type ResolvedTarget,
} from '../../src/bases/calendarSelection';

const explicit = (over: Partial<DisplaySelection> = {}): DisplaySelection => ({
  auto: false,
  stored: true,
  defaultRow: true,
  entries: [{ link: '[[NZ Holidays]]', enabled: true }],
  ...over,
});

describe('readDisplaySelection', () => {
  it('absent key yields the auto set with the default row from the legacy toggle', () => {
    const on = readDisplaySelection(undefined, undefined);
    expect(on).toEqual({ auto: true, stored: false, defaultRow: true, entries: [] });

    const off = readDisplaySelection(undefined, false);
    expect(off.defaultRow).toBe(false);
    expect(off.auto).toBe(true);
  });

  it('an explicit stored selection overrides auto', () => {
    const sel = readDisplaySelection(
      { default: false, entries: [{ link: '[[NZ Holidays]]', enabled: true }] },
      true,
    );
    expect(sel.auto).toBe(false);
    expect(sel.stored).toBe(true);
    expect(sel.defaultRow).toBe(false);
    expect(sel.entries).toEqual([{ link: '[[NZ Holidays]]', enabled: true }]);
  });

  it('a stored value without entries stays auto but pins the default row', () => {
    const sel = readDisplaySelection({ default: false }, true);
    expect(sel.auto).toBe(true);
    expect(sel.stored).toBe(true);
    expect(sel.defaultRow).toBe(false);
  });

  it('a stored value without a default field falls back to the legacy toggle', () => {
    expect(readDisplaySelection({ entries: [] }, false).defaultRow).toBe(false);
    expect(readDisplaySelection({ entries: [] }, undefined).defaultRow).toBe(true);
  });

  it('malformed shapes degrade to auto; malformed entries are dropped', () => {
    expect(readDisplaySelection('nonsense', undefined).auto).toBe(true);
    expect(readDisplaySelection(42, undefined).auto).toBe(true);
    const sel = readDisplaySelection(
      { entries: [{ link: '[[A]]', enabled: true }, { enabled: true }, 'junk', null] },
      undefined,
    );
    expect(sel.entries).toEqual([{ link: '[[A]]', enabled: true }]);
  });

  it('serialize→parse round-trips, including member toggles and flagged entries', () => {
    const sel = explicit({
      defaultRow: false,
      entries: [
        { link: '[[NZ Holidays]]', enabled: true },
        { link: '[[Team Set]]', enabled: true, members: { '[[Alice]]': true, '[[Bob]]': false } },
        { link: '[[Gone]]', enabled: true },
      ],
    });
    const parsed = readDisplaySelection(serializeSelection(sel), undefined);
    expect(parsed).toEqual(sel);
  });

  it('an auto selection serializes without entries so auto survives the round-trip', () => {
    const sel = readDisplaySelection({ default: false }, true);
    const parsed = readDisplaySelection(serializeSelection(sel), true);
    expect(parsed.auto).toBe(true);
    expect(parsed.defaultRow).toBe(false);
  });
});

describe('default-row toggle (both-key writes)', () => {
  it('deselecting the default writes both keys false', () => {
    const { selection, writes } = setDefaultRow(explicit(), false);
    expect(selection.defaultRow).toBe(false);
    expect(writes).not.toBeNull();
    expect(writes?.highlightWeekends).toBe(false);
    expect(readDisplaySelection(writes?.displayCalendars, undefined).defaultRow).toBe(false);
  });

  it('a no-op reassert produces no write', () => {
    expect(setDefaultRow(explicit(), true).writes).toBeNull();
  });

  it('toggling the default in auto mode preserves the auto entry set', () => {
    const auto = readDisplaySelection(undefined, true);
    const { selection, writes } = setDefaultRow(auto, false);
    expect(selection.auto).toBe(true);
    expect(readDisplaySelection(writes?.displayCalendars, true).auto).toBe(true);
  });
});

describe('reconcileLegacyFlip (two-way alias)', () => {
  it('flipping the legacy key after the new key exists updates the default row', () => {
    const stored = explicit({ defaultRow: true });
    const { selection, write } = reconcileLegacyFlip(stored, false);
    expect(selection.defaultRow).toBe(false);
    expect(write).not.toBeNull();
    expect(readDisplaySelection(write, undefined).defaultRow).toBe(false);
  });

  it('is guarded: agreement produces no write', () => {
    expect(reconcileLegacyFlip(explicit({ defaultRow: true }), true).write).toBeNull();
    expect(reconcileLegacyFlip(explicit({ defaultRow: false }), false).write).toBeNull();
  });

  it('never writes while the selection is unstored (legacy is the source then)', () => {
    const auto = readDisplaySelection(undefined, false);
    expect(reconcileLegacyFlip(auto, true).write).toBeNull();
  });

  it('an absent legacy key reconciles nothing', () => {
    expect(reconcileLegacyFlip(explicit({ defaultRow: false }), undefined).write).toBeNull();
  });
});

describe('entry and member toggles', () => {
  it('toggling an unknown calendar appends an entry and writes once', () => {
    const { selection, write } = setEntryEnabled(explicit(), '[[Ops]]', true);
    expect(selection.entries).toContainEqual({ link: '[[Ops]]', enabled: true });
    expect(write).not.toBeNull();
  });

  it('re-asserting an entry state produces no write', () => {
    expect(setEntryEnabled(explicit(), '[[NZ Holidays]]', true).write).toBeNull();
  });

  it('member toggles nest under the set entry', () => {
    const withSet = explicit({
      entries: [{ link: '[[Team Set]]', enabled: true, members: { '[[Alice]]': true } }],
    });
    const { selection, write } = setMemberEnabled(withSet, '[[Team Set]]', '[[Bob]]', false);
    expect(selection.entries[0]?.members).toEqual({ '[[Alice]]': true, '[[Bob]]': false });
    expect(write).not.toBeNull();
    expect(setMemberEnabled(selection, '[[Team Set]]', '[[Bob]]', false).write).toBeNull();
  });

  it('a member toggle for an unlisted set materializes the set entry enabled', () => {
    const { selection } = setMemberEnabled(explicit(), '[[Team Set]]', '[[Bob]]', false);
    expect(selection.entries).toContainEqual({
      link: '[[Team Set]]',
      enabled: true,
      members: { '[[Bob]]': false },
    });
  });
});

describe('materializeSelection', () => {
  it('turns the auto set into an explicit all-enabled selection', () => {
    const auto = readDisplaySelection(undefined, false);
    const sel = materializeSelection(auto, ['[[A]]', '[[B]]']);
    expect(sel.auto).toBe(false);
    expect(sel.defaultRow).toBe(false);
    expect(sel.entries).toEqual([
      { link: '[[A]]', enabled: true },
      { link: '[[B]]', enabled: true },
    ]);
  });

  it('leaves an already-explicit selection untouched', () => {
    const sel = explicit();
    expect(materializeSelection(sel, ['[[X]]'])).toBe(sel);
  });
});

describe('effectiveDisplayPaths', () => {
  const resolve = (link: string): ResolvedTarget => {
    if (link === '[[NZ Holidays]]') return { kind: 'calendar', path: 'NZ Holidays.md' };
    if (link === '[[Team Set]]') {
      return {
        kind: 'set',
        path: 'Team Set.md',
        members: [
          { link: '[[Alice]]', path: 'Alice.md' },
          { link: '[[Bob]]', path: 'Bob.md' },
        ],
      };
    }
    return null;
  };

  it('returns null for an auto selection (association-driven display)', () => {
    expect(effectiveDisplayPaths(readDisplaySelection(undefined, true), resolve)).toBeNull();
  });

  it('unions enabled calendars and set members', () => {
    const sel = explicit({
      entries: [
        { link: '[[NZ Holidays]]', enabled: true },
        { link: '[[Team Set]]', enabled: true },
      ],
    });
    const display = effectiveDisplayPaths(sel, resolve);
    expect(display?.paths).toEqual(new Set(['NZ Holidays.md', 'Alice.md', 'Bob.md']));
    expect(display?.flagged).toEqual([]);
  });

  it('a disabled member is excluded from the union', () => {
    const sel = explicit({
      entries: [{ link: '[[Team Set]]', enabled: true, members: { '[[Bob]]': false } }],
    });
    expect(effectiveDisplayPaths(sel, resolve)?.paths).toEqual(new Set(['Alice.md']));
  });

  it('a disabled entry contributes nothing', () => {
    const sel = explicit({ entries: [{ link: '[[NZ Holidays]]', enabled: false }] });
    expect(effectiveDisplayPaths(sel, resolve)?.paths).toEqual(new Set());
  });

  it('a dangling link is flagged and retained, contributing nothing', () => {
    const sel = explicit({
      entries: [
        { link: '[[Gone]]', enabled: true },
        { link: '[[NZ Holidays]]', enabled: true },
      ],
    });
    const display = effectiveDisplayPaths(sel, resolve);
    expect(display?.paths).toEqual(new Set(['NZ Holidays.md']));
    expect(display?.flagged).toEqual([{ link: '[[Gone]]', reason: 'link does not resolve' }]);
    expect(serializeSelection(sel)).toEqual(
      expect.objectContaining({
        entries: expect.arrayContaining([{ link: '[[Gone]]', enabled: true }]),
      }),
    );
  });
});
