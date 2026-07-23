/**
 * inferredDragGate unit tests (plan U1) — the whole decision surface for the
 * inferred-date drag prompt.
 *
 * - normalizeInferredDragMode: arbitrary value → valid mode (default ask)
 * - classifyDraggedEdge: day-granular before/after → which edge moved
 * - resolveInferredEdge: moved edge + dateStatus → the inferred dragged edge
 * - resolveInferredDragOutcome: inferred edge + mode + writable → outcome
 * - buildInferredDragPatch: action + edge → estimate-only vs estimate-and-dates
 *   patch fields
 */

import { describe, it, expect, jest } from '@jest/globals';
import {
  normalizeInferredDragMode,
  persistInferredDragMode,
  classifyDraggedEdge,
  resolveInferredEdge,
  resolveInferredDragOutcome,
  buildInferredDragPatch,
} from '../../src/bases/inferredDragGate';

const d = (mo: number, da: number) => new Date(2026, mo, da);
// datePolicy normalizes ends to end-of-day; the store reports day boundaries.
// Both before/after come from the same (SVAR) representation, so day-granular
// deltas are reliable — mirror that here with matching times on both sides.
const end = (mo: number, da: number) => new Date(2026, mo, da, 23, 59, 59, 999);

describe('persistInferredDragMode', () => {
  it('writes the chosen action to the tngantt_inferredDrag key', () => {
    const set = jest.fn();
    persistInferredDragMode(set, 'estimate-only');
    expect(set).toHaveBeenCalledWith('tngantt_inferredDrag', 'estimate-only');
  });

  it('swallows a failing set so the drag-commit handler never crashes', () => {
    const set = jest.fn(() => {
      throw new Error('config write failed');
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => persistInferredDragMode(set, 'estimate-and-dates')).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('normalizeInferredDragMode', () => {
  it('passes through the three known modes', () => {
    expect(normalizeInferredDragMode('ask')).toBe('ask');
    expect(normalizeInferredDragMode('estimate-only')).toBe('estimate-only');
    expect(normalizeInferredDragMode('estimate-and-dates')).toBe('estimate-and-dates');
  });

  it('coerces unknown / absent values to ask', () => {
    expect(normalizeInferredDragMode('nope')).toBe('ask');
    expect(normalizeInferredDragMode(undefined)).toBe('ask');
    expect(normalizeInferredDragMode(null)).toBe('ask');
    expect(normalizeInferredDragMode(42)).toBe('ask');
  });
});

describe('classifyDraggedEdge', () => {
  it('flags an end-only resize', () => {
    // start fixed, end pushed out two days
    expect(classifyDraggedEdge(d(5, 1), end(5, 3), d(5, 1), end(5, 5))).toBe('end');
  });

  it('flags a start-only resize', () => {
    // end fixed, start pulled back two days
    expect(classifyDraggedEdge(d(5, 3), end(5, 10), d(5, 1), end(5, 10))).toBe('start');
  });

  it('flags a whole-bar move (both edges shift) as both', () => {
    expect(classifyDraggedEdge(d(5, 1), end(5, 5), d(5, 4), end(5, 8))).toBe('both');
  });

  it('reports none when nothing moved at day granularity', () => {
    expect(classifyDraggedEdge(d(5, 1), end(5, 5), d(5, 1), end(5, 5))).toBe('none');
  });
});

describe('resolveInferredEdge', () => {
  it('an end resize of an inferred-end task is the inferred edge', () => {
    // AE1: authored start, derived end → dragging the end is inferred
    expect(resolveInferredEdge('end', 'inferred-end')).toBe('end');
  });

  it('a start resize of an inferred-start task is the inferred edge', () => {
    // AE5: authored due, derived start → dragging the start is inferred
    expect(resolveInferredEdge('start', 'inferred-start')).toBe('start');
  });

  it('dragging the authored edge of a partially-inferred task is not inferred', () => {
    // inferred-end task: the START is authored → dragging start is authored (AE6)
    expect(resolveInferredEdge('start', 'inferred-end')).toBeNull();
    // inferred-start task: the END (due) is authored → dragging end is authored
    expect(resolveInferredEdge('end', 'inferred-start')).toBeNull();
  });

  it('a fully-authored task never has an inferred edge', () => {
    expect(resolveInferredEdge('end', 'complete')).toBeNull();
    expect(resolveInferredEdge('start', 'complete')).toBeNull();
    expect(resolveInferredEdge('end', 'swapped')).toBeNull();
  });

  it('a placeholder (both-derived) task is treated as non-inferred (OQ5)', () => {
    expect(resolveInferredEdge('start', 'placeholder')).toBeNull();
    expect(resolveInferredEdge('end', 'placeholder')).toBeNull();
  });

  it('a whole-bar move never prompts (R2)', () => {
    expect(resolveInferredEdge('both', 'inferred-end')).toBeNull();
    expect(resolveInferredEdge('none', 'inferred-end')).toBeNull();
  });
});

describe('resolveInferredDragOutcome', () => {
  it('prompts on an inferred edge in ask mode when the estimate is writable', () => {
    expect(
      resolveInferredDragOutcome({ inferredEdge: 'end', mode: 'ask', estimateWritable: true }),
    ).toBe('prompt');
  });

  it('auto-applies the configured non-ask mode without prompting', () => {
    expect(
      resolveInferredDragOutcome({ inferredEdge: 'end', mode: 'estimate-only', estimateWritable: true }),
    ).toBe('estimate-only');
    expect(
      resolveInferredDragOutcome({
        inferredEdge: 'start',
        mode: 'estimate-and-dates',
        estimateWritable: true,
      }),
    ).toBe('estimate-and-dates');
  });

  it('falls back to write-as-today when the estimate is not writable, regardless of mode (R8/AE8)', () => {
    for (const mode of ['ask', 'estimate-only', 'estimate-and-dates'] as const) {
      expect(
        resolveInferredDragOutcome({ inferredEdge: 'end', mode, estimateWritable: false }),
      ).toBe('write-as-today');
    }
  });

  it('writes as today when no edge is inferred (authored / move)', () => {
    expect(
      resolveInferredDragOutcome({ inferredEdge: null, mode: 'ask', estimateWritable: true }),
    ).toBe('write-as-today');
  });
});

describe('buildInferredDragPatch', () => {
  const args = { newStart: d(5, 1), newEnd: end(5, 6), estimateMinutes: 8640 };

  it('estimate-only carries the estimate and materialises no date (AE2)', () => {
    const patch = buildInferredDragPatch({ action: 'estimate-only', inferredEdge: 'end', ...args });
    expect(patch).toEqual({ estimateMinutes: 8640, materialise: null });
  });

  it('estimate-and-dates carries the estimate AND the dragged end date only (AE3/OQ1)', () => {
    const patch = buildInferredDragPatch({
      action: 'estimate-and-dates',
      inferredEdge: 'end',
      ...args,
    });
    expect(patch).toEqual({
      estimateMinutes: 8640,
      materialise: { edge: 'end', date: args.newEnd },
    });
  });

  it('estimate-and-dates on an inferred start materialises the start (F4/AE5)', () => {
    const patch = buildInferredDragPatch({
      action: 'estimate-and-dates',
      inferredEdge: 'start',
      ...args,
    });
    expect(patch).toEqual({
      estimateMinutes: 8640,
      materialise: { edge: 'start', date: args.newStart },
    });
  });
});
