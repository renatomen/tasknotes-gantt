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

  // SVAR passes { api, row, column, onaction } (ICellProps). Typed loosely like
  // the rest of the SVAR third-party surface in this codebase; the value lookup
  // below re-narrows to the typed property bag.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let { row, column }: { row: any; column: any } = $props();

  const text = $derived(
    formatPropertyValue(
      (row?.custom?.properties as Record<string, TypedValue> | undefined)?.[column.id as string],
    ),
  );
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
