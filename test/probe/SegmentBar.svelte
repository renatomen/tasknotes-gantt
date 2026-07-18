<!--
  Split-task bar template: draws a task's `segments` as spaced sub-bars in one
  row, reproducing the DOM of SVAR's Pro-only BarSegments so a move to the paid
  build is a drop-in.

  There is no pixel math here — THE BAR IS THE RULER. SVAR already solved
  date→pixel for this row when it laid the bar out, so each segment is a
  proportion of the bar's date span, rendered as CSS percentages. The browser
  scales them against whatever width the bar actually has, which makes zoom and
  resize tracking free. A Pro build that lays segments out itself ($x/$w px) is
  honoured verbatim, keeping the migration a drop-in.

  All SVAR-internal access lives in `svarContract.ts` (one runtime-validated
  snapshot); this component otherwise consumes public ITask fields. The bar is
  made transparent by stamping SVAR's own `wx-split` class (see markBarSplit) —
  satisfying the library's designed condition rather than overriding its CSS.
  If SVAR internals ever move, `pieces` becomes null and the bar falls back to
  its ordinary continuous form — the feature switches off, nothing breaks.

  Markup and the segments-container CSS are adapted from `@svar-ui/svelte-gantt`
  `src/components/chart/BarSegments.svelte`:

    MIT License — Copyright (c) 2025 XB Software Sp. z o.o
    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions: the above copyright
    notice and this permission notice shall be included in all copies or
    substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS",
    WITHOUT WARRANTY OF ANY KIND.
-->
<script lang="ts">
  /* global Element */
  import type { IApi, ITask } from '@svar-ui/svelte-gantt';
  import { scaleSnapshot } from './svarContract';
  import { isSegmentSpan, segmentPieces, type SegmentPiece } from './segmentLayout';

  /** Exactly SVAR's taskTemplate contract — it always passes all three. */
  interface Props {
    data: ITask;
    api: IApi;
    onaction: (ev: { action: string; data: Record<string, unknown> }) => void;
  }
  const { data, api }: Props = $props();

  // Recomputed whenever SVAR hands us a new task object — which it does for
  // every layout-affecting change, so the snapshot read is always current.
  const pieces = $derived.by(() => {
    const segments = (data.segments ?? []).filter(isSegmentSpan);
    if (!segments.length || !data.start || !data.end) return null;
    const scale = scaleSnapshot(api);
    if (!scale) return null;
    return segmentPieces(segments, data.start, data.end, data.progress ?? 0, scale);
  });

  const pct = (fraction: number): string => `${(fraction * 100).toFixed(4)}%`;

  /** Pro layout wins when present; otherwise proportions of the bar. */
  function segmentStyle({ seg, left, width }: SegmentPiece): string {
    return typeof seg.$x === 'number' && typeof seg.$w === 'number'
      ? `left:${seg.$x}px;top:0px;width:${seg.$w}px;height:100%;`
      : `left:${pct(left)};top:0px;width:${pct(width)};height:100%;`;
  }

  /**
   * Stamp SVAR's own `wx-split` class onto the bar we render inside — the exact
   * class Pro's Bars.svelte binds via `class:wx-split={$splitTasks && task.segments}`
   * (unreachable in the MIT build, where splitTasks is forced false). This makes
   * SVAR's stylesheet treat the bar as a split bar: its fill rule
   * `.wx-task:not(.wx-split)` disarms itself, and its own
   * `.wx-bars .wx-split.wx-bar { background: transparent }` takes over — no
   * transparency CSS of ours, no !important, no specificity contest. We satisfy
   * the library's designed condition instead of fighting its cascade.
   */
  function markBarSplit(node: Element): (() => void) | undefined {
    const bar = node.parentElement;
    if (!bar?.classList.contains('wx-bar')) return undefined;
    bar.classList.add('wx-split');
    return () => bar.classList.remove('wx-split');
  }
</script>

{#if pieces}
  <div class="wx-segments" {@attach markBarSplit}>
    {#each pieces as piece, i (i)}
      <div class="wx-segment wx-bar wx-task" data-segment={i} style={segmentStyle(piece)}>
        <!-- Gated on the TASK's progress, not the segment's, so an empty segment
             still emits a 0%-wide wrapper — exactly what SVAR's BarSegments does. -->
        {#if data.progress}
          <div class="wx-progress-wrapper">
            <div class="wx-progress-percent" style="width:{piece.fill}%"></div>
          </div>
        {/if}
        <div class="wx-content">{piece.seg.text ?? ''}</div>
      </div>
    {/each}
  </div>
{:else}
  <div class="wx-content">{data.text ?? ''}</div>
{/if}

<style>
  /* Adapted from SVAR BarSegments.svelte (MIT, see header). SVAR's own
     `.wx-bar :global(.wx-segment)` rules reach our segments through the bar
     ancestor and are inherited for free; the container and connector below live
     in BarSegments' scoped block and would not apply, so they are reproduced. */
  .wx-segments {
    position: relative;
    width: 100%;
    height: 100%;
  }

  /* The dashed run connecting the spaced pieces. */
  .wx-segments::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 0;
    width: 100%;
    height: 0;
    border-top: 1px dashed #7f7f7f;
    transform: translateY(-50%);
  }

  .wx-segment {
    position: absolute;
    height: 100%;
    box-sizing: border-box;
    border-radius: var(--wx-gantt-bar-border-radius, 2px);
    background-color: var(--wx-gantt-task-color, #3d8de6);
    border: var(--wx-gantt-task-border, none);
    overflow: hidden;
  }

  .wx-progress-wrapper {
    position: absolute;
    width: 100%;
    height: 100%;
    border-radius: var(--wx-gantt-bar-border-radius, 2px);
    overflow: hidden;
  }

  .wx-progress-percent {
    height: 100%;
    background-color: var(--wx-gantt-task-fill-color, #2b6cb0);
  }

  .wx-content {
    position: relative;
    z-index: 2;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
