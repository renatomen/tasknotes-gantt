import {
  buildCalendarRegistry,
  datedBlockingSource,
  resolveTaskCalendar,
  stripSubpath,
  type CalendarNoteInput,
  type LinkResolver,
} from '../../src/controller/calendar/resolveCalendars';

const NOTES: CalendarNoteInput[] = [
  {
    path: 'Calendars/NZ Holidays.md',
    basename: 'NZ Holidays',
    frontmatter: { tngantt: 'calendar', color: '#2a9d8f', non_working: ['2026-02-06'] },
  },
  {
    path: 'Calendars/AU Holidays.md',
    basename: 'AU Holidays',
    frontmatter: { tngantt: 'calendar', non_working: ['2026-01-26'] },
  },
  {
    path: 'Calendars/APAC.md',
    basename: 'APAC',
    frontmatter: {
      tngantt: 'calendar-set',
      color: '#e76f51',
      calendars: ['[[NZ Holidays]]', '[[AU Holidays]]'],
    },
  },
  {
    path: 'Calendars/Nested Set.md',
    basename: 'Nested Set',
    frontmatter: { tngantt: 'calendar-set', calendars: ['[[APAC]]', '[[NZ Holidays]]'] },
  },
  {
    path: 'Calendars/Empty Set.md',
    basename: 'Empty Set',
    frontmatter: { tngantt: 'calendar-set', calendars: ['[[Ghost]]'] },
  },
  {
    path: 'Calendars/Broken.md',
    basename: 'Broken',
    frontmatter: { tngantt: 'calendar', pattern: 'BYDAY=MO' },
  },
  { path: 'Notes/Plain.md', basename: 'Plain', frontmatter: { title: 'not a calendar' } },
];

const resolveByBasename: LinkResolver = (linkText) => {
  const inner = linkText.startsWith('[[') ? linkText.slice(2, -2).split('|')[0] : linkText;
  const note = NOTES.find((candidate) => candidate.basename === inner);
  return note ? note.path : null;
};

const registry = buildCalendarRegistry(NOTES, resolveByBasename);

describe('buildCalendarRegistry', () => {
  it('routes notes by marker: calendars, sets, invalid, and ignores unmarked notes', () => {
    expect([...registry.calendars.keys()]).toEqual([
      'Calendars/NZ Holidays.md',
      'Calendars/AU Holidays.md',
    ]);
    expect([...registry.sets.keys()]).toEqual([
      'Calendars/APAC.md',
      'Calendars/Nested Set.md',
      'Calendars/Empty Set.md',
    ]);
    expect([...registry.invalid.keys()]).toEqual(['Calendars/Broken.md']);
  });

  it('resolves set members to calendar paths', () => {
    expect(registry.sets.get('Calendars/APAC.md')?.memberPaths).toEqual([
      'Calendars/NZ Holidays.md',
      'Calendars/AU Holidays.md',
    ]);
  });

  it('drops a set-typed member with a flag while remaining members take effect (flat sets)', () => {
    const nested = registry.sets.get('Calendars/Nested Set.md');
    expect(nested?.memberPaths).toEqual(['Calendars/NZ Holidays.md']);
    expect(nested?.flags.join(' ')).toMatch(/flat/);
  });
});

describe('resolveTaskCalendar', () => {
  it('returns the built-in default for a task with no association', () => {
    const resolved = resolveTaskCalendar(registry, undefined, 'Tasks/T.md', resolveByBasename);
    expect(resolved.identity).toBeUndefined();
    expect(resolved.calendars).toEqual([]);
    expect(resolved.schedulingSuspended).toBe(false);
  });

  it('resolves a direct calendar link with the calendar identity and colour', () => {
    const resolved = resolveTaskCalendar(
      registry,
      '[[NZ Holidays]]',
      'Tasks/T.md',
      resolveByBasename,
    );
    expect(resolved.identity).toEqual({
      id: 'Calendars/NZ Holidays.md',
      name: 'NZ Holidays',
      color: '#2a9d8f',
    });
    expect(resolved.calendars).toHaveLength(1);
    expect(resolved.schedulingSuspended).toBe(false);
  });

  it('strips a #section subpath before resolving', () => {
    const resolved = resolveTaskCalendar(
      registry,
      '[[NZ Holidays#February]]',
      'Tasks/T.md',
      resolveByBasename,
    );
    expect(resolved.identity?.id).toBe('Calendars/NZ Holidays.md');
  });

  it('resolves a set with the set colour winning and members as effective calendars', () => {
    const resolved = resolveTaskCalendar(registry, '[[APAC]]', 'Tasks/T.md', resolveByBasename);
    expect(resolved.identity).toEqual({ id: 'Calendars/APAC.md', name: 'APAC', color: '#e76f51' });
    expect(resolved.calendars.map((record) => record.name)).toEqual(['NZ Holidays', 'AU Holidays']);
  });

  it('treats a set whose members all dropped as valid with zero blocking time (nothing to suspend)', () => {
    const resolved = resolveTaskCalendar(registry, '[[Empty Set]]', 'Tasks/T.md', resolveByBasename);
    expect(resolved.identity?.name).toBe('Empty Set');
    expect(resolved.calendars).toEqual([]);
    expect(resolved.schedulingSuspended).toBe(false);
    expect(resolved.flags.length).toBeGreaterThan(0);
  });

  it('flags a dangling link, keeps default display, and suspends scheduling', () => {
    const resolved = resolveTaskCalendar(registry, '[[Ghost]]', 'Tasks/T.md', resolveByBasename);
    expect(resolved.identity).toBeUndefined();
    expect(resolved.calendars).toEqual([]);
    expect(resolved.flags).toHaveLength(1);
    expect(resolved.schedulingSuspended).toBe(true);
  });

  it('flags a link to a non-calendar note the same way', () => {
    const resolved = resolveTaskCalendar(registry, '[[Plain]]', 'Tasks/T.md', resolveByBasename);
    expect(resolved.schedulingSuspended).toBe(true);
    expect(resolved.flags[0]).toMatch(/not a calendar/);
  });

  it('flags a link to an invalid calendar with the invalidity reasons', () => {
    const resolved = resolveTaskCalendar(registry, '[[Broken]]', 'Tasks/T.md', resolveByBasename);
    expect(resolved.schedulingSuspended).toBe(true);
    expect(resolved.flags[0]).toMatch(/FREQ/);
  });

  it('flags a non-string association value', () => {
    const resolved = resolveTaskCalendar(registry, 42, 'Tasks/T.md', resolveByBasename);
    expect(resolved.schedulingSuspended).toBe(true);
  });
});

describe('stripSubpath', () => {
  it('strips heading and block subpaths while preserving aliases', () => {
    expect(stripSubpath('[[Cal#Section]]')).toBe('[[Cal]]');
    expect(stripSubpath('[[Cal#^block|alias]]')).toBe('[[Cal|alias]]');
    expect(stripSubpath('[[Cal|alias]]')).toBe('[[Cal|alias]]');
    expect(stripSubpath('[[Cal|ali#as]]')).toBe('[[Cal|ali#as]]');
    expect(stripSubpath('Cal#Section')).toBe('Cal');
  });
});

describe('datedBlockingSource', () => {
  it('answers by local calendar day over expanded spans', () => {
    const registryCalendar = registry.calendars.get('Calendars/NZ Holidays.md');
    if (!registryCalendar) throw new Error('fixture calendar missing');
    const source = datedBlockingSource(registryCalendar.definition);
    expect(source.isNonWorking(new Date(2026, 1, 6, 12, 0))).toBe(true);
    expect(source.isNonWorking(new Date(2026, 1, 7))).toBe(false);
  });

  it('expands multi-day spans day by day', () => {
    const source = datedBlockingSource({
      kind: 'calendar',
      description: undefined,
      color: undefined,
      pattern: undefined,
      patternStart: undefined,
      timezone: undefined,
      workingHours: [],
      availability: [],
      nonWorking: [
        { startDate: '2026-12-29', endDateExclusive: '2027-01-03', name: 'Summer shutdown' },
      ],
      events: [],
      recurringEvents: [],
      markers: [],
      diagnostics: [],
    });
    expect(source.isNonWorking(new Date(2026, 11, 29))).toBe(true);
    expect(source.isNonWorking(new Date(2027, 0, 2))).toBe(true);
    expect(source.isNonWorking(new Date(2027, 0, 3))).toBe(false);
  });
});
