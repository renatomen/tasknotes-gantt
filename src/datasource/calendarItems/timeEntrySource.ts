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
import type {
  CalendarItem,
  CalendarItemBatch,
  CalendarItemSource,
  LocalDay,
} from './types';
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

interface TimeEntryCandidate {
  entry: TaskNotesTimeEntry & { endTime: string };
  sourceIndex: number;
  startDay: LocalDay;
  endDay: LocalDay;
}

function toCandidate(entry: TaskNotesTimeEntry, sourceIndex: number): TimeEntryCandidate | null {
  if (entry.endTime === undefined) return null;
  const span = localDaySpanOfInstants(entry.startTime, entry.endTime);
  if (span === null) return null;
  return { entry: { ...entry, endTime: entry.endTime }, sourceIndex, ...span };
}

function compareTwinCandidates(a: TimeEntryCandidate, b: TimeEntryCandidate): number {
  const durationOrder = String(a.entry.duration ?? '').localeCompare(String(b.entry.duration ?? ''));
  if (durationOrder !== 0) return durationOrder;
  const descriptionOrder = (a.entry.description ?? '').localeCompare(b.entry.description ?? '');
  return descriptionOrder !== 0 ? descriptionOrder : a.sourceIndex - b.sourceIndex;
}

function twinOrdinals(candidates: readonly TimeEntryCandidate[]): ReadonlyMap<number, number> {
  const groups = new Map<string, TimeEntryCandidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.entry.startTime}\u0000${candidate.entry.endTime}`;
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }
  const ordinals = new Map<number, number>();
  for (const group of groups.values()) {
    group
      .sort(compareTwinCandidates)
      .forEach((candidate, index) => ordinals.set(candidate.sourceIndex, index + 1));
  }
  return ordinals;
}

function toCalendarItem(
  task: TaskNotesTaskInfo,
  candidate: TimeEntryCandidate,
  twinOrdinal: number,
): CalendarItem {
  const { entry, startDay, endDay } = candidate;
  return {
    id: makeCalendarItemId(
      'time-entry',
      task.path,
      `${startDay}#${entry.startTime}#${entry.endTime}#${twinOrdinal}`,
    ),
    family: 'time-entry',
    title: task.title ?? '',
    startDay,
    endDay,
    notePath: task.path,
  };
}

/** Pure expansion: finished time entries → flat day-attributed event rows. */
export function expandTimeEntryItems(input: TimeEntryExpansionInput): CalendarItemBatch {
  const occupancyByTaskPath = new Map<string, never[]>();
  if (!input.toggles.showTimeEntries) return { items: [], occupancyByTaskPath };

  const items: CalendarItem[] = [];
  for (const task of input.tasks) {
    const candidates = (task.timeEntries ?? [])
      .map((entry, index) => toCandidate(entry, index))
      .filter((candidate): candidate is TimeEntryCandidate => candidate !== null);
    const ordinals = twinOrdinals(candidates);
    for (const candidate of candidates) {
      items.push(toCalendarItem(task, candidate, ordinals.get(candidate.sourceIndex) ?? 1));
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
