<!--
  Throwaway probe host (spike): mounts the RAW `@svar-ui/svelte-gantt` <Gantt>
  with SVAR's DEFAULT templates (no plugin taskTemplate / BarContent) over a
  hardcoded dataset, to observe whether a "Pro"-documented feature renders in the
  bundled free build. Feature props are passed EXPLICITLY BY NAME (not via a
  spread) so there is no ambiguity about whether they reach <Gantt>. Unlike
  GanttPerfHost this imposes an explicit fixed height: a raw <Gantt> does not
  self-size the way GanttContainer does, so without a fixed wrapper SVAR measures
  chartHeight=0, draws no bars, and the sentinel never fires. The sentinel keys on
  `.wx-bar` presence (stable across two frames).
-->
<script lang="ts">
  /* global HTMLElement, requestAnimationFrame */
  import { onMount } from 'svelte';
  import { Gantt } from '@svar-ui/svelte-gantt';

  /* eslint-disable @typescript-eslint/no-explicit-any */
  interface Props {
    tasks: any[];
    links?: any[];
    splitTasks?: boolean;
    markers?: any[];
    baselines?: boolean;
    rollups?: any;
    criticalPath?: any;
    slack?: boolean;
    init?: (api: any) => void;
  }
  const {
    tasks,
    links = [],
    splitTasks = false,
    markers = [],
    baselines = false,
    rollups = false,
    criticalPath = null,
    slack = false,
    init,
  }: Props = $props();

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
  class="og-probe-host"
  bind:this={hostEl}
  style="height: 400px; width: 900px; position: relative;"
>
  <Gantt
    {tasks}
    {links}
    {splitTasks}
    {markers}
    {baselines}
    {rollups}
    {criticalPath}
    {slack}
    {init}
  />
</div>
