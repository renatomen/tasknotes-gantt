/**
 * Markdown source builder for grid cells.
 *
 * Turns a raw property value plus its resolved {@link CellRenderType} into the
 * markdown source string handed to Obsidian's `MarkdownRenderer`. Wikilinks and
 * emphasis pass through unchanged; for a `tags` column each value token is
 * `#`-prefixed (Obsidian stores tag values without the hash) so the renderer
 * emits a tag pill.
 *
 * Cell-breaking constructs are suppressed at the source: embeds, images,
 * headings, and fenced code are stripped before rendering. Raw HTML and other
 * tall block grammar the string denylist cannot reliably catch are handled by
 * the cell's CSS height clamp, not here — the clamp is the height guarantee,
 * this denylist is the first line.
 *
 * Pure and dependency-free.
 *
 * @module bases/cellMarkdownSource
 */

import type { CellRenderType } from './cellRenderType';

/** Coerce a raw value into an array of string tokens (one per multi-value item). */
function toTokens(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) {
    return raw.filter((item) => item !== null && item !== undefined).map(String);
  }
  return [String(raw)];
}

/** `#`-prefix a bare tag token, leaving an already-prefixed token untouched. */
function toTagToken(token: string): string {
  const trimmed = token.trim();
  if (trimmed === '') return '';
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

/** Strip embeds, images, headings, and fenced code — the cell-breaking constructs (R11). */
function suppressBreakingConstructs(markdown: string): string {
  return markdown
    .replace(/!\[\[[^\]]*\]\]/g, '') // embeds ![[...]]
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images ![](...)
    .replace(/```[\s\S]*?```/g, '') // fenced code (backticks)
    .replace(/~~~[\s\S]*?~~~/g, '') // fenced code (tildes)
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '') // ATX heading markers
    .trim();
}

/**
 * Build the markdown source string for a cell value.
 *
 * @param rawValue - the raw extracted property value (wikilinks preserved)
 * @param renderType - the resolved render directive (drives tag injection)
 * @returns the sanitized markdown source; empty string for an empty value
 */
export function buildCellMarkdownSource(rawValue: unknown, renderType: CellRenderType): string {
  const tokens = toTokens(rawValue);
  if (tokens.length === 0) return '';

  const rendered = renderType.tags
    ? tokens.map(toTagToken).filter((t) => t !== '')
    : tokens.map((t) => t.trim()).filter((t) => t !== '');

  // Tags join with spaces (inline pills); other multi-value cells with commas.
  // The cell's layout clamp handles overflow of long multi-value content.
  const joined = rendered.join(renderType.tags ? ' ' : ', ');
  return suppressBreakingConstructs(joined);
}
