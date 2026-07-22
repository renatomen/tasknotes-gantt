import { describe, expect, it } from '@jest/globals';
import { parseCalendarFrontmatter, type CalendarDefinition } from '../../src/controller/calendar/schema';
import {
  buildCalendarNotice,
  conflictDates,
  conflictsFromFacts,
} from '../../src/bases/calendarConflicts';

const WINDOW = { startDate: '2026-04-06', endDateExclusive: '2026-04-13' }; // Mon..Sun

function calendar(frontmatter: Record<string, unknown>): CalendarDefinition {
  const parsed = parseCalendarFrontmatter({ tngantt: 'calendar', ...frontmatter });
  if (parsed?.kind !== 'calendar') throw new Error('fixture is not a valid calendar');
  return parsed;
}

const monToFri = calendar({ pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' });
const sunToThu = calendar({ pattern: 'FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH' });

describe('conflictDates', () => {
  it('flags a day exactly when one calendar blocks it and another pattern covers it', () => {
    // Fri 2026-04-10: Mon–Fri works, Sun–Thu blocks. Sun 2026-04-12: reverse.
    // Sat 2026-04-11: both block — agreement, no conflict.
    expect(conflictDates([monToFri, sunToThu], WINDOW)).toEqual(['2026-04-10', '2026-04-12']);
  });

  it('a single calendar can never conflict with itself', () => {
    expect(conflictDates([monToFri], WINDOW)).toEqual([]);
  });

  it('a dated non-working entry conflicts with another calendar covering that day', () => {
    const withHoliday = calendar({
      pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      non_working: ['2026-04-08'],
    });
    expect(conflictDates([monToFri, withHoliday], WINDOW)).toEqual(['2026-04-08']);
  });

  it('a calendar without a working pattern never covers (only blocks)', () => {
    const datedOnly = calendar({ non_working: ['2026-04-07'] });
    // datedOnly blocks Tue; monToFri's pattern covers Tue → conflict on Tue.
    // monToFri blocks the weekend, but datedOnly has no pattern → no cover → no conflict.
    expect(conflictDates([monToFri, datedOnly], WINDOW)).toEqual(['2026-04-07']);
  });

  it('display-only events never block, so they cannot conflict', () => {
    const withEvent = calendar({
      pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      events: ['2026-04-09'],
    });
    expect(conflictDates([monToFri, withEvent], WINDOW)).toEqual([]);
  });
});

describe('conflictsFromFacts', () => {
  it('flags a day one facts-set blocks while another covers, ignoring shared blocks', () => {
    // #1 blocks Sat+Sun (covers the rest); #2 blocks Fri+Sat (covers the rest).
    // Fri: blocked by #2, covered by #1 -> conflict. Sun: reverse. Sat: both block -> none.
    const facts = [
      { blocked: new Set(['2026-04-11', '2026-04-12']), covers: true },
      { blocked: new Set(['2026-04-10', '2026-04-11']), covers: true },
    ];
    expect(conflictsFromFacts(facts, WINDOW)).toEqual(['2026-04-10', '2026-04-12']);
  });

  it('is the shared core of conflictDates (same result for the same calendars)', () => {
    const viaFacts = conflictsFromFacts(
      [
        { blocked: new Set(['2026-04-11', '2026-04-12']), covers: true }, // Mon–Fri
        { blocked: new Set(['2026-04-10', '2026-04-11']), covers: true }, // Sun–Thu
      ],
      WINDOW,
    );
    expect(viaFacts).toEqual(conflictDates([monToFri, sunToThu], WINDOW));
  });

  it('a facts-set that covers nothing only blocks, never conflicts', () => {
    const facts = [{ blocked: new Set(['2026-04-07']), covers: false }];
    expect(conflictsFromFacts(facts, WINDOW)).toEqual([]);
  });
});

describe('buildCalendarNotice', () => {
  const base = { displayedCount: 0, conflictCount: 0, invalidCount: 0, flaggedCount: 0 };

  it('is silent for a single healthy calendar', () => {
    expect(buildCalendarNotice({ ...base, displayedCount: 1 })).toBeNull();
  });

  it('names the year on the conflict count when a conflict year is given', () => {
    expect(
      buildCalendarNotice({ ...base, displayedCount: 2, conflictCount: 3, conflictYear: 2026 }),
    ).toBe('Displaying 2 calendars · 3 days in conflict in 2026');
  });

  it('warns that conflicts exist elsewhere when the counted window has none', () => {
    expect(buildCalendarNotice({ ...base, conflictCount: 0, conflictsElsewhere: true })).toBe(
      'conflicts exist in other years',
    );
  });

  it('prefers the counted conflicts over the elsewhere note when both hold', () => {
    expect(
      buildCalendarNotice({ ...base, conflictCount: 2, conflictYear: 2026, conflictsElsewhere: true }),
    ).toBe('2 days in conflict in 2026');
  });

  it('appears from two displayed calendars up', () => {
    expect(buildCalendarNotice({ ...base, displayedCount: 2 })).toBe('Displaying 2 calendars');
  });

  it('reports conflicts, invalid notes, and unresolved links', () => {
    expect(
      buildCalendarNotice({ displayedCount: 2, conflictCount: 1, invalidCount: 2, flaggedCount: 1 }),
    ).toBe('Displaying 2 calendars · 1 day in conflict · 2 invalid calendar notes · 1 selected link unresolved');
  });

  it('surfaces problems even with a single displayed calendar', () => {
    expect(buildCalendarNotice({ ...base, displayedCount: 1, invalidCount: 1 })).toBe(
      '1 invalid calendar note',
    );
  });
});

describe('self-conflict immunity', () => {
  it('a calendar whose dated holiday falls on its own covered day never conflicts alone', () => {
    const withHolidayOnWorkday = calendar({
      pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      non_working: ['2026-04-08'],
    });
    expect(conflictDates([withHolidayOnWorkday], WINDOW)).toEqual([]);
  });

  it('an invalid pattern covers nothing, so it cannot manufacture a conflict', () => {
    const invalidPattern = calendar({ pattern: 'FREQ=NONSENSE', non_working: ['2026-04-08'] });
    // It still blocks its dated day, but contributes no coverage of its own.
    expect(conflictDates([invalidPattern], WINDOW)).toEqual([]);
  });
});
