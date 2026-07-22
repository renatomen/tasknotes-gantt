<script lang="ts">
  /**
   * The week preview: seven day columns (Mon..Sun) rendered from the pure
   * {@link WeekPreviewLayout}. Each working day shows its authored hour ranges
   * (split shifts as stacked blocks) or an all-day marker; non-working days
   * recede. A null layout is a set; an `invalid` layout shows the flag state.
   */
  import { buildConflictTooltip } from './unionPreview';
  import type { DayColumn, WeekPreviewLayout } from './weekPreviewLayout';

  interface Props {
    layout: WeekPreviewLayout | null;
  }

  const { layout }: Props = $props();

  const dayTitle = (day: DayColumn): string | undefined =>
    day.conflict && day.conflictSources !== undefined
      ? buildConflictTooltip(day.date, day.conflictSources)
      : undefined;
</script>

<div class="og-week">
  {#if layout === null}
    <p class="og-week-note">The week preview applies to a calendar, not a set.</p>
  {:else if layout.invalid}
    <p class="og-week-flag">Can’t preview the week — {layout.invalid}</p>
  {:else}
    <div class="og-week-grid">
      {#each layout.days as day (day.weekday)}
        <div
          class="og-week-col"
          class:og-week-off={!day.isWorking}
          class:og-week-conflict={day.conflict}
          title={dayTitle(day)}
        >
          <div class="og-week-label">{day.label}</div>
          {#if day.isWorking && day.hours.length > 0}
            {#each day.hours as range, i (i)}
              <div class="og-week-block">{range.start}–{range.end}</div>
            {/each}
          {:else if day.isWorking}
            <div class="og-week-block og-week-allday">Working</div>
          {:else}
            <div class="og-week-none">—</div>
          {/if}
        </div>
      {/each}
    </div>
    <p class="og-week-hint">Hours are authored now — honoured once hour-granularity scheduling lands.</p>
  {/if}
</div>

<style>
  .og-week {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .og-week-note,
  .og-week-flag {
    margin: 0;
    font-size: var(--font-ui-small, 0.8125rem);
  }
  .og-week-flag {
    color: var(--text-error);
  }
  .og-week-note {
    color: var(--text-muted);
  }

  .og-week-grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 0.5rem;
  }
  .og-week-col {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.5rem 0.4rem;
    min-block-size: 5rem;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s, 4px);
  }
  /* Non-working days recede so the working shape reads at a glance. */
  .og-week-off {
    background: transparent;
    border-style: dashed;
  }
  /* A conflict outranks working/blocking: members disagree on this day. The
     diagonal error stripe matches the main view's conflict treatment. */
  .og-week-conflict {
    background-image: repeating-linear-gradient(
      45deg,
      var(--background-modifier-error) 0,
      var(--background-modifier-error) 4px,
      transparent 4px,
      transparent 8px
    );
    border-color: var(--background-modifier-error);
    border-style: solid;
  }

  .og-week-label {
    font-size: var(--font-ui-smaller, 0.75rem);
    font-weight: 600;
    color: var(--text-muted);
    text-align: center;
  }

  .og-week-block {
    padding: 0.2rem 0.3rem;
    font-size: var(--font-ui-smaller, 0.75rem);
    font-variant-numeric: tabular-nums;
    text-align: center;
    color: var(--text-normal);
    background: color-mix(in srgb, var(--interactive-accent) 22%, transparent);
    border-radius: var(--radius-s, 4px);
  }
  .og-week-allday {
    color: var(--text-muted);
    background: var(--background-modifier-border);
  }
  .og-week-none {
    text-align: center;
    color: var(--text-faint);
  }

  .og-week-hint {
    margin: 0;
    font-size: var(--font-ui-smaller, 0.75rem);
    color: var(--text-faint);
  }
</style>
