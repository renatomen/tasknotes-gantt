/**
 * Executable projection of the calendar model onto RFC 5545 / RFC 7953 shapes,
 * proving the lossless-boundary obligation in docs/architecture/standards-alignment.md.
 * The narrative field table lives in docs/architecture/calendar-rfc-mapping.md.
 *
 * All v1 constructs are day-granular DATE values, which are floating by
 * definition — the calendar timezone is carried at component level only and is
 * never emitted as a TZID parameter on a DATE-valued property (RFC 5545 3.2.19).
 */

import {
  addDaysIso,
  type AvailabilityBlock,
  type CalendarDefinition,
  type TimeRange,
} from './schema';

export interface RfcDatedProperty {
  valueType: 'DATE';
  value: string;
  tzid: undefined;
}

/**
 * VEVENT projection: TRANSP separates display-only from blocking time.
 * dtstart is absent only for an anchorless recurring event — like UID and
 * DTSTAMP, it is completed at export time, not stored.
 */
export interface RfcEvent {
  transparency: 'OPAQUE' | 'TRANSPARENT';
  dtstart: RfcDatedProperty | undefined;
  dtend: RfcDatedProperty | undefined;
  rrule: string | undefined;
  summary: string | undefined;
  marker: boolean;
}

/**
 * VAVAILABILITY AVAILABLE projection: an rrule paired with hour ranges.
 * The role discriminant survives the trip — array position alone cannot
 * distinguish the uniform working pattern from per-day blocks once a
 * pattern-less, availability-only calendar passes through.
 */
export interface RfcAvailableBlock {
  role: 'uniform' | 'per-day';
  rrule: string;
  hours: TimeRange[];
  dtstart: RfcDatedProperty | undefined;
}

export interface RfcAvailability {
  available: RfcAvailableBlock[];
}

export interface RfcCalendarModel {
  description: string | undefined;
  color: string | undefined;
  timezone: string | undefined;
  availability: RfcAvailability | undefined;
  events: RfcEvent[];
}

const dateProperty = (value: string): RfcDatedProperty => ({
  valueType: 'DATE',
  value,
  tzid: undefined,
});

export function toRfcCalendar(definition: CalendarDefinition): RfcCalendarModel {
  const events: RfcEvent[] = [];

  for (const span of definition.nonWorking) {
    events.push({
      transparency: 'OPAQUE',
      dtstart: dateProperty(span.startDate),
      dtend: dateProperty(span.endDateExclusive),
      rrule: undefined,
      summary: span.name,
      marker: false,
    });
  }
  for (const span of definition.events) {
    events.push({
      transparency: 'TRANSPARENT',
      dtstart: dateProperty(span.startDate),
      dtend: dateProperty(span.endDateExclusive),
      rrule: undefined,
      summary: span.name,
      marker: false,
    });
  }
  for (const marker of definition.markers) {
    events.push({
      transparency: 'TRANSPARENT',
      dtstart: dateProperty(marker.date),
      dtend: undefined,
      rrule: undefined,
      summary: marker.name,
      marker: true,
    });
  }
  for (const recurring of definition.recurringEvents) {
    events.push({
      transparency: 'TRANSPARENT',
      dtstart: definition.patternStart ? dateProperty(definition.patternStart) : undefined,
      dtend: undefined,
      rrule: recurring.rrule,
      summary: recurring.name,
      marker: false,
    });
  }

  const available: RfcAvailableBlock[] = [];
  if (definition.pattern !== undefined) {
    available.push({
      role: 'uniform',
      rrule: definition.pattern,
      hours: definition.workingHours,
      dtstart: definition.patternStart ? dateProperty(definition.patternStart) : undefined,
    });
  }
  for (const block of definition.availability) {
    available.push({ role: 'per-day', rrule: block.pattern, hours: block.hours, dtstart: undefined });
  }

  return {
    description: definition.description,
    color: definition.color,
    timezone: definition.timezone,
    availability: available.length > 0 ? { available } : undefined,
    events,
  };
}

export function fromRfcCalendar(model: RfcCalendarModel): CalendarDefinition {
  const definition: CalendarDefinition = {
    kind: 'calendar',
    description: model.description,
    color: model.color,
    pattern: undefined,
    patternStart: undefined,
    timezone: model.timezone,
    workingHours: [],
    availability: [],
    nonWorking: [],
    events: [],
    recurringEvents: [],
    markers: [],
    diagnostics: [],
  };

  const available = model.availability?.available ?? [];
  const uniform = available.find((block) => block.role === 'uniform');
  if (uniform) {
    definition.pattern = uniform.rrule;
    definition.workingHours = uniform.hours;
    definition.patternStart = uniform.dtstart?.value;
  }
  definition.availability = available
    .filter((block) => block.role === 'per-day')
    .map(toAvailabilityBlock);

  for (const event of model.events) {
    if (event.rrule !== undefined) {
      definition.recurringEvents.push({ rrule: event.rrule, name: event.summary });
      continue;
    }
    if (event.dtstart === undefined) continue;
    if (event.marker) {
      definition.markers.push({ date: event.dtstart.value, name: event.summary });
      continue;
    }
    const span = {
      startDate: event.dtstart.value,
      endDateExclusive: event.dtend?.value ?? addDaysIso(event.dtstart.value, 1),
      name: event.summary,
    };
    (event.transparency === 'OPAQUE' ? definition.nonWorking : definition.events).push(span);
  }

  return definition;
}

const toAvailabilityBlock = (block: RfcAvailableBlock): AvailabilityBlock => ({
  pattern: block.rrule,
  hours: block.hours,
});
