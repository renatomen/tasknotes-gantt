/**
 * Format a release date for display in the "What's New" view.
 *
 * The bundle stores the raw ISO date (`YYYY-MM-DD`) or `null`; the view formats
 * it here — adapters extract raw values, views format them for display.
 * The ISO string is parsed by hand rather than via `new Date(iso)` so the rendered
 * day never shifts under the local timezone.
 *
 * @param iso an ISO `YYYY-MM-DD` string, or `null`
 * @returns `"Month D, YYYY"` (e.g. `"July 1, 2026"`), or `""` when the input is
 *   missing or not a valid calendar date — callers guard on the empty string.
 */
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export function formatReleaseDate(iso: string | null): string {
  if (!iso) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return "";

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";

  // Reject impossible calendar days (e.g. Feb 30) by round-tripping through UTC.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return "";
  }

  return `${MONTH_NAMES[month - 1]} ${day}, ${year}`;
}
