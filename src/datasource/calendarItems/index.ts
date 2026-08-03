/**
 * Barrel for the calendar-item source layer.
 *
 * @module datasource/calendarItems
 */

export {
  CALENDAR_ITEM_ID_PREFIX,
  isCalendarItemId,
  makeCalendarItemId,
  resolveActivationNotePath,
} from './types';

export type {
  CalendarDerivationWindow,
  CalendarItem,
  CalendarItemBatch,
  CalendarItemFamily,
  CalendarItemQueryContext,
  CalendarItemSource,
  CalendarOccupancy,
  LocalDay,
} from './types';

export { localDayOfInstant, localDaySpanOfInstants } from './normalizers';

export type { LocalDaySpan } from './normalizers';

export { createPropertyEventSource, expandPropertyEventItems } from './propertyEventSource';

export type {
  PropertyEventExpansionInput,
  PropertyEventSource,
  PropertyEventSourceDeps,
  PropertyEventToggles,
} from './propertyEventSource';

export { createRecurringInstanceSource, expandRecurringOccupancy } from './recurringSource';

export type {
  RecurringExpansionInput,
  RecurringInstanceSource,
  RecurringInstanceState,
  RecurringInstanceToggles,
  RecurringSourceDeps,
  TaskReferenceResolver,
} from './recurringSource';

export { createTimeEntrySource, expandTimeEntryItems } from './timeEntrySource';

export type {
  TimeEntryExpansionInput,
  TimeEntrySource,
  TimeEntrySourceDeps,
  TimeEntryToggles,
} from './timeEntrySource';

export {
  createTimeblockSource,
  expandTimeblockItems,
  UNTITLED_TIMEBLOCK_TITLE,
} from './timeblockSource';

export type {
  DailyNoteTimeblocks,
  TimeblockExpansionInput,
  TimeblockSourceDeps,
  TimeblockToggles,
} from './timeblockSource';

export { createTimeblockWatch } from './timeblockWatch';

export type { TimeblockWatch, TimeblockWatchConfig } from './timeblockWatch';
