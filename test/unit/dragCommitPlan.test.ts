/**
 * overlayStoreGeometry: the cascade snapshot's settled-geometry overlay.
 * Controller rows lag optimistic echoes (self-write events skip recompute),
 * so the fresh snapshot lays live SVAR store spans over each row's geometry
 * while every frontmatter-derived fact stays with the controller row.
 */
import { describe, it, expect } from '@jest/globals';
import {
  overlayStoreGeometry,
  pureMoveBefore,
  type BarBefore,
  type LiveGeometryTask,
  type PlannerInstance,
  type SourceEchoes,
} from '../../src/bases/dragCommitPlan';
import { createDequeueBeforeRebase } from '../../src/bases/dragDequeueRebase';
import { planCascade, planGestureCommit, type PlannerDerivation } from '../../src/bases/dragCommitPlanner';
import {
  applyEchoToBaseline,
  createAppliedGanttSyncState,
  type AppliedGanttSyncState,
} from '../../src/bases/ganttSyncCoordinator';
import {
  inclusiveDaySpan,
  minutesToSpanDays,
  spanDaysToMinutes,
} from '../../src/controller/durationConversion';
import {
  buildSvarTasks,
  echoTaskPatch,
  planTaskSync,
  taskStateKey,
  type SvarTask,
  type SvarTaskInputs,
} from '../../src/bases/ganttSync';
import { hasDerivedBarGeometry } from '../../src/bases/eventRowGuards';
import { makeCalendarItemId, type CalendarOccupancy } from '../../src/datasource/calendarItems';
import type { RenderInstance } from '../../src/controller/InstanceExpansion';

const day = (iso: string): Date => new Date(`${iso}T00:00:00`);
const dayEnd = (iso: string): Date => new Date(`${iso}T23:59:59.999`);
const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

interface OverlayRow extends PlannerInstance {
  dateStatus: string | null;
  estimateMinutes: number | null;
}

const row = (id: string, startIso: string, endIso: string, parent?: string): OverlayRow => ({
  id,
  sourcePath: id,
  text: id,
  parent,
  start: day(startIso),
  end: dayEnd(endIso),
  ghostRuns: [{ startDate: startIso, days: 2 }],
  stretchFlagged: true,
  dateStatus: 'inferred-end',
  estimateMinutes: 480,
});

/** A store row whose bar is the derived occupancy envelope, not authored dates. */
const envelopeStoreRow = (): LiveGeometryTask => ({
  start: day('2026-02-01'),
  end: dayEnd('2026-04-30'),
  custom: {
    occupancyRuns: [{ startDate: '2026-02-01', days: 3, stateClass: 'done' }],
    occupancyEnvelope: true,
  },
});

const plannerDerivation = (): PlannerDerivation => ({
  minutesToSpanDays,
  spanDaysToMinutes,
  inclusiveDaySpan,
  defaultDurationDays: 2,
});

/** One recurring-instance occupancy fact for a day. */
const occupiedDay = (sourcePath: string, dayIso: string): CalendarOccupancy => ({
  family: 'recurring-instance',
  itemId: makeCalendarItemId('recurring-instance', sourcePath, dayIso),
  day: dayIso,
  minutes: null,
  stateClass: 'completed',
});

/** The live store task of an occupancy row, exactly as buildSvarTasks issues it. */
function occupancyStoreTask(
  sourcePath: string,
  startIso: string,
  endIso: string,
  occupiedIsos: readonly string[],
): SvarTask {
  const instance: RenderInstance = {
    id: sourcePath,
    sourcePath,
    text: sourcePath,
    start: day(startIso),
    end: dayEnd(endIso),
    progress: 0,
    isVirtual: false,
    isCollapsed: false,
    dateStatus: 'complete',
    estimateMinutes: null,
    status: null,
    priority: null,
    isFetched: false,
    isTopLevelPlacement: false,
    occupancy: occupiedIsos.map((iso) => occupiedDay(sourcePath, iso)),
    plainBarSuppressed: true,
  };
  const taskInputs: SvarTaskInputs = {
    instances: [instance],
    links: [],
    statusColors: [],
    barFillSource: 'default',
    showDateIndicators: false,
    arrowMode: 'primary',
  };
  return buildSvarTasks(taskInputs)[0]!;
}

/** The live store task of a plain (occupancy-free) row, exactly as buildSvarTasks issues it. */
function plainStoreTask(sourcePath: string, startIso: string, endIso: string): SvarTask {
  const instance: RenderInstance = {
    id: sourcePath,
    sourcePath,
    text: sourcePath,
    start: day(startIso),
    end: dayEnd(endIso),
    progress: 0,
    isVirtual: false,
    isCollapsed: false,
    dateStatus: 'complete',
    estimateMinutes: null,
    status: null,
    priority: null,
    isFetched: false,
    isTopLevelPlacement: false,
  };
  return buildSvarTasks({
    instances: [instance],
    links: [],
    statusColors: [],
    barFillSource: 'default',
    showDateIndicators: false,
    arrowMode: 'primary',
  })[0]!;
}

/** Minimal SVAR store surface: id -> live row, advanced only by echoes. */
type EchoStore = Map<string, { start: Date; end: Date; custom?: SvarTask['custom'] }>;

/** The production diff baseline, seeded from built tasks like the mount seed. */
function baselineOf(...tasks: SvarTask[]): AppliedGanttSyncState {
  return createAppliedGanttSyncState({ tasks, links: [] }, 'base-sort');
}

function storeRowOf(...tasks: SvarTask[]): EchoStore {
  return new Map(
    tasks.map((task) => [
      task.id,
      { start: task.start as Date, end: task.end as Date, custom: task.custom },
    ]),
  );
}

/** GanttContainer.echoSourceGeometry verbatim: each echoed row patches the live
 *  store over its current custom AND mirrors the same patch into the baseline. */
function emitEchoes(
  store: EchoStore,
  baseline: AppliedGanttSyncState,
  echoes: ReadonlyArray<SourceEchoes>,
): void {
  for (const source of echoes) {
    for (const echoRow of source.rows) {
      const patch = echoTaskPatch(echoRow.payload, store.get(echoRow.instanceId)?.custom);
      applyEchoToBaseline(baseline, echoRow.instanceId, patch);
      if (!('start' in patch)) continue;
      store.set(echoRow.instanceId, {
        start: patch.start,
        end: patch.end,
        ...(patch.custom !== undefined ? { custom: patch.custom } : {}),
      });
    }
  }
}

describe('overlayStoreGeometry', () => {
  it('uses the store span when the store answers with real Dates; a custom-less live row leaves every other field with the controller row', () => {
    const controller = [row('a.md', '2026-08-03', '2026-08-06')];
    const storeStart = day('2026-08-10');
    const storeEnd = dayEnd('2026-08-13');

    const overlaid = overlayStoreGeometry(controller, () => ({ start: storeStart, end: storeEnd }));

    expect(overlaid[0]?.start).toBe(storeStart);
    expect(overlaid[0]?.end).toBe(storeEnd);
    expect(overlaid[0]?.dateStatus).toBe('inferred-end');
    expect(overlaid[0]?.estimateMinutes).toBe(480);
    expect(overlaid[0]?.ghostRuns).toEqual([{ startDate: '2026-08-03', days: 2 }]);
    expect(overlaid[0]?.stretchFlagged).toBe(true);
  });

  it('adopts the live custom geometry fields with the span: a restore echo repaints the echoed ghost runs, not stale ones', () => {
    const controller = [row('a.md', '2026-08-03', '2026-08-06')];
    const liveRuns = [{ startDate: '2026-08-10', days: 1 }];

    const overlaid = overlayStoreGeometry(controller, () => ({
      start: day('2026-08-10'),
      end: dayEnd('2026-08-13'),
      custom: { ghostRuns: liveRuns, stretchFlagged: undefined },
    }));

    // The echoes advanced ghost runs and the flag alongside the span, so the
    // live custom record is the truth — the stale snapshot values must not
    // survive into a later cancel/failure restore.
    expect(overlaid[0]?.ghostRuns).toBe(liveRuns);
    expect(overlaid[0]?.stretchFlagged).toBeUndefined();
    expect(overlaid[0]?.dateStatus).toBe('inferred-end');
    expect(overlaid[0]?.estimateMinutes).toBe(480);
  });

  it('falls back per-row: a missing store row or a non-Date span leaves that row untouched while others overlay', () => {
    const controller = [
      row('missing.md', '2026-08-03', '2026-08-04'),
      row('string-span.md', '2026-08-03', '2026-08-04'),
      row('half-dated.md', '2026-08-03', '2026-08-04'),
      row('live.md', '2026-08-03', '2026-08-04'),
    ];
    const spans: Record<string, { start?: unknown; end?: unknown } | undefined> = {
      'missing.md': undefined,
      'string-span.md': { start: '2026-08-10', end: '2026-08-11' },
      'half-dated.md': { start: day('2026-08-10'), end: undefined },
      'live.md': { start: day('2026-08-10'), end: dayEnd('2026-08-11') },
    };

    const overlaid = overlayStoreGeometry(controller, (id) => spans[id]);

    expect(overlaid[0]).toBe(controller[0]);
    expect(overlaid[1]).toBe(controller[1]);
    expect(overlaid[2]).toBe(controller[2]);
    expect(overlaid[3]?.start).toEqual(day('2026-08-10'));
    expect(overlaid[3]?.end).toEqual(dayEnd('2026-08-11'));
  });

  it('never overlays the dragged row (exceptId): its dequeue-time store span is the post-drag position, which would void the cancel/failure restore', () => {
    const controller = [
      row('dragged.md', '2026-08-03', '2026-08-06'),
      row('sibling.md', '2026-08-03', '2026-08-04'),
    ];
    const postDrag = { start: day('2026-08-10'), end: dayEnd('2026-08-13') };

    const overlaid = overlayStoreGeometry(controller, () => postDrag, 'dragged.md');

    expect(overlaid[0]).toBe(controller[0]); // restore baseline stays pre-drag
    expect(overlaid[1]?.start).toEqual(postDrag.start);
  });

  it('leaves a derived-bar-geometry row at its authored span (the store span is the occupancy envelope) while still overlaying plain rows', () => {
    const controller = [
      row('recurring.md', '2026-02-10', '2026-02-14'),
      row('plain.md', '2026-08-03', '2026-08-04'),
    ];
    const store: Record<string, LiveGeometryTask | undefined> = {
      'recurring.md': envelopeStoreRow(),
      'plain.md': { start: day('2026-08-10'), end: dayEnd('2026-08-11') },
    };

    const overlaid = overlayStoreGeometry(controller, (id) => store[id]);

    expect(overlaid[0]).toBe(controller[0]); // authored scheduled/due kept, envelope refused
    expect(overlaid[1]?.start).toEqual(day('2026-08-10'));
    expect(overlaid[1]?.end).toEqual(dayEnd('2026-08-11'));
  });

  it('a pure parent move cascades a recurring child by its AUTHORED dates + delta, never the shifted envelope', () => {
    const controller: PlannerInstance[] = [
      row('P.md', '2026-01-01', '2026-05-31'),
      row('C.md', '2026-02-10', '2026-02-14', 'P.md'),
    ];
    // Production wiring: the child's store row answers the derived occupancy
    // envelope (Feb 1 – Apr 30), far wider than its authored scheduled/due.
    const snapshot = overlayStoreGeometry(
      controller,
      (id) => (id === 'C.md' ? envelopeStoreRow() : undefined),
      'P.md',
    );

    // The parent moves +2d.
    const plan = planCascade(
      {
        instanceId: 'P.md',
        name: 'P',
        before: { start: day('2026-01-01'), end: dayEnd('2026-05-31'), estimateMinutes: null },
        after: { start: day('2026-01-03'), end: dayEnd('2026-06-02') },
        settlement: { kind: 'plain' },
      },
      snapshot,
      { cascadeMode: 'auto' },
      plannerDerivation(),
    );

    // Authored Feb 10 – Feb 14 shifted +2d — not the envelope's Feb 3 / May 2.
    const patch = plan.writes.find((w) => w.sourcePath === 'C.md')?.patch;
    expect(patch?.start).toEqual(day('2026-02-12'));
    expect(patch?.end).toEqual(dayEnd('2026-02-16'));
  });

  it("a parent shrink fits to the recurring child's AUTHORED range, never its occupancy envelope", () => {
    const controller: PlannerInstance[] = [
      row('P.md', '2026-01-01', '2026-05-31'),
      row('C.md', '2026-02-10', '2026-03-20', 'P.md'),
    ];
    const snapshot = overlayStoreGeometry(
      controller,
      (id) => (id === 'C.md' ? envelopeStoreRow() : undefined),
      'P.md',
    );

    // The parent's end resizes May 31 → Mar 15, into the child.
    const plan = planCascade(
      {
        instanceId: 'P.md',
        name: 'P',
        before: { start: day('2026-01-01'), end: dayEnd('2026-05-31'), estimateMinutes: null },
        after: { start: day('2026-01-01'), end: dayEnd('2026-03-15') },
        settlement: { kind: 'plain' },
      },
      snapshot,
      { cascadeMode: 'auto' },
      plannerDerivation(),
    );

    // Fit wraps the authored child end (Mar 20) — not the envelope's Apr 30.
    const patch = plan.writes.find((w) => w.sourcePath === 'P.md')?.patch;
    expect(patch?.start).toEqual(day('2026-01-01'));
    expect(patch?.end).toEqual(dayEnd('2026-03-20'));
  });

  it('stacked parent moves: the second cascade shifts the subtree from the FIRST move\'s echoed child spans, one delta only', () => {
    // Controller rows still hold pre-first-drag geometry (self-write events
    // skip recomputation); the store carries the first move's +7d echoes.
    const controller: PlannerInstance[] = [
      row('T.md', '2026-08-03', '2026-08-06'),
      row('C1.md', '2026-08-03', '2026-08-04', 'T.md'),
      row('C2.md', '2026-08-05', '2026-08-06', 'T.md'),
    ];
    const echoedPlusSeven = (id: string) => {
      const stale = controller.find((i) => i.id === id);
      return { start: addDays(stale?.start as Date, 7), end: addDays(stale?.end as Date, 7) };
    };
    // Production wiring: the dragged row is excluded — planCascade reads its
    // geometry from the gesture outcome, never from the snapshot.
    const snapshot = overlayStoreGeometry(controller, echoedPlusSeven, 'T.md');
    const derivation: PlannerDerivation = {
      minutesToSpanDays,
      spanDaysToMinutes,
      inclusiveDaySpan,
      defaultDurationDays: 2,
    };

    // The second gesture moves the parent a further +3d off its echoed span.
    const plan = planCascade(
      {
        instanceId: 'T.md',
        name: 'T',
        before: { start: day('2026-08-10'), end: dayEnd('2026-08-13'), estimateMinutes: null },
        after: { start: day('2026-08-13'), end: dayEnd('2026-08-16') },
        settlement: { kind: 'plain' },
      },
      snapshot,
      { cascadeMode: 'auto' },
      derivation,
    );

    // Children move by the second delta from their ECHOED spans (+7d +3d = +10d
    // off the stale controller rows), never double-derived from the originals.
    const patchOf = (source: string) => plan.writes.find((w) => w.sourcePath === source)?.patch;
    expect(patchOf('C1.md')?.start).toEqual(day('2026-08-13'));
    expect(patchOf('C1.md')?.end).toEqual(dayEnd('2026-08-14'));
    expect(patchOf('C2.md')?.start).toEqual(day('2026-08-15'));
    expect(patchOf('C2.md')?.end).toEqual(dayEnd('2026-08-16'));
  });
});

describe('cascade echoes over an occupancy child (production echo wiring)', () => {
  it("stacked parent moves: the second cascade compounds the occupancy child from the first move's echoed span, exactly like its plain sibling", () => {
    // Controller rows lag at pre-first-drag geometry (self-write events skip
    // recomputation); the store carries the first move's +7d echoes, produced
    // through the REAL echo path over each row's live custom record.
    const controller: PlannerInstance[] = [
      row('T.md', '2026-08-03', '2026-08-06'),
      row('C1.md', '2026-08-03', '2026-08-04', 'T.md'),
      row('R.md', '2026-08-03', '2026-08-04', 'T.md'),
    ];
    const preEchoCustom = occupancyStoreTask('R.md', '2026-08-03', '2026-08-04', ['2026-08-03']).custom;
    const storeOf = (id: string): LiveGeometryTask | undefined => {
      const stale = controller.find((i) => i.id === id);
      if (!stale) return undefined;
      const geometry = {
        start: addDays(stale.start as Date, 7),
        end: addDays(stale.end as Date, 7),
        flagged: false,
        ghostRuns: [],
      };
      const patch = echoTaskPatch(
        { kind: 'geometry', geometry },
        id === 'R.md' ? preEchoCustom : undefined,
      );
      if (!('start' in patch)) throw new Error('geometry echo expected');
      return { start: patch.start, end: patch.end, custom: patch.custom };
    };
    const snapshot = overlayStoreGeometry(controller, storeOf, 'T.md');

    // The second gesture moves the parent a further +3d off its echoed span.
    const plan = planCascade(
      {
        instanceId: 'T.md',
        name: 'T',
        before: { start: day('2026-08-10'), end: dayEnd('2026-08-13'), estimateMinutes: null },
        after: { start: day('2026-08-13'), end: dayEnd('2026-08-16') },
        settlement: { kind: 'plain' },
      },
      snapshot,
      { cascadeMode: 'auto' },
      plannerDerivation(),
    );

    // Both children compound identically: +7d echo then +3d = +10d off the
    // stale controller rows. The occupancy child's vault frontmatter already
    // holds the +7d write, so seeding it from the stale authored span would
    // write it BACKWARD.
    const patchOf = (source: string) => plan.writes.find((w) => w.sourcePath === source)?.patch;
    expect(patchOf('C1.md')?.start).toEqual(day('2026-08-13'));
    expect(patchOf('C1.md')?.end).toEqual(dayEnd('2026-08-14'));
    expect(patchOf('R.md')?.start).toEqual(day('2026-08-13'));
    expect(patchOf('R.md')?.end).toEqual(dayEnd('2026-08-14'));
  });

  it('an aborted cascade reverts the occupancy child to its snapshot span, and the next genuine refresh re-issues its envelope and marks', () => {
    const controller: PlannerInstance[] = [
      row('T.md', '2026-08-03', '2026-08-06'),
      row('R.md', '2026-08-03', '2026-08-04', 'T.md'),
    ];
    const storeTask = occupancyStoreTask('R.md', '2026-08-03', '2026-08-04', ['2026-08-03', '2026-08-20']);
    const baseline = baselineOf(storeTask);
    const store = storeRowOf(storeTask);
    const snapshot = overlayStoreGeometry(controller, (id) => store.get(id), 'T.md');
    const plan = planCascade(
      {
        instanceId: 'T.md',
        name: 'T',
        before: { start: day('2026-08-03'), end: dayEnd('2026-08-06'), estimateMinutes: null },
        after: { start: day('2026-08-10'), end: dayEnd('2026-08-13') },
        settlement: { kind: 'plain' },
      },
      snapshot,
      { cascadeMode: 'auto' },
      plannerDerivation(),
    );

    // Forward echo (emitted before the write): the row shows the executor-owned
    // span as a plain bar — the derived marks do not survive a geometry echo.
    emitEchoes(store, baseline, plan.echoes);
    const echoed = store.get('R.md')!;
    expect(echoed.start).toEqual(day('2026-08-10'));
    expect(echoed.end).toEqual(dayEnd('2026-08-11'));
    expect(hasDerivedBarGeometry(echoed.custom)).toBe(false);

    // The write fails → the revert restores the snapshot's authored span; the
    // span the revert writes is still echo-owned, so it renders plain too.
    emitEchoes(store, baseline, plan.reverts);
    const reverted = store.get('R.md')!;
    expect(reverted.start).toEqual(day('2026-08-03'));
    expect(reverted.end).toEqual(dayEnd('2026-08-04'));
    expect(hasDerivedBarGeometry(reverted.custom)).toBe(false);

    // The failed write never changed the vault, so the refresh rebuilds the
    // IDENTICAL task — only the echo-mirrored baseline can trigger the diff
    // update that re-issues the envelope span, its marks, and the drag veto.
    const refreshed = occupancyStoreTask('R.md', '2026-08-03', '2026-08-04', ['2026-08-03', '2026-08-20']);
    expect(taskStateKey(refreshed)).toBe(taskStateKey(storeTask));
    const sync = planTaskSync(baseline.tasks, [refreshed]);
    const update = sync.updates.find((u) => u.id === 'R.md');
    expect(update?.task.custom.occupancyEnvelope).toBe(true);
    expect(update?.task.custom.occupancyRuns).toHaveLength(2);
    expect(update?.task.start).toEqual(day('2026-08-03'));
    expect(update?.task.end).toEqual(dayEnd('2026-08-20'));
    expect(hasDerivedBarGeometry(update?.task.custom)).toBe(true);
  });

  it('a successful cascade over write-invariant occupancy (recorded days) still gets its envelope re-issued by the next refresh', () => {
    const controller: PlannerInstance[] = [
      row('T.md', '2026-08-03', '2026-08-06'),
      row('R.md', '2026-08-03', '2026-08-04', 'T.md'),
    ];
    // Recorded completions on Aug 10 + Aug 20: days that do NOT move with the
    // authored scheduled/due write.
    const storeTask = occupancyStoreTask('R.md', '2026-08-03', '2026-08-04', ['2026-08-10', '2026-08-20']);
    const baseline = baselineOf(storeTask);
    const store = storeRowOf(storeTask);
    const snapshot = overlayStoreGeometry(controller, (id) => store.get(id), 'T.md');
    const plan = planCascade(
      {
        instanceId: 'T.md',
        name: 'T',
        before: { start: day('2026-08-03'), end: dayEnd('2026-08-06'), estimateMinutes: null },
        after: { start: day('2026-08-10'), end: dayEnd('2026-08-13') },
        settlement: { kind: 'plain' },
      },
      snapshot,
      { cascadeMode: 'auto' },
      plannerDerivation(),
    );
    const write = plan.writes.find((w) => w.sourcePath === 'R.md');
    expect(write?.patch.start).toEqual(day('2026-08-10'));
    expect(write?.patch.end).toEqual(dayEnd('2026-08-11'));
    emitEchoes(store, baseline, plan.echoes); // the write SUCCEEDS: no reverts

    // The write moved only authored dates; the occupied days are recorded
    // facts, so the refreshed row is state-key-IDENTICAL to the pre-drag
    // baseline — only the echo-mirrored baseline can trigger the re-issue.
    const refreshed = occupancyStoreTask('R.md', '2026-08-10', '2026-08-11', ['2026-08-10', '2026-08-20']);
    expect(taskStateKey(refreshed)).toBe(taskStateKey(storeTask));
    const sync = planTaskSync(baseline.tasks, [refreshed]);
    const update = sync.updates.find((u) => u.id === 'R.md');
    expect(update?.task.custom.occupancyEnvelope).toBe(true);
    expect(update?.task.start).toEqual(day('2026-08-10'));
    expect(update?.task.end).toEqual(dayEnd('2026-08-20'));
    expect(hasDerivedBarGeometry(update?.task.custom)).toBe(true);
  });
});

describe('plain-row echoes and the diff baseline (production echo wiring)', () => {
  const cascadePlusSevenDays = (store: EchoStore) => {
    const controller: PlannerInstance[] = [
      row('T.md', '2026-08-03', '2026-08-06'),
      row('C1.md', '2026-08-03', '2026-08-04', 'T.md'),
    ];
    return planCascade(
      {
        instanceId: 'T.md',
        name: 'T',
        before: { start: day('2026-08-03'), end: dayEnd('2026-08-06'), estimateMinutes: null },
        after: { start: day('2026-08-10'), end: dayEnd('2026-08-13') },
        settlement: { kind: 'plain' },
      },
      overlayStoreGeometry(controller, (id) => store.get(id), 'T.md'),
      { cascadeMode: 'auto' },
      plannerDerivation(),
    );
  };

  it('a successful write needs no re-issue: the refresh derives exactly the echoed geometry and the mirrored baseline already agrees', () => {
    const storeTask = plainStoreTask('C1.md', '2026-08-03', '2026-08-04');
    const baseline = baselineOf(storeTask);
    const store = storeRowOf(storeTask);

    emitEchoes(store, baseline, cascadePlusSevenDays(store).echoes);
    expect(baseline.tasks.get('C1.md')?.start).toEqual(day('2026-08-10'));
    expect(baseline.tasks.get('C1.md')?.end).toEqual(dayEnd('2026-08-11'));

    const refreshed = plainStoreTask('C1.md', '2026-08-10', '2026-08-11');
    const sync = planTaskSync(baseline.tasks, [refreshed]);
    expect(sync.updates).toHaveLength(0);
    expect(sync.adds).toHaveLength(0);
    expect(sync.deletes).toHaveLength(0);
    expect(sync.moves).toHaveLength(0);
  });

  it('a dangling echo against an unchanged vault is repainted: the refresh re-issues the row back to its authored span', () => {
    const storeTask = plainStoreTask('C1.md', '2026-08-03', '2026-08-04');
    const baseline = baselineOf(storeTask);
    const store = storeRowOf(storeTask);

    emitEchoes(store, baseline, cascadePlusSevenDays(store).echoes);

    const refreshed = plainStoreTask('C1.md', '2026-08-03', '2026-08-04');
    expect(taskStateKey(refreshed)).toBe(taskStateKey(storeTask));
    const sync = planTaskSync(baseline.tasks, [refreshed]);
    const update = sync.updates.find((u) => u.id === 'C1.md');
    expect(update?.task.start).toEqual(day('2026-08-03'));
    expect(update?.task.end).toEqual(dayEnd('2026-08-04'));
  });

  it('a failed write round-trips: the revert mirrors the authored span back, so the unchanged-vault refresh is a no-op', () => {
    const storeTask = plainStoreTask('C1.md', '2026-08-03', '2026-08-04');
    const baseline = baselineOf(storeTask);
    const store = storeRowOf(storeTask);
    const plan = cascadePlusSevenDays(store);

    emitEchoes(store, baseline, plan.echoes);
    emitEchoes(store, baseline, plan.reverts);
    expect(baseline.tasks.get('C1.md')?.start).toEqual(day('2026-08-03'));
    expect(baseline.tasks.get('C1.md')?.end).toEqual(dayEnd('2026-08-04'));

    const refreshed = plainStoreTask('C1.md', '2026-08-03', '2026-08-04');
    const sync = planTaskSync(baseline.tasks, [refreshed]);
    expect(sync.updates).toHaveLength(0);
  });
});

describe('createDequeueBeforeRebase', () => {
  const gestureBefore = (): BarBefore => ({
    start: day('2026-08-03'),
    end: dayEnd('2026-08-04'),
    dateStatus: 'inferred-end',
    estimateMinutes: 480,
  });
  const after = { start: day('2026-08-10'), end: dayEnd('2026-08-11') };

  it('keeps the gesture-time SPAN while the live row still holds this gesture\'s own post-drag span, yet re-reads the authored facts', () => {
    const live: BarBefore = { ...after, dateStatus: 'complete', estimateMinutes: 960 };
    const rebase = createDequeueBeforeRebase({ gestureBefore: gestureBefore(), after, readLive: () => live });

    rebase.atDequeue();

    expect(rebase.before()).toEqual({
      start: gestureBefore().start,
      end: gestureBefore().end,
      dateStatus: 'complete',
      estimateMinutes: 960,
    });
  });

  it("trusts the live span over the equality guard when a predecessor's echo moved the row to exactly this gesture's target", () => {
    // Drag A→B fails and reverts the row to A while this queued B→A gesture
    // waits: the live row equals the gesture's own `after`, so span equality
    // alone would keep the stale B capture and baseline a failure revert at B
    // though the vault is at A. The predecessor-echo signal breaks the tie.
    const revertedToA: BarBefore = {
      start: after.start,
      end: after.end,
      dateStatus: 'complete',
      estimateMinutes: 960,
    };
    const rebase = createDequeueBeforeRebase({
      gestureBefore: gestureBefore(),
      after,
      readLive: () => revertedToA,
      movedByPredecessor: () => true,
    });

    rebase.atDequeue();

    expect(rebase.before()).toEqual(revertedToA);
  });

  it('still keeps the gesture-time span at its own target when no predecessor echoed the source', () => {
    const live: BarBefore = { ...after, dateStatus: 'complete', estimateMinutes: 960 };
    const rebase = createDequeueBeforeRebase({
      gestureBefore: gestureBefore(),
      after,
      readLive: () => live,
      movedByPredecessor: () => false,
    });

    rebase.atDequeue();

    expect(rebase.before()).toEqual({ ...gestureBefore(), dateStatus: 'complete', estimateMinutes: 960 });
  });

  it('rebases the span from a live row someone else moved, facts included', () => {
    const settled: BarBefore = {
      start: day('2026-08-01'),
      end: dayEnd('2026-08-02'),
      dateStatus: 'complete',
      estimateMinutes: 960,
    };
    const rebase = createDequeueBeforeRebase({ gestureBefore: gestureBefore(), after, readLive: () => settled });

    rebase.atDequeue();

    expect(rebase.before()).toEqual(settled);
  });

  it('rebases ONCE: later dequeue marks (cascade-round snapshots) reuse the first capture', () => {
    const live: BarBefore = {
      start: day('2026-08-01'),
      end: dayEnd('2026-08-02'),
      dateStatus: 'inferred-end',
      estimateMinutes: 480,
    };
    const rebase = createDequeueBeforeRebase({ gestureBefore: gestureBefore(), after, readLive: () => ({ ...live }) });

    rebase.atDequeue();
    const first = rebase.before();
    live.start = day('2026-08-20');
    live.end = dayEnd('2026-08-21');
    live.estimateMinutes = 999;
    rebase.atDequeue();

    expect(rebase.before()).toBe(first);
  });

  it('keeps the gesture-time span when the live read answers without Dates, still refreshing non-null facts', () => {
    const rebase = createDequeueBeforeRebase({
      gestureBefore: gestureBefore(),
      after,
      readLive: () => ({ start: null, end: null, dateStatus: null, estimateMinutes: 960 }),
    });

    rebase.atDequeue();

    expect(rebase.before()).toEqual({ ...gestureBefore(), estimateMinutes: 960 });
  });

  it('is untouched before the dequeue mark: the gesture-time capture is the effective one', () => {
    const rebase = createDequeueBeforeRebase({
      gestureBefore: gestureBefore(),
      after,
      readLive: () => {
        throw new Error('must not read the live row before dequeue');
      },
    });

    expect(rebase.before()).toEqual(gestureBefore());
  });

  it('estimate-only resize, then a queued resize back: the dequeue facts refresh plans the estimate write back down, where the gesture-time copy would suppress it', () => {
    // The note's estimate settled at 5 days while this gesture waited; its own
    // gesture-time capture still says 3 days. The bar sits at the gesture's own
    // post-drag 3-day span, so the span guard skips — only the facts refresh
    // can surface the needed write.
    const fiveDaySpan = { start: day('2026-08-03'), end: dayEnd('2026-08-07') };
    const threeDaySpan = { start: day('2026-08-03'), end: dayEnd('2026-08-05') };
    const staleCapture: BarBefore = {
      ...fiveDaySpan,
      dateStatus: 'inferred-end',
      estimateMinutes: spanDaysToMinutes(3),
    };
    const settledFacts: BarBefore = {
      ...threeDaySpan,
      dateStatus: 'inferred-end',
      estimateMinutes: spanDaysToMinutes(5),
    };
    const instances: PlannerInstance[] = [
      { id: 'a.md#0', sourcePath: 'a.md', text: 'T', ...fiveDaySpan },
    ];
    const derivation: PlannerDerivation = { minutesToSpanDays, spanDaysToMinutes, inclusiveDaySpan };
    const gestureOf = (before: BarBefore) =>
      ({
        kind: 'bar',
        instanceId: 'a.md#0',
        before,
        after: threeDaySpan,
        estimateWritable: true,
        inferredDragMode: 'estimate-only',
      }) as const;
    const rebase = createDequeueBeforeRebase({ gestureBefore: staleCapture, after: threeDaySpan, readLive: () => settledFacts });

    rebase.atDequeue();
    const plan = planGestureCommit(gestureOf(rebase.before()), instances, undefined, derivation);
    const stalePlan = planGestureCommit(gestureOf(staleCapture), instances, undefined, derivation);

    expect(plan.writes).toEqual([
      { sourcePath: 'a.md', instanceId: 'a.md#0', patch: { estimate: spanDaysToMinutes(3) } },
    ]);
    // The unrebased capture writes nothing: 3 derived days match its stale
    // 3-day estimate, leaving the note at 5 days while the bar echoes 3.
    expect(stalePlan.writes).toEqual([]);
  });
});

describe('pureMoveBefore', () => {
  const before = (startIso: string, endIso: string): BarBefore => ({
    start: day(startIso),
    end: dayEnd(endIso),
    dateStatus: 'complete',
    estimateMinutes: null,
  });

  it('hands the cascade its origin for a pure move (both edges shifted equally)', () => {
    const b = before('2026-08-03', '2026-08-04');
    const after = { start: day('2026-08-06'), end: dayEnd('2026-08-07') };
    expect(pureMoveBefore(b, after)).toBe(b);
  });

  it('opts a resize out of origin inheritance: a halted resize owes no displacement', () => {
    const b = before('2026-08-03', '2026-08-04');
    const resize = { start: day('2026-08-03'), end: dayEnd('2026-08-06') };
    expect(pureMoveBefore(b, resize)).toBeUndefined();
  });

  it('opts an unmoved gesture and a span-less placeholder out too', () => {
    const b = before('2026-08-03', '2026-08-04');
    expect(pureMoveBefore(b, { start: b.start as Date, end: b.end as Date })).toBeUndefined();
    const dateless: BarBefore = { start: null, end: null, dateStatus: null, estimateMinutes: null };
    expect(pureMoveBefore(dateless, { start: day('2026-08-06'), end: dayEnd('2026-08-07') })).toBeUndefined();
  });
});
