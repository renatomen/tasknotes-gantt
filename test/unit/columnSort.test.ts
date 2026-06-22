/**
 * Unit tests for the grid column sort comparator (plan 2026-06-22-002, U1).
 *
 * Property columns store their value in `task.custom.properties[id]` as a
 * TypedValue ({kind,value}), NOT as a flat `task[id]` field — SVAR's default
 * comparator would read `undefined` and silently no-op. These helpers give each
 * property column a type-aware ascending comparator over the TypedValue (SVAR
 * negates the result for descending).
 */
import { describe, it, expect } from '@jest/globals';
import { compareTypedValues, propertyColumnSort } from '../../src/bases/columnSort';
import type { TypedValue } from '../../src/bases/propertyValues';

const tv = (kind: TypedValue['kind'], value: unknown): TypedValue => ({ kind, value });

describe('compareTypedValues', () => {
  it('orders dates chronologically (ascending)', () => {
    const a = tv('date', new Date(2026, 0, 1));
    const b = tv('date', new Date(2026, 0, 10));
    expect(compareTypedValues(a, b)).toBeLessThan(0);
    expect(compareTypedValues(b, a)).toBeGreaterThan(0);
  });

  it('orders numbers numerically (not lexically)', () => {
    expect(compareTypedValues(tv('number', 9), tv('number', 10))).toBeLessThan(0);
  });

  it('orders text case-insensitively via localeCompare', () => {
    expect(compareTypedValues(tv('text', 'apple'), tv('text', 'banana'))).toBeLessThan(0);
  });

  it('orders booleans false before true', () => {
    expect(compareTypedValues(tv('boolean', false), tv('boolean', true))).toBeLessThan(0);
  });

  it('sorts empty/undefined values LAST in ascending order', () => {
    expect(compareTypedValues(tv('empty', null), tv('text', 'x'))).toBeGreaterThan(0);
    expect(compareTypedValues(tv('text', 'x'), tv('empty', null))).toBeLessThan(0);
    expect(compareTypedValues(undefined, tv('text', 'x'))).toBeGreaterThan(0);
    expect(compareTypedValues(undefined, undefined)).toBe(0);
    expect(compareTypedValues(tv('empty', null), tv('empty', null))).toBe(0);
  });

  it('renders list values comparably (joined)', () => {
    expect(compareTypedValues(tv('list', ['a', 'b']), tv('list', ['c']))).toBeLessThan(0);
  });
});

describe('propertyColumnSort', () => {
  const task = (props: Record<string, TypedValue>) => ({ custom: { properties: props } });

  it('compares two tasks by the named property column (ascending)', () => {
    const sort = propertyColumnSort('note.due');
    const a = task({ 'note.due': tv('date', new Date(2026, 0, 1)) });
    const b = task({ 'note.due': tv('date', new Date(2026, 0, 9)) });
    expect(sort(a, b)).toBeLessThan(0);
  });

  it('treats a missing property value as empty (sorts last)', () => {
    const sort = propertyColumnSort('note.due');
    const withVal = task({ 'note.due': tv('text', 'x') });
    const without = task({});
    expect(sort(without, withVal)).toBeGreaterThan(0);
    expect(sort(withVal, without)).toBeLessThan(0);
  });
});
