<script lang="ts">
  // SVAR `taskTemplate` component: renders a bar's content — the task text, plus
  // an optional neutral icon chip (status/priority) seated left of the text. It
  // reproduces SVAR's default `.wx-content` verbatim (so the date-status CSS
  // hooks and text styling are preserved) and adds the chip only when the icon
  // spec is present. When `custom.barIcon` is null (icon source `none`, or the
  // value is absent from the palette) it renders exactly the pristine content.
  //
  // A working-time-stretched bar (custom.ghostRuns present) instead renders as
  // pieces on the shared bar-as-ruler substrate: working stretches solid,
  // blocked stretches at 15% opacity so the shaded background reads through.
  // The host bar gets SVAR's own `wx-split` class stamped, which satisfies the
  // library's transparency condition instead of fighting its fill rule. When
  // the scale snapshot is unavailable the bar degrades to its continuous form.
  //
  // Passed once as a stable prop to `<Gantt>` (see GanttContainer) — SVAR's
  // reinitStore does not read taskTemplate, so this never re-inits the store.
  /* global Element */
  import type { IApi } from '@svar-ui/svelte-gantt';
  import { lucideIcon } from './lucideIconAction';
  import type { IconSpec } from './barTreatment';
  import type { EstimateMeaning } from './viewOptions';
  import { scaleSnapshot } from '../render/svarContract';
  import {
    canTileSubSpans,
    ghostRunSegments,
    segmentPieces,
    type GhostRunSpan,
  } from '../render/segmentLayout';

  // SVAR's taskTemplate is typed Component<{data, api, onaction}>; declare all
  // three so the assignment typechecks. Fields are optional/loose so SVAR's
  // ITask is assignable to `data`. `custom.barIcon` / `custom.ghostRuns` are
  // attached by ganttSync.buildSvarTasks.
  interface Props {
    data: {
      text?: string;
      start?: Date;
      end?: Date;
      custom?: {
        barIcon?: IconSpec | null;
        ghostRuns?: readonly GhostRunSpan[];
        interpretationOverridden?: EstimateMeaning;
      };
    };
    api?: unknown;
    onaction?: (ev: { action: string; data: Record<string, unknown> }) => void;
  }
  let { data, api }: Props = $props();

  const spec = $derived(data?.custom?.barIcon ?? null);

  // The per-task override tick (R11): a tooltip only when this task's effective
  // Estimate meaning differs from the view default, else null (no tick). It names
  // both the effective interpretation and the default it overrides — direction
  // lives in the tooltip, never a second on-bar glyph.
  const overrideTooltip = $derived.by((): string | null => {
    switch (data?.custom?.interpretationOverridden) {
      case 'working-days':
        return "Estimate meaning: working days — overrides the view's calendar-days default";
      case 'calendar-days':
        return "Estimate meaning: calendar days — overrides the view's working-days default";
      default:
        return null;
    }
  });

  const ghostPieces = $derived.by(() => {
    const runs = data?.custom?.ghostRuns;
    if (!runs?.length || !(data.start instanceof Date) || !(data.end instanceof Date) || !api) {
      return null;
    }
    const snapshot = scaleSnapshot(api as IApi);
    if (!snapshot || !canTileSubSpans(snapshot)) return null;
    const segments = ghostRunSegments(runs, data.start, data.end);
    return segmentPieces(segments, data.start, data.end, 0, snapshot).map((piece, index) => ({
      left: piece.left,
      width: piece.width,
      blocked: segments[index]?.blocked ?? false,
    }));
  });

  const pct = (fraction: number): string => `${(fraction * 100).toFixed(4)}%`;

  /**
   * Stamp SVAR's own `wx-split` class on the host bar so its
   * `.wx-task:not(.wx-split)` fill rule steps aside and its transparent rule
   * applies — no `!important` contest with the library's scoped styles.
   */
  function markBarSplit(node: Element): (() => void) | undefined {
    const bar = node.parentElement;
    if (!bar?.classList.contains('wx-bar')) return undefined;
    bar.classList.add('wx-split');
    return () => bar.classList.remove('wx-split');
  }

  /**
   * Attach the top-edge override tick to the host bar (R11). Mirrors
   * {@link markBarSplit} but walks to the nearest `.wx-bar` ancestor (the tick
   * must anchor to the bar in both the plain and ghost-run branches) and appends
   * a real tick element carrying its own `title`, so hovering the tick — not the
   * whole bar — names the interpretation, coexisting with the bar's SVAR tooltip.
   * A `null` tooltip (task not overridden) is a no-op.
   */
  function markBarOverridden(tooltip: string | null) {
    return (node: Element): (() => void) | undefined => {
      if (!tooltip) return undefined;
      const bar = node.closest('.wx-bar');
      if (!bar) return undefined;
      const tick = document.createElement('span');
      tick.className = 'og-override-tick';
      tick.title = tooltip;
      bar.appendChild(tick);
      return () => tick.remove();
    };
  }
</script>

{#snippet barContent()}
  <div
    class="wx-content"
    class:og-ghost-label={ghostPieces}
    {@attach markBarOverridden(overrideTooltip)}
  >
    {#if spec}
      <span class="og-bar-chip">
        {#if spec.iconName}
          <span class="og-bar-glyph" use:lucideIcon={spec.iconName}></span>
        {:else if spec.kind === 'priority'}
          <span class="og-bar-dot" style="background-color: {spec.color}"></span>
        {:else if spec.completed}
          <!-- Completed status → filled disc (TaskNotes fills the status dot for a
               completed status); a non-completed status is a hollow ring below. -->
          <span class="og-bar-disc" style="background-color: {spec.color}"></span>
        {:else}
          <span class="og-bar-ring" style="border-color: {spec.color}"></span>
        {/if}
      </span>
    {/if}<span class="og-bar-text">{data.text ?? ''}</span>
  </div>
{/snippet}

{#if ghostPieces}
  <div class="og-ghost-runs" {@attach markBarSplit}>
    {#each ghostPieces as piece, index (index)}
      <div
        class="og-ghost-run"
        class:og-ghost-blocked={piece.blocked}
        style="left:{pct(piece.left)};width:{pct(piece.width)};"
      ></div>
    {/each}
    {@render barContent()}
  </div>
{:else}
  {@render barContent()}
{/if}
