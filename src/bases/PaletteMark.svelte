<script lang="ts">
  /**
   * The one chip mark: a configured icon, a palette glyph, or today's ring,
   * disc, or dot.
   */
  import type { DrawnIcon } from './paletteIcon';
  import { paletteGlyphFigure, paletteGlyphMarker } from './paletteGlyphFigure';
  import { lucideIcon } from './lucideIconAction';

  interface Props {
    drawn: DrawnIcon;
    color: string;
  }

  let { drawn, color }: Props = $props();

  const figure = $derived(drawn.kind === 'glyph' ? paletteGlyphFigure(drawn.glyph) : null);
  const marker = $derived(drawn.kind === 'glyph' ? paletteGlyphMarker(drawn.glyph) : null);
</script>

{#if drawn.kind === 'configured'}
  <span class="og-bar-glyph" use:lucideIcon={drawn.iconName}></span>
{:else if drawn.kind === 'glyph' && figure && marker}
  <span
    class="og-palette-glyph"
    style="color: {color}"
    data-og-glyph={marker.kind}
    data-og-glyph-progress={marker.progress}
    data-og-glyph-rank={marker.rank}
  >
    <svg viewBox="0 0 16 16" width="100%" height="100%" fill="none" aria-hidden="true">
      {#each figure.nodes as node, index (index)}
        {#if node.tag === 'circle'}
          <circle
            cx={node.cx}
            cy={node.cy}
            r={node.r}
            fill={node.fill}
            stroke={node.stroke}
            stroke-width={node.strokeWidth}
            stroke-dasharray={node.strokeDasharray}
            transform={node.transform}
          />
        {:else}
          <path
            d={node.d}
            fill="none"
            stroke={node.stroke}
            stroke-width={node.strokeWidth}
            stroke-linecap={node.strokeLinecap}
            stroke-linejoin={node.strokeLinejoin}
          />
        {/if}
      {/each}
    </svg>
  </span>
{:else if drawn.kind === 'dot'}
  <span class="og-bar-dot" style="background-color: {color}"></span>
{:else if drawn.kind === 'disc'}
  <span class="og-bar-disc" style="background-color: {color}"></span>
{:else}
  <span class="og-bar-ring" style="border-color: {color}"></span>
{/if}
