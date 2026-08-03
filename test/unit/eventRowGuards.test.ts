/**
 * eventRowGuards unit tests (calendar-view union U3).
 *
 * Whole-row read-only enforcement for calendar-item event rows: every mutating
 * SVAR gesture is refused per-row via these pure predicates, while task rows
 * keep their existing editability. Show-editor routing sends a calendar row's
 * double-click to its backing note (when it has one) instead of the task
 * editor flow.
 */

import { describe, it, expect } from '@jest/globals';
import {
  isCalendarItemRow,
  allowsRowMutation,
  allowsLinkEndpoints,
  refusesUserRowMutation,
  resolveShowEditorRoute,
} from '../../src/bases/eventRowGuards';
import { makeCalendarItemId } from '../../src/datasource/calendarItems';

const eventRowId = makeCalendarItemId('timeblock', 'Calendar/blocks.md', '2026-08-03');
const taskPath = 'Tasks/write-report.md';
const otherTaskPath = 'Tasks/review-report.md';

describe('isCalendarItemRow', () => {
  it('recognizes a synthetic calendar-item id', () => {
    expect(isCalendarItemRow(eventRowId)).toBe(true);
  });

  it('treats a vault path as a task row', () => {
    expect(isCalendarItemRow(taskPath)).toBe(false);
  });

  it('is total: unknown/empty ids are task rows, never a throw', () => {
    expect(isCalendarItemRow(undefined)).toBe(false);
    expect(isCalendarItemRow(null)).toBe(false);
    expect(isCalendarItemRow('')).toBe(false);
    expect(isCalendarItemRow(42)).toBe(false);
  });
});

describe('allowsRowMutation (drag-task / update-task / reorder intercepts)', () => {
  const mutatingActions = [
    'drag-task',
    'update-task',
    'move-task',
    'move-task:up',
    'move-task:down',
    'reorder-tasks',
    'move-up',
    'move-down',
  ] as const;

  it.each(mutatingActions)('%s: refuses a calendar-item row', () => {
    expect(allowsRowMutation(eventRowId)).toBe(false);
  });

  it.each(mutatingActions)('%s: allows a task row (vault path)', () => {
    expect(allowsRowMutation(taskPath)).toBe(true);
  });

  it('is total: unknown/empty ids are allowed as tasks, never a throw', () => {
    expect(allowsRowMutation(undefined)).toBe(true);
    expect(allowsRowMutation(null)).toBe(true);
    expect(allowsRowMutation('')).toBe(true);
    expect(allowsRowMutation(7)).toBe(true);
  });
});

describe('refusesUserRowMutation (committed update-task intercept)', () => {
  const context = { syncing: false, echoSource: 'og-echo' };

  it('refuses a user gesture on a calendar-item row', () => {
    expect(refusesUserRowMutation({ id: eventRowId }, context)).toBe(true);
  });

  it('allows a user gesture on a task row', () => {
    expect(refusesUserRowMutation({ id: taskPath }, context)).toBe(false);
  });

  it('lets our own echo pass even for a calendar-item row (diff-sync applies)', () => {
    expect(
      refusesUserRowMutation({ id: eventRowId, eventSource: 'og-echo' }, context),
    ).toBe(false);
  });

  it('lets a syncing-window event pass even for a calendar-item row', () => {
    expect(
      refusesUserRowMutation({ id: eventRowId }, { syncing: true, echoSource: 'og-echo' }),
    ).toBe(false);
  });
});

describe('allowsLinkEndpoints (add-link / delete-link intercepts)', () => {
  it('add-link: refuses when the SOURCE end is a calendar-item row', () => {
    expect(allowsLinkEndpoints(eventRowId, taskPath)).toBe(false);
  });

  it('add-link: refuses when the TARGET end is a calendar-item row', () => {
    expect(allowsLinkEndpoints(taskPath, eventRowId)).toBe(false);
  });

  it('delete-link: refuses when either resolved endpoint is a calendar-item row', () => {
    expect(allowsLinkEndpoints(eventRowId, eventRowId)).toBe(false);
  });

  it('allows a task-to-task link', () => {
    expect(allowsLinkEndpoints(taskPath, otherTaskPath)).toBe(true);
  });

  it('is total: unknown endpoints are allowed as tasks, never a throw', () => {
    expect(allowsLinkEndpoints(undefined, undefined)).toBe(true);
    expect(allowsLinkEndpoints(null, 3)).toBe(true);
  });
});

describe('resolveShowEditorRoute', () => {
  it('routes a calendar row with a backing note to the open-note path', () => {
    const route = resolveShowEditorRoute(eventRowId, () => 'Calendar/blocks.md');
    expect(route).toEqual({ kind: 'open-note', notePath: 'Calendar/blocks.md' });
  });

  it('routes a calendar row without a backing note to a no-op', () => {
    expect(resolveShowEditorRoute(eventRowId, () => undefined)).toEqual({ kind: 'none' });
    expect(resolveShowEditorRoute(eventRowId, () => null)).toEqual({ kind: 'none' });
  });

  it('leaves a task row on the existing editor flow without consulting the note finder', () => {
    let finderCalls = 0;
    const route = resolveShowEditorRoute(taskPath, () => {
      finderCalls += 1;
      return 'never.md';
    });
    expect(route).toEqual({ kind: 'task-editor' });
    expect(finderCalls).toBe(0);
  });

  it('is total: an unknown id stays on the task editor flow, never a throw', () => {
    expect(resolveShowEditorRoute(undefined, () => 'x.md')).toEqual({ kind: 'task-editor' });
    expect(resolveShowEditorRoute('', () => 'x.md')).toEqual({ kind: 'task-editor' });
  });
});
