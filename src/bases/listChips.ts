/**
 * The pure chip model behind the chips list editor.
 *
 * A list-type user field is edited as chips. Each chip carries the note's RAW
 * stored entry verbatim (a `[[wikilink]]` or a plain string, read via the
 * direct path from frontmatter) so the whole-list commit round-trips
 * byte-identically — untouched links never decay to their display form. The
 * `display` label is the human text (basename/alias for a link, verbatim for
 * plain) and `isLink` drives link styling and the hover-preview affordance.
 *
 * Reuses the shipped {@link normalizeStoredList} (verbatim entry extraction) and
 * {@link linkDisplay} (label + link detection); no new parsing.
 *
 * @module bases/listChips
 */

import { normalizeStoredList } from './taskNotesSuggest';
import { linkDisplay } from './propertyValues';

export interface ListChip {
  /** The verbatim stored entry — round-trips byte-identically on commit. */
  raw: string;
  /** Human label: basename/alias for a link, the entry itself for plain text. */
  display: string;
  /** Whether the entry is a note reference (a wikilink or a note path). */
  isLink: boolean;
}

/** One chip from a verbatim stored entry. */
export function chipFromRawEntry(raw: string): ListChip {
  const link = linkDisplay(raw);
  return { raw, display: link ?? raw, isLink: link !== null };
}

/**
 * The dedupe key for an entry: a `[[target]]`/`[[target|alias]]` wikilink's
 * target (alias-insensitive), else the trimmed entry. Two entries are the same
 * list member when their keys match — so a re-pick of a note (or the same note
 * under a different alias) is a no-op, matching the shipped append semantics.
 */
export function entryTarget(entry: string): string {
  const wiki = /^\[\[([^\]]+)\]\]$/.exec(entry.trim());
  if (!wiki) return entry.trim();
  const inner = wiki[1] ?? '';
  const aliasIdx = inner.indexOf('|');
  return (aliasIdx === -1 ? inner : inner.slice(0, aliasIdx)).trim();
}

/** Whether a chip list already contains an entry targeting the same note/text. */
export function chipsContainEntry(chips: readonly ListChip[], entry: string): boolean {
  const target = entryTarget(entry);
  return chips.some((chip) => entryTarget(chip.raw) === target);
}

/** Seed chips from a note's RAW frontmatter list value (scalar/empty tolerant). */
export function chipsFromStoredList(raw: unknown): ListChip[] {
  return normalizeStoredList(raw).map(chipFromRawEntry);
}

/** The ordered raw array for the single whole-list commit. */
export function rawListFromChips(chips: readonly ListChip[]): string[] {
  return chips.map((chip) => chip.raw);
}
