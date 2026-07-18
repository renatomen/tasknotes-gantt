<!--
  Spike host: mounts a raw SVAR <Gantt> with the hand-rolled SegmentBar template.
  No Obsidian — this runs in the isolated probe harness.

  The outer bar is made transparent by a :has() rule rather than a registered
  SVAR cue type: the bar that CONTAINS a segments container is the segmented one,
  and a `.wx-segment` never contains `.wx-segments`, so the segments themselves
  are untouched. That avoids the whole registered-task-type dance for the spike.
-->
<script lang="ts">
  /* global HTMLElement, requestAnimationFrame */
  import { onMount } from 'svelte';
  import { Gantt, Willow } from '@svar-ui/svelte-gantt';
  import SegmentBar from './SegmentBar.svelte';
  import './segments.css';

  /* eslint-disable @typescript-eslint/no-explicit-any */
  interface Props {
    tasks: any[];
    scales?: any[];
    cellWidth?: number;
    /** Grid is off by default so the chart fills the frame for screenshots. */
    columns?: any;
    /** Receives SVAR's api so contract tests can inspect the real store. */
    init?: (api: any) => void;
  }
  const { tasks, scales, cellWidth = 40, columns = false, init }: Props = $props();

  let hostEl: HTMLElement;
  const STABLE_FRAMES = 2;
  const MAX_FRAMES = 600;

  onMount(() => {
    let cancelled = false;
    let prevBars = -1;
    let stable = 0;
    let frames = 0;

    const tick = (): void => {
      if (cancelled || !hostEl) return;
      const bars = hostEl.querySelectorAll('.wx-bar').length;
      const settled = bars > 0 && bars === prevBars;
      stable = settled ? stable + 1 : 0;
      prevBars = bars;
      if (stable >= STABLE_FRAMES) {
        hostEl.setAttribute('data-render-complete', 'true');
        return;
      }
      frames += 1;
      if (frames >= MAX_FRAMES) {
        hostEl.setAttribute('data-render-failed', 'never-settled');
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    return () => {
      cancelled = true;
    };
  });
</script>

<div
  class="og-segments-host"
  bind:this={hostEl}
  style="height: 320px; width: 1000px; position: relative;"
>
  <Willow>
    <Gantt {tasks} {cellWidth} {columns} {init} scales={scales} taskTemplate={SegmentBar} readonly />
  </Willow>
</div>

<!-- The two global rules live in `segments.css`, imported above. -->
