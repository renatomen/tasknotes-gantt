export type DirectPrimitive = string | number | boolean | bigint | symbol;

export function stringifyDirectPrimitive(value: DirectPrimitive): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'symbol') return Symbol.prototype.toString.call(value);
  if (typeof value === 'number') return Number.prototype.toString.call(value);
  return BigInt.prototype.toString.call(value);
}
