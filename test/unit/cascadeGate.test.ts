/**
 * cascadeGate unit tests (plan U2) — subtree move + gated ancestor extend.
 *
 * - normalizeCascadeMode: arbitrary value → valid mode (default ask)
 * - classifyUpdateEvent: syncing/echo/user-gesture/action/ignore (five SVAR tags)
 * - classifyCellEdit: diff-against-stored cell-edit detection (noop on zero
 *   diffs, ambiguous on multiple diffs, coercion bridges for SVAR's `v * 1`)
 * - classifyUpdateGesture: classifyUpdateEvent with cell-edit detection folded in
 * - collectAncestorIds: parent-chain walk, cycle-guarded
 * - computeExtensions: extend-only union up the chain, dedup by source
 */

import { describe, it, expect } from '@jest/globals';
import {
  normalizeCascadeMode,
  classifyUpdateEvent,
  classifyCellEdit,
  classifyUpdateGesture,
  computeMoveExtensions,
  computeMoveDelta,
  computeSubtreeMove,
  computeShrinkFit,
  classifyLinkCreate,
  CASCADE_EVENT_SOURCES,
  type DateRange,
  type ExtensionNode,
  type SubtreeMoveNode,
} from '../../src/bases/cascadeGate';
import type { TypedValue } from '../../src/bases/propertyValues';

describe('classifyLinkCreate', () => {
  it('accepts an e2s drag → predecessor=source, dependent=target', () => {
    expect(classifyLinkCreate({ source: 'A.md', target: 'B.md', type: 'e2s' })).toEqual({
      predecessor: 'A.md',
      dependent: 'B.md',
    });
  });

  it('rejects non-FS handle geometries (deferred to M3)', () => {
    for (const type of ['s2s', 'e2e', 's2e']) {
      expect(classifyLinkCreate({ source: 'A.md', target: 'B.md', type })).toBeNull();
    }
  });

  it('rejects a self-link', () => {
    expect(classifyLinkCreate({ source: 'A.md', target: 'A.md', type: 'e2s' })).toBeNull();
  });

  it('rejects an empty endpoint', () => {
    expect(classifyLinkCreate({ source: '', target: 'B.md', type: 'e2s' })).toBeNull();
    expect(classifyLinkCreate({ source: 'A.md', target: '', type: 'e2s' })).toBeNull();
  });
});

describe('computeSubtreeMove', () => {
  const DAY = 86400000;
  const d = (mo: number, da: number) => new Date(2026, mo, da);
  const node = (
    id: string,
    sourcePath: string,
    parent: string | undefined,
    start: Date | null,
    end: Date | null,
  ): SubtreeMoveNode => ({ id, sourcePath, parent, start, end });

  it('shifts a single-parent child by the delta', () => {
    const nodes = [
      node('A', 'A.md', undefined, d(5, 1), d(5, 20)),
      node('C', 'C.md', 'A', d(5, 10), d(5, 12)),
    ];
    expect(computeSubtreeMove('A', DAY, nodes)).toEqual([
      { id: 'C', sourcePath: 'C.md', start: d(5, 11), end: d(5, 13) },
    ]);
  });

  it('includes a multi-parent sibling instance OUTSIDE the dragged subtree (regression: duplicate must stay in sync)', () => {
    // C has two parents: A (dragged) and B (not dragged). Both instances of C
    // must shift so the duplicates never diverge (AE7), even though C#B is not a
    // descendant of A.
    const nodes = [
      node('A', 'A.md', undefined, d(5, 1), d(5, 20)),
      node('B', 'B.md', undefined, d(5, 1), d(5, 20)),
      node('C#A', 'C.md', 'A', d(5, 10), d(5, 10)),
      node('C#B', 'C.md', 'B', d(5, 10), d(5, 10)),
    ];
    const shifts = computeSubtreeMove('A', DAY, nodes);
    expect(shifts.map((s) => s.id).sort((a, b) => a.localeCompare(b))).toEqual(['C#A', 'C#B']);
    for (const s of shifts) {
      expect(s.start).toEqual(d(5, 11));
      expect(s.end).toEqual(d(5, 11));
    }
  });

  it('excludes the dragged root itself', () => {
    const nodes = [
      node('A', 'A.md', undefined, d(5, 1), d(5, 20)),
      node('C', 'C.md', 'A', d(5, 10), d(5, 12)),
    ];
    expect(computeSubtreeMove('A', DAY, nodes).some((s) => s.id === 'A')).toBe(false);
  });

  it('walks multiple levels (grandchildren)', () => {
    const nodes = [
      node('A', 'A.md', undefined, d(5, 1), d(5, 20)),
      node('C', 'C.md', 'A', d(5, 5), d(5, 8)),
      node('G', 'G.md', 'C', d(5, 6), d(5, 7)),
    ];
    expect(computeSubtreeMove('A', DAY, nodes).map((s) => s.id).sort((a, b) => a.localeCompare(b))).toEqual(['C', 'G']);
  });

  it('skips instances with null dates and returns [] for a leaf root', () => {
    const nodes = [
      node('A', 'A.md', undefined, d(5, 1), d(5, 20)),
      node('C', 'C.md', 'A', null, null),
    ];
    expect(computeSubtreeMove('A', DAY, nodes)).toEqual([]);
  });
});

describe('computeMoveDelta', () => {
  const DAY = 86400000;
  const d = (y: number, mo: number, da: number, h = 0, mi = 0, s = 0, ms = 0) =>
    new Date(y, mo, da, h, mi, s, ms);

  it('detects a pure move despite end-of-day vs midnight mismatch (regression: parent drag moves children)', () => {
    // Controller normalizes end to 23:59:59.999; SVAR reports the dragged end
    // snapped to a day boundary (00:00). Both edges moved +6 days. Naive
    // ds === de on raw timestamps fails (end delta lands ~1 day short); the
    // day-granular comparison must still see a 6-day pure move.
    const delta = computeMoveDelta(
      d(2026, 5, 2), // beforeStart Jun 2 00:00
      d(2026, 5, 23, 23, 59, 59, 999), // beforeEnd Jun 23 23:59:59.999
      d(2026, 5, 8), // afterStart Jun 8 00:00
      d(2026, 5, 29), // afterEnd Jun 29 00:00 (SVAR-snapped)
    );
    expect(delta).toBe(6 * DAY);
  });

  it('returns 0 for a resize (only the end edge moves)', () => {
    expect(
      computeMoveDelta(d(2026, 5, 2), d(2026, 5, 23, 23, 59, 59, 999), d(2026, 5, 2), d(2026, 5, 26)),
    ).toBe(0);
  });

  it('returns 0 for a no-op (no edge moved a whole day)', () => {
    expect(
      computeMoveDelta(
        d(2026, 5, 2),
        d(2026, 5, 23, 23, 59, 59, 999),
        d(2026, 5, 2),
        d(2026, 5, 23, 23, 59, 59, 999),
      ),
    ).toBe(0);
  });

  it('returns the start delta for a clean both-midnight move', () => {
    expect(computeMoveDelta(d(2026, 5, 2), d(2026, 5, 10), d(2026, 5, 5), d(2026, 5, 13))).toBe(3 * DAY);
  });

  it('returns 0 when before dates are null', () => {
    expect(computeMoveDelta(null, null, d(2026, 5, 8), d(2026, 5, 29))).toBe(0);
  });
});

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
    expect([...CASCADE_EVENT_SOURCES].sort((a, b) => a.localeCompare(b))).toEqual(
      ['add-task', 'copy-task', 'delete-task', 'move-task', 'update-task'],
    );
  });

  it('ignores a present-but-unrecognized eventSource', () => {
    expect(classifyUpdateEvent({ eventSource: 'chart' }, opts)).toBe('ignore');
  });
});

describe('classifyCellEdit', () => {
  const text = (value: string): TypedValue => ({ kind: 'text', value });
  const num = (value: number): TypedValue => ({ kind: 'number', value });
  const dateTv = (value: Date): TypedValue => ({ kind: 'date', value });
  const COLUMNS = ['note.priority', 'note.status'] as const;

  it('classifies a differing flat column value as a cell edit with column and value', () => {
    const out = classifyCellEdit(
      { id: 'A', text: 'A', 'note.priority': 'high' },
      COLUMNS,
      { 'note.priority': text('low') },
    );
    expect(out).toEqual({ kind: 'cell-edit', columnId: 'note.priority', value: 'high' });
  });

  it('still classifies as cell edit when the copy carries start/end (misroute regression)', () => {
    const out = classifyCellEdit(
      {
        id: 'A',
        text: 'A',
        start: d(2026, 5, 1),
        end: d(2026, 5, 10),
        progress: 0,
        'note.priority': 'high',
      },
      COLUMNS,
      { 'note.priority': text('low') },
    );
    expect(out).toEqual({ kind: 'cell-edit', columnId: 'note.priority', value: 'high' });
  });

  it('extracts only the freshly-edited column when a stale prior-edit key is also present', () => {
    const out = classifyCellEdit(
      { id: 'A', 'note.status': 'done', 'note.priority': 'high' },
      COLUMNS,
      { 'note.priority': text('low'), 'note.status': text('done') },
    );
    expect(out).toEqual({ kind: 'cell-edit', columnId: 'note.priority', value: 'high' });
  });

  it('classifies re-committing the same value as a no-op cell edit', () => {
    const out = classifyCellEdit(
      { id: 'A', 'note.priority': 'low' },
      COLUMNS,
      { 'note.priority': text('low') },
    );
    expect(out).toEqual({ kind: 'cell-edit-noop' });
  });

  it('treats a bridge-coerced number as equal to the stored numeric string (no-op)', () => {
    const out = classifyCellEdit(
      { id: 'A', 'note.priority': 2026 },
      COLUMNS,
      { 'note.priority': text('2026') },
    );
    expect(out).toEqual({ kind: 'cell-edit-noop' });
  });

  it('diffs a genuinely different coerced number against a stored numeric string', () => {
    const out = classifyCellEdit(
      { id: 'A', 'note.priority': 2027 },
      COLUMNS,
      { 'note.priority': text('2026') },
    );
    expect(out).toEqual({ kind: 'cell-edit', columnId: 'note.priority', value: 2027 });
  });

  it('classifies an equal numeric value as a no-op', () => {
    expect(
      classifyCellEdit({ 'note.priority': 5 }, COLUMNS, { 'note.priority': num(5) }),
    ).toEqual({ kind: 'cell-edit-noop' });
  });

  it('classifies a differing numeric value as a cell edit', () => {
    expect(
      classifyCellEdit({ 'note.priority': 6 }, COLUMNS, { 'note.priority': num(5) }),
    ).toEqual({ kind: 'cell-edit', columnId: 'note.priority', value: 6 });
  });

  it('treats a date-shaped string as equal to the stored date at the same instant', () => {
    const out = classifyCellEdit(
      { 'note.due': '2026-06-17' },
      ['note.due'],
      { 'note.due': dateTv(new Date(2026, 5, 17)) },
    );
    expect(out).toEqual({ kind: 'cell-edit-noop' });
  });

  it('treats a cleared value as equal to a stored empty (no-op)', () => {
    expect(
      classifyCellEdit({ 'note.priority': '' }, COLUMNS, {
        'note.priority': { kind: 'empty', value: null },
      }),
    ).toEqual({ kind: 'cell-edit-noop' });
  });

  it('classifies clearing a stored value as a cell edit', () => {
    expect(
      classifyCellEdit({ 'note.priority': '' }, COLUMNS, { 'note.priority': text('low') }),
    ).toEqual({ kind: 'cell-edit', columnId: 'note.priority', value: '' });
  });

  it('classifies more than one genuine diff as ambiguous (stale flat key + external note change)', () => {
    const out = classifyCellEdit(
      { id: 'A', 'note.priority': 'high', 'note.status': 'doing' },
      COLUMNS,
      { 'note.priority': text('low'), 'note.status': text('done') },
    );
    expect(out).toEqual({ kind: 'cell-edit-ambiguous' });
  });

  it('treats a bridge-coerced 1 as equal to a stored boolean true (no-op)', () => {
    const out = classifyCellEdit(
      { 'note.flag': 1 },
      ['note.flag'],
      { 'note.flag': { kind: 'boolean', value: true } },
    );
    expect(out).toEqual({ kind: 'cell-edit-noop' });
  });

  it('treats a bridge-coerced 0 as equal to a stored boolean false (no-op)', () => {
    const out = classifyCellEdit(
      { 'note.flag': 0 },
      ['note.flag'],
      { 'note.flag': { kind: 'boolean', value: false } },
    );
    expect(out).toEqual({ kind: 'cell-edit-noop' });
  });

  it('classifies a genuine boolean flip (stored false, flat 1) as a cell edit', () => {
    const out = classifyCellEdit(
      { 'note.flag': 1 },
      ['note.flag'],
      { 'note.flag': { kind: 'boolean', value: false } },
    );
    expect(out).toEqual({ kind: 'cell-edit', columnId: 'note.flag', value: 1 });
  });

  it('treats a bridge-coerced 0 as equal to a stored EMPTY list (no-op)', () => {
    const out = classifyCellEdit(
      { 'note.contexts': 0 },
      ['note.contexts'],
      { 'note.contexts': { kind: 'list', value: [] } },
    );
    expect(out).toEqual({ kind: 'cell-edit-noop' });
  });

  it('classifies flat 0 against a NON-empty stored list as a cell edit', () => {
    const out = classifyCellEdit(
      { 'note.contexts': 0 },
      ['note.contexts'],
      { 'note.contexts': { kind: 'list', value: ['a'] } },
    );
    expect(out).toEqual({ kind: 'cell-edit', columnId: 'note.contexts', value: 0 });
  });

  it('classifies an element-wise equal list as a no-op', () => {
    expect(
      classifyCellEdit({ 'note.contexts': ['a', 'b'] }, ['note.contexts'], {
        'note.contexts': { kind: 'list', value: ['a', 'b'] },
      }),
    ).toEqual({ kind: 'cell-edit-noop' });
  });

  it('classifies a reordered list as a cell edit (order-sensitive)', () => {
    expect(
      classifyCellEdit({ 'note.contexts': ['b', 'a'] }, ['note.contexts'], {
        'note.contexts': { kind: 'list', value: ['a', 'b'] },
      }),
    ).toEqual({ kind: 'cell-edit', columnId: 'note.contexts', value: ['b', 'a'] });
  });

  it('returns null when no configured column key is present (reschedule/progress payloads)', () => {
    expect(
      classifyCellEdit({ start: d(2026, 5, 1), end: d(2026, 5, 10) }, COLUMNS, {}),
    ).toBeNull();
    expect(classifyCellEdit({ progress: 40 }, COLUMNS, {})).toBeNull();
    expect(classifyCellEdit(undefined, COLUMNS, {})).toBeNull();
  });

  it('never classifies a flat key outside the configured column set as a cell edit', () => {
    expect(
      classifyCellEdit({ 'note.unconfigured': 'x' }, COLUMNS, {}),
    ).toBeNull();
  });

  it('diffs against empty when the row has no stored properties record', () => {
    expect(classifyCellEdit({ 'note.priority': 'high' }, COLUMNS, undefined)).toEqual({
      kind: 'cell-edit',
      columnId: 'note.priority',
      value: 'high',
    });
  });
});

describe('classifyUpdateGesture', () => {
  const stored: Record<string, TypedValue> = { 'note.priority': { kind: 'text', value: 'low' } };
  const opts = {
    echoSource: ECHO,
    syncing: false,
    cellEditColumnIds: ['note.priority'],
    storedProperties: stored,
  };

  it('classifies a differing flat column value as a cell edit even with start/end present', () => {
    const out = classifyUpdateGesture(
      { task: { start: d(2026, 5, 1), end: d(2026, 5, 10), 'note.priority': 'high' } },
      opts,
    );
    expect(out).toEqual({ kind: 'cell-edit', columnId: 'note.priority', value: 'high' });
  });

  it('keeps echo and syncing precedence ahead of cell-edit detection', () => {
    expect(
      classifyUpdateGesture({ eventSource: ECHO, task: { 'note.priority': 'high' } }, opts),
    ).toEqual({ kind: 'echo' });
    expect(
      classifyUpdateGesture(
        { task: { 'note.priority': 'high' } },
        { ...opts, syncing: true },
      ),
    ).toEqual({ kind: 'syncing' });
  });

  it('keeps action and ignore classifications for tagged events with flat keys', () => {
    expect(
      classifyUpdateGesture({ eventSource: 'move-task', task: { 'note.priority': 'high' } }, opts),
    ).toEqual({ kind: 'action' });
    expect(
      classifyUpdateGesture({ eventSource: 'chart', task: { 'note.priority': 'high' } }, opts),
    ).toEqual({ kind: 'ignore' });
  });

  it('classifies reschedule and progress payloads as the plain user gesture', () => {
    expect(
      classifyUpdateGesture({ task: { start: d(2026, 5, 1), end: d(2026, 5, 10) } }, opts),
    ).toEqual({ kind: 'user-gesture' });
    expect(classifyUpdateGesture({ task: { progress: 40 } }, opts)).toEqual({
      kind: 'user-gesture',
    });
  });

  it('classifies a zero-diff cell commit as a no-op cell edit', () => {
    expect(classifyUpdateGesture({ task: { 'note.priority': 'low' } }, opts)).toEqual({
      kind: 'cell-edit-noop',
    });
  });

  it('lets an ambiguous multi-diff commit flow through as cell-edit-ambiguous', () => {
    const multiOpts = {
      ...opts,
      cellEditColumnIds: ['note.priority', 'note.status'],
      storedProperties: {
        'note.priority': { kind: 'text', value: 'low' } as TypedValue,
        'note.status': { kind: 'text', value: 'done' } as TypedValue,
      },
    };
    expect(
      classifyUpdateGesture(
        { task: { 'note.priority': 'high', 'note.status': 'doing' } },
        multiOpts,
      ),
    ).toEqual({ kind: 'cell-edit-ambiguous' });
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
