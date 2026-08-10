<!--
  Probe host: mounts the REAL SVAR <Tooltip> wrapping a REAL <Gantt>, with the
  plugin's own DependencyTooltip as tooltip content — the exact composition
  GanttContainer uses. Unit tests reach the model helper but not this boundary,
  and the boundary is where the tooltip has actually been failing.
-->
<script lang="ts">
  /* global HTMLElement, requestAnimationFrame */
  import { onMount } from 'svelte';
  import { Gantt, Tooltip, Willow } from '@svar-ui/svelte-gantt';
  import DependencyTooltip from '../../src/bases/DependencyTooltip.svelte';

  /* eslint-disable @typescript-eslint/no-explicit-any */
  interface Props {
    tasks: any[];
    links?: any[];
  }
  const { tasks, links = [] }: Props = $props();

  let hostEl: HTMLElement;
  let api: any = $state();

  const STABLE_FRAMES = 2;
  const MAX_FRAMES = 600;

  onMount(() => {
    let stable = 0;
    let frames = 0;
    const tick = (): void => {
      frames += 1;
      const bars = hostEl?.querySelectorAll('.wx-bar').length ?? 0;
      stable = bars > 0 ? stable + 1 : 0;
      if (stable >= STABLE_FRAMES) {
        hostEl.setAttribute('data-render-complete', 'true');
        return;
      }
      if (frames >= MAX_FRAMES) {
        hostEl.setAttribute('data-render-failed', 'true');
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
</script>

<div class="og-probe-host" bind:this={hostEl} style="height:400px;width:1200px;">
  <Willow>
    <Tooltip {api} content={DependencyTooltip} touch={window.matchMedia('(any-hover: hover)').matches}>
      <Gantt
        init={(a: any) => {
          api = a;
          (window as any).__probeApi = a;
        }}
        {tasks}
        {links}
      />
    </Tooltip>
  </Willow>
</div>
