/**
 * Barrel for the controller layer (action layer / source of truth).
 *
 * U5 adds InstanceExpansion; U6 adds the GanttController action layer.
 *
 * @module controller
 */

export {
  expandInstances,
  ExpansionResult,
  DEFAULT_FANOUT_CAP,
} from './InstanceExpansion';
export type {
  RenderInstance,
  RenderLink,
  SourceLink,
  LinkRewriteMode,
  ExpansionOptions,
} from './InstanceExpansion';

export { GanttController } from './GanttController';
export type {
  GanttControllerOptions,
  GanttControllerDeps,
  BasesInputProvider,
  ChangeListener,
} from './GanttController';
