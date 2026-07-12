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

/** The canonical `empty` value — the shared default where a value is absent. */
export const EMPTY_TYPED_VALUE: TypedValue = { kind: 'empty', value: null };

/** Element-wise equality of two display-item lists. */
export function listsEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

/**
 * String form of a scalar frontmatter value, or `null` for anything without a
 * meaningful single-token form: `null`/`undefined` and non-null objects (a
 * nested-map frontmatter value). Guards against the default `[object Object]`
 * coercion — an object has no displayable/storable token, so callers drop it.
 * Primitives (string, number, boolean, bigint, symbol) stringify verbatim.
 */
export function stringifyScalar(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') return null;
  return String(raw);
}

/** Minimal extractor contract — `BasesDataAdapter` satisfies it. */
export interface PropertyExtractor {
  extractValue(entry: unknown, propertyId: string): unknown;
}

/** A full-string match for an ISO / `YYYY-MM-DD` date (optionally with time). */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ][\d:.+Z-]*)?$/;

/** A date-*only* string (no time component). */
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse a date-like string to a `Date`, or `null` if invalid.
 *
 * A date-*only* string (`YYYY-MM-DD`) is built as **local** midnight — `new
 * Date("2026-06-17")` parses as UTC midnight, and the cell formatter reads
 * local getters, so a UTC parse renders the previous day for users west of UTC.
 * A date-*time* string keeps its instant (`new Date(s)`).
 */
function parseDateString(s: string): Date | null {
  const dateOnly = DATE_ONLY_RE.exec(s);
  const d = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

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
export function linkDisplay(s: string): string | null {
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

/** A non-empty array → `list` of display items; an all-empty array → `empty`. */
function classifyArray(raw: readonly unknown[]): TypedValue {
  const items = raw.map(listItemDisplay).filter((s) => s !== '');
  return items.length > 0 ? { kind: 'list', value: items } : { kind: 'empty', value: null };
}

/**
 * Classify a string by its shape: a wikilink/note path → `link`, an
 * ISO/`YYYY-MM-DD` string that parses → `date`, otherwise plain `text`.
 */
function classifyString(raw: string): TypedValue {
  const link = linkDisplay(raw);
  if (link !== null) return { kind: 'link', value: link };
  if (ISO_DATE_RE.test(raw)) {
    const d = parseDateString(raw);
    if (d) return { kind: 'date', value: d };
  }
  return { kind: 'text', value: raw };
}

/**
 * Classify a non-array object: a FileValue-shaped `{ file: { path } }` → `link`
 * (basename), any other shape → coerced `text`.
 */
function classifyObject(raw: object): TypedValue {
  const path = (raw as { file?: { path?: unknown } }).file?.path;
  if (typeof path === 'string') return { kind: 'link', value: basename(path) };
  return { kind: 'text', value: String(raw) };
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
    return classifyArray(raw);
  }
  if (typeof raw === 'string') {
    return classifyString(raw);
  }
  if (typeof raw === 'object') {
    return classifyObject(raw);
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

/** Minimal metadata for a fetched (out-of-result) note's synthetic Bases entry. */
export interface FetchedFileMeta {
  /** Vault-relative path (the map key). */
  path: string;
  /** File basename (no extension). */
  basename: string;
  /** File extension without the dot; defaults to `md`. */
  extension?: string;
  /** The note's frontmatter, or `null` when it has none. */
  frontmatter: Record<string, unknown> | null;
}

/**
 * Gather {@link FetchedFileMeta} for the show-all *context* rows — instances
 * whose path is not already in `seen` (the matched-row keys) and that `resolve`
 * maps to a real file. Each new path is added to `seen` so it is gathered once,
 * and a path `resolve` rejects (folder, missing file) is skipped. Pure: the
 * Obsidian file/frontmatter lookup lives in the injected `resolve`.
 */
export function collectFetchedFileMetas(
  instances: readonly { sourcePath: string }[],
  seen: Set<string>,
  resolve: (path: string) => Omit<FetchedFileMeta, 'path'> | null,
): FetchedFileMeta[] {
  const fetchedMetas: FetchedFileMeta[] = [];
  for (const inst of instances) {
    if (seen.has(inst.sourcePath)) continue;
    seen.add(inst.sourcePath);
    const meta = resolve(inst.sourcePath);
    if (!meta) continue;
    fetchedMetas.push({ path: inst.sourcePath, ...meta });
  }
  return fetchedMetas;
}

/**
 * Build grid property records for fetched (out-of-result) paths — the Show-all
 * *context* rows (U6), which are NOT in the Bases filter result and so have no
 * real Bases entry. Each path is given a *synthetic* entry (frontmatter + a
 * minimal file + a `getValue` that returns `null`) and run through the SAME
 * `extractor` matched rows use, so `note.*`/`file.*` columns resolve from the
 * note while genuine Base **formula/computed** columns fall back to empty (R5 —
 * fetched rows can't run the Bases formula engine). Keyed by path; merge into
 * {@link buildEntryProperties}' matched-row map.
 */
export function buildFetchedEntryProperties(
  metas: readonly FetchedFileMeta[],
  visiblePropIds: readonly string[],
  extractor: PropertyExtractor,
): Map<string, Record<string, TypedValue>> {
  const entries = metas.map((m) => ({
    file: {
      path: m.path,
      basename: m.basename,
      name: `${m.basename}.${m.extension ?? 'md'}`,
      extension: m.extension ?? 'md',
    },
    frontmatter: m.frontmatter ?? {},
    // A synthetic entry has no formula engine; null keeps formula columns empty
    // (cleanly, without the extractor's getValue-threw warning path).
    getValue: () => null,
  }));
  return buildEntryProperties(entries, visiblePropIds, extractor);
}
