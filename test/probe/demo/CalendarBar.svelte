<!--
  Throwaway decision sketch: renders one task under a chosen calendar-aware bar
  treatment so the shapes can be compared side by side with the real renderer.
  Not a design proposal — disposable probe scaffolding.

  treatment:
    'split'   -> working runs become segments; delegates to the PROVEN split-task
                 renderer (this is the code-reuse candidate)
    'hatched' -> one continuous bar, non-working stretches hatched through it
    'faded'   -> one continuous bar, non-working stretches dimmed
    'plain'   -> bar untouched; only the timeline background shows non-working
-->
<script lang="ts">
  /* eslint-disable @typescript-eslint/no-explicit-any */
  /* global Element */
  import SegmentBar from '../SegmentBar.svelte';
  import { scaleSnapshot } from '../svarContract';
  import { segmentPieces } from '../segmentLayout';

  interface Props {
    data: any;
    api: any;
    onaction: (ev: { action: string; data: Record<string, unknown> }) => void;
  }
  const { data, api, onaction }: Props = $props();

  /** Non-working stretches as fractions of the bar — same bar-as-ruler math. */
  const overlays = $derived.by(() => {
    const runs = data.nonWorking;
    if (!Array.isArray(runs) || !runs.length || !data.start || !data.end) return [];
    const scale = scaleSnapshot(api);
    if (!scale) return [];
    return segmentPieces(runs, data.start, data.end, 0, scale);
  });

  /** Every stretch (working and not) as fractions — for the ghosted treatment. */
  const pieces = $derived.by(() => {
    const runs = data.runs;
    if (!Array.isArray(runs) || !runs.length || !data.start || !data.end) return [];
    const scale = scaleSnapshot(api);
    if (!scale) return [];
    return segmentPieces(runs, data.start, data.end, 0, scale).map((p, i) => ({
      ...p,
      working: runs[i].working,
    }));
  });

  const pct = (f: number): string => `${(f * 100).toFixed(4)}%`;

  /**
   * Blank the host bar so the pieces below are the only visible body — the same
   * wx-split trick the split-task renderer uses (SVAR's own class, no override).
   */
  function markBarSplit(node: Element): (() => void) | undefined {
    const bar = node.parentElement;
    if (!bar?.classList.contains('wx-bar')) return undefined;
    bar.classList.add('wx-split');
    return () => bar.classList.remove('wx-split');
  }
</script>

{#if data.treatment === 'split'}
  <SegmentBar {data} {api} {onaction} />
{:else if data.treatment === 'ghosted'}
  <div class="og-runs" {@attach markBarSplit}>
    {#each pieces as p, i (i)}
      <div
        class="og-run"
        style="left:{pct(p.left)};width:{pct(p.width)};{p.working
          ? ''
          : `opacity:${data.ghostOpacity ?? 0.3};`}"
      ></div>
    {/each}
    <div class="wx-content og-runs-label">{data.text ?? ''}</div>
  </div>
{:else}
  {#if data.treatment === 'hatched' || data.treatment === 'faded'}
    {#each overlays as o, i (i)}
      <div
        class="og-nonworking og-{data.treatment}"
        style="left:{pct(o.left)};width:{pct(o.width)};"
      ></div>
    {/each}
  {/if}
  <div class="wx-content">{data.text ?? ''}</div>
{/if}

<style>
  .og-nonworking {
    position: absolute;
    top: 0;
    height: 100%;
    z-index: 1;
    pointer-events: none;
  }

  /* Diagonal hatching drawn through the bar body. */
  .og-hatched {
    background-image: repeating-linear-gradient(
      -45deg,
      rgba(255, 255, 255, 0.75) 0,
      rgba(255, 255, 255, 0.75) 3px,
      rgba(255, 255, 255, 0) 3px,
      rgba(255, 255, 255, 0) 7px
    );
  }

  /* Knock the bar back where it isn't really being worked. */
  .og-faded {
    background-color: rgba(255, 255, 255, 0.62);
  }

  /* Ghosted: the bar is drawn from pieces so the non-working ones can be truly
     transparent — the shaded background grid reads through them. */
  .og-runs {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .og-run {
    position: absolute;
    top: 0;
    height: 100%;
    box-sizing: border-box;
    background-color: var(--wx-gantt-task-color, #3d8de6);
    border: var(--wx-gantt-task-border, none);
    border-radius: var(--wx-gantt-bar-border-radius, 2px);
  }

  .og-runs-label {
    position: relative;
    z-index: 2;
  }
</style>
