<script lang="ts">
  /* global HTMLInputElement, KeyboardEvent, MouseEvent, HTMLElement */
  /**
   * Custom inline text editor hosting Obsidian's NATIVE `[[` wikilink suggester.
   *
   * Registered via `registerInlineEditor(OG_TEXT_EDITOR_TYPE, …)` and opened for
   * plain `text`-kind cells AND single-value `suggest` cells (a TaskNotes user
   * field carrying an autosuggest filter). SVAR mounts it with the stock
   * inline-editor contract (`editor` + `onsave`/`onapply`/`oncancel`): the column
   * getter seeds `editor.value` with the cell's RAW markdown (a stored `[[Note]]`
   * seeds verbatim, aliases intact — never the resolved display form), and the
   * view attaches a per-open vault fetcher as `editor.config.fetchSuggestions`
   * (scoped by the field's filter for a suggest cell, unfiltered for plain text).
   *
   * On mount it attaches a {@link WikilinkInputSuggest} over the rendered input:
   * the primitive owns `[[`-token detection, the filtered fetch, native rendering,
   * and the caret splice on pick. This component owns seeding, the commit, and the
   * two arbitration seams against SVAR's editor wrapper:
   *
   * - clickOutside: Obsidian renders the suggestion popover on `document.body`,
   *   topologically OUTSIDE this editor, so the wrapper's `use:clickOutside`
   *   would read a pick's click as an outside commit. A click landing in the
   *   popover is exempted so the pick's `selectSuggestion` runs instead.
   * - keys: while the popover is open Obsidian's suggest scope owns
   *   Arrow/Enter/Escape (move/pick/close). The editor commits on Enter only
   *   once the popover is closed, and never lets SVAR's wrapper cancel the edit
   *   out from under an in-flight pick.
   *
   * Commit rides the existing text path (raw markdown, including any inserted
   * `[[Note]]`, persists verbatim; decorations re-render on the confirming pass).
   */
  import { getContext, onMount } from 'svelte';
  import { clickOutside } from '@svar-ui/lib-dom';
  import type { App } from 'obsidian';
  import type { TextEditorConfig } from './cellEditCommit';
  import { GRID_APP_CONTEXT_KEY } from './gridContext';
  import { WikilinkInputSuggest } from './wikilinkInputSuggest';

  interface Props {
    editor: { value?: unknown; config?: Partial<TextEditorConfig> };
    onsave: (ignoreFocus?: boolean) => void;
    onapply: (value: unknown) => void;
    // SVAR also passes `oncancel` (cancel the whole edit); this editor lets
    // Escape fall through to the grid's own cancel hotkey, so it is not consumed.
    oncancel?: () => void;
  }
  let { editor, onsave, onapply }: Props = $props();

  const config: Partial<TextEditorConfig> = editor?.config ?? {};
  const fetchSuggestions =
    typeof config.fetchSuggestions === 'function' ? config.fetchSuggestions : null;
  const app = getContext<App | undefined>(GRID_APP_CONTEXT_KEY);

  const seeded = typeof editor?.value === 'string' ? editor.value : '';
  let text = $state(seeded);
  let node: HTMLInputElement | undefined = $state();

  // Obsidian renders its suggestion popover as this element on document.body —
  // undocumented popover DOM. Both arbitration seams key off its presence.
  const SUGGESTION_POPOVER_SELECTOR = '.suggestion-container';

  onMount(() => {
    node?.focus();
    node?.select();
    if (app && node && fetchSuggestions) {
      const suggest = new WikilinkInputSuggest(app, node, fetchSuggestions);
      // The popover renders on document.body, outside this subtree; if the grid
      // recycles the cell mid-edit the input's removal may not fire blur, so
      // close it here to avoid a lingering popover and its captured keymap scope.
      return () => suggest.close();
    }
  });

  function isSuggestPopoverOpen(): boolean {
    return document.querySelector(SUGGESTION_POPOVER_SELECTOR) !== null;
  }

  function handleInput(): void {
    // The native suggester mutates the input value directly on a pick and
    // dispatches `input`; read the live value so SVAR's editor mirror stays in
    // sync (the value a Tab-to-next-cell commit saves from).
    text = node?.value ?? text;
    onapply(text);
  }

  function handleKeydown(ev: KeyboardEvent): void {
    // Obsidian's suggest scope handles Arrow/Enter/Escape in the capture phase
    // and marks them handled; once it has, keep SVAR's wrapper from acting on
    // the same key (its Enter cancels the whole edit).
    if (ev.defaultPrevented) {
      ev.stopPropagation();
      return;
    }
    // The popover owns navigation/pick/close while open: don't commit, and don't
    // let Enter reach SVAR's cancel.
    if (isSuggestPopoverOpen()) {
      if (ev.key === 'Enter') ev.stopPropagation();
      return;
    }
    if (ev.key === 'Enter') {
      // No popover: commit the current text like the stock editor. stopPropagation
      // so SVAR's wrapper Enter (which cancels) doesn't also fire.
      ev.stopPropagation();
      onapply(text);
      onsave();
    }
    // Escape with no popover falls through to SVAR's grid cancel.
  }

  function commitFromOutsideClick(event?: MouseEvent): void {
    // A pick's click lands in the popover, which is topologically outside this
    // editor — the wrapper's clickOutside would otherwise commit before the
    // pick's selectSuggestion runs. Treat a click inside the popover as inside
    // the editor (no commit); a genuine elsewhere click commits the current text.
    if (
      event?.target instanceof HTMLElement &&
      event.target.closest(SUGGESTION_POPOVER_SELECTOR)
    ) {
      return;
    }
    onapply(text);
    onsave(true);
  }
</script>

<!-- clickOutside on the WRAPPER: clicks in the input stay inside, a click in the
     native popover is exempted by commitFromOutsideClick (so a mouse pick lands),
     and a genuinely-elsewhere click commits the current text before closing. -->
<div class="og-text-editor" use:clickOutside={commitFromOutsideClick}>
  <input
    bind:this={node}
    bind:value={text}
    class="wx-text"
    spellcheck="false"
    onkeydown={handleKeydown}
    oninput={handleInput}
  />
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
</style>
