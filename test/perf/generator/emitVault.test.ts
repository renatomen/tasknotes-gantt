/**
 * U2 vault-emitter unit tests (#161 perf plan): frontmatter round-trip + the
 * scratch-only write guard. Pure jest/node; the actual fs write goes to the OS
 * temp dir and is cleaned up. The behavioral "selects exactly N notes" assertion
 * needs a real Bases evaluator → it lives in U5, not here.
 */
import { describe, it, expect, afterAll } from '@jest/globals';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serializeTaskNote, serializeBaseFile, emitVault } from './emitVault';
import { generate } from './generate';
import type { GraphTask } from './graph';

function makeTask(overrides: Partial<GraphTask> & { path: string }): GraphTask {
  return {
    title: overrides.path.replace(/^.*\//, '').replace(/\.md$/, ''),
    parents: [],
    deps: [],
    start: null,
    due: null,
    status: 'open',
    matched: false,
    ...overrides,
  };
}

/** A minimal frontmatter reader tailored to the emitter's exact output. */
function readFrontmatter(content: string): Record<string, unknown> {
  const match = /^---\n([\s\S]*?)\n---/.exec(content);
  expect(match).not.toBeNull();
  const body = (match as RegExpExecArray)[1] as string;
  const out: Record<string, unknown> = {};
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    const kv = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1] as string;
    const inline = (kv[2] as string).trim();
    if (inline !== '') {
      out[key] = inline;
      continue;
    }
    // A nested list/block: collect the following indented lines.
    const block: string[] = [];
    while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1] as string)) {
      block.push((lines[i + 1] as string).trim());
      i += 1;
    }
    out[key] = block;
  }
  return out;
}

describe('serializeTaskNote — frontmatter shape', () => {
  it('round-trips a fully-dated matched task with status and tags', () => {
    const task = makeTask({
      path: 'Tasks/task-00001.md',
      start: new Date(2026, 2, 2),
      due: new Date(2026, 2, 20),
      status: 'in-progress',
      matched: true,
    });
    const fm = readFrontmatter(serializeTaskNote(task, 'project'));
    expect(fm.tags).toBe('[task, project]');
    expect(fm.scheduled).toBe('2026-03-02');
    expect(fm.due).toBe('2026-03-20');
    expect(fm.status).toBe('in-progress');
    expect(fm.projects).toBeUndefined();
  });

  it('emits a 4-item projects list for a 4-parent task', () => {
    const task = makeTask({
      path: 'Tasks/task-00010.md',
      parents: ['Tasks/task-00001.md', 'Tasks/task-00002.md', 'Tasks/task-00003.md', 'Tasks/task-00004.md'],
    });
    const fm = readFrontmatter(serializeTaskNote(task, 'project'));
    expect(fm.projects).toEqual([
      '- "[[task-00001]]"',
      '- "[[task-00002]]"',
      '- "[[task-00003]]"',
      '- "[[task-00004]]"',
    ]);
  });

  it('emits a blockedBy edge with uid + reltype + gap', () => {
    const task = makeTask({
      path: 'Tasks/task-00020.md',
      deps: [{ predecessorPath: 'Tasks/task-00005.md', reltype: 'FINISHTOSTART', gap: 'P2D' }],
    });
    const content = serializeTaskNote(task, 'project');
    expect(content).toContain('blockedBy:');
    expect(content).toContain('uid: "[[task-00005]]"');
    expect(content).toContain('reltype: FINISHTOSTART');
    expect(content).toContain('gap: P2D');
  });

  it('omits the gap key when a dependency has no gap', () => {
    const task = makeTask({
      path: 'Tasks/task-00021.md',
      deps: [{ predecessorPath: 'Tasks/task-00006.md', reltype: 'STARTTOSTART', gap: null }],
    });
    const content = serializeTaskNote(task, 'project');
    expect(content).toContain('reltype: STARTTOSTART');
    expect(content).not.toContain('gap:');
  });

  it('omits due for a start-only task (partial date mix)', () => {
    const task = makeTask({ path: 'Tasks/task-00030.md', start: new Date(2026, 2, 4) });
    const fm = readFrontmatter(serializeTaskNote(task, 'project'));
    expect(fm.scheduled).toBe('2026-03-04');
    expect(fm.due).toBeUndefined();
  });

  it('omits both dates for an undated task', () => {
    const content = serializeTaskNote(makeTask({ path: 'Tasks/task-00031.md' }), 'project');
    expect(content).not.toContain('scheduled:');
    expect(content).not.toContain('due:');
  });

  it('omits the matched tag for a non-matched task', () => {
    const fm = readFrontmatter(serializeTaskNote(makeTask({ path: 'Tasks/task-00032.md' }), 'project'));
    expect(fm.tags).toBe('[task]');
  });
});

describe('serializeBaseFile — filter expression', () => {
  it('filters on the matched tag and maps the companion date fields with show-all', () => {
    const base = serializeBaseFile('project');
    expect(base).toContain('file.hasTag("project")');
    expect(base).toContain('tngantt_startDateProperty: note.scheduled');
    expect(base).toContain('tngantt_endDateProperty: note.due');
    expect(base).toContain('tngantt_expandedRelationships: show-all');
    expect(base).toContain('type: obsidianGantt');
  });
});

describe('emitVault — write behavior', () => {
  const tmpRoots: string[] = [];
  afterAll(async () => {
    for (const dir of tmpRoots) await fs.rm(dir, { recursive: true, force: true });
  });

  async function freshDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'og-perf-emit-'));
    tmpRoots.push(dir);
    return dir;
  }

  it('refuses to write without an explicit output directory', async () => {
    const graph = generate(baseGraphParams());
    await expect(emitVault(graph, { outDir: '' })).rejects.toThrow();
  });

  it('writes every task + filler note and the base, all under the output dir', async () => {
    const graph = generate(baseGraphParams());
    const outDir = await freshDir();
    const result = await emitVault(graph, { outDir });

    expect(result.vaultDir).toBe(outDir);
    expect(result.notesWritten).toBe(graph.tasks.length + graph.fillers.length);
    // Base exists where reported, inside the output dir.
    expect(result.basePath.startsWith(outDir)).toBe(true);
    await expect(fs.stat(result.basePath)).resolves.toBeTruthy();
  });

  it('round-trips an emitted task note from disk (edges + dates + status preserved)', async () => {
    const graph = generate(baseGraphParams());
    const outDir = await freshDir();
    await emitVault(graph, { outDir });

    // Pick a matched, dated task with at least one parent to exercise every field.
    const sample = graph.tasks.find(
      (t) => t.matched && t.start && t.due && t.parents.length > 0,
    );
    expect(sample).toBeDefined();
    const onDisk = await fs.readFile(path.join(outDir, (sample as GraphTask).path), 'utf8');
    const fm = readFrontmatter(onDisk);
    expect(String(fm.tags)).toContain('project');
    expect(fm.scheduled).toBe(formatDate((sample as GraphTask).start as Date));
    expect(fm.due).toBe(formatDate((sample as GraphTask).due as Date));
    expect(fm.status).toBe((sample as GraphTask).status);
    expect((fm.projects as string[]).length).toBe((sample as GraphTask).parents.length);
  });
});

/** A compact graph for the write tests. */
function baseGraphParams() {
  return {
    seed: 7,
    totalNotes: 80,
    taskCount: 50,
    matchedCount: 10,
    multiParentDist: [
      { parents: 2, count: 4 },
      { parents: 4, count: 2 },
    ],
    maxDepth: 5,
    depDensity: 0.3,
    dateMix: { dated: 0.6, undated: 0.2, startOnly: 0.1, endOnly: 0.1 },
    cycleCount: 1,
    orphanCount: 2,
  };
}

/** Mirror of the emitter's date format for round-trip comparison. */
function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
