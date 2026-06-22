/**
 * Default-view safe-partial interleave (plan 2026-06-22-002, U6 / R7).
 *
 * With **no ephemeral column sort active**, the default Gantt view should show
 * Show-all *fetched* ("context") rows interleaved among their matched siblings
 * by the Obsidian Base sort — but only when the Base sort property maps to a
 * Gantt field we can compare locally (`note.scheduled→start`, `note.due→end`,
 * `file.name→text`, `note.status→status`, `note.progress→progress`). For any
 * other (formula / arbitrary-property) sort key we can't reproduce Bases'
 * comparator, so we keep the existing matched-first fallback (fetched trail).
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

/** A Gantt field a Base sort property can map onto. */
export type SortableField = 'start' | 'end' | 'text' | 'status' | 'progress';

/** A comparable sort key extracted from a task field. */
export type SortKey = Date | number | string | null;

/**
 * Base sort property id → Gantt {@link SortableField}, or `null` when the
 * property doesn't map to a comparable Gantt field (a formula or any other
 * arbitrary property → the matched-first fallback, R7/AE5).
 *
 * The five mappings are fixed by the plan (KTD5). Property ids are the dotted
 * Bases ids (e.g. `note.due`, `file.name`).
 */
const PROPERTY_TO_FIELD: Readonly<Record<string, SortableField>> = {
  'note.scheduled': 'start',
  'note.due': 'end',
  'file.name': 'text',
  'note.status': 'status',
  'note.progress': 'progress',
};

/**
 * Map a Bases sort property id to the Gantt field it sorts, or `null` when the
 * property is unmapped (formula / arbitrary) — the caller then keeps the current
 * matched-first fallback (no positioning, no throw).
 */
export function mapSortPropertyToField(propertyId: string): SortableField | null {
  return PROPERTY_TO_FIELD[propertyId] ?? null;
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
 * Ascending comparison of two non-null sort keys, type-aware. Dates compare
 * chronologically, numbers numerically, everything else by a locale-aware,
 * numeric-aware string compare (consistent with the grid column comparator).
 */
function compareKeys(a: Exclude<SortKey, null>, b: Exclude<SortKey, null>): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
}

/**
 * Ascending comparison with null-last semantics: a `null` key always sorts after
 * a non-null one (and two nulls are equal).
 */
function compareKeysNullLast(a: SortKey, b: SortKey): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compareKeys(a, b);
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
 */
export function positionFetchedAmongMatched(
  tasks: readonly CompanionTask[],
  sortConfig: readonly BasesSortConfig[],
): CompanionTask[] | readonly CompanionTask[] {
  const primary = sortConfig[0];
  const field = primary ? mapSortPropertyToField(primary.property) : null;
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
 */
function positionGroup(
  matched: readonly CompanionTask[],
  fetched: readonly CompanionTask[],
  field: SortableField,
  cmp: (a: SortKey, b: SortKey) => number,
): CompanionTask[] {
  // Pre-extract keys once.
  const keyOf = (t: CompanionTask): SortKey => extractSortKey(t, field);

  if (matched.length === 0) {
    // No matched anchors: order fetched by key (stable for equal keys).
    return stableSortByKey(fetched, keyOf, cmp);
  }

  // For each matched slot index i (0..matched.length), collect fetched rows that
  // belong *before* matched[i] — i.e. their key is strictly less than
  // matched[i]'s key AND not already placed before an earlier matched row.
  const slots: CompanionTask[][] = Array.from({ length: matched.length + 1 }, () => []);
  for (const f of fetched) {
    const fk = keyOf(f);
    let placed = matched.length; // default: trailing slot (after all matched).
    for (let i = 0; i < matched.length; i++) {
      const mk = keyOf(matched[i] as CompanionTask);
      if (cmp(fk, mk) < 0) {
        placed = i;
        break;
      }
    }
    slots[placed]?.push(f);
  }

  // Order fetched within each slot by key (stable), then assemble.
  const out: CompanionTask[] = [];
  for (let i = 0; i < matched.length; i++) {
    for (const f of stableSortByKey(slots[i] as CompanionTask[], keyOf, cmp)) out.push(f);
    out.push(matched[i] as CompanionTask);
  }
  for (const f of stableSortByKey(slots[matched.length] as CompanionTask[], keyOf, cmp)) {
    out.push(f);
  }
  return out;
}

/** Stable sort of tasks by their extracted key (preserves order for equal keys). */
function stableSortByKey(
  tasks: readonly CompanionTask[],
  keyOf: (t: CompanionTask) => SortKey,
  cmp: (a: SortKey, b: SortKey) => number,
): CompanionTask[] {
  return tasks
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const c = cmp(keyOf(a.t), keyOf(b.t));
      return c !== 0 ? c : a.i - b.i;
    })
    .map((x) => x.t);
}
