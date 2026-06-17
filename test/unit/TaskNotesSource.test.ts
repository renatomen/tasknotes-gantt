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
  hasWrite?: boolean;
  omitHasCapability?: boolean;
  /** When provided, `api.config()` returns `{ statuses }`; omitted ⇒ no `config`. */
  statuses?: Array<{ value?: string; label?: string; color?: string; isCompleted?: boolean }>;
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

  if (opts.statuses !== undefined) {
    api.catalog = { statuses: () => opts.statuses };
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
  } as unknown as App;
}

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

    it('mutate() does NOT persist progress in milestone 1 (deferred)', async () => {
      // Arrange
      const { api, updateSpy } = makeApi({ hasWrite: true });
      const source = await TaskNotesSource.create(makeApp(api));

      // Act
      await source!.mutate('t.md', { progress: 50, status: 'doing' });

      // Assert — progress is dropped; only status is written.
      expect(updateSpy).toHaveBeenCalledWith('t.md', { status: 'doing' }, undefined);
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
