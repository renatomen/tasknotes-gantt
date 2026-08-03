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
 * group/reader shapes from outside. Per-feed external-calendar toggles are
 * dynamic entries ({@link externalCalendarOptionEntries}) built from the
 * CURRENT subscription/calendar lists, so a deleted feed's orphaned config
 * key is inert — no current feed ever consults it.
 *
 * @module bases/calendarItemOptions
 */
import type { BasesOptionGroup, BasesOptions, BasesPropertyId } from 'obsidian';
import {
  externalCalendarFeedKey,
  type ExternalCalendarProviderKind,
  type ExternalIcsSubscription,
  type ExternalProviderCalendar,
} from '../datasource/calendarItems/externalCalendarSource';

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

const EXTERNAL_TOGGLE_KEY_PREFIXES: Record<ExternalCalendarProviderKind, string> = {
  ics: 'tngantt_showICS_',
  google: 'tngantt_showGoogleCalendar_',
  microsoft: 'tngantt_showMicrosoftCalendar_',
};

/** Canonical per-feed visibility config key (`tngantt_show<Provider>_<id>`). */
export function externalCalendarToggleKey(kind: ExternalCalendarProviderKind, id: string): string {
  return `${EXTERNAL_TOGGLE_KEY_PREFIXES[kind]}${id}`;
}

interface ExternalProviderSection {
  displayName: string;
  windowNote: string;
}

/**
 * What each provider's sync layer actually caches — shown so a user knows why
 * events outside these windows never appear, regardless of the Gantt window.
 */
const EXTERNAL_PROVIDER_SECTIONS: Record<ExternalCalendarProviderKind, ExternalProviderSection> = {
  ics: {
    displayName: 'ICS calendars',
    windowNote: "Events from each event's start to ~1 year ahead",
  },
  google: {
    displayName: 'Google calendars',
    windowNote: '~6 months back / 3 ahead (initial sync; incremental sync may add more)',
  },
  microsoft: {
    displayName: 'Microsoft calendars',
    windowNote: '~1 month back / 3 ahead (initial sync; incremental sync may add more)',
  },
};

interface ExternalFeedEntry {
  kind: ExternalCalendarProviderKind;
  id: string;
  name: string;
}

const EXTERNAL_PROVIDER_ORDER: readonly ExternalCalendarProviderKind[] = [
  'ics',
  'google',
  'microsoft',
];

function externalFeedsByKind(
  subscriptions: readonly ExternalIcsSubscription[],
  calendars: readonly ExternalProviderCalendar[],
): Map<ExternalCalendarProviderKind, ExternalFeedEntry[]> {
  const byKind = new Map<ExternalCalendarProviderKind, ExternalFeedEntry[]>();
  const add = (feed: ExternalFeedEntry): void => {
    byKind.set(feed.kind, [...(byKind.get(feed.kind) ?? []), feed]);
  };
  for (const subscription of subscriptions) {
    add({ kind: 'ics', id: subscription.id, name: subscription.name });
  }
  for (const calendar of calendars) {
    add({ kind: calendar.provider, id: calendar.id, name: calendar.name });
  }
  return byKind;
}

/**
 * Dynamic per-feed entries for the "Calendar items" group: for each provider
 * with at least one feed, a static description line stating that provider's
 * sync window, then one toggle per feed. Every toggle defaults OFF — this
 * Gantt's opt-in rule overrides the TaskNotes calendar's shown-by-default.
 */
export function externalCalendarOptionEntries(
  subscriptions: readonly ExternalIcsSubscription[],
  calendars: readonly ExternalProviderCalendar[],
): BasesOptions[] {
  const byKind = externalFeedsByKind(subscriptions, calendars);
  const entries: BasesOptions[] = [];
  for (const kind of EXTERNAL_PROVIDER_ORDER) {
    const feeds = byKind.get(kind);
    if (feeds === undefined || feeds.length === 0) continue;
    const section = EXTERNAL_PROVIDER_SECTIONS[kind];
    // Bases has no static-label option type; an empty text input renders its
    // placeholder as gray descriptive text (the viewOptions idiom) and its
    // key is never read, so the entry is purely informational.
    entries.push({
      type: 'text',
      displayName: section.displayName,
      key: `tngantt_externalCalendarWindow_${kind}`,
      default: '',
      placeholder: section.windowNote,
    });
    for (const feed of feeds) {
      entries.push({
        type: 'toggle',
        displayName: feed.name,
        key: externalCalendarToggleKey(feed.kind, feed.id),
        default: false,
      });
    }
  }
  return entries;
}

/**
 * The degrade description line for the options panel: Bases toggle options
 * carry no disabled/tooltip shape, so when an external-calendar service
 * surface failed its structural guard this session, the panel states it with
 * the same gray-text idiom the sync-window notes use (the session Notice is
 * the primary signal). Purely informational — the key is never read.
 */
export function externalCalendarDegradedEntry(): BasesOptions {
  return {
    type: 'text',
    displayName: 'External calendars',
    key: 'tngantt_externalCalendarDegraded',
    default: '',
    placeholder:
      'Some external-calendar services are unavailable — feed toggles may be incomplete and their events are not shown.',
  };
}

/**
 * The visible external feed keys ({@link externalCalendarFeedKey}) for the
 * CURRENT subscription/calendar lists. Only current feeds are consulted, so a
 * deleted feed's orphaned toggle key is ignored; a feed is visible only for
 * an explicit boolean `true` (default OFF).
 *
 * @param get - reads a per-view option value by key (the Bases `config.get`).
 */
export function readVisibleExternalCalendarFeeds(
  get: (key: string) => unknown,
  subscriptions: readonly ExternalIcsSubscription[],
  calendars: readonly ExternalProviderCalendar[],
): ReadonlySet<string> {
  const visible = new Set<string>();
  for (const feeds of externalFeedsByKind(subscriptions, calendars).values()) {
    for (const feed of feeds) {
      if (get(externalCalendarToggleKey(feed.kind, feed.id)) === true) {
        visible.add(externalCalendarFeedKey(feed.kind, feed.id));
      }
    }
  }
  return visible;
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
