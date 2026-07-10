<script lang="ts">
  /* global HTMLElement */
  /**
   * Generic type-aware grid cell.
   *
   * Rendered by SVAR as `<column.cell {api} {row} {column} onaction/>` for each
   * property column. Reads the task's render descriptor for this column from
   * `row.custom.cellRenders[column.id]`: a `text` descriptor renders as a plain
   * span (the conventional formatter's output); a `markdown` descriptor renders
   * via Obsidian's `MarkdownRenderer` so wikilinks become clickable links and
   * tag values become tag pills. `app` arrives via Svelte context (SVAR can't
   * pass it as a prop); when it is unavailable the cell degrades to the
   * type-tagged text bag rather than emitting raw markdown source.
   */
  import { getContext } from 'svelte';
  import { Component, MarkdownRenderer } from 'obsidian';
  import type { App } from 'obsidian';
  import type { CellRender } from './cellRender';
  import { GRID_APP_CONTEXT_KEY } from './gridContext';
  import { formatPropertyValue } from './propertyFormat';
  import type { TypedValue } from './propertyValues';

  // SVAR passes { api, row, column, onaction } (ICellProps). Typed loosely like
  // the rest of the SVAR third-party surface in this codebase; the lookups below
  // re-narrow to the typed grid bags.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let { row, column }: { row: any; column: any } = $props();

  const app = getContext<App | undefined>(GRID_APP_CONTEXT_KEY);

  const render = $derived(
    (row?.custom?.cellRenders as Record<string, CellRender> | undefined)?.[column.id as string],
  );

  // Conventional/degrade text: the formatted typed value. Used for text-mode
  // cells, and as the graceful fallback for a markdown cell when `app` is absent
  // (shows display text, never raw `[[...]]`).
  const fallbackText = $derived(
    formatPropertyValue(
      (row?.custom?.properties as Record<string, TypedValue> | undefined)?.[column.id as string],
    ),
  );

  const useMarkdown = $derived(render?.mode === 'markdown' && !!app);
  const displayText = $derived(render?.mode === 'text' ? render.text : fallbackText);
  const sourcePath = $derived((row?.custom?.sourceTaskId as string | undefined) ?? '');

  let el: HTMLElement | undefined = $state();

  $effect(() => {
    // Re-runs when the descriptor, app, or target element change (SVAR reuses
    // cell nodes across rows). Own the render lifecycle per pass and tear it down
    // on cleanup so virtualized reuse cannot leak render children or leave stale
    // content, and guard the async race (cleanup before render resolves).
    if (!useMarkdown || !el || !app || render?.mode !== 'markdown') return;
    const owner = new Component();
    owner.load();
    // Render into a fresh child per pass: a stale in-flight render (SVAR reuses
    // this node on scroll) then resolves into its own detached child on cleanup,
    // never wiping the live render.
    const child = el.createSpan();
    void MarkdownRenderer.render(app, render.source, child, sourcePath, owner);
    return () => {
      owner.unload();
      child.remove();
    };
  });
</script>

{#if useMarkdown}
  <span class="og-grid-cell og-grid-cell--md" title={fallbackText} bind:this={el}></span>
{:else}
  <span class="og-grid-cell" title={displayText}>{displayText}</span>
{/if}

<style>
  .og-grid-cell {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Markdown cells can hold multi-value/list content; clamp to the row so a
     rendered list or wrapping links can never grow the fixed SVAR row height
     (the CSS clamp is the height guarantee; source sanitization is the first
     line). Rendered links/tags flow inline and clip with ellipsis. */
  .og-grid-cell--md {
    max-height: 100%;
  }
  .og-grid-cell--md :global(p),
  .og-grid-cell--md :global(ul),
  .og-grid-cell--md :global(ol) {
    display: inline;
    margin: 0;
    padding: 0;
  }
  .og-grid-cell--md :global(li) {
    display: inline;
    list-style: none;
  }
  .og-grid-cell--md :global(li:not(:last-child))::after {
    content: ', ';
  }
</style>
