/**
 * Pure `[[`-token detection and splice over a text input value and caret
 * offset — the caret-aware autosuggest logic the text cell editor runs on each
 * keystroke, kept free of Obsidian/SVAR so it is fully unit-tested.
 *
 * @module bases/wikilinkToken
 */

const OPEN = '[[';
const CLOSE = ']]';

/** An open `[[…` token before the caret: its query text and value bounds. */
export interface WikilinkToken {
  /** Text between the token's `[[` and the caret. */
  query: string;
  /** Index of the token's opening `[[`. */
  start: number;
  /** Index at the caret (exclusive end of the token to replace). */
  end: number;
}

/** The result of splicing a chosen `[[Note]]` into a value. */
export interface SplicedWikilink {
  /** The new input value with the token replaced. */
  value: string;
  /** Caret offset positioned immediately after the inserted text. */
  caret: number;
}

/**
 * Detect an unterminated `[[…` token whose opening lies before `caret`.
 *
 * Scans back from the caret for the last `[[`; the token is open only when no
 * `]]` closes it before the caret. Returns the token's `query`/`start`/`end`,
 * or `null` when the caret is not inside an open `[[` token.
 */
export function detectWikilinkToken(value: string, caret: number): WikilinkToken | null {
  const bounded = Math.max(0, Math.min(caret, value.length));
  // Guard the `lastIndexOf` fromIndex: a negative value is clamped to 0 by the
  // spec (not treated as "no match"), which would falsely find an `[[` at the
  // very start when the caret is still inside or left of it.
  if (bounded < OPEN.length) return null;
  const start = value.lastIndexOf(OPEN, bounded - OPEN.length);
  if (start === -1) return null;
  const closeIdx = value.indexOf(CLOSE, start + OPEN.length);
  if (closeIdx !== -1 && closeIdx < bounded) return null;
  return { query: value.slice(start + OPEN.length, bounded), start, end: bounded };
}

/**
 * Replace `[token.start, token.end)` with the full `insert` string (the caller
 * builds the complete `[[Note]]`), reporting the caret just after the insert.
 */
export function spliceWikilink(
  value: string,
  token: { start: number; end: number },
  insert: string,
): SplicedWikilink {
  const start = Math.max(0, Math.min(token.start, value.length));
  const end = Math.max(start, Math.min(token.end, value.length));
  const next = value.slice(0, start) + insert + value.slice(end);
  return { value: next, caret: start + insert.length };
}
