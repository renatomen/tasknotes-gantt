<script lang="ts">
  /**
   * SVAR Gantt tooltip content. Always renders the hovered task's name, and
   * appends one line per incoming dependency when present — so a task with no
   * dependencies degrades to the normal name tooltip rather than an empty
   * container.
   *
   * The payload shape belongs to the library and has changed under us before,
   * so unwrapping it lives in a pure helper the unit suite can hold, and this
   * component only renders what the helper returns.
   */
  import { dependencyTooltipModel } from './dependencyTooltip';

  // Loosely typed to satisfy SVAR's tooltip content contract, the same
  // accommodation `PropertyCell.svelte` makes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let { data }: { data: any } = $props();

  const model = $derived(dependencyTooltipModel(data));
</script>

<div class="og-gantt-tooltip">
  <div class="og-tooltip-title">{model.title}</div>
  {#if model.lines.length > 0}
    <div class="og-tooltip-deps">
      {#each model.lines as line}
        <div class="og-tooltip-dep">{line}</div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .og-gantt-tooltip {
    font-family: var(--font-interface), sans-serif;
  }
  .og-tooltip-title {
    font-weight: var(--font-semibold, 600);
  }
  .og-tooltip-deps {
    margin-top: 4px;
    opacity: 0.85;
    font-size: 0.9em;
  }
</style>
