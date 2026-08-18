import { aggregateLegs } from '../../scripts/aggregate-e2e-results.mjs';

const EXPECTED = 39;

const specUrl = (name: string) => `file:///ci/work/test/specs/${name}`;
const specName = (index: number) => `spec-${String(index + 1).padStart(2, '0')}.e2e.ts`;
const allSpecNames = () => Array.from({ length: EXPECTED }, (_, index) => specName(index));

interface SessionOverride {
  passed?: number;
  failed?: number;
}

const makeSession = (name: string, { passed = 1, failed = 0 }: SessionOverride = {}) => ({
  specs: [specUrl(name)],
  state: { passed, failed, skipped: 0 },
});

const makeLeg = (leg: string, failuresBySpec: Record<string, number> = {}) => {
  const names = allSpecNames();
  return {
    leg,
    merged: { specs: names.map(specUrl) },
    sessions: names.map((name) => makeSession(name, { failed: failuresBySpec[name] ?? 0 })),
  };
};

const makeLegs = (count: number, failures: Record<string, Record<string, number>> = {}) =>
  Array.from({ length: count }, (_, index) => {
    const leg = `leg-${String(index + 1).padStart(2, '0')}`;
    return makeLeg(leg, failures[leg] ?? {});
  });

describe('aggregateLegs', () => {
  it('computes per-spec and per-execution failure rates over the valid-leg denominator', () => {
    const legs = makeLegs(12, {
      'leg-02': { 'spec-01.e2e.ts': 1 },
      'leg-05': { 'spec-01.e2e.ts': 1 },
      'leg-07': { 'spec-03.e2e.ts': 1 },
      'leg-11': { 'spec-09.e2e.ts': 2 },
    });

    const report = aggregateLegs(legs, { expectedSpecCount: EXPECTED });

    expect(report.validLegs).toHaveLength(12);
    expect(report.excludedLegs).toEqual([]);
    expect(report.perSpecFailureRates['spec-01.e2e.ts']).toEqual({ failures: 2, rate: 2 / 12 });
    expect(report.perSpecFailureRates['spec-03.e2e.ts']).toEqual({ failures: 1, rate: 1 / 12 });
    expect(report.perSpecFailureRates['spec-09.e2e.ts']).toEqual({ failures: 1, rate: 1 / 12 });
    expect(report.perSpecFailureRates['spec-02.e2e.ts']).toEqual({ failures: 0, rate: 0 });
    expect(report.perExecutionFailureRate).toEqual({
      failingExecutions: 4,
      validLegCount: 12,
      rate: 4 / 12,
    });
  });

  it('builds a full per-spec x per-leg matrix of pass/fail outcomes', () => {
    const legs = makeLegs(3, { 'leg-02': { 'spec-05.e2e.ts': 1 } });

    const report = aggregateLegs(legs, { expectedSpecCount: EXPECTED });

    expect(Object.keys(report.matrix)).toHaveLength(EXPECTED);
    expect(Object.keys(report.matrix['spec-05.e2e.ts'])).toHaveLength(3);
    expect(report.matrix['spec-05.e2e.ts']['leg-02']).toBe('failed');
    expect(report.matrix['spec-05.e2e.ts']['leg-01']).toBe('passed');
    expect(report.matrix['spec-01.e2e.ts']['leg-02']).toBe('passed');
  });

  it('excludes a leg that recorded fewer than the expected spec count and reports it', () => {
    const legs = makeLegs(12);
    const truncatedNames = allSpecNames().slice(0, 37);
    legs.push({
      leg: 'leg-13',
      merged: { specs: truncatedNames.map(specUrl) },
      sessions: truncatedNames.map((name) => makeSession(name)),
    });

    const report = aggregateLegs(legs, { expectedSpecCount: EXPECTED });

    expect(report.validLegs).toHaveLength(12);
    expect(report.validLegs).not.toContain('leg-13');
    expect(report.excludedLegs).toEqual([
      { leg: 'leg-13', reason: 'unexpected-spec-count', recordedSpecCount: 37, expectedSpecCount: EXPECTED },
    ]);
    expect(report.perExecutionFailureRate.validLegCount).toBe(12);
  });

  it('excludes a leg whose merged results are absent — a reporter that never wrote is not a pass', () => {
    const legs = makeLegs(2);
    legs.push({ leg: 'leg-03', merged: null as never, sessions: allSpecNames().map((name) => makeSession(name)) });

    const report = aggregateLegs(legs, { expectedSpecCount: EXPECTED });

    expect(report.validLegs).toEqual(['leg-01', 'leg-02']);
    expect(report.excludedLegs).toEqual([{ leg: 'leg-03', reason: 'missing-merged-results' }]);
    expect(report.perExecutionFailureRate.validLegCount).toBe(2);
  });

  it('excludes a leg containing a zero-tests-run session', () => {
    const legs = makeLegs(2);
    const zeroTestSessions = allSpecNames().map((name) =>
      name === 'spec-04.e2e.ts' ? makeSession(name, { passed: 0, failed: 0 }) : makeSession(name),
    );
    legs.push({ leg: 'leg-03', merged: { specs: allSpecNames().map(specUrl) }, sessions: zeroTestSessions });

    const report = aggregateLegs(legs, { expectedSpecCount: EXPECTED });

    expect(report.validLegs).toEqual(['leg-01', 'leg-02']);
    expect(report.excludedLegs).toEqual([
      { leg: 'leg-03', reason: 'zero-test-session', spec: 'spec-04.e2e.ts' },
    ]);
  });

  it('excludes a leg whose session files cover fewer specs than the merged results claim', () => {
    const legs = makeLegs(2);
    const partialSessions = allSpecNames()
      .slice(0, EXPECTED - 1)
      .map((name) => makeSession(name));
    legs.push({ leg: 'leg-03', merged: { specs: allSpecNames().map(specUrl) }, sessions: partialSessions });

    const report = aggregateLegs(legs, { expectedSpecCount: EXPECTED });

    expect(report.validLegs).toEqual(['leg-01', 'leg-02']);
    expect(report.excludedLegs).toEqual([
      {
        leg: 'leg-03',
        reason: 'session-spec-mismatch',
        sessionSpecCount: EXPECTED - 1,
        expectedSpecCount: EXPECTED,
      },
    ]);
  });

  it('reports null rates instead of dividing by zero when no leg is valid', () => {
    const legs = [{ leg: 'leg-01', merged: null as never, sessions: [] }];

    const report = aggregateLegs(legs, { expectedSpecCount: EXPECTED });

    expect(report.validLegs).toEqual([]);
    expect(report.matrix).toEqual({});
    expect(report.perSpecFailureRates).toEqual({});
    expect(report.perExecutionFailureRate).toEqual({
      failingExecutions: 0,
      validLegCount: 0,
      rate: null,
    });
  });
});
