/**
 * Type-tagged property values for the Gantt grid (plan 2026-06-18-001, U1).
 *
 * The grid mirrors the Base's selected properties, rendering each cell by its
 * type. `BasesDataAdapter.extractValue` returns **heterogeneous** forms for the
 * same logical type — a `note.`-prefixed date is the raw frontmatter *string*
 * `"2026-06-17"`, a computed date is an *ISO string*, only rarely a `Date` — so
 * the cell cannot type-switch on `instanceof`. This module classifies each raw
 * value by its *shape* into a small tagged union `{ kind, value }`; the cell
 * (U3) formats from `kind`. Classifying here (deterministically) also lets the
 * diff-sync key fold a stable fingerprint of the displayed values (U4).
 *
 * Pure and dependency-free: it takes an extractor with `extractValue` and the
 * Bases entries, and yields a `sourcePath → { propId: TypedValue }` map. Values
 * are resolved at `GanttData` assembly time (not threaded through the
 * source/controller pipeline), keyed by source path so every render instance of
 * a multi-parent task reads identical values.
 *
 * @module bases/propertyValues
 */

/** The display kind a property value is classified into. */
export type TypedValueKind =
  | 'date'
  | 'number'
  | 'boolean'
  | 'text'
  | 'list'
  | 'link'
  | 'empty';

/** A property value tagged with the kind that drives its cell rendering. */
export interface TypedValue {
  kind: TypedValueKind;
  /**
   * The carried value: `Date` for `date`, `number` for `number`, `boolean` for
   * `boolean`, the display text for `link`, `string[]` of display items for
   * `list`, the string for `text`, `null` for `empty`.
   */
  value: unknown;
}

/** Minimal extractor contract — `BasesDataAdapter` satisfies it. */
export interface PropertyExtractor {
  extractValue(entry: unknown, propertyId: string): unknown;
}

/** A full-string match for an ISO / `YYYY-MM-DD` date (optionally with time). */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ][\d:.+Z-]*)?$/;

/** A bare wikilink `[[target]]` or `[[target|alias]]`. */
const WIKILINK_RE = /^\[\[([^\]]+)\]\]$/;

/** Last path segment with any `.md` extension stripped. */
function basename(path: string): string {
  const seg = path.split('/').pop() ?? path;
  return seg.endsWith('.md') ? seg.slice(0, -3) : seg;
}

/**
 * Display text for a link-shaped string, or `null` when the string isn't a
 * link. Handles `[[target|alias]]` (→ alias), `[[path/target]]` (→ basename),
 * and a bare note path like `folder/Note.md` or root-level `Note.md`
 * (→ basename). A `.md` string here is a resolved FileValue path
 * (`convertValueToNative`) or a frontmatter path; wikilinks are handled above.
 */
function linkDisplay(s: string): string | null {
  const wiki = WIKILINK_RE.exec(s);
  if (wiki) {
    const inner = wiki[1] ?? '';
    const aliasIdx = inner.indexOf('|');
    if (aliasIdx !== -1) return inner.slice(aliasIdx + 1).trim();
    return basename(inner.trim());
  }
  if (s.endsWith('.md')) return basename(s);
  return null;
}

/** Display text for one list item (wikilink/FileValue → basename, else string). */
function listItemDisplay(item: unknown): string {
  if (item === null || item === undefined) return '';
  if (typeof item === 'string') {
    const link = linkDisplay(item);
    return link ?? item;
  }
  if (typeof item === 'object') {
    const path = (item as { file?: { path?: unknown } }).file?.path;
    if (typeof path === 'string') return basename(path);
  }
  return String(item);
}

/**
 * Classify a raw extracted value into a {@link TypedValue} by its runtime
 * shape. Pure and total — every input yields a tag (unknown shapes → `text`).
 */
export function classifyTypedValue(raw: unknown): TypedValue {
  if (raw === null || raw === undefined || raw === '') {
    return { kind: 'empty', value: null };
  }
  if (typeof raw === 'boolean') {
    return { kind: 'boolean', value: raw };
  }
  if (typeof raw === 'number') {
    return Number.isNaN(raw) ? { kind: 'empty', value: null } : { kind: 'number', value: raw };
  }
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? { kind: 'empty', value: null } : { kind: 'date', value: raw };
  }
  if (Array.isArray(raw)) {
    const items = raw.map(listItemDisplay).filter((s) => s !== '');
    return items.length > 0 ? { kind: 'list', value: items } : { kind: 'empty', value: null };
  }
  if (typeof raw === 'string') {
    const link = linkDisplay(raw);
    if (link !== null) return { kind: 'link', value: link };
    if (ISO_DATE_RE.test(raw)) {
      const d = new Date(raw);
      if (!Number.isNaN(d.getTime())) return { kind: 'date', value: d };
    }
    return { kind: 'text', value: raw };
  }
  if (typeof raw === 'object') {
    const path = (raw as { file?: { path?: unknown } }).file?.path;
    if (typeof path === 'string') return { kind: 'link', value: basename(path) };
  }
  return { kind: 'text', value: String(raw) };
}

/**
 * Build the per-task type-tagged property map for the visible columns.
 *
 * @param entries - the Bases entries (each must expose `file.path`)
 * @param visiblePropIds - the property ids to extract (the Base's visible set)
 * @param extractor - supplies the raw value per (entry, propertyId)
 * @returns `sourcePath → { propId: TypedValue }`; empty when no visible columns
 */
export function buildEntryProperties(
  entries: readonly unknown[],
  visiblePropIds: readonly string[],
  extractor: PropertyExtractor,
): Map<string, Record<string, TypedValue>> {
  const map = new Map<string, Record<string, TypedValue>>();
  if (visiblePropIds.length === 0) return map;

  for (const entry of entries) {
    const path = (entry as { file?: { path?: unknown } })?.file?.path;
    if (typeof path !== 'string') continue;

    const record: Record<string, TypedValue> = {};
    for (const propId of visiblePropIds) {
      record[propId] = classifyTypedValue(extractor.extractValue(entry, propId));
    }
    map.set(path, record);
  }
  return map;
}
