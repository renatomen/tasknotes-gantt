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

import {
  EXTERNAL_OCCUPANCY_STATE,
  type CalendarDerivationWindow,
  type CalendarItem,
  type CalendarItemBatch,
  type CalendarOccupancy,
  type LocalDay,
} from '../datasource/calendarItems';
import type { RenderInstance } from './InstanceExpansion';
import { spanEvaluationWindow } from './calendar/derivation';
import { isoToLocalDate, isoToLocalEndOfDay, localIso } from './calendar/stretch';

/**
 * The derivation window calendar-item sources derive against: the same
 * evaluation window the blocking-facts derivation uses over the pass's task
 * spans, extended to cover today through the same local day next year and
 * widened backward for source-owned anchors such as historical Daily Notes.
 * An all-undated task set retains the existing today-centered margin.
 */
export function calendarDerivationWindow(
  spans: ReadonlyArray<{ start: Date | null; end: Date | null }>,
  today: Date,
  startAnchors: readonly LocalDay[] = [],
): CalendarDerivationWindow {
  const spanWindow = spanEvaluationWindow(spans);
  if (spanWindow === null) {
    const todayWindow = spanEvaluationWindow([{ start: today, end: today }])!;
    return { ...todayWindow, startDate: earliestDay(todayWindow.startDate, startAnchors) };
  }
  const todayDay = localIso(today);
  const annualHorizon = localDayNextYear(today);
  return {
    startDate: earliestDay(
      spanWindow.startDate < todayDay ? spanWindow.startDate : todayDay,
      startAnchors,
    ),
    endDateExclusive:
      spanWindow.endDateExclusive > annualHorizon
        ? spanWindow.endDateExclusive
        : annualHorizon,
  };
}

function earliestDay(fallback: LocalDay, candidates: readonly LocalDay[]): LocalDay {
  return candidates.reduce(
    (earliest, candidate) => (candidate < earliest ? candidate : earliest),
    fallback,
  );
}

/** The same local calendar day next year, clamped for leap day. */
function localDayNextYear(date: Date): string {
  const year = date.getFullYear() + 1;
  const month = date.getMonth();
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  return localIso(new Date(year, month, Math.min(date.getDate(), lastDayOfMonth)));
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
  const suppressedPaths = mergeSuppressedPaths(batches);
  const withOccupancy =
    occupancyByTask.size === 0
      ? taskInstances
      : taskInstances.map((instance) =>
          attachOccupancy(instance, occupancyByTask, suppressedPaths),
        );
  return [...withOccupancy, ...eventRows];
}

/** Union of every batch's plain-bar-suppressed task paths. */
function mergeSuppressedPaths(batches: readonly CalendarItemBatch[]): ReadonlySet<string> {
  const merged = new Set<string>();
  for (const batch of batches) {
    for (const path of batch.plainBarSuppressedTaskPaths ?? []) {
      merged.add(path);
    }
  }
  return merged;
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

/**
 * Attach a task's merged occupancy — and, with it, whether a batch suppresses
 * the task's plain bar — to its instance; untouched tasks pass through.
 * Suppression rides only alongside occupancy: with nothing to render in the
 * plain bar's place, the view must keep the plain bar regardless.
 */
function attachOccupancy(
  instance: RenderInstance,
  occupancyByTask: ReadonlyMap<string, readonly CalendarOccupancy[]>,
  suppressedPaths: ReadonlySet<string>,
): RenderInstance {
  const occupancy = occupancyByTask.get(instance.sourcePath);
  if (!occupancy) return instance;
  return suppressedPaths.has(instance.sourcePath)
    ? { ...instance, occupancy, plainBarSuppressed: true }
    : { ...instance, occupancy };
}

/**
 * A calendar item as a read-only render row. The synthetic id flows through
 * `sourcePath` (the same field task identity uses); the item itself rides
 * along so path-consuming surfaces can branch on the namespace and resolve
 * the backing note. A multi-occurrence series item additionally carries its
 * occupied days as occupancy, so the row renders through the same
 * suppressed-envelope substrate as recurring tasks: the item's span IS the
 * envelope, one piece paints per occupied day, gaps stay unrendered.
 */
function toEventRow(item: CalendarItem): RenderInstance {
  const row: RenderInstance = {
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
  const occupancy = seriesOccupancy(item);
  return occupancy ? { ...row, occupancy, plainBarSuppressed: true } : row;
}

/**
 * One external-state occupancy entry per occupied day of a multi-occurrence
 * series, or `undefined` for a single-span item (which stays a solid bar).
 * Occurrences carry no backing note of their own, so piece activation routes
 * to the row — resolved through the item's namespace like the bar itself.
 */
function seriesOccupancy(item: CalendarItem): CalendarOccupancy[] | undefined {
  const days = item.occupancyDays;
  if (!days || days.length <= 1) return undefined;
  return days.map((day) => ({
    family: item.family,
    itemId: item.id,
    day,
    minutes: null,
    stateClass: EXTERNAL_OCCUPANCY_STATE,
  }));
}
