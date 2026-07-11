/**
 * vaultWikilinkSuggest unit tests — vault-sourced `[[` suggestion fetcher.
 *
 * Enumerates the vault's markdown files, scopes them by an optional
 * `FileFilterConfig`, fuzzy-ranks the survivors over basename + title + aliases,
 * caps the result, and maps each file to the shared SuggestionFetcher item shape
 * (with the `fileToLinktext` insert form and the winning SearchResult attached).
 * Injected with a fake vault + metadataCache so it is pure and offline.
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
 * the insert value is the linktext form, not the raw path. `getFileCache` is
 * deliberately absent — the fetcher must tolerate a note with no cache.
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

interface FileSpec {
  path: string;
  aliases?: string[];
  title?: string;
  tags?: string[];
}

/** A fake App whose `getFileCache` returns frontmatter (aliases/title/tags) per note. */
function makeRichApp(specs: FileSpec[]): App {
  const byPath = new Map(specs.map((spec) => [spec.path, spec]));
  const files = specs.map((spec) => fakeFile(spec.path));
  return {
    vault: {
      getMarkdownFiles: () => files,
    },
    metadataCache: {
      fileToLinktext: (file: TFile) => `LINK:${file.basename}`,
      getFileCache: (file: TFile) => {
        const spec = byPath.get(file.path);
        if (!spec) return null;
        const frontmatter: Record<string, unknown> = {};
        if (spec.aliases) frontmatter.aliases = spec.aliases;
        if (spec.title) frontmatter.title = spec.title;
        if (spec.tags) frontmatter.tags = spec.tags;
        return { frontmatter };
      },
    },
  } as unknown as App;
}

describe('createVaultWikilinkFetcher', () => {
  it('returns matching files mapped to the fileToLinktext insert form', async () => {
    const app = makeApp(['notes/Q3 Roadmap.md', 'notes/Q3 Budget.md', 'notes/Other.md']);
    const fetch = createVaultWikilinkFetcher(app, 'source.md');

    const results = await fetch('q3');

    expect(results.map((r) => ({ value: r.value, display: r.display, path: r.path }))).toEqual([
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

describe('createVaultWikilinkFetcher — fuzzy ranking', () => {
  it('ranks a note whose ALIAS matches the query even when its basename does not', async () => {
    const app = makeRichApp([
      { path: 'people/Charles.md', aliases: ['Chuck Norris'] },
      { path: 'people/Diane.md' },
    ]);
    const fetch = createVaultWikilinkFetcher(app, 'source.md');

    const results = await fetch('chuck');
    expect(results.map((r) => r.display)).toEqual(['Charles']);
  });

  it('orders the higher fuzzy score first', async () => {
    const app = makeRichApp([{ path: 'notes/Alpha Road.md' }, { path: 'notes/Road Map.md' }]);
    const fetch = createVaultWikilinkFetcher(app, 'source.md');

    const results = await fetch('road');
    expect(results.map((r) => r.display)).toEqual(['Road Map', 'Alpha Road']);
  });

  it('attaches the winning SearchResult to a matched suggestion for native highlighting', async () => {
    const app = makeApp(['notes/Roadmap.md']);
    const fetch = createVaultWikilinkFetcher(app, 'source.md');

    const [only] = await fetch('road');
    expect(only?.match).toBeDefined();
    expect(only?.match?.score).toBeGreaterThan(0);
  });

  it('omits the match on empty-query results (no fuzzy run)', async () => {
    const app = makeApp(['a.md']);
    const fetch = createVaultWikilinkFetcher(app, 'source.md');

    const [only] = await fetch('');
    expect(only?.match).toBeUndefined();
  });
});

describe('createVaultWikilinkFetcher — filter scoping', () => {
  it('limits suggestions to notes matching the filter (only #ws-tagged notes)', async () => {
    const app = makeRichApp([
      { path: 'ws/Alpha.md', tags: ['ws'] },
      { path: 'misc/Beta.md', tags: ['other'] },
    ]);
    const fetch = createVaultWikilinkFetcher(app, 'source.md', { requiredTags: ['ws'] });

    const results = await fetch('');
    expect(results.map((r) => r.display)).toEqual(['Alpha']);
  });

  it('offers all vault notes when no filter is configured', async () => {
    const app = makeRichApp([
      { path: 'ws/Alpha.md', tags: ['ws'] },
      { path: 'misc/Beta.md', tags: ['other'] },
    ]);
    const fetch = createVaultWikilinkFetcher(app, 'source.md');

    const results = await fetch('');
    expect(results.map((r) => r.display).sort()).toEqual(['Alpha', 'Beta']);
  });

  it('scopes by an include folder, rejecting a sibling that shares the prefix', async () => {
    const app = makeRichApp([
      { path: 'Projects/Alpha.md' },
      { path: 'ProjectsX/Beta.md' },
    ]);
    const fetch = createVaultWikilinkFetcher(app, 'source.md', { includeFolders: ['Projects'] });

    const results = await fetch('');
    expect(results.map((r) => r.display)).toEqual(['Alpha']);
  });
});

/** Attach a TaskNotes plugin whose settings expose an excludedFolders value. */
function withExcludedFolders(app: App, excludedFolders: unknown): App {
  (app as unknown as { plugins: unknown }).plugins = {
    getPlugin: (id: string) => (id === 'tasknotes' ? { settings: { excludedFolders } } : null),
  };
  return app;
}

describe('createVaultWikilinkFetcher — TaskNotes excludedFolders', () => {
  it('drops notes under a comma-string excludedFolders setting, ignoring blank entries', async () => {
    const app = withExcludedFolders(
      makeRichApp([{ path: 'Archive/Old.md' }, { path: 'Active/New.md' }]),
      ' Archive , ',
    );
    const fetch = createVaultWikilinkFetcher(app, 'source.md');

    const results = await fetch('');
    expect(results.map((r) => r.display)).toEqual(['New']);
  });

  it('drops notes under an array excludedFolders setting', async () => {
    const app = withExcludedFolders(
      makeRichApp([{ path: 'Archive/Old.md' }, { path: 'Active/New.md' }]),
      ['Archive'],
    );
    const fetch = createVaultWikilinkFetcher(app, 'source.md');

    const results = await fetch('');
    expect(results.map((r) => r.display)).toEqual(['New']);
  });
});
