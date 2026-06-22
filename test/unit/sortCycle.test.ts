/**
 * Unit tests for the ephemeral sort-cycle helper (plan 2026-06-22-002, U2).
 *
 * A header click cycles one column through three states: ascending →
 * descending → cleared (back to the Base order). Clicking a *different* column
 * restarts that column at ascending. The helper is the pure decision; the
 * interceptor in GanttContainer applies it (let SVAR sort for asc/desc, route
 * to the shared clear path for the null result).
 */
import { describe, it, expect } from '@jest/globals';
import { cycleNext } from '../../src/bases/sortCycle';

describe('cycleNext', () => {
  it('starts a fresh column at ascending (Covers AE2)', () => {
    expect(cycleNext(null, 'due')).toEqual({ column: 'due', direction: 'asc' });
  });

  it('advances the same column from ascending to descending', () => {
    expect(cycleNext({ column: 'due', direction: 'asc' }, 'due')).toEqual({
      column: 'due',
      direction: 'desc',
    });
  });

  it('clears the sort on the third click of the same column', () => {
    expect(cycleNext({ column: 'due', direction: 'desc' }, 'due')).toBeNull();
  });

  it('restarts at ascending when a different column is clicked', () => {
    expect(cycleNext({ column: 'due', direction: 'desc' }, 'name')).toEqual({
      column: 'name',
      direction: 'asc',
    });
    expect(cycleNext({ column: 'due', direction: 'asc' }, 'name')).toEqual({
      column: 'name',
      direction: 'asc',
    });
  });
});
