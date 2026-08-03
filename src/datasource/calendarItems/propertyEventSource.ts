/**
 * Property-based event calendar-item source: notes from this view's Bases
 * query render as flat read-only event bars via the user-mapped start/end/
 * title properties — never hardcoded names. Emission requires both the family
 * toggle and a configured start picker; the pickers hold `note.*` ids, so
 * values read straight off each entry's frontmatter (the cheap fast path —
 * a non-frontmatter picker can never emit).
 *
 * Date values are two-natured: a date-only string is floating (its date part
 * is the calendar day, no zone conversion), while a value with a time
 * component attributes through the shared instant normalizer so offset-stamped
 * timestamps shift with the observer's clock. An absent/placeholder value is
 * "no value" (no start → no event; no end → a one-day event); a present but
 * unparseable value drops the note silently — bad data never breaks the
 * family.
 *
 * Pure module: the toggles and the change subscription arrive via DI, the
 * entries via the query context's Bases-rows accessor — so events follow the
 * view's query by construction. Emits flat items only — no occupancy.
 *
 * @module datasource/calendarItems/propertyEventSource
 */

import type { BasesEntryLike } from '../../bases/types/bases-entry';
import { noteFrontmatterKey } from '../dateFieldMapping';
import type {
  CalendarItem,
  CalendarItemBatch,
  CalendarItemSource,
  LocalDay,
} from './types';
import { makeCalendarItemId } from './types';
import { localDayOfInstant, type LocalDaySpan } from './normalizers';

/** The property-event slice of the per-view calendar-item toggles. */
export interface PropertyEventToggles {
  showPropertyBasedEvents: boolean;
  /** Mapped property ids (`note.*` pickers); `''` = unset. */
  propertyEventStart: string;
  propertyEventEnd: string;
  propertyEventTitle: string;
}

/** Dependencies of the property-event source, injected by the controller wiring. */
export interface PropertyEventSourceDeps {
  /** Per-view property-event toggles and pickers, read fresh on every collect. */
  toggles(): PropertyEventToggles;
  /** Change-event seam driving the epoch (Bases data updates). */
  subscribe?(handler: (eventName: string, payload?: unknown) => void): () => void;
}

/** The property-event source; `dispose` releases the change-event subscription. */
export interface PropertyEventSource extends CalendarItemSource {
  dispose(): void;
}

/** Everything one property-event expansion derives against. */
export interface PropertyEventExpansionInput {
  entries: readonly BasesEntryLike[];
  toggles: PropertyEventToggles;
}

/** The bare frontmatter keys behind the configured pickers. */
interface ConfiguredEventProperties {
  startKey: string;
  endKey: string | null;
  titleKey: string | null;
}

function resolveConfiguredProperties(
  toggles: PropertyEventToggles,
): ConfiguredEventProperties | null {
  if (!toggles.showPropertyBasedEvents) return null;
  const startKey = noteFrontmatterKey(toggles.propertyEventStart);
  if (startKey === null) return null;
  return {
    startKey,
    endKey: noteFrontmatterKey(toggles.propertyEventEnd),
    titleKey: noteFrontmatterKey(toggles.propertyEventTitle),
  };
}

/**
 * Absent (no value) and invalid (a value that cannot be a day) diverge:
 * an absent optional field degrades gracefully while an invalid one drops
 * the note.
 */
type NormalizedDateValue =
  | { kind: 'absent' }
  | { kind: 'invalid' }
  | { kind: 'day'; day: LocalDay };

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Strings some tools serialize into frontmatter to mean "no value". */
const NO_VALUE_PLACEHOLDERS = new Set(['null', 'undefined']);

function normalizeDateValue(raw: unknown): NormalizedDateValue {
  if (raw === undefined || raw === null) return { kind: 'absent' };
  if (typeof raw !== 'string') return { kind: 'invalid' };
  const value = raw.trim();
  if (value === '' || NO_VALUE_PLACEHOLDERS.has(value.toLowerCase())) return { kind: 'absent' };
  if (DATE_ONLY_PATTERN.test(value)) return { kind: 'day', day: value };
  const day = localDayOfInstant(value);
  return day === null ? { kind: 'invalid' } : { kind: 'day', day };
}

/** ISO local days order lexically; a reversed pair degrades to an ordered span. */
function orderedDaySpan(oneDay: LocalDay, otherDay: LocalDay): LocalDaySpan {
  return oneDay <= otherDay
    ? { startDay: oneDay, endDay: otherDay }
    : { startDay: otherDay, endDay: oneDay };
}

function resolveTitle(
  frontmatter: Record<string, unknown>,
  titleKey: string | null,
  basename: string,
): string {
  const raw = titleKey === null ? undefined : frontmatter[titleKey];
  return typeof raw === 'string' && raw.trim() !== '' ? raw : basename;
}

function toPropertyEvent(
  entry: BasesEntryLike,
  configured: ConfiguredEventProperties,
): CalendarItem | null {
  const frontmatter = entry.frontmatter ?? entry.properties ?? {};
  const start = normalizeDateValue(frontmatter[configured.startKey]);
  if (start.kind !== 'day') return null;
  const end =
    configured.endKey === null
      ? ({ kind: 'absent' } as const)
      : normalizeDateValue(frontmatter[configured.endKey]);
  if (end.kind === 'invalid') return null;
  const span =
    end.kind === 'day'
      ? orderedDaySpan(start.day, end.day)
      : { startDay: start.day, endDay: start.day };
  return {
    id: makeCalendarItemId('property-event', entry.file.path),
    family: 'property-event',
    title: resolveTitle(frontmatter, configured.titleKey, entry.file.basename),
    startDay: span.startDay,
    endDay: span.endDay,
    notePath: entry.file.path,
  };
}

/** Pure expansion: mapped note properties → flat day-attributed event rows. */
export function expandPropertyEventItems(input: PropertyEventExpansionInput): CalendarItemBatch {
  const occupancyByTaskPath = new Map<string, never[]>();
  const configured = resolveConfiguredProperties(input.toggles);
  if (configured === null) return { items: [], occupancyByTaskPath };

  const items: CalendarItem[] = [];
  for (const entry of input.entries) {
    const item = toPropertyEvent(entry, configured);
    if (item !== null) items.push(item);
  }
  return { items, occupancyByTaskPath };
}

/** Build the property-event {@link CalendarItemSource} over injected deps. */
export function createPropertyEventSource(deps: PropertyEventSourceDeps): PropertyEventSource {
  let epoch = 0;
  const unsubscribe = deps.subscribe?.(() => {
    epoch += 1;
  });
  return {
    family: 'property-event',
    epoch: () => epoch,
    collect: async (context) =>
      expandPropertyEventItems({
        entries: context.basesEntries(),
        toggles: deps.toggles(),
      }),
    dispose: () => {
      unsubscribe?.();
    },
  };
}
