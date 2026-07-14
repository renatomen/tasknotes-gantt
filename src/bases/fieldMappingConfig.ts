/**
 * Single source of truth for the plugin's field-mapping view-config keys and
 * how they are read from a Bases view config.
 *
 * Both the Bases options schema (`sharedOptions` in `register.ts`) and the
 * gantt view's `buildFieldMappings` reference these constants, so the
 * `tngantt_`-prefixed key names cannot drift between what the options UI writes
 * and what the view reads.
 * That drift is exactly what caused the bug in PR #108 — see
 * docs/solutions/integration-issues/tasklist-view-tngantt-config-keys.md.
 *
 * @module bases/fieldMappingConfig
 */
import type { FieldMappings } from './types/field-mapping';

/** Canonical `tngantt_`-prefixed config keys for the field mappings. */
export const FIELD_MAPPING_KEYS = {
  text: 'tngantt_textProperty',
  start: 'tngantt_startDateProperty',
  end: 'tngantt_endDateProperty',
  progress: 'tngantt_progressProperty',
  parent: 'tngantt_parentProperty',
  status: 'tngantt_statusProperty',
  priority: 'tngantt_priorityProperty',
  timeEstimate: 'tngantt_timeEstimateProperty',
} as const;

/** Per-view fallback values used when a mapping key is unset. */
export interface FieldMappingDefaults {
  textProperty: string;
  startProperty: string;
  endProperty: string;
  progressProperty: string;
  parentProperty: string;
  statusProperty: string;
  priorityProperty: string;
  timeEstimateProperty: string;
}

/**
 * Default fallbacks: every property defaults to "unset" (empty). The plugins are
 * property-agnostic — they NEVER assume an Obsidian/TaskNotes property name. An
 * unset property is resolved against TaskNotes' configured field when TaskNotes is
 * present; otherwise the user maps fields via the view config. Unset on both sides
 * simply yields no value for that field.
 */
const BASE_DEFAULTS: FieldMappingDefaults = {
  textProperty: '',
  startProperty: '',
  endProperty: '',
  progressProperty: '',
  parentProperty: '',
  statusProperty: '',
  priorityProperty: '',
  timeEstimateProperty: '',
};

/**
 * Read the field mappings from a view config via the canonical `tngantt_` keys.
 *
 * @param get      a `config.get`-style reader (e.g. `(k) => this.config.get(k)`)
 * @param defaults optional per-view default overrides for unset keys (all default
 *                 to "unset"/empty — no property name is assumed)
 */
export function readFieldMappings(
  get: (key: string) => unknown,
  defaults: Partial<FieldMappingDefaults> = {},
): FieldMappings {
  const d = { ...BASE_DEFAULTS, ...defaults };
  return {
    textProperty: (get(FIELD_MAPPING_KEYS.text) as string) || d.textProperty,
    startProperty: (get(FIELD_MAPPING_KEYS.start) as string) || d.startProperty,
    endProperty: (get(FIELD_MAPPING_KEYS.end) as string) || d.endProperty,
    progressProperty: (get(FIELD_MAPPING_KEYS.progress) as string) || d.progressProperty,
    parentProperty: (get(FIELD_MAPPING_KEYS.parent) as string) || d.parentProperty,
    statusProperty: (get(FIELD_MAPPING_KEYS.status) as string) || d.statusProperty,
    priorityProperty: (get(FIELD_MAPPING_KEYS.priority) as string) || d.priorityProperty,
    timeEstimateProperty: (get(FIELD_MAPPING_KEYS.timeEstimate) as string) || d.timeEstimateProperty,
  };
}
