/**
 * propertyFormat unit tests (plan 2026-06-18-001, U3).
 *
 * Covers each TypedValue kind (AE2) and the blank paths (R6): empty, missing,
 * boolean false, and type-mismatched carriers. Display formatting is
 * locale-injected; the fingerprint formatter stays canonical `YYYY-MM-DD`.
 */

import { describe, it, expect } from '@jest/globals';
import {
  formatPropertyValue,
  fingerprintPropertyValue,
  BOOLEAN_TRUE_TOKEN,
} from '../../src/bases/propertyFormat';

/** The reference Intl output for (date, locale) — computed, never guessed. */
function intlReference(d: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(d);
}

describe('formatPropertyValue', () => {
  const date = new Date(2026, 5, 17);

  it('formats a date in the injected locale (de-DE day-first, en-US month-first)', () => {
    const de = formatPropertyValue({ kind: 'date', value: date }, 'de-DE');
    const us = formatPropertyValue({ kind: 'date', value: date }, 'en-US');
    expect(de).toBe(intlReference(date, 'de-DE'));
    expect(us).toBe(intlReference(date, 'en-US'));
    expect(de).not.toBe(us);
  });

  it('renders a number as its string regardless of locale', () => {
    expect(formatPropertyValue({ kind: 'number', value: 42 }, 'de-DE')).toBe('42');
    expect(formatPropertyValue({ kind: 'number', value: 0 }, 'en-US')).toBe('0');
  });

  it('renders boolean true as a checkmark and false as blank', () => {
    expect(formatPropertyValue({ kind: 'boolean', value: true }, 'de-DE')).toBe(BOOLEAN_TRUE_TOKEN);
    expect(formatPropertyValue({ kind: 'boolean', value: false }, 'de-DE')).toBe('');
  });

  it('joins a list with commas', () => {
    expect(formatPropertyValue({ kind: 'list', value: ['a', 'b', 'c'] }, 'en-US')).toBe('a, b, c');
  });

  it('renders link display text as-is', () => {
    expect(formatPropertyValue({ kind: 'link', value: 'Alice' }, 'en-US')).toBe('Alice');
  });

  it('renders text as-is', () => {
    expect(formatPropertyValue({ kind: 'text', value: 'in-progress' }, 'en-US')).toBe('in-progress');
  });

  it('renders blank for empty, null/undefined, and type-mismatched carriers (R6)', () => {
    expect(formatPropertyValue({ kind: 'empty', value: null }, 'en-US')).toBe('');
    expect(formatPropertyValue(null, 'en-US')).toBe('');
    expect(formatPropertyValue(undefined, 'en-US')).toBe('');
    expect(formatPropertyValue({ kind: 'date', value: 'not a date' }, 'en-US')).toBe('');
    expect(formatPropertyValue({ kind: 'number', value: NaN }, 'en-US')).toBe('');
  });
});

describe('fingerprintPropertyValue', () => {
  it('renders a date as canonical YYYY-MM-DD (locale-independent diff fingerprint)', () => {
    expect(fingerprintPropertyValue({ kind: 'date', value: new Date(2026, 5, 17) })).toBe('2026-06-17');
  });

  it('matches the display formatter for non-date kinds', () => {
    expect(fingerprintPropertyValue({ kind: 'boolean', value: true })).toBe(BOOLEAN_TRUE_TOKEN);
    expect(fingerprintPropertyValue({ kind: 'list', value: ['a', 'b'] })).toBe('a, b');
    expect(fingerprintPropertyValue({ kind: 'text', value: 'x' })).toBe('x');
    expect(fingerprintPropertyValue(undefined)).toBe('');
  });
});
