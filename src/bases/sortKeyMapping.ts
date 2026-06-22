/**
 * Default-view safe-partial interleave (plan 2026-06-22-002, U6 / R7).
 *
 * With **no ephemeral column sort active**, the default Gantt view should show
 * Show-all *fetched* ("context") rows interleaved among their matched siblings
 * by the Obsidian Base sort — but only when the Base sort property is the SAME
 * property a Gantt field was resolved from (per the user's configured
 * {@link FieldMappings}), so the value we compare matches what Bases sorted by.
 * For any other (formula / arbitrary / differently-mapped) sort key we can't
 * reproduce Bases' comparator, so we keep the matched-first fallback.
 *
 * Property names are NEVER hardcoded here: the plugins are property-agnostic, so
 * which property is start/end/status/progress/name is whatever the user (via
 * TaskNotes / the view config) mapped — `note.scheduled` for one vault, `note.banana`
 * for another. The map is therefore the **inverse of the resolved `FieldMappings`**.
 *
 * **Critical invariant (KTD5).** Bases sorts matched rows with locale/timezone
 * aware comparators we can't reproduce, and the Base is the ordering authority.
 * So this module **never re-sorts matched rows against each other** — it keeps
 * them in the exact Base-given order and only *positions each fetched row* among
 * its matched neighbours by comparing its mapped key. Null/undefined keys sort
 * last (ascending); descending mirrors. A fetched row in a group with no matched
 * siblings keeps a stable key-then-discovery order among the other fetched rows.
 *
 * Pure and dependency-free (besides the SourceTask / CompanionTask shapes and the
 * Obsidian `BasesSortConfig` type). The positioned list feeds
 * {@link import('../controller/InstanceExpansion').expandInstances}, which
 * preserves input order per sibling group — so this produces the right INPUT
 * order rather than mutating the expander.
 *
 * @module bases/sortKeyMapping
 */
import type { BasesSortConfig } from 'obsidian';
import type { CompanionTask } from '../datasource/companionResolve';
import type { FieldMappings } from './types/field-mapping';
import { compareScalars } from './columnSort';

/** A Gantt field a Base sort property can map onto. */
export type SortableField = 'start' | 'end' | 'text' | 'status' | 'progress';

/** A comparable sort key extracted from a task field. */
export type SortKey = Date | number | string | null;

/**
 * Map a Bases sort property id to the Gantt field it sorts, by INVERTING the
 * resolved {@link FieldMappings} (the same per-user config that fills
 * `task.start/end/status/progress/text`). A property maps to a field ONLY when it
 * equals that field's configured property — so the value the interleave sorts
 * fetched rows by always matches what Bases sorted matched rows by. Any other
 * property (a formula, or one mapped to no Gantt field, or a field whose configured
 * property differs from the sort key) returns `null` → the caller keeps the
 * matched-first fallback (no positioning, no throw).
 *
 * No property name is hardcoded — the only literals are the Obsidian BUILT-IN
 * file-name properties used for the name column when `textProperty` is unset
 * (`file.name`/`file.basename` are not user-remappable TaskNotes fields).
 */
export function mapSortPropertyToField(
  propertyId: string,
  mappings: FieldMappings,
): SortableField | null {
  if (!propertyId) return null;
  if (mappings.startProperty && propertyId === mappings.startProperty) return 'start';
  if (mappings.endProperty && propertyId === mappings.endProperty) return 'end';
  if (mappings.statusProperty && propertyId === mappings.statusProperty) return 'status';
  if (mappings.progressProperty && propertyId === mappings.progressProperty) return 'progress';
  const matchesName = mappings.textProperty
    ? propertyId === mappings.textProperty
    : propertyId === 'file.name' || propertyId === 'file.basename';
  return matchesName ? 'text' : null;
}

/**
 * Extract the comparable sort key for `field` off a task. Dates/strings/numbers
 * are returned as-is; an unset field yields `null` (→ sorts last in ascending).
 */
export function extractSortKey(task: CompanionTask, field: SortableField): SortKey {
  switch (field) {
    case 'start':
      return task.start;
    case 'end':
      return task.end;
    case 'text':
      return task.text;
    case 'status':
      return task.status;
    case 'progress':
      return task.progress;
  }
}

/**
 * Ascending comparison with null-last semantics: a `null` key always sorts after
 * a non-null one (and two nulls are equal). Non-null values delegate to the shared
 * {@link compareScalars} (the same locale-numeric convention as the grid column
 * comparator), so the two never drift apart.
 */
function compareKeysNullLast(a: SortKey, b: SortKey): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compareScalars(a, b);
}

/** The sibling-group key for a task: its first parent path, or `''` for roots. */
function groupKeyOf(task: CompanionTask): string {
  return task.parents[0] ?? '';
}

/**
 * Position fetched ("context") rows among their matched siblings by the Base
 * sort, preserving matched-row Base order EXACTLY.
 *
 * Returns the SAME array reference (no copy) when there's nothing to do — the
 * Base sort is unmapped/empty, or there are no fetched rows — so the controller
 * can keep the current matched-first fallback path cheaply.
 *
 * Otherwise returns a new array where, within each sibling group (keyed by first
 * parent), each fetched row is inserted before the first matched sibling whose
 * mapped key is strictly greater (ascending; mirrored for descending). Fetched
 * rows whose key isn't less than any matched sibling's key trail that group's
 * matched rows. Matched rows are never reordered relative to each other.
 *
 * @param tasks - the displayed companion set (matched first, then fetched).
 * @param sortConfig - `config.getSort()` (primary key at `[0]`; `[]` → no sort).
 * @param mappings - the resolved field mappings (the user's property→field config,
 *   from TaskNotes when present); inverted to decide which field the sort maps to.
 */
export function positionFetchedAmongMatched(
  tasks: readonly CompanionTask[],
  sortConfig: readonly BasesSortConfig[],
  mappings: FieldMappings,
): CompanionTask[] | readonly CompanionTask[] {
  const primary = sortConfig[0];
  const field = primary ? mapSortPropertyToField(primary.property, mappings) : null;
  if (!field) {
    // Unmapped / formula / no sort → keep the current matched-first fallback.
    return tasks;
  }

  const hasFetched = tasks.some((t) => t.isFetched);
  if (!hasFetched) {
    return tasks;
  }

  const descending = primary?.direction === 'DESC';
  const cmp = (a: SortKey, b: SortKey): number => {
    const base = compareKeysNullLast(a, b);
    // Null always sorts last regardless of direction, so only flip non-null
    // comparisons. compareKeysNullLast already returns ±1 for null cases; detect
    // a null-driven result and leave it unflipped.
    if (a === null || b === null) return base;
    return descending ? -base : base;
  };

  // Group matched + fetched by sibling group, preserving input order in each.
  const matchedByGroup = new Map<string, CompanionTask[]>();
  const fetchedByGroup = new Map<string, CompanionTask[]>();
  for (const t of tasks) {
    const key = groupKeyOf(t);
    const bucket = t.isFetched ? fetchedByGroup : matchedByGroup;
    const list = bucket.get(key);
    if (list) list.push(t);
    else bucket.set(key, [t]);
  }

  // Build, per group, the positioned sibling order (matched order preserved).
  const positionedByGroup = new Map<string, CompanionTask[]>();
  for (const [key, fetched] of fetchedByGroup) {
    const matched = matchedByGroup.get(key) ?? [];
    positionedByGroup.set(key, positionGroup(matched, fetched, field, cmp));
  }

  // Stitch back globally: walk the original task list; the first time a group is
  // encountered, splice in that group's full positioned order; skip the group's
  // other members (they were already emitted in the positioned block). This
  // anchors each group to where its FIRST member sat in the Base order, keeping
  // matched rows in their exact relative Base positions across groups.
  const out: CompanionTask[] = [];
  const emittedGroups = new Set<string>();
  for (const t of tasks) {
    const key = groupKeyOf(t);
    if (emittedGroups.has(key)) continue;
    const positioned = positionedByGroup.get(key);
    if (positioned) {
      out.push(...positioned);
      emittedGroups.add(key);
    } else {
      // Group has no fetched rows → emit its members in original order as we
      // meet them (matched-only group; nothing to reposition).
      out.push(t);
      // Mark so the remaining matched members of this group flow through the
      // else-branch below as encountered (we do NOT add to emittedGroups so each
      // matched-only member is emitted exactly once in input order).
    }
  }
  return out;
}

/**
 * Position one sibling group's fetched rows among its matched rows.
 *
 * Matched order is preserved exactly. Each fetched row is inserted before the
 * first matched row whose key compares greater (per `cmp`); fetched rows that
 * aren't less than any matched row trail the matched rows, ordered among
 * themselves by key (then stable discovery order). A group with no matched rows
 * returns the fetched rows ordered by key.
 *
 * Implemented as a two-pointer merge of the matched list (kept in its exact Base
 * order) and the key-sorted fetched list. This is correct even though the matched
 * keys are NOT monotonic (matched is in Base order, never re-sorted): a fetched
 * row's target slot is the first matched index whose key is greater, and that
 * slot is monotonic in fetched-sorted order — so once fetched is sorted ascending,
 * a single forward pass places every row, with matched keys read once each.
 */
function positionGroup(
  matched: readonly CompanionTask[],
  fetched: readonly CompanionTask[],
  field: SortableField,
  cmp: (a: SortKey, b: SortKey) => number,
): CompanionTask[] {
  const keyOf = (t: CompanionTask): SortKey => extractSortKey(t, field);
  const sortedFetched = stableSortByKey(fetched, keyOf, cmp);

  const out: CompanionTask[] = [];
  let fetchedIndex = 0;
  for (const matchedRow of matched) {
    const matchedKey = keyOf(matchedRow);
    // Emit every remaining fetched row that sorts before this matched anchor.
    while (fetchedIndex < sortedFetched.length && cmp(keyOf(sortedFetched[fetchedIndex]!), matchedKey) < 0) {
      out.push(sortedFetched[fetchedIndex++]!);
    }
    out.push(matchedRow);
  }
  // Fetched rows not less than any matched anchor (incl. null keys) trail the group.
  while (fetchedIndex < sortedFetched.length) out.push(sortedFetched[fetchedIndex++]!);
  return out;
}

/** Stable sort of tasks by their extracted key (preserves order for equal keys). */
function stableSortByKey(
  tasks: readonly CompanionTask[],
  keyOf: (t: CompanionTask) => SortKey,
  cmp: (a: SortKey, b: SortKey) => number,
): CompanionTask[] {
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => {
      const comparison = cmp(keyOf(a.task), keyOf(b.task));
      return comparison !== 0 ? comparison : a.index - b.index;
    })
    .map((entry) => entry.task);
}
