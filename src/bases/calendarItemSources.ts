/**
 * Register-side provider of concrete calendar-item sources.
 *
 * Bridges the per-view "Calendar items" toggles to the controller's
 * `createCalendarItemSources` dep: the toggles are read fresh on every
 * `provide()` (provider-closure pattern), and each opted-in family gets its
 * concrete source over the injected TaskNotes read/event seams. Pure DI — no
 * Obsidian imports — so the wiring is unit-testable without a vault.
 *
 * Two deliberate lifecycle rules:
 *
 * 1. **Recurring is always on; event families are created once and retained.**
 *    The recurring source is created on the FIRST `provide()` regardless of
 *    its toggle: the recurring engine emits recorded (completed/skipped)
 *    instances and materialized occurrences with the family toggle off — the
 *    TaskNotes calendar's semantics — so a fresh default view must collect it
 *    for dataset parity. Event-emitting families (time entries) emit nothing
 *    while off, so they are created lazily on the first toggle-on and stay
 *    provided after opt-out. Identity stays stable because the controller's
 *    batch cache keys on the source object.
 * 2. **Toggle flips ride the epoch.** The controller reuses a source's cached
 *    batch while its epoch is unchanged, and the sources' own epochs track
 *    only TaskNotes change events — so a toggles revision (bumped whenever the
 *    observed toggle values change between provides) is folded into every
 *    provided epoch. Both components only ever grow, so the sum is monotonic
 *    and equal only when neither changed.
 *
 * @module bases/calendarItemSources
 */

import {
  createRecurringInstanceSource,
  createTimeEntrySource,
  type CalendarItemQueryContext,
  type CalendarItemSource,
  type TaskReferenceResolver,
} from '../datasource/calendarItems';
import type { TaskNotesTaskInfo } from '../datasource/TaskNotesSource';
import {
  calendarItemTogglesSignatureTag,
  type CalendarItemToggles,
} from './calendarItemOptions';

/** A concrete family source plus its subscription disposer. */
interface DisposableCalendarItemSource extends CalendarItemSource {
  dispose(): void;
}

/** The seams the provider wires the family sources over (all injected). */
export interface CalendarItemSourceDeps {
  /** The per-view calendar-item toggles, read fresh on every provide/collect. */
  toggles(): CalendarItemToggles;
  /** The full TaskNotes task list (canonical, field-mapper-resolved fields). */
  listTasks(): Promise<readonly TaskNotesTaskInfo[]> | readonly TaskNotesTaskInfo[];
  /** TaskNotes change-event seam driving the sources' epochs; absent when TaskNotes is. */
  subscribe?(handler: (eventName: string, payload?: unknown) => void): () => void;
  /** Resolves `recurrence_parent` references to vault note paths. */
  resolveTaskReference?: TaskReferenceResolver;
}

/** What the view holds per mount: the dep the controller calls, plus teardown. */
export interface CalendarItemSourcesProvider {
  /** The currently provided family sources (the `createCalendarItemSources` dep). */
  provide(): readonly CalendarItemSource[];
  /** Release every created source's change-event subscription. */
  dispose(): void;
}

/** Build the per-mount calendar-item sources provider over injected seams. */
export function createCalendarItemSourcesProvider(
  deps: CalendarItemSourceDeps,
): CalendarItemSourcesProvider {
  let recurring: DisposableCalendarItemSource | null = null;
  let timeEntries: DisposableCalendarItemSource | null = null;
  let togglesRevision = 0;
  let lastTogglesTag: string | null = null;
  const wrappers = new Map<DisposableCalendarItemSource, CalendarItemSource>();

  // Stable wrapper identity per source: the controller's batch cache keys on
  // the provided object, so a fresh wrapper per provide() would defeat it.
  const withToggleEpoch = (source: DisposableCalendarItemSource): CalendarItemSource => {
    const existing = wrappers.get(source);
    if (existing) {
      return existing;
    }
    const wrapper: CalendarItemSource = {
      family: source.family,
      epoch: () => source.epoch() + togglesRevision,
      collect: (context: CalendarItemQueryContext) => source.collect(context),
    };
    wrappers.set(source, wrapper);
    return wrapper;
  };

  const sharedSeams = {
    listTasks: deps.listTasks,
    ...(deps.subscribe ? { subscribe: deps.subscribe } : {}),
  };

  const createRecurring = (): DisposableCalendarItemSource =>
    createRecurringInstanceSource({
      ...sharedSeams,
      toggles: () => {
        const current = deps.toggles();
        return {
          showRecurring: current.showRecurring,
          showCompletedRecurringInstances: current.showCompletedRecurringInstances,
          showSkippedRecurringInstances: current.showSkippedRecurringInstances,
        };
      },
      ...(deps.resolveTaskReference ? { resolveTaskReference: deps.resolveTaskReference } : {}),
    });

  const createTimeEntries = (): DisposableCalendarItemSource =>
    createTimeEntrySource({
      ...sharedSeams,
      toggles: () => ({ showTimeEntries: deps.toggles().showTimeEntries }),
    });

  return {
    provide(): readonly CalendarItemSource[] {
      const toggles = deps.toggles();
      const tag = calendarItemTogglesSignatureTag(toggles);
      if (lastTogglesTag !== null && tag !== lastTogglesTag) {
        togglesRevision += 1;
      }
      lastTogglesTag = tag;

      if (recurring === null) {
        recurring = createRecurring();
      }
      if (toggles.showTimeEntries && timeEntries === null) {
        timeEntries = createTimeEntries();
      }

      const sources: CalendarItemSource[] = [];
      if (recurring !== null) {
        sources.push(withToggleEpoch(recurring));
      }
      if (timeEntries !== null) {
        sources.push(withToggleEpoch(timeEntries));
      }
      return sources;
    },
    dispose(): void {
      recurring?.dispose();
      timeEntries?.dispose();
      recurring = null;
      timeEntries = null;
      wrappers.clear();
    },
  };
}
