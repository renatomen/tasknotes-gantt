/**
 * Pure matcher from a bare frontmatter key to the mapped canonical field it
 * addresses — the shared core of the editor resolver ({@link ./cellEditability})
 * and the write path ({@link ../controller/propertyPatchResolution}), so the
 * two sides can never drift on HOW a key matches a mapping (`note.` prefix
 * normalized on both sides, first match wins).
 *
 * Precedence is caller-owned: the two sides deliberately rank `text`
 * differently (the editor resolver last, the write path ahead of status), so
 * each passes its own ordered role list rather than inheriting one here.
 *
 * Dependency-free (no Obsidian/SVAR).
 *
 * @module bases/mappedFieldRole
 */

import { bareProperty } from '../datasource/dateFieldMapping';
import type { FieldMappings } from './types/field-mapping';

/** A mapped canonical field a bare frontmatter key can address. */
export type MappedFieldRole =
  | 'start'
  | 'end'
  | 'text'
  | 'status'
  | 'priority'
  | 'progress'
  | 'estimate';

const ROLE_PROPERTY: Readonly<
  Record<MappedFieldRole, (mappings: FieldMappings) => string | undefined>
> = {
  start: (mappings) => mappings.startProperty,
  end: (mappings) => mappings.endProperty,
  text: (mappings) => mappings.textProperty,
  status: (mappings) => mappings.statusProperty,
  priority: (mappings) => mappings.priorityProperty,
  progress: (mappings) => mappings.progressProperty,
  estimate: (mappings) => mappings.timeEstimateProperty,
};

/**
 * Match a bare frontmatter key against the mapped canonical fields, trying the
 * given roles in order — the first whose mapped property has the same bare form
 * wins. An unset or empty mapping never matches. Returns `null` when the key
 * addresses no mapped field.
 */
export function matchMappedFieldRole(
  key: string,
  mappings: FieldMappings,
  precedence: ReadonlyArray<MappedFieldRole>,
): MappedFieldRole | null {
  for (const role of precedence) {
    if (key === bareProperty(ROLE_PROPERTY[role](mappings))) return role;
  }
  return null;
}
