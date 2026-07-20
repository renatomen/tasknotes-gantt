<script lang="ts">
  /**
   * The calendar editor form: native controls bound to the pure form state
   * (calendarEditorState). Every decision — validation, dirty, the change set —
   * lives in that module; this component is presentation and binding.
   *
   * A save hands the change set up to the host, which writes it through the
   * comment-preserving frontmatter editor. Focus lands on the description on
   * mount and tab order follows the visual top-to-bottom field order.
   */
  /* global HTMLInputElement, HTMLTextAreaElement, structuredClone */
  import { tick } from 'svelte';
  import {
    changedFrontmatter,
    fieldErrors,
    frontmatterFromForm,
    isDirty,
    type DatedEntry,
    type EditorFormState,
  } from './calendarEditorState';
  import type { FrontmatterValue } from './frontmatterEdit';
  import { parseCalendarFrontmatter } from '../controller/calendar/schema';
  import { yearLayoutFor } from './yearGridLayout';
  import YearGrid from './YearGrid.svelte';
  import { weekLayoutFor } from './weekPreviewLayout';
  import WeekPreview from './WeekPreview.svelte';
  import { ganttStripLayoutFor } from './ganttStripLayout';
  import GanttStripPreview from './GanttStripPreview.svelte';

  interface Props {
    initial: EditorFormState;
    onSave: (changes: Record<string, FrontmatterValue>) => Promise<void>;
    /**
     * Attach the vault `[[` suggester to a member input once it mounts,
     * returning a disposer that tears the suggester down when the input goes.
     */
    attachMemberSuggest?: (input: HTMLInputElement, index: number) => (() => void) | void;
    /** Attach the searchable IANA-timezone picker to the timezone input. */
    attachTimezoneSuggest?: (input: HTMLInputElement) => (() => void) | void;
    /** Discard the in-progress edits and reload from disk. */
    onReload?: () => void;
    /** Focus the first field on mount — suppressed on a silent external refresh. */
    autofocus?: boolean;
  }

  const {
    initial,
    onSave,
    attachMemberSuggest,
    attachTimezoneSuggest,
    onReload,
    autofocus = true,
  }: Props = $props();

  let form = $state<EditorFormState>($state.snapshot(initial));
  let baseline = $state<EditorFormState>($state.snapshot(initial));
  let saving = $state(false);

  // The note changed on disk while the editor was open. The host (view) detects
  // this and calls in; the banner only surfaces when there are unsaved edits to
  // lose, so a clean form stays in step with disk without interrupting.
  let externalChanged = $state(false);
  export function markExternalChange(): void {
    externalChanged = true;
  }
  export function clearExternalChange(): void {
    externalChanged = false;
  }
  /** Whether the form holds edits not yet saved — the host reads this to decide
      between a silent refresh (clean) and the reload-or-keep banner (dirty). */
  export function hasUnsavedEdits(): boolean {
    return dirty;
  }

  const errors = $derived(fieldErrors(form));
  const dirty = $derived(isDirty(baseline, form));
  const hasErrors = $derived(Object.keys(errors).length > 0);

  // Preview tabs render the LIVE definition — parsed exactly as the chart does —
  // so unsaved edits reflect without a save. The derived is lazy: it only
  // evaluates while a preview tab is showing.
  type Tab = 'edit' | 'week' | 'strip' | 'year';
  let activeTab = $state<Tab>('edit');
  let previewYear = $state(new Date().getFullYear());
  const definition = $derived(parseCalendarFrontmatter(frontmatterFromForm(form)));
  const yearLayout = $derived(yearLayoutFor(definition, previewYear));
  const weekLayout = $derived(weekLayoutFor(definition));
  const stripLayout = $derived(ganttStripLayoutFor(definition));
  function stepYear(delta: number): void {
    previewYear += delta;
  }

  let descriptionEl: HTMLTextAreaElement | undefined;
  $effect(() => {
    if (autofocus) void tick().then(() => descriptionEl?.focus());
  });

  async function save(): Promise<void> {
    if (!dirty || hasErrors || saving) return;
    saving = true;
    // Snapshot what is being written BEFORE awaiting: edits made during a slow
    // save must not advance the baseline past them, or they would read as clean
    // and be silently lost. `$state.snapshot` is Svelte's way to plain-clone a
    // reactive proxy — `structuredClone` throws on the proxy.
    const snapshot = $state.snapshot(form) as EditorFormState;
    try {
      await onSave(changedFrontmatter(baseline, snapshot));
      baseline = snapshot;
      // Saving resolves the divergence — our write is now the disk truth.
      externalChanged = false;
    } finally {
      saving = false;
    }
  }

  function reload(): void {
    onReload?.();
  }

  const blankDated = (): DatedEntry => ({ date: '', name: '' });

  /** Svelte action: wire the vault `[[` suggester onto a member input, and
      close it when the input unmounts so no popover or keymap scope lingers. */
  function memberSuggest(node: HTMLInputElement, index: number) {
    const dispose = attachMemberSuggest?.(node, index);
    return {
      destroy() {
        dispose?.();
      },
    };
  }

  /** Svelte action: attach the searchable timezone picker, closing it on unmount. */
  function timezoneSuggest(node: HTMLInputElement) {
    const dispose = attachTimezoneSuggest?.(node);
    return {
      destroy() {
        dispose?.();
      },
    };
  }
</script>

<div class="og-cal-form">
  {#if externalChanged && dirty}
    <div class="og-cal-notice" role="alert">
      <span>This note changed on disk while you were editing.</span>
      <button type="button" class="og-cal-notice-btn" onclick={reload}>
        Reload and discard my changes
      </button>
    </div>
  {/if}

  {#if form.kind === 'calendar'}
    <div class="og-cal-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        class="og-cal-tab"
        class:og-cal-tab-active={activeTab === 'edit'}
        aria-selected={activeTab === 'edit'}
        onclick={() => (activeTab = 'edit')}
      >Edit</button>
      <button
        type="button"
        role="tab"
        class="og-cal-tab"
        class:og-cal-tab-active={activeTab === 'week'}
        aria-selected={activeTab === 'week'}
        onclick={() => (activeTab = 'week')}
      >Week</button>
      <button
        type="button"
        role="tab"
        class="og-cal-tab"
        class:og-cal-tab-active={activeTab === 'strip'}
        aria-selected={activeTab === 'strip'}
        onclick={() => (activeTab = 'strip')}
      >Gantt strip</button>
      <button
        type="button"
        role="tab"
        class="og-cal-tab"
        class:og-cal-tab-active={activeTab === 'year'}
        aria-selected={activeTab === 'year'}
        onclick={() => (activeTab = 'year')}
      >Year</button>
    </div>
  {/if}

  {#if form.kind === 'calendar' && activeTab === 'week'}
    <WeekPreview layout={weekLayout} />
  {:else if form.kind === 'calendar' && activeTab === 'strip'}
    <GanttStripPreview layout={stripLayout} />
  {:else if form.kind === 'calendar' && activeTab === 'year'}
    <YearGrid layout={yearLayout} year={previewYear} onYear={stepYear} />
  {:else}
  <section class="og-cal-group">
    <h3 class="og-cal-group-title">Identity</h3>

    <label class="og-cal-field">
      <span class="og-cal-label">Description</span>
      <textarea
        class="og-cal-control"
        bind:this={descriptionEl}
        bind:value={form.description}
        rows="2"
        placeholder="What this calendar represents"
      ></textarea>
    </label>

    <label class="og-cal-field">
      <span class="og-cal-label">Colour</span>
      <span class="og-cal-color">
        <span
          class="og-cal-swatch"
          class:og-cal-swatch-empty={!!errors.color || form.color === ''}
          style="background:{errors.color || form.color === '' ? 'transparent' : form.color}"
        ></span>
        <input class="og-cal-control" type="text" bind:value={form.color} placeholder="#2a9d8f" />
      </span>
      {#if errors.color}<span class="og-cal-error">{errors.color}</span>{/if}
    </label>
  </section>

  {#if form.kind === 'calendar'}
    <section class="og-cal-group">
      <h3 class="og-cal-group-title">Working schedule</h3>

      <label class="og-cal-field">
        <span class="og-cal-label">Working pattern</span>
        <input
          class="og-cal-control og-cal-mono"
          type="text"
          bind:value={form.pattern}
          placeholder="FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
        />
        {#if errors.pattern}<span class="og-cal-error">{errors.pattern}</span>{/if}
      </label>

      <label class="og-cal-field">
        <span class="og-cal-label">Anchor date</span>
        <input class="og-cal-control og-cal-narrow" type="date" bind:value={form.patternStart} />
        <small class="og-cal-hint">Only needed when the pattern repeats by interval or count.</small>
        {#if errors.patternStart}<span class="og-cal-error">{errors.patternStart}</span>{/if}
      </label>

      <fieldset class="og-cal-field">
        <legend class="og-cal-label">Working hours</legend>
        {#each form.workingHours as _hours, i (i)}
          <div class="og-cal-entry og-cal-entry-hours">
            <input
              class="og-cal-control"
              type="text"
              bind:value={form.workingHours[i]}
              placeholder="09:00-17:00"
            />
            <button
              type="button"
              class="og-cal-remove"
              aria-label="Remove hours"
              onclick={() => form.workingHours.splice(i, 1)}
            >Remove</button>
          </div>
        {/each}
        <button
          type="button"
          class="og-cal-add"
          onclick={() => form.workingHours.push('09:00-17:00')}
        >+ Add hours</button>
        {#if errors.workingHours}<span class="og-cal-error">{errors.workingHours}</span>{/if}
      </fieldset>

      <label class="og-cal-field">
        <span class="og-cal-label">Timezone</span>
        <input
          class="og-cal-control"
          type="text"
          bind:value={form.timezone}
          placeholder="Search a timezone (e.g. Pacific/Auckland)"
          use:timezoneSuggest
        />
        <small class="og-cal-hint">Recorded now; honoured once hour-level scheduling ships.</small>
        {#if errors.timezone}<span class="og-cal-error">{errors.timezone}</span>{/if}
      </label>
    </section>

    <section class="og-cal-group">
      <h3 class="og-cal-group-title">Exceptions</h3>

      {#each [{ key: 'nonWorking', label: 'Non-working days', single: 'non-working day' }, { key: 'events', label: 'Events', single: 'event' }] as list (list.key)}
        <fieldset class="og-cal-field">
          <legend class="og-cal-label">{list.label}</legend>
          {#each form[list.key as 'nonWorking' | 'events'] as entry, i (i)}
            {#if entry.raw === undefined}
              <div class="og-cal-entry" class:og-cal-entry-event={list.key === 'events'}>
                <input class="og-cal-control og-cal-narrow" type="date" bind:value={entry.date} />
                <input class="og-cal-control" type="text" bind:value={entry.name} placeholder="Name (optional)" />
                {#if list.key === 'events'}
                  <label class="og-cal-check">
                    <input type="checkbox" bind:checked={entry.marker} /> Marker
                  </label>
                {/if}
                <button
                  type="button"
                  class="og-cal-remove"
                  aria-label="Remove {list.single}"
                  onclick={() => form[list.key as 'nonWorking' | 'events'].splice(i, 1)}
                >Remove</button>
              </div>
            {:else}
              <div class="og-cal-readonly">Advanced entry — edit as markdown</div>
            {/if}
          {/each}
          <button
            type="button"
            class="og-cal-add"
            onclick={() => form[list.key as 'nonWorking' | 'events'].push(blankDated())}
          >+ Add {list.single}</button>
        </fieldset>
      {/each}
      {#if errors.dates}<span class="og-cal-error">{errors.dates}</span>{/if}

      {#if form.availabilityRaw !== undefined}
        <div class="og-cal-readonly">
          Availability blocks are set on this calendar — edit them as markdown for now.
        </div>
      {/if}
    </section>
  {:else}
    <section class="og-cal-group">
      <h3 class="og-cal-group-title">Member calendars</h3>
      <fieldset class="og-cal-field">
        {#each form.members as _member, i (i)}
          <div class="og-cal-entry og-cal-entry-member">
            <input
              class="og-cal-control"
              type="text"
              bind:value={form.members[i]}
              placeholder="[[Calendar note]]"
              use:memberSuggest={i}
            />
            <button
              type="button"
              class="og-cal-remove"
              aria-label="Remove member"
              onclick={() => form.members.splice(i, 1)}
            >Remove</button>
          </div>
        {/each}
        <button type="button" class="og-cal-add" onclick={() => form.members.push('')}>
          + Add member
        </button>
        {#if errors.members}<span class="og-cal-error">{errors.members}</span>{/if}
      </fieldset>
    </section>
  {/if}

  <div class="og-cal-actions">
    <button type="button" class="mod-cta" disabled={!dirty || hasErrors || saving} onclick={save}>
      {saving ? 'Saving…' : 'Save'}
    </button>
    {#if hasErrors}<span class="og-cal-error">Fix the flagged fields before saving.</span>{/if}
  </div>
  {/if}
</div>

<style>
  /* Native to Obsidian — every colour and radius comes from a theme variable,
     so the form adapts to light/dark and any theme. The design work is the
     information architecture: fields grouped by how a calendar is reasoned
     about (identity → normal schedule → exceptions), one field per row with
     real rhythm, and exception entries aligned as a grid so a holiday list
     reads as a table rather than a pile of inputs. */
  .og-cal-form {
    display: flex;
    flex-direction: column;
    gap: 1.75rem;
    max-width: 44rem;
    margin: 0 auto;
    padding: 0.5rem 0 2rem;
  }

  /* Tab strip separating the editable form from the read-only preview(s). */
  .og-cal-tabs {
    display: flex;
    gap: 0.25rem;
    border-bottom: 1px solid var(--background-modifier-border);
  }
  .og-cal-tab {
    padding: 0.4rem 0.9rem;
    font-size: var(--font-ui-small, 0.8125rem);
    color: var(--text-muted);
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    cursor: pointer;
  }
  .og-cal-tab:hover {
    color: var(--text-normal);
  }
  .og-cal-tab-active {
    color: var(--text-normal);
    border-bottom-color: var(--interactive-accent);
  }

  .og-cal-group {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  /* Eyebrow section labels — quiet, so the fields are the focus. */
  .og-cal-group-title {
    margin: 0;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--background-modifier-border);
    font-size: var(--font-ui-smaller, 0.75rem);
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .og-cal-field {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    border: none;
    margin: 0;
    padding: 0;
    min-inline-size: 0;
  }

  .og-cal-label {
    font-size: var(--font-ui-small, 0.8125rem);
    font-weight: 500;
    color: var(--text-normal);
    padding: 0;
  }

  .og-cal-control {
    inline-size: 100%;
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
    box-shadow: 0 0 0 2px var(--background-modifier-border-focus, transparent);
  }
  textarea.og-cal-control {
    resize: vertical;
    min-block-size: 2.5rem;
    font: inherit;
  }
  .og-cal-mono {
    font-family: var(--font-monospace);
  }
  /* Date and short-range fields do not need the full line width. */
  .og-cal-narrow {
    inline-size: auto;
    min-inline-size: 9rem;
    max-inline-size: 12rem;
  }

  .og-cal-color {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .og-cal-swatch {
    flex: 0 0 auto;
    inline-size: 1.6rem;
    block-size: 1.6rem;
    border-radius: var(--radius-s, 4px);
    border: 1px solid var(--background-modifier-border);
  }
  .og-cal-swatch-empty {
    background-image: linear-gradient(
      45deg,
      var(--background-modifier-border) 25%,
      transparent 25% 75%,
      var(--background-modifier-border) 75%
    );
    background-size: 8px 8px;
  }

  .og-cal-hint {
    font-size: var(--font-ui-smaller, 0.75rem);
    color: var(--text-faint);
  }
  .og-cal-error {
    font-size: var(--font-ui-smaller, 0.75rem);
    color: var(--text-error);
  }

  /* Aligned entry grid — date · name · (marker) · remove line up down the
     list so multiple exceptions read as rows of one table. */
  .og-cal-entry {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr) max-content;
    align-items: center;
    gap: 0.5rem;
  }
  .og-cal-entry-event {
    grid-template-columns: max-content minmax(0, 1fr) max-content max-content;
  }
  /* A single short field keeps Remove adjacent, not stranded across the row. */
  .og-cal-entry-hours {
    grid-template-columns: minmax(9rem, 12rem) max-content;
    justify-content: start;
  }
  .og-cal-entry-member {
    grid-template-columns: minmax(0, 1fr) max-content;
  }

  .og-cal-check {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: var(--font-ui-smaller, 0.75rem);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .og-cal-add {
    align-self: flex-start;
    margin-top: 0.15rem;
    padding: 0.3rem 0.6rem;
    font-size: var(--font-ui-smaller, 0.75rem);
    color: var(--text-muted);
    background: transparent;
    border: 1px dashed var(--background-modifier-border);
    border-radius: var(--radius-s, 4px);
    cursor: pointer;
  }
  .og-cal-add:hover {
    color: var(--text-normal);
    border-color: var(--background-modifier-border-hover);
  }
  .og-cal-remove {
    padding: 0.3rem 0.5rem;
    font-size: var(--font-ui-smaller, 0.75rem);
    color: var(--text-muted);
    background: transparent;
    border: none;
    cursor: pointer;
  }
  .og-cal-remove:hover {
    color: var(--text-error);
  }

  .og-cal-readonly {
    padding: 0.4rem 0.55rem;
    font-size: var(--font-ui-smaller, 0.75rem);
    color: var(--text-faint);
    font-style: italic;
    background: var(--background-secondary);
    border-radius: var(--radius-s, 4px);
  }

  .og-cal-notice {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
    padding: 0.6rem 0.75rem;
    font-size: var(--font-ui-small, 0.8125rem);
    color: var(--text-normal);
    background: var(--background-modifier-error-hover, var(--background-secondary));
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s, 4px);
  }
  .og-cal-notice-btn {
    padding: 0.25rem 0.6rem;
    cursor: pointer;
  }

  /* Save closes the form after the exceptions, set off by a divider — not a
     sticky footer, which would permanently cover a row of the fields above. */
  .og-cal-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-top: 0.5rem;
    padding-top: 1.25rem;
    border-top: 1px solid var(--background-modifier-border);
  }

  @media (max-width: 30rem) {
    .og-cal-entry,
    .og-cal-entry-event,
    .og-cal-entry-hours,
    .og-cal-entry-member {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
