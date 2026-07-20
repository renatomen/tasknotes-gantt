/**
 * Targeted, comment-preserving frontmatter edits.
 *
 * A calendar note is hand-authored: it can carry YAML comments, blank lines and
 * a deliberate key order that a full re-serialize would erase. The editor form
 * must not vandalise that. So a save rewrites ONLY the keys that changed — each
 * as a whole top-level block — and leaves every other line, comments included,
 * byte-identical. Untouched keys, the note body, and any `---` inside the body
 * are never parsed and never moved.
 *
 * This handles the value shapes a calendar note uses: scalars, string lists,
 * and lists of flat records. It is not a general YAML serializer; the editor
 * only ever writes these shapes, and anything it does not recognise it quotes
 * defensively rather than emitting raw.
 *
 * @module editor/frontmatterEdit
 */

export type FrontmatterValue =
  | string
  | number
  | boolean
  | undefined
  | ReadonlyArray<string | Record<string, unknown>>;

/**
 * Return `original` with each entry of `changes` applied to its frontmatter
 * key. A key set to `undefined` is removed; a key not present is appended
 * before the closing fence. Returns the input unchanged when nothing differs.
 */
export function editFrontmatterKeys(
  original: string,
  changes: Record<string, FrontmatterValue>,
): string {
  const fence = locateFrontmatter(original);
  if (fence === null) {
    const block = Object.entries(changes)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => serializeKey(key, value))
      .join('\n');
    return `---\n${block}\n---\n\n${original}`;
  }

  let lines = original.slice(fence.bodyStart, fence.bodyEnd).split('\n');
  for (const [key, value] of Object.entries(changes)) {
    lines = applyKey(lines, key, value);
  }
  const rebuilt = lines.join('\n');
  const next = original.slice(0, fence.bodyStart) + rebuilt + original.slice(fence.bodyEnd);
  return next === original ? original : next;
}

interface Fence {
  /** Index just after the opening `---\n`. */
  bodyStart: number;
  /** Index of the closing `---` line's leading newline. */
  bodyEnd: number;
}

/** Locate the frontmatter block, or null when the file has none. */
function locateFrontmatter(text: string): Fence | null {
  if (!text.startsWith('---\n')) return null;
  const close = text.indexOf('\n---', 3);
  if (close === -1) return null;
  return { bodyStart: 4, bodyEnd: close };
}

/** Replace, append or remove one key across the frontmatter's lines. */
function applyKey(lines: string[], key: string, value: FrontmatterValue): string[] {
  const span = keySpan(lines, key);
  if (value === undefined) {
    return span === null ? lines : [...lines.slice(0, span.start), ...lines.slice(span.end)];
  }
  const serialized = serializeKey(key, value).split('\n');
  if (span === null) {
    return dropTrailingBlank([...lines, ...serialized]);
  }
  if (serialized.join('\n') === lines.slice(span.start, span.end).join('\n')) {
    return lines; // no textual change for this key
  }
  return [...lines.slice(0, span.start), ...serialized, ...lines.slice(span.end)];
}

interface KeySpan {
  start: number;
  end: number;
}

/**
 * The line range `[start, end)` a top-level key owns — its own line plus any
 * indented continuation (a block list or nested mapping). A comment or blank
 * line ends the block, so it stays attached to what follows, never swallowed.
 */
function keySpan(lines: string[], key: string): KeySpan | null {
  const head = new RegExp(`^${escapeRegExp(key)}:`);
  const start = lines.findIndex((line) => head.test(line));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && isContinuation(lines[end] ?? '')) end++;
  return { start, end };
}

/** An indented, non-comment, non-blank line continues the key above it. */
function isContinuation(line: string): boolean {
  if (line.trim() === '' || line.trimStart().startsWith('#')) return false;
  return /^\s/.test(line);
}

function serializeKey(key: string, value: FrontmatterValue): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return `${key}: []`;
    const items = value.map((item) =>
      typeof item === 'string'
        ? `  - ${quoteScalar(item)}`
        : serializeRecord(item as Record<string, unknown>),
    );
    return `${key}:\n${items.join('\n')}`;
  }
  return `${key}: ${quoteScalar(value as string | number | boolean)}`;
}

/** One list item that is a flat record: `- k: v` then `  k2: v2`. */
function serializeRecord(record: Record<string, unknown>): string {
  const entries = Object.entries(record);
  return entries
    .map(([k, v], index) => {
      const prefix = index === 0 ? '  - ' : '    ';
      return `${prefix}${k}: ${quoteScalar(v as string | number | boolean)}`;
    })
    .join('\n');
}

/** Quote a scalar when YAML would otherwise misread it; pass clean values raw. */
function quoteScalar(value: string | number | boolean): string {
  if (typeof value !== 'string') return String(value);
  const needsQuote = value === '' || /[:#"'\n]|^[\s>|@`&*!%]|[\s]$|,/.test(value);
  return needsQuote ? `"${value.replace(/"/g, '\\"')}"` : value;
}

/** Avoid a doubled blank line when appending after a trailing empty line. */
function dropTrailingBlank(lines: string[]): string[] {
  return lines;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
