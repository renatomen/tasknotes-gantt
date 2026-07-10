/**
 * Per-cell render descriptors for the Gantt grid.
 *
 * A {@link CellRender} tells {@link import('./PropertyCell.svelte')} how to draw
 * a cell: either plain `text` (the conventional formatter's output, for
 * dates/numbers/booleans) or a `markdown` `source` string fed to Obsidian's
 * `MarkdownRenderer` (for wikilinks, tag pills, emphasis, lists).
 *
 * Descriptors are computed at `GanttData` assembly time in a single extraction
 * pass that also yields the type-tagged {@link TypedValue} map (kept for the
 * diff-sync fingerprint). Critically, the markdown `source` is built from the
 * **raw** extracted value — the classified `TypedValue` for a link keeps only
 * display text, which `MarkdownRenderer` could not turn back into a link.
 *
 * Pure and dependency-free: the render-type decision is injected as a callback
 * so this stays unit-testable without Obsidian or TaskNotes.
 *
 * @module bases/cellRender
 */

import { buildCellMarkdownSource } from './cellMarkdownSource';
import type { CellRenderType } from './cellRenderType';
import { formatPropertyValue } from './propertyFormat';
import {
  classifyTypedValue,
  type PropertyExtractor,
  type TypedValue,
  type TypedValueKind,
  type FetchedFileMeta,
} from './propertyValues';

/** How a grid cell renders: conventional text, or a markdown source string. */
export type CellRender =
  | { mode: 'text'; text: string }
  | { mode: 'markdown'; source: string };

/** Resolve a column's render directive from its id and classified value kind. */
export type ResolveRenderType = (propId: string, valueKind: TypedValueKind) => CellRenderType;

/** The paired output of one extraction pass: display descriptors + typed values. */
export interface CellData {
  /** `sourcePath → { propId: CellRender }` — drives cell rendering. */
  cellRenders: Map<string, Record<string, CellRender>>;
  /** `sourcePath → { propId: TypedValue }` — kept for the diff-sync fingerprint. */
  propertyValues: Map<string, Record<string, TypedValue>>;
}

/**
 * Build one cell's render descriptor from its raw value, classified value, and
 * resolved render type. A markdown descriptor whose source is empty degrades to
 * an empty text cell (nothing to render, and MarkdownRenderer on `''` is noise).
 */
export function buildCellRender(
  rawValue: unknown,
  typedValue: TypedValue,
  renderType: CellRenderType,
): CellRender {
  if (renderType.display === 'markdown') {
    const source = buildCellMarkdownSource(rawValue, renderType);
    return source === '' ? { mode: 'text', text: '' } : { mode: 'markdown', source };
  }
  return { mode: 'text', text: formatPropertyValue(typedValue) };
}

/**
 * Extract, classify, and build render descriptors for the visible columns in a
 * single pass over `entries`. Returns both the render descriptors and the
 * type-tagged values (the latter still feeds the fingerprint). Empty maps when
 * no columns are visible.
 */
export function buildCellData(
  entries: readonly unknown[],
  visiblePropIds: readonly string[],
  extractor: PropertyExtractor,
  resolveRenderType: ResolveRenderType,
): CellData {
  const cellRenders = new Map<string, Record<string, CellRender>>();
  const propertyValues = new Map<string, Record<string, TypedValue>>();
  if (visiblePropIds.length === 0) return { cellRenders, propertyValues };

  for (const entry of entries) {
    const path = (entry as { file?: { path?: unknown } })?.file?.path;
    if (typeof path !== 'string') continue;

    const renders: Record<string, CellRender> = {};
    const typed: Record<string, TypedValue> = {};
    for (const propId of visiblePropIds) {
      const raw = extractor.extractValue(entry, propId);
      const tv = classifyTypedValue(raw);
      typed[propId] = tv;
      renders[propId] = buildCellRender(raw, tv, resolveRenderType(propId, tv.kind));
    }
    cellRenders.set(path, renders);
    propertyValues.set(path, typed);
  }
  return { cellRenders, propertyValues };
}

/**
 * Build render descriptors for fetched (out-of-result) context rows from their
 * synthetic entries (frontmatter + minimal file + a `getValue` returning null),
 * mirroring `buildFetchedEntryProperties`. `note.*`/`file.*` columns resolve
 * from the note; genuine formula columns fall back to empty.
 */
export function buildFetchedCellData(
  metas: readonly FetchedFileMeta[],
  visiblePropIds: readonly string[],
  extractor: PropertyExtractor,
  resolveRenderType: ResolveRenderType,
): CellData {
  const entries = metas.map((m) => ({
    file: {
      path: m.path,
      basename: m.basename,
      name: `${m.basename}.${m.extension ?? 'md'}`,
      extension: m.extension ?? 'md',
    },
    frontmatter: m.frontmatter ?? {},
    getValue: () => null,
  }));
  return buildCellData(entries, visiblePropIds, extractor, resolveRenderType);
}

/** Deterministic fingerprint of one cell's render descriptor (for diff-sync). */
export function cellRenderKey(render: CellRender | undefined): string {
  if (!render) return '';
  return render.mode === 'markdown' ? `m:${render.source}` : `t:${render.text}`;
}
