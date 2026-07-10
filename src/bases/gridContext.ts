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
