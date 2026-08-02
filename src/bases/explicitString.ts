import { stringifyDirectPrimitive } from '../stringifyPrimitive';

type Primitive = null | undefined | string | number | boolean | bigint | symbol;

function isPrimitive(value: unknown): value is Primitive {
  return value === null || (typeof value !== 'object' && typeof value !== 'function');
}

function stringifyPrimitive(value: Primitive): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'symbol') throw new TypeError('Cannot convert a Symbol value to a string');
  return stringifyDirectPrimitive(value);
}

function ordinaryStringPrimitive(value: object): Primitive {
  for (const methodName of ['toString', 'valueOf'] as const) {
    const method = (value as Record<typeof methodName, unknown>)[methodName];
    if (typeof method !== 'function') continue;
    const result: unknown = Reflect.apply(method, value, []);
    if (isPrimitive(result)) return result;
  }
  throw new TypeError('Cannot convert object to primitive value');
}

/**
 * Explicit equivalent of JavaScript's `String(object)` coercion.
 *
 * @throws {TypeError} When the object has no primitive string form.
 */
export function stringifyObject(value: object): string {
  const toPrimitive = (value as { [Symbol.toPrimitive]?: unknown })[Symbol.toPrimitive];
  if (toPrimitive !== undefined && toPrimitive !== null) {
    if (typeof toPrimitive !== 'function') {
      throw new TypeError('Symbol.toPrimitive is not a function');
    }
    const result: unknown = Reflect.apply(toPrimitive, value, ['string']);
    if (!isPrimitive(result)) throw new TypeError('Cannot convert object to primitive value');
    return stringifyPrimitive(result);
  }
  return stringifyPrimitive(ordinaryStringPrimitive(value));
}
