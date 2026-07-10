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
 * Format a date for display in the given locale (numeric year/month/day, the
 * regional order and separators). Pure in (date, locale). A locale string Intl
 * rejects falls back to the canonical `YYYY-MM-DD` rather than throwing.
 */
export function formatDateForLocale(d: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).format(d);
  } catch {
    return formatIsoDate(d);
  }
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
