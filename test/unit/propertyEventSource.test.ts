/**
 * Property-based event calendar-item source unit tests.
 *
 * Notes from this view's Bases query become flat read-only event bars via the
 * user-mapped start/end/title properties. Date-only values are floating — the
 * date part is read verbatim, never zone-shifted — while values with a time
 * component attribute through the shared instant normalizer (the observer zone
 * cannot be pinned under Jest, so the offset-conversion fixture is stamped
 * with a foreign offset and a sanity assertion proves its wall date differs
 * from the expected local day). Malformed values drop the note, never the
 * derivation. Every fixture's `getValue` throws: property events must read
 * frontmatter directly.
 *
 * Following testing-standards.md: Jest, pure fixtures via DI, AAA.
 */

import { describe, it, expect, jest } from '@jest/globals';
import type { BasesEntry } from 'obsidian';
import {
  makeCalendarItemId,
  type CalendarItemQueryContext,
} from '../../src/datasource/calendarItems';
import {
  createPropertyEventSource,
  type PropertyEventSourceDeps,
  type PropertyEventToggles,
} from '../../src/datasource/calendarItems/propertyEventSource';
import type { BasesEntryLike } from '../../src/bases/types/bases-entry';

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** Express an absolute instant as an ISO string at the given UTC offset. */
function isoAtOffset(instant: Date, offsetMinutes: number): string {
  const wall = new Date(instant.getTime() + offsetMinutes * 60_000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return (
    `${pad(wall.getUTCFullYear(), 4)}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}` +
    `T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}:${pad(wall.getUTCSeconds())}` +
    `${sign}${pad(Math.trunc(abs / 60))}:${pad(abs % 60)}`
  );
}

const START_PROPERTY = 'note.eventStart';
const END_PROPERTY = 'note.eventEnd';
const TITLE_PROPERTY = 'note.eventTitle';

function togglesOn(overrides: Partial<PropertyEventToggles> = {}): PropertyEventToggles {
  return {
    showPropertyBasedEvents: true,
    propertyEventStart: START_PROPERTY,
    propertyEventEnd: END_PROPERTY,
    propertyEventTitle: TITLE_PROPERTY,
    ...overrides,
  };
}

/** A Bases row fixture whose `getValue` proves the frontmatter fast path. */
function noteEntry(path: string, frontmatter: Record<string, unknown>): BasesEntryLike {
  const name = path.split('/').pop() ?? path;
  return {
    file: { path, name, basename: name.replace(/\.md$/, '') },
    frontmatter,
    getValue: () => {
      throw new Error('property events must read frontmatter directly, never through getValue');
    },
  };
}

/** A query context whose Bases-rows accessor returns exactly these entries. */
function contextOver(entries: readonly BasesEntryLike[]): CalendarItemQueryContext {
  return {
    window: { startDate: '2026-08-01', endDateExclusive: '2026-09-01' },
    tasks: () => [],
    basesEntries: () => entries as unknown as readonly BasesEntry[],
  };
}

function makeSource(
  toggles: PropertyEventToggles = togglesOn(),
  deps: Partial<PropertyEventSourceDeps> = {},
) {
  return createPropertyEventSource({ toggles: () => toggles, ...deps });
}

describe('propertyEventSource — event bars from mapped properties', () => {
  it('renders one event bar per note spanning the start..end days inclusive', async () => {
    const conference = noteEntry('events/conference.md', {
      eventStart: '2026-08-03',
      eventEnd: '2026-08-05',
      eventTitle: 'Design conference',
    });

    const batch = await makeSource().collect(contextOver([conference]));

    expect(batch.items).toEqual([
      {
        id: makeCalendarItemId('property-event', 'events/conference.md'),
        family: 'property-event',
        title: 'Design conference',
        startDay: '2026-08-03',
        endDay: '2026-08-05',
        notePath: 'events/conference.md',
      },
    ]);
    expect(batch.occupancyByTaskPath.size).toBe(0);
  });

  it('gives a start-only note a one-day span', async () => {
    const workshop = noteEntry('events/workshop.md', { eventStart: '2026-08-10' });

    const batch = await makeSource().collect(contextOver([workshop]));

    expect(batch.items[0]).toMatchObject({ startDay: '2026-08-10', endDay: '2026-08-10' });
  });

  it('reads only the configured property names, ignoring other date-shaped fields', async () => {
    const entry = noteEntry('events/offsite.md', {
      eventStart: '2026-08-03',
      eventEnd: '2026-08-09',
      endDate: '2026-08-09',
    });

    const batch = await makeSource(togglesOn({ propertyEventEnd: '' })).collect(
      contextOver([entry]),
    );

    expect(batch.items[0]).toMatchObject({ startDay: '2026-08-03', endDay: '2026-08-03' });
  });

  it('reads a date-only start verbatim as a floating day, never zone-shifting it', async () => {
    // Instant parsing would read '2026-08-03' as UTC midnight and shift it to
    // the previous day for observers west of UTC; the floating read must not.
    const entry = noteEntry('events/floating.md', { eventStart: '2026-08-03' });

    const batch = await makeSource().collect(contextOver([entry]));

    expect(batch.items[0]).toMatchObject({ startDay: '2026-08-03', endDay: '2026-08-03' });
  });

  it('attributes an offset-stamped timed start to the observer-local day, not its wall date', async () => {
    // 00:30 local on Aug 4, stamped at an offset one hour behind the
    // observer's — the wall clock still reads Aug 3 there.
    const start = new Date(2026, 7, 4, 0, 30, 0);
    const stamped = isoAtOffset(start, -start.getTimezoneOffset() - 60);
    expect(stamped.startsWith('2026-08-03T23:30:00')).toBe(true);
    const entry = noteEntry('events/midnight.md', { eventStart: stamped });

    const batch = await makeSource().collect(contextOver([entry]));

    expect(batch.items[0]).toMatchObject({ startDay: '2026-08-04', endDay: '2026-08-04' });
  });

  it('normalizes a reversed start/end pair into an ordered span', async () => {
    const entry = noteEntry('events/reversed.md', {
      eventStart: '2026-08-05',
      eventEnd: '2026-08-03',
    });

    const batch = await makeSource().collect(contextOver([entry]));

    expect(batch.items[0]).toMatchObject({ startDay: '2026-08-03', endDay: '2026-08-05' });
  });
});

describe('propertyEventSource — emission gating', () => {
  it('emits an empty batch when the family toggle is off despite full configuration', async () => {
    const entry = noteEntry('events/conference.md', { eventStart: '2026-08-03' });

    const batch = await makeSource(togglesOn({ showPropertyBasedEvents: false })).collect(
      contextOver([entry]),
    );

    expect(batch.items).toEqual([]);
    expect(batch.occupancyByTaskPath.size).toBe(0);
  });

  it.each([
    { caseName: 'unconfigured', propertyEventStart: '' },
    { caseName: 'not frontmatter-backed', propertyEventStart: 'file.ctime' },
  ])(
    'emits an empty batch while the start picker is $caseName even with the toggle on',
    async ({ propertyEventStart }) => {
      const entry = noteEntry('events/conference.md', { eventStart: '2026-08-03' });

      const batch = await makeSource(togglesOn({ propertyEventStart })).collect(
        contextOver([entry]),
      );

      expect(batch.items).toEqual([]);
    },
  );
});

describe('propertyEventSource — title resolution', () => {
  it('falls back to the file basename when the title picker is unconfigured', async () => {
    const entry = noteEntry('events/team offsite.md', {
      eventStart: '2026-08-03',
      eventTitle: 'Ignored',
    });

    const batch = await makeSource(togglesOn({ propertyEventTitle: '' })).collect(
      contextOver([entry]),
    );

    expect(batch.items[0]?.title).toBe('team offsite');
  });

  it.each([
    { caseName: 'missing', frontmatter: { eventStart: '2026-08-03' } },
    { caseName: 'blank', frontmatter: { eventStart: '2026-08-03', eventTitle: '   ' } },
    { caseName: 'not a string', frontmatter: { eventStart: '2026-08-03', eventTitle: 42 } },
  ])(
    'falls back to the file basename when the configured title value is $caseName',
    async ({ frontmatter }) => {
      const entry = noteEntry('events/team offsite.md', frontmatter);

      const batch = await makeSource().collect(contextOver([entry]));

      expect(batch.items[0]?.title).toBe('team offsite');
    },
  );
});

describe('propertyEventSource — malformed values', () => {
  it.each([
    { caseName: 'an impossible calendar day', eventStart: '2026-02-30' },
    { caseName: 'unparseable', eventStart: 'not-a-date' },
    { caseName: 'empty', eventStart: '' },
    { caseName: 'blank', eventStart: '   ' },
    { caseName: 'the "null" placeholder', eventStart: 'null' },
    { caseName: 'the "undefined" placeholder', eventStart: 'undefined' },
    { caseName: 'not a string', eventStart: 20260803 },
  ])(
    'drops a note whose start value is $caseName without throwing, keeping valid siblings',
    async ({ eventStart }) => {
      const bad = noteEntry('events/bad.md', { eventStart });
      const good = noteEntry('events/good.md', { eventStart: '2026-08-03' });

      const batch = await makeSource().collect(contextOver([bad, good]));

      expect(batch.items.map((item) => item.notePath)).toEqual(['events/good.md']);
    },
  );

  it('drops a note without the start property while keeping configured siblings', async () => {
    const unrelated = noteEntry('notes/plain.md', { status: 'open' });
    const good = noteEntry('events/good.md', { eventStart: '2026-08-03' });

    const batch = await makeSource().collect(contextOver([unrelated, good]));

    expect(batch.items.map((item) => item.notePath)).toEqual(['events/good.md']);
  });

  it('drops a note whose configured end value is present but unparseable', async () => {
    const bad = noteEntry('events/bad-end.md', {
      eventStart: '2026-08-03',
      eventEnd: 'garbage',
    });
    const good = noteEntry('events/good.md', { eventStart: '2026-08-03' });

    const batch = await makeSource().collect(contextOver([bad, good]));

    expect(batch.items.map((item) => item.notePath)).toEqual(['events/good.md']);
  });
});

describe('propertyEventSource — identity and query scoping', () => {
  it('derives one event per file with distinct ids that are stable across refreshes', async () => {
    const source = makeSource();
    const context = contextOver([
      noteEntry('events/first.md', { eventStart: '2026-08-03' }),
      noteEntry('events/second.md', { eventStart: '2026-08-04' }),
    ]);

    const first = await source.collect(context);
    const second = await source.collect(context);

    const firstIds = first.items.map((item) => item.id);
    expect(firstIds).toEqual([
      makeCalendarItemId('property-event', 'events/first.md'),
      makeCalendarItemId('property-event', 'events/second.md'),
    ]);
    expect(new Set(firstIds).size).toBe(2);
    expect(second.items.map((item) => item.id)).toEqual(firstIds);
  });

  it('derives events only from the rows the query accessor returns', async () => {
    const kept = noteEntry('events/kept.md', { eventStart: '2026-08-03' });
    const filteredOut = noteEntry('events/filtered-out.md', { eventStart: '2026-08-04' });
    const source = makeSource();

    const unfiltered = await source.collect(contextOver([kept, filteredOut]));
    const filtered = await source.collect(contextOver([kept]));

    expect(unfiltered.items).toHaveLength(2);
    expect(filtered.items.map((item) => item.notePath)).toEqual(['events/kept.md']);
  });
});

describe('propertyEventSource — epoch and change events', () => {
  it('bumps the epoch when a subscribed change event fires and unsubscribes on dispose', () => {
    let handler: ((eventName: string, payload?: unknown) => void) | undefined;
    const unsubscribe = jest.fn();
    const source = makeSource(togglesOn(), {
      subscribe: (h) => {
        handler = h;
        return unsubscribe;
      },
    });

    const before = source.epoch();
    handler!('bases-data-updated');
    const after = source.epoch();
    source.dispose();

    expect(after).toBe(before + 1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
