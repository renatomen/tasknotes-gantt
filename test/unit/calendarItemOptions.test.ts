/**
 * Unit tests for the Calendar-items view-option group and its pure readers.
 *
 * Every calendar-item family defaults OFF — the omission fixture (a `get`
 * that returns nothing) is the default test. Once the recurring family is on,
 * the completed/skipped sub-toggles adopt the calendar's defaults (shown).
 * Property pickers are property-agnostic: empty defaults, no hardcoded names.
 */

import type { BasesOptions, BasesPropertyOption, BasesTextOption, BasesToggleOption } from 'obsidian';
import {
  CALENDAR_ITEM_OPTION_KEYS,
  calendarItemOptionsGroup,
  calendarItemTogglesSignatureTag,
  calendarItemWatchedProperties,
  externalCalendarDegradedEntry,
  externalCalendarOptionEntries,
  readCalendarItemToggles,
  readVisibleExternalCalendarFeeds,
  type CalendarItemToggles,
} from '../../src/bases/calendarItemOptions';
import type {
  ExternalIcsSubscription,
  ExternalProviderCalendar,
} from '../../src/datasource/calendarItems/externalCalendarSource';

const getFrom =
  (values: Record<string, unknown>) =>
  (key: string): unknown =>
    values[key];

const togglesWith = (values: Record<string, unknown>): CalendarItemToggles =>
  readCalendarItemToggles(getFrom(values));

describe('readCalendarItemToggles', () => {
  it('defaults every family OFF when its key is absent', () => {
    const toggles = togglesWith({});

    expect(toggles.showRecurring).toBe(false);
    expect(toggles.showTimeEntries).toBe(false);
    expect(toggles.showTimeblocks).toBe(false);
    expect(toggles.showPropertyBasedEvents).toBe(false);
  });

  it('defaults the completed/skipped sub-toggles to shown when their keys are absent', () => {
    const toggles = togglesWith({ [CALENDAR_ITEM_OPTION_KEYS.showRecurring]: true });

    expect(toggles.showRecurring).toBe(true);
    expect(toggles.showCompletedRecurringInstances).toBe(true);
    expect(toggles.showSkippedRecurringInstances).toBe(true);
  });

  it('honors an explicit sub-toggle opt-out', () => {
    const toggles = togglesWith({
      [CALENDAR_ITEM_OPTION_KEYS.showRecurring]: true,
      [CALENDAR_ITEM_OPTION_KEYS.showCompletedRecurringInstances]: false,
      [CALENDAR_ITEM_OPTION_KEYS.showSkippedRecurringInstances]: false,
    });

    expect(toggles.showCompletedRecurringInstances).toBe(false);
    expect(toggles.showSkippedRecurringInstances).toBe(false);
  });

  it('turns a family on only for an explicit boolean true (junk stays off)', () => {
    expect(togglesWith({ [CALENDAR_ITEM_OPTION_KEYS.showTimeblocks]: true }).showTimeblocks).toBe(
      true,
    );
    expect(togglesWith({ [CALENDAR_ITEM_OPTION_KEYS.showTimeblocks]: 'true' }).showTimeblocks).toBe(
      false,
    );
    expect(togglesWith({ [CALENDAR_ITEM_OPTION_KEYS.showTimeEntries]: 1 }).showTimeEntries).toBe(
      false,
    );
  });

  it('defaults the property pickers to empty (no property name is ever assumed)', () => {
    const toggles = togglesWith({});

    expect(toggles.propertyEventStart).toBe('');
    expect(toggles.propertyEventEnd).toBe('');
    expect(toggles.propertyEventTitle).toBe('');
  });

  it('passes a configured picker property name through unchanged', () => {
    const toggles = togglesWith({
      [CALENDAR_ITEM_OPTION_KEYS.propertyEventStart]: 'note.eventStart',
      [CALENDAR_ITEM_OPTION_KEYS.propertyEventEnd]: 'note.eventEnd',
      [CALENDAR_ITEM_OPTION_KEYS.propertyEventTitle]: 'note.eventTitle',
    });

    expect(toggles.propertyEventStart).toBe('note.eventStart');
    expect(toggles.propertyEventEnd).toBe('note.eventEnd');
    expect(toggles.propertyEventTitle).toBe('note.eventTitle');
  });

  it('rejects non-string and blank picker values as unset', () => {
    expect(togglesWith({ [CALENDAR_ITEM_OPTION_KEYS.propertyEventStart]: 42 }).propertyEventStart).toBe('');
    expect(togglesWith({ [CALENDAR_ITEM_OPTION_KEYS.propertyEventEnd]: null }).propertyEventEnd).toBe('');
    expect(togglesWith({ [CALENDAR_ITEM_OPTION_KEYS.propertyEventTitle]: '   ' }).propertyEventTitle).toBe('');
  });
});

describe('calendarItemOptionsGroup', () => {
  const findOption = (key: string): BasesOptions => {
    const option = calendarItemOptionsGroup().items.find((item) => item.key === key);
    if (!option) throw new Error(`option ${key} missing from the Calendar items group`);
    return option;
  };

  it('is a collapsible group named Calendar items', () => {
    const group = calendarItemOptionsGroup();

    expect(group.type).toBe('group');
    expect(group.displayName).toBe('Calendar items');
  });

  it('declares every family toggle defaulting off', () => {
    for (const key of [
      CALENDAR_ITEM_OPTION_KEYS.showRecurring,
      CALENDAR_ITEM_OPTION_KEYS.showTimeEntries,
      CALENDAR_ITEM_OPTION_KEYS.showTimeblocks,
      CALENDAR_ITEM_OPTION_KEYS.showPropertyBasedEvents,
    ]) {
      const option = findOption(key);
      expect(option.type).toBe('toggle');
      expect(option.default).toBe(false);
    }
  });

  it('declares the completed/skipped sub-toggles defaulting shown (calendar default)', () => {
    for (const key of [
      CALENDAR_ITEM_OPTION_KEYS.showCompletedRecurringInstances,
      CALENDAR_ITEM_OPTION_KEYS.showSkippedRecurringInstances,
    ]) {
      const option = findOption(key);
      expect(option.type).toBe('toggle');
      expect(option.default).toBe(true);
    }
  });

  it('declares the three event property pickers with empty defaults, filtered to note properties', () => {
    for (const key of [
      CALENDAR_ITEM_OPTION_KEYS.propertyEventStart,
      CALENDAR_ITEM_OPTION_KEYS.propertyEventEnd,
      CALENDAR_ITEM_OPTION_KEYS.propertyEventTitle,
    ]) {
      const option = findOption(key) as BasesPropertyOption;
      expect(option.type).toBe('property');
      expect(option.default).toBe('');
      expect(option.filter?.('note.eventStart')).toBe(true);
      expect(option.filter?.('file.name')).toBe(false);
      expect(option.filter?.('formula.x')).toBe(false);
    }
  });
});

describe('calendarItemWatchedProperties', () => {
  const pickers = {
    [CALENDAR_ITEM_OPTION_KEYS.propertyEventStart]: 'note.eventStart',
    [CALENDAR_ITEM_OPTION_KEYS.propertyEventEnd]: 'note.eventEnd',
    [CALENDAR_ITEM_OPTION_KEYS.propertyEventTitle]: 'note.eventTitle',
  };

  it('watches the three mapped event properties when the property-event family is ON', () => {
    const watched = calendarItemWatchedProperties(
      togglesWith({ ...pickers, [CALENDAR_ITEM_OPTION_KEYS.showPropertyBasedEvents]: true }),
    );

    expect(watched).toEqual(['note.eventStart', 'note.eventEnd', 'note.eventTitle']);
  });

  it('watches nothing when the family is OFF, even with pickers configured', () => {
    expect(calendarItemWatchedProperties(togglesWith(pickers))).toEqual([]);
  });

  it('omits unset pickers when the family is ON', () => {
    const watched = calendarItemWatchedProperties(
      togglesWith({
        [CALENDAR_ITEM_OPTION_KEYS.showPropertyBasedEvents]: true,
        [CALENDAR_ITEM_OPTION_KEYS.propertyEventStart]: 'note.eventStart',
      }),
    );

    expect(watched).toEqual(['note.eventStart']);
  });
});

describe('calendarItemTogglesSignatureTag', () => {
  it('is identical for unchanged toggles (an unrelated notify must reuse)', () => {
    const values = { [CALENDAR_ITEM_OPTION_KEYS.showTimeEntries]: true };

    expect(calendarItemTogglesSignatureTag(togglesWith(values))).toBe(
      calendarItemTogglesSignatureTag(togglesWith(values)),
    );
  });

  it('changes when any family toggle flips', () => {
    const off = calendarItemTogglesSignatureTag(togglesWith({}));

    for (const key of [
      CALENDAR_ITEM_OPTION_KEYS.showRecurring,
      CALENDAR_ITEM_OPTION_KEYS.showTimeEntries,
      CALENDAR_ITEM_OPTION_KEYS.showTimeblocks,
      CALENDAR_ITEM_OPTION_KEYS.showPropertyBasedEvents,
    ]) {
      expect(calendarItemTogglesSignatureTag(togglesWith({ [key]: true }))).not.toBe(off);
    }
  });

  it('changes when a recurring sub-toggle flips', () => {
    const shown = calendarItemTogglesSignatureTag(
      togglesWith({ [CALENDAR_ITEM_OPTION_KEYS.showRecurring]: true }),
    );
    const hidden = calendarItemTogglesSignatureTag(
      togglesWith({
        [CALENDAR_ITEM_OPTION_KEYS.showRecurring]: true,
        [CALENDAR_ITEM_OPTION_KEYS.showSkippedRecurringInstances]: false,
      }),
    );

    expect(hidden).not.toBe(shown);
  });

  it('gives each family a distinct position (two different single-family states never collide)', () => {
    const timeEntries = calendarItemTogglesSignatureTag(
      togglesWith({ [CALENDAR_ITEM_OPTION_KEYS.showTimeEntries]: true }),
    );
    const timeblocks = calendarItemTogglesSignatureTag(
      togglesWith({ [CALENDAR_ITEM_OPTION_KEYS.showTimeblocks]: true }),
    );

    expect(timeEntries).not.toBe(timeblocks);
  });
});

const WORK_SUBSCRIPTION: ExternalIcsSubscription = {
  id: 'work-cal',
  name: 'Work calendar',
  color: '#FF0000',
  enabled: true,
};

const DISABLED_SUBSCRIPTION: ExternalIcsSubscription = {
  id: 'disabled-cal',
  name: 'Disabled calendar',
  color: '#999999',
  enabled: false,
};

const HOME_GOOGLE_CALENDAR: ExternalProviderCalendar = {
  provider: 'google',
  id: 'cal1',
  name: 'Home',
};

const OUTLOOK_MICROSOFT_CALENDAR: ExternalProviderCalendar = {
  provider: 'microsoft',
  id: 'calA',
  name: 'Outlook',
};

describe('externalCalendarOptionEntries', () => {
  const allEntries = (): BasesOptions[] =>
    externalCalendarOptionEntries(
      [WORK_SUBSCRIPTION],
      [HOME_GOOGLE_CALENDAR, OUTLOOK_MICROSOFT_CALENDAR],
    );

  const toggleByKey = (key: string): BasesToggleOption => {
    const entry = allEntries().find((item) => item.key === key);
    if (!entry || entry.type !== 'toggle') throw new Error(`toggle ${key} missing`);
    return entry;
  };

  it('declares one per-feed toggle per subscription and provider calendar, all defaulting OFF', () => {
    for (const [key, displayName] of [
      ['tngantt_showICS_work-cal', 'Work calendar'],
      ['tngantt_showGoogleCalendar_cal1', 'Home'],
      ['tngantt_showMicrosoftCalendar_calA', 'Outlook'],
    ]) {
      const toggle = toggleByKey(key);
      // Opt-in rule: this Gantt defaults every external feed OFF even though
      // the TaskNotes calendar shows enabled subscriptions by default.
      expect(toggle.default).toBe(false);
      expect(toggle.displayName).toBe(displayName);
    }
  });

  it('states each provider sync window as a static description line before its toggles', () => {
    const entries = allEntries();
    const notes = entries.filter((entry): entry is BasesTextOption => entry.type === 'text');

    expect(notes.map((note) => note.placeholder)).toEqual([
      "Events from each event's start to ~1 year ahead",
      '~6 months back / 3 ahead (initial sync; incremental sync may add more)',
      '~1 month back / 3 ahead (initial sync; incremental sync may add more)',
    ]);
    const icsNoteIndex = entries.findIndex((entry) => entry.type === 'text');
    const icsToggleIndex = entries.findIndex((entry) => entry.key === 'tngantt_showICS_work-cal');
    expect(icsNoteIndex).toBeGreaterThanOrEqual(0);
    expect(icsToggleIndex).toBe(icsNoteIndex + 1);
  });

  it('omits a provider section entirely when it has no feeds', () => {
    const entries = externalCalendarOptionEntries([], [HOME_GOOGLE_CALENDAR]);

    expect(entries.some((entry) => entry.key.startsWith('tngantt_showICS_'))).toBe(false);
    expect(entries.some((entry) => entry.key.startsWith('tngantt_showMicrosoftCalendar_'))).toBe(false);
    expect(entries.some((entry) => entry.key === 'tngantt_showGoogleCalendar_cal1')).toBe(true);
  });

  it('omits disabled ICS subscriptions from the selectable feed catalog', () => {
    const entries = externalCalendarOptionEntries(
      [WORK_SUBSCRIPTION, DISABLED_SUBSCRIPTION],
      [],
    );

    expect(entries.some((entry) => entry.key === 'tngantt_showICS_work-cal')).toBe(true);
    expect(entries.some((entry) => entry.key === 'tngantt_showICS_disabled-cal')).toBe(false);
  });

  it('produces no entries at all when no external feeds exist', () => {
    expect(externalCalendarOptionEntries([], [])).toEqual([]);
  });
});

describe('externalCalendarDegradedEntry', () => {
  it('is a purely informational gray-text line naming the degraded external family', () => {
    // Bases toggle options carry no disabled/tooltip shape, so the degrade
    // signal in the options panel is this description-line idiom (an empty
    // text input rendering its placeholder), alongside the session Notice.
    const entry = externalCalendarDegradedEntry();
    expect(entry.type).toBe('text');
    expect(entry.default).toBe('');
    expect(entry.displayName).toBe('External calendars');
    expect(entry.placeholder).toContain('unavailable');
  });
});

describe('readVisibleExternalCalendarFeeds', () => {
  const readWith = (values: Record<string, unknown>): ReadonlySet<string> =>
    readVisibleExternalCalendarFeeds(
      getFrom(values),
      [WORK_SUBSCRIPTION],
      [HOME_GOOGLE_CALENDAR, OUTLOOK_MICROSOFT_CALENDAR],
    );

  it('defaults every feed to hidden when its key is absent', () => {
    expect(readWith({}).size).toBe(0);
  });

  it('makes a feed visible only for an explicit boolean true (junk stays hidden)', () => {
    expect(readWith({ 'tngantt_showICS_work-cal': true })).toEqual(new Set(['ics:work-cal']));
    expect(readWith({ 'tngantt_showICS_work-cal': 'true' }).size).toBe(0);
    expect(readWith({ 'tngantt_showGoogleCalendar_cal1': 1 }).size).toBe(0);
  });

  it('keys provider calendars by their unprefixed calendar id', () => {
    const visible = readWith({
      'tngantt_showGoogleCalendar_cal1': true,
      'tngantt_showMicrosoftCalendar_calA': true,
    });

    expect(visible).toEqual(new Set(['google:cal1', 'microsoft:calA']));
  });

  it('ignores an orphaned toggle key whose subscription no longer exists', () => {
    const visible = readWith({
      'tngantt_showICS_deleted-cal': true,
      'tngantt_showICS_work-cal': true,
    });

    expect(visible).toEqual(new Set(['ics:work-cal']));
  });

  it('ignores a true toggle for a disabled ICS subscription', () => {
    const visible = readVisibleExternalCalendarFeeds(
      getFrom({ 'tngantt_showICS_disabled-cal': true }),
      [DISABLED_SUBSCRIPTION],
      [],
    );

    expect(visible).toEqual(new Set());
  });
});
