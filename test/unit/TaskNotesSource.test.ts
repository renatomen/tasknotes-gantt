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

  const api: TaskNotesApi = {
    apiVersion: opts.apiVersion ?? 1,
    lifecycle: {
      ready: opts.ready ?? (() => Promise.resolve()),
    },
    tasks: {
      list: () => opts.tasks ?? [],
      get: (path: string) =>
        (opts.tasks ?? []).find((t) => t.path === path) ?? null,
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

  return { api, onSpy, offSpy, handlers };
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

    it('keeps capabilities.write false and exposes no mutate/deleteTask in this unit', async () => {
      // Arrange — even when TaskNotes grants write, U4 does not wire writes.
      const { api } = makeApi({ hasWrite: true });
      const source = await TaskNotesSource.create(makeApp(api));

      // Assert
      expect(source!.capabilities.write).toBe(false);
      expect(
        (source as unknown as Partial<{ mutate: unknown }>).mutate
      ).toBeUndefined();
      expect(
        (source as unknown as Partial<{ deleteTask: unknown }>).deleteTask
      ).toBeUndefined();
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
