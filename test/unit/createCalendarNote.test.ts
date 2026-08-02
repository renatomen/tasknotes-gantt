/**
 * The shared calendar-note creator: it scaffolds the right skeleton at a unique
 * Calendars/ path and opens the note. Exercised against a hand-rolled app fake
 * (the vault/workspace surface it touches is small); the routing that turns the
 * opened note into the editor is e2e-tested.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { App, TFile, type EventRef } from 'obsidian';
import {
  createAndOpenCalendarNote,
  pluginLifetime,
  type PluginLifetime,
} from '../../src/bases/createCalendarNote';

/**
 * A plugin lifetime under test control: `own` records the subscriptions the plugin
 * would release at unload, and `unload()` releases them and reports inactive —
 * standing in for Obsidian, with no state shared between tests.
 */
function fakeLifetime(): PluginLifetime & {
  unload(): void;
  openScopes(): number;
} {
  const scopes = new Set<{ close(): void }>();
  let active = true;
  return {
    isActive: () => active,
    scope: () => {
      const owned: { source: { offref(ref: EventRef): void }; ref: EventRef }[] = [];
      const deferred: (() => void)[] = [];
      const scope = {
        own: (source: { offref(ref: EventRef): void }, ref: EventRef) =>
          owned.push({ source, ref }),
        defer: (cleanup: () => void) => deferred.push(cleanup),
        close: () => {
          if (!scopes.delete(scope)) return;
          for (const ownedRef of owned.splice(0)) ownedRef.source.offref(ownedRef.ref);
          for (const cleanup of deferred.splice(0)) cleanup();
        },
      };
      scopes.add(scope);
      return scope;
    },
    /** How many scopes are still open — 0 means nothing is subscribed. */
    openScopes: () => scopes.size,
    unload: () => {
      active = false;
      for (const scope of [...scopes]) scope.close();
    },
  };
}

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
        // The created note must be resolvable: the marker watch refuses to watch a
        // path that no longer exists, so a fake that never adds it would fall
        // through to the open deadline instead of the already-indexed fast path.
        paths.add(p);
        const file = new TFile();
        file.path = p;
        return file;
      },
      // The marker watch releases on deletion too, so it subscribes to the vault.
      on: () => ({}),
      offref: () => {},
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
  return { app: app as unknown as App, created, opened, foldersCreated, lifetime: fakeLifetime() };
}

/**
 * An app whose metadata cache indexes the new note only when `indexNow()` says
 * so — the cold-vault case where the marker misses the pre-open wait. Records
 * what the opened leaf was asked to re-render as (`reissued`).
 */
const EDITOR_VIEW_TYPE = 'tngantt-calendar-editor';

function lateIndexingApp() {
  let indexed = false;
  const metadataListeners = new Map<
    object,
    { event: string; cb: (changed: { path: string }) => void }
  >();
  const vaultListeners = new Map<
    object,
    { event: string; cb: (changed: { path: string }) => void }
  >();
  const opened: unknown[] = [];
  const reissued: unknown[] = [];
  const state = {
    viewState: { type: 'markdown', state: { file: 'Calendars/New Calendar.md', mode: 'source' } } as {
      type: string;
      state: Record<string, unknown>;
    },
    holdOpen: false,
    holdCreate: false,
    holdViewState: false,
    holdCreateFolder: false,
  };
  let releaseCreateFolder: (() => void) | null = null;
  const created: string[] = [];
  let releaseViewState: (() => void) | null = null;
  let releaseCreate: (() => void) | null = null;
  // `holdOpen` parks `openFile` mid-flight, so a test can land an unload inside
  // that await — the boundary a watch must not be registered across.
  let releaseOpen: (() => void) | null = null;
  const leaf = {
    openFile: async (file: unknown) => {
      opened.push(file);
      if (state.holdOpen) await new Promise<void>((resolve) => (releaseOpen = resolve));
    },
    getViewState: () => state.viewState,
    setViewState: async (next: unknown) => {
      reissued.push(next);
      // The interception decides SYNCHRONOUSLY at the call — that is why a
      // transition begun while the plugin was loaded can still land as the editor
      // view after it unloads. The transition itself settles later.
      const requested = next as { type: string; state: Record<string, unknown> };
      const applied =
        lifetime.isActive() && requested.type === 'markdown'
          ? { ...requested, type: EDITOR_VIEW_TYPE }
          : { ...requested };
      if (state.holdViewState) await new Promise<void>((resolve) => (releaseViewState = resolve));
      state.viewState = applied;
    },
  };
  // Paths that exist in this fake vault: the created note lands here, and a
  // deletion removes it — the watch refuses to watch a path that is gone.
  const livePaths = new Set<string>();
  const app = {
    vault: {
      getAbstractFileByPath: (p: string) => (livePaths.has(p) ? ({ path: p } as unknown) : null),
      createFolder: async () => {
        if (state.holdCreateFolder) {
          await new Promise<void>((resolve) => (releaseCreateFolder = resolve));
        }
      },
      create: async (p: string) => {
        if (state.holdCreate) await new Promise<void>((resolve) => (releaseCreate = resolve));
        const file = new TFile();
        file.path = p;
        created.push(p);
        livePaths.add(p);
        return file;
      },
      // The watch also releases on deletion, so the vault is an event source too.
      on: (event: string, cb: (changed: { path: string }) => void) => {
        const ref = {};
        vaultListeners.set(ref, { event: `vault:${event}`, cb });
        return ref;
      },
      offref: (ref: object) => {
        vaultListeners.delete(ref);
      },
    },
    workspace: { getLeaf: () => leaf },
    metadataCache: {
      getFileCache: () => (indexed ? { frontmatter: { tngantt: 'calendar' } } : null),
      on: (event: string, cb: (changed: { path: string }) => void) => {
        const ref = {};
        metadataListeners.set(ref, { event, cb });
        return ref;
      },
      offref: (ref: object) => {
        metadataListeners.delete(ref);
      },
    },
  };
  // Unload releases every subscription the plugin took ownership of, exactly as
  // Obsidian does for registerEvent — that is what makes a leak impossible.
  const lifetime = fakeLifetime();
  const fire = (event: string): void => {
    for (const l of [...metadataListeners.values(), ...vaultListeners.values()]) {
      if (l.event === event) l.cb({ path: 'Calendars/New Calendar.md' });
    }
  };
  return {
    app: app as unknown as App,
    lifetime,
    created,
    /** Disable the plugin: releases its subscriptions and reports inactive. */
    unload: () => lifetime.unload(),
    opened,
    reissued,
    /** How many cache listeners are still registered (0 = nothing watching). */
    liveListeners: () => metadataListeners.size + vaultListeners.size,
    /** Park `openFile` until `releaseOpenFile()`, to unload inside that await. */
    holdOpenFile: () => {
      state.holdOpen = true;
    },
    releaseOpenFile: () => releaseOpen?.(),
    /** Park `vault.create` until `releaseCreate()`, to unload inside that await. */
    holdCreate: () => {
      state.holdCreate = true;
    },
    releaseCreate: () => releaseCreate?.(),
    /** Park `createFolder`, the first await of the flow. */
    holdCreateFolder: () => {
      state.holdCreateFolder = true;
    },
    releaseCreateFolder: () => releaseCreateFolder?.(),
    /** Park `setViewState` mid-re-route, to land an unload inside that await. */
    holdViewState: () => {
      state.holdViewState = true;
    },
    releaseViewState: () => releaseViewState?.(),
    /** Announce that the watched note was deleted before its marker indexed. */
    deleteNow: () => {
      livePaths.delete('Calendars/New Calendar.md');
      fire('vault:delete');
    },
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

describe('pluginLifetime', () => {
  function fakePlugin() {
    const cleanups: (() => void)[] = [];
    const plugin = {
      register: (cleanup: () => void) => cleanups.push(cleanup),
    };
    return {
      plugin,
      registrations: () => cleanups.length,
      unload: () => cleanups.forEach((cleanup) => cleanup()),
    };
  }

  it('releases the subscriptions a scope owns as soon as it closes', () => {
    const { plugin, unload } = fakePlugin();
    const metadataOffref = jest.fn<(ref: object) => void>();
    const vaultOffref = jest.fn<(ref: object) => void>();
    const lifetime = pluginLifetime(plugin as never);
    const metadataRef = { source: 'metadata' };
    const vaultRef = { source: 'vault' };
    const metadataSource = { offref: metadataOffref };
    const vaultSource = { offref: vaultOffref };

    const scope = lifetime.scope();
    scope.own(metadataSource, metadataRef as never);
    scope.own(vaultSource, vaultRef as never);

    scope.close();
    expect(metadataOffref).toHaveBeenCalledWith(metadataRef);
    expect(vaultOffref).toHaveBeenCalledWith(vaultRef);
    expect(metadataOffref).not.toHaveBeenCalledWith(vaultRef);
    expect(vaultOffref).not.toHaveBeenCalledWith(metadataRef);
    scope.close(); // idempotent
    unload();
    expect(metadataOffref).toHaveBeenCalledTimes(1);
    expect(vaultOffref).toHaveBeenCalledTimes(1);
  });

  it('runs deferred cleanups when the scope closes, and only once', () => {
    const { plugin } = fakePlugin();
    const lifetime = pluginLifetime(plugin as never);
    const scope = lifetime.scope();
    let runs = 0;
    scope.defer(() => runs++);
    scope.close();
    scope.close();
    expect(runs).toBe(1);
  });

  it('releases a scope that never closed when the plugin unloads', () => {
    const { plugin, unload } = fakePlugin();
    const offref = jest.fn<(ref: object) => void>();
    const lifetime = pluginLifetime(plugin as never);
    const ref = {};
    lifetime.scope().own({ offref }, ref as never);

    unload();
    expect(offref).toHaveBeenCalledWith(ref);
  });

  it('marks inactive before closing every open scope, and unload is idempotent', () => {
    const fake = fakePlugin();
    const lifetime = pluginLifetime(fake.plugin as never);
    const activityObservedDuringCleanup: boolean[] = [];
    const firstCleanup = jest.fn(() => activityObservedDuringCleanup.push(lifetime.isActive()));
    const secondCleanup = jest.fn(() => activityObservedDuringCleanup.push(lifetime.isActive()));
    lifetime.scope().defer(firstCleanup);
    lifetime.scope().defer(secondCleanup);
    expect(lifetime.isActive()).toBe(true);

    fake.unload();
    fake.unload();
    expect(lifetime.isActive()).toBe(false);
    expect(activityObservedDuringCleanup).toEqual([false, false]);
    expect(firstCleanup).toHaveBeenCalledTimes(1);
    expect(secondCleanup).toHaveBeenCalledTimes(1);
  });

  it('detaches a scope before running cleanup so reentrant close remains idempotent', () => {
    const fake = fakePlugin();
    const lifetime = pluginLifetime(fake.plugin as never);
    const scope = lifetime.scope();
    const afterReentry = jest.fn();
    scope.defer(() => scope.close());
    scope.defer(afterReentry);

    scope.close();
    fake.unload();
    expect(afterReentry).toHaveBeenCalledTimes(1);
  });

  it('continues releasing a scope when one cleanup fails', () => {
    const fake = fakePlugin();
    const lifetime = pluginLifetime(fake.plugin as never);
    const scope = lifetime.scope();
    const cleanupError = new Error('cleanup failed');
    const laterCleanup = jest.fn();
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    scope.defer(() => {
      throw cleanupError;
    });
    scope.defer(laterCleanup);

    scope.close();

    expect(laterCleanup).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      '[Gantt] Plugin lifetime cleanup failed',
      cleanupError,
    );
    consoleError.mockRestore();
  });

  it('registers one plugin cleanup regardless of how many scopes open and close', () => {
    const fake = fakePlugin();
    const lifetime = pluginLifetime(fake.plugin as never);
    for (let i = 0; i < 3; i += 1) lifetime.scope().close();

    expect(fake.registrations()).toBe(1);
  });

  it('releases registrations immediately when a scope is created after unload', () => {
    const fake = fakePlugin();
    const lifetime = pluginLifetime(fake.plugin as never);
    const offref = jest.fn<(ref: object) => void>();
    const deferred = jest.fn();
    const ref = {};
    fake.unload();

    const scope = lifetime.scope();
    scope.own({ offref }, ref as never);
    scope.defer(deferred);

    expect(offref).toHaveBeenCalledWith(ref);
    expect(deferred).toHaveBeenCalledTimes(1);
  });

  it('releases a scope created reentrantly during plugin unload', () => {
    const fake = fakePlugin();
    const lifetime = pluginLifetime(fake.plugin as never);
    const nestedCleanup = jest.fn();
    lifetime.scope().defer(() => lifetime.scope().defer(nestedCleanup));

    fake.unload();

    expect(nestedCleanup).toHaveBeenCalledTimes(1);
  });
});

describe('createAndOpenCalendarNote', () => {
  // Several cases drive the wait deadlines with fake timers. Restored here rather
  // than at the end of each test, so a failure mid-test cannot leave fake timers
  // enabled for every test after it.
  afterEach(() => {
    jest.useRealTimers();
  });

  it('scaffolds and opens a calendar note with the calendar skeleton', async () => {
    const { app, created, opened, lifetime } = fakeApp();
    await createAndOpenCalendarNote(app, 'calendar', lifetime);
    expect(created).toHaveLength(1);
    expect(created[0]!.path).toBe('Calendars/New Calendar.md');
    expect(created[0]!.text).toContain('tngantt: calendar');
    expect(opened).toHaveLength(1);
  });

  it('scaffolds and opens an empty calendar-set note', async () => {
    const { app, created, opened, lifetime } = fakeApp();
    await createAndOpenCalendarNote(app, 'calendar-set', lifetime);
    expect(created[0]!.path).toBe('Calendars/New Calendar Set.md');
    expect(created[0]!.text).toContain('tngantt: calendar-set');
    expect(opened).toHaveLength(1);
  });

  it('creates the Calendars folder only when it is absent', async () => {
    const missing = fakeApp();
    await createAndOpenCalendarNote(missing.app, 'calendar', missing.lifetime);
    expect(missing.foldersCreated).toContain('Calendars');

    const present = fakeApp(['Calendars']);
    await createAndOpenCalendarNote(present.app, 'calendar', present.lifetime);
    expect(present.foldersCreated).toHaveLength(0);
  });

  it('waits for the marker to be indexed before opening the note', async () => {
    // getFileCache returns no marker until a metadata 'changed' fires, so the
    // creator must park on the cache listener rather than open too early.
    let indexed = false;
    let changedCb: ((f: { path: string }) => void) | null = null;
    const opened: unknown[] = [];
    const livePaths = new Set<string>();
    const app = {
      vault: {
        // Only the created note resolves — a blanket truthy answer would make the
        // unique-path search never find a free name. It has to resolve at all
        // because the marker watch refuses to watch a path that is gone.
        getAbstractFileByPath: (p: string) => (livePaths.has(p) ? ({ path: p } as unknown) : null),
        createFolder: async () => undefined,
        create: async (p: string) => {
          livePaths.add(p);
          const file = new TFile();
          file.path = p;
          return file;
        },
        on: () => ({}),
        offref: () => {},
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
    const lifetime = fakeLifetime();

    const promise = createAndOpenCalendarNote(app, 'calendar', lifetime);
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

    const promise = createAndOpenCalendarNote(late.app, 'calendar', late.lifetime);
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
  });

  it('keeps watching however long indexing takes, with no deadline of its own', async () => {
    // The re-route is detached from the command promise, so bounding it by a clock
    // would only reproduce the bug after an arbitrary delay.
    jest.useFakeTimers();
    const late = lateIndexingApp();
    const promise = createAndOpenCalendarNote(late.app, 'calendar', late.lifetime);
    await jest.advanceTimersByTimeAsync(2000);
    await promise;

    await jest.advanceTimersByTimeAsync(600000); // ten minutes of cold indexing
    late.indexNow();
    await jest.advanceTimersByTimeAsync(0);
    expect(late.reissued).toHaveLength(1);
  });

  it('leaves a leaf that has moved on alone when the marker lands late', async () => {
    // The user may have navigated the tab elsewhere (or reopened the note, routing
    // it themselves) while the marker was indexing — re-routing then would yank
    // them away from what they are looking at.
    jest.useFakeTimers();
    const late = lateIndexingApp();
    const promise = createAndOpenCalendarNote(late.app, 'calendar', late.lifetime);
    await jest.advanceTimersByTimeAsync(2000);
    await promise;

    late.viewState = { type: 'markdown', state: { file: 'Somewhere Else.md', mode: 'source' } };
    late.indexNow();
    await jest.advanceTimersByTimeAsync(0);
    expect(late.reissued).toHaveLength(0);
  });

  it('writes nothing when the plugin unloads while the folder is being created', async () => {
    // The folder create is its own await, before the note exists at all: unloading
    // there must abandon the flow rather than leave a stray note behind.
    jest.useFakeTimers();
    const late = lateIndexingApp();
    late.holdCreateFolder();
    const promise = createAndOpenCalendarNote(late.app, 'calendar', late.lifetime);
    await jest.advanceTimersByTimeAsync(0);

    late.unload();
    late.releaseCreateFolder();
    await promise;
    expect(late.created).toHaveLength(0);
    expect(late.opened).toHaveLength(0);
    expect(late.liveListeners()).toBe(0);
  });

  it('registers no wait when the plugin unloads while the note is being written', async () => {
    // Unload during `vault.create`: the cleanup sees nothing registered yet, so the
    // flow must not go on to install a cache listener and a deadline behind it.
    jest.useFakeTimers();
    const late = lateIndexingApp();
    late.holdCreate();
    const promise = createAndOpenCalendarNote(late.app, 'calendar', late.lifetime);
    await jest.advanceTimersByTimeAsync(0);

    late.unload();
    late.releaseCreate();
    await promise;
    expect(late.liveListeners()).toBe(0);
    expect(late.opened).toHaveLength(0);
  });

  it('abandons a create that is still waiting on the index when the plugin unloads', async () => {
    // Unload lands during the pre-open wait: the wait must settle at once (its
    // deadline can no longer fire after teardown) and the flow must stop before it
    // opens a leaf or starts a fresh watch on behalf of a plugin that is gone.
    jest.useFakeTimers();
    const late = lateIndexingApp();
    const promise = createAndOpenCalendarNote(late.app, 'calendar', late.lifetime);
    await jest.advanceTimersByTimeAsync(500); // still inside the 2s wait

    late.unload();
    expect(late.liveListeners()).toBe(0); // the plugin released them itself
    // Deliberately NO timer advance: unload itself settles the wait, so nothing of
    // the unloaded plugin runs again at the deadline.
    await promise;
    expect(late.opened).toHaveLength(0); // …and the flow stood down

    // And nothing revives afterwards — neither a stray timer nor a late index.
    await jest.advanceTimersByTimeAsync(5000);
    late.indexNow();
    await jest.advanceTimersByTimeAsync(0);
    expect(late.opened).toHaveLength(0);
    expect(late.reissued).toHaveLength(0);
  });

  it('starts no watch when the plugin unloads while the note is opening', async () => {
    // `openFile` is a second await boundary after the generation check: an unload
    // inside it runs its cleanup, so a watch registered afterwards would be owned
    // by a plugin whose routing interceptor is already gone.
    jest.useFakeTimers();
    const late = lateIndexingApp();
    late.holdOpenFile();
    const promise = createAndOpenCalendarNote(late.app, 'calendar', late.lifetime);
    await jest.advanceTimersByTimeAsync(2000); // wait gives up, open starts
    expect(late.opened).toHaveLength(1); // parked inside openFile

    late.unload();
    late.releaseOpenFile();
    await promise;
    expect(late.liveListeners()).toBe(0);

    late.indexNow();
    await jest.advanceTimersByTimeAsync(0);
    expect(late.reissued).toHaveLength(0);
  });

  it('stops watching when the note it is waiting on is deleted', async () => {
    // A deletion emits its own event and no `changed` can follow it, so a watch with
    // no deadline would retain the file and leaf until unload — one listener per
    // abandoned create.
    jest.useFakeTimers();
    const late = lateIndexingApp();
    const promise = createAndOpenCalendarNote(late.app, 'calendar', late.lifetime);
    await jest.advanceTimersByTimeAsync(2000);
    await promise;
    expect(late.liveListeners()).toBeGreaterThan(0);

    late.deleteNow();
    expect(late.liveListeners()).toBe(0);
    late.indexNow();
    await jest.advanceTimersByTimeAsync(0);
    expect(late.reissued).toHaveLength(0);
  });

  it('starts no watch when the note is deleted while it is opening', async () => {
    // The deletion lands before the late watch would be registered, so there is no
    // later `changed` or `delete` to release it — the watch must not start at all.
    jest.useFakeTimers();
    const late = lateIndexingApp();
    late.holdOpenFile();
    const promise = createAndOpenCalendarNote(late.app, 'calendar', late.lifetime);
    await jest.advanceTimersByTimeAsync(2000);
    expect(late.opened).toHaveLength(1); // parked inside openFile

    late.deleteNow();
    late.releaseOpenFile();
    await promise;
    expect(late.liveListeners()).toBe(0);
    expect(late.reissued).toHaveLength(0);
  });

  it('puts the leaf back on markdown when unload lands mid-re-route', async () => {
    // The watch has already released itself by the time setViewState is applying, so
    // cancellation has nothing left to stop. If the plugin goes away in that window
    // the editor view type is unregistered, and the leaf must not be left showing it.
    jest.useFakeTimers();
    const late = lateIndexingApp();
    late.holdViewState();
    const promise = createAndOpenCalendarNote(late.app, 'calendar', late.lifetime);
    await jest.advanceTimersByTimeAsync(2000);
    await promise;

    late.indexNow();
    await jest.advanceTimersByTimeAsync(0);
    expect(late.reissued).toHaveLength(1); // the re-route is applying

    late.unload();
    late.releaseViewState();
    await jest.advanceTimersByTimeAsync(0);
    expect(late.reissued).toHaveLength(2);
    expect((late.reissued[1] as { type: string }).type).toBe('markdown');
  });

  it('drops a still-pending marker watch when the plugin unloads', async () => {
    jest.useFakeTimers();
    const late = lateIndexingApp();
    const promise = createAndOpenCalendarNote(late.app, 'calendar', late.lifetime);
    await jest.advanceTimersByTimeAsync(2000);
    await promise;
    expect(late.liveListeners()).toBeGreaterThan(0); // still waiting on the index

    late.unload();
    expect(late.liveListeners()).toBe(0);
    late.indexNow();
    await jest.advanceTimersByTimeAsync(0);
    expect(late.reissued).toHaveLength(0);
  });

  it('surfaces a Notice and rethrows when creation fails', async () => {
    const { app, lifetime } = fakeApp([], () => Promise.reject(new Error('disk full')));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(createAndOpenCalendarNote(app, 'calendar', lifetime)).rejects.toThrow('disk full');
    jest.restoreAllMocks();
  });
});
