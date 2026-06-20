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

/** Render a `date` carrier: `YYYY-MM-DD` for a valid `Date`, else blank (R6). */
function formatDateValue(value: unknown): string {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? formatDate(value) : '';
}

/** Render a `number` carrier as its string, blank for a non-number or NaN (R6). */
function formatNumberValue(value: unknown): string {
  return typeof value === 'number' && !Number.isNaN(value) ? String(value) : '';
}

/** Render a `boolean` carrier: a checkmark only for `true`, else blank (R5/R6). */
function formatBooleanValue(value: unknown): string {
  return value === true ? BOOLEAN_TRUE_TOKEN : '';
}

/** Render a `list` carrier as a comma-joined string, blank for a non-array (R6). */
function formatListValue(value: unknown): string {
  return Array.isArray(value) ? value.map(String).join(', ') : '';
}

/** Render a `link` carrier as its display string, blank for a non-string (R6). */
function formatLinkValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Render a `text` carrier as-is, coercing a non-string (and null → blank). */
function formatTextValue(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

/**
 * Format a {@link TypedValue} for grid display. Returns blank for `empty`, a
 * missing value, or a value whose carried type doesn't match its `kind`.
 */
export function formatPropertyValue(tv: TypedValue | null | undefined): string {
  if (!tv) return '';
  switch (tv.kind) {
    case 'date':
      return formatDateValue(tv.value);
    case 'number':
      return formatNumberValue(tv.value);
    case 'boolean':
      return formatBooleanValue(tv.value);
    case 'list':
      return formatListValue(tv.value);
    case 'link':
      return formatLinkValue(tv.value);
    case 'text':
      return formatTextValue(tv.value);
    case 'empty':
    default:
      return '';
  }
}
