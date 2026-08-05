/**
 * Shared per-family day-attribution normalizers.
 *
 * Offset-stamped timestamps (an explicit UTC offset or `Z`) are absolute
 * instants: they convert to the observer's local time before day attribution,
 * unlike naive/floating date fields whose date part is read verbatim. Every
 * family that renders instant-based facts (time entries, external events, …)
 * attributes days through here so they all shift identically with the
 * observer's clock.
 *
 * @module datasource/calendarItems/normalizers
 */

import type { CalendarDerivationWindow, LocalDay } from './types';

/** An inclusive observer-local day span. */
export interface LocalDaySpan {
  startDay: LocalDay;
  endDay: LocalDay;
}

/**
 * Whether a day span overlaps the derivation window (start inclusive, end
 * exclusive). Structural in the span so both a built `CalendarItem` and an
 * in-progress candidate share one window predicate rather than each imitating it.
 */
export function intersectsWindow(
  span: { startDay: LocalDay; endDay: LocalDay },
  window: CalendarDerivationWindow,
): boolean {
  return span.endDay >= window.startDate && span.startDay < window.endDateExclusive;
}

function formatLocalDay(date: Date): LocalDay {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// An ISO datetime with an optional zone (Z or ±HH:MM). Captures the date and
// clock parts so an impossible one (2026-02-30T12:00Z, T24:00) is rejected
// BEFORE `Date` silently rolls it into the next month/day.
const ISO_INSTANT_PATTERN =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

/**
 * The observer-local calendar day an absolute instant falls on, or `null`
 * when the value is not a parseable timestamp string. Accepts `unknown` so
 * callers can feed raw external data and treat `null` as "skip this fact".
 */
export function localDayOfInstant(instant: unknown): LocalDay | null {
  if (typeof instant !== 'string' || instant.trim() === '') return null;
  const trimmed = instant.trim();
  // Validate ISO-shaped components first; a non-ISO but Date-parseable string
  // keeps its prior behavior, so no valid format regresses.
  const iso = ISO_INSTANT_PATTERN.exec(trimmed);
  if (iso !== null) {
    const [, day = '', hour, minute, second] = iso;
    if (!isRealCalendarDay(day) || !isRealWallClockTime(hour, minute, second)) return null;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatLocalDay(parsed);
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FLOATING_DATE_TIME_PATTERN =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const FLOATING_MIDNIGHT_PATTERN = /^\d{4}-\d{2}-\d{2}T00:00(?::00(?:\.0+)?)?$/;

/**
 * Whether a value is a floating (zone-less) datetime at exactly midnight
 * (`YYYY-MM-DDT00:00[:00[.0…]]`). An all-day DTEND that arrives as a midnight
 * datetime rather than a bare date is still an exclusive whole-day boundary.
 */
export function isFloatingMidnight(value: unknown): boolean {
  return typeof value === 'string' && FLOATING_MIDNIGHT_PATTERN.test(value.trim());
}

/** Whether a value is a floating date-only string (`YYYY-MM-DD`). */
export function isLocalDayString(value: unknown): value is LocalDay {
  return typeof value === 'string' && DATE_ONLY_PATTERN.test(value);
}

const CALENDAR_DAY_PATTERN = /^(\d{1,4})-(\d{2})-(\d{2})$/;

// Pure arithmetic, no Date construction: engines ROLL OVER impossible dates
// (2026-02-30 → Mar 2) rather than failing, and a Date round-trip drags in the
// observer's zone (rejecting real dates a zone skips, e.g. 2011-12-30 in
// Pacific/Apia) plus the 0–99 year remap. The shape gate rejects a trailing
// suffix while allowing the unpadded early years formatDateForStorage can emit.
export function isRealCalendarDay(day: LocalDay): boolean {
  const match = CALENDAR_DAY_PATTERN.exec(day);
  if (match === null) return false;
  const [, yearText = '', monthText = '', dayText = ''] = match;
  const month = Number(monthText);
  const dayOfMonth = Number(dayText);
  if (month < 1 || month > 12 || dayOfMonth < 1) return false;
  return dayOfMonth <= daysInMonth(Number(yearText), month);
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1] ?? 0;
}

// The date-only check can't see an impossible wall clock (T99:99), so validate
// the clock parts too. They are two-digit, hence non-negative; seconds allow 60
// for a positive leap second (RFC 5545 time-second).
function isRealWallClockTime(hour?: string, minute?: string, second?: string): boolean {
  return (
    Number(hour) <= 23 &&
    Number(minute) <= 59 &&
    (second === undefined || Number(second) <= 60)
  );
}

/**
 * The calendar day of a floating (wall-clock) value, read WITHOUT zone
 * conversion: a date-only string and an offset-less datetime both mean "this
 * date wherever the observer is", so their date part is verbatim — routing
 * them through `Date` day-extraction would shift dates (the engine parses
 * bare dates as UTC midnight). An offset-stamped stray still converts as an
 * absolute instant. `null` for anything unparseable.
 */
export function localDayOfWallClock(value: unknown): LocalDay | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (DATE_ONLY_PATTERN.test(trimmed)) {
    return isRealCalendarDay(trimmed) ? trimmed : null;
  }
  const floating = FLOATING_DATE_TIME_PATTERN.exec(trimmed);
  if (floating !== null) {
    const [, floatingDay = '', hour, minute, second] = floating;
    if (!isRealCalendarDay(floatingDay) || !isRealWallClockTime(hour, minute, second)) {
      return null;
    }
    return floatingDay;
  }
  return localDayOfInstant(trimmed);
}

/** The local day `deltaDays` away from `day` (calendar arithmetic, DST-safe). */
export function shiftLocalDay(day: LocalDay, deltaDays: number): LocalDay {
  const [year = 0, month = 0, dayOfMonth = 0] = day.split('-').map(Number);
  return formatLocalDay(new Date(year, month - 1, dayOfMonth + deltaDays));
}

function isObserverLocalMidnight(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (FLOATING_MIDNIGHT_PATTERN.test(trimmed)) return true;
  const parsed = new Date(trimmed);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.getHours() === 0 &&
    parsed.getMinutes() === 0 &&
    parsed.getSeconds() === 0 &&
    parsed.getMilliseconds() === 0
  );
}

/**
 * The inclusive observer-local day span a timed start/end pair occupies.
 * Offset-stamped values convert as instants and floating values keep their
 * wall-clock days. An end exactly at local midnight is exclusive, clamped so
 * zero-duration and sub-day ranges keep a one-day minimum. A reversed pair
 * normalizes to an ordered span rather than throwing.
 */
export function localDaySpanOfInstants(
  startInstant: unknown,
  endInstant: unknown,
): LocalDaySpan | null {
  const startDay = localDayOfWallClock(startInstant);
  const endDay = localDayOfWallClock(endInstant);
  if (startDay === null || endDay === null) return null;
  if (startDay > endDay) return { startDay: endDay, endDay: startDay };
  const inclusiveEndDay =
    endDay > startDay && isObserverLocalMidnight(endInstant)
      ? shiftLocalDay(endDay, -1)
      : endDay;
  return { startDay, endDay: inclusiveEndDay };
}
