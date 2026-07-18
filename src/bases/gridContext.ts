/**
 * Svelte context key for handing the Obsidian `App` down to SVAR-mounted grid
 * cells. SVAR instantiates each `PropertyCell` with only `{ api, row, column,
 * onaction }`, so the cell cannot receive `app` as a prop. `GanttContainer` sets
 * this context at init (it holds `app` as a prop); a cell reads it to call
 * `MarkdownRenderer`. A cell that renders text-only never needs it.
 *
 * @module bases/gridContext
 */

import type { App } from 'obsidian';

/** Context key under which `GanttContainer` provides the Obsidian `App`. */
export const GRID_APP_CONTEXT_KEY = 'og-gantt-app';

/** The value stored under {@link GRID_APP_CONTEXT_KEY}. */
export type GridAppContext = App;

/**
 * Context key under which `GanttContainer` provides the assembly pass's
 * display-locale snapshot (`GanttData.dateLocale`) to grid cells, for the same
 * SVAR-can't-pass-props reason as the App context. A `string` locale tag.
 */
export const GRID_DATE_LOCALE_CONTEXT_KEY = 'og-gantt-date-locale';

/**
 * Context key under which `GanttContainer` provides the LIVE set of grid column
 * ids carrying an inline editor, as a getter (`() => ReadonlySet<string>`) so a
 * cell's `$derived` re-runs when editability changes. A `PropertyCell` combines
 * it with its row's `custom.editable` to show the editable-cell cue.
 */
export const GRID_EDITABLE_COLUMNS_CONTEXT_KEY = 'og-gantt-editable-columns';

/** The value stored under {@link GRID_EDITABLE_COLUMNS_CONTEXT_KEY}. */
export type GridEditableColumnsContext = () => ReadonlySet<string>;
