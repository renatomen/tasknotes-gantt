/**
 * Pure decision logic for the Estimate-meaning axis, extracted from the register
 * so it is unit-testable independently of the Obsidian vault. The register keeps
 * only the thin app-wiring (reading frontmatter) and delegates every decision
 * here; span↔estimate derivation itself lives with the controller's derivation
 * authority.
 */
import {
  resolveEstimateMeaning,
  type EstimateMeaning,
  type NonWorkingRendering,
} from './viewOptions';

/**
 * Whether the availability seam must engage for a view. The seam is only needed
 * when an axis actually reads the calendar: split rendering (to find blocked
 * days), a `working-days` view default (to re-project a derived edge), or a
 * mapped per-task override (which could select `working-days` on some task).
 * Otherwise today's flat, calendar-blind behaviour holds.
 */
export function needsCalendarSeam(
  rendering: NonWorkingRendering,
  viewMeaning: EstimateMeaning,
  overrideMapped: boolean,
): boolean {
  return rendering === 'split' || viewMeaning === 'working-days' || overrideMapped;
}

/**
 * A task's effective Estimate meaning: the view default, overridden by the task's
 * mapped override value when valid. `readValue` supplies the raw frontmatter value
 * register-side (where the vault is readable); a null `frontmatterKey` (no override
 * property mapped) pins every task to the default without ever reading.
 */
export function estimateMeaningForTask(
  viewDefault: EstimateMeaning,
  frontmatterKey: string | null,
  readValue: (taskPath: string) => unknown,
): (taskPath: string) => EstimateMeaning {
  if (!frontmatterKey) return () => viewDefault;
  return (taskPath) => resolveEstimateMeaning(viewDefault, readValue(taskPath));
}

/**
 * Whether a task interprets its estimate in WORKING days, or undefined when no
 * axis engages working-day counting at all. Cheap — resolved from view config and
 * the task's own meaning value, with no calendar assembly — so a caller that only
 * needs the yes/no can ask this instead of invoking a counter (which materializes
 * the vault's calendars) and testing its result for null.
 */
export function workingDaysMeaningGate(
  viewMeaning: EstimateMeaning,
  overrideMapped: boolean,
  meaningForTask: (taskPath: string) => EstimateMeaning,
): ((taskPath: string) => boolean) | undefined {
  if (viewMeaning !== 'working-days' && !overrideMapped) return undefined;
  return (taskPath) => meaningForTask(taskPath) === 'working-days';
}

/**
 * The resize→estimate working-day counter for the write path, or undefined when
 * no axis engages working-day counting (nothing to convert). The counter returns
 * null for a `calendar-days` task — its resize records the flat calendar span —
 * and delegates to `countWorkingDays` for a `working-days` task.
 */
export function countWorkingDaysResolver(
  viewMeaning: EstimateMeaning,
  overrideMapped: boolean,
  meaningForTask: (taskPath: string) => EstimateMeaning,
  countWorkingDays: (taskPath: string, start: Date, end: Date) => number | null,
): ((taskPath: string, start: Date, end: Date) => number | null) | undefined {
  const usesWorkingDays = workingDaysMeaningGate(viewMeaning, overrideMapped, meaningForTask);
  if (!usesWorkingDays) return undefined;
  return (taskPath, start, end) =>
    usesWorkingDays(taskPath) ? countWorkingDays(taskPath, start, end) : null;
}

