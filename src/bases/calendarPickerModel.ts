/**
 * Pure row/transition model behind the calendar picker modal. The modal is
 * thin DOM wiring; every decision — row states, indeterminate parents,
 * flagged rows, toggle transitions, the create-note scaffold — lives here so
 * it unit-tests without Obsidian.
 */

import type { CalendarRegistry } from '../controller/calendar/resolveCalendars';
import { resolveTaskCalendar } from '../controller/calendar/resolveCalendars';
import {
  materializeSelection,
  setDefaultRow,
  setEntryAllMembers,
  setEntryEnabled,
  setMemberEnabled,
  type DisplaySelection,
  type SelectionEntry,
  type StoredSelectionValue,
} from './calendarSelection';

export interface PickerContext {
  registry: CalendarRegistry;
  selection: DisplaySelection;
  /** Link text → vault path, or null when dangling. */
  resolveLink: (link: string) => string | null;
  /** Canonical wikilink for a vault path (used when an entry must be created). */
  linkFor: (path: string) => string;
  /** Calendar paths displayed while the selection is auto (association-derived). */
  autoDisplayedPaths: ReadonlySet<string>;
}

export interface DefaultRowModel {
  kind: 'default';
  enabled: boolean;
}

export interface CalendarRowModel {
  kind: 'calendar';
  path: string;
  name: string;
  description: string | undefined;
  color: string | undefined;
  checked: boolean;
}

export interface SetMemberRowModel {
  link: string;
  path: string;
  name: string;
  checked: boolean;
}

export type SetRowState = 'all' | 'none' | 'partial';

export interface SetRowModel {
  kind: 'set';
  path: string;
  name: string;
  description: string | undefined;
  color: string | undefined;
  state: SetRowState;
  members: SetMemberRowModel[];
}

export interface FlaggedRowModel {
  kind: 'flagged';
  label: string;
  reason: string;
}

export type PickerRowModel = DefaultRowModel | CalendarRowModel | SetRowModel | FlaggedRowModel;

/** Writes the modal hands back to the view for persistence. */
export interface PickerWrites {
  displayCalendars: StoredSelectionValue;
  highlightWeekends?: boolean;
}

export interface PickerTransition {
  selection: DisplaySelection;
  writes: PickerWrites | null;
}

export function buildPickerRows(context: PickerContext): PickerRowModel[] {
  const { registry, selection } = context;
  const entriesByPath = mapEntriesByPath(context);
  const rows: PickerRowModel[] = [{ kind: 'default', enabled: selection.defaultRow }];

  for (const calendar of registry.calendars.values()) {
    const entry = entriesByPath.get(calendar.path);
    rows.push({
      kind: 'calendar',
      path: calendar.path,
      name: calendar.name,
      description: calendar.definition.description,
      color: calendar.definition.color,
      checked: entry ? entry.enabled : isAutoDisplayed(context, calendar.path),
    });
  }

  for (const set of registry.sets.values()) {
    const entry = entriesByPath.get(set.path);
    const members = set.members.map((member) => ({
      link: member.link,
      path: member.path,
      name: registry.calendars.get(member.path)?.name ?? member.path,
      checked: entry
        ? entry.enabled && entry.members?.[member.link] !== false
        : isAutoDisplayed(context, member.path),
    }));
    rows.push({
      kind: 'set',
      path: set.path,
      name: set.name,
      description: set.definition.description,
      color: set.definition.color,
      state: setStateOf(members),
      members,
    });
  }

  for (const [, invalid] of context.registry.invalid) {
    rows.push({ kind: 'flagged', label: invalid.name, reason: invalid.reasons.join('; ') });
  }
  for (const entry of selection.entries) {
    if (context.resolveLink(entry.link) === null) {
      rows.push({ kind: 'flagged', label: entry.link, reason: 'link does not resolve' });
    }
  }
  return rows;
}

function setStateOf(members: readonly SetMemberRowModel[]): SetRowState {
  if (members.every((member) => !member.checked)) return 'none';
  return members.every((member) => member.checked) ? 'all' : 'partial';
}

function isAutoDisplayed(context: PickerContext, path: string): boolean {
  return context.selection.auto && context.autoDisplayedPaths.has(path);
}

function mapEntriesByPath(context: PickerContext): Map<string, SelectionEntry> {
  const byPath = new Map<string, SelectionEntry>();
  for (const entry of context.selection.entries) {
    const path = context.resolveLink(entry.link);
    if (path !== null) byPath.set(path, entry);
  }
  return byPath;
}

export function toggleDefaultRow(context: PickerContext): PickerTransition {
  const { selection, writes } = setDefaultRow(context.selection, !context.selection.defaultRow);
  return { selection, writes };
}

export function toggleCalendarRow(
  context: PickerContext,
  row: CalendarRowModel,
): PickerTransition {
  const explicit = ensureExplicit(context);
  const link = linkForPath(context, explicit, row.path);
  const { selection, write } = setEntryEnabled(explicit, link, !row.checked);
  return { selection, writes: write === null ? null : { displayCalendars: write } };
}

/**
 * A fully-enabled set disables; a partial (indeterminate) or disabled set
 * enables every member.
 */
export function toggleSetRow(context: PickerContext, row: SetRowModel): PickerTransition {
  const explicit = ensureExplicit(context);
  const link = linkForPath(context, explicit, row.path);
  const { selection, write } =
    row.state === 'all'
      ? setEntryEnabled(explicit, link, false)
      : setEntryAllMembers(explicit, link);
  return { selection, writes: write === null ? null : { displayCalendars: write } };
}

export function toggleSetMember(
  context: PickerContext,
  row: SetRowModel,
  member: SetMemberRowModel,
): PickerTransition {
  const explicit = ensureExplicit(context);
  const link = linkForPath(context, explicit, row.path);
  const { selection, write } = setMemberEnabled(explicit, link, member.link, !member.checked);
  return { selection, writes: write === null ? null : { displayCalendars: write } };
}

/**
 * The first explicit toggle from auto seeds the entry list from the
 * auto-displayed calendars so the visible union does not jump.
 */
function ensureExplicit(context: PickerContext): DisplaySelection {
  return materializeSelection(
    context.selection,
    [...context.autoDisplayedPaths].map((path) => context.linkFor(path)),
  );
}

function linkForPath(
  context: PickerContext,
  selection: DisplaySelection,
  path: string,
): string {
  for (const entry of selection.entries) {
    if (context.resolveLink(entry.link) === path) return entry.link;
  }
  return context.linkFor(path);
}

/**
 * The calendar paths displayed while no selection is stored: the union of
 * every task association's resolved member calendars.
 */
export function autoDisplayedPathsFrom(
  registry: CalendarRegistry,
  associations: ReadonlyArray<{ value: unknown; taskPath: string }>,
  resolveLink: (linkText: string, fromPath: string) => string | null,
): Set<string> {
  const paths = new Set<string>();
  for (const association of associations) {
    const resolved = resolveTaskCalendar(
      registry,
      association.value,
      association.taskPath,
      resolveLink,
    );
    for (const calendar of resolved.calendars) paths.add(calendar.path);
  }
  return paths;
}

const CREATE_FOLDER = 'Calendars';
const CREATE_BASENAME = 'New Calendar';

/** First `Calendars/New Calendar[ N].md` path that does not already exist. */
export function uniqueCalendarPath(exists: (path: string) => boolean): string {
  const candidate = `${CREATE_FOLDER}/${CREATE_BASENAME}.md`;
  if (!exists(candidate)) return candidate;
  for (let n = 2; ; n++) {
    const numbered = `${CREATE_FOLDER}/${CREATE_BASENAME} ${n}.md`;
    if (!exists(numbered)) return numbered;
  }
}

/**
 * The scaffolded frontmatter as data (the object form the schema parser
 * validates) and as note text. Mon–Fri is the least-surprising starting
 * pattern; users edit from there.
 */
export const CALENDAR_SKELETON_FRONTMATTER = {
  tngantt: 'calendar',
  pattern: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  non_working: [],
} as const;

export function calendarSkeletonText(): string {
  return [
    '---',
    `tngantt: ${CALENDAR_SKELETON_FRONTMATTER.tngantt}`,
    `pattern: "${CALENDAR_SKELETON_FRONTMATTER.pattern}"`,
    'non_working: []',
    '---',
    '',
  ].join('\n');
}
