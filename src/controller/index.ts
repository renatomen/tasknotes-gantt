/**
 * Barrel for the controller layer (action layer / source of truth).
 *
 * Populated by later units: U6 (GanttController). U5 adds InstanceExpansion.
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
