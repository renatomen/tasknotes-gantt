/**
 * Strict locale-aware parsing of typed date input for the inline date editor.
 *
 * The field order and separators are derived from the SAME Intl surface
 * {@link ./dateLocale} formats with (numeric year/month/day `formatToParts`),
 * so what the editor displays is exactly what it accepts back — and nothing
 * else. Rejecting non-conforming strings (wrong separators, swapped order,
 * two-digit years, impossible calendar days) instead of guessing is the point:
 * `01/02/2026` means Jan 2 in en-US and Feb 1 in de-DE, and only the locale's
 * own pattern may decide. A locale Intl rejects falls back to the canonical
 * `YYYY-MM-DD`, mirroring `formatDateForLocale`'s ISO fallback so the
 * format→parse round-trip holds for every locale string.
 *
 * Pure and dependency-free (no Obsidian/SVAR).
 *
 * @module bases/dateEditParse
 */

type DateField = 'year' | 'month' | 'day';

/** A compiled locale pattern: the matching regex + the field capture order. */
interface LocaleDatePattern {
  regex: RegExp;
  order: DateField[];
}

/** Bidi/formatting marks (LRM/RLM/ALM) some locales embed around numeric fields. */
const DIRECTIONAL_MARKS = /[‎‏؜]/g;

/** The canonical fallback pattern (what `formatIsoDate` emits). */
const ISO_PATTERN: LocaleDatePattern = {
  regex: /^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$/,
  order: ['year', 'month', 'day'],
};

/**
 * Pattern construction costs an Intl formatter + a regex compile; memoize per
 * locale like `dateLocale`'s formatter cache. `null` marks a locale Intl
 * rejected (or one whose parts can't form an unambiguous pattern) so callers
 * fall back to ISO without retrying construction.
 */
const patternsByLocale = new Map<string, LocaleDatePattern | null>();

function patternFor(locale: string): LocaleDatePattern | null {
  let pattern = patternsByLocale.get(locale);
  if (pattern === undefined) {
    pattern = buildPattern(locale);
    patternsByLocale.set(locale, pattern);
  }
  return pattern;
}

function buildPattern(locale: string): LocaleDatePattern | null {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(new Date(2033, 10, 25));
  } catch {
    return null;
  }

  let source = '^\\s*';
  const order: DateField[] = [];
  for (const part of parts) {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day') {
      order.push(part.type);
      // Two-digit years are rejected structurally: only a full 4-digit year
      // matches, so an ambiguous "3/20/26" never parses.
      source += part.type === 'year' ? '(\\d{4})' : '(\\d{1,2})';
    } else {
      source += literalPattern(part.value);
    }
  }
  if (order.length !== 3 || new Set(order).size !== 3) return null;
  return { regex: new RegExp(source + '\\s*$'), order };
}

/**
 * A literal separator's pattern: whitespace-tolerant around the trimmed
 * separator characters. A purely-whitespace literal must stay REQUIRED
 * (`\s+`) — collapsing it to `\s*` would let adjacent digit groups merge and
 * re-introduce ambiguity in space-separated locales.
 */
function literalPattern(literal: string): string {
  const core = literal.replace(DIRECTIONAL_MARKS, '').trim();
  if (core === '') return '\\s+';
  return '\\s*' + core.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*';
}

/**
 * Parse `text` strictly against `locale`'s numeric date format. Returns the
 * date at local midnight, or `null` for anything non-conforming: wrong
 * order/separators for the locale, a two-digit year, or a field combination
 * that is not a real calendar day (`30.2.2026`). Surrounding/separator
 * whitespace is tolerated.
 */
export function parseDateForLocale(text: string, locale: string): Date | null {
  const pattern = patternFor(locale) ?? ISO_PATTERN;
  const match = pattern.regex.exec(text.replace(DIRECTIONAL_MARKS, ''));
  if (!match) return null;

  const fields = { year: 0, month: 0, day: 0 };
  pattern.order.forEach((field, i) => {
    fields[field] = Number(match[i + 1]);
  });

  const parsed = new Date(fields.year, fields.month - 1, fields.day);
  const isRealDay =
    parsed.getFullYear() === fields.year &&
    parsed.getMonth() === fields.month - 1 &&
    parsed.getDate() === fields.day;
  return isRealDay ? parsed : null;
}
