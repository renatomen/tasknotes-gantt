/**
 * TaskNotesInteractions — native TaskNotes interaction for Gantt bars.
 *
 * Encapsulates every TaskNotes-API and Obsidian-workspace call needed to make a
 * bar behave like a native TaskNotes task card, so the Svelte view stays
 * API-free (it invokes this through callback props, mirroring the `onMutate`
 * seam). The view never imports TaskNotes/Obsidian internals.
 *
 * Behaviour mirrors TaskNotes' own task-card handler (confirmed against
 * TaskNotes 4.11.0): `ctrl/meta` → open the note in a new tab; otherwise the
 * configured `singleClickAction`/`doubleClickAction` (`edit` | `openNote` |
 * `none`) decides. Right-click shows the native task context menu.
 *
 * Reads ride supported public APIs (`api.settings.snapshot()`,
 * `api.ui.taskMenu`, `api.tasks.get`); only opening the edit modal uses the
 * internal `plugin.openTaskEditModal`, guarded, with a fallback to opening the
 * note so it degrades rather than breaks (see plan KTD / origin decision).
 *
 * @module bases/taskNotesInteractions
 */

/* global MouseEvent */
import type { App } from 'obsidian';

/** TaskNotes plugin id used to resolve the plugin instance + api. */
const TASKNOTES_PLUGIN_ID = 'tasknotes';

/** The resolved intent of a bar activation. */
export type ClickIntent = 'openNote' | 'openNoteNewTab' | 'editModal' | 'none';

/** Which click bound the interaction (selects which settings action applies). */
export type ClickKind = 'single' | 'double';

/**
 * Resolve a TaskNotes click-action + modifier state to a concrete intent (pure).
 *
 * `ctrl`/`meta` always opens the note in a new tab, regardless of the configured
 * action (matches TaskNotes). Otherwise the action maps directly; an
 * unset/unknown action defaults to opening the note (the safe default), while an
 * explicit `none` is a no-op.
 */
export function resolveClickIntent(opts: {
  action: string | undefined;
  ctrlOrMeta: boolean;
}): ClickIntent {
  if (opts.ctrlOrMeta) {
    return 'openNoteNewTab';
  }
  switch (opts.action) {
    case 'edit':
      return 'editModal';
    case 'none':
      return 'none';
    case 'openNote':
      return 'openNote';
    default:
      return 'openNote';
  }
}

/** Minimal structural slice of the TaskNotes plugin instance + api we consume. */
interface TaskNotesPlugin {
  api?: {
    settings?: { snapshot?(): Record<string, unknown> | null | undefined };
    tasks?: { get(path: string): unknown };
    ui?: { taskMenu?: { show?(opts: { taskPath: string; event: MouseEvent }): void } };
  };
  /** Internal: opens the native edit modal for a TaskInfo. No public API. */
  openTaskEditModal?(task: unknown, onTaskUpdated?: () => void): unknown;
}

/** `app.plugins` is not in Obsidian's public typings; reach it narrowly. */
interface PluginsRegistry {
  getPlugin(id: string): TaskNotesPlugin | undefined | null;
}

/**
 * Performs native TaskNotes interactions for a Gantt bar's note path. Construct
 * with the Obsidian `app`; the TaskNotes plugin/api are resolved per call so a
 * later enable/disable is picked up.
 */
export class TaskNotesInteractions {
  constructor(private readonly app: App) {}

  /**
   * Handle a left/double-click activation of a bar: open the note (current or
   * new tab), open the native edit modal, or no-op, per TaskNotes settings and
   * modifier keys. Falls back to opening the note whenever the edit modal can't
   * be opened (TaskNotes absent, internal method missing, or it throws).
   */
  public async handleActivate(
    path: string,
    opts: { kind: ClickKind; ctrlOrMeta: boolean },
  ): Promise<void> {
    const api = this.resolvePlugin()?.api;
    const settings = this.safeSnapshot(api);
    const actionKey = opts.kind === 'double' ? 'doubleClickAction' : 'singleClickAction';
    const action = typeof settings?.[actionKey] === 'string'
      ? settings[actionKey]
      : undefined;

    const intent = resolveClickIntent({ action, ctrlOrMeta: opts.ctrlOrMeta });

    switch (intent) {
      case 'none':
        return;
      case 'openNote':
        await this.openNote(path, false);
        return;
      case 'openNoteNewTab':
        await this.openNote(path, true);
        return;
      case 'editModal':
        await this.openEditModalOrFallback(path);
        return;
    }
  }

  /**
   * Show the native TaskNotes task context menu for `path` at the event
   * position. Inert (no-op) when TaskNotes is unavailable.
   */
  public showContextMenu(path: string, event: MouseEvent): void {
    try {
      const show = this.resolvePlugin()?.api?.ui?.taskMenu?.show;
      if (typeof show === 'function') {
        show({ taskPath: path, event });
      }
    } catch {
      // Native menu unavailable — nothing to surface.
    }
  }

  /** Open the note at `path`, in a new tab when `newTab` is set. */
  private async openNote(path: string, newTab: boolean): Promise<void> {
    try {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file) {
        return;
      }
      // getLeaf('tab') opens a new tab; getLeaf(false) reuses the active leaf.
      const leaf = this.app.workspace.getLeaf(newTab ? 'tab' : false);
      // file is a TFile here; the abstract-file type is narrowed by Obsidian.
      await leaf.openFile(file as Parameters<typeof leaf.openFile>[0]);
    } catch {
      // Best-effort; opening a note must never crash the chart.
    }
  }

  /**
   * Open the native TaskNotes edit modal for `path` via the guarded internal
   * `plugin.openTaskEditModal(task)`. Falls back to opening the note when the
   * plugin/api/method is unavailable or throws.
   */
  private async openEditModalOrFallback(path: string): Promise<void> {
    const plugin = this.resolvePlugin();
    const get = plugin?.api?.tasks?.get;
    const open = plugin?.openTaskEditModal;
    if (plugin && typeof get === 'function' && typeof open === 'function') {
      try {
        const task = await get.call(plugin.api!.tasks, path);
        if (task) {
          open.call(plugin, task);
          return;
        }
      } catch {
        // fall through to open-note fallback
      }
    }
    await this.openNote(path, false);
  }

  /** Resolve the TaskNotes plugin instance, guarded. */
  private resolvePlugin(): TaskNotesPlugin | null {
    try {
      const plugins = (this.app as unknown as { plugins?: PluginsRegistry }).plugins;
      return plugins?.getPlugin(TASKNOTES_PLUGIN_ID) ?? null;
    } catch {
      return null;
    }
  }

  /** Read the settings snapshot, guarded. */
  private safeSnapshot(
    api: TaskNotesPlugin['api'],
  ): Record<string, unknown> | undefined {
    try {
      return api?.settings?.snapshot?.() ?? undefined;
    } catch {
      return undefined;
    }
  }
}
