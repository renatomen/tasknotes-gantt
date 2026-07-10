/**
 * dateEditParse unit tests (locale-aware date editor — strict typed-input parsing).
 *
 * Verifies the pure parser the inline date editor commits through: the
 * day/month/year order and separators are derived from the SAME Intl surface
 * the display formatter uses, non-conforming strings (swapped order, wrong
 * separators, two-digit years, impossible calendar days) are rejected rather
 * than guessed, and every locale round-trips with `formatDateForLocale`.
 */

import { describe, it, expect } from '@jest/globals';
import { parseDateForLocale } from '../../src/bases/dateEditParse';
import { formatDateForLocale } from '../../src/bases/dateLocale';

/** Assert a parse produced the given local calendar day. */
function expectDay(result: Date | null, year: number, month1: number, day: number): void {
  expect(result).not.toBeNull();
  const d = result as Date;
  expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([year, month1, day]);
}

describe('parseDateForLocale — de-DE (day-first, dot-separated)', () => {
  it('parses the regional numeric form', () => {
    expectDay(parseDateForLocale('20.3.2026', 'de-DE'), 2026, 3, 20);
  });

  it('tolerates zero-padded fields', () => {
    expectDay(parseDateForLocale('20.03.2026', 'de-DE'), 2026, 3, 20);
  });

  it('tolerates surrounding and separator-adjacent whitespace', () => {
    expectDay(parseDateForLocale('  20. 3. 2026  ', 'de-DE'), 2026, 3, 20);
  });

  it('rejects the wrong separator for the locale', () => {
    expect(parseDateForLocale('20/3/2026', 'de-DE')).toBeNull();
    expect(parseDateForLocale('2026-03-20', 'de-DE')).toBeNull();
  });

  it('rejects a two-digit year', () => {
    expect(parseDateForLocale('20.3.26', 'de-DE')).toBeNull();
  });

  it('rejects an impossible calendar day', () => {
    expect(parseDateForLocale('32.1.2026', 'de-DE')).toBeNull();
    expect(parseDateForLocale('30.2.2026', 'de-DE')).toBeNull();
  });
});

describe('parseDateForLocale — en-US (month-first, slash-separated)', () => {
  it('parses the regional numeric form', () => {
    expectDay(parseDateForLocale('3/20/2026', 'en-US'), 2026, 3, 20);
  });

  it('rejects a day-first string (swapped order reads as month 20)', () => {
    expect(parseDateForLocale('20/3/2026', 'en-US')).toBeNull();
  });

  it('accepts the ambiguous-looking form strictly as month/day', () => {
    // 01/02/2026 is Feb 1 in day-first locales; en-US resolves it as Jan 2 —
    // the locale decides, never a heuristic.
    expectDay(parseDateForLocale('01/02/2026', 'en-US'), 2026, 1, 2);
  });

  it('rejects a two-digit year', () => {
    expect(parseDateForLocale('3/20/26', 'en-US')).toBeNull();
  });
});

describe('parseDateForLocale — en-CA (ISO-like year-first)', () => {
  it('parses the regional numeric form', () => {
    expectDay(parseDateForLocale('2026-03-20', 'en-CA'), 2026, 3, 20);
  });

  it('rejects a day-first string against the year-first pattern', () => {
    expect(parseDateForLocale('20-03-2026', 'en-CA')).toBeNull();
  });
});

describe('parseDateForLocale — non-conforming input', () => {
  it.each(['', '   ', 'banana', '20.3', '20.3.2026.5', '3//2026', '1e3.3.2026'])(
    'rejects %j (de-DE)',
    (input) => {
      expect(parseDateForLocale(input, 'de-DE')).toBeNull();
    },
  );
});

describe('parseDateForLocale — locale fallback', () => {
  it('falls back to the canonical YYYY-MM-DD for a locale Intl rejects (mirrors formatDateForLocale)', () => {
    expectDay(parseDateForLocale('2026-03-20', '!!'), 2026, 3, 20);
    expect(parseDateForLocale('20.3.2026', '!!')).toBeNull();
  });
});

describe('parseDateForLocale — round-trips with formatDateForLocale', () => {
  const locales = ['de-DE', 'en-US', 'en-GB', 'en-CA', 'fr-FR', 'ja-JP', 'nl-NL', '!!'];
  const dates = [new Date(2026, 2, 20), new Date(2026, 0, 2), new Date(2031, 11, 31)];

  it.each(locales)('parse(format(d)) recovers the same calendar day in %s', (locale) => {
    for (const d of dates) {
      const formatted = formatDateForLocale(d, locale);
      expectDay(parseDateForLocale(formatted, locale), d.getFullYear(), d.getMonth() + 1, d.getDate());
    }
  });
});
