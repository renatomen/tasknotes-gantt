/**
 * Display formatting for type-tagged property values (plan 2026-06-18-001, U3).
 *
 * Pure counterpart to {@link import('./PropertyCell.svelte')}: turns a
 * {@link TypedValue} into the string a grid cell renders, switching on `kind`
 * (never on `instanceof`). Two formatters share the per-kind rendering and
 * differ only on dates:
 *
 * - {@link formatPropertyValue} — DISPLAY: dates render in the caller-supplied
 *   locale (snapshot once per data-assembly pass, threaded explicitly).
 * - {@link fingerprintPropertyValue} — DIFF FINGERPRINT: dates render canonical
 *   `YYYY-MM-DD`, locale-independent, so the diff-sync fingerprint is stable
 *   regardless of the display locale.
 *
 * @module bases/propertyFormat
 */

import { formatDateForLocale, formatIsoDate } from './dateLocale';
import type { TypedValue } from './propertyValues';

/** The glyph a `true` boolean renders as; `false`/empty render blank (R5/R6). */
export const BOOLEAN_TRUE_TOKEN = '✓';

/** Render a `date` carrier via `dateFormatter` for a valid `Date`, else blank (R6). */
function formatDateValue(value: unknown, dateFormatter: (d: Date) => string): string {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? dateFormatter(value) : '';
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

function formatWithDateFormatter(
  tv: TypedValue | null | undefined,
  dateFormatter: (d: Date) => string,
): string {
  if (!tv) return '';
  switch (tv.kind) {
    case 'date':
      return formatDateValue(tv.value, dateFormatter);
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

/**
 * Format a {@link TypedValue} for grid display: dates in the given locale.
 * Returns blank for `empty`, a missing value, or a value whose carried type
 * doesn't match its `kind`.
 */
export function formatPropertyValue(tv: TypedValue | null | undefined, locale: string): string {
  return formatWithDateFormatter(tv, (d) => formatDateForLocale(d, locale));
}

/**
 * Fingerprint a {@link TypedValue} for diff-sync: identical to
 * {@link formatPropertyValue} except dates stay canonical `YYYY-MM-DD`, so the
 * fingerprint never varies with the display locale.
 */
export function fingerprintPropertyValue(tv: TypedValue | null | undefined): string {
  return formatWithDateFormatter(tv, formatIsoDate);
}
