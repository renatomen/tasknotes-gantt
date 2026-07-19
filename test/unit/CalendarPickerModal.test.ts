/**
 * U9 picker coverage: the pure row/transition model (calendarPickerModel) and
 * the modal's DOM wiring, exercised against the obsidian mock's recording
 * Modal/FakeElement (test/__mocks__/obsidian.ts).
 */

import { describe, expect, it, jest } from '@jest/globals';
import { App, FakeElement } from 'obsidian';
import {
  buildCalendarRegistry,
  stripSubpath,
  type CalendarNoteInput,
} from '../../src/controller/calendar/resolveCalendars';
import { resolveParentLink } from '../../src/bases/parentLink';
import { parseCalendarFrontmatter } from '../../src/controller/calendar/schema';
import { readDisplaySelection, type DisplaySelection } from '../../src/bases/calendarSelection';
import {
  autoDisplayedPathsFrom,
  buildPickerRows,
  CALENDAR_SKELETON_FRONTMATTER,
  calendarSkeletonText,
  toggleCalendarRow,
  toggleDefaultRow,
  toggleSetMember,
  toggleSetRow,
  uniqueCalendarPath,
  type PickerContext,
  type PickerWrites,
  type SetRowModel,
} from '../../src/bases/calendarPickerModel';
import { CalendarPickerModal } from '../../src/bases/CalendarPickerModal';

const NOTES: CalendarNoteInput[] = [
  {
    path: 'Calendars/NZ.md',
    basename: 'NZ',
    frontmatter: { tngantt: 'calendar', description: 'NZ holidays', color: '#2a9d8f' },
  },
  { path: 'Calendars/AU.md', basename: 'AU', frontmatter: { tngantt: 'calendar' } },
  {
    path: 'Calendars/APAC.md',
    basename: 'APAC',
    frontmatter: { tngantt: 'calendar-set', calendars: ['[[NZ]]', '[[AU]]'] },
  },
  {
    path: 'Calendars/Broken.md',
    basename: 'Broken',
    frontmatter: { tngantt: 'calendar', pattern: 'BYDAY=MO' },
  },
];

const resolveByName = (link: string): string | null => {
  const inner = link.startsWith('[[') ? link.slice(2, -2).split('|')[0] : link;
  const note = NOTES.find((candidate) => candidate.basename === inner);
  return note ? note.path : null;
};

const registry = buildCalendarRegistry(NOTES, resolveByName);

function context(selection: DisplaySelection, autoPaths: string[] = []): PickerContext {
  return {
    registry,
    selection,
    resolveLink: resolveByName,
    linkFor: (path) => `[[${path.replace(/^.*\//, '').replace(/\.md$/, '')}]]`,
    autoDisplayedPaths: new Set(autoPaths),
  };
}

const explicitSelection = (entries: DisplaySelection['entries']): DisplaySelection => ({
  auto: false,
  stored: true,
  defaultRow: true,
  entries,
});

describe('buildPickerRows', () => {
  it('rows reflect resolved calendars, sets, and flags (invalid + dangling)', () => {
    const sel = explicitSelection([
      { link: '[[NZ]]', enabled: true },
      { link: '[[Gone]]', enabled: true },
    ]);
    const rows = buildPickerRows(context(sel));
    expect(rows[0]).toEqual({ kind: 'default', enabled: true });
    expect(rows).toContainEqual(
      expect.objectContaining({ kind: 'calendar', name: 'NZ', checked: true, color: '#2a9d8f' }),
    );
    expect(rows).toContainEqual(expect.objectContaining({ kind: 'calendar', name: 'AU', checked: false }));
    expect(rows).toContainEqual(expect.objectContaining({ kind: 'set', name: 'APAC' }));
    expect(rows).toContainEqual(expect.objectContaining({ kind: 'flagged', label: 'Broken' }));
    expect(rows).toContainEqual(
      expect.objectContaining({ kind: 'flagged', label: '[[Gone]]', reason: 'link does not resolve' }),
    );
  });

  it('auto mode checks the association-displayed calendars', () => {
    const rows = buildPickerRows(context(readDisplaySelection(undefined, true), ['Calendars/NZ.md']));
    expect(rows).toContainEqual(expect.objectContaining({ kind: 'calendar', name: 'NZ', checked: true }));
    expect(rows).toContainEqual(expect.objectContaining({ kind: 'calendar', name: 'AU', checked: false }));
  });

  it('a stored selection resolves through the real resolver with the vault-wide anchor', () => {
    // Pins the production seam: buildPickerContext resolves entry links via
    // resolveParentLink with an EMPTY source path (no anchoring file). A
    // falsy-source refusal here renders every stored row unchecked and flags
    // valid entries as broken.
    const app = {
      metadataCache: {
        getFirstLinkpathDest: (linkpath: string) => {
          const note = NOTES.find((candidate) => candidate.basename === linkpath);
          return note ? { path: note.path } : null;
        },
      },
      vault: { getAbstractFileByPath: () => null },
    } as unknown as App;
    const sel = explicitSelection([{ link: '[[NZ]]', enabled: true }]);
    const rows = buildPickerRows({
      registry,
      selection: sel,
      resolveLink: (link) => resolveParentLink(app, stripSubpath(link), ''),
      linkFor: (path) => `[[${path}]]`,
      autoDisplayedPaths: new Set(),
    });
    expect(rows).toContainEqual(
      expect.objectContaining({ kind: 'calendar', name: 'NZ', checked: true }),
    );
    expect(rows).not.toContainEqual(expect.objectContaining({ kind: 'flagged', label: '[[NZ]]' }));
  });

  it('a partially-enabled set is indeterminate (partial state)', () => {
    const sel = explicitSelection([
      { link: '[[APAC]]', enabled: true, members: { '[[AU]]': false } },
    ]);
    const set = buildPickerRows(context(sel)).find((row) => row.kind === 'set') as SetRowModel;
    expect(set.state).toBe('partial');
    expect(set.members).toEqual([
      expect.objectContaining({ name: 'NZ', checked: true }),
      expect.objectContaining({ name: 'AU', checked: false }),
    ]);
  });
});

describe('toggle transitions', () => {
  it('toggling a calendar row writes the selection once', () => {
    const sel = explicitSelection([{ link: '[[NZ]]', enabled: true }]);
    const ctx = context(sel);
    const row = buildPickerRows(ctx).find(
      (candidate) => candidate.kind === 'calendar' && candidate.name === 'NZ',
    );
    const { selection, writes } = toggleCalendarRow(ctx, row as never);
    expect(writes).not.toBeNull();
    expect(selection.entries).toContainEqual({ link: '[[NZ]]', enabled: false });
  });

  it('the first toggle from auto materializes the auto set so the display does not jump', () => {
    const ctx = context(readDisplaySelection(undefined, true), ['Calendars/NZ.md']);
    const auRow = buildPickerRows(ctx).find(
      (candidate) => candidate.kind === 'calendar' && candidate.name === 'AU',
    );
    const { selection } = toggleCalendarRow(ctx, auRow as never);
    expect(selection.auto).toBe(false);
    expect(selection.entries).toEqual([
      { link: '[[NZ]]', enabled: true },
      { link: '[[AU]]', enabled: true },
    ]);
  });

  it('clicking an indeterminate set enables all members', () => {
    const sel = explicitSelection([{ link: '[[APAC]]', enabled: true, members: { '[[AU]]': false } }]);
    const ctx = context(sel);
    const set = buildPickerRows(ctx).find((row) => row.kind === 'set') as SetRowModel;
    const { selection } = toggleSetRow(ctx, set);
    expect(selection.entries).toContainEqual({ link: '[[APAC]]', enabled: true });
    const rerows = buildPickerRows(context(selection)).find((row) => row.kind === 'set') as SetRowModel;
    expect(rerows.state).toBe('all');
  });

  it('clicking a fully-enabled set disables it', () => {
    const sel = explicitSelection([{ link: '[[APAC]]', enabled: true }]);
    const ctx = context(sel);
    const set = buildPickerRows(ctx).find((row) => row.kind === 'set') as SetRowModel;
    const { selection } = toggleSetRow(ctx, set);
    expect(selection.entries).toContainEqual({ link: '[[APAC]]', enabled: false });
  });

  it('a member toggle nests under the set entry', () => {
    const sel = explicitSelection([{ link: '[[APAC]]', enabled: true }]);
    const ctx = context(sel);
    const set = buildPickerRows(ctx).find((row) => row.kind === 'set') as SetRowModel;
    const { selection } = toggleSetMember(ctx, set, set.members[1]!);
    expect(selection.entries).toContainEqual({
      link: '[[APAC]]',
      enabled: true,
      members: { '[[AU]]': false },
    });
  });

  it('the default row toggle round-trips the legacy key (both-key writes)', () => {
    const ctx = context(explicitSelection([]));
    const { writes } = toggleDefaultRow(ctx);
    expect(writes?.highlightWeekends).toBe(false);
    expect(readDisplaySelection(writes?.displayCalendars, undefined).defaultRow).toBe(false);
  });
});

describe('auto display + create scaffolding', () => {
  it('autoDisplayedPathsFrom unions association-resolved member calendars', () => {
    const paths = autoDisplayedPathsFrom(
      registry,
      [
        { value: '[[APAC]]', taskPath: 'task-a.md' },
        { value: '[[Missing]]', taskPath: 'task-b.md' },
      ],
      resolveByName,
    );
    expect(paths).toEqual(new Set(['Calendars/NZ.md', 'Calendars/AU.md']));
  });

  it('uniqueCalendarPath numbers past existing notes', () => {
    expect(uniqueCalendarPath(() => false)).toBe('Calendars/New Calendar.md');
    const taken = new Set(['Calendars/New Calendar.md', 'Calendars/New Calendar 2.md']);
    expect(uniqueCalendarPath((path) => taken.has(path))).toBe('Calendars/New Calendar 3.md');
  });

  it('the scaffold frontmatter is a valid calendar per the schema', () => {
    const parsed = parseCalendarFrontmatter(CALENDAR_SKELETON_FRONTMATTER);
    expect(parsed?.kind).toBe('calendar');
    expect(calendarSkeletonText()).toContain('tngantt: calendar');
  });
});

describe('CalendarPickerModal wiring', () => {
  function openModal(selection: DisplaySelection, autoPaths: string[] = []) {
    let current = selection;
    const persist = jest.fn((writes: PickerWrites) => {
      current = readDisplaySelection(writes.displayCalendars, writes.highlightWeekends ?? true);
    });
    const createCalendar = jest.fn(async () => {});
    const modal = new CalendarPickerModal(new App(), {
      getContext: () => context(current, autoPaths),
      persist,
      createCalendar,
    });
    modal.open();
    return { modal, persist, createCalendar, contentEl: modal.contentEl as unknown as FakeElement };
  }

  const isCheckbox = (el: FakeElement) => el.tagName === 'INPUT' && el.attrs.type === 'checkbox';

  it('renders native checkboxes and focuses the first one', () => {
    const { contentEl } = openModal(explicitSelection([{ link: '[[NZ]]', enabled: true }]));
    const checkboxes = contentEl.queryAll(isCheckbox);
    expect(checkboxes.length).toBeGreaterThan(2);
    expect(checkboxes[0]?.focused).toBe(true);
  });

  it('a flagged row renders a disabled checkbox with the reason as description', () => {
    const { contentEl } = openModal(explicitSelection([{ link: '[[Gone]]', enabled: true }]));
    const flaggedRow = contentEl.query(
      (el) =>
        el.cls.includes('og-cal-picker-row-flagged') &&
        el.query((child) => child.text === '[[Gone]]') !== null,
    );
    expect(flaggedRow?.query(isCheckbox)?.disabled).toBe(true);
    expect(flaggedRow?.query((el) => el.tagName === 'SMALL')?.text).toBe('link does not resolve');
  });

  it('a set row renders indeterminate when partially enabled', () => {
    const { contentEl } = openModal(
      explicitSelection([{ link: '[[APAC]]', enabled: true, members: { '[[AU]]': false } }]),
    );
    const indeterminate = contentEl.queryAll(isCheckbox).find((el) => el.indeterminate);
    expect(indeterminate).toBeDefined();
  });

  it('changing a checkbox persists exactly once and re-renders from fresh state', () => {
    const { contentEl, persist } = openModal(explicitSelection([{ link: '[[NZ]]', enabled: true }]));
    const nzCheckbox = contentEl
      .query((el) => el.query((child) => child.text === 'NZ') !== null)
      ?.query(isCheckbox);
    nzCheckbox?.trigger('change');
    expect(persist).toHaveBeenCalledTimes(1);
    const rerendered = contentEl
      .query((el) => el.query((child) => child.text === 'NZ') !== null)
      ?.query(isCheckbox);
    expect(rerendered?.checked).toBe(false);
  });

  it('the expand button reveals member rows', () => {
    const { contentEl } = openModal(explicitSelection([{ link: '[[APAC]]', enabled: true }]));
    expect(contentEl.query((el) => el.cls.includes('og-cal-picker-members'))).toBeNull();
    contentEl.query((el) => el.tagName === 'BUTTON')?.trigger('click');
    expect(contentEl.query((el) => el.cls.includes('og-cal-picker-members'))).not.toBeNull();
  });

  it('an empty vault renders the create action, which scaffolds then closes', async () => {
    let current = readDisplaySelection(undefined, true);
    const createCalendar = jest.fn(async () => {});
    const modal = new CalendarPickerModal(new App(), {
      getContext: () => ({
        registry: buildCalendarRegistry([], () => null),
        selection: current,
        resolveLink: () => null,
        linkFor: (path) => `[[${path}]]`,
        autoDisplayedPaths: new Set(),
      }),
      persist: (writes) => {
        current = readDisplaySelection(writes.displayCalendars, true);
      },
      createCalendar,
    });
    modal.open();
    const contentEl = modal.contentEl as unknown as FakeElement;
    const button = contentEl.query((el) => el.tagName === 'BUTTON');
    expect(button?.text).toBe('Create calendar');
    expect(button?.focused).toBe(true);
    button?.trigger('click');
    await Promise.resolve();
    expect(createCalendar).toHaveBeenCalledTimes(1);
    expect(modal.closed).toBe(true);
  });

  it('a failed create keeps the modal open', async () => {
    const modal = new CalendarPickerModal(new App(), {
      getContext: () => ({
        registry: buildCalendarRegistry([], () => null),
        selection: readDisplaySelection(undefined, true),
        resolveLink: () => null,
        linkFor: (path) => `[[${path}]]`,
        autoDisplayedPaths: new Set(),
      }),
      persist: () => {},
      createCalendar: jest.fn(async () => {
        throw new Error('vault says no');
      }),
    });
    modal.open();
    const contentEl = modal.contentEl as unknown as FakeElement;
    contentEl.query((el) => el.tagName === 'BUTTON')?.trigger('click');
    await Promise.resolve();
    await Promise.resolve();
    expect(modal.closed).toBe(false);
  });
});
