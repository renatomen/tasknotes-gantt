/**
 * cascadeGate unit tests (plan U2) — subtree move + gated ancestor extend.
 *
 * - normalizeCascadeMode: arbitrary value → valid mode (default ask)
 * - classifyUpdateEvent: syncing/echo/user-gesture/action/ignore (five SVAR tags)
 * - collectAncestorIds: parent-chain walk, cycle-guarded
 * - computeExtensions: extend-only union up the chain, dedup by source
 */

import { describe, it, expect } from '@jest/globals';
import {
  normalizeCascadeMode,
  classifyUpdateEvent,
  computeMoveExtensions,
  computeShrinkFit,
  CASCADE_EVENT_SOURCES,
  type DateRange,
  type ExtensionNode,
} from '../../src/bases/cascadeGate';

const ECHO = 'og-self';
const d = (y: number, m: number, day: number) => new Date(y, m, day);

describe('normalizeCascadeMode', () => {
  it('passes through the three valid modes', () => {
    expect(normalizeCascadeMode('ask')).toBe('ask');
    expect(normalizeCascadeMode('auto')).toBe('auto');
    expect(normalizeCascadeMode('never')).toBe('never');
  });

  it('defaults to ask for missing/empty/unknown values', () => {
    expect(normalizeCascadeMode(undefined)).toBe('ask');
    expect(normalizeCascadeMode(null)).toBe('ask');
    expect(normalizeCascadeMode('')).toBe('ask');
    expect(normalizeCascadeMode('bogus')).toBe('ask');
    expect(normalizeCascadeMode(42)).toBe('ask');
  });
});

describe('classifyUpdateEvent', () => {
  const opts = { echoSource: ECHO, syncing: false };

  it('returns syncing regardless of source when a refresh is in progress', () => {
    expect(classifyUpdateEvent({ eventSource: undefined }, { echoSource: ECHO, syncing: true })).toBe('syncing');
    expect(classifyUpdateEvent({ eventSource: 'update-task' }, { echoSource: ECHO, syncing: true })).toBe('syncing');
  });

  it('flags our own echo writes', () => {
    expect(classifyUpdateEvent({ eventSource: ECHO }, opts)).toBe('echo');
  });

  it('treats an event with no eventSource as the user gesture', () => {
    expect(classifyUpdateEvent({ eventSource: undefined }, opts)).toBe('user-gesture');
    expect(classifyUpdateEvent({ eventSource: null }, opts)).toBe('user-gesture');
    expect(classifyUpdateEvent({}, opts)).toBe('user-gesture');
  });

  it('classifies each of the five SVAR action tags as "action"', () => {
    for (const tag of ['update-task', 'move-task', 'add-task', 'delete-task', 'copy-task']) {
      expect(classifyUpdateEvent({ eventSource: tag }, opts)).toBe('action');
    }
  });

  it('keeps the action tag set in sync with the documented five-tag set', () => {
    expect([...CASCADE_EVENT_SOURCES].sort()).toEqual(
      ['add-task', 'copy-task', 'delete-task', 'move-task', 'update-task'],
    );
  });

  it('ignores a present-but-unrecognized eventSource', () => {
    expect(classifyUpdateEvent({ eventSource: 'chart' }, opts)).toBe('ignore');
  });
});

describe('computeMoveExtensions', () => {
  const node = (over: Partial<ExtensionNode> & { id: string }): ExtensionNode => ({
    id: over.id,
    sourcePath: over.sourcePath ?? `${over.id}.md`,
    name: over.name ?? over.id,
    parent: over.parent,
    start: over.start ?? d(2026, 0, 1),
    end: over.end ?? d(2026, 0, 10),
  });
  const moved = (entries: Array<[string, DateRange]>) => new Map<string, DateRange>(entries);

  it('extends a parent on the exceeded end only when a leaf moves past it', () => {
    // leaf L moved past parent P's end.
    const nodes = [
      node({ id: 'P', sourcePath: 'P.md', start: d(2026, 0, 1), end: d(2026, 0, 10) }),
      node({ id: 'L', sourcePath: 'L.md', parent: 'P', start: d(2026, 0, 12), end: d(2026, 0, 20) }),
    ];
    const out = computeMoveExtensions(moved([['L.md', { start: d(2026, 0, 12), end: d(2026, 0, 20) }]]), nodes);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ sourcePath: 'P.md', oldEnd: d(2026, 0, 10), newEnd: d(2026, 0, 20) });
    expect(out[0].newStart).toEqual(d(2026, 0, 1)); // start unchanged
  });

  it('returns empty when the moved task stays within its ancestors (extend-only)', () => {
    const nodes = [
      node({ id: 'P', sourcePath: 'P.md', start: d(2026, 0, 1), end: d(2026, 0, 20) }),
      node({ id: 'L', sourcePath: 'L.md', parent: 'P', start: d(2026, 0, 5), end: d(2026, 0, 8) }),
    ];
    expect(computeMoveExtensions(moved([['L.md', { start: d(2026, 0, 5), end: d(2026, 0, 8) }]]), nodes)).toEqual([]);
  });

  it('extends both parent and grandparent (union of moved descendants)', () => {
    const nodes = [
      node({ id: 'G', sourcePath: 'G.md', start: d(2026, 0, 1), end: d(2026, 0, 20) }),
      node({ id: 'P', sourcePath: 'P.md', parent: 'G', start: d(2026, 0, 1), end: d(2026, 0, 10) }),
      node({ id: 'L', sourcePath: 'L.md', parent: 'P', start: d(2026, 0, 1), end: d(2026, 0, 30) }),
    ];
    const out = computeMoveExtensions(moved([['L.md', { start: d(2026, 0, 1), end: d(2026, 0, 30) }]]), nodes);
    const bySrc = Object.fromEntries(out.map((e) => [e.sourcePath, e.newEnd]));
    expect(bySrc['P.md']).toEqual(d(2026, 0, 30));
    expect(bySrc['G.md']).toEqual(d(2026, 0, 30));
  });

  it('does not flag an ancestor that is itself moved (rigid subtree shift)', () => {
    // Parent A and its child L both moved (A drag shifts L); A should not be
    // proposed for extension from L, since they moved together.
    const nodes = [
      node({ id: 'A', sourcePath: 'A.md', start: d(2026, 0, 5), end: d(2026, 0, 15) }),
      node({ id: 'L', sourcePath: 'L.md', parent: 'A', start: d(2026, 0, 6), end: d(2026, 0, 14) }),
    ];
    const out = computeMoveExtensions(
      moved([
        ['A.md', { start: d(2026, 0, 5), end: d(2026, 0, 15) }],
        ['L.md', { start: d(2026, 0, 6), end: d(2026, 0, 14) }],
      ]),
      nodes,
    );
    expect(out).toEqual([]);
  });

  it('extends a multi-parent child’s ALTERNATE parent when a sibling-parent drag carries it out', () => {
    // C is a child of both A (dragged) and B (not dragged). C moves with A and
    // now exceeds B's window → B must be offered for extension. C appears as two
    // instances: C@A (under A, moved) and C@B (under B, not moved).
    const nodes = [
      node({ id: 'A', sourcePath: 'A.md', start: d(2026, 0, 10), end: d(2026, 0, 20) }),
      node({ id: 'B', sourcePath: 'B.md', start: d(2026, 0, 1), end: d(2026, 0, 12) }),
      node({ id: 'C@A', sourcePath: 'C.md', parent: 'A', start: d(2026, 0, 14), end: d(2026, 0, 18) }),
      node({ id: 'C@B', sourcePath: 'C.md', parent: 'B', start: d(2026, 0, 14), end: d(2026, 0, 18) }),
    ];
    const out = computeMoveExtensions(
      moved([
        ['A.md', { start: d(2026, 0, 10), end: d(2026, 0, 20) }],
        ['C.md', { start: d(2026, 0, 14), end: d(2026, 0, 18) }],
      ]),
      nodes,
    );
    // A is moved → not flagged. B is not moved and C now exceeds it → flagged.
    expect(out.map((e) => e.sourcePath)).toEqual(['B.md']);
    expect(out[0].newEnd).toEqual(d(2026, 0, 18));
  });

  it('dedups by source and skips ancestors with incomplete dates; empty inputs', () => {
    const nodes = [
      node({ id: 'P#a', sourcePath: 'P.md', start: d(2026, 0, 1), end: d(2026, 0, 10) }),
      node({ id: 'P#b', sourcePath: 'P.md', start: d(2026, 0, 1), end: d(2026, 0, 10) }),
      node({ id: 'L#a', sourcePath: 'L.md', parent: 'P#a', start: d(2026, 0, 1), end: d(2026, 0, 20) }),
      node({ id: 'L#b', sourcePath: 'L.md', parent: 'P#b', start: d(2026, 0, 1), end: d(2026, 0, 20) }),
    ];
    const out = computeMoveExtensions(moved([['L.md', { start: d(2026, 0, 1), end: d(2026, 0, 20) }]]), nodes);
    expect(out).toHaveLength(1);
    expect(out[0].sourcePath).toBe('P.md');

    const incomplete: ExtensionNode[] = [
      { id: 'P', sourcePath: 'P.md', name: 'P', parent: undefined, start: null, end: null },
      node({ id: 'L', sourcePath: 'L.md', parent: 'P' }),
    ];
    expect(computeMoveExtensions(moved([['L.md', { start: d(2026, 0, 1), end: d(2026, 0, 20) }]]), incomplete)).toEqual([]);
    expect(computeMoveExtensions(new Map(), nodes)).toEqual([]);
  });
});

describe('computeShrinkFit', () => {
  const r = (a: number, b: number): DateRange => ({ start: d(2026, 0, a), end: d(2026, 0, b) });

  it('corrects only the dragged-in START, leaving the finish where the user put it', () => {
    // Parent [1,31] → start dragged in to 10 (past first child at 5); finish 31 untouched.
    const fit = computeShrinkFit(r(1, 31), r(10, 31), [r(5, 20)]);
    expect(fit).toEqual(r(5, 31)); // start pushed back to 5; end stays 31
  });

  it('corrects only the dragged-in FINISH, leaving the start where the user put it', () => {
    // Parent [1,31] → finish dragged in to 15 (before last child at 20); start 1 untouched.
    const fit = computeShrinkFit(r(1, 31), r(1, 15), [r(5, 20)]);
    expect(fit).toEqual(r(1, 20)); // end pushed back to 20; start stays 1
  });

  it('corrects both edges only when both were dragged into the children', () => {
    const fit = computeShrinkFit(r(1, 31), r(10, 15), [r(5, 12), r(8, 20)]);
    expect(fit).toEqual(r(5, 20));
  });

  it('returns null when the new range still contains the children', () => {
    expect(computeShrinkFit(r(1, 31), r(1, 25), [r(5, 20)])).toBeNull();
  });

  it('returns null for a pre-existing overflow (before did not contain children either)', () => {
    // Child already overflowed the parent before this resize → not newly orphaned.
    expect(computeShrinkFit(r(1, 10), r(1, 8), [r(5, 20)])).toBeNull();
  });

  it('returns null when the parent has no children', () => {
    expect(computeShrinkFit(r(1, 31), r(10, 15), [])).toBeNull();
  });
});
