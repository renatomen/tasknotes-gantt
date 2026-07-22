/**
 * A calendar's working-day rules and the non-working complement they imply over
 * a window — the single source of truth every shading/conflict surface reads, so
 * the previews and the live chart always agree on which days are worked.
 *
 * Working days come from the availability blocks when present, else the top-level
 * pattern. This is a DAY-granularity projection: an availability block's pattern
 * decides which days it covers; its hours are not consulted here (hour-level
 * effects are a separate, later concern). Every window day matched by no working
 * rule is the blocking (non-working) complement.
 *
 * @module controller/calendar/workingDays
 */

import type { CalendarDefinition } from './schema';
import { addDaysIso } from './schema';
import { evaluatePattern, type EvaluationWindow } from './patternWindow';

export interface WorkingRule {
  rule: string;
  anchor: string | undefined;
}

/**
 * The RRULEs that define a calendar's working days: one per availability block
 * when any are present (the block's pattern; its hours are ignored at day
 * granularity), else the single top-level pattern. Empty when the calendar
 * defines no working pattern at all (e.g. a holidays-only calendar).
 */
export function workingDayRules(definition: CalendarDefinition): WorkingRule[] {
  if (definition.availability.length > 0) {
    return definition.availability.map((block) => ({ rule: block.pattern, anchor: undefined }));
  }
  if (definition.pattern !== undefined) {
    return [{ rule: definition.pattern, anchor: definition.patternStart }];
  }
  return [];
}

/**
 * The non-working days a calendar's working rule(s) imply over the window — every
 * window day matched by no working rule — and whether any valid working rule
 * covers the rest. Generalises a single pattern's blocking complement to the
 * union of pattern + availability blocks. A calendar with no valid working rule
 * covers nothing and blocks nothing here (its dated `non_working` holidays are a
 * separate source the caller adds). An unevaluable rule contributes nothing,
 * matching the existing inert-on-invalid behaviour.
 */
export function workingComplement(
  definition: CalendarDefinition,
  window: EvaluationWindow,
): { blocked: Set<string>; covers: boolean } {
  const working = new Set<string>();
  let covers = false;
  for (const { rule, anchor } of workingDayRules(definition)) {
    const matched = evaluatePattern(rule, anchor, window);
    if (matched.kind !== 'ok') continue;
    covers = true;
    for (const day of matched.dates) working.add(day);
  }

  const blocked = new Set<string>();
  if (covers) {
    for (let day = window.startDate; day < window.endDateExclusive; day = addDaysIso(day, 1)) {
      if (!working.has(day)) blocked.add(day);
    }
  }
  return { blocked, covers };
}
