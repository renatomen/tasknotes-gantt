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
 * Only the editor kinds this unit ships are handled here (`text`, `number`,
 * `boolean`, `list`); date/choice/suggest editors arrive in later units and
 * {@link shippedEditorKind} filters them out.
 *
 * Dependency-free (no Obsidian/SVAR). Mirrors {@link ./cascadeGate}.
 *
 * @module bases/cellEditCommit
 */

import type { CellEditorKind } from './cellEditability';
import type { TypedValue } from './propertyValues';

/** The editor kinds with a working inline editor in this unit. */
export type ShippedEditorKind = 'text' | 'number' | 'boolean' | 'list';

const SHIPPED_KINDS: ReadonlySet<CellEditorKind> = new Set(['text', 'number', 'boolean', 'list']);

/** Narrow a resolved editor kind to a shipped one, or `null` when deferred. */
export function shippedEditorKind(kind: CellEditorKind): ShippedEditorKind | null {
  return SHIPPED_KINDS.has(kind) ? (kind as ShippedEditorKind) : null;
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
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

function listsEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

function commitText(raw: unknown, stored: TypedValue): CellEditCommit {
  const s = String(raw);
  if (s === storedStringForm(stored)) return NOOP;
  return { action: 'commit', value: s };
}

/** Local `YYYY-MM-DD` of a date (the frontmatter calendar-date form). */
function toLocalYmd(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The single-string form of a stored value (what a text input shows). */
function storedStringForm(stored: TypedValue): string {
  switch (stored.kind) {
    case 'empty':
      return '';
    case 'date':
      return toLocalYmd(stored.value as Date);
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
  const value = stored ?? { kind: 'empty', value: null };
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
  const value = stored ?? { kind: 'empty', value: null };
  switch (value.kind) {
    case 'empty':
      return '';
    case 'list':
      return [...(value.value as string[])];
    default:
      return value.value;
  }
}
