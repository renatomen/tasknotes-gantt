/**
 * taskNotesManagedPaths unit tests (inline cell editing — per-row editability).
 *
 * Verifies the guarded view-layer resolver of TaskNotes-managed note paths:
 * managed = `api.tasks.get(path)` resolves task info. Degrades to an empty set
 * (nothing editable) when TaskNotes is absent, drifted, or throwing.
 */

import { describe, it, expect, jest } from '@jest/globals';
import type { App } from 'obsidian';
import { resolveManagedTaskPaths } from '../../src/bases/taskNotesManagedPaths';

function makeApp(
  get: ((path: string) => unknown) | undefined,
  opts: { present?: boolean } = {},
): App {
  const present = opts.present ?? true;
  const api = { tasks: get ? { get } : {} };
  return {
    plugins: {
      getPlugin: (id: string) => (present && id === 'tasknotes' ? { api } : undefined),
    },
  } as unknown as App;
}

describe('resolveManagedTaskPaths', () => {
  it('includes only the paths where TaskNotes resolves task info', async () => {
    const app = makeApp((path) =>
      path === 'tasks/a.md' ? Promise.resolve({ path }) : Promise.resolve(null),
    );
    const managed = await resolveManagedTaskPaths(app, ['tasks/a.md', 'notes/plain.md']);
    expect(managed.has('tasks/a.md')).toBe(true);
    expect(managed.has('notes/plain.md')).toBe(false);
  });

  it('queries each unique path once', async () => {
    const get = jest.fn((path: string) => Promise.resolve({ path }));
    const app = makeApp(get);
    await resolveManagedTaskPaths(app, ['a.md', 'a.md', 'b.md']);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('treats a per-path lookup failure as not managed', async () => {
    const app = makeApp((path) => {
      if (path === 'bad.md') throw new Error('boom');
      return Promise.resolve({ path });
    });
    const managed = await resolveManagedTaskPaths(app, ['good.md', 'bad.md']);
    expect(managed.has('good.md')).toBe(true);
    expect(managed.has('bad.md')).toBe(false);
  });

  it('returns an empty set when TaskNotes is absent', async () => {
    const managed = await resolveManagedTaskPaths(makeApp(() => ({}), { present: false }), ['a.md']);
    expect(managed.size).toBe(0);
  });

  it('returns an empty set when the tasks surface has drifted (no get)', async () => {
    const managed = await resolveManagedTaskPaths(makeApp(undefined), ['a.md']);
    expect(managed.size).toBe(0);
  });
});
