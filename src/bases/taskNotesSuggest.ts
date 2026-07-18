/**
 * Shared suggestion types and pure list-value helpers for the inline editors.
 *
 * The native `[[` suggester (see {@link ./wikilinkInputSuggest}) and its vault
 * fetcher (see {@link ./vaultWikilinkSuggest}) serve {@link TaskNotesSuggestion}s;
 * a pick stores the {@link wikilinkEntry} form, and the chips direct-commit path
 * seeds and commits from {@link normalizeStoredList}'s verbatim entries.
 *
 * @module bases/taskNotesSuggest
 */

import type { SearchResult } from 'obsidian';
import { stringifyScalar } from './propertyValues';

/** One suggestion served to the editor: the link text to store + display form. */
export interface TaskNotesSuggestion {
  /** Resolved link text (`fileToLinktext` form) — what a pick stores. */
  value: string;
  /** Human-readable row text (basename plus title/alias extras). */
  display: string;
  /** Vault path of the suggested note, when the source carried one. */
  path?: string;
  /** Fuzzy-match spans over the display text, for native `renderResults` highlighting. */
  match?: SearchResult;
}

/** Async suggestion source the editor debounces over. */
export type SuggestionFetcher = (query: string) => Promise<TaskNotesSuggestion[]>;

/**
 * A picked suggestion's stored form: `[[link text]]`, matching how TaskNotes
 * stores file-suggested values (projects, user fields).
 */
export function wikilinkEntry(insertText: string): string {
  return `[[${insertText}]]`;
}

/** The RAW stored value as a verbatim entry list (scalar → 1 entry; empty → []). */
export function normalizeStoredList(raw: unknown): string[] {
  if (raw === null || raw === undefined || raw === '') return [];
  if (Array.isArray(raw)) {
    const entries: string[] = [];
    for (const item of raw) {
      const s = stringifyScalar(item);
      if (s !== null && s !== '') entries.push(s);
    }
    return entries;
  }
  const s = stringifyScalar(raw);
  return s === null ? [] : [s];
}
