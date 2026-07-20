import { describe, expect, it } from '@jest/globals';
import { filterTimezones } from '../../src/editor/timezoneFilter';

const ZONES = [
  'Pacific/Auckland',
  'America/New_York',
  'America/Argentina/Buenos_Aires',
  'Europe/London',
  'Europe/Lisbon',
  'Australia/Sydney',
  'UTC',
];

describe('filterTimezones', () => {
  it('returns the whole list (capped) for an empty query', () => {
    expect(filterTimezones(ZONES, '')).toEqual(ZONES.slice(0, ZONES.length));
    expect(filterTimezones(ZONES, '  ', 3)).toHaveLength(3);
  });

  it('matches on any substring, case-insensitively', () => {
    expect(filterTimezones(ZONES, 'york')).toEqual(['America/New_York']);
    expect(filterTimezones(ZONES, 'AUCK')).toEqual(['Pacific/Auckland']);
  });

  it('ranks a city-name prefix ahead of a mid-string match', () => {
    // "lis" starts the city Lisbon; it also appears nowhere else, but the ranking
    // must put a city-prefix hit first among several substring hits.
    const result = filterTimezones(ZONES, 'lon');
    expect(result[0]).toBe('Europe/London'); // city "london" starts with "lon"
  });

  it('returns nothing for a query that matches no zone', () => {
    expect(filterTimezones(ZONES, 'zzz')).toEqual([]);
  });

  it('respects the result limit', () => {
    expect(filterTimezones(ZONES, 'a', 2)).toHaveLength(2);
  });
});
