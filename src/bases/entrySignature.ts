/**
 * Entry-signature for the #161 `reuseTasks` gate.
 *
 * A fingerprint of the matched Bases entries — their count plus each `file.path`,
 * optionally extended with a per-entry value string. The `reuseTasks` optimization
 * reuses the controller's cached tasks when this signature is unchanged, so a
 * config-only / echo `onDataUpdated` (same entries, same values) is a cheap no-op
 * that avoids the #161 re-notify storm.
 *
 * CRITICAL: the value string must NOT be read through the Bases value system
 * (`entry.getValue`) — that is exactly what re-pokes the storm. The caller supplies
 * `valueOf` reading Obsidian's metadata cache directly (frontmatter), so a genuine
 * field edit (status/priority/date/…) flips the signature and refreshes the bars,
 * while an identical re-notify keeps the same signature (reuse). See
 * `docs/solutions/integration-issues/gantt-bases-getvalue-renotify-storm.md`.
 *
 * Extracted from the `GanttView` glue so the signature rule is unit-testable in
 * isolation (no Obsidian) — per `register-ts-coverage-not-glue`.
 *
 * @module bases/entrySignature
 */

import { checklistCompletionSignature, type ChecklistItemLike } from './checklistProgress';
import type { ProgressMode } from './types/field-mapping';

/** Minimal entry shape the signature reads (a subset of a Bases entry). */
export interface SignatureEntry {
  file?: { path?: string };
}

/**
 * A signature prefix carrying the resolved Progress mode, so a mode switch always
 * flips the whole signature and forces a re-read. Without it, a note with no
 * checklist has an identical per-entry value in both modes (empty checklist
 * fingerprint, same mapped property value), so its bar would keep the stale value
 * until a manual refresh. Pure.
 */
export function progressModeSignatureTag(mode: ProgressMode | undefined): string {
  return `pm:${mode ?? 'property'}|`;
}

/**
 * The per-entry value string folded into the signature: the JSON-encoded
 * frontmatter values for the mapped fields, plus (in TaskNotes progress mode) the
 * note's checklist-completion fingerprint. Returns `''` for an entry with no
 * frontmatter in a non-TaskNotes context (nothing observable to fingerprint).
 * Values are ``-joined so adjacent fields can't collide, and JSON-encoded so
 * array/object edits stay observable. Pure (the caller reads the cache).
 *
 * @param fmKeys - bare frontmatter keys to fingerprint (from {@link frontmatterSignatureKeys}).
 * @param frontmatter - the note's cached frontmatter, or null when absent.
 * @param listItems - the note's cached list items (checklist source), or undefined.
 * @param tasknotesProgress - whether Progress mode is `tasknotes` (folds the checklist fingerprint).
 */
export function entryValueSignature(
  fmKeys: readonly string[],
  frontmatter: Record<string, unknown> | null | undefined,
  listItems: ReadonlyArray<ChecklistItemLike> | null | undefined,
  tasknotesProgress: boolean,
): string {
  if (!frontmatter && !tasknotesProgress) return '';
  const frontmatterPart = fmKeys.length
    ? fmKeys.map((k) => JSON.stringify(frontmatter?.[k] ?? '')).join('')
    : '';
  const checklistPart = tasknotesProgress ? checklistCompletionSignature(listItems) : '';
  return frontmatterPart + checklistPart;
}

/**
 * The bare frontmatter keys whose values drive an instance's rendering: the
 * `note.*` field-mapping values with their `note.` / `note:` prefix stripped. The
 * value-sensitive signature reads these from the metadata cache, so a live edit to
 * one flips the signature and refreshes the bars.
 *
 * Only frontmatter-backed (`note.` / `note:`) mappings qualify — a mapping to a
 * `formula.*` / `file.*` / computed property has no frontmatter key and its edits
 * cannot be observed via the metadata cache, so it is intentionally excluded (the
 * signature then degrades to path-only for that field). Pure and Obsidian-free so
 * the prefix/strip logic is unit-testable in isolation.
 */
export function frontmatterSignatureKeys(
  mappingValues: ReadonlyArray<string | undefined>,
): string[] {
  const keys: string[] = [];
  for (const property of mappingValues) {
    if (!property) continue;
    if (property.startsWith('note.')) keys.push(property.slice('note.'.length));
    else if (property.startsWith('note:')) keys.push(property.slice('note:'.length));
  }
  return keys;
}

/**
 * Fingerprint of a matched entry set: the entry count followed by each entry's
 * `file.path` (missing paths → empty segment), joined by `|`. When `valueOf` is
 * supplied, each entry also contributes its value string (after `~`), so a value
 * edit changes the signature. Pure: no value reads of its own — `valueOf` (when
 * given) owns cache-safe reading.
 */
export function entriesSignature(
  entries: ReadonlyArray<SignatureEntry>,
  valueOf?: (entry: SignatureEntry) => string,
): string {
  let sig = String(entries.length);
  for (const entry of entries) {
    sig += `|${entry.file?.path ?? ''}`;
    if (valueOf) sig += `~${valueOf(entry)}`;
  }
  return sig;
}
