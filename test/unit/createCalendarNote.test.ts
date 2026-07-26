/**
 * The shared calendar-note creator: it scaffolds the right skeleton at a unique
 * Calendars/ path and opens the note. Exercised against a hand-rolled app fake
 * (the vault/workspace surface it touches is small); the routing that turns the
 * opened note into the editor is e2e-tested.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { App, TFile } from 'obsidian';
import {
  cancelPendingMarkerWatches,
  createAndOpenCalendarNote,
} from '../../src/bases/createCalendarNote';

function fakeApp(existingPaths: string[] = [], createImpl?: () => Promise<TFile>) {
  const paths = new Set(existingPaths);
  const created: { path: string; text: string }[] = [];
  const opened: unknown[] = [];
  const foldersCreated: string[] = [];
  const app = {
    vault: {
      getAbstractFileByPath: (p: string) => (paths.has(p) ? ({ path: p } as unknown) : null),
      createFolder: async (p: string) => {
        foldersCreated.push(p);
        paths.add(p);
      },
      create: async (p: string, text: string) => {
        if (createImpl) return createImpl();
        created.push({ path: p, text });
        const file = new TFile();
        file.path = p;
        return file;
      },
    },
    workspace: {
      getLeaf: () => ({
        openFile: async (file: unknown) => {
          opened.push(file);
        },
      }),
    },
    // The creator waits for the marker to be indexed before opening; a fresh
    // note reads back its marker at once here, so the wait resolves immediately.
    metadataCache: {
      getFileCache: () => ({ frontmatter: { tngantt: 'calendar' } }),
      on: () => ({}),
      offref: () => {},
    },
  };
  return { app: app as unknown as App, created, opened, foldersCreated };
}

/**
 * An app whose metadata cache indexes the new note only when `indexNow()` says
 * so — the cold-vault case where the marker misses the pre-open wait. Records
 * what the opened leaf was asked to re-render as (`reissued`).
 */
function lateIndexingApp() {
  let indexed = false;
  const listeners = new Map<object, { event: string; cb: (changed: { path: string }) => void }>();
  const opened: unknown[] = [];
  const reissued: unknown[] = [];
  const state = {
    viewState: { type: 'markdown', state: { file: 'Calendars/New Calendar.md', mode: 'source' } } as {
      type: string;
      state: Record<string, unknown>;
    },
  };
  const leaf = {
    openFile: async (file: unknown) => {
      opened.push(file);
    },
    getViewState: () => state.viewState,
    setViewState: async (next: unknown) => {
      reissued.push(next);
    },
  };
  const app = {
    vault: {
      getAbstractFileByPath: () => null,
      createFolder: async () => undefined,
      create: async (p: string) => {
        const file = new TFile();
        file.path = p;
        return file;
      },
    },
    workspace: { getLeaf: () => leaf },
    metadataCache: {
      getFileCache: () => (indexed ? { frontmatter: { tngantt: 'calendar' } } : null),
      on: (event: string, cb: (changed: { path: string }) => void) => {
        const ref = {};
        listeners.set(ref, { event, cb });
        return ref;
      },
      offref: (ref: object) => {
        listeners.delete(ref);
      },
    },
  };
  const fire = (event: string): void => {
    for (const l of [...listeners.values()]) {
      if (l.event === event) l.cb({ path: 'Calendars/New Calendar.md' });
    }
  };
  return {
    app: app as unknown as App,
    opened,
    reissued,
    /** How many cache listeners are still registered (0 = nothing watching). */
    liveListeners: () => listeners.size,
    set viewState(next: { type: string; state: Record<string, unknown> }) {
      state.viewState = next;
    },
    /** Index the marker and fire the cache's `changed` event for the note. */
    indexNow: () => {
      indexed = true;
      fire('changed');
    },
  };
}

describe('createAndOpenCalendarNote', () => {
  it('scaffolds and opens a calendar note with the calendar skeleton', async () => {
    const { app, created, opened } = fakeApp();
    await createAndOpenCalendarNote(app, 'calendar');
    expect(created).toHaveLength(1);
    expect(created[0]!.path).toBe('Calendars/New Calendar.md');
    expect(created[0]!.text).toContain('tngantt: calendar');
    expect(opened).toHaveLength(1);
  });

  it('scaffolds and opens an empty calendar-set note', async () => {
    const { app, created, opened } = fakeApp();
    await createAndOpenCalendarNote(app, 'calendar-set');
    expect(created[0]!.path).toBe('Calendars/New Calendar Set.md');
    expect(created[0]!.text).toContain('tngantt: calendar-set');
    expect(opened).toHaveLength(1);
  });

  it('creates the Calendars folder only when it is absent', async () => {
    const missing = fakeApp();
    await createAndOpenCalendarNote(missing.app, 'calendar');
    expect(missing.foldersCreated).toContain('Calendars');

    const present = fakeApp(['Calendars']);
    await createAndOpenCalendarNote(present.app, 'calendar');
    expect(present.foldersCreated).toHaveLength(0);
  });

  it('waits for the marker to be indexed before opening the note', async () => {
    // getFileCache returns no marker until a metadata 'changed' fires, so the
    // creator must park on the cache listener rather than open too early.
    let indexed = false;
    let changedCb: ((f: { path: string }) => void) | null = null;
    const opened: unknown[] = [];
    const app = {
      vault: {
        getAbstractFileByPath: () => null,
        createFolder: async () => undefined,
        create: async (p: string) => {
          const file = new TFile();
          file.path = p;
          return file;
        },
      },
      workspace: {
        getLeaf: () => ({
          openFile: async (file: unknown) => {
            opened.push(file);
          },
        }),
      },
      metadataCache: {
        getFileCache: () => (indexed ? { frontmatter: { tngantt: 'calendar' } } : null),
        on: (_event: string, cb: (f: { path: string }) => void) => {
          changedCb = cb;
          return {};
        },
        offref: () => {},
      },
    } as unknown as App;

    const promise = createAndOpenCalendarNote(app, 'calendar');
    // Let the create + listener registration settle, then simulate indexing.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(opened).toHaveLength(0); // parked, not yet opened
    indexed = true;
    changedCb?.({ path: 'Calendars/New Calendar.md' });
    await promise;
    expect(opened).toHaveLength(1);
  });

  it('re-routes the opened leaf when the marker indexes only after the wait gives up', async () => {
    // A cold or busy vault can take longer than the wait to index the frontmatter.
    // The note then opens as markdown — routing reads the marker synchronously —
    // and a later cache update re-routes nothing, so the command silently fails
    // its promise to open the editor. Re-issuing the leaf's own view state once
    // the marker lands puts it back through the interception.
    jest.useFakeTimers();
    const late = lateIndexingApp();

    const promise = createAndOpenCalendarNote(late.app, 'calendar');
    await jest.advanceTimersByTimeAsync(2000); // the wait gives up
    await promise;
    expect(late.opened).toHaveLength(1);
    expect(late.reissued).toHaveLength(0);

    late.indexNow();
    await jest.advanceTimersByTimeAsync(0);
    expect(late.reissued).toEqual([
      { type: 'markdown', state: { file: 'Calendars/New Calendar.md', mode: 'source' } },
    ]);
    expect(late.liveListeners()).toBe(0); // the watch released itself
    jest.useRealTimers();
  });

  it('keeps watching however long indexing takes, with no deadline of its own', async () => {
    // The re-route is detached from the command promise, so bounding it by a clock
    // would only reproduce the bug after an arbitrary delay.
    jest.useFakeTimers();
    const late = lateIndexingApp();
    const promise = createAndOpenCalendarNote(late.app, 'calendar');
    await jest.advanceTimersByTimeAsync(2000);
    await promise;

    await jest.advanceTimersByTimeAsync(600000); // ten minutes of cold indexing
    late.indexNow();
    await jest.advanceTimersByTimeAsync(0);
    expect(late.reissued).toHaveLength(1);
    jest.useRealTimers();
  });

  it('leaves a leaf that has moved on alone when the marker lands late', async () => {
    // The user may have navigated the tab elsewhere (or reopened the note, routing
    // it themselves) while the marker was indexing — re-routing then would yank
    // them away from what they are looking at.
    jest.useFakeTimers();
    const late = lateIndexingApp();
    const promise = createAndOpenCalendarNote(late.app, 'calendar');
    await jest.advanceTimersByTimeAsync(2000);
    await promise;

    late.viewState = { type: 'markdown', state: { file: 'Somewhere Else.md', mode: 'source' } };
    late.indexNow();
    await jest.advanceTimersByTimeAsync(0);
    expect(late.reissued).toHaveLength(0);
    jest.useRealTimers();
  });

  it('drops a still-pending marker watch when the plugin unloads', async () => {
    jest.useFakeTimers();
    const late = lateIndexingApp();
    const promise = createAndOpenCalendarNote(late.app, 'calendar');
    await jest.advanceTimersByTimeAsync(2000);
    await promise;
    expect(late.liveListeners()).toBeGreaterThan(0); // still waiting on the index

    cancelPendingMarkerWatches();
    expect(late.liveListeners()).toBe(0);
    late.indexNow();
    await jest.advanceTimersByTimeAsync(0);
    expect(late.reissued).toHaveLength(0);
    jest.useRealTimers();
  });

  it('surfaces a Notice and rethrows when creation fails', async () => {
    const { app } = fakeApp([], () => Promise.reject(new Error('disk full')));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(createAndOpenCalendarNote(app, 'calendar')).rejects.toThrow('disk full');
    jest.restoreAllMocks();
  });
});
