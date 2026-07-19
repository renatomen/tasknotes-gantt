import {
  matchesCalendarMarker,
  parseCalendarFrontmatter,
  type CalendarDefinition,
  type CalendarSetDefinition,
  type InvalidDefinition,
} from '../../src/controller/calendar/schema';

const fullCalendar = {
  tngantt: 'calendar',
  description: 'Mon-Fri 9-17, NZ public holidays',
  color: '#2a9d8f',
  pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  working_hours: ['09:00-17:00'],
  timezone: 'Pacific/Auckland',
  non_working: [
    '2026-12-25',
    { date: '2026-02-06', name: 'Waitangi Day' },
    { start: '2026-12-29', end: '2027-01-02', name: 'Summer shutdown' },
  ],
  events: [
    { date: '2026-04-10', name: 'Good Friday' },
    { date: '2026-08-30', name: 'v1.0 release', marker: true },
    { pattern: 'FREQ=WEEKLY;BYDAY=SA,SU', name: 'Weekend' },
  ],
};

function parseCalendar(frontmatter: Record<string, unknown>): CalendarDefinition {
  const parsed = parseCalendarFrontmatter(frontmatter);
  if (parsed?.kind !== 'calendar') throw new Error(`expected calendar, got ${parsed?.kind}`);
  return parsed;
}

function parseInvalid(frontmatter: Record<string, unknown>): InvalidDefinition {
  const parsed = parseCalendarFrontmatter(frontmatter);
  if (parsed?.kind !== 'invalid') throw new Error(`expected invalid, got ${parsed?.kind}`);
  return parsed;
}

describe('matchesCalendarMarker', () => {
  it('matches calendar and calendar-set markers with trimming and case tolerance', () => {
    expect(matchesCalendarMarker({ tngantt: 'calendar' })).toBe('calendar');
    expect(matchesCalendarMarker({ tngantt: '  Calendar ' })).toBe('calendar');
    expect(matchesCalendarMarker({ tngantt: 'CALENDAR-SET' })).toBe('calendar-set');
  });

  it('returns null for absent, unrelated, or non-string markers', () => {
    expect(matchesCalendarMarker({})).toBeNull();
    expect(matchesCalendarMarker({ tngantt: 'kanban' })).toBeNull();
    expect(matchesCalendarMarker({ tngantt: 7 })).toBeNull();
    expect(matchesCalendarMarker(undefined)).toBeNull();
  });
});

describe('parseCalendarFrontmatter — calendars', () => {
  it('returns null for a note without the marker', () => {
    expect(parseCalendarFrontmatter({ title: 'not a calendar' })).toBeNull();
  });

  it('parses a full calendar with every field populated', () => {
    const cal = parseCalendar(fullCalendar);
    expect(cal.description).toBe('Mon-Fri 9-17, NZ public holidays');
    expect(cal.color).toBe('#2a9d8f');
    expect(cal.pattern).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    expect(cal.timezone).toBe('Pacific/Auckland');
    expect(cal.workingHours).toEqual([{ start: '09:00', end: '17:00' }]);
    expect(cal.nonWorking).toHaveLength(3);
    expect(cal.events).toHaveLength(1);
    expect(cal.markers).toEqual([{ date: '2026-08-30', name: 'v1.0 release' }]);
    expect(cal.recurringEvents).toEqual([{ rrule: 'FREQ=WEEKLY;BYDAY=SA,SU', name: 'Weekend' }]);
    expect(cal.diagnostics).toEqual([]);
  });

  it('turns a bare date into a one-day blocking span with an exclusive end', () => {
    const cal = parseCalendar({ tngantt: 'calendar', non_working: ['2026-12-25'] });
    expect(cal.nonWorking).toEqual([
      { startDate: '2026-12-25', endDateExclusive: '2026-12-26', name: undefined },
    ]);
  });

  it('maps an inclusive authored range end to an exclusive DTEND-style end', () => {
    const cal = parseCalendar({
      tngantt: 'calendar',
      non_working: [{ start: '2026-12-29', end: '2027-01-02', name: 'Summer shutdown' }],
    });
    expect(cal.nonWorking).toEqual([
      { startDate: '2026-12-29', endDateExclusive: '2027-01-03', name: 'Summer shutdown' },
    ]);
  });

  it('accepts Date instances from the frontmatter parser as UTC calendar days', () => {
    const cal = parseCalendar({
      tngantt: 'calendar',
      non_working: [new Date(Date.UTC(2026, 11, 25))],
    });
    expect(cal.nonWorking[0]).toEqual({
      startDate: '2026-12-25',
      endDateExclusive: '2026-12-26',
      name: undefined,
    });
  });

  it('treats a calendar with no pattern as a seven-day working week (pattern absent, still valid)', () => {
    const cal = parseCalendar({ tngantt: 'calendar', non_working: ['2026-12-25'] });
    expect(cal.pattern).toBeUndefined();
    expect(cal.diagnostics).toEqual([]);
  });

  it('drops a malformed dated entry with a diagnostic while the calendar stays valid', () => {
    const cal = parseCalendar({
      tngantt: 'calendar',
      non_working: ['not-a-date', '2026-12-25'],
    });
    expect(cal.nonWorking).toHaveLength(1);
    expect(cal.nonWorking[0]?.startDate).toBe('2026-12-25');
    expect(cal.diagnostics).toHaveLength(1);
    expect(cal.diagnostics[0]?.path).toBe('non_working[0]');
  });

  it('drops an entry whose range is inverted (end before start) with a diagnostic', () => {
    const cal = parseCalendar({
      tngantt: 'calendar',
      non_working: [{ start: '2027-01-02', end: '2026-12-29' }],
    });
    expect(cal.nonWorking).toHaveLength(0);
    expect(cal.diagnostics).toHaveLength(1);
  });

  it('drops a non_working entry carrying a recurring pattern, with a diagnostic (fail-visible)', () => {
    const cal = parseCalendar({
      tngantt: 'calendar',
      non_working: [{ pattern: 'FREQ=WEEKLY;BYDAY=FR' }, '2026-12-25'],
    });
    expect(cal.nonWorking).toHaveLength(1);
    expect(cal.diagnostics).toHaveLength(1);
    expect(cal.diagnostics[0]?.path).toBe('non_working[0]');
  });

  it('keeps a non_working entry carrying a marker flag as blocking, with a diagnostic', () => {
    const cal = parseCalendar({
      tngantt: 'calendar',
      non_working: [{ date: '2026-12-25', marker: true }],
    });
    expect(cal.nonWorking).toHaveLength(1);
    expect(cal.markers).toHaveLength(0);
    expect(cal.diagnostics).toHaveLength(1);
  });

  it('validates working_hours ranges and drops bad ones with diagnostics', () => {
    const cal = parseCalendar({
      tngantt: 'calendar',
      working_hours: ['09:00-12:00', '13:00-17:00', 'lunchtime', '18:00-09:00'],
    });
    expect(cal.workingHours).toEqual([
      { start: '09:00', end: '12:00' },
      { start: '13:00', end: '17:00' },
    ]);
    expect(cal.diagnostics).toHaveLength(2);
  });

  it('parses per-day availability blocks pairing a pattern with hour ranges', () => {
    const cal = parseCalendar({
      tngantt: 'calendar',
      availability: [
        { pattern: 'FREQ=WEEKLY;BYDAY=TU,TH', hours: ['09:00-17:00'] },
        { pattern: 'FREQ=WEEKLY;BYDAY=MO,WE,FR', hours: ['09:00-12:00'] },
      ],
    });
    expect(cal.availability).toHaveLength(2);
    expect(cal.availability[1]?.hours).toEqual([{ start: '09:00', end: '12:00' }]);
  });

  it('drops an availability block with an invalid pattern, keeping the rest', () => {
    const cal = parseCalendar({
      tngantt: 'calendar',
      availability: [
        { pattern: 'BYDAY=TU', hours: ['09:00-17:00'] },
        { pattern: 'FREQ=WEEKLY;BYDAY=MO', hours: ['09:00-12:00'] },
      ],
    });
    expect(cal.availability).toHaveLength(1);
    expect(cal.diagnostics).toHaveLength(1);
  });
});

describe('parseCalendarFrontmatter — timezone', () => {
  it('stores a valid zone verbatim', () => {
    const cal = parseCalendar({ tngantt: 'calendar', timezone: 'Pacific/Auckland' });
    expect(cal.timezone).toBe('Pacific/Auckland');
    expect(cal.diagnostics).toEqual([]);
  });

  it('stores a deprecated-but-valid IANA alias verbatim, never canonicalized', () => {
    const cal = parseCalendar({ tngantt: 'calendar', timezone: 'Asia/Calcutta' });
    expect(cal.timezone).toBe('Asia/Calcutta');
    expect(cal.diagnostics).toEqual([]);
  });

  it('stores a non-canonically cased zone verbatim', () => {
    const cal = parseCalendar({ tngantt: 'calendar', timezone: 'pacific/auckland' });
    expect(cal.timezone).toBe('pacific/auckland');
    expect(cal.diagnostics).toEqual([]);
  });

  it('flags and ignores an unknown zone while the calendar stays valid', () => {
    const cal = parseCalendar({ tngantt: 'calendar', timezone: 'Mars/Olympus' });
    expect(cal.timezone).toBeUndefined();
    expect(cal.diagnostics).toHaveLength(1);
    expect(cal.diagnostics[0]?.path).toBe('timezone');
  });
});

describe('parseCalendarFrontmatter — invalid calendars (fail-visible)', () => {
  it('rejects a pattern with no FREQ component', () => {
    const invalid = parseInvalid({ tngantt: 'calendar', pattern: 'BYDAY=MO,TU' });
    expect(invalid.reasons.join(' ')).toMatch(/FREQ/);
  });

  it('rejects advanced grammar (INTERVAL/COUNT/UNTIL) without a pattern_start anchor', () => {
    const invalid = parseInvalid({
      tngantt: 'calendar',
      pattern: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO',
    });
    expect(invalid.reasons.join(' ')).toMatch(/pattern_start/);
  });

  it('accepts advanced grammar when pattern_start anchors it', () => {
    const cal = parseCalendar({
      tngantt: 'calendar',
      pattern: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO',
      pattern_start: '2026-01-05',
    });
    expect(cal.patternStart).toBe('2026-01-05');
  });

  it('rejects a pattern that is not a string', () => {
    const invalid = parseInvalid({ tngantt: 'calendar', pattern: 42 });
    expect(invalid.reasons.length).toBeGreaterThan(0);
  });
});

describe('parseCalendarFrontmatter — calendar sets', () => {
  it('parses a set with wikilink members', () => {
    const parsed = parseCalendarFrontmatter({
      tngantt: 'calendar-set',
      description: 'APAC coverage',
      color: '#e76f51',
      calendars: ['[[NZ Holidays]]', '[[AU Holidays]]', '[[Birthdays]]'],
    }) as CalendarSetDefinition;
    expect(parsed.kind).toBe('calendar-set');
    expect(parsed.members).toEqual(['[[NZ Holidays]]', '[[AU Holidays]]', '[[Birthdays]]']);
    expect(parsed.diagnostics).toEqual([]);
  });

  it('flags and drops a member that is not a wikilink', () => {
    const parsed = parseCalendarFrontmatter({
      tngantt: 'calendar-set',
      calendars: ['[[NZ Holidays]]', 'plain text', 7],
    }) as CalendarSetDefinition;
    expect(parsed.members).toEqual(['[[NZ Holidays]]']);
    expect(parsed.diagnostics).toHaveLength(2);
  });

  it('treats a set with no members list as valid but empty', () => {
    const parsed = parseCalendarFrontmatter({ tngantt: 'calendar-set' }) as CalendarSetDefinition;
    expect(parsed.members).toEqual([]);
  });
});
