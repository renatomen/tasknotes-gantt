/**
 * After the timezone parameter is removed, a two-line weekly rule lands on
 * the same days in every harness timezone. Leaving the parameter in place
 * shifts Auckland a day later under model 0.3.1.
 */

import { describe, expect, it } from '@jest/globals';
import type { CalendarItemQueryContext } from '../../src/datasource/calendarItems';
import { createRecurringInstanceSource } from '../../src/datasource/calendarItems/recurringSource';
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
