/**
 * Bases view-options builders for the Gantt view.
 *
 * Originally extracted verbatim from the inline `options:` arrows in
 * `register.ts` so the option arrays can be unit-tested. The Gantt options are
 * now organized into five collapsible `BasesOptionGroup` sections (Fields,
 * Progress, Relationships, Timeline, Appearance) rather than a flat list;
 * config keys, defaults, and `min` values are unchanged (the opacity slider's
 * label was renamed — see `relationshipOptions` — but its key was not).
 *
 * Note on control types: the official Bases options union (1.13+) has no
 * `number` or `boolean` control, so a numeric input is modeled as `slider` and
 * a boolean as `toggle`. These mappings are behavior-equivalent.
 *
 * @module bases/viewOptions
 */
import type { BasesAllOptions, BasesOptions, BasesOptionGroup } from 'obsidian';
import { FIELD_MAPPING_KEYS } from './fieldMappingConfig';
import { DEFAULT_MAX_HEIGHT, GANTT_MIN_HEIGHT } from './ganttHeight';
import type { BarChannelSource, BarIconSource } from './barTreatment';
import type { FieldMappings, ProgressMode, TimeEstimateMode } from './types/field-mapping';

/**
 * The field-mapping property options. The Gantt view splits these across its
 * Fields group (six mappings) and Progress group (Progress Property). Kept as a
 * flat leaf array so the view composes its own grouping.
 */
function sharedFieldMappingOptions(): BasesOptions[] {
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
      default: '',
      placeholder: 'Select a progress property (0-100); optional',
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
    {
      type: 'property' as const,
      displayName: 'Priority Property',
      key: FIELD_MAPPING_KEYS.priority,
      default: '',
      placeholder: 'Select priority property (colors bars by TaskNotes priority)',
    },
    {
      type: 'property' as const,
      displayName: 'Calendar Property',
      key: FIELD_MAPPING_KEYS.calendar,
      default: '',
      placeholder: 'Wikilink to a calendar or calendar-set note (optional)',
    },
  ];
}

/** The two allowed values of the "Expanded relationships" setting. */
export type ExpandedRelationships = 'inherit' | 'show-all';

// `ProgressMode` / `TimeEstimateMode` are defined in the leaf types module
// (`./types/field-mapping`) to avoid an import cycle; imported above and
// re-exported here so existing `viewOptions` consumers keep importing them from
// the same place.
export type { ProgressMode, TimeEstimateMode };

/**
 * Default opacity (fraction 0–1) for Show-all *expanded items* (U6) —
 * out-of-filter descendants pulled in for context. ("Context bars" is the
 * internal/legacy name for the same concept; the UI label is "Expanded items
 * opacity (%)".) Used as the slider's default (as a percentage) and as the
 * fallback in {@link readContextOpacity} and the view. Expanded items are
 * companion-only, so the slider lives in {@link relationshipOptions}.
 */
export const DEFAULT_CONTEXT_OPACITY = 0.55;

/** Minimum expanded-items opacity (fraction) — keep them faintly visible. */
const MIN_CONTEXT_OPACITY = 0.1;

/**
 * The Relationships-section controls (Expanded relationships + Expanded items
 * opacity + Hide top-level subtasks). Companion-only: rendered ONLY when
 * TaskNotes is present — expansion has no effect in standalone mode, so these
 * are omitted rather than shown inert. Order is deliberate: the opacity slider
 * sits directly after "Expanded relationships" because it tunes the expanded
 * (out-of-filter context) items. Labels match TaskNotes' exact strings for
 * cross-plugin recognizability.
 */
function relationshipOptions(): BasesOptions[] {
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
    // U6 cue tuning: how prominent Show-all *expanded* items (out-of-filter
    // descendants pulled in for context) are. Stored as a percentage; read as a
    // 0–1 fraction in readContextOpacity() and applied as a CSS custom property.
    // Number → slider (the official options union has no 'number' control).
    // `max`/`step` are required for a usable Obsidian slider (see the max-height
    // note below). Key stays `tngantt_contextOpacity` (label-only rename) so
    // existing views keep their saved value.
    {
      type: 'slider',
      displayName: 'Expanded items opacity (%)',
      key: 'tngantt_contextOpacity',
      default: Math.round(DEFAULT_CONTEXT_OPACITY * 100),
      min: Math.round(MIN_CONTEXT_OPACITY * 100),
      max: 100,
      step: 5,
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
 * Wrap leaf options in a collapsible Bases option group. Groups hold leaf
 * controls only (one level of nesting — no sub-sections), so `items` is typed
 * `BasesOptions[]`, not `BasesAllOptions[]`.
 */
function group(displayName: string, items: BasesOptions[]): BasesOptionGroup<BasesOptions> {
  return { type: 'group', displayName, items };
}

/**
 * The Progress-mode dropdown (companion-only). `tasknotes` mirrors TaskNotes'
 * computed checklist progress (read-only); `property` reads/persists the
 * Progress Property. The default MATCHES {@link readProgressMode}'s unset
 * resolution (property when a property is mapped, else tasknotes) so the shown
 * mode == the applied mode, and an explicit selection differs from the default
 * and therefore persists. Record<string,string> value→label map.
 */
function progressModeOption(hasProgressProperty: boolean): BasesOptions {
  return {
    type: 'dropdown',
    displayName: 'Progress mode',
    key: 'tngantt_progressMode',
    default: hasProgressProperty ? 'property' : 'tasknotes',
    options: { tasknotes: 'TaskNotes Progress', property: 'Property' },
  };
}

/**
 * The Time-Estimate write-mode dropdown (companion-only). `dont-update` (the
 * default) never writes the estimate on a resize; `tasknotes` writes it through
 * TaskNotes' own `timeEstimate` field; `property` writes it to the mapped "Time
 * Estimate" property. Reading the estimate to drive date inference is always on,
 * regardless of this mode (R5/R6). Companion-only because a write never fires
 * standalone, so a mode control there would be inert. Record<string,string> map.
 */
function timeEstimateModeOption(): BasesOptions {
  return {
    type: 'dropdown',
    displayName: 'Time Estimate Update',
    key: 'tngantt_timeEstimateMode',
    default: 'dont-update',
    options: { 'dont-update': "Don't update", tasknotes: 'TaskNotes field', property: 'Property' },
  };
}

/**
 * The "Time Estimate" property picker. Sits in the Fields group beside the other
 * property mappings. Always shown: the estimate (minutes) drives date inference
 * where a date is missing and is the write target in Property mode; standalone
 * mode reads it for inference too. When empty in TaskNotes-field mode it resolves
 * to TaskNotes' configured timeEstimate property (R2/R6).
 */
function timeEstimatePropertyOption(): BasesOptions {
  return {
    type: 'property' as const,
    displayName: 'Time Estimate Property',
    key: FIELD_MAPPING_KEYS.timeEstimate,
    default: '',
    placeholder: 'Minutes; drives bar length when a date is missing. Empty = TaskNotes field',
  };
}

/**
 * The per-task "Estimate meaning" override property picker. Sits in the Fields
 * group beside the other mappings. Points at a task property whose value
 * (`working-days` / `calendar-days`) overrides the view's Estimate meaning for
 * that task; empty = the task follows the view default.
 */
function estimateMeaningPropertyOption(): BasesOptions {
  return {
    type: 'property' as const,
    displayName: 'Estimate meaning override',
    key: FIELD_MAPPING_KEYS.estimateMeaning,
    default: '',
    placeholder: 'Per-task working-days / calendar-days. Empty = follow the view',
  };
}

/**
 * Timeline-section controls: scale, task duration, dependency arrows, parent
 * date cascade, and the two task-visibility toggles (folded in from the former
 * standalone "Task visibility" group).
 */
function timelineOptions(): BasesOptions[] {
  return [
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
    // Weekend day-column shading. Default on — shading is the conventional
    // reading of a gantt timeline; the toggle exists to opt out. Weekend days
    // derive from the user's locale (see controller/availability). Sits in
    // Timeline beside Default Scale: shading only renders at day/hour scales.
    {
      type: 'toggle',
      displayName: 'Highlight weekends',
      key: 'tngantt_highlightWeekends',
      default: true,
    },
    // Estimate meaning: does a time-estimate count working days (a derived
    // endpoint skips the task's non-working days) or calendar days (flat)? Affects
    // only derived edges; per-view default, overridable per task (Fields group).
    {
      type: 'dropdown',
      displayName: 'Estimate meaning',
      key: 'tngantt_estimateMeaning',
      default: 'calendar-days',
      options: {
        'working-days': 'Working days (skip non-working)',
        'calendar-days': 'Calendar days',
      },
    },
    // Non-working-day rendering: shade blocked days in the background, or draw
    // them as split segments inside any dated bar. Per-view.
    {
      type: 'dropdown',
      displayName: 'Non-working-day rendering',
      key: 'tngantt_nonWorkingRendering',
      default: 'shaded',
      options: {
        shaded: 'Shaded background',
        split: 'Split segments',
      },
    },
    // Number → slider (the official Bases options union has no 'number' control;
    // 'slider' is the closest numeric input). Behavior-equivalent.
    {
      type: 'slider',
      displayName: 'Default task duration (days)',
      key: 'tngantt_defaultDuration',
      default: 1,
      min: 1,
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
    // Inferred-edge drag behaviour: when a resize moves an edge whose date is
    // inferred from the time-estimate, whether to grow just the estimate, grow
    // the estimate and stamp a real date, or ask each time. Read per-view in
    // getInferredDragMode(); consumed by the GanttContainer drag-persistence gate.
    {
      type: 'dropdown',
      displayName: 'Inferred date drag',
      key: 'tngantt_inferredDrag',
      default: 'ask',
      options: {
        ask: 'Ask: grow estimate or write dates',
        'estimate-only': 'Grow the estimate only',
        'estimate-and-dates': 'Grow the estimate and write dates',
      },
    },
    // Missing/partial-date handling (R6, R8, R9, R11). Read per-view in
    // buildDatePolicyConfig(). Boolean → toggle (no 'boolean' control).
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
  ];
}

/**
 * Appearance-section controls: the bar fill/strip channel sources, task icon,
 * date-status indicators, and the layout controls (toolbar visibility + min/max
 * height, folded in from the former standalone "Layout" group).
 */
function appearanceOptions(): BasesOptions[] {
  return [
    // Bar treatment channels (per-view). Fill and Strip are independent sources:
    // Fill paints the bar body, Strip the left accent — set either to None to draw
    // nothing (both None falls back to the default role treatment). Read in
    // getBarFillSource/getBarStripSource/getBarIcon and consumed by the view's
    // barTreatment resolver + generated stylesheet + icon chip. By status/priority
    // need the TaskNotes companion palette; By calendar is companion-independent;
    // all degrade to Default when their palette is empty. Record<string,string> maps.
    {
      type: 'dropdown',
      displayName: 'Bar fill',
      key: 'tngantt_barFillSource',
      default: 'default',
      options: {
        none: 'None',
        default: 'Default',
        status: 'By status',
        priority: 'By priority',
        calendar: 'By calendar',
        theme: 'Obsidian theme',
      },
    },
    {
      type: 'dropdown',
      displayName: 'Bar strip',
      key: 'tngantt_barStripSource',
      default: 'none',
      options: {
        none: 'None',
        default: 'Default',
        status: 'By status',
        priority: 'By priority',
        calendar: 'By calendar',
        theme: 'Obsidian theme',
      },
    },
    {
      type: 'dropdown',
      displayName: 'Task icon',
      key: 'tngantt_barIcon',
      default: 'none',
      options: { none: 'None', status: 'Status', priority: 'Priority' },
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
    // Per-view min-height in px. The chart host never shrinks below this, so a
    // chart reduced to a single (e.g. collapsed) root stays a usable size rather
    // than a sliver. Read in getMinHeight(); clamped to the absolute ~2-row floor
    // (GANTT_MIN_HEIGHT) so it can be raised but not set below what keeps one row
    // visible. Number → slider; `max`/`step` required (see Max height note below).
    {
      type: 'slider',
      displayName: 'Min height (px)',
      key: 'tngantt_minHeight',
      default: GANTT_MIN_HEIGHT,
      min: GANTT_MIN_HEIGHT,
      max: 2000,
      step: 10,
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
    // Grid/timeline divider width in px. Modeled as `text` (not `slider`): SVAR
    // enforces no divider bounds, so a slider would bake in an arbitrary max, and
    // precise numeric entry beats a coarse slider for a value the user also sets
    // by dragging the divider. Empty default → the placeholder shows and the
    // effective width falls back to the first (name) column's width. Coercion,
    // the plugin-minimum clamp, and the fallback all live in the read path
    // (resolveInitialGridWidth); the drag path writes a number to the same key.
    {
      type: 'text',
      displayName: 'Table width (px)',
      key: 'tngantt_tableWidth',
      default: '',
      placeholder: 'Auto (first column width) — or a pixel width',
    },
  ];
}

/**
 * The Gantt chart view's Bases view options, organized into five collapsible
 * sections (native `BasesOptionGroup` containers): Fields, Progress,
 * Relationships, Timeline, Appearance.
 *
 * Progress Property is always shown (standalone Gantt still maps it to drive
 * progress bars); it moves out of Fields into the Progress section so it sits
 * beside Progress mode. Progress mode and the whole Relationships section are
 * companion-only — built only when TaskNotes is present, mirroring the prior
 * conditional-omission behavior (a standalone user sees no inert companion
 * controls). Groups declare no expand state — Bases owns that.
 *
 * @param companionAvailable - whether TaskNotes is present. When false, the
 *   Relationships section and the Progress-mode control are omitted.
 * @param hasProgressProperty - whether a Progress Property is configured. Drives
 *   the Progress-mode dropdown's SHOWN default so it matches what
 *   {@link readProgressMode} resolves for an unset mode: `property` when a
 *   property is mapped (don't silently switch an existing view to computed),
 *   else `tasknotes`.
 */
export function ganttViewOptions(
  companionAvailable = true,
  hasProgressProperty = false,
): BasesAllOptions[] {
  const mappings = sharedFieldMappingOptions();
  const fieldsItems = mappings.filter((o) => o.key !== FIELD_MAPPING_KEYS.progress);
  const progressPropertyOption = mappings.find((o) => o.key === FIELD_MAPPING_KEYS.progress);

  // Time Estimate mapping sits in Fields beside the other property pickers. The
  // property is always shown; the "Time Estimate Update" write mode is
  // companion-only (a write never fires standalone, so the control would be inert).
  fieldsItems.push(timeEstimatePropertyOption(), estimateMeaningPropertyOption());
  if (companionAvailable) {
    fieldsItems.push(timeEstimateModeOption());
  }

  // Progress Property is always shown; Progress mode is companion-only.
  const progressItems: BasesOptions[] = progressPropertyOption ? [progressPropertyOption] : [];
  if (companionAvailable) {
    progressItems.push(progressModeOption(hasProgressProperty));
  }

  const groups: BasesAllOptions[] = [
    group('Fields', fieldsItems),
    group('Progress', progressItems),
  ];
  if (companionAvailable) {
    groups.push(group('Relationships', relationshipOptions()));
  }
  groups.push(group('Timeline', timelineOptions()), group('Appearance', appearanceOptions()));
  return groups;
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
 * Read the per-view "Highlight weekends" toggle, defaulting to on. Off only for
 * an explicit boolean `false` (the `!== false` contract `showDateIndicators`
 * uses). Pure (no Obsidian/DOM); mirrors {@link readShowToolbar}.
 *
 * @param get - reads a per-view option value by key (the Bases `config.get`).
 */
export function readHighlightWeekends(get: (key: string) => unknown): boolean {
  return get('tngantt_highlightWeekends') !== false;
}

/** Per-view interpretation of a time-estimate (affects only derived edges). */
export type EstimateMeaning = 'working-days' | 'calendar-days';

/** Per-view rendering of non-working days on bars. */
export type NonWorkingRendering = 'shaded' | 'split';

/**
 * Read the per-view Estimate meaning; unrecognized/absent → `calendar-days`
 * (today's flat behaviour). Pure; mirrors {@link readHighlightWeekends}.
 */
export function readEstimateMeaning(get: (key: string) => unknown): EstimateMeaning {
  return get('tngantt_estimateMeaning') === 'working-days' ? 'working-days' : 'calendar-days';
}

/**
 * Read the per-view Non-working-day rendering; unrecognized/absent → `shaded`.
 * Pure; mirrors {@link readEstimateMeaning}.
 */
export function readNonWorkingRendering(get: (key: string) => unknown): NonWorkingRendering {
  return get('tngantt_nonWorkingRendering') === 'split' ? 'split' : 'shaded';
}

/**
 * Resolve a task's effective Estimate meaning: a valid per-task override value
 * (`working-days` / `calendar-days`) wins; anything else falls back to the view
 * default. Pure; the register-side per-task read supplies `taskValue`.
 */
export function resolveEstimateMeaning(
  viewDefault: EstimateMeaning,
  taskValue: unknown,
): EstimateMeaning {
  return taskValue === 'working-days' || taskValue === 'calendar-days' ? taskValue : viewDefault;
}

/**
 * Read the raw per-view calendar display selection. Parsing/validation lives
 * in `calendarSelection.ts` (`readDisplaySelection`); this reader only pins
 * the prefixed key. Pure; mirrors {@link readHighlightWeekends}.
 */
export function readDisplayCalendars(get: (key: string) => unknown): unknown {
  return get('tngantt_displayCalendars');
}

/**
 * Coerce a raw stored channel-source value to the six-value {@link BarChannelSource}
 * union, or `null` when it is absent/unknown so the caller can fall back to the
 * per-channel default.
 */
function coerceChannelSource(raw: unknown): BarChannelSource | null {
  return raw === 'none' ||
    raw === 'default' ||
    raw === 'status' ||
    raw === 'priority' ||
    raw === 'theme' ||
    raw === 'calendar'
    ? raw
    : null;
}

/**
 * Read the per-view Bar fill channel source from `tngantt_barFillSource`,
 * defaulting to `default` when the key is absent or holds an unknown value. Pure
 * (no Obsidian/DOM).
 *
 * @param get - reads a per-view option value by key (the Bases `config.get`).
 */
export function readBarFillSource(get: (key: string) => unknown): BarChannelSource {
  return coerceChannelSource(get('tngantt_barFillSource')) ?? 'default';
}

/**
 * Read the per-view Bar strip channel source from `tngantt_barStripSource`,
 * defaulting to `none` when the key is absent or holds an unknown value. Pure
 * (no Obsidian/DOM); mirrors {@link readBarFillSource}.
 *
 * @param get - reads a per-view option value by key (the Bases `config.get`).
 */
export function readBarStripSource(get: (key: string) => unknown): BarChannelSource {
  return coerceChannelSource(get('tngantt_barStripSource')) ?? 'none';
}

/**
 * Read the per-view task-icon source (U5), defaulting to `none`. Recognizes
 * `status`/`priority`; everything else maps to `none`. Pure (no Obsidian/DOM).
 *
 * @param get - reads a per-view option value by key (the Bases `config.get`).
 */
export function readBarIcon(get: (key: string) => unknown): BarIconSource {
  const raw = get('tngantt_barIcon');
  return raw === 'status' || raw === 'priority' ? raw : 'none';
}

/**
 * Read the per-view Progress mode (R1–R3). An explicit `property` always wins; an
 * explicit `tasknotes` wins only when the companion source is available
 * (standalone has no computed source, so it coalesces to `property`).
 *
 * When unset or junk, the default preserves existing views: `property` when a
 * Progress Property is already configured (or when standalone, where the
 * TaskNotes option isn't offered), otherwise `tasknotes` for a fresh companion
 * view. {@link ganttViewOptions} aligns the dropdown's SHOWN default to this same
 * rule, so the mode the user sees always equals the mode applied — and an
 * explicit selection differs from the shown default and therefore persists
 * (Bases doesn't store an option left at its default). In `tasknotes` mode the
 * Progress Property is ignored. Pure (no Obsidian/DOM); mirrors {@link readBarFillSource}.
 *
 * @param get - reads a per-view option value by key (the Bases `config.get`).
 * @param ctx - `companionAvailable` (TaskNotes present) gates the TaskNotes
 *   source (R3); `hasProgressProperty` (a Progress Property is mapped) drives the
 *   unset default so an existing property view isn't silently switched to computed.
 */
export function readProgressMode(
  get: (key: string) => unknown,
  ctx: { companionAvailable: boolean; hasProgressProperty: boolean },
): ProgressMode {
  const raw = get('tngantt_progressMode');
  if (raw === 'property') return 'property';
  if (raw === 'tasknotes' && ctx.companionAvailable) return 'tasknotes';
  // Unset/junk (or `tasknotes` in standalone): preserve existing behavior — a
  // configured property (or standalone) → `property`; a fresh companion view → `tasknotes`.
  if (!ctx.companionAvailable || ctx.hasProgressProperty) return 'property';
  return 'tasknotes';
}

/**
 * Read the per-view Time Estimate write mode (R1–R3), defaulting to
 * `dont-update`. An explicit `property` always wins; an explicit `tasknotes`
 * wins only when the companion is available (the TaskNotes-field write target is
 * unreachable standalone, so it coalesces to `dont-update`). Unset or junk →
 * `dont-update` (the R1 default). The mode gates only writes — reading the
 * estimate for inference is independent of it (R5/R6). Pure (no Obsidian/DOM);
 * mirrors {@link readProgressMode}.
 *
 * @param get - reads a per-view option value by key (the Bases `config.get`).
 * @param ctx - `companionAvailable` (TaskNotes present) gates the TaskNotes-field
 *   write mode (R3).
 */
export function readTimeEstimateMode(
  get: (key: string) => unknown,
  ctx: { companionAvailable: boolean },
): TimeEstimateMode {
  const raw = get('tngantt_timeEstimateMode');
  if (raw === 'property') return 'property';
  if (raw === 'tasknotes' && ctx.companionAvailable) return 'tasknotes';
  return 'dont-update';
}

/**
 * Whether the bar's progress handle is read-only/hidden (U5/R7). The handle is
 * editable ONLY in Property mode with a mapped Progress Property — the sole
 * configuration with a resolved write target. It's read-only in TaskNotes mode
 * (computed) and in Property mode with no mapped property, where a drag would
 * silently no-op (nowhere to persist). Pure; the view wraps it via
 * `register.getProgressReadonly()`.
 */
export function isProgressReadonly(mappings: FieldMappings): boolean {
  return mappings.progressMode !== 'property' || (mappings.progressProperty ?? '').trim() === '';
}

/**
 * Whether a resize should write the Time Estimate back (U6/R13–R15). True in
 * `tasknotes` mode (which `readTimeEstimateMode` only returns with the companion
 * present) and in `property` mode with a mapped "Time Estimate" property. False
 * in `dont-update` (the default) and in `property` mode with no property (nowhere
 * to write). Standalone read-only is enforced separately by the source/container,
 * so this stays a pure mode+property predicate. Pure; mirrors
 * {@link isProgressReadonly}.
 */
export function isTimeEstimateWriteEnabled(mappings: FieldMappings): boolean {
  const mode = mappings.timeEstimateMode ?? 'dont-update';
  if (mode === 'tasknotes') return true;
  if (mode === 'property') return (mappings.timeEstimateProperty ?? '').trim() !== '';
  return false;
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
 * Read the per-view min-height in px, defaulting to {@link GANTT_MIN_HEIGHT}. A
 * finite value is clamped UP to {@link GANTT_MIN_HEIGHT} (the absolute ~2-row
 * floor — the chart must never go below what keeps a single row visible); a
 * non-finite/junk value falls back to the default. Pure (no Obsidian/DOM);
 * mirrors {@link readMaxHeight}. `register.getMinHeight()` wraps it.
 *
 * @param get - reads a per-view option value by key (the Bases `config.get`).
 */
export function readMinHeight(get: (key: string) => unknown): number {
  const raw = Number(get('tngantt_minHeight'));
  return Number.isFinite(raw) ? Math.max(GANTT_MIN_HEIGHT, raw) : GANTT_MIN_HEIGHT;
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
 * Read the per-view Show-all expanded-items opacity (U6) as a 0–1 fraction. The
 * slider stores a percentage; this converts and clamps to
 * `[MIN_CONTEXT_OPACITY, 1]` so expanded items never fully vanish or exceed 1. A
 * non-numeric/non-finite stored value falls back to {@link DEFAULT_CONTEXT_OPACITY}.
 * Pure (no Obsidian/DOM); mirrors {@link readMaxHeight}.
 *
 * @param get - reads a per-view option value by key (the Bases `config.get`).
 */
export function readContextOpacity(get: (key: string) => unknown): number {
  const raw = get('tngantt_contextOpacity');
  // Unset/blank reads as the default — distinct from a real 0, which `Number()`
  // would also coerce from null/'' and then clamp (hiding the "unset" intent).
  if (raw === null || raw === undefined || raw === '') return DEFAULT_CONTEXT_OPACITY;
  const pct = Number(raw);
  if (!Number.isFinite(pct)) return DEFAULT_CONTEXT_OPACITY;
  return Math.min(1, Math.max(MIN_CONTEXT_OPACITY, pct / 100));
}

