/**
 * Pure row-visibility predicate for the Gantt view's presentation filter (#161, U4).
 *
 * Every row-visibility option — Hide-top, Show-undated, Show-partial — is applied
 * by the view as ONE composed SVAR `filter-tasks` predicate over the stable
 * instance set. Because the task array never varies with these options, a Bases
 * config oscillation cannot churn the chart: the controller emits a no-op and the
 * view does a cheap filter re-apply (R1/R2).
 *
 * This module is the single composition point and the R5 extension seam: a future
 * row-visibility option folds into {@link shouldHideRow} here, inheriting the
 * no-churn property for free — no per-option special-casing in the view.
 *
 * Kept dependency-free (no Svelte, no SVAR, no Obsidian) so the truth table is
 * unit-testable in isolation.
 *
 * @module bases/rowVisibility
 */

import { PARTIAL_DATE_STATUSES, type DateStatus } from '../controller/datePolicy';

/** The per-task fields the predicate reads (a subset of `SvarTask.custom`). */
export interface RowVisibilityInput {
  /** True for an also-top-level DUPLICATE row (the Hide-top target). */
  isTopLevelPlacement: boolean;
  /** The task's resolved date-policy classification. */
  dateStatus: DateStatus;
}

/** The three row-visibility option values, as the view sees them. */
export interface RowVisibilityFlags {
  /** "Hide top-level subtasks": hide also-top-level duplicate rows. */
  hideTopLevel: boolean;
  /** "Show tasks with no dates": when false, hide `placeholder` rows. */
  showUndated: boolean;
  /** "Show tasks with only one date": when false, hide partial-date rows. */
  showPartial: boolean;
}

/**
 * Decide whether a single row is hidden by the composed presentation filter.
 *
 * A row is hidden when ANY active option targets it:
 * - Hide-top targets its duplicate top-level placement.
 * - Show-undated (off) targets a `placeholder` (no-date) row.
 * - Show-partial (off) targets an `inferred-start`/`inferred-end` (one-date) row.
 *
 * Note: SVAR's `filterTree` keeps a hidden ANCESTOR if any descendant passes, so an
 * undated parent of a dated child stays visible (KTD4/R8 accepted behavior) — that
 * is a property of the tree walk, not of this per-row predicate.
 */
export function shouldHideRow(custom: RowVisibilityInput, flags: RowVisibilityFlags): boolean {
  return (
    (flags.hideTopLevel && custom.isTopLevelPlacement) ||
    (!flags.showUndated && custom.dateStatus === 'placeholder') ||
    (!flags.showPartial && PARTIAL_DATE_STATUSES.has(custom.dateStatus))
  );
}

/**
 * Whether any row-visibility option is currently active. When false, the view
 * clears the filter (`filter-tasks` with no predicate → show everything) instead
 * of running a predicate that hides nothing.
 */
export function anyRowFilterActive(flags: RowVisibilityFlags): boolean {
  return flags.hideTopLevel || !flags.showUndated || !flags.showPartial;
}
