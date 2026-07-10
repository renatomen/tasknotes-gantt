<script lang="ts">
  /* global HTMLElement, MouseEvent */
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
  import { resolveDateLocale } from './dateLocale';
  import {
    GRID_APP_CONTEXT_KEY,
    GRID_DATE_LOCALE_CONTEXT_KEY,
    GRID_EDITABLE_COLUMNS_CONTEXT_KEY,
    type GridEditableColumnsContext,
  } from './gridContext';
  import { formatPropertyValue } from './propertyFormat';
  import type { TypedValue } from './propertyValues';

  // SVAR passes { api, row, column, onaction } (ICellProps). Typed loosely like
  // the rest of the SVAR third-party surface in this codebase; the lookups below
  // re-narrow to the typed grid bags.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let { row, column }: { row: any; column: any } = $props();

  const app = getContext<App | undefined>(GRID_APP_CONTEXT_KEY);
  // The assembly pass's locale snapshot; a cell mounted without the container
  // context re-resolves from the same source, so the two can't disagree.
  const dateLocale =
    getContext<string | undefined>(GRID_DATE_LOCALE_CONTEXT_KEY) ?? resolveDateLocale();

  const render = $derived(
    (row?.custom?.cellRenders as Record<string, CellRender> | undefined)?.[column.id as string],
  );

  // Conventional/degrade text: the formatted typed value. Used for text-mode
  // cells, and as the graceful fallback for a markdown cell when `app` is absent
  // (shows display text, never raw `[[...]]`).
  const fallbackText = $derived(
    formatPropertyValue(
      (row?.custom?.properties as Record<string, TypedValue> | undefined)?.[column.id as string],
      dateLocale,
    ),
  );

  const useMarkdown = $derived(render?.mode === 'markdown' && !!app);
  const displayText = $derived(render?.mode === 'text' ? render.text : fallbackText);
  const sourcePath = $derived((row?.custom?.sourceTaskId as string | undefined) ?? '');

  // Editable-cell cue (inline cell editing): a text cursor marks cells whose
  // column carries an inline editor AND whose row TaskNotes can persist —
  // mirroring the editor-open gate, so the cue never points at a dead end.
  const getEditableColumns = getContext<GridEditableColumnsContext | undefined>(
    GRID_EDITABLE_COLUMNS_CONTEXT_KEY,
  );
  const isEditable = $derived(
    !!row?.custom?.editable && !!getEditableColumns?.().has(column.id as string),
  );

  let el: HTMLElement | undefined = $state();

  /** Open Obsidian's global search for a tag (mirrors a tag click in a note). */
  function openTagSearch(currentApp: App, tag: string): void {
    try {
      const gs = (
        currentApp as unknown as {
          internalPlugins?: {
            getPluginById?: (id: string) => { instance?: { openGlobalSearch?: (q: string) => void } } | undefined;
          };
        }
      ).internalPlugins?.getPluginById?.('global-search')?.instance;
      gs?.openGlobalSearch?.(`tag:#${tag}`);
    } catch {
      /* global search unavailable — no-op (never fall back to the row modal) */
    }
  }

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

  /**
   * Make rendered links/tags behave as they do in a note body. Without this the
   * click bubbles to the grid's row handler (SVAR `select-task` → the TaskNotes
   * modal); stopping propagation on an anchor keeps the modal closed and runs the
   * native action instead: an internal link opens its note, a tag opens Obsidian
   * search. Clicks elsewhere in the cell still fall through to the row handler.
   */
  $effect(() => {
    const node = el;
    if (!useMarkdown || !node || !app) return;
    const currentApp = app;
    const onClick = (evt: MouseEvent): void => {
      const anchor = (evt.target as HTMLElement | null)?.closest?.('a.internal-link, a.tag');
      if (!anchor) return;
      evt.preventDefault();
      evt.stopPropagation();
      if (anchor.classList.contains('internal-link')) {
        const linktext =
          anchor.getAttribute('data-href') ?? anchor.getAttribute('href') ?? anchor.textContent ?? '';
        if (linktext) void currentApp.workspace.openLinkText(linktext, sourcePath, evt.ctrlKey || evt.metaKey);
      } else {
        const tag = (anchor.getAttribute('href') ?? anchor.textContent ?? '').replace(/^#/, '');
        if (tag) openTagSearch(currentApp, tag);
      }
    };
    // Also swallow the anchor's mousedown so SVAR can't begin a row selection/drag.
    const onMouseDown = (evt: MouseEvent): void => {
      if ((evt.target as HTMLElement | null)?.closest?.('a.internal-link, a.tag')) evt.stopPropagation();
    };
    // Fire `hover-link` so the Page Preview core plugin shows its popover (with the
    // user's configured modifier — we pass the event and let the plugin decide),
    // matching link hover in a note body.
    const onMouseOver = (evt: MouseEvent): void => {
      const anchor = (evt.target as HTMLElement | null)?.closest?.('a.internal-link');
      if (!anchor) return;
      const linktext =
        anchor.getAttribute('data-href') ?? anchor.getAttribute('href') ?? anchor.textContent ?? '';
      if (!linktext) return;
      currentApp.workspace.trigger('hover-link', {
        event: evt,
        source: 'og-gantt-grid',
        hoverParent: { hoverPopover: null },
        targetEl: anchor,
        linktext,
        sourcePath,
      });
    };
    node.addEventListener('click', onClick);
    node.addEventListener('mousedown', onMouseDown);
    node.addEventListener('mouseover', onMouseOver);
    return () => {
      node.removeEventListener('click', onClick);
      node.removeEventListener('mousedown', onMouseDown);
      node.removeEventListener('mouseover', onMouseOver);
    };
  });
</script>

{#if useMarkdown}
  <span
    class="og-grid-cell og-grid-cell--md"
    class:og-cell-editable={isEditable}
    title={fallbackText}
    bind:this={el}
  ></span>
{:else}
  <span class="og-grid-cell" class:og-cell-editable={isEditable} title={displayText}
    >{displayText}</span
  >
{/if}

<style>
  .og-grid-cell {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .og-cell-editable {
    cursor: text;
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
