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

/**
 * The inclusive observer-local day span a start/end instant pair touches
 * (equal instants collapse to a one-day span), or `null` when either instant
 * is unparseable. A reversed pair normalizes to an ordered span — malformed
 * ordering degrades to a rendered span rather than an error.
 */
export function localDaySpanOfInstants(
  startInstant: unknown,
  endInstant: unknown,
): LocalDaySpan | null {
  const startDay = localDayOfInstant(startInstant);
  const endDay = localDayOfInstant(endInstant);
  if (startDay === null || endDay === null) return null;
  return startDay <= endDay
    ? { startDay, endDay }
    : { startDay: endDay, endDay: startDay };
}
