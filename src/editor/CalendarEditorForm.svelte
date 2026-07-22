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
  /* global HTMLInputElement, HTMLTextAreaElement */
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
  import { yearLayoutFor, buildYearGridUnion } from './yearGridLayout';
  import YearGrid from './YearGrid.svelte';
  import { weekLayoutFor, buildWeekPreviewUnion } from './weekPreviewLayout';
  import WeekPreview from './WeekPreview.svelte';
  import { ganttStripLayoutFor, buildGanttStripUnion } from './ganttStripLayout';
  import GanttStripPreview from './GanttStripPreview.svelte';
  import { type MemberResolution } from './unionPreview';
  import { buildCalendarNotice } from '../bases/calendarConflicts';
  import { formatUtcOffset } from './timezoneOffset';
  import WorkingPatternEditor from './WorkingPatternEditor.svelte';
  import ColorField from './ColorField.svelte';
  import { validateNoteName } from './noteName';

  interface Props {
    initial: EditorFormState;
    /** The note's current name (its filename), shown in the editable Name field. */
    initialName: string;
    onSave: (changes: Record<string, FrontmatterValue>) => Promise<void>;
    /** Rename the note's file; the host performs the vault rename. */
    onRename?: (newName: string) => Promise<void>;
    /**
     * Attach the vault `[[` suggester to a member input once it mounts,
     * returning a disposer that tears the suggester down when the input goes.
     */
    attachMemberSuggest?: (input: HTMLInputElement, index: number) => (() => void) | void;
    /** Attach the searchable IANA-timezone picker to the timezone input. */
    attachTimezoneSuggest?: (input: HTMLInputElement) => (() => void) | void;
    /**
     * Resolve a set-member link to a member calendar (or a degradation reason)
     * for the live union preview. Injected by the host, which has vault access;
     * the form stays pure and re-resolves as the member list is edited.
     */
    resolveMember?: (link: string) => MemberResolution;
    /** Discard the in-progress edits and reload from disk. */
    onReload?: () => void;
    /** Focus the first field on mount — suppressed on a silent external refresh. */
    autofocus?: boolean;
  }

  const {
    initial,
    initialName,
    onSave,
    onRename,
    attachMemberSuggest,
    attachTimezoneSuggest,
    resolveMember,
    onReload,
    autofocus = true,
  }: Props = $props();

  let form = $state<EditorFormState>($state.snapshot(initial));
  let baseline = $state<EditorFormState>($state.snapshot(initial));
  // The name is the note's filename, edited here and renamed on save. Tracked
  // apart from the frontmatter form (which the pure state module owns) with its
  // own baseline so a rename that lands advances the clean point.
  let name = $state(initialName);
  let nameBaseline = $state(initialName);
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
  /** Whether a save would go through right now — the close guard disables its
      Save button otherwise, so an errored or mid-save form can't offer it. */
  export function canSave(): boolean {
    return dirty && !hasErrors && !saving;
  }

  const errors = $derived(fieldErrors(form));
  const nameError = $derived(validateNoteName(name));
  const nameDirty = $derived(name.trim() !== nameBaseline);
  const dirty = $derived(isDirty(baseline, form) || nameDirty);
  const hasErrors = $derived(Object.keys(errors).length > 0 || nameError !== null);

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

  // A calendar-set previews the UNION of its members. The members resolve live
  // through the injected resolver, so adding/removing one updates every preview
  // and the banner without a save. Unresolved links and non-calendar notes are
  // excluded from the union and counted apart in the banner.
  const resolvedMembers = $derived<MemberResolution[]>(
    form.kind === 'calendar-set' && resolveMember
      ? form.members.map((link) => resolveMember(link))
      : [],
  );
  const okMembers = $derived(
    resolvedMembers.filter(
      (member): member is Extract<MemberResolution, { kind: 'ok' }> => member.kind === 'ok',
    ),
  );
  const memberDefinitions = $derived(okMembers.map((member) => member.definition));
  const memberNames = $derived(okMembers.map((member) => member.name));
  const okCount = $derived(memberDefinitions.length);
  const unresolvedCount = $derived(
    resolvedMembers.filter((member) => member.kind === 'unresolved').length,
  );
  const invalidCount = $derived(
    resolvedMembers.filter((member) => member.kind === 'invalid').length,
  );
  const unionWeekLayout = $derived(buildWeekPreviewUnion(memberDefinitions, memberNames));
  const unionStripLayout = $derived(buildGanttStripUnion(memberDefinitions, memberNames));
  const unionYearLayout = $derived(buildYearGridUnion(memberDefinitions, previewYear, memberNames));

  // The banner counts conflicts over one canonical window — the selected year —
  // read from the SAME layout the Year tab renders, so the number and the Year
  // stripes can never drift. But the Week/Strip tabs render conflicts over their
  // own content windows, which can fall outside that year: the banner also warns
  // whenever any preview shows a conflict the year count misses, so it never
  // reads "all clear" while a stripe is visible. When anything needs attention
  // the notice leads with that; a bare "Displaying N calendars" shows only when
  // nothing does (displayedCount 0 suppresses that count line under warning).
  const conflictCount = $derived(
    unionYearLayout.cells.filter((cell) => cell.inYear && cell.dayClass === 'conflict').length,
  );
  const conflictsElsewhere = $derived(
    conflictCount === 0 &&
      (unionWeekLayout.days.some((day) => day.conflict) ||
        unionStripLayout.cells.some((cell) => cell.conflict)),
  );
  const setNoticeWarn = $derived(
    conflictCount > 0 || conflictsElsewhere || invalidCount > 0 || unresolvedCount > 0,
  );
  const setNotice = $derived(
    form.kind === 'calendar-set'
      ? buildCalendarNotice({
          displayedCount: setNoticeWarn ? 0 : okCount,
          conflictCount,
          conflictYear: previewYear,
          conflictsElsewhere,
          invalidCount,
          flaggedCount: unresolvedCount,
        })
      : null,
  );

  // Live, DST-aware offset for the chosen zone — computed offline via Intl, a
  // hint only; the note always persists the IANA name, never the offset.
  const timezoneOffset = $derived(
    form.timezone.trim() === '' ? null : formatUtcOffset(form.timezone),
  );

  let descriptionEl: HTMLTextAreaElement | undefined;
  $effect(() => {
    if (autofocus) void tick().then(() => descriptionEl?.focus());
  });

  export async function save(): Promise<void> {
    if (!dirty || hasErrors || saving) return;
    saving = true;
    // Snapshot what is being written BEFORE awaiting: edits made during a slow
    // save must not advance the baseline past them, or they would read as clean
    // and be silently lost. `$state.snapshot` is Svelte's way to plain-clone a
    // reactive proxy — `structuredClone` throws on the proxy.
    const snapshot = $state.snapshot(form) as EditorFormState;
    const newName = name.trim();
    try {
      // Frontmatter first (targets the current path), then the rename moves the
      // file — so a frontmatter write never lands on the post-rename path.
      if (isDirty(baseline, snapshot)) await onSave(changedFrontmatter(baseline, snapshot));
      if (newName !== nameBaseline) await onRename?.(newName);
      baseline = snapshot;
      nameBaseline = newName;
      name = newName;
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

  <!-- Sticky header: preview tabs (calendars AND sets) plus an always-visible
       Save and an unsaved-changes cue, so both stay reachable however far the
       form scrolls. A set's tabs render the union of its member calendars. -->
  <div class="og-cal-header">
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
    <div class="og-cal-header-actions">
      {#if dirty}<span class="og-cal-unsaved">Unsaved changes</span>{/if}
      <button
        type="button"
        class="mod-cta"
        disabled={!dirty || hasErrors || saving}
        onclick={save}
      >{saving ? 'Saving…' : 'Save'}</button>
    </div>
  </div>
  {#if hasErrors}
    <span class="og-cal-error og-cal-header-error">Fix the flagged fields before saving.</span>
  {/if}

  <!-- The set-level status line, shown on every tab so the conflict/attention
       state is visible while editing members or reading any preview. Polite
       (role="status"), so live member edits never spam an assertive announce. -->
  {#if form.kind === 'calendar-set' && setNotice !== null}
    <div class="og-cal-status" class:og-cal-status-warn={setNoticeWarn} role="status">{setNotice}</div>
  {/if}

  {#snippet setEmptyState()}
    <p class="og-cal-empty">Add member calendars to preview the set’s combined working time.</p>
  {/snippet}

  {#snippet setLegend()}
    <div class="og-cal-legend">
      <span class="og-cal-legend-key"><i class="og-cal-legend-swatch og-cal-legend-working"></i> Working</span>
      <span class="og-cal-legend-key"><i class="og-cal-legend-swatch og-cal-legend-off"></i> Non-working</span>
      <span class="og-cal-legend-key"><i class="og-cal-legend-swatch og-cal-legend-conflict"></i> Conflict</span>
    </div>
  {/snippet}

  {#if activeTab === 'week'}
    {#if form.kind === 'calendar'}
      <WeekPreview layout={weekLayout} />
    {:else if okCount === 0}
      {@render setEmptyState()}
    {:else}
      <WeekPreview layout={unionWeekLayout} />
      {@render setLegend()}
    {/if}
  {:else if activeTab === 'strip'}
    {#if form.kind === 'calendar'}
      <GanttStripPreview layout={stripLayout} />
    {:else if okCount === 0}
      {@render setEmptyState()}
    {:else}
      <GanttStripPreview layout={unionStripLayout} />
      {@render setLegend()}
    {/if}
  {:else if activeTab === 'year'}
    {#if form.kind === 'calendar'}
      <YearGrid layout={yearLayout} year={previewYear} onYear={stepYear} />
    {:else if okCount === 0}
      {@render setEmptyState()}
    {:else}
      <YearGrid layout={unionYearLayout} year={previewYear} onYear={stepYear} />
    {/if}
  {:else}
  <section class="og-cal-group">
    <h3 class="og-cal-group-title">Identity</h3>

    <label class="og-cal-field">
      <span class="og-cal-label">Name</span>
      <input
        class="og-cal-control"
        type="text"
        bind:value={name}
        placeholder="Calendar name"
        aria-label="Calendar name"
      />
      {#if nameError}<span class="og-cal-error">{nameError}</span>{/if}
    </label>

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

    <div class="og-cal-field">
      <span class="og-cal-label">Colour</span>
      <ColorField bind:value={form.color} />
      {#if errors.color}<span class="og-cal-error">{errors.color}</span>{/if}
    </div>
  </section>

  {#if form.kind === 'calendar'}
    <section class="og-cal-group">
      <h3 class="og-cal-group-title">Working schedule</h3>

      <div class="og-cal-field">
        <span class="og-cal-label">Working pattern</span>
        <WorkingPatternEditor bind:value={form.pattern} />
        {#if errors.pattern}<span class="og-cal-error">{errors.pattern}</span>{/if}
      </div>

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
        <small class="og-cal-hint">
          {#if timezoneOffset}Currently {timezoneOffset} · {/if}Recorded now; honoured once hour-level
          scheduling ships.
        </small>
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
    padding: 0 0 2rem;
  }

  /* Sticky header: pinned to the top of the scrolling editor so the tabs, Save
     and the unsaved cue stay reachable however far the form scrolls. */
  /* The scroll container (Obsidian's .view-content) carries a top padding, and a
     `top: 0` sticky pins to the content box — below that padding — leaving a band
     above the header where scrolled content shows through. Zero the top padding
     so the header pins flush to the scrollport; the heading keeps its own margin
     for spacing. Scoped by both classes to outrank the theme's .view-content. */
  :global(.view-content.og-calendar-editor) {
    padding-top: 0;
  }
  .og-cal-header {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem 0.75rem;
    /* Widen past a focused field's 2px focus ring, which overhangs the field on
       each side: pull the header out with a negative inline margin (into the
       scroller's horizontal padding, so no overflow) and restore the inset with
       matching inline padding, so the ring never peeks past the header edges as
       a field scrolls behind it. */
    margin-inline: -0.25rem;
    padding: 0.5rem 0.25rem;
    background-color: var(--background-primary);
    border-bottom: 1px solid var(--background-modifier-border);
  }
  .og-cal-header-actions {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    /* Keep Save hard right even when there are no tabs (the set editor), where
       space-between would otherwise leave the lone actions group at the left. */
    margin-left: auto;
  }
  /* Warning-style cue (theme colour, no icon) that edits are pending. */
  .og-cal-unsaved {
    padding: 0.15rem 0.5rem;
    font-size: var(--font-ui-smaller, 0.75rem);
    font-weight: 500;
    color: var(--text-warning, var(--color-orange, #d98a00));
    background: color-mix(
      in srgb,
      var(--text-warning, var(--color-orange, #d98a00)) 15%,
      transparent
    );
    border-radius: var(--radius-s, 4px);
  }
  .og-cal-header-error {
    margin-top: -1.25rem;
  }

  .og-cal-tabs {
    display: flex;
    gap: 0.25rem;
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
  /* Date and short-range fields do not need the full line width. */
  .og-cal-narrow {
    inline-size: auto;
    min-inline-size: 9rem;
    max-inline-size: 12rem;
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

  /* The set-status line: a polite status treatment, distinct from the error
     .og-cal-notice. Neutral/muted when it only reports "Displaying N", warning
     colour once anything (conflicts/invalid/unresolved) needs attention. */
  .og-cal-status {
    padding: 0.5rem 0.75rem;
    font-size: var(--font-ui-small, 0.8125rem);
    color: var(--text-muted);
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s, 4px);
  }
  .og-cal-status-warn {
    color: var(--text-warning, var(--color-orange, #d98a00));
    background: color-mix(
      in srgb,
      var(--text-warning, var(--color-orange, #d98a00)) 12%,
      transparent
    );
    border-color: color-mix(
      in srgb,
      var(--text-warning, var(--color-orange, #d98a00)) 35%,
      transparent
    );
  }

  /* Guidance shown for a set with no resolved members, instead of an all-working
     union grid that would masquerade as a real calendar. */
  .og-cal-empty {
    margin: 0;
    font-size: var(--font-ui-small, 0.8125rem);
    color: var(--text-muted);
  }

  /* Always-visible legend for the set previews (the year grid carries its own). */
  .og-cal-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 1rem;
    font-size: var(--font-ui-smaller, 0.75rem);
    color: var(--text-muted);
  }
  .og-cal-legend-key {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .og-cal-legend-swatch {
    inline-size: 0.75rem;
    block-size: 0.75rem;
    border-radius: 2px;
  }
  .og-cal-legend-working {
    background: var(--background-modifier-border);
  }
  .og-cal-legend-off {
    background: color-mix(in srgb, var(--color-red, #d9534f) 55%, var(--background-primary));
  }
  .og-cal-legend-conflict {
    background:
      repeating-linear-gradient(
        -45deg,
        var(--background-modifier-error, #e5534b) 0,
        var(--background-modifier-error, #e5534b) 2px,
        transparent 2px,
        transparent 4px
      ),
      color-mix(in srgb, var(--background-modifier-error, #e5534b) 40%, var(--background-primary));
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
