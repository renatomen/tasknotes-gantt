/**
 * Pins the reproduced status and priority glyph rule against TaskNotes
 * `src/ui/kit/glyphs.ts` (`statusGlyphState`, `priorityGlyphState`) at tag 5.0.5.
 */
import { describe, expect, it } from '@jest/globals';
import {
  priorityGlyphState,
  statusGlyphState,
  type PriorityGlyphInput,
  type StatusGlyphInput,
} from '../../src/datasource/taskNotesIconState';

const WORKFLOW: StatusGlyphInput[] = [
  { id: 'none', value: 'none', isCompleted: false, order: 0 },
  { id: 'open', value: 'open', isCompleted: false, order: 1 },
  { id: 'in-progress', value: 'in-progress', isCompleted: false, order: 2 },
  { id: 'review', value: 'review', isCompleted: false, order: 3 },
  { id: 'done', value: 'done', isCompleted: true, order: 4 },
  { id: 'skipped', value: 'skipped', isCompleted: false, isSkipped: true, order: 5 },
];

describe('statusGlyphState', () => {
  it('marks the none status unset and the first open status an empty ring', () => {
    expect(statusGlyphState('none', WORKFLOW)).toEqual({
      role: 'status',
      kind: 'unset',
      progress: 0,
    });
    expect(statusGlyphState('open', WORKFLOW)).toEqual({
      role: 'status',
      kind: 'open',
      progress: 0,
    });
  });

  it('fills later open statuses by their place in the open workflow', () => {
    expect(statusGlyphState('in-progress', WORKFLOW)).toEqual({
      role: 'status',
      kind: 'progress',
      progress: 1 / 3,
    });
    expect(statusGlyphState('review', WORKFLOW)).toEqual({
      role: 'status',
      kind: 'progress',
      progress: 2 / 3,
    });
  });

  it('marks a completed status complete and a skipped status skipped', () => {
    expect(statusGlyphState('done', WORKFLOW)).toEqual({
      role: 'status',
      kind: 'complete',
      progress: 1,
    });
    expect(statusGlyphState('skipped', WORKFLOW)).toEqual({
      role: 'status',
      kind: 'skipped',
      progress: 1,
    });
  });

  it('gives the same states when the catalog is listed out of order', () => {
    const reversed = [...WORKFLOW].reverse();
    for (const status of WORKFLOW) {
      expect(statusGlyphState(status.value, reversed)).toEqual(
        statusGlyphState(status.value, WORKFLOW),
      );
    }
  });

  it('treats a status flagged both completed and skipped as skipped', () => {
    const both: StatusGlyphInput = {
      id: 'both',
      value: 'both',
      isCompleted: true,
      isSkipped: true,
      order: 9,
    };
    expect(statusGlyphState('both', [...WORKFLOW, both])).toEqual({
      role: 'status',
      kind: 'skipped',
      progress: 1,
    });
  });

  it('marks an empty value unset and an unconfigured value unknown', () => {
    expect(statusGlyphState('', WORKFLOW)).toEqual({
      role: 'status',
      kind: 'unset',
      progress: 0,
    });
    expect(statusGlyphState('missing', WORKFLOW)).toEqual({
      role: 'status',
      kind: 'unknown',
      progress: 0,
    });
  });
});

const RANKS: PriorityGlyphInput[] = [
  { value: 'urgent', weight: 3 },
  { value: 'high', weight: 2 },
  { value: 'low', weight: 1 },
  { value: 'none', weight: 0 },
];

describe('priorityGlyphState', () => {
  it('ranks the highest, middle, and lowest weighted priorities, and leaves weight zero unset', () => {
    expect(priorityGlyphState('urgent', RANKS)).toEqual({
      role: 'priority',
      kind: 'dot',
      rank: 'top',
    });
    expect(priorityGlyphState('high', RANKS)).toEqual({
      role: 'priority',
      kind: 'dot',
      rank: 'middle',
    });
    expect(priorityGlyphState('low', RANKS)).toEqual({
      role: 'priority',
      kind: 'dot',
      rank: 'bottom',
    });
    expect(priorityGlyphState('none', RANKS)).toEqual({ role: 'priority', kind: 'unset' });
  });

  it('ranks a single weighted priority in the middle', () => {
    expect(priorityGlyphState('only', [{ value: 'only', weight: 5 }])).toEqual({
      role: 'priority',
      kind: 'dot',
      rank: 'middle',
    });
  });

  it('marks a missing priority unset and an unconfigured priority unknown', () => {
    expect(priorityGlyphState(undefined, RANKS)).toEqual({ role: 'priority', kind: 'unset' });
    expect(priorityGlyphState('', RANKS)).toEqual({ role: 'priority', kind: 'unset' });
    expect(priorityGlyphState('missing', RANKS)).toEqual({ role: 'priority', kind: 'unknown' });
  });
});
