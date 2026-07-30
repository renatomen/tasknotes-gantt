/**
 * Per-open SVAR cell-editor wiring characterization.
 *
 * The component resolves whether an editor may open and supplies the row-bound
 * callbacks. This boundary only decorates the already-resolved editor config
 * with a fresh vault suggestion source and, for chips, a raw seed and direct
 * whole-list commit.
 */

import { describe, expect, it, jest } from '@jest/globals';
import type { App, TFile } from 'obsidian';
import {
  OG_CHIPS_EDITOR_TYPE,
  OG_DATE_EDITOR_TYPE,
  OG_TEXT_EDITOR_TYPE,
  type ChipsEditorConfig,
  type SvarEditorConfig,
  type TextEditorConfig,
} from '../../src/bases/cellEditCommit';
import { wireSvarCellEditorForOpen } from '../../src/bases/svarCellEditorWiring';

function fakeFile(path: string): TFile {
  const name = path.split('/').pop() ?? path;
  return {
    path,
    name,
    basename: name.replace(/\.md$/, ''),
  } as unknown as TFile;
}

function makeApp(paths: string[]): App {
  const files = paths.map(fakeFile);
  return {
    vault: {
      getMarkdownFiles: () => files,
    },
    metadataCache: {
      fileToLinktext: (file: TFile) => file.basename,
    },
  } as unknown as App;
}

function textWiring(config: SvarEditorConfig): TextEditorConfig {
  if (typeof config === 'string') throw new Error('expected a configured text editor');
  return config.config as TextEditorConfig;
}

function chipsWiring(config: SvarEditorConfig): ChipsEditorConfig {
  if (typeof config === 'string') throw new Error('expected a configured chips editor');
  return config.config as ChipsEditorConfig;
}

describe('wireSvarCellEditorForOpen', () => {
  it('creates a fresh unfiltered text suggestion source for each open', async () => {
    const app = makeApp(['Projects/Alpha.md', 'Archive/Beta.md']);
    const base: SvarEditorConfig = { type: OG_TEXT_EDITOR_TYPE, config: {} };

    const first = textWiring(wireSvarCellEditorForOpen(base, { app, sourcePath: 'Tasks/One.md' }));
    const second = textWiring(wireSvarCellEditorForOpen(base, { app, sourcePath: 'Tasks/One.md' }));

    expect(first.fetchSuggestions).not.toBe(second.fetchSuggestions);
    await expect(first.fetchSuggestions?.('')).resolves.toEqual([
      { value: 'Alpha', display: 'Alpha', path: 'Projects/Alpha.md', match: undefined },
      { value: 'Beta', display: 'Beta', path: 'Archive/Beta.md', match: undefined },
    ]);
  });

  it('applies the single-value suggest field filter to the text suggestion source', async () => {
    const app = makeApp(['Projects/Alpha.md', 'Archive/Beta.md']);
    const base: SvarEditorConfig = {
      type: OG_TEXT_EDITOR_TYPE,
      config: { autosuggestFilter: { includeFolders: ['Projects'] } },
    };

    const wired = textWiring(
      wireSvarCellEditorForOpen(base, { app, sourcePath: 'Tasks/One.md' }),
    );

    await expect(wired.fetchSuggestions?.('')).resolves.toEqual([
      { value: 'Alpha', display: 'Alpha', path: 'Projects/Alpha.md', match: undefined },
    ]);
  });

  it('reads and normalizes the current raw chips seed on every open', () => {
    const app = makeApp([]);
    const base: SvarEditorConfig = { type: OG_CHIPS_EDITOR_TYPE, config: {} };
    let stored: unknown = ['[[Note|Alias]]'];
    const readRawSeed = (): unknown => stored;
    const commitRawList = (): void => undefined;

    const first = chipsWiring(
      wireSvarCellEditorForOpen(base, {
        app,
        sourcePath: 'Tasks/One.md',
        chips: { readRawSeed, commitRawList },
      }),
    );
    stored = ['[[Other]]', '', 3];
    const second = chipsWiring(
      wireSvarCellEditorForOpen(base, {
        app,
        sourcePath: 'Tasks/One.md',
        chips: { readRawSeed, commitRawList },
      }),
    );

    expect(first.seed).toEqual(['[[Note|Alias]]']);
    expect(second.seed).toEqual(['[[Other]]', '3']);
  });

  it('delegates a chips commit as the exact whole raw list', () => {
    const app = makeApp([]);
    const raw = ['[[Note|Alias]]', 'Plain'];
    const commitRawList = jest.fn<(value: string[]) => void>();
    const wired = chipsWiring(
      wireSvarCellEditorForOpen(
        { type: OG_CHIPS_EDITOR_TYPE, config: {} },
        {
          app,
          sourcePath: 'Tasks/One.md',
          chips: { readRawSeed: () => [], commitRawList },
        },
      ),
    );

    wired.commitList?.(raw);

    expect(commitRawList).toHaveBeenCalledTimes(1);
    expect(commitRawList.mock.calls[0]?.[0]).toBe(raw);
  });

  it('leaves a chips config unchanged when row-scoped callbacks are unavailable', () => {
    const base: SvarEditorConfig = {
      type: OG_CHIPS_EDITOR_TYPE,
      config: { autosuggestFilter: { includeFolders: ['Projects'] } },
    };

    const wired = wireSvarCellEditorForOpen(base, {
      app: makeApp([]),
      sourcePath: '',
    });

    expect(wired).toBe(base);
  });

  it.each<{ label: string; config: SvarEditorConfig }>([
    { label: 'stock text', config: 'text' },
    {
      label: 'date',
      config: { type: OG_DATE_EDITOR_TYPE, config: { locale: 'de-DE' } },
    },
    {
      label: 'rich select',
      config: { type: 'richselect', config: { options: [{ id: 'open', label: 'Open' }] } },
    },
    { label: 'unknown custom', config: { type: 'unrelated-editor', config: {} } },
  ])('passes the $label editor config through unchanged', ({ config }) => {
    const wired = wireSvarCellEditorForOpen(config, {
      app: makeApp([]),
      sourcePath: 'Tasks/One.md',
    });

    expect(wired).toBe(config);
  });
});
