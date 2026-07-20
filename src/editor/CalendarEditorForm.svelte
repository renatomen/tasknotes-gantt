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
    isDirty,
    type DatedEntry,
    type EditorFormState,
  } from './calendarEditorState';
  import type { FrontmatterValue } from './frontmatterEdit';

  interface Props {
    initial: EditorFormState;
    onSave: (changes: Record<string, FrontmatterValue>) => Promise<void>;
    /** Attach the vault `[[` suggester to a member input once it mounts. */
    attachMemberSuggest?: (input: HTMLInputElement, index: number) => void;
    /** External change while the form is dirty — the host asks reload-or-keep. */
    externalNotice?: boolean;
    onReload?: () => void;
  }

  const { initial, onSave, attachMemberSuggest, externalNotice = false, onReload }: Props =
    $props();

  let form = $state<EditorFormState>(structuredClone(initial));
  let baseline = $state<EditorFormState>(structuredClone(initial));
  let saving = $state(false);

  const errors = $derived(fieldErrors(form));
  const dirty = $derived(isDirty(baseline, form));
  const hasErrors = $derived(Object.keys(errors).length > 0);

  let descriptionEl: HTMLTextAreaElement | undefined;
  $effect(() => {
    void tick().then(() => descriptionEl?.focus());
  });

  async function save(): Promise<void> {
    if (!dirty || hasErrors || saving) return;
    saving = true;
    try {
      await onSave(changedFrontmatter(baseline, form));
      baseline = structuredClone(form);
    } finally {
      saving = false;
    }
  }

  function reload(): void {
    onReload?.();
  }

  const blankDated = (): DatedEntry => ({ date: '', name: '' });

  /** Svelte action: wire the vault `[[` suggester onto a member input. */
  function memberSuggest(node: HTMLInputElement, index: number): void {
    attachMemberSuggest?.(node, index);
  }
</script>

<div class="og-cal-form">
  {#if externalNotice}
    <div class="og-cal-form-notice" role="alert">
      <span>This note changed on disk while you were editing.</span>
      <button type="button" onclick={reload}>Reload &amp; discard my changes</button>
    </div>
  {/if}

  <label class="og-cal-field">
    <span class="og-cal-label">Description</span>
    <textarea
      bind:this={descriptionEl}
      bind:value={form.description}
      rows="2"
      placeholder="What this calendar represents"
    ></textarea>
  </label>

  <label class="og-cal-field">
    <span class="og-cal-label">Colour</span>
    <span class="og-cal-color-row">
      <span class="og-cal-swatch" style="background:{errors.color ? 'transparent' : form.color}"
      ></span>
      <input type="text" bind:value={form.color} placeholder="#2a9d8f" />
    </span>
    {#if errors.color}<span class="og-cal-error">{errors.color}</span>{/if}
  </label>

  {#if form.kind === 'calendar'}
    <label class="og-cal-field">
      <span class="og-cal-label">Working pattern (RRULE)</span>
      <input type="text" bind:value={form.pattern} placeholder="FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" />
      {#if errors.pattern}<span class="og-cal-error">{errors.pattern}</span>{/if}
    </label>

    <label class="og-cal-field">
      <span class="og-cal-label">Pattern start (anchor)</span>
      <input type="date" bind:value={form.patternStart} />
      {#if errors.patternStart}<span class="og-cal-error">{errors.patternStart}</span>{/if}
    </label>

    <fieldset class="og-cal-field">
      <legend class="og-cal-label">Working hours</legend>
      {#each form.workingHours as _hours, i (i)}
        <span class="og-cal-list-row">
          <input type="text" bind:value={form.workingHours[i]} placeholder="09:00-17:00" />
          <button type="button" onclick={() => form.workingHours.splice(i, 1)}>Remove</button>
        </span>
      {/each}
      <button type="button" onclick={() => form.workingHours.push('09:00-17:00')}>Add hours</button>
      {#if errors.workingHours}<span class="og-cal-error">{errors.workingHours}</span>{/if}
    </fieldset>

    <label class="og-cal-field">
      <span class="og-cal-label">Timezone</span>
      <input type="text" bind:value={form.timezone} placeholder="Pacific/Auckland" />
      <small class="og-cal-hint">Authored now; honoured when hour granularity lands.</small>
      {#if errors.timezone}<span class="og-cal-error">{errors.timezone}</span>{/if}
    </label>

    {#each [{ key: 'nonWorking', label: 'Non-working days' }, { key: 'events', label: 'Events' }] as list (list.key)}
      <fieldset class="og-cal-field">
        <legend class="og-cal-label">{list.label}</legend>
        {#each form[list.key as 'nonWorking' | 'events'] as entry, i (i)}
          {#if entry.raw === undefined}
            <span class="og-cal-list-row">
              <input type="date" bind:value={entry.date} />
              <input type="text" bind:value={entry.name} placeholder="Name (optional)" />
              {#if list.key === 'events'}
                <label class="og-cal-check">
                  <input type="checkbox" bind:checked={entry.marker} /> Marker
                </label>
              {/if}
              <button
                type="button"
                onclick={() => form[list.key as 'nonWorking' | 'events'].splice(i, 1)}
              >Remove</button>
            </span>
          {:else}
            <span class="og-cal-list-row og-cal-readonly">Advanced entry — edit as markdown</span>
          {/if}
        {/each}
        <button
          type="button"
          onclick={() => form[list.key as 'nonWorking' | 'events'].push(blankDated())}
        >Add {list.label.toLowerCase()}</button>
      </fieldset>
    {/each}
  {:else}
    <fieldset class="og-cal-field">
      <legend class="og-cal-label">Member calendars</legend>
      {#each form.members as _member, i (i)}
        <span class="og-cal-list-row">
          <input
            type="text"
            bind:value={form.members[i]}
            placeholder="[[Calendar note]]"
            use:memberSuggest={i}
          />
          <button type="button" onclick={() => form.members.splice(i, 1)}>Remove</button>
        </span>
      {/each}
      <button type="button" onclick={() => form.members.push('')}>Add member</button>
    </fieldset>
  {/if}

  <div class="og-cal-form-actions">
    <button type="button" class="mod-cta" disabled={!dirty || hasErrors || saving} onclick={save}>
      {saving ? 'Saving…' : 'Save'}
    </button>
    {#if hasErrors}<span class="og-cal-error">Fix the flagged fields before saving.</span>{/if}
  </div>
</div>
