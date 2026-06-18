<script lang="ts">
  /**
   * Generic type-aware grid cell (plan 2026-06-18-001, U3).
   *
   * Rendered by SVAR as `<column.cell {api} {row} {column} onaction/>` for each
   * property column. Reads the task's type-tagged value for this column from
   * `row.custom.properties[column.id]` (guarded — pre-existing/optimistic task
   * writes may lack the bag) and renders it via the pure formatter, switching
   * on `kind` rather than `instanceof`.
   */
  import { formatPropertyValue } from './propertyFormat';
  import type { TypedValue } from './propertyValues';

  // SVAR passes { api, row, column, onaction }; this cell only needs row+column.
  let { row, column }: { row: { custom?: { properties?: Record<string, TypedValue> } }; column: { id: string } } =
    $props();

  const text = $derived(formatPropertyValue(row?.custom?.properties?.[column.id]));
</script>

<span class="og-grid-cell" title={text}>{text}</span>

<style>
  .og-grid-cell {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
