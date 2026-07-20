<script lang="ts">
  /**
   * The gantt-strip preview: a zoomed-out day strip rendered from the pure
   * {@link GanttStripLayout}. Shaded days paint with the chart's own holiday
   * background variable and markers ride as vertical lines, so the strip reads
   * as the live chart would. A null layout is a set; an `invalid` layout flags.
   */
  import type { GanttStripLayout, StripMarker } from './ganttStripLayout';

  interface Props {
    layout: GanttStripLayout | null;
  }

  const { layout }: Props = $props();

  const markerTitle = (marker: StripMarker): string =>
    marker.name === undefined ? marker.date : `${marker.date} — ${marker.name}`;
</script>

<div class="og-strip">
  {#if layout === null}
    <p class="og-strip-note">The gantt-strip preview applies to a calendar, not a set.</p>
  {:else if layout.invalid}
    <p class="og-strip-flag">Can’t preview — {layout.invalid}</p>
  {:else}
    <div class="og-strip-track">
      <div class="og-strip-cells">
        {#each layout.cells as cell (cell.date)}
          <div class="og-strip-cell" class:og-strip-shaded={cell.shaded}></div>
        {/each}
      </div>
      {#each layout.markers as marker, i (marker.date + '#' + i)}
        <div class="og-strip-marker" style="left:{marker.xFraction * 100}%" title={markerTitle(marker)}>
          {#if marker.name}<span class="og-strip-marker-label">{marker.name}</span>{/if}
        </div>
      {/each}
    </div>
    <p class="og-strip-hint">A zoomed-out rehearsal — shading and markers as the chart renders them.</p>
  {/if}
</div>

<style>
  .og-strip {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .og-strip-note,
  .og-strip-flag {
    margin: 0;
    font-size: var(--font-ui-small, 0.8125rem);
  }
  .og-strip-flag {
    color: var(--text-error);
  }
  .og-strip-note {
    color: var(--text-muted);
  }

  .og-strip-track {
    position: relative;
    block-size: 3rem;
    /* Room above the strip for the markers' labels — the track does NOT clip, so
       a label positioned above it stays visible. */
    margin-block-start: 1.5rem;
  }
  /* The bordered, rounded bar clips only the day cells, not the marker labels. */
  .og-strip-cells {
    display: flex;
    block-size: 100%;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s, 4px);
    overflow: hidden;
  }
  .og-strip-cell {
    flex: 1 1 0;
    min-inline-size: 0;
  }
  /* The chart's own holiday shade, with a neutral fallback outside the chart. */
  .og-strip-shaded {
    background: var(
      --wx-gantt-holiday-background,
      color-mix(in srgb, var(--text-normal) 12%, transparent)
    );
  }

  .og-strip-marker {
    position: absolute;
    inset-block: 0;
    inline-size: 2px;
    background: var(--text-accent);
  }
  .og-strip-marker-label {
    position: absolute;
    inset-block-end: 100%;
    inset-inline-start: 0;
    transform: translateX(-50%);
    padding: 0 0.25rem;
    font-size: var(--font-ui-smaller, 0.75rem);
    white-space: nowrap;
    color: var(--text-accent);
  }

  .og-strip-hint {
    margin: 0;
    font-size: var(--font-ui-smaller, 0.75rem);
    color: var(--text-faint);
  }
</style>
