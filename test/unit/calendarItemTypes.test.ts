/**
 * Calendar-item contract unit tests: the synthetic-ID namespace (collision
 * freedom with vault paths, hence managed-path editability exclusion) and the
 * pure bar-activate resolver.
 *
 * Following testing-standards.md: Jest, pure functions, AAA.
 */

import { describe, it, expect } from '@jest/globals';
import {
  CALENDAR_ITEM_ID_PREFIX,
  isCalendarItemId,
  makeCalendarItemId,
  resolveActivationNotePath,
  type CalendarItem,
} from '../../src/datasource/calendarItems';

/** Concise CalendarItem factory. */
function item(partial: Partial<CalendarItem> & { id: string }): CalendarItem {
  return {
    family: 'timeblock',
    title: 'Focus block',
    startDay: '2026-01-10',
    endDay: '2026-01-10',
    ...partial,
  };
}

describe('calendar-item synthetic ID namespace', () => {
  it('composes a namespaced id from family and series id', () => {
    const id = makeCalendarItemId('timeblock', 'Daily/2026-01-10.md#tb-1');

    expect(id).toBe(`${CALENDAR_ITEM_ID_PREFIX}timeblock/Daily/2026-01-10.md#tb-1`);
  });

  it('appends the day qualifier for dated instances', () => {
    const id = makeCalendarItemId('recurring-instance', 'Tasks/standup.md', '2026-01-12');

    expect(id).toBe(`${CALENDAR_ITEM_ID_PREFIX}recurring-instance/Tasks/standup.md@2026-01-12`);
  });

  it('recognizes its own ids', () => {
    const id = makeCalendarItemId('time-entry', 'Tasks/a.md', '2026-01-10');

    expect(isCalendarItemId(id)).toBe(true);
  });

  it('rejects vault paths, including ones that share the namespace spelling', () => {
    expect(isCalendarItemId('Tasks/a.md')).toBe(false);
    expect(isCalendarItemId('og-calendar.md')).toBe(false);
    expect(isCalendarItemId('og-calendar/timeblock.md')).toBe(false);
  });

  it('never matches a managed vault-path set, so union rows are not editable-eligible', () => {
    // The view gates inline editability on `managedPaths.has(sourcePath)`;
    // synthetic ids flow through the same field, so exclusion rests on the
    // namespace never colliding with a vault path.
    const managedPaths: ReadonlySet<string> = new Set(['Tasks/a.md', 'og-calendar.md']);
    const id = makeCalendarItemId('time-entry', 'Tasks/a.md');

    expect(managedPaths.has('Tasks/a.md')).toBe(true); // the set itself works
    expect(isCalendarItemId(id)).toBe(true);
    expect(managedPaths.has(id)).toBe(false);
  });
});

describe('resolveActivationNotePath — bar-activate resolution', () => {
  it('passes a task vault path through unchanged', () => {
    const resolved = resolveActivationNotePath('Tasks/a.md', () => undefined);

    expect(resolved).toBe('Tasks/a.md');
  });

  it('resolves a calendar item with a backing note to that note', () => {
    const id = makeCalendarItemId('time-entry', 'Tasks/a.md', '2026-01-10');
    const backed = item({ id, family: 'time-entry', notePath: 'Tasks/a.md' });

    const resolved = resolveActivationNotePath(id, (lookup) =>
      lookup === id ? backed : undefined,
    );

    expect(resolved).toBe('Tasks/a.md');
  });

  it('resolves a note-less calendar item to null (activation no-op, no throw)', () => {
    const id = makeCalendarItemId('external-event', 'work-calendar/standup', '2026-01-12');
    const noteless = item({ id, family: 'external-event' });

    const resolved = resolveActivationNotePath(id, (lookup) =>
      lookup === id ? noteless : undefined,
    );

    expect(resolved).toBeNull();
  });

  it('resolves an unknown calendar id to null rather than treating it as a path', () => {
    const id = makeCalendarItemId('timeblock', 'gone.md#tb-9');

    const resolved = resolveActivationNotePath(id, () => undefined);

    expect(resolved).toBeNull();
  });
});
