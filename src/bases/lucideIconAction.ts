/**
 * Shared Svelte action that renders an Obsidian/Lucide (or any plugin-registered)
 * icon into a node via Obsidian's `setIcon` (OG-81). Used by both the Gantt's
 * floating controls (GanttContainer) and the per-bar icon chip (BarContent), so
 * the setIcon + clear-and-reset-on-update behavior lives in one place.
 *
 * @module bases/lucideIconAction
 */
import { setIcon } from 'obsidian';

/** Svelte `use:lucideIcon={name}` action; re-renders on name change. */
export function lucideIcon(node: HTMLElement, iconName: string) {
  setIcon(node, iconName);
  return {
    update(next: string) {
      node.replaceChildren();
      setIcon(node, next);
    },
  };
}
