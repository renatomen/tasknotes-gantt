/**
 * TaskNotes custom user-field types for grid cell rendering.
 *
 * Resolves the map of TaskNotes custom fields (frontmatter key → assigned type
 * and optional autosuggest filter) from the in-process TaskNotes API, so the
 * cell render-type resolver can treat TaskNotes as the authoritative type source
 * when the plugin is installed. Mirrors the guarded `app.plugins.getPlugin`
 * access used elsewhere in the Bases view; degrades to an empty map when
 * TaskNotes is absent, mid-upgrade, or exposes a drifted surface.
 *
 * This is the view-layer counterpart to `TaskNotesSource.getFieldConfig` (which
 * serves the datasource's date-field mapping); the Bases view holds no
 * `TaskNotesSource`, so it reads the same `model.config().userFields` surface
 * directly. Unlike `getFieldConfig` it keeps ALL field types (not just `date`)
 * and carries the `autosuggestFilter` for the future inline editor.
 *
 * @module bases/taskNotesFieldTypes
 */

import type { App } from 'obsidian';

/** A TaskNotes custom field's type plus its (opaque) autosuggest filter config. */
export interface UserFieldType {
  type: string;
  /** TaskNotes `FileFilterConfig` (folder/tag/property scope) for the editor; opaque here. */
  autosuggestFilter?: unknown;
}

/** The TaskNotes config slice this reader needs (narrow, guarded). */
interface TaskNotesUserFieldRaw {
  enabled?: boolean | null;
  key?: string | null;
  type?: string | null;
  autosuggestFilter?: unknown;
}
interface TaskNotesConfigRaw {
  userFields?: TaskNotesUserFieldRaw[] | null;
}
interface TaskNotesApiLike {
  model?: { config?(): TaskNotesConfigRaw | null | undefined };
}
interface PluginsRegistryLike {
  getPlugin(id: string): { api?: TaskNotesApiLike } | null | undefined;
}

/** TaskNotes plugin id (matches the datasource resolution). */
const TASKNOTES_PLUGIN_ID = 'tasknotes';

/**
 * Resolve TaskNotes custom user-field types, keyed by lowercased frontmatter
 * key. Empty when TaskNotes is unavailable or has no user fields. An explicit
 * `enabled: false` field is excluded; a field missing a key or type is dropped.
 */
export function resolveUserFieldTypes(app: App): Map<string, UserFieldType> {
  const map = new Map<string, UserFieldType>();
  try {
    const plugins = (app as unknown as { plugins?: PluginsRegistryLike }).plugins;
    const api = plugins?.getPlugin(TASKNOTES_PLUGIN_ID)?.api;
    const config = api?.model?.config?.();
    for (const field of config?.userFields ?? []) {
      if (
        field &&
        field.enabled !== false &&
        typeof field.key === 'string' &&
        field.key.length > 0 &&
        typeof field.type === 'string' &&
        field.type.length > 0
      ) {
        map.set(field.key.toLowerCase(), {
          type: field.type,
          autosuggestFilter: field.autosuggestFilter,
        });
      }
    }
  } catch {
    // Degrade to an empty map — the resolver falls through to the widget map.
  }
  return map;
}
