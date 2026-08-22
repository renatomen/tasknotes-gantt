export const CALENDAR_ITEMS_SOURCES_TRACE_SCHEMA = 'calendar-items-sources/v1' as const;

export type CalendarItemsSourcesPhase =
  | 'suite-before'
  | 'initial-readiness'
  | 'before-each'
  | 'config-action-start'
  | 'config-action-observed'
  | 'terminal-failure'
  | 'suite-after'
  | 'teardown';

export interface CalendarItemsSourcesTargetFacts {
  path: string;
  fileExists: boolean | null;
  cacheEntryExists: boolean | null;
  taskNotesOccurrenceListed: boolean | null;
  recurrenceParentPresent: boolean | null;
  occurrenceDateMatches: boolean | null;
  liveBaseHostPresent: boolean | null;
  liveBaseTargetPresent: boolean | null;
}

export interface CalendarItemsSourcesRootFacts {
  rootId: string;
  mountToken: number | null;
  ownerLeafId: string | null;
  selectedByGlobalProxy: boolean;
  connected: boolean;
  visible: boolean;
  ownsBase: boolean | null;
  ownerDomMember: boolean | null;
  ownerLiveBaseHostPresent: boolean | null;
  ownerLiveBaseTargetPresent: boolean | null;
  targetPresent: boolean;
}

export interface SourcesOwnershipAnalysis {
  authoritativeRoot: CalendarItemsSourcesRootFacts | null;
  proxyRoot: CalendarItemsSourcesRootFacts | null;
  ambiguousOwner: boolean;
  crossMountJoin: boolean;
  authoritativeTargetAbsent: boolean;
  wrongOwnerObserved: boolean;
}

export function analyzeCalendarItemsSourcesOwnership(
  roots: CalendarItemsSourcesRootFacts[],
  liveBaseTargetPresent: boolean | null,
): SourcesOwnershipAnalysis {
  const eligibleOwners = roots.filter(({ connected, visible, ownsBase, ownerDomMember, ownerLeafId,
    ownerLiveBaseHostPresent }) =>
    connected
    && visible
    && ownsBase === true
    && ownerDomMember === true
    && ownerLeafId !== null
    && ownerLiveBaseHostPresent === true);
  const authoritativeRoot = eligibleOwners.length === 1 ? eligibleOwners[0] : null;
  const proxyRoots = roots.filter(({ selectedByGlobalProxy }) => selectedByGlobalProxy);
  const proxyRoot = proxyRoots.length === 1 ? proxyRoots[0] : null;
  const ambiguousOwner = eligibleOwners.length !== 1 || proxyRoots.length !== 1;
  const authoritativeTargetAbsent = authoritativeRoot !== null
    && (authoritativeRoot.targetPresent !== true
      || authoritativeRoot.ownerLiveBaseTargetPresent !== true);
  const crossMountJoin = authoritativeRoot !== null
    && liveBaseTargetPresent === true
    && authoritativeRoot.ownerLiveBaseTargetPresent !== true;
  const proxyContradictsOwner = proxyRoot !== null && (
    !proxyRoot.connected
    || !proxyRoot.visible
    || proxyRoot.ownsBase !== true
    || proxyRoot.ownerDomMember !== true
    || proxyRoot.ownerLeafId === null
    || proxyRoot.ownerLiveBaseHostPresent !== true
    || proxyRoot.ownerLiveBaseTargetPresent !== true
    || !proxyRoot.targetPresent
  );
  const wrongOwnerObserved = !ambiguousOwner
    && !crossMountJoin
    && !authoritativeTargetAbsent
    && proxyRoot !== null
    && authoritativeRoot !== null
    && proxyRoot.rootId !== authoritativeRoot.rootId
    && proxyContradictsOwner;

  return {
    authoritativeRoot,
    proxyRoot,
    ambiguousOwner,
    crossMountJoin,
    authoritativeTargetAbsent,
    wrongOwnerObserved,
  };
}

export interface SourcesDiagnosisCompleteness {
  sameCheckpointObservation: boolean;
  orderedPhases: boolean;
  targetFileAndCache: boolean;
  taskNotesFacts: boolean;
  liveBaseResult: boolean;
  rootCensus: boolean;
  ownerDomMembership: boolean;
  configActions: boolean;
  terminalEvidence: boolean;
  boundarySides: boolean;
  correlationKeys: boolean;
}

export interface SourcesDiagnosisDisqualifiers {
  genericApiReadyOnly: boolean;
  missingPrerequisiteEvent: boolean;
  divergentConfigHistory: boolean;
  missingPostTransitionControl: boolean;
  unknownOwner: boolean;
  disconnectedAuthoritativeRoot: boolean;
  crossMountJoin: boolean;
  authoritativeTargetAbsent: boolean;
  missingBoundarySide: boolean;
  missingCorrelationKey: boolean;
  pendingWork: boolean;
  supersededWork: boolean;
  legitimateInvalidator: boolean;
  remount: boolean;
  filtered: boolean;
  reseeded: boolean;
  overflow: boolean;
  collectorFailure: boolean;
  diagnosticRetrievalFailure: boolean;
  unmatchedControl: boolean;
}

export interface SourcesMatchedControlEquality {
  basePath: boolean;
  orderedJourney: boolean;
  configHistory: boolean;
  targetIdentity: boolean;
  terminalPrerequisites: boolean;
}

export interface SourcesMatchedControl {
  kind: 'simultaneous-owner';
  available: boolean;
  equality: SourcesMatchedControlEquality;
}

export interface CalendarItemsSourcesSnapshot {
  schema: typeof CALENDAR_ITEMS_SOURCES_TRACE_SCHEMA;
  phase: CalendarItemsSourcesPhase;
  checkpoint: string;
  sequence: number;
  target: CalendarItemsSourcesTargetFacts;
  roots: CalendarItemsSourcesRootFacts[];
  prerequisite: {
    name: string | null;
    state: 'pending' | 'terminal' | 'unknown';
  };
  workState: 'pending' | 'settled' | 'superseded' | 'unknown';
  completeness: SourcesDiagnosisCompleteness;
  disqualifiers: SourcesDiagnosisDisqualifiers;
  matchedControl: SourcesMatchedControl | null;
}

export interface CalendarItemsSourcesBoundary {
  phase: CalendarItemsSourcesPhase;
  checkpoint: string;
  sequence: number;
  target: CalendarItemsSourcesTargetFacts;
  roots: CalendarItemsSourcesRootFacts[];
  sameCheckpointObservation: boolean;
  initialReadinessCaptured: boolean;
  actionHistoryMatches: boolean;
  overflow: boolean;
  collectorFailure: boolean;
  diagnosticRetrievalFailure: boolean;
}

export interface CalendarItemsSourcesReadinessEvidence {
  open: boolean;
  boundary: CalendarItemsSourcesBoundary | null;
  pollFailed: boolean;
  missingBars: readonly string[] | null;
  diagnosticRetrievalFailure: boolean;
}

export function startCalendarItemsSourcesReadinessEvidence(): CalendarItemsSourcesReadinessEvidence {
  return {
    open: true,
    boundary: null,
    pollFailed: false,
    missingBars: null,
    diagnosticRetrievalFailure: false,
  };
}

function normalizeMissingBars(missingBars: readonly string[]): string[] {
  return [...new Set(missingBars)].sort();
}

export function recordCalendarItemsSourcesReadinessEvidence(
  evidence: CalendarItemsSourcesReadinessEvidence,
  boundary: CalendarItemsSourcesBoundary,
  missingBars: readonly string[],
): CalendarItemsSourcesReadinessEvidence {
  if (!evidence.open) return evidence;
  return {
    open: true,
    boundary,
    pollFailed: missingBars.length > 0,
    missingBars: normalizeMissingBars(missingBars),
    diagnosticRetrievalFailure: evidence.diagnosticRetrievalFailure,
  };
}

export function recordCalendarItemsSourcesReadinessRetrievalFailure(
  evidence: CalendarItemsSourcesReadinessEvidence,
): CalendarItemsSourcesReadinessEvidence {
  if (!evidence.open) return evidence;
  return {
    ...startCalendarItemsSourcesReadinessEvidence(),
    diagnosticRetrievalFailure: true,
  };
}

export function retainMatchingCalendarItemsSourcesReadinessEvidence(
  evidence: CalendarItemsSourcesReadinessEvidence,
  missingBars: readonly string[],
): CalendarItemsSourcesReadinessEvidence {
  if (!evidence.open || evidence.boundary === null || evidence.missingBars === null) return evidence;
  const observed = normalizeMissingBars(missingBars);
  const matches = observed.length === evidence.missingBars.length
    && observed.every((bar, index) => bar === evidence.missingBars?.[index]);
  return matches ? evidence : invalidateCalendarItemsSourcesReadinessEvidence(evidence);
}

export function shouldCaptureCalendarItemsSourcesReadinessBoundary(
  missingBars: readonly string[],
  now: number,
  lastCaptureAt: number | null,
  minimumInterval: number,
): boolean {
  return missingBars.length > 0
    && (lastCaptureAt === null || now - lastCaptureAt >= minimumInterval);
}

export function invalidateCalendarItemsSourcesReadinessEvidence(
  evidence: CalendarItemsSourcesReadinessEvidence,
): CalendarItemsSourcesReadinessEvidence {
  if (!evidence.open) return evidence;
  return {
    ...startCalendarItemsSourcesReadinessEvidence(),
    diagnosticRetrievalFailure: evidence.diagnosticRetrievalFailure,
  };
}

export function sealCalendarItemsSourcesReadinessEvidence(
  evidence: CalendarItemsSourcesReadinessEvidence,
): CalendarItemsSourcesReadinessEvidence {
  if (!evidence.open) return evidence;
  return { ...evidence, open: false };
}

export function selectCalendarItemsSourcesTerminalBoundary(
  origin: string,
  readinessEvidence: CalendarItemsSourcesReadinessEvidence,
  resampledBoundary: CalendarItemsSourcesBoundary,
): CalendarItemsSourcesBoundary {
  const savedBoundary = readinessEvidence.boundary;
  const promoteSavedBoundary = readinessEvidence.pollFailed
    && savedBoundary !== null
    && origin === `beforeEach:${savedBoundary.checkpoint}`
    && calendarItemsSourcesCensusesMatch(savedBoundary, resampledBoundary);
  const selectedBoundary: CalendarItemsSourcesBoundary = promoteSavedBoundary ? {
    ...savedBoundary,
    phase: 'terminal-failure',
    sameCheckpointObservation: true,
  } : resampledBoundary;
  return mergeCalendarItemsSourcesTerminalFailureFacts(
    selectedBoundary,
    resampledBoundary,
    readinessEvidence.diagnosticRetrievalFailure,
  );
}

function mergeCalendarItemsSourcesTerminalFailureFacts(
  boundary: CalendarItemsSourcesBoundary,
  terminalBoundary: CalendarItemsSourcesBoundary,
  readinessDiagnosticRetrievalFailure: boolean,
): CalendarItemsSourcesBoundary {
  const overflow = boundary.overflow || terminalBoundary.overflow;
  const collectorFailure = boundary.collectorFailure || terminalBoundary.collectorFailure;
  const diagnosticRetrievalFailure = boundary.diagnosticRetrievalFailure
    || terminalBoundary.diagnosticRetrievalFailure
    || readinessDiagnosticRetrievalFailure;
  if (overflow === boundary.overflow
      && collectorFailure === boundary.collectorFailure
      && diagnosticRetrievalFailure === boundary.diagnosticRetrievalFailure) return boundary;
  return { ...boundary, overflow, collectorFailure, diagnosticRetrievalFailure };
}

function calendarItemsSourcesCensusesMatch(
  savedBoundary: CalendarItemsSourcesBoundary,
  terminalBoundary: CalendarItemsSourcesBoundary,
): boolean {
  if (savedBoundary.target.liveBaseHostPresent !== terminalBoundary.target.liveBaseHostPresent
      || savedBoundary.target.liveBaseTargetPresent !== terminalBoundary.target.liveBaseTargetPresent
      || savedBoundary.roots.length !== terminalBoundary.roots.length) return false;
  const terminalRoots = new Map(terminalBoundary.roots.map((root) => [root.rootId, root]));
  return savedBoundary.roots.every((savedRoot) => {
    const terminalRoot = terminalRoots.get(savedRoot.rootId);
    return terminalRoot !== undefined && calendarItemsSourcesRootsMatch(savedRoot, terminalRoot);
  });
}

function calendarItemsSourcesRootsMatch(
  savedRoot: CalendarItemsSourcesRootFacts,
  terminalRoot: CalendarItemsSourcesRootFacts,
): boolean {
  return savedRoot.mountToken === terminalRoot.mountToken
    && savedRoot.ownerLeafId === terminalRoot.ownerLeafId
    && savedRoot.selectedByGlobalProxy === terminalRoot.selectedByGlobalProxy
    && savedRoot.connected === terminalRoot.connected
    && savedRoot.visible === terminalRoot.visible
    && savedRoot.ownsBase === terminalRoot.ownsBase
    && savedRoot.ownerDomMember === terminalRoot.ownerDomMember
    && savedRoot.ownerLiveBaseHostPresent === terminalRoot.ownerLiveBaseHostPresent
    && savedRoot.ownerLiveBaseTargetPresent === terminalRoot.ownerLiveBaseTargetPresent
    && savedRoot.targetPresent === terminalRoot.targetPresent;
}

export function buildCalendarItemsSourcesSnapshot(
  boundary: CalendarItemsSourcesBoundary,
): CalendarItemsSourcesSnapshot {
  const prerequisiteTerminal = boundary.target.taskNotesOccurrenceListed === true
    && boundary.target.recurrenceParentPresent === true
    && boundary.target.occurrenceDateMatches === true;
  const ownership = analyzeCalendarItemsSourcesOwnership(
    boundary.roots,
    boundary.target.liveBaseTargetPresent,
  );
  const terminalEvidence = boundary.phase === 'terminal-failure';
  const authoritativeRoot = ownership.authoritativeRoot;
  const matchedControl = authoritativeRoot === null ? null : {
    kind: 'simultaneous-owner' as const,
    available: true,
    equality: {
      basePath: authoritativeRoot.ownsBase === true,
      orderedJourney: boundary.initialReadinessCaptured,
      configHistory: boundary.actionHistoryMatches,
      targetIdentity: boundary.target.liveBaseTargetPresent === true
        && authoritativeRoot.ownerLiveBaseTargetPresent === true
        && authoritativeRoot.targetPresent,
      terminalPrerequisites: prerequisiteTerminal,
    },
  };

  return {
    schema: CALENDAR_ITEMS_SOURCES_TRACE_SCHEMA,
    phase: boundary.phase,
    checkpoint: boundary.checkpoint,
    sequence: boundary.sequence,
    target: boundary.target,
    roots: boundary.roots,
    prerequisite: {
      name: 'tasknotes-concrete-occurrence',
      state: boundary.target.taskNotesOccurrenceListed === null
        ? 'unknown'
        : prerequisiteTerminal ? 'terminal' : 'pending',
    },
    workState: prerequisiteTerminal && boundary.target.liveBaseTargetPresent === true ? 'settled' : 'unknown',
    completeness: {
      sameCheckpointObservation: boundary.sameCheckpointObservation,
      orderedPhases: boundary.initialReadinessCaptured && boundary.actionHistoryMatches && terminalEvidence,
      targetFileAndCache: boundary.target.fileExists !== null && boundary.target.cacheEntryExists !== null,
      taskNotesFacts: boundary.target.taskNotesOccurrenceListed !== null
        && boundary.target.recurrenceParentPresent !== null
        && boundary.target.occurrenceDateMatches !== null,
      liveBaseResult: boundary.target.liveBaseHostPresent === true
        && boundary.target.liveBaseTargetPresent !== null,
      rootCensus: boundary.roots.length > 0,
      ownerDomMembership: boundary.roots.every(({ ownerDomMember }) => ownerDomMember !== null),
      configActions: boundary.actionHistoryMatches,
      terminalEvidence,
      boundarySides: boundary.target.liveBaseTargetPresent !== null
        && boundary.roots.every(({ targetPresent, ownerLiveBaseTargetPresent }) =>
          typeof targetPresent === 'boolean' && ownerLiveBaseTargetPresent !== null),
      correlationKeys: boundary.roots.every(({ mountToken, ownerLeafId }) =>
        mountToken !== null && ownerLeafId !== null),
    },
    disqualifiers: {
      genericApiReadyOnly: false,
      missingPrerequisiteEvent: boundary.target.taskNotesOccurrenceListed === null,
      divergentConfigHistory: false,
      missingPostTransitionControl: matchedControl === null,
      unknownOwner: ownership.ambiguousOwner
        || boundary.roots.some(({ ownsBase, ownerLeafId }) => ownsBase === null || ownerLeafId === null),
      disconnectedAuthoritativeRoot: boundary.roots.some(({ ownsBase, connected }) =>
        ownsBase === true && !connected),
      crossMountJoin: ownership.crossMountJoin,
      authoritativeTargetAbsent: ownership.authoritativeTargetAbsent
        || (boundary.target.liveBaseTargetPresent === true && ownership.authoritativeRoot === null),
      missingBoundarySide: !boundary.sameCheckpointObservation,
      missingCorrelationKey: boundary.roots.some(({ mountToken, ownerLeafId }) =>
        mountToken === null || ownerLeafId === null),
      pendingWork: false,
      supersededWork: false,
      legitimateInvalidator: false,
      remount: hasConcurrentMountTokens(boundary.roots),
      filtered: false,
      reseeded: false,
      overflow: boundary.overflow,
      collectorFailure: boundary.collectorFailure,
      diagnosticRetrievalFailure: boundary.diagnosticRetrievalFailure,
      unmatchedControl: matchedControl === null || !allTrue(matchedControl.equality),
    },
    matchedControl,
  };
}

export type CalendarItemsSourcesVerdict =
  | { status: 'open' }
  | { status: 'class-b'; cause: 'wrong-owner-proxy' };

function allTrue(values: object): boolean {
  return Object.values(values).every((value) => value === true);
}

function hasConcurrentMountTokens(roots: CalendarItemsSourcesRootFacts[]): boolean {
  const mountsByLeaf = new Map<string, Set<number>>();
  for (const root of roots) {
    if (root.ownerDomMember !== true || root.ownerLeafId === null || root.mountToken === null) continue;
    const mounts = mountsByLeaf.get(root.ownerLeafId) ?? new Set<number>();
    mounts.add(root.mountToken);
    mountsByLeaf.set(root.ownerLeafId, mounts);
  }
  return [...mountsByLeaf.values()].some((mounts) => mounts.size > 1);
}

function isComplete(snapshot: CalendarItemsSourcesSnapshot): boolean {
  return allTrue(snapshot.completeness)
    && !Object.values(snapshot.disqualifiers).some(Boolean)
    && snapshot.workState === 'settled'
    && snapshot.matchedControl?.available === true
    && allTrue(snapshot.matchedControl.equality);
}

function isWrongOwnerProxy(snapshot: CalendarItemsSourcesSnapshot): boolean {
  if (snapshot.prerequisite.state !== 'terminal'
      || snapshot.matchedControl?.kind !== 'simultaneous-owner') return false;
  return analyzeCalendarItemsSourcesOwnership(
    snapshot.roots,
    snapshot.target.liveBaseTargetPresent,
  ).wrongOwnerObserved;
}

export function classifyCalendarItemsSourcesDiagnosis(
  snapshot: CalendarItemsSourcesSnapshot,
): CalendarItemsSourcesVerdict {
  if (!isComplete(snapshot)) return { status: 'open' };
  if (isWrongOwnerProxy(snapshot)) return { status: 'class-b', cause: 'wrong-owner-proxy' };
  return { status: 'open' };
}
