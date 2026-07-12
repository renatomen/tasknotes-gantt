/**
 * Vault-sourced `[[` suggestion fetcher for the inline cell editors.
 *
 * Enumerates the vault's markdown files, scopes them by a TaskNotes user field's
 * autosuggest filter ({@link matchesFileFilter}), fuzzy-ranks the survivors over
 * basename + title + aliases (mirroring the field set TaskNotes' own suggester
 * searches, so a note reachable by its alias stays reachable here), caps the
 * result, and maps each file to the shared {@link SuggestionFetcher} item shape
 * — with the insert value in `fileToLinktext` form, the same form TaskNotes
 * stores, and the winning `SearchResult` attached for native highlighting.
 *
 * Independent of TaskNotes' unreachable `FileSuggestHelper`: this source is
 * always reachable, so it never degrades — only matches / no-matches apply.
 *
 * @module bases/vaultWikilinkSuggest
 */

import type { App, CachedMetadata, SearchResult, TFile } from 'obsidian';
import { getAllTags, parseFrontMatterAliases, prepareFuzzySearch } from 'obsidian';
import { matchesFileFilter, type FileFilterCandidate, type FileFilterConfig } from './fileFilter';
import type { SuggestionFetcher, TaskNotesSuggestion } from './taskNotesSuggest';

/** Matches the limit the TaskNotes-served suggest path uses. */
export const VAULT_SUGGEST_LIMIT = 20;

interface VaultLike {
  getMarkdownFiles?: () => TFile[];
}

interface MetadataCacheLike {
  fileToLinktext?: (file: TFile, sourcePath: string, omitMdExtension?: boolean) => string;
  getFileCache?: (file: TFile) => CachedMetadata | null;
}

interface TaskNotesSettingsLike {
  excludedFolders?: unknown;
}

interface PluginRegistryLike {
  getPlugin?: (id: string) => { settings?: TaskNotesSettingsLike } | null | undefined;
}

/**
 * Read TaskNotes' plugin-wide `excludedFolders` setting so dropped folders are
 * honored even for an unfiltered field. Best-effort: TaskNotes may be absent or
 * mid-upgrade, so any failure yields no exclusions rather than blocking. The raw
 * setting is a comma string or an array; {@link matchesFileFilter} normalizes
 * each entry, so only splitting and empty-dropping happen here.
 */
function resolveExcludedFolders(app: App): string[] {
  try {
    const plugins = (app as unknown as { plugins?: PluginRegistryLike }).plugins;
    const raw = plugins?.getPlugin?.('tasknotes')?.settings?.excludedFolders;
    let parts: unknown[] = [];
    if (Array.isArray(raw)) parts = raw;
    else if (typeof raw === 'string') parts = raw.split(',');
    return parts.filter((part): part is string => typeof part === 'string' && part.trim() !== '');
  } catch {
    return [];
  }
}

/** The best fuzzy match across a note's searchable fields, or `null` if none matched. */
function bestFieldMatch(
  scoreText: (text: string) => SearchResult | null,
  fields: string[],
): SearchResult | null {
  let best: SearchResult | null = null;
  for (const field of fields) {
    if (field === '') continue;
    const result = scoreText(field);
    if (result && (best === null || result.score > best.score)) best = result;
  }
  return best;
}

/** Loop-invariant inputs a single file's ranking pass reads, assembled once per query. */
interface RankContext {
  filter?: FileFilterConfig;
  hasQuery: boolean;
  scoreText: (text: string) => SearchResult | null;
  excludedFolders: string[];
  getFileCache?: (file: TFile) => CachedMetadata | null;
  metadataCache?: MetadataCacheLike;
  fileToLinktext: (file: TFile, sourcePath: string, omitMdExtension?: boolean) => string;
  sourcePath: string;
}

function readWikilinkCandidate(
  file: TFile,
  cache: CachedMetadata | null,
  filter: FileFilterConfig | undefined,
  hasQuery: boolean,
): FileFilterCandidate {
  const frontmatter = (cache?.frontmatter ?? {}) as Record<string, unknown>;
  return {
    tags: filter !== undefined && cache ? (getAllTags(cache) ?? []) : [],
    path: file.path,
    frontmatter,
    aliases: hasQuery ? (parseFrontMatterAliases(frontmatter) ?? []) : [],
    title: hasQuery && typeof frontmatter.title === 'string' ? frontmatter.title : file.basename,
  };
}

/** Filter + rank one file; `null` means the file is excluded or missed the query. */
function rankWikilinkFile(file: TFile, ctx: RankContext): TaskNotesSuggestion | null {
  // The metadata-cache lookup is skipped for an unfiltered, not-yet-typed `[[`
  // — the common plain-text case scanning the whole vault.
  const needsCache = ctx.filter !== undefined || ctx.hasQuery;
  const cache =
    needsCache && typeof ctx.getFileCache === 'function'
      ? ctx.getFileCache.call(ctx.metadataCache, file)
      : null;
  const candidate = readWikilinkCandidate(file, cache, ctx.filter, ctx.hasQuery);
  if (!matchesFileFilter(candidate, ctx.filter, ctx.excludedFolders)) return null;

  const match = ctx.hasQuery
    ? bestFieldMatch(ctx.scoreText, [file.basename, candidate.title, ...candidate.aliases])
    : null;
  if (ctx.hasQuery && match === null) return null;

  return {
    value: ctx.fileToLinktext.call(ctx.metadataCache, file, ctx.sourcePath, true),
    display: file.basename,
    path: file.path,
    ...(match ? { match } : {}),
  };
}

/**
 * Build a fetcher that serves vault notes matching a query as `[[`-insert
 * suggestions, scoped by `filter` (undefined ⇒ all vault) and ranked by fuzzy
 * score. Reads only the injected `app` slices (no globals) and guards against
 * the vault / metadata-cache methods being absent (returns `[]`).
 */
export function createVaultWikilinkFetcher(
  app: App,
  sourcePath: string,
  filter?: FileFilterConfig,
): SuggestionFetcher {
  const vault = (app as unknown as { vault?: VaultLike }).vault;
  const metadataCache = (app as unknown as { metadataCache?: MetadataCacheLike }).metadataCache;
  const excludedFolders = resolveExcludedFolders(app);

  return (query: string) => {
    const getMarkdownFiles = vault?.getMarkdownFiles;
    const fileToLinktext = metadataCache?.fileToLinktext;
    if (typeof getMarkdownFiles !== 'function' || typeof fileToLinktext !== 'function') {
      return Promise.resolve([]);
    }

    const needle = query.trim();
    const ctx: RankContext = {
      filter,
      hasQuery: needle !== '',
      scoreText: prepareFuzzySearch(needle),
      excludedFolders,
      getFileCache: metadataCache?.getFileCache,
      metadataCache,
      fileToLinktext,
      sourcePath,
    };

    const ranked: TaskNotesSuggestion[] = [];
    for (const file of getMarkdownFiles.call(vault)) {
      const entry = rankWikilinkFile(file, ctx);
      if (entry) ranked.push(entry);
    }

    ranked.sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0));
    return Promise.resolve(ranked.slice(0, VAULT_SUGGEST_LIMIT));
  };
}
