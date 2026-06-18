import {
  formatGap,
  formatIncomingDep,
  formatIncomingDeps,
  type IncomingDep,
} from '../../src/bases/dependencyTooltip';

const dep = (over: Partial<IncomingDep> = {}): IncomingDep => ({
  reltype: 'FINISHTOSTART',
  gap: null,
  predecessorName: 'Draft docs',
  ...over,
});

describe('formatGap', () => {
  it('formats single-unit durations compactly with a + sign', () => {
    expect(formatGap('P1D')).toBe('+1d');
    expect(formatGap('P3W')).toBe('+3w');
    expect(formatGap('PT4H')).toBe('+4h');
    expect(formatGap('PT30M')).toBe('+30m');
  });

  it('formats a lead (leading -) with a - sign', () => {
    expect(formatGap('-P2D')).toBe('-2d');
    expect(formatGap('-PT2H')).toBe('-2h');
  });

  it('returns empty string for null/empty', () => {
    expect(formatGap(null)).toBe('');
    expect(formatGap('')).toBe('');
    expect(formatGap('   ')).toBe('');
  });

  it('falls back to the raw ISO string for composite/exotic durations (KTD5)', () => {
    expect(formatGap('P1W2DT3H')).toBe('P1W2DT3H');
    expect(formatGap('P1Y')).toBe('P1Y');
    expect(formatGap('PT1H30M')).toBe('PT1H30M');
  });
});

describe('formatIncomingDep', () => {
  it('covers AE2 — FS edge with gap P1D shows FS and +1d', () => {
    expect(formatIncomingDep(dep({ reltype: 'FINISHTOSTART', gap: 'P1D' }))).toBe(
      'Blocked by Draft docs — FS +1d',
    );
  });

  it('maps every reltype to its short label', () => {
    expect(formatIncomingDep(dep({ reltype: 'FINISHTOSTART' }))).toContain('FS');
    expect(formatIncomingDep(dep({ reltype: 'FINISHTOFINISH' }))).toContain('FF');
    expect(formatIncomingDep(dep({ reltype: 'STARTTOSTART' }))).toContain('SS');
    expect(formatIncomingDep(dep({ reltype: 'STARTTOFINISH' }))).toContain('SF');
  });

  it('omits the gap suffix when there is no gap', () => {
    expect(formatIncomingDep(dep({ reltype: 'STARTTOSTART', gap: null }))).toBe(
      'Blocked by Draft docs — SS',
    );
  });
});

describe('formatIncomingDeps', () => {
  it('returns empty string for no edges (caller must inject nothing)', () => {
    expect(formatIncomingDeps([])).toBe('');
  });

  it('lists each edge, sorted alphabetically by predecessor name (deterministic)', () => {
    const out = formatIncomingDeps([
      dep({ predecessorName: 'Zeta', reltype: 'STARTTOSTART' }),
      dep({ predecessorName: 'Alpha', reltype: 'FINISHTOSTART', gap: 'P1D' }),
    ]);
    expect(out).toBe('Blocked by Alpha — FS +1d\nBlocked by Zeta — SS');
  });
});
