import {
  analyzeCalendarItemsSourcesOwnership,
  buildCalendarItemsSourcesSnapshot,
  classifyCalendarItemsSourcesDiagnosis,
  type CalendarItemsSourcesSnapshot,
  type SourcesDiagnosisDisqualifiers,
  type SourcesMatchedControl,
} from '../specs/helpers/calendarItemsSourcesDiagnosis';

const complete = {
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
  buildSha: true,
  fixtureVersion: true,
  pluginVersions: true,
  basePath: true,
  orderedJourney: true,
  configHistory: true,
  targetIdentity: true,
  traceSchema: true,
  boundaryInputs: true,
  phase: true,
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
  return {
    schema: 'calendar-items-sources/v1',
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
        ownerLeafId: 'base-leaf-stale',
        selectedByGlobalProxy: true,
        connected: false,
        visible: false,
        ownsBase: false,
        ownerDomMember: false,
        ownerLiveBaseHostPresent: true,
        ownerLiveBaseTargetPresent: true,
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
    prerequisite: { name: 'tasknotes-concrete-occurrence', state: 'terminal' },
    workState: 'settled',
    completeness: complete,
    disqualifiers: noDisqualifiers,
    matchedControl: {
      kind: 'simultaneous-owner',
      available: true,
      equality,
      targetBeforePrerequisite: true,
      targetAfterPrerequisite: true,
    },
  };
}

function matchedControl(snapshot: CalendarItemsSourcesSnapshot): SourcesMatchedControl {
  if (snapshot.matchedControl === null) throw new Error('Expected a matched control fixture');
  return snapshot.matchedControl;
}

describe('classifyCalendarItemsSourcesDiagnosis', () => {
  it('classifies only a complete simultaneous owning root as a wrong-owner proxy', () => {
    expect(classifyCalendarItemsSourcesDiagnosis(wrongOwnerSnapshot())).toEqual({
      status: 'class-b',
      cause: 'wrong-owner-proxy',
    });
  });

  it('classifies weak readiness only with a named transition and positive matched control', () => {
    const snapshot = wrongOwnerSnapshot();
    snapshot.prerequisite = { name: 'tasknotes-concrete-occurrence', state: 'pending' };
    snapshot.roots = [
      {
        rootId: 'owner',
        mountToken: 2,
        ownerLeafId: 'base-leaf-current',
        selectedByGlobalProxy: true,
        connected: true,
        visible: true,
        ownsBase: true,
        ownerDomMember: true,
        ownerLiveBaseHostPresent: true,
        ownerLiveBaseTargetPresent: false,
        targetPresent: false,
      },
    ];
    snapshot.matchedControl = {
      ...matchedControl(snapshot),
      kind: 'distinct-execution',
      targetBeforePrerequisite: false,
      targetAfterPrerequisite: true,
    };

    expect(classifyCalendarItemsSourcesDiagnosis(snapshot)).toEqual({
      status: 'class-b',
      cause: 'weak-readiness',
    });
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
      initialReadinessCaptured: true,
      actionHistoryMatches: true,
      overflow: false,
      collectorFailure: false,
    });

    expect(snapshot.disqualifiers).toEqual(expect.objectContaining({
      crossMountJoin: true,
      authoritativeTargetAbsent: true,
    }));
    expect(snapshot.matchedControl).toBeNull();
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
