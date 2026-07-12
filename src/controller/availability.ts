/**
 * Availability seam — answers "is this date non-working?" for the view and,
 * later, the scheduling cascade, from composable non-working-day sources.
 *
 * Standards contract: every semantic this module expresses is a strict subset
 * of the iCalendar family. The locale-weekend source is an RFC 7953
 * (Calendar Availability) weekly recurring non-working pattern — equivalently
 * an RFC 5545 `RRULE:FREQ=WEEKLY;BYDAY=...` over the weekend day codes; the
 * {@link BYDAY_BY_ISO_DAY} mapping is that projection, kept executable so the
 * claim is testable rather than prose. Day-level availability operates on
 * LOCAL calendar dates, matching iCalendar all-day (DATE value) semantics — a
 * non-working day never shifts across a timezone boundary.
 *
 * v1 ships exactly one source (locale weekends). The composition contract
 * (`buildAvailability` over many sources) is the extension point future
 * calendar sources (holiday feeds, schedules, exceptions) plug into.
 *
 * @module controller/availability
 */

/** One producer of non-working-day facts, queried by local calendar date. */
export interface AvailabilitySource {
  isNonWorking(date: Date): boolean;
}

/** The composed availability query consumers ask. */
export interface Availability {
  isNonWorkingDay(date: Date): boolean;
}

/** ISO 8601 weekday number (1 = Monday … 7 = Sunday) → iCalendar BYDAY code. */
export const BYDAY_BY_ISO_DAY: Readonly<Record<number, string>> = {
  1: "MO",
  2: "TU",
  3: "WE",
  4: "TH",
  5: "FR",
  6: "SA",
  7: "SU",
};

/** iCalendar BYDAY code → ISO 8601 weekday number; 0 for an unknown code. */
export function isoDayFromByday(code: string): number {
  for (const [iso, byday] of Object.entries(BYDAY_BY_ISO_DAY)) {
    if (byday === code) return Number(iso);
  }
  return 0;
}

/** Weekend fallback when locale week data is unavailable: Saturday/Sunday. */
const FALLBACK_WEEKEND: ReadonlySet<number> = new Set([6, 7]);

/** The slice of `Intl.Locale` week data this module reads. */
interface WeekInfoLike {
  weekend?: unknown;
}

interface LocaleLike {
  weekInfo?: WeekInfoLike;
  getWeekInfo?: () => WeekInfoLike;
}

function defaultMakeLocale(locale: string): unknown {
  return new Intl.Locale(locale);
}

/**
 * Resolve the locale's weekend days as ISO weekday numbers (1–7).
 *
 * Reads `Intl.Locale` week data through both accessor shapes V8 has shipped
 * (`weekInfo` property and `getWeekInfo()` method). Any failure — unknown
 * locale, missing accessors, malformed data — falls back to Saturday/Sunday
 * rather than throwing.
 *
 * @param locale - a BCP 47 locale tag (the display-locale snapshot).
 * @param makeLocale - injectable `Intl.Locale` factory for tests.
 */
export function resolveWeekendDays(
  locale: string,
  makeLocale: (locale: string) => unknown = defaultMakeLocale,
): ReadonlySet<number> {
  try {
    const localeObj = makeLocale(locale) as LocaleLike;
    const info =
      localeObj.weekInfo ??
      (typeof localeObj.getWeekInfo === "function"
        ? localeObj.getWeekInfo()
        : undefined);
    const weekend = info?.weekend;
    if (Array.isArray(weekend) && weekend.length > 0) {
      const days = weekend.filter(
        (d): d is number => Number.isInteger(d) && d >= 1 && d <= 7,
      );
      if (days.length === weekend.length) return new Set(days);
    }
  } catch {
    // Unknown locale or no Intl.Locale support — use the fallback.
  }
  return FALLBACK_WEEKEND;
}

/** ISO weekday number (1–7) of a date's LOCAL calendar day. */
function isoDayOf(date: Date): number {
  const jsDay = date.getDay();
  return jsDay === 0 ? 7 : jsDay;
}

/** A weekly recurring non-working source over a set of ISO weekend days. */
export function localeWeekendSource(
  weekendDays: ReadonlySet<number>,
): AvailabilitySource {
  return {
    isNonWorking: (date: Date) => weekendDays.has(isoDayOf(date)),
  };
}

/** Compose sources into one availability query (union of non-working). */
export function buildAvailability(
  sources: readonly AvailabilitySource[],
): Availability {
  return {
    isNonWorkingDay: (date: Date) =>
      sources.some((source) => source.isNonWorking(date)),
  };
}

/**
 * The value the view's `highlightTime` delegates to: SVAR's theme-native
 * `wx-weekend` class for a non-working day/hour cell, `''` otherwise.
 *
 * The day/hour gate is load-bearing: SVAR gates its chart-body holidays to
 * day/hour min-units itself, but its time-scale header invokes the function
 * for every cell at every zoom — an ungated classifier would tint month/week
 * header cells that happen to start on a weekend. An hour cell classifies by
 * its enclosing local date.
 */
export function weekendHighlightClass(
  date: Date,
  unit: string,
  availability: Availability,
): string {
  if (unit !== "day" && unit !== "hour") return "";
  return availability.isNonWorkingDay(date) ? "wx-weekend" : "";
}
