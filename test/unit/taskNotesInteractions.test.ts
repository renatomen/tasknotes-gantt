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
  resolveClickActivation,
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

describe('resolveClickActivation (pure)', () => {
  it('single-click on an unselected row selects only (no action)', () => {
    expect(resolveClickActivation({ kind: 'single', wasSelected: false })).toBe('selectOnly');
  });

  it('single-click on an already-selected row runs the single action', () => {
    expect(resolveClickActivation({ kind: 'single', wasSelected: true })).toBe('activateSingle');
  });

  it('defaults to select-only when wasSelected is omitted', () => {
    expect(resolveClickActivation({ kind: 'single' })).toBe('selectOnly');
  });

  it('double-click always runs the double action, regardless of selection', () => {
    expect(resolveClickActivation({ kind: 'double', wasSelected: false })).toBe('activateDouble');
    expect(resolveClickActivation({ kind: 'double', wasSelected: true })).toBe('activateDouble');
    expect(resolveClickActivation({ kind: 'double' })).toBe('activateDouble');
  });
});

/** Build a fake Obsidian App + TaskNotes plugin/api with captured spies. */
function makeEnv(opts: {
  present?: boolean;
  singleClickAction?: string;
  doubleClickAction?: string;
  hasEditModal?: boolean;
  editModalThrows?: boolean;
  /** Paths the vault reports as absent — a deleted or renamed note. */
  missingPaths?: string[];
  /** TaskNotes tracks no task for this path (an unmanaged note). */
  taskMissing?: boolean;
} = {}) {
  const present = opts.present !== false;
  const openFile = jest.fn((_file: { path: string }) => Promise.resolve());
  const getLeaf = jest.fn((_mode?: unknown) => ({ openFile }));
  // Path-faithful AND identity-stable: one object per path, handed back on every
  // lookup. Path-faithful so a wrong path is a different object; identity-stable
  // so the assertions can compare by REFERENCE. Structural comparison would let
  // an implementation that rebuilds `{ path }` — discarding the resolved TFile
  // Obsidian's openFile actually requires — pass while every real click fails.
  const files = new Map<string, { path: string }>();
  const fileFor = (path: string): { path: string } => {
    const existing = files.get(path);
    if (existing) return existing;
    const created = { path };
    files.set(path, created);
    return created;
  };
  // Real `getAbstractFileByPath` returns null for a path with no file, so the
  // double has to be able to as well — otherwise the module's not-found guard is
  // unreachable and deleting it stays green.
  const missing = new Set(opts.missingPaths ?? []);
  const getAbstractFileByPath = jest.fn((path: string) =>
    missing.has(path) ? null : fileFor(path),
  );

  const taskMenuShow = jest.fn();
  // Same reasoning for the TaskInfo the edit modal receives: the real object
  // carries more than `path`, so forwarding it is what the modal depends on.
  const tasks = new Map<string, { path: string; title: string }>();
  const taskFor = (path: string): { path: string; title: string } => {
    const existing = tasks.get(path);
    if (existing) return existing;
    const created = { path, title: 'A' };
    tasks.set(path, created);
    return created;
  };
  const tasksGet = jest.fn((path: string) =>
    Promise.resolve(opts.taskMissing ? undefined : taskFor(path)),
  );
  const openTaskEditModal = jest.fn((_task: unknown) => {
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

  return {
    app,
    getLeaf,
    openFile,
    getAbstractFileByPath,
    taskMenuShow,
    tasksGet,
    openTaskEditModal,
    fileFor,
    taskFor,
    /** The note object actually handed to `leaf.openFile` on the last call. */
    openedNote: (): unknown => openFile.mock.calls.at(-1)?.[0],
    /** The task object actually handed to `openTaskEditModal` on the last call. */
    editedTask: (): unknown => openTaskEditModal.mock.calls.at(-1)?.[0],
  };
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
    expect(env.openedNote()).toBe(env.fileFor('tasks/a.md'));
    expect(env.openTaskEditModal).not.toHaveBeenCalled();
  });

  it('opens the note in a new tab when ctrl/meta is held', async () => {
    const env = makeEnv({ singleClickAction: 'edit' }); // action overridden by modifier
    await new TaskNotesInteractions(env.app).handleActivate('tasks/b.md', {
      kind: 'single',
      ctrlOrMeta: true,
    });

    expect(env.getLeaf).toHaveBeenCalledWith('tab'); // new tab
    expect(env.openFile).toHaveBeenCalledTimes(1);
    expect(env.openedNote()).toBe(env.fileFor('tasks/b.md'));
    expect(env.openTaskEditModal).not.toHaveBeenCalled();
  });

  it('opens the native edit modal for an edit action (via guarded plugin call)', async () => {
    const env = makeEnv({ singleClickAction: 'edit' });
    await new TaskNotesInteractions(env.app).handleActivate('tasks/c.md', {
      kind: 'single',
      ctrlOrMeta: false,
    });

    expect(env.tasksGet).toHaveBeenCalledWith('tasks/c.md');
    expect(env.openTaskEditModal).toHaveBeenCalledTimes(1);
    expect(env.editedTask()).toBe(env.taskFor('tasks/c.md'));
    expect(env.openFile).not.toHaveBeenCalled();
  });

  it('reads the double-click action for a double-click', async () => {
    const env = makeEnv({ singleClickAction: 'none', doubleClickAction: 'edit' });
    await new TaskNotesInteractions(env.app).handleActivate('tasks/d.md', {
      kind: 'double',
      ctrlOrMeta: false,
    });

    expect(env.openTaskEditModal).toHaveBeenCalledTimes(1);
    expect(env.editedTask()).toBe(env.taskFor('tasks/d.md'));
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
    await new TaskNotesInteractions(env.app).handleActivate('tasks/e.md', {
      kind: 'single',
      ctrlOrMeta: false,
    });

    expect(env.openFile).toHaveBeenCalledTimes(1); // fell back
    expect(env.openedNote()).toBe(env.fileFor('tasks/e.md'));
  });

  it('falls back to opening the note when openTaskEditModal throws', async () => {
    const env = makeEnv({ singleClickAction: 'edit', editModalThrows: true });
    await new TaskNotesInteractions(env.app).handleActivate('tasks/f.md', {
      kind: 'single',
      ctrlOrMeta: false,
    });

    expect(env.openTaskEditModal).toHaveBeenCalledTimes(1);
    expect(env.editedTask()).toBe(env.taskFor('tasks/f.md'));
    expect(env.openFile).toHaveBeenCalledTimes(1); // fell back after throw
    expect(env.openedNote()).toBe(env.fileFor('tasks/f.md'));
  });

  it('opens the note (never the modal) when TaskNotes is absent', async () => {
    const env = makeEnv({ present: false, singleClickAction: 'edit' });
    await new TaskNotesInteractions(env.app).handleActivate('tasks/g.md', {
      kind: 'single',
      ctrlOrMeta: false,
    });

    expect(env.openFile).toHaveBeenCalledTimes(1);
    expect(env.openedNote()).toBe(env.fileFor('tasks/g.md'));
    expect(env.openTaskEditModal).not.toHaveBeenCalled();
  });

  it('opens nothing when the clicked note no longer exists', async () => {
    const env = makeEnv({ singleClickAction: 'openNote', missingPaths: ['tasks/gone.md'] });
    await new TaskNotesInteractions(env.app).handleActivate('tasks/gone.md', {
      kind: 'single',
      ctrlOrMeta: false,
    });

    // Without the not-found guard this reaches openFile(null): the user gets an
    // empty tab and the throw is swallowed by the surrounding catch.
    expect(env.getAbstractFileByPath).toHaveBeenCalledWith('tasks/gone.md');
    expect(env.getLeaf).not.toHaveBeenCalled();
    expect(env.openFile).not.toHaveBeenCalled();
  });

  it('falls back to opening the note when TaskNotes tracks no task for the path', async () => {
    const env = makeEnv({ singleClickAction: 'edit', taskMissing: true });
    await new TaskNotesInteractions(env.app).handleActivate('tasks/h.md', {
      kind: 'single',
      ctrlOrMeta: false,
    });

    expect(env.openTaskEditModal).not.toHaveBeenCalled();
    expect(env.openedNote()).toBe(env.fileFor('tasks/h.md'));
  });

  it('opens the note the clicked path resolves to, not a fixed one', async () => {
    const env = makeEnv({ singleClickAction: 'openNote' });
    const interactions = new TaskNotesInteractions(env.app);
    const openedFor = async (path: string) => {
      env.openFile.mockClear();
      await interactions.handleActivate(path, { kind: 'single', ctrlOrMeta: false });
      return env.openFile.mock.calls.at(-1)?.[0];
    };
    // Two distinguishing paths must reach two distinguishing notes, and each
    // must be the very object the vault returned — not a look-alike rebuilt
    // from the path. A handler that opened one fixed note, or that discarded
    // the resolved file, would satisfy every count- and presence-check above.
    expect(await openedFor('tasks/a.md')).toBe(env.fileFor('tasks/a.md'));
    expect(await openedFor('tasks/b.md')).toBe(env.fileFor('tasks/b.md'));
  });

  it('opens the edit modal for the clicked path, not a fixed task', async () => {
    const env = makeEnv({ singleClickAction: 'edit' });
    const interactions = new TaskNotesInteractions(env.app);
    const editedFor = async (path: string) => {
      env.openTaskEditModal.mockClear();
      await interactions.handleActivate(path, { kind: 'single', ctrlOrMeta: false });
      return env.openTaskEditModal.mock.calls.at(-1)?.[0];
    };
    expect(await editedFor('tasks/a.md')).toBe(env.taskFor('tasks/a.md'));
    expect(await editedFor('tasks/b.md')).toBe(env.taskFor('tasks/b.md'));
  });
});

describe('TaskNotesInteractions.showContextMenu', () => {
  // Two paths through the same call: a single asserted path is satisfied by a
  // hardcoded one, and every menu action would then land on the wrong note.
  it('shows the native task menu for the path at the event', () => {
    const env = makeEnv({});
    const interactions = new TaskNotesInteractions(env.app);
    const first = { clientX: 1 } as unknown as MouseEvent;
    const second = { clientX: 2 } as unknown as MouseEvent;

    interactions.showContextMenu('tasks/a.md', first);
    interactions.showContextMenu('tasks/b.md', second);

    // The event is asserted by REFERENCE for the same reason the note and task
    // are: `toEqual` is structural and ignores undefined-valued keys, so a
    // handler forwarding a rebuilt event would pass here while Obsidian's
    // `showAtMouseEvent` got a stub — and this call site swallows the throw.
    const calls = env.taskMenuShow.mock.calls.map(
      ([arg]) => arg as { taskPath: string; event: unknown },
    );
    expect(calls.map((call) => call.taskPath)).toEqual(['tasks/a.md', 'tasks/b.md']);
    expect(calls[0]?.event).toBe(first);
    expect(calls[1]?.event).toBe(second);
  });

  it('is inert (no throw) when TaskNotes is absent', () => {
    const env = makeEnv({ present: false });
    expect(() =>
      new TaskNotesInteractions(env.app).showContextMenu('tasks/a.md', {} as MouseEvent),
    ).not.toThrow();
    expect(env.taskMenuShow).not.toHaveBeenCalled();
  });
});
