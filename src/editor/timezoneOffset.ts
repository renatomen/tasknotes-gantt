/**
 * The current UTC offset of an IANA zone, as a `UTC±HH:MM` label — a live,
 * DST-aware hint for the timezone picker. Display only: the note persists the
 * IANA name (the canonical, standards-correct identifier), and the offset is
 * always derived for a reference instant, never stored.
 *
 * @module editor/timezoneOffset
 */

export function formatUtcOffset(zone: string, at: Date = new Date()): string | null {
  let name: string | undefined;
  try {
    name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value;
  } catch {
    return null; // unknown zone — Intl throws on an invalid timeZone
  }
  if (name === undefined) return null;
  if (name === 'GMT' || name === 'UTC') return 'UTC+00:00';

  const match = /^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(name);
  if (match === null) return null;
  const sign = match[1];
  const hours = match[2];
  if (sign === undefined || hours === undefined) return null;
  const minutes = match[3] ?? '00';
  return `UTC${sign}${hours.padStart(2, '0')}:${minutes}`;
}
