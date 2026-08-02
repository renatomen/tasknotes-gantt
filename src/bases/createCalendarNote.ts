/**
 * Scaffold a new calendar or calendar-set note and open it. Shared by the
 * picker's "Create calendar" action and the Create calendar / Create calendar
 * set commands, so both create the same skeletons in the same place.
 *
 * The new note carries the calendar marker, so opening it routes straight to
 * the editor via the setViewState interception — no separate "open as editor"
 * step. Failures surface a Notice and rethrow so callers can react.
 *
 * @module bases/createCalendarNote
 */
/* global clearTimeout */
import {
  Notice,
  TFile,
  type App,
  type EventRef,
  type Plugin,
  type WorkspaceLeaf,
} from 'obsidian';
import { matchesCalendarMarker } from '../controller/calendar/schema';
import {
  CREATE_FOLDER,
  calendarSetSkeletonText,
  calendarSkeletonText,
  uniqueCalendarPath,
  uniqueCalendarSetPath,
} from './calendarPickerModel';

export type CalendarNoteKind = 'calendar' | 'calendar-set';

export interface EventRefSource {
  offref(ref: EventRef): void;
}

/** How long to hold the note back from opening while its marker indexes. */
const OPEN_WAIT_MS = 2000;

/**
 * A bounded sub-lifetime: subscriptions handed to it are released when the scope
 * closes, and at plugin unload if it never does. That upper bound is what makes
 * the "no listener outlives the plugin" guarantee structural rather than
 * something each code path has to remember.
 */
export interface LifetimeScope {
  /** Hand an event subscription and its source to this scope. */
  own(source: EventRefSource, ref: EventRef): void;
  /** Run `cleanup` when this scope closes (or at plugin unload). */
  defer(cleanup: () => void): void;
  /** Release everything this scope owns. Idempotent. */
  close(): void;
}

/**
 * The plugin lifetime this module's asynchronous work belongs to.
 *
 * Creating a calendar note spans several awaits (write, index wait, open) and the
 * plugin can be disabled at any of them. Rather than tracking that by hand, each
 * piece of work takes a `scope` it can close when it finishes, and `isActive` is
 * the honest answer to "should this continuation still act?".
 *
 * Injected rather than reached for globally, so both entry points pass their own
 * plugin and tests supply a fake with no shared module state.
 */
export interface PluginLifetime {
  /** Open a sub-lifetime for one bounded piece of work. */
  scope(): LifetimeScope;
  /** Whether the plugin is still loaded. */
  isActive(): boolean;
}

/**
 * Adapt an Obsidian plugin to the lifetime this module needs. One plugin cleanup
 * closes every still-open scope at unload; closing a scope sooner detaches and
 * runs only that scope's disposers, so repeated calendar creation does not leave
 * append-only plugin cleanup registrations behind.
 */
export function pluginLifetime(plugin: Plugin): PluginLifetime {
  let active = true;
  const scopes = new Set<LifetimeScope>();
  plugin.register(() => {
    if (!active) return;
    active = false;
    const openScopes = [...scopes];
    scopes.clear();
    for (const scope of openScopes) scope.close();
  });
  return {
    isActive: () => active,
    scope: () => {
      let open = active;
      const cleanups: (() => void)[] = [];
      const addCleanup = (cleanup: () => void): void => {
        if (open) {
          cleanups.push(cleanup);
        } else {
          cleanup();
        }
      };
      const scope: LifetimeScope = {
        own: (source, ref) => addCleanup(() => source.offref(ref)),
        defer: addCleanup,
        close: () => {
          if (!open) return;
          open = false;
          scopes.delete(scope);
          const pending = cleanups.splice(0);
          for (const cleanup of pending) {
            try {
              cleanup();
            } catch (error) {
              console.error('[Gantt] Plugin lifetime cleanup failed', error);
            }
          }
        },
      };
      if (open) scopes.add(scope);
      return scope;
    },
  };
}

interface MarkerHandlers {
  /** The marker became visible in the metadata cache. */
  onIndexed(): void;
  /** The note was deleted, so the marker is never coming. */
  onGone?(): void;
}

/**
 * Watch the metadata cache until the note's marker is visible, then run
 * `onIndexed`. `vault.create` resolves before the frontmatter is indexed, and the
 * editor router reads the marker from that cache, so acting too early routes the
 * note to plain markdown instead of the editor.
 *
 * One-shot, and stops early when the note is deleted — no `changed` event can
 * follow a deletion, so a watch that ignored it would be waiting for something
 * that can never happen. Both subscriptions live in one scope, so finishing,
 * cancelling and unloading all release them by the same path.
 */
function watchForMarker(
  app: App,
  lifetime: PluginLifetime,
  file: TFile,
  handlers: MarkerHandlers,
): () => void {
  // Already gone (deleted while the caller was awaiting something): no event can
  // follow, so there is nothing to watch for.
  if (app.vault.getAbstractFileByPath(file.path) === null) {
    handlers.onGone?.();
    return () => {};
  }
  const indexed = (): boolean =>
    matchesCalendarMarker(app.metadataCache.getFileCache(file)?.frontmatter) !== null;
  const scope = lifetime.scope();
  scope.own(
    app.metadataCache,
    app.metadataCache.on('changed', (changed) => {
      if (changed.path !== file.path || !indexed()) return;
      scope.close();
      handlers.onIndexed();
    }),
  );
  scope.own(
    app.vault,
    app.vault.on('delete', (deleted) => {
      if (deleted.path !== file.path) return;
      scope.close();
      handlers.onGone?.();
    }),
  );
  if (indexed()) {
    scope.close();
    handlers.onIndexed();
  }
  return () => scope.close();
}

/**
 * Wait for the marker, reporting whether it arrived. The deadline is what keeps
 * the *command* responsive — it must open the note either way rather than hang on
 * a slow index — and a deletion settles the wait at once, since nothing can index
 * afterwards.
 */
function waitForMarkerIndexed(
  app: App,
  lifetime: PluginLifetime,
  file: TFile,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopWatch: () => void = () => {};
    // The deadline lives in its own scope so an unload settles the wait AT ONCE:
    // otherwise the timer (and the whole create continuation captured behind this
    // promise) would stay alive until the deadline fired, running the unloaded
    // plugin's code once more just to find out it should stop.
    const deadline = lifetime.scope();
    const finish = (found: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stopWatch();
      deadline.close();
      resolve(found);
    };
    deadline.defer(() => finish(false));
    stopWatch = watchForMarker(app, lifetime, file, {
      onIndexed: () => finish(true),
      onGone: () => finish(false),
    });
    // Already settled (indexed, or gone) — synchronously, so no deadline to arm.
    if (settled) return;
    timer = setTimeout(() => finish(false), timeoutMs);
  });
}

/**
 * Put a note that opened as plain markdown back through routing once its marker
 * finally indexes. A cold or busy vault can index slower than the open wait; the
 * interception reads the marker synchronously during `setViewState`, so a later
 * cache update re-routes nothing and the command silently fails its promise to
 * open the editor. Re-issuing the leaf's OWN view state re-runs that decision,
 * the same way the "View as calendar" menu item does — preserving its mode and
 * active state rather than inventing new ones.
 *
 * Deliberately has no deadline: however long indexing takes, the note still
 * reaches the editor. Leaves a leaf that has moved on alone — the user may have
 * navigated it elsewhere, or reopened the note and routed it themselves.
 *
 * The plugin can still be disabled while the transition is applying, after which
 * the editor view type is no longer registered; that leaf is put back on markdown,
 * but only when it is still showing the note this re-route moved.
 */
function routeWhenMarkerIndexes(
  app: App,
  lifetime: PluginLifetime,
  leaf: WorkspaceLeaf,
  file: TFile,
): void {
  watchForMarker(app, lifetime, file, {
    onIndexed: () => {
      const state = leaf.getViewState();
      if (state.type !== 'markdown') return;
      if (state.state?.['file'] !== file.path) return;
      void Promise.resolve(leaf.setViewState(state))
        .then(() => {
          if (lifetime.isActive()) return undefined;
          const applied = leaf.getViewState();
          const stillOurs = applied.state?.['file'] === file.path && applied.type !== 'markdown';
          return stillOurs ? leaf.setViewState({ ...applied, type: 'markdown' }) : undefined;
        })
        .catch((error) => {
          console.error('[Gantt] Failed to re-route the calendar note to the editor:', error);
        });
    },
  });
}

/** Signals that the plugin unloaded mid-flow, so the rest is abandoned. */
class PluginUnloaded extends Error {}

/**
 * Continue only while the plugin is loaded.
 *
 * Every `await` in the flow below is a window in which the plugin can be disabled,
 * and each step afterwards does something the user would not want a disabled
 * plugin doing — writing a note, opening a leaf, starting a watch. Rather than an
 * ad-hoc check per step (easy to add one step and forget), the rule is uniform:
 * call this after every await, and the flow abandons itself.
 */
function ensureLive(lifetime: PluginLifetime): void {
  if (!lifetime.isActive()) throw new PluginUnloaded('the plugin unloaded');
}

/** Create a `Calendars/` note of the given kind from its skeleton and open it. */
export async function createAndOpenCalendarNote(
  app: App,
  kind: CalendarNoteKind,
  lifetime: PluginLifetime,
): Promise<void> {
  try {
    const { vault } = app;
    const exists = (path: string): boolean => vault.getAbstractFileByPath(path) !== null;
    if (!exists(CREATE_FOLDER)) {
      await vault.createFolder(CREATE_FOLDER).catch(() => undefined);
      ensureLive(lifetime);
    }
    const path = kind === 'calendar' ? uniqueCalendarPath(exists) : uniqueCalendarSetPath(exists);
    const text = kind === 'calendar' ? calendarSkeletonText() : calendarSetSkeletonText();
    const file = (await vault.create(path, text)) as TFile;
    ensureLive(lifetime);
    const indexed = await waitForMarkerIndexed(app, lifetime, file, OPEN_WAIT_MS);
    ensureLive(lifetime);
    // The note is written either way, but opening one that has since been deleted
    // would surface an error the user cannot act on.
    if (!exists(file.path)) return;
    const leaf = app.workspace.getLeaf(true);
    await leaf.openFile(file);
    ensureLive(lifetime);
    // Opened before the marker was visible → it landed in markdown. Keep watching
    // so a late index still reaches the editor, without holding the command open.
    if (!indexed) routeWhenMarkerIndexes(app, lifetime, leaf, file);
  } catch (error) {
    // Abandoning because the plugin went away is not a failure: there is nobody
    // left to tell, and the note (if written) is intact on disk.
    if (error instanceof PluginUnloaded) return;
    console.error('[Gantt] Failed to create the calendar note:', error);
    new Notice("Couldn't create the calendar note — see console for details.");
    throw error;
  }
}
