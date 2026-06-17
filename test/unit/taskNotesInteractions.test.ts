/**
 * U1: TaskNotes interaction service unit tests.
 *
 * - resolveClickIntent (pure): settings action + ctrl/meta → intent.
 * - TaskNotesInteractions dispatch: open note (current/new tab), open native
 *   edit modal (guarded internal, falls back to open-note), native context menu.
 *
 * All TaskNotes/Obsidian calls are mocked; the service is the single place that
 * touches them, so the Svelte view stays API-free.
 */

/* global MouseEvent */
import { describe, it, expect, jest } from '@jest/globals';
import type { App } from 'obsidian';
import {
  resolveClickIntent,
  TaskNotesInteractions,
} from '../../src/bases/taskNotesInteractions';

describe('resolveClickIntent (pure)', () => {
  it('ctrl/meta always opens the note in a new tab, regardless of action', () => {
    expect(resolveClickIntent({ action: 'edit', ctrlOrMeta: true })).toBe('openNoteNewTab');
    expect(resolveClickIntent({ action: 'openNote', ctrlOrMeta: true })).toBe('openNoteNewTab');
    expect(resolveClickIntent({ action: 'none', ctrlOrMeta: true })).toBe('openNoteNewTab');
  });

  it('maps the configured action when no modifier is held', () => {
    expect(resolveClickIntent({ action: 'edit', ctrlOrMeta: false })).toBe('editModal');
    expect(resolveClickIntent({ action: 'openNote', ctrlOrMeta: false })).toBe('openNote');
    expect(resolveClickIntent({ action: 'none', ctrlOrMeta: false })).toBe('none');
  });

  it('defaults to opening the note for an unset/unknown action', () => {
    expect(resolveClickIntent({ action: undefined, ctrlOrMeta: false })).toBe('openNote');
    expect(resolveClickIntent({ action: 'something-new', ctrlOrMeta: false })).toBe('openNote');
  });
});

/** Build a fake Obsidian App + TaskNotes plugin/api with captured spies. */
function makeEnv(opts: {
  present?: boolean;
  singleClickAction?: string;
  doubleClickAction?: string;
  hasEditModal?: boolean;
  editModalThrows?: boolean;
} = {}) {
  const present = opts.present !== false;
  const openFile = jest.fn(() => Promise.resolve());
  const getLeaf = jest.fn((_mode?: unknown) => ({ openFile }));
  const file = { path: 'tasks/a.md' };
  const getAbstractFileByPath = jest.fn((_p: string) => file);

  const taskMenuShow = jest.fn();
  const tasksGet = jest.fn((path: string) => Promise.resolve({ path, title: 'A' }));
  const openTaskEditModal = jest.fn(() => {
    if (opts.editModalThrows) throw new Error('modal boom');
    return undefined;
  });

  const api = {
    settings: {
      snapshot: () => ({
        singleClickAction: opts.singleClickAction,
        doubleClickAction: opts.doubleClickAction,
      }),
    },
    tasks: { get: tasksGet },
    ui: { taskMenu: { show: taskMenuShow } },
  };

  const plugin: Record<string, unknown> = { api };
  if (opts.hasEditModal !== false) {
    plugin.openTaskEditModal = openTaskEditModal;
  }

  const app = {
    plugins: { getPlugin: (id: string) => (present && id === 'tasknotes' ? plugin : undefined) },
    workspace: { getLeaf },
    vault: { getAbstractFileByPath },
  } as unknown as App;

  return { app, getLeaf, openFile, getAbstractFileByPath, taskMenuShow, tasksGet, openTaskEditModal };
}

describe('TaskNotesInteractions.handleActivate', () => {
  it('opens the note in the current tab for a single-click openNote action', async () => {
    const env = makeEnv({ singleClickAction: 'openNote' });
    await new TaskNotesInteractions(env.app).handleActivate('tasks/a.md', {
      kind: 'single',
      ctrlOrMeta: false,
    });

    expect(env.getAbstractFileByPath).toHaveBeenCalledWith('tasks/a.md');
    expect(env.getLeaf).toHaveBeenCalledWith(false); // current tab
    expect(env.openFile).toHaveBeenCalledTimes(1);
    expect(env.openTaskEditModal).not.toHaveBeenCalled();
  });

  it('opens the note in a new tab when ctrl/meta is held', async () => {
    const env = makeEnv({ singleClickAction: 'edit' }); // action overridden by modifier
    await new TaskNotesInteractions(env.app).handleActivate('tasks/a.md', {
      kind: 'single',
      ctrlOrMeta: true,
    });

    expect(env.getLeaf).toHaveBeenCalledWith('tab'); // new tab
    expect(env.openFile).toHaveBeenCalledTimes(1);
    expect(env.openTaskEditModal).not.toHaveBeenCalled();
  });

  it('opens the native edit modal for an edit action (via guarded plugin call)', async () => {
    const env = makeEnv({ singleClickAction: 'edit' });
    await new TaskNotesInteractions(env.app).handleActivate('tasks/a.md', {
      kind: 'single',
      ctrlOrMeta: false,
    });

    expect(env.tasksGet).toHaveBeenCalledWith('tasks/a.md');
    expect(env.openTaskEditModal).toHaveBeenCalledTimes(1);
    expect(env.openFile).not.toHaveBeenCalled();
  });

  it('reads the double-click action for a double-click', async () => {
    const env = makeEnv({ singleClickAction: 'none', doubleClickAction: 'edit' });
    await new TaskNotesInteractions(env.app).handleActivate('tasks/a.md', {
      kind: 'double',
      ctrlOrMeta: false,
    });

    expect(env.openTaskEditModal).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a none action', async () => {
    const env = makeEnv({ singleClickAction: 'none' });
    await new TaskNotesInteractions(env.app).handleActivate('tasks/a.md', {
      kind: 'single',
      ctrlOrMeta: false,
    });

    expect(env.openFile).not.toHaveBeenCalled();
    expect(env.openTaskEditModal).not.toHaveBeenCalled();
  });

  it('falls back to opening the note when openTaskEditModal is absent', async () => {
    const env = makeEnv({ singleClickAction: 'edit', hasEditModal: false });
    await new TaskNotesInteractions(env.app).handleActivate('tasks/a.md', {
      kind: 'single',
      ctrlOrMeta: false,
    });

    expect(env.openFile).toHaveBeenCalledTimes(1); // fell back
  });

  it('falls back to opening the note when openTaskEditModal throws', async () => {
    const env = makeEnv({ singleClickAction: 'edit', editModalThrows: true });
    await new TaskNotesInteractions(env.app).handleActivate('tasks/a.md', {
      kind: 'single',
      ctrlOrMeta: false,
    });

    expect(env.openTaskEditModal).toHaveBeenCalledTimes(1);
    expect(env.openFile).toHaveBeenCalledTimes(1); // fell back after throw
  });

  it('opens the note (never the modal) when TaskNotes is absent', async () => {
    const env = makeEnv({ present: false, singleClickAction: 'edit' });
    await new TaskNotesInteractions(env.app).handleActivate('tasks/a.md', {
      kind: 'single',
      ctrlOrMeta: false,
    });

    expect(env.openFile).toHaveBeenCalledTimes(1);
    expect(env.openTaskEditModal).not.toHaveBeenCalled();
  });
});

describe('TaskNotesInteractions.showContextMenu', () => {
  it('shows the native task menu for the path at the event', () => {
    const env = makeEnv({});
    const event = { clientX: 1 } as unknown as MouseEvent;
    new TaskNotesInteractions(env.app).showContextMenu('tasks/a.md', event);

    expect(env.taskMenuShow).toHaveBeenCalledWith({ taskPath: 'tasks/a.md', event });
  });

  it('is inert (no throw) when TaskNotes is absent', () => {
    const env = makeEnv({ present: false });
    expect(() =>
      new TaskNotesInteractions(env.app).showContextMenu('tasks/a.md', {} as MouseEvent),
    ).not.toThrow();
    expect(env.taskMenuShow).not.toHaveBeenCalled();
  });
});
