/**
 * taskNotesSuggest unit tests (restricted-choice editors — autosuggest adapter).
 *
 * Verifies the guarded adapter over TaskNotes' file-suggest capability: the
 * per-edit reachability probe (TaskNotes 4.11.0 exposes NO suggest surface, so
 * the probe degrades to `null`), the suggestion mapping when a helper IS
 * reachable (forward-compatible probe points on the plugin instance / its api),
 * and the pure list-append helpers the suggest editor's direct commit path uses
 * (preserve raw entries verbatim, wikilink dedupe, wikilink entry form).
 */

import { describe, it, expect, jest } from '@jest/globals';
import type { App } from 'obsidian';
import {
  appendListEntry,
  resolveSuggestionFetcher,
  wikilinkEntry,
} from '../../src/bases/taskNotesSuggest';

/** An App whose plugin registry returns the given TaskNotes plugin instance. */
function makeApp(plugin: unknown): App {
  return {
    plugins: {
      getPlugin: (id: string) => (id === 'tasknotes' ? plugin : undefined),
    },
  } as unknown as App;
}

describe('resolveSuggestionFetcher — reachability probe', () => {
  it('degrades to null when TaskNotes is absent', () => {
    expect(resolveSuggestionFetcher(makeApp(undefined), {})).toBeNull();
  });

  it('degrades to null when the plugin exposes no file-suggest helper (TaskNotes 4.11.0)', () => {
    expect(resolveSuggestionFetcher(makeApp({ api: {} }), {})).toBeNull();
  });

  it('degrades to null when the exposed helper has no callable suggest', () => {
    expect(resolveSuggestionFetcher(makeApp({ FileSuggestHelper: {} }), {})).toBeNull();
    expect(
      resolveSuggestionFetcher(makeApp({ FileSuggestHelper: { suggest: 'nope' } }), {}),
    ).toBeNull();
  });

  it('degrades to null when the plugin registry itself throws', () => {
    const app = {
      plugins: {
        getPlugin: () => {
          throw new Error('registry unavailable');
        },
      },
    } as unknown as App;
    expect(resolveSuggestionFetcher(app, {})).toBeNull();
  });

  it('resolves a fetcher from a plugin-instance helper, forwarding plugin/query/filter', async () => {
    const filter = { requiredTags: ['ws'] };
    const suggest = jest.fn(async () => [
      { insertText: 'WS Alpha', displayText: 'WS Alpha [title: Alpha]', path: 'ws/WS Alpha.md' },
      { insertText: 'WS Beta', displayText: 'WS Beta', path: 'ws/WS Beta.md' },
    ]);
    const plugin = { FileSuggestHelper: { suggest } };

    const fetcher = resolveSuggestionFetcher(makeApp(plugin), filter);
    expect(fetcher).not.toBeNull();
    const results = await fetcher!('ws');

    expect(results).toEqual([
      { value: 'WS Alpha', display: 'WS Alpha [title: Alpha]', path: 'ws/WS Alpha.md' },
      { value: 'WS Beta', display: 'WS Beta', path: 'ws/WS Beta.md' },
    ]);
    expect(suggest).toHaveBeenCalledWith(plugin, 'ws', 20, filter);
  });

  it('resolves a fetcher from an api-exposed helper', async () => {
    const suggest = jest.fn(async () => [{ insertText: 'Note', displayText: 'Note' }]);
    const fetcher = resolveSuggestionFetcher(makeApp({ api: { FileSuggestHelper: { suggest } } }), {});

    expect(await fetcher!('n')).toEqual([{ value: 'Note', display: 'Note' }]);
  });

  it('drops malformed suggestion entries and defaults display to the insert text', async () => {
    const suggest = jest.fn(async () => [
      { insertText: 'Good' },
      { displayText: 'no insert text' },
      null,
      'nonsense',
    ]);
    const fetcher = resolveSuggestionFetcher(makeApp({ FileSuggestHelper: { suggest } }), {});

    expect(await fetcher!('g')).toEqual([{ value: 'Good', display: 'Good' }]);
  });

  it('yields [] when the resolved helper rejects or returns a non-array', async () => {
    const rejecting = resolveSuggestionFetcher(
      makeApp({ FileSuggestHelper: { suggest: async () => Promise.reject(new Error('boom')) } }),
      {},
    );
    expect(await rejecting!('q')).toEqual([]);

    const nonArray = resolveSuggestionFetcher(
      makeApp({ FileSuggestHelper: { suggest: async () => ({ nope: true }) } }),
      {},
    );
    expect(await nonArray!('q')).toEqual([]);
  });
});

describe('wikilinkEntry', () => {
  it('wraps a resolved link text as a [[wikilink]] (the TaskNotes stored form)', () => {
    expect(wikilinkEntry('WS Alpha')).toBe('[[WS Alpha]]');
    expect(wikilinkEntry('folder/WS Alpha')).toBe('[[folder/WS Alpha]]');
  });
});

describe('appendListEntry', () => {
  it('appends to the RAW stored list, preserving existing wikilink entries verbatim', () => {
    expect(appendListEntry(['[[WS Alpha]]'], '[[WS Beta]]')).toEqual(['[[WS Alpha]]', '[[WS Beta]]']);
  });

  it('appends free text as a plain entry', () => {
    expect(appendListEntry(['[[WS Alpha]]'], 'Manual entry')).toEqual(['[[WS Alpha]]', 'Manual entry']);
  });

  it('starts a list from an empty/absent stored value', () => {
    expect(appendListEntry(undefined, '[[WS Alpha]]')).toEqual(['[[WS Alpha]]']);
    expect(appendListEntry(null, 'a')).toEqual(['a']);
    expect(appendListEntry('', 'a')).toEqual(['a']);
    expect(appendListEntry([], 'a')).toEqual(['a']);
  });

  it('wraps a scalar stored value into a list before appending', () => {
    expect(appendListEntry('[[WS Alpha]]', '[[WS Beta]]')).toEqual(['[[WS Alpha]]', '[[WS Beta]]']);
    expect(appendListEntry(7, 'a')).toEqual(['7', 'a']);
  });

  it('returns null (noop) for an empty or whitespace entry', () => {
    expect(appendListEntry(['[[WS Alpha]]'], '')).toBeNull();
    expect(appendListEntry(['[[WS Alpha]]'], '   ')).toBeNull();
  });

  it('returns null (noop) when the exact entry is already present', () => {
    expect(appendListEntry(['[[WS Alpha]]', 'x'], '[[WS Alpha]]')).toBeNull();
    expect(appendListEntry(['x'], 'x')).toBeNull();
  });

  it('returns null (noop) when a wikilink targeting the same note is already present (alias-insensitive)', () => {
    expect(appendListEntry(['[[WS Alpha|Alias]]'], '[[WS Alpha]]')).toBeNull();
  });

  it('drops null/empty items while preserving the rest of a mixed stored array', () => {
    expect(appendListEntry(['[[A]]', null, '', 3], 'b')).toEqual(['[[A]]', '3', 'b']);
  });
});
