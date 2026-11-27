/**
 * Recurring occupancy for the Gantt.
 *
 * The model calendar decides which occurrences exist. This module asks it
 * once per task and attaches the resulting facts to the task row. A task the
 * model cannot read drops out of the batch. Task-set access, toggles,
 * reference resolution, and the change subscription all arrive via DI.
 * Occupancy only — the recurring family adds no flat event rows.
 *
 * @module datasource/calendarItems/recurringSource
 */

import type { TaskNotesTaskInfo } from '../TaskNotesSource';
import type {
  CalendarDerivationWindow,
  CalendarItemBatch,
  CalendarItemQueryContext,
  CalendarItemSource,
} from './types';
import { deriveRecurringOccupancy } from './recurringModelCalendar';

/** Per-day state of one recurring instance (drives the per-instance piece classes). */
export type RecurringInstanceState =
  | 'next'
  | 'projected'
  | 'completed'
  | 'skipped'
  | 'materialized';

const RECURRING_STATE_KINDS = {
  next: 'virtual',
  projected: 'virtual',
  completed: 'recorded',
  skipped: 'recorded',
  materialized: 'recorded',
} as const satisfies Record<RecurringInstanceState, 'virtual' | 'recorded'>;

export type RecordedRecurringState = {
  [State in RecurringInstanceState]: (typeof RECURRING_STATE_KINDS)[State] extends 'recorded'
    ? State
    : never;
}[RecurringInstanceState];

export const RECORDED_RECURRING_STATE_CLASSES: readonly RecordedRecurringState[] =
  Object.entries(RECURRING_STATE_KINDS)
    .filter(([, kind]) => kind === 'recorded')
    .map(([state]) => state) as RecordedRecurringState[];

export function isRecordedRecurringStateClass(
  stateClass: string | undefined,
): stateClass is RecordedRecurringState {
  return (
    stateClass !== undefined &&
    Object.prototype.hasOwnProperty.call(RECURRING_STATE_KINDS, stateClass) &&
    RECURRING_STATE_KINDS[stateClass as RecurringInstanceState] === 'recorded'
  );
}

/** The recurring-family slice of the per-view calendar-item toggles. */
export interface RecurringInstanceToggles {
  showRecurring: boolean;
  showCompletedRecurringInstances: boolean;
  showSkippedRecurringInstances: boolean;
}

/** Resolves a parent link path to a vault note path (metadataCache seam). */
export type TaskReferenceResolver = (linkPath: string, fromPath: string) => string | null;

/** Dependencies of the recurring source, injected by the controller wiring. */
export interface RecurringSourceDeps {
  /** The full TaskNotes task list (canonical, field-mapper-resolved fields). */
  listTasks(): Promise<readonly TaskNotesTaskInfo[]> | readonly TaskNotesTaskInfo[];
  /** Per-view recurring toggles, read fresh on every collect. */
  toggles(): RecurringInstanceToggles;
  /** Resolve `recurrence_parent` references; absent → normalized-reference fallback. */
  resolveTaskReference?: TaskReferenceResolver;
  /** Change-event seam ({@link import('../TaskNotesSource').TaskNotesSource.subscribe} shape) driving the epoch. */
  subscribe?(handler: (eventName: string, payload?: unknown) => void): () => void;
}

/** The recurring source; `dispose` releases the change-event subscription. */
export interface RecurringInstanceSource extends CalendarItemSource {
  dispose(): void;
}

/** Everything one parity expansion derives against. */
export interface RecurringExpansionInput {
  tasks: readonly TaskNotesTaskInfo[];
  window: CalendarDerivationWindow;
  toggles: RecurringInstanceToggles;
  resolveTaskReference?: TaskReferenceResolver;
  /** Observer zone for entry placement. Defaults to the runtime time zone. */
  timezone?: string;
  /** ISO instant the model treats as now. Defaults to the current time. */
  now?: string;
}

/** Recurring occupancy for one derivation window. One model call per task. */
export function expandRecurringOccupancy(input: RecurringExpansionInput): CalendarItemBatch {
  const derived = deriveRecurringOccupancy(input);
  return {
    items: [],
    occupancyByTaskPath: derived.occupancyByTaskPath,
    plainBarSuppressedTaskPaths: derived.plainBarSuppressedTaskPaths,
  };
}

/** Build the recurring-instance {@link CalendarItemSource} over injected deps. */
export function createRecurringInstanceSource(deps: RecurringSourceDeps): RecurringInstanceSource {
  let epoch = 0;
  const unsubscribe = deps.subscribe?.(() => {
    epoch += 1;
  });
  return {
    family: 'recurring-instance',
    epoch: () => epoch,
    collect: async (context: CalendarItemQueryContext) =>
      expandRecurringOccupancy({
        tasks: await deps.listTasks(),
        window: context.window,
        toggles: deps.toggles(),
        resolveTaskReference: deps.resolveTaskReference,
      }),
    dispose: () => {
      unsubscribe?.();
    },
  };
}
