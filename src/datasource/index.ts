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
  TaskPatch,
  MutationContext,
} from './types';

export { BasesSource } from './BasesSource';
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
