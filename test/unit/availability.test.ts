import { describe, expect, it } from "@jest/globals";
import {
  BYDAY_BY_ISO_DAY,
  buildAvailability,
  isoDayFromByday,
  localeWeekendSource,
  resolveWeekendDays,
  calendarCellClass,
  dateIdentityClass,
  weekendHighlightClass,
  type AvailabilitySource,
} from "../../src/controller/availability";

/** Local-time date builder (year, month 1-12, day, optional hour/minute). */
function localDate(
  year: number,
  month: number,
  day: number,
  hour = 12,
  minute = 0
): Date {
  return new Date(year, month - 1, day, hour, minute);
}

// 2026-07-11 is a Saturday, 2026-07-12 a Sunday, 2026-07-10 a Friday,
// 2026-07-13 a Monday (fixed anchors used throughout).
const SATURDAY = localDate(2026, 7, 11);
const SUNDAY = localDate(2026, 7, 12);
const FRIDAY = localDate(2026, 7, 10);
const MONDAY = localDate(2026, 7, 13);

describe("resolveWeekendDays", () => {
  it("resolves Saturday/Sunday for en-US", () => {
    expect([...resolveWeekendDays("en-US")].sort()).toEqual([6, 7]);
  });

  it("resolves Friday/Saturday for ar-EG", () => {
    expect([...resolveWeekendDays("ar-EG")].sort()).toEqual([5, 6]);
  });

  it.each(["zz-notreal", "", "not a locale at all!!!"])(
    "falls back to Saturday/Sunday for junk locale %p",
    (locale) => {
      expect([...resolveWeekendDays(locale)].sort()).toEqual([6, 7]);
    }
  );

  it("falls back to Saturday/Sunday when week data accessors are absent", () => {
    // A Locale-like whose weekInfo/getWeekInfo are missing (older engines).
    const bareLocale = {};
    expect(
      [...resolveWeekendDays("en-US", () => bareLocale)].sort()
    ).toEqual([6, 7]);
  });

  it("falls back to Saturday/Sunday when the Locale constructor throws", () => {
    expect(
      [
        ...resolveWeekendDays("en-US", () => {
          throw new Error("no Intl.Locale");
        }),
      ].sort()
    ).toEqual([6, 7]);
  });
});

describe("buildAvailability with the locale weekend source", () => {
  const weekend = buildAvailability([
    localeWeekendSource(resolveWeekendDays("en-US")),
  ]);

  it("classifies Saturday and Sunday as non-working", () => {
    expect(weekend.isNonWorkingDay(SATURDAY)).toBe(true);
    expect(weekend.isNonWorkingDay(SUNDAY)).toBe(true);
  });

  it.each([
    ["Monday", MONDAY],
    ["Friday", FRIDAY],
  ])("classifies %s as working", (_name, date) => {
    expect(weekend.isNonWorkingDay(date)).toBe(false);
  });

  it("classifies across month and year boundaries", () => {
    // 2026-08-01 is a Saturday; 2027-01-02 is a Saturday; 2026-12-31 a Thursday.
    expect(weekend.isNonWorkingDay(localDate(2026, 8, 1))).toBe(true);
    expect(weekend.isNonWorkingDay(localDate(2027, 1, 2))).toBe(true);
    expect(weekend.isNonWorkingDay(localDate(2026, 12, 31))).toBe(false);
  });

  it("classifies by the LOCAL calendar date, even at 23:59 local", () => {
    // R11: a Date at 23:59 local on a Saturday is non-working regardless of
    // what UTC day that instant falls on.
    expect(weekend.isNonWorkingDay(localDate(2026, 7, 11, 23, 59))).toBe(true);
    expect(weekend.isNonWorkingDay(localDate(2026, 7, 13, 0, 0))).toBe(false);
  });

  it("respects a Friday/Saturday weekend set", () => {
    const friSat = buildAvailability([
      localeWeekendSource(resolveWeekendDays("ar-EG")),
    ]);
    expect(friSat.isNonWorkingDay(FRIDAY)).toBe(true);
    expect(friSat.isNonWorkingDay(SATURDAY)).toBe(true);
    expect(friSat.isNonWorkingDay(SUNDAY)).toBe(false);
  });
});

describe("buildAvailability composition (R8)", () => {
  it("takes the union of multiple sources", () => {
    // A stub source marking one fixed Wednesday (2026-07-15) as non-working.
    const fixedWednesday: AvailabilitySource = {
      isNonWorking: (date: Date) =>
        date.getFullYear() === 2026 &&
        date.getMonth() === 6 &&
        date.getDate() === 15,
    };
    const composed = buildAvailability([
      localeWeekendSource(resolveWeekendDays("en-US")),
      fixedWednesday,
    ]);

    expect(composed.isNonWorkingDay(SATURDAY)).toBe(true);
    expect(composed.isNonWorkingDay(localDate(2026, 7, 15))).toBe(true);
    expect(composed.isNonWorkingDay(MONDAY)).toBe(false);
  });

  it("classifies nothing as non-working with no sources", () => {
    const empty = buildAvailability([]);
    expect(empty.isNonWorkingDay(SATURDAY)).toBe(false);
    expect(empty.isNonWorkingDay(SUNDAY)).toBe(false);
  });
});

describe("weekendHighlightClass (KTD2 unit gate)", () => {
  const weekend = buildAvailability([
    localeWeekendSource(resolveWeekendDays("en-US")),
  ]);

  it("returns wx-weekend for a day cell on a Sunday", () => {
    expect(weekendHighlightClass(SUNDAY, "day", weekend)).toBe("wx-weekend");
  });

  it("returns wx-weekend for an hour cell on a Saturday", () => {
    expect(weekendHighlightClass(localDate(2026, 7, 11, 9), "hour", weekend)).toBe(
      "wx-weekend"
    );
  });

  it("returns empty for a weekday at any unit", () => {
    expect(weekendHighlightClass(MONDAY, "day", weekend)).toBe("");
    expect(weekendHighlightClass(MONDAY, "hour", weekend)).toBe("");
  });

  // Covers AE3 at unit level: TimeScale calls the function for every header
  // cell at every zoom, so coarse units must never classify (R3).
  it.each(["week", "month", "quarter", "year"])(
    "returns empty for a %s cell even on a weekend date",
    (unit) => {
      expect(weekendHighlightClass(SATURDAY, unit, weekend)).toBe("");
      expect(weekendHighlightClass(SUNDAY, unit, weekend)).toBe("");
    }
  );
});

describe("calendarCellClass (static identity classes)", () => {
  const weekend = buildAvailability([
    localeWeekendSource(resolveWeekendDays("en-US")),
  ]);

  it("stamps the weekend class plus the identity classes on a weekend day cell", () => {
    expect(calendarCellClass(SUNDAY, "day", weekend)).toBe(
      `wx-weekend og-cal-cell ${dateIdentityClass(SUNDAY)}`
    );
  });

  it("stamps only the identity classes on a weekday", () => {
    expect(calendarCellClass(MONDAY, "day", weekend)).toBe(
      `og-cal-cell ${dateIdentityClass(MONDAY)}`
    );
  });

  it.each(["week", "month", "quarter", "year"])(
    "returns empty for a %s cell (ungated header calls)",
    (unit) => {
      expect(calendarCellClass(SATURDAY, unit, weekend)).toBe("");
    }
  );

  it("identity class encodes the LOCAL calendar day", () => {
    expect(dateIdentityClass(localDate(2026, 4, 10, 23))).toBe("og-d-2026-04-10");
    expect(dateIdentityClass(localDate(2026, 4, 3, 0))).toBe("og-d-2026-04-03");
  });
});

describe("RFC 7953 BYDAY projection (R12)", () => {
  it("maps ISO days 1-7 to iCalendar BYDAY codes", () => {
    expect(BYDAY_BY_ISO_DAY).toEqual({
      1: "MO",
      2: "TU",
      3: "WE",
      4: "TH",
      5: "FR",
      6: "SA",
      7: "SU",
    });
  });

  it("round-trips the ar-EG weekend set through BYDAY codes", () => {
    const isoDays = [...resolveWeekendDays("ar-EG")].sort();
    const byday = isoDays.map((d) => BYDAY_BY_ISO_DAY[d]);
    expect(byday).toEqual(["FR", "SA"]);
    expect(byday.map(isoDayFromByday).sort()).toEqual(isoDays);
  });

  it("round-trips the en-US weekend set through BYDAY codes", () => {
    const isoDays = [...resolveWeekendDays("en-US")].sort();
    const byday = isoDays.map((d) => BYDAY_BY_ISO_DAY[d]);
    expect(byday).toEqual(["SA", "SU"]);
    expect(byday.map(isoDayFromByday).sort()).toEqual(isoDays);
  });
});
