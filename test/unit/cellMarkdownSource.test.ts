/**
 * cellMarkdownSource unit tests (grid markdown cell rendering, U4).
 *
 * Verifies tag injection (only for tags columns, idempotent on already-prefixed
 * tokens), wikilink/emphasis passthrough, multi-value joining, and suppression
 * of cell-breaking constructs (embeds, images, headings, fenced code).
 */

import { describe, it, expect } from '@jest/globals';
import { buildCellMarkdownSource } from '../../src/bases/cellMarkdownSource';
import type { CellRenderType } from '../../src/bases/cellRenderType';

const MD: CellRenderType = { display: 'markdown', tags: false };
const TAGS: CellRenderType = { display: 'markdown', tags: true };

describe('buildCellMarkdownSource — tags', () => {
  it('prefixes a bare tag value with # (AE1)', () => {
    expect(buildCellMarkdownSource('t/note', TAGS)).toBe('#t/note');
  });

  it('leaves an already-prefixed tag untouched', () => {
    expect(buildCellMarkdownSource('#t/done', TAGS)).toBe('#t/done');
  });

  it('injects # into each item of a tag list, space-joined', () => {
    expect(buildCellMarkdownSource(['t/note', 'done'], TAGS)).toBe('#t/note #done');
  });
});

describe('buildCellMarkdownSource — wikilinks and emphasis', () => {
  it('passes a wikilink through unchanged (AE2 — raw preserved)', () => {
    expect(buildCellMarkdownSource('[[Justin]]', MD)).toBe('[[Justin]]');
  });

  it('renders a list of wikilinks comma-joined, both links preserved', () => {
    expect(buildCellMarkdownSource(['[[Justin]]', '[[Hayden]]'], MD)).toBe('[[Justin]], [[Hayden]]');
  });

  it('passes bold/italic emphasis through', () => {
    expect(buildCellMarkdownSource('**bold** and *italic*', MD)).toBe('**bold** and *italic*');
  });

  it('does not inject # into a non-tags free-text value containing a literal hashtag (AE5)', () => {
    expect(buildCellMarkdownSource('see #urgent', MD)).toBe('see #urgent');
  });
});

describe('buildCellMarkdownSource — suppression (R11 / AE6)', () => {
  it('strips a transclusion embed', () => {
    expect(buildCellMarkdownSource('before ![[image.png]] after', MD)).toBe('before  after');
  });

  it('strips a markdown image', () => {
    expect(buildCellMarkdownSource('![](x.png) caption', MD)).toBe('caption');
  });

  it('strips ATX heading markers', () => {
    expect(buildCellMarkdownSource('# Heading text', MD)).toBe('Heading text');
  });

  it('strips a fenced code block', () => {
    expect(buildCellMarkdownSource('a ```code``` b', MD)).toBe('a  b');
  });
});

describe('buildCellMarkdownSource — empties', () => {
  it('returns empty string for null/undefined/empty', () => {
    expect(buildCellMarkdownSource(null, MD)).toBe('');
    expect(buildCellMarkdownSource(undefined, MD)).toBe('');
    expect(buildCellMarkdownSource('', MD)).toBe('');
    expect(buildCellMarkdownSource([], TAGS)).toBe('');
  });
});
