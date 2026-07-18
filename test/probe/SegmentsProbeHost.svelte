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

  /* eslint-disable @typescript-eslint/no-explicit-any */
  interface Props {
    tasks: any[];
    scales?: any[];
    cellWidth?: number;
    /** Grid is off by default so the chart fills the frame for screenshots. */
    columns?: any;
  }
  const { tasks, scales, cellWidth = 40, columns = false }: Props = $props();

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
    <Gantt {tasks} {cellWidth} {columns} scales={scales} taskTemplate={SegmentBar} readonly />
  </Willow>
</div>

<style>
  /* A bar that contains segments is the segmented one — blank its own body so the
     segments are the visible pieces. Segments never contain `.wx-segments`, so
     this cannot blank them. */
  :global(.wx-bar:has(> .wx-segments)) {
    background: transparent !important;
    border-color: transparent !important;
  }

  /* SVAR suppresses its own whole-bar progress fill only when `splitTasks` is on,
     and the MIT build forces that false — so it paints a fill spanning the entire
     bar underneath our segments. Hide it; per-segment progress replaces it. The
     child combinator matters: segment fills are nested deeper and must survive. */
  :global(.wx-bar:has(> .wx-segments) > .wx-progress-wrapper) {
    display: none !important;
  }
</style>
