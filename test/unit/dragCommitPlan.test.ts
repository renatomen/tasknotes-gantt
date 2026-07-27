/**
 * overlayStoreGeometry: the cascade snapshot's settled-geometry overlay.
 * Controller rows lag optimistic echoes (self-write events skip recompute),
 * so the fresh snapshot lays live SVAR store spans over each row's geometry
 * while every frontmatter-derived fact stays with the controller row.
 */
import { describe, it, expect } from '@jest/globals';
import { overlayStoreGeometry, type PlannerInstance } from '../../src/bases/dragCommitPlan';
import { planCascade, type PlannerDerivation } from '../../src/bases/dragCommitPlanner';
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
