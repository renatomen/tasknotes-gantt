/**
 * Unit tests for the default-view safe-partial interleave (plan
 * 2026-06-22-002, U6 / R7).
 *
 * Covers:
 * - property→field mapping driven by the user's configured {@link FieldMappings}
 *   (NEVER hardcoded names) — a custom-mapped property maps; a Base sort property
 *   that isn't the configured property for any field returns `null` (the fix for
 *   the chatgpt-codex-connector P2: don't position by a value Bases didn't sort by).
 * - sort-key extraction off a SourceTask for each mapped field.
 * - {@link positionFetchedAmongMatched}: fetched rows positioned among their
 *   matched siblings by the mapped key, with matched-row Base order preserved
 *   EXACTLY; null keys sort last; an unmapped key leaves the matched-first
 *   fallback; descending order positions correctly.
 */

import { describe, it, expect } from '@jest/globals';
import type { CompanionTask } from '../../src/datasource/companionResolve';
import type { FieldMappings } from '../../src/bases/types/field-mapping';
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

/** Build a FieldMappings with sane test defaults; override per case. */
function mapped(over: Partial<FieldMappings> = {}): FieldMappings {
  return {
    textProperty: '',
    startProperty: 'note.scheduled',
    endProperty: 'note.due',
    statusProperty: 'note.status',
    progressProperty: 'note.progress',
    ...over,
  };
}

/** The common case used by the positioning tests (sort key == configured end prop). */
const MAPPINGS = mapped();

describe('sortKeyMapping — mapSortPropertyToField (config-driven, property-agnostic)', () => {
  it('maps each configured property to its Gantt field', () => {
    const m = mapped();
    expect(mapSortPropertyToField(m.startProperty, m)).toBe('start');
    expect(mapSortPropertyToField(m.endProperty, m)).toBe('end');
    expect(mapSortPropertyToField(m.statusProperty as string, m)).toBe('status');
    expect(mapSortPropertyToField(m.progressProperty, m)).toBe('progress');
  });

  it('is property-agnostic: a custom-mapped property (note.banana → start) maps; the conventional name does not', () => {
    const m = mapped({ startProperty: 'note.banana' });
    expect(mapSortPropertyToField('note.banana', m)).toBe('start');
    // With "scheduled" remapped to note.banana, the conventional note.scheduled is
    // no longer a Gantt-field property → no positioning (must not assume it).
    expect(mapSortPropertyToField('note.scheduled', m)).toBeNull();
  });

  it('maps the configured name property, or the file-name built-ins when textProperty is unset', () => {
    expect(mapSortPropertyToField('file.name', mapped({ textProperty: '' }))).toBe('text');
    expect(mapSortPropertyToField('file.basename', mapped({ textProperty: '' }))).toBe('text');
    const m = mapped({ textProperty: 'note.title' });
    expect(mapSortPropertyToField('note.title', m)).toBe('text');
    // With a configured name property, the file-name built-ins no longer map to text.
    expect(mapSortPropertyToField('file.name', m)).toBeNull();
  });

  it('returns null for a sort key that is not the configured property of any field (Codex P2 fix)', () => {
    // end is mapped to a CUSTOM property; the Base sorts by note.due → must NOT be
    // treated as `end` (matched rows were ordered by note.due, not the custom field).
    const m = mapped({ endProperty: 'note.customDue' });
    expect(mapSortPropertyToField('note.due', m)).toBeNull();
  });

  it('returns null for a formula / arbitrary / empty sort key', () => {
    const m = mapped();
    expect(mapSortPropertyToField('formula.daysLeft', m)).toBeNull();
    expect(mapSortPropertyToField('note.assignee', m)).toBeNull();
    expect(mapSortPropertyToField('', m)).toBeNull();
  });

  it('ignores empty mappings (no field has a configured property → always null)', () => {
    const empty = mapped({ startProperty: '', endProperty: '', statusProperty: '', progressProperty: '', textProperty: '' });
    expect(mapSortPropertyToField('note.due', empty)).toBeNull();
    // textProperty unset still allows the file-name built-ins for the name column.
    expect(mapSortPropertyToField('file.name', empty)).toBe('text');
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
    const result = positionFetchedAmongMatched(matched, sort('note.due', 'ASC'), MAPPINGS);
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
    const result = positionFetchedAmongMatched([matched, fetched], sort('note.due', 'ASC'), MAPPINGS);
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
    const result = positionFetchedAmongMatched([matched, fetched], sort('note.due', 'ASC'), MAPPINGS);
    expect(result.map((t) => t.path)).toEqual(['matched.md', 'fetched.md']);
  });

  it('positions by a CUSTOM-mapped sort property (property-agnostic, end → note.banana)', () => {
    // The user's "end" is note.banana, and the Base sorts by note.banana → positions
    // by task.end (which BasesSource filled from note.banana). Proves no hardcoding.
    const m = mapped({ endProperty: 'note.banana' });
    const matched = ctask({ path: 'matched.md', isFetched: false, end: new Date('2026-03-10'), parents: ['P.md'] });
    const fetched = ctask({ path: 'fetched.md', isFetched: true, end: new Date('2026-03-03'), parents: ['P.md'] });
    const result = positionFetchedAmongMatched([matched, fetched], sort('note.banana', 'ASC'), m);
    expect(result.map((t) => t.path)).toEqual(['fetched.md', 'matched.md']);
  });

  it('does NOT position when the Base sort key differs from the configured field property (Codex P2)', () => {
    // Base sorts by note.due, but the view mapped end → note.customDue. Treating
    // note.due as end would order fetched by the wrong value → must fall back.
    const m = mapped({ endProperty: 'note.customDue' });
    const tasks: CompanionTask[] = [
      ctask({ path: 'm.md', isFetched: false, end: new Date('2026-03-10'), parents: ['P.md'] }),
      ctask({ path: 'f.md', isFetched: true, end: new Date('2026-03-01'), parents: ['P.md'] }),
    ];
    const result = positionFetchedAmongMatched(tasks, sort('note.due', 'ASC'), m);
    expect(result).toBe(tasks); // unchanged (matched-first fallback)
  });

  it('positions fetched rows independently per sibling group (by parent)', () => {
    const tasks: CompanionTask[] = [
      ctask({ path: 'A.md', isFetched: false, end: new Date('2026-03-10'), parents: ['P.md'] }),
      ctask({ path: 'B.md', isFetched: false, end: new Date('2026-03-10'), parents: ['Q.md'] }),
      ctask({ path: 'fP.md', isFetched: true, end: new Date('2026-03-01'), parents: ['P.md'] }),
      ctask({ path: 'fQ.md', isFetched: true, end: new Date('2026-03-20'), parents: ['Q.md'] }),
    ];
    const result = positionFetchedAmongMatched(tasks, sort('note.due', 'ASC'), MAPPINGS);
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
    const result = positionFetchedAmongMatched([matched, fetched], sort('note.due', 'ASC'), MAPPINGS);
    expect(result.map((t) => t.path)).toEqual(['matched.md', 'fetched.md']);
  });

  it('positions correctly for descending order', () => {
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
    const result = positionFetchedAmongMatched([matched, fetched], sort('note.due', 'DESC'), MAPPINGS);
    expect(result.map((t) => t.path)).toEqual(['fetched.md', 'matched.md']);
  });

  it('Covers AE5: unmapped/formula sort key → no positioning → fetched trail (fallback)', () => {
    const tasks: CompanionTask[] = [
      ctask({ path: 'm.md', isFetched: false, parents: ['P.md'] }),
      ctask({ path: 'f.md', isFetched: true, end: new Date('2026-03-01'), parents: ['P.md'] }),
    ];
    const result = positionFetchedAmongMatched(tasks, sort('formula.daysLeft', 'ASC'), MAPPINGS);
    expect(result).toBe(tasks);
  });

  it('no sort configured (empty descriptor) → no positioning → input unchanged', () => {
    const tasks: CompanionTask[] = [
      ctask({ path: 'm.md', isFetched: false, parents: ['P.md'] }),
      ctask({ path: 'f.md', isFetched: true, parents: ['P.md'] }),
    ];
    const result = positionFetchedAmongMatched(tasks, [], MAPPINGS);
    expect(result).toBe(tasks);
  });

  it('does not throw and returns input when there are no fetched rows', () => {
    const tasks: CompanionTask[] = [
      ctask({ path: 'a.md', isFetched: false, end: new Date('2026-03-10'), parents: ['P.md'] }),
      ctask({ path: 'b.md', isFetched: false, end: new Date('2026-03-01'), parents: ['P.md'] }),
    ];
    const result = positionFetchedAmongMatched(tasks, sort('note.due', 'ASC'), MAPPINGS);
    expect(result.map((t) => t.path)).toEqual(['a.md', 'b.md']);
  });

  it('a fetched row with no matched sibling in its group keeps its relative order', () => {
    const tasks: CompanionTask[] = [
      ctask({ path: 'f2.md', isFetched: true, end: new Date('2026-03-20'), parents: ['P.md'] }),
      ctask({ path: 'f1.md', isFetched: true, end: new Date('2026-03-01'), parents: ['P.md'] }),
    ];
    const result = positionFetchedAmongMatched(tasks, sort('note.due', 'ASC'), MAPPINGS);
    expect(result.map((t) => t.path)).toEqual(['f1.md', 'f2.md']);
  });
});
