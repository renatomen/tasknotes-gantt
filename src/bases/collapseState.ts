/**
 * Per-view collapse-state serialization (U7).
 *
 * The set of *collapsed* task-instance ids (SVAR `open: false`) is persisted in
 * per-view config so a collapsed branch survives reload and settings changes.
 * These helpers are pure (no Obsidian/DOM) so they unit-test in isolation; the
 * component owns the live set and `register.ts` reads/writes the serialized form.
 *
 * Only collapsed ids are stored — parents default to open, so the persisted set
 * is the minority case and an empty/absent value means "all expanded".
 *
 * @module bases/collapseState
 */

/** The per-view config key the collapsed-id set is persisted under. */
export const COLLAPSED_KEY = 'tngantt_collapsedIds';

/**
 * Serialize a collapsed-id set to a STABLE JSON string array. Stability (dedup +
 * sort) is load-bearing: `register.ts` guards every config write against the
 * last persisted string, and an unstable serialization (insertion-order or
 * duplicates) would defeat that no-op guard and risk a refresh loop.
 */
export function serializeCollapsed(ids: Iterable<string>): string {
  return JSON.stringify([...new Set(ids)].sort());
}

/**
 * Tolerantly parse persisted collapse state into a Set of ids. Accepts the
 * serialized JSON string (the normal case) or an already-parsed array (Bases may
 * hand back either). Junk, the wrong shape, or a parse failure yields an empty
 * set ("all expanded") rather than throwing.
 */
export function parseCollapsed(raw: unknown): Set<string> {
  const fromArray = (arr: unknown): Set<string> | null =>
    Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === 'string')) : null;

  if (typeof raw === 'string' && raw.length > 0) {
    try {
      const parsed = fromArray(JSON.parse(raw));
      if (parsed) return parsed;
    } catch {
      /* malformed JSON — fall through to empty */
    }
  }
  return fromArray(raw) ?? new Set();
}

/**
 * Persist the collapsed-id set through the injected `set` (the Bases
 * `config.set`), skipping unchanged values and swallowing a failing write — the
 * same loop-breaking no-op guard as {@link import('./gridWidthPersist').persistGridWidth}.
 * Persisting per-view config makes Obsidian re-run the view (`onDataUpdated`),
 * which reseeds the chart; writing an *unchanged* set would feed a refresh loop.
 * The guard compares the *normalized* serialization of both sides, so a reorder
 * or duplicate in either never triggers a redundant write.
 *
 * @param set - persists a per-view option value by key (the Bases `config.set`).
 * @param currentRaw - the currently-stored raw value (string or array), or unset.
 * @param ids - the collapsed-id set to persist.
 */
export function persistCollapsed(
  set: (key: string, value: unknown) => void,
  currentRaw: unknown,
  ids: Iterable<string>,
): void {
  const next = serializeCollapsed(ids);
  if (next === serializeCollapsed(parseCollapsed(currentRaw))) return;
  try {
    set(COLLAPSED_KEY, next);
  } catch (error) {
    console.warn('[Gantt] Failed to persist collapse state:', error);
  }
}

/**
 * Decide the next collapsed-id set for a collapse-all / expand-all toggle. When
 * every collapsible (parent) id is already collapsed, expand all (empty set);
 * otherwise collapse all parents. A view with no parents can't collapse, so the
 * toggle always resolves to expand-all (empty).
 */
export function toggleCollapseAll(
  parentIds: ReadonlySet<string>,
  collapsed: ReadonlySet<string>,
): Set<string> {
  const allCollapsed = parentIds.size > 0 && [...parentIds].every((id) => collapsed.has(id));
  return allCollapsed ? new Set() : new Set(parentIds);
}
