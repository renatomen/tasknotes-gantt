/**
 * Timeblock calendar-item source: daily-note timeblocks render as flat
 * read-only event rows, one per valid block, attributed to the daily note's
 * own date (day granularity). The clock times validate a block but never move
 * it off its note's day — a block whose end clock time is at or before its
 * start (some users cross midnight) still attributes to the note's date only,
 * a deliberate simplification until hourly granularity. A malformed block
 * (missing id, unparseable clock time) drops silently — a bad block never
 * breaks the family.
 *
 * Pure module: the daily-note walk, the family toggle, and the liveness epoch
 * all arrive via DI. Emits flat items only — no occupancy.
 *
 * @module datasource/calendarItems/timeblockSource
 */

import type {
  CalendarDerivationWindow,
  CalendarItem,
  CalendarItemBatch,
  CalendarItemSource,
  LocalDay,
} from './types';
import { makeCalendarItemId } from './types';

/** The timeblock slice of the per-view calendar-item toggles. */
export interface TimeblockToggles {
  showTimeblocks: boolean;
}

/** One daily note's raw timeblock payload, as listed by the injected accessor. */
export interface DailyNoteTimeblocks {
  /** The note's own calendar day — every block's day attribution. */
  date: LocalDay;
  path: string;
  /** The raw frontmatter `timeblocks` value; validated per block here. */
  timeblocks: unknown;
}

/** Dependencies of the timeblock source, injected by the controller wiring. */
export interface TimeblockSourceDeps {
  /** Daily notes intersecting the derivation window (metadata-cache walk). */
  listDailyNotes(
    window: CalendarDerivationWindow,
  ): Promise<readonly DailyNoteTimeblocks[]> | readonly DailyNoteTimeblocks[];
  /** Earliest configured Daily Note, used to widen the shared window start. */
  earliestDailyNoteDay?(): LocalDay | null;
  /** Per-view timeblock toggle, read fresh on every collect. */
  toggles(): TimeblockToggles;
  /** Liveness signal, typically the timeblock watch's epoch; absent = constant. */
  epoch?(): number;
}

/** Everything one timeblock expansion derives against. */
export interface TimeblockExpansionInput {
  dailyNotes: readonly DailyNoteTimeblocks[];
  toggles: TimeblockToggles;
}

/** Display title for a block whose own title is missing or blank. */
export const UNTITLED_TIMEBLOCK_TITLE = '(untitled block)';

const CLOCK_TIME_PATTERN = /^([01]?\d|2[0-3]):[0-5]\d$/;

function isClockTime(value: unknown): boolean {
  return typeof value === 'string' && CLOCK_TIME_PATTERN.test(value);
}

function toCalendarItem(note: DailyNoteTimeblocks, block: unknown): CalendarItem | null {
  if (typeof block !== 'object' || block === null) return null;
  const { id, title, startTime, endTime, color } = block as Record<string, unknown>;
  if (typeof id !== 'string' || id === '') return null;
  if (!isClockTime(startTime) || !isClockTime(endTime)) return null;
  const item: CalendarItem = {
    id: makeCalendarItemId('timeblock', note.path, id),
    family: 'timeblock',
    title: typeof title === 'string' && title.trim() !== '' ? title : UNTITLED_TIMEBLOCK_TITLE,
    startDay: note.date,
    endDay: note.date,
    notePath: note.path,
  };
  if (typeof color === 'string' && color !== '') item.color = color;
  return item;
}

/** Pure expansion: valid daily-note timeblocks → flat one-day event rows. */
export function expandTimeblockItems(input: TimeblockExpansionInput): CalendarItemBatch {
  const occupancyByTaskPath = new Map<string, never[]>();
  if (!input.toggles.showTimeblocks) return { items: [], occupancyByTaskPath };

  const items: CalendarItem[] = [];
  for (const note of input.dailyNotes) {
    if (!Array.isArray(note.timeblocks)) continue;
    for (const block of note.timeblocks) {
      const item = toCalendarItem(note, block);
      if (item !== null) items.push(item);
    }
  }
  return { items, occupancyByTaskPath };
}

/** Build the timeblock {@link CalendarItemSource} over injected deps. */
export function createTimeblockSource(deps: TimeblockSourceDeps): CalendarItemSource {
  return {
    family: 'timeblock',
    ...(deps.earliestDailyNoteDay
      ? {
          windowStartAnchor: () =>
            deps.toggles().showTimeblocks ? deps.earliestDailyNoteDay!() : null,
        }
      : {}),
    epoch: () => deps.epoch?.() ?? 0,
    collect: async (context) =>
      expandTimeblockItems({
        dailyNotes: await deps.listDailyNotes(context.window),
        toggles: deps.toggles(),
      }),
  };
}
