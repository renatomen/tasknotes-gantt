/**
 * Pure resolution of a view's field mappings against TaskNotes' field config.
 *
 * The chart reads the properties this returns and writes through the targets
 * it returns, so an inline edit lands on the column the user is looking at.
 * With no field config the view mappings pass through and nothing is writable:
 * there is no backing property to default to, and assuming one would name a
 * field the user never chose.
 *
 * Status and priority are writable only when the property the view reads is
 * the property TaskNotes persists. An unset mapping resolves to that property,
 * so it is writable. A view pointed somewhere else is read-only: the canonical
 * write would land where the edited column does not show.
 *
 * @module controller/fieldMappingResolution
 */

import type { Branded } from '../brandedValue';
import { bareProperty, resolveDateMapping, toNoteProperty } from '../datasource/dateFieldMapping';
import type { FieldMappings } from '../datasource/fieldMappings';
import type { DateWriteTarget, FieldConfig } from '../datasource/types';

/** Roles whose inline edit persists only when the view reads TaskNotes' own property. */
export type WritableMappedRole = 'status' | 'priority' | 'assignees';

/** One writability answer per {@link WritableMappedRole}, minted here. */
export type RoleWritability = Branded<
  { [Role in WritableMappedRole]: boolean },
  'fieldMapping.roleWritability'
>;

/**
 * The resolved date-field mapping state for the active source.
 * Surfaces whether each role's configured property was a valid TaskNotes date
 * target (so the view can show an "invalid mapping" notice) and the effective
 * read property used. All-`false`/`null` when there is no field config.
 */
export interface DateMappingInfo {
  startInvalid: boolean;
  endInvalid: boolean;
  startReadProp: string | null;
  endReadProp: string | null;
}

/** Everything a caller needs to read, write, and gate the resolved mappings. */
export interface FieldMappingResolution {
  mappings: FieldMappings;
  startWriteTarget: DateWriteTarget | null;
  endWriteTarget: DateWriteTarget | null;
  dateMappingInfo: DateMappingInfo;
  roleWritability: RoleWritability;
}

function mintRoleWritability(flags: { [Role in WritableMappedRole]: boolean }): RoleWritability {
  return flags as RoleWritability;
}

/** A fresh all-false record, for before resolution and for a missing field config. */
export function unresolvedRoleWritability(): RoleWritability {
  return mintRoleWritability({ status: false, priority: false, assignees: false });
}

/**
 * Resolve the property a field mapping reads: the view's own mapping when it sets
 * one, else the backing system's configured property (note-prefixed to a Bases
 * property id). Unset on both sides stays unset — no property name is assumed.
 */
function resolveMappedProperty(
  configured: string | undefined,
  fallbackProp: string | null,
): string | undefined {
  if ((configured ?? '').trim() !== '') return configured;
  const fallback = (fallbackProp ?? '').trim();
  return fallback !== '' ? toNoteProperty(fallback) : configured;
}

/**
 * Whether a canonical write to the backing system's field would land on the very
 * property the view reads. An unconfigured backing field has nowhere to write.
 */
function writesToSameProperty(
  readProperty: string | undefined,
  backingProp: string | null,
): boolean {
  const backing = (backingProp ?? '').trim();
  if (backing === '') return false;
  return bareProperty(readProperty) === backing;
}

/** Resolve view mappings against TaskNotes' field config. `null` config passes them through. */
export function resolveFieldMappings(
  mappings: FieldMappings,
  fieldConfig: FieldConfig | null,
): FieldMappingResolution {
  if (!fieldConfig) {
    return {
      mappings: { ...mappings },
      startWriteTarget: null,
      endWriteTarget: null,
      dateMappingInfo: {
        startInvalid: false,
        endInvalid: false,
        startReadProp: null,
        endReadProp: null,
      },
      roleWritability: mintRoleWritability({ status: false, priority: false, assignees: false }),
    };
  }

  const startRes = resolveDateMapping(bareProperty(mappings.startProperty), 'start', fieldConfig);
  const endRes = resolveDateMapping(bareProperty(mappings.endProperty), 'end', fieldConfig);
  const statusProperty = resolveMappedProperty(mappings.statusProperty, fieldConfig.statusProp);
  const priorityProperty = resolveMappedProperty(mappings.priorityProperty, fieldConfig.priorityProp);
  // No Assignees field: leave the role unset even when the view names a column,
  // so a registered user field of that name keeps its own editor.
  const assigneesBacking = (fieldConfig.assigneesProp ?? '').trim();
  const assigneesProperty =
    assigneesBacking !== ''
      ? resolveMappedProperty(mappings.assigneesProperty, fieldConfig.assigneesProp ?? null)
      : undefined;

  return {
    mappings: {
      ...mappings,
      startProperty: toNoteProperty(startRes.readProp),
      endProperty: toNoteProperty(endRes.readProp),
      statusProperty,
      priorityProperty,
      assigneesProperty,
    },
    startWriteTarget: startRes.writeTarget,
    endWriteTarget: endRes.writeTarget,
    dateMappingInfo: {
      startInvalid: startRes.invalid,
      endInvalid: endRes.invalid,
      startReadProp: startRes.readProp,
      endReadProp: endRes.readProp,
    },
    roleWritability: mintRoleWritability({
      status: writesToSameProperty(statusProperty, fieldConfig.statusProp),
      priority: writesToSameProperty(priorityProperty, fieldConfig.priorityProp),
      assignees: writesToSameProperty(assigneesProperty, fieldConfig.assigneesProp ?? null),
    }),
  };
}
