/**
 * The CSS3 colour set is the RFC 7986 palette the calendar colour field draws
 * from, so its membership, hex lookup, validation and search ranking are pinned
 * here — the picker's suggestions and the editor's accept/reject both lean on
 * exactly this behaviour.
 */
import { describe, expect, it } from '@jest/globals';
import {
  CSS3_COLORS,
  filterCss3Colors,
  hexForCss3Name,
  isCss3ColorName,
  isHexColor,
  isValidCalendarColor,
} from '../../src/bases/css3Colors';

describe('CSS3 colour set', () => {
  it('carries the full CSS3 keyword set with lowercase names and hex swatches', () => {
    expect(CSS3_COLORS).toHaveLength(147);
    for (const color of CSS3_COLORS) {
      expect(color.name).toBe(color.name.toLowerCase());
      expect(color.hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('has no duplicate names', () => {
    const names = CSS3_COLORS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('isCss3ColorName', () => {
  it('accepts a keyword case-insensitively', () => {
    expect(isCss3ColorName('cornflowerblue')).toBe(true);
    expect(isCss3ColorName('CornflowerBlue')).toBe(true);
    expect(isCss3ColorName('  RED  ')).toBe(true);
  });

  it('rejects a non-keyword', () => {
    expect(isCss3ColorName('notacolour')).toBe(false);
    expect(isCss3ColorName('')).toBe(false);
  });
});

describe('hexForCss3Name', () => {
  it('returns the swatch hex for a keyword, null otherwise', () => {
    expect(hexForCss3Name('cornflowerblue')).toBe('#6495ed');
    expect(hexForCss3Name('SEAGREEN')).toBe('#2e8b57');
    expect(hexForCss3Name('nope')).toBeNull();
  });
});

describe('isHexColor', () => {
  it('accepts 3/4/6/8-digit hex', () => {
    expect(isHexColor('#fff')).toBe(true);
    expect(isHexColor('#2a9d8f')).toBe(true);
    expect(isHexColor('#2a9d8fcc')).toBe(true);
  });

  it('rejects non-hex', () => {
    expect(isHexColor('red')).toBe(false);
    expect(isHexColor('#zz')).toBe(false);
    expect(isHexColor('2a9d8f')).toBe(false);
  });
});

describe('isValidCalendarColor', () => {
  it('accepts a hex or a CSS3 keyword', () => {
    expect(isValidCalendarColor('#2a9d8f')).toBe(true);
    expect(isValidCalendarColor('cornflowerblue')).toBe(true);
  });

  it('rejects anything the renderer could not paint', () => {
    expect(isValidCalendarColor('foobar')).toBe(false);
    expect(isValidCalendarColor('var(--color-red)')).toBe(false);
  });
});

describe('filterCss3Colors', () => {
  it('returns the whole set for an empty query', () => {
    expect(filterCss3Colors('')).toHaveLength(CSS3_COLORS.length);
    expect(filterCss3Colors('   ')).toHaveLength(CSS3_COLORS.length);
  });

  it('ranks prefix matches ahead of substring matches', () => {
    const names = filterCss3Colors('sea').map((c) => c.name);
    // 'seagreen'/'seashell' start with 'sea'; 'lightseagreen' only contains it.
    expect(names.indexOf('seagreen')).toBeLessThan(names.indexOf('lightseagreen'));
    expect(names.indexOf('seashell')).toBeLessThan(names.indexOf('lightseagreen'));
  });

  it('matches case-insensitively', () => {
    expect(filterCss3Colors('CORN').map((c) => c.name)).toContain('cornflowerblue');
  });

  it('returns empty for no match', () => {
    expect(filterCss3Colors('zzzz')).toEqual([]);
  });
});
