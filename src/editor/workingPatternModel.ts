/**
 * The working-pattern RRULE as an editable model, so the form can offer a
 * visual builder instead of raw RRULE text. Covers the shapes a working pattern
 * actually uses — daily / weekly-by-weekday / monthly-by-date / monthly-by-
 * nth-weekday. `parsePattern` returns null for anything it cannot represent
 * faithfully (e.g. yearly, complex multi-part rules), so the editor can fall
 * back to a raw text field rather than silently rewrite the rule.
 *
 * @module editor/workingPatternModel
 */

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type WeekdayCode = (typeof WEEKDAY_CODES)[number];

export interface PatternModel {
  frequency: Frequency;
  /** Repeat every N periods; >= 1. */
  interval: number;
  /** WEEKLY: the working weekdays. */
  weekdays: WeekdayCode[];
  monthlyMode: 'day-of-month' | 'nth-weekday';
  /** day-of-month: 1..31. */
  monthDay: number;
  /** nth-weekday: 1..4, or -1 for "last". */
  nthPosition: number;
  nthWeekday: WeekdayCode;
}

const WEEKDAY_SET = new Set<string>(WEEKDAY_CODES);
// The only RRULE parts the visual model represents. A rule carrying anything
// else (COUNT, UNTIL, WKST, BYMONTH, BYSETPOS…) is edited as raw text, never
// silently rewritten — parsePattern returns null so the field falls back.
const REPRESENTED_PARTS = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY']);

export function defaultPattern(): PatternModel {
  return {
    frequency: 'WEEKLY',
    interval: 1,
    weekdays: ['MO', 'TU', 'WE', 'TH', 'FR'],
    monthlyMode: 'day-of-month',
    monthDay: 1,
    nthPosition: 1,
    nthWeekday: 'MO',
  };
}

/** Parse an RRULE into the model, or null when it is not visually representable. */
export function parsePattern(rule: string): PatternModel | null {
  const parts = parseParts(rule);
  const freq = parts.get('FREQ');
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY') return null;

  // Any clause the model cannot round-trip (COUNT, UNTIL, WKST, BYMONTH…) forces
  // the raw fallback rather than a lossy edit.
  for (const key of parts.keys()) {
    if (!REPRESENTED_PARTS.has(key)) return null;
  }

  const interval = readInterval(parts.get('INTERVAL'));
  if (interval === null) return null; // an explicit invalid interval must fail visibly

  const model = defaultPattern();
  model.frequency = freq;
  model.interval = interval;

  if (freq === 'WEEKLY') {
    if (parts.has('BYMONTHDAY')) return null;
    const weekdays = readWeekdays(parts.get('BYDAY'));
    if (weekdays === null) return null;
    model.weekdays = weekdays;
    return model;
  }

  if (freq === 'MONTHLY') return parseMonthly(parts, model);

  // DAILY: only interval matters; any BY* part is beyond the visual model.
  return parts.has('BYDAY') || parts.has('BYMONTHDAY') ? null : model;
}

export function formatPattern(model: PatternModel): string {
  const parts = [`FREQ=${model.frequency}`];
  if (model.interval > 1) parts.push(`INTERVAL=${model.interval}`);

  if (model.frequency === 'WEEKLY' && model.weekdays.length > 0) {
    parts.push(`BYDAY=${model.weekdays.join(',')}`);
  } else if (model.frequency === 'MONTHLY') {
    if (model.monthlyMode === 'day-of-month') {
      parts.push(`BYMONTHDAY=${model.monthDay}`);
    } else {
      parts.push(`BYDAY=${model.nthPosition}${model.nthWeekday}`);
    }
  }
  return parts.join(';');
}

function parseMonthly(parts: Map<string, string>, model: PatternModel): PatternModel | null {
  const byMonthDay = parts.get('BYMONTHDAY');
  const byDayPart = parts.get('BYDAY');
  // A combined by-date AND by-weekday monthly rule is beyond the visual model.
  if (byMonthDay !== undefined && byDayPart !== undefined) return null;
  if (byMonthDay !== undefined) {
    const day = Number(byMonthDay);
    if (!Number.isInteger(day) || day < 1 || day > 31) return null;
    model.monthlyMode = 'day-of-month';
    model.monthDay = day;
    return model;
  }

  const byDay = parts.get('BYDAY');
  if (byDay !== undefined) {
    const match = /^(-?\d+)(MO|TU|WE|TH|FR|SA|SU)$/.exec(byDay);
    if (match === null) return null;
    model.monthlyMode = 'nth-weekday';
    model.nthPosition = Number(match[1]);
    model.nthWeekday = match[2] as WeekdayCode;
    return model;
  }
  return null;
}

function parseParts(rule: string): Map<string, string> {
  const parts = new Map<string, string>();
  for (const segment of rule.split(';')) {
    const eq = segment.indexOf('=');
    if (eq === -1) continue;
    const key = segment.slice(0, eq).trim().toUpperCase();
    const value = segment.slice(eq + 1).trim();
    if (key !== '') parts.set(key, value);
  }
  return parts;
}

/** The interval: absent means 1; an explicitly invalid value means null (reject). */
function readInterval(raw: string | undefined): number | null {
  if (raw === undefined) return 1;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 ? value : null;
}

/** Plain weekday codes, or null if any entry is positioned/unknown. */
function readWeekdays(raw: string | undefined): WeekdayCode[] | null {
  if (raw === undefined || raw === '') return null;
  const codes: WeekdayCode[] = [];
  for (const token of raw.split(',')) {
    const code = token.trim().toUpperCase();
    if (!WEEKDAY_SET.has(code)) return null;
    codes.push(code as WeekdayCode);
  }
  return codes;
}
