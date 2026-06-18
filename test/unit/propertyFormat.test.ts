/**
 * propertyFormat unit tests (plan 2026-06-18-001, U3).
 *
 * Covers each TypedValue kind (AE2) and the blank paths (R6): empty, missing,
 * boolean false, and type-mismatched carriers.
 */

import { describe, it, expect } from '@jest/globals';
import { formatPropertyValue, BOOLEAN_TRUE_TOKEN } from '../../src/bases/propertyFormat';

describe('formatPropertyValue', () => {
  it('formats a date as YYYY-MM-DD', () => {
    expect(formatPropertyValue({ kind: 'date', value: new Date(2026, 5, 17) })).toBe('2026-06-17');
  });

  it('renders a number as its string', () => {
    expect(formatPropertyValue({ kind: 'number', value: 42 })).toBe('42');
    expect(formatPropertyValue({ kind: 'number', value: 0 })).toBe('0');
  });

  it('renders boolean true as a checkmark and false as blank', () => {
    expect(formatPropertyValue({ kind: 'boolean', value: true })).toBe(BOOLEAN_TRUE_TOKEN);
    expect(formatPropertyValue({ kind: 'boolean', value: false })).toBe('');
  });

  it('joins a list with commas', () => {
    expect(formatPropertyValue({ kind: 'list', value: ['a', 'b', 'c'] })).toBe('a, b, c');
  });

  it('renders link display text as-is', () => {
    expect(formatPropertyValue({ kind: 'link', value: 'Alice' })).toBe('Alice');
  });

  it('renders text as-is', () => {
    expect(formatPropertyValue({ kind: 'text', value: 'in-progress' })).toBe('in-progress');
  });

  it('renders blank for empty, null/undefined, and type-mismatched carriers (R6)', () => {
    expect(formatPropertyValue({ kind: 'empty', value: null })).toBe('');
    expect(formatPropertyValue(null)).toBe('');
    expect(formatPropertyValue(undefined)).toBe('');
    expect(formatPropertyValue({ kind: 'date', value: 'not a date' })).toBe('');
    expect(formatPropertyValue({ kind: 'number', value: NaN })).toBe('');
  });
});
