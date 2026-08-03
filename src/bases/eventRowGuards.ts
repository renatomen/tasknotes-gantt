/**
 * Read-only enforcement for calendar-item event rows (calendar-view union).
 *
 * Calendar items render as rows in the same SVAR store as tasks, but they are
 * derived facts — no mutating gesture may reach them (R9). SVAR has no per-task
 * readonly flag, so `GanttContainer`'s `api.intercept` handlers consult these
 * pure predicates and refuse the gesture per-row; refusing `drag-task` at the
 * first frame makes SVAR abort the whole gesture natively.
 *
 * All predicates are total over `unknown` ids: anything that is not a synthetic
 * calendar-item id is treated as a task row (allow), never a throw — an
 * unexpected payload must degrade to today's task behavior, not brick editing.
 *
 * @module bases/eventRowGuards
 */

import { isCalendarItemId } from '../datasource/calendarItems';

/** Whether a row id (SVAR event payload, so possibly non-string) is a calendar-item row. */
export function isCalendarItemRow(id: unknown): boolean {
  return typeof id === 'string' && isCalendarItemId(id);
}

/**
 * Per-row veto for the single-row mutating intercepts (`drag-task`,
 * `update-task`, and every reorder alias): `false` refuses the gesture.
 */
export function allowsRowMutation(id: unknown): boolean {
  return !isCalendarItemRow(id);
}

/**
 * Whole veto for a committed mutating event (`update-task`): refuse only a
 * USER gesture on a calendar-item row. Programmatic echoes and syncing-window
 * refreshes must pass, or the diff-sync could never apply our own updates to
 * event rows.
 */
export function refusesUserRowMutation(
  ev: { id?: unknown; eventSource?: string },
  context: { syncing: boolean; echoSource: string },
): boolean {
  if (context.syncing || ev.eventSource === context.echoSource) return false;
  return !allowsRowMutation(ev.id);
}

/**
 * Per-link veto for `add-link` / `delete-link`: a dependency edge may not
 * touch a calendar-item row on either end.
 */
export function allowsLinkEndpoints(source: unknown, target: unknown): boolean {
  return allowsRowMutation(source) && allowsRowMutation(target);
}

/** Where a double-click (SVAR `show-editor`) on a row should go. */
export type ShowEditorRoute =
  | { kind: 'task-editor' }
  | { kind: 'open-note'; notePath: string }
  | { kind: 'none' };

/**
 * Route a double-click: task rows keep the existing editor flow; a calendar
 * row opens its backing note when it has one, else no-ops (a synthetic id is
 * never an openable path). The finder is consulted only for calendar rows.
 */
export function resolveShowEditorRoute(
  id: unknown,
  findBackingNotePath: (rowId: string) => string | null | undefined,
): ShowEditorRoute {
  if (typeof id !== 'string' || !isCalendarItemId(id)) {
    return { kind: 'task-editor' };
  }
  const notePath = findBackingNotePath(id);
  return notePath ? { kind: 'open-note', notePath } : { kind: 'none' };
}
