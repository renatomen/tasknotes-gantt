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
 * (trusted-but-external) and are validated by {@link isSafeColor} on every path
 * that interpolates them — both the generated CSS *rules* and the icon-chip
 * `style` attribute ({@link resolveIconSpec}, which falls back to `currentColor`
 * for an unsafe value). Theme-source colors are trusted literals authored here
 * (CSS variables / `color-mix`) and bypass the guard.
 *
 * @module bases/barTreatment
 */

import type { PriorityColor, StatusColor } from '../datasource/types';

/** Per-view bar color mode: fill the whole bar, or a left accent strip. */
export type BarColorMode = 'fill' | 'strip';

/** Per-view color source: none, TaskNotes status/priority, or Obsidian theme. */
export type BarColorSource = 'default' | 'status' | 'priority' | 'theme' | 'calendar';

/** Per-view icon source: none, or the status/priority icon (independent of color). */
export type BarIconSource = 'none' | 'status' | 'priority';

/** Prefix for the per-status bar class, namespaced to this plugin. */
export const STATUS_CLASS_PREFIX = 'og-status-';

/** Prefix for the per-priority bar class, namespaced to this plugin. */
export const PRIORITY_CLASS_PREFIX = 'og-prio-';

/**
 * Prefix for the per-calendar bar class. Deliberately not `og-cal-`, which the
 * shading cells and picker rows already use — a calendar note named "cell"
 * would otherwise slug straight onto `og-cal-cell`.
 */
export const CALENDAR_CLASS_PREFIX = 'og-calendar-';

/** Role class marking a parent bar in the role-based (`default`/`theme`) sources. */
export const PARENT_ROLE_CLASS = 'og-parent';

/** The plugin-scoped base bar selector every generated rule is anchored to. */
const BAR_SELECTOR = '.og-bases-gantt .wx-bar';

/** Width of the left accent strip in `strip` mode (matches the layout study). */
export const STRIP_WIDTH_PX = 6;

/**
 * Left inset on `.wx-content` in `strip` mode: the strip width plus a comfortable
 * gap so the icon chip / text never crowds the strip. Emitted only in strip mode
 * (via the generated stylesheet), so fill/role modes keep their tighter inset.
 */
export const STRIP_CONTENT_PADDING_PX = STRIP_WIDTH_PX + 4;

/**
 * A neutral tone `pct`% of the way from the editor background toward `--text-normal`.
 * Guarantees a fixed perceptual delta from the background in ANY theme (theme surface
 * vars like `--background-secondary` collapse onto `--background-primary` in
 * low-contrast themes), so neutral bar bodies/outlines/progress stay visible.
 */
function mixNeutral(pct: number): string {
  return `color-mix(in srgb, var(--text-normal) ${pct}%, var(--background-primary))`;
}

/**
 * `color` shifted `pct`% toward `--text-normal`: a DARKER tone in light themes and a
 * LIGHTER tone in dark themes, keeping the hue. Used for the progress band and the
 * theme parent tone (more contrast without introducing a foreign hue).
 */
function shiftToward(color: string, pct: number): string {
  return `color-mix(in srgb, ${color}, var(--text-normal) ${pct}%)`;
}

/**
 * Role colors for the two "hierarchy" sources. Parents and children get two
 * distinct, equally-saturated treatments (never a pale tint of each other — opacity
 * is reserved for the Show-all "context" cue). `default` is a fixed, theme-independent
 * green/blue (SVAR-style).
 */
const DEFAULT_PARENT_COLOR = '#2ea043';
const DEFAULT_CHILD_COLOR = '#1f6feb';

/**
 * `theme` role colors: the theme's OWN accent (`--interactive-accent` — the hue the
 * user sets in Appearance → Accent color, or the active theme overrides), so the
 * bars are whatever the user's theme defines (yellow accent → yellow bars). Obsidian
 * exposes a single user-defined accent hue, so parent vs child is one hue in TWO
 * TONES: the child is the raw accent; the parent shifts toward `--text-normal` for
 * more contrast against the background (darker in light themes, lighter in dark) so
 * it reads as the more prominent, higher-in-the-hierarchy bar.
 */
const THEME_ACCENT = 'var(--interactive-accent)';
const THEME_PARENT_TONE_SHIFT_PCT = 30;
const THEME_PARENT_COLOR = shiftToward(THEME_ACCENT, THEME_PARENT_TONE_SHIFT_PCT);
const THEME_CHILD_COLOR = THEME_ACCENT;

/**
 * Text treatment on a saturated FILL: white plus a soft dark shadow, so the label
 * stays legible whether the fill is dark or on the paler side (guards the
 * "white text on a light fill" contrast failure across themes).
 */
const FILL_TEXT_COLOR = 'var(--text-on-accent, #fff)';
const FILL_TEXT_SHADOW = '0 1px 2px rgba(0, 0, 0, 0.5)';

/**
 * STRIP-mode body: a neutral surface that is GUARANTEED to read against the
 * editor/chart background in any theme. Deriving BOTH the body fill and the outline
 * as a mix toward `--text-normal` guarantees a fixed perceptual delta from the
 * background: a soft fill plus a clearly visible edge define the bar as a distinct
 * pill. Text is the theme's normal text color (the accent lives in the left strip).
 */
const STRIP_BODY_MIX_PCT = 16;
const STRIP_BORDER_MIX_PCT = 38;
const STRIP_BODY_COLOR = mixNeutral(STRIP_BODY_MIX_PCT);
const STRIP_BORDER_COLOR = mixNeutral(STRIP_BORDER_MIX_PCT);
const STRIP_TEXT_COLOR = 'var(--text-normal)';

/**
 * STRIP-mode PARENT body (hierarchy sources `default`/`theme` only): a more
 * prominent neutral than the child body — mixed further toward `--text-normal` so
 * a parent bar reads as heavier (higher contrast) than its children, matching the
 * Gantt convention for summary rows. Differentiation is by contrast/lightness
 * ONLY (no opacity), and orthogonal to the left strip accent.
 */
const STRIP_PARENT_BODY_MIX_PCT = 30;
const STRIP_PARENT_BODY_COLOR = mixNeutral(STRIP_PARENT_BODY_MIX_PCT);

/**
 * Progress fill for STRIP-mode bars: a contrasting shift of the NEUTRAL bar body
 * (not the left strip). The completed portion reads as a brighter band (dark themes)
 * / darker band (light themes) of the SAME neutral bar — a tonal shift of the bar's
 * color, never an extension of the strip accent.
 */
const NEUTRAL_PROGRESS_MIX_PCT = 45;
const NEUTRAL_PROGRESS_COLOR = mixNeutral(NEUTRAL_PROGRESS_MIX_PCT);

/**
 * Progress-fill color for FILL-mode bars: a more contrasting tonal shift of the
 * bar's OWN accent, so the completed portion reads as a darker/lighter band of the
 * same hue instead of SVAR's fixed blue (`--wx-gantt-task-fill-color`).
 */
const PROGRESS_CONTRAST_PCT = 30;
function progressColor(accent: string): string {
  return shiftToward(accent, PROGRESS_CONTRAST_PCT);
}

/**
 * Safe CSS color guard: hex (`#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`), an `rgb()/hsl()`
 * functional form, or a bare named keyword. Prevents a malformed palette value from
 * breaking out of the generated rule; anything else is skipped (bar stays uncolored).
 * The hex branch admits ONLY the four valid digit counts (3/4/6/8) so an invalid
 * length that would silently drop the whole declaration cannot pass.
 */
const SAFE_COLOR_HEX = '#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})';
const SAFE_COLOR_NAMED = '[a-z]+';
const SAFE_COLOR_FUNC = String.raw`(?:rgb|hsl)a?\([0-9.,%\s/]+\)`;
export const SAFE_COLOR = new RegExp(
  `^(?:${SAFE_COLOR_HEX}|${SAFE_COLOR_NAMED}|${SAFE_COLOR_FUNC})$`,
  'i',
);

/**
 * CSS-wide keywords that pass the bare-`[a-z]+` branch of {@link SAFE_COLOR} but do
 * NOT produce a visible fill — a `transparent`/`inherit`/`currentColor` palette color
 * would render an invisible bar with floating text, indistinguishable from a render
 * bug. Rejected so such a value degrades to the uncolored (SVAR default) bar instead.
 */
const UNSAFE_COLOR_KEYWORDS = new Set([
  'transparent',
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
  'currentcolor',
  'none',
]);

/** Whether a palette color is safe AND visible to splice into a generated CSS rule. */
export function isSafeColor(color: string | null | undefined): boolean {
  if (!color) return false;
  return SAFE_COLOR.test(color) && !UNSAFE_COLOR_KEYWORDS.has(color.trim().toLowerCase());
}

/** The status/priority palettes, bundled so per-instance resolvers take ≤4 args. */
export interface Palettes {
  status: ReadonlyArray<StatusColor>;
  priority: ReadonlyArray<PriorityColor>;
  /**
   * The vault's calendars as a palette — `value` is the calendar (or set) id,
   * `color` its authored colour. Companion-independent: calendars never depend
   * on TaskNotes being installed.
   */
  calendar?: ReadonlyArray<{ value: string; color: string }>;
}

/** The bar-relevant slice of a render instance the resolvers read. */
export interface TreatmentInstance {
  status: string | null;
  priority: string | null;
  /**
   * Resolved calendar identity — the calendar's own id for a direct link, the
   * SET's id for a set-linked task, so a set's colour wins. Absent/null for an
   * unassociated task, which then takes the default role treatment.
   */
  calendarId?: string | null;
}

/**
 * The resolved icon-chip content for a bar. `kind` selects the no-icon shape
 * (status → ring/disc, priority → filled dot, matching TaskNotes' geometry);
 * `iconName` (when present) renders a glyph instead. `color` is the ring/dot/glyph
 * color, already guarded (an unsafe palette color falls back to `currentColor`).
 */
export interface IconSpec {
  /** Which dimension this chip represents — drives the no-icon shape. */
  kind: 'status' | 'priority';
  /** `setIcon`-accepted icon name, when the value's config carries one. */
  iconName?: string;
  /** Ring border / dot fill / glyph color (guarded; `currentColor` when unsafe). */
  color: string;
  /**
   * True only for a `status` whose config is flagged completed. Selects the
   * filled-disc no-icon shape (TaskNotes fills the status dot for completed
   * statuses; a hollow ring otherwise). Absent (never `false`) for
   * non-completed statuses and all priorities. Set regardless of `iconName` so
   * a completion flip re-fingerprints the chip even for icon statuses.
   */
  completed?: true;
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
 * Memo of computed slugs, keyed by `prefix\0value` (a NUL delimiter that cannot
 * appear in a prefix). A status/priority value repeats across many bars, so
 * memoizing turns the per-bar regex+hash work into once-per-distinct-value (bounded
 * by the vault's palette). Deterministic, so the cache never needs invalidation.
 */
const slugCache = new Map<string, string>();

/**
 * A CSS-safe, stable, collision-resistant class token for `value` under `prefix`.
 * The readable part is sanitized to `[a-z0-9-]`; a short hash of the RAW value is
 * appended so two distinct values never collide even if their readable parts do.
 */
function slug(prefix: string, value: string): string {
  const key = `${prefix}\0${value}`;
  const cached = slugCache.get(key);
  if (cached !== undefined) return cached;
  const readable = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-/, '')
    .replace(/-$/, '');
  const suffix = hash36(value);
  const result = readable ? `${prefix}${readable}-${suffix}` : `${prefix}${suffix}`;
  slugCache.set(key, result);
  return result;
}

/** A CSS-safe, stable class token for a status value (prefix `og-status-`). */
export function statusSlug(value: string): string {
  return slug(STATUS_CLASS_PREFIX, value);
}

/** A CSS-safe, stable class token for a priority value (prefix `og-prio-`). */
export function prioritySlug(value: string): string {
  return slug(PRIORITY_CLASS_PREFIX, value);
}

/** A CSS-safe, stable class token for a calendar id (prefix `og-calendar-`). */
export function calendarSlug(value: string): string {
  return slug(CALENDAR_CLASS_PREFIX, value);
}

/** Whether a palette contains `value` with a usable, safe color. */
function hasSafeColor(palette: ReadonlyArray<{ value: string; color: string }>, value: string): boolean {
  return palette.some((c) => c.value === value && isSafeColor(c.color));
}

/**
 * The color source actually applied. `status`/`priority` require a palette; when it
 * is EMPTY (standalone / no TaskNotes companion) they degrade to `default` so bars
 * still get the hierarchy treatment instead of rendering as plain SVAR bars (R15/F3).
 * An absent VALUE within a NON-empty palette is a per-bar miss, not a whole-view
 * degrade — so this keys only on palette emptiness. Both {@link resolveTreatmentClass}
 * and {@link buildTreatmentStyle} route through it so the class and the stylesheet agree.
 */
function effectiveSource(source: BarColorSource, palettes: Palettes): BarColorSource {
  if (source === 'status' && palettes.status.length === 0) return 'default';
  if (source === 'priority' && palettes.priority.length === 0) return 'default';
  if (source === 'calendar' && (palettes.calendar?.length ?? 0) === 0) return 'default';
  return source;
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
 * - `theme` / `default`: the parent-role class for parents; children carry no
 *   class (the generated base `.wx-bar` role rule styles them).
 */
export function resolveTreatmentClass(
  source: BarColorSource,
  instance: TreatmentInstance,
  isParent: boolean,
  palettes: Palettes,
): string | null {
  switch (effectiveSource(source, palettes)) {
    case 'status':
      return instance.status && hasSafeColor(palettes.status, instance.status)
        ? statusSlug(instance.status)
        : null;
    case 'priority':
      return instance.priority && hasSafeColor(palettes.priority, instance.priority)
        ? prioritySlug(instance.priority)
        : null;
    case 'calendar':
      // An unassociated task has no calendar colour to take, so it falls back
      // to the default role treatment rather than rendering as a plain bar.
      return instance.calendarId && hasSafeColor(palettes.calendar ?? [], instance.calendarId)
        ? calendarSlug(instance.calendarId)
        : isParent
          ? PARENT_ROLE_CLASS
          : null;
    case 'theme':
    case 'default':
      return isParent ? PARENT_ROLE_CLASS : null;
    default:
      return null;
  }
}

/** Distinct treatment classes a bar could carry across all palette values, for SVAR registration. */
export function treatmentClassRegistry(palettes: Palettes): string[] {
  const ids = new Set<string>([PARENT_ROLE_CLASS]);
  for (const { value, color } of palettes.status) {
    if (isSafeColor(color)) ids.add(statusSlug(value));
  }
  for (const { value, color } of palettes.priority) {
    if (isSafeColor(color)) ids.add(prioritySlug(value));
  }
  for (const { value, color } of palettes.calendar ?? []) {
    if (isSafeColor(color)) ids.add(calendarSlug(value));
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
 * Build the deduped, scoped stylesheet for the active mode + source.
 *
 * - `default`: fixed green-parent / blue-child role rules (theme-independent).
 * - `theme`: the same role rules driven by the theme's own `--interactive-accent`
 *   (late-bound, so a theme/accent change re-tints live). No palette needed.
 * - `status`/`priority`: one rule per present palette value with a safe color —
 *   a `background-color` fill (`mode='fill'`) or a `::before` left strip
 *   (`mode='strip'`). Fill is `!important` so it wins over the date-status flag's
 *   own `!important` background (coexistence).
 */
export function buildTreatmentStyle(input: TreatmentStyleInput): string {
  const { mode, palettes, instances } = input;
  // Empty status/priority palette (standalone) degrades to the Default role style.
  const source = effectiveSource(input.source, palettes);
  if (source === 'default') return buildRoleStyle(mode, DEFAULT_PARENT_COLOR, DEFAULT_CHILD_COLOR);
  if (source === 'theme') return buildRoleStyle(mode, THEME_PARENT_COLOR, THEME_CHILD_COLOR);

  const { palette, slugOf, valueOf } = paletteFor(source, palettes);

  const present = new Set<string>();
  for (const inst of instances) {
    const value = valueOf(inst);
    if (value) present.add(value);
  }

  const rules = buildValueRules(mode, palette, present, slugOf);
  // Calendar bars sit on top of the default role rules, so an unassociated
  // task keeps the hierarchy treatment instead of rendering as a plain bar.
  if (source === 'calendar') {
    const base = buildRoleStyle(mode, DEFAULT_PARENT_COLOR, DEFAULT_CHILD_COLOR);
    return rules.length === 0 ? base : [base, ...rules].join('\n');
  }
  if (rules.length === 0) return '';
  // Strip mode: neutralize EVERY bar body to a theme surface with readable text +
  // a visible outline (the accent is the left strip), and widen the content inset
  // so it clears the strip. Progress is a tonal shift of the NEUTRAL body (shared
  // by all strip bars), not the strip accent. Date-status-flagged bars keep theirs.
  if (mode === 'strip') {
    rules.unshift(
      stripBodyRule(),
      progressFillRule(BAR_SELECTOR, NEUTRAL_PROGRESS_COLOR),
      stripContentPadRule(),
    );
  }
  return rules.join('\n');
}

/** The palette, class-slug and per-instance value reader for a value source. */
function paletteFor(
  source: BarColorSource,
  palettes: Palettes,
): {
  palette: ReadonlyArray<{ value: string; color: string }>;
  slugOf: (value: string) => string;
  valueOf: (instance: TreatmentInstance) => string | null | undefined;
} {
  if (source === 'calendar') {
    return {
      palette: palettes.calendar ?? [],
      slugOf: calendarSlug,
      valueOf: (instance) => instance.calendarId,
    };
  }
  if (source === 'status') {
    return { palette: palettes.status, slugOf: statusSlug, valueOf: (i) => i.status };
  }
  return { palette: palettes.priority, slugOf: prioritySlug, valueOf: (i) => i.priority };
}

/**
 * One rule (fill) or two (fill body + progress) per present, safe palette value,
 * deduped. Extracted from {@link buildTreatmentStyle} so that function stays a thin
 * dispatch + assembly shell (keeps its branch count low).
 */
function buildValueRules(
  mode: BarColorMode,
  palette: ReadonlyArray<{ value: string; color: string }>,
  present: ReadonlySet<string>,
  slugOf: (value: string) => string,
): string[] {
  const emitted = new Set<string>();
  const rules: string[] = [];
  for (const { value, color } of palette) {
    if (!present.has(value) || emitted.has(value) || !isSafeColor(color)) continue;
    emitted.add(value);
    const sel = `${BAR_SELECTOR}.${slugOf(value)}`;
    if (mode === 'strip') {
      rules.push(`${sel}${stripRule(color)}`);
    } else {
      // Fill mode: the bar body IS the accent, so progress is a contrasting shift of it.
      rules.push(fillBodyRule(sel, color), progressFillRule(sel, progressColor(color)));
    }
  }
  return rules;
}

/**
 * A saturated FILL body rule for `selector`: the accent background plus the legible
 * white-with-shadow label treatment. `!important` so it wins over the date-status
 * flag's own `!important` background (coexistence).
 */
function fillBodyRule(selector: string, color: string): string {
  // --og-ghost-fill: the bar's own background is forced transparent when it
  // renders as ghost pieces (wx-split), so the pieces re-read the treatment
  // colour through this inherited property — a stretched bar keeps its
  // status/priority/theme fill instead of reverting to the default colour.
  return `${selector} { background-color: ${color} !important; --og-ghost-fill: ${color}; color: ${FILL_TEXT_COLOR} !important; text-shadow: ${FILL_TEXT_SHADOW}; }`;
}

/**
 * The `::before` left-strip declaration block for a given accent color. Offset
 * -1px on the left/top/bottom so it overlays the bar's 1px border (otherwise the
 * border shows to the strip's left); its left corners inherit the bar's radius so
 * it conforms to the rounded outer corner rather than letting the bar peek past.
 *
 * `z-index: 1` keeps the strip painted ABOVE SVAR's `.wx-progress-wrapper` (a real
 * child at `z-index: auto`, which as a later sibling would otherwise paint over the
 * `::before` and hide the strip as progress grows), while staying below `.wx-content`
 * (`z-index: 2`) so the icon/text remain on top.
 */
function stripRule(color: string): string {
  return (
    `::before { content: ""; position: absolute; left: -1px; top: -1px; bottom: -1px; z-index: 1; ` +
    `width: ${STRIP_WIDTH_PX}px; background-color: ${color}; ` +
    `border-top-left-radius: var(--wx-gantt-bar-border-radius, 4px); ` +
    `border-bottom-left-radius: var(--wx-gantt-bar-border-radius, 4px); }`
  );
}

/**
 * Widen `.wx-content`'s left inset in strip mode so the chip/text clears the strip.
 * `!important` because the component's scoped base rule (`.wx-content` padding) carries
 * Svelte's hash class and thus higher specificity than this injected stylesheet.
 */
function stripContentPadRule(): string {
  return `${BAR_SELECTOR} .wx-content { padding-left: ${STRIP_CONTENT_PADDING_PX}px !important; }`;
}

/**
 * Strip-mode bar body: a neutral surface with readable text and a visible outline.
 * `color` MUST be `!important` — SVAR's own `.wx-task:not(.wx-split)` rule is
 * svelte-scoped (higher specificity) and otherwise forces white text onto the
 * light body. The color-mix outline makes the bar visible even when theme surface
 * vars collapse onto the (transparent) chart's editor background — the "fill not
 * contrasting" case. The left border is covered by the strip's -1px overlay.
 */
function stripBodyRule(): string {
  return (
    `${BAR_SELECTOR} { background-color: ${STRIP_BODY_COLOR} !important; ` +
    `color: ${STRIP_TEXT_COLOR} !important; ` +
    `border: 1px solid ${STRIP_BORDER_COLOR} !important; }`
  );
}

/**
 * Override SVAR's fixed progress-fill (`.wx-progress-percent`) for a bar selector.
 * `!important` beats SVAR's svelte-scoped `.wx-task .wx-progress-percent`; a more
 * specific selector (`.wx-bar.<slug>` / `.wx-bar.og-parent`) beats the neutral base.
 */
function progressFillRule(selector: string, fillColor: string): string {
  return `${selector} .wx-progress-percent { background-color: ${fillColor} !important; }`;
}

/**
 * Role-based rules (parent vs child) for the `default`/`theme` sources. In `fill`
 * the child hue is the base `.wx-bar` fill and the parent hue overrides on
 * `.og-parent`; in `strip` the body stays neutral (see {@link stripBodyRule}), the
 * parent body gets a higher-contrast neutral, and the hues drive the `::before`
 * accent strip.
 */
function buildRoleStyle(mode: BarColorMode, parentColor: string, childColor: string): string {
  const parentSel = `${BAR_SELECTOR}.${PARENT_ROLE_CLASS}`;
  if (mode === 'strip') {
    return [
      stripBodyRule(),
      // Parent body is a higher-contrast neutral than the child body (hierarchy cue,
      // contrast-only). More specific than stripBodyRule() so it wins for parents.
      `${parentSel} { background-color: ${STRIP_PARENT_BODY_COLOR} !important; }`,
      `${BAR_SELECTOR}${stripRule(childColor)}`,
      `${parentSel}::before { background-color: ${parentColor}; }`,
      // Progress follows the shared NEUTRAL body, not the parent/child strip accents.
      progressFillRule(BAR_SELECTOR, NEUTRAL_PROGRESS_COLOR),
      stripContentPadRule(),
    ].join('\n');
  }
  return [
    fillBodyRule(BAR_SELECTOR, childColor),
    `${parentSel} { background-color: ${parentColor} !important; }`,
    progressFillRule(BAR_SELECTOR, progressColor(childColor)),
    progressFillRule(parentSel, progressColor(parentColor)),
  ].join('\n');
}

/**
 * The icon chip spec for a bar, or `null` when no chip renders (icon source is
 * `none`, or the bar's value is absent from the palette — matching TaskNotes,
 * which shows an indicator only when a config exists).
 *
 * `iconName` is present only when the value's config carries an icon; otherwise
 * the caller renders the no-icon shape for `kind` (status → ring/disc, priority
 * → dot). For a completed status the no-icon shape is a filled disc — see
 * {@link IconSpec.completed}.
 */
export function resolveIconSpec(
  iconSource: BarIconSource,
  instance: TreatmentInstance,
  palettes: Palettes,
): IconSpec | null {
  if (iconSource === 'none') return null;
  const value = iconSource === 'status' ? instance.status : instance.priority;
  if (!value) return null;
  const palette: ReadonlyArray<{ value: string; color: string; icon?: string; isCompleted?: boolean }> =
    iconSource === 'status' ? palettes.status : palettes.priority;
  const entry = palette.find((p) => p.value === value);
  if (!entry?.color) return null;
  // Guard the chip color the same as the CSS-rule paths. BarContent renders it
  // as `style="color: <color>"`; Svelte escapes the attribute (no HTML breakout)
  // but does NOT stop CSS-declaration injection via `;` inside the value, so an
  // unsafe/malformed palette color falls back to `currentColor` (the bar's text
  // color) rather than being interpolated verbatim.
  const color = isSafeColor(entry.color) ? entry.color : 'currentColor';
  // `completed` only exists on the status palette (StatusColor); priorities have
  // no completion concept, so this is always false for them.
  const completed = iconSource === 'status' && entry.isCompleted === true;
  return {
    kind: iconSource,
    color,
    ...(entry.icon ? { iconName: entry.icon } : {}),
    ...(completed ? { completed: true } : {}),
  };
}
