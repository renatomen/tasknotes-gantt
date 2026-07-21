<script lang="ts">
  /**
   * The calendar colour field: a disclosure that rests collapsed — swatch, value
   * and a live bar preview — and unfolds on demand to a searchable CSS3-name list
   * plus a native hex picker. Colour is rarely changed, so the controls stay out
   * of the way until asked for. The value is a CSS3 keyword (lossless to the
   * iCalendar COLOR property) or a hex; both paint directly, so no resolver.
   */
  /* global HTMLInputElement, HTMLElement, MouseEvent, KeyboardEvent, Event, Node */
  import { tick } from 'svelte';
  import { filterCss3Colors, hexForCss3Name, isHexColor } from '../bases/css3Colors';

  interface Props {
    /** The stored colour — a CSS3 keyword, a hex, or '' for the theme default. */
    value: string;
  }
  let { value = $bindable() }: Props = $props();

  let expanded = $state(false);
  let query = $state('');
  let searchEl: HTMLInputElement | undefined;

  const matches = $derived(filterCss3Colors(query));
  const isEmpty = $derived(value.trim() === '');
  // A keyword or hex is itself a valid CSS colour, so the preview uses it as-is.
  const previewCss = $derived(isEmpty ? 'transparent' : value.trim());
  // The native picker only takes #rrggbb, so map a keyword to its hex and fall
  // back for shorthand/alpha hexes it would reject.
  const pickerHex = $derived(
    hexForCss3Name(value) ?? (/^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : '#4682b4'),
  );

  function open(): void {
    expanded = true;
    query = '';
    void tick().then(() => searchEl?.focus());
  }
  function close(): void {
    expanded = false;
  }

  function pick(name: string): void {
    value = name;
    close();
  }
  function onHexInput(event: Event): void {
    value = (event.currentTarget as HTMLInputElement).value;
    close();
  }
  function clear(): void {
    value = '';
    close();
  }

  function onSearchKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      close();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const typed = query.trim().toLowerCase();
      if (isHexColor(typed) || hexForCss3Name(typed)) pick(typed);
      else if (matches.length > 0) pick(matches[0]!.name);
    }
  }

  /** Close when a pointer lands outside the whole control. */
  function clickOutside(node: HTMLElement) {
    const onDown = (event: MouseEvent) => {
      if (!node.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', onDown, true);
    return {
      destroy() {
        document.removeEventListener('pointerdown', onDown, true);
      },
    };
  }
</script>

<div class="og-color" use:clickOutside>
  <button
    type="button"
    class="og-color-summary"
    class:og-color-open={expanded}
    aria-expanded={expanded}
    aria-controls="og-color-panel"
    onclick={() => (expanded ? close() : open())}
  >
    <span class="og-color-sw" class:og-color-sw-empty={isEmpty} style="background:{previewCss}"></span>
    <span class="og-color-val" class:og-color-val-muted={isEmpty}>{isEmpty ? 'Default' : value}</span>
    <span class="og-color-bar-wrap">
      <span class="og-color-bar" class:og-color-bar-empty={isEmpty} style="background:{previewCss}"></span>
    </span>
    <span class="og-color-chev" aria-hidden="true">▾</span>
  </button>

  {#if expanded}
    <div class="og-color-panel" id="og-color-panel">
      <div class="og-color-search-row">
        <input
          class="og-color-search"
          type="text"
          bind:this={searchEl}
          bind:value={query}
          onkeydown={onSearchKeydown}
          placeholder="Search a colour name or #hex…"
          aria-label="Search CSS3 colour name or enter a hex"
          spellcheck="false"
          autocomplete="off"
        />
        <label class="og-color-pick" title="Custom colour (hex)">
          <span class="og-color-pick-icon" aria-hidden="true">🎨</span>
          <input type="color" value={pickerHex} oninput={onHexInput} aria-label="Pick a custom colour" />
        </label>
      </div>

      <div class="og-color-list" role="listbox" aria-label="CSS3 colours">
        <button type="button" class="og-color-item og-color-clear" onclick={clear}>
          <span class="og-color-isw og-color-sw-empty"></span>
          <span class="og-color-iname og-color-val-muted">Default (theme colour)</span>
        </button>
        {#each matches as color (color.name)}
          <button
            type="button"
            class="og-color-item"
            class:og-color-item-active={color.name === value.trim().toLowerCase()}
            role="option"
            aria-selected={color.name === value.trim().toLowerCase()}
            onclick={() => pick(color.name)}
          >
            <span class="og-color-isw" style="background:{color.hex}"></span>
            <span class="og-color-iname">{color.name}</span>
            <span class="og-color-ihex">{color.hex}</span>
          </button>
        {:else}
          <div class="og-color-empty">No CSS3 colour matches “{query}”.</div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .og-color {
    position: relative;
  }
  .og-color-summary {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s, 4px);
    padding: 0.4rem 0.6rem;
    cursor: pointer;
    color: var(--text-normal);
    text-align: left;
    font-size: var(--font-ui-small, 0.8125rem);
  }
  .og-color-summary:hover {
    border-color: var(--background-modifier-border-hover);
  }
  .og-color-open {
    border-color: var(--interactive-accent);
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }
  .og-color-sw {
    width: 20px;
    height: 20px;
    border-radius: 4px;
    flex: none;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.18);
  }
  .og-color-sw-empty {
    background:
      repeating-conic-gradient(var(--background-modifier-border) 0% 25%, transparent 0% 50%) 50% / 10px
      10px;
  }
  .og-color-val {
    font-family: var(--font-monospace);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 12ch;
  }
  .og-color-val-muted {
    color: var(--text-muted);
  }
  .og-color-bar-wrap {
    flex: 1;
    display: flex;
    align-items: center;
    min-width: 2.5rem;
  }
  .og-color-bar {
    height: 13px;
    width: 100%;
    border-radius: 3px;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
  }
  .og-color-bar-empty {
    box-shadow: none;
    background: var(--background-modifier-border) !important;
    opacity: 0.5;
  }
  .og-color-chev {
    flex: none;
    color: var(--text-muted);
    font-size: 0.7rem;
    transition: transform 0.15s ease;
  }
  .og-color-open .og-color-chev {
    transform: rotate(180deg);
  }

  .og-color-panel {
    border: 1px solid var(--interactive-accent);
    border-top: 0;
    border-radius: 0 0 var(--radius-s, 4px) var(--radius-s, 4px);
    background: var(--background-primary);
    padding: 0.55rem;
  }
  .og-color-search-row {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  .og-color-search {
    flex: 1;
    min-width: 0;
    font-family: var(--font-monospace);
    font-size: var(--font-ui-small, 0.8125rem);
    color: var(--text-normal);
    background: var(--background-modifier-form-field, var(--background-secondary));
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s, 4px);
    padding: 0.35rem 0.55rem;
  }
  .og-color-search:focus {
    border-color: var(--interactive-accent);
    outline: none;
  }
  .og-color-pick {
    position: relative;
    width: 34px;
    height: 30px;
    flex: none;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s, 4px);
    background: var(--background-secondary);
    display: grid;
    place-items: center;
    overflow: hidden;
    cursor: pointer;
  }
  .og-color-pick:hover {
    border-color: var(--background-modifier-border-hover);
  }
  .og-color-pick-icon {
    font-size: 0.9rem;
    line-height: 1;
  }
  .og-color-pick input[type='color'] {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    border: 0;
    cursor: pointer;
  }

  .og-color-list {
    margin-top: 0.5rem;
    max-height: 210px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .og-color-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    background: transparent;
    border: 0;
    border-radius: var(--radius-s, 4px);
    padding: 0.4rem 0.45rem;
    font-size: var(--font-ui-small, 0.8125rem);
    color: var(--text-normal);
    cursor: pointer;
    text-align: left;
  }
  .og-color-item:hover,
  .og-color-item-active {
    background: var(--background-modifier-hover);
  }
  .og-color-isw {
    width: 14px;
    height: 14px;
    border-radius: 4px;
    flex: none;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
  }
  .og-color-iname {
    flex: 1;
    font-family: var(--font-monospace);
  }
  .og-color-ihex {
    font-family: var(--font-monospace);
    font-size: 0.72rem;
    color: var(--text-muted);
  }
  .og-color-empty {
    padding: 0.5rem 0.45rem;
    color: var(--text-muted);
    font-size: var(--font-ui-small, 0.8125rem);
  }
</style>
