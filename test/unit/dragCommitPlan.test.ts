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
  type PlannerInstance,
} from '../../src/bases/dragCommitPlan';
import { createDequeueBeforeRebase } from '../../src/bases/dragDequeueRebase';
import { planCascade, planGestureCommit, type PlannerDerivation } from '../../src/bases/dragCommitPlanner';
import {
  inclusiveDaySpan,
  minutesToSpanDays,
  spanDaysToMinutes,
} from '../../src/controller/durationConversion';

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

describe('overlayStoreGeometry', () => {
  it('uses the store span when the store answers with real Dates, keeping every non-geometry field from the controller row', () => {
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
