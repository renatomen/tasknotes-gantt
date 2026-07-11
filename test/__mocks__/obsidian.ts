/**
 * Minimal Jest mock for the `obsidian` runtime module.
 *
 * Obsidian is provided by the host app at runtime, not by an npm package, so
 * unit tests can't import its real exports. Most tests use `import type` (erased
 * at compile time) and need nothing here. This mock exists for the few units
 * that extend an Obsidian class at runtime — e.g. `FocusTaskModal extends
 * FuzzySuggestModal` — so they can be constructed and exercised in isolation.
 *
 * Add exports here only as units under test require them.
 */

/** Stub host app. */
export class App {
  /** Marker so the mock isn't an empty class (S2094); the real App has many members. */
  readonly isMock = true;
}

/**
 * Stub of Obsidian's `TFile` so runtime `instanceof TFile` checks (e.g.
 * `resolveNoteProgress`, `computeEntrySignature`) can be exercised in unit tests:
 * a test's fake file must be a real instance of this class to pass the guard.
 */
export class TFile {
  path = '';
}

/**
 * Stub of Obsidian's generic fuzzy picker. Subclasses override getItems /
 * getItemText / renderSuggestion / onChooseItem; this base only needs to be
 * constructible and to accept the wiring the subclass calls in its constructor.
 */
export class FuzzySuggestModal<T> {
  app: App;
  private placeholder = '';
  constructor(app: App) {
    this.app = app;
  }
  setPlaceholder(text: string): void {
    this.placeholder = text;
  }
  /** Subclasses override this; declared here so the generic `T` is load-bearing. */
  getItems(): T[] {
    return [];
  }
}

interface CachedMetadataLike {
  frontmatter?: Record<string, unknown>;
  tags?: Array<{ tag?: unknown }>;
}

/** A single fuzzy-match span `[start, end)` over the searched text. */
type SearchMatchPart = [number, number];

interface SearchResultLike {
  score: number;
  matches: SearchMatchPart[];
}

/**
 * Flatten a note's `#`-prefixed tags the way the real `getAllTags` does — from
 * frontmatter `tags` (string or array) plus inline `tags` entries — so the vault
 * fetcher's candidate build can be exercised offline.
 */
export function getAllTags(cache: CachedMetadataLike | null | undefined): string[] | null {
  if (!cache) return null;
  const tags: string[] = [];
  const fmTags = cache.frontmatter?.tags;
  if (Array.isArray(fmTags)) {
    for (const tag of fmTags) {
      if (typeof tag === 'string' && tag !== '') tags.push(tag.startsWith('#') ? tag : `#${tag}`);
    }
  } else if (typeof fmTags === 'string' && fmTags !== '') {
    tags.push(fmTags.startsWith('#') ? fmTags : `#${fmTags}`);
  }
  if (Array.isArray(cache.tags)) {
    for (const entry of cache.tags) {
      if (entry && typeof entry.tag === 'string') tags.push(entry.tag);
    }
  }
  return tags;
}

/** Normalize the `aliases`/`alias` frontmatter key to a string array (or null). */
export function parseFrontMatterAliases(
  frontmatter: Record<string, unknown> | null | undefined,
): string[] | null {
  if (!frontmatter || typeof frontmatter !== 'object') return null;
  const raw = frontmatter.aliases ?? frontmatter.alias;
  if (raw === null || raw === undefined) return null;
  if (Array.isArray(raw)) return raw.filter((alias): alias is string => typeof alias === 'string');
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((alias) => alias.trim())
      .filter((alias) => alias !== '');
  }
  return null;
}

/**
 * Deterministic stand-in for the real `prepareFuzzySearch`: a contiguous
 * substring scores highest (earlier is better), a scattered subsequence scores
 * lower (tighter is better), and a miss returns `null`. Enough to prove the
 * fetcher ranks by score and includes alias matches; the real matcher runs in
 * e2e.
 */
export function prepareFuzzySearch(
  query: string,
): (text: string) => SearchResultLike | null {
  const needle = query.toLowerCase();
  return (text: string): SearchResultLike | null => {
    if (needle === '') return null;
    const haystack = text.toLowerCase();
    const contiguous = haystack.indexOf(needle);
    if (contiguous !== -1) {
      return { score: 100 - contiguous, matches: [[contiguous, contiguous + needle.length]] };
    }
    const matches: SearchMatchPart[] = [];
    let needleIndex = 0;
    for (let i = 0; i < haystack.length && needleIndex < needle.length; i++) {
      if (haystack[i] === needle[needleIndex]) {
        matches.push([i, i + 1]);
        needleIndex++;
      }
    }
    if (needleIndex < needle.length) return null;
    const spread = matches.length > 0 ? matches[matches.length - 1][0] - matches[0][0] : 0;
    return { score: 50 - spread, matches };
  };
}
