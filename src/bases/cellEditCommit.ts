/**
 * Pure commit/seed logic for inline grid cell editors.
 *
 * Sits between SVAR's grid `update-cell` bridge and the controller's
 * `mutateProperty`. The bridge coerces every committed value with `v *= 1`
 * (numeric strings and `true` become numbers, `[]` becomes `0`) before the
 * container's `update-task` intercept sees it, so the raw committed value must
 * be cast back to what the edited column's editor kind means before it can be
 * persisted — and a value that cannot be cast is rejected without a write.
 * `editorSeedValue` is the mirror image: what the column `getter`
 * should hand SVAR when the editor opens (SVAR seeds the input from it).
 *
 * Only editor kinds with a shipped inline editor are handled here (`text`,
 * `number`, `boolean`, `list`); date/choice/suggest kinds resolve descriptors
 * but have no inline editor yet, and {@link shippedEditorKind} filters them out.
 *
 * No Obsidian/SVAR dependencies. Mirrors {@link ./cascadeGate}.
 *
 * @module bases/cellEditCommit
 */

import { toYmd } from '../datasource/dateFieldMapping';
import type { CellEditorDescriptor, CellEditorKind } from './cellEditability';
import { EMPTY_TYPED_VALUE, listsEqual, type TypedValue } from './propertyValues';

/** The editor kinds with a shipped inline editor. */
export type ShippedEditorKind = 'text' | 'number' | 'boolean' | 'list';

const SHIPPED_KINDS: ReadonlySet<CellEditorKind> = new Set(['text', 'number', 'boolean', 'list']);

/** Narrow a resolved editor kind to a shipped one, or `null` when there is none. */
export function shippedEditorKind(kind: CellEditorKind): ShippedEditorKind | null {
  return SHIPPED_KINDS.has(kind) ? (kind as ShippedEditorKind) : null;
}

/** Filter resolved editor descriptors down to the kinds with a shipped editor. */
export function shippedEditorKinds(
  cellEditors: ReadonlyMap<string, CellEditorDescriptor> | undefined,
): Map<string, ShippedEditorKind> {
  const kinds = new Map<string, ShippedEditorKind>();
  for (const [columnId, descriptor] of cellEditors ?? []) {
    const kind = shippedEditorKind(descriptor.kind);
    if (kind) kinds.set(columnId, kind);
  }
  return kinds;
}

/**
 * The editor-attached column ids in grid display order (name column excluded) —
 * the id set a committed task copy is diffed against to attribute a cell edit.
 */
export function editorAttachedColumnIds(
  descriptors: ReadonlyArray<{ id: string; isName: boolean }>,
  kinds: ReadonlyMap<string, ShippedEditorKind>,
): string[] {
  return descriptors.filter((c) => !c.isName && kinds.has(c.id)).map((c) => c.id);
}

/**
 * The `{id, label}` options a boolean column's richselect editor offers. Ids
 * are the strings `'true'`/`'false'` — SVAR's `IOption.id` is `string | number`
 * — and {@link resolveCellEditCommit} casts them back to booleans; the string
 * form also survives the bridge's `v *= 1` coercion untouched.
 */
export const BOOLEAN_EDITOR_OPTIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'true', label: 'true' },
  { id: 'false', label: 'false' },
];

/** The slice of a SVAR grid row the editor gate/getter read. */
export interface SvarRowLike {
  id?: string | number;
  custom?: { editable?: boolean; properties?: Record<string, TypedValue> };
}

/** A SVAR inline-editor config (`TEditorType | IColumnEditor`). */
export type SvarEditorConfig =
  | string
  | { type: string; config: { options: Array<{ id: string; label: string }> } };

/** The SVAR editor config for a shipped kind (text-input based except boolean). */
export function svarEditorConfigFor(kind: ShippedEditorKind): SvarEditorConfig {
  return kind === 'boolean'
    ? { type: 'richselect', config: { options: [...BOOLEAN_EDITOR_OPTIONS] } }
    : 'text';
}

/**
 * The editor config a grid row may open for a column resolved to `kind`, or
 * `null` when the row is not editable (its source note is not TaskNotes-managed)
 * or the column has no shipped editor. The pure per-row half of the editor
 * gate — the view layers its own state (read-only, in-flight writes) on top.
 */
export function rowEditorConfig(
  row: SvarRowLike | undefined,
  kind: ShippedEditorKind | undefined,
): SvarEditorConfig | null {
  if (!row?.custom?.editable || !kind) return null;
  return svarEditorConfigFor(kind);
}

/** How a committed editor value should be handled. */
export type CellEditCommit =
  | { action: 'reject'; reason: string }
  | { action: 'noop' }
  | { action: 'commit'; value: unknown };

const COMMIT_NULL: CellEditCommit = { action: 'commit', value: null };
const NOOP: CellEditCommit = { action: 'noop' };

/**
 * Resolve a committed raw editor value against the column's editor kind and the
 * row's stored value: cast it back per kind, detect the re-committed-unchanged
 * case (`noop` — the caller must not write), or reject an uncastable value.
 * An empty string always means "clear" (`commit null`), a noop when the stored
 * value is already empty.
 */
export function resolveCellEditCommit(
  kind: ShippedEditorKind,
  raw: unknown,
  stored: TypedValue,
): CellEditCommit {
  if (raw === '' || raw === null || raw === undefined) {
    return stored.kind === 'empty' ? NOOP : COMMIT_NULL;
  }
  switch (kind) {
    case 'number':
      return commitNumber(raw, stored);
    case 'boolean':
      return commitBoolean(raw, stored);
    case 'list':
      return commitList(raw, stored);
    case 'text':
      return commitText(raw, stored);
  }
}

// Caveat shared by the number and text casts below: SVAR's bridge coerces a
// whitespace-only committed string to 0 before this module ever sees it (its
// `v *= 1` guard keeps the product when `isNaN` is false, and `isNaN('  ')` is
// false), so '  ' arrives as the number 0 and commits as 0 / '0'. Not fixable
// downstream of the bridge; accepted.
function commitNumber(raw: unknown, stored: TypedValue): CellEditCommit {
  const n = asFiniteNumber(raw);
  if (n === null) {
    return { action: 'reject', reason: 'This field needs a number.' };
  }
  if (stored.kind === 'number' && stored.value === n) return NOOP;
  if (stored.kind === 'text' && stored.value === String(n)) return NOOP;
  return { action: 'commit', value: n };
}

function asFiniteNumber(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function commitBoolean(raw: unknown, stored: TypedValue): CellEditCommit {
  const b = asBoolean(raw);
  if (b === null) {
    return { action: 'reject', reason: 'This field needs true or false.' };
  }
  if (stored.kind === 'boolean' && stored.value === b) return NOOP;
  return { action: 'commit', value: b };
}

function asBoolean(raw: unknown): boolean | null {
  if (raw === true || raw === false) return raw;
  // SVAR's update-cell bridge coerces a committed `true` to 1 (`v *= 1`);
  // `false` is falsy and passes through untouched.
  if (raw === 1) return true;
  if (raw === 0) return false;
  if (typeof raw === 'string') {
    const s = raw.trim().toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
  }
  return null;
}

function commitList(raw: unknown, stored: TypedValue): CellEditCommit {
  // Round-trip guard FIRST: a committed string identical to what the editor was
  // seeded with means nothing changed — splitting it could still corrupt (a
  // stored item may itself contain a comma, e.g. the display text of
  // `[[Doe, John]]`), so the noop must not depend on the split.
  if (typeof raw === 'string' && raw === editorSeedValue('list', stored)) return NOOP;
  const items = asListItems(raw);
  if (items === null) {
    return { action: 'reject', reason: 'This field needs a comma-separated list.' };
  }
  if (stored.kind === 'list' && listsEqual(items, stored.value as string[])) return NOOP;
  return { action: 'commit', value: items };
}

function asListItems(raw: unknown): string[] | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return [String(raw)];
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item).trim()).filter((s) => s !== '');
  }
  if (typeof raw !== 'string') return null;
  return splitListEntries(raw)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/**
 * Split a committed list string on commas OUTSIDE `[[...]]` pairs, so a
 * wikilink entry like `[[Doe, John]]` stays one entry. An unbalanced `[[`
 * makes bracket tracking meaningless — the whole string is treated as plain
 * text and split on every comma.
 */
function splitListEntries(raw: string): string[] {
  const entries: string[] = [];
  let current = '';
  let depth = 0;
  for (let i = 0; i < raw.length; i += 1) {
    if (raw.startsWith('[[', i)) {
      depth += 1;
      current += '[[';
      i += 1;
      continue;
    }
    if (depth > 0 && raw.startsWith(']]', i)) {
      depth -= 1;
      current += ']]';
      i += 1;
      continue;
    }
    if (raw[i] === ',' && depth === 0) {
      entries.push(current);
      current = '';
      continue;
    }
    current += raw[i];
  }
  if (depth !== 0) return raw.split(',');
  entries.push(current);
  return entries;
}

function commitText(raw: unknown, stored: TypedValue): CellEditCommit {
  const s = String(raw);
  if (s === storedStringForm(stored)) return NOOP;
  return { action: 'commit', value: s };
}

/** The single-string form of a stored value (what a text input shows). */
function storedStringForm(stored: TypedValue): string {
  switch (stored.kind) {
    case 'empty':
      return '';
    case 'date':
      return toYmd(stored.value as Date);
    case 'list':
      return (stored.value as string[]).join(', ');
    default:
      return String(stored.value);
  }
}

/**
 * What the column `getter` should return for an opening editor: the
 * `'true'`/`'false'` option id for a boolean column (matching
 * {@link BOOLEAN_EDITOR_OPTIONS} so the richselect pre-selects it), the raw
 * number for a number column, and the single-string form otherwise (list
 * items comma-joined — matching what the text editor shows).
 */
export function editorSeedValue(kind: ShippedEditorKind, stored: TypedValue | undefined): unknown {
  const value = stored ?? EMPTY_TYPED_VALUE;
  if (value.kind === 'empty') return '';
  if (kind === 'number' && value.kind === 'number') return value.value;
  return storedStringForm(value);
}

/**
 * The flat `task[columnId]` value that mirrors a stored value — used to restore
 * a row's flat keys (revert after a failed write; reseed after an ambiguous
 * edit) so later diffs classify them as unchanged.
 */
export function storedFlatValue(stored: TypedValue | undefined): unknown {
  const value = stored ?? EMPTY_TYPED_VALUE;
  switch (value.kind) {
    case 'empty':
      return '';
    case 'list':
      return [...(value.value as string[])];
    default:
      return value.value;
  }
}

/**
 * Extend a task payload with the current flat value of every editor-attached
 * column, so applying it re-aligns the row's flat editor keys with its stored
 * values.
 *
 * SVAR's grid bridge copies the whole row on an editor commit, and its
 * `update-task` applies payloads as a shallow spread — so a committed flat
 * `[columnId]` key persists on the store row indefinitely. A programmatic
 * update that refreshes `custom.properties` (e.g. after an external note edit)
 * but leaves the flat keys untouched strands them stale; a later no-change
 * commit on ANOTHER column would then single-diff on the stale key and write
 * the old value back over the external edit. Threading every diff-sync
 * update/seed through this keeps flat-key attribution sound.
 */
export function withAlignedFlatKeys<
  T extends { custom: { properties?: Record<string, TypedValue> } },
>(task: T, columnIds: ReadonlyArray<string>): T {
  if (columnIds.length === 0) return task;
  const flatKeys: Record<string, unknown> = {};
  for (const columnId of columnIds) {
    flatKeys[columnId] = storedFlatValue(task.custom.properties?.[columnId]);
  }
  return { ...task, ...flatKeys };
}
