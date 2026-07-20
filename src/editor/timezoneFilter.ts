/**
 * Pure ranking/filtering for the timezone picker: given the runtime's IANA zone
 * list and a query, return the best matches. A city-name prefix ranks ahead of
 * a whole-string prefix, ahead of a bare substring, so typing "auck" surfaces
 * `Pacific/Auckland` first.
 *
 * @module editor/timezoneFilter
 */

const DEFAULT_LIMIT = 50;

export function filterTimezones(
  zones: readonly string[],
  query: string,
  limit: number = DEFAULT_LIMIT,
): string[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return zones.slice(0, limit);

  return zones
    .filter((zone) => zone.toLowerCase().includes(needle))
    .sort((a, b) => rank(a, needle) - rank(b, needle) || a.localeCompare(b))
    .slice(0, limit);
}

function rank(zone: string, needle: string): number {
  const lower = zone.toLowerCase();
  const city = lower.slice(lower.lastIndexOf('/') + 1);
  if (city.startsWith(needle)) return 0;
  if (lower.startsWith(needle)) return 1;
  return 2;
}
