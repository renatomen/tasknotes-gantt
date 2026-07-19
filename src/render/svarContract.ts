/**
 * The ONE place split-task rendering touches SVAR internals. Everything else
 * consumes public `ITask` fields and public Gantt props.
 *
 * Borrowed surface, in full:
 *   - `getState()._scales.diff` + `._scales.lengthUnit` — SVAR's own calendar
 *     arithmetic, so segment fractions use exactly the units the chart is drawn
 *     in (`_`-prefixed = not public API, though it is present in IData's types).
 *   - `getState()._scales.start` + `._scales.end` — the drawn chart's date span,
 *     for overlays positioned against the whole chart area rather than against
 *     one bar. Read through a separate snapshot so an overlay-only breakage can
 *     never switch off bar-relative rendering, and vice versa.
 *   - `getState().durationUnit` — a documented Gantt prop, read back off state.
 *
 * Two guards keep this honest:
 *   - `svar-contract.probe.ts` pins the same expectations at test time, with a
 *     rendering oracle that uses SVAR itself as ground truth.
 *   - This function validates the shape at runtime and returns null when SVAR
 *     has moved something, so the template degrades to an ordinary continuous
 *     bar — an upgrade can switch the feature off (with one console warning),
 *     it can never break the chart.
 *
 * Snapshot rather than subscription is deliberate: SVAR re-creates every task
 * object whenever layout inputs change (that is how its own bars stay fresh),
 * so the template re-renders — and re-reads this snapshot — exactly when the
 * scale could have changed. Zoom that only changes pixel width needs no
 * re-render at all: the segments are percentages of their bar.
 */
import type { IApi } from '@svar-ui/svelte-gantt';
import type { DiffFn, ScaleSnapshot } from './segmentLayout';

let warned = false;

export function scaleSnapshot(api: IApi): ScaleSnapshot | null {
  const state = api.getState();
  const scales = state._scales;
  const diff = scales?.diff;
  const lengthUnit = scales?.lengthUnit;

  if (typeof diff !== 'function' || typeof lengthUnit !== 'string') {
    if (!warned) {
      warned = true;
      console.warn(
        '[segments] SVAR internals moved (_scales.diff / _scales.lengthUnit); split-task rendering disabled, bars fall back to their continuous form.',
      );
    }
    return null;
  }

  return {
    diff,
    lengthUnit,
    durationUnit: state.durationUnit === 'hour' ? 'hour' : 'day',
  };
}

/** The drawn chart's date span, for chart-area (not bar-relative) geometry. */
export interface ChartSpan {
  start: Date;
  end: Date;
  lengthUnit: string;
  /** Rendered width of the chart content area, in px. */
  widthPx: number;
  diff: DiffFn;
}

let spanWarned = false;

/**
 * Snapshot of the chart's own date span. Null — overlay hidden, chart intact —
 * whenever SVAR has moved any part of it.
 */
export function chartSpanSnapshot(api: IApi): ChartSpan | null {
  const scales = api.getState()._scales;
  const { start, end, diff, lengthUnit, width } = scales ?? {};

  const usable =
    start instanceof Date &&
    end instanceof Date &&
    !Number.isNaN(start.getTime()) &&
    !Number.isNaN(end.getTime()) &&
    start < end &&
    typeof diff === 'function' &&
    typeof lengthUnit === 'string' &&
    typeof width === 'number' &&
    width > 0;

  if (!usable) {
    if (!spanWarned) {
      spanWarned = true;
      console.warn(
        '[markers] SVAR internals moved (_scales.start / _scales.end); marker overlay disabled, the chart is unaffected.',
      );
    }
    return null;
  }

  return { start, end, lengthUnit, widthPx: width, diff };
}
