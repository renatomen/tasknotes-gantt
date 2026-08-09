<script lang="ts">
  /**
   * SVAR Gantt tooltip content. Renders the hovered task's name, and appends one
   * line per incoming dependency when present — so a task with no dependencies
   * degrades to the normal name tooltip rather than an empty container.
   *
   * SVAR keeps this component mounted while the pointer moves between bars and
   * renders it for every hover target it can resolve. A hovered edge is one of
   * them, and describes itself: the blocked task, and the single relationship
   * that edge stands for.
   *
   * The container is still withheld when there is nothing to say — a rollup or
   * resource target, or an edge with no matching dependency. That leaves a bare
   * chip, because the surrounding chrome is painted on the presence of a content
   * component rather than on what it emits; only a resolver that declines the
   * target removes it. Every drawn edge resolves, so this is unreachable in
   * practice rather than merely unlikely.
   */
  import type { IApi, ILink, IResource, ITask } from '@svar-ui/svelte-gantt';
  import { dependencyTooltipModel, type TaskLookup } from './dependencyTooltip';

  // SVAR declares this union for its tooltip content but does not export it, so
  // it is mirrored here against the task, link and resource types it does
  // export. That catches a change to the wrapper — a renamed key or an added
  // variant fails the build rather than quietly emptying the tooltip again — but
  // not a change inside the task itself.
  type TooltipPayload =
    | { task: ITask; segmentIndex: number | null }
    | { link: ILink }
    | { rollup: ITask }
    | { resource: IResource };

  let { api, data }: { api?: IApi; data: TooltipPayload } = $props();

  const findTask: TaskLookup = (id) => api?.getTask(id) as ReturnType<TaskLookup>;
  const model = $derived(dependencyTooltipModel(data, findTask));
  const isEmpty = $derived(model.title === '' && model.lines.length === 0);
</script>

{#if !isEmpty}
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
{/if}

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
