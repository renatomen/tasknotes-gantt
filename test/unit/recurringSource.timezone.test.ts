/**
 * A two-line timezone rule keeps the days model 0.2.1 produced, in each
 * harness timezone. Model 0.3.1 shifts those days unless the timezone
 * parameter is removed before expansion.
 */

import { describe, expect, it } from '@jest/globals';
import type { CalendarItemQueryContext } from '../../src/datasource/calendarItems';
import { createRecurringInstanceSource } from '../../src/datasource/calendarItems/recurringSource';
import type { TaskNotesTaskInfo } from '../../src/datasource/TaskNotesSource';

const WINDOW = { startDate: '2026-01-05', endDateExclusive: '2026-02-03' } as const;
const RULE = 'DTSTART;TZID=America/New_York:20260106T090000\nRRULE:FREQ=WEEKLY';

const DAYS_BY_TIMEZONE: Record<string, readonly string[]> = {
  'America/Los_Angeles': ['2026-01-06', '2026-01-13', '2026-01-20', '2026-01-27'],
  UTC: ['2026-01-06', '2026-01-13', '2026-01-20', '2026-01-27'],
  'Pacific/Auckland': ['2026-01-06', '2026-01-13', '2026-01-20', '2026-01-27'],
};

describe('recurringSource — timezone rule days', () => {
  it('keeps a two-line timezone weekly rule on the days it had before the model bump', async () => {
    const timezone = process.env.TZ ?? 'UTC';
    const expected = DAYS_BY_TIMEZONE[timezone];
    expect(expected).toBeDefined();

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

    expect((batch.occupancyByTaskPath.get(task.path) ?? []).map((item) => item.day)).toEqual(expected);
  });
});
