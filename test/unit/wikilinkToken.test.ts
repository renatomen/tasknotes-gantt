/**
 * wikilinkToken unit tests — pure `[[`-token detection + splice over a text
 * input value and caret offset (no Obsidian/SVAR).
 *
 * detectWikilinkToken scans back from the caret for the last `[[` not closed by
 * a `]]` before the caret; spliceWikilink replaces the token bounds with the
 * full inserted `[[Note]]` string and reports the caret after the insert.
 */

import { describe, it, expect } from '@jest/globals';
import { detectWikilinkToken, spliceWikilink } from '../../src/bases/wikilinkToken';

describe('detectWikilinkToken', () => {
  it('detects an open token at the end of the value', () => {
    expect(detectWikilinkToken('Draft [[Q3', 10)).toEqual({ query: 'Q3', start: 6, end: 10 });
  });

  it('detects the second unterminated token, not the first closed one', () => {
    const value = 'Draft [[Q3]] and [[Re';
    expect(detectWikilinkToken(value, value.length)).toEqual({ query: 'Re', start: 17, end: 21 });
  });

  it('returns null when there is no [[ at all', () => {
    expect(detectWikilinkToken('plain text', 5)).toBeNull();
  });

  it('returns null for a closed [[X]] with the caret after the ]]', () => {
    expect(detectWikilinkToken('[[X]]', 5)).toBeNull();
  });

  it('detects an empty-query token right after a just-opened [[', () => {
    expect(detectWikilinkToken('[[', 2)).toEqual({ query: '', start: 0, end: 2 });
  });

  it('detects the token the caret is inside (first of two [[ tokens)', () => {
    // value: '[[Alpha and [[Be', caret inside "Alpha" (after "Al")
    const value = '[[Alpha and [[Be';
    expect(detectWikilinkToken(value, 4)).toEqual({ query: 'Al', start: 0, end: 4 });
  });

  it('extends the token end through a following ]] that closes it (editing an existing link)', () => {
    // caret sits before the closing ]] of '[[Q3]]' — a pick must replace the
    // whole link, not leave a stray ]] behind.
    expect(detectWikilinkToken('[[Q3]] foo', 4)).toEqual({ query: 'Q3', start: 0, end: 6 });
  });

  it('does not extend through a ]] that belongs to a nested [[ (token stays open)', () => {
    // The ]] closes '[[b', not the outer '[[a', so '[[a' is unterminated.
    expect(detectWikilinkToken('[[a [[b]]', 3)).toEqual({ query: 'a', start: 0, end: 3 });
  });

  it('returns null when the caret is past the closing ]] of a link', () => {
    expect(detectWikilinkToken('[[Q3]] foo', 8)).toBeNull();
  });

  it('returns null at caret 0 even when the value starts with [[', () => {
    // The caret is left of the whole `[[`; no token has been typed before it.
    expect(detectWikilinkToken('[[ProjectX]]', 0)).toBeNull();
  });

  it('returns null at caret 1 (between the two opening brackets)', () => {
    // Only one `[` is to the left of the caret — not a complete `[[` token.
    expect(detectWikilinkToken('[[ProjectX]]', 1)).toBeNull();
  });
});

describe('spliceWikilink', () => {
  it('replaces the token bounds mid-string and preserves the surrounding text', () => {
    expect(spliceWikilink('see [[Q3 later', { start: 4, end: 8 }, '[[Q3-Roadmap]]')).toEqual({
      value: 'see [[Q3-Roadmap]] later',
      caret: 18,
    });
  });

  it('splices at the end of the string with the caret after the insert', () => {
    expect(spliceWikilink('Draft [[Q3', { start: 6, end: 10 }, '[[Q3-Roadmap]]')).toEqual({
      value: 'Draft [[Q3-Roadmap]]',
      caret: 20,
    });
  });

  it('splices into the middle of the string', () => {
    expect(spliceWikilink('a [[b c', { start: 2, end: 5 }, '[[bee]]')).toEqual({
      value: 'a [[bee]] c',
      caret: 9,
    });
  });

  it('inserts at a zero-width bound (start === end) defensively', () => {
    expect(spliceWikilink('abc', { start: 1, end: 1 }, '[[X]]')).toEqual({
      value: 'a[[X]]bc',
      caret: 6,
    });
  });
});
