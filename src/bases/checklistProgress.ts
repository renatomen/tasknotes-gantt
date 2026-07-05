/**
 * Shared top-level checklist-progress helpers — the single source of truth for
 * "what counts as a top-level checklist item", mirroring TaskNotes'
 * `calculateChecklistProgress`. Two consumers read from the same rule so they
 * can never drift:
 *
 * - {@link checklistProgressPercent} — the bar value in TaskNotes progress mode
 *   (`BasesSource.computeChecklistProgress`).
 * - {@link checklistCompletionSignature} — a compact fingerprint folded into the
 *   `#161` refresh gate (`computeEntrySignature`) so a checklist tick, which
 *   changes `listItems` rather than frontmatter, flips the signature and
 *   refreshes the bar (U4/R5).
 *
 * Input is Obsidian's `CachedMetadata.listItems`, narrowed to the two fields the
 * count needs; pure and Obsidian-free so the rule is unit-testable in isolation.
 *
 * @module bases/checklistProgress
 */

/** The subset of a metadata-cache `ListItemCache` the checklist count reads. */
export interface ChecklistItemLike {
  /** The char inside the brackets (`' '`, `'x'`, `'/'`, …); absent for plain bullets. */
  task?: string;
  /** Parent list-item line, or negative for a top-level item. */
  parent?: number;
}

/** Completed and total counts over the note's top-level checklist items. */
export interface ChecklistCounts {
  completed: number;
  total: number;
}

/**
 * Count completed and total **top-level** checklist items: entries with a `task`
 * marker whose `parent` is negative (nested items and plain bullets are
 * excluded). `x`/`X` count as completed; any other marker counts toward total
 * only.
 */
export function countTopLevelChecklistItems(
  listItems: ReadonlyArray<ChecklistItemLike> | null | undefined,
): ChecklistCounts {
  let completed = 0;
  let total = 0;
  if (Array.isArray(listItems)) {
    for (const item of listItems) {
      if (!item || typeof item.task !== 'string') continue;
      if (typeof item.parent === 'number' && item.parent >= 0) continue;
      total += 1;
      if (item.task.toLowerCase() === 'x') completed += 1;
    }
  }
  return { completed, total };
}

/**
 * The checklist progress as a 0–100 percentage, or `null` when the note has no
 * top-level checklist items (the caller renders that as an empty bar).
 */
export function checklistProgressPercent(
  listItems: ReadonlyArray<ChecklistItemLike> | null | undefined,
): number | null {
  const { completed, total } = countTopLevelChecklistItems(listItems);
  return total === 0 ? null : Math.round((completed / total) * 100);
}

/**
 * A compact `completed/total` fingerprint for the refresh gate; `''` when there
 * are no checklist items (so it contributes nothing to the entry signature).
 */
export function checklistCompletionSignature(
  listItems: ReadonlyArray<ChecklistItemLike> | null | undefined,
): string {
  const { completed, total } = countTopLevelChecklistItems(listItems);
  return total === 0 ? '' : `${completed}/${total}`;
}
