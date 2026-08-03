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

import type { LocalDay } from './types';

/** An inclusive observer-local day span. */
export interface LocalDaySpan {
  startDay: LocalDay;
  endDay: LocalDay;
}

function formatLocalDay(date: Date): LocalDay {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * The observer-local calendar day an absolute instant falls on, or `null`
 * when the value is not a parseable timestamp string. Accepts `unknown` so
 * callers can feed raw external data and treat `null` as "skip this fact".
 */
export function localDayOfInstant(instant: unknown): LocalDay | null {
  if (typeof instant !== 'string' || instant.trim() === '') return null;
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatLocalDay(parsed);
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FLOATING_DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
const FLOATING_MIDNIGHT_PATTERN = /^\d{4}-\d{2}-\d{2}T00:00(?::00(?:\.0+)?)?$/;

/** Whether a value is a floating date-only string (`YYYY-MM-DD`). */
export function isLocalDayString(value: unknown): value is LocalDay {
  return typeof value === 'string' && DATE_ONLY_PATTERN.test(value);
}

// Round-trip through local Date parts: engines ROLL OVER impossible calendar
// dates (2026-02-30 → Mar 2) instead of failing, so a parse-NaN check can't
// reject them.
function isRealCalendarDay(day: LocalDay): boolean {
  const [year = 0, month = 0, dayOfMonth = 0] = day.split('-').map(Number);
  const parsed = new Date(year, month - 1, dayOfMonth);
  return (
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === dayOfMonth
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
  const floatingDay = FLOATING_DATE_TIME_PATTERN.exec(trimmed)?.[1];
  if (floatingDay !== undefined) {
    return isRealCalendarDay(floatingDay) ? floatingDay : null;
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
