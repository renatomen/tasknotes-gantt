/**
 * TaskNotes-managed note paths for per-row grid editability.
 *
 * A row is inline-editable only when TaskNotes manages its source note —
 * the same `api.tasks.get(path)` truth the write path's row gate enforces
 * (`TaskNotesSource.mutate` refuses a fieldWrite when no task info resolves).
 * Resolving it here, at GanttData assembly time, lets every rendered row carry
 * the flag so the view never offers an editor the write would refuse.
 *
 * Mirrors the guarded view-layer API access of {@link ./taskNotesFieldTypes}:
 * `tasks.get` is a TaskNotes-internal cache read (no Bases entry access, so no
 * re-notify poke — the #161 constraint), and any absence/drift/failure degrades
 * to an empty set (nothing editable).
 *
 * @module bases/taskNotesManagedPaths
 */

import type { App } from 'obsidian';

interface TaskNotesTasksLike {
  get?(path: string): Promise<unknown> | unknown;
}
interface TaskNotesApiLike {
  tasks?: TaskNotesTasksLike;
}
interface PluginsRegistryLike {
  getPlugin(id: string): { api?: TaskNotesApiLike } | null | undefined;
}

/** TaskNotes plugin id (matches the datasource resolution). */
const TASKNOTES_PLUGIN_ID = 'tasknotes';

/**
 * Resolve which of `paths` are TaskNotes-managed tasks: the subset where
 * `api.tasks.get(path)` yields task info. Each unique path is queried once;
 * a failed lookup counts as not managed. Empty when TaskNotes is unavailable.
 */
export async function resolveManagedTaskPaths(
  app: App,
  paths: Iterable<string>,
): Promise<ReadonlySet<string>> {
  const managed = new Set<string>();
  try {
    const plugins = (app as unknown as { plugins?: PluginsRegistryLike }).plugins;
    const tasks = plugins?.getPlugin(TASKNOTES_PLUGIN_ID)?.api?.tasks;
    if (!tasks || typeof tasks.get !== 'function') {
      return managed;
    }
    const unique = [...new Set(paths)];
    const infos = await Promise.all(
      unique.map(async (path) => {
        try {
          return await tasks.get!(path);
        } catch {
          return null;
        }
      }),
    );
    for (let i = 0; i < unique.length; i += 1) {
      if (infos[i]) {
        managed.add(unique[i]!);
      }
    }
  } catch {
    // Degrade to "nothing managed" — rows render read-only.
  }
  return managed;
}
