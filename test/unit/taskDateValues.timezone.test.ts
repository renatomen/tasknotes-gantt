import { describe, expect, it } from '@jest/globals';
import type { App, BasesEntry } from 'obsidian';
import { BasesSource } from '../../src/datasource/BasesSource';
import {
  buildTaskUpdates,
  TaskNotesSource,
  type TaskNotesApi,
} from '../../src/datasource/TaskNotesSource';
import { applyDatePolicy } from '../../src/controller/datePolicy';
import { classifyTypedValue } from '../../src/bases/propertyValues';

async function readBasesDates(start: string, end: string) {
  const entry = {
    file: { path: 'Approval.md', basename: 'Approval' },
    frontmatter: { begins: start, finishes: end },
    getValue: () => null,
  } as unknown as BasesEntry;
  const source = new BasesSource({} as App, [entry], {
    textProperty: '',
    startProperty: 'note.begins',
    endProperty: 'note.finishes',
    progressProperty: '',
  });
  const [task] = await source.getTasks();
  return task;
}

async function readTaskNotesDates(start: string, end: string) {
  const task = { path: 'Approval.md', scheduled: start, due: end };
  const api: TaskNotesApi = {
    apiVersion: 1,
    tasks: { list: () => [task], get: () => task },
  };
  const app = { plugins: { getPlugin: () => ({ api }) } } as unknown as App;
  const source = await TaskNotesSource.create(app);
  if (!source) throw new Error('Expected the compatible TaskNotes source');
  const [result] = await source.getTasks();
  return result;
}

async function readBasesDateValues(start: Date, end: Date) {
  const values: Record<string, Date> = { 'formula.begins': start, 'formula.finishes': end };
  const entry = {
    file: { path: 'Approval.md', basename: 'Approval' },
    getValue: (property: string) => ({ date: values[property] }),
  } as unknown as BasesEntry;
  const source = new BasesSource({} as App, [entry], {
    textProperty: '',
    startProperty: 'formula.begins',
    endProperty: 'formula.finishes',
    progressProperty: '',
  });
  const [task] = await source.getTasks();
  return task;
}

const calendarDays = [
  { text: '2026-09-10', year: 2026, month: 8, day: 10 },
  { text: '2026-03-08', year: 2026, month: 2, day: 8 },
  { text: '2026-11-01', year: 2026, month: 10, day: 1 },
  { text: '2026-04-05', year: 2026, month: 3, day: 5 },
  { text: '2026-09-27', year: 2026, month: 8, day: 27 },
  { text: '2028-02-29', year: 2028, month: 1, day: 29 },
];

describe('Bases computed DateValue dates', () => {
  it.each(calendarDays)('preserves the host local calendar date $text', async ({ year, month, day }) => {
    const task = await readBasesDateValues(new Date(year, month, day), new Date(year, month, day));
    const displayed = applyDatePolicy(task, { defaultDuration: 1, today: new Date(2026, 0, 1) });

    expect(task.start).toEqual(new Date(year, month, day));
    expect(task.end).toEqual(new Date(year, month, day));
    expect(displayed.start).toEqual(new Date(year, month, day));
    expect(displayed.end).toEqual(new Date(year, month, day, 23, 59, 59, 999));
  });

  it('keeps a computed UTC timestamp as an instant', async () => {
    const task = await readBasesDateValues(new Date('2026-09-10T00:00:00Z'), new Date('2026-09-11T00:00:00Z'));

    expect(task.start?.toISOString()).toBe('2026-09-10T00:00:00.000Z');
    expect(task.end?.toISOString()).toBe('2026-09-11T00:00:00.000Z');
  });
});

it('keeps an impossible calendar date as text in the grid', () => {
  expect(classifyTypedValue('2026-02-30')).toEqual({ kind: 'text', value: '2026-02-30' });
});

describe.each([
  { name: 'Bases frontmatter', read: readBasesDates },
  { name: 'TaskNotes companion', read: readTaskNotesDates },
])('$name calendar dates', ({ read }) => {
  it.each(calendarDays)('reads $text at local midnight, matching the grid', async ({ text, year, month, day }) => {
    const task = await read(text, text);
    const expected = new Date(year, month, day);

    expect(task.start).toEqual(expected);
    expect(task.end).toEqual(expected);
    expect(classifyTypedValue(text)).toEqual({ kind: 'date', value: expected });
  });

  it('places the authored Approval range on September 10–11 before any drag', async () => {
    const task = await read('2026-09-10', '2026-09-11');

    const displayed = applyDatePolicy(task, { defaultDuration: 1, today: new Date(2026, 8, 1) });

    expect(displayed).toEqual({
      start: new Date(2026, 8, 10),
      end: new Date(2026, 8, 11, 23, 59, 59, 999),
      dateStatus: 'complete',
    });
  });

  it.each([
    { start: '2026-03-07', end: '2026-03-09', year: 2026, month: 2, first: 7, last: 9 },
    { start: '2026-10-31', end: '2026-11-02', year: 2026, month: 9, first: 31, last: 33 },
    { start: '2026-09-26', end: '2026-09-28', year: 2026, month: 8, first: 26, last: 28 },
    { start: '2026-04-04', end: '2026-04-06', year: 2026, month: 3, first: 4, last: 6 },
  ])('keeps $start–$end stable across repeated write/refresh cycles', async ({ start, end, year, month, first, last }) => {
    let task = await read(start, end);

    for (let refresh = 0; refresh < 3; refresh++) {
      const displayed = applyDatePolicy(task, { defaultDuration: 1, today: new Date(2026, 0, 1) });
      const updates = buildTaskUpdates({ dateWrites: [
        { target: { kind: 'scheduled' }, value: displayed.start },
        { target: { kind: 'due' }, value: displayed.end },
      ] });

      expect(displayed.start).toEqual(new Date(year, month, first));
      expect(displayed.end).toEqual(new Date(year, month, last, 23, 59, 59, 999));
      expect(updates).toEqual({ scheduled: start, due: end });
      task = await read(String(updates.scheduled), String(updates.due));
    }
  });
});
