/**
 * Display formatting for type-tagged property values (plan 2026-06-18-001, U3).
 *
 * Pure counterpart to {@link import('./PropertyCell.svelte')}: turns a
 * {@link TypedValue} into the string a grid cell renders, switching on `kind`
 * (never on `instanceof`). Deterministic — dates render as `YYYY-MM-DD` (the
 * codebase convention, and stable for the diff-sync fingerprint in U4) and a
 * boolean renders as a checkmark token or blank.
 *
 * @module bases/propertyFormat
 */

import type { TypedValue } from './propertyValues';

/** The glyph a `true` boolean renders as; `false`/empty render blank (R5/R6). */
export const BOOLEAN_TRUE_TOKEN = '✓';

/** `YYYY-MM-DD` (local), matching the rest of the codebase's date display. */
function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format a {@link TypedValue} for grid display. Returns blank for `empty`, a
 * missing value, or a value whose carried type doesn't match its `kind`.
 */
export function formatPropertyValue(tv: TypedValue | null | undefined): string {
  if (!tv) return '';
  switch (tv.kind) {
    case 'date':
      return tv.value instanceof Date && !Number.isNaN(tv.value.getTime()) ? formatDate(tv.value) : '';
    case 'number':
      return typeof tv.value === 'number' && !Number.isNaN(tv.value) ? String(tv.value) : '';
    case 'boolean':
      return tv.value === true ? BOOLEAN_TRUE_TOKEN : '';
    case 'list':
      return Array.isArray(tv.value) ? tv.value.map((v) => String(v)).join(', ') : '';
    case 'link':
      return typeof tv.value === 'string' ? tv.value : '';
    case 'text':
      return typeof tv.value === 'string' ? tv.value : String(tv.value ?? '');
    case 'empty':
    default:
      return '';
  }
}
