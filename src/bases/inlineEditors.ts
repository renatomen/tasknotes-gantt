/**
 * One-time registration of the plugin's custom SVAR inline grid editors.
 *
 * `registerInlineEditor` mutates the module-level editor registry inside
 * `@svar-ui/svelte-grid` — the same package instance the bundled
 * `@svar-ui/svelte-gantt` grid resolves its editors from (single hoisted copy,
 * bundled once), so a type registered here is what a column's
 * `editor: { type: OG_DATE_EDITOR_TYPE }` opens. Registration is idempotent
 * and invoked from `GanttContainer` so it precedes any editor open without
 * needing a plugin-lifecycle hook.
 *
 * @module bases/inlineEditors
 */

import { registerInlineEditor } from '@svar-ui/svelte-grid';
import DateCellEditor from './DateCellEditor.svelte';
import { OG_DATE_EDITOR_TYPE } from './cellEditCommit';

let registered = false;

/**
 * SVAR types inline editors against its own `TEditorConfig` (whose `config` is
 * the stock editors' options/cell/template shape); ours reads the custom
 * `{ locale }` config `svarEditorConfigFor('date', …)` attaches, so the
 * component is bridged with a cast rather than widening its props.
 */
type SvarInlineEditorComponent = Parameters<typeof registerInlineEditor>[1];

/** Register the custom inline editors once; safe to call per view mount. */
export function ensureInlineEditorsRegistered(): void {
  if (registered) return;
  registered = true;
  registerInlineEditor(OG_DATE_EDITOR_TYPE, DateCellEditor as unknown as SvarInlineEditorComponent);
}
