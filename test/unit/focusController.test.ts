/**
 * Unit tests for the pure focusController module.
 *
 * All tests are DOM-free, SVAR-free, and Obsidian-free — pure data-in/data-out.
 * AAA structure, one behaviour per test.
 */

import { describe, it, expect } from '@jest/globals';
import {
  resolveAncestorsToOpen,
  estimatePixelsPerDay,
  selectZoomLevel,
  buildFocusPlan,
  dedupeInstancesBySource,
  focusItemText,
  pickActiveFocusEntry,
} from '../../src/bases/focusController';
import type { FocusInstance, ZoomLevel } from '../../src/bases/focusController';
import { buildZoomConfig } from '../../src/bases/zoomConfig';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeInstance(overrides: Partial<FocusInstance> & { id: string; sourcePath: string }): FocusInstance {
  return {
    text: overrides.id,
    start: null,
    end: null,
    ...overrides,
  };
}

/** A three-level chain: root → mid → leaf */
function makeChain(): FocusInstance[] {
  return [
    makeInstance({ id: 'root', sourcePath: 'root.md' }),
    makeInstance({ id: 'mid', sourcePath: 'mid.md', parent: 'root' }),
    makeInstance({ id: 'leaf', sourcePath: 'leaf.md', parent: 'mid' }),
  ];
}

/** Simple zoom levels for deterministic selectZoomLevel tests. */
function makeLevel(minCell: number, maxCell: number, finestUnit: string): ZoomLevel {
  return {
    minCellWidth: minCell,
    maxCellWidth: maxCell,
    scales: [{ unit: finestUnit, step: 1, format: '' }],
  };
}

// ---------------------------------------------------------------------------
// resolveAncestorsToOpen
// ---------------------------------------------------------------------------

describe('resolveAncestorsToOpen', () => {
  it('3-deep nest all collapsed → returns all three, root-first order', () => {
    const instances = makeChain();
    const isCollapsed = (_id: string) => true;

    const result = resolveAncestorsToOpen(instances, 'leaf', isCollapsed);

    expect(result).toEqual(['root', 'mid']);
  });

  it('middle ancestor already open → returns only the collapsed ones, root-first', () => {
    const instances = makeChain();
    // root=collapsed, mid=open, leaf is target
    const isCollapsed = (id: string) => id === 'root';

    const result = resolveAncestorsToOpen(instances, 'leaf', isCollapsed);

    expect(result).toEqual(['root']);
  });

  it('top-level target (no parent) → empty array', () => {
    const instances = makeChain();
    const isCollapsed = (_id: string) => true;

    const result = resolveAncestorsToOpen(instances, 'root', isCollapsed);

    expect(result).toEqual([]);
  });

  it('missing parent link → stops gracefully without throwing', () => {
    const instances: FocusInstance[] = [
      makeInstance({ id: 'child', sourcePath: 'child.md', parent: 'ghost' }),
    ];
    const isCollapsed = (_id: string) => true;

    expect(() => resolveAncestorsToOpen(instances, 'child', isCollapsed)).not.toThrow();
    const result = resolveAncestorsToOpen(instances, 'child', isCollapsed);
    // 'ghost' is not in the instance list → chain stops; no ids collected
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// estimatePixelsPerDay
// ---------------------------------------------------------------------------

describe('estimatePixelsPerDay', () => {
  it('finest unit day → repCellWidth px per day', () => {
    const level: ZoomLevel = makeLevel(40, 120, 'day');
    const repCell = (40 + 120) / 2; // 80

    expect(estimatePixelsPerDay(level)).toBeCloseTo(repCell / 1);
  });

  it('finest unit month → approximately repCellWidth / 30', () => {
    const level: ZoomLevel = makeLevel(60, 140, 'month');
    const repCell = (60 + 140) / 2; // 100

    expect(estimatePixelsPerDay(level)).toBeCloseTo(repCell / 30);
  });

  it('year level yields fewer px/day than a day level (monotonic)', () => {
    const yearLevel: ZoomLevel = makeLevel(100, 300, 'year');
    const dayLevel: ZoomLevel = makeLevel(40, 80, 'day');

    expect(estimatePixelsPerDay(yearLevel)).toBeLessThan(estimatePixelsPerDay(dayLevel));
  });
});

// ---------------------------------------------------------------------------
// selectZoomLevel
// ---------------------------------------------------------------------------

describe('selectZoomLevel', () => {
  /** Deterministic injected pixelsPerDay: index+1 px/day (higher index = more zoomed in). */
  function ppd(levels: ZoomLevel[]) {
    return (l: ZoomLevel) => (levels.indexOf(l) + 1);
  }

  it('short bar on a wide chart → a high (fine) index', () => {
    // 5 levels; ppd: 1,2,3,4,5 px/day
    // durationDays=3, chartWidth=2000
    // barPx at each level: 3,6,9,12,15 px — all ≤ 1000 (50% of 2000)
    // → should return index 4 (largest satisfying)
    const levels = [1, 2, 3, 4, 5].map((_, i) => makeLevel(10 * (i + 1), 20 * (i + 1), 'day'));
    const result = selectZoomLevel({ durationDays: 3, chartWidthPx: 2000, levels, pixelsPerDay: ppd(levels) });

    expect(result).toBe(4);
  });

  it('multi-month bar → a lower (coarse) index', () => {
    // durationDays=120, chartWidth=1000 → 50% = 500
    // barPx at each level: 120*1=120, 120*2=240, 120*3=360, 120*4=480, 120*5=600
    // levels 0–3 satisfy (≤500), level 4 does not → largest satisfying = index 3
    const levels = [1, 2, 3, 4, 5].map((_, i) => makeLevel(10 * (i + 1), 20 * (i + 1), 'day'));
    const result = selectZoomLevel({ durationDays: 120, chartWidthPx: 1000, levels, pixelsPerDay: ppd(levels) });

    expect(result).toBe(3);
  });

  it('bar that exceeds 50% at every level → returns 0', () => {
    // durationDays=1000, chartWidth=100 → 50% = 50
    // barPx at each level: 1000*1=1000, ... all > 50 → return 0
    const levels = [1, 2, 3].map((_, i) => makeLevel(10 * (i + 1), 20 * (i + 1), 'day'));
    const result = selectZoomLevel({ durationDays: 1000, chartWidthPx: 100, levels, pixelsPerDay: ppd(levels) });

    expect(result).toBe(0);
  });

  it('chosen level barPx ≤ 0.5 * chartWidthPx whenever any level satisfies it', () => {
    // durationDays=50, chartWidth=1000 → 50% = 500
    // ppd: 1,2,3,4,5; barPx: 50,100,150,200,250 → all satisfy; largest=4
    const levels = [1, 2, 3, 4, 5].map((_, i) => makeLevel(10 * (i + 1), 20 * (i + 1), 'day'));
    const chosen = selectZoomLevel({ durationDays: 50, chartWidthPx: 1000, levels, pixelsPerDay: ppd(levels) });
    const chosenLevel = levels[chosen];
    const barPx = 50 * ppd(levels)(chosenLevel);

    expect(barPx).toBeLessThanOrEqual(0.5 * 1000);
  });

  it('picks the densest fitting level on the REAL (non-monotonic) ladder, not the highest index', () => {
    // The shipped ladder's px/day is non-monotonic by index: L4 (day, rep 55) is
    // denser than L5 (week+day, rep 42.5), and L6 (hour) is far denser than all.
    // For a 10-day bar on a 2000px chart (half = 1000), every level except L6
    // fits; the densest fitting level is L4 (55 px/day > L5's 42.5), NOT the
    // highest fitting index L5. The old "largest index" rule would wrongly pick 5.
    const levels = buildZoomConfig('day').levels;
    const result = selectZoomLevel({ durationDays: 10, chartWidthPx: 2000, levels });

    expect(result).toBe(4);
  });

  it('uses estimatePixelsPerDay when no pixelsPerDay injector provided', () => {
    // Coarsest level (year); durationDays=365, chartWidth=10000 → should be fine
    const levels = [
      makeLevel(100, 300, 'year'),
      makeLevel(40, 80, 'day'),
    ];
    // Just assert it doesn't throw and returns a valid index
    const result = selectZoomLevel({ durationDays: 365, chartWidthPx: 10000, levels });

    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThan(levels.length);
  });
});

// ---------------------------------------------------------------------------
// buildFocusPlan
// ---------------------------------------------------------------------------

describe('buildFocusPlan', () => {
  const levels: ZoomLevel[] = [1, 2, 3].map((_, i) => makeLevel(10 * (i + 1), 20 * (i + 1), 'day'));
  // Inject deterministic ppd: 1, 2, 3 px/day
  const pixelsPerDay = (l: ZoomLevel) => (levels.indexOf(l) + 1);

  const baseOpts = {
    levels,
    chartWidthPx: 1000,
    isCollapsed: (_id: string) => false,
  };

  it('complete start+end (end > start) → fit=true, centerDate=midpoint, numeric targetLevel', () => {
    const start = new Date('2024-01-01T00:00:00Z');
    const end = new Date('2024-01-11T00:00:00Z'); // 10 days
    const instances: FocusInstance[] = [
      makeInstance({ id: 'task-a', sourcePath: 'a.md', start, end }),
    ];

    const plan = buildFocusPlan({
      ...baseOpts,
      instances,
      targetId: 'task-a',
      pixelsPerDay,
    });

    expect(plan.fit).toBe(true);
    expect(plan.targetLevel).not.toBeNull();
    expect(typeof plan.targetLevel).toBe('number');
    // centerDate = midpoint
    const expectedCenter = new Date((start.getTime() + end.getTime()) / 2);
    expect(plan.centerDate).toEqual(expectedCenter);
    expect(plan.ancestorsToOpen).toEqual([]);
  });

  it('milestone (start only, no end) → fit=false, targetLevel=null, centerDate=start', () => {
    const start = new Date('2024-03-15T00:00:00Z');
    const instances: FocusInstance[] = [
      makeInstance({ id: 'milestone', sourcePath: 'milestone.md', start }),
    ];

    const plan = buildFocusPlan({ ...baseOpts, instances, targetId: 'milestone', pixelsPerDay });

    expect(plan.fit).toBe(false);
    expect(plan.targetLevel).toBeNull();
    expect(plan.centerDate).toEqual(start);
  });

  it('end ≤ start → treated as partial (fit=false, centerDate=start)', () => {
    const start = new Date('2024-06-01T00:00:00Z');
    const end = new Date('2024-05-01T00:00:00Z'); // end before start
    const instances: FocusInstance[] = [
      makeInstance({ id: 'bad-dates', sourcePath: 'bad.md', start, end }),
    ];

    const plan = buildFocusPlan({ ...baseOpts, instances, targetId: 'bad-dates', pixelsPerDay });

    expect(plan.fit).toBe(false);
    expect(plan.targetLevel).toBeNull();
    expect(plan.centerDate).toEqual(start);
  });

  it('no dates → fit=false, centerDate=null', () => {
    const instances: FocusInstance[] = [
      makeInstance({ id: 'no-dates', sourcePath: 'no-dates.md' }),
    ];

    const plan = buildFocusPlan({ ...baseOpts, instances, targetId: 'no-dates', pixelsPerDay });

    expect(plan.fit).toBe(false);
    expect(plan.targetLevel).toBeNull();
    expect(plan.centerDate).toBeNull();
  });

  it('ancestorsToOpen reflects collapsed ancestors', () => {
    const instances: FocusInstance[] = [
      makeInstance({ id: 'parent-a', sourcePath: 'parent-a.md' }),
      makeInstance({ id: 'child-a', sourcePath: 'child-a.md', parent: 'parent-a' }),
    ];
    const isCollapsed = (id: string) => id === 'parent-a';

    const plan = buildFocusPlan({
      ...baseOpts,
      instances,
      targetId: 'child-a',
      isCollapsed,
      pixelsPerDay,
    });

    expect(plan.ancestorsToOpen).toEqual(['parent-a']);
  });

  it('missing target → safe empty-ish plan', () => {
    const instances: FocusInstance[] = [
      makeInstance({ id: 'task-x', sourcePath: 'x.md' }),
    ];

    const plan = buildFocusPlan({ ...baseOpts, instances, targetId: 'nonexistent', pixelsPerDay });

    expect(plan).toEqual({
      ancestorsToOpen: [],
      targetLevel: null,
      centerDate: null,
      fit: false,
    });
  });
});

// ---------------------------------------------------------------------------
// dedupeInstancesBySource
// ---------------------------------------------------------------------------

describe('dedupeInstancesBySource', () => {
  it('two instances with same sourcePath (multi-parent) → keeps first, preserves order', () => {
    const instances: FocusInstance[] = [
      makeInstance({ id: 'inst-1', sourcePath: 'shared.md', text: 'first' }),
      makeInstance({ id: 'inst-2', sourcePath: 'unique.md', text: 'unique' }),
      makeInstance({ id: 'inst-3', sourcePath: 'shared.md', text: 'second' }),
    ];

    const result = dedupeInstancesBySource(instances);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('inst-1');
    expect(result[0].text).toBe('first');
    expect(result[1].id).toBe('inst-2');
  });
});

// ---------------------------------------------------------------------------
// focusItemText
// ---------------------------------------------------------------------------

describe('focusItemText', () => {
  it('contains both the task name and the source path', () => {
    const instance = makeInstance({ id: 't1', sourcePath: 'folder/task.md', text: 'My Task' });
    const result = focusItemText(instance);

    expect(result).toContain('My Task');
    expect(result).toContain('folder/task.md');
  });
});

// ---------------------------------------------------------------------------
// pickActiveFocusEntry
// ---------------------------------------------------------------------------

describe('pickActiveFocusEntry', () => {
  /** A fake container that "contains" exactly the elements in its set. */
  function container(...owned: object[]): { contains(other: unknown): boolean } {
    const set = new Set<unknown>(owned);
    return { contains: (other: unknown) => set.has(other) };
  }

  it('returns the entry whose container is inside the active leaf', () => {
    const c1 = {};
    const c2 = {};
    const entries = new Map<object, string>([
      [c1, 'entry-1'],
      [c2, 'entry-2'],
    ]);
    const active = container(c2); // active leaf contains c2

    expect(pickActiveFocusEntry(entries, active)).toBe('entry-2');
  });

  it('falls back to the most-recently-registered entry when the active leaf matches none', () => {
    const c1 = {};
    const c2 = {};
    const entries = new Map<object, string>([
      [c1, 'entry-1'],
      [c2, 'entry-2'],
    ]);
    const active = container(); // contains nothing registered

    expect(pickActiveFocusEntry(entries, active)).toBe('entry-2');
  });

  it('falls back to the last entry when no active container is given', () => {
    const entries = new Map<object, string>([
      [{}, 'entry-1'],
      [{}, 'entry-2'],
    ]);

    expect(pickActiveFocusEntry(entries, null)).toBe('entry-2');
  });

  it('returns null when there are no entries', () => {
    expect(pickActiveFocusEntry(new Map<object, string>(), container())).toBeNull();
  });
});
