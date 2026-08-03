/**
 * The "Calendar items" per-view option group and its pure readers.
 *
 * Mirrors the TaskNotes calendar's toggle vocabulary (recurring instances with
 * completed/skipped sub-toggles, time entries, timeblocks, property-based
 * events with three property pickers) so a calendar user recognizes every
 * control. Every family defaults OFF — the Gantt stays a pure task timeline
 * until a family is opted in; once a family is on, its sub-toggles adopt the
 * calendar's own defaults (completed/skipped instances shown).
 *
 * Kept out of `viewOptions.ts` deliberately (size budget); follows its
 * group/reader shapes from outside. Per-subscription external-calendar toggles
 * arrive in a later slice and will extend this group.
 *
 * @module bases/calendarItemOptions
 */
import type { BasesOptionGroup, BasesOptions, BasesPropertyId } from 'obsidian';

/** Canonical `tngantt_`-prefixed config keys for the calendar-item options. */
export const CALENDAR_ITEM_OPTION_KEYS = {
  showRecurring: 'tngantt_showRecurring',
  showCompletedRecurringInstances: 'tngantt_showCompletedRecurringInstances',
  showSkippedRecurringInstances: 'tngantt_showSkippedRecurringInstances',
  showTimeEntries: 'tngantt_showTimeEntries',
  showTimeblocks: 'tngantt_showTimeblocks',
  showPropertyBasedEvents: 'tngantt_showPropertyBasedEvents',
  propertyEventStart: 'tngantt_propertyEventStart',
  propertyEventEnd: 'tngantt_propertyEventEnd',
  propertyEventTitle: 'tngantt_propertyEventTitle',
} as const;

/** Snapshot of the per-view calendar-item toggles, read fresh each recompute. */
export interface CalendarItemToggles {
  showRecurring: boolean;
  showCompletedRecurringInstances: boolean;
  showSkippedRecurringInstances: boolean;
  showTimeEntries: boolean;
  showTimeblocks: boolean;
  showPropertyBasedEvents: boolean;
  /** Mapped property ids for property-based events; `''` = unset (never a hardcoded name). */
  propertyEventStart: string;
  propertyEventEnd: string;
  propertyEventTitle: string;
}

/** A picker value is a property id only when it is a non-blank string; anything else is unset. */
function readPickerProperty(raw: unknown): string {
  return typeof raw === 'string' && raw.trim() !== '' ? raw : '';
}

/**
 * Read the calendar-item toggles from a view config. Family toggles are on only
 * for an explicit boolean `true` (default OFF); the completed/skipped
 * sub-toggles are off only for an explicit `false` (the calendar shows them by
 * default). Pure (no Obsidian/DOM): the caller passes the Bases `config.get`;
 * mirrors `readHighlightWeekends` in `viewOptions.ts`.
 *
 * @param get - reads a per-view option value by key (the Bases `config.get`).
 */
export function readCalendarItemToggles(get: (key: string) => unknown): CalendarItemToggles {
  return {
    showRecurring: get(CALENDAR_ITEM_OPTION_KEYS.showRecurring) === true,
    showCompletedRecurringInstances:
      get(CALENDAR_ITEM_OPTION_KEYS.showCompletedRecurringInstances) !== false,
    showSkippedRecurringInstances:
      get(CALENDAR_ITEM_OPTION_KEYS.showSkippedRecurringInstances) !== false,
    showTimeEntries: get(CALENDAR_ITEM_OPTION_KEYS.showTimeEntries) === true,
    showTimeblocks: get(CALENDAR_ITEM_OPTION_KEYS.showTimeblocks) === true,
    showPropertyBasedEvents: get(CALENDAR_ITEM_OPTION_KEYS.showPropertyBasedEvents) === true,
    propertyEventStart: readPickerProperty(get(CALENDAR_ITEM_OPTION_KEYS.propertyEventStart)),
    propertyEventEnd: readPickerProperty(get(CALENDAR_ITEM_OPTION_KEYS.propertyEventEnd)),
    propertyEventTitle: readPickerProperty(get(CALENDAR_ITEM_OPTION_KEYS.propertyEventTitle)),
  };
}

/**
 * Property events read frontmatter, so the pickers offer only `note.*`
 * properties — a `file.*`/`formula.*` value could never be observed by the
 * entry signature (see `frontmatterSignatureKeys`).
 */
function isNoteProperty(propertyId: BasesPropertyId): boolean {
  return propertyId.startsWith('note.');
}

function familyToggle(displayName: string, key: string): BasesOptions {
  return { type: 'toggle', displayName, key, default: false };
}

function eventPropertyPicker(displayName: string, key: string, placeholder: string): BasesOptions {
  return {
    type: 'property',
    displayName,
    key,
    default: '',
    placeholder,
    filter: isNoteProperty,
  };
}

/**
 * The collapsible "Calendar items" option group. Toggle labels mirror the
 * TaskNotes calendar's vocabulary; ordering keeps each family's sub-controls
 * directly under its toggle.
 */
export function calendarItemOptionsGroup(): BasesOptionGroup<BasesOptions> {
  return {
    type: 'group',
    displayName: 'Calendar items',
    items: [
      familyToggle('Show recurring tasks', CALENDAR_ITEM_OPTION_KEYS.showRecurring),
      {
        type: 'toggle',
        displayName: 'Show completed instances',
        key: CALENDAR_ITEM_OPTION_KEYS.showCompletedRecurringInstances,
        default: true,
      },
      {
        type: 'toggle',
        displayName: 'Show skipped instances',
        key: CALENDAR_ITEM_OPTION_KEYS.showSkippedRecurringInstances,
        default: true,
      },
      familyToggle('Show time entries', CALENDAR_ITEM_OPTION_KEYS.showTimeEntries),
      familyToggle('Show timeblocks', CALENDAR_ITEM_OPTION_KEYS.showTimeblocks),
      familyToggle('Show property-based events', CALENDAR_ITEM_OPTION_KEYS.showPropertyBasedEvents),
      eventPropertyPicker(
        'Event start property',
        CALENDAR_ITEM_OPTION_KEYS.propertyEventStart,
        'Property holding the event start date',
      ),
      eventPropertyPicker(
        'Event end property',
        CALENDAR_ITEM_OPTION_KEYS.propertyEventEnd,
        'Property holding the event end date (optional)',
      ),
      eventPropertyPicker(
        'Event title property',
        CALENDAR_ITEM_OPTION_KEYS.propertyEventTitle,
        'Property holding the event title (defaults to file name)',
      ),
    ],
  };
}

/**
 * Signature tag of the toggle VALUES, folded into the entry-signature prefix so
 * flipping any calendar-family toggle forces a re-read (repaint) while an
 * unchanged config keeps the tag — and the reuse — identical. Fixed-position
 * bit encoding: each toggle owns one position, so two different states can
 * never collide. The pickers are deliberately absent — when their family is on
 * they join the watched mapping values, whose identity tag already flips on a
 * re-point.
 */
export function calendarItemTogglesSignatureTag(toggles: CalendarItemToggles): string {
  const bits = [
    toggles.showRecurring,
    toggles.showCompletedRecurringInstances,
    toggles.showSkippedRecurringInstances,
    toggles.showTimeEntries,
    toggles.showTimeblocks,
    toggles.showPropertyBasedEvents,
  ]
    .map((on) => (on ? '1' : '0'))
    .join('');
  return `ci:${bits}|`;
}

/**
 * The mapped properties an enabled calendar-item family consumes, to be
 * appended to the entry signature's watched mapping values: with the
 * property-event family ON, its three configured pickers (the events are
 * scoped by this view's query, so their fields are watched like any mapping);
 * OFF, nothing — the fields leave the watched set and edits to them no longer
 * force a re-read.
 */
export function calendarItemWatchedProperties(toggles: CalendarItemToggles): string[] {
  if (!toggles.showPropertyBasedEvents) return [];
  return [toggles.propertyEventStart, toggles.propertyEventEnd, toggles.propertyEventTitle].filter(
    (property) => property !== '',
  );
}
