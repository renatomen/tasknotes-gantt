/**
 * The union of a calendar-set's member calendars over a window: the day-facts
 * the set previews render. A day is blocking (non-working) when ANY member
 * blocks it; events and markers are the union across members; conflicts are the
 * days where members disagree — one blocks while another's pattern covers it,
 * exactly the existing `conflictDates` definition. The set editor's Week/Strip/
 * Year tabs each build this over their own evaluation window.
 *
 * @module editor/unionPreview
 */

import { parseCalendarFrontmatter, type CalendarDefinition } from '../controller/calendar/schema';
import { stripSubpath } from '../controller/calendar/resolveCalendars';
import type { EvaluationWindow } from '../controller/calendar/patternWindow';
import { conflictsFromFacts, type CalendarDayFacts } from '../bases/calendarConflicts';
import {
  blockingFacts,
  emptyClassifiedDays,
  eventDays,
  markerDays,
  mergeClassifiedDays,
  type ClassifiedDays,
} from './calendarDayFacts';

/**
 * The outcome of resolving one set-member link: a valid member calendar, a link
 * that doesn't resolve to a file, or a note that resolves but isn't a valid
 * calendar (an invalid note, or a calendar-set — sets are flat). Only `ok`
 * definitions flow into the union; the other two count separately in the banner.
 */
export type MemberResolution =
  | { kind: 'ok'; name: string; definition: CalendarDefinition }
  | { kind: 'unresolved' }
  | { kind: 'invalid' };

/** A resolved member note: its display name and frontmatter, or null when the
 *  link finds no file. */
export interface ResolvedMemberNote {
  name: string;
  frontmatter: unknown;
}

/**
 * Classify one set-member link into the union's three-way outcome, given a
 * resolver that turns a link into a note (or null). The link's subpath is
 * stripped first (association is note-level), then the note's frontmatter is
 * parsed: a valid calendar is `ok`, anything else that resolved — an invalid
 * note or a calendar-set, since sets are flat — is `invalid`, and a link that
 * resolves to no file is `unresolved`. Pure: the Obsidian resolution lives in
 * the caller, so the policy unit-tests without a vault.
 */
export function classifyMember(
  link: string,
  resolve: (strippedLink: string) => ResolvedMemberNote | null,
): MemberResolution {
  const note = resolve(stripSubpath(link));
  if (note === null) return { kind: 'unresolved' };
  const parsed = parseCalendarFrontmatter(note.frontmatter);
  return parsed !== null && parsed.kind === 'calendar'
    ? { kind: 'ok', name: note.name, definition: parsed }
    : { kind: 'invalid' };
}

/** One member's stake in a conflict day: its own label for the day (a holiday or
 *  event name) — or undefined when it merely covers the day or blocks it via its
 *  weekly pattern — and which calendar it is. */
export interface ConflictSource {
  calendar: string;
  description: string | undefined;
}

export interface UnionModel {
  /** Days blocking (non-working) in at least one member. */
  blocking: ClassifiedDays;
  /** Display-only event days (one-off + recurring) across all members. */
  events: ClassifiedDays;
  /** Member markers, deduped by date (first name wins). */
  markers: ClassifiedDays;
  /** Days where members disagree: one blocks while another covers. */
  conflicts: Set<string>;
  /** Per conflict day, the disagreeing members and how each labels it. Empty
   *  unless member names were supplied (only the tooltip needs the attribution). */
  conflictSources: Map<string, ConflictSource[]>;
}

/**
 * Combine resolved member calendars into their union day-facts over `window`.
 * When `names` is supplied (index-aligned with `members`), each conflict day is
 * attributed to the members that disagree on it, for the preview tooltip.
 */
export function buildUnionModel(
  members: readonly CalendarDefinition[],
  window: EvaluationWindow,
  names?: readonly string[],
): UnionModel {
  const blocking = emptyClassifiedDays();
  const events = emptyClassifiedDays();
  const markers = emptyClassifiedDays();
  // One blocking pass per member feeds the union's shading, its conflicts, and
  // the per-day conflict attribution — no member's blocking complement is
  // evaluated more than once.
  const perMember: { name: string | undefined; blocking: ClassifiedDays; covers: boolean }[] = [];
  members.forEach((member, index) => {
    const memberBlocking = blockingFacts(member, window);
    mergeClassifiedDays(blocking, memberBlocking.blocking);
    mergeClassifiedDays(events, eventDays(member, window));
    mergeClassifiedDays(markers, markerDays(member));
    perMember.push({ name: names?.[index], blocking: memberBlocking.blocking, covers: memberBlocking.covers });
  });
  const facts: CalendarDayFacts[] = perMember.map((m) => ({ blocked: m.blocking.days, covers: m.covers }));
  const conflicts = new Set(conflictsFromFacts(facts, window));
  const conflictSources =
    names === undefined ? new Map<string, ConflictSource[]>() : attributeConflicts(conflicts, perMember);
  return { blocking, events, markers, conflicts, conflictSources };
}

/** For each conflict day, list every member that blocks or covers it, with the
 *  blocker's own label (a covering member, or a weekly-pattern block, has none). */
function attributeConflicts(
  conflicts: ReadonlySet<string>,
  perMember: readonly { name: string | undefined; blocking: ClassifiedDays; covers: boolean }[],
): Map<string, ConflictSource[]> {
  const sources = new Map<string, ConflictSource[]>();
  for (const day of conflicts) {
    const daySources: ConflictSource[] = [];
    for (const member of perMember) {
      if (member.blocking.days.has(day)) {
        daySources.push({ calendar: member.name ?? '', description: member.blocking.names.get(day) });
      } else if (member.covers) {
        daySources.push({ calendar: member.name ?? '', description: undefined });
      }
    }
    sources.set(day, daySources);
  }
  return sources;
}
