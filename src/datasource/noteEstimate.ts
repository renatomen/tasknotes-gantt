/**
 * Resolve a note's Time Estimate (minutes) by path, cache-safely.
 *
 * Companion-expanded tasks (relationship descendants pulled into the tree that
 * aren't matched Base entries) are produced by {@link TaskNotesSource}, which has
 * no Bases entry to read a property from. Without this they carry no estimate and
 * fall back to the view's Default duration even when the note has one. This reads
 * the same frontmatter `BasesSource` uses for matched entries, but keyed by path.
 *
 * Cache-safe (`metadataCache` only, no Bases `getValue`, mirroring
 * {@link import('./noteProgress')}). Returns `null` when the file/cache/value is
 * missing or invalid so inference falls back to the Default duration.
 *
 * @module datasource/noteEstimate
 */

import { type App, TFile } from 'obsidian';

/**
 * Coerce a raw frontmatter value into a Time Estimate in minutes, or `null`.
 *
 * A Time Estimate is a positive integer number of minutes (R4): a missing, zero,
 * negative, non-integer, or otherwise non-finite value is treated as "no
 * estimate" (`null`). A numeric string (`"120"`) coerces; a non-numeric string
 * (`"abc"`) does not.
 */
export function coerceEstimateMinutes(raw: unknown): number | null {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

/**
 * Resolve a note's Time Estimate (minutes) from its frontmatter `bareKey`, or
 * `null`. `bareKey` is the frontmatter property name (already stripped of any
 * `note.` prefix); pass `null` when no estimate source is resolvable.
 */
export function resolveNoteEstimate(app: App, path: string, bareKey: string | null): number | null {
  if (!bareKey) return null;
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return null;
  const cache = app.metadataCache.getFileCache(file);
  return coerceEstimateMinutes(cache?.frontmatter?.[bareKey]);
}
