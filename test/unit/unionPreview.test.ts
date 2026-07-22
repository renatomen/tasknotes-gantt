/**
 * The calendar-set union model: a day blocks in the union when any member
 * blocks it, events/markers union across members, and conflicts are the
 * disagreements (one member blocks while another covers). These are the
 * day-facts every set preview tab renders, so they are pinned here.
 */
import { describe, expect, it } from '@jest/globals';
import { parseCalendarFrontmatter, type CalendarDefinition } from '../../src/controller/calendar/schema';
import type { EvaluationWindow } from '../../src/controller/calendar/patternWindow';
import { buildUnionModel, classifyMember } from '../../src/editor/unionPreview';

/** Parse a frontmatter object to a CalendarDefinition (throws on a non-calendar). */
function calendar(frontmatter: Record<string, unknown>): CalendarDefinition {
  const parsed = parseCalendarFrontmatter({ tngantt: 'calendar', ...frontmatter });
  if (parsed === null || parsed.kind !== 'calendar') throw new Error('fixture is not a calendar');
  return parsed;
}

// A Monday-aligned week: Mon 2026-01-05 .. Sun 2026-01-11.
const WEEK: EvaluationWindow = { startDate: '2026-01-05', endDateExclusive: '2026-01-12' };
const SAT = '2026-01-10';
const SUN = '2026-01-11';

describe('buildUnionModel', () => {
  it('flags a day one member blocks and another covers as a conflict', () => {
    const weekdays = calendar({ pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' }); // blocks Sat + Sun
    const withSaturday = calendar({ pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA' }); // works Sat, blocks Sun
    const model = buildUnionModel([weekdays, withSaturday], WEEK);

    expect(model.conflicts.has(SAT)).toBe(true); // one blocks, one covers
    expect(model.conflicts.has(SUN)).toBe(false); // both block — agreement, not conflict
    expect(model.blocking.days.has(SAT)).toBe(true); // blocking in the union (weekdays member)
    expect(model.blocking.days.has(SUN)).toBe(true);
  });

  it('unions event days across members including recurring occurrences, deduped', () => {
    const oneOff = calendar({ events: [{ date: SAT, name: 'Party' }] });
    const recurring = calendar({
      // A recurring event every Saturday — same date as the one-off, must dedupe.
      recurring_events: [{ rrule: 'FREQ=WEEKLY;BYDAY=SA', name: 'Market' }],
    });
    const model = buildUnionModel([oneOff, recurring], WEEK);

    expect(model.events.days.has(SAT)).toBe(true);
    expect([...model.events.days].filter((d) => d === SAT)).toHaveLength(1); // a Set dedupes
  });

  it('reports no conflicts for a single member', () => {
    const only = calendar({ pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' });
    const model = buildUnionModel([only], WEEK);
    expect(model.conflicts.size).toBe(0);
    expect(model.blocking.days.has(SAT)).toBe(true);
  });

  it('yields empty facts for an empty set', () => {
    const model = buildUnionModel([], WEEK);
    expect(model.blocking.days.size).toBe(0);
    expect(model.events.days.size).toBe(0);
    expect(model.markers.days.size).toBe(0);
    expect(model.conflicts.size).toBe(0);
  });

  it('finds every disagreeing day across a full-year window', () => {
    const weekdays = calendar({ pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' }); // works Mon–Fri
    const sunThu = calendar({ pattern: 'FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH' }); // works Sun–Thu
    const YEAR: EvaluationWindow = { startDate: '2026-01-01', endDateExclusive: '2027-01-01' };
    const model = buildUnionModel([weekdays, sunThu], YEAR);
    // They disagree on every Friday and every Sunday of 2026 (~104 days).
    expect(model.conflicts.size).toBeGreaterThan(90);
  });

  it('never conflicts with an events-only member (events do not block)', () => {
    const weekdays = calendar({ pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' });
    const eventsOnly = calendar({ events: [{ date: SAT, name: 'Note' }] }); // no pattern → covers nothing
    const model = buildUnionModel([weekdays, eventsOnly], WEEK);
    expect(model.conflicts.size).toBe(0);
  });
});

describe('classifyMember', () => {
  const calendarFm = { name: 'Cal', frontmatter: { tngantt: 'calendar', pattern: 'FREQ=WEEKLY;BYDAY=MO' } };

  it('is unresolved when the link resolves to no file', () => {
    expect(classifyMember('[[Missing]]', () => null)).toEqual({ kind: 'unresolved' });
  });

  it('is ok with the note name and parsed definition for a valid calendar', () => {
    const result = classifyMember('[[Cal]]', () => calendarFm);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.name).toBe('Cal');
      expect(result.definition.kind).toBe('calendar');
    }
  });

  it('is invalid for a calendar-set member (sets are flat)', () => {
    expect(
      classifyMember('[[Set]]', () => ({ name: 'Set', frontmatter: { tngantt: 'calendar-set' } })),
    ).toEqual({ kind: 'invalid' });
  });

  it('is invalid for a non-calendar or unmarked note', () => {
    expect(classifyMember('[[Doc]]', () => ({ name: 'Doc', frontmatter: { title: 'x' } }))).toEqual({
      kind: 'invalid',
    });
  });

  it('strips a subpath before resolving the link', () => {
    let seen = '';
    classifyMember('[[Cal#heading]]', (link) => {
      seen = link;
      return calendarFm;
    });
    expect(seen).toBe('[[Cal]]');
  });
});

describe('buildUnionModel conflict attribution', () => {
  it('names each disagreeing member, using its label or the date when it has none', () => {
    // NZ Holidays blocks 2026-01-02 as a named holiday; Weekdays covers it (works).
    const holidays = calendar({ non_working: [{ date: '2026-01-02', name: 'Matariki' }] });
    const weekdays = calendar({ pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' });
    const window: EvaluationWindow = { startDate: '2026-01-01', endDateExclusive: '2026-01-05' };
    const model = buildUnionModel([holidays, weekdays], window, ['NZ Holidays', 'Weekdays']);

    expect(model.conflicts.has('2026-01-02')).toBe(true);
    expect(model.conflictSources.get('2026-01-02')).toEqual([
      { calendar: 'NZ Holidays', description: 'Matariki' }, // blocker, with its holiday name
      { calendar: 'Weekdays', description: undefined }, // coverer, no label — tooltip uses the date
    ]);
  });

  it('leaves conflict attribution empty when no member names are supplied', () => {
    const holidays = calendar({ non_working: [{ date: '2026-01-02', name: 'Matariki' }] });
    const weekdays = calendar({ pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' });
    const window: EvaluationWindow = { startDate: '2026-01-01', endDateExclusive: '2026-01-05' };
    const model = buildUnionModel([holidays, weekdays], window);
    expect(model.conflictSources.size).toBe(0);
  });
});
