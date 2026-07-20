import { describe, expect, it } from '@jest/globals';
import {
  changedFrontmatter,
  fieldErrors,
  formFromFrontmatter,
  frontmatterFromForm,
  isDirty,
  type EditorFormState,
} from '../../src/editor/calendarEditorState';
import { parseCalendarFrontmatter } from '../../src/controller/calendar/schema';

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

describe('frontmatterFromForm — live definition for the preview tabs', () => {
  it('produces frontmatter that parses back into the edited calendar', () => {
    const form = formFromFrontmatter(CALENDAR);
    const parsed = parseCalendarFrontmatter(frontmatterFromForm(form));
    expect(parsed?.kind).toBe('calendar');
    if (parsed?.kind !== 'calendar') throw new Error('expected a calendar');
    expect(parsed.pattern).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    expect(parsed.patternStart).toBe('2026-01-05');
    expect(parsed.nonWorking).toHaveLength(1);
    expect(parsed.nonWorking[0]?.startDate).toBe('2026-04-10');
  });

  it('reflects an unsaved edit without a save', () => {
    const form: EditorFormState = {
      ...formFromFrontmatter(CALENDAR),
      pattern: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
    };
    const parsed = parseCalendarFrontmatter(frontmatterFromForm(form));
    if (parsed?.kind !== 'calendar') throw new Error('expected a calendar');
    expect(parsed.pattern).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR');
  });

  it('omits empty fields and carries the set members for a set', () => {
    const setForm = formFromFrontmatter({
      tngantt: 'calendar-set',
      calendars: ['[[NZ Holidays]]'],
    });
    const frontmatter = frontmatterFromForm(setForm);
    expect(frontmatter.tngantt).toBe('calendar-set');
    expect(frontmatter.calendars).toEqual(['[[NZ Holidays]]']);
    expect(frontmatter.pattern).toBeUndefined();
    expect(frontmatter.description).toBeUndefined();
  });
});

describe('Codex-found round-trip losses', () => {
  it('preserves an event marker flag across an edit', () => {
    const original = formFromFrontmatter({
      tngantt: 'calendar',
      events: [{ date: '2026-08-30', name: 'Release', marker: true }],
    });
    expect(original.events[0]?.marker).toBe(true);
    // Add a second event; the first must keep its marker on write-back.
    const next: EditorFormState = {
      ...original,
      events: [...original.events, { date: '2026-09-01', name: 'Launch' }],
    };
    const written = changedFrontmatter(original, next).events as Array<Record<string, unknown>>;
    expect(written[0]).toEqual({ date: '2026-08-30', name: 'Release', marker: true });
  });

  it('round-trips a {start, end} range entry the form cannot decompose', () => {
    const original = formFromFrontmatter({
      tngantt: 'calendar',
      non_working: [
        { start: '2026-12-29', end: '2027-01-02', name: 'Shutdown' },
        { date: '2026-04-10' },
      ],
    });
    // The range survived as a passthrough alongside the editable simple entry.
    const next: EditorFormState = {
      ...original,
      nonWorking: [...original.nonWorking, { date: '2026-06-01', name: 'Added' }],
    };
    const written = changedFrontmatter(original, next).non_working as unknown[];
    expect(written).toContainEqual({ start: '2026-12-29', end: '2027-01-02', name: 'Shutdown' });
    expect(written).toContainEqual({ date: '2026-06-01', name: 'Added' });
  });

  it('keeps a Date-typed exception editable and reserializes it as an ISO date', () => {
    // Obsidian parses an unquoted `date: 2026-04-10` as a Date. The form must
    // normalize it, not treat it as an opaque passthrough — otherwise a later
    // list edit reserializes the Date via String() and the calendar drops it.
    const original = formFromFrontmatter({
      tngantt: 'calendar',
      non_working: [{ date: new Date(Date.UTC(2026, 3, 10)), name: 'Good Friday' }],
    });
    expect(original.nonWorking[0]).toEqual({ date: '2026-04-10', name: 'Good Friday' });
    expect(original.nonWorking[0]?.raw).toBeUndefined();

    const next: EditorFormState = {
      ...original,
      nonWorking: [...original.nonWorking, { date: '2026-06-01', name: 'Added' }],
    };
    const written = changedFrontmatter(original, next).non_working as unknown[];
    expect(written).toContainEqual({ date: '2026-04-10', name: 'Good Friday' });
  });

  it('normalizes a bare Date list item to an ISO date', () => {
    const form = formFromFrontmatter({
      tngantt: 'calendar',
      non_working: [new Date(Date.UTC(2026, 0, 1))],
    });
    expect(form.nonWorking[0]).toEqual({ date: '2026-01-01', name: '' });
  });

  it('normalizes a Date-typed pattern_start into the anchor field', () => {
    // Obsidian parses an unquoted `pattern_start: 2026-01-05` as a Date; read as
    // a bare string it would be empty, blocking every save with a missing-anchor
    // error on an INTERVAL/COUNT/UNTIL pattern.
    const form = formFromFrontmatter({
      tngantt: 'calendar',
      pattern: 'FREQ=WEEKLY;INTERVAL=2',
      pattern_start: new Date(Date.UTC(2026, 0, 5)),
    });
    expect(form.patternStart).toBe('2026-01-05');
  });

  it('preserves a null list item as raw rather than crashing on its date', () => {
    // A hand-authored empty dash (`- `) parses as null; it must not throw while
    // building the form, just round-trip untouched for markdown editing.
    const form = formFromFrontmatter({ tngantt: 'calendar', non_working: [null] });
    expect(form.nonWorking[0]).toEqual({ date: '', name: '', raw: null });
  });

  it('rejects a reversed or zero-length working-hours range', () => {
    const base = formFromFrontmatter(CALENDAR);
    expect(fieldErrors({ ...base, workingHours: ['18:00-09:00'] }).workingHours).toBeDefined();
    expect(fieldErrors({ ...base, workingHours: ['09:00-09:00'] }).workingHours).toBeDefined();
    expect(fieldErrors({ ...base, workingHours: ['09:00-17:00'] }).workingHours).toBeUndefined();
  });
});

describe('Codex-found save-bad-data validation', () => {
  const base = formFromFrontmatter(CALENDAR);

  it('flags a dated entry with no date so an empty exception cannot be saved', () => {
    expect(fieldErrors({ ...base, nonWorking: [{ date: '', name: 'x' }] }).dates).toBeDefined();
    expect(fieldErrors({ ...base, events: [{ date: '', name: '' }] }).dates).toBeDefined();
    expect(fieldErrors(base).dates).toBeUndefined();
  });

  it('ignores a raw passthrough entry when checking dates', () => {
    const withRaw = { ...base, nonWorking: [{ date: '', name: '', raw: { start: 'a', end: 'b' } }] };
    expect(fieldErrors(withRaw).dates).toBeUndefined();
  });

  it('flags a set member that is empty or not a wikilink', () => {
    const set = formFromFrontmatter({ tngantt: 'calendar-set', calendars: ['[[A]]'] });
    expect(fieldErrors({ ...set, members: ['[[A]]', ''] }).members).toBeDefined();
    expect(fieldErrors({ ...set, members: ['plain text'] }).members).toBeDefined();
    expect(fieldErrors({ ...set, members: ['[[A]]', '[[B]]'] }).members).toBeUndefined();
  });

  it('does not flag members on a plain calendar', () => {
    expect(fieldErrors(base).members).toBeUndefined();
  });
});
