/**
 * BasesSource — read-only `DataSource` over an Obsidian Bases query result.
 *
 * Wraps the existing Bases extraction layer ({@link BasesDataAdapter}) behind
 * the capability-typed {@link DataSource} contract. It produces raw
 * {@link SourceTask} values (native `Date`/`number`/`string`/`null` — never
 * formatted strings, per `.augment/rules/data-formatting-separation.md`) and
 * resolves raw parent references (wikilinks, markdown links, paths) to vault
 * paths in the same namespace as `SourceTask.path`, so the instance-expansion
 * layer can map a child to its parent unambiguously.
 *
 * Bases has no dependency model, so {@link BasesSource.getDependencies} always
 * returns `[]` and `capabilities.write` is hardcoded to `false` — read-only is
 * expressed structurally by the absence of `mutate`/`deleteTask`.
 *
 * @module datasource/BasesSource
 */

import type { App, BasesEntry } from 'obsidian';
import type { FieldMappings } from '../bases/types/field-mapping';
import { BasesDataAdapter } from '../bases/services/BasesDataAdapter';
import type {
  DataSource,
  DataSourceCapabilities,
  SourceDependency,
  SourceTask,
} from './types';

/**
 * Read-only data source backed by an Obsidian Bases query result.
 */
export class BasesSource implements DataSource {
  /** Bases is read-only: the single source of read-only truth (R5). */
  public readonly capabilities: DataSourceCapabilities = { write: false };

  private readonly app: App;
  private readonly entries: BasesEntry[];
  private readonly mappings: FieldMappings;
  private readonly adapter: BasesDataAdapter;

  /**
   * @param app - Obsidian app, used only for `metadataCache` parent resolution.
   * @param entries - Bases query entries (e.g. `basesView.data.data`).
   * @param mappings - Property→field mapping configuration.
   */
  constructor(app: App, entries: BasesEntry[], mappings: FieldMappings) {
    this.app = app;
    this.entries = entries;
    this.mappings = mappings;
    this.adapter = new BasesDataAdapter();
  }

  /**
   * List all source tasks with raw values and resolved parent paths.
   *
   * Uses the existing two-tier extraction discipline: cheap frontmatter/file
   * access via {@link BasesDataAdapter}, no expensive bulk `getValue` calls.
   */
  public async getTasks(): Promise<SourceTask[]> {
    return this.entries.map((entry) => this.toSourceTask(entry));
  }

  /**
   * Bases has no dependency model, so there are never any dependency edges.
   *
   * @param _path - Ignored; present to satisfy the {@link DataSource} contract.
   */
  public async getDependencies(_path: string): Promise<SourceDependency[]> {
    return [];
  }

  /**
   * Convert a single Bases entry into a raw {@link SourceTask}.
   */
  private toSourceTask(entry: BasesEntry): SourceTask {
    const path = entry.file.path;

    // Official BasesEntry is structurally assignable to the adapter's BasesEntryLike (see bases-entry.ts / plan KTD 4).
    return {
      path,
      text: this.adapter.extractText(entry, this.mappings.textProperty),
      start: this.adapter.extractDate(entry, this.mappings.startProperty),
      end: this.adapter.extractDate(entry, this.mappings.endProperty),
      progress: this.adapter.extractProgress(entry, this.mappings.progressProperty),
      status: this.adapter.extractStatus(entry, this.mappings.statusProperty),
      // Priority value comes from the mapped Base property (extractStatus is a
      // generic optional-string extractor). The color palette still comes from the
      // TaskNotes companion (getPriorityColors); a value with no palette entry
      // simply gets no color. Unmapped → null.
      priority: this.adapter.extractStatus(entry, this.mappings.priorityProperty),
      parents: this.resolveParents(entry),
    };
  }

  /**
   * Extract raw parent references and resolve each to a vault path.
   *
   * `BasesDataAdapter.extractParents` returns *raw* references (wikilinks,
   * markdown links, relative paths); the `DataSource` contract requires
   * `parents` to be resolved vault paths in the same namespace as `path`.
   * References that do not resolve to a vault file are dropped.
   */
  private resolveParents(entry: BasesEntry): string[] {
    const parentProperty = this.mappings.parentProperty;
    if (!parentProperty) {
      return [];
    }

    const rawRefs = this.adapter.extractParents(entry, parentProperty);
    const sourcePath = entry.file.path;
    const resolved: string[] = [];

    for (const ref of rawRefs) {
      const path = this.resolveParentLink(ref, sourcePath);
      if (path !== null) {
        resolved.push(path);
      }
    }

    return resolved;
  }

  /**
   * Resolve a parent link reference to an actual vault path.
   *
   * Handles wikilinks `[[Page]]`/`[[Page|alias]]`, markdown links
   * `[text](path)`, and direct paths, via `metadataCache.getFirstLinkpathDest`
   * — mirroring the resolution logic in
   * `src/bases/views/GanttTaskListView.ts` `resolveParentLink`.
   *
   * @param parentRef - The raw parent reference string.
   * @param sourcePath - The path of the note containing the reference (for
   *   relative-path resolution).
   * @returns The resolved vault path, or `null` if not resolvable.
   */
  private resolveParentLink(parentRef: string, sourcePath: string): string | null {
    if (!parentRef) {
      return null;
    }

    const trimmed = parentRef.trim();

    // Extract link path from wikilink format [[path]] or [[path|alias]]
    let linkPath = trimmed;
    if (trimmed.startsWith('[[') && trimmed.endsWith(']]')) {
      const inner = trimmed.slice(2, -2).trim();
      const pipeIndex = inner.indexOf('|');
      linkPath = pipeIndex !== -1 ? inner.substring(0, pipeIndex) : inner;
    }
    // Extract from markdown link format [text](path)
    else {
      const mdMatch = /^\[([^\]]*)\]\(([^)]+)\)$/.exec(trimmed);
      if (mdMatch?.[2]) {
        linkPath = mdMatch[2].trim();
      }
    }

    // Resolve via Obsidian's metadata cache (handles relative paths, aliases).
    const resolvedFile = this.app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
    if (resolvedFile) {
      return resolvedFile.path;
    }

    // Fall back to treating an unmodified value as a direct vault path.
    if (linkPath === trimmed && this.app.vault.getAbstractFileByPath(trimmed)) {
      return trimmed;
    }

    return null;
  }
}
