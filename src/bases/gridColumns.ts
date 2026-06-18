/**
 * Grid column descriptors derived from the Base's view config (plan
 * 2026-06-18-001, U2).
 *
 * The Gantt grid mirrors the Base's selected properties: the name/hierarchy
 * column (SVAR `text`, carrying the tree) is forced first, then one column per
 * visible property in the Base's order. This module is the pure descriptor
 * builder — `GanttContainer` (U4) turns these descriptors into concrete SVAR
 * columns (attaching the tree to `text` and a `PropertyCell` to the rest).
 *
 * It also exposes a stable fingerprint (`gridColumnsKey`) so the view rebuilds
 * the SVAR columns array (which re-inits the store, resetting zoom/scroll) only
 * when the column *configuration* changes — never on a plain data refresh.
 *
 * Pure and dependency-free.
 *
 * @module bases/gridColumns
 */

/** A grid column descriptor (config-derived; not yet a SVAR column). */
export interface GridColumn {
  /** SVAR column id: `'text'` for the name column, else the Bases property id. */
  id: string;
  /**
   * The Bases property id this column reads/persists under. Equals {@link id}
   * for property columns; for the name column it's the resolved name property
   * (so width persistence writes the right `columnSize` key).
   */
  propId: string;
  /** Column header text (from the Base's display name). */
  header: string;
  /** Fixed pixel width. */
  width: number;
  /** Text alignment. */
  align: 'left' | 'center' | 'right';
  /** `true` for the name/hierarchy column (carries the tree). */
  isName: boolean;
}

/** Default width for the name/hierarchy column when unsized. */
export const DEFAULT_NAME_WIDTH = 240;

/** Default width for a property column when unsized. */
export const DEFAULT_COLUMN_WIDTH = 140;

/** SVAR id of the name/hierarchy column (carries indent + expand/collapse). */
export const NAME_COLUMN_ID = 'text';

/** Property ids treated as the task name (mapped onto the `text` column). */
function nameCandidates(nameProp: string): string[] {
  const out: string[] = [];
  for (const id of [nameProp, 'file.name', 'file.basename']) {
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** A width from the `columnSize` map for a property id, or undefined. */
function sizeOf(columnSize: Record<string, number> | undefined, propId: string): number | undefined {
  const w = columnSize?.[propId];
  return typeof w === 'number' && w > 0 ? w : undefined;
}

/**
 * Build the ordered grid column descriptors.
 *
 * The name column comes first. If the Base's `order` selects a name-like
 * property (the configured name property, or `file.name`/`file.basename`), the
 * first such property maps onto the name column — it is not duplicated as a
 * second column; any further name-like properties render as ordinary columns.
 *
 * @param order - visible property ids in the Base's configured order
 * @param displayName - resolves a property id to its header text
 * @param columnSize - the standard per-property width map (px)
 * @param nameProp - the configured task-name property (e.g. `textProperty`, or
 *   a sensible default like `file.name`); used to pick + persist the name column
 * @returns descriptors with the name column first
 */
export function buildGridColumns(
  order: readonly string[],
  displayName: (propertyId: string) => string,
  columnSize: Record<string, number> | undefined,
  nameProp: string,
): GridColumn[] {
  const candidates = nameCandidates(nameProp);
  const nameColProp = order.find((id) => candidates.includes(id));

  const headerFor = (id: string): string => {
    const name = displayName(id);
    return name && name.trim() !== '' ? name : id;
  };

  const nameColumn: GridColumn = {
    id: NAME_COLUMN_ID,
    propId: nameColProp ?? nameProp,
    header: nameColProp ? headerFor(nameColProp) : 'Task',
    width: sizeOf(columnSize, nameColProp ?? nameProp) ?? DEFAULT_NAME_WIDTH,
    align: 'left',
    isName: true,
  };

  const propertyColumns: GridColumn[] = [];
  for (const id of order) {
    if (id === nameColProp) continue; // the one mapped onto the name column
    propertyColumns.push({
      id,
      propId: id,
      header: headerFor(id),
      width: sizeOf(columnSize, id) ?? DEFAULT_COLUMN_WIDTH,
      align: 'left',
      isName: false,
    });
  }

  return [nameColumn, ...propertyColumns];
}

/**
 * A stable fingerprint of the column *structure* (ids, headers, and order) — the
 * config that genuinely requires a SVAR store re-init to change. The view
 * rebuilds the columns array (re-initing the store) only when this changes.
 *
 * Width is deliberately EXCLUDED: SVAR applies a resize in place, and the new
 * width is persisted to `columnSize` for the next mount — so a width change
 * must NOT force a reseed. Including it would mean a resize → `columnSize`
 * write → next refresh re-reads the wider column → key change → reseed →
 * zoom/scroll reset (the PR #73 regression). Initial widths are still read from
 * `columnSize` when the columns are (re)built.
 */
export function gridColumnsKey(columns: readonly GridColumn[]): string {
  return columns.map((c) => `${c.id}:${c.header}`).join('|');
}

/**
 * Merge a resized column's width into the standard `columnSize` map (U5),
 * returning a new map. The width is rounded to an integer pixel; other entries
 * are preserved so a resize never clobbers another column's stored width.
 */
export function mergeColumnSize(
  existing: Record<string, number> | undefined,
  propId: string,
  width: number,
): Record<string, number> {
  return { ...(existing ?? {}), [propId]: Math.round(width) };
}
