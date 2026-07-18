/**
 * The ONE place split-task rendering touches SVAR internals. Everything else
 * consumes public `ITask` fields and public Gantt props.
 *
 * Borrowed surface, in full:
 *   - `getState()._scales.diff` + `._scales.lengthUnit` — SVAR's own calendar
 *     arithmetic, so segment fractions use exactly the units the chart is drawn
 *     in (`_`-prefixed = not public API, though it is present in IData's types).
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
import type { ScaleSnapshot } from './segmentLayout';

let warned = false;

export function scaleSnapshot(api: IApi): ScaleSnapshot | null {
  const state = api.getState();
  const scales = state._scales;
  const diff = scales?.diff;
  const lengthUnit = scales?.lengthUnit;

  if (typeof diff !== 'function' || typeof lengthUnit !== 'string') {
    if (!warned) {
      warned = true;
      // eslint-disable-next-line no-console
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
