<!--
  Split-task bar template: draws a task's `segments` as spaced sub-bars in one
  row, reproducing the DOM that SVAR's Pro-only BarSegments emits so a move to
  the paid build is a drop-in.

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

  DEPENDS ON SVAR INTERNALS — every item here is pinned by
  `test/probe/svar-contract.probe.ts`, which fails loudly if an upgrade moves it:
    - `task.$x` / `task.$w`      computed bar geometry (`$`-prefixed = internal)
    - `getReactiveState()._scales` the timeline scale (`_`-prefixed = private)
    - `_scales.diff(a, b, unit, inclusive)` signature and semantics
    - the `.wx-*` class names this markup emits
    - our template rendering as a DIRECT CHILD of `.wx-bar` (see segments.css)
-->
<script lang="ts">
  import { fromStore } from 'svelte/store';
  import type { IApi, ITask } from '@svar-ui/svelte-gantt';
  import {
    segmentBox,
    segmentProgresses,
    type DurationUnit,
    type ScaleLike,
    type SegmentInput,
  } from './segmentLayout';

  /** Exactly SVAR's taskTemplate contract — it always passes all three. */
  interface Props {
    data: ITask;
    api: IApi;
    onaction: (ev: { action: string; data: Record<string, unknown> }) => void;
  }
  const { data, api }: Props = $props();

  // `fromStore` is the idiomatic Svelte 5 bridge for stores obtained at runtime
  // (these come from an API call, so the `$store` prefix form does not apply).
  // Reading `api` once is deliberate: SVAR hands the template a stable api for
  // the lifetime of the mount, so there is no later value to react to.
  // svelte-ignore state_referenced_locally
  const state = api.getReactiveState();
  const scales = fromStore(state._scales as unknown as import('svelte/store').Readable<ScaleLike>);
  const cellWidth = fromStore(state.cellWidth as unknown as import('svelte/store').Readable<number>);
  const durationUnit = fromStore(
    state.durationUnit as unknown as import('svelte/store').Readable<DurationUnit>,
  );

  const segments = $derived(
    Array.isArray(data.segments) && data.segments.length > 0
      ? (data.segments as SegmentInput[])
      : null,
  );

  /** Pixels per scale length-unit — the same factor SVAR lays tasks out with. */
  const pxPerUnit = $derived(cellWidth.current || scales.current?.lengthUnitWidth || 0);

  const laidOut = $derived(!!segments && !!scales.current?.diff && pxPerUnit > 0);

  const boxes = $derived(
    laidOut && segments
      ? segments.map((seg) =>
          // A Pro build lays segments out itself — honour that when present.
          typeof seg.$x === 'number' && typeof seg.$w === 'number'
            ? { left: seg.$x, width: seg.$w }
            : segmentBox(seg, data.$x ?? 0, scales.current, pxPerUnit, durationUnit.current),
        )
      : [],
  );

  /** One pass for the whole array rather than a rescan per segment. */
  const progresses = $derived(
    segments ? segmentProgresses(segments, data.progress ?? 0) : [],
  );
</script>

{#if laidOut && segments}
  <div class="wx-segments">
    {#each segments as seg, i (i)}
      <div
        class="wx-segment wx-bar wx-task"
        data-segment={i}
        style="left:{boxes[i]!.left}px;top:0px;width:{boxes[i]!.width}px;height:100%;"
      >
        <!-- Gated on the TASK's progress, not the segment's, so an empty segment
             still emits a 0%-wide wrapper — exactly what SVAR's BarSegments does.
             Fidelity matters more here than skipping an empty node. -->
        {#if data.progress}
          <div class="wx-progress-wrapper">
            <div class="wx-progress-percent" style="width:{progresses[i]}%"></div>
          </div>
        {/if}
        <div class="wx-content">{seg.text ?? ''}</div>
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
