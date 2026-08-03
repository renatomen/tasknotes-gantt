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
 *    for dataset parity. Event-emitting families (time entries, timeblocks,
 *    property events, external calendars) emit nothing while off, so they are
 *    created lazily on the first toggle-on (visible feed, for external) and
 *    stay provided after opt-out. Identity stays stable because the
 *    controller's batch cache keys on the source object.
 * 2. **Config flips ride the epoch.** The controller reuses a source's cached
 *    batch while its epoch is unchanged, and the sources' own epochs track
 *    only their data-change events — so a config revision (bumped whenever the
 *    observed toggle values, property pickers, or visible external feeds
 *    change between provides) is folded into every provided epoch. Both
 *    components only ever grow, so the sum is monotonic and equal only when
 *    neither changed.
 *
 * @module bases/calendarItemSources
 */

import {
  createExternalCalendarSource,
  createPropertyEventSource,
  createRecurringInstanceSource,
  createTimeblockSource,
  createTimeEntrySource,
  type CalendarDerivationWindow,
  type CalendarItemQueryContext,
  type CalendarItemSource,
  type DailyNoteTimeblocks,
  type TaskReferenceResolver,
} from '../datasource/calendarItems';
import type { TaskNotesTaskInfo } from '../datasource/TaskNotesSource';
import type { TimerScheduler } from './scheduler';
import {
  calendarItemTogglesSignatureTag,
  type CalendarItemToggles,
} from './calendarItemOptions';

/** A concrete family source plus its subscription disposer. */
interface DisposableCalendarItemSource extends CalendarItemSource {
  dispose(): void;
}

/** Degrade/loading flags observed on one external-calendar collect. */
export interface ExternalBatchFlags {
  degraded: boolean;
  loading: boolean;
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
  /**
   * Bases data-change seam driving the property-event epoch: the view fires
   * the subscribed handlers whenever the entry signature changes (a genuine
   * Bases data/property change), so the cached batch re-derives from the
   * current entries. Absent → the epoch rides config revisions only.
   */
  subscribeBasesData?(handler: () => void): () => void;
  /**
   * Daily notes intersecting the derivation window (timeblock family).
   * Absent → the family cannot derive and is never created.
   */
  listDailyNotes?(
    window: CalendarDerivationWindow,
  ): Promise<readonly DailyNoteTimeblocks[]> | readonly DailyNoteTimeblocks[];
  /** The timeblock watch's epoch (daily-note liveness); absent → constant. */
  timeblockEpoch?(): number;
  /**
   * Opaque TaskNotes plugin handle for the external-calendar family's guarded
   * service reads. Absent → the family cannot derive and is never created.
   */
  getTaskNotesPlugin?(): unknown;
  /** Per-view visible external feed keys, read fresh on every provide/collect. */
  visibleExternalFeeds?(): ReadonlySet<string>;
  /** Timer surface for the external source's fetch-free fallback poll. */
  scheduler?: TimerScheduler;
  /** External data-changed hook — the host schedules a refresh so a bump repaints. */
  onExternalEpochBump?(): void;
  /** Observes each external collect's degrade/loading flags (Notice + indicator wiring). */
  onExternalBatchFlags?(flags: ExternalBatchFlags): void;
}

/** What the view holds per mount: the dep the controller calls, plus teardown. */
export interface CalendarItemSourcesProvider {
  /** The currently provided family sources (the `createCalendarItemSources` dep). */
  provide(): readonly CalendarItemSource[];
  /**
   * The external-calendar source's raw epoch (0 before the source exists) —
   * folded into the view's entry signature as an epoch tag.
   */
  externalEpoch(): number;
  /** Release every created source's subscriptions and timers. */
  dispose(): void;
}

/** Build the per-mount calendar-item sources provider over injected seams. */
export function createCalendarItemSourcesProvider(
  deps: CalendarItemSourceDeps,
): CalendarItemSourcesProvider {
  let recurring: DisposableCalendarItemSource | null = null;
  let timeEntries: DisposableCalendarItemSource | null = null;
  let timeblocks: DisposableCalendarItemSource | null = null;
  let propertyEvents: DisposableCalendarItemSource | null = null;
  let external: DisposableCalendarItemSource | null = null;
  let configRevision = 0;
  let lastConfigTag: string | null = null;
  const wrappers = new Map<DisposableCalendarItemSource, CalendarItemSource>();

  // Stable wrapper identity per source: the controller's batch cache keys on
  // the provided object, so a fresh wrapper per provide() would defeat it.
  const withConfigEpoch = (source: DisposableCalendarItemSource): CalendarItemSource => {
    const existing = wrappers.get(source);
    if (existing) {
      return existing;
    }
    const wrapper: CalendarItemSource = {
      family: source.family,
      epoch: () => source.epoch() + configRevision,
      collect: (context: CalendarItemQueryContext) => source.collect(context),
    };
    wrappers.set(source, wrapper);
    return wrapper;
  };

  const sharedSeams = {
    listTasks: deps.listTasks,
    ...(deps.subscribe ? { subscribe: deps.subscribe } : {}),
  };

  const visibleExternalFeeds = (): ReadonlySet<string> =>
    deps.visibleExternalFeeds?.() ?? new Set<string>();

  /**
   * Everything a cached batch must invalidate on beyond the sources' own data
   * epochs: the toggle bits, the property-event pickers (their family's read
   * targets), and the visible external feed keys. Compared per provide; a
   * change bumps the config revision folded into every provided epoch.
   */
  const configTag = (toggles: CalendarItemToggles, visibleFeeds: ReadonlySet<string>): string =>
    calendarItemTogglesSignatureTag(toggles) +
    JSON.stringify([
      toggles.propertyEventStart,
      toggles.propertyEventEnd,
      toggles.propertyEventTitle,
    ]) +
    [...visibleFeeds].sort((a, b) => a.localeCompare(b)).join(',');

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

  const createTimeblocks = (
    listDailyNotes: NonNullable<CalendarItemSourceDeps['listDailyNotes']>,
  ): DisposableCalendarItemSource => {
    const source = createTimeblockSource({
      listDailyNotes,
      toggles: () => ({ showTimeblocks: deps.toggles().showTimeblocks }),
      ...(deps.timeblockEpoch ? { epoch: deps.timeblockEpoch } : {}),
    });
    // The timeblock watch (the epoch's owner) is disposed by the view wiring;
    // the source itself holds no subscription.
    return { ...source, dispose: () => {} };
  };

  const createPropertyEvents = (): DisposableCalendarItemSource =>
    createPropertyEventSource({
      toggles: () => {
        const current = deps.toggles();
        return {
          showPropertyBasedEvents: current.showPropertyBasedEvents,
          propertyEventStart: current.propertyEventStart,
          propertyEventEnd: current.propertyEventEnd,
          propertyEventTitle: current.propertyEventTitle,
        };
      },
      ...(deps.subscribeBasesData
        ? {
            subscribe: (handler: (eventName: string, payload?: unknown) => void) =>
              deps.subscribeBasesData!(() => handler('bases-data-changed')),
          }
        : {}),
    });

  const createExternal = (
    getTaskNotesPlugin: NonNullable<CalendarItemSourceDeps['getTaskNotesPlugin']>,
    scheduler: TimerScheduler,
  ): DisposableCalendarItemSource => {
    const source = createExternalCalendarSource({
      getTaskNotesPlugin,
      visibleFeeds: visibleExternalFeeds,
      scheduler,
      ...(deps.onExternalEpochBump ? { onEpochBump: deps.onExternalEpochBump } : {}),
    });
    return {
      family: source.family,
      epoch: source.epoch,
      collect: async (context) => {
        const batch = await source.collect(context);
        deps.onExternalBatchFlags?.({
          degraded: batch.degraded === true,
          loading: batch.loading === true,
        });
        return batch;
      },
      dispose: source.dispose,
    };
  };

  return {
    provide(): readonly CalendarItemSource[] {
      const toggles = deps.toggles();
      const visibleFeeds = visibleExternalFeeds();
      const tag = configTag(toggles, visibleFeeds);
      if (lastConfigTag !== null && tag !== lastConfigTag) {
        configRevision += 1;
      }
      lastConfigTag = tag;

      recurring ??= createRecurring();
      if (toggles.showTimeEntries) {
        timeEntries ??= createTimeEntries();
      }
      if (toggles.showTimeblocks && deps.listDailyNotes) {
        timeblocks ??= createTimeblocks(deps.listDailyNotes.bind(deps));
      }
      if (toggles.showPropertyBasedEvents) {
        propertyEvents ??= createPropertyEvents();
      }
      if (
        external === null &&
        deps.getTaskNotesPlugin &&
        deps.scheduler &&
        visibleFeeds.size > 0
      ) {
        external = createExternal(deps.getTaskNotesPlugin.bind(deps), deps.scheduler);
      }

      const created = [recurring, timeEntries, timeblocks, propertyEvents, external];
      const sources: CalendarItemSource[] = [];
      for (const source of created) {
        if (source !== null) {
          sources.push(withConfigEpoch(source));
        }
      }
      return sources;
    },
    externalEpoch(): number {
      return external?.epoch() ?? 0;
    },
    dispose(): void {
      const created = [recurring, timeEntries, timeblocks, propertyEvents, external];
      try {
        for (const source of created) {
          // Each family releases in isolation: one throwing dispose must not
          // suppress sibling cleanup or the idempotency bookkeeping below.
          try {
            source?.dispose();
          } catch {
            // Released as far as that family allows.
          }
        }
      } finally {
        recurring = null;
        timeEntries = null;
        timeblocks = null;
        propertyEvents = null;
        external = null;
        wrappers.clear();
      }
    },
  };
}
