/**
 * The pure name helpers behind the editor's rename field: what the basename of a
 * path is, whether a proposed name is usable, and where a rename lands. The view
 * performs the rename; these decide the name and target it computes.
 */
import { describe, expect, it } from '@jest/globals';
import { noteBasename, renameTargetPath, validateNoteName } from '../../src/editor/noteName';

describe('noteBasename', () => {
  it('strips the folder and the .md extension', () => {
    expect(noteBasename('Calendars/NZ Holidays.md')).toBe('NZ Holidays');
    expect(noteBasename('Top.md')).toBe('Top');
    expect(noteBasename('a/b/c/Deep.md')).toBe('Deep');
  });

  it('is empty for a null or empty path', () => {
    expect(noteBasename(null)).toBe('');
    expect(noteBasename('')).toBe('');
  });
});

describe('validateNoteName', () => {
  it('accepts an ordinary name', () => {
    expect(validateNoteName('NZ Public Holidays')).toBeNull();
  });

  it('rejects an empty name', () => {
    expect(validateNoteName('')).toMatch(/empty/i);
    expect(validateNoteName('   ')).toMatch(/empty/i);
  });

  it('rejects path separators and reserved characters', () => {
    for (const bad of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b']) {
      expect(validateNoteName(bad)).not.toBeNull();
    }
  });
});

describe('renameTargetPath', () => {
  it('keeps the note in its own folder with a .md extension', () => {
    expect(renameTargetPath('Calendars/NZ Holidays.md', 'NZ Public Holidays')).toBe(
      'Calendars/NZ Public Holidays.md',
    );
  });

  it('handles a note at the vault root', () => {
    expect(renameTargetPath('Top.md', 'Renamed')).toBe('Renamed.md');
  });

  it('trims the new name', () => {
    expect(renameTargetPath('Calendars/A.md', '  B  ')).toBe('Calendars/B.md');
  });
});
