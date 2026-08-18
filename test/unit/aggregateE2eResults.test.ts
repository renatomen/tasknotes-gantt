import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  aggregateLegs,
  readLegsFromDirectory,
  readLegsFromDispatchDirectories,
} from '../../scripts/aggregate-e2e-results.mjs';

const EXPECTED = 39;

const specUrl = (name: string) => `file:///ci/work/test/specs/${name}`;
const specName = (index: number) => `spec-${String(index + 1).padStart(2, '0')}.e2e.ts`;
const allSpecNames = () => Array.from({ length: EXPECTED }, (_, index) => specName(index));

interface SessionOverride {
  passed?: number;
  failed?: number;
  skipped?: number;
}

const makeSession = (name: string, { passed = 1, failed = 0, skipped = 0 }: SessionOverride = {}) => ({
  specs: [specUrl(name)],
  state: { passed, failed, skipped },
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

describe('readLegsFromDirectory', () => {
  let artifactsDir: string;

  beforeEach(() => {
    artifactsDir = mkdtempSync(join(tmpdir(), 'aggregate-e2e-'));
  });

  afterEach(() => {
    rmSync(artifactsDir, { recursive: true, force: true });
  });

  const writeLegFixture = (legNumber: number, files: Record<string, string>) => {
    const resultsDir = join(artifactsDir, `e2e-results-leg-${legNumber}`, '.wdio-results');
    mkdirSync(resultsDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(resultsDir, name), content);
    }
  };

  it('routes the merged file and session files into the leg and records the values it read', () => {
    const session = JSON.stringify(makeSession('spec-01.e2e.ts'));
    writeLegFixture(1, {
      'wdio-merged-results.json': JSON.stringify({ specs: [specUrl('spec-01.e2e.ts')] }),
      'wdio-0-0-json-reporter.json': session,
    });

    const legs = readLegsFromDirectory(artifactsDir);

    expect(legs).toEqual([
      {
        leg: 'e2e-results-leg-1',
        merged: { specs: [specUrl('spec-01.e2e.ts')] },
        sessions: [JSON.parse(session)],
        corruptFiles: [],
      },
    ]);
  });

  it('captures an unparseable results file in corruptFiles instead of dropping it', () => {
    writeLegFixture(1, {
      'wdio-merged-results.json': JSON.stringify({ specs: [] }),
      'wdio-0-0-json-reporter.json': '{broken',
    });

    const legs = readLegsFromDirectory(artifactsDir);

    expect(legs[0].corruptFiles).toEqual(['wdio-0-0-json-reporter.json']);
  });

  it('rejects leg directories beyond the expected execution count instead of widening the denominator', () => {
    writeLegFixture(1, { 'wdio-merged-results.json': JSON.stringify({ specs: [] }) });
    writeLegFixture(2, { 'wdio-merged-results.json': JSON.stringify({ specs: [] }) });
    writeLegFixture(3, { 'wdio-merged-results.json': JSON.stringify({ specs: [] }) });

    expect(() => readLegsFromDirectory(artifactsDir, 2)).toThrow(/e2e-results-leg-3/);
  });

  it('pools legs from multiple dispatch downloads under distinct dispatch namespaces', () => {
    const secondRoot = mkdtempSync(join(tmpdir(), 'aggregate-e2e-b-'));
    try {
      writeLegFixture(1, { 'wdio-merged-results.json': JSON.stringify({ specs: [] }) });
      const otherResults = join(secondRoot, 'e2e-results-leg-1', '.wdio-results');
      mkdirSync(otherResults, { recursive: true });
      writeFileSync(join(otherResults, 'wdio-merged-results.json'), JSON.stringify({ specs: [] }));

      const legs = readLegsFromDispatchDirectories([
        { artifactsDir, expectedExecutions: 2 },
        { artifactsDir: secondRoot, expectedExecutions: 1 },
      ]);

      expect(legs.map((leg: { leg: string }) => leg.leg)).toEqual([
        'dispatch-1/e2e-results-leg-1',
        'dispatch-1/e2e-results-leg-2',
        'dispatch-2/e2e-results-leg-1',
      ]);
      expect(
        legs.filter((leg: { artifactMissing?: boolean }) => leg.artifactMissing).map((leg: { leg: string }) => leg.leg),
      ).toEqual(['dispatch-1/e2e-results-leg-2']);
    } finally {
      rmSync(secondRoot, { recursive: true, force: true });
    }
  });

  it('rejects the same download directory supplied twice — one run must not double-count', () => {
    writeLegFixture(1, { 'wdio-merged-results.json': JSON.stringify({ specs: [] }) });

    expect(() =>
      readLegsFromDispatchDirectories([
        { artifactsDir, expectedExecutions: 1 },
        { artifactsDir, expectedExecutions: 1 },
      ]),
    ).toThrow(/same download directory/);
  });

  it('keeps single-dispatch leg names unprefixed', () => {
    writeLegFixture(1, { 'wdio-merged-results.json': JSON.stringify({ specs: [] }) });

    const legs = readLegsFromDispatchDirectories([{ artifactsDir, expectedExecutions: 1 }]);

    expect(legs.map((leg: { leg: string }) => leg.leg)).toEqual(['e2e-results-leg-1']);
  });

  it('synthesizes artifact-missing legs for expected executions with no directory', () => {
    writeLegFixture(2, { 'wdio-merged-results.json': JSON.stringify({ specs: [] }) });

    const legs = readLegsFromDirectory(artifactsDir, 3);

    expect(legs.map((leg: { leg: string }) => leg.leg)).toEqual([
      'e2e-results-leg-2',
      'e2e-results-leg-1',
      'e2e-results-leg-3',
    ]);
    expect(legs.filter((leg: { artifactMissing?: boolean }) => leg.artifactMissing).map((leg: { leg: string }) => leg.leg)).toEqual([
      'e2e-results-leg-1',
      'e2e-results-leg-3',
    ]);
  });
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

  it('excludes a leg with an unparseable results file under its own reason, not as missing', () => {
    const legs = [
      ...makeLegs(2),
      {
        leg: 'leg-03',
        merged: { specs: allSpecNames().map(specUrl) },
        sessions: allSpecNames().map((name) => makeSession(name)),
        corruptFiles: ['wdio-0-0-json-reporter.json'],
      },
    ];

    const report = aggregateLegs(legs, { expectedSpecCount: EXPECTED });

    expect(report.validLegs).toEqual(['leg-01', 'leg-02']);
    expect(report.excludedLegs).toEqual([
      { leg: 'leg-03', reason: 'corrupt-results-file', files: ['wdio-0-0-json-reporter.json'] },
    ]);
  });

  it('keeps a leg valid when a session recorded only skipped tests — skipping is not an infrastructure failure', () => {
    const legs = makeLegs(2);
    const sessions = allSpecNames().map((name) =>
      name === 'spec-04.e2e.ts' ? makeSession(name, { passed: 0, failed: 0, skipped: 2 }) : makeSession(name),
    );
    legs.push({ leg: 'leg-03', merged: { specs: allSpecNames().map(specUrl) }, sessions });

    const report = aggregateLegs(legs, { expectedSpecCount: EXPECTED });

    expect(report.validLegs).toEqual(['leg-01', 'leg-02', 'leg-03']);
    expect(report.excludedLegs).toEqual([]);
    expect(report.matrix['spec-04.e2e.ts']['leg-03']).toBe('passed');
  });

  it('excludes a leg whose merged results parsed but lack a specs array (the zero-session mergeResults output)', () => {
    const legs = [...makeLegs(2), { leg: 'leg-03', merged: {} as never, sessions: [] }];

    const report = aggregateLegs(legs, { expectedSpecCount: EXPECTED });

    expect(report.validLegs).toEqual(['leg-01', 'leg-02']);
    expect(report.excludedLegs).toEqual([{ leg: 'leg-03', reason: 'malformed-merged-results' }]);
  });

  it('excludes a leg whose merged specs contain a non-string entry instead of crashing', () => {
    const legs = [
      ...makeLegs(2),
      {
        leg: 'leg-03',
        merged: { specs: [null, ...allSpecNames().slice(1).map(specUrl)] as never },
        sessions: allSpecNames().map((name) => makeSession(name)),
      },
    ];

    const report = aggregateLegs(legs, { expectedSpecCount: EXPECTED });

    expect(report.validLegs).toEqual(['leg-01', 'leg-02']);
    expect(report.excludedLegs).toEqual([{ leg: 'leg-03', reason: 'malformed-merged-results' }]);
  });

  it('excludes a leg containing a session with non-numeric state counts', () => {
    const sessions = allSpecNames().map((name) =>
      name === 'spec-04.e2e.ts'
        ? { specs: [specUrl(name)], state: { passed: 1, failed: 0 } as never }
        : makeSession(name),
    );
    const legs = [...makeLegs(2), { leg: 'leg-03', merged: { specs: allSpecNames().map(specUrl) }, sessions }];

    const report = aggregateLegs(legs, { expectedSpecCount: EXPECTED });

    expect(report.validLegs).toEqual(['leg-01', 'leg-02']);
    expect(report.excludedLegs).toEqual([{ leg: 'leg-03', reason: 'malformed-session-results' }]);
  });

  it('excludes a leg containing a session whose specs hold a non-string entry', () => {
    const sessions = allSpecNames().map((name) =>
      name === 'spec-04.e2e.ts' ? { specs: [null] as never, state: { passed: 1, failed: 0, skipped: 0 } } : makeSession(name),
    );
    const legs = [...makeLegs(2), { leg: 'leg-03', merged: { specs: allSpecNames().map(specUrl) }, sessions }];

    const report = aggregateLegs(legs, { expectedSpecCount: EXPECTED });

    expect(report.validLegs).toEqual(['leg-01', 'leg-02']);
    expect(report.excludedLegs).toEqual([{ leg: 'leg-03', reason: 'malformed-session-results' }]);
  });

  it('excludes a leg containing a session with no associated specs — an orphan failure must not vanish', () => {
    const sessions = [
      ...allSpecNames().map((name) => makeSession(name)),
      { specs: [], state: { passed: 0, failed: 1, skipped: 0 } },
    ];
    const legs = [...makeLegs(2), { leg: 'leg-03', merged: { specs: allSpecNames().map(specUrl) }, sessions }];

    const report = aggregateLegs(legs, { expectedSpecCount: EXPECTED });

    expect(report.validLegs).toEqual(['leg-01', 'leg-02']);
    expect(report.excludedLegs).toEqual([{ leg: 'leg-03', reason: 'malformed-session-results' }]);
  });

  it('excludes a leg whose session specs differ from the merged receipt in identity, not just count', () => {
    const receiptNames = allSpecNames();
    const sessionNames = [...allSpecNames().slice(1), 'spec-40.e2e.ts'];
    const legs = [
      ...makeLegs(2),
      {
        leg: 'leg-03',
        merged: { specs: receiptNames.map(specUrl) },
        sessions: sessionNames.map((name) => makeSession(name)),
      },
    ];

    const report = aggregateLegs(legs, { expectedSpecCount: EXPECTED });

    expect(report.validLegs).toEqual(['leg-01', 'leg-02']);
    expect(report.excludedLegs).toEqual([
      {
        leg: 'leg-03',
        reason: 'session-spec-mismatch',
        sessionSpecCount: EXPECTED,
        expectedSpecCount: EXPECTED,
      },
    ]);
  });

  it('excludes a leg containing a session that parsed as null instead of crashing', () => {
    const sessions = [...allSpecNames().map((name) => makeSession(name)), null as never];
    const legs = [...makeLegs(2), { leg: 'leg-03', merged: { specs: allSpecNames().map(specUrl) }, sessions }];

    const report = aggregateLegs(legs, { expectedSpecCount: EXPECTED });

    expect(report.validLegs).toEqual(['leg-01', 'leg-02']);
    expect(report.excludedLegs).toEqual([{ leg: 'leg-03', reason: 'malformed-session-results' }]);
  });

  it('excludes a leg containing a session without state or specs instead of crashing', () => {
    const sessions = [...allSpecNames().map((name) => makeSession(name)), {} as never];
    const legs = [...makeLegs(2), { leg: 'leg-03', merged: { specs: allSpecNames().map(specUrl) }, sessions }];

    const report = aggregateLegs(legs, { expectedSpecCount: EXPECTED });

    expect(report.validLegs).toEqual(['leg-01', 'leg-02']);
    expect(report.excludedLegs).toEqual([{ leg: 'leg-03', reason: 'malformed-session-results' }]);
  });

  it('excludes a leg marked artifact-missing so absent uploads stay in the denominator report', () => {
    const legs = [
      ...makeLegs(2),
      { leg: 'e2e-results-leg-3', merged: null as never, sessions: [], artifactMissing: true },
    ];

    const report = aggregateLegs(legs, { expectedSpecCount: EXPECTED });

    expect(report.validLegs).toEqual(['leg-01', 'leg-02']);
    expect(report.excludedLegs).toEqual([{ leg: 'e2e-results-leg-3', reason: 'missing-artifact' }]);
  });

  it('excludes a leg whose merged specs list only reaches the expected count through duplicates', () => {
    const duplicated = [...allSpecNames().slice(0, EXPECTED - 1), specName(0)];
    const legs = [
      ...makeLegs(2),
      {
        leg: 'leg-03',
        merged: { specs: duplicated.map(specUrl) },
        sessions: duplicated.map((name) => makeSession(name)),
      },
    ];

    const report = aggregateLegs(legs, { expectedSpecCount: EXPECTED });

    expect(report.validLegs).toEqual(['leg-01', 'leg-02']);
    expect(report.excludedLegs).toEqual([
      { leg: 'leg-03', reason: 'unexpected-spec-count', recordedSpecCount: EXPECTED - 1, expectedSpecCount: EXPECTED },
    ]);
  });

  it('keeps a spec failed when a later session entry for the same spec passes', () => {
    const legs = makeLegs(1);
    legs[0].sessions = [
      makeSession('spec-01.e2e.ts', { failed: 1 }),
      makeSession('spec-01.e2e.ts'),
      ...allSpecNames()
        .slice(1)
        .map((name) => makeSession(name)),
    ];

    const report = aggregateLegs(legs, { expectedSpecCount: EXPECTED });

    expect(report.validLegs).toEqual(['leg-01']);
    expect(report.matrix['spec-01.e2e.ts']['leg-01']).toBe('failed');
    expect(report.perSpecFailureRates['spec-01.e2e.ts']).toEqual({ failures: 1, rate: 1 });
  });

  it('fails loudly when valid legs disagree on spec identity instead of diluting rates', () => {
    const legs = makeLegs(2);
    const swapped = [...allSpecNames().slice(0, EXPECTED - 1), 'spec-99.e2e.ts'];
    legs.push({
      leg: 'leg-03',
      merged: { specs: swapped.map(specUrl) },
      sessions: swapped.map((name) => makeSession(name)),
    });

    expect(() => aggregateLegs(legs, { expectedSpecCount: EXPECTED })).toThrow(/spec identity|spec-99/);
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
