/**
 * The planner table: the reachable drag-commit space derived MECHANICALLY —
 * the full cross-product of outcome × gesture × instances × tree role ×
 * cascade mode × persist result, filtered by named impossibility/inertness
 * rules, with the remainder fully enumerated and driven through both entry
 * points. Impossible combinations are asserted impossible (the planner is
 * shown to normalize them), never silently skipped.
 *
 * Named rules (each excluded combo carries exactly one):
 * - prompt-fires-only-on-resize — gate outcomes require a single-edge resize
 *   with matching inferred provenance and a writable estimate.
 * - progress-crosses-no-other-dimension — a progress drag never prompts,
 *   mirrors, or cascades; only its persist result varies.
 * - no-op-collapses-every-dimension — a day-granular no-op is one empty plan.
 * - cancel-produces-no-cascade — a cancelled prompt restores and stops; only
 *   the resize edge and instance count vary (restore coverage).
 * - mode-gates-only-shrink-and-extend — the cascade mode is inert unless the
 *   combo reaches a shrink-fit or ancestor-extend gate.
 * - auto-mirrors-the-prompt-resolved-plan — a non-ask mode lands the same
 *   committed plan the prompt's choice lands (asserted by identity), so auto
 *   rows run at the canonical slice only.
 * - instances-vary-only-mirror-coverage — the N-instance axis exists to prove
 *   sibling coverage; it crosses the mirror-bearing slices only.
 * - failure-varies-only-by-revert-class — the revert plan is carried data
 *   varying by write class (main, gate-main, subtree, shrink, extend,
 *   progress), so failure rows cross exactly those carriers.
 */
import { describe, it, expect, jest } from '@jest/globals';
import {
  planGestureCommit,
  planCascade,
  verifyMirrorCoverage,
  isEmptyPlan,
  emptyPlan,
  memoizePlannerDerivation,
  type DerivationMemo,
  type CascadeChoices,
  type CascadeOutcome,
  type CommitGesture,
  type GestureChoice,
  type GesturePlan,
  type GestureSettlement,
  type Plan,
  type PlannerDerivation,
  type PlannerInstance,
} from '../../src/bases/dragCommitPlanner';
import {
  inclusiveDaySpan,
  minutesToSpanDays,
  spanDaysToMinutes,
} from '../../src/controller/durationConversion';
import type { InferredDragAction } from '../../src/bases/inferredDragGate';
import type { DateStatus } from '../../src/controller/datePolicy';

const day = (iso: string): Date => new Date(`${iso}T00:00:00`);
const dayEnd = (iso: string): Date => new Date(`${iso}T23:59:59.999`);
const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

// ── Dimensions ───────────────────────────────────────────────────────────────

const OUTCOMES = [
  'write-as-today',
  'prompt-estimate-only',
  'prompt-estimate-and-dates',
  'prompt-cancel',
  'auto-estimate-only',
  'auto-estimate-and-dates',
] as const;
const GESTURES = ['resize-start', 'resize-end', 'move', 'none', 'progress'] as const;
const INSTANCE_COUNTS = [1, 2] as const;
const ROLES = ['leaf', 'parent', 'has-ancestors'] as const;
const MODES = ['ask', 'auto', 'never'] as const;
const PERSISTS = ['success', 'failure'] as const;

type Outcome = (typeof OUTCOMES)[number];
type Gesture = (typeof GESTURES)[number];
type Role = (typeof ROLES)[number];
type Mode = (typeof MODES)[number];
type Persist = (typeof PERSISTS)[number];

interface Combo {
  outcome: Outcome;
  gesture: Gesture;
  instances: 1 | 2;
  role: Role;
  mode: Mode;
  persist: Persist;
}

const isGateOutcome = (o: Outcome): boolean => o !== 'write-as-today';
const isAutoOutcome = (o: Outcome): boolean => o.startsWith('auto-');
const isResize = (g: Gesture): boolean => g === 'resize-start' || g === 'resize-end';
const landsDates = (o: Outcome): boolean =>
  o === 'write-as-today' || o.endsWith('estimate-and-dates');

const isCanonicalGateSlice = (c: Combo): boolean =>
  c.role === 'leaf' && c.instances === 1 && c.mode === 'ask' && c.persist === 'success';

const reachesModeGate = (c: Combo): boolean =>
  c.role === 'has-ancestors' ||
  (c.role === 'parent' && isResize(c.gesture) && landsDates(c.outcome));

const onMirrorAxis = (c: Combo): boolean =>
  c.role === 'leaf' ||
  (c.gesture === 'move' &&
    c.role === 'parent' &&
    c.outcome === 'write-as-today' &&
    c.persist === 'success');

type FailureClass = 'main-plain' | 'main-gate' | 'subtree' | 'shrink' | 'extend' | 'progress';

/** The six revert-class carriers the failure dimension crosses. */
const FAILURE_CARRIERS: ReadonlyArray<[FailureClass, Partial<Combo>]> = [
  ['progress', { gesture: 'progress' }],
  ['main-plain', { gesture: 'resize-end', outcome: 'write-as-today', role: 'leaf', mode: 'ask' }],
  ['main-gate', { gesture: 'resize-end', outcome: 'prompt-estimate-only', role: 'leaf', instances: 1, mode: 'ask' }],
  ['subtree', { gesture: 'move', outcome: 'write-as-today', role: 'parent', instances: 1, mode: 'ask' }],
  ['shrink', { gesture: 'resize-end', outcome: 'write-as-today', role: 'parent', instances: 1, mode: 'auto' }],
  ['extend', { gesture: 'resize-end', outcome: 'write-as-today', role: 'has-ancestors', instances: 1, mode: 'auto' }],
];

function failureClassOf(c: Combo): FailureClass | null {
  const carrier = FAILURE_CARRIERS.find(([, shape]) =>
    Object.entries(shape).every(([key, value]) => c[key as keyof Combo] === value),
  );
  return carrier ? carrier[0] : null;
}

const isCanonical = (c: Combo): boolean =>
  c.role === 'leaf' && c.instances === 1 && c.mode === 'ask';

/** The named exclusion rules, in precedence order. */
const EXCLUSION_RULES: ReadonlyArray<[string, (c: Combo) => boolean]> = [
  ['prompt-fires-only-on-resize', (c) => isGateOutcome(c.outcome) && !isResize(c.gesture)],
  ['progress-crosses-no-other-dimension', (c) => c.gesture === 'progress' && !isCanonical(c)],
  [
    'no-op-collapses-every-dimension',
    (c) => c.gesture === 'none' && (!isCanonical(c) || c.persist !== 'success'),
  ],
  [
    'cancel-produces-no-cascade',
    (c) =>
      c.outcome === 'prompt-cancel' &&
      (c.role !== 'leaf' || c.mode !== 'ask' || c.persist !== 'success'),
  ],
  ['mode-gates-only-shrink-and-extend', (c) => c.mode !== 'ask' && !reachesModeGate(c)],
  [
    'auto-mirrors-the-prompt-resolved-plan',
    (c) => isAutoOutcome(c.outcome) && !isCanonicalGateSlice(c),
  ],
  ['instances-vary-only-mirror-coverage', (c) => c.instances === 2 && !onMirrorAxis(c)],
  [
    'failure-varies-only-by-revert-class',
    (c) => c.persist === 'failure' && failureClassOf(c) === null,
  ],
];

/** First matching exclusion rule, or null when the combo is a table row. */
function exclusionRule(c: Combo): string | null {
  return EXCLUSION_RULES.find(([, applies]) => applies(c))?.[0] ?? null;
}

const FULL_PRODUCT: Combo[] = OUTCOMES.flatMap((outcome) =>
  GESTURES.flatMap((gesture) =>
    INSTANCE_COUNTS.flatMap((instances) =>
      ROLES.flatMap((role) =>
        MODES.flatMap((mode) =>
          PERSISTS.map((persist) => ({ outcome, gesture, instances, role, mode, persist })),
        ),
      ),
    ),
  ),
);

const TABLE_ROWS = FULL_PRODUCT.filter((c) => exclusionRule(c) === null);
const EXCLUDED = FULL_PRODUCT.filter((c) => exclusionRule(c) !== null);

// ── Fixtures ─────────────────────────────────────────────────────────────────

const T = 'notes/T.md';
const C1 = 'notes/C1.md';
const C2 = 'notes/C2.md';

const inst = (
  id: string,
  sourcePath: string,
  startIso: string,
  endIso: string,
  parent?: string,
): PlannerInstance => ({
  id,
  sourcePath,
  text: sourcePath,
  parent,
  start: day(startIso),
  end: dayEnd(endIso),
});

interface Fixture {
  instances: PlannerInstance[];
  draggedId: string;
}

/** T spans Mon 08-03 .. Thu 08-06; children/parents placed per role. */
function buildFixture(role: Role, count: 1 | 2): Fixture {
  if (count === 1) {
    if (role === 'leaf') return { instances: [inst(T, T, '2026-08-03', '2026-08-06')], draggedId: T };
    if (role === 'parent') {
      return {
        instances: [
          inst(T, T, '2026-08-03', '2026-08-06'),
          inst('C1#a', C1, '2026-08-03', '2026-08-04', T),
          inst('C2#a', C2, '2026-08-05', '2026-08-06', T),
        ],
        draggedId: T,
      };
    }
    return {
      instances: [
        inst('P1', 'notes/P1.md', '2026-08-03', '2026-08-06'),
        inst('T#p1', T, '2026-08-03', '2026-08-06', 'P1'),
      ],
      draggedId: 'T#p1',
    };
  }
  if (role === 'leaf') {
    return {
      instances: [
        inst('W1', 'notes/W1.md', '2026-08-01', '2026-08-31'),
        inst('W2', 'notes/W2.md', '2026-08-01', '2026-08-31'),
        inst('T#w1', T, '2026-08-03', '2026-08-06', 'W1'),
        inst('T#w2', T, '2026-08-03', '2026-08-06', 'W2'),
      ],
      draggedId: 'T#w1',
    };
  }
  if (role === 'parent') {
    return {
      instances: [
        inst('W1', 'notes/W1.md', '2026-08-01', '2026-08-31'),
        inst('W2', 'notes/W2.md', '2026-08-01', '2026-08-31'),
        inst('T#w1', T, '2026-08-03', '2026-08-06', 'W1'),
        inst('T#w2', T, '2026-08-03', '2026-08-06', 'W2'),
        inst('C1#t1', C1, '2026-08-03', '2026-08-04', 'T#w1'),
        inst('C1#t2', C1, '2026-08-03', '2026-08-04', 'T#w2'),
        inst('C2#t1', C2, '2026-08-05', '2026-08-06', 'T#w1'),
        inst('C2#t2', C2, '2026-08-05', '2026-08-06', 'T#w2'),
      ],
      draggedId: 'T#w1',
    };
  }
  return {
    instances: [
      inst('P1', 'notes/P1.md', '2026-08-03', '2026-08-06'),
      inst('P2', 'notes/P2.md', '2026-08-03', '2026-08-06'),
      inst('T#p1', T, '2026-08-03', '2026-08-06', 'P1'),
      inst('T#p2', T, '2026-08-03', '2026-08-06', 'P2'),
    ],
    draggedId: 'T#p1',
  };
}

const derivation = (overrides: Partial<PlannerDerivation> = {}): PlannerDerivation => ({
  minutesToSpanDays,
  spanDaysToMinutes,
  inclusiveDaySpan,
  defaultDurationDays: 2,
  ...overrides,
});

const BEFORE = { start: day('2026-08-03'), end: dayEnd('2026-08-06') };
const STORED_ESTIMATE = spanDaysToMinutes(4); // matches the 4-day span

/** Parent-role resizes SHRINK into the children (the shrink gate needs it);
 *  everything else GROWS (the extend gate needs it). Move shifts +7 days. */
function afterSpanFor(gesture: Gesture, role: Role): { start: Date; end: Date } {
  switch (gesture) {
    case 'resize-end':
      return role === 'parent'
        ? { start: BEFORE.start, end: dayEnd('2026-08-04') }
        : { start: BEFORE.start, end: dayEnd('2026-08-08') };
    case 'resize-start':
      return role === 'parent'
        ? { start: day('2026-08-05'), end: BEFORE.end }
        : { start: day('2026-08-01'), end: BEFORE.end };
    case 'move':
      return { start: addDays(BEFORE.start, 7), end: addDays(BEFORE.end, 7) };
    default:
      return { start: day('2026-08-03'), end: day('2026-08-06') }; // none: same days
  }
}

function dateStatusFor(combo: Combo): DateStatus {
  if (!isGateOutcome(combo.outcome)) return 'complete';
  return combo.gesture === 'resize-start' ? 'inferred-start' : 'inferred-end';
}

function buildGesture(combo: Combo, fixture: Fixture): CommitGesture {
  if (combo.gesture === 'progress') {
    return { kind: 'progress', instanceId: fixture.draggedId, progress: 55, beforeProgress: 20 };
  }
  const mode: InferredDragAction | 'ask' = combo.outcome.startsWith('auto-')
    ? (combo.outcome.slice('auto-'.length) as InferredDragAction)
    : 'ask';
  return {
    kind: 'bar',
    instanceId: fixture.draggedId,
    before: {
      start: BEFORE.start,
      end: BEFORE.end,
      dateStatus: dateStatusFor(combo),
      estimateMinutes: STORED_ESTIMATE,
    },
    after: afterSpanFor(combo.gesture, combo.role),
    estimateWritable: true,
    inferredDragMode: mode,
  };
}

// ── Flow driver: gesture plan → choice re-plan → cascade loop ────────────────

interface Flow {
  first: GesturePlan;
  committed: GesturePlan;
  settlement: GestureSettlement;
  cascades: Plan[];
}

function gestureChoiceFor(combo: Combo): GestureChoice {
  if (combo.outcome === 'prompt-cancel') return null;
  if (combo.outcome === 'prompt-estimate-only') return { action: 'estimate-only' };
  if (combo.outcome === 'prompt-estimate-and-dates') return { action: 'estimate-and-dates' };
  return undefined;
}

function resolveCommitted(combo: Combo, fixture: Fixture, deriv: PlannerDerivation): {
  first: GesturePlan;
  committed: GesturePlan;
} {
  const gesture = buildGesture(combo, fixture);
  const first = planGestureCommit(gesture, fixture.instances, undefined, deriv);
  if (!combo.outcome.startsWith('prompt-')) return { first, committed: first };
  const committed = planGestureCommit(gesture, fixture.instances, gestureChoiceFor(combo), deriv);
  return { first, committed };
}

function cascadeOutcomeFor(combo: Combo, fixture: Fixture, settlement: GestureSettlement): CascadeOutcome {
  return {
    instanceId: fixture.draggedId,
    name: T,
    before: { start: BEFORE.start, end: BEFORE.end, estimateMinutes: STORED_ESTIMATE },
    after: afterSpanFor(combo.gesture, combo.role),
    settlement,
  };
}

function answerCascade(plan: Plan, answers: CascadeChoices, failureClass: FailureClass | null): boolean {
  if (plan.prompt?.kind === 'shrink-fit') {
    answers.shrinkChoice = 'adjust';
    return true;
  }
  if (plan.prompt?.kind === 'extend') {
    answers.extendApproved = true;
    return true;
  }
  if (plan.resume === 'after-subtree') {
    answers.persistedSubtreeSources =
      failureClass === 'subtree' ? [] : plan.writes.map((w) => w.sourcePath);
    return true;
  }
  return false;
}

function driveFlow(combo: Combo, fixture: Fixture, deriv: PlannerDerivation): Flow {
  const { first, committed } = resolveCommitted(combo, fixture, deriv);
  const failureClass = combo.persist === 'failure' ? failureClassOf(combo) : null;
  const mainFails = failureClass === 'main-plain' || failureClass === 'main-gate' || failureClass === 'progress';
  const settlement = mainFails ? committed.settlement.onFailure : committed.settlement.onSuccess;
  const cascades: Plan[] = [];
  const answers: CascadeChoices = { cascadeMode: combo.mode };
  for (let i = 0; i < 4; i += 1) {
    const plan = planCascade(cascadeOutcomeFor(combo, fixture, settlement), fixture.instances, answers, deriv);
    cascades.push(plan);
    if (!answerCascade(plan, answers, failureClass)) break;
  }
  return { first, committed, settlement, cascades };
}

// ── Per-row assertions ───────────────────────────────────────────────────────

const datedOf = (fixture: Fixture, source: string): number =>
  fixture.instances.filter((i) => i.sourcePath === source && i.start && i.end).length;

function assertUniversalInvariants(fixture: Fixture, plans: Plan[]): void {
  for (const plan of plans) {
    expect(verifyMirrorCoverage(plan, fixture.instances)).toEqual([]);
    const hasExtend = plan.writes.some((w) => w.unmirrored === 'ancestor-extend-refresh-only');
    const hasGeometryWrite = plan.writes.some(
      (w) => !w.unmirrored && (w.patch.start !== undefined || w.patch.end !== undefined),
    );
    expect(hasExtend && hasGeometryWrite).toBe(false); // shrink and extend never co-occur
  }
}

function assertProgressRow(combo: Combo, flow: Flow): void {
  const write = flow.committed.writes[0];
  expect(write?.patch).toEqual({ progress: 55 });
  expect(write?.unmirrored).toBe('progress-by-design');
  expect(flow.committed.echoes).toEqual([]);
  expect(flow.settlement.kind).toBe('no-cascade');
  if (combo.persist === 'failure') {
    expect(flow.committed.reverts[0]?.rows[0]?.payload).toEqual({ kind: 'progress', progress: 20 });
  }
  expect(flow.cascades.every(isEmptyPlan)).toBe(true);
}

function assertWriteAsTodayShape(
  combo: Combo,
  flow: Flow,
  patch: Plan['writes'][number]['patch'] | undefined,
): void {
  expect(patch?.start).toBeDefined();
  expect(patch?.end).toBeDefined();
  // A move keeps the 4-day count, so the estimate write is suppressed.
  if (combo.gesture === 'move' || combo.gesture === 'none') expect(patch?.estimate).toBeUndefined();
  else expect(patch?.estimate).toBeDefined();
  // A failed plain main persist settles aborted — never a cascading plain.
  const mainFailed = combo.persist === 'failure' && failureClassOf(combo)?.startsWith('main');
  expect(flow.settlement.kind).toBe(mainFailed ? 'aborted' : 'plain');
}

function assertCommittedShape(combo: Combo, flow: Flow, fixture: Fixture): void {
  const plan = flow.committed;
  const patch = plan.writes[0]?.patch;
  switch (combo.outcome) {
    case 'write-as-today': {
      assertWriteAsTodayShape(combo, flow, patch);
      break;
    }
    case 'prompt-cancel': {
      expect(plan.writes).toEqual([]);
      expect(plan.echoes[0]?.rows).toHaveLength(datedOf(fixture, T));
      expect(flow.settlement.kind).toBe('aborted');
      break;
    }
    default: {
      // estimate-only / estimate-and-dates (prompted or auto)
      expect(patch?.estimate).toBeDefined();
      const wantsDate = combo.outcome.endsWith('estimate-and-dates');
      const draggedEdgeDate = combo.gesture === 'resize-start' ? patch?.start : patch?.end;
      const otherEdgeDate = combo.gesture === 'resize-start' ? patch?.end : patch?.start;
      expect(draggedEdgeDate !== undefined).toBe(wantsDate);
      expect(otherEdgeDate).toBeUndefined();
      expect(flow.settlement.kind).toBe(combo.persist === 'failure' ? 'aborted' : 'inferred');
    }
  }
  if (combo.outcome !== 'prompt-cancel' && combo.gesture !== 'none') {
    expect(plan.echoes[0]?.sourcePath).toBe(T);
    expect(plan.echoes[0]?.rows).toHaveLength(datedOf(fixture, T));
  }
  if (combo.outcome.startsWith('prompt-')) {
    expect(flow.first.prompt).toEqual({ kind: 'inferred-drag' });
    expect(flow.first.writes).toEqual([]);
  } else {
    expect(flow.first.prompt).toBeNull();
  }
}

function expectedCascadeGate(combo: Combo): 'subtree' | 'shrink' | 'extend' | 'none' {
  if (combo.gesture === 'move') {
    if (combo.role === 'parent') return 'subtree';
    return combo.role === 'has-ancestors' ? 'extend' : 'none';
  }
  if (isResize(combo.gesture)) {
    if (combo.role === 'parent' && landsDates(combo.outcome)) return 'shrink';
    return combo.role === 'has-ancestors' ? 'extend' : 'none';
  }
  return 'none';
}

function assertSubtreeCascade(combo: Combo, flow: Flow, fixture: Fixture): void {
  const first = flow.cascades[0] as Plan;
  expect(first.resume).toBe('after-subtree');
  expect(first.writes.map((w) => w.sourcePath).sort()).toEqual([C1, C2]);
  for (const echo of first.echoes) {
    expect(echo.rows).toHaveLength(datedOf(fixture, echo.sourcePath));
  }
  if (combo.persist === 'failure') {
    // Per-source reverts restore each instance's own PRE-DRAG snapshot — the
    // payload values are the snapshot dates, never the shifted span.
    expect(first.reverts.length).toBeGreaterThan(0);
    for (const revert of first.reverts) {
      const snapshots = fixture.instances.filter((i) => i.sourcePath === revert.sourcePath);
      expect(revert.rows).toEqual(
        snapshots.map((i) => ({
          instanceId: i.id,
          payload: {
            kind: 'geometry',
            geometry: { start: i.start, end: i.end, flagged: false, ghostRuns: [] },
          },
        })),
      );
    }
  }
  expect(flow.cascades.slice(1).every(isEmptyPlan)).toBe(true); // wide/no ancestors
}

function assertShrinkCascade(combo: Combo, flow: Flow, fixture: Fixture): void {
  if (combo.mode === 'never') {
    expect(flow.cascades.every(isEmptyPlan)).toBe(true);
    return;
  }
  if (combo.mode === 'ask') expect(flow.cascades[0]?.prompt?.kind).toBe('shrink-fit');
  const settled = flow.cascades[combo.mode === 'ask' ? 1 : 0] as Plan;
  const write = settled.writes[0];
  expect(write?.sourcePath).toBe(T);
  // Adjust-to-fit restores the children's boundary on the violated edge.
  expect(write?.patch.start).toEqual(day('2026-08-03'));
  expect(write?.patch.end).toEqual(dayEnd('2026-08-06'));
  // Estimate consistency rides only an inferred-edge decision.
  expect(write?.patch.estimate !== undefined).toBe(combo.outcome.endsWith('estimate-and-dates'));
  expect(settled.echoes[0]?.rows).toHaveLength(datedOf(fixture, T));
  if (combo.persist === 'failure') {
    // A failed shrink puts rows back at the resize the main persist saved.
    const row = settled.reverts[0]?.rows[0];
    expect(row?.payload).toEqual({
      kind: 'geometry',
      geometry: { ...afterSpanFor(combo.gesture, combo.role), flagged: false, ghostRuns: [] },
    });
  }
}

function assertExtendCascade(combo: Combo, flow: Flow): void {
  if (combo.mode === 'never') {
    expect(flow.cascades.every(isEmptyPlan)).toBe(true);
    return;
  }
  if (combo.mode === 'ask') expect(flow.cascades[0]?.prompt?.kind).toBe('extend');
  const settled = flow.cascades[combo.mode === 'ask' ? 1 : 0] as Plan;
  expect(settled.writes.length).toBe(combo.instances);
  for (const write of settled.writes) {
    expect(write.unmirrored).toBe('ancestor-extend-refresh-only');
  }
  expect(settled.echoes).toEqual([]);
  expect(settled.reverts).toEqual([]); // a failed extend leaves per-row state (pinned)
}

function assertCascadeShape(combo: Combo, flow: Flow, fixture: Fixture): void {
  if (flow.settlement.kind === 'aborted' || flow.settlement.kind === 'no-cascade') {
    expect(flow.cascades.every(isEmptyPlan)).toBe(true);
    return;
  }
  switch (expectedCascadeGate(combo)) {
    case 'subtree':
      assertSubtreeCascade(combo, flow, fixture);
      break;
    case 'shrink':
      assertShrinkCascade(combo, flow, fixture);
      break;
    case 'extend':
      assertExtendCascade(combo, flow);
      break;
    default:
      expect(flow.cascades.every(isEmptyPlan)).toBe(true);
  }
}

function assertRow(combo: Combo): void {
  const fixture = buildFixture(combo.role, combo.instances);
  const flow = driveFlow(combo, fixture, derivation());
  assertUniversalInvariants(fixture, [flow.first, flow.committed, ...flow.cascades]);
  if (combo.gesture === 'progress') {
    assertProgressRow(combo, flow);
    return;
  }
  if (combo.gesture === 'none') {
    expect(isEmptyPlan(flow.committed)).toBe(true);
    expect(flow.settlement.kind).toBe('no-cascade');
    expect(flow.cascades.every(isEmptyPlan)).toBe(true);
    return;
  }
  assertCommittedShape(combo, flow, fixture);
  if (combo.persist === 'failure' && failureClassOf(combo)?.startsWith('main')) {
    expect(flow.committed.reverts[0]?.rows).toHaveLength(datedOf(fixture, T));
  }
  assertCascadeShape(combo, flow, fixture);
}

// ── The mechanical table ─────────────────────────────────────────────────────

describe('the planner table — mechanical enumeration', () => {
  it('the cross-product is fully partitioned: every combo is a row or carries one named rule', () => {
    expect(FULL_PRODUCT).toHaveLength(
      OUTCOMES.length * GESTURES.length * INSTANCE_COUNTS.length * ROLES.length * MODES.length * PERSISTS.length,
    );
    expect(TABLE_ROWS.length + EXCLUDED.length).toBe(FULL_PRODUCT.length);
    for (const combo of EXCLUDED) expect(typeof exclusionRule(combo)).toBe('string');
  });

  it('the reachable set lands at its enumerated size', () => {
    expect(TABLE_ROWS).toHaveLength(68);
  });

  it.each(
    TABLE_ROWS.map((combo) => [
      `${combo.outcome} × ${combo.gesture} × ${combo.instances} × ${combo.role} × ${combo.mode} × ${combo.persist}`,
      combo,
    ] as [string, Combo]),
  )('%s', (_label, combo) => {
    assertRow(combo);
  });
});

// ── Impossibility rules, asserted impossible ─────────────────────────────────

describe('impossible combinations are impossible by behavior, not skipped', () => {
  const deriv = derivation();

  it('a whole-bar move of an inferred task never prompts: write-as-today materialization (pinned R13)', () => {
    const fixture = buildFixture('leaf', 1);
    const gesture = buildGesture({ ...combo0('move'), outcome: 'write-as-today' }, fixture);
    (gesture as Extract<CommitGesture, { kind: 'bar' }>).before.dateStatus = 'inferred-end';
    const plan = planGestureCommit(gesture, fixture.instances, undefined, deriv);
    expect(plan.prompt).toBeNull();
    expect(plan.writes[0]?.patch.start).toBeDefined();
    expect(plan.writes[0]?.patch.end).toBeDefined();
    expect(plan.settlement.onSuccess.kind).toBe('plain');
  });

  it('a resize on the AUTHORED edge of an inferred task never prompts', () => {
    const fixture = buildFixture('leaf', 1);
    const gesture = buildGesture({ ...combo0('resize-end'), outcome: 'write-as-today' }, fixture);
    (gesture as Extract<CommitGesture, { kind: 'bar' }>).before.dateStatus = 'inferred-start';
    const plan = planGestureCommit(gesture, fixture.instances, undefined, deriv);
    expect(plan.prompt).toBeNull();
    expect(plan.settlement.onSuccess.kind).toBe('plain');
  });

  it('an unwritable estimate never prompts: the gate falls back to the date write', () => {
    const fixture = buildFixture('leaf', 1);
    const gesture = buildGesture({ ...combo0('resize-end'), outcome: 'prompt-estimate-only' }, fixture);
    (gesture as Extract<CommitGesture, { kind: 'bar' }>).estimateWritable = false;
    const plan = planGestureCommit(gesture, fixture.instances, undefined, deriv);
    expect(plan.prompt).toBeNull();
    expect(plan.writes[0]?.patch.estimate).toBeUndefined();
    expect(plan.writes[0]?.patch.start).toBeDefined();
  });

  it('a cancelled gesture cascades nothing, even with narrow ancestors and auto mode', () => {
    const fixture = buildFixture('has-ancestors', 1);
    const plan = planCascade(
      cascadeOutcomeFor({ ...combo0('resize-end'), role: 'has-ancestors' }, fixture, { kind: 'aborted' }),
      fixture.instances,
      { cascadeMode: 'auto' },
      deriv,
    );
    expect(isEmptyPlan(plan)).toBe(true);
  });

  it('auto mode lands the identical committed plan the prompt choice lands', () => {
    const fixture = buildFixture('leaf', 1);
    for (const action of ['estimate-only', 'estimate-and-dates'] as const) {
      const auto = resolveCommitted({ ...combo0('resize-end'), outcome: `auto-${action}` }, fixture, deriv);
      const prompted = resolveCommitted({ ...combo0('resize-end'), outcome: `prompt-${action}` }, fixture, deriv);
      expect(auto.committed).toEqual(prompted.committed);
    }
  });

  it('a growth resize never trips the shrink gate (only newly-orphaned children fit)', () => {
    const fixture = buildFixture('parent', 1);
    const outcome = cascadeOutcomeFor(combo0('resize-end'), fixture, { kind: 'plain' });
    outcome.after = { start: BEFORE.start, end: dayEnd('2026-08-10') }; // grows past both children
    const plan = planCascade(outcome, fixture.instances, { cascadeMode: 'ask' }, deriv);
    expect(plan.prompt).toBeNull();
    expect(isEmptyPlan(plan)).toBe(true);
  });

  function combo0(gesture: Gesture): Combo {
    return { outcome: 'prompt-estimate-only', gesture, instances: 1, role: 'leaf', mode: 'ask', persist: 'success' };
  }
});

// ── Named rows ───────────────────────────────────────────────────────────────

/** Mon–Fri working, Sat/Sun blocked — the derivation for the estimate-suppression rows. */
function weekendDerivation(): PlannerDerivation {
  const workingDaysIn = (span: { start: Date; end: Date }): number => {
    let count = 0;
    for (let d = new Date(span.start); d <= span.end; d = addDays(d, 1)) {
      if (d.getDay() !== 0 && d.getDay() !== 6) count += 1;
    }
    return Math.max(1, count);
  };
  return derivation({
    deriveEstimate: (_sourcePath, span) => ({
      days: workingDaysIn(span),
      start: span.start,
      end: span.end,
      flagged: false,
      ghostRuns: [],
    }),
  });
}

describe('named rows', () => {
  it('AE3: a 90-minute estimate survives a whole-bar move (no estimate write)', () => {
    const fixture: Fixture = { instances: [inst(T, T, '2026-08-03', '2026-08-03')], draggedId: T };
    const gesture: CommitGesture = {
      kind: 'bar',
      instanceId: T,
      before: { start: day('2026-08-03'), end: dayEnd('2026-08-03'), dateStatus: 'complete', estimateMinutes: 90 },
      after: { start: day('2026-08-04'), end: dayEnd('2026-08-04') },
      estimateWritable: true,
      inferredDragMode: 'ask',
    };
    const plan = planGestureCommit(gesture, fixture.instances, undefined, weekendDerivation());
    expect(plan.writes[0]?.patch.estimate).toBeUndefined();
    expect(plan.writes[0]?.patch.start).toEqual(day('2026-08-04'));
    expect(plan.writes[0]?.patch.end).toEqual(dayEnd('2026-08-04'));
  });

  it('R10: a resize spanning only blocked days writes dates and leaves the estimate untouched', () => {
    // Fri 08-07 (1 working day, 90-minute estimate) resized to Fri..Sun: still 1 working day.
    const fixture: Fixture = { instances: [inst(T, T, '2026-08-07', '2026-08-07')], draggedId: T };
    const gesture: CommitGesture = {
      kind: 'bar',
      instanceId: T,
      before: { start: day('2026-08-07'), end: dayEnd('2026-08-07'), dateStatus: 'complete', estimateMinutes: 90 },
      after: { start: day('2026-08-07'), end: dayEnd('2026-08-09') },
      estimateWritable: true,
      inferredDragMode: 'ask',
    };
    const plan = planGestureCommit(gesture, fixture.instances, undefined, weekendDerivation());
    expect(plan.writes[0]?.patch.estimate).toBeUndefined();
    expect(plan.writes[0]?.patch.end).toEqual(dayEnd('2026-08-09'));
  });

  it('R11: a day-granular no-op produces the empty plan', () => {
    const combo: Combo = { outcome: 'write-as-today', gesture: 'none', instances: 1, role: 'leaf', mode: 'ask', persist: 'success' };
    const fixture = buildFixture('leaf', 1);
    const flow = driveFlow(combo, fixture, derivation());
    expect(isEmptyPlan(flow.committed)).toBe(true);
    expect(flow.settlement.kind).toBe('no-cascade');
  });

  it('undo-restore pins restore-as-value: no authored estimate → the view default is written back', () => {
    const fixture = buildFixture('parent', 1);
    const outcome: CascadeOutcome = {
      instanceId: T,
      name: T,
      before: { start: BEFORE.start, end: BEFORE.end, estimateMinutes: null },
      after: { start: BEFORE.start, end: dayEnd('2026-08-04') },
      settlement: {
        kind: 'inferred',
        outcome: { action: 'estimate-and-dates', edge: 'end', estimateMinutes: spanDaysToMinutes(2) },
      },
    };
    const plan = planCascade(outcome, fixture.instances, { cascadeMode: 'ask', shrinkChoice: 'undo' }, derivation());
    expect(plan.writes[0]?.patch).toEqual({
      start: BEFORE.start,
      end: BEFORE.end,
      estimate: spanDaysToMinutes(2), // defaultDurationDays = 2
    });
  });

  it('undo-restore puts an authored sub-day estimate back as its value', () => {
    const fixture = buildFixture('parent', 1);
    const outcome: CascadeOutcome = {
      instanceId: T,
      name: T,
      before: { start: BEFORE.start, end: BEFORE.end, estimateMinutes: 90 },
      after: { start: BEFORE.start, end: dayEnd('2026-08-04') },
      settlement: {
        kind: 'inferred',
        outcome: { action: 'estimate-and-dates', edge: 'end', estimateMinutes: spanDaysToMinutes(2) },
      },
    };
    const plan = planCascade(outcome, fixture.instances, { cascadeMode: 'ask', shrinkChoice: 'undo' }, derivation());
    expect(plan.writes[0]?.patch.estimate).toBe(90);
  });

  it('estimate-only skips the shrink gate entirely (pinned: neither adjust nor undo may materialise the derived edge)', () => {
    const fixture = buildFixture('parent', 1);
    const outcome: CascadeOutcome = {
      instanceId: T,
      name: T,
      before: { start: BEFORE.start, end: BEFORE.end, estimateMinutes: STORED_ESTIMATE },
      after: { start: BEFORE.start, end: dayEnd('2026-08-04') },
      settlement: {
        kind: 'inferred',
        outcome: { action: 'estimate-only', edge: 'end', estimateMinutes: spanDaysToMinutes(2) },
      },
    };
    const plan = planCascade(outcome, fixture.instances, { cascadeMode: 'ask' }, derivation());
    expect(plan.prompt).toBeNull();
    expect(isEmptyPlan(plan)).toBe(true);
  });

  it('shrink handled → the extend gate is skipped (shrink and extend never co-occur)', () => {
    // T under a narrow parent AND over children: the shrink write ends the pass.
    const fixture: Fixture = {
      instances: [
        inst('P1', 'notes/P1.md', '2026-08-03', '2026-08-06'),
        inst('T#p1', T, '2026-08-03', '2026-08-06', 'P1'),
        inst('C1#a', C1, '2026-08-03', '2026-08-04', 'T#p1'),
        inst('C2#a', C2, '2026-08-05', '2026-08-06', 'T#p1'),
      ],
      draggedId: 'T#p1',
    };
    const outcome: CascadeOutcome = {
      instanceId: 'T#p1',
      name: T,
      before: { start: BEFORE.start, end: BEFORE.end, estimateMinutes: STORED_ESTIMATE },
      after: { start: BEFORE.start, end: dayEnd('2026-08-04') },
      settlement: { kind: 'plain' },
    };
    const plan = planCascade(outcome, fixture.instances, { cascadeMode: 'auto' }, derivation());
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]?.unmirrored).toBeUndefined();
    expect(plan.resume).toBeNull(); // the pass ends here — no extend follows
  });

  it('estimate-only cascades from the REAL derived span, not the optimistic dragged span', () => {
    const fixture = buildFixture('has-ancestors', 1);
    const derived = { start: day('2026-08-03'), end: dayEnd('2026-08-06'), flagged: false, ghostRuns: [] };
    const deriv = derivation({ deriveSpan: () => derived });
    const outcome: CascadeOutcome = {
      instanceId: 'T#p1',
      name: T,
      before: { start: BEFORE.start, end: BEFORE.end, estimateMinutes: STORED_ESTIMATE },
      after: { start: BEFORE.start, end: dayEnd('2026-08-08') }, // optimistic span exceeds P1
      settlement: {
        kind: 'inferred',
        outcome: { action: 'estimate-only', edge: 'end', estimateMinutes: spanDaysToMinutes(6) },
      },
    };
    // The derived span stays inside P1's window → no extension is proposed.
    const plan = planCascade(outcome, fixture.instances, { cascadeMode: 'auto' }, deriv);
    expect(isEmptyPlan(plan)).toBe(true);
  });

  it('queue interaction: first fails after second queued — the dequeued gesture re-plans from the reverted world', () => {
    const fixture = buildFixture('leaf', 2);
    const combo: Combo = { outcome: 'write-as-today', gesture: 'resize-end', instances: 2, role: 'leaf', mode: 'ask', persist: 'failure' };
    const first = driveFlow(combo, fixture, derivation());
    // The failed first gesture reverted every row to the pre-drag snapshot…
    for (const row of first.committed.reverts[0]?.rows ?? []) {
      expect(row.payload).toEqual({
        kind: 'geometry',
        geometry: { start: BEFORE.start, end: BEFORE.end, flagged: false, ghostRuns: [] },
      });
    }
    // …so the second gesture, planned at dequeue from those same facts, captures
    // the ORIGINAL revert baseline — never the first gesture's optimistic dates.
    const second = planGestureCommit(
      buildGesture({ ...combo, gesture: 'move', persist: 'success' }, fixture),
      fixture.instances,
      undefined,
      derivation(),
    );
    expect(second.reverts[0]?.rows[0]?.payload).toEqual({
      kind: 'geometry',
      geometry: { start: BEFORE.start, end: BEFORE.end, flagged: false, ghostRuns: [] },
    });
  });

  it('queue interaction: first succeeds then second executes — the dequeued gesture re-plans from post-settlement facts', () => {
    const fixture = buildFixture('leaf', 2);
    const landed = afterSpanFor('resize-end', 'leaf');
    // The executor refreshed the rows to the first gesture's landed span before dequeue.
    const settledInstances = fixture.instances.map((i) =>
      i.sourcePath === T ? { ...i, start: landed.start, end: landed.end } : i,
    );
    const second = planGestureCommit(
      {
        kind: 'bar',
        instanceId: fixture.draggedId,
        before: { start: landed.start, end: landed.end, dateStatus: 'complete', estimateMinutes: STORED_ESTIMATE },
        after: { start: addDays(landed.start, 7), end: addDays(landed.end, 7) },
        estimateWritable: true,
        inferredDragMode: 'ask',
      },
      settledInstances,
      undefined,
      derivation(),
    );
    expect(second.reverts[0]?.rows[0]?.payload).toEqual({
      kind: 'geometry',
      geometry: { start: landed.start, end: landed.end, flagged: false, ghostRuns: [] },
    });
  });

  it('a parent pure-move whose main persist FAILS cascades nothing: the aborted settlement yields the empty plan', () => {
    const fixture = buildFixture('parent', 1);
    const combo: Combo = { outcome: 'write-as-today', gesture: 'move', instances: 1, role: 'parent', mode: 'auto', persist: 'failure' };
    const { committed } = resolveCommitted(combo, fixture, derivation());
    expect(committed.settlement.onFailure.kind).toBe('aborted');
    const cascade = planCascade(
      cascadeOutcomeFor(combo, fixture, committed.settlement.onFailure),
      fixture.instances,
      { cascadeMode: 'auto' },
      derivation(),
    );
    expect(isEmptyPlan(cascade)).toBe(true);
  });

  it('neither unmirrored marker can exempt an estimate-only write', () => {
    const instances = [inst(T, T, '2026-08-03', '2026-08-06')];
    for (const unmirrored of ['progress-by-design', 'ancestor-extend-refresh-only'] as const) {
      const plan = {
        ...emptyPlan(),
        writes: [{ sourcePath: T, instanceId: T, patch: { estimate: 7200 }, unmirrored }],
      };
      expect(verifyMirrorCoverage(plan, instances)).toHaveLength(1);
    }
  });

  it('an estimate-only write demands geometry coverage like a date write', () => {
    const instances = [inst(T, T, '2026-08-03', '2026-08-06')];
    const plan = {
      ...emptyPlan(),
      writes: [{ sourcePath: T, instanceId: T, patch: { estimate: 7200 } }],
    };
    expect(verifyMirrorCoverage(plan, instances)).toEqual([
      `${T}: instance ${T} lacks a geometry echo`,
    ]);
  });

  it('a progress echo row never satisfies geometry mirror coverage', () => {
    const instances = [inst(T, T, '2026-08-03', '2026-08-06')];
    const plan = {
      ...emptyPlan(),
      writes: [{ sourcePath: T, instanceId: T, patch: { start: day('2026-08-10'), end: dayEnd('2026-08-13') } }],
      echoes: [{ sourcePath: T, rows: [{ instanceId: T, payload: { kind: 'progress' as const, progress: 10 } }] }],
    };
    expect(verifyMirrorCoverage(plan, instances)).toEqual([
      `${T}: instance ${T} lacks a geometry echo`,
    ]);
  });

  it('progress-by-design on a geometry patch is a coverage violation, not an exemption', () => {
    const instances = [inst(T, T, '2026-08-03', '2026-08-06')];
    const plan = {
      ...emptyPlan(),
      writes: [{
        sourcePath: T,
        instanceId: T,
        patch: { start: day('2026-08-10'), end: dayEnd('2026-08-13') },
        unmirrored: 'progress-by-design' as const,
      }],
    };
    expect(verifyMirrorCoverage(plan, instances)).toEqual([
      `${T}: progress-by-design cannot exempt a geometry write`,
    ]);
  });

  it('ancestor-extend-refresh-only on a progress patch is a coverage violation', () => {
    const instances = [inst(T, T, '2026-08-03', '2026-08-06')];
    const plan = {
      ...emptyPlan(),
      writes: [{
        sourcePath: T,
        instanceId: T,
        patch: { progress: 40 },
        unmirrored: 'ancestor-extend-refresh-only' as const,
      }],
    };
    expect(verifyMirrorCoverage(plan, instances)).toEqual([
      `${T}: ancestor-extend-refresh-only marks date-only extensions`,
    ]);
  });

  it('mixed subtree persistence: the failed source reverts to snapshot; the persisted shift still drives the extend re-plan', () => {
    // C1 and C2 each have a second placement under an alternate parent (W1/W2)
    // that does NOT move with T — the persisted child's shift must extend ITS
    // alternate parent; the failed child's must not.
    const fixture: Fixture = {
      instances: [
        inst(T, T, '2026-08-03', '2026-08-06'),
        inst('C1#t', C1, '2026-08-03', '2026-08-04', T),
        inst('C2#t', C2, '2026-08-05', '2026-08-06', T),
        inst('W1', 'notes/W1.md', '2026-08-01', '2026-08-08'),
        inst('C1#w', C1, '2026-08-03', '2026-08-04', 'W1'),
        inst('W2', 'notes/W2.md', '2026-08-01', '2026-08-08'),
        inst('C2#w', C2, '2026-08-05', '2026-08-06', 'W2'),
      ],
      draggedId: T,
    };
    const outcome: CascadeOutcome = {
      instanceId: T,
      name: T,
      before: { start: BEFORE.start, end: BEFORE.end, estimateMinutes: STORED_ESTIMATE },
      after: { start: addDays(BEFORE.start, 7), end: addDays(BEFORE.end, 7) },
      settlement: { kind: 'plain' },
    };
    const first = planCascade(outcome, fixture.instances, { cascadeMode: 'auto' }, derivation());
    expect(first.resume).toBe('after-subtree');
    expect(first.writes.map((w) => w.sourcePath).sort()).toEqual([C1, C2]);
    // The failed source's carried revert restores BOTH its placements to snapshot.
    const c2Revert = first.reverts.find((r) => r.sourcePath === C2);
    expect(c2Revert?.rows).toEqual([
      { instanceId: 'C2#t', payload: { kind: 'geometry', geometry: { start: day('2026-08-05'), end: dayEnd('2026-08-06'), flagged: false, ghostRuns: [] } } },
      { instanceId: 'C2#w', payload: { kind: 'geometry', geometry: { start: day('2026-08-05'), end: dayEnd('2026-08-06'), flagged: false, ghostRuns: [] } } },
    ]);
    // Resume with only C1 persisted: W1 (C1's alternate parent) is extended; W2 is not.
    const second = planCascade(
      outcome,
      fixture.instances,
      { cascadeMode: 'auto', persistedSubtreeSources: [C1] },
      derivation(),
    );
    expect(second.writes.map((w) => w.sourcePath)).toEqual(['notes/W1.md']);
    expect(second.writes[0]?.unmirrored).toBe('ancestor-extend-refresh-only');
    expect(second.writes[0]?.patch.end).toEqual(addDays(dayEnd('2026-08-04'), 7));
  });

  it('an estimate-only outcome whose derived day-count matches the stored estimate writes nothing, still echoes and settles inferred', () => {
    const instances = [
      inst('P1', 'notes/P1.md', '2026-08-07', '2026-08-07'),
      inst('T#p1', T, '2026-08-07', '2026-08-07', 'P1'),
    ];
    // The derived span deliberately differs from the optimistic drag (ends 08-10,
    // not 08-09) so the cascade seeding is provably the DERIVED span.
    const derivedGeom = {
      start: day('2026-08-07'),
      end: dayEnd('2026-08-10'),
      flagged: false,
      ghostRuns: [{ startDate: '2026-08-08', days: 2 }],
    };
    const deriv: PlannerDerivation = { ...weekendDerivation(), deriveSpan: () => derivedGeom };
    const gesture: CommitGesture = {
      kind: 'bar',
      instanceId: 'T#p1',
      // Fri, 1 working day, 90-minute estimate; resized over the weekend keeps 1 working day.
      before: { start: day('2026-08-07'), end: dayEnd('2026-08-07'), dateStatus: 'inferred-end', estimateMinutes: 90 },
      after: { start: day('2026-08-07'), end: dayEnd('2026-08-09') },
      estimateWritable: true,
      inferredDragMode: 'ask',
    };
    const plan = planGestureCommit(gesture, instances, { action: 'estimate-only' }, deriv);
    expect(plan.writes).toEqual([]);
    expect(plan.reverts).toEqual([]);
    expect(plan.echoes[0]?.rows).toEqual([
      { instanceId: 'T#p1', payload: { kind: 'geometry', geometry: derivedGeom } },
    ]);
    expect(plan.settlement.onSuccess.kind).toBe('inferred');
    // The cascade still runs estimate-only seeding: the DERIVED end (08-10, past
    // the optimistic 08-09) is what exceeds P1 and sizes its extension.
    const cascade = planCascade(
      {
        instanceId: 'T#p1',
        name: T,
        before: { start: day('2026-08-07'), end: dayEnd('2026-08-07'), estimateMinutes: 90 },
        after: gesture.after,
        settlement: plan.settlement.onSuccess,
      },
      instances,
      { cascadeMode: 'auto' },
      deriv,
    );
    expect(cascade.writes.map((w) => w.sourcePath)).toEqual(['notes/P1.md']);
    expect(cascade.writes[0]?.unmirrored).toBe('ancestor-extend-refresh-only');
    expect(cascade.writes[0]?.patch.end).toEqual(dayEnd('2026-08-10'));
  });

  it('stacked drags: `before` captured from the live optimistic span makes a drag back to the original dates a WRITE, never a no-op', () => {
    // First gesture A→B is queued/in flight: the controller snapshot
    // (`instances`) still holds A — self-write echoes skip recomputation —
    // while the SVAR row the user grabs shows the optimistic B. The capture
    // reads the STORE span, so before=B, after=A is a real move that writes
    // A back over the first persist.
    const fixture = buildFixture('leaf', 1);
    const spanA = { start: BEFORE.start, end: BEFORE.end };
    const spanB = { start: addDays(BEFORE.start, 7), end: addDays(BEFORE.end, 7) };
    const revertDrag: CommitGesture = {
      kind: 'bar',
      instanceId: fixture.draggedId,
      before: { ...spanB, dateStatus: 'complete', estimateMinutes: STORED_ESTIMATE },
      after: spanA,
      estimateWritable: true,
      inferredDragMode: 'ask',
    };
    const plan = planGestureCommit(revertDrag, fixture.instances, undefined, derivation());
    expect(isEmptyPlan(plan)).toBe(false);
    expect(plan.writes[0]?.patch.start).toEqual(spanA.start);
    expect(plan.writes[0]?.patch.end).toEqual(spanA.end);
    // The revert baseline stays on CONTROLLER facts (`instances` = A): a failed
    // persist leaves the note untouched, so a refresh re-derives A — never the
    // first gesture's optimistic B, which its own persist may yet fail.
    expect(plan.reverts[0]?.rows[0]?.payload).toEqual({
      kind: 'geometry',
      geometry: { start: spanA.start, end: spanA.end, flagged: false, ghostRuns: [] },
    });
    // A STALE capture (before read from `instances` = A) is exactly the silent-
    // divergence bug this pins: before == after collapses to the empty plan.
    const staleCapture = planGestureCommit(
      { ...revertDrag, before: { ...spanA, dateStatus: 'complete', estimateMinutes: STORED_ESTIMATE } },
      fixture.instances,
      undefined,
      derivation(),
    );
    expect(isEmptyPlan(staleCapture)).toBe(true);
  });

  it('a genuinely no-op jiggle (live-store before == after) still yields the empty plan', () => {
    const fixture = buildFixture('leaf', 1);
    const plan = planGestureCommit(
      {
        kind: 'bar',
        instanceId: fixture.draggedId,
        before: { start: BEFORE.start, end: BEFORE.end, dateStatus: 'complete', estimateMinutes: STORED_ESTIMATE },
        after: { start: day('2026-08-03'), end: day('2026-08-06') }, // same days
        estimateWritable: true,
        inferredDragMode: 'ask',
      },
      fixture.instances,
      undefined,
      derivation(),
    );
    expect(isEmptyPlan(plan)).toBe(true);
    expect(plan.settlement.onSuccess.kind).toBe('no-cascade');
  });

  it('a calendar-days task under split rendering echoes its real ghost runs after a drag (null day count, full geometry)', () => {
    const fixture = buildFixture('leaf', 2);
    const after = afterSpanFor('resize-end', 'leaf'); // 2026-08-03 .. 2026-08-08
    const geometry = {
      start: after.start,
      end: after.end,
      flagged: false,
      ghostRuns: [{ startDate: '2026-08-08', days: 1 }],
    };
    // Calendar-days: no working-day axis, so the day count is null (nothing
    // recounts) — but split rendering still gives the span real ghost runs,
    // and the echo must carry them, never the plain-geometry fallback.
    const deriv = derivation({ deriveEstimate: () => ({ days: null, ...geometry }) });
    const plan = planGestureCommit(
      buildGesture(
        { outcome: 'write-as-today', gesture: 'resize-end', instances: 2, role: 'leaf', mode: 'ask', persist: 'success' },
        fixture,
      ),
      fixture.instances,
      undefined,
      deriv,
    );
    // A null count falls back to the calendar-day span for the estimate write.
    expect(plan.writes[0]?.patch.estimate).toBe(
      spanDaysToMinutes(inclusiveDaySpan(after.start, after.end)),
    );
    expect(plan.echoes[0]?.rows).toHaveLength(2);
    for (const row of plan.echoes[0]?.rows ?? []) {
      expect(row.payload).toEqual({ kind: 'geometry', geometry });
    }
  });

  it('echoes carry the authority\'s FULL geometry — flag and ghost runs included', () => {
    const fixture = buildFixture('leaf', 2);
    const geometry = {
      start: day('2026-08-03'),
      end: dayEnd('2026-08-11'),
      flagged: false,
      ghostRuns: [{ startDate: '2026-08-08', days: 2 }],
    };
    const deriv = derivation({ deriveEstimate: () => ({ days: 6, ...geometry }) });
    const plan = planGestureCommit(
      buildGesture(
        { outcome: 'write-as-today', gesture: 'resize-end', instances: 2, role: 'leaf', mode: 'ask', persist: 'success' },
        fixture,
      ),
      fixture.instances,
      undefined,
      deriv,
    );
    expect(plan.echoes[0]?.rows).toHaveLength(2);
    for (const row of plan.echoes[0]?.rows ?? []) {
      expect(row.payload).toEqual({ kind: 'geometry', geometry });
    }
  });
});

describe('memoizePlannerDerivation (the per-gesture derivation memo)', () => {
  const geometry = (iso: string) => ({
    start: day(iso),
    end: dayEnd(iso),
    flagged: false,
    ghostRuns: [],
  });
  const baseDerivation = (): PlannerDerivation => ({
    minutesToSpanDays,
    spanDaysToMinutes,
    inclusiveDaySpan,
  });

  it('materializes an identical deriveEstimate query once and replays the same answer', () => {
    const deriveEstimate = jest.fn((_source: string, span: { start: Date; end: Date }) => ({
      ...geometry('2026-03-02'),
      start: span.start,
      end: span.end,
      days: 3,
    }));
    const memoized = memoizePlannerDerivation({ ...baseDerivation(), deriveEstimate });
    const span = { start: day('2026-03-02'), end: dayEnd('2026-03-04') };

    const first = memoized.deriveEstimate!('a.md', span);
    const again = memoized.deriveEstimate!('a.md', { ...span });

    expect(deriveEstimate).toHaveBeenCalledTimes(1);
    expect(again).toBe(first);
  });

  it('computes distinct deriveEstimate queries separately (different source or span)', () => {
    const deriveEstimate = jest.fn(() => ({ ...geometry('2026-03-02'), days: 1 }));
    const memoized = memoizePlannerDerivation({ ...baseDerivation(), deriveEstimate });
    const span = { start: day('2026-03-02'), end: dayEnd('2026-03-04') };

    memoized.deriveEstimate!('a.md', span);
    memoized.deriveEstimate!('b.md', span);
    memoized.deriveEstimate!('a.md', { start: span.start, end: dayEnd('2026-03-05') });

    expect(deriveEstimate).toHaveBeenCalledTimes(3);
  });

  it('memoizes deriveSpan by (source, edge, anchor, minutes)', () => {
    const deriveSpan = jest.fn(() => geometry('2026-03-02'));
    const memoized = memoizePlannerDerivation({ ...baseDerivation(), deriveSpan });

    const first = memoized.deriveSpan!('a.md', 'end', day('2026-03-02'), 480);
    const again = memoized.deriveSpan!('a.md', 'end', day('2026-03-02'), 480);
    memoized.deriveSpan!('a.md', 'end', day('2026-03-02'), 960);

    expect(deriveSpan).toHaveBeenCalledTimes(2);
    expect(again).toBe(first);
  });

  it('shares one gesture memo across wrapper instances, and a fresh memo starts cold', () => {
    const deriveEstimate = jest.fn(() => ({ ...geometry('2026-03-02'), days: 2 }));
    const memo: DerivationMemo = new Map();
    const span = { start: day('2026-03-02'), end: dayEnd('2026-03-03') };

    // The container builds a NEW wrapper per plan call but hands every call of
    // one gesture the same memo — the estimate/echo/re-plan calls share facts.
    memoizePlannerDerivation({ ...baseDerivation(), deriveEstimate }, memo).deriveEstimate!('a.md', span);
    memoizePlannerDerivation({ ...baseDerivation(), deriveEstimate }, memo).deriveEstimate!('a.md', span);
    expect(deriveEstimate).toHaveBeenCalledTimes(1);

    // The next gesture's fresh memo never sees the previous gesture's answers.
    memoizePlannerDerivation({ ...baseDerivation(), deriveEstimate }, new Map()).deriveEstimate!('a.md', span);
    expect(deriveEstimate).toHaveBeenCalledTimes(2);
  });

  it('passes conversions through untouched and keeps absent authority callbacks absent', () => {
    const memoized = memoizePlannerDerivation({ ...baseDerivation(), defaultDurationDays: 5 });
    expect(memoized.deriveEstimate).toBeUndefined();
    expect(memoized.deriveSpan).toBeUndefined();
    expect(memoized.minutesToSpanDays).toBe(minutesToSpanDays);
    expect(memoized.spanDaysToMinutes).toBe(spanDaysToMinutes);
    expect(memoized.inclusiveDaySpan).toBe(inclusiveDaySpan);
    expect(memoized.defaultDurationDays).toBe(5);
  });
});
