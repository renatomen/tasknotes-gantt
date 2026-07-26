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
 * Live marker watches, so a plugin unload can drop every one of them (this
 * module has no plugin handle of its own to register events against).
 */
const markerWatches = new Set<() => void>();

/**
 * Cancel every pending marker watch. Called on plugin unload so a watch left
 * over from a create — the re-route below deliberately has no deadline — cannot
 * outlive the plugin.
 */
export function cancelPendingMarkerWatches(): void {
  for (const stop of [...markerWatches]) stop();
}

/**
 * Run `onIndexed` once — as soon as the note's marker is visible in the metadata
 * cache. `vault.create` resolves before the frontmatter is indexed, and the editor
 * router reads the marker from that cache, so acting too early routes the note to
 * plain markdown instead of the editor.
 *
 * One-shot: the watch releases its listener as soon as the marker lands. Callers
 * that must not wait forever impose their own deadline; the rest are released by
 * {@link cancelPendingMarkerWatches} at unload.
 */
function watchForMarker(app: App, file: TFile, onIndexed: () => void): () => void {
  const indexed = (): boolean =>
    matchesCalendarMarker(app.metadataCache.getFileCache(file)?.frontmatter) !== null;
  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    app.metadataCache.offref(changedRef);
    markerWatches.delete(stop);
  };
  const changedRef = app.metadataCache.on('changed', (changed) => {
    if (changed.path !== file.path || !indexed()) return;
    stop();
    onIndexed();
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
 * way rather than hang on a slow index.
 */
function waitForMarkerIndexed(app: App, file: TFile, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let found = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = watchForMarker(app, file, () => {
      found = true;
      clearTimeout(timer);
      resolve(true);
    });
    // An already-indexed marker settles the watch synchronously — no deadline to arm.
    if (found) return;
    timer = setTimeout(() => {
      stop();
      resolve(false);
    }, timeoutMs);
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
 */
function routeWhenMarkerIndexes(app: App, leaf: WorkspaceLeaf, file: TFile): void {
  watchForMarker(app, file, () => {
    const state = leaf.getViewState();
    if (state.type !== 'markdown') return;
    if (state.state?.['file'] !== file.path) return;
    void Promise.resolve(leaf.setViewState(state)).catch((error) => {
      console.error('[Gantt] Failed to re-route the calendar note to the editor:', error);
    });
  });
}

/** Create a `Calendars/` note of the given kind from its skeleton and open it. */
export async function createAndOpenCalendarNote(app: App, kind: CalendarNoteKind): Promise<void> {
  try {
    const { vault } = app;
    const exists = (path: string): boolean => vault.getAbstractFileByPath(path) !== null;
    if (!exists(CREATE_FOLDER)) {
      await vault.createFolder(CREATE_FOLDER).catch(() => undefined);
    }
    const path = kind === 'calendar' ? uniqueCalendarPath(exists) : uniqueCalendarSetPath(exists);
    const text = kind === 'calendar' ? calendarSkeletonText() : calendarSetSkeletonText();
    const file = (await vault.create(path, text)) as TFile;
    const indexed = await waitForMarkerIndexed(app, file, OPEN_WAIT_MS);
    const leaf = app.workspace.getLeaf(true);
    await leaf.openFile(file);
    // Opened before the marker was visible → it landed in markdown. Keep watching
    // so a late index still reaches the editor, without holding the command open.
    if (!indexed) routeWhenMarkerIndexes(app, leaf, file);
  } catch (error) {
    console.error('[Gantt] Failed to create the calendar note:', error);
    new Notice("Couldn't create the calendar note — see console for details.");
    throw error;
  }
}
