/**
 * Pure reader for the Gantt view's date-policy + visibility options (U3).
 *
 * Kept in its own dependency-free module (no Obsidian, no Svelte) so the
 * coercion rules are unit-testable in isolation; `register.ts` re-exports it.
 *
 * @module bases/datePolicyConfig
 */

import type { DatePolicyConfig } from '../controller/GanttController';

/**
 * Resolve the date-policy config from per-view option values.
 *
 * `defaultDuration` coerces to an integer ≥ 1 (default 1); the visibility
 * toggles default to shown — only an explicit `false` hides.
 *
 * @param get - reads a per-view option value by key (the Bases `config.get`).
 */
export function readDatePolicyConfig(get: (key: string) => unknown): DatePolicyConfig {
  const raw = Number(get('defaultDuration'));
  const defaultDuration = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
  return {
    defaultDuration,
    showUndatedTasks: get('showUndatedTasks') !== false,
    showPartialDateTasks: get('showPartialDateTasks') !== false,
  };
}
