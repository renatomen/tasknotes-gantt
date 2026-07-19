import { parseCalendarFrontmatter, type CalendarDefinition } from '../../src/controller/calendar/schema';
import {
  fromRfcCalendar,
  toRfcCalendar,
  type RfcDatedProperty,
} from '../../src/controller/calendar/rfcMapping';

const authored = {
  tngantt: 'calendar',
  description: 'Mon-Fri 9-17, NZ public holidays',
  color: '#2a9d8f',
  pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  pattern_start: '2026-01-05',
  working_hours: ['09:00-17:00'],
  timezone: 'Pacific/Auckland',
  availability: [
    { pattern: 'FREQ=WEEKLY;BYDAY=TU,TH', hours: ['09:00-17:00'] },
    { pattern: 'FREQ=WEEKLY;BYDAY=MO,WE,FR', hours: ['09:00-12:00'] },
  ],
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

function definition(): CalendarDefinition {
  const parsed = parseCalendarFrontmatter(authored);
  if (parsed?.kind !== 'calendar') throw new Error('fixture must parse as a calendar');
  return parsed;
}

function allDatedProperties(model: ReturnType<typeof toRfcCalendar>): RfcDatedProperty[] {
  const properties: RfcDatedProperty[] = [];
  for (const event of model.events) {
    if (event.dtstart) properties.push(event.dtstart);
    if (event.dtend) properties.push(event.dtend);
  }
  if (model.availability) {
    for (const block of model.availability.available) {
      if (block.dtstart) properties.push(block.dtstart);
    }
  }
  return properties;
}

describe('toRfcCalendar', () => {
  it('maps blocking spans to opaque events and display-only entries to transparent events', () => {
    const model = toRfcCalendar(definition());
    const opaque = model.events.filter((event) => event.transparency === 'OPAQUE');
    const transparent = model.events.filter((event) => event.transparency === 'TRANSPARENT');
    expect(opaque).toHaveLength(3);
    expect(transparent).toHaveLength(3);
  });

  it('marks marker entries with the marker flag on a transparent event', () => {
    const model = toRfcCalendar(definition());
    const markers = model.events.filter((event) => event.marker);
    expect(markers).toHaveLength(1);
    expect(markers[0]?.transparency).toBe('TRANSPARENT');
    expect(markers[0]?.summary).toBe('v1.0 release');
  });

  it('preserves exclusive DTEND semantics for authored inclusive ranges', () => {
    const model = toRfcCalendar(definition());
    const shutdown = model.events.find((event) => event.summary === 'Summer shutdown');
    expect(shutdown?.dtstart.value).toBe('2026-12-29');
    expect(shutdown?.dtend?.value).toBe('2027-01-03');
  });

  it('maps the working pattern and per-day blocks to AVAILABLE components with rrules', () => {
    const model = toRfcCalendar(definition());
    expect(model.availability?.available.map((block) => block.rrule)).toEqual([
      'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      'FREQ=WEEKLY;BYDAY=TU,TH',
      'FREQ=WEEKLY;BYDAY=MO,WE,FR',
    ]);
  });

  it('carries a recurring display-only event with its rrule', () => {
    const model = toRfcCalendar(definition());
    const recurring = model.events.find((event) => event.rrule);
    expect(recurring?.rrule).toBe('FREQ=WEEKLY;BYDAY=SA,SU');
    expect(recurring?.transparency).toBe('TRANSPARENT');
  });

  it('never attaches a TZID parameter to any DATE-valued property (RFC 5545 3.2.19)', () => {
    const model = toRfcCalendar(definition());
    for (const property of allDatedProperties(model)) {
      if (property.valueType === 'DATE') {
        expect(property.tzid).toBeUndefined();
      }
    }
  });

  it('keeps the calendar timezone at component level only', () => {
    const model = toRfcCalendar(definition());
    expect(model.timezone).toBe('Pacific/Auckland');
  });
});

describe('round-trip', () => {
  it('round-trips every authored construct through the RFC model unchanged', () => {
    const original = definition();
    const back = fromRfcCalendar(toRfcCalendar(original));
    expect(back.description).toBe(original.description);
    expect(back.color).toBe(original.color);
    expect(back.pattern).toBe(original.pattern);
    expect(back.patternStart).toBe(original.patternStart);
    expect(back.timezone).toBe(original.timezone);
    expect(back.workingHours).toEqual(original.workingHours);
    expect(back.availability).toEqual(original.availability);
    expect(back.nonWorking).toEqual(original.nonWorking);
    expect(back.events).toEqual(original.events);
    expect(back.markers).toEqual(original.markers);
    expect(back.recurringEvents).toEqual(original.recurringEvents);
  });

  it('round-trips an availability-only calendar without inventing a uniform pattern', () => {
    const parsed = parseCalendarFrontmatter({
      tngantt: 'calendar',
      availability: [
        { pattern: 'FREQ=WEEKLY;BYDAY=TU,TH', hours: ['09:00-17:00'] },
        { pattern: 'FREQ=WEEKLY;BYDAY=MO,WE,FR', hours: ['09:00-12:00'] },
      ],
    });
    if (parsed?.kind !== 'calendar') throw new Error('fixture must parse');
    const back = fromRfcCalendar(toRfcCalendar(parsed));
    expect(back.pattern).toBeUndefined();
    expect(back.workingHours).toEqual([]);
    expect(back.availability).toEqual(parsed.availability);
  });

  it('round-trips a minimal date-only calendar', () => {
    const parsed = parseCalendarFrontmatter({ tngantt: 'calendar', non_working: ['2026-12-25'] });
    if (parsed?.kind !== 'calendar') throw new Error('fixture must parse');
    const back = fromRfcCalendar(toRfcCalendar(parsed));
    expect(back.nonWorking).toEqual(parsed.nonWorking);
    expect(back.pattern).toBeUndefined();
    expect(back.timezone).toBeUndefined();
  });
});
