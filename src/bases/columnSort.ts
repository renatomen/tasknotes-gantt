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
 * Ascending, type-aware comparison of two raw scalar values: dates compare
 * chronologically, numbers numerically, booleans false<true, and everything else
 * by a locale-aware, numeric-aware string form. Shared by {@link compareTypedValues}
 * (grid column sort) and the default-view interleave (`sortKeyMapping`) so the one
 * locale-numeric compare convention can't drift between them. Empty/null handling
 * is the caller's job — this assumes both values are present.
 */
export function compareScalars(a: unknown, b: unknown): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
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

  return compareScalars((a as TypedValue).value, (b as TypedValue).value);
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
