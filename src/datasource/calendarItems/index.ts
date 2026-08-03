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

export { createRecurringInstanceSource, expandRecurringOccupancy } from './recurringSource';

export type {
  RecurringExpansionInput,
  RecurringInstanceSource,
  RecurringInstanceState,
  RecurringInstanceToggles,
  RecurringSourceDeps,
  TaskReferenceResolver,
} from './recurringSource';
