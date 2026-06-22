/**
 * Grid column sort comparator (plan 2026-06-22-002, U1).
 *
 * Property columns store their value in `task.custom.properties[id]` as a
 * {@link TypedValue}, not as a flat `task[id]` field. SVAR's built-in column
 * comparator reads `task[id]` (→ `undefined` for property columns), so without a
 * per-column `sort` fn a property-column header click silently no-ops. SVAR's
 * `column.sort(a, b)` receives the two task rows and negates the result for
 * descending, so these comparators return the ASCENDING order.
 *
 * Pure and dependency-free (besides the TypedValue type).
 *
 * @module bases/columnSort
 */
import type { TypedValue } from './propertyValues';

/** True when a TypedValue carries no displayable value (sorts last in ascending). */
function isEmpty(v: TypedValue | undefined): boolean {
  return v == null || v.kind === 'empty' || v.value == null;
}

/**
 * Ascending comparator over two {@link TypedValue}s, type-aware by `kind`. Empty
 * values sort last. Same-kind values compare by their natural order (dates
 * chronologically, numbers numerically, booleans false<true); everything else
 * (text, link, list, mixed kinds) compares by a locale-aware string form.
 */
export function compareTypedValues(a: TypedValue | undefined, b: TypedValue | undefined): number {
  const aEmpty = isEmpty(a);
  const bEmpty = isEmpty(b);
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1; // empty after non-empty (ascending)
  if (bEmpty) return -1;

  const av = (a as TypedValue).value;
  const bv = (b as TypedValue).value;

  if (av instanceof Date && bv instanceof Date) return av.getTime() - bv.getTime();
  if (typeof av === 'number' && typeof bv === 'number') return av - bv;
  if (typeof av === 'boolean' && typeof bv === 'boolean') return (av ? 1 : 0) - (bv ? 1 : 0);

  return String(av).localeCompare(String(bv), undefined, { sensitivity: 'base', numeric: true });
}

/**
 * Read a task row's TypedValue for a property column. The param is a permissive
 * record (assignable from SVAR's `IDataHash` `{[k]: any}`, which a concrete task
 * interface is NOT — that mismatch is why this isn't typed as `SvarTask`); the
 * known `custom.properties` shape is recovered by a contained cast.
 */
function readProperty(row: Record<string, unknown>, propId: string): TypedValue | undefined {
  const custom = (row as { custom?: { properties?: Record<string, TypedValue> } }).custom;
  return custom?.properties?.[propId];
}

/**
 * Build a SVAR `column.sort` comparator for a property column: compares two task
 * rows by their {@link TypedValue} for `propId` (a missing value is treated as
 * empty → sorts last). Returns the ascending order; SVAR negates for descending.
 * Param typed as a record so it's assignable to SVAR's `TSortFunction`.
 */
export function propertyColumnSort(
  propId: string,
): (a: Record<string, unknown>, b: Record<string, unknown>) => number {
  return (a, b) => compareTypedValues(readProperty(a, propId), readProperty(b, propId));
}
