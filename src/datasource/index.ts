/**
 * Barrel for the data-source layer.
 *
 * @module datasource
 */

export type {
  DataSource,
  DataSourceCapabilities,
  SourceTask,
  SourceDependency,
  DependencyRelType,
  StatusColor,
  PriorityColor,
  ChoiceOption,
  ChoiceRole,
  TaskPatch,
  MutationContext,
  FieldConfig,
  CustomDateField,
  DateWriteTarget,
  DateWrite,
  EstimateWriteTarget,
} from './types';

export {
  resolveDateMapping,
  bareProperty,
  toNoteProperty,
  noteFrontmatterKey,
  type ResolvedDateMapping,
} from './dateFieldMapping';

export {
  CALENDAR_ITEM_ID_PREFIX,
  isCalendarItemId,
  makeCalendarItemId,
  resolveActivationNotePath,
} from './calendarItems';
export type {
  CalendarDerivationWindow,
  CalendarItem,
  CalendarItemBatch,
  CalendarItemFamily,
  CalendarItemQueryContext,
  CalendarItemSource,
  CalendarOccupancy,
  LocalDay,
} from './calendarItems';

export { BasesSource } from './BasesSource';
export { CompositeSource } from './CompositeSource';
export {
  TaskNotesSource,
  MIN_TASKNOTES_API_VERSION,
  TASKNOTES_CHANGE_EVENTS,
} from './TaskNotesSource';
export type {
  TaskNotesApi,
  TaskNotesTaskInfo,
  TaskNotesDependencyEdge,
  TaskNotesEventRef,
  TaskNotesEventHandler,
} from './TaskNotesSource';
export type { FieldMappings, ProgressMode, TimeEstimateMode } from './fieldMappings';
