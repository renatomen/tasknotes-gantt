/**
 * Cell editor resolver — decides which inline editor (if any) a grid property
 * column offers.
 *
 * Editable columns are exactly the properties TaskNotes can persist: the mapped
 * canonical fields (start/end/status/priority/progress/estimate) and registered
 * TaskNotes custom user fields. Everything else resolves to no editor —
 * computed columns (`file.*`/`formula.*`), the name column (the write bridge
 * cannot attribute name edits; title edits stay with the modal), and
 * unregistered `note.*` properties (TaskNotes' frontmatter writer silently
 * drops unknown keys). Status/priority/progress/estimate editors are additionally
 * gated on a resolved write target, mirroring
 * {@link import('../controller/propertyPatchResolution')} so an editor is never
 * offered where the write path would refuse.
 *
 * Pure and dependency-free (no Obsidian/SVAR): lookups are injected, matching
 * {@link ./cellRenderType}.
 *
 * @module bases/cellEditability
 */

import { bareProperty } from '../datasource/dateFieldMapping';
import type { TaskNotesFieldMeta } from './cellRenderType';
import type { FieldMappings } from './types/field-mapping';

/** The inline editor families a cell can resolve to. */
export type CellEditorKind =
  | 'date'
  | 'text'
  | 'number'
  | 'boolean'
  | 'list'
  | 'choice-status'
  | 'choice-priority'
  | 'suggest';

/** A resolved editor for one column: its kind plus TaskNotes' suggest scope. */
export interface CellEditorDescriptor {
  kind: CellEditorKind;
  /** TaskNotes `FileFilterConfig` scoping a `suggest` editor; opaque here. */
  autosuggestFilter?: unknown;
  /**
   * Whether a `suggest` column's underlying field is list-shaped. List commits
   * APPEND an entry through the direct write path (never the grid bridge, whose
   * display-form diffing cannot represent wikilink lists); single-value commits
   * ride the bridge with text semantics.
   */
  isList?: boolean;
  /**
   * Which mapped date role a `date` column carries. Only the mapped start/end
   * columns have one — it keys the cross-field start≤end validation; a custom
   * TaskNotes date field is order-free and carries none.
   */
  dateRole?: 'start' | 'end';
}

/** Injected lookups + writability the editor resolution decides against. */
export interface CellEditorDeps {
  /** TaskNotes custom-field meta for a bare frontmatter key, or `null`. */
  taskNotesFieldType(propertyKey: string): TaskNotesFieldMeta | null;
  /** The view's resolved field mappings (mapped fields take precedence). */
  mappings: FieldMappings;
  /** Whether a progress write target is resolved (Property mode with a key). */
  progressWritable: boolean;
  /** Whether a Time Estimate write target is resolved (mode ≠ `dont-update`). */
  estimateWritable: boolean;
  /**
   * Whether the mapped status property is the one TaskNotes persists to. TaskNotes
   * writes status through its OWN configured property, so a view mapped to a
   * different one can only be read — an editor there would write somewhere the
   * column does not show.
   */
  statusWritable: boolean;
  /** Whether the mapped priority property is TaskNotes' own. Mirrors {@link statusWritable}. */
  priorityWritable: boolean;
  /** `true` for the name/hierarchy column (never editable inline). */
  isNameColumn: boolean;
}

/**
 * Resolve the editor for the column identified by `propId`, or `null` for a
 * read-only column. Mapped canonical fields win over a registered user field
 * of the same key; matching normalizes the `note.` prefix on both sides,
 * mirroring the write path's `resolvePropertyPatch`.
 */
export function resolveCellEditor(propId: string, deps: CellEditorDeps): CellEditorDescriptor | null {
  if (/^(file|formula)[.:]/.test(propId)) return null;
  if (deps.isNameColumn) return null;
  const key = bareProperty(propId);
  if (!key) return null;

  const { mappings } = deps;
  if (key === bareProperty(mappings.startProperty)) {
    return { kind: 'date', dateRole: 'start' };
  }
  if (key === bareProperty(mappings.endProperty)) {
    return { kind: 'date', dateRole: 'end' };
  }
  if (key === bareProperty(mappings.statusProperty)) {
    return deps.statusWritable ? { kind: 'choice-status' } : null;
  }
  if (key === bareProperty(mappings.priorityProperty)) {
    return deps.priorityWritable ? { kind: 'choice-priority' } : null;
  }
  if (key === bareProperty(mappings.progressProperty)) {
    return deps.progressWritable ? { kind: 'number' } : null;
  }
  if (key === bareProperty(mappings.timeEstimateProperty)) {
    return deps.estimateWritable ? { kind: 'number' } : null;
  }
  if (key === bareProperty(mappings.textProperty)) return null;

  const field = deps.taskNotesFieldType(key);
  return field ? editorForUserField(field) : null;
}

/** Map a registered TaskNotes user field's type to its editor descriptor. */
function editorForUserField(field: TaskNotesFieldMeta): CellEditorDescriptor {
  switch (field.type) {
    case 'date':
      return { kind: 'date' };
    case 'boolean':
      return { kind: 'boolean' };
    case 'number':
      return { kind: 'number' };
    case 'list':
    case 'text':
      if (field.autosuggestFilter) {
        return {
          kind: 'suggest',
          autosuggestFilter: field.autosuggestFilter,
          isList: field.type === 'list',
        };
      }
      return { kind: field.type };
    default:
      return { kind: 'text' };
  }
}
