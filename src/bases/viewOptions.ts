/**
 * Bases view-options builders for the Gantt and TaskList views.
 *
 * Extracted verbatim from the inline `options:` arrows in `register.ts` so the
 * option arrays can be unit-tested. These are pure functions with no arguments
 * (the old builders ignored their `_config` parameter) and zero behavior
 * change: same keys, types, labels, defaults, and `min` values.
 *
 * Note on control types: the official Bases options union (1.13+) has no
 * `number` or `boolean` control, so a numeric input is modeled as `slider` and
 * a boolean as `toggle`. These mappings are behavior-equivalent.
 *
 * @module bases/viewOptions
 */
import type { BasesAllOptions } from 'obsidian';
import { FIELD_MAPPING_KEYS } from './fieldMappingConfig';
import { DEFAULT_MAX_HEIGHT, GANTT_MIN_HEIGHT } from './ganttHeight';

/**
 * The shared field-mapping property options consumed by both the Gantt view
 * (spread into its option set) and the TaskList view (used directly).
 */
function sharedFieldMappingOptions(): BasesAllOptions[] {
  return [
    {
      type: 'property' as const,
      displayName: 'Task Name Property',
      key: FIELD_MAPPING_KEYS.text,
      default: '',
      placeholder: 'Select task name property (defaults to file name)',
    },
    {
      type: 'property' as const,
      displayName: 'Start Date Property',
      key: FIELD_MAPPING_KEYS.start,
      default: '',
      placeholder: 'Defaults to TaskNotes Scheduled; or pick a TaskNotes date field',
    },
    {
      type: 'property' as const,
      displayName: 'End Date Property',
      key: FIELD_MAPPING_KEYS.end,
      default: '',
      placeholder: 'Defaults to TaskNotes Due; or pick a TaskNotes date field',
    },
    {
      type: 'property' as const,
      displayName: 'Progress Property',
      key: FIELD_MAPPING_KEYS.progress,
      default: 'note.progress',
      placeholder: 'Select progress property (0-100)',
    },
    {
      type: 'property' as const,
      displayName: 'Parent Property',
      key: FIELD_MAPPING_KEYS.parent,
      default: '',
      placeholder: 'Select parent task property (optional)',
    },
    {
      type: 'property' as const,
      displayName: 'Status Property',
      key: FIELD_MAPPING_KEYS.status,
      default: '',
      placeholder: 'Select status property (colors bars by TaskNotes status)',
    },
  ];
}

/** The two allowed values of the "Expanded relationships" setting. */
export type ExpandedRelationships = 'inherit' | 'show-all';

/**
 * Companion-only relationship controls (Expanded relationships + Hide top-level
 * subtasks). Grouped together and rendered ONLY when TaskNotes is present —
 * expansion is companion-only, so in standalone mode these are omitted rather
 * than shown inert. Labels match TaskNotes' exact strings for cross-plugin
 * recognizability.
 */
function relationshipOptions(): BasesAllOptions[] {
  return [
    {
      type: 'dropdown',
      displayName: 'Expanded relationships',
      key: 'tngantt_expandedRelationships',
      default: 'inherit',
      // Record<string,string> — an array renders every choice as "[object Object]".
      options: {
        inherit: 'Inherit',
        'show-all': 'Show all',
      },
    },
    {
      type: 'toggle',
      displayName: 'Hide top-level subtasks',
      key: 'tngantt_hideTopLevelSubtasks',
      default: false,
    },
  ];
}

/**
 * The Gantt chart view's Bases view options: the shared field-mapping property
 * options followed by the Gantt-specific dropdowns, slider, and toggles.
 *
 * @param companionAvailable - whether TaskNotes is present. When false, the
 *   companion-only relationship controls are omitted (expansion has no effect in
 *   standalone mode, so the controls would be inert — hide them instead).
 */
export function ganttViewOptions(companionAvailable = true): BasesAllOptions[] {
  return [
    ...sharedFieldMappingOptions(),
    ...(companionAvailable ? relationshipOptions() : []),
    {
      type: 'dropdown',
      displayName: 'Default Scale',
      key: 'tngantt_defaultScale',
      default: 'day',
      options: {
        hour: 'Hours',
        day: 'Days',
        week: 'Weeks',
        month: 'Months',
      },
    },
    // R27: how dependency arrows render across duplicated multi-parent
    // instances. Persisted per-view via config.set/get; read in mountGantt.
    {
      type: 'dropdown',
      displayName: 'Dependency Arrows',
      key: 'tngantt_dependencyArrowMode',
      default: 'primary',
      options: {
        primary: 'Primary instance only',
        all: 'All instances',
      },
    },
    // Parent/ancestor date-cascade behavior when a child drag/resize would
    // change ancestor spans. Read per-view in getCascadeMode(); consumed by
    // the GanttContainer drag-persistence gate.
    {
      type: 'dropdown',
      displayName: 'Parent date updates',
      key: 'tngantt_parentDateCascade',
      default: 'ask',
      options: {
        ask: 'Ask before updating parent dates',
        auto: 'Update parent dates automatically',
        never: 'Never update parent dates',
      },
    },
    // Missing/partial-date handling (R6, R8, R9, R11). Read per-view in
    // buildDatePolicyConfig()/getShowDateIndicators(); consumed by the
    // controller's date policy + the view's bar-level indicators.
    // Number → slider (the official Bases options union has no 'number'
    // control; 'slider' is the closest numeric input). Behavior-equivalent.
    {
      type: 'slider',
      displayName: 'Default task duration (days)',
      key: 'tngantt_defaultDuration',
      default: 1,
      min: 1,
    },
    // Boolean → toggle (the official options union has no 'boolean' control).
    {
      type: 'toggle',
      displayName: 'Show tasks with no dates',
      key: 'tngantt_showUndatedTasks',
      default: true,
    },
    {
      type: 'toggle',
      displayName: 'Show tasks with only one date',
      key: 'tngantt_showPartialDateTasks',
      default: true,
    },
    {
      type: 'toggle',
      displayName: 'Show date-status indicators on bars',
      key: 'tngantt_showDateIndicators',
      default: true,
    },
    // Per-view toolbar visibility (plan 002 R2); default off. When on, the
    // GanttToolbar renders above the chart with the Auto/Light/Dark theme
    // switch. The theme MODE itself (tngantt_themeMode) is persisted via the
    // toolbar, not an options-panel entry — see register.getThemeMode().
    {
      type: 'toggle',
      displayName: 'Show toolbar',
      key: 'tngantt_showToolbar',
      default: false,
    },
    // Per-view max-height in px (plan 003 R1). The chart host fits its content
    // up to this cap, then scrolls internally. Number → slider (the official
    // options union has no 'number' control). Read in getMaxHeight(); a ~2-row
    // floor is enforced in the clamp, not here. `max`/`step` are REQUIRED for a
    // usable control: an Obsidian slider with no `max` falls back to an HTML
    // range max of 100, which is below our `min` floor (112) and renders the
    // slider disabled. min mirrors the ~2-row floor.
    {
      type: 'slider',
      displayName: 'Max height (px)',
      key: 'tngantt_maxHeight',
      default: DEFAULT_MAX_HEIGHT,
      min: GANTT_MIN_HEIGHT,
      max: 2000,
      step: 10,
    },
  ];
}

/**
 * Read the per-view "show toolbar" toggle (plan 002 R2), defaulting to off. Pure
 * (no Obsidian/DOM): the caller passes the Bases `config.get` so the reader
 * unit-tests in isolation; `register.getShowToolbar()` wraps it. Co-located with
 * the `tngantt_showToolbar` option definition above; mirrors `readThemeMode`.
 *
 * @param get - reads a per-view option value by key (the Bases `config.get`).
 */
export function readShowToolbar(get: (key: string) => unknown): boolean {
  return get('tngantt_showToolbar') === true;
}

/**
 * Read the per-view max-height in px (plan 003 R1), defaulting to
 * {@link DEFAULT_MAX_HEIGHT}. A non-positive, non-finite, or non-numeric stored
 * value falls back to the default. Pure (no Obsidian/DOM): the caller passes the
 * Bases `config.get` so the reader unit-tests in isolation;
 * `register.getMaxHeight()` wraps it. Co-located with the `tngantt_maxHeight`
 * option definition above; mirrors {@link readShowToolbar}.
 *
 * @param get - reads a per-view option value by key (the Bases `config.get`).
 */
export function readMaxHeight(get: (key: string) => unknown): number {
  const raw = Number(get('tngantt_maxHeight'));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_HEIGHT;
}

/**
 * Read the per-view "Expanded relationships" mode, defaulting to `inherit`.
 * Normalizes TaskNotes' value vocabulary: `show-all` (any case, with surrounding
 * quotes or space/underscore separators) and the numeric/boolean truthy encodings
 * (`1`, `true`) map to `show-all`; everything else — including `inherit`, `0`, and
 * junk — maps to `inherit`. Pure (no Obsidian/DOM): the caller passes the Bases
 * `config.get`. Mirrors {@link readShowToolbar}.
 *
 * @param get - reads a per-view option value by key (the Bases `config.get`).
 */
export function readExpandedRelationships(get: (key: string) => unknown): ExpandedRelationships {
  const raw = get('tngantt_expandedRelationships');
  if (raw === 1 || raw === '1' || raw === true) return 'show-all';
  if (typeof raw === 'string') {
    const norm = raw
      .trim()
      .toLowerCase()
      .replace(/^["']|["']$/g, '')
      .replace(/[\s_]+/g, '-');
    if (norm === 'show-all') return 'show-all';
  }
  return 'inherit';
}

/**
 * Read the per-view "Hide top-level subtasks" toggle, defaulting to off. True
 * only for an explicit boolean `true` (mirrors {@link readShowToolbar} and
 * TaskNotes' own `=== true` read). Pure (no Obsidian/DOM).
 *
 * @param get - reads a per-view option value by key (the Bases `config.get`).
 */
export function readHideTopLevelSubtasks(get: (key: string) => unknown): boolean {
  return get('tngantt_hideTopLevelSubtasks') === true;
}

/**
 * The TaskList view's Bases view options: the shared field-mapping property
 * options only.
 */
export function taskListViewOptions(): BasesAllOptions[] {
  return sharedFieldMappingOptions();
}
