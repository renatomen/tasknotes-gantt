/**
 * Which generic property writes TaskNotes would treat as one of its own fields.
 *
 * A column is owned when its frontmatter key is a property the running field
 * mapping assigns to a built-in field. A second check refuses an update key
 * `tasks.update` reads as a built-in field even when that field is stored
 * under a different property. Mapped roles are decided before either check.
 *
 * @module controller/fieldOwnership
 */

import type { FieldMapping, TaskUpdateInput } from '@tasknotes/model';
import { isRecognizedProperty } from '@tasknotes/model/mapping';

/**
 * Every key of the bundled update type. A model bump that adds a field fails
 * typecheck until this record covers it.
 */
export const TASK_UPDATE_KEYS = {
  id: true,
  title: true,
  status: true,
  priority: true,
  due: true,
  scheduled: true,
  path: true,
  archived: true,
  tags: true,
  contexts: true,
  projects: true,
  attachments: true,
  assignees: true,
  recurrence: true,
  recurrence_anchor: true,
  recurrence_original_date: true,
  complete_instances: true,
  skipped_instances: true,
  recurrence_parent: true,
  occurrence_date: true,
  occurrence_materialization: true,
  occurrence_next_trigger: true,
  occurrence_template: true,
  occurrence_past_horizon: true,
  occurrence_future_horizon: true,
  completedDate: true,
  timeEstimate: true,
  timeEntries: true,
  totalTrackedTime: true,
  dateCreated: true,
  dateModified: true,
  icsEventId: true,
  googleCalendarEventId: true,
  googleCalendarExceptionEventId: true,
  googleCalendarExceptionOriginalScheduled: true,
  googleCalendarMovedOriginalDates: true,
  reminders: true,
  customProperties: true,
  basesData: true,
  blockedBy: true,
  blocking: true,
  isBlocked: true,
  isBlocking: true,
  hasSubtasks: true,
  details: true,
  sortOrder: true,
  customFrontmatter: true,
} as const satisfies Record<keyof TaskUpdateInput, true>;

/**
 * Field-mapping members. An update key that appears here is reserved only
 * when the running mapping has it, so a user field can keep a name that this
 * TaskNotes does not use as a built-in field.
 */
const BUILT_IN_FIELD_KEYS = {
  id: true,
  title: true,
  status: true,
  priority: true,
  due: true,
  scheduled: true,
  contexts: true,
  projects: true,
  attachments: true,
  assignees: true,
  timeEstimate: true,
  completedDate: true,
  dateCreated: true,
  dateModified: true,
  recurrence: true,
  recurrenceAnchor: true,
  recurrenceOriginalDate: true,
  recurrenceParent: true,
  occurrenceDate: true,
  occurrenceMaterialization: true,
  occurrenceNextTrigger: true,
  occurrenceTemplate: true,
  occurrencePastHorizon: true,
  occurrenceFutureHorizon: true,
  archiveTag: true,
  timeEntries: true,
  completeInstances: true,
  skippedInstances: true,
  blockedBy: true,
  pomodoros: true,
  icsEventId: true,
  icsEventTag: true,
  googleCalendarEventId: true,
  googleCalendarExceptionEventId: true,
  googleCalendarExceptionOriginalScheduled: true,
  googleCalendarMovedOriginalDates: true,
  reminders: true,
  sortOrder: true,
} as const satisfies Record<keyof FieldMapping, true>;

/** The running mapping's answer, or unreadable when it could not be read. */
export interface FieldOwnership {
  /** False when the mapping could not be read. Every generic write is then refused. */
  known: boolean;
  /** Present only when {@link FieldOwnership.known} and a mapping was read. */
  mapping?: Readonly<Record<string, string>>;
  /** Update-object keys the running TaskNotes interprets as built-in fields. */
  reservedUpdateKeys: ReadonlySet<string>;
}

/** Mapping unreadable: do not guess which properties are built-in. */
export function unknownFieldOwnership(): FieldOwnership {
  return {
    known: false,
    reservedUpdateKeys: new Set(Object.keys(TASK_UPDATE_KEYS)),
  };
}

/**
 * No mapping was supplied by an older caller. Refuse every update key, and
 * do not treat arbitrary property names as owned.
 */
export function legacyFieldOwnership(): FieldOwnership {
  return {
    known: true,
    reservedUpdateKeys: new Set(Object.keys(TASK_UPDATE_KEYS)),
  };
}

/** Ownership for a mapping that was actually read. */
export function resolveFieldOwnership(
  mapping: Readonly<Record<string, string>>
): FieldOwnership {
  return {
    known: true,
    mapping,
    reservedUpdateKeys: reservedUpdateKeys(mapping),
  };
}

/**
 * Whether a generic write of `key` would land on a field TaskNotes owns.
 * Mapped roles are not this function's concern; callers match those first.
 */
export function refusesGenericWrite(
  key: string,
  ownership: FieldOwnership
): boolean {
  if (!ownership.known) return true;
  if (ownership.reservedUpdateKeys.has(key)) return true;
  if (!ownership.mapping) return false;
  return propertyIsOwned(ownership.mapping, key);
}

/**
 * The checker types a complete mapping. A stored mapping omits members, and
 * the function itself supplies the two optional defaults, so the cast is the
 * boundary rather than a second copy of that defaulting.
 */
function propertyIsOwned(mapping: Readonly<Record<string, string>>, key: string): boolean {
  return isRecognizedProperty(mapping as unknown as FieldMapping, key);
}

/** The ownership a writability record carries, or the legacy set when it carries none. */
export function readFieldOwnership(record: {
  ownership?: FieldOwnership;
}): FieldOwnership {
  return record.ownership ?? legacyFieldOwnership();
}

function reservedUpdateKeys(
  mapping: Readonly<Record<string, string>>
): ReadonlySet<string> {
  const reserved = new Set<string>();
  for (const key of Object.keys(TASK_UPDATE_KEYS)) {
    if (runningHasUpdateKey(key, mapping)) reserved.add(key);
  }
  return reserved;
}

/**
 * An update key that is also a field-mapping member is reserved only when the
 * running mapping has that member. Keys the mapping type never carries, such
 * as `details` and `tags`, stay reserved: `tasks.update` reads them, and a
 * generic write of `details` replaces the note body.
 */
function runningHasUpdateKey(
  key: string,
  mapping: Readonly<Record<string, string>>
): boolean {
  if (
    Object.prototype.hasOwnProperty.call(mapping, key) &&
    typeof mapping[key] === 'string'
  ) {
    return true;
  }
  return !Object.prototype.hasOwnProperty.call(BUILT_IN_FIELD_KEYS, key);
}
