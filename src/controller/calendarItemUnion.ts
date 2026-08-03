/**
 * Pure union of calendar-item batches into the render-instance list.
 *
 * Flat items become read-only event rows appended AFTER every task row; each
 * batch's per-task occupancy attachments merge onto every render instance of
 * the owning task (keyed by task path) and never become rows. With nothing to
 * union the input list is returned unchanged, so the default (no injected
 * sources) path is byte-for-byte today's task-only behavior.
 *
 * @module controller/calendarItemUnion
 */

import type {
  CalendarDerivationWindow,
  CalendarItem,
  CalendarItemBatch,
  CalendarOccupancy,
} from '../datasource/calendarItems';
import type { RenderInstance } from './InstanceExpansion';
import { spanEvaluationWindow } from './calendar/derivation';
import { isoToLocalDate, isoToLocalEndOfDay } from './calendar/stretch';

/**
 * The derivation window calendar-item sources derive against: the same
 * evaluation window the blocking-facts derivation uses over the pass's task
 * spans, so every calendar consumer windows itself identically. An all-undated
 * task set anchors the window at `today` with the same margin.
 */
export function calendarDerivationWindow(
  spans: ReadonlyArray<{ start: Date | null; end: Date | null }>,
  today: Date,
): CalendarDerivationWindow {
  return (
    spanEvaluationWindow(spans) ?? spanEvaluationWindow([{ start: today, end: today }])!
  );
}

/**
 * Union calendar-item batches into the task render list. Returns the input
 * list unchanged (same reference) when there is nothing to union.
 */
export function unionCalendarBatches(
  taskInstances: readonly RenderInstance[],
  batches: readonly CalendarItemBatch[],
): readonly RenderInstance[] {
  if (batches.length === 0) {
    return taskInstances;
  }
  const occupancyByTask = mergeOccupancyByTask(batches);
  const eventRows = batches.flatMap((batch) => batch.items.map(toEventRow));
  if (occupancyByTask.size === 0 && eventRows.length === 0) {
    return taskInstances;
  }
  const withOccupancy =
    occupancyByTask.size === 0
      ? taskInstances
      : taskInstances.map((instance) => attachOccupancy(instance, occupancyByTask));
  return [...withOccupancy, ...eventRows];
}

/**
 * Merge every batch's occupancy channel into one per-task map, preserving
 * batch order. Occupancy for a task path with no render instance is dropped —
 * the channel attaches to existing rows, never creates them.
 */
function mergeOccupancyByTask(
  batches: readonly CalendarItemBatch[],
): Map<string, CalendarOccupancy[]> {
  const merged = new Map<string, CalendarOccupancy[]>();
  for (const batch of batches) {
    for (const [taskPath, occupancy] of batch.occupancyByTaskPath) {
      if (occupancy.length === 0) {
        continue;
      }
      const existing = merged.get(taskPath);
      if (existing) {
        existing.push(...occupancy);
      } else {
        merged.set(taskPath, [...occupancy]);
      }
    }
  }
  return merged;
}

/** Attach a task's merged occupancy to its instance; untouched tasks pass through. */
function attachOccupancy(
  instance: RenderInstance,
  occupancyByTask: ReadonlyMap<string, readonly CalendarOccupancy[]>,
): RenderInstance {
  const occupancy = occupancyByTask.get(instance.sourcePath);
  return occupancy ? { ...instance, occupancy } : instance;
}

/**
 * A calendar item as a read-only render row. The synthetic id flows through
 * `sourcePath` (the same field task identity uses); the item itself rides
 * along so path-consuming surfaces can branch on the namespace and resolve
 * the backing note.
 */
function toEventRow(item: CalendarItem): RenderInstance {
  return {
    id: item.id,
    sourcePath: item.id,
    text: item.title,
    start: isoToLocalDate(item.startDay),
    end: isoToLocalEndOfDay(item.endDay),
    progress: null,
    isVirtual: false,
    isCollapsed: false,
    dateStatus: 'complete',
    estimateMinutes: null,
    status: null,
    priority: null,
    isFetched: false,
    isTopLevelPlacement: false,
    calendarItem: item,
  };
}
