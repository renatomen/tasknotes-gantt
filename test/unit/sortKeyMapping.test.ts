/**
 * Unit tests for the default-view safe-partial interleave (plan
 * 2026-06-22-002, U6 / R7).
 *
 * Covers:
 * - property→field mapping for the five mapped Gantt fields, and `null` for an
 *   unmapped / formula sort key (Covers AE5).
 * - sort-key extraction off a SourceTask for each mapped field.
 * - {@link positionFetchedAmongMatched}: fetched rows positioned among their
 *   matched siblings by the mapped key, with matched-row Base order preserved
 *   EXACTLY (the don't-re-sort-matched regression guard); null keys sort last;
 *   an unmapped key leaves the current matched-first fallback (fetched trail);
 *   descending order positions correctly.
 */

import { describe, it, expect } from '@jest/globals';
import type { CompanionTask } from '../../src/datasource/companionResolve';
import type { BasesSortConfig } from 'obsidian';
import {
  mapSortPropertyToField,
  extractSortKey,
  positionFetchedAmongMatched,
} from '../../src/bases/sortKeyMapping';

/** Concise CompanionTask factory (matched/fetched flag + per-field values). */
function ctask(
  partial: Partial<CompanionTask> & { path: string; isFetched: boolean },
): CompanionTask {
  return {
    text: partial.path,
    start: null,
    end: null,
    progress: null,
    status: null,
    parents: [],
    alsoTopLevel: false,
    ...partial,
  };
}

/** Build a BasesSortConfig primary descriptor. */
function sort(property: string, direction: 'ASC' | 'DESC' = 'ASC'): BasesSortConfig[] {
  return [{ property: property as BasesSortConfig['property'], direction }];
}

describe('sortKeyMapping — mapSortPropertyToField', () => {
  it('maps note.scheduled → start', () => {
    expect(mapSortPropertyToField('note.scheduled')).toBe('start');
  });

  it('maps note.due → end', () => {
    expect(mapSortPropertyToField('note.due')).toBe('end');
  });

  it('maps file.name → text', () => {
    expect(mapSortPropertyToField('file.name')).toBe('text');
  });

  it('maps note.status → status', () => {
    expect(mapSortPropertyToField('note.status')).toBe('status');
  });

  it('maps note.progress → progress', () => {
    expect(mapSortPropertyToField('note.progress')).toBe('progress');
  });

  it('returns null for an unmapped property (Covers AE5: formula/arbitrary)', () => {
    expect(mapSortPropertyToField('formula.daysLeft')).toBeNull();
    expect(mapSortPropertyToField('note.assignee')).toBeNull();
    expect(mapSortPropertyToField('file.mtime')).toBeNull();
  });
});

describe('sortKeyMapping — extractSortKey', () => {
  it('extracts the start date for the start field', () => {
    const d = new Date('2026-03-03');
    expect(extractSortKey(ctask({ path: 'a.md', isFetched: false, start: d }), 'start')).toBe(d);
  });

  it('extracts the end date for the end field', () => {
    const d = new Date('2026-03-10');
    expect(extractSortKey(ctask({ path: 'a.md', isFetched: false, end: d }), 'end')).toBe(d);
  });

  it('extracts the text for the text field', () => {
    expect(extractSortKey(ctask({ path: 'a.md', isFetched: false, text: 'Alpha' }), 'text')).toBe(
      'Alpha',
    );
  });

  it('extracts the status for the status field', () => {
    expect(
      extractSortKey(ctask({ path: 'a.md', isFetched: false, status: 'open' }), 'status'),
    ).toBe('open');
  });

  it('extracts the progress for the progress field', () => {
    expect(
      extractSortKey(ctask({ path: 'a.md', isFetched: false, progress: 42 }), 'progress'),
    ).toBe(42);
  });

  it('returns null for an unset (null) field value', () => {
    expect(extractSortKey(ctask({ path: 'a.md', isFetched: false, start: null }), 'start')).toBeNull();
  });
});

describe('sortKeyMapping — positionFetchedAmongMatched', () => {
  it('preserves matched-row Base order EXACTLY regardless of the comparator', () => {
    // Matched rows are deliberately NOT in mapped-key order: m1=later, m2=earlier.
    // The function must keep them in their given Base order — never re-sort them.
    const matched = [
      ctask({ path: 'm1.md', isFetched: false, end: new Date('2026-03-20'), parents: ['P.md'] }),
      ctask({ path: 'm2.md', isFetched: false, end: new Date('2026-03-01'), parents: ['P.md'] }),
    ];
    const result = positionFetchedAmongMatched(matched, sort('note.due', 'ASC'));
    expect(result.map((t) => t.path)).toEqual(['m1.md', 'm2.md']);
  });

  it('positions a fetched child before a matched sibling with a later key (same parent)', () => {
    // AE4-shaped: fetched due 03-03 before matched due 03-10 under the same parent.
    const matched = ctask({
      path: 'matched.md',
      isFetched: false,
      end: new Date('2026-03-10'),
      parents: ['P.md'],
    });
    const fetched = ctask({
      path: 'fetched.md',
      isFetched: true,
      end: new Date('2026-03-03'),
      parents: ['P.md'],
    });
    const result = positionFetchedAmongMatched([matched, fetched], sort('note.due', 'ASC'));
    expect(result.map((t) => t.path)).toEqual(['fetched.md', 'matched.md']);
  });

  it('positions a fetched child after a matched sibling with an earlier key', () => {
    const matched = ctask({
      path: 'matched.md',
      isFetched: false,
      end: new Date('2026-03-01'),
      parents: ['P.md'],
    });
    const fetched = ctask({
      path: 'fetched.md',
      isFetched: true,
      end: new Date('2026-03-15'),
      parents: ['P.md'],
    });
    const result = positionFetchedAmongMatched([matched, fetched], sort('note.due', 'ASC'));
    expect(result.map((t) => t.path)).toEqual(['matched.md', 'fetched.md']);
  });

  it('positions fetched rows independently per sibling group (by parent)', () => {
    const tasks: CompanionTask[] = [
      ctask({ path: 'A.md', isFetched: false, end: new Date('2026-03-10'), parents: ['P.md'] }),
      ctask({ path: 'B.md', isFetched: false, end: new Date('2026-03-10'), parents: ['Q.md'] }),
      // Fetched under P, earlier than A → before A.
      ctask({ path: 'fP.md', isFetched: true, end: new Date('2026-03-01'), parents: ['P.md'] }),
      // Fetched under Q, later than B → after B.
      ctask({ path: 'fQ.md', isFetched: true, end: new Date('2026-03-20'), parents: ['Q.md'] }),
    ];
    const result = positionFetchedAmongMatched(tasks, sort('note.due', 'ASC'));
    // P group: fP before A. Q group: B before fQ. Matched A precedes matched B
    // in Base order, so groups stay anchored to their matched members' order.
    const order = result.map((t) => t.path);
    expect(order.indexOf('fP.md')).toBeLessThan(order.indexOf('A.md'));
    expect(order.indexOf('B.md')).toBeLessThan(order.indexOf('fQ.md'));
  });

  it('null fetched key sorts last within its group for ascending', () => {
    const matched = ctask({
      path: 'matched.md',
      isFetched: false,
      end: new Date('2026-03-10'),
      parents: ['P.md'],
    });
    const fetched = ctask({ path: 'fetched.md', isFetched: true, end: null, parents: ['P.md'] });
    const result = positionFetchedAmongMatched([matched, fetched], sort('note.due', 'ASC'));
    expect(result.map((t) => t.path)).toEqual(['matched.md', 'fetched.md']);
  });

  it('positions correctly for descending order', () => {
    // Descending: larger keys first. Fetched 03-20 should land before matched 03-10.
    const matched = ctask({
      path: 'matched.md',
      isFetched: false,
      end: new Date('2026-03-10'),
      parents: ['P.md'],
    });
    const fetched = ctask({
      path: 'fetched.md',
      isFetched: true,
      end: new Date('2026-03-20'),
      parents: ['P.md'],
    });
    const result = positionFetchedAmongMatched([matched, fetched], sort('note.due', 'DESC'));
    expect(result.map((t) => t.path)).toEqual(['fetched.md', 'matched.md']);
  });

  it('Covers AE5: unmapped/formula sort key → no positioning → fetched trail (fallback)', () => {
    const tasks: CompanionTask[] = [
      ctask({ path: 'm.md', isFetched: false, parents: ['P.md'] }),
      ctask({ path: 'f.md', isFetched: true, end: new Date('2026-03-01'), parents: ['P.md'] }),
    ];
    // Input already has matched-first; an unmapped key must leave it untouched.
    const result = positionFetchedAmongMatched(tasks, sort('formula.daysLeft', 'ASC'));
    expect(result).toBe(tasks);
  });

  it('no sort configured (empty descriptor) → no positioning → input unchanged', () => {
    const tasks: CompanionTask[] = [
      ctask({ path: 'm.md', isFetched: false, parents: ['P.md'] }),
      ctask({ path: 'f.md', isFetched: true, parents: ['P.md'] }),
    ];
    const result = positionFetchedAmongMatched(tasks, []);
    expect(result).toBe(tasks);
  });

  it('does not throw and returns input when there are no fetched rows', () => {
    const tasks: CompanionTask[] = [
      ctask({ path: 'a.md', isFetched: false, end: new Date('2026-03-10'), parents: ['P.md'] }),
      ctask({ path: 'b.md', isFetched: false, end: new Date('2026-03-01'), parents: ['P.md'] }),
    ];
    const result = positionFetchedAmongMatched(tasks, sort('note.due', 'ASC'));
    // No fetched rows to position → matched order preserved exactly.
    expect(result.map((t) => t.path)).toEqual(['a.md', 'b.md']);
  });

  it('a fetched row with no matched sibling in its group keeps its relative order', () => {
    // Group P has only fetched rows; they keep their input (discovery) order
    // among themselves but ordered by key when both have keys.
    const tasks: CompanionTask[] = [
      ctask({ path: 'f2.md', isFetched: true, end: new Date('2026-03-20'), parents: ['P.md'] }),
      ctask({ path: 'f1.md', isFetched: true, end: new Date('2026-03-01'), parents: ['P.md'] }),
    ];
    const result = positionFetchedAmongMatched(tasks, sort('note.due', 'ASC'));
    expect(result.map((t) => t.path)).toEqual(['f1.md', 'f2.md']);
  });
});
