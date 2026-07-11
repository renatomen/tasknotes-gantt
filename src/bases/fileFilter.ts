/**
 * Pure, Obsidian-free file-filter predicate that scopes `[[` suggestions to the
 * notes a TaskNotes user field's autosuggest filter would allow.
 *
 * TaskNotes computes this scope inside its bundled `FileSuggestHelper`, which a
 * companion plugin cannot reach, so the semantics are reproduced here rather
 * than called. Working over a small candidate shape (already-extracted tags /
 * path / frontmatter / aliases / title) keeps this unit-testable and free of any
 * `obsidian` import; the vault fetcher builds the candidates and applies this.
 *
 * @module bases/fileFilter
 */

/** The autosuggest filter shape TaskNotes stores on a user field. */
export interface FileFilterConfig {
  /** Any-of tag patterns; a `-`-prefixed entry excludes notes carrying it. */
  requiredTags?: string[];
  /** Path-prefix folders a note must live under (empty ⇒ any folder). */
  includeFolders?: string[];
  /** Raw frontmatter key a note must carry (empty ⇒ no property constraint). */
  propertyKey?: string;
  /** Expected value(s) for `propertyKey` (empty ⇒ key-present is enough). */
  propertyValue?: string;
}

/** The already-extracted note facts the predicate reads. */
export interface FileFilterCandidate {
  tags: string[];
  path: string;
  frontmatter: Record<string, unknown>;
  aliases: string[];
  title: string;
}

function stripTagHash(tag: string): string {
  return tag.startsWith('#') ? tag.slice(1) : tag;
}

/**
 * TaskNotes' hierarchical tag match with substring fallback: exact, a nested
 * child (`ws/alpha` under `ws`), or a substring. The `#` is stripped from both
 * sides so a `#`-prefixed vault tag and a bare config pattern compare equal.
 */
function matchesHierarchicalTag(candidateTag: string, condition: string): boolean {
  const tag = stripTagHash(candidateTag).toLowerCase();
  const cond = stripTagHash(condition).toLowerCase();
  if (tag === '' || cond === '') return false;
  return tag === cond || tag.startsWith(`${cond}/`) || tag.includes(cond);
}

function matchesTagConditions(candidateTags: string[], conditionTags: string[]): boolean {
  if (conditionTags.length === 0) return true;

  const inclusions: string[] = [];
  const exclusions: string[] = [];
  for (const condition of conditionTags) {
    if (typeof condition !== 'string') continue;
    if (condition.startsWith('-')) {
      const pattern = condition.slice(1);
      if (pattern !== '') exclusions.push(pattern);
    } else {
      inclusions.push(condition);
    }
  }

  for (const exclusion of exclusions) {
    if (candidateTags.some((tag) => matchesHierarchicalTag(tag, exclusion))) return false;
  }

  if (inclusions.length > 0) {
    return inclusions.some((inclusion) =>
      candidateTags.some((tag) => matchesHierarchicalTag(tag, inclusion)),
    );
  }

  // Only exclusions were given and none matched, so the note is allowed.
  return true;
}

function normalizeFolder(folder: string): string {
  return folder
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function isPathUnderFolder(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

function normalizeFolderList(folders: string[] | undefined): string[] {
  return (folders ?? []).map(normalizeFolder).filter((folder) => folder !== '');
}

function matchesIncludeFolders(path: string, includeFolders: string[] | undefined): boolean {
  const folders = normalizeFolderList(includeFolders);
  return folders.length === 0 || folders.some((folder) => isPathUnderFolder(path, folder));
}

function isPathExcluded(path: string, excludedFolders: string[] | undefined): boolean {
  return normalizeFolderList(excludedFolders).some((folder) => isPathUnderFolder(path, folder));
}

function normalizePropertyValues(value: string | undefined): string[] {
  const trimmed = value != null ? value.trim() : '';
  if (trimmed === '') return [];
  return trimmed
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

function frontmatterValueMatches(value: unknown, expected: Set<string>): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some((item) => frontmatterValueMatches(item, expected));
  if (typeof value === 'string') return expected.has(value.trim().toLowerCase());
  if (typeof value === 'number' || typeof value === 'boolean') {
    return expected.has(String(value).toLowerCase());
  }
  if (typeof value === 'object') {
    try {
      return expected.has(JSON.stringify(value).toLowerCase());
    } catch {
      return false;
    }
  }
  return false;
}

function matchesProperty(
  frontmatter: Record<string, unknown>,
  propertyKey: string | undefined,
  propertyValue: string | undefined,
): boolean {
  const key = propertyKey ? propertyKey.trim() : '';
  if (key === '') return true;
  if (!(key in frontmatter)) return false;

  const actual = frontmatter[key];
  const expectedValues = normalizePropertyValues(propertyValue);
  if (expectedValues.length === 0) {
    return actual !== undefined && actual !== null;
  }

  const expected = new Set(expectedValues.map((item) => item.toLowerCase()));
  return frontmatterValueMatches(actual, expected);
}

/**
 * Whether a note passes a field's autosuggest filter. Every present dimension
 * (excluded folders, then tags, folders, and property) must hold; an undefined
 * config leaves only the plugin-wide `excludedFolders` constraint in force.
 */
export function matchesFileFilter(
  candidate: FileFilterCandidate,
  config: FileFilterConfig | undefined,
  excludedFolders?: string[],
): boolean {
  if (isPathExcluded(candidate.path, excludedFolders)) return false;
  if (!config) return true;
  if (!matchesTagConditions(candidate.tags, config.requiredTags ?? [])) return false;
  if (!matchesIncludeFolders(candidate.path, config.includeFolders)) return false;
  if (!matchesProperty(candidate.frontmatter, config.propertyKey, config.propertyValue)) {
    return false;
  }
  return true;
}
