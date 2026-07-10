/**
 * cellRender unit tests (grid markdown cell rendering, U5).
 *
 * Verifies the descriptor builder (markdown vs conventional, raw-value
 * preservation, empty degradation), the single-pass buildCellData (both maps
 * keyed by path, path-less entries skipped), the fetched variant, and the
 * fingerprint key.
 */

import { describe, it, expect } from '@jest/globals';
import {
  buildCellRender,
  buildCellData,
  buildFetchedCellData,
  cellRenderKey,
  type ResolveRenderType,
} from '../../src/bases/cellRender';
import { classifyTypedValue, type PropertyExtractor } from '../../src/bases/propertyValues';
import type { CellRenderType } from '../../src/bases/cellRenderType';

const MD: CellRenderType = { display: 'markdown', tags: false };
const TAGS: CellRenderType = { display: 'markdown', tags: true };
const CONV: CellRenderType = { display: 'conventional', tags: false };

describe('buildCellRender', () => {
  it('renders a conventional date as formatted text (AE4)', () => {
    const raw = new Date(2026, 5, 17);
    expect(buildCellRender(raw, classifyTypedValue(raw), CONV)).toEqual({
      mode: 'text',
      text: '2026-06-17',
    });
  });

  it('renders a link as markdown with the raw wikilink preserved (AE2)', () => {
    expect(buildCellRender('[[Sarah]]', classifyTypedValue('[[Sarah]]'), MD)).toEqual({
      mode: 'markdown',
      source: '[[Sarah]]',
    });
  });

  it('injects # for a tags column', () => {
    expect(buildCellRender('t/note', classifyTypedValue('t/note'), TAGS)).toEqual({
      mode: 'markdown',
      source: '#t/note',
    });
  });

  it('wraps a bare link path so a computed link column stays clickable', () => {
    expect(buildCellRender('folder/Note.md', classifyTypedValue('folder/Note.md'), MD)).toEqual({
      mode: 'markdown',
      source: '[[folder/Note.md]]',
    });
  });

  it('wraps bare link paths in a list, leaving wikilinks and plain text untouched', () => {
    const raw = ['folder/A.md', '[[B]]', 'plain text'];
    expect(buildCellRender(raw, classifyTypedValue(raw), MD)).toEqual({
      mode: 'markdown',
      source: '[[folder/A.md]], [[B]], plain text',
    });
  });

  it('degrades an empty markdown source to an empty text cell', () => {
    expect(buildCellRender('', classifyTypedValue(''), MD)).toEqual({ mode: 'text', text: '' });
  });
});

describe('buildCellData', () => {
  const extractor: PropertyExtractor = {
    extractValue: (entry, propId) => (entry as { fm?: Record<string, unknown> }).fm?.[propId],
  };
  const resolve: ResolveRenderType = (propId) =>
    propId === 'note.assignee' ? MD : CONV;

  it('builds both maps keyed by source path in one pass', () => {
    const entries = [
      { file: { path: 'a.md' }, fm: { 'note.assignee': '[[Justin]]', 'note.due': new Date(2026, 0, 1) } },
    ];
    const { cellRenders, propertyValues } = buildCellData(
      entries,
      ['note.assignee', 'note.due'],
      extractor,
      resolve,
    );
    expect(cellRenders.get('a.md')?.['note.assignee']).toEqual({ mode: 'markdown', source: '[[Justin]]' });
    expect(cellRenders.get('a.md')?.['note.due']).toEqual({ mode: 'text', text: '2026-01-01' });
    expect(propertyValues.get('a.md')?.['note.assignee'].kind).toBe('link');
  });

  it('skips an entry without a string path', () => {
    const { cellRenders } = buildCellData(
      [{ file: {} }, { file: { path: 'b.md' }, fm: {} }],
      ['note.x'],
      extractor,
      resolve,
    );
    expect(cellRenders.has('b.md')).toBe(true);
    expect(cellRenders.size).toBe(1);
  });

  it('returns empty maps when there are no visible columns', () => {
    const { cellRenders, propertyValues } = buildCellData([{ file: { path: 'a.md' } }], [], extractor, resolve);
    expect(cellRenders.size).toBe(0);
    expect(propertyValues.size).toBe(0);
  });
});

describe('buildFetchedCellData', () => {
  it('resolves note.* columns from a synthetic entry frontmatter', () => {
    const extractor: PropertyExtractor = {
      extractValue: (entry, propId) =>
        (entry as { frontmatter?: Record<string, unknown> }).frontmatter?.[propId],
    };
    const resolve: ResolveRenderType = () => MD;
    const { cellRenders } = buildFetchedCellData(
      [{ path: 'c.md', basename: 'c', frontmatter: { 'note.assignee': '[[Hayden]]' } }],
      ['note.assignee'],
      extractor,
      resolve,
    );
    expect(cellRenders.get('c.md')?.['note.assignee']).toEqual({ mode: 'markdown', source: '[[Hayden]]' });
  });
});

describe('cellRenderKey', () => {
  it('fingerprints markdown and text distinctly, empty for undefined', () => {
    expect(cellRenderKey({ mode: 'markdown', source: '#a' })).toBe('m:#a');
    expect(cellRenderKey({ mode: 'text', text: 'x' })).toBe('t:x');
    expect(cellRenderKey(undefined)).toBe('');
  });
});
