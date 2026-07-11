/**
 * Vault-sourced `[[` suggestion fetcher for the text cell editor.
 *
 * Enumerates the vault's markdown files, filters by the token query
 * (case-insensitive over basename and path), caps the result, and maps each
 * file to the shared {@link SuggestionFetcher} item shape — with the insert
 * value in `fileToLinktext` form, the same form TaskNotes stores. Independent
 * of TaskNotes: this source is always reachable, so it never degrades — only
 * matches / no-matches apply (there is no loading or "unavailable" state).
 *
 * @module bases/vaultWikilinkSuggest
 */

import type { App, TFile } from 'obsidian';
import type { SuggestionFetcher, TaskNotesSuggestion } from './taskNotesSuggest';

/** Matches the limit the TaskNotes-served suggest path uses. */
export const VAULT_SUGGEST_LIMIT = 20;

interface VaultLike {
  getMarkdownFiles?: () => TFile[];
}

interface MetadataCacheLike {
  fileToLinktext?: (file: TFile, sourcePath: string, omitMdExtension?: boolean) => string;
}

/**
 * Build a fetcher that serves vault notes matching a query as `[[`-insert
 * suggestions, resolving each note's link text relative to `sourcePath`. Reads
 * only the injected `app` slices (no globals) and guards against the vault /
 * metadata-cache methods being absent (returns `[]`).
 */
export function createVaultWikilinkFetcher(app: App, sourcePath: string): SuggestionFetcher {
  const vault = (app as unknown as { vault?: VaultLike }).vault;
  const metadataCache = (app as unknown as { metadataCache?: MetadataCacheLike }).metadataCache;

  return (query: string) => {
    const getMarkdownFiles = vault?.getMarkdownFiles;
    const fileToLinktext = metadataCache?.fileToLinktext;
    if (typeof getMarkdownFiles !== 'function' || typeof fileToLinktext !== 'function') {
      return Promise.resolve([]);
    }

    const needle = query.trim().toLowerCase();
    const suggestions: TaskNotesSuggestion[] = [];
    for (const file of getMarkdownFiles.call(vault)) {
      if (
        needle !== '' &&
        !file.basename.toLowerCase().includes(needle) &&
        !file.path.toLowerCase().includes(needle)
      ) {
        continue;
      }
      suggestions.push({
        value: fileToLinktext.call(metadataCache, file, sourcePath, true),
        display: file.basename,
        path: file.path,
      });
      if (suggestions.length >= VAULT_SUGGEST_LIMIT) break;
    }
    return Promise.resolve(suggestions);
  };
}
