/**
 * Unit tests for the Calendar-items view-option group and its pure readers.
 *
 * Every calendar-item family defaults OFF — the omission fixture (a `get`
 * that returns nothing) is the default test. Once the recurring family is on,
 * the completed/skipped sub-toggles adopt the calendar's defaults (shown).
 * Property pickers are property-agnostic: empty defaults, no hardcoded names.
 */

import type { BasesOptions, BasesPropertyOption } from 'obsidian';
import {
  CALENDAR_ITEM_OPTION_KEYS,
  calendarItemOptionsGroup,
  calendarItemTogglesSignatureTag,
  calendarItemWatchedProperties,
  readCalendarItemToggles,
  type CalendarItemToggles,
} from '../../src/bases/calendarItemOptions';

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
