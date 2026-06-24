<!--
  Thin mount host for the isolated render harness (U3, #161 perf plan). Wraps a
  `GanttData` value in a store and mounts the REAL `GanttContainer` read-only,
  with `themeMode:'light'` (skips the auto-theme Obsidian subscription) and a
  minimal `app` stub.

  It deliberately imposes NO outer fixed height — `GanttContainer` sets its own
  `og-chart-area` height via `resolveHostHeight` (capped at `maxHeight`), and
  SVAR measures THAT, exactly as in the embed. The `data-render-complete`
  sentinel is set only after SVAR's `clientHeight` binding has flushed (`.wx-chart`
  reports a non-zero height — i.e. `chartHeight > 0`, not the `num=1` pre-measure
  transient) AND the materialized `.wx-row` count is stable across two animation
  frames. The perf gate (U4) waits on that attribute before measuring, so a
  `chartHeight=0` transient can't be mistaken for a healthy bounded window.
-->
<script lang="ts">
  /* global HTMLElement, requestAnimationFrame */
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import type { App } from 'obsidian';
  import GanttContainer from '../../../src/bases/GanttContainer.svelte';
  import type { GanttData } from '../../../src/bases/types/gantt-view-data';

  const { data }: { data: GanttData } = $props();

  // A store so a future test can refresh in place; mounted once here.
  const store = writable(data);
  const appStub = {} as unknown as App;

  let hostEl: HTMLElement;

  /** Frames the (.wx-chart height > 0, .wx-row count) reading must stay stable. */
  const STABLE_FRAMES = 2;

  onMount(() => {
    let cancelled = false;
    let prevRows = -1;
    let stable = 0;

    const tick = (): void => {
      if (cancelled || !hostEl) return;
      const chart = hostEl.querySelector('.wx-chart') as HTMLElement | null;
      const chartHeight = chart?.clientHeight ?? 0;
      const rows = hostEl.querySelectorAll('.wx-row').length;
      // Ready only once SVAR has a real measured height AND the window has settled.
      const settled = chartHeight > 0 && rows > 0 && rows === prevRows;
      stable = settled ? stable + 1 : 0;
      prevRows = rows;
      if (stable >= STABLE_FRAMES) {
        hostEl.setAttribute('data-render-complete', 'true');
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

<div class="og-perf-host" bind:this={hostEl}>
  <GanttContainer data={store} app={appStub} themeMode="light" />
</div>
