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

export {
  isLocalDayString,
  localDayOfInstant,
  localDayOfWallClock,
  localDaySpanOfInstants,
  shiftLocalDay,
} from './normalizers';

export type { LocalDaySpan } from './normalizers';

export {
  DEFAULT_EXTERNAL_CALENDAR_POLL_MS,
  createExternalCalendarSource,
  externalCalendarFeedKey,
  readExternalIcsSubscriptions,
  readExternalProviderCalendars,
} from './externalCalendarSource';

export type {
  ExternalCalendarProviderKind,
  ExternalCalendarSource,
  ExternalCalendarSourceDeps,
  ExternalIcsSubscription,
  ExternalProviderCalendar,
} from './externalCalendarSource';

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
