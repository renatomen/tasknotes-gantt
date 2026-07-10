/**
 * Locale resolution + locale-aware date display formatting for the grid.
 *
 * The display locale is SNAPSHOT once per data-assembly pass (in
 * `register.buildGanttData`) and threaded down explicitly — formatters never
 * read it lazily — so every cell and both sides of a diff comparison within a
 * pass see the same locale. Storage (raw frontmatter, `entrySignature`) and the
 * diff fingerprint stay locale-independent.
 *
 * @module bases/dateLocale
 */

/** The shape of a global carrying the e2e/test debug hook. */
interface GanttDebugGlobal {
  __tnGanttDebug?: boolean | { localeOverride?: unknown };
}

/** Canonical zero-padded local `YYYY-MM-DD` — the locale-independent form. */
export function formatIsoDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Formatter construction costs ~60x a format call, and an assembly pass formats
 * every date cell — memoize per locale (a session sees ~1). `null` marks a
 * locale Intl rejected, so bad strings don't retry construction per cell.
 */
const formattersByLocale = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(locale: string): Intl.DateTimeFormat | null {
  let formatter = formattersByLocale.get(locale);
  if (formatter === undefined) {
    try {
      // Gregorian + Latin digits pinned: a locale's Intl defaults may use
      // another calendar (th-TH: Buddhist year 2569) or digit system (ar-EG),
      // which would break the typed-input round-trip against stored Gregorian
      // dates. Order and separators stay locale-shaped.
      formatter = new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        calendar: 'gregory',
        numberingSystem: 'latn',
      });
    } catch {
      formatter = null;
    }
    formattersByLocale.set(locale, formatter);
  }
  return formatter;
}

/**
 * Format a date for display in the given locale (numeric year/month/day, the
 * regional order and separators). Pure in (date, locale). A locale string Intl
 * rejects falls back to the canonical `YYYY-MM-DD` rather than throwing.
 */
export function formatDateForLocale(d: Date, locale: string): string {
  const formatter = formatterFor(locale);
  return formatter ? formatter.format(d) : formatIsoDate(d);
}

/**
 * Snapshot the display locale: the `window.__tnGanttDebug.localeOverride` test
 * hook when set (object-shaped debug global only — the plain `true` toggle that
 * enables debug logging carries no override), else the environment's Intl
 * default. The global is injectable for tests; production callers use the
 * default.
 */
export function resolveDateLocale(globalLike: unknown = globalThis): string {
  try {
    const debug = (globalLike as GanttDebugGlobal).__tnGanttDebug;
    if (debug && typeof debug === 'object') {
      const override = debug.localeOverride;
      if (typeof override === 'string' && override !== '') return override;
    }
  } catch {
    // Unreadable global — fall through to the Intl default.
  }
  try {
    return new Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    // No usable Intl default: '' makes formatDateForLocale take its ISO fallback.
    return '';
  }
}
