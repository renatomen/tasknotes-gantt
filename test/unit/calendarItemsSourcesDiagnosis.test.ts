import {
  analyzeCalendarItemsSourcesOwnership,
  buildCalendarItemsSourcesSnapshot,
  classifyCalendarItemsSourcesDiagnosis,
  invalidateCalendarItemsSourcesReadinessEvidence,
  recordCalendarItemsSourcesReadinessEvidence,
  sealCalendarItemsSourcesReadinessEvidence,
  selectCalendarItemsSourcesTerminalBoundary,
  shouldCaptureCalendarItemsSourcesReadinessBoundary,
  startCalendarItemsSourcesReadinessEvidence,
  type CalendarItemsSourcesSnapshot,
  type SourcesDiagnosisDisqualifiers,
  type SourcesMatchedControl,
} from '../specs/helpers/calendarItemsSourcesDiagnosis';

const complete = {
  sameCheckpointObservation: true,
  orderedPhases: true,
  targetFileAndCache: true,
  taskNotesFacts: true,
  liveBaseResult: true,
  rootCensus: true,
  ownerDomMembership: true,
  configActions: true,
  terminalEvidence: true,
  boundarySides: true,
  correlationKeys: true,
};

const equality = {
  basePath: true,
  orderedJourney: true,
  configHistory: true,
  targetIdentity: true,
  terminalPrerequisites: true,
};

const noDisqualifiers: SourcesDiagnosisDisqualifiers = {
  genericApiReadyOnly: false,
  missingPrerequisiteEvent: false,
  divergentConfigHistory: false,
  missingPostTransitionControl: false,
  unknownOwner: false,
  disconnectedAuthoritativeRoot: false,
  crossMountJoin: false,
  authoritativeTargetAbsent: false,
  missingBoundarySide: false,
  missingCorrelationKey: false,
  pendingWork: false,
  supersededWork: false,
  legitimateInvalidator: false,
  remount: false,
  filtered: false,
  reseeded: false,
  overflow: false,
  collectorFailure: false,
  diagnosticRetrievalFailure: false,
  unmatchedControl: false,
};

function wrongOwnerSnapshot(): CalendarItemsSourcesSnapshot {
  return buildCalendarItemsSourcesSnapshot({
    phase: 'terminal-failure',
    checkpoint: 'second-before-each',
    sequence: 12,
    target: {
      path: 'Standup 2026-03-23.md',
      fileExists: true,
      cacheEntryExists: true,
      taskNotesOccurrenceListed: true,
      recurrenceParentPresent: true,
      occurrenceDateMatches: true,
      liveBaseHostPresent: true,
      liveBaseTargetPresent: true,
    },
    roots: [
      {
        rootId: 'proxy',
        mountToken: 1,
        ownerLeafId: 'base-leaf-other',
        selectedByGlobalProxy: true,
        connected: true,
        visible: true,
        ownsBase: false,
        ownerDomMember: true,
        ownerLiveBaseHostPresent: true,
        ownerLiveBaseTargetPresent: false,
        targetPresent: false,
      },
      {
        rootId: 'owner',
        mountToken: 2,
        ownerLeafId: 'base-leaf-current',
        selectedByGlobalProxy: false,
        connected: true,
        visible: true,
        ownsBase: true,
        ownerDomMember: true,
        ownerLiveBaseHostPresent: true,
        ownerLiveBaseTargetPresent: true,
        targetPresent: true,
      },
    ],
    sameCheckpointObservation: true,
    initialReadinessCaptured: true,
    actionHistoryMatches: true,
    overflow: false,
    collectorFailure: false,
  });
}

function matchedControl(snapshot: CalendarItemsSourcesSnapshot): SourcesMatchedControl {
  if (snapshot.matchedControl === null) throw new Error('Expected a matched control fixture');
  return snapshot.matchedControl;
}

describe('classifyCalendarItemsSourcesDiagnosis', () => {
  it('classifies a capture-realizable simultaneous owning root as a wrong-owner proxy', () => {
    expect(classifyCalendarItemsSourcesDiagnosis(wrongOwnerSnapshot())).toEqual({
      status: 'class-b',
      cause: 'wrong-owner-proxy',
    });
  });

  it('keeps pending readiness open without a distinct matched execution', () => {
    const fixture = wrongOwnerSnapshot();
    const snapshot = buildCalendarItemsSourcesSnapshot({
      phase: 'terminal-failure',
      checkpoint: 'pending-prerequisite',
      sequence: 13,
      target: {
        ...fixture.target,
        taskNotesOccurrenceListed: false,
        recurrenceParentPresent: false,
        occurrenceDateMatches: false,
        liveBaseTargetPresent: false,
      },
      roots: fixture.roots,
      sameCheckpointObservation: true,
      initialReadinessCaptured: true,
      actionHistoryMatches: true,
      overflow: false,
      collectorFailure: false,
    });

    expect(snapshot.prerequisite.state).toBe('pending');
    expect(classifyCalendarItemsSourcesDiagnosis(snapshot)).toEqual({ status: 'open' });
  });

  it('derives a simultaneous control from the authoritative owner before classifying the proxy', () => {
    const fixture = wrongOwnerSnapshot();
    const owner = { ...fixture.roots[1], selectedByGlobalProxy: true };
    const snapshot = buildCalendarItemsSourcesSnapshot({
      phase: 'terminal-failure',
      checkpoint: 'authoritative-control',
      sequence: 14,
      target: fixture.target,
      roots: [owner],
      sameCheckpointObservation: true,
      initialReadinessCaptured: true,
      actionHistoryMatches: true,
      overflow: false,
      collectorFailure: false,
    });

    expect(snapshot.matchedControl).toEqual(expect.objectContaining({
      kind: 'simultaneous-owner',
      available: true,
      equality,
    }));
    expect(classifyCalendarItemsSourcesDiagnosis(snapshot)).toEqual({ status: 'open' });
  });

  it('refuses a wrong-owner verdict from a post-failure resample', () => {
    const fixture = wrongOwnerSnapshot();
    const snapshot = buildCalendarItemsSourcesSnapshot({
      phase: 'terminal-failure',
      checkpoint: 'post-failure-resample',
      sequence: 15,
      target: fixture.target,
      roots: fixture.roots,
      sameCheckpointObservation: false,
      initialReadinessCaptured: true,
      actionHistoryMatches: true,
      overflow: false,
      collectorFailure: false,
    });

    expect(snapshot.disqualifiers.missingBoundarySide).toBe(true);
    expect(classifyCalendarItemsSourcesDiagnosis(snapshot)).toEqual({ status: 'open' });
  });

  it('keeps a green suite-after snapshot ineligible for a causal verdict', () => {
    const fixture = wrongOwnerSnapshot();
    const snapshot = buildCalendarItemsSourcesSnapshot({
      phase: 'suite-after',
      checkpoint: 'suite-after',
      sequence: 16,
      target: fixture.target,
      roots: fixture.roots,
      sameCheckpointObservation: true,
      initialReadinessCaptured: true,
      actionHistoryMatches: true,
      overflow: false,
      collectorFailure: false,
    });

    expect(snapshot.completeness.terminalEvidence).toBe(false);
    expect(classifyCalendarItemsSourcesDiagnosis(snapshot)).toEqual({ status: 'open' });
  });

  it('marks an empty root census and missing live Base host incomplete', () => {
    const fixture = wrongOwnerSnapshot();
    const snapshot = buildCalendarItemsSourcesSnapshot({
      phase: 'terminal-failure',
      checkpoint: 'missing-host',
      sequence: 17,
      target: {
        ...fixture.target,
        liveBaseHostPresent: false,
        liveBaseTargetPresent: false,
      },
      roots: [],
      sameCheckpointObservation: true,
      initialReadinessCaptured: true,
      actionHistoryMatches: true,
      overflow: false,
      collectorFailure: false,
    });

    expect(snapshot.completeness.liveBaseResult).toBe(false);
    expect(snapshot.completeness.rootCensus).toBe(false);
  });

  it('promotes only the matching failing readiness poll to terminal evidence', () => {
    const fixture = wrongOwnerSnapshot();
    const savedBoundary = {
      phase: 'before-each' as const,
      checkpoint: 'before-each-2',
      sequence: 15,
      target: fixture.target,
      roots: fixture.roots,
      sameCheckpointObservation: true,
      initialReadinessCaptured: true,
      actionHistoryMatches: true,
      overflow: false,
      collectorFailure: false,
    };
    const resampledBoundary = {
      ...savedBoundary,
      phase: 'terminal-failure' as const,
      checkpoint: 'post-failure-resample',
      sameCheckpointObservation: false,
    };

    expect(selectCalendarItemsSourcesTerminalBoundary(
      'beforeEach:before-each-2',
      savedBoundary,
      resampledBoundary,
      true,
    )).toEqual(expect.objectContaining({
      checkpoint: 'before-each-2',
      phase: 'terminal-failure',
      sameCheckpointObservation: true,
    }));
    expect(selectCalendarItemsSourcesTerminalBoundary(
      'beforeEach:before-each-2',
      savedBoundary,
      resampledBoundary,
      false,
    )).toBe(resampledBoundary);
    expect(selectCalendarItemsSourcesTerminalBoundary(
      'test:property events',
      savedBoundary,
      resampledBoundary,
      true,
    )).toBe(resampledBoundary);
  });

  it('seals the last completed readiness poll against a post-deadline write', () => {
    const fixture = wrongOwnerSnapshot();
    const completedBoundary = {
      phase: 'before-each' as const,
      checkpoint: 'completed-poll',
      sequence: 18,
      target: fixture.target,
      roots: fixture.roots,
      sameCheckpointObservation: true,
      initialReadinessCaptured: true,
      actionHistoryMatches: true,
      overflow: false,
      collectorFailure: false,
    };
    const lateBoundary = { ...completedBoundary, checkpoint: 'late-poll', sequence: 19 };
    const open = startCalendarItemsSourcesReadinessEvidence();
    const completed = recordCalendarItemsSourcesReadinessEvidence(
      open,
      completedBoundary,
      ['Standup 2026-03-23.md'],
    );
    const sealed = sealCalendarItemsSourcesReadinessEvidence(completed);

    expect(recordCalendarItemsSourcesReadinessEvidence(
      sealed,
      lateBoundary,
      ['Standup 2026-03-23.md'],
    )).toBe(sealed);
    expect(sealed.boundary).toBe(completedBoundary);
    expect(sealed.pollFailed).toBe(true);
    expect(invalidateCalendarItemsSourcesReadinessEvidence(sealed)).toBe(sealed);
  });

  it('drops an earlier capture when a later readiness poll completes without a census', () => {
    const fixture = wrongOwnerSnapshot();
    const boundary = {
      phase: 'before-each' as const,
      checkpoint: 'second-before-each',
      sequence: 20,
      target: fixture.target,
      roots: fixture.roots,
      sameCheckpointObservation: true,
      initialReadinessCaptured: true,
      actionHistoryMatches: true,
      overflow: false,
      collectorFailure: false,
    };
    const captured = recordCalendarItemsSourcesReadinessEvidence(
      startCalendarItemsSourcesReadinessEvidence(),
      boundary,
      ['Standup 2026-03-23.md'],
    );

    expect(invalidateCalendarItemsSourcesReadinessEvidence(captured)).toEqual({
      open: true,
      boundary: null,
      pollFailed: false,
    });
  });

  it('captures readiness boundaries only after a missing-bar observation and at the throttle edge', () => {
    expect(shouldCaptureCalendarItemsSourcesReadinessBoundary([], 10_000, null, 5_000)).toBe(false);
    expect(shouldCaptureCalendarItemsSourcesReadinessBoundary(
      ['Standup 2026-03-23.md'],
      10_000,
      null,
      5_000,
    )).toBe(true);
    expect(shouldCaptureCalendarItemsSourcesReadinessBoundary(
      ['Standup 2026-03-23.md'],
      14_999,
      10_000,
      5_000,
    )).toBe(false);
    expect(shouldCaptureCalendarItemsSourcesReadinessBoundary(
      ['Standup 2026-03-23.md'],
      15_000,
      10_000,
      5_000,
    )).toBe(true);
  });

  it.each(Object.keys(complete) as Array<keyof typeof complete>)(
    'refuses a verdict when completeness fact %s is missing',
    (fact) => {
      const snapshot = wrongOwnerSnapshot();
      snapshot.completeness = { ...snapshot.completeness, [fact]: false };

      expect(classifyCalendarItemsSourcesDiagnosis(snapshot)).toEqual({ status: 'open' });
    },
  );

  it.each(Object.keys(noDisqualifiers) as Array<keyof SourcesDiagnosisDisqualifiers>)(
    'refuses a verdict when %s is present',
    (fact) => {
      const snapshot = wrongOwnerSnapshot();
      snapshot.disqualifiers = { ...snapshot.disqualifiers, [fact]: true };

      expect(classifyCalendarItemsSourcesDiagnosis(snapshot)).toEqual({ status: 'open' });
    },
  );

  it('refuses an unmatched control even when the availability flag is inconsistent', () => {
    const snapshot = wrongOwnerSnapshot();
    snapshot.matchedControl = { ...matchedControl(snapshot), available: false };

    expect(classifyCalendarItemsSourcesDiagnosis(snapshot)).toEqual({ status: 'open' });
  });

  it('refuses a cross-mount owner proxy observation', () => {
    const snapshot = wrongOwnerSnapshot();
    snapshot.disqualifiers = { ...snapshot.disqualifiers, crossMountJoin: true };

    expect(classifyCalendarItemsSourcesDiagnosis(snapshot)).toEqual({ status: 'open' });
  });

  it('refuses a wrong-owner verdict while one leaf has concurrent mount tokens', () => {
    const fixture = wrongOwnerSnapshot();
    const snapshot = buildCalendarItemsSourcesSnapshot({
      phase: 'terminal-failure',
      checkpoint: 'remount-in-flight',
      sequence: 20,
      target: fixture.target,
      roots: fixture.roots.map((root) => ({
        ...root,
        ownerLeafId: 'base-leaf-current',
        ownsBase: true,
        ownerDomMember: true,
        connected: true,
      })),
      sameCheckpointObservation: true,
      initialReadinessCaptured: true,
      actionHistoryMatches: true,
      overflow: false,
      collectorFailure: false,
    });

    expect(snapshot.disqualifiers.remount).toBe(true);
    expect(classifyCalendarItemsSourcesDiagnosis(snapshot)).toEqual({ status: 'open' });
  });

  it('keeps a stale target-bearing root beside a different current live root open', () => {
    const roots = wrongOwnerSnapshot().roots;
    roots[0] = {
      ...roots[0],
      connected: true,
      visible: true,
      ownerDomMember: true,
      targetPresent: true,
    };
    roots[1] = {
      ...roots[1],
      ownerLiveBaseTargetPresent: false,
      targetPresent: false,
    };

    const ownership = analyzeCalendarItemsSourcesOwnership(roots, false);

    expect(ownership).toEqual(expect.objectContaining({
      authoritativeRoot: expect.objectContaining({ rootId: 'owner' }),
      authoritativeTargetAbsent: true,
      wrongOwnerObserved: false,
    }));
  });

  it('fails closed when boundary production would join a stale target to a different live owner', () => {
    const fixture = wrongOwnerSnapshot();
    fixture.roots[0] = {
      ...fixture.roots[0],
      connected: true,
      visible: true,
      ownerDomMember: true,
      targetPresent: true,
    };
    fixture.roots[1] = {
      ...fixture.roots[1],
      ownerLiveBaseTargetPresent: false,
      targetPresent: false,
    };

    const snapshot = buildCalendarItemsSourcesSnapshot({
      phase: 'terminal-failure',
      checkpoint: 'multi-leaf-correlation',
      sequence: 18,
      target: fixture.target,
      roots: fixture.roots,
      sameCheckpointObservation: true,
      initialReadinessCaptured: true,
      actionHistoryMatches: true,
      overflow: false,
      collectorFailure: false,
    });

    expect(snapshot.disqualifiers).toEqual(expect.objectContaining({
      crossMountJoin: true,
      authoritativeTargetAbsent: true,
    }));
    expect(snapshot.matchedControl).toEqual(expect.objectContaining({
      equality: expect.objectContaining({ targetIdentity: false }),
    }));
    expect(snapshot.disqualifiers.unmatchedControl).toBe(true);
    expect(classifyCalendarItemsSourcesDiagnosis(snapshot)).toEqual({ status: 'open' });
  });

  it('refuses a pending or superseded product work state', () => {
    for (const workState of ['pending', 'superseded'] as const) {
      const snapshot = wrongOwnerSnapshot();
      snapshot.workState = workState;
      expect(classifyCalendarItemsSourcesDiagnosis(snapshot)).toEqual({ status: 'open' });
    }
  });

  it('refuses control equality with any mismatched dimension', () => {
    const snapshot = wrongOwnerSnapshot();
    const control = matchedControl(snapshot);
    snapshot.matchedControl = {
      ...control,
      equality: { ...control.equality, configHistory: false },
    };

    expect(classifyCalendarItemsSourcesDiagnosis(snapshot)).toEqual({ status: 'open' });
  });
});
