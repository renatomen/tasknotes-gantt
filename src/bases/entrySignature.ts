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
 * while an identical re-notify keeps the same signature (reuse).
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
    const key = property.startsWith('note.')
      ? property.slice('note.'.length)
      : property.startsWith('note:')
        ? property.slice('note:'.length)
        : null;
    if (key !== null && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/**
 * The mapping values the signature watches: the view's own mappings UNIONED with
 * the ones the controller resolved.
 *
 * Both halves are load-bearing. The RESOLVED values make a field the user left
 * unset still watch the property it actually reads (TaskNotes' own), so an edit to
 * it refreshes the bars. The VIEW values keep the signature sensitive to a live
 * mapping change: the resolved set lags by one refresh — it is recomputed only when
 * the source is re-selected, which happens AFTER the signature is compared — so
 * watching it alone would leave a re-mapped field fingerprinting its old property,
 * and the unchanged signature would reuse the cached tasks instead of re-reading.
 */
export function watchedMappingValues(
  viewMappings: WatchedMappings,
  resolvedMappings: WatchedMappings,
  estimateReadKey: string | null,
): Array<string | undefined> {
  return [
    viewMappings.startProperty,
    resolvedMappings.startProperty,
    viewMappings.endProperty,
    resolvedMappings.endProperty,
    viewMappings.progressProperty,
    viewMappings.statusProperty,
    resolvedMappings.statusProperty,
    viewMappings.priorityProperty,
    resolvedMappings.priorityProperty,
    viewMappings.parentProperty,
    estimateReadKey ?? viewMappings.timeEstimateProperty,
    viewMappings.calendarProperty,
    resolvedMappings.calendarProperty,
  ];
}

/**
 * A tag identifying WHICH properties the roles are mapped to, folded into the
 * signature so that re-pointing a role always forces a re-read.
 *
 * The watched frontmatter keys alone cannot carry this. Two roles can share one
 * property (start and end both on `note.date`), so unmapping one leaves the key set
 * identical and the value fingerprint unchanged — the Base would never be re-read and
 * the bar would keep rendering the old role's value. A role mapped to a
 * `formula.*`/`file.*` property contributes no frontmatter key at all, so re-pointing
 * it is invisible to the key set entirely. The mapping identity sees both.
 *
 * Derived from config, so it is constant across the notifies of an unchanged view — a
 * config-only / echo notify still reuses, and the storm gate is unaffected.
 */
export function mappingSignatureTag(mappingValues: ReadonlyArray<string | undefined>): string {
  // JSON-encoded rather than delimiter-joined: a property name may contain any
  // character, so a separator could be forged and two different mappings could
  // otherwise flatten to the same tag.
  return JSON.stringify(mappingValues.map((property) => property ?? ''));
}

/** The cached note data the signature fingerprints, read per matched entry. */
export interface EntryNoteCache {
  frontmatter: Record<string, unknown> | null;
  listItems?: ReadonlyArray<ChecklistItemLike>;
}

/** Everything the composed signature decides against. */
export interface EntrySignatureInputs {
  entries: ReadonlyArray<SignatureEntry>;
  /** The LIVE view mappings — see {@link watchedMappingValues} on why these, not the resolved ones, drive the modes. */
  viewMappings: WatchedMappings & { progressMode?: ProgressMode };
  /** The mappings the controller resolved on the previous refresh. */
  resolvedMappings: WatchedMappings;
  /** The controller's resolved Time Estimate read key, or `null` before it resolves. */
  estimateReadKey: string | null;
  /**
   * Cache-safe per-entry read (Obsidian's metadata cache), or `null` when the note is
   * unreadable. MUST NOT read through the Bases value system — that is what re-pokes
   * the re-notify storm this signature exists to break.
   */
  noteCacheOf(entry: SignatureEntry): EntryNoteCache | null;
  /**
   * State of the calendar-note layer (the watch's epoch). A calendar-note edit
   * changes no task entry, so without this tag the signature would be identical
   * and the refresh would reuse cached tasks — stale stretch/shading inputs.
   */
  calendarStateTag?: string;
}

/**
 * The whole entry signature: the mapping identity and Progress mode, followed by the
 * matched entry set and (when there is anything value-bearing to watch) each entry's
 * value fingerprint.
 *
 * Composed here rather than in the view so the rule is unit-testable without Obsidian
 * — the caller injects the cache read. Skips the per-entry read entirely when no
 * frontmatter key is watched and the checklist is not in play, keeping a config-only
 * notify cheap.
 */
export function composeEntrySignature(input: EntrySignatureInputs): string {
  const { entries, viewMappings, resolvedMappings, estimateReadKey } = input;
  const watched = watchedMappingValues(viewMappings, resolvedMappings, estimateReadKey);
  const fmKeys = frontmatterSignatureKeys(watched);
  const prefix =
    mappingSignatureTag(watched) +
    progressModeSignatureTag(viewMappings.progressMode) +
    (input.calendarStateTag ?? '');
  const tasknotesProgress = viewMappings.progressMode === 'tasknotes';

  if (fmKeys.length === 0 && !tasknotesProgress) {
    return prefix + entriesSignature(entries);
  }
  return (
    prefix +
    entriesSignature(entries, (entry) => {
      const cache = input.noteCacheOf(entry);
      if (!cache) return '';
      return entryValueSignature(fmKeys, cache.frontmatter, cache.listItems, tasknotesProgress);
    })
  );
}

/** The instance-driving mapping slice {@link watchedMappingValues} reads. */
export interface WatchedMappings {
  startProperty?: string;
  endProperty?: string;
  progressProperty?: string;
  statusProperty?: string;
  priorityProperty?: string;
  parentProperty?: string;
  timeEstimateProperty?: string;
  calendarProperty?: string;
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
