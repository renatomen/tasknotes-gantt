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
  // A row with per-instance occupancy (custom.occupancyRuns — the recurring
  // family) renders on the same substrate: one whole-day piece per instance
  // with a state class, gaps unrendered so the calendar shading reads through;
  // at zooms coarser than day/hour a dashed series spine spans first→last
  // instance instead. The host goes transparent only when the occupancy
  // ENVELOPE replaced the plain bar (custom.occupancyEnvelope).
  //
  // Passed once as a stable prop to `<Gantt>` (see GanttContainer) — SVAR's
  // reinitStore does not read taskTemplate, so this never re-inits the store.
  /* global Element, HTMLElement, MutationObserver, Event */
  import type { IApi } from '@svar-ui/svelte-gantt';
  import { lucideIcon } from './lucideIconAction';
  import type { IconSpec } from './barTreatment';
  import type { EstimateMeaning } from './viewOptions';
  import { scaleSnapshot } from '../render/svarContract';
  import {
    canTileSubSpans,
    ghostRunSegments,
    occupancyRender,
    segmentPieces,
    type GhostRunSpan,
    type OccupancyPiece,
    type OccupancyRunSpan,
  } from '../render/segmentLayout';
  import { resolveOccupancyActivationPath } from './occupancyDisplay';

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
        sourceTaskId?: string;
        barIcon?: IconSpec | null;
        ghostRuns?: readonly GhostRunSpan[];
        occupancyRuns?: readonly OccupancyRunSpan[];
        occupancyEnvelope?: boolean;
        calendarItemColor?: string;
        interpretationOverridden?: EstimateMeaning;
      };
    };
    api?: unknown;
    onaction?: (ev: { action: string; data: Record<string, unknown> }) => void;
  }
  let { data, api }: Props = $props();

  const spec = $derived(data?.custom?.barIcon ?? null);

  // The per-task override dot (R11): a tooltip only when this task's effective
  // Estimate meaning differs from the view default, else null (no dot). It names
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

  // Per-instance occupancy (recurring rows): tiled whole-day pieces at day/hour
  // zoom, a dashed series spine at coarser zooms — never a solid continuous
  // claim. Null (no runs / no usable scale) falls through to the other branches.
  const occupancyView = $derived.by(() => {
    const runs = data?.custom?.occupancyRuns;
    if (!runs?.length || !(data.start instanceof Date) || !(data.end instanceof Date) || !api) {
      return null;
    }
    const snapshot = scaleSnapshot(api as IApi);
    if (!snapshot) return null;
    return occupancyRender(runs, data.start, data.end, snapshot);
  });

  const pct = (fraction: number): string => `${(fraction * 100).toFixed(4)}%`;

  const pieceClass = (piece: OccupancyPiece): string =>
    piece.stateClass ? `og-instance og-instance-${piece.stateClass}` : 'og-instance';

  const pieceTitle = (piece: OccupancyPiece): string =>
    piece.stateClass ? `${piece.day} — ${piece.stateClass}` : piece.day;

  /** The path this piece activates: its materialized note, else the owning task. */
  const pieceActivatePath = (piece: OccupancyPiece): string | undefined => {
    const sourceTaskId = data?.custom?.sourceTaskId;
    return sourceTaskId ? resolveOccupancyActivationPath(piece, sourceTaskId) : undefined;
  };

  /**
   * Swallow drag-initiating events (pointer, mouse AND touch — SVAR starts a
   * bar drag from all three) so pressing the node — an occupancy piece or the
   * override dot — can never move the bar's dates; click/dblclick still
   * bubble, so selection, hover tooltips, and piece-routed activation keep
   * working.
   */
  function stopDragEvents(node: Element): () => void {
    const stop = (e: Event): void => e.stopPropagation();
    const events = ['pointerdown', 'mousedown', 'touchstart', 'touchmove'] as const;
    for (const evt of events) node.addEventListener(evt, stop);
    return () => {
      for (const evt of events) node.removeEventListener(evt, stop);
    };
  }

  /**
   * Stamp SVAR's own `wx-split` class on the host bar so its
   * `.wx-task:not(.wx-split)` fill rule steps aside and its transparent rule
   * applies — no `!important` contest with the library's scoped styles.
   *
   * SVAR re-applies a bar's whole class list from its `task.type` on an
   * `update-task` (e.g. a Bar Fill / Strip source change re-issues the task with
   * a new treatment class), which drops this imperatively-added class — leaving
   * the body opaque so the ghost pieces blend over it until a remount. A
   * MutationObserver re-asserts it whenever it is stripped while the pieces are
   * mounted, so the split survives a live re-colour without a re-render.
   */
  function markBarSplit(node: Element): (() => void) | undefined {
    const bar = node.parentElement;
    if (!bar?.classList.contains('wx-bar')) return undefined;
    bar.classList.add('wx-split');
    const observer = new MutationObserver(() => {
      if (!bar.classList.contains('wx-split')) bar.classList.add('wx-split');
    });
    observer.observe(bar, { attributes: true, attributeFilter: ['class'] });
    return () => {
      observer.disconnect();
      bar.classList.remove('wx-split');
    };
  }

  /**
   * Conditional {@link markBarSplit}: an occupancy ENVELOPE goes transparent so
   * only its pieces paint (the plain scheduled→due bar is suppressed); with the
   * family off the host bar keeps its fill and the recorded pieces overlay it.
   */
  function markBarSplitWhen(enabled: boolean) {
    return (node: Element): (() => void) | undefined =>
      enabled ? markBarSplit(node) : undefined;
  }

  /** Thread a source-native event color through SVAR's supported bar variables. */
  function colorCalendarItemBar(color: string | undefined) {
    return (node: Element): (() => void) | undefined => {
      if (!color) return undefined;
      const bar = node.closest('.wx-bar');
      if (!(bar instanceof HTMLElement)) return undefined;
      const eventColor = bar.style.getPropertyValue('--og-event-color');
      const ghostFill = bar.style.getPropertyValue('--og-ghost-fill');
      bar.style.setProperty('--og-event-color', color);
      bar.style.setProperty('--og-ghost-fill', color);
      return () => {
        eventColor
          ? bar.style.setProperty('--og-event-color', eventColor)
          : bar.style.removeProperty('--og-event-color');
        ghostFill
          ? bar.style.setProperty('--og-ghost-fill', ghostFill)
          : bar.style.removeProperty('--og-ghost-fill');
      };
    };
  }

  /**
   * Attach the upper-left corner override dot to the host bar (R11). Mirrors
   * {@link markBarSplit} but walks to the nearest `.wx-bar` ancestor (the dot
   * must anchor to the bar in both the plain and ghost-run branches) and appends
   * a real dot element carrying its own `title`, so hovering the dot — not the
   * whole bar — names the interpretation, coexisting with the bar's SVAR tooltip.
   * A `null` tooltip (task not overridden) is a no-op.
   */
  function markBarOverridden(tooltip: string | null) {
    return (node: Element): (() => void) | undefined => {
      if (!tooltip) return undefined;
      const bar = node.closest('.wx-bar');
      if (!bar) return undefined;
      const dot = document.createElement('span');
      dot.className = 'og-override-dot';
      dot.title = tooltip;
      // The dot sits on the bar's top-left corner — SVAR's start-resize zone —
      // so inspecting the indicator (including a long-press on touch) must not
      // move the start date.
      const removeDragStops = stopDragEvents(dot);
      bar.appendChild(dot);
      return () => {
        removeDragStops();
        dot.remove();
      };
    };
  }
</script>

{#snippet barContent()}
  <div
    class="wx-content"
    class:og-ghost-label={Boolean(ghostPieces) || Boolean(occupancyView)}
    {@attach colorCalendarItemBar(data?.custom?.calendarItemColor)}
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

{#if occupancyView}
  <div
    class="og-ghost-runs"
    {@attach markBarSplitWhen(data?.custom?.occupancyEnvelope === true)}
  >
    {#if occupancyView.kind === 'pieces'}
      {#each occupancyView.pieces as piece (piece.day)}
        <div
          class={pieceClass(piece)}
          title={pieceTitle(piece)}
          data-og-instance={piece.day}
          data-og-activate-path={pieceActivatePath(piece)}
          style="left:{pct(piece.left)};width:{pct(piece.width)};"
          {@attach stopDragEvents}
        ></div>
      {/each}
    {:else}
      {#if occupancyView.plain}
        <!-- The kept plain scheduled→due bar at coarse zoom: indicative precision, exactly like the spine. -->
        <div
          class="og-instance og-instance-plain og-indicative"
          style="left:{pct(occupancyView.plain.left)};width:{pct(occupancyView.plain.width)};"
        ></div>
      {/if}
      <div
        class="og-series-spine"
        style="left:{pct(occupancyView.left)};width:{pct(occupancyView.width)};"
      ></div>
    {/if}
    {@render barContent()}
  </div>
{:else if ghostPieces}
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
