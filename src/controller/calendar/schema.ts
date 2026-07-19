/**
 * Calendar-note frontmatter model: friendly keys, canonical RFC values.
 * Fail granularity: an invalid working pattern invalidates the whole calendar;
 * a malformed entry or field is dropped with a diagnostic and the calendar
 * stays valid (fail-visible, never fail-open). The RFC 5545/7953 projection
 * lives in rfcMapping.ts and docs/architecture/calendar-rfc-mapping.md.
 */

export interface CalendarDiagnostic {
  path: string;
  message: string;
}

export interface TimeRange {
  start: string;
  end: string;
}

/** All-day blocking or display span; end is exclusive, DTEND-style. */
export interface DatedSpan {
  startDate: string;
  endDateExclusive: string;
  name: string | undefined;
}

export interface RecurringEvent {
  rrule: string;
  name: string | undefined;
}

export interface MarkerEvent {
  date: string;
  name: string | undefined;
}

export interface AvailabilityBlock {
  pattern: string;
  hours: TimeRange[];
}

export interface CalendarDefinition {
  kind: 'calendar';
  description: string | undefined;
  color: string | undefined;
  pattern: string | undefined;
  patternStart: string | undefined;
  timezone: string | undefined;
  workingHours: TimeRange[];
  availability: AvailabilityBlock[];
  nonWorking: DatedSpan[];
  events: DatedSpan[];
  recurringEvents: RecurringEvent[];
  markers: MarkerEvent[];
  diagnostics: CalendarDiagnostic[];
}

export interface CalendarSetDefinition {
  kind: 'calendar-set';
  description: string | undefined;
  color: string | undefined;
  members: string[];
  diagnostics: CalendarDiagnostic[];
}

export interface InvalidDefinition {
  kind: 'invalid';
  reasons: string[];
}

export type ParsedCalendarNote = CalendarDefinition | CalendarSetDefinition | InvalidDefinition;

const CALENDAR_MARKER = 'calendar';
const CALENDAR_SET_MARKER = 'calendar-set';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HOURS_RANGE = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;
const HAS_FREQ = /(^|;)\s*FREQ=/i;
const ANCHORED_GRAMMAR = /(^|;)\s*(INTERVAL|COUNT|UNTIL)=/i;

export function matchesCalendarMarker(frontmatter: unknown): 'calendar' | 'calendar-set' | null {
  if (typeof frontmatter !== 'object' || frontmatter === null) return null;
  const marker = (frontmatter as Record<string, unknown>)['tngantt'];
  if (typeof marker !== 'string') return null;
  const normalized = marker.trim().toLowerCase();
  if (normalized === CALENDAR_MARKER) return 'calendar';
  if (normalized === CALENDAR_SET_MARKER) return 'calendar-set';
  return null;
}

/** Returns null when the note carries no calendar marker at all. */
export function parseCalendarFrontmatter(frontmatter: unknown): ParsedCalendarNote | null {
  const marker = matchesCalendarMarker(frontmatter);
  if (marker === null) return null;
  const source = frontmatter as Record<string, unknown>;
  return marker === 'calendar' ? parseCalendar(source) : parseCalendarSet(source);
}

function parseCalendar(source: Record<string, unknown>): CalendarDefinition | InvalidDefinition {
  const reasons: string[] = [];
  const diagnostics: CalendarDiagnostic[] = [];

  const pattern = readPattern(source, reasons);
  const patternStart = readOptionalIsoDate(source['pattern_start']);
  if (pattern !== undefined && ANCHORED_GRAMMAR.test(pattern) && patternStart === undefined) {
    reasons.push(
      'pattern uses INTERVAL/COUNT/UNTIL, which needs a pattern_start anchor date to evaluate',
    );
  }
  if (reasons.length > 0) return { kind: 'invalid', reasons };

  const definition: CalendarDefinition = {
    kind: 'calendar',
    description: readOptionalString(source['description']),
    color: readOptionalString(source['color']),
    pattern,
    patternStart,
    timezone: readTimezone(source['timezone'], diagnostics),
    workingHours: readHoursList(source['working_hours'], 'working_hours', diagnostics),
    availability: readAvailability(source['availability'], diagnostics),
    nonWorking: [],
    events: [],
    recurringEvents: [],
    markers: [],
    diagnostics,
  };

  readDatedList(source['non_working'], 'non_working', diagnostics, (entry, path) => {
    if (entry.rrule !== undefined) {
      diagnostics.push({
        path,
        message: 'recurring patterns are not supported in non_working; use the calendar pattern or events',
      });
      return;
    }
    if (entry.marker) {
      diagnostics.push({ path, message: 'marker flags are display-only; kept as blocking' });
    }
    if (entry.span) definition.nonWorking.push(entry.span);
  });

  readDatedList(source['events'], 'events', diagnostics, (entry, path) => {
    if (entry.rrule !== undefined) {
      definition.recurringEvents.push({ rrule: entry.rrule, name: entry.name });
      return;
    }
    if (!entry.span) return;
    if (entry.marker) {
      if (dayCountOf(entry.span) > 1) {
        diagnostics.push({ path, message: 'a marker is a single date; range kept as display span' });
        definition.events.push(entry.span);
        return;
      }
      definition.markers.push({ date: entry.span.startDate, name: entry.name });
      return;
    }
    definition.events.push(entry.span);
  });

  return definition;
}

function parseCalendarSet(source: Record<string, unknown>): CalendarSetDefinition {
  const diagnostics: CalendarDiagnostic[] = [];
  const members: string[] = [];
  const raw = source['calendars'];
  if (Array.isArray(raw)) {
    raw.forEach((member, index) => {
      if (typeof member === 'string' && /^\[\[.+\]\]$/.test(member.trim())) {
        members.push(member.trim());
      } else {
        diagnostics.push({ path: `calendars[${index}]`, message: 'set members must be wikilinks' });
      }
    });
  } else if (raw !== undefined && raw !== null) {
    diagnostics.push({ path: 'calendars', message: 'expected a list of wikilinks' });
  }
  return {
    kind: 'calendar-set',
    description: readOptionalString(source['description']),
    color: readOptionalString(source['color']),
    members,
    diagnostics,
  };
}

function readPattern(source: Record<string, unknown>, reasons: string[]): string | undefined {
  const raw = source['pattern'];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string' || raw.trim() === '') {
    reasons.push('pattern must be a literal RRULE string');
    return undefined;
  }
  const pattern = raw.trim();
  if (!HAS_FREQ.test(pattern)) {
    reasons.push('pattern is not a valid RRULE: missing FREQ');
    return undefined;
  }
  return pattern;
}

function readTimezone(raw: unknown, diagnostics: CalendarDiagnostic[]): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string' || raw.trim() === '') {
    diagnostics.push({ path: 'timezone', message: 'timezone must be an IANA zone name' });
    return undefined;
  }
  const zone = raw.trim();
  // Constructor probe is alias- and case-tolerant where a canonical-list
  // membership check is not; the authored string is stored verbatim.
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: zone });
    return zone;
  } catch {
    diagnostics.push({ path: 'timezone', message: `unknown IANA zone: ${zone}` });
    return undefined;
  }
}

function readHoursList(
  raw: unknown,
  path: string,
  diagnostics: CalendarDiagnostic[],
): TimeRange[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    diagnostics.push({ path, message: 'expected a list of HH:MM-HH:MM ranges' });
    return [];
  }
  const ranges: TimeRange[] = [];
  raw.forEach((value, index) => {
    const range = typeof value === 'string' ? parseHoursRange(value.trim()) : undefined;
    if (range) {
      ranges.push(range);
    } else {
      diagnostics.push({ path: `${path}[${index}]`, message: 'expected HH:MM-HH:MM with start before end' });
    }
  });
  return ranges;
}

function parseHoursRange(value: string): TimeRange | undefined {
  if (!HOURS_RANGE.test(value)) return undefined;
  const [start, end] = value.split('-') as [string, string];
  return start < end ? { start, end } : undefined;
}

function readAvailability(raw: unknown, diagnostics: CalendarDiagnostic[]): AvailabilityBlock[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    diagnostics.push({ path: 'availability', message: 'expected a list of {pattern, hours} blocks' });
    return [];
  }
  const blocks: AvailabilityBlock[] = [];
  raw.forEach((value, index) => {
    const path = `availability[${index}]`;
    if (typeof value !== 'object' || value === null) {
      diagnostics.push({ path, message: 'expected a {pattern, hours} block' });
      return;
    }
    const block = value as Record<string, unknown>;
    const pattern = typeof block['pattern'] === 'string' ? block['pattern'].trim() : '';
    if (!HAS_FREQ.test(pattern)) {
      diagnostics.push({ path, message: 'block pattern is not a valid RRULE: missing FREQ' });
      return;
    }
    const hours = readHoursList(block['hours'], `${path}.hours`, diagnostics);
    blocks.push({ pattern, hours });
  });
  return blocks;
}

interface DatedEntry {
  span: DatedSpan | undefined;
  rrule: string | undefined;
  name: string | undefined;
  marker: boolean;
}

function readDatedList(
  raw: unknown,
  path: string,
  diagnostics: CalendarDiagnostic[],
  consume: (entry: DatedEntry, path: string) => void,
): void {
  if (raw === undefined || raw === null) return;
  if (!Array.isArray(raw)) {
    diagnostics.push({ path, message: 'expected a list of dated entries' });
    return;
  }
  raw.forEach((value, index) => {
    const entryPath = `${path}[${index}]`;
    const entry = readDatedEntry(value);
    if (!entry) {
      diagnostics.push({ path: entryPath, message: 'expected a date, {date}, {start, end}, or {pattern} entry' });
      return;
    }
    consume(entry, entryPath);
  });
}

function readDatedEntry(value: unknown): DatedEntry | undefined {
  const bare = toIsoDate(value);
  if (bare !== undefined) {
    return { span: oneDaySpan(bare, undefined), rrule: undefined, name: undefined, marker: false };
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const entry = value as Record<string, unknown>;
  const name = readOptionalString(entry['name']);
  const marker = entry['marker'] === true;

  const rruleSource = entry['pattern'] ?? entry['rrule'];
  const rrule = typeof rruleSource === 'string' ? rruleSource.trim() : undefined;
  if (rrule !== undefined) {
    if (!HAS_FREQ.test(rrule)) return undefined;
    return { span: undefined, rrule, name, marker };
  }

  const date = toIsoDate(entry['date']);
  if (date !== undefined) return { span: oneDaySpan(date, name), rrule: undefined, name, marker };

  const start = toIsoDate(entry['start']);
  const end = toIsoDate(entry['end']);
  if (start !== undefined && end !== undefined && start <= end) {
    return {
      span: { startDate: start, endDateExclusive: addDaysIso(end, 1), name },
      rrule: undefined,
      name,
      marker,
    };
  }
  return undefined;
}

function oneDaySpan(date: string, name: string | undefined): DatedSpan {
  return { startDate: date, endDateExclusive: addDaysIso(date, 1), name };
}

function dayCountOf(span: DatedSpan): number {
  const start = isoToUtcMs(span.startDate);
  const end = isoToUtcMs(span.endDateExclusive);
  return Math.round((end - start) / 86_400_000);
}

function toIsoDate(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!ISO_DATE.test(text)) return undefined;
  return Number.isNaN(isoToUtcMs(text)) ? undefined : text;
}

export function addDaysIso(date: string, days: number): string {
  const shifted = new Date(isoToUtcMs(date) + days * 86_400_000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isoToUtcMs(date: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day);
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function readOptionalIsoDate(value: unknown): string | undefined {
  return toIsoDate(value);
}
