/**
 * Resolve a parent-link reference to an actual vault file path.
 *
 * Handles wikilinks (`[[Page]]`, `[[Page|alias]]`), markdown links
 * (`[text](path)`), and direct paths, using Obsidian's metadata cache (which
 * resolves relative paths and aliases) with a direct-vault-path fallback.
 * Returns the resolved file path, or `null` if it cannot be resolved.
 *
 * Single source of truth: previously duplicated verbatim in
 * PropertyMappingService and GanttTaskListView.
 *
 * @module bases/parentLink
 */
import type { App } from "obsidian";

export function resolveParentLink(
  app: App,
  parentRef: string,
  sourcePath: string | undefined
): string | null {
  if (!sourcePath) return null;
  if (!parentRef) return null;

  const trimmed = parentRef.trim();

  // Extract the link path from a wikilink ([[path]] / [[path|alias]])...
  let linkPath = trimmed;
  if (trimmed.startsWith("[[") && trimmed.endsWith("]]")) {
    const inner = trimmed.slice(2, -2).trim();
    const pipeIndex = inner.indexOf("|");
    linkPath = pipeIndex !== -1 ? inner.substring(0, pipeIndex) : inner;
  }
  // ...or from a markdown link ([text](path)).
  else {
    const match = /^\[([^\]]*)\]\(([^)]+)\)$/.exec(trimmed);
    if (match?.[2]) {
      linkPath = match[2].trim();
    }
  }

  // Resolve via the metadata cache (handles relative paths + aliases).
  const resolvedFile = app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
  if (resolvedFile) {
    return resolvedFile.path;
  }

  // Fallback: treat the value as a direct vault path.
  if (linkPath === trimmed && app.vault.getAbstractFileByPath(trimmed)) {
    return trimmed;
  }

  return null;
}
