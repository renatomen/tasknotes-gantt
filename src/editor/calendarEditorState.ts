/**
 * The pure form state behind the calendar editor: a flat, editable projection
 * of a calendar (or set) note's frontmatter, with dirty tracking, inline field
 * validation, and a change set targeted at {@link editFrontmatterKeys}.
 *
 * The form maps to the note's FRONTMATTER keys, not the parsed definition —
 * so what the user edits is what gets written back, and a save touches only
 * the keys that actually changed.
 *
 * Availability blocks are the one shape the form does not decompose yet; they
 * pass through untouched so a save never drops them.
 *
 * @module editor/calendarEditorState
 */

import { isSafeColor } from '../bases/barTreatment';
import type { FrontmatterValue } from './frontmatterEdit';

export interface DatedEntry {
  date: string;
  name: string;
  /** Display-marker flag (events); preserved so an edit never demotes a marker. */
  marker?: boolean;
  /**
   * Verbatim source for an entry the form does not decompose — a `{start, end}`
   * range, an rrule entry — so a save round-trips it untouched rather than
   * dropping it.
   */
  raw?: unknown;
}

export interface EditorFormState {
  kind: 'calendar' | 'calendar-set';
  description: string;
  color: string;
  pattern: string;
  patternStart: string;
  timezone: string;
  workingHours: string[];
  nonWorking: DatedEntry[];
  events: DatedEntry[];
  members: string[];
  /** Availability blocks, carried verbatim so a save cannot drop them. */
  availabilityRaw: unknown;
}

const HAS_FREQ = /(^|;)\s*FREQ=/i;
const ANCHORED = /(^|;)\s*(INTERVAL|COUNT|UNTIL)=/i;
const HOURS_RANGE = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

export function formFromFrontmatter(frontmatter: Record<string, unknown>): EditorFormState {
  const kind = String(frontmatter.tngantt).trim().toLowerCase() === 'calendar-set'
    ? 'calendar-set'
    : 'calendar';
  return {
    kind,
    description: readString(frontmatter.description),
    color: readString(frontmatter.color),
    pattern: readString(frontmatter.pattern),
    patternStart: readString(frontmatter.pattern_start),
    timezone: readString(frontmatter.timezone),
    workingHours: readStringList(frontmatter.working_hours),
    nonWorking: readDatedList(frontmatter.non_working),
    events: readDatedList(frontmatter.events),
    members: readStringList(frontmatter.calendars),
    availabilityRaw: frontmatter.availability,
  };
}

export function isDirty(original: EditorFormState, current: EditorFormState): boolean {
  return Object.keys(changedFrontmatter(original, current)).length > 0;
}

/**
 * The frontmatter keys whose serialized value differs, ready for
 * {@link editFrontmatterKeys}. A field cleared to empty writes `undefined`
 * (removing the key); an unchanged field is omitted entirely.
 */
export function changedFrontmatter(
  original: EditorFormState,
  current: EditorFormState,
): Record<string, FrontmatterValue> {
  const changes: Record<string, FrontmatterValue> = {};
  const put = (key: string, before: FrontmatterValue, after: FrontmatterValue): void => {
    if (JSON.stringify(before) !== JSON.stringify(after)) changes[key] = after;
  };

  put('description', scalarOrUndefined(original.description), scalarOrUndefined(current.description));
  put('color', scalarOrUndefined(original.color), scalarOrUndefined(current.color));
  put('pattern', scalarOrUndefined(original.pattern), scalarOrUndefined(current.pattern));
  put('pattern_start', scalarOrUndefined(original.patternStart), scalarOrUndefined(current.patternStart));
  put('timezone', scalarOrUndefined(original.timezone), scalarOrUndefined(current.timezone));
  put('working_hours', original.workingHours, current.workingHours);
  put('non_working', datedForWrite(original.nonWorking), datedForWrite(current.nonWorking));
  put('events', datedForWrite(original.events), datedForWrite(current.events));
  if (current.kind === 'calendar-set') put('calendars', original.members, current.members);
  return changes;
}

export interface FieldErrors {
  color?: string;
  pattern?: string;
  patternStart?: string;
  timezone?: string;
  workingHours?: string;
}

/** Inline validation, wording mirroring the schema's fail-visible messages (R26). */
export function fieldErrors(form: EditorFormState): FieldErrors {
  const errors: FieldErrors = {};
  if (form.color !== '' && !isSafeColor(form.color)) {
    errors.color = 'Not a usable colour';
  }
  if (form.pattern !== '' && !HAS_FREQ.test(form.pattern)) {
    errors.pattern = 'Pattern is not a valid RRULE: missing FREQ';
  }
  if (form.pattern !== '' && ANCHORED.test(form.pattern) && form.patternStart === '') {
    errors.patternStart = 'INTERVAL/COUNT/UNTIL needs a pattern_start anchor date';
  }
  if (form.timezone !== '' && !isValidTimezone(form.timezone)) {
    errors.timezone = `Unknown IANA zone: ${form.timezone}`;
  }
  if (form.workingHours.some((range) => !isValidHoursRange(range))) {
    errors.workingHours = 'Expected HH:MM-HH:MM with start before end';
  }
  return errors;
}

function scalarOrUndefined(value: string): string | undefined {
  return value.trim() === '' ? undefined : value;
}

/**
 * Serialize the dated entries for a save. An undecomposed entry round-trips
 * verbatim; a simple one drops an empty name and preserves a marker flag.
 */
function datedForWrite(entries: DatedEntry[]): unknown[] {
  return entries.map((entry) => {
    if (entry.raw !== undefined) return entry.raw;
    const record: Record<string, unknown> = { date: entry.date };
    if (entry.name.trim() !== '') record.name = entry.name;
    if (entry.marker === true) record.marker = true;
    return record;
  });
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function readDatedList(value: unknown): DatedEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === 'string') return { date: item, name: '' };
    const record = item as { date?: unknown; name?: unknown; marker?: unknown };
    // Only a simple single-date entry is editable in the form; anything else
    // (a {start, end} range, an rrule) round-trips verbatim so it is not lost.
    const isSimple =
      item !== null &&
      typeof item === 'object' &&
      typeof record.date === 'string' &&
      !('start' in record) &&
      !('pattern' in record) &&
      !('rrule' in record);
    if (!isSimple) return { date: '', name: '', raw: item };
    const entry: DatedEntry = {
      date: record.date as string,
      name: typeof record.name === 'string' ? record.name : '',
    };
    if (record.marker === true) entry.marker = true;
    return entry;
  });
}

/** A well-formed HH:MM-HH:MM range whose start is strictly before its end. */
function isValidHoursRange(range: string): boolean {
  if (!HOURS_RANGE.test(range)) return false;
  const [start, end] = range.split('-');
  return (start as string) < (end as string);
}

function isValidTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
