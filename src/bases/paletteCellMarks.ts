/**
 * Attach a palette mark to the mapped status and priority cells.
 *
 * The palettes already ride the render contract. This stamps the mark onto the
 * cell descriptor those columns already carry, and leaves every other column
 * alone — including one that happens to hold the same text.
 *
 * @module bases/paletteCellMarks
 */

import type { PriorityColor, StatusColor } from '../datasource/types';
import { isSafeColor } from './barTreatment';
import type { CellData, CellPaletteMark, CellRender } from './cellRender';
import type { TypedValue } from './propertyValues';

interface MarkedColumn {
  id: string;
  palette: readonly { value: string; color: string; icon?: string; glyph?: StatusColor['glyph'] }[];
}

/** Columns whose cells may carry a mark, in status-then-priority order. */
function markedColumns(
  mappings: { statusProperty?: string; priorityProperty?: string },
  palettes: { status: readonly StatusColor[]; priority: readonly PriorityColor[] },
): MarkedColumn[] {
  const columns: MarkedColumn[] = [];
  if (mappings.statusProperty) columns.push({ id: mappings.statusProperty, palette: palettes.status });
  if (mappings.priorityProperty) {
    columns.push({ id: mappings.priorityProperty, palette: palettes.priority });
  }
  return columns;
}

function storedText(value: TypedValue | undefined): string | null {
  if (!value || value.kind !== 'text' || typeof value.value !== 'string') return null;
  return value.value;
}

function markFor(
  stored: string | undefined,
  value: TypedValue | undefined,
  palette: MarkedColumn['palette'],
): CellPaletteMark | null {
  const text = stored ?? storedText(value);
  if (text === null) return null;
  const entry = palette.find((candidate) => candidate.value === text);
  if (!entry?.glyph) return null;
  const color = isSafeColor(entry.color) ? entry.color : 'currentColor';
  if (entry.icon) return { kind: 'configured', iconName: entry.icon, color };
  return { kind: 'glyph', glyph: entry.glyph, color };
}

/**
 * Return `cellRenders` with palette marks on the mapped columns.
 *
 * The same map comes back when no cell gains a mark, so a pass with no glyphs
 * does not copy the descriptors.
 */
export function cellRendersWithPaletteMarks(
  cellRenders: CellData['cellRenders'],
  propertyValues: CellData['propertyValues'],
  mappings: { statusProperty?: string; priorityProperty?: string },
  palettes: { status: readonly StatusColor[]; priority: readonly PriorityColor[] },
  storedTexts?: CellData['storedTexts'],
): CellData['cellRenders'] {
  const columns = markedColumns(mappings, palettes);
  if (columns.length === 0) return cellRenders;

  let changed = false;
  const next = new Map(cellRenders);
  for (const [path, renders] of cellRenders) {
    const values = propertyValues.get(path);
    const stored = storedTexts?.get(path);
    let record = renders;
    for (const column of columns) {
      const current = record[column.id];
      if (!current) continue;
      const mark = markFor(stored?.[column.id], values?.[column.id], column.palette);
      if (!mark) continue;
      record = { ...record, [column.id]: withMark(current, mark) };
      changed = true;
    }
    if (record !== renders) next.set(path, record);
  }
  return changed ? next : cellRenders;
}

function withMark(render: CellRender, paletteMark: CellPaletteMark): CellRender {
  return { ...render, paletteMark };
}
