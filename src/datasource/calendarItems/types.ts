/**
 * Calendar-item source contract.
 *
 * Calendar items (timeblocks, time entries, recurring instances, property
 * events, external calendar events, task date events) enter the Gantt as
 * **independent read-only sources** — one module per family — rather than
 * through the task {@link import('../types').DataSource} pipeline. Each source
 * derives day-attributed output on **two channels**:
 *
 * 1. **Flat union items** ({@link CalendarItem}) — rendered as read-only event
 *    rows after the task rows.
 * 2. **Per-task occupancy attachments** ({@link CalendarOccupancy}, keyed by
 *    task path) — merged onto the owning task's render instance, never rows.
 *
 * Items carry a **synthetic id** in a namespace that can never collide with a
 * vault path, because the id flows through the same `path`-shaped surfaces
 * tasks use (`SourceTask.path` / `RenderInstance.sourcePath`). Path-consuming
 * surfaces (managed-path editability, bar-activate note-opening, mutation
 * resolution) branch on {@link isCalendarItemId}.
 *
 * @module datasource/calendarItems/types
 */

import type { BasesEntry } from 'obsidian';
import type { SourceTask } from '../types';

/**
 * The calendar-item layer's structural guard for unknown external surfaces:
 * any non-null object — arrays included, deliberately looser than record
 * guards that exclude them — read as a string-keyed record; anything else is
 * `undefined`.
 */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The calendar-item families the Gantt can render. */
export type CalendarItemFamily =
  | 'recurring-instance'
  | 'time-entry'
  | 'timeblock'
  | 'property-event'
  | 'external-event';

/**
 * The synthetic-id namespace prefix. Obsidian forbids `:` in note and folder
 * names, so no vault path can contain the `://` sequence — a prefixed id can
 * never equal (or be equalled by) a `SourceTask.path`.
 */
export const CALENDAR_ITEM_ID_PREFIX = 'og-calendar://';

/** A local calendar day as ISO `YYYY-MM-DD` (no time, no timezone). */
export type LocalDay = string;

/**
 * Compose a synthetic calendar-item id: the namespace prefix, the family, a
 * URI-component-encoded stable series id (typically the backing note path or
 * an external UID), and an optional encoded instance qualifier. Encoding each
 * component keeps the composition injective even when its data contains `@`,
 * `/`, `%`, or another separator.
 */
export function makeCalendarItemId(
  family: CalendarItemFamily,
  seriesId: string,
  qualifier?: string,
): string {
  const encodedQualifier = qualifier === undefined ? '' : `@${encodeURIComponent(qualifier)}`;
  return `${CALENDAR_ITEM_ID_PREFIX}${family}/${encodeURIComponent(seriesId)}${encodedQualifier}`;
}

/** Whether an id in a `path`-shaped field is a synthetic calendar-item id. */
export function isCalendarItemId(id: string): boolean {
  return id.startsWith(CALENDAR_ITEM_ID_PREFIX);
}

/**
 * One calendar item, day-attributed: a flat union row on the event channel.
 * Values are raw (no display formatting); the view formats for display.
 */
export interface CalendarItem {
  /** Synthetic id (see {@link makeCalendarItemId}); never a vault path. */
  id: string;
  /** The family that produced this item. */
  family: CalendarItemFamily;
  /** Display text (item title). */
  title: string;
  /** First local day of the item's span (inclusive). */
  startDay: LocalDay;
  /** Last local day of the item's span (inclusive). */
  endDay: LocalDay;
  /**
   * Family-specific state classification (e.g. a logged vs planned time
   * entry), or absent when the family has a single state.
   */
  stateClass?: string;
  /**
   * The vault note this item derives from, when it has one. Bar-activate
   * opens it; an item without one must no-op on activation
   * ({@link resolveActivationNotePath}).
   */
  notePath?: string;
  /** Fixed display color (CSS color string), or absent for the family default. */
  color?: string;
  /**
   * The local days a multi-occurrence series actually occupies inside its
   * span, ascending. Present only when the item stands for a recurring series
   * touching more than one day — the renderer pieces the bar per occupied day
   * (the way recurring-task occupancy renders) instead of drawing the span
   * solid. Absent = solid span.
   */
  occupancyDays?: readonly LocalDay[];
}

/**
 * The occupancy state class of one occurrence of a multi-occurrence series
 * ({@link CalendarItem.occupancyDays}). External occurrences are plain
 * calendar facts with a single shared state — distinct from the recurring
 * family's per-instance states, so their pieces paint like the event bar
 * rather than like task instances.
 */
export const EXTERNAL_OCCUPANCY_STATE = 'external';

/**
 * One day-attributed occupancy fact a family attaches to an owning task —
 * the second channel. Merged onto the task's render instance, never a row.
 */
export interface CalendarOccupancy {
  /** The family that produced this occupancy. */
  family: CalendarItemFamily;
  /** Synthetic id of the calendar item this occupancy derives from. */
  itemId: string;
  /** The occupied local day. */
  day: LocalDay;
  /** Occupied minutes within the day, or `null` for day-granular families. */
  minutes: number | null;
  /**
   * Family-specific state classification of this occupied day (e.g. a
   * recurring instance's `next`/`projected`/`completed`/`skipped`/
   * `materialized`, or an external series occurrence's
   * {@link EXTERNAL_OCCUPANCY_STATE}), or absent when the family has a
   * single state.
   */
  stateClass?: string;
  /**
   * The vault note backing this occupied day when it has its own (a
   * materialized occurrence's note). A click on the day's piece opens it;
   * pieces without one route to the owning task.
   */
  notePath?: string;
}

/** The two-channel output of one source derivation. */
export interface CalendarItemBatch {
  /** Flat union items — read-only event rows. */
  items: readonly CalendarItem[];
  /** Per-task occupancy attachments keyed by owning task path. */
  occupancyByTaskPath: ReadonlyMap<string, readonly CalendarOccupancy[]>;
  /**
   * Task paths whose plain scheduled→due bar this batch replaces with its
   * occupancy rendering (the recurring family while it is enabled).
   * Absent/empty when the batch suppresses nothing.
   */
  plainBarSuppressedTaskPaths?: ReadonlySet<string>;
  /**
   * A backing service surface failed its structural guard, so part (or all)
   * of this family degraded to empty. The orchestrator surfaces the Notice;
   * the batch itself stays usable. Absent = every surface answered.
   */
  degraded?: boolean;
  /**
   * The services answered but their event caches are still cold (feeds are
   * configured yet zero events are cached) — a transient first-collect state,
   * distinct from {@link degraded}. Absent once events exist.
   */
  loading?: boolean;
}

/**
 * The derivation window a source derives against: fixed per derivation and
 * scroll-independent, expressed as local days (start inclusive, end exclusive).
 * Structurally matches the controller's calendar evaluation window so both
 * derivations window themselves identically.
 */
export interface CalendarDerivationWindow {
  startDate: LocalDay;
  endDateExclusive: LocalDay;
}

/**
 * The query context a source derives against. The accessors read the CURRENT
 * task set / Bases entries at derivation time; concrete family factories close
 * over whatever further inputs (vault, settings, external feeds) they need.
 */
export interface CalendarItemQueryContext {
  /** Derivation window (fixed per derivation, scroll-independent). */
  window: CalendarDerivationWindow;
  /** The raw source tasks of the same derivation pass. */
  tasks(): readonly SourceTask[];
  /** The current Bases entries backing the view. */
  basesEntries(): readonly BasesEntry[];
}

/**
 * A read-only calendar-item source — one per enabled family. The controller
 * calls {@link collect} during snapshot builds and unions the batch into the
 * render snapshot alongside the task pipeline.
 */
export interface CalendarItemSource {
  /** The single family this source derives. */
  readonly family: CalendarItemFamily;
  /** Earliest source-owned day the shared derivation window must include. */
  windowStartAnchor?(): LocalDay | null;
  /**
   * Staleness signal: a monotonic epoch the source bumps whenever its
   * underlying facts change. While it is unchanged the controller reuses the
   * cached batch (no re-derivation); a bump invalidates the cached snapshot.
   */
  epoch(): number;
  /** Derive both channels for the given context. */
  collect(context: CalendarItemQueryContext): Promise<CalendarItemBatch>;
}

/**
 * What a bar activation should open for a render row's source identity: a
 * plain vault path (task row) activates itself; a calendar-item id resolves to
 * the item's backing note; a note-less or unknown item resolves to `null` —
 * activation must no-op rather than treat the synthetic id as a vault path.
 */
export function resolveActivationNotePath(
  sourcePath: string,
  findCalendarItem: (id: string) => CalendarItem | undefined,
): string | null {
  if (!isCalendarItemId(sourcePath)) {
    return sourcePath;
  }
  return findCalendarItem(sourcePath)?.notePath ?? null;
}
