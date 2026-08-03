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
import type { CalendarItem, CalendarItemSource, LocalDay } from './types';
import { asRecord, makeCalendarItemId } from './types';
import {
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

interface GuardedProvidersRead {
  providers: GuardedProvider[];
  /** Whether any individual provider's guarded read threw (its data is missing). */
  degraded: boolean;
}

function guardedProviders(raw: unknown): GuardedProvidersRead {
  const providers: GuardedProvider[] = [];
  let degraded = false;
  for (const entry of asArray(raw)) {
    const provider = asRecord(entry);
    const kind = providerKindOf(provider?.providerId);
    const getAllEvents = methodOf(provider, 'getAllEvents');
    if (!kind || !getAllEvents) continue;
    // Guard each provider on its own: one throwing provider loses only its own
    // events while healthy siblings keep rendering.
    try {
      const events: ExternalEvent[] = [];
      for (const rawEvent of asArray(getAllEvents())) {
        const event = toExternalEvent(rawEvent);
        if (event) events.push(event);
      }
      const getAvailableCalendars = methodOf(provider, 'getAvailableCalendars');
      providers.push({
        kind,
        events,
        calendars: toProviderCalendars(kind, getAvailableCalendars?.()),
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

function readIcsSurface(plugin: unknown): SurfaceRead | null {
  const service = icsService(plugin);
  const getSubscriptions = methodOf(service, 'getSubscriptions');
  const getAllEvents = methodOf(service, 'getAllEvents');
  const getLastFetched = methodOf(service, 'getLastFetched');
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
    return {
      feedEvents,
      configuredFeedKeys: [...enabledIds].map((id) => externalCalendarFeedKey('ics', id)),
      completedFeedKeys: [...enabledIds]
        .filter((id) => {
          try {
            return typeof getLastFetched?.(id) === 'string';
          } catch {
            return false;
          }
        })
        .map((id) => externalCalendarFeedKey('ics', id)),
    };
  } catch {
    return null;
  }
}

function readProviderSurface(plugin: unknown): SurfaceRead | null {
  const getAllProviders = methodOf(providerRegistry(plugin), 'getAllProviders');
  if (!getAllProviders) return null;
  try {
    const feedEvents: FeedEvent[] = [];
    const configuredFeedKeys: string[] = [];
    const { providers, degraded } = guardedProviders(getAllProviders());
    for (const provider of providers) {
      for (const calendar of provider.calendars) {
        configuredFeedKeys.push(externalCalendarFeedKey(provider.kind, calendar.id));
      }
      const prefix = `${provider.kind}-`;
      for (const event of provider.events) {
        if (!event.subscriptionId.startsWith(prefix)) continue;
        const calendarId = event.subscriptionId.slice(prefix.length);
        feedEvents.push({ feedKey: externalCalendarFeedKey(provider.kind, calendarId), event });
      }
    }
    return { feedEvents, configuredFeedKeys, ...(degraded ? { degraded: true } : {}) };
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

function buildItems(feedEvents: readonly FeedEvent[]): CalendarItem[] {
  const singleEntries: SingleEntry[] = [];
  // Series group per feed AND series id: feed-local series ids are only unique
  // within their own feed, so two feeds reusing one id stay separate rows.
  const seriesByFeedAndId = new Map<string, SeriesGroup>();
  for (const { feedKey, event } of feedEvents) {
    const span = normalizedSpan(event);
    if (span === null) continue;
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
  const singles = singleEntries.map((entry) =>
    toSingleItem(entry, singleDiscriminator(entry.occurrence, ordinals)),
  );
  const series = [...seriesByFeedAndId.values()]
    .map((group) => toSeriesItem(group.feedKey, group.seriesId, group.occurrences))
    .filter((item): item is CalendarItem => item !== null);
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
      for (const provider of guardedProviders(getAllProviders()).providers) {
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

/** Canonical identity of a feed set: deduped, sorted, joined. */
function feedSetKey(keys: readonly string[]): string {
  return [...new Set(keys)].sort((a, b) => a.localeCompare(b)).join(',');
}

/**
 * Configured feed keys via the fetch-free surfaces only (subscription configs
 * and the providers' calendar caches) — safe outside `collect`, where
 * `ICSSubscriptionService.getAllEvents` must never be touched.
 */
function fetchFreeConfiguredFeedKeys(plugin: unknown): string[] {
  const keys = readExternalIcsSubscriptions(plugin)
    .filter((subscription) => subscription.enabled)
    .map((subscription) => externalCalendarFeedKey('ics', subscription.id));
  for (const calendar of readExternalProviderCalendars(plugin)) {
    keys.push(externalCalendarFeedKey(calendar.provider, calendar.id));
  }
  return keys;
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

  // Loading is a first-signal lifecycle, never an emptiness inference: the
  // visible-configured feed set counts as loading until the first completion
  // signal (a data-changed emission, a changed-fingerprint tick, or a collect
  // observing a warm cache) is recorded FOR that set — an empty result then
  // clears it, and a feed-set change re-arms it exactly once.
  let completionSignalFeedSetKey: string | null = null;

  const recordCompletionSignal = (): void => {
    const visible = deps.visibleFeeds();
    completionSignalFeedSetKey = feedSetKey(
      fetchFreeConfiguredFeedKeys(deps.getTaskNotesPlugin()).filter((key) => visible.has(key)),
    );
  };

  const bumpOnDataChanged = (): void => {
    // A listener can outlive dispose when a service's unsubscribe misbehaves;
    // the guard keeps a disposed source from bumping or re-reading services.
    if (disposed) return;
    // Refresh the fingerprint too, so the next fallback tick stays quiet
    // instead of double-bumping for the same change.
    lastFingerprint = fetchFreeFingerprint(deps.getTaskNotesPlugin());
    recordCompletionSignal();
    epoch += 1;
    deps.onEpochBump?.();
  };

  const asUnsubscribe = (value: unknown): (() => void) =>
    typeof value === 'function' ? (value as () => void) : () => {};

  const attachIcsEmitter = (plugin: Record<string, unknown> | undefined): void => {
    if (icsUnsubscribe) return;
    const on = methodOf(icsService(plugin), 'on');
    if (!on) return;
    try {
      icsUnsubscribe = asUnsubscribe(on(DATA_CHANGED_EVENT, bumpOnDataChanged));
    } catch {
      icsUnsubscribe = undefined;
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
    if (fingerprint !== lastFingerprint) {
      lastFingerprint = fingerprint;
      recordCompletionSignal();
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
    collect: async () => {
      const visible = deps.visibleFeeds();
      // Zero visible feeds is a full opt-out: return a plain empty batch
      // without touching either event surface — `ICSSubscriptionService.
      // getAllEvents` starts network fetches for cold/expired caches, and an
      // opted-out view must never initiate one.
      if (visible.size === 0) {
        return { items: [], occupancyByTaskPath: new Map() };
      }
      const plugin = deps.getTaskNotesPlugin();
      const surfaces = [readIcsSurface(plugin), readProviderSurface(plugin)];
      const present = surfaces.filter((surface): surface is SurfaceRead => surface !== null);
      const degraded =
        present.length < surfaces.length || present.some((surface) => surface.degraded === true);
      const feedEvents = present.flatMap((surface) => surface.feedEvents);
      const visibleFeedKeys = present
        .flatMap((surface) => surface.configuredFeedKeys)
        .filter((key) => visible.has(key));
      const visibleFeedEvents = feedEvents.filter((feedEvent) => visible.has(feedEvent.feedKey));
      const currentFeedSetKey = feedSetKey(visibleFeedKeys);
      const completedFeedKeys = new Set(
        present
          .flatMap((surface) => surface.completedFeedKeys ?? [])
          .filter((key) => visible.has(key)),
      );
      // A warm cache is a completed load — events observed for the visible
      // set or per-feed ICS fetch metadata count as a completion signal
      // without waiting for an emission.
      if (
        visibleFeedEvents.length > 0 ||
        (visibleFeedKeys.length > 0 && visibleFeedKeys.every((key) => completedFeedKeys.has(key)))
      ) {
        completionSignalFeedSetKey = currentFeedSetKey;
      }
      const loading =
        !degraded &&
        visibleFeedKeys.length > 0 &&
        completionSignalFeedSetKey !== currentFeedSetKey;
      const items = buildItems(visibleFeedEvents);
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
