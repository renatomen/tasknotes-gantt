/**
 * Cell render-type resolver.
 *
 * Decides how a grid property column renders — as Obsidian markdown (clickable
 * wikilinks, tag pills, emphasis, lists) or via the conventional formatter
 * (dates/numbers/booleans) — by resolving the column's type from three sources
 * in priority order:
 *
 *   1. TaskNotes custom-field config (authoritative — the user defines the
 *      field's shape there; also carries editing metadata for the future editor)
 *   2. Obsidian `metadataTypeManager` widget (the only source expressing `tags`)
 *   3. Bases value shape (the classified `TypedValue.kind`)
 *
 * Pure and dependency-free: it takes injected lookups so it is unit-testable
 * without Obsidian or TaskNotes. TaskNotes has no tags/link type, so a
 * TaskNotes-managed field never renders as tag pills — tag rendering reaches
 * only non-TaskNotes fields via the widget map.
 *
 * @module bases/cellRenderType
 */

import type { TypedValueKind } from './propertyValues';

/** Editing metadata a TaskNotes custom field carries (surfaced for a later editor). */
export interface TaskNotesFieldMeta {
  type: string;
  autosuggestFilter?: unknown;
}

/** How a cell should render, plus whether tag-pill injection applies. */
export interface CellRenderType {
  display: 'markdown' | 'conventional';
  /** True only when the resolved type is the Obsidian `tags` widget. */
  tags: boolean;
  /** Present when a TaskNotes custom field owns this column (for the editor follow-up). */
  fieldMeta?: TaskNotesFieldMeta;
}

/** Injected type-source lookups plus the classified value kind for the fallback. */
export interface RenderTypeDeps {
  /** TaskNotes custom-field type for a frontmatter key, or `null` when not a user field. */
  taskNotesFieldType(propertyKey: string): TaskNotesFieldMeta | null;
  /** Obsidian widget type for a property name, or `null` when unknown. */
  obsidianWidget(propertyName: string): string | null;
  /** The Bases-classified value kind, used only when the first two sources miss. */
  valueKind: TypedValueKind;
}

/** TaskNotes field types that render as markdown; the rest use conventional formatting. */
const TASKNOTES_MARKDOWN_TYPES: ReadonlySet<string> = new Set(['text', 'list']);

/** Widget types that render as markdown text (no tag injection). */
const WIDGET_MARKDOWN_TYPES: ReadonlySet<string> = new Set(['text', 'multitext', 'aliases']);

/** Value kinds that render as markdown when neither TaskNotes nor the widget map decides. */
const MARKDOWN_VALUE_KINDS: ReadonlySet<TypedValueKind> = new Set(['text', 'list', 'link']);

/** Strip a Bases property-id prefix (`note.`/`file.`/`formula.`) to the bare property name. */
function stripPrefix(propId: string): string {
  const dot = propId.indexOf('.');
  return dot === -1 ? propId : propId.slice(dot + 1);
}

/**
 * Resolve how the column identified by `propId` should render, applying the
 * TaskNotes → widget → value-shape precedence.
 */
export function resolveCellRenderType(propId: string, deps: RenderTypeDeps): CellRenderType {
  const name = stripPrefix(propId);

  const taskNotes = deps.taskNotesFieldType(name);
  if (taskNotes) {
    const display = TASKNOTES_MARKDOWN_TYPES.has(taskNotes.type) ? 'markdown' : 'conventional';
    return { display, tags: false, fieldMeta: taskNotes };
  }

  const widget = deps.obsidianWidget(name);
  if (widget) {
    if (widget === 'tags') return { display: 'markdown', tags: true };
    if (WIDGET_MARKDOWN_TYPES.has(widget)) return { display: 'markdown', tags: false };
    return { display: 'conventional', tags: false };
  }

  return MARKDOWN_VALUE_KINDS.has(deps.valueKind)
    ? { display: 'markdown', tags: false }
    : { display: 'conventional', tags: false };
}
