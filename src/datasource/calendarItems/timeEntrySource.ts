/**
 * Time-entry calendar-item source: finished tracked work sessions render as
 * flat read-only event rows, one per entry, day-attributed from their
 * offset-stamped timestamps via the shared instant normalizers (an entry
 * crossing local midnight covers both days). Running entries (no `endTime`)
 * and entries with unparseable timestamps drop silently — a bad entry never
 * breaks the family.
 *
 * Pure module: task-set access, the family toggle, and the change
 * subscription all arrive via DI. Emits flat items only — no occupancy.
 *
 * @module datasource/calendarItems/timeEntrySource
 */

import type { TaskNotesTaskInfo, TaskNotesTimeEntry } from '../TaskNotesSource';
import type { CalendarItem, CalendarItemBatch, CalendarItemSource } from './types';
import { makeCalendarItemId } from './types';
import { localDaySpanOfInstants } from './normalizers';

/** The time-entry slice of the per-view calendar-item toggles. */
export interface TimeEntryToggles {
  showTimeEntries: boolean;
}

/** Dependencies of the time-entry source, injected by the controller wiring. */
export interface TimeEntrySourceDeps {
  /** The full TaskNotes task list (canonical, field-mapper-resolved fields). */
  listTasks(): Promise<readonly TaskNotesTaskInfo[]> | readonly TaskNotesTaskInfo[];
  /** Per-view time-entry toggle, read fresh on every collect. */
  toggles(): TimeEntryToggles;
  /** Change-event seam ({@link import('../TaskNotesSource').TaskNotesSource.subscribe} shape) driving the epoch. */
  subscribe?(handler: (eventName: string, payload?: unknown) => void): () => void;
}

/** The time-entry source; `dispose` releases the change-event subscription. */
export interface TimeEntrySource extends CalendarItemSource {
  dispose(): void;
}

/** Everything one time-entry expansion derives against. */
export interface TimeEntryExpansionInput {
  tasks: readonly TaskNotesTaskInfo[];
  toggles: TimeEntryToggles;
}

function toCalendarItem(task: TaskNotesTaskInfo, entry: TaskNotesTimeEntry): CalendarItem | null {
  // No endTime = still running; the calendar renders finished entries only.
  if (entry.endTime === undefined) return null;
  const span = localDaySpanOfInstants(entry.startTime, entry.endTime);
  if (span === null) return null;
  return {
    // The start timestamp discriminates multiple entries on one local day;
    // it is data, so the id survives refreshes unchanged.
    id: makeCalendarItemId('time-entry', task.path, `${span.startDay}#${entry.startTime}`),
    family: 'time-entry',
    title: task.title ?? '',
    startDay: span.startDay,
    endDay: span.endDay,
    notePath: task.path,
  };
}

/** Pure expansion: finished time entries → flat day-attributed event rows. */
export function expandTimeEntryItems(input: TimeEntryExpansionInput): CalendarItemBatch {
  const occupancyByTaskPath = new Map<string, never[]>();
  if (!input.toggles.showTimeEntries) return { items: [], occupancyByTaskPath };

  const items: CalendarItem[] = [];
  for (const task of input.tasks) {
    for (const entry of task.timeEntries ?? []) {
      const item = toCalendarItem(task, entry);
      if (item !== null) items.push(item);
    }
  }
  return { items, occupancyByTaskPath };
}

/** Build the time-entry {@link CalendarItemSource} over injected deps. */
export function createTimeEntrySource(deps: TimeEntrySourceDeps): TimeEntrySource {
  let epoch = 0;
  const unsubscribe = deps.subscribe?.(() => {
    epoch += 1;
  });
  return {
    family: 'time-entry',
    epoch: () => epoch,
    collect: async () =>
      expandTimeEntryItems({
        tasks: await deps.listTasks(),
        toggles: deps.toggles(),
      }),
    dispose: () => {
      unsubscribe?.();
    },
  };
}
