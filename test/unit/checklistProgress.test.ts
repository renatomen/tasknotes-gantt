/**
 * Shared checklist-progress helpers (U3/U4): the single source of truth for
 * "what counts as a top-level checklist item", used both to compute the bar
 * value (BasesSource) and to fingerprint completion for the refresh gate
 * (computeEntrySignature). Pure/Obsidian-free.
 */
import { describe, it, expect } from '@jest/globals';
import {
  countTopLevelChecklistItems,
  checklistProgressPercent,
  checklistCompletionSignature,
} from '../../src/bases/checklistProgress';

const topLevel = (task: string) => ({ task, parent: -1 });

describe('countTopLevelChecklistItems', () => {
  it('counts completed and total top-level items', () => {
    expect(
      countTopLevelChecklistItems([topLevel('x'), topLevel('x'), topLevel(' '), topLevel(' ')]),
    ).toEqual({ completed: 2, total: 4 });
  });

  it('excludes nested items (parent >= 0) and plain bullets (no task)', () => {
    const items = [
      topLevel('x'),
      { task: 'x', parent: 0 }, // nested — excluded
      { parent: -1 }, // plain bullet — excluded
      topLevel(' '),
    ];
    expect(countTopLevelChecklistItems(items)).toEqual({ completed: 1, total: 2 });
  });

  it('counts x/X as complete, other markers as incomplete', () => {
    expect(countTopLevelChecklistItems([topLevel('X'), topLevel('/'), topLevel(' ')])).toEqual({
      completed: 1,
      total: 3,
    });
  });

  it('returns zeros for undefined/empty', () => {
    expect(countTopLevelChecklistItems(undefined)).toEqual({ completed: 0, total: 0 });
    expect(countTopLevelChecklistItems([])).toEqual({ completed: 0, total: 0 });
  });
});

describe('checklistProgressPercent', () => {
  it('rounds completed/total to a percentage', () => {
    expect(checklistProgressPercent([topLevel('x'), topLevel(' '), topLevel(' ')])).toBe(33);
    expect(checklistProgressPercent([topLevel('x'), topLevel('x')])).toBe(100);
  });

  it('returns null when there are no checklist items', () => {
    expect(checklistProgressPercent([])).toBeNull();
    expect(checklistProgressPercent([{ parent: -1 }])).toBeNull();
  });
});

describe('checklistCompletionSignature', () => {
  it('is a compact completed/total string that changes when an item is toggled', () => {
    const before = checklistCompletionSignature([topLevel('x'), topLevel(' '), topLevel(' ')]);
    const after = checklistCompletionSignature([topLevel('x'), topLevel('x'), topLevel(' ')]);
    expect(before).toBe('1/3');
    expect(after).toBe('2/3');
    expect(before).not.toBe(after);
  });

  it('is empty when there are no checklist items (so it adds nothing to the signature)', () => {
    expect(checklistCompletionSignature(undefined)).toBe('');
    expect(checklistCompletionSignature([{ parent: -1 }])).toBe('');
  });
});
