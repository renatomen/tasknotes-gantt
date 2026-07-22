<script lang="ts">
  /**
   * The year-at-a-glance preview: a contributions-style grid rendered from the
   * pure {@link YearGridLayout}. Weekday rows (Mon..Sun) fill each week column
   * top-to-bottom; the layout already classified every day, so this is purely
   * presentation. The grid compresses to the available width (no horizontal
   * scroll), with month labels across the top, weekday labels down the left, and
   * a stepped divider tracing each month boundary (it jogs mid-week where a month
   * breaks between weekdays). A null layout means the note is a set; an `invalid`
   * layout shows the flag state rather than a stale grid.
   */
  import { addDaysIso } from '../controller/calendar/schema';
  import { buildConflictTooltip } from './unionPreview';
  import { monthColumns, type YearGridCell, type YearGridLayout } from './yearGridLayout';

  interface Props {
    layout: YearGridLayout | null;
    year: number;
    onYear: (delta: number) => void;
  }

  const { layout, year, onYear }: Props = $props();

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const months = $derived(layout === null ? [] : monthColumns(layout));
  const lastColumn = $derived(layout === null ? 0 : layout.columns - 1);

  const cellTitle = (cell: YearGridCell): string => {
    if (cell.conflictSources !== undefined && cell.conflictSources.length > 0) {
      return buildConflictTooltip(cell.date, cell.conflictSources);
    }
    return cell.name === undefined ? cell.date : `${cell.date} — ${cell.name}`;
  };

  // A month boundary sits on a cell's edge when the neighbouring day belongs to a
  // different month. Each boundary is drawn from BOTH sides so the inter-cell gap
  // never leaves it ambiguous: the first cells of a month carry a top/left line
  // (previous day one row up, same weekday one week left), and the last cells
  // carry a bottom/right line (next day one row down, same weekday one week
  // right). Together they trace a stepped divider that jogs at mid-week breaks.
  const monthOf = (iso: string): string => iso.slice(0, 7);
  const dividesTop = (cell: YearGridCell): boolean =>
    cell.row > 0 && monthOf(cell.date) !== monthOf(addDaysIso(cell.date, -1));
  const dividesLeft = (cell: YearGridCell): boolean =>
    cell.column > 0 && monthOf(cell.date) !== monthOf(addDaysIso(cell.date, -7));
  const dividesBottom = (cell: YearGridCell): boolean =>
    cell.row < 6 && monthOf(cell.date) !== monthOf(addDaysIso(cell.date, 1));
  const dividesRight = (cell: YearGridCell): boolean =>
    cell.column < lastColumn && monthOf(cell.date) !== monthOf(addDaysIso(cell.date, 7));
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
    <div class="og-year-cal" style="--cols: {layout.columns}">
      <div class="og-year-corner"></div>

      <div class="og-year-months">
        {#each months as m, i (m.month)}
          <span
            class="og-year-month"
            style="grid-column: {m.column + 1} / {(months[i + 1]?.column ?? lastColumn + 1) + 1}"
          >{MONTHS[m.month - 1]}</span>
        {/each}
      </div>

      <div class="og-year-weekdays" aria-hidden="true">
        {#each WEEKDAYS as label, weekday (label)}
          <span class="og-year-weekday" style="grid-row: {weekday + 1}">{label}</span>
        {/each}
      </div>

      <div class="og-year-grid" role="img" aria-label="Working days across {year}">
        {#each layout.cells as cell (cell.date)}
          {#if cell.inYear}
            <div
              class="og-year-cell og-year-{cell.dayClass}"
              class:og-year-div-top={dividesTop(cell)}
              class:og-year-div-left={dividesLeft(cell)}
              class:og-year-div-bottom={dividesBottom(cell)}
              class:og-year-div-right={dividesRight(cell)}
              style="grid-column: {cell.column + 1}; grid-row: {cell.row + 1}"
              title={cellTitle(cell)}
            ></div>
          {/if}
        {/each}
      </div>
    </div>

    <div class="og-year-legend">
      <span class="og-year-key"><i class="og-year-swatch og-year-working"></i> Working</span>
      <span class="og-year-key"><i class="og-year-swatch og-year-blocking"></i> Non-working</span>
      <span class="og-year-key"><i class="og-year-swatch og-year-event"></i> Event</span>
      <span class="og-year-key"><i class="og-year-swatch og-year-marker"></i> Marker</span>
      <span class="og-year-key"><i class="og-year-swatch og-year-conflict"></i> Conflict</span>
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

  /* The whole year fits the available width: week columns share the space as
     equal fractions, so there is never a horizontal scroll. A max width keeps the
     cells near-square on wide panes rather than stretching them. */
  .og-year-cal {
    --og-cell-h: 0.8rem;
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: auto auto;
    column-gap: 5px;
    row-gap: 3px;
    min-inline-size: 0;
    max-inline-size: calc(var(--cols) * 1rem + 2.5rem);
  }
  .og-year-corner {
    grid-column: 1;
    grid-row: 1;
  }

  .og-year-months {
    grid-column: 2;
    grid-row: 1;
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    column-gap: 2px;
    align-items: end;
    /* A label sits at its month's start column and may run past it; clip at the
       grid's right edge so a trailing label never forces a horizontal scroll. */
    overflow: hidden;
  }
  /* Each label spans its own month's columns and clips at that edge, so labels
     can never overlap — they shorten as the pane narrows instead. */
  .og-year-month {
    grid-row: 1;
    overflow: hidden;
    white-space: nowrap;
    line-height: 1;
    font-size: var(--font-ui-smaller, 0.75rem);
    color: var(--text-muted);
  }

  .og-year-weekdays {
    grid-column: 1;
    grid-row: 2;
    display: grid;
    grid-template-rows: repeat(7, var(--og-cell-h));
    row-gap: 2px;
  }
  .og-year-weekday {
    align-self: center;
    text-align: end;
    line-height: 1;
    font-size: var(--font-ui-smaller, 0.75rem);
    color: var(--text-muted);
  }

  .og-year-grid {
    grid-column: 2;
    grid-row: 2;
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    grid-template-rows: repeat(7, var(--og-cell-h));
    gap: 2px;
  }
  .og-year-cell {
    min-inline-size: 0;
    border-radius: 2px;
    /* One box-shadow reads all four edge variables, so any combination of month
       dividers composes without enumerating the cases. */
    --og-div-t: 0 0 0 0 transparent;
    --og-div-l: 0 0 0 0 transparent;
    --og-div-b: 0 0 0 0 transparent;
    --og-div-r: 0 0 0 0 transparent;
    box-shadow: var(--og-div-t), var(--og-div-l), var(--og-div-b), var(--og-div-r);
  }

  /* Stepped month divider: a line on the edge of the cells bordering a month
     change. Inset so it hugs the cell edge rather than falling into the gap; the
     boundary's two sides both draw, so the gap never leaves it ambiguous. */
  .og-year-div-top {
    --og-div-t: inset 0 1.5px 0 var(--text-muted);
  }
  .og-year-div-left {
    --og-div-l: inset 1.5px 0 0 var(--text-muted);
  }
  .og-year-div-bottom {
    --og-div-b: inset 0 -1.5px 0 var(--text-muted);
  }
  .og-year-div-right {
    --og-div-r: inset -1.5px 0 0 var(--text-muted);
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
  /* A conflict must read at cell scale, so it uses a hard-edged error diagonal
     over a solid error wash rather than a fine gradient that would blur away. */
  .og-year-conflict {
    background:
      repeating-linear-gradient(
        -45deg,
        var(--background-modifier-error, #e5534b) 0,
        var(--background-modifier-error, #e5534b) 2px,
        transparent 2px,
        transparent 4px
      ),
      color-mix(in srgb, var(--background-modifier-error, #e5534b) 40%, var(--background-primary));
    outline: 1px solid var(--background-modifier-error, #e5534b);
    outline-offset: -1px;
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
