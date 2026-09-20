/**
 * U3: BasesSource Unit Tests
 *
 * Verifies the read-only `DataSource` over a Bases query result:
 * - entries map to raw `SourceTask[]` (native Date/number/null, never strings)
 * - basename fallback for text; progress clamped 0–100
 * - multi-valued parents resolve to vault paths in the same namespace as `path`
 * - wikilink parents resolve via metadataCache to another task's `path`
 * - missing dates yield `null`, not a formatted string
 * - read-only capability: no `mutate`/`deleteTask`
 * - unscheduled handling: no fabricated dates in the data layer
 *
 * Following testing-standards.md: Jest, mocked Obsidian, Arrange-Act-Assert.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { BasesSource } from '../../src/datasource/BasesSource';
import type { BasesEntry } from 'obsidian';
import type { FieldMappings } from '../../src/bases/types/field-mapping';
import type { App } from 'obsidian';
import { composeEntrySignature } from '../../src/bases/entrySignature';

/** Property IDs use the colon form so extraction routes through getValue(). */
const MAPPINGS: FieldMappings = {
  textProperty: 'note:title',
  startProperty: 'note:start',
  endProperty: 'note:due',
  progressProperty: 'note:progress',
  parentProperty: 'note:parent',
  statusProperty: 'note:status',
  priorityProperty: 'note:priority',
};

/**
 * Build a fake BasesEntry whose getValue() returns Bases-style Value objects.
 * `values` maps property id → the raw value to wrap.
 */
function makeEntry(
  path: string,
  basename: string,
  values: Record<string, unknown>
): BasesEntry {
  // A faithful runtime double of a Bases entry: only `file` + `getValue` are the
  // official surface, so it's cast through `unknown` to the public `BasesEntry`
  // (the official `file: TFile` and `Value` return are intentionally narrower
  // than this loose double — see BasesDataAdapter KTD 4).
  return {
    file: { path, name: `${basename}.md`, basename },
    getValue: (propertyId: string) => {
      if (!(propertyId in values)) {
        return null;
      }
      const raw = values[propertyId];
      if (raw instanceof Date) {
        return { date: raw };
      }
      return { data: raw };
    },
  } as unknown as BasesEntry;
}

/**
 * Minimal App mock. `links` maps linkpath → resolved vault path; unknown
 * linkpaths resolve to null (dropped). `existingPaths` backs the direct-path
 * fallback via vault.getAbstractFileByPath.
 */
function makeApp(links: Record<string, string>, existingPaths: string[] = []): App {
  return {
    metadataCache: {
      getFileCache: () => null,
      getFirstLinkpathDest: (linkpath: string) => {
        const resolved = links[linkpath];
        return resolved ? { path: resolved } : null;
      },
    },
    vault: {
      getAbstractFileByPath: (p: string) =>
        existingPaths.includes(p) ? { path: p } : null,
    },
  } as unknown as App;
}

describe('BasesSource', () => {
  let app: App;

  beforeEach(() => {
    app = makeApp({});
  });

  describe('note snapshot freshness', () => {
    const mappings: FieldMappings = {
      textProperty: 'file.name', startProperty: 'note.begins',
      endProperty: 'note.finishes', progressProperty: '',
    };

    function fixture() {
      const entry = Object.assign(makeEntry('task.md', 'task', {
        'note:begins': '2026-09-20', 'note:finishes': '2026-09-22',
      }), {
        frontmatter: { begins: '2026-09-20', finishes: '2026-09-22' },
      });
      const cache: { frontmatter?: Record<string, unknown> } = {
        frontmatter: { begins: '2026-09-21', finishes: '2026-09-23' },
      };
      const cacheApp = {
        ...makeApp({}),
        metadataCache: { getFileCache: () => cache },
      } as unknown as App;
      return { entry, cache, cacheApp };
    }

    it.each(['note.', 'note:'])('reads the dates fingerprinted by refresh while Bases entries lag successive writes (%s)', async prefix => {
      const { entry, cache, cacheApp } = fixture();
      const dateMappings = { ...mappings, startProperty: `${prefix}begins`, endProperty: `${prefix}finishes` };
      const source = new BasesSource(cacheApp, [entry], dateMappings);
      const signature = () => composeEntrySignature({
        entries: [entry], viewMappings: dateMappings, resolvedMappings: dateMappings,
        estimateReadKey: null, noteCacheOf: () => ({ frontmatter: cache.frontmatter ?? null }),
      });
      const consumed = signature();

      const [first] = await source.getTasks();
      expect([first.start, first.end]).toEqual([new Date(2026, 8, 21), new Date(2026, 8, 23)]);
      entry.frontmatter = { begins: '2026-09-21', finishes: '2026-09-23' };
      expect(signature()).toBe(consumed);

      cache.frontmatter = { begins: '2026-09-20', finishes: '2026-09-22' };
      expect(signature()).not.toBe(consumed);
      const [second] = await source.getTasks();
      expect([second.start, second.end]).toEqual([new Date(2026, 8, 20), new Date(2026, 8, 22)]);
    });

    it.each([{}, { begins: '2026-09-21' }, undefined])(
      'does not resurrect a removed end date from a retained entry (%j)', async frontmatter => {
        const { entry, cache, cacheApp } = fixture();
        cache.frontmatter = frontmatter;
        const [task] = await new BasesSource(cacheApp, [entry], mappings).getTasks();
        expect(task.end).toBeNull();
      },
    );

    it('uses the query entry while its metadata cache is unavailable', async () => {
      const { entry } = fixture();
      const [task] = await new BasesSource(makeApp({}), [entry], mappings).getTasks();
      expect([task.start, task.end]).toEqual([new Date(2026, 8, 20), new Date(2026, 8, 22)]);
    });

    it('keeps computed-property access bound to its original Bases entry', async () => {
      const { entry, cacheApp } = fixture();
      const computed = Object.assign(entry, {
        getValue() {
          expect(this).toBe(computed);
          return { date: new Date(2026, 8, 24) };
        },
      });
      const [task] = await new BasesSource(cacheApp, [computed], {
        ...mappings, endProperty: 'formula.finish',
      }).getTasks();
      expect(task.end).toEqual(new Date(2026, 8, 24));
    });
  });

  describe('capabilities', () => {
    it('is read-only and exposes no write methods', () => {
      // Arrange
      const source = new BasesSource(app, [], MAPPINGS);

      // Assert
      expect(source.capabilities.write).toBe(false);
      expect((source as Partial<{ mutate: unknown }>).mutate).toBeUndefined();
      expect((source as Partial<{ deleteTask: unknown }>).deleteTask).toBeUndefined();
    });
  });

  describe('getTasks', () => {
    it('maps an entry to a SourceTask with raw Date values', async () => {
      // Arrange
      const start = new Date('2026-04-02');
      const end = new Date('2026-04-20');
      const entry = makeEntry('tasks/a.md', 'a', {
        'note:title': 'Task A',
        'note:start': start,
        'note:due': end,
        'note:progress': 50,
      });
      const source = new BasesSource(app, [entry], MAPPINGS);

      // Act
      const [task] = await source.getTasks();

      // Assert
      expect(task.path).toBe('tasks/a.md');
      expect(task.text).toBe('Task A');
      expect(task.start).toBeInstanceOf(Date);
      expect(task.end).toBeInstanceOf(Date);
      expect(task.start?.getTime()).toBe(start.getTime());
      expect(task.end?.getTime()).toBe(end.getTime());
      expect(task.progress).toBe(50);
      expect(task.status).toBeNull();
      expect(task.parents).toEqual([]);
    });

    it('extracts status from the mapped status property', async () => {
      // Arrange
      const entry = makeEntry('tasks/s.md', 's', { 'note:status': '11🟥Active = Now' });
      const source = new BasesSource(app, [entry], MAPPINGS);

      // Act
      const [task] = await source.getTasks();

      // Assert
      expect(task.status).toBe('11🟥Active = Now');
    });

    it('extracts priority from the mapped priority property', async () => {
      // Arrange — priority reads through its OWN mapping, not the status property
      // (guards a copy-paste regression that reuses statusProperty).
      const entry = makeEntry('tasks/p.md', 'p', { 'note:status': 'active', 'note:priority': 'high' });
      const source = new BasesSource(app, [entry], MAPPINGS);

      // Act
      const [task] = await source.getTasks();

      // Assert
      expect(task.priority).toBe('high');
      expect(task.status).toBe('active');
    });

    it('yields null priority when priorityProperty is unmapped', async () => {
      // Arrange - priorityProperty '' short-circuits even when a value is present
      const entry = makeEntry('tasks/p.md', 'p', { 'note:priority': 'ignored' });
      const source = new BasesSource(app, [entry], { ...MAPPINGS, priorityProperty: '' });

      // Act
      const [task] = await source.getTasks();

      // Assert
      expect(task.priority).toBeNull();
    });

    it('yields null status when statusProperty is unmapped', async () => {
      // Arrange - statusProperty '' short-circuits even when a value is present
      const entry = makeEntry('tasks/s.md', 's', { 'note:status': 'ignored' });
      const source = new BasesSource(app, [entry], { ...MAPPINGS, statusProperty: '' });

      // Act
      const [task] = await source.getTasks();

      // Assert
      expect(task.status).toBeNull();
    });

    it('falls back to file.basename when the text value is absent', async () => {
      // Arrange
      const entry = makeEntry('notes/meeting.md', 'meeting', {
        'note:start': new Date('2026-02-01'),
      });
      const source = new BasesSource(app, [entry], MAPPINGS);

      // Act
      const [task] = await source.getTasks();

      // Assert
      expect(task.text).toBe('meeting');
    });

    it('clamps progress into the 0–100 range', async () => {
      // Arrange
      const high = makeEntry('t/high.md', 'high', { 'note:progress': 150 });
      const low = makeEntry('t/low.md', 'low', { 'note:progress': -20 });
      const source = new BasesSource(app, [high, low], MAPPINGS);

      // Act
      const [a, b] = await source.getTasks();

      // Assert
      expect(a.progress).toBe(100);
      expect(b.progress).toBe(0);
    });

    it('yields null (not a formatted string) for missing dates and progress', async () => {
      // Arrange — an unscheduled task with no start/end/progress
      const entry = makeEntry('backlog/x.md', 'x', { 'note:title': 'Backlog X' });
      const source = new BasesSource(app, [entry], MAPPINGS);

      // Act
      const [task] = await source.getTasks();

      // Assert — data layer must not fabricate dates (no "today" substitution)
      expect(task.start).toBeNull();
      expect(task.end).toBeNull();
      expect(task.progress).toBeNull();
      expect(typeof task.start).not.toBe('string');
      expect(typeof task.end).not.toBe('string');
    });

    it('returns an empty array for no entries', async () => {
      // Arrange
      const source = new BasesSource(app, [], MAPPINGS);

      // Act / Assert
      expect(await source.getTasks()).toEqual([]);
    });
  });

  describe('parent resolution', () => {
    it('resolves a multi-valued parent property into an array of vault paths', async () => {
      // Arrange
      app = makeApp({
        'Parent A': 'projects/parent-a.md',
        'Parent B': 'projects/parent-b.md',
      });
      const entry = makeEntry('tasks/child.md', 'child', {
        'note:parent': ['[[Parent A]]', '[[Parent B]]'],
      });
      const source = new BasesSource(app, [entry], MAPPINGS);

      // Act
      const [task] = await source.getTasks();

      // Assert
      expect(task.parents).toEqual([
        'projects/parent-a.md',
        'projects/parent-b.md',
      ]);
    });

    it('resolves a wikilink parent to the same path used as another task\'s identity', async () => {
      // Arrange — the wikilink [[Sample Project]] must resolve into the same
      // namespace as the project task's `path`, so the instance map can link.
      const projectPath = 'projects/Sample Project.md';
      app = makeApp({ 'Sample Project': projectPath });

      const project = makeEntry(projectPath, 'Sample Project', {
        'note:title': 'Sample Project',
      });
      const child = makeEntry('tasks/child.md', 'child', {
        'note:parent': '[[Sample Project]]',
      });
      const source = new BasesSource(app, [project, child], MAPPINGS);

      // Act
      const [projectTask, childTask] = await source.getTasks();

      // Assert
      expect(childTask.parents).toEqual([projectPath]);
      expect(childTask.parents[0]).toBe(projectTask.path);
    });

    it('drops parent references that do not resolve to a vault file', async () => {
      // Arrange — one resolvable, one dangling reference
      app = makeApp({ 'Real Parent': 'projects/real.md' });
      const entry = makeEntry('tasks/child.md', 'child', {
        'note:parent': ['[[Real Parent]]', '[[Ghost Parent]]'],
      });
      const source = new BasesSource(app, [entry], MAPPINGS);

      // Act
      const [task] = await source.getTasks();

      // Assert
      expect(task.parents).toEqual(['projects/real.md']);
    });

    it('resolves a direct vault path via the getAbstractFileByPath fallback', async () => {
      // Arrange — a bare path that is not a link but exists in the vault
      app = makeApp({}, ['projects/direct.md']);
      const entry = makeEntry('tasks/child.md', 'child', {
        'note:parent': 'projects/direct.md',
      });
      const source = new BasesSource(app, [entry], MAPPINGS);

      // Act
      const [task] = await source.getTasks();

      // Assert
      expect(task.parents).toEqual(['projects/direct.md']);
    });

    it('returns empty parents when no parent property is configured', async () => {
      // Arrange
      const mappings: FieldMappings = { ...MAPPINGS, parentProperty: '' };
      const entry = makeEntry('tasks/child.md', 'child', {
        'note:parent': '[[Anything]]',
      });
      const source = new BasesSource(app, [entry], mappings);

      // Act
      const [task] = await source.getTasks();

      // Assert
      expect(task.parents).toEqual([]);
    });
  });

  describe('getDependencies', () => {
    it('always returns an empty array (Bases has no dependency model)', async () => {
      // Arrange
      const source = new BasesSource(app, [], MAPPINGS);

      // Act / Assert
      expect(await source.getDependencies('anything.md')).toEqual([]);
    });
  });

  describe('checklist progress (TaskNotes mode, U3)', () => {
    const TN_MAPPINGS: FieldMappings = { ...MAPPINGS, progressMode: 'tasknotes' };

    /** An App whose metadataCache.getFileCache returns listItems keyed by path. */
    function makeCacheApp(caches: Record<string, unknown[]>, frontmatter: Record<string, Record<string, unknown>> = {}): App {
      return {
        metadataCache: {
          getFileCache: (file: { path: string }) =>
            file ? { listItems: caches[file.path], frontmatter: frontmatter[file.path] } : {},
          getFirstLinkpathDest: () => null,
        },
        vault: { getAbstractFileByPath: () => null },
      } as unknown as App;
    }

    it('computes the percentage from completed/total top-level checklist items (R4)', async () => {
      // Arrange — 2 of 4 top-level checklist items complete
      const cacheApp = makeCacheApp({
        'tasks/a.md': [
          { task: 'x', parent: -1 },
          { task: 'x', parent: -1 },
          { task: ' ', parent: -1 },
          { task: ' ', parent: -1 },
        ],
      });
      const entry = makeEntry('tasks/a.md', 'a', {});
      const source = new BasesSource(cacheApp, [entry], TN_MAPPINGS);

      // Act
      const [task] = await source.getTasks();

      // Assert
      expect(task.progress).toBe(50);
    });

    it('yields null when the note has no checklist items (R6)', async () => {
      // Arrange — a note with no list items, and a note with a non-task bullet only
      const cacheApp = makeCacheApp({
        'tasks/none.md': [],
        'tasks/bullet.md': [{ parent: -1 }], // plain bullet, no `task` marker
      });
      const source = new BasesSource(
        cacheApp,
        [makeEntry('tasks/none.md', 'none', {}), makeEntry('tasks/bullet.md', 'bullet', {})],
        TN_MAPPINGS,
      );

      // Act
      const [none, bullet] = await source.getTasks();

      // Assert — null (→ bar renders 0 via ganttSync `?? 0`)
      expect(none.progress).toBeNull();
      expect(bullet.progress).toBeNull();
    });

    it('excludes nested checklist items from the count', async () => {
      // Arrange — one nested completed item (parent >= 0) must NOT count
      const cacheApp = makeCacheApp({
        'tasks/n.md': [
          { task: 'x', parent: -1 }, // top-level, complete
          { task: 'x', parent: 0 }, // nested under line 0 — excluded
          { task: ' ', parent: -1 }, // top-level, incomplete
        ],
      });
      const source = new BasesSource(cacheApp, [makeEntry('tasks/n.md', 'n', {})], TN_MAPPINGS);

      // Act
      const [task] = await source.getTasks();

      // Assert — 1 of 2 top-level → 50 (nested `x` ignored)
      expect(task.progress).toBe(50);
    });

    it('counts x/X as complete and other markers as incomplete', async () => {
      // Arrange
      const cacheApp = makeCacheApp({
        'tasks/m.md': [
          { task: 'X', parent: -1 }, // complete (uppercase)
          { task: '/', parent: -1 }, // in-progress marker — counts, not complete
          { task: ' ', parent: -1 }, // incomplete
        ],
      });
      const source = new BasesSource(cacheApp, [makeEntry('tasks/m.md', 'm', {})], TN_MAPPINGS);

      // Act
      const [task] = await source.getTasks();

      // Assert — 1 of 3 complete → 33
      expect(task.progress).toBe(33);
    });

    it('reads the Progress Property (not the checklist) in property mode (R8)', async () => {
      // Arrange — property mode: the checklist would compute 100, but the mapped
      // property value (30) must win because the compute path is not taken.
      const cacheApp = makeCacheApp(
        { 'tasks/p.md': [{ task: 'x', parent: -1 }] },
        { 'tasks/p.md': { progress: 30 } },
      );
      const entry = makeEntry('tasks/p.md', 'p', { 'note:progress': 30 });
      const source = new BasesSource(cacheApp, [entry], { ...MAPPINGS, progressMode: 'property' });

      // Act
      const [task] = await source.getTasks();

      // Assert
      expect(task.progress).toBe(30);
    });
  });
});
