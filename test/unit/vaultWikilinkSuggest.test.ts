/**
 * vaultWikilinkSuggest unit tests — vault-sourced `[[` suggestion fetcher.
 *
 * Enumerates the vault's markdown files, filters by the query (case-insensitive
 * over basename/path), caps the result, and maps each file to the shared
 * SuggestionFetcher item shape with the `fileToLinktext` insert form. Injected
 * with a fake vault + metadataCache so it is pure and offline.
 */

import { describe, it, expect } from '@jest/globals';
import type { App, TFile } from 'obsidian';
import {
  createVaultWikilinkFetcher,
  VAULT_SUGGEST_LIMIT,
} from '../../src/bases/vaultWikilinkSuggest';

function fakeFile(path: string): TFile {
  const name = path.split('/').pop() ?? path;
  const basename = name.replace(/\.md$/, '');
  return { path, name, basename } as unknown as TFile;
}

/**
 * A fake App exposing only the vault + metadataCache slices the fetcher reads.
 * `fileToLinktext` returns the basename wrapped in a marker so tests can assert
 * the insert value is the linktext form, not the raw path.
 */
function makeApp(paths: string[]): App {
  const files = paths.map(fakeFile);
  return {
    vault: {
      getMarkdownFiles: () => files,
    },
    metadataCache: {
      fileToLinktext: (file: TFile) => `LINK:${file.basename}`,
    },
  } as unknown as App;
}

describe('createVaultWikilinkFetcher', () => {
  it('returns matching files mapped to the fileToLinktext insert form', async () => {
    const app = makeApp(['notes/Q3 Roadmap.md', 'notes/Q3 Budget.md', 'notes/Other.md']);
    const fetch = createVaultWikilinkFetcher(app, 'source.md');

    const results = await fetch('q3');

    expect(results).toEqual([
      { value: 'LINK:Q3 Roadmap', display: 'Q3 Roadmap', path: 'notes/Q3 Roadmap.md' },
      { value: 'LINK:Q3 Budget', display: 'Q3 Budget', path: 'notes/Q3 Budget.md' },
    ]);
  });

  it('returns an empty array when nothing matches (no-matches, not an error)', async () => {
    const app = makeApp(['notes/Alpha.md', 'notes/Beta.md']);
    const fetch = createVaultWikilinkFetcher(app, 'source.md');

    expect(await fetch('zzz')).toEqual([]);
  });

  it('returns the capped set for an empty query rather than throwing', async () => {
    const app = makeApp(['a.md', 'b.md', 'c.md']);
    const fetch = createVaultWikilinkFetcher(app, 'source.md');

    const results = await fetch('');

    expect(results.map((r) => r.display)).toEqual(['a', 'b', 'c']);
  });

  it('caps the result at VAULT_SUGGEST_LIMIT', async () => {
    const paths = Array.from({ length: VAULT_SUGGEST_LIMIT + 5 }, (_, i) => `note-${i}.md`);
    const app = makeApp(paths);
    const fetch = createVaultWikilinkFetcher(app, 'source.md');

    expect((await fetch('')).length).toBe(VAULT_SUGGEST_LIMIT);
  });

  it('uses the fileToLinktext form for the insert value, not the raw path', async () => {
    const app = makeApp(['deep/folder/Target.md']);
    const fetch = createVaultWikilinkFetcher(app, 'source.md');

    const [only] = await fetch('target');
    expect(only?.value).toBe('LINK:Target');
    expect(only?.value).not.toBe('deep/folder/Target.md');
  });

  it('matches case-insensitively over the basename', async () => {
    const app = makeApp(['notes/RoadMap.md']);
    const fetch = createVaultWikilinkFetcher(app, 'source.md');

    expect((await fetch('ROADMAP'))[0]?.display).toBe('RoadMap');
  });

  it('matches over the path, not only the basename', async () => {
    const app = makeApp(['projects/alpha/Notes.md', 'projects/beta/Notes.md']);
    const fetch = createVaultWikilinkFetcher(app, 'source.md');

    const results = await fetch('alpha');
    expect(results.map((r) => r.path)).toEqual(['projects/alpha/Notes.md']);
  });

  it('returns [] defensively when getMarkdownFiles is absent', async () => {
    const app = { vault: {}, metadataCache: {} } as unknown as App;
    const fetch = createVaultWikilinkFetcher(app, 'source.md');

    expect(await fetch('x')).toEqual([]);
  });

  it('returns [] defensively when fileToLinktext is absent', async () => {
    const app = {
      vault: { getMarkdownFiles: () => [fakeFile('a.md')] },
      metadataCache: {},
    } as unknown as App;
    const fetch = createVaultWikilinkFetcher(app, 'source.md');

    expect(await fetch('a')).toEqual([]);
  });
});
