import { describe, expect, it } from '@jest/globals';
import { formatUtcOffset } from '../../src/editor/timezoneOffset';

// Fixed reference dates so DST-dependent offsets are deterministic.
const NZ_SUMMER = new Date('2026-01-15T00:00:00Z'); // Auckland UTC+13 (DST)
const NZ_WINTER = new Date('2026-07-15T00:00:00Z'); // Auckland UTC+12 (standard)

describe('formatUtcOffset', () => {
  it('formats a positive offset as UTC±HH:MM', () => {
    expect(formatUtcOffset('Pacific/Auckland', NZ_SUMMER)).toBe('UTC+13:00');
  });

  it('reflects DST at the reference date', () => {
    expect(formatUtcOffset('Pacific/Auckland', NZ_WINTER)).toBe('UTC+12:00');
  });

  it('formats a negative offset', () => {
    // New York is UTC-05:00 in January (standard time).
    expect(formatUtcOffset('America/New_York', NZ_SUMMER)).toBe('UTC-05:00');
  });

  it('formats a half-hour offset', () => {
    // India is UTC+05:30 year-round.
    expect(formatUtcOffset('Asia/Kolkata', NZ_SUMMER)).toBe('UTC+05:30');
  });

  it('formats UTC itself as UTC+00:00', () => {
    expect(formatUtcOffset('UTC', NZ_SUMMER)).toBe('UTC+00:00');
  });

  it('returns null for an unknown zone', () => {
    expect(formatUtcOffset('Not/AZone', NZ_SUMMER)).toBeNull();
  });
});
