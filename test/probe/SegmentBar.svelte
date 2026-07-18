<!--
  Spike: hand-rolled split-task bar template.

  Draws a task's `segments` as spaced sub-bars inside one row, reproducing the
  DOM that SVAR's Pro-only BarSegments emits, so a future move to the paid build
  is a drop-in. Falls back to an ordinary bar body when the task has no segments.

  Markup and the segments-container CSS below are adapted from
  `@svar-ui/svelte-gantt` `src/components/chart/BarSegments.svelte`:

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

  Positions are computed here rather than read off the task because the MIT build
  never lays segments out (`splitTasks` is forced false in the store's init). A
  Pro build would supply `$x`/`$w` per segment; this prefers those when present.
-->
<script lang="ts">
  /* eslint-disable @typescript-eslint/no-explicit-any */
  import { segmentBoxes, segmentProgress, type SegmentInput } from './segmentLayout';

  // Matches SVAR's taskTemplate contract exactly: it always passes all three.
  interface Props {
    data: any;
    api: any;
    onaction: (ev: { action: string; data: Record<string, unknown> }) => void;
  }
  const { data, api }: Props = $props();

  let scales: any = $state(null);
  let cellWidth = $state(0);
  let durationUnit: 'day' | 'hour' = $state('day');

  $effect(() => {
    const rs = api?.getReactiveState?.();
    if (!rs) return;
    const unsubs: Array<() => void> = [];
    const sub = (store: any, set: (v: any) => void): void => {
      if (store?.subscribe) unsubs.push(store.subscribe(set));
    };
    sub(rs._scales, (v) => { scales = v; });
    sub(rs.cellWidth, (v) => { if (v) cellWidth = v; });
    sub(rs.durationUnit, (v) => { if (v) durationUnit = v; });
    return () => unsubs.forEach((u) => u());
  });

  const segments: SegmentInput[] | null = $derived(
    Array.isArray(data?.segments) && data.segments.length > 0 ? data.segments : null,
  );

  /** Pixels per scale length-unit; `cellWidth` is the store's own factor. */
  const pxPerUnit = $derived(cellWidth || scales?.lengthUnitWidth || 0);

  const boxes = $derived(
    segments && scales?.diff && pxPerUnit
      ? segments.map((seg: any, i: number) =>
          // A Pro build lays segments out itself — prefer that when present.
          typeof seg.$x === 'number' && typeof seg.$w === 'number'
            ? { left: seg.$x, width: seg.$w }
            : segmentBoxes([seg], data.$x ?? 0, scales, pxPerUnit, durationUnit)[0],
        )
      : [],
  );

  const ready = $derived(!!segments && boxes.length === segments.length);
</script>

{#if ready && segments}
  <div class="wx-segments">
    {#each segments as seg, i (i)}
      {@const box = boxes[i] ?? { left: 0, width: 0 }}
      <div
        class="wx-segment wx-bar wx-task"
        data-segment={i}
        style="left:{box.left}px;top:0px;width:{box.width}px;height:100%;"
      >
        {#if data.progress}
          <div class="wx-progress-wrapper">
            <div
              class="wx-progress-percent"
              style="width:{segmentProgress(segments, data.progress, i)}%"
            ></div>
          </div>
        {/if}
        <div class="wx-content">{seg.text ?? ''}</div>
      </div>
    {/each}
  </div>
{:else}
  <div class="wx-content">{data?.text ?? ''}</div>
{/if}

<style>
  /* Adapted from SVAR BarSegments.svelte (MIT, see header). */
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
