<script lang="ts">
  /**
   * The year-at-a-glance preview: a contributions-style grid rendered from the
   * pure {@link YearGridLayout}. Weekday rows (Mon..Sun) fill each week column
   * top-to-bottom; the layout already classified every day, so this is purely
   * presentation. A null layout means the note is a set (no working pattern); an
   * `invalid` layout shows the flag state rather than a stale grid.
   */
  import type { YearGridLayout } from './yearGridLayout';

  interface Props {
    layout: YearGridLayout | null;
    year: number;
    onYear: (delta: number) => void;
  }

  const { layout, year, onYear }: Props = $props();

  const cellTitle = (date: string, name: string | undefined): string =>
    name === undefined ? date : `${date} — ${name}`;
</script>

<div class="og-year">
  <div class="og-year-head">
    <button type="button" class="og-year-step" aria-label="Previous year" onclick={() => onYear(-1)}>‹</button>
    <span class="og-year-label">{year}</span>
    <button type="button" class="og-year-step" aria-label="Next year" onclick={() => onYear(1)}>›</button>
  </div>

  {#if layout === null}
    <p class="og-year-note">The year preview applies to a calendar, not a set.</p>
  {:else if layout.invalid}
    <p class="og-year-flag">Can’t preview this year — {layout.invalid}</p>
  {:else}
    <div class="og-year-scroll">
      <div class="og-year-grid">
        {#each layout.cells as cell (cell.date)}
          <div
            class="og-year-cell og-year-{cell.inYear ? cell.dayClass : 'pad'}"
            title={cell.inYear ? cellTitle(cell.date, cell.name) : ''}
          ></div>
        {/each}
      </div>
    </div>

    <div class="og-year-legend">
      <span class="og-year-key"><i class="og-year-swatch og-year-working"></i> Working</span>
      <span class="og-year-key"><i class="og-year-swatch og-year-blocking"></i> Non-working</span>
      <span class="og-year-key"><i class="og-year-swatch og-year-event"></i> Event</span>
      <span class="og-year-key"><i class="og-year-swatch og-year-marker"></i> Marker</span>
    </div>
  {/if}
</div>

<style>
  .og-year {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .og-year-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .og-year-step {
    padding: 0.1rem 0.5rem;
    font-size: var(--font-ui-medium, 1rem);
    line-height: 1;
    cursor: pointer;
  }
  .og-year-label {
    min-inline-size: 3.5rem;
    text-align: center;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .og-year-note,
  .og-year-flag {
    margin: 0;
    font-size: var(--font-ui-small, 0.8125rem);
  }
  .og-year-flag {
    color: var(--text-error);
  }
  .og-year-note {
    color: var(--text-muted);
  }

  /* Weekday rows fill each week column top-to-bottom (the layout's cell order). */
  .og-year-scroll {
    overflow-x: auto;
  }
  .og-year-grid {
    display: grid;
    grid-template-rows: repeat(7, 0.85rem);
    grid-auto-flow: column;
    grid-auto-columns: 0.85rem;
    gap: 2px;
    inline-size: max-content;
  }
  .og-year-cell {
    inline-size: 0.85rem;
    block-size: 0.85rem;
    border-radius: 2px;
  }

  /* Non-working recedes as calm context (softened, still the conventional red);
     events and the marker stay crisp so they read as the notable days. */
  .og-year-working {
    background: var(--background-modifier-border);
  }
  .og-year-blocking {
    background: color-mix(in srgb, var(--color-red, #d9534f) 55%, var(--background-primary));
  }
  .og-year-event {
    background: color-mix(in srgb, var(--color-blue, #4c8dff) 70%, var(--background-primary));
  }
  .og-year-marker {
    background: var(--color-yellow, #e0af00);
  }
  .og-year-pad {
    background: transparent;
  }

  .og-year-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 1rem;
    font-size: var(--font-ui-smaller, 0.75rem);
    color: var(--text-muted);
  }
  .og-year-key {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .og-year-swatch {
    inline-size: 0.75rem;
    block-size: 0.75rem;
    border-radius: 2px;
  }
</style>
