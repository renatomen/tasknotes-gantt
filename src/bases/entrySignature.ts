/**
 * Pure entry-signature for the #161 `reuseTasks` gate.
 *
 * A cheap fingerprint of the matched Bases entries — their count plus each
 * `file.path`, with **no value reads**. Reading entry values through the Bases
 * value system is exactly what re-pokes Bases into the #161 re-notify storm, so a
 * config-only / echo `onDataUpdated` (which carries the SAME entries) must be
 * detectable without touching values: an unchanged signature lets the view reuse
 * cached base tasks instead of re-reading the source. See
 * `docs/solutions/integration-issues/gantt-bases-getvalue-renotify-storm.md`.
 *
 * Extracted from the `GanttView` glue so the signature rule is unit-testable in
 * isolation (no Obsidian) — per `register-ts-coverage-not-glue`.
 *
 * @module bases/entrySignature
 */

/** Minimal entry shape the signature reads (a subset of a Bases entry). */
export interface SignatureEntry {
  file?: { path?: string };
}

/**
 * Cheap fingerprint of a matched entry set: the entry count followed by each
 * entry's `file.path` (missing paths contribute an empty segment), joined by `|`.
 * Pure: no value reads, no Obsidian.
 */
export function entriesSignature(entries: ReadonlyArray<SignatureEntry>): string {
  let sig = String(entries.length);
  for (const entry of entries) {
    sig += `|${entry.file?.path ?? ''}`;
  }
  return sig;
}
