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
/** How much longer to keep watching, to re-route a note that indexed late. */
const LATE_ROUTE_WINDOW_MS = 60000;

/**
 * Wait until the note's marker is visible in the metadata cache, reporting
 * whether it got there. `vault.create` resolves before the frontmatter is
 * indexed, and the editor router reads the marker from that cache — open too
 * early and the note routes to plain markdown instead of the editor. Resolves at
 * once if already indexed, else on the first matching cache change, with a
 * timeout so a miss never hangs the command.
 */
function waitForMarkerIndexed(app: App, file: TFile, timeoutMs: number): Promise<boolean> {
  const indexed = (): boolean =>
    matchesCalendarMarker(app.metadataCache.getFileCache(file)?.frontmatter) !== null;
  if (indexed()) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const finish = (found: boolean): void => {
      clearTimeout(timer);
      app.metadataCache.offref(ref);
      resolve(found);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    const ref = app.metadataCache.on('changed', (changed) => {
      if (changed.path === file.path && indexed()) finish(true);
    });
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
 * Leaves a leaf that has moved on alone: the user may have navigated it
 * elsewhere, or reopened the note and routed it themselves.
 */
async function routeWhenMarkerIndexes(app: App, leaf: WorkspaceLeaf, file: TFile): Promise<void> {
  if (!(await waitForMarkerIndexed(app, file, LATE_ROUTE_WINDOW_MS))) return;
  const state = leaf.getViewState();
  if (state.type !== 'markdown') return;
  if (state.state?.['file'] !== file.path) return;
  await leaf.setViewState(state);
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
    if (!indexed) {
      void routeWhenMarkerIndexes(app, leaf, file).catch((error) => {
        console.error('[Gantt] Failed to re-route the calendar note to the editor:', error);
      });
    }
  } catch (error) {
    console.error('[Gantt] Failed to create the calendar note:', error);
    new Notice("Couldn't create the calendar note — see console for details.");
    throw error;
  }
}
