<script lang="ts">
  /* global HTMLInputElement, KeyboardEvent, setTimeout, clearTimeout */
  /**
   * Custom inline autosuggest editor (typed input + TaskNotes-served
   * suggestions in a SVAR Dropdown).
   *
   * Registered with SVAR's grid via `registerInlineEditor(OG_SUGGEST_EDITOR_TYPE, …)`
   * (see {@link ./inlineEditors}); SVAR mounts it with the stock inline-editor
   * contract (`editor` + `onsave`/`onapply`/`oncancel`), and the column's
   * editor config carries a {@link SuggestEditorConfig}: the suggest channel
   * (filter + column id + list shape) plus the view-wired callbacks.
   *
   * States:
   * - `fetchSuggestions` absent → DEGRADED: a "suggestions unavailable" hint,
   *   free-text commits only (TaskNotes 4.11.0 exposes no reachable suggester).
   * - loading → a "Searching…" row while a debounced (~150 ms) fetch runs.
   * - no matches → a "No matches" row; typed text still commits.
   * - results → pick with click or ArrowUp/Down + Enter (ArrowUp above the
   *   first row clears the highlight so a plain Enter commits the typed text).
   *
   * Commit semantics:
   * - Single-value column: a pick applies `[[link text]]`, typed Enter applies
   *   the raw text — both save through the grid bridge (text semantics
   *   downstream). An empty typed Enter applies `''` (the "clear" commit).
   * - LIST-shaped column (`isList`): every commit routes through
   *   `commitListEntry` (the view's direct append path — the bridge's
   *   display-form diffing cannot represent wikilink lists) and the editor
   *   closes via `oncancel` WITHOUT applying, so nothing rides the bridge. The
   *   input starts empty: the editor appends an entry, it does not re-edit the
   *   joined list.
   * - Escape → SVAR's grid hotkey cancels; a click elsewhere `onsave(true)`s,
   *   which re-commits the seeded value — a noop downstream.
   */
  import { onMount } from 'svelte';
  import { clickOutside } from '@svar-ui/lib-dom';
  import { Dropdown } from '@svar-ui/svelte-core';
  import type { SuggestEditorConfig } from './cellEditCommit';
  import { wikilinkEntry, type TaskNotesSuggestion } from './taskNotesSuggest';

  interface Props {
    editor: { value?: unknown; config?: Partial<SuggestEditorConfig> };
    onsave: (ignoreFocus?: boolean) => void;
    onapply: (value: unknown) => void;
    oncancel: () => void;
  }
  let { editor, onsave, onapply, oncancel }: Props = $props();

  const config: Partial<SuggestEditorConfig> = editor?.config ?? {};
  const isList = config.isList === true;
  const fetchSuggestions =
    typeof config.fetchSuggestions === 'function' ? config.fetchSuggestions : null;
  const degraded = !fetchSuggestions;

  const seeded = typeof editor?.value === 'string' ? editor.value : '';
  let text = $state(isList ? '' : seeded);
  let items = $state<TaskNotesSuggestion[]>([]);
  let loading = $state(false);
  let searched = $state(false);
  let active = $state(-1);
  let node: HTMLInputElement | undefined = $state();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let fetchSeq = 0;

  const DEBOUNCE_MS = 150;

  onMount(() => {
    node?.focus();
    if (!isList) node?.select();
    scheduleFetch();
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      // Orphan any in-flight fetch so a late resolve can't touch torn-down state.
      fetchSeq += 1;
    };
  });

  function scheduleFetch(): void {
    if (!fetchSuggestions) return;
    loading = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void runFetch();
    }, DEBOUNCE_MS);
  }

  async function runFetch(): Promise<void> {
    if (!fetchSuggestions) return;
    const seq = ++fetchSeq;
    const results = await fetchSuggestions(text.trim());
    if (seq !== fetchSeq) return;
    items = results;
    loading = false;
    searched = true;
    active = results.length > 0 ? 0 : -1;
  }

  function commitEntry(entry: string): void {
    if (isList) {
      // Direct path: the view appends + persists; nothing may ride the bridge.
      config.commitListEntry?.(entry);
      oncancel();
      return;
    }
    onapply(entry);
    onsave();
  }

  function pick(item: TaskNotesSuggestion): void {
    commitEntry(wikilinkEntry(item.value));
  }

  function moveActive(delta: number): void {
    if (items.length === 0) return;
    // -1 (no highlight) is reachable above the first row: a plain Enter then
    // commits the typed text instead of force-picking a suggestion.
    active = Math.min(items.length - 1, Math.max(-1, active + delta));
  }

  function handleKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      if (items.length > 0) {
        moveActive(ev.key === 'ArrowDown' ? 1 : -1);
        ev.preventDefault();
        ev.stopPropagation();
      }
      return;
    }
    if (ev.key !== 'Enter') return;
    const chosen = active >= 0 ? items[active] : undefined;
    if (chosen) {
      pick(chosen);
      return;
    }
    const trimmed = text.trim();
    if (isList) {
      if (trimmed === '') {
        oncancel();
        return;
      }
      commitEntry(trimmed);
      return;
    }
    // Single-value free text (or the '' clear) rides the bridge like the stock
    // text editor.
    onapply(trimmed);
    onsave();
  }

  function handleInput(): void {
    active = -1;
    searched = false;
    scheduleFetch();
  }
</script>

<!-- clickOutside on the WRAPPER, exactly like DateCellEditor: clicks in the
     input stay inside, clicks in the portal'd dropdown are exempted by
     lib-dom's nested-listener check, and only a genuinely-elsewhere click
     closes the editor (an untouched save resolves to a noop downstream). -->
<div class="og-suggest-editor" use:clickOutside={() => onsave(true)}>
  <input
    bind:this={node}
    bind:value={text}
    class="wx-text"
    spellcheck="false"
    placeholder={isList ? 'Add entry…' : ''}
    onkeydown={handleKeydown}
    oninput={handleInput}
  />
  <Dropdown trackScroll={true} width="auto" {oncancel}>
    <div class="og-suggest-panel">
      {#if degraded}
        <div class="og-suggest-hint og-suggest-degraded">
          Suggestions unavailable — press Enter to save the typed text.
        </div>
      {:else if loading}
        <div class="og-suggest-hint og-suggest-loading">Searching…</div>
      {:else if items.length === 0}
        {#if searched}
          <div class="og-suggest-hint og-suggest-empty">No matches — Enter saves the typed text.</div>
        {/if}
      {:else}
        {#each items as item, index (item.value)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="og-suggest-item"
            class:og-suggest-active={index === active}
            onclick={() => pick(item)}
            onmousemove={() => (active = index)}
          >
            {item.display}
          </div>
        {/each}
      {/if}
    </div>
  </Dropdown>
</div>

<style>
  .og-suggest-editor {
    width: 100%;
    height: 100%;
  }
  .og-suggest-editor input.wx-text {
    width: 100%;
    height: 100%;
    border: 1px solid var(--wx-color-primary);
    outline: none;
    padding-left: 8px;
    font: inherit;
    background: var(--wx-background);
    color: var(--wx-color-font);
  }
  /* The Dropdown portals the panel out of this subtree, so no descendant
     selectors off .og-suggest-editor — these nodes are authored here, and
     Svelte's attribute scoping travels with them into the portal. */
  .og-suggest-panel {
    max-height: 250px;
    min-width: 180px;
    overflow-y: auto;
  }
  .og-suggest-item {
    padding: var(--wx-input-padding, 6px 8px);
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .og-suggest-item.og-suggest-active {
    background: var(--wx-background-hover);
  }
  .og-suggest-hint {
    padding: var(--wx-input-padding, 6px 8px);
    color: var(--wx-color-font-alt, var(--wx-color-font));
    font-style: italic;
  }
</style>
