/**
 * Pure resolution of a Gantt date role (start/end) to a TaskNotes write target,
 * given the configured frontmatter property and TaskNotes' {@link FieldConfig}.
 *
 * The Bases view config picks a frontmatter property for each role; this module
 * turns that pick into both the property the chart should *read* (`readProp`)
 * and the {@link DateWriteTarget} the chart should *write* — guaranteeing the
 * two agree (round-trip symmetry). A property that is neither the configured
 * scheduled/due property nor an enabled custom date field is `invalid` and
 * falls back to the role default for **both** read and write, so an invalid
 * mapping degrades coherently rather than reading one field and writing another
 * (the GitHub #70 failure mode).
 *
 * @module datasource/dateFieldMapping
 */

import type { DateWriteTarget, FieldConfig } from './types';

/** A resolved date-field mapping for one role. */
export interface ResolvedDateMapping {
  /** Bare frontmatter property the chart should read this date from. */
  readProp: string;
  /** Where a write to this date should be persisted. */
  writeTarget: DateWriteTarget;
  /** True when the configured property was not a valid date target (fell back). */
  invalid: boolean;
}

/**
 * Resolve a configured (bare) property name + role to a {@link ResolvedDateMapping}.
 *
 * @param configuredProp - The Base's bare property name for this role, or
 *   `undefined`/empty to take the role default. Must be bare (no `note.`); use
 *   {@link bareProperty} to normalize first.
 * @param role - `'start'` (defaults to scheduled) or `'end'` (defaults to due).
 * @param cfg - TaskNotes' configured date-field surface.
 */
export function resolveDateMapping(
  configuredProp: string | undefined,
  role: 'start' | 'end',
  cfg: FieldConfig,
): ResolvedDateMapping {
  // Role default — fall back to the canonical TaskNotes field name when the
  // configured property name is unknown (degenerate config still writes the
  // canonical scheduled/due, which TaskNotes maps to its own property).
  const defaultProp = role === 'start' ? cfg.scheduledProp ?? 'scheduled' : cfg.dueProp ?? 'due';
  const defaultTarget: DateWriteTarget = role === 'start' ? { kind: 'scheduled' } : { kind: 'due' };

  const prop = configuredProp && configuredProp.length > 0 ? configuredProp : undefined;
  if (!prop) {
    return { readProp: defaultProp, writeTarget: defaultTarget, invalid: false };
  }
  if (cfg.scheduledProp && prop === cfg.scheduledProp) {
    return { readProp: prop, writeTarget: { kind: 'scheduled' }, invalid: false };
  }
  if (cfg.dueProp && prop === cfg.dueProp) {
    return { readProp: prop, writeTarget: { kind: 'due' }, invalid: false };
  }
  const field = cfg.dateFields.find((f) => f.key === prop);
  if (field) {
    return {
      readProp: prop,
      writeTarget: { kind: 'userField', key: field.key, id: field.id },
      invalid: false,
    };
  }
  // Not a writable date target → symmetric fallback to the role default.
  return { readProp: defaultProp, writeTarget: defaultTarget, invalid: true };
}

/**
 * Strip a `note.` / `note:` mapping prefix to the bare frontmatter property
 * name. Returns `undefined` for an empty/undefined input.
 */
export function bareProperty(prop: string | undefined): string | undefined {
  if (!prop) {
    return undefined;
  }
  const stripped = prop.replace(/^note[.:]/, '');
  return stripped.length > 0 ? stripped : undefined;
}

/** Re-form a bare frontmatter property name into the `note.` dot-form mapping. */
export function toNoteProperty(bare: string): string {
  return `note.${bare}`;
}
