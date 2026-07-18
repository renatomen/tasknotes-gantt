/**
 * dateLocale unit tests: locale resolution (override hook, Intl snapshot) and
 * locale-aware date display formatting (regional order, purity, bogus-locale
 * fallback to the canonical ISO form).
 */

import { describe, it, expect } from '@jest/globals';
import {
  formatDateForLocale,
  formatIsoDate,
  resolveDateLocale,
} from '../../src/bases/dateLocale';

const SAMPLE = new Date(2026, 6, 11); // 2026-07-11 local

/** The reference Intl output for (date, locale) — computed, never guessed. */
function intlReference(d: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(d);
}

describe('formatDateForLocale', () => {
  it('formats de-DE day-first with dot separators, unlike en-US', () => {
    const de = formatDateForLocale(SAMPLE, 'de-DE');
    const us = formatDateForLocale(SAMPLE, 'en-US');
    expect(de).toBe(intlReference(SAMPLE, 'de-DE'));
    expect(de.startsWith('11.')).toBe(true);
    expect(de).not.toBe(us);
  });

  it('formats en-US month-first with slash separators', () => {
    const us = formatDateForLocale(SAMPLE, 'en-US');
    expect(us).toBe(intlReference(SAMPLE, 'en-US'));
    expect(us.startsWith('7/')).toBe(true);
  });

  it('is pure: same (date, locale) yields identical output across calls', () => {
    expect(formatDateForLocale(SAMPLE, 'de-DE')).toBe(formatDateForLocale(SAMPLE, 'de-DE'));
    expect(formatDateForLocale(new Date(2026, 6, 11), 'fr-FR')).toBe(
      formatDateForLocale(new Date(2026, 6, 11), 'fr-FR'),
    );
  });

  it('falls back to YYYY-MM-DD without throwing on a bogus locale string', () => {
    expect(formatDateForLocale(SAMPLE, 'not a locale!!')).toBe('2026-07-11');
    expect(formatDateForLocale(SAMPLE, '')).toBe('2026-07-11');
  });
});

describe('formatIsoDate', () => {
  it('renders the canonical zero-padded local YYYY-MM-DD', () => {
    expect(formatIsoDate(new Date(2026, 0, 3))).toBe('2026-01-03');
  });
});

describe('resolveDateLocale', () => {
  it('returns the localeOverride from an object-shaped __tnGanttDebug', () => {
    expect(resolveDateLocale({ __tnGanttDebug: { localeOverride: 'de-DE' } })).toBe('de-DE');
  });

  it('ignores a boolean __tnGanttDebug (the existing debug-log toggle shape)', () => {
    expect(resolveDateLocale({ __tnGanttDebug: true })).toBe(
      new Intl.DateTimeFormat().resolvedOptions().locale,
    );
  });

  it('ignores a non-string or empty localeOverride', () => {
    const intlDefault = new Intl.DateTimeFormat().resolvedOptions().locale;
    expect(resolveDateLocale({ __tnGanttDebug: { localeOverride: 42 } })).toBe(intlDefault);
    expect(resolveDateLocale({ __tnGanttDebug: { localeOverride: '' } })).toBe(intlDefault);
  });

  it('snapshots the Intl default locale when no override is set', () => {
    expect(resolveDateLocale({})).toBe(new Intl.DateTimeFormat().resolvedOptions().locale);
  });
});
