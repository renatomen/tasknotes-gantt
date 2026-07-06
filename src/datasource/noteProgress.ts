/**
 * Resolve a note's progress (0–100) by path, mode-aware.
 *
 * Companion-expanded tasks (relationship descendants pulled into the tree that
 * aren't matched Base entries) are produced by {@link TaskNotesSource}, which has
 * no Bases entry to read a property from. Without this they render 0 progress in
 * both modes even when the note has a checklist or a populated Progress Property.
 * This reads the same source data `BasesSource` uses, but keyed by path:
 *
 * - `tasknotes` (or unset): the note's top-level checklist completion
 *   ({@link checklistProgressPercent}).
 * - `property`: the note's frontmatter Progress Property (bare key), clamped to
 *   0–100.
 *
 * Cache-safe (`metadataCache` only, no Bases `getValue`). Returns `null` when the
 * file/cache/value is missing so the bar renders empty. Property mode reads the
 * note's frontmatter only — a formula/computed Progress column is unresolvable for
 * a companion task that has no Bases entry (matched entries still read via the
 * adapter's full extraction).
 *
 * @module datasource/noteProgress
 */

import { type App, TFile } from 'obsidian';
import { checklistProgressPercent } from '../bases/checklistProgress';
import type { ProgressMode } from '../bases/types/field-mapping';

export function resolveNoteProgress(
  app: App,
  path: string,
  mode: ProgressMode | undefined,
  propertyKey: string | null,
): number | null {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return null;
  const cache = app.metadataCache.getFileCache(file);

  if (mode !== 'property') {
    return checklistProgressPercent(cache?.listItems);
  }

  if (!propertyKey) return null;
  const raw = cache?.frontmatter?.[propertyKey];
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}
