import { describe, expect, it } from '@jest/globals';
import {
  changedFrontmatter,
  fieldErrors,
  formFromFrontmatter,
  isDirty,
  type EditorFormState,
} from '../../src/editor/calendarEditorState';

const CALENDAR = {
  tngantt: 'calendar',
  description: 'NZ holidays',
  color: '#2a9d8f',
  pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  pattern_start: '2026-01-05',
  timezone: 'Pacific/Auckland',
  working_hours: ['09:00-17:00'],
  non_working: [{ date: '2026-04-10', name: 'Fixture Holiday' }],
};

describe('formFromFrontmatter', () => {
  it('reads every scalar and list field into the form', () => {
    const form = formFromFrontmatter(CALENDAR);
    expect(form.kind).toBe('calendar');
    expect(form.description).toBe('NZ holidays');
    expect(form.color).toBe('#2a9d8f');
    expect(form.pattern).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    expect(form.patternStart).toBe('2026-01-05');
    expect(form.timezone).toBe('Pacific/Auckland');
    expect(form.workingHours).toEqual(['09:00-17:00']);
    expect(form.nonWorking).toEqual([{ date: '2026-04-10', name: 'Fixture Holiday' }]);
  });

  it('defaults missing fields to empty rather than undefined', () => {
    const form = formFromFrontmatter({ tngantt: 'calendar' });
    expect(form.description).toBe('');
    expect(form.color).toBe('');
    expect(form.workingHours).toEqual([]);
    expect(form.nonWorking).toEqual([]);
  });

  it('reads a set note into member entries', () => {
    const form = formFromFrontmatter({
      tngantt: 'calendar-set',
      calendars: ['[[NZ Holidays]]', '[[AU Holidays]]'],
    });
    expect(form.kind).toBe('calendar-set');
    expect(form.members).toEqual(['[[NZ Holidays]]', '[[AU Holidays]]']);
  });
});

describe('isDirty', () => {
  it('is false for an untouched form', () => {
    const form = formFromFrontmatter(CALENDAR);
    expect(isDirty(form, form)).toBe(false);
  });

  it('is true once any field differs', () => {
    const original = formFromFrontmatter(CALENDAR);
    expect(isDirty(original, { ...original, description: 'Changed' })).toBe(true);
    expect(isDirty(original, { ...original, workingHours: [] })).toBe(true);
  });
});

describe('changedFrontmatter', () => {
  const original = formFromFrontmatter(CALENDAR);

  it('emits only the keys that changed', () => {
    const next: EditorFormState = { ...original, description: 'New' };
    expect(changedFrontmatter(original, next)).toEqual({ description: 'New' });
  });

  it('emits nothing for a no-op', () => {
    expect(changedFrontmatter(original, original)).toEqual({});
  });

  it('removes a scalar cleared to empty by setting it undefined', () => {
    const next: EditorFormState = { ...original, timezone: '' };
    expect(changedFrontmatter(original, next)).toEqual({ timezone: undefined });
  });

  it('serializes the list fields under their frontmatter keys', () => {
    const next: EditorFormState = {
      ...original,
      workingHours: ['09:00-12:00'],
      nonWorking: [{ date: '2026-12-25', name: 'Christmas' }],
    };
    const changes = changedFrontmatter(original, next);
    expect(changes.working_hours).toEqual(['09:00-12:00']);
    expect(changes.non_working).toEqual([{ date: '2026-12-25', name: 'Christmas' }]);
  });

  it('drops the name key from a dated entry that has none', () => {
    const next: EditorFormState = {
      ...original,
      nonWorking: [{ date: '2026-12-25', name: '' }],
    };
    expect(changedFrontmatter(original, next).non_working).toEqual([{ date: '2026-12-25' }]);
  });

  it('writes set members under the calendars key', () => {
    const set = formFromFrontmatter({ tngantt: 'calendar-set', calendars: ['[[A]]'] });
    const next: EditorFormState = { ...set, members: ['[[A]]', '[[B]]'] };
    expect(changedFrontmatter(set, next)).toEqual({ calendars: ['[[A]]', '[[B]]'] });
  });
});

describe('fieldErrors — inline validation mirroring R26', () => {
  const base = formFromFrontmatter(CALENDAR);

  it('flags an unsafe colour', () => {
    expect(fieldErrors({ ...base, color: 'url(evil)' }).color).toBeDefined();
    expect(fieldErrors(base).color).toBeUndefined();
  });

  it('flags a pattern with no FREQ', () => {
    expect(fieldErrors({ ...base, pattern: 'BYDAY=MO' }).pattern).toMatch(/FREQ/i);
  });

  it('flags an anchored pattern with no pattern_start', () => {
    const form = { ...base, pattern: 'FREQ=WEEKLY;COUNT=4', patternStart: '' };
    expect(fieldErrors(form).patternStart).toBeDefined();
  });

  it('flags a malformed working-hours range', () => {
    expect(fieldErrors({ ...base, workingHours: ['9-5'] }).workingHours).toBeDefined();
    expect(fieldErrors({ ...base, workingHours: ['09:00-17:00'] }).workingHours).toBeUndefined();
  });

  it('flags an unknown timezone but accepts a valid IANA name', () => {
    expect(fieldErrors({ ...base, timezone: 'Mars/Olympus' }).timezone).toBeDefined();
    expect(fieldErrors({ ...base, timezone: 'Pacific/Auckland' }).timezone).toBeUndefined();
    expect(fieldErrors({ ...base, timezone: '' }).timezone).toBeUndefined();
  });

  it('accepts a clean calendar with no errors', () => {
    expect(fieldErrors(base)).toEqual({});
  });
});
