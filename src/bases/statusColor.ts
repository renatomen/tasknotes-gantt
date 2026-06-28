/**
 * Pure helpers for status-driven bar coloring (U5).
 *
 * Dependency-free (no Obsidian, no Svelte) so the slug + stylesheet logic is
 * unit-testable in isolation; `GanttContainer.svelte` imports it. Mirrors the
 * pure-module style of `datePolicyConfig.ts`.
 *
 * The bar class is derived from the status *value*; the color is looked up by
 * the raw value (an exact match to the TaskNotes config), so emoji/symbol-laden
 * status strings still produce a valid, unique class.
 *
 * @module bases/statusColor
 */

import type { StatusColor } from '../datasource/types';

/** Prefix for the per-status bar class, namespaced to this plugin. */
export const STATUS_CLASS_PREFIX = 'og-status-';

/**
 * Safe CSS color guard: hex (`#rgb`…`#rrggbbaa`), an `rgb()/hsl()` functional
 * form, or a bare keyword. Status colors come from the user's TaskNotes config
 * (trusted-but-external); this prevents a malformed value from breaking out of
 * the generated rule. Anything else is skipped (bar simply stays uncolored).
 */
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|[a-z]+|(?:rgb|hsl)a?\([0-9.,%\s/]+\))$/i;

/**
 * Stable 32-bit string hash (djb2), base36 — for slug uniqueness.
 *
 * Iterates by code point (`for…of`) so emoji/astral characters in status
 * values hash as whole code points rather than surrogate halves. The output is
 * an internal, per-render CSS-class suffix (not persisted), so it only needs to
 * be deterministic and collision-resistant — both preserved here.
 */
function hash36(s: string): string {
  let h = 5381;
  for (const ch of s) {
    h = ((h << 5) + h + (ch.codePointAt(0) ?? 0)) >>> 0;
  }
  return h.toString(36);
}

/**
 * A CSS-safe, stable, collision-resistant class token for a status value.
 *
 * The value can contain emoji/symbols/spaces (e.g. `11🟥Active = Now`), so the
 * readable part is sanitized to `[a-z0-9-]` and a short hash of the RAW value is
 * appended — two distinct values never collide even if their readable parts do.
 */
export function statusSlug(value: string): string {
  const readable = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // collapse each run of non-alphanumerics to one dash
    .replace(/^-/, '') // ...so at most a single leading dash remains to trim
    .replace(/-$/, ''); // ...and a single trailing one (no backtracking-prone `-+`)
  const suffix = hash36(value);
  return readable
    ? `${STATUS_CLASS_PREFIX}${readable}-${suffix}`
    : `${STATUS_CLASS_PREFIX}${suffix}`;
}

/**
 * Build a deduped CSS stylesheet coloring each present status' bar by its
 * TaskNotes color. A rule is emitted only for a status that (a) appears on a
 * render instance and (b) has a safe configured color. Rules are scoped under
 * `.og-bases-gantt` so they never leak outside the Gantt view. Output order
 * follows the `colors` (config) order for determinism.
 *
 * The `background-color` is `!important` so it wins over the date-status
 * indicator's own `!important` background — a bar that is BOTH date-flagged and
 * status-colored shows its status color as the fill, while the date-status
 * flag's border / text / progress treatments still signal the incomplete dates
 * (R4 coexistence).
 *
 * @param instances - render instances (only `.status` is read)
 * @param colors - the status→color palette from the source layer
 * @returns CSS text (possibly empty), ready to inject into a `<style>` element
 */
export function buildStatusStyleRules(
  instances: ReadonlyArray<{ status: string | null }>,
  colors: ReadonlyArray<StatusColor>,
): string {
  const present = new Set<string>();
  for (const inst of instances) {
    if (inst.status) present.add(inst.status);
  }

  const emitted = new Set<string>();
  const rules: string[] = [];
  for (const { value, color } of colors) {
    if (!present.has(value) || emitted.has(value)) continue;
    if (!color || !SAFE_COLOR.test(color)) continue;
    emitted.add(value);
    rules.push(
      `.og-bases-gantt .wx-bar.${statusSlug(value)} { background-color: ${color} !important; }`,
    );
  }
  return rules.join('\n');
}
