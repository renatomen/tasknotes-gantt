/**
 * Pure decision logic for the Estimate-meaning axis, extracted from the register
 * so it is unit-testable independently of the Obsidian vault. The register keeps
 * only the thin app-wiring (reading frontmatter, the per-pass blocking lookup)
 * and delegates every decision here.
 */
import {
  resolveEstimateMeaning,
  type EstimateMeaning,
  type NonWorkingRendering,
} from './viewOptions';
import { applyWorkingTimeStretch } from '../controller/calendar/stretch';
import { minutesToSpanDays } from '../controller/durationConversion';

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
  if (viewMeaning !== 'working-days' && !overrideMapped) return undefined;
  return (taskPath, start, end) =>
    meaningForTask(taskPath) === 'working-days' ? countWorkingDays(taskPath, start, end) : null;
}

/** The blocking facts a span projection needs (a subset of the stretch seam). */
export interface SpanBlocking {
  isBlocked(dayIso: string): boolean;
  /** Widest authored blocked run (days) — feeds the scan ceiling. */
  maxBlockedRunDays: number;
}

/**
 * Project the span an estimate will RE-DERIVE from its authored anchor — the
 * write path's mirror of the read path's derivation, built ON the read path:
 * the same {@link applyWorkingTimeStretch}, the same blocking facts, the same
 * ceiling formula the controller uses. Anything less drifts (a lookalike walk
 * missed both the fully-blocked floor and the authored-run ceiling headroom).
 *
 * `blocking` null means the task has no working-day seam — the plain span is
 * already the derivation. A stretch that hits its ceiling falls back to the
 * plain span exactly as the read path does (fail-visible there, plain here).
 */
export function projectDerivedSpan(args: {
  edge: 'start' | 'end';
  anchor: Date;
  estimateMinutes: number;
  blocking: SpanBlocking | null;
  addDays: (date: Date, days: number) => Date;
}): { start: Date; end: Date } {
  const durationDays = Math.max(1, minutesToSpanDays(args.estimateMinutes));
  const far = args.addDays(args.anchor, (args.edge === 'end' ? 1 : -1) * (durationDays - 1));
  const plain =
    args.edge === 'end' ? { start: args.anchor, end: far } : { start: far, end: args.anchor };
  if (!args.blocking) return plain;
  const stretched = applyWorkingTimeStretch({
    start: plain.start,
    end: plain.end,
    dateStatus: args.edge === 'end' ? 'inferred-end' : 'inferred-start',
    durationDays,
    isBlocked: args.blocking.isBlocked,
    ceilingDays: 8 * durationDays + args.blocking.maxBlockedRunDays,
  });
  return stretched === null || stretched.flagged
    ? plain
    : { start: stretched.start, end: stretched.end };
}
