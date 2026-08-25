import { createGanttLifecycleCollector } from '../../src/debugLog';
import {
  areColumnSortControlsEquivalent,
  boundedFact,
  buildColumnSortControlDigest,
  classifyColumnSortDiagnosis,
  COLUMN_SORT_BOUNDED_FACT_LIMIT,
  COLUMN_SORT_LIFECYCLE_CAPACITY,
  createColumnSortEnvelopeGate,
  estimateWorstCaseRecordBudget,
  isColumnSortControlIdentityComplete,
  type ColumnSortClickAttempt,
  type ColumnSortControlIdentity,
  type ColumnSortRootCensusEntry,
  type ColumnSortTraceInput,
} from '../specs/helpers/columnSortDiagnosis';

function root(overrides: Partial<ColumnSortRootCensusEntry> = {}): ColumnSortRootCensusEntry {
  return {
    mountToken: 1,
    selectedByGlobalProxy: true,
    connected: true,
    visible: true,
    ownsBase: true,
    headerPresent: true,
    ...overrides,
  };
}

function attempt(overrides: Partial<ColumnSortClickAttempt> = {}): ColumnSortClickAttempt {
  return {
    callSite: 'ae1-sort-loop',
    attemptOrdinal: 1,
    landed: true,
    ariaSortBefore: 'none',
    ariaSortAfter: 'ascending',
    activeLeafViewType: 'bases',
    markdownLeafPresent: false,
    roots: [root()],
    sequence: 10,
    ...overrides,
  };
}

function wrongRootAttempt(): ColumnSortClickAttempt {
  return attempt({
    landed: false,
    roots: [
      root({ ownsBase: false, connected: false, headerPresent: false }),
      root({ selectedByGlobalProxy: false, ownsBase: true, headerPresent: true }),
    ],
  });
}

function completeSlice(): NonNullable<ColumnSortTraceInput['slice']> {
  return {
    phaseStartSeen: true,
    terminalSeen: true,
    readinessPassedSeen: true,
    overflowInSlice: false,
    collectorFailure: false,
  };
}

function baseInput(overrides: Partial<ColumnSortTraceInput> = {}): ColumnSortTraceInput {
  return {
    diagnosticOutcome: 'captured',
    slice: completeSlice(),
    clickAttempts: [attempt()],
    rowContradiction: null,
    domRemovalObserved: null,
    matchedControl: true,
    comparableTraceDisagrees: false,
    ...overrides,
  };
}

describe('classifyColumnSortDiagnosis', () => {
  it('classifies a diagnostic-unavailable envelope as probe-failure, never open (AE5)', () => {
    const verdict = classifyColumnSortDiagnosis(baseInput({ diagnosticOutcome: 'unavailable' }));
    expect(verdict.verdict).toBe('probe-failure');
  });

  it('classifies a failed retrieval as probe-failure', () => {
    const verdict = classifyColumnSortDiagnosis(baseInput({ diagnosticOutcome: 'failed' }));
    expect(verdict.verdict).toBe('probe-failure');
  });

  it('classifies an overflowed failing slice as open and names the overflow (AE5)', () => {
    const verdict = classifyColumnSortDiagnosis(
      baseInput({ slice: { ...completeSlice(), overflowInSlice: true } }),
    );
    expect(verdict.verdict).toBe('open');
    expect(verdict.reason).toContain('overflow');
  });

  it('refuses every verdict when the slice misses its boundary phase markers', () => {
    const verdict = classifyColumnSortDiagnosis(
      baseInput({
        slice: { ...completeSlice(), phaseStartSeen: false },
        clickAttempts: [
          attempt({
            landed: false,
            roots: [
              root({ ownsBase: false, connected: false }),
              root({ selectedByGlobalProxy: false, ownsBase: true, headerPresent: true }),
            ],
          }),
        ],
      }),
    );
    expect(verdict.verdict).toBe('open');
  });

  it('refuses every verdict when the failing-test slice is missing', () => {
    const verdict = classifyColumnSortDiagnosis(
      baseInput({ slice: null, clickAttempts: [wrongRootAttempt()] }),
    );
    expect(verdict.verdict).toBe('open');
    expect(verdict.reason).toContain('slice missing');
  });

  it('refuses every verdict when the slice records a collector failure', () => {
    const verdict = classifyColumnSortDiagnosis(
      baseInput({
        slice: { ...completeSlice(), collectorFailure: true },
        clickAttempts: [wrongRootAttempt()],
      }),
    );
    expect(verdict.verdict).toBe('open');
    expect(verdict.reason).toContain('collector failure');
  });

  it('refuses every verdict when the terminal phase marker is missing', () => {
    const verdict = classifyColumnSortDiagnosis(
      baseInput({
        slice: { ...completeSlice(), terminalSeen: false },
        clickAttempts: [wrongRootAttempt()],
      }),
    );
    expect(verdict.verdict).toBe('open');
    expect(verdict.reason).toContain('phase markers');
  });

  it('refuses every verdict when the readiness-passed marker is missing', () => {
    const verdict = classifyColumnSortDiagnosis(
      baseInput({
        slice: { ...completeSlice(), readinessPassedSeen: false },
        clickAttempts: [wrongRootAttempt()],
      }),
    );
    expect(verdict.verdict).toBe('open');
    expect(verdict.reason).toContain('readiness');
  });

  it('lets the earliest absent click own the verdict over a row contradiction that alone would be row loss', () => {
    const verdict = classifyColumnSortDiagnosis(
      baseInput({
        clickAttempts: [wrongRootAttempt()],
        rowContradiction: {
          rowAbsentFromSampledRoot: true,
          rowPresentInOwningRoot: false,
          productTransitionRecorded: true,
        },
      }),
    );
    expect(verdict.verdict).toBe('class-b-wrong-root');
    expect(verdict.causalAttemptOrdinal).toBe(1);
  });

  it('reaches a verdict from in-slice facts alone; ring overflow outside the slice is not an input', () => {
    const verdict = classifyColumnSortDiagnosis(
      baseInput({
        clickAttempts: [attempt({ landed: false, roots: [root({ headerPresent: false })] })],
        domRemovalObserved: true,
      }),
    );
    expect(verdict.verdict).toBe('class-d-header-drop');
  });

  it('classifies class (b) wrong-root when the sampled root is stale and a live owner holds the header (AE1)', () => {
    const verdict = classifyColumnSortDiagnosis(
      baseInput({
        clickAttempts: [
          attempt({
            landed: false,
            roots: [
              root({ ownsBase: false, connected: false, headerPresent: false }),
              root({ selectedByGlobalProxy: false, ownsBase: true, headerPresent: true }),
            ],
          }),
        ],
      }),
    );
    expect(verdict.verdict).toBe('class-b-wrong-root');
    expect(verdict.causalAttemptOrdinal).toBe(1);
  });

  it('stays open for the same census without the owning-root observation (AE1)', () => {
    const verdict = classifyColumnSortDiagnosis(
      baseInput({
        clickAttempts: [
          attempt({
            landed: false,
            roots: [root({ ownsBase: false, connected: false, headerPresent: false })],
          }),
        ],
      }),
    );
    expect(verdict.verdict).toBe('open');
  });

  it('classifies class (d) header drop only when removal was observed (AE2)', () => {
    const observed = classifyColumnSortDiagnosis(
      baseInput({
        clickAttempts: [attempt({ landed: false, roots: [root({ headerPresent: false })] })],
        domRemovalObserved: true,
      }),
    );
    expect(observed.verdict).toBe('class-d-header-drop');

    const unobserved = classifyColumnSortDiagnosis(
      baseInput({
        clickAttempts: [attempt({ landed: false, roots: [root({ headerPresent: false })] })],
        domRemovalObserved: null,
      }),
    );
    expect(unobserved.verdict).toBe('open');
  });

  it('classifies mixed absent-then-landed attempts by the earliest causal attempt', () => {
    const verdict = classifyColumnSortDiagnosis(
      baseInput({
        clickAttempts: [
          attempt({
            attemptOrdinal: 1,
            sequence: 5,
            landed: false,
            roots: [
              root({ ownsBase: false, connected: false, headerPresent: false }),
              root({ selectedByGlobalProxy: false, ownsBase: true, headerPresent: true }),
            ],
          }),
          attempt({ attemptOrdinal: 2, sequence: 9, landed: true }),
        ],
      }),
    );
    expect(verdict.verdict).toBe('class-b-wrong-root');
    expect(verdict.causalAttemptOrdinal).toBe(1);
  });

  it('routes a landed-clicks row contradiction to wrong-root when the owning root holds the row (AE3)', () => {
    const verdict = classifyColumnSortDiagnosis(
      baseInput({
        rowContradiction: {
          rowAbsentFromSampledRoot: true,
          rowPresentInOwningRoot: true,
          productTransitionRecorded: null,
        },
      }),
    );
    expect(verdict.verdict).toBe('class-b-wrong-root');
  });

  it('routes a landed-clicks row loss with a recorded product transition to class (d) (AE4)', () => {
    const verdict = classifyColumnSortDiagnosis(
      baseInput({
        rowContradiction: {
          rowAbsentFromSampledRoot: true,
          rowPresentInOwningRoot: false,
          productTransitionRecorded: true,
        },
      }),
    );
    expect(verdict.verdict).toBe('class-d-row-loss');
  });

  it('refuses row loss when owning-root presence is unknown, even with a recorded transition', () => {
    const verdict = classifyColumnSortDiagnosis(
      baseInput({
        rowContradiction: {
          rowAbsentFromSampledRoot: true,
          rowPresentInOwningRoot: null,
          productTransitionRecorded: true,
        },
      }),
    );
    expect(verdict.verdict).toBe('open');
    expect(verdict.reason).toContain('owner presence unknown');
  });

  it('accepts a later sorted order-tick as sort-delivery proof when click-time aria is unchanged', () => {
    const verdict = classifyColumnSortDiagnosis(
      baseInput({
        clickAttempts: [attempt({ ariaSortBefore: 'none', ariaSortAfter: 'none' })],
        sortStateObservedAfterClicks: true,
        rowContradiction: {
          rowAbsentFromSampledRoot: true,
          rowPresentInOwningRoot: false,
          productTransitionRecorded: true,
        },
      }),
    );
    expect(verdict.verdict).toBe('class-d-row-loss');
  });

  it('refuses row loss when no landed click shows an observed aria-sort change', () => {
    const verdict = classifyColumnSortDiagnosis(
      baseInput({
        clickAttempts: [attempt({ ariaSortBefore: 'ascending', ariaSortAfter: 'ascending' })],
        rowContradiction: {
          rowAbsentFromSampledRoot: true,
          rowPresentInOwningRoot: false,
          productTransitionRecorded: true,
        },
      }),
    );
    expect(verdict.verdict).toBe('open');
    expect(verdict.reason).toContain('sort delivery unproven');
  });

  it('refuses a header-drop verdict when the sole owning root is not live and visible', () => {
    const verdict = classifyColumnSortDiagnosis(
      baseInput({
        clickAttempts: [
          attempt({ landed: false, roots: [root({ visible: false, headerPresent: false })] }),
        ],
        domRemovalObserved: true,
      }),
    );
    expect(verdict.verdict).toBe('open');
  });

  it('refuses a class verdict without a matched control (AE1/AE2)', () => {
    const verdict = classifyColumnSortDiagnosis(
      baseInput({
        matchedControl: false,
        clickAttempts: [
          attempt({
            landed: false,
            roots: [
              root({ ownsBase: false, connected: false, headerPresent: false }),
              root({ selectedByGlobalProxy: false, ownsBase: true, headerPresent: true }),
            ],
          }),
        ],
      }),
    );
    expect(verdict.verdict).toBe('open');
    expect(verdict.reason).toContain('control');
  });

  it('classifies disagreeing comparable traces as open-conflicting (AE6)', () => {
    const verdict = classifyColumnSortDiagnosis(
      baseInput({
        comparableTraceDisagrees: true,
        clickAttempts: [
          attempt({
            landed: false,
            roots: [
              root({ ownsBase: false, connected: false, headerPresent: false }),
              root({ selectedByGlobalProxy: false, ownsBase: true, headerPresent: true }),
            ],
          }),
        ],
      }),
    );
    expect(verdict.verdict).toBe('open-conflicting');
  });

  it('stays open when no contradiction is located anywhere in the trace', () => {
    const verdict = classifyColumnSortDiagnosis(baseInput());
    expect(verdict.verdict).toBe('open');
  });
});

describe('scalar-fact discipline', () => {
  it('bounds list-shaped facts to the fact limit', () => {
    const long = Array.from({ length: 200 }, (_, i) => `note.due-and-more-${i}`);
    const fact = boundedFact(long);
    expect(fact.length).toBeLessThanOrEqual(COLUMN_SORT_BOUNDED_FACT_LIMIT);
    expect(fact).toContain('note.due-and-more-0');
  });

  it('never sets collectorFailure when recording bounded probe facts', () => {
    const collector = createGanttLifecycleCollector(16);
    const attempts = [
      attempt(),
      attempt({ landed: false, roots: [root({ headerPresent: false })] }),
    ];
    for (const clickAttempt of attempts) {
      collector.record({
        scope: 'column-sort',
        mountToken: 1,
        controllerStarted: null,
        controllerDelivered: null,
        svarGeneration: null,
        event: 'colsort-click-attempt',
        facts: {
          callSite: clickAttempt.callSite,
          attemptOrdinal: clickAttempt.attemptOrdinal,
          landed: clickAttempt.landed,
          ariaSortBefore: clickAttempt.ariaSortBefore,
          ariaSortAfter: clickAttempt.ariaSortAfter,
          rootCensus: boundedFact(
            clickAttempt.roots.map(
              (r) => `${r.mountToken}:${r.ownsBase}:${r.headerPresent}:${r.connected}`,
            ),
          ),
        },
      });
    }
    const snapshot = collector.snapshot();
    expect(snapshot.incomplete.collectorFailure).toBe(false);
    expect(snapshot.records).toHaveLength(2);
  });
});

describe('createColumnSortEnvelopeGate', () => {
  it('emits once per error identity and caps total envelopes', () => {
    const gate = createColumnSortEnvelopeGate(3);
    const a = new Error('a');
    const b = new Error('b');
    expect(gate.shouldEmit(a)).toBe(true);
    expect(gate.shouldEmit(a)).toBe(false);
    expect(gate.shouldEmit(b)).toBe(true);
    expect(gate.shouldEmit(new Error('c'))).toBe(true);
    expect(gate.shouldEmit(new Error('d'))).toBe(false);
  });
});

describe('estimateWorstCaseRecordBudget', () => {
  it('fits the collector capacity with at least 25% headroom', () => {
    const budget = estimateWorstCaseRecordBudget();
    expect(budget.capacity).toBe(COLUMN_SORT_LIFECYCLE_CAPACITY);
    expect(budget.total).toBeLessThanOrEqual(COLUMN_SORT_LIFECYCLE_CAPACITY * 0.75);
    expect(budget.survivingBoundaries.length).toBeGreaterThan(0);
  });
});

function completeIdentity(): ColumnSortControlIdentity {
  return {
    buildSha: 'a'.repeat(40),
    specSchema: 'column-sort-diagnosis/v1',
    chromiumVersion: '1.12.7',
    taskNotesVersion: '4.11.0',
    platform: 'win32',
    nodeVersion: 'v20.0.0',
    obsidianVersion: '1.9.14',
    electronVersion: '37.2.4',
  };
}

describe('buildColumnSortControlDigest', () => {
  it('carries the control-identity stamp and per-site click summaries the matching rules consume', () => {
    const digest = buildColumnSortControlDigest({
      identity: completeIdentity(),
      attempts: [attempt(), attempt({ callSite: 'ae2-clear-click', landed: true })],
      armed: true,
      overflow: false,
      collectorFailure: false,
      basePath: 'Companion.base',
      readinessGates: 7,
    });
    expect(digest.identity.buildSha).toBe('a'.repeat(40));
    expect(digest.identity.obsidianVersion).toBe('1.9.14');
    expect(digest.identity.electronVersion).toBe('37.2.4');
    expect(digest.perSite).toEqual([
      { callSite: 'ae1-sort-loop', attempts: 1, allLanded: true },
      { callSite: 'ae2-clear-click', attempts: 1, allLanded: true },
    ]);
    expect(digest.armed).toBe(true);
    expect(digest.basePath).toBe('Companion.base');
    expect(digest.readinessGates).toBe(7);
    expect(digest.journey).toBe('ae1-sort-loop|ae2-clear-click');
  });
});

describe('areColumnSortControlsEquivalent', () => {
  function digest(overrides: Partial<Parameters<typeof buildColumnSortControlDigest>[0]> = {}) {
    return buildColumnSortControlDigest({
      identity: completeIdentity(),
      attempts: [attempt()],
      armed: true,
      overflow: false,
      collectorFailure: false,
      basePath: 'Companion.base',
      readinessGates: 7,
      ...overrides,
    });
  }

  it('accepts two digests with identical complete identity, base, journey, and gate count', () => {
    expect(areColumnSortControlsEquivalent(digest(), digest())).toBe(true);
  });

  it('rejects a pair when any identity field differs', () => {
    const other = digest({ identity: { ...completeIdentity(), electronVersion: '37.2.5' } });
    expect(areColumnSortControlsEquivalent(digest(), other)).toBe(false);
  });

  it('rejects a pair when either identity is incomplete', () => {
    const incomplete = digest({ identity: { ...completeIdentity(), buildSha: null } });
    expect(areColumnSortControlsEquivalent(digest(), incomplete)).toBe(false);
  });

  it('rejects a pair whose click-site journeys differ', () => {
    const other = digest({ attempts: [attempt({ callSite: 'ae2-sort-loop' })] });
    expect(areColumnSortControlsEquivalent(digest(), other)).toBe(false);
  });

  it('rejects a pair whose Base path or readiness-gate count differs', () => {
    expect(areColumnSortControlsEquivalent(digest(), digest({ basePath: 'Other.base' }))).toBe(false);
    expect(areColumnSortControlsEquivalent(digest(), digest({ readinessGates: 8 }))).toBe(false);
  });

  it('rejects a pair when either side ran unarmed or with a collector failure', () => {
    expect(areColumnSortControlsEquivalent(digest(), digest({ armed: false }))).toBe(false);
    expect(areColumnSortControlsEquivalent(digest(), digest({ collectorFailure: true }))).toBe(false);
  });

  it('rejects a pair when either side overflowed', () => {
    expect(areColumnSortControlsEquivalent(digest(), digest({ overflow: true }))).toBe(false);
  });

  it('rejects a pair whose per-site click summaries diverge', () => {
    const retried = digest({ attempts: [attempt(), attempt({ landed: false })] });
    expect(areColumnSortControlsEquivalent(digest(), retried)).toBe(false);
  });
});

describe('isColumnSortControlIdentityComplete', () => {
  it('accepts an identity with every runtime-fingerprint field present', () => {
    expect(isColumnSortControlIdentityComplete(completeIdentity())).toBe(true);
  });

  it('rejects an identity when any runtime-fingerprint field is null', () => {
    const fingerprintFields = [
      'buildSha',
      'chromiumVersion',
      'taskNotesVersion',
      'obsidianVersion',
      'electronVersion',
    ] as const;
    for (const field of fingerprintFields) {
      const identity = completeIdentity();
      identity[field] = null;
      expect(isColumnSortControlIdentityComplete(identity)).toBe(false);
    }
  });
});
