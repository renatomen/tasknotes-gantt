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
/**
 * Mapping members whose values are tags, not frontmatter properties. TaskNotes
 * does not treat them as property keys, so a user field may reuse the name.
 */
const TAG_SETTING_KEYS = ['archiveTag', 'icsEventTag'] as const satisfies readonly (keyof FieldMapping)[];

/**
 * The field-mapping member an update key addresses, or `null` when `tasks.update`
 * reads the key on every TaskNotes. A member is reserved only when the running
 * mapping reports it, so a newer field does not lock a user field of that name
 * on a TaskNotes that does not have the field.
 */
const UPDATE_KEY_MEMBER = {
  id: 'id',
  title: 'title',
  status: 'status',
  priority: 'priority',
  due: 'due',
  scheduled: 'scheduled',
  path: null,
  archived: null,
  tags: null,
  contexts: 'contexts',
  projects: 'projects',
  attachments: 'attachments',
  assignees: 'assignees',
  recurrence: 'recurrence',
  recurrence_anchor: 'recurrenceAnchor',
  recurrence_original_date: 'recurrenceOriginalDate',
  complete_instances: 'completeInstances',
  skipped_instances: 'skippedInstances',
  recurrence_parent: 'recurrenceParent',
  occurrence_date: 'occurrenceDate',
  occurrence_materialization: 'occurrenceMaterialization',
  occurrence_next_trigger: 'occurrenceNextTrigger',
  occurrence_template: 'occurrenceTemplate',
  occurrence_past_horizon: 'occurrencePastHorizon',
  occurrence_future_horizon: 'occurrenceFutureHorizon',
  completedDate: 'completedDate',
  timeEstimate: 'timeEstimate',
  timeEntries: 'timeEntries',
  totalTrackedTime: null,
  dateCreated: 'dateCreated',
  dateModified: 'dateModified',
  icsEventId: 'icsEventId',
  googleCalendarEventId: 'googleCalendarEventId',
  googleCalendarExceptionEventId: 'googleCalendarExceptionEventId',
  googleCalendarExceptionOriginalScheduled: 'googleCalendarExceptionOriginalScheduled',
  googleCalendarMovedOriginalDates: 'googleCalendarMovedOriginalDates',
  reminders: 'reminders',
  customProperties: null,
  basesData: null,
  blockedBy: 'blockedBy',
  blocking: null,
  isBlocked: null,
  isBlocking: null,
  hasSubtasks: null,
  details: null,
  sortOrder: 'sortOrder',
  customFrontmatter: null,
} as const satisfies Record<keyof TaskUpdateInput, keyof FieldMapping | null>;

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
 * A reported mapping value, excluding tag settings. The model's property
 * checker also fills defaults for members the running mapping did not report,
 * which would lock a user field on a TaskNotes that has no such field.
 */
function propertyIsOwned(mapping: Readonly<Record<string, string>>, key: string): boolean {
  for (const [member, value] of Object.entries(mapping)) {
    if ((TAG_SETTING_KEYS as readonly string[]).includes(member)) continue;
    if (value === key) return true;
  }
  return false;
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
 * An update key that addresses a field-mapping member is reserved only when
 * the running mapping reports that member. Keys no member addresses, such as
 * `details` and `tags`, stay reserved: `tasks.update` reads them, and a
 * generic write of `details` replaces the note body.
 */
function runningHasUpdateKey(
  key: string,
  mapping: Readonly<Record<string, string>>
): boolean {
  const member = UPDATE_KEY_MEMBER[key as keyof typeof UPDATE_KEY_MEMBER];
  if (member === undefined) return true;
  if (member === null) return true;
  return typeof mapping[member] === 'string';
}
