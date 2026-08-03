/**
 * External-calendar calendar-item source: events from TaskNotes' ICS
 * subscriptions and its Google/Microsoft calendar providers render as flat
 * read-only event rows. All service access happens inside this module against
 * an injected opaque plugin handle, structurally guarded — a missing or
 * malformed surface degrades that surface to empty (flagged `degraded`),
 * never a throw.
 *
 * Refresh is event-driven: the primary signal is each service's
 * `data-changed` emitter; a timer tick is only a fallback and re-reads
 * exclusively fetch-free surfaces (subscription configs and the providers'
 * pure event caches). `ICSSubscriptionService.getAllEvents` starts network
 * fetches for cold/expired caches, so the tick NEVER touches it — only
 * `collect` (an on-demand derivation, same as TaskNotes' own views) may.
 *
 * A recurring series (occurrences sharing `recurringEventId`) collapses to
 * ONE row spanning its first..last occurrence day, carrying `occupancyDays`
 * so the renderer pieces the occupied days; upstream per-instance ids are
 * index-suffixed and shift as the sync window slides, so ids key on
 * series + first day + start time instead.
 *
 * @module datasource/calendarItems/externalCalendarSource
 */

import type { TimerScheduler } from '../../bases/scheduler';
import type { CalendarItem, CalendarItemSource, LocalDay } from './types';
import { makeCalendarItemId } from './types';
import {
  isLocalDayString,
  localDayOfWallClock,
  shiftLocalDay,
  type LocalDaySpan,
} from './normalizers';

/** The external feed families TaskNotes can serve. */
export type ExternalCalendarProviderKind = 'ics' | 'google' | 'microsoft';

/** An ICS subscription as listed for options building (guarded read). */
export interface ExternalIcsSubscription {
  id: string;
  name: string;
  color?: string;
  enabled: boolean;
}

/** A provider calendar as listed for options building (guarded read). */
export interface ExternalProviderCalendar {
  provider: Exclude<ExternalCalendarProviderKind, 'ics'>;
  id: string;
  name: string;
}

/** Dependencies of the external-calendar source, injected by the wiring. */
export interface ExternalCalendarSourceDeps {
  /** Opaque TaskNotes plugin handle; every access is structurally guarded here. */
  getTaskNotesPlugin(): unknown;
  /** Per-view visible feed keys ({@link externalCalendarFeedKey}), read fresh per collect. */
  visibleFeeds(): ReadonlySet<string>;
  /** Timer surface for the fetch-free fallback poll. */
  scheduler: TimerScheduler;
  /** Fallback poll interval; defaults to {@link DEFAULT_EXTERNAL_CALENDAR_POLL_MS}. */
  pollIntervalMs?: number;
}

/** The external-calendar source; `dispose` releases emitters and the timer. */
export interface ExternalCalendarSource extends CalendarItemSource {
  dispose(): void;
}

export const DEFAULT_EXTERNAL_CALENDAR_POLL_MS = 60_000;

const DATA_CHANGED_EVENT = 'data-changed';

/** Canonical visibility key for one external feed (`kind:id`). */
export function externalCalendarFeedKey(kind: ExternalCalendarProviderKind, id: string): string {
  return `${kind}:${id}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function methodOf(
  owner: Record<string, unknown> | undefined,
  name: string,
): ((...args: unknown[]) => unknown) | undefined {
  const candidate = owner?.[name];
  return typeof candidate === 'function'
    ? (candidate as (...args: unknown[]) => unknown).bind(owner)
    : undefined;
}

/** The ICSEvent slice this source consumes (TaskNotes service shape). */
interface ExternalEvent {
  subscriptionId: string;
  title: string;
  start: string;
  end?: string;
  allDay: boolean;
  recurringEventId?: string;
  color?: string;
}

function toExternalEvent(raw: unknown): ExternalEvent | null {
  const record = asRecord(raw);
  if (!record) return null;
  const { subscriptionId, start } = record;
  if (typeof subscriptionId !== 'string' || subscriptionId === '') return null;
  if (typeof start !== 'string' || start.trim() === '') return null;
  const recurringEventId = record.recurringEventId;
  return {
    subscriptionId,
    start,
    title: typeof record.title === 'string' ? record.title : '',
    end: typeof record.end === 'string' ? record.end : undefined,
    allDay: record.allDay === true,
    recurringEventId:
      typeof recurringEventId === 'string' && recurringEventId !== '' ? recurringEventId : undefined,
    color: typeof record.color === 'string' ? record.color : undefined,
  };
}

function toIcsSubscriptions(raw: unknown): ExternalIcsSubscription[] {
  const subscriptions: ExternalIcsSubscription[] = [];
  for (const entry of asArray(raw)) {
    const record = asRecord(entry);
    if (!record || typeof record.id !== 'string' || record.id === '') continue;
    subscriptions.push({
      id: record.id,
      name: typeof record.name === 'string' ? record.name : '',
      color: typeof record.color === 'string' ? record.color : undefined,
      enabled: record.enabled !== false,
    });
  }
  return subscriptions;
}

interface GuardedProvider {
  kind: Exclude<ExternalCalendarProviderKind, 'ics'>;
  events: ExternalEvent[];
  calendars: ExternalProviderCalendar[];
}

function providerKindOf(value: unknown): GuardedProvider['kind'] | undefined {
  return value === 'google' || value === 'microsoft' ? value : undefined;
}

function toProviderCalendars(
  kind: GuardedProvider['kind'],
  raw: unknown,
): ExternalProviderCalendar[] {
  const calendars: ExternalProviderCalendar[] = [];
  for (const entry of asArray(raw)) {
    const record = asRecord(entry);
    if (!record || typeof record.id !== 'string' || record.id === '') continue;
    calendars.push({
      provider: kind,
      id: record.id,
      name: typeof record.summary === 'string' ? record.summary : '',
    });
  }
  return calendars;
}

function guardedProviders(raw: unknown): GuardedProvider[] {
  const providers: GuardedProvider[] = [];
  for (const entry of asArray(raw)) {
    const provider = asRecord(entry);
    const kind = providerKindOf(provider?.providerId);
    const getAllEvents = methodOf(provider, 'getAllEvents');
    if (!kind || !getAllEvents) continue;
    const events: ExternalEvent[] = [];
    for (const rawEvent of asArray(getAllEvents())) {
      const event = toExternalEvent(rawEvent);
      if (event) events.push(event);
    }
    const getAvailableCalendars = methodOf(provider, 'getAvailableCalendars');
    providers.push({ kind, events, calendars: toProviderCalendars(kind, getAvailableCalendars?.()) });
  }
  return providers;
}

/** Current ICS subscriptions via the guarded service surface; absence → empty. */
export function readExternalIcsSubscriptions(plugin: unknown): readonly ExternalIcsSubscription[] {
  const getSubscriptions = methodOf(asRecord(asRecord(plugin)?.icsSubscriptionService), 'getSubscriptions');
  if (!getSubscriptions) return [];
  try {
    return toIcsSubscriptions(getSubscriptions());
  } catch {
    return [];
  }
}

/** Current provider calendars via the guarded registry surface; absence → empty. */
export function readExternalProviderCalendars(plugin: unknown): readonly ExternalProviderCalendar[] {
  const getAllProviders = methodOf(asRecord(asRecord(plugin)?.calendarProviderRegistry), 'getAllProviders');
  if (!getAllProviders) return [];
  try {
    return guardedProviders(getAllProviders()).flatMap((provider) => provider.calendars);
  } catch {
    return [];
  }
}

// --- dialect normalization ------------------------------------------------

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function orderedSpan(a: LocalDay, b: LocalDay): LocalDaySpan {
  return a <= b ? { startDay: a, endDay: b } : { startDay: b, endDay: a };
}

function isAllDayShaped(event: ExternalEvent): boolean {
  return event.allDay || isLocalDayString(event.start);
}

function allDaySpan(event: ExternalEvent): LocalDaySpan | null {
  const startDay = localDayOfWallClock(event.start);
  if (startDay === null) return null;
  let endDay = event.end === undefined ? startDay : (localDayOfWallClock(event.end) ?? startDay);
  // iCalendar DTEND for VALUE=DATE is exclusive and TaskNotes passes it
  // verbatim, so the last occupied day is the day before.
  if (isLocalDayString(event.end) && endDay > startDay) endDay = shiftLocalDay(endDay, -1);
  return orderedSpan(startDay, endDay);
}

function timedSpan(event: ExternalEvent): LocalDaySpan | null {
  // localDayOfWallClock covers both timed dialects: offset-stamped ICS values
  // convert as instants, offset-less Google/Microsoft values stay floating.
  const startDay = localDayOfWallClock(event.start);
  const endDay = event.end === undefined ? startDay : localDayOfWallClock(event.end);
  if (startDay === null || endDay === null) return null;
  return orderedSpan(startDay, endDay);
}

function normalizedSpan(event: ExternalEvent): LocalDaySpan | null {
  return isAllDayShaped(event) ? allDaySpan(event) : timedSpan(event);
}

function localStartTime(event: ExternalEvent): string {
  if (isAllDayShaped(event)) return '00:00';
  // Date parses offset-stamped values as instants (converted to local) and
  // offset-less values as local wall time — both yield the observer's clock.
  const parsed = new Date(event.start);
  if (Number.isNaN(parsed.getTime())) return '00:00';
  return `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

// --- expansion ------------------------------------------------------------

interface FeedEvent {
  feedKey: string;
  event: ExternalEvent;
}

interface SurfaceRead {
  feedEvents: FeedEvent[];
  configuredFeedCount: number;
}

function readIcsSurface(plugin: unknown): SurfaceRead | null {
  const service = asRecord(asRecord(plugin)?.icsSubscriptionService);
  const getSubscriptions = methodOf(service, 'getSubscriptions');
  const getAllEvents = methodOf(service, 'getAllEvents');
  if (!getSubscriptions || !getAllEvents) return null;
  try {
    const enabledIds = new Set(
      toIcsSubscriptions(getSubscriptions())
        .filter((subscription) => subscription.enabled)
        .map((subscription) => subscription.id),
    );
    const feedEvents: FeedEvent[] = [];
    for (const raw of asArray(getAllEvents())) {
      const event = toExternalEvent(raw);
      if (!event || !enabledIds.has(event.subscriptionId)) continue;
      feedEvents.push({ feedKey: externalCalendarFeedKey('ics', event.subscriptionId), event });
    }
    return { feedEvents, configuredFeedCount: enabledIds.size };
  } catch {
    return null;
  }
}

function readProviderSurface(plugin: unknown): SurfaceRead | null {
  const getAllProviders = methodOf(asRecord(asRecord(plugin)?.calendarProviderRegistry), 'getAllProviders');
  if (!getAllProviders) return null;
  try {
    const feedEvents: FeedEvent[] = [];
    let configuredFeedCount = 0;
    for (const provider of guardedProviders(getAllProviders())) {
      configuredFeedCount += provider.calendars.length;
      const prefix = `${provider.kind}-`;
      for (const event of provider.events) {
        if (!event.subscriptionId.startsWith(prefix)) continue;
        const calendarId = event.subscriptionId.slice(prefix.length);
        feedEvents.push({ feedKey: externalCalendarFeedKey(provider.kind, calendarId), event });
      }
    }
    return { feedEvents, configuredFeedCount };
  } catch {
    return null;
  }
}

function daysOfSpan(span: LocalDaySpan): LocalDay[] {
  const days: LocalDay[] = [];
  for (let day = span.startDay; day <= span.endDay; day = shiftLocalDay(day, 1)) {
    days.push(day);
  }
  return days;
}

interface NormalizedOccurrence {
  event: ExternalEvent;
  span: LocalDaySpan;
  startTime: string;
}

function toSingleItem(occurrence: NormalizedOccurrence): CalendarItem {
  const { event, span, startTime } = occurrence;
  return {
    id: makeCalendarItemId(
      'external-event',
      event.recurringEventId ?? event.subscriptionId,
      `${span.startDay}#${startTime}`,
    ),
    family: 'external-event',
    title: event.title,
    startDay: span.startDay,
    endDay: span.endDay,
    ...(event.color === undefined ? {} : { color: event.color }),
  };
}

function toSeriesItem(seriesId: string, occurrences: NormalizedOccurrence[]): CalendarItem | null {
  const sorted = [...occurrences].sort((a, b) =>
    `${a.span.startDay}#${a.startTime}`.localeCompare(`${b.span.startDay}#${b.startTime}`),
  );
  const first = sorted[0];
  if (first === undefined) return null;
  const occupiedDays = [...new Set(sorted.flatMap((occurrence) => daysOfSpan(occurrence.span)))].sort(
    (a, b) => a.localeCompare(b),
  );
  const firstDay = occupiedDays[0] ?? first.span.startDay;
  const lastDay = occupiedDays[occupiedDays.length - 1] ?? first.span.endDay;
  return {
    id: makeCalendarItemId('external-event', seriesId, `${firstDay}#${first.startTime}`),
    family: 'external-event',
    title: first.event.title,
    startDay: firstDay,
    endDay: lastDay,
    ...(first.event.color === undefined ? {} : { color: first.event.color }),
    ...(occupiedDays.length > 1 ? { occupancyDays: occupiedDays } : {}),
  };
}

function buildItems(feedEvents: readonly FeedEvent[]): CalendarItem[] {
  const singles: CalendarItem[] = [];
  const seriesById = new Map<string, NormalizedOccurrence[]>();
  for (const { event } of feedEvents) {
    const span = normalizedSpan(event);
    if (span === null) continue;
    const occurrence: NormalizedOccurrence = { event, span, startTime: localStartTime(event) };
    if (event.recurringEventId === undefined) {
      singles.push(toSingleItem(occurrence));
      continue;
    }
    const existing = seriesById.get(event.recurringEventId) ?? [];
    seriesById.set(event.recurringEventId, [...existing, occurrence]);
  }
  const series = [...seriesById.entries()]
    .map(([seriesId, occurrences]) => toSeriesItem(seriesId, occurrences))
    .filter((item): item is CalendarItem => item !== null);
  return [...singles, ...series];
}

// --- source ---------------------------------------------------------------

function fingerprintEvent(event: ExternalEvent): string {
  return [
    event.subscriptionId,
    event.recurringEventId ?? '',
    event.start,
    event.end ?? '',
    String(event.allDay),
    event.title,
    event.color ?? '',
  ].join('|');
}

/**
 * Change fingerprint over the fetch-free surfaces only: ICS subscription
 * configs and the providers' pure event caches. ICS event content is
 * deliberately absent — its only fetch-free change signal is the service's
 * `data-changed` emitter.
 */
function fetchFreeFingerprint(plugin: unknown): string {
  const parts: string[] = [];
  for (const subscription of readExternalIcsSubscriptions(plugin)) {
    parts.push(
      `ics|${subscription.id}|${subscription.name}|${subscription.color ?? ''}|${subscription.enabled}`,
    );
  }
  const getAllProviders = methodOf(asRecord(asRecord(plugin)?.calendarProviderRegistry), 'getAllProviders');
  if (getAllProviders) {
    try {
      for (const provider of guardedProviders(getAllProviders())) {
        for (const calendar of provider.calendars) {
          parts.push(`${provider.kind}|cal|${calendar.id}|${calendar.name}`);
        }
        for (const event of provider.events) {
          parts.push(`${provider.kind}|ev|${fingerprintEvent(event)}`);
        }
      }
    } catch {
      parts.push('providers|unreadable');
    }
  }
  return parts.join('\n');
}

/** Build the external-calendar {@link CalendarItemSource} over injected deps. */
export function createExternalCalendarSource(deps: ExternalCalendarSourceDeps): ExternalCalendarSource {
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_EXTERNAL_CALENDAR_POLL_MS;
  let epoch = 0;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let icsUnsubscribe: (() => void) | undefined;
  const providerUnsubscribes = new Map<string, () => void>();
  let lastFingerprint = fetchFreeFingerprint(deps.getTaskNotesPlugin());

  const bumpOnDataChanged = (): void => {
    // Refresh the fingerprint too, so the next fallback tick stays quiet
    // instead of double-bumping for the same change.
    lastFingerprint = fetchFreeFingerprint(deps.getTaskNotesPlugin());
    epoch += 1;
  };

  const asUnsubscribe = (value: unknown): (() => void) =>
    typeof value === 'function' ? (value as () => void) : () => {};

  const attachIcsEmitter = (plugin: Record<string, unknown> | undefined): void => {
    if (icsUnsubscribe) return;
    const on = methodOf(asRecord(plugin?.icsSubscriptionService), 'on');
    if (!on) return;
    try {
      icsUnsubscribe = asUnsubscribe(on(DATA_CHANGED_EVENT, bumpOnDataChanged));
    } catch {
      icsUnsubscribe = undefined;
    }
  };

  const attachProviderEmitters = (plugin: Record<string, unknown> | undefined): void => {
    const getAllProviders = methodOf(asRecord(plugin?.calendarProviderRegistry), 'getAllProviders');
    if (!getAllProviders) return;
    try {
      for (const entry of asArray(getAllProviders())) {
        const provider = asRecord(entry);
        const providerId = typeof provider?.providerId === 'string' ? provider.providerId : undefined;
        if (providerId === undefined || providerUnsubscribes.has(providerId)) continue;
        const on = methodOf(provider, 'on');
        if (!on) continue;
        providerUnsubscribes.set(providerId, asUnsubscribe(on(DATA_CHANGED_EVENT, bumpOnDataChanged)));
      }
    } catch {
      // A degraded registry read is retried on the next tick.
    }
  };

  const attachEmitters = (): void => {
    const plugin = asRecord(deps.getTaskNotesPlugin());
    attachIcsEmitter(plugin);
    attachProviderEmitters(plugin);
  };

  const tick = (): void => {
    if (disposed) return;
    attachEmitters();
    const fingerprint = fetchFreeFingerprint(deps.getTaskNotesPlugin());
    if (fingerprint !== lastFingerprint) {
      lastFingerprint = fingerprint;
      epoch += 1;
    }
    timer = deps.scheduler.setTimeout(tick, pollIntervalMs);
  };

  attachEmitters();
  timer = deps.scheduler.setTimeout(tick, pollIntervalMs);

  return {
    family: 'external-event',
    epoch: () => epoch,
    collect: async () => {
      const plugin = deps.getTaskNotesPlugin();
      const visible = deps.visibleFeeds();
      const surfaces = [readIcsSurface(plugin), readProviderSurface(plugin)];
      const present = surfaces.filter((surface): surface is SurfaceRead => surface !== null);
      const degraded = present.length < surfaces.length;
      const feedEvents = present.flatMap((surface) => surface.feedEvents);
      const configuredFeedCount = present.reduce(
        (count, surface) => count + surface.configuredFeedCount,
        0,
      );
      const loading = !degraded && configuredFeedCount > 0 && feedEvents.length === 0;
      const items = buildItems(feedEvents.filter((feedEvent) => visible.has(feedEvent.feedKey)));
      return {
        items,
        occupancyByTaskPath: new Map(),
        ...(degraded ? { degraded: true } : {}),
        ...(loading ? { loading: true } : {}),
      };
    },
    dispose: () => {
      disposed = true;
      if (timer !== undefined) deps.scheduler.clearTimeout(timer);
      icsUnsubscribe?.();
      icsUnsubscribe = undefined;
      for (const unsubscribe of providerUnsubscribes.values()) unsubscribe();
      providerUnsubscribes.clear();
    },
  };
}
