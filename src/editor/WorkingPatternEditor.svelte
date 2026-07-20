<script module lang="ts">
  // A per-instance counter so each editor's radio group has a unique name;
  // otherwise two mounted editors would share one radio group.
  let instanceCount = 0;
</script>

<script lang="ts">
  /**
   * A visual builder for the working-pattern RRULE, so authors pick frequency,
   * interval, weekdays and monthly rules instead of typing raw notation. Reads
   * the current rule through the pure {@link parsePattern}; a rule the model
   * cannot represent (or that the author chooses to edit by hand) falls back to
   * a raw text field, never silently rewritten. Every visual change is committed
   * back through {@link formatPattern}.
   */
  import {
    defaultPattern,
    formatPattern,
    parsePattern,
    WEEKDAY_CODES,
    type Frequency,
    type PatternModel,
    type WeekdayCode,
  } from './workingPatternModel';

  interface Props {
    value: string;
  }

  let { value = $bindable() }: Props = $props();

  const initial = parsePattern(value);
  // A non-empty rule the model can't represent opens in raw mode so it is never
  // rewritten; an empty value starts fresh in the visual builder.
  let raw = $state(initial === null && value.trim() !== '');
  let model = $state<PatternModel>(initial ?? defaultPattern());

  const WEEKDAY_LABELS: Record<WeekdayCode, string> = {
    MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun',
  };
  const FREQUENCIES: { value: Frequency; label: string; unit: string }[] = [
    { value: 'DAILY', label: 'Daily', unit: 'days' },
    { value: 'WEEKLY', label: 'Weekly', unit: 'weeks' },
    { value: 'MONTHLY', label: 'Monthly', unit: 'months' },
  ];
  const POSITIONS = [
    { value: 1, label: 'first' },
    { value: 2, label: 'second' },
    { value: 3, label: 'third' },
    { value: 4, label: 'fourth' },
    { value: -1, label: 'last' },
  ];

  const unit = $derived(FREQUENCIES.find((f) => f.value === model.frequency)?.unit ?? 'weeks');
  const monthlyGroup = `og-monthly-mode-${instanceCount++}`;

  function commit(): void {
    value = formatPattern(model);
  }

  /** Clamp a possibly-empty/invalid number input to an integer in [min, max]. */
  function clampInt(raw: number, min: number, max: number, fallback: number): number {
    if (!Number.isFinite(raw)) return fallback;
    return Math.min(max, Math.max(min, Math.round(raw)));
  }

  function commitInterval(): void {
    model.interval = clampInt(model.interval, 1, 999, 1);
    commit();
  }

  function commitMonthDay(): void {
    model.monthDay = clampInt(model.monthDay, 1, 31, 1);
    commit();
  }

  function toggleWeekday(code: WeekdayCode): void {
    const selected = new Set(model.weekdays);
    if (selected.has(code)) {
      if (selected.size === 1) return; // keep at least one working day
      selected.delete(code);
    } else {
      selected.add(code);
    }
    model.weekdays = WEEKDAY_CODES.filter((c) => selected.has(c));
    commit();
  }

  function setWeekdaysOnly(): void {
    model.weekdays = ['MO', 'TU', 'WE', 'TH', 'FR'];
    commit();
  }

  function editAsText(): void {
    value = formatPattern(model); // hand the current rule to the text field
    raw = true;
  }

  function useVisualEditor(): void {
    const parsed = parsePattern(value);
    if (parsed !== null) {
      model = parsed;
      raw = false;
    }
    // If the raw rule is not representable, stay in raw mode (parsed === null).
  }

  const rawParses = $derived(parsePattern(value) !== null);
</script>

<div class="og-rrule">
  {#if raw}
    <input
      class="og-cal-control og-cal-mono"
      type="text"
      bind:value
      placeholder="FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
    />
    <div class="og-rrule-rawnote">
      <small class="og-cal-hint">Editing the pattern as text.</small>
      <button type="button" class="og-rrule-link" disabled={!rawParses} onclick={useVisualEditor}>
        Use the visual editor
      </button>
    </div>
  {:else}
    <div class="og-rrule-row">
      <select class="og-cal-control og-cal-narrow" bind:value={model.frequency} onchange={commit}>
        {#each FREQUENCIES as freq (freq.value)}
          <option value={freq.value}>{freq.label}</option>
        {/each}
      </select>
      <label class="og-rrule-interval">
        every
        <input
          class="og-cal-control"
          type="number"
          min="1"
          bind:value={model.interval}
          onchange={commitInterval}
        />
        {unit}
      </label>
    </div>

    {#if model.frequency === 'WEEKLY'}
      <div class="og-rrule-weekdays" role="group" aria-label="Working weekdays">
        {#each WEEKDAY_CODES as code (code)}
          <button
            type="button"
            class="og-rrule-day"
            class:og-rrule-day-on={model.weekdays.includes(code)}
            aria-pressed={model.weekdays.includes(code)}
            onclick={() => toggleWeekday(code)}
          >{WEEKDAY_LABELS[code]}</button>
        {/each}
        <button type="button" class="og-rrule-link" onclick={setWeekdaysOnly}>Weekdays</button>
      </div>
    {:else if model.frequency === 'MONTHLY'}
      <div class="og-rrule-monthly">
        <label class="og-rrule-radio">
          <input
            type="radio"
            name={monthlyGroup}
            checked={model.monthlyMode === 'day-of-month'}
            onchange={() => {
              model.monthlyMode = 'day-of-month';
              commit();
            }}
          />
          on day
          <input
            class="og-cal-control"
            type="number"
            min="1"
            max="31"
            bind:value={model.monthDay}
            disabled={model.monthlyMode !== 'day-of-month'}
            onchange={commitMonthDay}
          />
          of the month
        </label>
        <label class="og-rrule-radio">
          <input
            type="radio"
            name={monthlyGroup}
            checked={model.monthlyMode === 'nth-weekday'}
            onchange={() => {
              model.monthlyMode = 'nth-weekday';
              commit();
            }}
          />
          on the
          <select
            class="og-cal-control og-cal-narrow"
            bind:value={model.nthPosition}
            disabled={model.monthlyMode !== 'nth-weekday'}
            onchange={commit}
          >
            {#each POSITIONS as pos (pos.value)}
              <option value={pos.value}>{pos.label}</option>
            {/each}
          </select>
          <select
            class="og-cal-control og-cal-narrow"
            bind:value={model.nthWeekday}
            disabled={model.monthlyMode !== 'nth-weekday'}
            onchange={commit}
          >
            {#each WEEKDAY_CODES as code (code)}
              <option value={code}>{WEEKDAY_LABELS[code]}</option>
            {/each}
          </select>
        </label>
      </div>
    {/if}

    <button type="button" class="og-rrule-link og-rrule-text-toggle" onclick={editAsText}>
      Edit as text
    </button>
  {/if}
</div>

<style>
  /* The shared field-control look, local to this component: Svelte scopes styles
     per component, so the form's `.og-cal-*` rules do not reach here. */
  .og-cal-control {
    box-sizing: border-box;
    padding: 0.4rem 0.55rem;
    font-size: var(--font-ui-small, 0.8125rem);
    color: var(--text-normal);
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s, 4px);
  }
  .og-cal-control:hover {
    border-color: var(--background-modifier-border-hover);
  }
  .og-cal-control:focus {
    outline: none;
    border-color: var(--interactive-accent);
  }
  .og-cal-narrow {
    inline-size: auto;
    min-inline-size: 8rem;
  }
  .og-cal-mono {
    inline-size: 100%;
    font-family: var(--font-monospace);
  }

  .og-rrule {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .og-rrule-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  .og-rrule-interval {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: var(--font-ui-small, 0.8125rem);
    color: var(--text-muted);
  }
  .og-rrule-interval input {
    inline-size: 4rem;
  }

  .og-rrule-weekdays {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .og-rrule-day {
    padding: 0.3rem 0.55rem;
    font-size: var(--font-ui-smaller, 0.75rem);
    color: var(--text-muted);
    background: transparent;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s, 4px);
    cursor: pointer;
  }
  .og-rrule-day-on {
    color: var(--text-on-accent);
    background: var(--interactive-accent);
    border-color: var(--interactive-accent);
  }

  .og-rrule-monthly {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .og-rrule-radio {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: var(--font-ui-small, 0.8125rem);
    color: var(--text-normal);
  }
  .og-rrule-radio input[type='number'] {
    inline-size: 4rem;
  }

  .og-rrule-rawnote {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .og-rrule-link {
    align-self: flex-start;
    padding: 0;
    font-size: var(--font-ui-smaller, 0.75rem);
    color: var(--text-accent);
    background: none;
    border: none;
    cursor: pointer;
  }
  .og-rrule-link:disabled {
    color: var(--text-faint);
    cursor: default;
  }
  .og-rrule-text-toggle {
    margin-top: 0.1rem;
  }
</style>
