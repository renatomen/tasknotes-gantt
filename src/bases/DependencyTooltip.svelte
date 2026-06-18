<script lang="ts">
  /**
   * SVAR Gantt tooltip content (U3). Receives the hovered task as `{ data }`
   * (an SVAR task; our `custom.incomingDeps` rides along). Always renders the
   * task name, and appends one line per incoming dependency when present — so a
   * task with no dependencies degrades to the normal name tooltip rather than an
   * empty container (plan 004, design finding on empty state).
   *
   * `data` is typed loosely to satisfy SVAR's tooltip content contract, the same
   * accommodation `PropertyCell.svelte` makes.
   */
  import { formatIncomingDeps, type IncomingDep } from './dependencyTooltip';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let { data }: { data: any } = $props();

  const deps = (): IncomingDep[] => data?.custom?.incomingDeps ?? [];
  const lines = (): string[] => {
    const text = formatIncomingDeps(deps());
    return text ? text.split('\n') : [];
  };
</script>

<div class="og-gantt-tooltip">
  <div class="og-tooltip-title">{data?.text ?? ''}</div>
  {#if lines().length > 0}
    <div class="og-tooltip-deps">
      {#each lines() as line}
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
