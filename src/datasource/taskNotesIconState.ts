/**
 * TaskNotes' status and priority glyph rule, reproduced here because TaskNotes
 * exports neither the rule nor its renderers.
 *
 * The cases match `statusGlyphState` and `priorityGlyphState`: skipped wins
 * over completed, the none status is unset, later open statuses fill by their
 * sorted place, and priority weight zero is unset while a lone weighted
 * priority sits in the middle.
 *
 * @module datasource/taskNotesIconState
 */

import type { PaletteGlyph, PriorityPaletteGlyph, StatusPaletteGlyph } from './types';

/** The catalog fields the status rule reads. */
export interface StatusGlyphInput {
  id?: string;
  value: string;
  isCompleted: boolean;
  isSkipped?: boolean;
  order: number;
}

/** The catalog fields the priority rule reads. */
export interface PriorityGlyphInput {
  value: string;
  weight: number;
}

/** Loose catalog rows, before they are narrowed to {@link StatusGlyphInput}. */
interface LooseCatalogEntry {
  id?: unknown;
  value?: unknown;
  isCompleted?: unknown;
  isSkipped?: unknown;
  order?: unknown;
  weight?: unknown;
}

/** The first open status is an empty ring. Later ones fill towards done. */
export function statusGlyphState(
  statusValue: string,
  statuses: readonly StatusGlyphInput[],
): StatusPaletteGlyph {
  const status = statuses.find((candidate) => candidate.value === statusValue);
  if (!status) {
    return { role: 'status', kind: statusValue ? 'unknown' : 'unset', progress: 0 };
  }
  if (status.isSkipped) return { role: 'status', kind: 'skipped', progress: 1 };
  if (status.isCompleted) return { role: 'status', kind: 'complete', progress: 1 };
  if (status.id === 'none') return { role: 'status', kind: 'unset', progress: 0 };

  const open = statuses
    .filter((candidate) => !candidate.isCompleted && !candidate.isSkipped && candidate.id !== 'none')
    .sort((a, b) => a.order - b.order);
  const index = open.findIndex((candidate) => candidate.value === statusValue);
  if (index <= 0) return { role: 'status', kind: 'open', progress: 0 };
  return { role: 'status', kind: 'progress', progress: index / open.length };
}

/**
 * Every ranked priority is a dot. The highest weight gets a ring around its
 * dot and the lowest a smaller dot; a single ranked priority is a plain dot.
 * Weight zero is unset, as is a missing priority.
 */
export function priorityGlyphState(
  priorityValue: string | undefined,
  priorities: readonly PriorityGlyphInput[],
): PriorityPaletteGlyph {
  const priority = priorityValue
    ? priorities.find((candidate) => candidate.value === priorityValue)
    : undefined;
  if (priorityValue && !priority) return { role: 'priority', kind: 'unknown' };
  if (!priority || priority.weight <= 0) return { role: 'priority', kind: 'unset' };
  const weights = priorities.map((candidate) => candidate.weight).filter((weight) => weight > 0);
  const highest = Math.max(...weights);
  const lowest = Math.min(...weights);
  if (highest === lowest) return { role: 'priority', kind: 'dot', rank: 'middle' };
  if (priority.weight === highest) return { role: 'priority', kind: 'dot', rank: 'top' };
  if (priority.weight === lowest) return { role: 'priority', kind: 'dot', rank: 'bottom' };
  return { role: 'priority', kind: 'dot', rank: 'middle' };
}

/** One glyph per status value, using the first catalog row when values repeat. */
export function statusGlyphsByValue(
  statuses: readonly StatusGlyphInput[],
): Map<string, StatusPaletteGlyph> {
  const glyphs = new Map<string, StatusPaletteGlyph>();
  for (const status of statuses) {
    if (glyphs.has(status.value)) continue;
    glyphs.set(status.value, statusGlyphState(status.value, statuses));
  }
  return glyphs;
}

/** One glyph per priority value, using the first catalog row when values repeat. */
export function priorityGlyphsByValue(
  priorities: readonly PriorityGlyphInput[],
): Map<string, PriorityPaletteGlyph> {
  const glyphs = new Map<string, PriorityPaletteGlyph>();
  for (const priority of priorities) {
    if (glyphs.has(priority.value)) continue;
    glyphs.set(priority.value, priorityGlyphState(priority.value, priorities));
  }
  return glyphs;
}

function asCatalogEntry(entry: unknown): LooseCatalogEntry | null {
  if (!entry || typeof entry !== 'object') return null;
  return entry as LooseCatalogEntry;
}

/** Keep catalog rows that have a status value, filling the rule's required fields. */
export function statusGlyphInputs(raw: unknown): StatusGlyphInput[] {
  if (!Array.isArray(raw)) return [];
  const inputs: StatusGlyphInput[] = [];
  for (const item of raw) {
    const entry = asCatalogEntry(item);
    if (!entry || typeof entry.value !== 'string') continue;
    inputs.push({
      ...(typeof entry.id === 'string' ? { id: entry.id } : {}),
      value: entry.value,
      isCompleted: entry.isCompleted === true,
      isSkipped: entry.isSkipped === true,
      order: typeof entry.order === 'number' ? entry.order : 0,
    });
  }
  return inputs;
}

/** Keep catalog rows that have a priority value, treating a missing weight as zero. */
export function priorityGlyphInputs(raw: unknown): PriorityGlyphInput[] {
  if (!Array.isArray(raw)) return [];
  const inputs: PriorityGlyphInput[] = [];
  for (const item of raw) {
    const entry = asCatalogEntry(item);
    if (!entry || typeof entry.value !== 'string') continue;
    inputs.push({
      value: entry.value,
      weight: typeof entry.weight === 'number' ? entry.weight : 0,
    });
  }
  return inputs;
}

/** Stable fingerprint of one glyph, shared by the bar chip and the grid cell. */
export function paletteGlyphKey(glyph: PaletteGlyph): string {
  switch (glyph.role) {
    case 'status':
      return `status:${glyph.kind}:${glyph.progress}`;
    case 'priority':
      return priorityGlyphKey(glyph);
    default: {
      const unexpected: never = glyph;
      return unexpected;
    }
  }
}

function priorityGlyphKey(glyph: PriorityPaletteGlyph): string {
  switch (glyph.kind) {
    case 'dot':
      return `priority:dot:${glyph.rank}`;
    case 'unset':
    case 'unknown':
      return `priority:${glyph.kind}`;
    default: {
      const unexpected: never = glyph;
      return unexpected;
    }
  }
}
