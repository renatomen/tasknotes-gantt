<script lang="ts">
  /**
   * Gantt per-view toolbar (plan 002 U4). Slim control surface rendered above
   * the chart only when the per-view `tngantt_showToolbar` toggle is on.
   *
   * v1 holds a single control: a 3-state Auto / Light / Dark theme switch (R3,
   * R7). On change it sets the live theme `mode` (bound back to GanttContainer's
   * reactive state, U2) and calls the persist callback that closes over the
   * per-view config write (U3). The toolbar never touches Bases config directly.
   *
   * Styled with Obsidian CSS variables so it reads as native chrome — the chart
   * itself is themed by the SVAR wrapper, but this toolbar lives in Obsidian's
   * own surface, not inside the SVAR theme scope.
   */
  import type { ThemeMode } from './themeResolver';

  interface Props {
    /** Current theme mode (bindable: the segmented control writes it back). */
    mode: ThemeMode;
    /** Persist the chosen mode per-view (closes over config.set in register). */
    // eslint-disable-next-line no-unused-vars -- type-signature param name
    onModeChange: (mode: ThemeMode) => void;
  }

  let { mode = $bindable(), onModeChange }: Props = $props();

  const choices: ReadonlyArray<{ value: ThemeMode; label: string }> = [
    { value: 'auto', label: 'Auto' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  function select(next: ThemeMode): void {
    if (next === mode) return;
    mode = next;
    onModeChange(next);
  }
</script>

<div class="og-gantt-toolbar" role="toolbar" aria-label="Gantt toolbar">
  <div class="og-toolbar-group" role="radiogroup" aria-label="Theme">
    <span class="og-toolbar-label">Theme</span>
    <div class="og-segmented">
      {#each choices as choice (choice.value)}
        <button
          type="button"
          role="radio"
          aria-checked={mode === choice.value}
          class="og-segment"
          class:is-active={mode === choice.value}
          onclick={() => select(choice.value)}
        >
          {choice.label}
        </button>
      {/each}
    </div>
  </div>
</div>

<style>
  .og-gantt-toolbar {
    display: flex;
    align-items: center;
    gap: var(--size-4-2, 8px);
    padding: var(--size-4-1, 4px) var(--size-4-2, 8px);
    border-bottom: 1px solid var(--background-modifier-border);
    background: var(--background-secondary);
    font-size: var(--font-ui-small, 13px);
  }

  .og-toolbar-group {
    display: flex;
    align-items: center;
    gap: var(--size-4-2, 8px);
  }

  .og-toolbar-label {
    color: var(--text-muted);
    font-weight: var(--font-medium, 500);
  }

  .og-segmented {
    display: inline-flex;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s, 4px);
    overflow: hidden;
    background: var(--background-primary);
  }

  .og-segment {
    appearance: none;
    border: none;
    background: transparent;
    color: var(--text-normal);
    padding: var(--size-4-1, 4px) var(--size-4-2, 8px);
    cursor: pointer;
    font-size: inherit;
    line-height: 1.4;
    box-shadow: none;
  }

  .og-segment + .og-segment {
    border-left: 1px solid var(--background-modifier-border);
  }

  .og-segment:hover {
    background: var(--background-modifier-hover);
  }

  .og-segment.is-active {
    background: var(--interactive-accent);
    color: var(--text-on-accent);
  }

  .og-segment.is-active:hover {
    background: var(--interactive-accent-hover, var(--interactive-accent));
  }
</style>
