/**
 * Multi-calendar disagreement classification: a date conflicts exactly when
 * one displayed calendar blocks it while another displayed calendar's working
 * pattern explicitly covers it. Agreement (all block, or all cover) is never
 * a conflict, a calendar cannot conflict with itself, and display-only
 * events never block, so they never conflict.
 */

import { addDaysIso, type CalendarDefinition } from '../controller/calendar/schema';
import { blockingComplement, type EvaluationWindow } from '../controller/calendar/patternWindow';

export interface CalendarDayFacts {
  /** Days this calendar blocks inside the window. */
  blocked: Set<string>;
  /** True when a valid working pattern makes uncomplemented days covered. */
  covers: boolean;
}

export function conflictDates(
  calendars: ReadonlyArray<CalendarDefinition>,
  window: EvaluationWindow,
): string[] {
  return conflictsFromFacts(
    calendars.map((calendar) => dayFacts(calendar, window)),
    window,
  );
}

/**
 * The conflict-classification core over already-computed per-calendar day facts:
 * a day conflicts exactly when one calendar blocks it while another covers it.
 * Callers that already hold each calendar's blocked/covers facts (the set-union
 * preview) use this to avoid recomputing the blocking complement a second time.
 */
export function conflictsFromFacts(
  facts: ReadonlyArray<CalendarDayFacts>,
  window: EvaluationWindow,
): string[] {
  const conflicts: string[] = [];
  for (let day = window.startDate; day < window.endDateExclusive; day = addDaysIso(day, 1)) {
    const blockedBy = facts.some((fact) => fact.blocked.has(day));
    const coveredBy = facts.some((fact) => fact.covers && !fact.blocked.has(day));
    if (blockedBy && coveredBy) conflicts.push(day);
  }
  return conflicts;
}

function dayFacts(calendar: CalendarDefinition, window: EvaluationWindow): CalendarDayFacts {
  const blocked = new Set<string>();
  for (const span of calendar.nonWorking) {
    for (
      let day = span.startDate < window.startDate ? window.startDate : span.startDate;
      day < span.endDateExclusive && day < window.endDateExclusive;
      day = addDaysIso(day, 1)
    ) {
      blocked.add(day);
    }
  }
  let covers = false;
  if (calendar.pattern !== undefined) {
    const complement = blockingComplement(calendar.pattern, calendar.patternStart, window);
    if (complement.kind === 'ok') {
      covers = true;
      for (const date of complement.dates) blocked.add(date);
    }
  }
  return { blocked, covers };
}

export interface CalendarNoticeFacts {
  displayedCount: number;
  conflictCount: number;
  invalidCount: number;
  /** Selected entries whose links no longer resolve. */
  flaggedCount: number;
  /** Names the year the conflict count is scoped to, when the count is shown. */
  conflictYear?: number;
  /** Conflicts the counted window misses but a preview still surfaces. */
  conflictsElsewhere?: boolean;
}

/**
 * The calendar-status banner line, or null when there is nothing to say. The
 * banner exists from two displayed calendars up (the picker's shortcut) and
 * whenever any calendar needs attention. The conflict count is scoped to one
 * window (the selected year); `conflictsElsewhere` keeps the banner honest when
 * a preview shows a conflict that window misses.
 */
export function buildCalendarNotice(facts: CalendarNoticeFacts): string | null {
  const parts: string[] = [];
  if (facts.displayedCount >= 2) {
    parts.push(`Displaying ${facts.displayedCount} calendars`);
  }
  if (facts.conflictCount > 0) {
    const inYear = facts.conflictYear !== undefined ? ` in ${facts.conflictYear}` : '';
    parts.push(
      `${facts.conflictCount} ${plural(facts.conflictCount, 'day', 'days')} in conflict${inYear}`,
    );
  } else if (facts.conflictsElsewhere) {
    parts.push('conflicts exist in other years');
  }
  if (facts.invalidCount > 0) {
    parts.push(
      `${facts.invalidCount} invalid calendar ${plural(facts.invalidCount, 'note', 'notes')}`,
    );
  }
  if (facts.flaggedCount > 0) {
    parts.push(
      `${facts.flaggedCount} selected ${plural(facts.flaggedCount, 'link', 'links')} unresolved`,
    );
  }
  return parts.length === 0 ? null : parts.join(' · ');
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

