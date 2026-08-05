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
 * feed + series + first day + start time instead.
 *
 * @module datasource/calendarItems/externalCalendarSource
 */

import type { TimerScheduler } from '../../bases/scheduler';
import type {
  CalendarDerivationWindow,
  CalendarItem,
  CalendarItemSource,
  LocalDay,
} from './types';
import { asRecord, makeCalendarItemId } from './types';
import { dlog } from '../../debugLog';
import {
  intersectsWindow,
  isLocalDayString,
  localDaySpanOfInstants,
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

/** Guarded catalog read used by the options panel. */
export interface ExternalCalendarDiscovery {
  icsSubscriptions: readonly ExternalIcsSubscription[];
  providerCalendars: readonly ExternalProviderCalendar[];
  degraded: boolean;
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
  /**
   * Fires after each epoch bump (emitter `data-changed` or a fallback tick
   * that observed changed cached facts) so the host can schedule a refresh —
   * the epoch alone only classifies a refresh someone else triggers.
   */
  onEpochBump?(): void;
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

function icsService(plugin: unknown): Record<string, unknown> | undefined {
  return asRecord(asRecord(plugin)?.icsSubscriptionService);
}

function providerRegistry(plugin: unknown): Record<string, unknown> | undefined {
  return asRecord(asRecord(plugin)?.calendarProviderRegistry);
}

/** The ICSEvent slice this source consumes (TaskNotes service shape). */
interface ExternalEvent {
  id?: string;
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
    id: typeof record.id === 'string' && record.id !== '' ? record.id : undefined,
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
  completedCalendarIds: string[];
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

function hasProviderSyncToken(provider: Record<string, unknown>, calendarId: string): boolean {
  const getSyncToken = methodOf(provider, 'getSyncToken');
  if (!getSyncToken) return false;
  try {
    const token = getSyncToken(calendarId);
    return typeof token === 'string' && token !== '';
  } catch {
    return false;
  }
}

interface GuardedProvidersRead {
  providers: GuardedProvider[];
  /** Whether any individual provider's guarded read threw (its data is missing). */
  degraded: boolean;
}

function guardedProviders(raw: unknown): GuardedProvidersRead {
  if (!Array.isArray(raw)) return { providers: [], degraded: true };
  const providers: GuardedProvider[] = [];
  let degraded = false;
  for (const entry of raw) {
    const provider = asRecord(entry);
    const kind = providerKindOf(provider?.providerId);
    const getAllEvents = methodOf(provider, 'getAllEvents');
    const getAvailableCalendars = methodOf(provider, 'getAvailableCalendars');
    if (!provider || !kind || !getAllEvents || !getAvailableCalendars) {
      degraded = true;
      continue;
    }
    // Guard the event-cache read and the calendar catalog SEPARATELY: a failing
    // getAllEvents (e.g. a cold/throwing cache) must not drop the provider's
    // catalog, or a feed the user already selected would vanish from visibility/
    // degrade handling instead of staying selectable and marked degraded. One
    // throwing provider still loses only its own data; healthy siblings render.
    const events: ExternalEvent[] = [];
    try {
      for (const rawEvent of asArray(getAllEvents())) {
        const event = toExternalEvent(rawEvent);
        if (event) events.push(event);
      }
    } catch {
      degraded = true;
    }
    try {
      const calendars = toProviderCalendars(kind, getAvailableCalendars());
      providers.push({
        kind,
        events,
        calendars,
        completedCalendarIds: calendars
          .filter((calendar) => hasProviderSyncToken(provider, calendar.id))
          .map((calendar) => calendar.id),
      });
    } catch {
      degraded = true;
    }
  }
  return { providers, degraded };
}

/** Current ICS subscriptions via the guarded service surface; absence → empty. */
export function readExternalIcsSubscriptions(plugin: unknown): readonly ExternalIcsSubscription[] {
  const getSubscriptions = methodOf(icsService(plugin), 'getSubscriptions');
  if (!getSubscriptions) return [];
  try {
    return toIcsSubscriptions(getSubscriptions());
  } catch {
    return [];
  }
}

/**
 * Whether the provider registry currently exposes any calendar provider — true
 * even while a provider's catalog is transiently empty (mid-reconnect/resync),
 * because the provider object persists. Lets the wiring create the discovery
 * watcher for a selected-but-transiently-absent provider feed at view open, so
 * the calendar's return is observed instead of waiting for an unrelated refresh.
 */
export function hasExternalCalendarProviders(plugin: unknown): boolean {
  // Total over unknown: even the registry/method access is guarded, so a
  // throwing accessor degrades to "no providers" rather than escaping into the
  // per-provide create-gate.
  try {
    const getAllProviders = methodOf(providerRegistry(plugin), 'getAllProviders');
    if (!getAllProviders) return false;
    return guardedProviders(getAllProviders()).providers.length > 0;
  } catch {
    return false;
  }
}

/** Current provider calendars via the guarded registry surface; absence → empty. */
export function readExternalProviderCalendars(plugin: unknown): readonly ExternalProviderCalendar[] {
  const getAllProviders = methodOf(providerRegistry(plugin), 'getAllProviders');
  if (!getAllProviders) return [];
  try {
    return guardedProviders(getAllProviders()).providers.flatMap((provider) => provider.calendars);
  } catch {
    return [];
  }
}

/**
 * Read both external-calendar catalogs once while retaining whether either
 * discovery surface was unavailable. An empty catalog is healthy only when
 * both service methods exist and return successfully.
 */
export function readExternalCalendarDiscovery(plugin: unknown): ExternalCalendarDiscovery {
  let degraded = false;
  let icsSubscriptions: readonly ExternalIcsSubscription[] = [];
  let providerCalendars: readonly ExternalProviderCalendar[] = [];

  const getSubscriptions = methodOf(icsService(plugin), 'getSubscriptions');
  if (!getSubscriptions) {
    degraded = true;
  } else {
    try {
      icsSubscriptions = toIcsSubscriptions(getSubscriptions());
    } catch {
      degraded = true;
    }
  }

  const getAllProviders = methodOf(providerRegistry(plugin), 'getAllProviders');
  if (!getAllProviders) {
    degraded = true;
  } else {
    try {
      const guarded = guardedProviders(getAllProviders());
      providerCalendars = guarded.providers.flatMap((provider) => provider.calendars);
      degraded ||= guarded.degraded;
    } catch {
      degraded = true;
    }
  }

  return { icsSubscriptions, providerCalendars, degraded };
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
  if (event.end === undefined) return { startDay, endDay: startDay };
  let endDay = localDayOfWallClock(event.end);
  if (endDay === null) return null;
  // iCalendar DTEND for VALUE=DATE is exclusive and TaskNotes passes it
  // verbatim, so the last occupied day is the day before.
  if (isLocalDayString(event.end) && endDay > startDay) endDay = shiftLocalDay(endDay, -1);
  return orderedSpan(startDay, endDay);
}

function timedSpan(event: ExternalEvent): LocalDaySpan | null {
  if (event.end === undefined) {
    const startDay = localDayOfWallClock(event.start);
    return startDay === null ? null : { startDay, endDay: startDay };
  }
  return localDaySpanOfInstants(event.start, event.end);
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
  configuredFeedKeys: string[];
  completedFeedKeys?: string[];
  /** Set when part of the surface (an individual provider) failed its read. */
  degraded?: true;
}

type GuardedMethod = (...args: unknown[]) => unknown;

function hasIcsCompletionEvidence(
  getLastFetched: GuardedMethod | undefined,
  subscriptionId: string,
): boolean {
  if (!getLastFetched) return false;
  try {
    return typeof getLastFetched(subscriptionId) === 'string';
  } catch {
    return false;
  }
}

function readIcsSurface(plugin: unknown): SurfaceRead | null {
  const service = icsService(plugin);
  const getSubscriptions = methodOf(service, 'getSubscriptions');
  const getAllEvents = methodOf(service, 'getAllEvents');
  const getLastFetched = methodOf(service, 'getLastFetched');
  if (!getSubscriptions || !getAllEvents) return null;
  try {
    const enabledSubscriptions = toIcsSubscriptions(getSubscriptions()).filter(
      (subscription) => subscription.enabled,
    );
    const enabledIds = new Set(enabledSubscriptions.map((subscription) => subscription.id));
    const feedColors = new Map(
      enabledSubscriptions.map((subscription) => [subscription.id, subscription.color]),
    );
    const feedEvents: FeedEvent[] = [];
    for (const raw of asArray(getAllEvents())) {
      const event = toExternalEvent(raw);
      if (!event || !enabledIds.has(event.subscriptionId)) continue;
      const feedColor = feedColors.get(event.subscriptionId);
      feedEvents.push({
        feedKey: externalCalendarFeedKey('ics', event.subscriptionId),
        event: event.color === undefined && feedColor !== undefined ? { ...event, color: feedColor } : event,
      });
    }
    return {
      feedEvents,
      configuredFeedKeys: [...enabledIds].map((id) => externalCalendarFeedKey('ics', id)),
      completedFeedKeys: [...enabledIds]
        .filter((id) => hasIcsCompletionEvidence(getLastFetched, id))
        .map((id) => externalCalendarFeedKey('ics', id)),
    };
  } catch {
    return null;
  }
}

function fetchFreeCompletedIcsFeedKeys(plugin: unknown): string[] {
  const service = icsService(plugin);
  const getSubscriptions = methodOf(service, 'getSubscriptions');
  const getLastFetched = methodOf(service, 'getLastFetched');
  if (!getSubscriptions) return [];
  try {
    return toIcsSubscriptions(getSubscriptions())
      .filter(
        (subscription) =>
          subscription.enabled && hasIcsCompletionEvidence(getLastFetched, subscription.id),
      )
      .map((subscription) => externalCalendarFeedKey('ics', subscription.id));
  } catch {
    return [];
  }
}

function fetchFreeCompletedProviderFeedKeys(plugin: unknown): string[] {
  const getAllProviders = methodOf(providerRegistry(plugin), 'getAllProviders');
  if (!getAllProviders) return [];
  try {
    return guardedProviders(getAllProviders()).providers.flatMap((provider) =>
      provider.completedCalendarIds.map((calendarId) =>
        externalCalendarFeedKey(provider.kind, calendarId),
      ),
    );
  } catch {
    return [];
  }
}

function fetchFreeCompletedFeedKeys(plugin: unknown): string[] {
  return [
    ...fetchFreeCompletedIcsFeedKeys(plugin),
    ...fetchFreeCompletedProviderFeedKeys(plugin),
  ];
}

function readProviderSurface(plugin: unknown): SurfaceRead | null {
  const getAllProviders = methodOf(providerRegistry(plugin), 'getAllProviders');
  if (!getAllProviders) return null;
  try {
    const feedEvents: FeedEvent[] = [];
    const configuredFeedKeys: string[] = [];
    const completedFeedKeys: string[] = [];
    const { providers, degraded } = guardedProviders(getAllProviders());
    for (const provider of providers) {
      const completedCalendarIds = new Set(provider.completedCalendarIds);
      for (const calendar of provider.calendars) {
        const feedKey = externalCalendarFeedKey(provider.kind, calendar.id);
        configuredFeedKeys.push(feedKey);
        if (completedCalendarIds.has(calendar.id)) completedFeedKeys.push(feedKey);
      }
      const prefix = `${provider.kind}-`;
      for (const event of provider.events) {
        if (!event.subscriptionId.startsWith(prefix)) continue;
        const calendarId = event.subscriptionId.slice(prefix.length);
        feedEvents.push({ feedKey: externalCalendarFeedKey(provider.kind, calendarId), event });
      }
    }
    return {
      feedEvents,
      configuredFeedKeys,
      completedFeedKeys,
      ...(degraded ? { degraded: true } : {}),
    };
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

/** One non-recurring event held with the feed it arrived through. */
interface SingleEntry {
  feedKey: string;
  occurrence: NormalizedOccurrence;
}

function toSingleItem(entry: SingleEntry, discriminator: string): CalendarItem {
  const { event, span, startTime } = entry.occurrence;
  // Single ids are feed-scoped exactly like series ids: two surfaces (an ICS
  // subscription named like a provider's prefixed feed) can otherwise reuse
  // one subscriptionId + event id and collide.
  return {
    id: makeCalendarItemId(
      'external-event',
      entry.feedKey,
      `${span.startDay}#${startTime}#${discriminator}`,
    ),
    family: 'external-event',
    title: event.title,
    startDay: span.startDay,
    endDay: span.endDay,
    ...(event.color === undefined ? {} : { color: event.color }),
  };
}

function canonicalNearTwinRank(occurrence: NormalizedOccurrence): string {
  const { event, span } = occurrence;
  // Ranks group members by their stable distinguishers (day, time and title
  // are already equal within a group), so a near-twin keeps its ordinal even
  // when the service reorders the batch between ticks.
  return `${span.endDay}#${String(event.allDay)}#${event.color ?? ''}`;
}

/**
 * Ordinals for id-less events, grouped per feed by exactly what the rendered
 * qualifier can see (start day, start time, title) — grouping on anything the
 * id cannot see would split indistinguishable events into groups rendering
 * identical ids. Distinct events each sit alone at `~0`, so inserting or
 * removing an unrelated event never shifts their ids; within a group the
 * canonical rank orders near-twins, and service order remains the last
 * tiebreak only for byte-identical records.
 */
function idlessOrdinals(entries: readonly SingleEntry[]): Map<NormalizedOccurrence, number> {
  const groups = new Map<string, NormalizedOccurrence[]>();
  for (const entry of entries) {
    const { event, span, startTime } = entry.occurrence;
    if (event.id !== undefined) continue;
    // A structured key: a delimiter smuggled into one component can never
    // alias another feed's group.
    const key = JSON.stringify([entry.feedKey, span.startDay, startTime, event.title]);
    const group = groups.get(key) ?? [];
    group.push(entry.occurrence);
    groups.set(key, group);
  }
  const ordinals = new Map<NormalizedOccurrence, number>();
  for (const group of groups.values()) {
    const ranked = [...group].sort((a, b) =>
      canonicalNearTwinRank(a).localeCompare(canonicalNearTwinRank(b)),
    );
    ranked.forEach((occurrence, index) => ordinals.set(occurrence, index));
  }
  return ordinals;
}

function singleDiscriminator(
  occurrence: NormalizedOccurrence,
  ordinals: ReadonlyMap<NormalizedOccurrence, number>,
): string {
  const { event } = occurrence;
  // The prefixes keep explicit ids and generated title stand-ins in disjoint
  // namespaces, and the ordinal is ALWAYS generated for id-less events, so a
  // literal title `Busy~0` yields `t:Busy~0~0` — never colliding with the
  // first twin of `Busy` (`t:Busy~0`) or with any explicit id (`i:…`).
  if (event.id !== undefined) return `i:${event.id}`;
  return `t:${event.title}~${ordinals.get(occurrence) ?? 0}`;
}

function toSeriesItem(
  feedKey: string,
  seriesId: string,
  occurrences: NormalizedOccurrence[],
): CalendarItem | null {
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
    id: makeCalendarItemId('external-event', `${feedKey}/${seriesId}`, `${firstDay}#${first.startTime}`),
    family: 'external-event',
    title: first.event.title,
    startDay: firstDay,
    endDay: lastDay,
    ...(first.event.color === undefined ? {} : { color: first.event.color }),
    ...(occupiedDays.length > 1 ? { occupancyDays: occupiedDays } : {}),
  };
}

interface SeriesGroup {
  feedKey: string;
  seriesId: string;
  occurrences: NormalizedOccurrence[];
}

function buildItems(
  feedEvents: readonly FeedEvent[],
  window: CalendarDerivationWindow,
): CalendarItem[] {
  const singleEntries: SingleEntry[] = [];
  // Series group per feed AND series id: feed-local series ids are only unique
  // within their own feed, so two feeds reusing one id stay separate rows.
  const seriesByFeedAndId = new Map<string, SeriesGroup>();
  for (const { feedKey, event } of feedEvents) {
    const span = normalizedSpan(event);
    if (span === null) continue;
    // Drop occurrences outside the derivation window: a feed cache holding old
    // or far-future events must not append out-of-window rows that stretch the
    // timeline — a series then spans only its in-window occurrences.
    if (!intersectsWindow(span, window)) continue;
    const occurrence: NormalizedOccurrence = { event, span, startTime: localStartTime(event) };
    if (event.recurringEventId === undefined) {
      singleEntries.push({ feedKey, occurrence });
      continue;
    }
    const groupKey = `${feedKey}\n${event.recurringEventId}`;
    const group = seriesByFeedAndId.get(groupKey) ?? {
      feedKey,
      seriesId: event.recurringEventId,
      occurrences: [],
    };
    seriesByFeedAndId.set(groupKey, { ...group, occurrences: [...group.occurrences, occurrence] });
  }
  const ordinals = idlessOrdinals(singleEntries);
  // Per-fact ingestion boundary: a malformed external id (e.g. a lone-surrogate
  // UID reaching encodeURIComponent in makeCalendarItemId) skips just that one
  // feed entry rather than aborting the whole external collect.
  const singles: CalendarItem[] = [];
  for (const entry of singleEntries) {
    try {
      singles.push(toSingleItem(entry, singleDiscriminator(entry.occurrence, ordinals)));
    } catch (error) {
      dlog('[calendar] skipped a malformed external event', error);
    }
  }
  const series: CalendarItem[] = [];
  for (const group of seriesByFeedAndId.values()) {
    try {
      const item = toSeriesItem(group.feedKey, group.seriesId, group.occurrences);
      if (item !== null) series.push(item);
    } catch (error) {
      dlog('[calendar] skipped a malformed external series', error);
    }
  }
  return [...singles, ...series];
}

// --- source ---------------------------------------------------------------

function fingerprintEvent(event: ExternalEvent): string {
  // The upstream id participates only for non-recurring events, whose rendered
  // ids derive from it (an id-only reindex must read as a change). A recurring
  // occurrence renders keyed on recurringEventId + dates, so its per-instance
  // id reindexing as the sync window slides must NOT phantom-bump the epoch.
  return [
    event.recurringEventId === undefined ? (event.id ?? '') : '',
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
  const getAllProviders = methodOf(providerRegistry(plugin), 'getAllProviders');
  if (getAllProviders) {
    try {
      const guarded = guardedProviders(getAllProviders());
      // Fold the degraded flag in: a provider whose event cache throws now keeps
      // its catalog (unchanged fingerprint), so recovering to a healthy empty
      // read would otherwise leave the epoch unbumped and the stale degraded
      // batch cached. The flag flip is the only fetch-free signal of that
      // transition.
      parts.push(`providers|degraded|${guarded.degraded}`);
      for (const provider of guarded.providers) {
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
  // The exact ICS service object the current unsubscribe is bound to. TaskNotes
  // can swap icsSubscriptionService under a stable plugin handle, so identity —
  // not merely "an unsubscribe exists" — decides when to rebind.
  let icsBoundService: unknown;
  // The bound service exposes `on` but the last subscribe attempt threw: retry
  // it on the next tick (without re-processing the swap) until it takes, so a
  // service whose emitter is not yet ready at swap time still gets a listener.
  let icsSubscriptionPending = false;
  const providerUnsubscribes = new Map<string, () => void>();
  let lastFingerprint = fetchFreeFingerprint(deps.getTaskNotesPlugin());

  // Loading is a per-feed first-signal lifecycle, never an emptiness
  // inference: each configured feed stays loading until its own event or
  // service completion metadata has been observed.
  const completedFeedKeys = new Set<string>();

  const recordCompletedFeedKeys = (feedKeys: readonly string[]): boolean => {
    let changed = false;
    for (const feedKey of feedKeys) {
      if (completedFeedKeys.has(feedKey)) continue;
      completedFeedKeys.add(feedKey);
      changed = true;
    }
    return changed;
  };

  const recordFetchFreeCompletionEvidence = (): boolean => {
    return recordCompletedFeedKeys(fetchFreeCompletedFeedKeys(deps.getTaskNotesPlugin()));
  };

  // Drop ICS completion evidence when the ICS service is replaced: a cold
  // replacement must re-show loading rather than inherit the retired service's
  // "already loaded" state. Provider completion is untouched.
  const forgetIcsCompletion = (): void => {
    const icsPrefix = externalCalendarFeedKey('ics', '');
    for (const feedKey of completedFeedKeys) {
      if (feedKey.startsWith(icsPrefix)) completedFeedKeys.delete(feedKey);
    }
  };

  const bumpOnDataChanged = (): void => {
    // A listener can outlive dispose when a service's unsubscribe misbehaves;
    // the guard keeps a disposed source from bumping or re-reading services.
    if (disposed) return;
    // Refresh the fingerprint too, so the next fallback tick stays quiet
    // instead of double-bumping for the same change.
    lastFingerprint = fetchFreeFingerprint(deps.getTaskNotesPlugin());
    recordFetchFreeCompletionEvidence();
    epoch += 1;
    deps.onEpochBump?.();
  };

  const asUnsubscribe = (value: unknown): (() => void) =>
    typeof value === 'function' ? (value as () => void) : () => {};

  // Subscribe to the bound service's data-changed emitter. A service with no
  // `on` is legitimately unsubscribable (nothing to retry); one whose `on`
  // throws is marked pending so the next tick retries without re-processing the
  // swap.
  const subscribeIcs = (service: Record<string, unknown> | undefined): void => {
    const on = methodOf(service, 'on');
    if (!on) {
      icsSubscriptionPending = false;
      return;
    }
    try {
      icsUnsubscribe = asUnsubscribe(on(DATA_CHANGED_EVENT, bumpOnDataChanged));
      icsSubscriptionPending = false;
    } catch {
      icsUnsubscribe = undefined;
      icsSubscriptionPending = true;
    }
  };

  const attachIcsEmitter = (plugin: Record<string, unknown> | undefined): void => {
    const service = icsService(plugin);
    if (service === icsBoundService) {
      // Same service: only retry a subscription that previously failed to bind,
      // never re-process the swap (which would re-bump the epoch every tick).
      if (icsSubscriptionPending) subscribeIcs(service);
      return;
    }
    // A prior real service was bound: this call is a replacement, not the first
    // attach. Release the retired binding on ANY identity change — even to an
    // unsubscribable service — so a dead service can never keep emitting.
    const isReplacement = icsBoundService !== undefined;
    if (icsUnsubscribe) {
      try {
        icsUnsubscribe();
      } catch {
        // Released as far as the retired service allows.
      }
      icsUnsubscribe = undefined;
    }
    icsBoundService = service;
    subscribeIcs(service);
    // A genuine replacement invalidates prior ICS completion (a cold service must
    // re-show loading) and forces one refresh against the new service — a signal
    // it emitted before we could bind would otherwise be lost.
    if (isReplacement) {
      forgetIcsCompletion();
      epoch += 1;
      deps.onEpochBump?.();
    }
  };

  const attachProviderEmitters = (plugin: Record<string, unknown> | undefined): void => {
    const getAllProviders = methodOf(providerRegistry(plugin), 'getAllProviders');
    if (!getAllProviders) return;
    let entries: unknown[];
    try {
      entries = asArray(getAllProviders());
    } catch {
      // A degraded registry read is retried on the next tick.
      return;
    }
    for (const entry of entries) {
      const provider = asRecord(entry);
      const providerId = typeof provider?.providerId === 'string' ? provider.providerId : undefined;
      if (providerId === undefined || providerUnsubscribes.has(providerId)) continue;
      const on = methodOf(provider, 'on');
      if (!on) continue;
      // Per-provider guard: one throwing subscription is retried next tick
      // while every later provider still gets its listener attached now.
      try {
        providerUnsubscribes.set(providerId, asUnsubscribe(on(DATA_CHANGED_EVENT, bumpOnDataChanged)));
      } catch {
        // Retried on the next tick.
      }
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
    const completionChanged = recordFetchFreeCompletionEvidence();
    if (fingerprint !== lastFingerprint || completionChanged) {
      lastFingerprint = fingerprint;
      epoch += 1;
      deps.onEpochBump?.();
    }
    timer = deps.scheduler.setTimeout(tick, pollIntervalMs);
  };

  attachEmitters();
  timer = deps.scheduler.setTimeout(tick, pollIntervalMs);

  return {
    family: 'external-event',
    epoch: () => epoch,
    collect: async (context) => {
      const visible = deps.visibleFeeds();
      // Zero visible feeds is a full opt-out: return a plain empty batch
      // without touching either event surface — `ICSSubscriptionService.
      // getAllEvents` starts network fetches for cold/expired caches, and an
      // opted-out view must never initiate one.
      if (visible.size === 0) {
        return { items: [], occupancyByTaskPath: new Map() };
      }
      const plugin = deps.getTaskNotesPlugin();
      // Read the ICS surface only when an ICS feed is visible: `getAllEvents`
      // starts network fetches for cold/expired caches, so a provider-only
      // selection must not initiate one. A gated-out surface is simply absent
      // from the set, so it never counts as degraded.
      const icsPrefix = externalCalendarFeedKey('ics', '');
      const hasVisibleIcs = [...visible].some((key) => key.startsWith(icsPrefix));
      const surfaces = [
        ...(hasVisibleIcs ? [readIcsSurface(plugin)] : []),
        readProviderSurface(plugin),
      ];
      const present = surfaces.filter((surface): surface is SurfaceRead => surface !== null);
      const degraded =
        present.length < surfaces.length || present.some((surface) => surface.degraded === true);
      const feedEvents = present.flatMap((surface) => surface.feedEvents);
      const visibleFeedKeys = present
        .flatMap((surface) => surface.configuredFeedKeys)
        .filter((key) => visible.has(key));
      const visibleFeedEvents = feedEvents.filter((feedEvent) => visible.has(feedEvent.feedKey));
      recordCompletedFeedKeys(present.flatMap((surface) => surface.completedFeedKeys ?? []));
      recordCompletedFeedKeys(visibleFeedEvents.map((feedEvent) => feedEvent.feedKey));
      // A warm cache is a completed load — events observed for the visible
      // set or per-feed service completion metadata count as a signal
      // without waiting for an emission.
      const loading =
        !degraded &&
        visibleFeedKeys.length > 0 &&
        visibleFeedKeys.some((feedKey) => !completedFeedKeys.has(feedKey));
      const items = buildItems(visibleFeedEvents, context.window);
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
      timer = undefined;
      // Best-effort teardown: each unsubscribe is guarded on its own so one
      // throwing service can never leak the remaining listeners, and the
      // bookkeeping is cleared in finally so dispose stays idempotent.
      try {
        icsUnsubscribe?.();
      } catch {
        // Released as far as the service allows.
      } finally {
        icsUnsubscribe = undefined;
        icsBoundService = undefined;
        icsSubscriptionPending = false;
      }
      try {
        for (const unsubscribe of providerUnsubscribes.values()) {
          try {
            unsubscribe();
          } catch {
            // Released as far as the provider allows.
          }
        }
      } finally {
        providerUnsubscribes.clear();
      }
    },
  };
}
