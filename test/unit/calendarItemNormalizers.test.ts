/**
 * Shared calendar-item day-attribution normalizer unit tests.
 *
 * Offset-stamped timestamps are absolute instants that must convert to the
 * observer's local time before day attribution. The observer zone cannot be
 * pinned under Jest (reassigning `process.env.TZ` does not reach Node's
 * native setter there), so fixtures are built dynamically around the
 * machine-local midnight and stamped with a FOREIGN offset whose wall date
 * provably differs from the local day — a sanity assertion on each fixture
 * guarantees the discrimination, in every timezone the suite runs in.
 *
 * Following testing-standards.md: Jest, pure functions, AAA.
 */

import { describe, it, expect } from '@jest/globals';
import {
  isLocalDayString,
  isRealCalendarDay,
  localDayOfInstant,
  localDayOfWallClock,
  localDaySpanOfInstants,
  shiftLocalDay,
} from '../../src/datasource/calendarItems/normalizers';

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** Express an absolute instant as an ISO string at the given UTC offset. */
function isoAtOffset(instant: Date, offsetMinutes: number): string {
  const wall = new Date(instant.getTime() + offsetMinutes * 60_000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return (
    `${pad(wall.getUTCFullYear(), 4)}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}` +
    `T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}:${pad(wall.getUTCSeconds())}` +
    `${sign}${pad(Math.trunc(abs / 60))}:${pad(abs % 60)}`
  );
}

/** Express an absolute instant as an ISO string at the observer's own offset. */
function isoAtLocalOffset(instant: Date): string {
  return isoAtOffset(instant, -instant.getTimezoneOffset());
}

/**
 * An offset one hour behind the observer's: the wall clock reads one hour
 * earlier, so an instant just past local midnight gets a PREVIOUS-day wall
 * date — the case where naive date-part reading and instant conversion differ.
 */
function foreignOffsetBehindLocal(instant: Date): number {
  return -instant.getTimezoneOffset() - 60;
}

/** Independent oracle: the observer-local day via Intl formatting. */
function intlLocalDay(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

// 2026-08-04 00:30 in the observer's local time — just past local midnight.
const PAST_LOCAL_MIDNIGHT = new Date(2026, 7, 4, 0, 30, 0);
const PAST_LOCAL_MIDNIGHT_DAY = '2026-08-04';

describe('localDayOfInstant — offset-aware local-day attribution', () => {
  it('attributes an offset-stamped instant to the observer-local day even when its wall date differs', () => {
    const stamped = isoAtOffset(PAST_LOCAL_MIDNIGHT, foreignOffsetBehindLocal(PAST_LOCAL_MIDNIGHT));
    // Fixture sanity: the foreign wall date really is the previous day, so a
    // naive date-part reading would return 2026-08-03 here.
    expect(stamped.startsWith('2026-08-03T23:30:00')).toBe(true);

    expect(localDayOfInstant(stamped)).toBe(PAST_LOCAL_MIDNIGHT_DAY);
  });

  it('converts Z-suffixed instants to the observer-local day too', () => {
    const zStamped = isoAtOffset(PAST_LOCAL_MIDNIGHT, 0).replace('+00:00', 'Z');

    expect(localDayOfInstant(zStamped)).toBe(PAST_LOCAL_MIDNIGHT_DAY);
  });

  it('agrees with the Intl formatting oracle on the offset-stamped example 23:30:00+13:00', () => {
    const instant = new Date('2026-08-03T23:30:00+13:00');

    expect(localDayOfInstant('2026-08-03T23:30:00+13:00')).toBe(intlLocalDay(instant));
  });

  it('zero-pads single-digit month and day', () => {
    const january = new Date(2026, 0, 5, 12, 0, 0);

    expect(localDayOfInstant(isoAtLocalOffset(january))).toBe('2026-01-05');
  });

  it.each([
    { caseName: 'an unparseable string', value: 'not-a-timestamp' },
    { caseName: 'an empty string', value: '' },
    { caseName: 'a blank string', value: '   ' },
    { caseName: 'undefined', value: undefined },
    { caseName: 'null', value: null },
    { caseName: 'a number', value: 1754200000000 },
  ])('returns null for $caseName', ({ value }) => {
    expect(localDayOfInstant(value)).toBeNull();
  });
});

describe('localDaySpanOfInstants — inclusive local-day span of an instant range', () => {
  const beforeMidnight = new Date(2026, 7, 3, 23, 30, 0);

  it('spans both days when the range crosses local midnight', () => {
    const span = localDaySpanOfInstants(
      isoAtLocalOffset(beforeMidnight),
      isoAtLocalOffset(PAST_LOCAL_MIDNIGHT),
    );

    expect(span).toEqual({ startDay: '2026-08-03', endDay: '2026-08-04' });
  });

  it('collapses a zero-length range to a one-day span', () => {
    const nineAm = isoAtLocalOffset(new Date(2026, 7, 3, 9, 0, 0));

    expect(localDaySpanOfInstants(nineAm, nineAm)).toEqual({
      startDay: '2026-08-03',
      endDay: '2026-08-03',
    });
  });

  it('spans by observer-local days, not the wall dates of the timestamps', () => {
    const offset = foreignOffsetBehindLocal(PAST_LOCAL_MIDNIGHT);
    const start = isoAtOffset(PAST_LOCAL_MIDNIGHT, offset);
    const end = isoAtOffset(new Date(2026, 7, 4, 0, 45, 0), offset);
    // Fixture sanity: both wall dates read the previous day.
    expect(start.startsWith('2026-08-03')).toBe(true);
    expect(end.startsWith('2026-08-03')).toBe(true);

    expect(localDaySpanOfInstants(start, end)).toEqual({
      startDay: PAST_LOCAL_MIDNIGHT_DAY,
      endDay: PAST_LOCAL_MIDNIGHT_DAY,
    });
  });

  it('normalizes a reversed range into an ordered span', () => {
    const span = localDaySpanOfInstants(
      isoAtLocalOffset(PAST_LOCAL_MIDNIGHT),
      isoAtLocalOffset(beforeMidnight),
    );

    expect(span).toEqual({ startDay: '2026-08-03', endDay: '2026-08-04' });
  });

  it.each([
    { caseName: 'the start is unparseable', start: 'garbage', end: '2026-08-03T10:00:00Z' },
    { caseName: 'the end is unparseable', start: '2026-08-03T10:00:00Z', end: 'garbage' },
    { caseName: 'the end is missing', start: '2026-08-03T10:00:00Z', end: undefined },
  ])('returns null when $caseName', ({ start, end }) => {
    expect(localDaySpanOfInstants(start, end)).toBeNull();
  });
});

describe('localDayOfWallClock — floating (zone-less) day attribution', () => {
  it('reads a date-only string verbatim, never through a UTC bare-date parse', () => {
    expect(localDayOfWallClock('2026-08-10')).toBe('2026-08-10');
  });

  it('reads an offset-less datetime as its own floating date part', () => {
    // 23:30 catches a treat-as-UTC defect in zones ahead of UTC; 00:30
    // catches it in zones behind — together every nonzero offset exposes it.
    expect(localDayOfWallClock('2026-03-10T23:30:00')).toBe('2026-03-10');
    expect(localDayOfWallClock('2026-03-10T00:30:00')).toBe('2026-03-10');
  });

  it('still converts an offset-stamped stray as an absolute instant', () => {
    const pastMidnight = new Date(2026, 7, 4, 0, 30, 0);
    const foreignOffset = -pastMidnight.getTimezoneOffset() - 60;
    const stamped = isoAtOffset(pastMidnight, foreignOffset);
    expect(stamped.startsWith('2026-08-03T23:30:00')).toBe(true);

    expect(localDayOfWallClock(stamped)).toBe('2026-08-04');
  });

  it.each([
    { caseName: 'an impossible calendar date', value: '2026-02-30' },
    { caseName: 'an impossible hour and minute', value: '2026-08-10T99:99' },
    { caseName: 'an out-of-range hour', value: '2026-08-10T24:00' },
    { caseName: 'an out-of-range minute', value: '2026-08-10T12:60' },
    { caseName: 'a second past the leap-second bound', value: '2026-08-10T23:59:61' },
    { caseName: 'an unparseable string', value: 'not-a-date' },
    { caseName: 'undefined', value: undefined },
    { caseName: 'a number', value: 20260810 },
  ])('returns null for $caseName', ({ value }) => {
    expect(localDayOfWallClock(value)).toBeNull();
  });

  it('accepts a leap-second and a boundary wall clock', () => {
    expect(localDayOfWallClock('2026-08-10T23:59:60')).toBe('2026-08-10');
    expect(localDayOfWallClock('2026-08-10T23:59:59')).toBe('2026-08-10');
    // A datetime without a seconds field exercises the seconds-less accept arm.
    expect(localDayOfWallClock('2026-08-10T12:30')).toBe('2026-08-10');
  });
});

describe('isRealCalendarDay', () => {
  it('accepts a real day, a leap day, and early/unpadded years (zone-independent)', () => {
    expect(isRealCalendarDay('2026-02-28')).toBe(true);
    expect(isRealCalendarDay('2024-02-29')).toBe(true); // leap year
    expect(isRealCalendarDay('0000-02-29')).toBe(true); // year 0 is a leap year
    expect(isRealCalendarDay('0050-01-01')).toBe(true);
    expect(isRealCalendarDay('50-01-01')).toBe(true); // formatDateForStorage's unpadded early year
    expect(isRealCalendarDay('2011-12-30')).toBe(true); // real day Pacific/Apia skipped
  });

  it('rejects an impossible day, a non-leap Feb 29, a trailing suffix, and a bad shape', () => {
    expect(isRealCalendarDay('2026-02-30')).toBe(false);
    expect(isRealCalendarDay('2026-02-29')).toBe(false); // 2026 is not a leap year
    expect(isRealCalendarDay('2026-13-01')).toBe(false);
    expect(isRealCalendarDay('2026-01-15-extra')).toBe(false);
    expect(isRealCalendarDay('2026-1-5')).toBe(false);
  });
});

describe('isLocalDayString', () => {
  it('accepts only the date-only shape', () => {
    expect(isLocalDayString('2026-08-10')).toBe(true);
    expect(isLocalDayString('2026-08-10T00:00:00')).toBe(false);
    expect(isLocalDayString(undefined)).toBe(false);
  });
});

describe('shiftLocalDay — calendar day arithmetic', () => {
  it('shifts forward and backward across month boundaries', () => {
    expect(shiftLocalDay('2026-08-31', 1)).toBe('2026-09-01');
    expect(shiftLocalDay('2026-09-01', -1)).toBe('2026-08-31');
  });

  it('shifts across a leap-February boundary', () => {
    expect(shiftLocalDay('2028-02-28', 1)).toBe('2028-02-29');
    expect(shiftLocalDay('2028-03-01', -1)).toBe('2028-02-29');
  });
});
