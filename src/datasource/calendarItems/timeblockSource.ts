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
import { dlog } from '../../debugLog';

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
/** NUL twin separator: impossible in a real frontmatter id, so a suffixed
 *  twin never collides with a raw id; encodeURIComponent renders it %00. */
const TWIN_SEPARATOR = String.fromCodePoint(0);

function isClockTime(value: unknown): boolean {
  return typeof value === 'string' && CLOCK_TIME_PATTERN.test(value);
}

/** Whether an id is a usable timeblock key: a non-empty string with no NUL (the
 *  twin separator), so a raw id can never collide with a suffixed twin. */
function isUsableId(id: unknown): id is string {
  return typeof id === 'string' && id !== '' && !id.includes(TWIN_SEPARATOR);
}

/** The block's own `id` when it is a usable timeblock, else null. */
function validTimeblockId(block: unknown): string | null {
  if (typeof block !== 'object' || block === null) return null;
  const { id, startTime, endTime } = block as Record<string, unknown>;
  if (!isUsableId(id)) return null;
  if (!isClockTime(startTime) || !isClockTime(endTime)) return null;
  return id;
}

// A daily note can hold two blocks with the same id; both would key the same
// synthetic row and one would overwrite the other. A per-note occurrence suffix
// keeps twins distinct while leaving a unique id's row identity stable.
function toCalendarItem(note: DailyNoteTimeblocks, block: unknown, twinSuffix: string): CalendarItem | null {
  if (typeof block !== 'object' || block === null) return null;
  const { id, title, startTime, endTime, color } = block as Record<string, unknown>;
  if (!isUsableId(id)) return null;
  if (!isClockTime(startTime) || !isClockTime(endTime)) return null;
  const item: CalendarItem = {
    id: makeCalendarItemId('timeblock', note.path, `${id}${twinSuffix}`),
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
    // Wrap validation too: a throwing accessor/Proxy on a block must skip that
    // block, not abort the note's whole expansion.
    const ids = note.timeblocks.map((block) => {
      try {
        return validTimeblockId(block);
      } catch {
        return null;
      }
    });
    const idCounts = new Map<string, number>();
    for (const id of ids) if (id !== null) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
    const seen = new Map<string, number>();
    note.timeblocks.forEach((block, index) => {
      const id = ids[index];
      let twinSuffix = '';
      if (typeof id === 'string' && (idCounts.get(id) ?? 0) > 1) {
        const ordinal = (seen.get(id) ?? 0) + 1;
        seen.set(id, ordinal);
        twinSuffix = `${TWIN_SEPARATOR}${ordinal}`;
      }
      try {
        const item = toCalendarItem(note, block, twinSuffix);
        if (item !== null) items.push(item);
      } catch (error) {
        // Last-resort ingestion boundary: a pathological id (e.g. a lone
        // surrogate reaching encodeURIComponent) skips this one block rather
        // than aborting the whole snapshot build. Debug-gated breadcrumb only.
        dlog('[calendar] skipped a malformed timeblock', error);
      }
    });
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
