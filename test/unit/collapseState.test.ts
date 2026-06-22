/**
 * Unit tests for the collapse-all toggle helper (U7).
 *
 * Collapse state is ephemeral session state (not persisted), so only the pure
 * collapse-all / expand-all decision is covered here.
 */
import { describe, it, expect } from '@jest/globals';
import { toggleCollapseAll } from '../../src/bases/collapseState';

describe('toggleCollapseAll', () => {
  const parents = new Set(['p1', 'p2', 'p3']);

  it('collapses all parents when some are still expanded', () => {
    expect(toggleCollapseAll(parents, new Set(['p1']))).toEqual(parents);
  });

  it('expands all (empty) when every parent is already collapsed', () => {
    expect(toggleCollapseAll(parents, new Set(['p1', 'p2', 'p3']))).toEqual(new Set());
  });

  it('collapses all when nothing is collapsed yet', () => {
    expect(toggleCollapseAll(parents, new Set())).toEqual(parents);
  });

  it('resolves to expand-all when there are no collapsible parents', () => {
    expect(toggleCollapseAll(new Set(), new Set())).toEqual(new Set());
  });
});
