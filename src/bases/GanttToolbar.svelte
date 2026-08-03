<script lang="ts">
  /**
   * Gantt per-view toolbar (plan 002 U4). Slim control surface rendered above
   * the chart only when the per-view `tngantt_showToolbar` toggle is on.
   *
   * Controls: a 3-state Auto / Light / Dark theme switch and — when the host
   * supplies the opener — a quick-source-switcher button. On change the theme
   * switch calls `onModeChange` — the parent (GanttContainer) owns the live
   * theme `mode` write so the reseed + theme flip batch in one tick; the
   * parent's callback also persists the per-view config. The toolbar never
   * writes `mode` locally and never touches Bases config directly.
   *
   * Styled with Obsidian CSS variables so it reads as native chrome — the chart
   * itself is themed by the SVAR wrapper, but this toolbar lives in Obsidian's
   * own surface, not inside the SVAR theme scope.
   */
  import type { ThemeMode } from './themeResolver';

  interface Props {
    /** Current theme mode (read-only display; the parent owns the write). */
    mode: ThemeMode;
    /** Notify the parent of the chosen mode; the parent updates state + persists. */
    onModeChange: (mode: ThemeMode) => void;
    /**
     * Open the quick source switcher. Presence-gated like the container's other
     * optional interaction callbacks: the button renders only when the host
     * supplies the opener.
     */
    onOpenSourceSwitcher?: () => void;
  }

  let { mode, onModeChange, onOpenSourceSwitcher }: Props = $props();

  const choices: ReadonlyArray<{ value: ThemeMode; label: string }> = [
    { value: 'auto', label: 'Auto' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  function select(next: ThemeMode): void {
    if (next === mode) return;
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
  {#if onOpenSourceSwitcher}
    <div class="og-toolbar-group">
      <button
        type="button"
        class="og-toolbar-button"
        aria-haspopup="dialog"
        aria-label="Quick source switcher"
        onclick={onOpenSourceSwitcher}
      >
        Sources
      </button>
    </div>
  {/if}
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

  .og-toolbar-button {
    appearance: none;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s, 4px);
    background: var(--background-primary);
    color: var(--text-normal);
    padding: var(--size-4-1, 4px) var(--size-4-2, 8px);
    cursor: pointer;
    font-size: inherit;
    line-height: 1.4;
    box-shadow: none;
  }

  .og-toolbar-button:hover {
    background: var(--background-modifier-hover);
  }
</style>
