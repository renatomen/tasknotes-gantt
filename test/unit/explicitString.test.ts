import { describe, expect, it } from '@jest/globals';
import { stringifyObject } from '../../src/bases/explicitString';

type StringOutcome =
  | { kind: 'value'; value: string }
  | { kind: 'error'; name: string };

interface CoercionCase {
  name: string;
  create: () => object;
}

function captureStringOutcome(stringify: () => string): StringOutcome {
  try {
    return { kind: 'value', value: stringify() };
  } catch (error) {
    return {
      kind: 'error',
      name: error instanceof Error ? error.name : typeof error,
    };
  }
}

function createWithoutPrototype(properties: PropertyDescriptorMap = {}): object {
  return Object.create(null, properties) as object;
}

const coercionCases: CoercionCase[] = [
  { name: 'Date', create: () => new Date('2026-08-02T00:00:00.000Z') },
  { name: 'array', create: () => [1, 2] },
  { name: 'plain object', create: () => ({}) },
  {
    name: 'receiver-dependent toString',
    create: () => ({
      label: 'calendar',
      toString() {
        return this.label;
      },
    }),
  },
  {
    name: 'toString precedence over valueOf',
    create: () => ({
      toString: () => 'from-toString',
      valueOf: () => 'from-valueOf',
    }),
  },
  {
    name: 'Symbol.toPrimitive with string hint and receiver',
    create: () => ({
      label: 'timeline',
      [Symbol.toPrimitive](hint: string) {
        return `${this.label}:${hint}`;
      },
    }),
  },
  {
    name: 'null Symbol.toPrimitive with ordinary fallback',
    create: () => ({
      [Symbol.toPrimitive]: null,
      toString: () => 'fallback',
    }),
  },
  {
    name: 'non-primitive toString with valueOf fallback',
    create: () =>
      createWithoutPrototype({
        toString: { value: () => ({}) },
        valueOf: { value: () => 42 },
      }),
  },
  {
    name: 'object without coercion methods',
    create: () => createWithoutPrototype(),
  },
  {
    name: 'non-callable Symbol.toPrimitive',
    create: () => ({ [Symbol.toPrimitive]: 42 }),
  },
  {
    name: 'object-producing Symbol.toPrimitive',
    create: () => ({ [Symbol.toPrimitive]: () => ({}) }),
  },
  {
    name: 'symbol-producing Symbol.toPrimitive',
    create: () => ({ [Symbol.toPrimitive]: () => Symbol('result') }),
  },
  {
    name: 'symbol-producing ordinary toString',
    create: () => ({ toString: () => Symbol('result') }),
  },
  { name: 'null-producing toString', create: () => ({ toString: () => null }) },
  { name: 'undefined-producing toString', create: () => ({ toString: () => undefined }) },
];

describe('stringifyObject', () => {
  it.each(coercionCases)('$name matches native String coercion', ({ create }) => {
    const nativeValue = create();
    const explicitValue = create();

    expect(captureStringOutcome(() => stringifyObject(explicitValue))).toEqual(
      captureStringOutcome(() => String(nativeValue)),
    );
  });
});
