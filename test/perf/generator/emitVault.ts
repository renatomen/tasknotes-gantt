/**
 * Vault emitter (U2, #161 perf plan): serialize a canonical {@link TaskGraph} to
 * a real Obsidian vault — TaskNotes-convention notes plus a `.base` — in a
 * disposable scratch directory, for the full-stack layer (U5) and on-demand
 * diagnosis (U7).
 *
 * Convention (confirmed in `test/vaults/gantt-companion/`): each task is a note
 * with `tags: [task]` (plus the matched tag for the Base subset), `projects:` as
 * a wikilink list for multi-parent edges, `scheduled`/`due` dates (omitted for
 * the undated/partial mix), a `status`, and `blockedBy:` `{uid, reltype, gap}`
 * entries for dependencies. The `.base` maps the companion fields and filters to
 * the matched subset via `file.hasTag(...)`.
 *
 * @module test/perf/generator/emitVault
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { GraphTask, TaskGraph } from './graph';

/** Options for {@link emitVault}; `outDir` is required (scratch-only guard). */
export interface EmitOptions {
  /** Absolute/explicit scratch directory to write into (required). */
  outDir: string;
  /** `.base` filename (default `Generated.base`). */
  baseName?: string;
  /** Tag that marks the matched subset + drives the Base filter (default `project`). */
  matchedTag?: string;
  /**
   * Multi-parent edge field (#161 storm repro). `projects` (default) writes a
   * TaskNotes `projects:` wikilink list (resolved via the TaskNotes API). `in`
   * writes an `in:` wikilink list AND emits a `.base` that maps the Gantt's
   * `parentProperty` to `note.in` — so parents resolve via Bases `getValue` on a
   * LINK property, reproducing the production config (`Gantt Base.base`) whose
   * bulk `getValue` re-pokes Bases into the re-notify storm.
   */
  parentField?: 'projects' | 'in';
  /**
   * Emit the production-shaped storm `.base` (#161): a MULTI-view base (Gantt +
   * Table) with `parentProperty: note.in`, a status sort, and Inherit mode — the
   * exact shape that reproduces the toggle storm. Requires `parentField: 'in'`.
   */
  stormBase?: boolean;
}

/** Summary of an emit run. */
export interface EmitResult {
  vaultDir: string;
  notesWritten: number;
  basePath: string;
}

const DEFAULT_BASE_NAME = 'Generated.base';
const DEFAULT_MATCHED_TAG = 'project';

/** The note basename (no dir, no extension) used as a wikilink target. */
function titleFromPath(notePath: string): string {
  return notePath.replace(/^.*\//, '').replace(/\.md$/, '');
}

/** Format a Date as `YYYY-MM-DD` (local parts — matches how dates are generated). */
function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Serialize a task to a markdown note with TaskNotes-convention frontmatter.
 * Empty lists and null dates are omitted, reproducing the undated/partial mix.
 */
export function serializeTaskNote(
  task: GraphTask,
  matchedTag = DEFAULT_MATCHED_TAG,
  parentField: 'projects' | 'in' = 'projects',
): string {
  const lines: string[] = ['---'];
  lines.push(`tags: [task${task.matched ? `, ${matchedTag}` : ''}]`);

  if (task.parents.length > 0) {
    lines.push(`${parentField}:`);
    for (const parent of task.parents) lines.push(`  - "[[${titleFromPath(parent)}]]"`);
  }

  lines.push(`status: ${task.status}`);

  if (task.start) lines.push(`scheduled: ${formatDate(task.start)}`);
  if (task.due) lines.push(`due: ${formatDate(task.due)}`);

  if (task.deps.length > 0) {
    lines.push('blockedBy:');
    for (const dep of task.deps) {
      lines.push(`  - uid: "[[${titleFromPath(dep.predecessorPath)}]]"`);
      lines.push(`    reltype: ${dep.reltype}`);
      if (dep.gap !== null) lines.push(`    gap: ${dep.gap}`);
    }
  }

  lines.push('---', '', `# ${task.title}`, '');
  return lines.join('\n');
}

/**
 * Serialize the `.base` file: a Gantt view over the matched subset (filtered by
 * the matched tag) with the companion date-field mapping and Show-all expansion.
 */
export function serializeBaseFile(matchedTag = DEFAULT_MATCHED_TAG): string {
  return [
    'filters:',
    '  and:',
    `    - 'file.hasTag("${matchedTag}")'`,
    'views:',
    '  - type: obsidianGantt',
    '    name: "Gantt (OG) — perf"',
    '    tngantt_startDateProperty: note.scheduled',
    '    tngantt_endDateProperty: note.due',
    '    tngantt_expandedRelationships: show-all',
    '    order:',
    '      - file.name',
    '      - note.scheduled',
    '      - note.due',
    '',
  ].join('\n');
}

/**
 * Serialize the production-shaped STORM `.base` (#161 repro): a MULTI-view base
 * (Gantt + Table) over the matched subset, with `parentProperty: note.in` (so the
 * Gantt resolves parents via Bases `getValue` on the `in` LINK property), Inherit
 * mode, and a status sort — mirroring the maintainer's `Gantt Base.base` that
 * reproduces the toggle storm. Toggling `tngantt_hideTopLevelSubtasks` on this
 * shape is what makes our bulk `getValue` re-poke Bases into the re-notify storm.
 */
export function serializeStormBaseFile(matchedTag = DEFAULT_MATCHED_TAG): string {
  return [
    'filters:',
    '  and:',
    `    - 'file.hasTag("${matchedTag}")'`,
    'views:',
    '  - type: obsidianGantt',
    '    name: "Gantt"',
    '    sort:',
    '      - property: status',
    '        direction: DESC',
    '    order:',
    '      - file.basename',
    '      - note.status',
    '      - note.scheduled',
    '      - note.due',
    '    parentProperty: note.in',
    '    statusProperty: note.status',
    '    startDateProperty: note.scheduled',
    '    endDateProperty: note.due',
    '    textProperty: file.basename',
    '    tngantt_expandedRelationships: inherit',
    '    tngantt_hideTopLevelSubtasks: false',
    '  - type: table',
    '    name: "Table"',
    '    order:',
    '      - file.name',
    '      - note.status',
    '      - note.scheduled',
    '      - note.due',
    '',
  ].join('\n');
}

/** Minimal filler-note body (no task tag, so the Base filter never matches it). */
function serializeFillerNote(title: string): string {
  return `# ${title}\n`;
}

/**
 * Write the graph to a vault under `options.outDir`. Requires an explicit
 * non-empty output dir (scratch-only guard — never the live vault); all writes
 * are joined under it.
 */
export async function emitVault(graph: TaskGraph, options: EmitOptions): Promise<EmitResult> {
  const outDir = options.outDir;
  if (!outDir || outDir.trim() === '') {
    throw new Error('emitVault requires an explicit output directory (scratch-only).');
  }
  const matchedTag = options.matchedTag ?? DEFAULT_MATCHED_TAG;
  const baseName = options.baseName ?? DEFAULT_BASE_NAME;
  const parentField = options.parentField ?? 'projects';

  await fs.mkdir(outDir, { recursive: true });

  const writeNote = async (relPath: string, content: string): Promise<void> => {
    const full = path.join(outDir, relPath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf8');
  };

  let notesWritten = 0;
  for (const task of graph.tasks) {
    await writeNote(task.path, serializeTaskNote(task, matchedTag, parentField));
    notesWritten += 1;
  }
  for (const filler of graph.fillers) {
    await writeNote(filler.path, serializeFillerNote(filler.title));
    notesWritten += 1;
  }

  const basePath = path.join(outDir, baseName);
  await fs.writeFile(
    basePath,
    options.stormBase ? serializeStormBaseFile(matchedTag) : serializeBaseFile(matchedTag),
    'utf8',
  );

  return { vaultDir: outDir, notesWritten, basePath };
}
