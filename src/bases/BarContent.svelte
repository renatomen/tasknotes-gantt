<script lang="ts">
  /* global HTMLElement */
  // SVAR `taskTemplate` component: renders a bar's content — the task text, plus
  // an optional neutral icon chip (status/priority) seated left of the text. It
  // reproduces SVAR's default `.wx-content` verbatim (so the date-status CSS
  // hooks and text styling are preserved) and adds the chip only when the icon
  // spec is present. When `custom.barIcon` is null (icon source `none`, or the
  // value is absent from the palette) it renders exactly the pristine content.
  //
  // Passed once as a stable prop to `<Gantt>` (see GanttContainer) — SVAR's
  // reinitStore does not read taskTemplate, so this never re-inits the store.
  import { setIcon } from 'obsidian';
  import type { IconSpec } from './barTreatment';

  // SVAR's taskTemplate is typed Component<{data, api, onaction}>; declare all
  // three so the assignment typechecks, but we only read `data`. Fields are
  // optional/loose so SVAR's ITask is assignable to `data`. `data.custom.barIcon`
  // is the resolved icon spec attached by ganttSync.buildSvarTasks.
  interface Props {
    data: { text?: string; custom?: { barIcon?: IconSpec | null } };
    api?: unknown;
    onaction?: (ev: { action: string; data: Record<string, unknown> }) => void;
  }
  let { data }: Props = $props();

  const spec = $derived(data?.custom?.barIcon ?? null);

  /** Svelte action: render a Lucide/registered icon into the node via Obsidian. */
  function icon(node: HTMLElement, name: string) {
    setIcon(node, name);
    return {
      update(next: string) {
        node.replaceChildren();
        setIcon(node, next);
      },
    };
  }
</script>

<div class="wx-content">
  {#if spec}
    {#if spec.iconName}
      <span class="og-bar-chip" style="color: {spec.color}" use:icon={spec.iconName}></span>
    {:else}
      <span class="og-bar-chip"
        ><span class="og-bar-dot" style="background-color: {spec.color}"></span></span
      >
    {/if}
  {/if}{data.text ?? ''}
</div>
