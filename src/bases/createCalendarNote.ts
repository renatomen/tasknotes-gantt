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
import { Notice, TFile, type App } from 'obsidian';
import { matchesCalendarMarker } from '../controller/calendar/schema';
import {
  CREATE_FOLDER,
  calendarSetSkeletonText,
  calendarSkeletonText,
  uniqueCalendarPath,
  uniqueCalendarSetPath,
} from './calendarPickerModel';

export type CalendarNoteKind = 'calendar' | 'calendar-set';

/**
 * Wait until the note's marker is visible in the metadata cache. `vault.create`
 * resolves before the frontmatter is indexed, and the editor router reads the
 * marker from that cache — open too early and the note routes to plain markdown
 * instead of the editor. Resolves at once if already indexed, else on the first
 * matching cache change, with a timeout so a miss never hangs the command.
 */
function waitForMarkerIndexed(app: App, file: TFile, timeoutMs = 2000): Promise<void> {
  const indexed = (): boolean =>
    matchesCalendarMarker(app.metadataCache.getFileCache(file)?.frontmatter) !== null;
  if (indexed()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      app.metadataCache.offref(ref);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    const ref = app.metadataCache.on('changed', (changed) => {
      if (changed.path === file.path && indexed()) finish();
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
    await waitForMarkerIndexed(app, file);
    await app.workspace.getLeaf(true).openFile(file);
  } catch (error) {
    console.error('[Gantt] Failed to create the calendar note:', error);
    new Notice("Couldn't create the calendar note — see console for details.");
    throw error;
  }
}
