/**
 * Multi-calendar disagreement classification: a date conflicts exactly when
 * one displayed calendar blocks it while another displayed calendar's working
 * pattern explicitly covers it. Agreement (all block, or all cover) is never
 * a conflict, a calendar cannot conflict with itself, and display-only
 * events never block, so they never conflict.
 */

import { addDaysIso, type CalendarDefinition } from '../controller/calendar/schema';
import type { EvaluationWindow } from '../controller/calendar/patternWindow';
import { workingComplement, workingDayRules } from '../controller/calendar/workingDays';

/**
 * Whether the selected calendar definitions can disagree, independent of the
 * currently rendered chart window. This is a capability signal for the legend;
 * the rendered conflict dates remain windowed by `conflictDatesWithSources`.
 */
export function calendarConflictCapability(
  calendars: ReadonlyArray<CalendarDefinition>,
): boolean {
  if (calendars.length < 2) return false;
  const signatures = new Set(calendars.map(conflictSignature));
  const canCover = calendars.some((calendar) => workingDayRules(calendar).length > 0);
  const canBlock = calendars.some(
    (calendar) => workingDayRules(calendar).length > 0 || calendar.nonWorking.length > 0,
  );
  return canCover && canBlock && signatures.size > 1;
}

function conflictSignature(calendar: CalendarDefinition): string {
  const rules = workingDayRules(calendar)
    .map(({ rule, anchor }) => `${rule}|${anchor ?? ''}`)
    .sort();
  const nonWorking = calendar.nonWorking
    .map(({ startDate, endDateExclusive }) => `${startDate}|${endDateExclusive}`)
    .sort();
  return JSON.stringify({ rules, nonWorking });
}

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
 * Conflict days plus the names of the calendars that disagree — the attributed
 * form of {@link conflictDates}, for callers that hold each calendar name.
 */
export function conflictDatesWithSources(
  calendars: ReadonlyArray<{ path: string; name: string; definition: CalendarDefinition }>,
  window: EvaluationWindow,
): { dates: string[]; calendars: string[] } {
  return conflictsWithSources(
    calendars.map(({ path, name, definition }) => ({
      id: path,
      name,
      ...dayFacts(definition, window),
    })),
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

/** Per-calendar day facts, identified — the input to conflict attribution. */
export interface NamedCalendarDayFacts extends CalendarDayFacts {
  /** Stable identity (the note path); two same-named calendars stay distinct. */
  id: string;
  /** Display name for the banner. */
  name: string;
}

/**
 * Conflict days **and the calendars that disagree on them**, so a banner can name
 * them instead of reporting a bare count the user has to go and investigate.
 *
 * A calendar takes part in a conflict on either side of the disagreement: it
 * blocks a day another one covers, or it covers a day another one blocks. Names
 * are collected in input order and deduplicated, so the banner reads in the same
 * order as the picker.
 */
export function conflictsWithSources(
  facts: ReadonlyArray<NamedCalendarDayFacts>,
  window: EvaluationWindow,
): { dates: string[]; calendars: string[] } {
  const dates: string[] = [];
  // Participation is tracked by ID, not display name: two calendars in different
  // folders can share a basename, and collapsing them would render a false
  // self-conflict ("between Work") with a wrong +N count.
  const disagreeing = new Set<string>();
  for (let day = window.startDate; day < window.endDateExclusive; day = addDaysIso(day, 1)) {
    const blockers = facts.filter((fact) => fact.blocked.has(day));
    const coverers = facts.filter((fact) => fact.covers && !fact.blocked.has(day));
    if (blockers.length === 0 || coverers.length === 0) continue;
    dates.push(day);
    for (const fact of [...blockers, ...coverers]) disagreeing.add(fact.id);
  }
  // Input order, one entry per participating calendar (names may repeat).
  const calendars = facts.filter((fact) => disagreeing.has(fact.id)).map((fact) => fact.name);
  return { dates, calendars };
}

function dayFacts(calendar: CalendarDefinition, window: EvaluationWindow): CalendarDayFacts {
  // Working days (and the covers flag) come from the shared source — pattern or
  // availability blocks — so conflicts see exactly what the chart shades.
  const { blocked, covers } = workingComplement(calendar, window);
  for (const span of calendar.nonWorking) {
    for (
      let day = span.startDate < window.startDate ? window.startDate : span.startDate;
      day < span.endDateExclusive && day < window.endDateExclusive;
      day = addDaysIso(day, 1)
    ) {
      blocked.add(day);
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
  /**
   * The calendars that disagree, so the banner can say WHICH selection caused the
   * conflict. Capped when rendered — the point is to identify the culprits, not to
   * reproduce the picker.
   */
  conflictCalendars?: readonly string[];
}

/** How many disagreeing calendars the banner names before summarising the rest. */
const MAX_NAMED_CONFLICT_CALENDARS = 3;

/** `NZ Holidays, Sun Thu` — or `A, B, C +2 more` past the cap. */
function namedCalendars(names: readonly string[]): string {
  if (names.length <= MAX_NAMED_CONFLICT_CALENDARS) return names.join(', ');
  const shown = names.slice(0, MAX_NAMED_CONFLICT_CALENDARS).join(', ');
  return `${shown} +${names.length - MAX_NAMED_CONFLICT_CALENDARS} more`;
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
    const between =
      facts.conflictCalendars && facts.conflictCalendars.length > 0
        ? ` between ${namedCalendars(facts.conflictCalendars)}`
        : '';
    parts.push(
      `${facts.conflictCount} ${plural(facts.conflictCount, 'day', 'days')} in conflict${inYear}${between}`,
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
