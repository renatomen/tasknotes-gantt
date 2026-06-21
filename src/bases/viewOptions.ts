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

/**
 * The Gantt chart view's Bases view options: the shared field-mapping property
 * options followed by the Gantt-specific dropdowns, slider, and toggles.
 */
export function ganttViewOptions(): BasesAllOptions[] {
  return [
    ...sharedFieldMappingOptions(),
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
  ];
}

/**
 * The TaskList view's Bases view options: the shared field-mapping property
 * options only.
 */
export function taskListViewOptions(): BasesAllOptions[] {
  return sharedFieldMappingOptions();
}
