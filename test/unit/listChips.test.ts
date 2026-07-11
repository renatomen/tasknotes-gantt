/**
 * listChips unit tests — the pure chip model behind the chips list editor.
 *
 * `chipsFromStoredList` turns a note's RAW frontmatter list value (verbatim
 * `[[wikilink]]` / plain strings, read via the direct path) into chip models
 * whose `raw` round-trips byte-identically and whose `display` is the human
 * label (basename/alias for a link, verbatim for plain). `rawListFromChips`
 * recomposes the raw array for the single whole-list commit. Pure and offline.
 */

import { describe, it, expect } from '@jest/globals';
import { chipsFromStoredList, rawListFromChips, type ListChip } from '../../src/bases/listChips';

describe('chipsFromStoredList', () => {
  it('maps a mixed link + plain list to link and plain chips', () => {
    const chips = chipsFromStoredList(['[[WS Alpha]]', 'Ad-hoc item']);
    expect(chips).toEqual<ListChip[]>([
      { raw: '[[WS Alpha]]', display: 'WS Alpha', isLink: true },
      { raw: 'Ad-hoc item', display: 'Ad-hoc item', isLink: false },
    ]);
  });

  it('shows the alias as the display label for an aliased wikilink', () => {
    const chips = chipsFromStoredList(['[[people/Charles|Chuck Norris]]']);
    expect(chips).toEqual<ListChip[]>([
      { raw: '[[people/Charles|Chuck Norris]]', display: 'Chuck Norris', isLink: true },
    ]);
  });

  it('shows the basename (not the folder path) for a pathful wikilink', () => {
    const chips = chipsFromStoredList(['[[projects/WS Alpha]]']);
    expect(chips[0]?.display).toBe('WS Alpha');
    expect(chips[0]?.isLink).toBe(true);
  });

  it('preserves each raw entry byte-identically (no round-trip to display form)', () => {
    const raw = ['[[projects/WS Alpha|Alpha]]', 'plain, with comma'];
    expect(chipsFromStoredList(raw).map((c) => c.raw)).toEqual(raw);
  });

  it('treats a single scalar string as a one-item list', () => {
    expect(chipsFromStoredList('[[Solo]]')).toEqual<ListChip[]>([
      { raw: '[[Solo]]', display: 'Solo', isLink: true },
    ]);
  });

  it('returns no chips for an empty, null, undefined, or blank value', () => {
    expect(chipsFromStoredList([])).toEqual([]);
    expect(chipsFromStoredList(null)).toEqual([]);
    expect(chipsFromStoredList(undefined)).toEqual([]);
    expect(chipsFromStoredList('')).toEqual([]);
  });

  it('skips null/undefined array holes, keeping the surrounding items verbatim', () => {
    const chips = chipsFromStoredList(['[[WS Alpha]]', null, 'kept']);
    expect(chips.map((c) => c.raw)).toEqual(['[[WS Alpha]]', 'kept']);
  });
});

describe('rawListFromChips', () => {
  it('recomposes the ordered raw array for the whole-list commit', () => {
    const chips: ListChip[] = [
      { raw: '[[WS Alpha]]', display: 'WS Alpha', isLink: true },
      { raw: 'Ad-hoc item', display: 'Ad-hoc item', isLink: false },
    ];
    expect(rawListFromChips(chips)).toEqual(['[[WS Alpha]]', 'Ad-hoc item']);
  });

  it('round-trips a stored list unchanged through chips and back', () => {
    const raw = ['[[WS Alpha]]', 'Ad-hoc item', '[[people/Charles|Chuck]]'];
    expect(rawListFromChips(chipsFromStoredList(raw))).toEqual(raw);
  });

  it('is empty for no chips', () => {
    expect(rawListFromChips([])).toEqual([]);
  });
});
