/**
 * Pure helpers for per-view bar color/icon treatments (generalizes `statusColor.ts`).
 *
 * Given the per-view settings (color mode + color source + icon source) and the
 * status/priority palettes, this module produces the three view-layer artifacts:
 *
 * 1. a per-bar **treatment class** (`resolveTreatmentClass`) folded into the SVAR
 *    task `type` string by `ganttSync`,
 * 2. the **generated stylesheet** (`buildTreatmentStyle`) injected under
 *    `.og-bases-gantt`, and
 * 3. the **icon-chip spec** (`resolveIconSpec`) the `BarContent` template renders.
 *
 * Dependency-free (no Obsidian, no Svelte) so the full Mode × Source matrix is
 * unit-testable in isolation. Mirrors the pure-module style of `datePolicyConfig.ts`.
 *
 * Color safety: palette colors come from the user's TaskNotes config
 * (trusted-but-external) and are validated by {@link SAFE_COLOR} before being
 * emitted into a rule. Theme-source colors are trusted literals authored here
 * (CSS variables / `color-mix`) and bypass the guard.
 *
 * @module bases/barTreatment
 */

import type { PriorityColor, StatusColor } from '../datasource/types';

/** Per-view bar color mode: fill the whole bar, or a left accent strip. */
export type BarColorMode = 'fill' | 'strip';

/** Per-view color source: none, TaskNotes status/priority, or Obsidian theme. */
export type BarColorSource = 'default' | 'status' | 'priority' | 'theme';

/** Per-view icon source: none, or the status/priority icon (independent of color). */
export type BarIconSource = 'none' | 'status' | 'priority';

/** Prefix for the per-status bar class, namespaced to this plugin. */
export const STATUS_CLASS_PREFIX = 'og-status-';

/** Prefix for the per-priority bar class, namespaced to this plugin. */
export const PRIORITY_CLASS_PREFIX = 'og-prio-';

/** Role class marking a parent bar in `theme` color mode. */
export const PARENT_ROLE_CLASS = 'og-parent';

/** Width of the left accent strip in `strip` mode (matches the layout study). */
export const STRIP_WIDTH_PX = 3;

/**
 * Child-bar tint for `theme` mode: a light blend of the theme accent over the
 * primary background, so children read as the same family as (accent) parents.
 */
const THEME_CHILD_COLOR =
  'color-mix(in srgb, var(--interactive-accent) 28%, var(--background-primary))';

/**
 * Safe CSS color guard: hex (`#rgb`…`#rrggbbaa`), an `rgb()/hsl()` functional
 * form, or a bare keyword. Prevents a malformed palette value from breaking out
 * of the generated rule. Anything else is skipped (bar stays uncolored).
 */
export const SAFE_COLOR = /^(#[0-9a-f]{3,8}|[a-z]+|(?:rgb|hsl)a?\([0-9.,%\s/]+\))$/i;

/** The status/priority palettes, bundled so per-instance resolvers take ≤4 args. */
export interface Palettes {
  status: ReadonlyArray<StatusColor>;
  priority: ReadonlyArray<PriorityColor>;
}

/** The bar-relevant slice of a render instance the resolvers read. */
export interface TreatmentInstance {
  status: string | null;
  priority: string | null;
}

/** The resolved icon chip for a bar: an icon glyph name and/or a color for the dot. */
export interface IconSpec {
  /** `setIcon`-accepted icon name, when the value's config carries one. */
  iconName?: string;
  /** The dimension color — tints the glyph, or fills the dot when no glyph. */
  color: string;
}

/**
 * Stable 32-bit string hash (djb2), base36 — for slug uniqueness. Iterates by
 * code point so emoji/astral characters hash as whole code points.
 */
function hash36(s: string): string {
  let h = 5381;
  for (const ch of s) {
    h = ((h << 5) + h + (ch.codePointAt(0) ?? 0)) >>> 0;
  }
  return h.toString(36);
}

/**
 * A CSS-safe, stable, collision-resistant class token for `value` under `prefix`.
 * The readable part is sanitized to `[a-z0-9-]`; a short hash of the RAW value is
 * appended so two distinct values never collide even if their readable parts do.
 */
function slug(prefix: string, value: string): string {
  const readable = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-/, '')
    .replace(/-$/, '');
  const suffix = hash36(value);
  return readable ? `${prefix}${readable}-${suffix}` : `${prefix}${suffix}`;
}

/** A CSS-safe, stable class token for a status value (prefix `og-status-`). */
export function statusSlug(value: string): string {
  return slug(STATUS_CLASS_PREFIX, value);
}

/** A CSS-safe, stable class token for a priority value (prefix `og-prio-`). */
export function prioritySlug(value: string): string {
  return slug(PRIORITY_CLASS_PREFIX, value);
}

/** Whether a palette contains `value` with a usable, safe color. */
function hasSafeColor(palette: ReadonlyArray<{ value: string; color: string }>, value: string): boolean {
  return palette.some((c) => c.value === value && !!c.color && SAFE_COLOR.test(c.color));
}

/**
 * The treatment class a bar carries for the active color source, or `null` when
 * the bar takes no plugin class (SVAR/theme default content).
 *
 * A bar carries at most one treatment class. `isParent` is supplied by the
 * caller (derived from a whole-array parent scan) — parent-ness is not a
 * property of a lone instance, so this function never infers it.
 *
 * - `status` / `priority`: the value's slug, but only when the value has a safe
 *   configured color (else no rule would exist for it → `null`).
 * - `theme`: the parent-role class for parents; children carry no class (the
 *   generated base `.wx-bar` rule styles them).
 * - `default`: `null`.
 */
export function resolveTreatmentClass(
  source: BarColorSource,
  instance: TreatmentInstance,
  isParent: boolean,
  palettes: Palettes,
): string | null {
  switch (source) {
    case 'status':
      return instance.status && hasSafeColor(palettes.status, instance.status)
        ? statusSlug(instance.status)
        : null;
    case 'priority':
      return instance.priority && hasSafeColor(palettes.priority, instance.priority)
        ? prioritySlug(instance.priority)
        : null;
    case 'theme':
      return isParent ? PARENT_ROLE_CLASS : null;
    default:
      return null;
  }
}

/** Distinct treatment classes a bar could carry across all palette values, for SVAR registration. */
export function treatmentClassRegistry(palettes: Palettes): string[] {
  const ids = new Set<string>([PARENT_ROLE_CLASS]);
  for (const { value, color } of palettes.status) {
    if (color && SAFE_COLOR.test(color)) ids.add(statusSlug(value));
  }
  for (const { value, color } of palettes.priority) {
    if (color && SAFE_COLOR.test(color)) ids.add(prioritySlug(value));
  }
  return [...ids];
}

/** Inputs to {@link buildTreatmentStyle}, grouped to keep the signature small. */
export interface TreatmentStyleInput {
  mode: BarColorMode;
  source: BarColorSource;
  palettes: Palettes;
  /** Render instances — only `.status`/`.priority` are read (present-value set). */
  instances: ReadonlyArray<TreatmentInstance>;
}

/**
 * Build the deduped, scoped stylesheet for the active mode + source, or `''`.
 *
 * - `status`/`priority`: one rule per present palette value with a safe color —
 *   a `background-color` fill (`mode='fill'`) or a `::before` left strip
 *   (`mode='strip'`). Fill is `!important` so it wins over the date-status flag's
 *   own `!important` background (coexistence).
 * - `theme`: parent/child rules using Obsidian CSS variables (late-bound, so a
 *   theme flip re-tints live). No palette needed; emitted even when empty.
 * - `default`: `''`.
 */
export function buildTreatmentStyle(input: TreatmentStyleInput): string {
  const { mode, source, palettes, instances } = input;
  if (source === 'default') return '';
  if (source === 'theme') return buildThemeStyle(mode);

  const palette: ReadonlyArray<{ value: string; color: string }> =
    source === 'status' ? palettes.status : palettes.priority;
  const slugOf = source === 'status' ? statusSlug : prioritySlug;

  const present = new Set<string>();
  for (const inst of instances) {
    const v = source === 'status' ? inst.status : inst.priority;
    if (v) present.add(v);
  }

  const emitted = new Set<string>();
  const rules: string[] = [];
  for (const { value, color } of palette) {
    if (!present.has(value) || emitted.has(value)) continue;
    if (!color || !SAFE_COLOR.test(color)) continue;
    emitted.add(value);
    const sel = `.og-bases-gantt .wx-bar.${slugOf(value)}`;
    rules.push(
      mode === 'strip' ? `${sel}${stripRule(color)}` : `${sel} { background-color: ${color} !important; }`,
    );
  }
  return rules.join('\n');
}

/** The `::before` left-strip declaration block for a given accent color. */
function stripRule(color: string): string {
  return (
    `::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; ` +
    `width: ${STRIP_WIDTH_PX}px; background-color: ${color}; }`
  );
}

/** Theme-source rules (parent/child roles) for the given mode. */
function buildThemeStyle(mode: BarColorMode): string {
  const bar = '.og-bases-gantt .wx-bar';
  if (mode === 'strip') {
    return [
      `${bar} { background-color: var(--background-secondary) !important; }`,
      `${bar}${stripRule(THEME_CHILD_COLOR)}`,
      `${bar}.${PARENT_ROLE_CLASS}::before { background-color: var(--interactive-accent); }`,
    ].join('\n');
  }
  return [
    `${bar} { background-color: ${THEME_CHILD_COLOR} !important; color: var(--text-normal); }`,
    `${bar}.${PARENT_ROLE_CLASS} { background-color: var(--interactive-accent) !important; color: var(--text-on-accent); }`,
  ].join('\n');
}

/**
 * The icon chip spec for a bar, or `null` when no chip renders (icon source is
 * `none`, or the bar's value is absent from the palette — matching TaskNotes,
 * which shows an indicator only when a config exists).
 *
 * `iconName` is present only when the value's config carries an icon; otherwise
 * the caller renders a colored dot (`color`).
 */
export function resolveIconSpec(
  iconSource: BarIconSource,
  instance: TreatmentInstance,
  palettes: Palettes,
): IconSpec | null {
  if (iconSource === 'none') return null;
  const value = iconSource === 'status' ? instance.status : instance.priority;
  if (!value) return null;
  const palette: ReadonlyArray<{ value: string; color: string; icon?: string }> =
    iconSource === 'status' ? palettes.status : palettes.priority;
  const entry = palette.find((p) => p.value === value);
  if (!entry || !entry.color) return null;
  return entry.icon ? { iconName: entry.icon, color: entry.color } : { color: entry.color };
}
