/**
 * Per-day classification facts for a single calendar over a window — the marker,
 * blocking (non-working), and event day-sets the previews render, each carrying
 * the entry name that produced the day (for hover labels). Extracted from the
 * year grid so the calendar-set union preview can compute the same facts per
 * member and combine them, rather than duplicating the derivation.
 *
 * @module editor/calendarDayFacts
 */

import type { CalendarDefinition } from '../controller/calendar/schema';
import { addDaysIso } from '../controller/calendar/schema';
import {
  blockingComplement,
  evaluatePattern,
  type EvaluationWindow,
} from '../controller/calendar/patternWindow';

/** A day set with the entry name that produced each day (for hover labels). */
export interface ClassifiedDays {
  days: Set<string>;
  names: Map<string, string>;
}

export function emptyClassifiedDays(): ClassifiedDays {
  return { days: new Set(), names: new Map() };
}

export function markerDays(definition: CalendarDefinition): ClassifiedDays {
  const result = emptyClassifiedDays();
  for (const marker of definition.markers) {
    result.days.add(marker.date);
    if (marker.name !== undefined) result.names.set(marker.date, marker.name);
  }
  return result;
}

/** Non-working days: the pattern's blocking complement plus explicit spans. */
export function blockingDays(
  definition: CalendarDefinition,
  window: EvaluationWindow,
): ClassifiedDays {
  return blockingFacts(definition, window).blocking;
}

/**
 * Blocking days (with names) plus whether a valid working pattern covers the
 * rest — the two facts a set-union conflict check needs. Computing them together
 * lets the union derive both its blocking shading and its conflicts from one
 * pass per member, rather than evaluating the blocking complement twice.
 */
export function blockingFacts(
  definition: CalendarDefinition,
  window: EvaluationWindow,
): { blocking: ClassifiedDays; covers: boolean } {
  const blocking = emptyClassifiedDays();
  let covers = false;
  if (definition.pattern !== undefined) {
    const complement = blockingComplement(definition.pattern, definition.patternStart, window);
    if (complement.kind === 'ok') {
      covers = true;
      for (const day of complement.dates) blocking.days.add(day);
    }
  }
  addSpanDays(definition.nonWorking, window, blocking);
  return { blocking, covers };
}

/** Display-only days: dated event spans plus recurring-event occurrences. */
export function eventDays(definition: CalendarDefinition, window: EvaluationWindow): ClassifiedDays {
  const result = emptyClassifiedDays();
  addSpanDays(definition.events, window, result);
  for (const event of definition.recurringEvents) {
    // Anchor to the calendar's pattern_start, matching the live shading path, so
    // an anchored (INTERVAL/COUNT/UNTIL) recurrence is not silently dropped.
    const occurrences = evaluatePattern(event.rrule, definition.patternStart, window);
    if (occurrences.kind !== 'ok') continue;
    for (const day of occurrences.dates) {
      result.days.add(day);
      if (event.name !== undefined) result.names.set(day, event.name);
    }
  }
  return result;
}

/** Merge `source` into `into`, keeping the first name seen for a day. */
export function mergeClassifiedDays(into: ClassifiedDays, source: ClassifiedDays): void {
  for (const day of source.days) {
    into.days.add(day);
    const name = source.names.get(day);
    if (name !== undefined && !into.names.has(day)) into.names.set(day, name);
  }
}

function addSpanDays(
  spans: ReadonlyArray<{ startDate: string; endDateExclusive: string; name: string | undefined }>,
  window: EvaluationWindow,
  into: ClassifiedDays,
): void {
  for (const span of spans) {
    for (let day = span.startDate; day < span.endDateExclusive; day = addDaysIso(day, 1)) {
      if (day < window.startDate || day >= window.endDateExclusive) continue;
      into.days.add(day);
      if (span.name !== undefined) into.names.set(day, span.name);
    }
  }
}
