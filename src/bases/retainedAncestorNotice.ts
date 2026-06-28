/**
 * Heads-up notice: incomplete-date parents retained when a date filter is OFF
 * (#161, U8/R8).
 *
 * SVAR's `filter-tasks` walks the tree with `filterTree`, which keeps a node if the
 * node OR any descendant passes the predicate (KTD4). So when "Show tasks with no
 * dates" (or "…with only one date") is OFF, an UNDATED / PARTIAL-DATE parent of a
 * DATED child stays visible — its child passes, so the parent is retained. This is
 * accepted product behavior (maintainer, 2026-06-27), but it can surprise a user who
 * expected every such row to vanish.
 *
 * This pure builder counts those retained parents from the instance tree so the view
 * can show a small contextual line — only when it actually happens, so there's no
 * standing noise. Both date-incompleteness classes are covered symmetrically:
 * `placeholder` (gated on Show-undated) and `inferred-*` (gated on Show-partial).
 *
 * Pure (no Svelte/SVAR/Obsidian) so the copy + counting are unit-testable.
 *
 * @module bases/retainedAncestorNotice
 */

import { shouldHideRow, type RowVisibilityFlags } from './rowVisibility';
import { PARTIAL_DATE_STATUSES, type DateStatus } from '../controller/datePolicy';

/** Minimal instance shape the notice reads (a subset of `RenderInstance`). */
export interface RetainedNoticeInstance {
  id: string;
  parent?: string;
  isTopLevelPlacement: boolean;
  dateStatus: DateStatus;
}

/** Pluralize "parent" for a count. */
function parents(count: number): string {
  return count === 1 ? 'parent' : 'parents';
}

/** Children grouped by parent id. */
type ChildIndex = Map<string, RetainedNoticeInstance[]>;

/**
 * Build the child-by-parent index and the set of row ids that pass the composed
 * filter, in a single pass over the instances.
 */
function indexInstances(
  instances: readonly RetainedNoticeInstance[],
  flags: RowVisibilityFlags,
): { childrenOf: ChildIndex; shown: Set<string> } {
  const childrenOf: ChildIndex = new Map();
  const shown = new Set<string>();
  for (const inst of instances) {
    if (inst.parent) {
      const siblings = childrenOf.get(inst.parent);
      if (siblings) siblings.push(inst);
      else childrenOf.set(inst.parent, [inst]);
    }
    if (!shouldHideRow(inst, flags)) shown.add(inst.id);
  }
  return { childrenOf, shown };
}

/** Does this node have any descendant (at any depth) that passes the filter? */
function hasShownDescendant(
  id: string,
  childrenOf: ChildIndex,
  shown: ReadonlySet<string>,
): boolean {
  const stack = [...(childrenOf.get(id) ?? [])];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (shown.has(node.id)) return true;
    const kids = childrenOf.get(node.id);
    if (kids) stack.push(...kids);
  }
  return false;
}

/**
 * Count the retained incomplete-date parents — those kept visible only because a
 * descendant passes the filter — split by date-incompleteness class. `undated`
 * counts `placeholder` parents (gated on Show-undated); `partial` counts
 * `inferred-*` parents (gated on Show-partial).
 */
function countRetainedParents(
  instances: readonly RetainedNoticeInstance[],
  flags: RowVisibilityFlags,
  childrenOf: ChildIndex,
  shown: ReadonlySet<string>,
): { undated: number; partial: number } {
  let undated = 0;
  let partial = 0;
  for (const inst of instances) {
    const hiddenUndated = !flags.showUndated && inst.dateStatus === 'placeholder';
    const hiddenPartial = !flags.showPartial && PARTIAL_DATE_STATUSES.has(inst.dateStatus);
    if (!hiddenUndated && !hiddenPartial) continue;
    if (!hasShownDescendant(inst.id, childrenOf, shown)) continue;
    if (hiddenUndated) undated += 1;
    else partial += 1;
  }
  return { undated, partial };
}

/**
 * Compose the heads-up copy from the counts, or `undefined` when neither class has
 * a retained parent to report.
 */
function formatNotice(undated: number, partial: number): string | undefined {
  const clauses: string[] = [];
  if (undated > 0) clauses.push(`${undated} undated ${parents(undated)}`);
  if (partial > 0) clauses.push(`${partial} partial-date ${parents(partial)}`);
  if (clauses.length === 0) return undefined;

  return `${clauses.join(' and ')} kept to show their dated subtasks.`;
}

/**
 * Build the heads-up notice, or `undefined` when it doesn't apply.
 *
 * Returns a message only when a date filter is OFF AND ≥1 matching parent is retained
 * because it has a visible descendant. Counts the two date-incompleteness classes
 * separately:
 * - `placeholder` (undated) parents — only when Show-undated is OFF.
 * - `inferred-start`/`inferred-end` (partial-date) parents — only when Show-partial is OFF.
 *
 * Returns `undefined` when both date filters are ON, or when no such parent is retained.
 */
export function buildRetainedAncestorNotice(
  instances: readonly RetainedNoticeInstance[],
  flags: RowVisibilityFlags,
): string | undefined {
  if (flags.showUndated && flags.showPartial) return undefined; // no date filter active

  // Two passes over instances: first build the child index + shown set, then
  // count the retained parents against it, then render the copy.
  const { childrenOf, shown } = indexInstances(instances, flags);
  const { undated, partial } = countRetainedParents(instances, flags, childrenOf, shown);
  return formatNotice(undated, partial);
}
