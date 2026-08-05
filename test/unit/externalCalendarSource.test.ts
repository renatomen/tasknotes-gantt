/**
 * External-calendar calendar-item source unit tests.
 *
 * Fixtures are shaped like the ACTUAL TaskNotes services (transcribed from the
 * sibling checkout): `icsSubscriptionService.getSubscriptions()` returns
 * `{id,name,url,type,color,enabled,refreshInterval}` records,
 * `getAllEvents()` returns ICSEvent `{id,subscriptionId,title,start,end,
 * allDay,rrule?,recurringEventId?,color?}`, and `calendarProviderRegistry`
 * exposes providers (EventEmitter-shaped `on` returning an unsubscribe)
 * whose `getAllEvents()` return the same ICSEvent shape with `subscriptionId`
 * prefixed `google-`/`microsoft-`.
 *
 * The works-but-does-nothing failure mode is a named defect class here, so
 * happy paths assert REAL items with exact days/ids, never just "no throw".
 *
 * The observer zone cannot be pinned under Jest, so instant-dialect fixtures
 * are built dynamically from machine-local wall times (foreign-offset stamped
 * where the conversion is the behavior under test, with a sanity assertion).
 * Wall-clock-dialect expectations are zone-independent by definition.
 */

import { describe, it, expect, jest } from '@jest/globals';
import {
  makeCalendarItemId,
  type CalendarItemQueryContext,
} from '../../src/datasource/calendarItems';
import {
  createExternalCalendarSource,
  externalCalendarFeedKey,
  readExternalCalendarDiscovery,
  readExternalIcsSubscriptions,
  readExternalProviderCalendars,
  type ExternalCalendarSourceDeps,
} from '../../src/datasource/calendarItems/externalCalendarSource';
import type { TimerScheduler } from '../../src/bases/scheduler';

const externalItemId = (seriesId: string, qualifier: string): string =>
  makeCalendarItemId('external-event', seriesId, qualifier);

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

/** Express an absolute instant as an ISO string at the observer's own offset. */
function isoAtLocalOffset(instant: Date): string {
  return isoAtOffset(instant, -instant.getTimezoneOffset());
}

/** An offset one hour behind the observer's (foreign wall date differs at local midnight). */
function foreignOffsetBehindLocal(instant: Date): number {
  return -instant.getTimezoneOffset() - 60;
}

// --- service-shaped fixtures (transcribed from the TaskNotes sibling checkout) ---

interface IcsSubscriptionFixture {
  id: string;
  name: string;
  url?: string;
  filePath?: string;
  type: 'remote' | 'local';
  color: string;
  enabled: boolean;
  refreshInterval: number;
}

interface IcsEventFixture {
  id?: string;
  subscriptionId: string;
  title: string;
  description?: string;
  start: string;
  end?: string;
  allDay: boolean;
  location?: string;
  url?: string;
  rrule?: string;
  recurringEventId?: string;
  color?: string;
}

function icsSubscription(overrides: Partial<IcsSubscriptionFixture> = {}): IcsSubscriptionFixture {
  return {
    id: 'work-cal',
    name: 'Work calendar',
    url: 'https://example.com/work.ics',
    type: 'remote',
    color: '#FF0000',
    enabled: true,
    refreshInterval: 60,
    ...overrides,
  };
}

function icsEvent(overrides: Partial<IcsEventFixture> = {}): IcsEventFixture {
  return {
    id: 'work-cal-uid-1',
    subscriptionId: 'work-cal',
    title: 'Team sync',
    start: '2026-08-10T12:00:00Z',
    end: '2026-08-10T13:00:00Z',
    allDay: false,
    ...overrides,
  };
}

/** Records listeners the way the TaskNotes EventEmitter does (on → unsubscribe). */
function emitterStub() {
  const listeners = new Map<string, Array<() => void>>();
  const unsubscribeCalls: string[] = [];
  return {
    on: (event: string, listener: () => void): (() => void) => {
      const existing = listeners.get(event) ?? [];
      listeners.set(event, [...existing, listener]);
      return () => {
        unsubscribeCalls.push(event);
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter((l) => l !== listener),
        );
      };
    },
    emit: (event: string) => {
      for (const listener of listeners.get(event) ?? []) listener();
    },
    unsubscribeCalls,
  };
}

interface ProviderFixtureInput {
  providerId: 'google' | 'microsoft';
  calendars?: Array<{ id: string; summary: string; backgroundColor?: string; primary?: boolean }>;
  events?: IcsEventFixture[];
  syncTokensByCalendarId?: Readonly<Record<string, string>>;
}

function providerFixture(input: ProviderFixtureInput) {
  const emitter = emitterStub();
  const state = { events: input.events ?? [] };
  return {
    state,
    emitter,
    provider: {
      providerId: input.providerId,
      providerName: input.providerId === 'google' ? 'Google Calendar' : 'Microsoft Calendar',
      getAllEvents: jest.fn(() => state.events),
      getAvailableCalendars: jest.fn(() => input.calendars ?? []),
      getSyncToken: jest.fn((calendarId: string) => input.syncTokensByCalendarId?.[calendarId]),
      on: emitter.on,
    },
  };
}

interface PluginFixtureInput {
  subscriptions?: IcsSubscriptionFixture[];
  icsEvents?: IcsEventFixture[];
  providers?: Array<ReturnType<typeof providerFixture>['provider']>;
  lastFetchedById?: Readonly<Record<string, string>>;
}

function pluginFixture(input: PluginFixtureInput = {}) {
  const emitter = emitterStub();
  const state = {
    subscriptions: input.subscriptions ?? [],
    icsEvents: input.icsEvents ?? [],
    lastFetchedById: { ...(input.lastFetchedById ?? {}) } as Record<string, string>,
  };
  const icsSubscriptionService = {
    getSubscriptions: jest.fn(() => state.subscriptions),
    getAllEvents: jest.fn(() => state.icsEvents),
    getLastFetched: jest.fn((id: string) => state.lastFetchedById[id]),
    on: emitter.on,
  };
  const calendarProviderRegistry = {
    getAllProviders: jest.fn(() => input.providers ?? []),
  };
  return {
    state,
    emitter,
    icsSubscriptionService,
    plugin: { icsSubscriptionService, calendarProviderRegistry },
  };
}

function manualScheduler() {
  let nextHandle = 1;
  const pending = new Map<number, () => void>();
  const scheduler: TimerScheduler = {
    setTimeout: (callback: () => void) => {
      const handle = nextHandle++;
      pending.set(handle, callback);
      return handle as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (timer) => {
      pending.delete(timer as unknown as number);
    },
  };
  return {
    scheduler,
    tick: () => {
      const [handle, callback] = pending.entries().next().value ?? [];
      if (handle === undefined || callback === undefined) return false;
      pending.delete(handle);
      callback();
      return true;
    },
    pendingCount: () => pending.size,
  };
}

const CONTEXT: CalendarItemQueryContext = {
  window: { startDate: '2026-08-01', endDateExclusive: '2026-10-01' },
  tasks: () => [],
  basesEntries: () => [],
};

function makeSource(
  plugin: unknown,
  visibleFeeds: ReadonlySet<string>,
  overrides: Partial<ExternalCalendarSourceDeps> = {},
) {
  const timers = manualScheduler();
  const source = createExternalCalendarSource({
    getTaskNotesPlugin: () => plugin,
    visibleFeeds: () => visibleFeeds,
    scheduler: timers.scheduler,
    ...overrides,
  });
  return { source, timers };
}

const ALL_WORK_VISIBLE = new Set([externalCalendarFeedKey('ics', 'work-cal')]);

describe('createExternalCalendarSource — guarded service absence', () => {
  it('degrades to an empty batch without throwing when TaskNotes is absent', async () => {
    const { source } = makeSource(undefined, ALL_WORK_VISIBLE);

    const batch = await source.collect(CONTEXT);

    expect(batch.items).toEqual([]);
    expect(batch.degraded).toBe(true);
    expect(batch.loading).toBeFalsy();
  });

  it('degrades when the plugin exposes malformed service surfaces', async () => {
    const malformed = { icsSubscriptionService: {}, calendarProviderRegistry: { getAllProviders: 7 } };
    const { source } = makeSource(malformed, ALL_WORK_VISIBLE);

    const batch = await source.collect(CONTEXT);

    expect(batch.items).toEqual([]);
    expect(batch.degraded).toBe(true);
  });

  it('never touches the ICS surface (no fetch, no degrade) when no ICS feed is visible', async () => {
    const google = providerFixture({
      providerId: 'google',
      calendars: [{ id: 'cal1', summary: 'Home' }],
      events: [
        icsEvent({
          id: 'google-cal1-e1',
          subscriptionId: 'google-cal1',
          title: 'Dentist',
          start: '2026-08-12T10:00:00',
          end: '2026-08-12T10:30:00',
        }),
      ],
    });
    // getAllEvents is the ICS fetch trigger; it must not run for a provider-only view.
    const getAllEvents = jest.fn(() => []);
    const plugin = {
      icsSubscriptionService: { getSubscriptions: jest.fn(() => []), getAllEvents },
      calendarProviderRegistry: { getAllProviders: () => [google.provider] },
    };
    const { source } = makeSource(plugin, new Set([externalCalendarFeedKey('google', 'cal1')]));

    const batch = await source.collect(CONTEXT);

    expect(getAllEvents).not.toHaveBeenCalled();
    expect(batch.degraded).toBeUndefined();
    expect(batch.items.map((item) => item.title)).toEqual(['Dentist']);
  });

  it('reads the ICS surface when an ICS feed is visible', async () => {
    const getAllEvents = jest.fn(() => []);
    const plugin = {
      icsSubscriptionService: {
        getSubscriptions: jest.fn(() => []),
        getAllEvents,
        getLastFetched: () => undefined,
      },
      calendarProviderRegistry: { getAllProviders: () => [] },
    };
    const { source } = makeSource(plugin, ALL_WORK_VISIBLE);

    await source.collect(CONTEXT);

    expect(getAllEvents).toHaveBeenCalled();
  });

  it('keeps a healthy provider\'s events and flags degraded when a sibling provider throws', async () => {
    const broken = providerFixture({ providerId: 'google', calendars: [{ id: 'cal1', summary: 'Home' }] });
    broken.provider.getAllEvents.mockImplementation(() => {
      throw new Error('provider exploded');
    });
    const microsoft = providerFixture({
      providerId: 'microsoft',
      calendars: [{ id: 'calA', summary: 'Outlook' }],
      events: [
        icsEvent({
          id: 'microsoft-calA-e1',
          subscriptionId: 'microsoft-calA',
          title: 'Design review',
          start: '2026-08-12T14:00:00',
          end: '2026-08-12T15:00:00',
        }),
      ],
    });
    const fixture = pluginFixture({ providers: [broken.provider, microsoft.provider] });
    const { source } = makeSource(fixture.plugin, new Set([externalCalendarFeedKey('microsoft', 'calA')]));

    const batch = await source.collect(CONTEXT);

    expect(batch.items).toHaveLength(1);
    expect(batch.items[0].title).toBe('Design review');
    expect(batch.items[0].startDay).toBe('2026-08-12');
    expect(batch.degraded).toBe(true);
  });

  it('preserves a provider catalog when its event-cache read throws (feed stays selectable, degraded)', async () => {
    const broken = providerFixture({ providerId: 'google', calendars: [{ id: 'cal1', summary: 'Home' }] });
    broken.provider.getAllEvents.mockImplementation(() => {
      throw new Error('cache exploded');
    });
    const fixture = pluginFixture({ providers: [broken.provider] });
    const { source } = makeSource(fixture.plugin, new Set([externalCalendarFeedKey('google', 'cal1')]));

    const batch = await source.collect(CONTEXT);

    // The event read failed → degraded, but reading the catalog is independent…
    expect(batch.degraded).toBe(true);
    expect(batch.items).toEqual([]);
    // …so the selected calendar survives the throw and stays selectable.
    expect(readExternalProviderCalendars(fixture.plugin).map((cal) => cal.id)).toContain('cal1');
  });

  it('marks malformed provider entries and missing required provider surfaces as degraded', async () => {
    const malformedProviders = [
      null,
      { getAllEvents: () => [], getAvailableCalendars: () => [] },
      { providerId: 'google', getAvailableCalendars: () => [] },
      { providerId: 'microsoft', getAllEvents: () => [] },
    ];
    const fixture = pluginFixture({ subscriptions: [icsSubscription()] });
    const plugin = {
      ...fixture.plugin,
      calendarProviderRegistry: { getAllProviders: () => malformedProviders },
    };
    // A provider feed is visible, so the provider surface is read and its
    // malformed entries degrade the collect.
    const { source } = makeSource(plugin, new Set([externalCalendarFeedKey('google', 'cal1')]));

    const batch = await source.collect(CONTEXT);

    expect(batch.items).toEqual([]);
    expect(batch.degraded).toBe(true);
    expect(readExternalCalendarDiscovery(plugin).degraded).toBe(true);
  });

  it('does not degrade an ICS-only view when the provider registry is absent or throwing', async () => {
    // An ICS-only selection must not be marked degraded (which would suppress its
    // cold-cache loading indicator) just because the Google/Microsoft registry is
    // missing — the provider is irrelevant to a view that selected no provider feed.
    const fixture = pluginFixture({ subscriptions: [icsSubscription()], icsEvents: [icsEvent()] });
    const plugin = {
      icsSubscriptionService: fixture.icsSubscriptionService,
      calendarProviderRegistry: {
        getAllProviders: () => {
          throw new Error('registry offline');
        },
      },
    };
    const { source } = makeSource(plugin, ALL_WORK_VISIBLE);

    const batch = await source.collect(CONTEXT);

    expect(batch.degraded).toBeFalsy();
  });

  it('attaches a later provider\'s data-changed listener when an earlier provider\'s on() throws', () => {
    const broken = providerFixture({ providerId: 'google', calendars: [] });
    broken.provider.on = () => {
      throw new Error('emitter unavailable');
    };
    const microsoft = providerFixture({ providerId: 'microsoft', calendars: [{ id: 'calA', summary: 'Outlook' }] });
    const fixture = pluginFixture({ providers: [broken.provider, microsoft.provider] });
    const { source } = makeSource(
      fixture.plugin,
      new Set([externalCalendarFeedKey('microsoft', 'calA')]),
    );

    microsoft.emitter.emit('data-changed');

    expect(source.epoch()).toBe(1);
  });

  it('degrades the throwing surface instead of rejecting when a guarded getter throws', async () => {
    const fixture = pluginFixture({ subscriptions: [icsSubscription()] });
    fixture.icsSubscriptionService.getAllEvents.mockImplementation(() => {
      throw new Error('cache exploded');
    });
    const { source } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    const batch = await source.collect(CONTEXT);

    expect(batch.items).toEqual([]);
    expect(batch.degraded).toBe(true);
  });
});

describe('createExternalCalendarSource — ICS dialect normalization', () => {
  it('uses the subscription color when an ICS event has no event-level color', async () => {
    const fixture = pluginFixture({
      subscriptions: [icsSubscription({ color: '#c0392b' })],
      icsEvents: [icsEvent()],
    });
    const { source } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    const batch = await source.collect(CONTEXT);

    expect(batch.items[0].color).toBe('#c0392b');
  });

  it('skips an ICS event with a malformed id without aborting the whole collect', async () => {
    const fixture = pluginFixture({
      subscriptions: [icsSubscription()],
      icsEvents: [
        // A lone UTF-16 surrogate id makes encodeURIComponent throw in the id build.
        icsEvent({ id: String.fromCodePoint(0xd800), title: 'Broken' }),
        icsEvent({ id: 'work-cal-uid-ok', title: 'Good' }),
      ],
    });
    const { source } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    const batch = await source.collect(CONTEXT);

    expect(batch.items).toHaveLength(1);
    expect(batch.items[0].title).toBe('Good');
  });

  it('keeps surrounding events in order when a middle event id is malformed', async () => {
    const fixture = pluginFixture({
      subscriptions: [icsSubscription()],
      icsEvents: [
        icsEvent({ id: 'e-a', title: 'A', start: '2026-08-10T09:00:00Z', end: '2026-08-10T10:00:00Z' }),
        icsEvent({ id: String.fromCodePoint(0xd800), title: 'Bad' }),
        icsEvent({ id: 'e-c', title: 'C', start: '2026-08-11T09:00:00Z', end: '2026-08-11T10:00:00Z' }),
      ],
    });
    const { source } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    const batch = await source.collect(CONTEXT);

    expect(batch.items.map((item) => item.title)).toEqual(['A', 'C']);
  });

  it('converts foreign-offset UTC-instant events to observer-local day spans (real items, not empties)', async () => {
    // 2026-08-04 00:30 local, stamped at an offset one hour behind: the wall
    // date reads the PREVIOUS day, so naive date-part reading would misfile it.
    const pastMidnight = new Date(2026, 7, 4, 0, 30, 0);
    const start = isoAtOffset(pastMidnight, foreignOffsetBehindLocal(pastMidnight));
    expect(start.startsWith('2026-08-03T23:30:00')).toBe(true);
    const end = isoAtOffset(new Date(2026, 7, 4, 1, 0, 0), foreignOffsetBehindLocal(pastMidnight));
    const fixture = pluginFixture({
      subscriptions: [icsSubscription()],
      icsEvents: [icsEvent({ start, end, title: 'Standup', color: '#00FF00' })],
    });
    const { source } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    const batch = await source.collect(CONTEXT);

    expect(batch.items).toHaveLength(1);
    const item = batch.items[0];
    expect(item.family).toBe('external-event');
    expect(item.title).toBe('Standup');
    expect(item.color).toBe('#00FF00');
    expect(item.startDay).toBe('2026-08-04');
    expect(item.endDay).toBe('2026-08-04');
    expect(item.notePath).toBeUndefined();
  });

  it('spans both local days when a timed instant event crosses local midnight', async () => {
    const fixture = pluginFixture({
      subscriptions: [icsSubscription()],
      icsEvents: [
        icsEvent({
          start: isoAtLocalOffset(new Date(2026, 7, 3, 23, 0, 0)),
          end: isoAtLocalOffset(new Date(2026, 7, 4, 1, 0, 0)),
        }),
      ],
    });
    const { source } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    const batch = await source.collect(CONTEXT);

    expect(batch.items).toHaveLength(1);
    expect(batch.items[0].startDay).toBe('2026-08-03');
    expect(batch.items[0].endDay).toBe('2026-08-04');
  });

  it('excludes the end day when a timed instant event ends exactly at local midnight', async () => {
    const fixture = pluginFixture({
      subscriptions: [icsSubscription()],
      icsEvents: [
        icsEvent({
          start: isoAtLocalOffset(new Date(2026, 7, 3, 23, 0, 0)),
          end: isoAtLocalOffset(new Date(2026, 7, 4, 0, 0, 0)),
        }),
      ],
    });
    const { source } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    const batch = await source.collect(CONTEXT);

    expect(batch.items[0]).toMatchObject({ startDay: '2026-08-03', endDay: '2026-08-03' });
  });

  it('keeps a one-day all-day event on its own floating day (exclusive DTEND collapses)', async () => {
    const fixture = pluginFixture({
      subscriptions: [icsSubscription()],
      icsEvents: [icsEvent({ start: '2026-08-10', end: '2026-08-11', allDay: true })],
    });
    const { source } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    const batch = await source.collect(CONTEXT);

    expect(batch.items).toHaveLength(1);
    expect(batch.items[0].startDay).toBe('2026-08-10');
    expect(batch.items[0].endDay).toBe('2026-08-10');
  });

  it('collapses an all-day event whose exclusive end is a midnight datetime, not a bare date', async () => {
    // Google/Microsoft style: allDay true but the end arrives as `…T00:00:00`.
    // The midnight datetime is the same exclusive whole-day boundary as a bare
    // date, so the event occupies only 2026-08-10 (not through 08-11).
    const fixture = pluginFixture({
      subscriptions: [icsSubscription()],
      icsEvents: [
        icsEvent({ start: '2026-08-10T00:00:00', end: '2026-08-11T00:00:00', allDay: true }),
      ],
    });
    const { source } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    const batch = await source.collect(CONTEXT);

    expect(batch.items).toHaveLength(1);
    expect(batch.items[0].startDay).toBe('2026-08-10');
    expect(batch.items[0].endDay).toBe('2026-08-10');
  });

  it('renders a multi-day all-day event through its last occupied day (exclusive DTEND minus one)', async () => {
    const fixture = pluginFixture({
      subscriptions: [icsSubscription()],
      icsEvents: [icsEvent({ start: '2026-08-10', end: '2026-08-13', allDay: true })],
    });
    const { source } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    const batch = await source.collect(CONTEXT);

    expect(batch.items).toHaveLength(1);
    expect(batch.items[0].startDay).toBe('2026-08-10');
    expect(batch.items[0].endDay).toBe('2026-08-12');
    expect(batch.items[0].occupancyDays).toBeUndefined();
  });

  it('drops an all-day event whose present end is not a real calendar day', async () => {
    const fixture = pluginFixture({
      subscriptions: [icsSubscription()],
      icsEvents: [icsEvent({ start: '2026-08-10', end: '2026-02-30', allDay: true })],
    });
    const { source } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    const batch = await source.collect(CONTEXT);

    expect(batch.items).toEqual([]);
  });

  it('keeps an all-day event with no end as a one-day event', async () => {
    const fixture = pluginFixture({
      subscriptions: [icsSubscription()],
      icsEvents: [icsEvent({ start: '2026-08-10', end: undefined, allDay: true })],
    });
    const { source } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    const batch = await source.collect(CONTEXT);

    expect(batch.items[0]).toMatchObject({ startDay: '2026-08-10', endDay: '2026-08-10' });
  });

  it('collapses a zero-duration event to a one-day span', async () => {
    const nineAm = isoAtLocalOffset(new Date(2026, 7, 5, 9, 0, 0));
    const fixture = pluginFixture({
      subscriptions: [icsSubscription()],
      icsEvents: [icsEvent({ start: nineAm, end: nineAm })],
    });
    const { source } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    const batch = await source.collect(CONTEXT);

    expect(batch.items).toHaveLength(1);
    expect(batch.items[0].startDay).toBe('2026-08-05');
    expect(batch.items[0].endDay).toBe('2026-08-05');
  });
});

describe('createExternalCalendarSource — Google/Microsoft wall-clock dialect', () => {
  function googlePlugin(events: IcsEventFixture[]) {
    const google = providerFixture({
      providerId: 'google',
      calendars: [{ id: 'cal1', summary: 'Home' }],
      events,
    });
    const fixture = pluginFixture({ providers: [google.provider] });
    return { plugin: fixture.plugin, google };
  }
  const CAL1_VISIBLE = new Set([externalCalendarFeedKey('google', 'cal1')]);

  it('drops external events outside the derivation window, keeping in-window ones', async () => {
    const { plugin } = googlePlugin([
      icsEvent({
        id: 'google-cal1-far',
        subscriptionId: 'google-cal1',
        title: 'Far future',
        start: '2027-01-05',
        end: '2027-01-06',
        allDay: true,
      }),
      icsEvent({
        id: 'google-cal1-in',
        subscriptionId: 'google-cal1',
        title: 'In window',
        start: '2026-08-15',
        end: '2026-08-16',
        allDay: true,
      }),
    ]);
    const { source } = makeSource(plugin, CAL1_VISIBLE);

    const batch = await source.collect(CONTEXT);

    expect(batch.items.map((item) => item.title)).toEqual(['In window']);
  });

  it('keeps a late-evening local-wall event on its own floating day (23:30 never zone-shifts)', async () => {
    const { plugin } = googlePlugin([
      icsEvent({
        id: 'google-cal1-e1',
        subscriptionId: 'google-cal1',
        start: '2026-08-10T23:30:00',
        end: '2026-08-10T23:45:00',
      }),
    ]);
    const { source } = makeSource(plugin, CAL1_VISIBLE);

    const batch = await source.collect(CONTEXT);

    expect(batch.items).toHaveLength(1);
    expect(batch.items[0].startDay).toBe('2026-08-10');
    expect(batch.items[0].endDay).toBe('2026-08-10');
  });

  it('keeps an early-morning local-wall event on its own floating day (00:30 never zone-shifts)', async () => {
    // The 23:30 case catches a treat-as-UTC defect in zones ahead of UTC; this
    // 00:30 companion catches it in zones behind — together every nonzero
    // offset exposes the mutant.
    const { plugin } = googlePlugin([
      icsEvent({
        id: 'google-cal1-e2',
        subscriptionId: 'google-cal1',
        start: '2026-08-10T00:30:00',
        end: '2026-08-10T01:00:00',
      }),
    ]);
    const { source } = makeSource(plugin, CAL1_VISIBLE);

    const batch = await source.collect(CONTEXT);

    expect(batch.items).toHaveLength(1);
    expect(batch.items[0].startDay).toBe('2026-08-10');
    expect(batch.items[0].endDay).toBe('2026-08-10');
  });

  it('renders a multi-day non-recurring wall-clock event as one solid span without occupancyDays', async () => {
    const { plugin } = googlePlugin([
      icsEvent({
        id: 'google-cal1-e3',
        subscriptionId: 'google-cal1',
        start: '2026-08-14T22:00:00',
        end: '2026-08-16T10:00:00',
      }),
    ]);
    const { source } = makeSource(plugin, CAL1_VISIBLE);

    const batch = await source.collect(CONTEXT);

    expect(batch.items).toHaveLength(1);
    expect(batch.items[0].startDay).toBe('2026-08-14');
    expect(batch.items[0].endDay).toBe('2026-08-16');
    expect(batch.items[0].occupancyDays).toBeUndefined();
  });

  it('excludes the end day when a floating wall-clock event ends exactly at midnight', async () => {
    const { plugin } = googlePlugin([
      icsEvent({
        id: 'google-cal1-midnight',
        subscriptionId: 'google-cal1',
        start: '2026-08-14T23:00:00',
        end: '2026-08-15T00:00:00',
      }),
    ]);
    const { source } = makeSource(plugin, CAL1_VISIBLE);

    const batch = await source.collect(CONTEXT);

    expect(batch.items[0]).toMatchObject({ startDay: '2026-08-14', endDay: '2026-08-14' });
  });
});

describe('createExternalCalendarSource — identity and recurring series', () => {
  it('gives two same-day events at different start times distinct, data-derived ids', async () => {
    const fixture = pluginFixture({
      subscriptions: [icsSubscription()],
      icsEvents: [
        icsEvent({
          id: 'work-cal-uid-1',
          start: isoAtLocalOffset(new Date(2026, 7, 10, 9, 0, 0)),
          end: isoAtLocalOffset(new Date(2026, 7, 10, 9, 30, 0)),
        }),
        icsEvent({
          id: 'work-cal-uid-2',
          start: isoAtLocalOffset(new Date(2026, 7, 10, 17, 0, 0)),
          end: isoAtLocalOffset(new Date(2026, 7, 10, 17, 30, 0)),
        }),
      ],
    });
    const { source } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    const batch = await source.collect(CONTEXT);

    expect(batch.items).toHaveLength(2);
    expect(batch.items[0].id).toBe(
      externalItemId('ics:work-cal', '2026-08-10#09:00#i:work-cal-uid-1'),
    );
    expect(batch.items[1].id).toBe(
      externalItemId('ics:work-cal', '2026-08-10#17:00#i:work-cal-uid-2'),
    );
  });

  it('keeps two same-day all-day singles in one feed as distinct rows', async () => {
    const fixture = pluginFixture({
      subscriptions: [icsSubscription()],
      icsEvents: [
        icsEvent({ id: 'work-cal-uid-1', title: 'Holiday', start: '2026-08-10', end: '2026-08-11', allDay: true }),
        icsEvent({ id: 'work-cal-uid-2', title: 'Birthday', start: '2026-08-10', end: '2026-08-11', allDay: true }),
      ],
    });
    const { source } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    const batch = await source.collect(CONTEXT);

    expect(batch.items).toHaveLength(2);
    expect(batch.items.map((item) => item.title).sort((a, b) => a.localeCompare(b))).toEqual([
      'Birthday',
      'Holiday',
    ]);
    expect(batch.items.map((item) => item.id).sort((a, b) => a.localeCompare(b))).toEqual([
      externalItemId('ics:work-cal', '2026-08-10#00:00#i:work-cal-uid-1'),
      externalItemId('ics:work-cal', '2026-08-10#00:00#i:work-cal-uid-2'),
    ]);
  });

  it('keeps an ICS single and a provider single sharing subscriptionId and event id as distinct feed-scoped rows', async () => {
    // An ICS subscription literally named like the provider's prefixed feed id:
    // both surfaces then serve an event with the SAME subscriptionId + id.
    const sharedShape: Partial<IcsEventFixture> = {
      id: 'uid-1',
      subscriptionId: 'google-cal1',
      title: 'Same slot',
      start: '2026-08-10T09:00:00',
      end: '2026-08-10T09:30:00',
    };
    const google = providerFixture({
      providerId: 'google',
      calendars: [{ id: 'cal1', summary: 'Home' }],
      events: [icsEvent(sharedShape)],
    });
    const fixture = pluginFixture({
      subscriptions: [icsSubscription({ id: 'google-cal1' })],
      icsEvents: [icsEvent(sharedShape)],
      providers: [google.provider],
    });
    const { source } = makeSource(
      fixture.plugin,
      new Set([
        externalCalendarFeedKey('ics', 'google-cal1'),
        externalCalendarFeedKey('google', 'cal1'),
      ]),
    );

    const batch = await source.collect(CONTEXT);

    expect(batch.items).toHaveLength(2);
    expect(batch.items.map((item) => item.id).sort((a, b) => a.localeCompare(b))).toEqual([
      externalItemId('google:cal1', '2026-08-10#09:00#i:uid-1'),
      externalItemId('ics:google-cal1', '2026-08-10#09:00#i:uid-1'),
    ]);
  });

  it('keeps two id-less singles with identical title, day and start as distinct rows (deterministic per-feed ordinal)', async () => {
    const idlessTwin = (): IcsEventFixture => ({
      subscriptionId: 'work-cal',
      title: 'Busy',
      start: '2026-08-10',
      end: '2026-08-11',
      allDay: true,
    });
    const fixture = pluginFixture({
      subscriptions: [icsSubscription()],
      icsEvents: [idlessTwin(), idlessTwin()],
    });
    const { source } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    const batch = await source.collect(CONTEXT);

    expect(batch.items).toHaveLength(2);
    expect(batch.items.map((item) => item.id).sort((a, b) => a.localeCompare(b))).toEqual([
      externalItemId('ics:work-cal', '2026-08-10#00:00#t:Busy~0'),
      externalItemId('ics:work-cal', '2026-08-10#00:00#t:Busy~1'),
    ]);
  });

  it('keeps distinct id-less singles at their exact ids when an earlier id-less event is inserted', async () => {
    const idless = (title: string, day: string): IcsEventFixture => ({
      subscriptionId: 'work-cal',
      title,
      start: day,
      allDay: true,
    });
    const fixture = pluginFixture({
      subscriptions: [icsSubscription()],
      icsEvents: [idless('Alpha', '2026-08-11'), idless('Beta', '2026-08-12')],
    });
    const { source } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);
    const before = (await source.collect(CONTEXT)).items.map((item) => item.id);
    expect(before.sort((a, b) => a.localeCompare(b))).toEqual([
      externalItemId('ics:work-cal', '2026-08-11#00:00#t:Alpha~0'),
      externalItemId('ics:work-cal', '2026-08-12#00:00#t:Beta~0'),
    ]);

    fixture.state.icsEvents = [
      idless('Aardvark day', '2026-08-01'),
      idless('Alpha', '2026-08-11'),
      idless('Beta', '2026-08-12'),
    ];
    const after = (await source.collect(CONTEXT)).items.map((item) => item.id);

    expect(after).toEqual(expect.arrayContaining(before));
    expect(after).toHaveLength(3);
  });

  it('keeps an explicit id shaped like a generated twin discriminator distinct from id-less twins', async () => {
    const idlessTwin = (): IcsEventFixture => ({
      subscriptionId: 'work-cal',
      title: 'Busy',
      start: '2026-08-10',
      allDay: true,
    });
    const fixture = pluginFixture({
      subscriptions: [icsSubscription()],
      icsEvents: [icsEvent({ id: 'Busy~0', title: 'Busy', start: '2026-08-10', end: undefined, allDay: true }), idlessTwin(), idlessTwin()],
    });
    const { source } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    const batch = await source.collect(CONTEXT);

    expect(batch.items.map((item) => item.id).sort((a, b) => a.localeCompare(b))).toEqual([
      externalItemId('ics:work-cal', '2026-08-10#00:00#i:Busy~0'),
      externalItemId('ics:work-cal', '2026-08-10#00:00#t:Busy~0'),
      externalItemId('ics:work-cal', '2026-08-10#00:00#t:Busy~1'),
    ]);
  });

  it('keeps id-less events sharing title, day and start but differing in endDay as distinct rows', async () => {
    const idlessSpanning = (end: string): IcsEventFixture => ({
      subscriptionId: 'work-cal',
      title: 'Busy',
      start: '2026-08-10',
      end,
      allDay: true,
    });
    const fixture = pluginFixture({
      subscriptions: [icsSubscription()],
      icsEvents: [idlessSpanning('2026-08-11'), idlessSpanning('2026-08-13')],
    });
    const { source } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    const batch = await source.collect(CONTEXT);

    expect(batch.items).toHaveLength(2);
    expect(batch.items.map((item) => item.id).sort((a, b) => a.localeCompare(b))).toEqual([
      externalItemId('ics:work-cal', '2026-08-10#00:00#t:Busy~0'),
      externalItemId('ics:work-cal', '2026-08-10#00:00#t:Busy~1'),
    ]);
    expect(batch.items.map((item) => item.endDay).sort((a, b) => a.localeCompare(b))).toEqual([
      '2026-08-10',
      '2026-08-12',
    ]);
  });

  it('keeps each different-endDay near-twin at the same id when the service reverses delivery order', async () => {
    const idlessSpanning = (end: string): IcsEventFixture => ({
      subscriptionId: 'work-cal',
      title: 'Busy',
      start: '2026-08-10',
      end,
      allDay: true,
    });
    const shortEvent = idlessSpanning('2026-08-11');
    const longEvent = idlessSpanning('2026-08-13');
    const fixture = pluginFixture({
      subscriptions: [icsSubscription()],
      icsEvents: [shortEvent, longEvent],
    });
    const { source } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);
    const idByEndDay = (items: readonly { id: string; endDay: string }[]) =>
      new Map(items.map((item) => [item.endDay, item.id]));
    const before = idByEndDay((await source.collect(CONTEXT)).items);

    fixture.state.icsEvents = [longEvent, shortEvent];
    const after = idByEndDay((await source.collect(CONTEXT)).items);

    expect(after.size).toBe(2);
    expect(after.get('2026-08-10')).toBe(before.get('2026-08-10'));
    expect(after.get('2026-08-12')).toBe(before.get('2026-08-12'));
  });

  it('keeps an id-less title literally shaped like a twin discriminator distinct from id-less twins', async () => {
    const idless = (title: string): IcsEventFixture => ({
      subscriptionId: 'work-cal',
      title,
      start: '2026-08-10',
      allDay: true,
    });
    const fixture = pluginFixture({
      subscriptions: [icsSubscription()],
      icsEvents: [idless('Busy~0'), idless('Busy'), idless('Busy')],
    });
    const { source } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    const batch = await source.collect(CONTEXT);

    expect(batch.items.map((item) => item.id).sort((a, b) => a.localeCompare(b))).toEqual([
      externalItemId('ics:work-cal', '2026-08-10#00:00#t:Busy~0'),
      externalItemId('ics:work-cal', '2026-08-10#00:00#t:Busy~0~0'),
      externalItemId('ics:work-cal', '2026-08-10#00:00#t:Busy~1'),
    ]);
  });

  it('keeps identical feed-local series ids from two feeds as separate rows', async () => {
    const google = providerFixture({
      providerId: 'google',
      calendars: [{ id: 'cal1', summary: 'Home' }],
      events: [
        icsEvent({
          id: 'google-cal1-shared-0',
          subscriptionId: 'google-cal1',
          recurringEventId: 'shared-series',
          title: 'Google standup',
          start: '2026-08-10T09:00:00',
          end: '2026-08-10T09:30:00',
        }),
      ],
    });
    const microsoft = providerFixture({
      providerId: 'microsoft',
      calendars: [{ id: 'calA', summary: 'Outlook' }],
      events: [
        icsEvent({
          id: 'microsoft-calA-shared-0',
          subscriptionId: 'microsoft-calA',
          recurringEventId: 'shared-series',
          title: 'Outlook standup',
          start: '2026-08-12T09:00:00',
          end: '2026-08-12T09:30:00',
        }),
      ],
    });
    const fixture = pluginFixture({ providers: [google.provider, microsoft.provider] });
    const { source } = makeSource(
      fixture.plugin,
      new Set([
        externalCalendarFeedKey('google', 'cal1'),
        externalCalendarFeedKey('microsoft', 'calA'),
      ]),
    );

    const batch = await source.collect(CONTEXT);

    expect(batch.items).toHaveLength(2);
    const byTitle = new Map(batch.items.map((item) => [item.title, item]));
    const googleRow = byTitle.get('Google standup');
    const outlookRow = byTitle.get('Outlook standup');
    expect(googleRow?.id).toBe(
      externalItemId('google:cal1/shared-series', '2026-08-10#09:00'),
    );
    expect(googleRow?.startDay).toBe('2026-08-10');
    expect(googleRow?.endDay).toBe('2026-08-10');
    expect(outlookRow?.id).toBe(
      externalItemId('microsoft:calA/shared-series', '2026-08-12#09:00'),
    );
    expect(outlookRow?.startDay).toBe('2026-08-12');
    expect(outlookRow?.endDay).toBe('2026-08-12');
  });

  it('collapses a twice-daily series to ONE item keyed on the series with occupancyDays per occupied day', async () => {
    const occurrences = [
      ['google-cal1-master1-0', '2026-08-10T09:00:00', '2026-08-10T09:45:00'],
      ['google-cal1-master1-1', '2026-08-10T17:00:00', '2026-08-10T17:30:00'],
      ['google-cal1-master1-2', '2026-08-11T09:00:00', '2026-08-11T09:45:00'],
      ['google-cal1-master1-3', '2026-08-12T17:00:00', '2026-08-12T17:30:00'],
    ].map(([id, start, end]) =>
      icsEvent({
        id,
        subscriptionId: 'google-cal1',
        recurringEventId: 'google-cal1-master1',
        title: 'Twice daily',
        start,
        end,
      }),
    );
    const google = providerFixture({
      providerId: 'google',
      calendars: [{ id: 'cal1', summary: 'Home' }],
      events: occurrences,
    });
    const fixture = pluginFixture({ providers: [google.provider] });
    const { source } = makeSource(fixture.plugin, new Set([externalCalendarFeedKey('google', 'cal1')]));

    const batch = await source.collect(CONTEXT);

    expect(batch.items).toHaveLength(1);
    const series = batch.items[0];
    expect(series.id).toBe(
      externalItemId('google:cal1/google-cal1-master1', '2026-08-10#09:00'),
    );
    expect(series.title).toBe('Twice daily');
    expect(series.startDay).toBe('2026-08-10');
    expect(series.endDay).toBe('2026-08-12');
    expect(series.occupancyDays).toEqual(['2026-08-10', '2026-08-11', '2026-08-12']);
  });

  it('keeps the series id refresh-stable when upstream re-indexes and appends occurrences', async () => {
    const occurrenceAt = (id: string, day: string) =>
      icsEvent({
        id,
        subscriptionId: 'google-cal1',
        recurringEventId: 'google-cal1-master1',
        start: `${day}T09:00:00`,
        end: `${day}T09:45:00`,
      });
    const google = providerFixture({
      providerId: 'google',
      calendars: [{ id: 'cal1', summary: 'Home' }],
      events: [occurrenceAt('google-cal1-master1-0', '2026-08-10')],
    });
    const fixture = pluginFixture({ providers: [google.provider] });
    const { source } = makeSource(fixture.plugin, new Set([externalCalendarFeedKey('google', 'cal1')]));
    const before = await source.collect(CONTEXT);

    // Upstream refresh: index-suffixed instance ids renumber AND a new day appears.
    google.state.events = [
      occurrenceAt('google-cal1-master1-7', '2026-08-10'),
      occurrenceAt('google-cal1-master1-8', '2026-08-11'),
    ];
    const after = await source.collect(CONTEXT);

    expect(before.items).toHaveLength(1);
    expect(after.items).toHaveLength(1);
    expect(after.items[0].id).toBe(before.items[0].id);
    expect(after.items[0].occupancyDays).toEqual(['2026-08-10', '2026-08-11']);
  });

  it('renders a single-occurrence series as a plain span item without occupancyDays', async () => {
    const fixture = pluginFixture({
      subscriptions: [icsSubscription()],
      icsEvents: [
        icsEvent({
          recurringEventId: 'work-cal-master9',
          start: isoAtLocalOffset(new Date(2026, 7, 20, 9, 0, 0)),
          end: isoAtLocalOffset(new Date(2026, 7, 20, 10, 0, 0)),
        }),
      ],
    });
    const { source } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    const batch = await source.collect(CONTEXT);

    expect(batch.items).toHaveLength(1);
    expect(batch.items[0].id).toBe(
      externalItemId('ics:work-cal/work-cal-master9', '2026-08-20#09:00'),
    );
    expect(batch.items[0].occupancyDays).toBeUndefined();
  });
});

describe('createExternalCalendarSource — subscription and toggle filtering', () => {
  it('excludes events of a disabled subscription even when the service still returns them', async () => {
    const fixture = pluginFixture({
      subscriptions: [
        icsSubscription({ id: 'work-cal', enabled: true }),
        icsSubscription({ id: 'old-cal', name: 'Old calendar', enabled: false }),
      ],
      icsEvents: [
        icsEvent({ title: 'Kept' }),
        icsEvent({ id: 'old-cal-uid-1', subscriptionId: 'old-cal', title: 'Dropped' }),
      ],
    });
    const visible = new Set([
      externalCalendarFeedKey('ics', 'work-cal'),
      externalCalendarFeedKey('ics', 'old-cal'),
    ]);
    const { source } = makeSource(fixture.plugin, visible);

    const batch = await source.collect(CONTEXT);

    expect(batch.items).toHaveLength(1);
    expect(batch.items[0].title).toBe('Kept');
  });

  it('excludes exactly the subscription whose per-view toggle is off', async () => {
    const fixture = pluginFixture({
      subscriptions: [
        icsSubscription({ id: 'work-cal' }),
        icsSubscription({ id: 'home-cal', name: 'Home calendar' }),
      ],
      icsEvents: [
        icsEvent({ title: 'Work event' }),
        icsEvent({ id: 'home-cal-uid-1', subscriptionId: 'home-cal', title: 'Home event' }),
      ],
    });
    const { source } = makeSource(fixture.plugin, new Set([externalCalendarFeedKey('ics', 'home-cal')]));

    const batch = await source.collect(CONTEXT);

    expect(batch.items).toHaveLength(1);
    expect(batch.items[0].title).toBe('Home event');
  });
});

describe('createExternalCalendarSource — refresh signals', () => {
  it('starts at epoch 0 and does not bump on collect alone', async () => {
    const fixture = pluginFixture({ subscriptions: [icsSubscription()], icsEvents: [icsEvent()] });
    const { source } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    expect(source.epoch()).toBe(0);
    await source.collect(CONTEXT);
    expect(source.epoch()).toBe(0);
  });

  it('bumps the epoch when the ICS service emits data-changed', () => {
    const fixture = pluginFixture({ subscriptions: [icsSubscription()] });
    const { source } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    fixture.emitter.emit('data-changed');

    expect(source.epoch()).toBe(1);
  });

  it('bumps on a provider data-changed while nothing is visible only on a catalog change (discovery)', () => {
    let calendars: Array<{ id: string; summary: string }> = [{ id: 'cal1', summary: 'Home' }];
    const google = providerFixture({ providerId: 'google' });
    google.provider.getAvailableCalendars.mockImplementation(() => calendars);
    const fixture = pluginFixture({ providers: [google.provider] });
    const { source } = makeSource(fixture.plugin, new Set());

    // A routine provider sync (data-changed, catalog unchanged) must not refresh
    // an empty/opted-out view…
    google.emitter.emit('data-changed');
    expect(source.epoch()).toBe(0);

    // …but the same emitter signalling a catalog change (a configured feed's
    // calendar reappearing) is a discovery signal that does bump.
    calendars = [
      { id: 'cal1', summary: 'Home' },
      { id: 'cal2', summary: 'Work' },
    ];
    google.emitter.emit('data-changed');
    expect(source.epoch()).toBe(1);
  });

  it('rebinds to a replacement ICS service swapped under a stable plugin handle', () => {
    const first = emitterStub();
    const second = emitterStub();
    const icsServiceWith = (emitter: ReturnType<typeof emitterStub>) => ({
      getSubscriptions: () => [],
      getAllEvents: () => [],
      getLastFetched: () => undefined,
      on: emitter.on,
    });
    const plugin: { icsSubscriptionService: unknown; calendarProviderRegistry: unknown } = {
      icsSubscriptionService: icsServiceWith(first),
      calendarProviderRegistry: { getAllProviders: () => [] },
    };
    const { source, timers } = makeSource(plugin, ALL_WORK_VISIBLE);

    // Bound to the first service.
    first.emit('data-changed');
    expect(source.epoch()).toBe(1);

    // TaskNotes replaces the service object under the same plugin handle.
    plugin.icsSubscriptionService = icsServiceWith(second);
    timers.tick();
    const afterRebind = source.epoch();
    // The swap itself forces one refresh so the new service's data is collected
    // even if it never re-emits (a signal it fired before we bound is lost).
    expect(afterRebind).toBe(2);

    // The replacement's emissions are now observed; the retired one is released.
    second.emit('data-changed');
    expect(source.epoch()).toBe(afterRebind + 1);
    first.emit('data-changed');
    expect(source.epoch()).toBe(afterRebind + 1);
  });

  it('does not re-subscribe to the same ICS service across repeated ticks', () => {
    const emitter = emitterStub();
    const on = jest.fn(emitter.on);
    const plugin = {
      icsSubscriptionService: {
        getSubscriptions: () => [],
        getAllEvents: () => [],
        getLastFetched: () => undefined,
        on,
      },
      calendarProviderRegistry: { getAllProviders: () => [] },
    };
    const { source, timers } = makeSource(plugin, ALL_WORK_VISIBLE);

    timers.tick();
    timers.tick();
    emitter.emit('data-changed');

    // One listener → one bump; a double-subscribe would bump twice.
    expect(source.epoch()).toBe(1);
    expect(on.mock.calls.filter((call) => call[0] === 'data-changed')).toHaveLength(1);
  });

  it('releases the retired ICS binding and refreshes when a replacement has no on()', () => {
    const first = emitterStub();
    const plugin: { icsSubscriptionService: unknown; calendarProviderRegistry: unknown } = {
      icsSubscriptionService: {
        getSubscriptions: () => [],
        getAllEvents: () => [],
        getLastFetched: () => undefined,
        on: first.on,
      },
      calendarProviderRegistry: { getAllProviders: () => [] },
    };
    const { source, timers } = makeSource(plugin, ALL_WORK_VISIBLE);

    first.emit('data-changed');
    expect(source.epoch()).toBe(1);

    // A replacement with no `on`: the retired binding is released, and the swap
    // still forces one refresh (a dead service must not keep emitting).
    plugin.icsSubscriptionService = { getSubscriptions: () => [], getAllEvents: () => [] };
    timers.tick();
    const afterSwap = source.epoch();
    expect(afterSwap).toBeGreaterThan(1);

    first.emit('data-changed');
    expect(source.epoch()).toBe(afterSwap);
  });

  it('retries a replacement whose on() throws at swap time and later recovers', () => {
    const first = emitterStub();
    const recovered = emitterStub();
    let onCalls = 0;
    const recoveringOn = (event: string, listener: () => void): (() => void) => {
      onCalls += 1;
      // The emitter is not ready on the first bind attempt but takes afterward.
      if (onCalls === 1) throw new Error('emitter not ready');
      return recovered.on(event, listener);
    };
    const plugin: { icsSubscriptionService: unknown; calendarProviderRegistry: unknown } = {
      icsSubscriptionService: {
        getSubscriptions: () => [],
        getAllEvents: () => [],
        getLastFetched: () => undefined,
        on: first.on,
      },
      calendarProviderRegistry: { getAllProviders: () => [] },
    };
    const { source, timers } = makeSource(plugin, ALL_WORK_VISIBLE);

    first.emit('data-changed');
    expect(source.epoch()).toBe(1);

    // Swap to a service whose on() throws once. The swap forces one refresh…
    plugin.icsSubscriptionService = {
      getSubscriptions: () => [],
      getAllEvents: () => [],
      getLastFetched: () => undefined,
      on: recoveringOn,
    };
    timers.tick();
    const afterSwap = source.epoch();
    expect(afterSwap).toBe(2);

    // …the next tick retries the pending subscription (no second refresh)…
    timers.tick();
    expect(source.epoch()).toBe(afterSwap);

    // …and now the recovered emitter's data-changed is finally observed.
    recovered.emit('data-changed');
    expect(source.epoch()).toBe(afterSwap + 1);
  });

  it('does not bump the epoch on a timer tick when the cached facts are unchanged', () => {
    const google = providerFixture({
      providerId: 'google',
      calendars: [{ id: 'cal1', summary: 'Home' }],
      events: [icsEvent({ id: 'google-cal1-e1', subscriptionId: 'google-cal1' })],
    });
    const fixture = pluginFixture({ subscriptions: [icsSubscription()], providers: [google.provider] });
    const { source, timers } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    expect(timers.tick()).toBe(true);

    expect(source.epoch()).toBe(0);
  });

  it('bumps the epoch on a timer tick when provider cached events changed', () => {
    const google = providerFixture({
      providerId: 'google',
      calendars: [{ id: 'cal1', summary: 'Home' }],
      events: [icsEvent({ id: 'google-cal1-e1', subscriptionId: 'google-cal1' })],
    });
    const fixture = pluginFixture({ providers: [google.provider] });
    const { source, timers } = makeSource(
      fixture.plugin,
      new Set([externalCalendarFeedKey('google', 'cal1')]),
    );

    google.state.events = [
      icsEvent({ id: 'google-cal1-e1', subscriptionId: 'google-cal1', start: '2026-08-11T10:00:00' }),
    ];
    timers.tick();

    expect(source.epoch()).toBe(1);
  });

  it('bumps the epoch on a timer tick when a provider event cache recovers from a throw', () => {
    const google = providerFixture({ providerId: 'google', calendars: [{ id: 'cal1', summary: 'Home' }] });
    let throwing = true;
    google.provider.getAllEvents.mockImplementation(() => {
      if (throwing) throw new Error('cache cold');
      return [];
    });
    const fixture = pluginFixture({ providers: [google.provider] });
    const { source, timers } = makeSource(
      fixture.plugin,
      new Set([externalCalendarFeedKey('google', 'cal1')]),
    );

    // Recover: the event cache stops throwing but returns the same empty set and
    // the catalog is unchanged — the degraded-flag flip is the only fetch-free
    // signal, so without folding it into the fingerprint the epoch would stall.
    throwing = false;
    timers.tick();

    expect(source.epoch()).toBe(1);
  });

  it('bumps the epoch on a timer tick when only provider event ids changed (a cache reindex)', () => {
    const google = providerFixture({
      providerId: 'google',
      calendars: [{ id: 'cal1', summary: 'Home' }],
      events: [icsEvent({ id: 'google-cal1-e1', subscriptionId: 'google-cal1' })],
    });
    const fixture = pluginFixture({ providers: [google.provider] });
    const { source, timers } = makeSource(
      fixture.plugin,
      new Set([externalCalendarFeedKey('google', 'cal1')]),
    );

    // Same event content, new upstream id: rendered ids derive from the id,
    // so a silent reindex must still count as a change.
    google.state.events = [icsEvent({ id: 'google-cal1-e9', subscriptionId: 'google-cal1' })];
    timers.tick();

    expect(source.epoch()).toBe(1);
  });

  it('does not bump the epoch when only recurring occurrence ids reindex (series identity is unchanged)', () => {
    const occurrence = (id: string) =>
      icsEvent({ id, subscriptionId: 'google-cal1', recurringEventId: 'google-cal1-master1' });
    const google = providerFixture({
      providerId: 'google',
      calendars: [{ id: 'cal1', summary: 'Home' }],
      events: [occurrence('google-cal1-master1-0')],
    });
    const fixture = pluginFixture({ providers: [google.provider] });
    const { source, timers } = makeSource(
      fixture.plugin,
      new Set([externalCalendarFeedKey('google', 'cal1')]),
    );

    google.state.events = [occurrence('google-cal1-master1-7')];
    timers.tick();

    expect(source.epoch()).toBe(0);
  });

  it('does not bump on a provider event sync when only an ICS feed is visible', () => {
    const google = providerFixture({
      providerId: 'google',
      calendars: [{ id: 'cal1', summary: 'Home' }],
      events: [icsEvent({ id: 'google-cal1-e1', subscriptionId: 'google-cal1' })],
    });
    const fixture = pluginFixture({ subscriptions: [icsSubscription()], providers: [google.provider] });
    // Only the ICS feed is visible; the provider is connected but not selected.
    const { source, timers } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    // A provider event syncs — irrelevant to an ICS-only view, so no epoch bump
    // (which would otherwise refresh a view that opted out of that feed).
    google.state.events = [
      icsEvent({ id: 'google-cal1-e1', subscriptionId: 'google-cal1', start: '2026-08-11T10:00:00' }),
    ];
    timers.tick();

    expect(source.epoch()).toBe(0);
  });

  it('does not bump when an invisible provider gains a sync token in an ICS-only view', () => {
    let syncToken: string | undefined;
    const google = providerFixture({
      providerId: 'google',
      calendars: [{ id: 'cal1', summary: 'Home' }],
    });
    google.provider.getSyncToken.mockImplementation(() => syncToken);
    const fixture = pluginFixture({ subscriptions: [icsSubscription()], providers: [google.provider] });
    const { source, timers } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    // The invisible provider completes (gains a sync token) — completion evidence
    // for a feed this ICS-only view never shows, so it must not bump.
    syncToken = 'completed-token';
    timers.tick();

    expect(source.epoch()).toBe(0);
  });

  it('does not bump on an ICS service replacement in a provider-only view', () => {
    const google = providerFixture({ providerId: 'google', calendars: [{ id: 'cal1', summary: 'Home' }] });
    const first = emitterStub();
    const plugin: { icsSubscriptionService: unknown; calendarProviderRegistry: unknown } = {
      icsSubscriptionService: {
        getSubscriptions: () => [],
        getAllEvents: () => [],
        getLastFetched: () => undefined,
        on: first.on,
      },
      calendarProviderRegistry: { getAllProviders: () => [google.provider] },
    };
    const { source, timers } = makeSource(
      plugin,
      new Set([externalCalendarFeedKey('google', 'cal1')]),
    );

    // TaskNotes swaps the ICS service — irrelevant to a provider-only view, so
    // the lifecycle rebind must not refresh it.
    plugin.icsSubscriptionService = {
      getSubscriptions: () => [],
      getAllEvents: () => [],
      on: () => () => {},
    };
    timers.tick();

    expect(source.epoch()).toBe(0);
  });

  it('does not bump on a Microsoft event sync when only a Google feed is visible', () => {
    const google = providerFixture({
      providerId: 'google',
      calendars: [{ id: 'gcal', summary: 'Google' }],
      events: [icsEvent({ id: 'google-gcal-e1', subscriptionId: 'google-gcal' })],
    });
    const microsoft = providerFixture({
      providerId: 'microsoft',
      calendars: [{ id: 'mcal', summary: 'Outlook' }],
      events: [icsEvent({ id: 'microsoft-mcal-e1', subscriptionId: 'microsoft-mcal' })],
    });
    const fixture = pluginFixture({ providers: [google.provider, microsoft.provider] });
    const { source, timers } = makeSource(
      fixture.plugin,
      new Set([externalCalendarFeedKey('google', 'gcal')]),
    );

    // Microsoft (invisible) syncs its events — a different provider KIND than the
    // visible Google feed, so it must not refresh the Google-only view.
    microsoft.state.events = [
      icsEvent({ id: 'microsoft-mcal-e1', subscriptionId: 'microsoft-mcal', start: '2026-08-11T10:00:00' }),
    ];
    timers.tick();

    expect(source.epoch()).toBe(0);
  });

  it('does not bump on a Microsoft data-changed emission when only a Google feed is visible', () => {
    const google = providerFixture({ providerId: 'google', calendars: [{ id: 'gcal', summary: 'Google' }] });
    const microsoft = providerFixture({ providerId: 'microsoft', calendars: [{ id: 'mcal', summary: 'Outlook' }] });
    const fixture = pluginFixture({ providers: [google.provider, microsoft.provider] });
    const { source } = makeSource(
      fixture.plugin,
      new Set([externalCalendarFeedKey('google', 'gcal')]),
    );

    // The invisible Microsoft provider's emitter fires — its callback is scoped
    // to the Microsoft kind, which is not visible, so no bump.
    microsoft.emitter.emit('data-changed');

    expect(source.epoch()).toBe(0);
  });

  it('still bumps on a provider catalog change while nothing is visible (discovery)', () => {
    let calendars: Array<{ id: string; summary: string }> = [];
    const google = providerFixture({ providerId: 'google' });
    google.provider.getAvailableCalendars.mockImplementation(() => calendars);
    const fixture = pluginFixture({ providers: [google.provider] });
    const { source, timers } = makeSource(fixture.plugin, new Set());

    // A previously-selected calendar reappears in the catalog — a discovery
    // signal that must still bump while nothing is visible so the feed can show.
    calendars = [{ id: 'cal1', summary: 'Home' }];
    timers.tick();

    expect(source.epoch()).toBe(1);
  });

  it('does not bump on a provider event-only change while nothing is visible', () => {
    const google = providerFixture({
      providerId: 'google',
      calendars: [{ id: 'cal1', summary: 'Home' }],
      events: [icsEvent({ id: 'google-cal1-e1', subscriptionId: 'google-cal1' })],
    });
    const fixture = pluginFixture({ providers: [google.provider] });
    const { source, timers } = makeSource(fixture.plugin, new Set());

    // Catalog unchanged; only event CONTENT changes. While nothing is visible the
    // fingerprint folds the catalog only (discovery), so event syncs don't bump.
    google.state.events = [
      icsEvent({ id: 'google-cal1-e1', subscriptionId: 'google-cal1', start: '2026-08-11T10:00:00' }),
    ];
    timers.tick();

    expect(source.epoch()).toBe(0);
  });

  it('bumps the epoch on a timer tick when an ICS subscription flips enabled', () => {
    const fixture = pluginFixture({ subscriptions: [icsSubscription({ enabled: true })] });
    const { source, timers } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    fixture.state.subscriptions = [icsSubscription({ enabled: false })];
    timers.tick();

    expect(source.epoch()).toBe(1);
  });

  it('fires onEpochBump when the ICS service emits data-changed', () => {
    const fixture = pluginFixture({ subscriptions: [icsSubscription()] });
    const onEpochBump = jest.fn();
    const { source } = makeSource(fixture.plugin, ALL_WORK_VISIBLE, { onEpochBump });

    fixture.emitter.emit('data-changed');

    expect(onEpochBump).toHaveBeenCalledTimes(1);
    expect(source.epoch()).toBe(1);
  });

  it('does not bump on a provider data-changed emission when only an ICS feed is visible', () => {
    const google = providerFixture({ providerId: 'google', calendars: [{ id: 'cal1', summary: 'Home' }] });
    const fixture = pluginFixture({ subscriptions: [icsSubscription()], providers: [google.provider] });
    const onEpochBump = jest.fn();
    const { source } = makeSource(fixture.plugin, ALL_WORK_VISIBLE, { onEpochBump });

    // A connected-but-unselected provider fires data-changed; the view is
    // ICS-only, so the primary emitter signal must not refresh it either.
    google.emitter.emit('data-changed');

    expect(source.epoch()).toBe(0);
    expect(onEpochBump).not.toHaveBeenCalled();
  });

  it('bumps on a provider data-changed emission when its provider feed is visible', () => {
    const google = providerFixture({ providerId: 'google', calendars: [{ id: 'cal1', summary: 'Home' }] });
    const fixture = pluginFixture({ providers: [google.provider] });
    const onEpochBump = jest.fn();
    const { source } = makeSource(
      fixture.plugin,
      new Set([externalCalendarFeedKey('google', 'cal1')]),
      { onEpochBump },
    );

    google.emitter.emit('data-changed');

    expect(source.epoch()).toBe(1);
    expect(onEpochBump).toHaveBeenCalledTimes(1);
  });

  it('fires onEpochBump when a fallback tick observes changed cached facts', () => {
    const fixture = pluginFixture({ subscriptions: [icsSubscription({ enabled: true })] });
    const onEpochBump = jest.fn();
    const { timers } = makeSource(fixture.plugin, ALL_WORK_VISIBLE, { onEpochBump });

    fixture.state.subscriptions = [icsSubscription({ enabled: false })];
    timers.tick();

    expect(onEpochBump).toHaveBeenCalledTimes(1);
  });

  it('does not fire onEpochBump on a quiet fallback tick', () => {
    const fixture = pluginFixture({ subscriptions: [icsSubscription()] });
    const onEpochBump = jest.fn();
    const { timers } = makeSource(fixture.plugin, ALL_WORK_VISIBLE, { onEpochBump });

    timers.tick();

    expect(onEpochBump).not.toHaveBeenCalled();
  });

  it('never calls the fetch-triggering ICS getAllEvents from the timer tick', () => {
    // ICSSubscriptionService.getAllEvents kicks off network fetches for cold or
    // expired caches — polling through it would turn the fallback timer into a
    // fetch loop. Collect may read it; the tick must not.
    const fixture = pluginFixture({ subscriptions: [icsSubscription()], icsEvents: [icsEvent()] });
    const { timers } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);
    fixture.icsSubscriptionService.getLastFetched.mockClear();

    timers.tick();
    timers.tick();

    expect(fixture.icsSubscriptionService.getAllEvents).not.toHaveBeenCalled();
    expect(fixture.icsSubscriptionService.getLastFetched).toHaveBeenCalledTimes(2);
  });

  it('reschedules itself so the fallback keeps ticking', () => {
    const fixture = pluginFixture({ subscriptions: [icsSubscription()] });
    const { timers } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    expect(timers.pendingCount()).toBe(1);
    timers.tick();
    expect(timers.pendingCount()).toBe(1);
  });

  it('dispose releases the emitter subscriptions and stops the timer', () => {
    const google = providerFixture({ providerId: 'google', calendars: [] });
    const fixture = pluginFixture({ subscriptions: [icsSubscription()], providers: [google.provider] });
    const { source, timers } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    source.dispose();

    expect(fixture.emitter.unsubscribeCalls).toContain('data-changed');
    expect(google.emitter.unsubscribeCalls).toContain('data-changed');
    expect(timers.pendingCount()).toBe(0);
    fixture.emitter.emit('data-changed');
    expect(source.epoch()).toBe(0);
  });

  it('releases the provider listeners even when the ICS unsubscribe throws', () => {
    const google = providerFixture({ providerId: 'google', calendars: [] });
    const fixture = pluginFixture({ subscriptions: [icsSubscription()], providers: [google.provider] });
    fixture.icsSubscriptionService.on = () => () => {
      throw new Error('unsubscribe exploded');
    };
    const { source, timers } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    source.dispose();

    expect(google.emitter.unsubscribeCalls).toContain('data-changed');
    expect(timers.pendingCount()).toBe(0);
  });

  it('a data-changed reaching a leaked listener after dispose does not bump', () => {
    const fixture = pluginFixture({ subscriptions: [icsSubscription()] });
    const realOn = fixture.emitter.on;
    // A service whose unsubscribe silently fails to detach: the source's own
    // disposed guard, not the emitter, must keep it quiet.
    fixture.icsSubscriptionService.on = (event: string, listener: () => void) => {
      realOn(event, listener);
      return () => {};
    };
    const onEpochBump = jest.fn();
    const { source } = makeSource(fixture.plugin, ALL_WORK_VISIBLE, { onEpochBump });

    source.dispose();
    fixture.emitter.emit('data-changed');

    expect(source.epoch()).toBe(0);
    expect(onEpochBump).not.toHaveBeenCalled();
  });
});

describe('createExternalCalendarSource — cold cache', () => {
  it('flags loading (not degraded) when services are present but caches are still empty', async () => {
    const google = providerFixture({ providerId: 'google', calendars: [{ id: 'cal1', summary: 'Home' }] });
    const fixture = pluginFixture({ subscriptions: [icsSubscription()], providers: [google.provider] });
    const { source } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    const batch = await source.collect(CONTEXT);

    expect(batch.items).toEqual([]);
    expect(batch.loading).toBe(true);
    expect(batch.degraded).toBeFalsy();
  });

  it('clears the loading flag once cached events exist', async () => {
    const fixture = pluginFixture({ subscriptions: [icsSubscription()], icsEvents: [icsEvent()] });
    const { source } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    const batch = await source.collect(CONTEXT);

    expect(batch.items).toHaveLength(1);
    expect(batch.loading).toBeFalsy();
  });

  it('keeps loading while a visible sibling feed has no event or completion evidence', async () => {
    const fixture = pluginFixture({
      subscriptions: [
        icsSubscription(),
        icsSubscription({ id: 'home-cal', name: 'Home calendar' }),
      ],
      icsEvents: [icsEvent()],
    });
    const visible = new Set([
      externalCalendarFeedKey('ics', 'work-cal'),
      externalCalendarFeedKey('ics', 'home-cal'),
    ]);
    const { source } = makeSource(fixture.plugin, visible);

    const batch = await source.collect(CONTEXT);

    expect(batch.items).toHaveLength(1);
    expect(batch.loading).toBe(true);
  });

  it('does not flag loading when a visible ICS feed has a warm empty cache', async () => {
    const fixture = pluginFixture({
      subscriptions: [icsSubscription()],
      icsEvents: [],
      lastFetchedById: { 'work-cal': '2026-08-04T10:00:00.000Z' },
    });
    const { source } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    const batch = await source.collect(CONTEXT);

    expect(batch.items).toEqual([]);
    expect(batch.loading).toBeFalsy();
    expect(fixture.icsSubscriptionService.getLastFetched).toHaveBeenCalledWith('work-cal');
  });

  it('re-shows loading for a cold ICS service that replaces a warm one', async () => {
    const fixture = pluginFixture({
      subscriptions: [icsSubscription()],
      icsEvents: [],
      lastFetchedById: { 'work-cal': '2026-08-04T10:00:00.000Z' },
    });
    const { source, timers } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);

    // The warm service records the feed as completed — no loading.
    const warm = await source.collect(CONTEXT);
    expect(warm.loading).toBeFalsy();

    // TaskNotes swaps in a cold service (same feed still configured, but never
    // fetched). The swap must forget the retired service's completion evidence.
    const coldEmitter = emitterStub();
    fixture.plugin.icsSubscriptionService = {
      getSubscriptions: () => [icsSubscription()],
      getAllEvents: () => [],
      getLastFetched: () => undefined,
      on: coldEmitter.on,
    };
    timers.tick();

    const cold = await source.collect(CONTEXT);
    expect(cold.loading).toBe(true);
  });

  it.each(['google', 'microsoft'] as const)(
    'does not flag loading when a visible %s feed has a warm empty cache',
    async (providerId) => {
      const provider = providerFixture({
        providerId,
        calendars: [{ id: 'cal1', summary: 'Home' }],
        events: [],
        syncTokensByCalendarId: { cal1: 'completed-sync-token' },
      });
      const fixture = pluginFixture({ providers: [provider.provider] });
      const visible = new Set([externalCalendarFeedKey(providerId, 'cal1')]);
      const { source } = makeSource(fixture.plugin, visible);

      const batch = await source.collect(CONTEXT);

      expect(batch.items).toEqual([]);
      expect(batch.loading).toBeFalsy();
      expect(provider.provider.getSyncToken).toHaveBeenCalledWith('cal1');
    },
  );

  it('reads neither event surface on collect when no feeds are visible', async () => {
    const google = providerFixture({ providerId: 'google', calendars: [{ id: 'cal1', summary: 'Home' }] });
    const fixture = pluginFixture({
      subscriptions: [icsSubscription()],
      icsEvents: [icsEvent()],
      providers: [google.provider],
    });
    const { source } = makeSource(fixture.plugin, new Set());
    // Construction reads the fetch-free provider cache for the fingerprint;
    // only reads made BY collect are under test.
    google.provider.getAllEvents.mockClear();

    const batch = await source.collect(CONTEXT);

    expect(batch.items).toEqual([]);
    expect(batch.degraded).toBeFalsy();
    expect(batch.loading).toBeFalsy();
    expect(fixture.icsSubscriptionService.getAllEvents).not.toHaveBeenCalled();
    expect(google.provider.getAllEvents).not.toHaveBeenCalled();
  });

  it('does not flag loading when no feeds are configured at all (a true empty)', async () => {
    const fixture = pluginFixture({ subscriptions: [], icsEvents: [] });
    const { source } = makeSource(fixture.plugin, new Set());

    const batch = await source.collect(CONTEXT);

    expect(batch.items).toEqual([]);
    expect(batch.loading).toBeFalsy();
    expect(batch.degraded).toBeFalsy();
  });

  it('clears loading on the first data-changed even when zero events came back', async () => {
    // An empty-but-healthy calendar: the fetch completed and reported nothing.
    const fixture = pluginFixture({ subscriptions: [icsSubscription()], icsEvents: [] });
    const { source } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);
    expect((await source.collect(CONTEXT)).loading).toBe(true);

    fixture.state.lastFetchedById['work-cal'] = '2026-08-04T10:00:00.000Z';
    fixture.emitter.emit('data-changed');
    const batch = await source.collect(CONTEXT);

    expect(batch.items).toEqual([]);
    expect(batch.loading).toBeFalsy();
  });

  it('a global data-changed emission completes only feeds with per-feed evidence', async () => {
    const fixture = pluginFixture({
      subscriptions: [
        icsSubscription(),
        icsSubscription({ id: 'home-cal', name: 'Home calendar' }),
      ],
      icsEvents: [],
    });
    const visible = new Set([
      externalCalendarFeedKey('ics', 'work-cal'),
      externalCalendarFeedKey('ics', 'home-cal'),
    ]);
    const { source } = makeSource(fixture.plugin, visible);
    expect((await source.collect(CONTEXT)).loading).toBe(true);

    fixture.state.lastFetchedById['work-cal'] = '2026-08-04T10:00:00.000Z';
    fixture.emitter.emit('data-changed');

    expect((await source.collect(CONTEXT)).loading).toBe(true);
    fixture.state.lastFetchedById['home-cal'] = '2026-08-04T10:01:00.000Z';
    fixture.emitter.emit('data-changed');
    expect((await source.collect(CONTEXT)).loading).toBeFalsy();
  });

  it('a changed-fingerprint fallback tick counts as the completion signal', async () => {
    const fixture = pluginFixture({ subscriptions: [icsSubscription()], icsEvents: [] });
    const { source, timers } = makeSource(fixture.plugin, ALL_WORK_VISIBLE);
    expect((await source.collect(CONTEXT)).loading).toBe(true);

    fixture.state.subscriptions = [icsSubscription({ name: 'Renamed work calendar' })];
    fixture.state.lastFetchedById['work-cal'] = '2026-08-04T10:00:00.000Z';
    timers.tick();

    expect((await source.collect(CONTEXT)).loading).toBeFalsy();
  });

  it('does not flag loading when the only configured feeds are invisible in this view', async () => {
    const fixture = pluginFixture({ subscriptions: [icsSubscription()], icsEvents: [] });
    const { source } = makeSource(fixture.plugin, new Set());

    const batch = await source.collect(CONTEXT);

    expect(batch.loading).toBeFalsy();
    expect(batch.degraded).toBeFalsy();
  });

  it('a visible-feed-set change re-arms loading once until the next completion signal', async () => {
    const fixture = pluginFixture({
      subscriptions: [icsSubscription(), icsSubscription({ id: 'home-cal', name: 'Home' })],
      icsEvents: [],
    });
    let visible: ReadonlySet<string> = new Set([externalCalendarFeedKey('ics', 'work-cal')]);
    const { source } = makeSource(fixture.plugin, new Set(), { visibleFeeds: () => visible });

    expect((await source.collect(CONTEXT)).loading).toBe(true);
    fixture.state.lastFetchedById['work-cal'] = '2026-08-04T10:00:00.000Z';
    fixture.emitter.emit('data-changed');
    expect((await source.collect(CONTEXT)).loading).toBeFalsy();

    visible = new Set([...visible, externalCalendarFeedKey('ics', 'home-cal')]);
    expect((await source.collect(CONTEXT)).loading).toBe(true);
    // Still armed on a repeat collect — the change re-arms once, not per collect.
    expect((await source.collect(CONTEXT)).loading).toBe(true);

    fixture.state.lastFetchedById['home-cal'] = '2026-08-04T10:01:00.000Z';
    fixture.emitter.emit('data-changed');
    expect((await source.collect(CONTEXT)).loading).toBeFalsy();
  });
});

describe('guarded feed listing for the options layer', () => {
  it('lists ICS subscriptions with their id, name, color and enabled state', () => {
    const fixture = pluginFixture({
      subscriptions: [
        icsSubscription(),
        icsSubscription({ id: 'home-cal', name: 'Home calendar', color: '#0000FF', enabled: false }),
      ],
    });

    const listed = readExternalIcsSubscriptions(fixture.plugin);

    expect(listed).toEqual([
      { id: 'work-cal', name: 'Work calendar', color: '#FF0000', enabled: true },
      { id: 'home-cal', name: 'Home calendar', color: '#0000FF', enabled: false },
    ]);
  });

  it('lists provider calendars keyed by provider kind and calendar id', () => {
    const google = providerFixture({
      providerId: 'google',
      calendars: [{ id: 'cal1', summary: 'Home', backgroundColor: '#4285F4' }],
    });
    const microsoft = providerFixture({
      providerId: 'microsoft',
      calendars: [{ id: 'calA', summary: 'Outlook' }],
    });
    const fixture = pluginFixture({ providers: [google.provider, microsoft.provider] });

    const listed = readExternalProviderCalendars(fixture.plugin);

    expect(listed).toEqual([
      { provider: 'google', id: 'cal1', name: 'Home' },
      { provider: 'microsoft', id: 'calA', name: 'Outlook' },
    ]);
  });

  it('returns empty lists instead of throwing when the services are absent', () => {
    expect(readExternalIcsSubscriptions(undefined)).toEqual([]);
    expect(readExternalProviderCalendars({})).toEqual([]);
  });
});
