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
  | { kind: 'ok'; definition: CalendarDefinition }
  | { kind: 'unresolved' }
  | { kind: 'invalid' };

/** A resolved member note: its frontmatter, or null when the link finds no file. */
export interface ResolvedMemberNote {
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
    ? { kind: 'ok', definition: parsed }
    : { kind: 'invalid' };
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
}

/** Combine resolved member calendars into their union day-facts over `window`. */
export function buildUnionModel(
  members: readonly CalendarDefinition[],
  window: EvaluationWindow,
): UnionModel {
  const blocking = emptyClassifiedDays();
  const events = emptyClassifiedDays();
  const markers = emptyClassifiedDays();
  // One blocking pass per member feeds both the union's shading and its
  // conflicts — the conflict check reuses the same blocked/covers facts rather
  // than re-evaluating each member's blocking complement.
  const facts: CalendarDayFacts[] = [];
  for (const member of members) {
    const memberBlocking = blockingFacts(member, window);
    mergeClassifiedDays(blocking, memberBlocking.blocking);
    facts.push({ blocked: memberBlocking.blocking.days, covers: memberBlocking.covers });
    mergeClassifiedDays(events, eventDays(member, window));
    mergeClassifiedDays(markers, markerDays(member));
  }
  return { blocking, events, markers, conflicts: new Set(conflictsFromFacts(facts, window)) };
}
