/**
 * Guarded adapter over TaskNotes' file-suggest capability (`FileSuggestHelper`)
 * for the autosuggest cell editor, plus the pure list-append helpers its direct
 * commit path uses.
 *
 * The canonical suggester is TaskNotes' `FileSuggestHelper.suggest(plugin,
 * query, limit, filterConfig)` — the same engine its own project/user-field
 * suggests run on. Verified against installed TaskNotes 4.11.0: the helper is
 * bundled inside TaskNotes' `main.js` closure and is NOT exposed on the plugin
 * instance or its runtime api, so {@link resolveSuggestionFetcher} currently
 * degrades to `null` and the editor renders its "suggestions unavailable"
 * free-text state. The probe checks the two natural exposure points (the
 * plugin instance and its `api`) with the helper's exact call signature, so
 * the adapter lights up without changes the day TaskNotes exports it —
 * re-probed per editor open (mirroring {@link ./taskNotesFieldTypes}' guarded
 * access), never hand-rolling a parallel vault scan.
 *
 * @module bases/taskNotesSuggest
 */

import type { App } from 'obsidian';

/** One suggestion served to the editor: the link text to store + display form. */
export interface TaskNotesSuggestion {
  /** Resolved link text (`fileToLinktext` form) — what a pick stores. */
  value: string;
  /** Human-readable row text (basename plus title/alias extras). */
  display: string;
  /** Vault path of the suggested note, when the helper carried one. */
  path?: string;
}

/** Async suggestion source the editor debounces over. */
export type SuggestionFetcher = (query: string) => Promise<TaskNotesSuggestion[]>;

/** The FileSuggestHelper call surface (TaskNotes' documented signature). */
interface FileSuggestHelperLike {
  suggest(
    plugin: unknown,
    query: string,
    limit?: number,
    filterConfig?: unknown,
  ): Promise<unknown> | unknown;
}

/** Exposure points the probe checks on the resolved plugin instance. */
interface TaskNotesPluginLike {
  FileSuggestHelper?: unknown;
  api?: { FileSuggestHelper?: unknown };
}

interface PluginsRegistryLike {
  getPlugin(id: string): unknown;
}

const TASKNOTES_PLUGIN_ID = 'tasknotes';

/** Matches the limit TaskNotes' own suggest consumers pass. */
const SUGGEST_LIMIT = 20;

function asFileSuggestHelper(candidate: unknown): FileSuggestHelperLike | null {
  if (
    candidate &&
    typeof candidate === 'object' &&
    typeof (candidate as { suggest?: unknown }).suggest === 'function'
  ) {
    return candidate as FileSuggestHelperLike;
  }
  return null;
}

/**
 * Resolve TaskNotes' file-suggest capability for one editor session, or `null`
 * when it is unreachable (TaskNotes absent, mid-upgrade, or — as of 4.11.0 —
 * not exposing the helper). The returned fetcher forwards the plugin instance,
 * query, limit, and the field's `autosuggestFilter` verbatim, maps the results
 * to {@link TaskNotesSuggestion}s, and never throws (errors yield `[]`).
 */
export function resolveSuggestionFetcher(app: App, filterConfig: unknown): SuggestionFetcher | null {
  try {
    const plugins = (app as unknown as { plugins?: PluginsRegistryLike }).plugins;
    const plugin = plugins?.getPlugin(TASKNOTES_PLUGIN_ID) as TaskNotesPluginLike | null | undefined;
    if (!plugin) return null;
    const helper =
      asFileSuggestHelper(plugin.FileSuggestHelper) ??
      asFileSuggestHelper(plugin.api?.FileSuggestHelper);
    if (!helper) return null;
    return async (query: string) => {
      try {
        const raw = await helper.suggest(plugin, query, SUGGEST_LIMIT, filterConfig);
        if (!Array.isArray(raw)) return [];
        const suggestions: TaskNotesSuggestion[] = [];
        for (const item of raw) {
          const insertText = (item as { insertText?: unknown } | null)?.insertText;
          if (typeof insertText !== 'string' || insertText === '') continue;
          const displayText = (item as { displayText?: unknown }).displayText;
          const path = (item as { path?: unknown }).path;
          suggestions.push({
            value: insertText,
            display: typeof displayText === 'string' && displayText !== '' ? displayText : insertText,
            ...(typeof path === 'string' ? { path } : {}),
          });
        }
        return suggestions;
      } catch {
        return [];
      }
    };
  } catch {
    return null;
  }
}

/**
 * A picked suggestion's stored form: `[[link text]]`, matching how TaskNotes
 * stores file-suggested values (projects, user fields).
 */
export function wikilinkEntry(insertText: string): string {
  return `[[${insertText}]]`;
}

/** The link target of a `[[target]]`/`[[target|alias]]` entry, else the entry. */
function entryTarget(entry: string): string {
  const wiki = /^\[\[([^\]]+)\]\]$/.exec(entry.trim());
  if (!wiki) return entry.trim();
  const inner = wiki[1] ?? '';
  const aliasIdx = inner.indexOf('|');
  return (aliasIdx === -1 ? inner : inner.slice(0, aliasIdx)).trim();
}

/** The RAW stored value as a verbatim entry list (scalar → 1 entry; empty → []). */
function normalizeStoredList(raw: unknown): string[] {
  if (raw === null || raw === undefined || raw === '') return [];
  if (Array.isArray(raw)) {
    const entries: string[] = [];
    for (const item of raw) {
      if (item === null || item === undefined) continue;
      const s = typeof item === 'string' ? item : String(item);
      if (s !== '') entries.push(s);
    }
    return entries;
  }
  return [String(raw)];
}

/**
 * Append `entry` to the RAW stored list value, preserving every existing entry
 * verbatim (the grid's TypedValues only carry display forms — rebuilding from
 * them would strip stored wikilinks, which is why the direct commit path reads
 * the raw frontmatter). Returns `null` (a noop — nothing to write) for an
 * empty entry or when an equal entry / a wikilink targeting the same note is
 * already present.
 */
export function appendListEntry(rawStored: unknown, entry: string): string[] | null {
  const trimmed = entry.trim();
  if (trimmed === '') return null;
  const existing = normalizeStoredList(rawStored);
  const target = entryTarget(trimmed);
  if (existing.some((e) => e === trimmed || entryTarget(e) === target)) return null;
  return [...existing, trimmed];
}
