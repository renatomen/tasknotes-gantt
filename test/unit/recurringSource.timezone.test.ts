/**
 * After the timezone parameter is removed, a two-line weekly rule lands on
 * the same days in every harness timezone. Leaving the parameter in place
 * shifts Auckland a day later under model 0.3.1.
 */

import { describe, expect, it } from '@jest/globals';
import { calendarDateToInstant, calendarInstantToDate } from '@tasknotes/model/calendar';
import type { CalendarItemQueryContext } from '../../src/datasource/calendarItems';
import { expandRecurringOccupancy, createRecurringInstanceSource } from '../../src/datasource/calendarItems/recurringSource';
import type { TaskNotesTaskInfo } from '../../src/datasource/TaskNotesSource';

const WINDOW = { startDate: '2026-01-05', endDateExclusive: '2026-02-03' } as const;
const RULE = 'DTSTART;TZID=America/New_York:20260106T090000\nRRULE:FREQ=WEEKLY';
const EXPECTED_DAYS = ['2026-01-06', '2026-01-13', '2026-01-20', '2026-01-27'] as const;

describe('recurringSource — timezone rule days', () => {
  it('keeps a two-line timezone weekly rule on the same days in every harness timezone', async () => {
    const task: TaskNotesTaskInfo = {
      path: 'routines/standup.md',
      title: 'Standup',
      recurrence: RULE,
      scheduled: '2026-01-06',
    };
    const context: CalendarItemQueryContext = { window: WINDOW, tasks: () => [], basesEntries: () => [] };
    const batch = await createRecurringInstanceSource({
      listTasks: () => [task],
      toggles: () => ({
        showRecurring: true,
        showCompletedRecurringInstances: true,
        showSkippedRecurringInstances: true,
      }),
    }).collect(context);

    expect((batch.occupancyByTaskPath.get(task.path) ?? []).map((item) => item.day)).toEqual([
      ...EXPECTED_DAYS,
    ]);
  });
});

const OFFSET_SCHEDULED = '2026-03-08T04:30:00Z';

function nextDay(timezone?: string): string {
  const batch = expandRecurringOccupancy({
    tasks: [
      {
        path: 'tasks/offset.md',
        title: 'Offset',
        recurrence: 'FREQ=DAILY;COUNT=1',
        scheduled: OFFSET_SCHEDULED,
      },
    ],
    window: { startDate: '2026-03-01', endDateExclusive: '2026-03-15' },
    toggles: {
      showRecurring: true,
      showCompletedRecurringInstances: true,
      showSkippedRecurringInstances: true,
    },
    now: '2026-03-08T12:00:00Z',
    ...(timezone === undefined ? {} : { timezone }),
  });
  return (batch.occupancyByTaskPath.get('tasks/offset.md') ?? [])[0]?.day ?? '';
}

function runtimeCivilDay(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  if (zone === 'America/Los_Angeles') return '2026-03-07';
  if (zone === 'UTC' || zone === 'Pacific/Auckland') return '2026-03-08';
  return calendarInstantToDate(calendarDateToInstant(OFFSET_SCHEDULED, zone), zone, true).slice(0, 10);
}

describe('recurringSource — offset scheduled day', () => {
  it('places 2026-03-08T04:30:00Z on the 7th in Los Angeles and the 8th in UTC and Auckland', () => {
    expect(nextDay('America/Los_Angeles')).toBe('2026-03-07');
    expect(nextDay('UTC')).toBe('2026-03-08');
    expect(nextDay('Pacific/Auckland')).toBe('2026-03-08');
  });

  it('uses the runtime zone when none is injected', () => {
    expect(nextDay()).toBe(runtimeCivilDay());
  });
});
