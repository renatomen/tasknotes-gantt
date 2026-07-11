<script lang="ts">
  /* global HTMLInputElement, KeyboardEvent, MouseEvent, HTMLElement */
  /**
   * Inline chips editor for LIST-shaped user fields (list-kind and list-shaped
   * suggest). Existing items render as removable chips seeded from the note's RAW
   * frontmatter list (so untouched links round-trip byte-identically), and an
   * add-input hosts the native `[[` suggester for adding link or plain items.
   *
   * Registered via `registerInlineEditor(OG_CHIPS_EDITOR_TYPE, …)`. SVAR mounts it
   * with the stock inline-editor contract; the view attaches `seed` (raw list),
   * `fetchSuggestions` (the add-input's scoped vault fetcher), and `commitList`
   * (the single whole-list direct-path write) to `editor.config` per open.
   *
   * Lifecycle: the whole edit persists once — an outside-click composes the final
   * ordered raw `string[]` and calls `commitList` a single time (never the grid
   * bridge, which can't represent a wikilink list). Enter in the add-input only
   * pushes a chip; a native pick pushes a `[[Note]]` chip via the suggester's
   * `onSelect`; Backspace on an empty input removes the last chip; Escape falls
   * through to SVAR's grid cancel, discarding the in-session adds/removes.
   */
  import { getContext, onMount } from 'svelte';
  import { clickOutside } from '@svar-ui/lib-dom';
  import type { App } from 'obsidian';
  import type { ChipsEditorConfig } from './cellEditCommit';
  import { GRID_APP_CONTEXT_KEY } from './gridContext';
  import { WikilinkInputSuggest } from './wikilinkInputSuggest';
  import {
    chipFromRawEntry,
    chipsContainEntry,
    chipsFromStoredList,
    rawListFromChips,
    type ListChip,
  } from './listChips';

  interface Props {
    editor: { value?: unknown; config?: Partial<ChipsEditorConfig> };
    // SVAR also passes `onsave`/`onapply` (commit through the bridge); the chips
    // path never rides the bridge — it writes the whole array via `commitList`
    // and closes through `oncancel` (the append-editor precedent), so the bridge
    // callbacks are intentionally unused.
    onsave?: (ignoreFocus?: boolean) => void;
    onapply?: (value: unknown) => void;
    oncancel: () => void;
  }
  let { editor, oncancel }: Props = $props();

  const config: Partial<ChipsEditorConfig> = editor?.config ?? {};
  const fetchSuggestions =
    typeof config.fetchSuggestions === 'function' ? config.fetchSuggestions : null;
  const commitList = typeof config.commitList === 'function' ? config.commitList : null;
  const app = getContext<App | undefined>(GRID_APP_CONTEXT_KEY);

  // Obsidian renders its suggestion popover on document.body — both arbitration
  // seams (clickOutside exemption, key handling) key off its presence.
  const SUGGESTION_POPOVER_SELECTOR = '.suggestion-container';

  let chips = $state<ListChip[]>(chipsFromStoredList(config.seed ?? []));
  let draft = $state('');
  let node: HTMLInputElement | undefined = $state();
  // Single-flight: an outside click can fire alongside blur; commit at most once.
  let committed = false;

  onMount(() => {
    node?.focus();
    if (app && node && fetchSuggestions) {
      const suggest = new WikilinkInputSuggest(app, node, fetchSuggestions, pushRawChip);
      return () => suggest.close();
    }
  });

  function isSuggestPopoverOpen(): boolean {
    return document.querySelector(SUGGESTION_POPOVER_SELECTOR) !== null;
  }

  function pushRawChip(rawEntry: string): void {
    const raw = rawEntry.trim();
    // Ignore an empty add or a duplicate (exact or a wikilink to the same note),
    // matching the shipped append path's dedupe — clear the input either way.
    if (raw !== '' && !chipsContainEntry(chips, raw)) {
      chips = [...chips, chipFromRawEntry(raw)];
    }
    draft = '';
    if (node) node.value = '';
    node?.focus();
  }

  function removeChip(index: number): void {
    chips = chips.filter((_, i) => i !== index);
    node?.focus();
  }

  function commit(): void {
    if (committed) return;
    committed = true;
    // Fold any un-pushed draft into the list, then persist the whole raw array
    // once through the direct path and close via oncancel — never the bridge,
    // which can't represent a wikilink list (append-editor precedent).
    const pending = draft.trim();
    const finalChips = pending === '' ? chips : [...chips, chipFromRawEntry(pending)];
    commitList?.(rawListFromChips(finalChips));
    oncancel();
  }

  function stopRowDragArming(ev: MouseEvent): void {
    // SVAR's row-reorder helper arms on a bubbling row mousedown; capture-stop it
    // so a text-selection drag in the add-input stays a selection. Must be capture
    // phase — Svelte delegates bubble mousedown to the app root, after SVAR's own.
    ev.stopPropagation();
  }

  function handleKeydown(ev: KeyboardEvent): void {
    // The native suggest scope owns Arrow/Enter/Escape while open (capture phase);
    // once it marks a key handled, keep SVAR's wrapper from acting on it.
    if (ev.defaultPrevented) {
      ev.stopPropagation();
      return;
    }
    if (ev.key === 'Tab') {
      // Tab/Shift+Tab would reach SVAR's grid hotkey, which closes this editor via
      // the bridge and commits the stale seed — discarding chip edits and writing a
      // list-suggest cell back as scalar text. Commit the chips directly and consume
      // the key so the bridge never fires (the edit stays; focus does not advance).
      ev.stopPropagation();
      ev.preventDefault();
      commit();
      return;
    }
    if (isSuggestPopoverOpen()) {
      if (ev.key === 'Enter') ev.stopPropagation();
      return;
    }
    if (ev.key === 'Enter') {
      // Enter pushes the typed text as a chip; it does NOT commit the session.
      ev.stopPropagation();
      if (draft.trim() !== '') pushRawChip(draft);
      return;
    }
    if (ev.key === 'Backspace' && draft === '' && chips.length > 0) {
      // Quick edit: Backspace on an empty add-input removes the last chip.
      removeChip(chips.length - 1);
    }
    // Escape with no popover falls through to SVAR's grid cancel (no write).
  }

  function handleInput(): void {
    draft = node?.value ?? draft;
  }

  function commitFromOutsideClick(event?: MouseEvent): void {
    // A pick's click lands in the popover, topologically outside this editor —
    // treat it as inside (no commit) so the pick runs; a genuine elsewhere click
    // commits the whole list.
    if (
      event?.target instanceof HTMLElement &&
      event.target.closest(SUGGESTION_POPOVER_SELECTOR)
    ) {
      return;
    }
    commit();
  }
</script>

<!-- clickOutside on the WRAPPER: clicks on chips/input stay inside, a click in the
     native popover is exempted (so a pick lands), and a genuinely-elsewhere click
     commits the whole raw list once before closing. -->
<div class="og-chips-editor" use:clickOutside={commitFromOutsideClick}>
  <div class="og-chips-row">
    {#each chips as chip, index (index)}
      <span class="og-chip" class:og-chip-link={chip.isLink} title={chip.display}>
        <span class="og-chip-label">{chip.display}</span>
        <button
          type="button"
          class="og-chip-remove"
          aria-label={`Remove ${chip.display}`}
          onclick={() => removeChip(index)}
        >×</button>
      </span>
    {/each}
    <input
      bind:this={node}
      bind:value={draft}
      class="og-chip-input"
      spellcheck="false"
      placeholder={chips.length === 0 ? 'Add entry…' : ''}
      onkeydown={handleKeydown}
      oninput={handleInput}
      onmousedowncapture={stopRowDragArming}
    />
  </div>
</div>

<style>
  .og-chips-editor {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    box-sizing: border-box;
    border: 1px solid var(--wx-color-primary);
    background: var(--wx-background);
    padding: 0 4px;
    overflow: hidden;
  }
  .og-chips-row {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    gap: 4px;
    width: 100%;
    overflow-x: auto;
  }
  .og-chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex: 0 0 auto;
    padding: 1px 4px 1px 6px;
    border-radius: 10px;
    background: var(--background-modifier-hover, rgba(127, 127, 127, 0.15));
    color: var(--wx-color-font);
    font: inherit;
    line-height: 1.4;
  }
  .og-chip-link {
    color: var(--link-color, var(--wx-color-primary));
  }
  /* Full labels, never truncated — chip names stay legible for scanning; the row
     scrolls horizontally when they overflow the cell. */
  .og-chip-label {
    white-space: nowrap;
  }
  .og-chip-remove {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    padding: 0;
    border: none;
    background: transparent;
    color: currentColor;
    opacity: 0.6;
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
  }
  .og-chip-remove:hover {
    opacity: 1;
  }
  .og-chip-input {
    flex: 1 1 60px;
    min-width: 60px;
    border: none;
    outline: none;
    padding: 2px;
    font: inherit;
    background: transparent;
    color: var(--wx-color-font);
  }
</style>
