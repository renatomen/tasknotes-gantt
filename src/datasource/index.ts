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
  TaskPatch,
  MutationContext,
  FieldConfig,
  CustomDateField,
  DateWriteTarget,
  DateWrite,
} from './types';

export {
  resolveDateMapping,
  bareProperty,
  toNoteProperty,
  type ResolvedDateMapping,
} from './dateFieldMapping';

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
