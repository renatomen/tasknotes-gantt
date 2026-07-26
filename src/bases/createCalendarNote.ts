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
import { Notice, TFile, type App, type WorkspaceLeaf } from 'obsidian';
import { matchesCalendarMarker } from '../controller/calendar/schema';
import {
  CREATE_FOLDER,
  calendarSetSkeletonText,
  calendarSkeletonText,
  uniqueCalendarPath,
  uniqueCalendarSetPath,
} from './calendarPickerModel';

export type CalendarNoteKind = 'calendar' | 'calendar-set';

/** How long to hold the note back from opening while its marker indexes. */
const OPEN_WAIT_MS = 2000;

/**
 * Live marker watches and pending waits, so a plugin unload can drop every one
 * of them (this module has no plugin handle of its own to register events
 * against).
 */
const markerWatches = new Set<() => void>();

/**
 * Bumped by {@link cancelPendingMarkerWatches} so a create that is mid-flight
 * when the plugin unloads abandons the rest of its work instead of resuming into
 * a torn-down plugin.
 */
let liveGeneration = 0;

/**
 * Cancel everything this module has pending. Called on plugin unload: it releases
 * each cache listener, settles any wait at once (rather than letting its deadline
 * fire later), and retires the generation so an in-flight create stops before it
 * can touch the workspace or start a fresh watch.
 */
export function cancelPendingMarkerWatches(): void {
  liveGeneration++;
  for (const stop of [...markerWatches]) stop();
}

/**
 * Run `onIndexed` once — as soon as the note's marker is visible in the metadata
 * cache. `vault.create` resolves before the frontmatter is indexed, and the editor
 * router reads the marker from that cache, so acting too early routes the note to
 * plain markdown instead of the editor.
 *
 * One-shot: the watch releases its listener as soon as the marker lands, or as
 * soon as the note is deleted — no `changed` event can follow a deletion, so a
 * deadline-free watch would otherwise retain the file until unload, one listener
 * per abandoned attempt. Callers that must not wait forever impose their own
 * deadline; the rest are released by {@link cancelPendingMarkerWatches} at unload.
 */
function watchForMarker(app: App, file: TFile, onIndexed: () => void): () => void {
  // Already gone (deleted while the caller was awaiting something): no `changed`
  // and no `delete` can follow, so a watch here would never release itself.
  if (app.vault.getAbstractFileByPath(file.path) === null) return () => {};
  const indexed = (): boolean =>
    matchesCalendarMarker(app.metadataCache.getFileCache(file)?.frontmatter) !== null;
  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    app.metadataCache.offref(changedRef);
    app.vault.offref(deleteRef);
    markerWatches.delete(stop);
  };
  const changedRef = app.metadataCache.on('changed', (changed) => {
    if (changed.path !== file.path || !indexed()) return;
    stop();
    onIndexed();
  });
  const deleteRef = app.vault.on('delete', (deleted) => {
    if (deleted.path === file.path) stop();
  });
  markerWatches.add(stop);
  if (indexed()) {
    stop();
    onIndexed();
  }
  return stop;
}

/**
 * Wait for the marker, reporting whether it arrived before `timeoutMs`. The
 * deadline is what keeps the *command* responsive — it must open the note either
 * way rather than hang on a slow index. An unload settles the wait immediately
 * through the same registry, so its deadline can never fire after teardown.
 */
function waitForMarkerIndexed(app: App, file: TFile, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopWatch: () => void = () => {};
    const finish = (found: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stopWatch();
      markerWatches.delete(abort);
      resolve(found);
    };
    const abort = (): void => finish(false);
    stopWatch = watchForMarker(app, file, () => finish(true));
    // An already-indexed marker settles the watch synchronously — nothing to arm.
    if (settled) return;
    markerWatches.add(abort);
    timer = setTimeout(abort, timeoutMs);
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
 * reaches the editor. Nothing waits on this, so the only reason to stop early
 * would be listener hygiene — and unload already covers that. Leaves a leaf that
 * has moved on alone: the user may have navigated it elsewhere, or reopened the
 * note and routed it themselves.
 *
 * An unload can still land while the re-route is applying, after the watch has
 * released itself: the editor view type is unregistered by then, so the leaf is
 * put back on markdown rather than left showing a view that no longer exists.
 */
function routeWhenMarkerIndexes(
  app: App,
  leaf: WorkspaceLeaf,
  file: TFile,
  generation: number,
): void {
  watchForMarker(app, file, () => {
    const state = leaf.getViewState();
    if (state.type !== 'markdown') return;
    if (state.state?.['file'] !== file.path) return;
    void Promise.resolve(leaf.setViewState(state))
      .then(() => {
        if (generation === liveGeneration) return undefined;
        return leaf.setViewState({ ...state, type: 'markdown' });
      })
      .catch((error) => {
        console.error('[Gantt] Failed to re-route the calendar note to the editor:', error);
      });
  });
}

/** Create a `Calendars/` note of the given kind from its skeleton and open it. */
export async function createAndOpenCalendarNote(app: App, kind: CalendarNoteKind): Promise<void> {
  const generation = liveGeneration;
  try {
    const { vault } = app;
    const exists = (path: string): boolean => vault.getAbstractFileByPath(path) !== null;
    if (!exists(CREATE_FOLDER)) {
      await vault.createFolder(CREATE_FOLDER).catch(() => undefined);
    }
    const path = kind === 'calendar' ? uniqueCalendarPath(exists) : uniqueCalendarSetPath(exists);
    const text = kind === 'calendar' ? calendarSkeletonText() : calendarSetSkeletonText();
    const file = (await vault.create(path, text)) as TFile;
    // Unloaded while the write was in flight: registering the wait now would put a
    // listener and a timer behind the cleanup that has already run.
    if (generation !== liveGeneration) return;
    const indexed = await waitForMarkerIndexed(app, file, OPEN_WAIT_MS);
    // Unloaded while waiting: the note is written, but opening it (or starting a
    // watch) now would mutate the workspace on behalf of a torn-down plugin.
    if (generation !== liveGeneration) return;
    const leaf = app.workspace.getLeaf(true);
    await leaf.openFile(file);
    // Opened before the marker was visible → it landed in markdown. Keep watching
    // so a late index still reaches the editor, without holding the command open.
    // The generation is re-checked because `openFile` is another await boundary: an
    // unload landing inside it runs its cleanup first, and a watch registered after
    // that would be orphaned — owned by a plugin whose interceptor is already gone.
    if (!indexed && generation === liveGeneration) {
      routeWhenMarkerIndexes(app, leaf, file, generation);
    }
  } catch (error) {
    console.error('[Gantt] Failed to create the calendar note:', error);
    new Notice("Couldn't create the calendar note — see console for details.");
    throw error;
  }
}
