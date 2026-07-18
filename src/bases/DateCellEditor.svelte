<script lang="ts">
  /* global HTMLInputElement, KeyboardEvent, MouseEvent */
  /**
   * Custom inline date editor (locale-aware typed input + SVAR Calendar).
   *
   * Registered with SVAR's grid via `registerInlineEditor(OG_DATE_EDITOR_TYPE, …)`
   * (see {@link ./inlineEditors}); SVAR mounts it with the stock inline-editor
   * contract — `editor` (the grid store's editor state: `value` seeded from the
   * column getter, `config` from the column's editor config) plus the
   * `onsave`/`onapply`/`oncancel` actions. SVAR's own datepicker is pick-only
   * (its value element swallows keydown), so this editor adds what it can't:
   * typing a date in the user's regional format.
   *
   * Commit semantics:
   * - Enter with conforming text → apply the parsed `Date` and save (the grid
   *   commits it through update-cell; Dates survive the bridge's coercion).
   * - Enter with an empty input → apply `''` and save (the "clear" commit).
   * - Enter with NON-conforming text → the editor STAYS OPEN, marked invalid;
   *   nothing is applied or committed (the deliberate UX: silently cancelling
   *   would discard a typo the user can still fix; the event must not bubble,
   *   or SVAR's editor wrapper would cancel-close on it).
   * - Picking a calendar day (or its today/clear buttons) → apply and save.
   * - Escape → SVAR's grid hotkey cancels; a click elsewhere closes via the
   *   popup-cancel/save-last-applied paths — an untouched editor re-commits the
   *   seeded Date, which resolves to a noop downstream.
   *
   * The display locale arrives via `editor.config.locale` (threaded from the
   * assembly pass's snapshot through `svarEditorConfigFor`); formatting and
   * strict parsing share it (see {@link ./dateEditParse}).
   */
  import { onMount } from 'svelte';
  import { clickOutside } from '@svar-ui/lib-dom';
  import { Calendar, Dropdown } from '@svar-ui/svelte-core';
  import { formatDateForLocale } from './dateLocale';
  import { parseDateForLocale } from './dateEditParse';

  interface Props {
    editor: { value?: unknown; config?: { locale?: string } };
    onsave: (ignoreFocus?: boolean) => void;
    onapply: (value: unknown) => void;
    oncancel: () => void;
  }
  let { editor, onsave, onapply, oncancel }: Props = $props();

  const locale: string = typeof editor?.config?.locale === 'string' ? editor.config.locale : '';
  const seeded: Date | undefined = editor?.value instanceof Date ? editor.value : undefined;

  let text = $state(seeded ? formatDateForLocale(seeded, locale) : '');
  let invalid = $state(false);
  let node: HTMLInputElement | undefined = $state();

  onMount(() => {
    node?.focus();
    node?.select();
  });

  function commitTyped(ev: KeyboardEvent): void {
    if (ev.key !== 'Enter') return;
    const trimmed = text.trim();
    if (trimmed === '') {
      onapply('');
      onsave();
      return;
    }
    const parsed = parseDateForLocale(trimmed, locale);
    if (!parsed) {
      invalid = true;
      // Keep the editor open to fix the typo; without this the keydown bubbles
      // to SVAR's editor wrapper, whose Enter handler cancel-closes.
      ev.stopPropagation();
      return;
    }
    onapply(parsed);
    onsave();
  }

  function pickDate({ value }: { value?: unknown }): void {
    onapply(value instanceof Date ? value : '');
    onsave();
  }

  function stopRowDragArming(ev: MouseEvent): void {
    // A selection drag inside the input must stay a text selection — SVAR's
    // row-reorder helper arms on any bubbling row mousedown.
    ev.stopPropagation();
  }
</script>

<!-- clickOutside lives on the WRAPPER (not the calendar div): clicks in the
     input stay inside it, clicks in the portal'd calendar popup are exempted by
     lib-dom's nested-listener check (the popup registers this wrapper as its
     parent), and only a genuinely-elsewhere click closes the editor. -->
<div class="og-date-editor" use:clickOutside={() => onsave(true)}>
  <input
    bind:this={node}
    bind:value={text}
    class="wx-text"
    class:og-date-invalid={invalid}
    spellcheck="false"
    onkeydown={commitTyped}
    oninput={() => (invalid = false)}
    onmousedowncapture={stopRowDragArming}
  />
  <Dropdown trackScroll={true} width="auto" {oncancel}>
    <div class="og-date-calendar">
      <Calendar value={seeded} onchange={pickDate} />
    </div>
  </Dropdown>
</div>

<style>
  .og-date-editor {
    width: 100%;
    height: 100%;
  }
  .og-date-editor input.wx-text {
    width: 100%;
    height: 100%;
    border: 1px solid var(--wx-color-primary);
    outline: none;
    padding-left: 8px;
    font: inherit;
    background: var(--wx-background);
    color: var(--wx-color-font);
  }
  .og-date-editor input.og-date-invalid {
    border-color: var(--text-error, #e93147);
  }
  /* The calendar's month pagers are wxi-* glyphs from SVAR's icon webfont,
     which the plugin disables (fonts={false}); re-implement the two arrows as
     inline SVGs like GanttContainer does for its wx icons. :global because the
     Dropdown portals this subtree out of the component's scope. */
  .og-date-calendar :global(.wx-pager) {
    width: 24px;
    height: 24px;
    background-size: 16px 16px;
    background-repeat: no-repeat;
    background-position: center;
    cursor: pointer;
  }
  .og-date-calendar :global(.wxi-angle-left) {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m15 18-6-6 6-6'/%3E%3C/svg%3E");
  }
  .og-date-calendar :global(.wxi-angle-right) {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m9 18 6-6-6-6'/%3E%3C/svg%3E");
  }
</style>
