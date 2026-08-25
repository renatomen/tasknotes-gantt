/**
 * Pure classification and accounting for the column-sort e2e diagnosis. The
 * e2e spec gathers facts through the shared lifecycle collector; everything
 * here is side-effect-free so the pre-registered decision rules are
 * unit-provable. The classifier fail-closes: any missing mandatory fact yields
 * `open`, a probe-health failure yields `probe-failure` (a distinct trended
 * bucket, never `open`), and a class verdict additionally requires a matched
 * control.
 */

export const COLUMN_SORT_TRACE_SCHEMA = 'column-sort-diagnosis/v1';
export const COLUMN_SORT_LIFECYCLE_CAPACITY = 4096;
export const COLUMN_SORT_ENVELOPE_CAP = 3;
export const COLUMN_SORT_BOUNDED_FACT_LIMIT = 500;

/** Serialize a list-shaped observation into one bounded scalar fact. */
export function boundedFact(
  values: readonly string[],
  limit: number = COLUMN_SORT_BOUNDED_FACT_LIMIT,
): string {
  return values.join('|').slice(0, limit);
}

export interface ColumnSortRootCensusEntry {
  mountToken: number | null;
  selectedByGlobalProxy: boolean;
  connected: boolean;
  visible: boolean;
  /** null when the owning leaf could not be resolved for this root. */
  ownsBase: boolean | null;
  /** Whether this root's header set holds the sort column. */
  headerPresent: boolean;
}

export interface ColumnSortClickAttempt {
  callSite: string;
  /** Ambient phase when the attempt ran — slices attempts to their test. */
  phase: string;
  attemptOrdinal: number;
  landed: boolean;
  ariaSortBefore: string | null;
  ariaSortAfter: string | null;
  activeLeafViewType: string | null;
  markdownLeafPresent: boolean;
  roots: ColumnSortRootCensusEntry[];
  /** Collector sequence at capture time — orders attempts across call sites. */
  sequence: number;
}

export interface ColumnSortSliceFacts {
  phaseStartSeen: boolean;
  terminalSeen: boolean;
  readinessPassedSeen: boolean;
  /** Overflow OUTSIDE the failing slice is deliberately not modeled; only in-slice overflow disqualifies. */
  overflowInSlice: boolean;
  collectorFailure: boolean;
}

export interface ColumnSortRowContradiction {
  rowAbsentFromSampledRoot: boolean;
  rowPresentInOwningRoot: boolean | null;
  /**
   * Certified fact, not raw presence: true only when the operator verified a
   * recorded product transition on the failing mount AFTER the landed click
   * sequence, within the failing slice. null while no capture exists at the
   * product reseed decision points, or when ordering is unverified.
   */
  productTransitionRecorded: boolean | null;
}

export interface ColumnSortTraceInput {
  diagnosticOutcome: 'captured' | 'failed' | 'unavailable';
  slice: ColumnSortSliceFacts | null;
  clickAttempts: readonly ColumnSortClickAttempt[];
  rowContradiction: ColumnSortRowContradiction | null;
  /**
   * Certified fact, not raw presence: true only when the operator verified a
   * header/row removal WITHOUT recreation, on the failing attempt's mount,
   * AFTER the slice's readiness-passed marker. null while the seam observes
   * no header/row DOM add/remove lifecycle, or when any of those ordering and
   * mount conditions is unverified.
   */
  domRemovalObserved: boolean | null;
  /**
   * Certified fact: true only when an order-tick recorded after the click
   * sequence observed an active sort IN THE DIRECTION the clicks requested.
   * Aria facts on the click itself are same-tick reads taken before the
   * framework renders the transition, so delivery is provable from either
   * signal. null when no post-click tick exists in the slice or direction
   * is unverified.
   */
  sortStateObservedAfterClicks?: boolean | null;
  /**
   * The failing test's phase label. When set, only click attempts stamped
   * with this phase participate in localization — a recovered miss from an
   * earlier passing test is that test's fact, never this failure's cause.
   */
  failingPhase?: string | null;
  matchedControl: boolean;
  comparableTraceDisagrees?: boolean;
}

export type ColumnSortVerdictClass =
  | 'probe-failure'
  | 'open'
  | 'open-conflicting'
  | 'class-b-wrong-root'
  | 'class-d-header-drop'
  | 'class-d-row-loss';

export interface ColumnSortVerdict {
  verdict: ColumnSortVerdictClass;
  reason: string;
  causalAttemptOrdinal: number | null;
}

function open(reason: string): ColumnSortVerdict {
  return { verdict: 'open', reason, causalAttemptOrdinal: null };
}

function sampledRoot(attempt: ColumnSortClickAttempt): ColumnSortRootCensusEntry | undefined {
  return attempt.roots.find((root) => root.selectedByGlobalProxy);
}

function liveOwnerWithHeader(attempt: ColumnSortClickAttempt): ColumnSortRootCensusEntry | undefined {
  return attempt.roots.find(
    (root) => root.ownsBase === true && root.connected && root.visible && root.headerPresent,
  );
}

interface CandidateVerdict {
  verdict: Extract<ColumnSortVerdictClass, 'class-b-wrong-root' | 'class-d-header-drop' | 'class-d-row-loss'>;
  reason: string;
  causalAttemptOrdinal: number | null;
}

/**
 * Localize an absent-header click attempt: wrong-root when a live owner held
 * the header while the sampled root was stale, genuine drop only when the
 * removal itself was observed by the seam's DOM lifecycle facts.
 */
function localizeAbsentClick(
  attempt: ColumnSortClickAttempt,
  domRemovalObserved: boolean | null,
): CandidateVerdict | ColumnSortVerdict {
  const sampled = sampledRoot(attempt);
  const owner = liveOwnerWithHeader(attempt);
  // Staleness must be POSITIVE evidence: proven non-ownership or a dead node.
  // Unresolved ownership (null) is unknown, not stale — a second pane can
  // legitimately show the same Base, so another proven owner does not convict
  // a root whose own resolution merely failed.
  const sampledProvenStale =
    sampled === undefined || sampled.ownsBase === false || !sampled.connected || !sampled.visible;
  const sampledOwnershipUnresolved =
    sampled !== undefined && sampled.ownsBase === null && sampled.connected && sampled.visible;
  if (sampledOwnershipUnresolved) {
    return open('sampled-root ownership unresolved: staleness unprovable');
  }
  if (sampledProvenStale && owner !== undefined && owner !== sampled) {
    return {
      verdict: 'class-b-wrong-root',
      reason: 'sampled root stale or non-owning while a live owning root held the header',
      causalAttemptOrdinal: attempt.attemptOrdinal,
    };
  }
  const owningRoots = attempt.roots.filter((root) => root.ownsBase === true);
  const unresolvedOthers = attempt.roots.some((root) => root !== sampled && root.ownsBase === null);
  // A drop is only provable against a LIVE owning root: an invisible or
  // disconnected owner cannot prove the header is absent from what the user
  // (and the click) actually faced — and any OTHER root with unresolved
  // ownership leaves single-ownership unproven.
  const genuineAbsence =
    owningRoots.length === 1 &&
    owningRoots[0] === sampled &&
    owningRoots[0].connected &&
    owningRoots[0].visible &&
    !owningRoots[0].headerPresent &&
    !unresolvedOthers;
  if (!genuineAbsence) {
    return open('click-attempt census ambiguous: no provable wrong-root or genuine-absence shape');
  }
  if (domRemovalObserved !== true) {
    return open('header genuinely absent from the owning root but removal unobserved');
  }
  return {
    verdict: 'class-d-header-drop',
    reason: 'header removed without recreation from the single live owning root after readiness',
    causalAttemptOrdinal: attempt.attemptOrdinal,
  };
}

function localizeRowContradiction(
  row: ColumnSortRowContradiction,
  input: ColumnSortTraceInput,
  scopedAttempts: readonly ColumnSortClickAttempt[],
): CandidateVerdict | ColumnSortVerdict {
  if (!row.rowAbsentFromSampledRoot) {
    return open('row contradiction reported without a sampled-root absence');
  }
  if (row.rowPresentInOwningRoot === true) {
    return {
      verdict: 'class-b-wrong-root',
      reason: 'row absent from the sampled root while present in the live owning root',
      causalAttemptOrdinal: null,
    };
  }
  // Class (d) requires ALL mandatory facts: ownership proven absent (null is
  // unknown, not absent), a recorded product transition, and proven sort
  // delivery — an aria change on a landed click, or an active sort observed
  // by a later order tick (the click-time aria read is same-tick and can
  // legitimately precede the rendered transition).
  if (row.rowPresentInOwningRoot === null) {
    return open('row-loss owner presence unknown: ownership resolution incomplete');
  }
  const ariaChanged = scopedAttempts.some(
    (attempt) => attempt.landed && attempt.ariaSortBefore !== attempt.ariaSortAfter,
  );
  const sortDelivered = ariaChanged || input.sortStateObservedAfterClicks === true;
  if (!sortDelivered) {
    return open('row-loss sort delivery unproven: no aria change and no post-click sorted tick');
  }
  if (row.productTransitionRecorded === true) {
    return {
      verdict: 'class-d-row-loss',
      reason: 'rows dropped or reordered by a recorded product transition after landed clicks',
      causalAttemptOrdinal: null,
    };
  }
  return open('row-loss facts incomplete: no recorded product transition');
}

/**
 * Localize the earliest contradiction. The earliest causal click attempt owns
 * the classification; a later landed attempt is a recovery fact, never a
 * re-litigation. Returns a candidate class verdict or an `open` refusal.
 */
function localize(input: ColumnSortTraceInput): CandidateVerdict | ColumnSortVerdict {
  const scopedAttempts =
    input.failingPhase == null
      ? input.clickAttempts
      : input.clickAttempts.filter((attempt) => attempt.phase === input.failingPhase);
  const absentAttempt = [...scopedAttempts]
    .sort((a, b) => a.sequence - b.sequence)
    .find((attempt) => !attempt.landed);
  if (absentAttempt) return localizeAbsentClick(absentAttempt, input.domRemovalObserved);
  if (input.rowContradiction) {
    return localizeRowContradiction(input.rowContradiction, input, scopedAttempts);
  }
  return open('no contradiction located in the trace');
}

/** The pre-registered decision rules from the diagnosis plan, fail-closed. */
export function classifyColumnSortDiagnosis(input: ColumnSortTraceInput): ColumnSortVerdict {
  if (input.diagnosticOutcome === 'unavailable') {
    return { verdict: 'probe-failure', reason: 'collector unavailable', causalAttemptOrdinal: null };
  }
  if (input.diagnosticOutcome === 'failed') {
    return { verdict: 'probe-failure', reason: 'diagnostic retrieval failed', causalAttemptOrdinal: null };
  }
  if (input.slice === null) return open('failing-test slice missing');
  if (input.slice.collectorFailure) return open('collector failure recorded');
  if (input.slice.overflowInSlice) return open('overflow observed within the failing slice');
  if (!input.slice.phaseStartSeen || !input.slice.terminalSeen) {
    return open('slice boundary phase markers missing');
  }
  if (!input.slice.readinessPassedSeen) return open('readiness-passed marker missing from slice');

  const candidate = localize(input);
  if (candidate.verdict === 'open') return candidate;
  if (!input.matchedControl) {
    return open(`${candidate.reason}; no matched control`);
  }
  if (input.comparableTraceDisagrees === true) {
    return { verdict: 'open-conflicting', reason: candidate.reason, causalAttemptOrdinal: candidate.causalAttemptOrdinal };
  }
  return candidate;
}

export interface ColumnSortEnvelopeGate {
  shouldEmit(error: unknown): boolean;
}

/** Cap envelopes per suite and dedup by error identity (same object, one envelope). */
export function createColumnSortEnvelopeGate(
  cap: number = COLUMN_SORT_ENVELOPE_CAP,
): ColumnSortEnvelopeGate {
  const seen = new Set<unknown>();
  let emitted = 0;
  return {
    shouldEmit(error: unknown): boolean {
      if (seen.has(error)) return false;
      seen.add(error);
      if (emitted >= cap) return false;
      emitted += 1;
      return true;
    },
  };
}

export interface ColumnSortRecordBudget {
  capacity: number;
  total: number;
  breakdown: Record<string, number>;
  /** Inter-test boundaries that survive worst-case eviction at this volume. */
  survivingBoundaries: string[];
}

/**
 * Worst-case ring demand across the five-test journey, failure paths included.
 * A single exhausted 90s readiness gate is the dominant term; a second gate
 * cannot exhaust in the same envelope because the first one fails its test and
 * mocha aborts the remaining tests of the suite.
 */
export function estimateWorstCaseRecordBudget(): ColumnSortRecordBudget {
  const breakdown: Record<string, number> = {
    // 7 gates (before + 5 beforeEach + reopen) at a typical ~20 polls each:
    // every poll's activateBaseLeaf fires one product active-leaf-classified.
    activeLeafClassifiedTypical: 7 * 20,
    // One failing gate polling its full 90s budget at ~500ms cadence.
    activeLeafClassifiedExhaustedGate: 180,
    // Mounts: initial + reopen + up to 3 heal-driven remounts, ~8 records each.
    mountLifecycle: 5 * 8,
    // Click attempts: five sortByColumn loops at worst 20 polls + 8 direct clicks.
    clickAttempts: 5 * 20 + 8,
    // Nine order/state wait sites at worst 30 ticks each.
    orderTickCensuses: 9 * 30,
    // Reset boundaries, readiness-passed markers, phase markers, suite start/teardown.
    boundaryAndPhaseMarkers: 5 + 7 + 12 + 2,
    // svar-ready and other view hook sites during this journey (no zoom/scroll).
    otherProductHooks: 20,
  };
  const total = Object.values(breakdown).reduce((sum, records) => sum + records, 0);
  return {
    capacity: COLUMN_SORT_LIFECYCLE_CAPACITY,
    total,
    breakdown,
    // At worst-case volume the ring holds the full journey, so every inter-test
    // boundary survives; under a single exhausted gate the oldest boundary
    // (suite-before -> test 1) is the first to evict.
    survivingBoundaries: ['test1-test2', 'test2-test3', 'test3-test4', 'test4-test5'],
  };
}

export interface ColumnSortControlIdentity {
  buildSha: string | null;
  specSchema: string;
  chromiumVersion: string | null;
  taskNotesVersion: string | null;
  platform: string;
  nodeVersion: string;
  obsidianVersion: string | null;
  electronVersion: string | null;
}

/** True only when every runtime-fingerprint field of the identity is present. */
export function isColumnSortControlIdentityComplete(identity: ColumnSortControlIdentity): boolean {
  return (
    identity.buildSha !== null &&
    identity.chromiumVersion !== null &&
    identity.taskNotesVersion !== null &&
    identity.obsidianVersion !== null &&
    identity.electronVersion !== null
  );
}

export interface ColumnSortControlDigestInput {
  identity: ColumnSortControlIdentity;
  attempts: readonly ColumnSortClickAttempt[];
  armed: boolean;
  overflow: boolean;
  collectorFailure: boolean;
  basePath: string;
  readinessGates: number;
  /** Node-side count of diagnostic browser commands that failed this suite. */
  diagnosticCommandFailures: number;
}

export interface ColumnSortPerSiteSummary {
  callSite: string;
  attempts: number;
  allLanded: boolean;
}

export interface ColumnSortControlDigest {
  schema: string;
  identity: ColumnSortControlIdentity;
  perSite: ColumnSortPerSiteSummary[];
  armed: boolean;
  overflow: boolean;
  collectorFailure: boolean;
  basePath: string;
  readinessGates: number;
  /** Ordered click-site journey (call sites in first-attempt order, bounded). */
  journey: string;
  /** Largest root count any click attempt observed (0 when no census ran). */
  maxRootCount: number;
  /** Whether every censused root was owning, connected, and visible. */
  allRootsLiveOwners: boolean;
  /** Distinct sampled-root mount tokens across the journey (remount count). */
  distinctMountTokens: number;
  /** Diagnostic commands that failed without reaching the collector. */
  diagnosticCommandFailures: number;
}

/**
 * The pass-path control digest: exactly the fields control matching consumes.
 * A digest whose identity is incomplete per
 * {@link isColumnSortControlIdentityComplete} is unmatchable as a control.
 */
export function buildColumnSortControlDigest(
  input: ColumnSortControlDigestInput,
): ColumnSortControlDigest {
  const perSite = new Map<string, ColumnSortPerSiteSummary>();
  for (const attempt of input.attempts) {
    const existing = perSite.get(attempt.callSite);
    if (existing) {
      existing.attempts += 1;
      existing.allLanded = existing.allLanded && attempt.landed;
    } else {
      perSite.set(attempt.callSite, {
        callSite: attempt.callSite,
        attempts: 1,
        allLanded: attempt.landed,
      });
    }
  }
  const maxRootCount = input.attempts.reduce(
    (max, attempt) => Math.max(max, attempt.roots.length),
    0,
  );
  // An attempt with an EMPTY census is degraded observation, not health: a
  // vacuous every() must not read as "all roots were live owners".
  const allRootsLiveOwners = input.attempts.every(
    (attempt) =>
      attempt.roots.length > 0 &&
      attempt.roots.every((root) => root.ownsBase === true && root.connected && root.visible),
  );
  const mountTokens = new Set<number | null>();
  for (const attempt of input.attempts) {
    const sampled = attempt.roots.find((root) => root.selectedByGlobalProxy);
    if (sampled) mountTokens.add(sampled.mountToken);
  }
  return {
    schema: COLUMN_SORT_TRACE_SCHEMA,
    identity: input.identity,
    perSite: [...perSite.values()],
    armed: input.armed,
    overflow: input.overflow,
    collectorFailure: input.collectorFailure,
    basePath: input.basePath,
    readinessGates: input.readinessGates,
    journey: boundedFact([...perSite.keys()]),
    maxRootCount,
    allRootsLiveOwners,
    distinctMountTokens: mountTokens.size,
    diagnosticCommandFailures: input.diagnosticCommandFailures,
  };
}

/**
 * Mechanical control equivalence: two digests are comparable as a
 * failure/control pair only when their identities are complete and identical,
 * and they walked the same Base, journey, and readiness-gate count with a
 * healthy collector. Any difference or incompleteness makes them
 * non-equivalent — the operator never eyeballs a match.
 */
export function areColumnSortControlsEquivalent(
  a: ColumnSortControlDigest,
  b: ColumnSortControlDigest,
): boolean {
  const identityEqual = (Object.keys(a.identity) as (keyof ColumnSortControlIdentity)[]).every(
    (key) => a.identity[key] === b.identity[key],
  );
  const perSiteEqual =
    a.perSite.length === b.perSite.length &&
    a.perSite.every((site) => {
      const twin = b.perSite.find((candidate) => candidate.callSite === site.callSite);
      return twin !== undefined && twin.attempts === site.attempts && twin.allLanded === site.allLanded;
    });
  return (
    isColumnSortControlIdentityComplete(a.identity) &&
    isColumnSortControlIdentityComplete(b.identity) &&
    identityEqual &&
    perSiteEqual &&
    a.schema === b.schema &&
    a.basePath === b.basePath &&
    a.journey === b.journey &&
    a.readinessGates === b.readinessGates &&
    a.maxRootCount === b.maxRootCount &&
    a.distinctMountTokens === b.distinctMountTokens &&
    a.allRootsLiveOwners &&
    b.allRootsLiveOwners &&
    a.diagnosticCommandFailures === 0 &&
    b.diagnosticCommandFailures === 0 &&
    a.armed &&
    b.armed &&
    !a.overflow &&
    !b.overflow &&
    !a.collectorFailure &&
    !b.collectorFailure
  );
}

/**
 * Boundary coverage for a failure that stopped mid-journey: a full-suite
 * control can serve an early-test failure only when the failure's click-site
 * journey is a PREFIX of the control's journey and the control run is
 * healthy (complete identity, no overflow, no collector failure, live-owner
 * censuses throughout). Facts past the failure boundary exist only in the
 * control and are not evidence against it.
 */
export function columnSortControlCoversBoundary(
  control: ColumnSortControlDigest,
  failureJourney: string,
): boolean {
  return (
    isColumnSortControlIdentityComplete(control.identity) &&
    control.armed &&
    !control.overflow &&
    !control.collectorFailure &&
    control.diagnosticCommandFailures === 0 &&
    control.allRootsLiveOwners &&
    failureJourney.length > 0 &&
    (control.journey === failureJourney || control.journey.startsWith(`${failureJourney}|`))
  );
}
