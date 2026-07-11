<script lang="ts">
  /* global HTMLInputElement, KeyboardEvent */
  /**
   * Custom inline text editor with Obsidian-native `[[` wikilink autosuggest.
   *
   * A variant of {@link ./SuggestCellEditor.svelte}: same inline-editor contract
   * (`editor` + `onsave`/`onapply`/`oncancel`), same SVAR `Dropdown` +
   * `use:clickOutside` wrapper (a mouse pick in the portal'd dropdown is exempted
   * by lib-dom's nested-listener check, so it lands instead of being lost to the
   * editor's clickOutside → commit). Registered via
   * `registerInlineEditor(OG_TEXT_EDITOR_TYPE, …)` and opened for `text`-kind
   * cells in place of the stock text input.
   *
   * The difference from the suggest editor: the dropdown opens ONLY while the
   * caret sits inside an open `[[…` token (the suggest editor queries the whole
   * value). Each keystroke runs the pure token detector; a token feeds its query
   * to the per-open vault fetcher and a pick splices `[[Note]]` into the bound
   * `text` at the token bounds. This source is always reachable (the vault), so
   * there is no degraded/loading state — only matches / no-matches.
   *
   * Key arbitration:
   * - Dropdown OPEN: ArrowUp/Down move the highlight; Enter picks the highlighted
   *   suggestion (does not commit the cell); Escape closes the dropdown only —
   *   all with `stopPropagation` so the grid never sees them.
   * - Dropdown CLOSED: Enter commits the current text through the grid bridge;
   *   Escape falls through to SVAR's grid cancel.
   *
   * Commit rides the existing text path (raw markdown, including any inserted
   * `[[Note]]`, persists verbatim; decorations re-render on the confirming pass).
   */
  import { onMount, tick } from 'svelte';
  import { clickOutside } from '@svar-ui/lib-dom';
  import { Dropdown } from '@svar-ui/svelte-core';
  import type { TextEditorConfig } from './cellEditCommit';
  import { detectWikilinkToken, spliceWikilink } from './wikilinkToken';
  import { wikilinkEntry, type TaskNotesSuggestion } from './taskNotesSuggest';

  interface Props {
    editor: { value?: unknown; config?: Partial<TextEditorConfig> };
    onsave: (ignoreFocus?: boolean) => void;
    onapply: (value: unknown) => void;
    // SVAR also passes `oncancel` (cancel the whole edit); this editor closes its
    // dropdown independently and lets Escape fall through to the grid's own
    // cancel hotkey, so it is intentionally not consumed here.
    oncancel?: () => void;
  }
  let { editor, onsave, onapply }: Props = $props();

  const config: Partial<TextEditorConfig> = editor?.config ?? {};
  const fetchSuggestions =
    typeof config.fetchSuggestions === 'function' ? config.fetchSuggestions : null;

  const seeded = typeof editor?.value === 'string' ? editor.value : '';
  let text = $state(seeded);
  let items = $state<TaskNotesSuggestion[]>([]);
  let searched = $state(false);
  let open = $state(false);
  let active = $state(-1);
  let node: HTMLInputElement | undefined = $state();
  let tokenBounds: { start: number; end: number } | null = null;
  let fetchSeq = 0;

  onMount(() => {
    node?.focus();
    node?.select();
    return () => {
      // Orphan any in-flight fetch so a late resolve can't touch torn-down state.
      fetchSeq += 1;
    };
  });

  function closeDropdown(): void {
    open = false;
    items = [];
    searched = false;
    active = -1;
    tokenBounds = null;
    // Orphan any in-flight fetch so a late resolve can't reopen the dropdown.
    fetchSeq += 1;
  }

  async function refreshFromCaret(): Promise<void> {
    if (!fetchSuggestions) {
      closeDropdown();
      return;
    }
    const caret = node?.selectionStart ?? text.length;
    const token = detectWikilinkToken(text, caret);
    if (!token) {
      closeDropdown();
      return;
    }
    tokenBounds = { start: token.start, end: token.end };
    const seq = ++fetchSeq;
    const results = await fetchSuggestions(token.query);
    if (seq !== fetchSeq) return;
    items = results;
    searched = true;
    active = results.length > 0 ? 0 : -1;
    open = true;
  }

  async function pick(item: TaskNotesSuggestion): Promise<void> {
    if (!tokenBounds) return;
    // The fetcher's `value` is already the fileToLinktext form, so the insert is
    // `[[` + value + `]]` (wikilinkEntry) — spliced at the token bounds so the
    // surrounding text is preserved.
    const spliced = spliceWikilink(text, tokenBounds, wikilinkEntry(item.value));
    text = spliced.value;
    closeDropdown();
    // Restore focus + caret after the input re-renders from the new `text`.
    await tick();
    node?.focus();
    node?.setSelectionRange(spliced.caret, spliced.caret);
  }

  function moveActive(delta: number): void {
    if (items.length === 0) return;
    active = Math.min(items.length - 1, Math.max(0, active + delta));
  }

  function handleKeydown(ev: KeyboardEvent): void {
    if (open) {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        moveActive(ev.key === 'ArrowDown' ? 1 : -1);
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
      if (ev.key === 'Enter') {
        // Pick the highlighted suggestion; never commit the cell while open.
        ev.preventDefault();
        ev.stopPropagation();
        const chosen = active >= 0 ? items[active] : undefined;
        if (chosen) void pick(chosen);
        return;
      }
      if (ev.key === 'Escape') {
        // Close the dropdown only — keep the edit open (don't let the grid cancel).
        ev.stopPropagation();
        closeDropdown();
        return;
      }
      return;
    }
    if (ev.key === 'Enter') {
      // No dropdown: commit the current text like the stock text editor. onsave
      // is the authoritative commit trigger; stop the event so the grid's own
      // Enter handler doesn't also process it.
      ev.stopPropagation();
      onapply(text);
      onsave();
    }
    // Escape (no dropdown) falls through to SVAR's grid cancel.
  }

  function handleInput(): void {
    void refreshFromCaret();
  }

  // Caret moves that fire no `input` (arrows, Home/End, a click inside the cell)
  // must re-sync the token state — otherwise the dropdown stays open after the
  // caret leaves the `[[…` span and Enter would force-pick instead of commit.
  const CARET_KEYS = new Set([
    'ArrowLeft',
    'ArrowRight',
    'Home',
    'End',
    'PageUp',
    'PageDown',
  ]);

  function handleKeyup(ev: KeyboardEvent): void {
    if (CARET_KEYS.has(ev.key)) void refreshFromCaret();
  }

  function handleClick(): void {
    void refreshFromCaret();
  }
</script>

<!-- clickOutside on the WRAPPER, exactly like SuggestCellEditor/DateCellEditor:
     clicks in the input stay inside, clicks in the portal'd dropdown are
     exempted by lib-dom's nested-listener check (so a mouse pick lands), and
     only a genuinely-elsewhere click closes the editor (a noop downstream). -->
<div class="og-text-editor" use:clickOutside={() => onsave(true)}>
  <input
    bind:this={node}
    bind:value={text}
    class="wx-text"
    spellcheck="false"
    onkeydown={handleKeydown}
    onkeyup={handleKeyup}
    onclick={handleClick}
    oninput={handleInput}
  />
  {#if open}
    <!-- oncancel closes the dropdown (scroll / click outside the popup) without
         cancelling the edit — a genuine outside click still commits via the
         wrapper's clickOutside above. -->
    <Dropdown trackScroll={true} width="auto" oncancel={closeDropdown}>
      <div class="og-suggest-panel">
        {#if items.length === 0}
          {#if searched}
            <div class="og-suggest-hint og-suggest-empty">No matching notes.</div>
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
  {/if}
</div>

<style>
  .og-text-editor {
    width: 100%;
    height: 100%;
  }
  .og-text-editor input.wx-text {
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
     selectors off .og-text-editor — these nodes are authored here, and Svelte's
     attribute scoping travels with them into the portal. */
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
