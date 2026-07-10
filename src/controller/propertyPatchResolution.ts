/**
 * Pure resolution of an inline cell edit — an edited property id + raw value —
 * into the {@link TaskPatch} to persist.
 *
 * A property that IS one of the configured field mappings routes through its
 * dedicated patch member (start/end/text/status/progress/estimate), so the
 * write always lands where the mapping says — never a hardcoded property name.
 * Any other property becomes a generic {@link TaskPatch.fieldWrite} by bare
 * frontmatter key. Every refusal throws BEFORE a patch is produced, so a
 * refused edit can never reach the source as an empty update that reports
 * phantom success.
 *
 * Extracted from `GanttController` (mirroring {@link ../datasource/dateFieldMapping}
 * and {@link ../bases/sortKeyMapping}) so the resolution rules are unit-testable
 * without a controller. Dependency-free: no Obsidian/SVAR.
 *
 * @module controller/propertyPatchResolution
 */

import type { FieldMappings } from '../bases/types/field-mapping';
import { bareProperty } from '../datasource/dateFieldMapping';
import type { TaskPatch } from '../datasource/types';
import { toYmd } from '../datasource/TaskNotesSource';

/** The resolved write context {@link resolvePropertyPatch} decides against. */
export interface PropertyPatchOptions {
  /** The resolved field mappings the active source reads from. */
  mappings: FieldMappings;
  /**
   * Whether a progress write target is resolved (Property mode with a mapped
   * key). When `false` an edit on the mapped progress property is refused —
   * failing closed instead of producing a bare `progress` patch the source
   * would silently drop.
   */
  progressWritable: boolean;
  /**
   * Whether a Time Estimate write target is resolved (mode other than
   * `dont-update`, with a target mapped). When `false` an edit on the mapped
   * estimate property is refused, mirroring {@link PropertyPatchOptions.progressWritable}.
   */
  estimateWritable: boolean;
}

/**
 * Keys TaskNotes' `tasks.update` interprets as `Partial<TaskInfo>` fields and
 * gives canonical treatment (`title` can rename the file, `details` replaces
 * the note body, list fields are normalized). A generic fieldWrite must never
 * collide with them. These are TaskNotes API field names — a stable API
 * contract — not vault property names, so this set is not a hardcoded-property
 * table (the plugins stay property-agnostic).
 */
const CANONICAL_TASKINFO_KEYS: ReadonlySet<string> = new Set([
  'title',
  'status',
  'priority',
  'due',
  'scheduled',
  'tags',
  'contexts',
  'projects',
  'timeEstimate',
  'recurrence',
  'blockedBy',
  'details',
  'archived',
  'sortOrder',
  'timeEntries',
  'complete_instances',
  'skipped_instances',
  'dateCreated',
  'dateModified',
]);

/**
 * Resolve an edited property id + raw value into the right {@link TaskPatch}
 * member — mapped fields through their dedicated branches, everything else as
 * a generic `fieldWrite` by bare frontmatter key.
 *
 * Refusals (all thrown, never a droppable patch): non-note property ids
 * (`file.*`/`formula.*`), unresolvable ids, wrong-typed values for mapped
 * fields, edits on a non-writable progress/estimate mapping, and fieldWrites
 * colliding with canonical TaskNotes keys.
 *
 * @param propertyId - The edited column's property id (`note.`-prefixed or bare).
 * @param value - The raw new value; `null` clears, `[]` writes an empty list.
 * @param options - Resolved mappings + progress/estimate writability.
 */
export function resolvePropertyPatch(
  propertyId: string,
  value: unknown,
  options: PropertyPatchOptions,
): TaskPatch {
  if (/^(file|formula)[.:]/.test(propertyId)) {
    throw new TypeError(`Not a writable note property: ${propertyId}`);
  }
  const key = bareProperty(propertyId);
  if (!key) {
    throw new TypeError(`Unresolvable property id: ${propertyId}`);
  }
  const { mappings } = options;
  if (key === bareProperty(mappings.startProperty)) {
    return { start: asDatePatchValue(value, propertyId) };
  }
  if (key === bareProperty(mappings.endProperty)) {
    return { end: asDatePatchValue(value, propertyId) };
  }
  if (key === bareProperty(mappings.textProperty)) {
    return { text: asStringPatchValue(value, propertyId) };
  }
  if (key === bareProperty(mappings.statusProperty)) {
    return { status: asStringPatchValue(value, propertyId) };
  }
  if (key === bareProperty(mappings.priorityProperty)) {
    return { priority: asStringPatchValue(value, propertyId) };
  }
  if (key === bareProperty(mappings.progressProperty)) {
    if (!options.progressWritable) {
      throw new Error(
        `Mapped progress property ${propertyId} is not writable (TaskNotes computed mode); edit refused`,
      );
    }
    return { progress: asNumberPatchValue(value, propertyId) };
  }
  if (key === bareProperty(mappings.timeEstimateProperty)) {
    if (!options.estimateWritable) {
      throw new Error(
        `Mapped Time Estimate property ${propertyId} is not writable (no write target resolved); edit refused`,
      );
    }
    return { estimate: asNumberPatchValue(value, propertyId) };
  }
  if (CANONICAL_TASKINFO_KEYS.has(key)) {
    throw new TypeError(
      `Refusing generic write to canonical TaskNotes field key: ${key}`,
    );
  }
  return { fieldWrite: { key, value: asFieldWriteValue(value, propertyId) } };
}

/** Narrow a raw property-edit value for a mapped date field (`null` clears). */
function asDatePatchValue(value: unknown, propertyId: string): Date | null {
  if (value === null) {
    return null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  throw new TypeError(`Mapped date property ${propertyId} requires a Date or null`);
}

/** Narrow a raw property-edit value for a mapped string field (text/status). */
function asStringPatchValue(value: unknown, propertyId: string): string {
  if (typeof value === 'string') {
    return value;
  }
  throw new TypeError(`Mapped property ${propertyId} requires a string value`);
}

/** Narrow a raw property-edit value for a mapped numeric field (progress/estimate). */
function asNumberPatchValue(value: unknown, propertyId: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  throw new TypeError(`Mapped property ${propertyId} requires a finite number value`);
}

/**
 * Canonicalize a fieldWrite value: a `Date` serializes as local `YYYY-MM-DD`
 * (a full ISO timestamp would corrupt a frontmatter calendar-date property);
 * everything else passes verbatim.
 */
function asFieldWriteValue(value: unknown, propertyId: string): unknown {
  if (!(value instanceof Date)) {
    return value;
  }
  if (Number.isNaN(value.getTime())) {
    throw new TypeError(`Property ${propertyId} received an invalid Date`);
  }
  return toYmd(value);
}
