/**
 * U4: TaskNotesSource Unit Tests
 *
 * Verifies the read + capability + events `DataSource` over the TaskNotes JS
 * API against a fully mocked api object:
 * - TaskInfo → SourceTask mapping (raw Date scheduled/due, progress null,
 *   status carried, title → text)
 * - dependency mapping with correct reltype → DependencyRelType union and gap
 *   (covers AE3: a FINISHTOSTART blockedBy maps correctly)
 * - create() returns null when TaskNotes is absent / api undefined / apiVersion
 *   mismatch (graceful fallback to Bases)
 * - supportsWrite() reflects hasCapability (true and false); capabilities.write
 *   is false in this unit; mutate/deleteTask are undefined
 * - subscribe() registers handlers and the returned disposer unsubscribes
 *
 * Following testing-standards.md: Jest, mocked TaskNotes api via DI, AAA.
 */

import { describe, it, expect, jest } from '@jest/globals';
import {
  TaskNotesSource,
  TASKNOTES_CHANGE_EVENTS,
  type TaskNotesApi,
  type TaskNotesDependencyEdge,
  type TaskNotesTaskInfo,
} from '../../src/datasource/TaskNotesSource';
import type { App } from 'obsidian';

/** Options for building a fake TaskNotes api object. */
interface FakeApiOptions {
  apiVersion?: number;
  ready?: () => Promise<void>;
  tasks?: TaskNotesTaskInfo[];
  dependencies?: Record<string, TaskNotesDependencyEdge[]>;
  /** When provided, adds `relationships.subtasks`; omitted ⇒ accessor absent. */
  subtasks?: Record<string, TaskNotesTaskInfo[]>;
  /** When provided, adds `relationships.parents`; omitted ⇒ accessor absent. */
  parents?: Record<string, TaskNotesTaskInfo[]>;
  hasWrite?: boolean;
  omitHasCapability?: boolean;
  /** When provided, `api.config()` returns `{ statuses }`; omitted ⇒ no `config`. */
  statuses?: Array<{ value?: string; label?: string; color?: string; isCompleted?: boolean; icon?: string }>;
  /** When provided, `api.catalog.priorities()` returns these; omitted ⇒ absent. */
  priorities?: Array<{ value?: string; label?: string; color?: string; icon?: string }>;
}

/**
 * Build a fake TaskNotes api. Captures registered event handlers so tests can
 * fire events and assert on/off behavior.
 */
function makeApi(opts: FakeApiOptions = {}) {
  const handlers = new Map<symbol, { name: string; fn: (p?: unknown) => void }>();
  const onSpy = jest.fn((name: string, fn: (p?: unknown) => void) => {
    const ref = Symbol(name);
    handlers.set(ref, { name, fn });
    return ref;
  });
  const offSpy = jest.fn((ref: unknown) => {
    handlers.delete(ref as symbol);
  });
  // Write-surface spies (TaskNotes 4.11.0: tasks.update(path, updates, ctx),
  // tasks.delete(path, ctx)). Resolve by default; tests override to reject.
  const updateSpy = jest.fn(
    (_path: string, _updates: Record<string, unknown>, _ctx?: unknown) =>
      Promise.resolve(),
  );
  const deleteSpy = jest.fn((_path: string, _ctx?: unknown) => Promise.resolve());

  const api: TaskNotesApi = {
    apiVersion: opts.apiVersion ?? 1,
    lifecycle: {
      ready: opts.ready ?? (() => Promise.resolve()),
    },
    tasks: {
      list: () => opts.tasks ?? [],
      get: (path: string) =>
        (opts.tasks ?? []).find((t) => t.path === path) ?? null,
      update: updateSpy,
      delete: deleteSpy,
    },
    relationships: {
      dependencies: (path: string) => opts.dependencies?.[path] ?? [],
      ...(opts.subtasks
        ? { subtasks: (path: string) => opts.subtasks![path] ?? [] }
        : {}),
      ...(opts.parents
        ? { parents: (path: string) => opts.parents![path] ?? [] }
        : {}),
    },
    events: {
      on: onSpy,
      off: offSpy,
    },
  };

  if (!opts.omitHasCapability) {
    api.hasCapability = (cap: string) =>
      cap === 'tasks.write' ? opts.hasWrite === true : false;
  }

  if (opts.statuses !== undefined || opts.priorities !== undefined) {
    api.catalog = {
      ...(opts.statuses !== undefined ? { statuses: () => opts.statuses } : {}),
      ...(opts.priorities !== undefined ? { priorities: () => opts.priorities } : {}),
    };
  }

  return { api, onSpy, offSpy, updateSpy, deleteSpy, handlers };
}

/**
 * Build a fake Obsidian App whose plugin registry returns the given TaskNotes
 * api (or simulates TaskNotes being absent when `api` is undefined).
 */
function makeApp(api?: TaskNotesApi): App {
  return {
    plugins: {
      getPlugin: (id: string) =>
        id === 'tasknotes' && api ? { api } : undefined,
    },
    metadataCache: {
      // Resolve a link target (basename) → a TFile-like { path } by appending
      // `.md` when absent. Enough for dependency-edge resolution in tests.
      getFirstLinkpathDest: (linktext: string) => ({
        path: /\.md$/i.test(linktext) ? linktext : `${linktext}.md`,
      }),
    },
  } as unknown as App;
}

describe('TaskNotesSource — dependency writes (M2)', () => {
  async function makeWritableSource(opts: FakeApiOptions = {}) {
    const built = makeApi({ hasWrite: true, ...opts });
    const source = await TaskNotesSource.create(makeApp(built.api));
    if (!source) throw new Error('expected a source');
    return { source, updateSpy: built.updateSpy };
  }

  describe('addDependency', () => {
    it('appends an FS edge to an empty blockedBy and writes via tasks.update', async () => {
      const { source, updateSpy } = await makeWritableSource({
        tasks: [{ path: 'dep.md' }],
      });
      await source.addDependency('dep.md', 'pred.md', 'FINISHTOSTART');
      expect(updateSpy).toHaveBeenCalledTimes(1);
      const [path, updates] = updateSpy.mock.calls[0]!;
      expect(path).toBe('dep.md');
      expect(updates).toEqual({
        blockedBy: [{ uid: '[[pred]]', reltype: 'FINISHTOSTART' }],
      });
    });

    it('preserves existing edges verbatim when appending', async () => {
      const { source, updateSpy } = await makeWritableSource({
        tasks: [{ path: 'dep.md', blockedBy: [{ uid: '[[other]]', reltype: 'STARTTOSTART', gap: 'P1D' }] }],
      });
      await source.addDependency('dep.md', 'pred.md', 'FINISHTOSTART');
      const [, updates] = updateSpy.mock.calls[0]!;
      expect((updates as { blockedBy: unknown[] }).blockedBy).toEqual([
        { uid: '[[other]]', reltype: 'STARTTOSTART', gap: 'P1D' },
        { uid: '[[pred]]', reltype: 'FINISHTOSTART' },
      ]);
    });

    it('is a no-op when an equivalent edge already exists (dedup by resolved path)', async () => {
      const { source, updateSpy } = await makeWritableSource({
        tasks: [{ path: 'dep.md', blockedBy: [{ uid: '[[pred]]', reltype: 'FINISHTOSTART' }] }],
      });
      await source.addDependency('dep.md', 'pred.md', 'FINISHTOSTART');
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('forwards the MutationContext to tasks.update', async () => {
      const { source, updateSpy } = await makeWritableSource({ tasks: [{ path: 'dep.md' }] });
      const ctx = { correlationId: 'abc' };
      await source.addDependency('dep.md', 'pred.md', 'FINISHTOSTART', ctx);
      expect(updateSpy.mock.calls[0]![2]).toBe(ctx);
    });
  });

  describe('removeDependency', () => {
    it('filters the matching edge and preserves the rest', async () => {
      const { source, updateSpy } = await makeWritableSource({
        tasks: [{ path: 'dep.md', blockedBy: [
          { uid: '[[pred]]', reltype: 'FINISHTOSTART' },
          { uid: '[[keep]]', reltype: 'STARTTOSTART' },
        ] }],
      });
      await source.removeDependency('dep.md', 'pred.md');
      const [, updates] = updateSpy.mock.calls[0]!;
      expect((updates as { blockedBy: unknown[] }).blockedBy).toEqual([
        { uid: '[[keep]]', reltype: 'STARTTOSTART' },
      ]);
    });

    it('writes undefined when removing the last edge', async () => {
      const { source, updateSpy } = await makeWritableSource({
        tasks: [{ path: 'dep.md', blockedBy: [{ uid: '[[pred]]', reltype: 'FINISHTOSTART' }] }],
      });
      await source.removeDependency('dep.md', 'pred.md');
      expect((updateSpy.mock.calls[0]![1] as { blockedBy: unknown }).blockedBy).toBeUndefined();
    });

    it('is a no-op when no edge matches the predecessor', async () => {
      const { source, updateSpy } = await makeWritableSource({
        tasks: [{ path: 'dep.md', blockedBy: [{ uid: '[[other]]', reltype: 'FINISHTOSTART' }] }],
      });
      await source.removeDependency('dep.md', 'pred.md');
      expect(updateSpy).not.toHaveBeenCalled();
    });
  });
});

describe('TaskNotesSource — getStatusColors', () => {
  async function makeSource(opts: FakeApiOptions): Promise<TaskNotesSource> {
    const { api } = makeApi(opts);
    const source = await TaskNotesSource.create(makeApp(api));
    if (!source) throw new Error('expected a source');
    return source;
  }

  it('maps catalog.statuses() to StatusColor[], keeping value+color', async () => {
    const source = await makeSource({
      statuses: [
        { value: '11🟥Active = Now', label: '🟥Active', color: '#f8312f', isCompleted: false },
        { value: '41🟩Done = Recent', label: '🟩Done', color: '#00d26a', isCompleted: true },
      ],
    });

    expect(await source.getStatusColors()).toEqual([
      { value: '11🟥Active = Now', color: '#f8312f', isCompleted: false },
      { value: '41🟩Done = Recent', color: '#00d26a', isCompleted: true },
    ]);
  });

  it('drops entries missing a value or a color', async () => {
    const source = await makeSource({
      statuses: [{ value: 'ok', color: '#fff' }, { value: 'no-color' }, { color: '#000' }],
    });

    expect(await source.getStatusColors()).toEqual([
      { value: 'ok', color: '#fff', isCompleted: false },
    ]);
  });

  it('falls back to model.config().statuses when catalog is absent', async () => {
    const { api } = makeApi({});
    api.model = {
      config: () => ({ statuses: [{ value: 'X', color: '#abc', isCompleted: false }] }),
    };
    const source = await TaskNotesSource.create(makeApp(api));
    expect(await source!.getStatusColors()).toEqual([
      { value: 'X', color: '#abc', isCompleted: false },
    ]);
  });

  it('returns [] when no status source is exposed', async () => {
    const source = await makeSource({}); // no statuses ⇒ neither catalog nor model

    expect(await source.getStatusColors()).toEqual([]);
  });

  it('returns [] when the status accessor throws', async () => {
    const { api } = makeApi({});
    api.catalog = {
      statuses: () => {
        throw new Error('boom');
      },
    };
    const source = await TaskNotesSource.create(makeApp(api));
    expect(await source!.getStatusColors()).toEqual([]);
  });

  it('carries an icon when the status config has one, omits it otherwise', async () => {
    const source = await makeSource({
      statuses: [
        { value: 'todo', color: '#fff', icon: 'circle' },
        { value: 'done', color: '#0f0', isCompleted: true },
      ],
    });

    expect(await source.getStatusColors()).toEqual([
      { value: 'todo', color: '#fff', isCompleted: false, icon: 'circle' },
      { value: 'done', color: '#0f0', isCompleted: true },
    ]);
  });
});

describe('TaskNotesSource — getPriorityColors', () => {
  async function makeSource(opts: FakeApiOptions): Promise<TaskNotesSource> {
    const { api } = makeApi(opts);
    const source = await TaskNotesSource.create(makeApp(api));
    if (!source) throw new Error('expected a source');
    return source;
  }

  it('maps catalog.priorities() to PriorityColor[], keeping value+color', async () => {
    const source = await makeSource({
      priorities: [
        { value: 'high', label: 'High', color: '#ff0000' },
        { value: 'low', label: 'Low', color: '#00aaff' },
      ],
    });

    expect(await source.getPriorityColors()).toEqual([
      { value: 'high', color: '#ff0000' },
      { value: 'low', color: '#00aaff' },
    ]);
  });

  it('carries an icon when the priority config has one', async () => {
    const source = await makeSource({
      priorities: [{ value: 'high', color: '#f00', icon: 'flag' }, { value: 'mid', color: '#fa0' }],
    });

    expect(await source.getPriorityColors()).toEqual([
      { value: 'high', color: '#f00', icon: 'flag' },
      { value: 'mid', color: '#fa0' },
    ]);
  });

  it('drops entries missing a value or a color', async () => {
    const source = await makeSource({
      priorities: [{ value: 'ok', color: '#fff' }, { value: 'no-color' }, { color: '#000' }],
    });

    expect(await source.getPriorityColors()).toEqual([{ value: 'ok', color: '#fff' }]);
  });

  it('falls back to model.config().priorities when catalog is absent', async () => {
    const { api } = makeApi({});
    api.model = {
      config: () => ({ priorities: [{ value: 'high', color: '#abc' }] }),
    };
    const source = await TaskNotesSource.create(makeApp(api));
    expect(await source!.getPriorityColors()).toEqual([{ value: 'high', color: '#abc' }]);
  });

  it('returns [] when no priority source is exposed', async () => {
    const source = await makeSource({});
    expect(await source.getPriorityColors()).toEqual([]);
  });

  it('returns [] when the priority accessor throws', async () => {
    const { api } = makeApi({});
    api.catalog = {
      priorities: () => {
        throw new Error('boom');
      },
    };
    const source = await TaskNotesSource.create(makeApp(api));
    expect(await source!.getPriorityColors()).toEqual([]);
  });
});

describe('TaskNotesSource — getFieldConfig (U1)', () => {
  /** Build an api whose model.config() returns the given fieldMapping + userFields. */
  function makeConfigApi(config: {
    fieldMapping?: Record<string, string>;
    userFields?: Array<{ enabled?: boolean; displayName?: string; key?: string; id?: string; type?: string }>;
  } | null) {
    const { api } = makeApi({});
    api.model = { config: () => (config as { statuses?: never } | null) ?? null };
    return api;
  }

  async function fieldConfigFrom(config: Parameters<typeof makeConfigApi>[0]) {
    const source = await TaskNotesSource.create(makeApp(makeConfigApi(config)));
    if (!source) throw new Error('expected a source');
    return source.getFieldConfig();
  }

  it('returns the configured scheduled/due property names and date custom fields', async () => {
    // Persisted TaskNotes userFields carry NO `enabled` flag (matches data.json):
    // their presence means active. Only an explicit `enabled: false` is excluded.
    const cfg = await fieldConfigFrom({
      fieldMapping: { scheduled: 'scheduled', due: 'due' },
      userFields: [
        { type: 'date', key: 'start', id: 'fld_start', displayName: 'Start' },
        { type: 'text', key: 'notes', id: 'fld_notes', displayName: 'Notes' },
        { enabled: false, type: 'date', key: 'old', id: 'fld_old', displayName: 'Old' },
      ],
    });

    expect(cfg).toEqual({
      scheduledProp: 'scheduled',
      dueProp: 'due',
      dateFields: [{ key: 'start', id: 'fld_start', displayName: 'Start' }],
    });
  });

  it('includes a date field that has no `enabled` key (real TaskNotes settings shape)', async () => {
    // Regression for the bug where requiring `enabled === true` dropped every
    // field, since persisted userFields omit `enabled` entirely.
    const cfg = await fieldConfigFrom({
      fieldMapping: { scheduled: 'scheduled', due: 'due' },
      userFields: [{ type: 'date', key: 'start', id: 'fld_1756287909511', displayName: 'Start' }],
    });

    expect(cfg?.dateFields).toEqual([
      { key: 'start', id: 'fld_1756287909511', displayName: 'Start' },
    ]);
  });

  it('honors TaskNotes-remapped scheduled/due property names', async () => {
    const cfg = await fieldConfigFrom({
      fieldMapping: { scheduled: 'tn_scheduled', due: 'tn_deadline' },
      userFields: [],
    });

    expect(cfg?.scheduledProp).toBe('tn_scheduled');
    expect(cfg?.dueProp).toBe('tn_deadline');
    expect(cfg?.dateFields).toEqual([]);
  });

  it('yields null props and empty dateFields when fieldMapping/userFields are absent', async () => {
    const cfg = await fieldConfigFrom({});

    expect(cfg).toEqual({ scheduledProp: null, dueProp: null, dateFields: [] });
  });

  it('drops date fields missing a key (cannot address the frontmatter property)', async () => {
    const cfg = await fieldConfigFrom({
      fieldMapping: { scheduled: 's', due: 'd' },
      userFields: [
        { enabled: true, type: 'date', id: 'uf_x', displayName: 'No Key' },
        { enabled: true, type: 'date', key: 'good', id: 'uf_good', displayName: 'Good' },
      ],
    });

    expect(cfg?.dateFields).toEqual([{ key: 'good', id: 'uf_good', displayName: 'Good' }]);
  });

  it('returns null when model.config() throws (graceful)', async () => {
    const { api } = makeApi({});
    api.model = {
      config: () => {
        throw new Error('boom');
      },
    };
    const source = await TaskNotesSource.create(makeApp(api));
    expect(await source!.getFieldConfig()).toBeNull();
  });

  it('returns null when the api exposes no model.config', async () => {
    const source = await TaskNotesSource.create(makeApp(makeApi({}).api));
    expect(await source!.getFieldConfig()).toBeNull();
  });
});

describe('TaskNotesSource', () => {
  describe('create() / readiness', () => {
    it('resolves a source when TaskNotes is present, ready, and compatible', async () => {
      // Arrange
      const ready = jest.fn(() => Promise.resolve());
      const { api } = makeApi({ apiVersion: 1, ready });
      const app = makeApp(api);

      // Act
      const source = await TaskNotesSource.create(app);

      // Assert
      expect(source).toBeInstanceOf(TaskNotesSource);
      expect(ready).toHaveBeenCalledTimes(1);
    });

    it('returns null when TaskNotes is not installed (getPlugin → undefined)', async () => {
      // Arrange
      const app = makeApp(undefined);

      // Act / Assert
      expect(await TaskNotesSource.create(app)).toBeNull();
    });

    it('returns null when the plugin exposes no api', async () => {
      // Arrange — plugin present but api undefined
      const app = {
        plugins: { getPlugin: () => ({}) },
      } as unknown as App;

      // Act / Assert
      expect(await TaskNotesSource.create(app)).toBeNull();
    });

    it('returns null on an incompatible apiVersion', async () => {
      // Arrange
      const { api } = makeApi({ apiVersion: 0 });
      const app = makeApp(api);

      // Act / Assert
      expect(await TaskNotesSource.create(app)).toBeNull();
    });

    it('returns null when apiVersion is missing', async () => {
      // Arrange
      const { api } = makeApi();
      delete api.apiVersion;
      const app = makeApp(api);

      // Act / Assert
      expect(await TaskNotesSource.create(app)).toBeNull();
    });

    it('returns null (does not throw) when lifecycle.ready() rejects', async () => {
      // Arrange
      const { api } = makeApi({
        ready: () => Promise.reject(new Error('not ready')),
      });
      const app = makeApp(api);

      // Act / Assert
      await expect(TaskNotesSource.create(app)).resolves.toBeNull();
    });

    it('returns null (does not throw) when plugin resolution throws', async () => {
      // Arrange
      const app = {
        plugins: {
          getPlugin: () => {
            throw new Error('registry blew up');
          },
        },
      } as unknown as App;

      // Act / Assert
      await expect(TaskNotesSource.create(app)).resolves.toBeNull();
    });
  });

  describe('getTasks()', () => {
    it('maps TaskInfo to SourceTask with raw Date dates, null progress, status', async () => {
      // Arrange
      const scheduled = new Date('2026-04-02');
      const due = new Date('2026-04-20');
      const { api } = makeApi({
        tasks: [
          {
            path: 'tasks/a.md',
            title: 'Task A',
            status: 'in-progress',
            scheduled,
            due,
          },
        ],
      });
      const app = makeApp(api);
      const source = await TaskNotesSource.create(app);

      // Act
      const [task] = await source!.getTasks();

      // Assert
      expect(task.path).toBe('tasks/a.md');
      expect(task.text).toBe('Task A');
      expect(task.start).toBeInstanceOf(Date);
      expect(task.end).toBeInstanceOf(Date);
      expect(task.start?.getTime()).toBe(scheduled.getTime());
      expect(task.end?.getTime()).toBe(due.getTime());
      // TaskNotes has no numeric progress field.
      expect(task.progress).toBeNull();
      expect(task.status).toBe('in-progress');
      // No confirmed parent/project edge in this unit.
      expect(task.parents).toEqual([]);
    });

    it('maps priority (and null when unset)', async () => {
      const { api } = makeApi({
        tasks: [
          { path: 'a.md', title: 'A', priority: 'high' },
          { path: 'b.md', title: 'B' },
        ],
      });
      const source = await TaskNotesSource.create(makeApp(api));

      const [a, b] = await source!.getTasks();

      expect(a.priority).toBe('high');
      expect(b.priority).toBeNull();
    });

    it('parses date strings into raw Date values', async () => {
      // Arrange
      const { api } = makeApi({
        tasks: [{ path: 't.md', title: 'T', scheduled: '2026-05-01', due: '2026-05-10' }],
      });
      const source = await TaskNotesSource.create(makeApp(api));

      // Act
      const [task] = await source!.getTasks();

      // Assert
      expect(task.start).toBeInstanceOf(Date);
      expect(task.end).toBeInstanceOf(Date);
      expect(typeof task.start).not.toBe('string');
    });

    it('yields null (not a fabricated date) for missing/unparseable dates', async () => {
      // Arrange — unscheduled task, plus a garbage date
      const { api } = makeApi({
        tasks: [{ path: 'backlog/x.md', title: 'X', scheduled: null, due: 'not-a-date' }],
      });
      const source = await TaskNotesSource.create(makeApp(api));

      // Act
      const [task] = await source!.getTasks();

      // Assert
      expect(task.start).toBeNull();
      expect(task.end).toBeNull();
    });

    it('falls back to empty text when title is absent', async () => {
      // Arrange
      const { api } = makeApi({ tasks: [{ path: 't.md' }] });
      const source = await TaskNotesSource.create(makeApp(api));

      // Act
      const [task] = await source!.getTasks();

      // Assert
      expect(task.text).toBe('');
      expect(task.status).toBeNull();
    });

    it('returns [] when tasks.list throws (graceful)', async () => {
      // Arrange
      const { api } = makeApi();
      api.tasks!.list = () => {
        throw new Error('boom');
      };
      const source = await TaskNotesSource.create(makeApp(api));

      // Act / Assert
      expect(await source!.getTasks()).toEqual([]);
    });
  });

  describe('getDependencies()', () => {
    it('maps a FINISHTOSTART blockedBy edge to the FINISHTOSTART reltype with gap (AE3)', async () => {
      // Arrange
      const { api } = makeApi({
        dependencies: {
          'tasks/b.md': [
            { path: 'tasks/a.md', reltype: 'FINISHTOSTART', gap: 'P1D' },
          ],
        },
      });
      const source = await TaskNotesSource.create(makeApp(api));

      // Act
      const deps = await source!.getDependencies('tasks/b.md');

      // Assert
      expect(deps).toEqual([
        { predecessorPath: 'tasks/a.md', reltype: 'FINISHTOSTART', gap: 'P1D' },
      ]);
    });

    it('maps all four reltypes and defaults gap to null', async () => {
      // Arrange
      const { api } = makeApi({
        dependencies: {
          'x.md': [
            { path: 'p1.md', reltype: 'FINISHTOSTART' },
            { path: 'p2.md', reltype: 'FINISHTOFINISH' },
            { path: 'p3.md', reltype: 'STARTTOSTART' },
            { path: 'p4.md', reltype: 'STARTTOFINISH' },
          ],
        },
      });
      const source = await TaskNotesSource.create(makeApp(api));

      // Act
      const deps = await source!.getDependencies('x.md');

      // Assert
      expect(deps.map((d) => d.reltype)).toEqual([
        'FINISHTOSTART',
        'FINISHTOFINISH',
        'STARTTOSTART',
        'STARTTOFINISH',
      ]);
      expect(deps.every((d) => d.gap === null)).toBe(true);
    });

    it('reads the live nested shape ({ dependency: { reltype, gap, uid }, path }) (4.11.0)', async () => {
      // The real TaskNotes API nests reltype/gap under `dependency` and puts the
      // resolved predecessor at top-level `path`. Verified against 4.11.0 via the
      // dependency e2e; the flat shape above is a fallback for older payloads.
      const { api } = makeApi({
        dependencies: {
          'x.md': [
            {
              dependency: { uid: 'Spec', reltype: 'STARTTOSTART', gap: 'P2D' },
              path: 'Spec.md',
            } as TaskNotesDependencyEdge,
          ],
        },
      });
      const source = await TaskNotesSource.create(makeApp(api));

      const deps = await source!.getDependencies('x.md');

      expect(deps).toEqual([
        { predecessorPath: 'Spec.md', reltype: 'STARTTOSTART', gap: 'P2D' },
      ]);
    });

    it('resolves the predecessor from uid when path is absent', async () => {
      // Arrange
      const { api } = makeApi({
        dependencies: { 'x.md': [{ uid: 'tasks/a.md', reltype: 'STARTTOSTART' }] },
      });
      const source = await TaskNotesSource.create(makeApp(api));

      // Act
      const [dep] = await source!.getDependencies('x.md');

      // Assert
      expect(dep.predecessorPath).toBe('tasks/a.md');
    });

    it('drops edges with an unknown reltype or no predecessor', async () => {
      // Arrange
      const { api } = makeApi({
        dependencies: {
          'x.md': [
            { path: 'good.md', reltype: 'FINISHTOSTART' },
            { path: 'bad.md', reltype: 'SOMETHING_ELSE' },
            { reltype: 'FINISHTOSTART' }, // no predecessor
          ],
        },
      });
      const source = await TaskNotesSource.create(makeApp(api));

      // Act
      const deps = await source!.getDependencies('x.md');

      // Assert
      expect(deps).toEqual([
        { predecessorPath: 'good.md', reltype: 'FINISHTOSTART', gap: null },
      ]);
    });

    it('returns [] when relationships.dependencies throws (graceful)', async () => {
      // Arrange
      const { api } = makeApi();
      api.relationships!.dependencies = () => {
        throw new Error('boom');
      };
      const source = await TaskNotesSource.create(makeApp(api));

      // Act / Assert
      expect(await source!.getDependencies('x.md')).toEqual([]);
    });
  });

  describe('relationships — relationship index / parents (plan #161 U1)', () => {
    it('getRelationshipIndex inverts parents over the task list into childrenByPath + parentsByPath', async () => {
      // P.md is the parent of child-a + child-b; getRelationshipIndex lists all
      // tasks, resolves each task's parents, and inverts into children.
      const { api } = makeApi({
        tasks: [
          { path: 'P.md', title: 'Parent' },
          { path: 'child-a.md', title: 'Child A', scheduled: '2026-01-01', due: '2026-01-05', status: 'open' },
          { path: 'child-b.md', title: 'Child B' },
        ],
        parents: {
          'child-a.md': [{ path: 'P.md' }],
          'child-b.md': [{ path: 'P.md' }],
        },
      });
      const source = await TaskNotesSource.create(makeApp(api));
      const index = await source!.getRelationshipIndex();

      const children = index.childrenByPath.get('P.md') ?? [];
      expect(children.map((c) => c.path).sort()).toEqual(['child-a.md', 'child-b.md']);
      // Children are mapped to raw SourceTasks (dates parsed, parents owned by resolver).
      const childA = children.find((c) => c.path === 'child-a.md')!;
      expect(childA).toMatchObject({ text: 'Child A', status: 'open', progress: null, parents: [] });
      expect(childA.start).toBeInstanceOf(Date);
      expect(childA.end).toBeInstanceOf(Date);

      expect(index.parentsByPath.get('child-a.md')).toEqual(['P.md']);
      expect(index.parentsByPath.get('child-b.md')).toEqual(['P.md']);
      // Childless / parentless tasks are absent from the respective maps.
      expect(index.childrenByPath.has('child-a.md')).toBe(false);
      expect(index.parentsByPath.has('P.md')).toBe(false);
    });

    it('getRelationshipIndex records multi-parent children under each parent', async () => {
      const { api } = makeApi({
        tasks: [{ path: 'P1.md' }, { path: 'P2.md' }, { path: 'C.md' }],
        parents: { 'C.md': [{ path: 'P1.md' }, { path: 'P2.md' }] },
      });
      const source = await TaskNotesSource.create(makeApp(api));
      const index = await source!.getRelationshipIndex();
      expect(index.childrenByPath.get('P1.md')!.map((c) => c.path)).toEqual(['C.md']);
      expect(index.childrenByPath.get('P2.md')!.map((c) => c.path)).toEqual(['C.md']);
      expect(index.parentsByPath.get('C.md')).toEqual(['P1.md', 'P2.md']);
    });

    it('getRelationshipIndex signals NOT-READY (null) when the task list is empty / cold (cache-poisoning guard #161)', async () => {
      // An empty task list means TaskNotes' metadataCache scan has not warmed
      // yet (api.tasks.list → getAllTasks scans Obsidian's metadataCache, which
      // can be cold at view-mount — notably on a warm restart that loads the
      // persisted cache WITHOUT firing per-file change events, so no task.* event
      // ever invalidates a stale read). Returning a non-null empty index here
      // would let the controller cache the cold read and stick Show-all at the
      // matched-only count forever. null = "not ready, retry next build".
      const empty = await TaskNotesSource.create(makeApp(makeApi({ tasks: [] }).api));
      const idx = await empty!.getRelationshipIndex();
      expect(idx).toBeNull();
    });

    it('getRelationshipIndex is READY (non-null, empty maps) when ≥1 task exists with no relationships', async () => {
      // A warm task list with zero parent/child edges is AUTHORITATIVE, not cold:
      // it returns a non-null index with empty maps so the controller caches it
      // and never re-runs the full-vault scan. This is the no-relationships-vault
      // storm guard — the signal distinguishes "cold" (0 tasks) from "genuinely
      // empty" (≥1 task, no edges), so the latter is not re-fetched on every notify.
      const { api } = makeApi({ tasks: [{ path: 'a.md' }, { path: 'b.md' }] });
      const source = await TaskNotesSource.create(makeApp(api));
      const idx = await source!.getRelationshipIndex();
      expect(idx).not.toBeNull();
      expect(idx!.childrenByPath.size).toBe(0);
      expect(idx!.parentsByPath.size).toBe(0);
    });

    it('getRelationshipIndex degrades gracefully when parents resolution throws', async () => {
      const { api } = makeApi({ tasks: [{ path: 'a.md' }], parents: { 'a.md': [] } });
      api.relationships!.parents = () => {
        throw new Error('boom');
      };
      const source = await TaskNotesSource.create(makeApp(api));
      const idx = await source!.getRelationshipIndex();
      // getParents swallows the throw → no parents → empty inversion, no throw.
      // The task list is non-empty, so the index is still READY (non-null).
      expect(idx).not.toBeNull();
      expect(idx!.childrenByPath.size).toBe(0);
      expect(idx!.parentsByPath.size).toBe(0);
    });

    it('getParents returns resolved parent paths, filtering junk', async () => {
      const { api } = makeApi({
        parents: {
          'child.md': [{ path: 'p1.md' }, { title: 'no path' } as TaskNotesTaskInfo, { path: 'p2.md' }],
        },
      });
      const source = await TaskNotesSource.create(makeApp(api));
      expect(await source!.getParents('child.md')).toEqual(['p1.md', 'p2.md']);
    });

    it('getParents returns [] when the accessor is absent', async () => {
      const source = await TaskNotesSource.create(makeApp(makeApi().api));
      expect(await source!.getParents('x.md')).toEqual([]);
    });

    it('getParents returns [] when the accessor throws', async () => {
      const { api } = makeApi({ parents: { 'x.md': [] } });
      api.relationships!.parents = () => {
        throw new Error('boom');
      };
      const throwing = await TaskNotesSource.create(makeApp(api));
      expect(await throwing!.getParents('x.md')).toEqual([]);
    });

    it('getParents returns [] when the accessor returns a non-array', async () => {
      const { api } = makeApi({ parents: { 'x.md': [] } });
      api.relationships!.parents = (() => null) as unknown as typeof api.relationships.parents;
      const bad = await TaskNotesSource.create(makeApp(api));
      expect(await bad!.getParents('x.md')).toEqual([]);
    });

    it('subscribes to task.projects.changed for hierarchy freshness', async () => {
      expect(TASKNOTES_CHANGE_EVENTS).toContain('task.projects.changed');
      const { api, onSpy } = makeApi();
      const source = await TaskNotesSource.create(makeApp(api));
      const off = source!.subscribe(() => {});
      const names = onSpy.mock.calls.map((c) => c[0]);
      expect(names).toContain('task.projects.changed');
      off();
    });
  });

  describe('capability sequencing', () => {
    it('supportsWrite() is true when hasCapability("tasks.write") is true', async () => {
      // Arrange
      const { api } = makeApi({ hasWrite: true });
      const source = await TaskNotesSource.create(makeApp(api));

      // Act / Assert
      expect(source!.supportsWrite()).toBe(true);
    });

    it('supportsWrite() is false when hasCapability("tasks.write") is false', async () => {
      // Arrange
      const { api } = makeApi({ hasWrite: false });
      const source = await TaskNotesSource.create(makeApp(api));

      // Act / Assert
      expect(source!.supportsWrite()).toBe(false);
    });

    it('supportsWrite() is false (guarded) when hasCapability is absent', async () => {
      // Arrange
      const { api } = makeApi({ omitHasCapability: true });
      const source = await TaskNotesSource.create(makeApp(api));

      // Act / Assert
      expect(source!.supportsWrite()).toBe(false);
    });

    it('capabilities.write reflects supportsWrite() (U8): true when TaskNotes grants tasks.write', async () => {
      // Arrange
      const writable = await TaskNotesSource.create(makeApp(makeApi({ hasWrite: true }).api));
      const readonly = await TaskNotesSource.create(makeApp(makeApi({ hasWrite: false }).api));

      // Assert — the composite/controller derive read-only truth from this flag.
      expect(writable!.capabilities.write).toBe(true);
      expect(readonly!.capabilities.write).toBe(false);
    });
  });

  describe('write path — mutate() / deleteTask() (U8)', () => {
    it('mutate() maps a dates-only patch to a single tasks.update with yyyy-MM-dd scheduled/due', async () => {
      // Arrange
      const { api, updateSpy } = makeApi({ hasWrite: true });
      const source = await TaskNotesSource.create(makeApp(api));

      // Act — a drag commit carries day-snapped local-midnight Dates.
      await source!.mutate(
        'tasks/a.md',
        { start: new Date(2026, 3, 2), end: new Date(2026, 3, 20) },
        { source: 'obsidian-gantt', correlationId: 'c1' },
      );

      // Assert — exactly one atomic update, dates formatted, context forwarded.
      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy).toHaveBeenCalledWith(
        'tasks/a.md',
        { scheduled: '2026-04-02', due: '2026-04-20' },
        { source: 'obsidian-gantt', correlationId: 'c1' },
      );
    });

    it('mutate() writes only the fields present in the patch (no clobbering)', async () => {
      // Arrange
      const { api, updateSpy } = makeApi({ hasWrite: true });
      const source = await TaskNotesSource.create(makeApp(api));

      // Act — a modal Save touching title + status only.
      await source!.mutate('t.md', { text: 'Renamed', status: 'done' });

      // Assert — scheduled/due absent (not nulled), title/status mapped.
      expect(updateSpy).toHaveBeenCalledWith(
        't.md',
        { title: 'Renamed', status: 'done' },
        undefined,
      );
    });

    it('mutate() forwards an explicit null date to clear the field', async () => {
      // Arrange
      const { api, updateSpy } = makeApi({ hasWrite: true });
      const source = await TaskNotesSource.create(makeApp(api));

      // Act
      await source!.mutate('t.md', { start: null });

      // Assert
      expect(updateSpy).toHaveBeenCalledWith('t.md', { scheduled: null }, undefined);
    });

    it('mutate() does NOT persist a bare progress value with no resolved write target (safety)', async () => {
      // Arrange
      const { api, updateSpy } = makeApi({ hasWrite: true });
      const source = await TaskNotesSource.create(makeApp(api));

      // Act — progress with no progressWrite target (e.g. tasknotes mode / no property)
      await source!.mutate('t.md', { progress: 50, status: 'doing' });

      // Assert — progress is dropped; only status is written.
      expect(updateSpy).toHaveBeenCalledWith('t.md', { status: 'doing' }, undefined);
    });

    it('mutate() persists a resolved progress write to the mapped property, clamped and rounded (U6/R9/R10)', async () => {
      // Arrange
      const { api, updateSpy } = makeApi({ hasWrite: true });
      const source = await TaskNotesSource.create(makeApp(api));

      // Act — above-range value; write target resolved to the bare frontmatter key
      await source!.mutate('t.md', { progress: 117, progressWrite: { key: 'progress' } });

      // Assert — coalesced to 100 and written to the property key
      expect(updateSpy).toHaveBeenCalledWith('t.md', { progress: 100 }, undefined);
    });

    it('mutate() coalesces a below-range progress to 0 and rounds fractional values', async () => {
      // Arrange
      const { api, updateSpy } = makeApi({ hasWrite: true });
      const source = await TaskNotesSource.create(makeApp(api));

      // Act / Assert — below 0 → 0
      await source!.mutate('t.md', { progress: -5, progressWrite: { key: 'pct' } });
      expect(updateSpy).toHaveBeenLastCalledWith('t.md', { pct: 0 }, undefined);

      // fractional → nearest integer
      await source!.mutate('t.md', { progress: 62.4, progressWrite: { key: 'pct' } });
      expect(updateSpy).toHaveBeenLastCalledWith('t.md', { pct: 62 }, undefined);
    });

    it('mutate() writes nothing for progress when the value is absent even if a target is present', async () => {
      // Arrange
      const { api, updateSpy } = makeApi({ hasWrite: true });
      const source = await TaskNotesSource.create(makeApp(api));

      // Act — target but no value (should not write the key)
      await source!.mutate('t.md', { progressWrite: { key: 'progress' }, status: 'doing' });

      // Assert — only status; no progress key
      expect(updateSpy).toHaveBeenCalledWith('t.md', { status: 'doing' }, undefined);
    });

    it('mutate() does not let a progress write clobber other patched fields', async () => {
      // Arrange
      const { api, updateSpy } = makeApi({ hasWrite: true });
      const source = await TaskNotesSource.create(makeApp(api));

      // Act
      await source!.mutate('t.md', {
        progress: 40,
        progressWrite: { key: 'progress' },
        status: 'doing',
      });

      // Assert — both the progress key and status are written
      expect(updateSpy).toHaveBeenCalledWith('t.md', { progress: 40, status: 'doing' }, undefined);
    });

    it('mutate() propagates a write failure (so the controller can revert + Notice)', async () => {
      // Arrange
      const { api, updateSpy } = makeApi({ hasWrite: true });
      updateSpy.mockRejectedValueOnce(new Error('disk full'));
      const source = await TaskNotesSource.create(makeApp(api));

      // Act / Assert — writes must NOT swallow errors like the read paths do.
      await expect(source!.mutate('t.md', { status: 'x' })).rejects.toThrow('disk full');
    });

    it('deleteTask() calls tasks.delete with the path and context', async () => {
      // Arrange
      const { api, deleteSpy } = makeApi({ hasWrite: true });
      const source = await TaskNotesSource.create(makeApp(api));

      // Act
      await source!.deleteTask('tasks/a.md', { source: 'obsidian-gantt', correlationId: 'd1' });

      // Assert
      expect(deleteSpy).toHaveBeenCalledWith('tasks/a.md', {
        source: 'obsidian-gantt',
        correlationId: 'd1',
      });
    });

    it('applies a scheduled dateWrite to updates.scheduled (yyyy-MM-dd)', async () => {
      const { api, updateSpy } = makeApi({ hasWrite: true });
      const source = await TaskNotesSource.create(makeApp(api));

      await source!.mutate('t.md', {
        dateWrites: [{ target: { kind: 'scheduled' }, value: new Date(2026, 5, 17) }],
      });

      expect(updateSpy).toHaveBeenCalledWith('t.md', { scheduled: '2026-06-17' }, undefined);
    });

    it('applies a due dateWrite to updates.due', async () => {
      const { api, updateSpy } = makeApi({ hasWrite: true });
      const source = await TaskNotesSource.create(makeApp(api));

      await source!.mutate('t.md', {
        dateWrites: [{ target: { kind: 'due' }, value: new Date(2026, 6, 4) }],
      });

      expect(updateSpy).toHaveBeenCalledWith('t.md', { due: '2026-07-04' }, undefined);
    });

    it('applies a userField dateWrite as a top-level key by frontmatter key (not userFields/id)', async () => {
      const { api, updateSpy } = makeApi({ hasWrite: true });
      const source = await TaskNotesSource.create(makeApp(api));

      await source!.mutate('t.md', {
        dateWrites: [
          { target: { kind: 'userField', key: 'start', id: 'uf_start' }, value: new Date(2026, 5, 1) },
        ],
      });

      // TaskNotes' mapToFrontmatter reads custom-field values from the TOP LEVEL
      // of updates by the field's frontmatter `key` (confirmed vs 4.11.0:
      // `d=e; d[u.key]`). NOT a userFields object, NOT by id.
      expect(updateSpy).toHaveBeenCalledWith('t.md', { start: '2026-06-01' }, undefined);
    });

    it('merges multiple dateWrites into one atomic update', async () => {
      const { api, updateSpy } = makeApi({ hasWrite: true });
      const source = await TaskNotesSource.create(makeApp(api));

      await source!.mutate('t.md', {
        dateWrites: [
          { target: { kind: 'userField', key: 'start', id: 'uf_start' }, value: new Date(2026, 5, 1) },
          { target: { kind: 'due' }, value: new Date(2026, 6, 4) },
        ],
      });

      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy).toHaveBeenCalledWith(
        't.md',
        { due: '2026-07-04', start: '2026-06-01' },
        undefined,
      );
    });

    it('forwards a null dateWrite value to clear the target', async () => {
      const { api, updateSpy } = makeApi({ hasWrite: true });
      const source = await TaskNotesSource.create(makeApp(api));

      await source!.mutate('t.md', {
        dateWrites: [
          { target: { kind: 'scheduled' }, value: null },
          { target: { kind: 'userField', key: 'start', id: 'uf_start' }, value: null },
        ],
      });

      expect(updateSpy).toHaveBeenCalledWith('t.md', { scheduled: null, start: null }, undefined);
    });

    it('mutate() throws when the api exposes no update method', async () => {
      // Arrange
      const { api } = makeApi({ hasWrite: true });
      delete api.tasks!.update;
      const source = await TaskNotesSource.create(makeApp(api));

      // Act / Assert
      await expect(source!.mutate('t.md', { status: 'x' })).rejects.toThrow();
    });
  });

  describe('subscribe()', () => {
    it('registers a handler for every change event and fires it on emit', async () => {
      // Arrange
      const { api, onSpy, handlers } = makeApi();
      const source = await TaskNotesSource.create(makeApp(api));
      const received: Array<{ name: string; payload?: unknown }> = [];

      // Act
      source!.subscribe((name, payload) => received.push({ name, payload }));

      // Assert — one registration per known change event
      expect(onSpy).toHaveBeenCalledTimes(TASKNOTES_CHANGE_EVENTS.length);

      // Fire a task.updated event through the captured handler.
      const updated = [...handlers.values()].find((h) => h.name === 'task.updated');
      expect(updated).toBeDefined();
      updated!.fn({ path: 'tasks/a.md' });

      expect(received).toEqual([
        { name: 'task.updated', payload: { path: 'tasks/a.md' } },
      ]);
    });

    it('returns a disposer that unsubscribes all registered handlers', async () => {
      // Arrange
      const { api, offSpy, handlers } = makeApi();
      const source = await TaskNotesSource.create(makeApp(api));
      const dispose = source!.subscribe(() => undefined);
      expect(handlers.size).toBe(TASKNOTES_CHANGE_EVENTS.length);

      // Act
      dispose();

      // Assert
      expect(offSpy).toHaveBeenCalledTimes(TASKNOTES_CHANGE_EVENTS.length);
      expect(handlers.size).toBe(0);
    });

    it('a throwing consumer handler does not break the event bridge', async () => {
      // Arrange
      const { api, handlers } = makeApi();
      const source = await TaskNotesSource.create(makeApp(api));
      source!.subscribe(() => {
        throw new Error('consumer blew up');
      });
      const updated = [...handlers.values()].find((h) => h.name === 'task.updated');

      // Act / Assert — the bridge swallows the consumer error
      expect(() => updated!.fn()).not.toThrow();
    });
  });
});
