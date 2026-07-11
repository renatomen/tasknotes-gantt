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
 * Every resolvable editor kind now ships an inline editor: the scalar kinds
 * (`text`, `number`, `boolean`, `list`), the custom locale-aware `date` editor
 * (registered as {@link OG_DATE_EDITOR_TYPE}, commits real `Date` objects — the
 * bridge's coercion skips `instanceof Date`), the restricted-choice kinds
 * (`choice-status`/`choice-priority` — a stock richselect over the backing
 * system's configured value set, committing the value STRING), and `suggest`
 * (single-value fields host the native `[[` suggester under
 * {@link OG_TEXT_EDITOR_TYPE} and commit with text semantics through the
 * bridge; LIST-shaped fields keep the {@link OG_SUGGEST_EDITOR_TYPE} append
 * editor and bypass the bridge entirely via a direct-commit callback, because
 * the bridge's display-form diffing cannot represent wikilink lists).
 *
 * No Obsidian/SVAR dependencies. Mirrors {@link ./cascadeGate}.
 *
 * @module bases/cellEditCommit
 */

import { toYmd } from '../datasource/dateFieldMapping';
import type { CellEditorDescriptor, CellEditorKind } from './cellEditability';
import type { CellRender } from './cellRender';
import { EMPTY_TYPED_VALUE, listsEqual, type TypedValue } from './propertyValues';

/** The editor kinds with a shipped inline editor. */
export type ShippedEditorKind =
  | 'text'
  | 'number'
  | 'boolean'
  | 'list'
  | 'date'
  | 'choice-status'
  | 'choice-priority'
  | 'suggest';

const SHIPPED_KINDS: ReadonlySet<CellEditorKind> = new Set([
  'text',
  'number',
  'boolean',
  'list',
  'date',
  'choice-status',
  'choice-priority',
  'suggest',
]);

/** The inline-editor type the custom locale-aware date editor registers under. */
export const OG_DATE_EDITOR_TYPE = 'og-date';

/**
 * The inline-editor type the list-append autosuggest editor registers under.
 * Reached only by list-shaped suggest fields; single-value suggest and plain
 * text host the native suggester under {@link OG_TEXT_EDITOR_TYPE}.
 */
export const OG_SUGGEST_EDITOR_TYPE = 'og-suggest';

/**
 * The inline-editor type the native `[[` suggester editor registers under.
 * Replaces the stock `'text'` input for `text`-kind AND single-value `suggest`
 * cells (the latter carrying the field's autosuggest filter); `number`/`list`
 * keep the bare stock text editor.
 */
export const OG_TEXT_EDITOR_TYPE = 'og-text';

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

/** One selectable value of a choice column's richselect (SVAR `IOption`). */
export interface ChoiceEditorOption {
  id: string;
  label: string;
}

/**
 * Map a backing system's configured choice values to richselect options: the
 * stored value string is the option id (what the editor commits and the bridge
 * passes through), the label its display form (value fallback).
 */
export function choiceEditorOptions(
  options: ReadonlyArray<{ value: string; label: string }>,
): ChoiceEditorOption[] {
  return options.map((o) => ({ id: o.value, label: o.label || o.value }));
}

/** The per-column suggest channel resolved from the editor descriptors. */
export interface SuggestEditorChannel {
  /** The edited grid column id — also the property id the write path resolves. */
  columnId: string;
  /** TaskNotes `FileFilterConfig` scoping the suggestions; opaque here. */
  autosuggestFilter: unknown;
  /** List-shaped field: commits append via {@link SuggestEditorConfig.commitListEntry}. */
  isList: boolean;
}

/**
 * What the suggest editor reads from `editor.config`: the pure channel plus the
 * view-wired callbacks. `fetchSuggestions` absent = TaskNotes' file-suggest
 * capability is unreachable — the editor renders its degraded state (hint +
 * free text). `commitListEntry` is wired only for list-shaped columns and owns
 * persistence for them (the direct path).
 */
export interface SuggestEditorConfig extends SuggestEditorChannel {
  fetchSuggestions?: (query: string) => Promise<Array<{ value: string; display: string }>>;
  commitListEntry?: (entry: string) => void;
}

/**
 * What the text cell editor reads from `editor.config`: the vault `[[`
 * suggestion source, attached per editor-open by the view (the base config
 * carries none). Absent = plain text editing with no autosuggest.
 * `autosuggestFilter` scopes a single-value suggest field's fetcher; the view
 * consumes it while wiring the fetcher and does not forward it to the editor.
 */
export interface TextEditorConfig {
  fetchSuggestions?: (
    query: string,
  ) => Promise<Array<{ value: string; display: string; path?: string }>>;
  /** TaskNotes `FileFilterConfig` scoping a single-value suggest field; opaque here. */
  autosuggestFilter?: unknown;
}

/** A SVAR inline-editor config (`TEditorType | IColumnEditor`). */
export type SvarEditorConfig =
  | string
  | { type: string; config: { options: ChoiceEditorOption[] } }
  | { type: string; config: { locale: string } }
  | { type: string; config: SuggestEditorConfig }
  | { type: string; config: TextEditorConfig };

/** The context the per-kind editor configs are built from. */
export interface EditorConfigContext {
  /** The assembly pass's display-locale snapshot (the date editor's channel). */
  dateLocale: string;
  /** Richselect options for a choice column; no/empty options ⇒ no editor. */
  choiceOptions?: ReadonlyArray<ChoiceEditorOption>;
  /** The suggest channel for a suggest column; absent ⇒ no editor. */
  suggest?: SuggestEditorChannel;
}

/**
 * The SVAR editor config for a shipped kind: boolean → richselect, date → the
 * registered custom editor (its config carries the assembly pass's display
 * locale — SVAR's store hands `column.editor.config` to the opened editor as
 * `editor.config`), choice kinds → richselect over the configured value set
 * (or `null` when the set is empty — a picker with nothing to pick is not
 * offered), suggest → the registered custom autosuggest editor carrying its
 * channel (or `null` without one), text → the registered custom text editor
 * (inline `[[` autosuggest), and `number`/`list` → the stock text input.
 */
export function svarEditorConfigFor(
  kind: ShippedEditorKind,
  context: EditorConfigContext,
): SvarEditorConfig | null {
  if (kind === 'boolean') {
    return { type: 'richselect', config: { options: [...BOOLEAN_EDITOR_OPTIONS] } };
  }
  if (kind === 'date') {
    return { type: OG_DATE_EDITOR_TYPE, config: { locale: context.dateLocale } };
  }
  if (kind === 'choice-status' || kind === 'choice-priority') {
    const options = context.choiceOptions ?? [];
    if (options.length === 0) return null;
    return { type: 'richselect', config: { options: [...options] } };
  }
  if (kind === 'suggest') {
    if (!context.suggest) return null;
    // A list-shaped suggest keeps the append editor (chips arrive later); a
    // single-value suggest hosts the native `[[` suggester like plain text,
    // carrying its filter so the view wires a scoped fetcher.
    if (context.suggest.isList) {
      return { type: OG_SUGGEST_EDITOR_TYPE, config: { ...context.suggest } };
    }
    return {
      type: OG_TEXT_EDITOR_TYPE,
      config: { autosuggestFilter: context.suggest.autosuggestFilter },
    };
  }
  if (kind === 'text') {
    // The view attaches an unfiltered vault `[[` fetcher per open (withTextEditorWiring).
    return { type: OG_TEXT_EDITOR_TYPE, config: {} };
  }
  // `number` and `list` share the stock text input (they cast on commit).
  return 'text';
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
  context: EditorConfigContext,
): SvarEditorConfig | null {
  if (!row?.custom?.editable || !kind) return null;
  return svarEditorConfigFor(kind, context);
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
  opts?: { choiceValues?: readonly string[] },
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
    case 'date':
      return commitDate(raw, stored);
    case 'choice-status':
    case 'choice-priority':
      return commitChoice(raw, stored, opts?.choiceValues);
    // Single-value suggest fields commit whatever the editor produced (typed
    // free text or a picked `[[wikilink]]` string) with text semantics; the
    // list-shaped suggest commits never reach here (direct path).
    case 'suggest':
    case 'text':
      return commitText(raw, stored);
  }
}

// A choice richselect commits the picked option id — the configured value
// STRING. The bridge's `v *= 1` coercion turns a numeric-looking value into a
// number, so a finite number casts back to its string form; anything else is a
// stray value that must not reach the write path.
function commitChoice(
  raw: unknown,
  stored: TypedValue,
  choiceValues?: readonly string[],
): CellEditCommit {
  const value =
    typeof raw === 'string'
      ? raw
      : typeof raw === 'number' && Number.isFinite(raw)
        ? recoverConfiguredValue(raw, choiceValues)
        : null;
  if (value === null) {
    return { action: 'reject', reason: 'This field needs one of the configured values.' };
  }
  if (value === storedStringForm(stored)) return NOOP;
  return { action: 'commit', value };
}

/**
 * Recover the configured option value from a bridge-coerced number: `01` or
 * `1.0` arrive as `1`, and persisting `String(1)` would no longer match the
 * TaskNotes catalog. Exactly one numeric-equal configured value wins; zero or
 * several (ambiguous) reject via `null`. Without a catalog the plain string
 * form stands (numeric-looking values then round-trip only when canonical).
 */
function recoverConfiguredValue(raw: number, choiceValues?: readonly string[]): string | null {
  if (!choiceValues) return String(raw);
  const matches = choiceValues.filter((v) => Number(v) === raw);
  return matches.length === 1 ? (matches[0] ?? null) : null;
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

// The custom date editor commits only real Dates (typed input is parsed
// BEFORE it applies; the calendar picks Dates), and the bridge's coercion
// skips `instanceof Date` — so anything else here is a stray value that must
// not reach the write path.
function commitDate(raw: unknown, stored: TypedValue): CellEditCommit {
  if (!(raw instanceof Date) || Number.isNaN(raw.getTime())) {
    return { action: 'reject', reason: 'This field needs a date.' };
  }
  if (stored.kind === 'date' && isSameCalendarDay(raw, stored.value as Date)) return NOOP;
  return { action: 'commit', value: raw };
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Local-midnight epoch — day-granularity comparisons for date-order checks. */
function localDayMs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** The mapped-role date columns (start/end) among the resolved editor descriptors. */
export function dateRoleColumns(
  cellEditors: ReadonlyMap<string, CellEditorDescriptor> | undefined,
): Map<string, 'start' | 'end'> {
  const roles = new Map<string, 'start' | 'end'>();
  for (const [columnId, descriptor] of cellEditors ?? []) {
    if (descriptor.kind === 'date' && descriptor.dateRole) {
      roles.set(columnId, descriptor.dateRole);
    }
  }
  return roles;
}

/**
 * The suggest columns among the resolved editor descriptors, keyed by column
 * id with their channel (filter + list shape). Mirrors {@link dateRoleColumns}.
 */
export function suggestColumns(
  cellEditors: ReadonlyMap<string, CellEditorDescriptor> | undefined,
): Map<string, { autosuggestFilter: unknown; isList: boolean }> {
  const channels = new Map<string, { autosuggestFilter: unknown; isList: boolean }>();
  for (const [columnId, descriptor] of cellEditors ?? []) {
    if (descriptor.kind === 'suggest') {
      channels.set(columnId, {
        autosuggestFilter: descriptor.autosuggestFilter,
        isList: descriptor.isList === true,
      });
    }
  }
  return channels;
}

/** The date-bearing slice of a render row the cross-field check reads. */
export interface DatedRowLike {
  start: Date | null;
  end: Date | null;
  /** How the row's dates were derived ({@link import('../controller/datePolicy')}). */
  dateStatus?: string;
}

/**
 * The REAL counterpart date for an edit on the given mapped role, or `null`
 * when there is nothing trustworthy to validate against. The row's resolved
 * dates may be policy-inferred: the counterpart is real only for a `complete`
 * row or when the INFERRED edge is the one being edited (`inferred-start`
 * while editing start ⇒ the end is real, and vice versa). Placeholder and
 * swapped rows fail open — their resolved edges don't mirror the stored
 * fields, so blocking on them would reject valid single-edge writes.
 */
export function counterpartDate(row: DatedRowLike | undefined, role: 'start' | 'end'): Date | null {
  if (!row) return null;
  const status = row.dateStatus ?? 'complete';
  if (status !== 'complete' && status !== `inferred-${role}`) return null;
  return role === 'start' ? row.end : row.start;
}

/**
 * Whether committing `edited` on the given role would put the start after the
 * end, compared at calendar-day granularity (resolved ends are normalized to
 * end-of-day, so equal days must pass). No counterpart → nothing to violate.
 */
export function violatesDateOrder(
  role: 'start' | 'end',
  edited: Date,
  counterpart: Date | null,
): boolean {
  if (!counterpart) return false;
  return role === 'start'
    ? localDayMs(edited) > localDayMs(counterpart)
    : localDayMs(edited) < localDayMs(counterpart);
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
 * number for a number column, the raw stored `Date` for a date column (the
 * custom editor formats it for the locale itself, and an untouched
 * commit-on-close then round-trips as the unchanged Date), and the
 * single-string form otherwise (list items comma-joined — matching what the
 * text editor shows).
 */
export function editorSeedValue(kind: ShippedEditorKind, stored: TypedValue | undefined): unknown {
  const value = stored ?? EMPTY_TYPED_VALUE;
  if (value.kind === 'empty') return '';
  if (kind === 'number' && value.kind === 'number') return value.value;
  if (kind === 'date' && value.kind === 'date') return value.value;
  return storedStringForm(value);
}

/**
 * The seed for an opening single-value text/suggest editor, preferring the
 * cell's rendered markdown source over the type-tagged display form. A wikilink
 * value (`[[Note]]`, `[[Note|Alias]]`) classifies to its display text, so
 * {@link editorSeedValue} alone would seed the editor with `Note`/`Alias` and a
 * commit would drop the link. The render descriptor already holds the exact
 * markdown the cell shows, so the editor seeds and round-trips that instead.
 * (A list-shaped suggest editor starts empty and ignores this seed.) Other
 * kinds and non-markdown cells fall back to {@link editorSeedValue}.
 */
export function editorSeedFor(
  kind: ShippedEditorKind,
  stored: TypedValue | undefined,
  render: CellRender | undefined,
): unknown {
  if ((kind === 'text' || kind === 'suggest') && render?.mode === 'markdown') {
    return render.source;
  }
  return editorSeedValue(kind, stored);
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
