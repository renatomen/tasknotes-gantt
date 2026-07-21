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

import type { CalendarDefinition } from '../controller/calendar/schema';
import type { EvaluationWindow } from '../controller/calendar/patternWindow';
import { conflictDates } from '../bases/calendarConflicts';
import {
  blockingDays,
  emptyClassifiedDays,
  eventDays,
  markerDays,
  mergeClassifiedDays,
  type ClassifiedDays,
} from './calendarDayFacts';

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
  for (const member of members) {
    mergeClassifiedDays(blocking, blockingDays(member, window));
    mergeClassifiedDays(events, eventDays(member, window));
    mergeClassifiedDays(markers, markerDays(member));
  }
  return { blocking, events, markers, conflicts: new Set(conflictDates(members, window)) };
}
