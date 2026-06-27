/**
 * Pure readers for the Gantt view's date-policy + row-visibility options (U3).
 *
 * Kept in its own dependency-free module (no Obsidian, no Svelte) so the
 * coercion rules are unit-testable in isolation; `register.ts` re-exports them.
 *
 * Two layers, two readers (#161, KTD7):
 * - {@link readDatePolicyConfig} feeds the controller's DERIVATION — only
 *   `defaultDuration`, a data-shaping input that legitimately re-derives.
 * - {@link readRowVisibilityOptions} feeds the VIEW's presentation filter — the
 *   show-undated/show-partial toggles, applied via SVAR `filter-tasks` over the
 *   stable instance set so toggling them never churns the chart.
 *
 * Both read the SAME `.base` config keys as before (R4); only the internal
 * application path differs.
 *
 * @module bases/datePolicyConfig
 */

import type { DatePolicyConfig } from '../controller/GanttController';

/** The view's row-visibility toggles (presentation layer, #161). */
export interface RowVisibilityOptions {
  /** When `false`, undated (placeholder) rows are hidden by the view filter. */
  showUndatedTasks: boolean;
  /** When `false`, partial-date (inferred) rows are hidden by the view filter. */
  showPartialDateTasks: boolean;
}

/**
 * Resolve the controller's date-policy config (derivation input) from per-view
 * option values. `defaultDuration` coerces to an integer ≥ 1 (default 1).
 *
 * @param get - reads a per-view option value by key (the Bases `config.get`).
 */
export function readDatePolicyConfig(get: (key: string) => unknown): DatePolicyConfig {
  const raw = Number(get('tngantt_defaultDuration'));
  const defaultDuration = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
  return { defaultDuration };
}

/**
 * Resolve the view's row-visibility toggles (presentation input) from per-view
 * option values. Both default to shown — only an explicit `false` hides.
 *
 * @param get - reads a per-view option value by key (the Bases `config.get`).
 */
export function readRowVisibilityOptions(get: (key: string) => unknown): RowVisibilityOptions {
  return {
    showUndatedTasks: get('tngantt_showUndatedTasks') !== false,
    showPartialDateTasks: get('tngantt_showPartialDateTasks') !== false,
  };
}
