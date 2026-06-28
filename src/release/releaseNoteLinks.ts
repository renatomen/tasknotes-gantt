/**
 * Turn `(#123)` / `(#12, #34)` issue references in release-notes markdown into
 * clickable links to this repo's issues. Pure and idempotent; runs ONLY for the
 * in-app "What's New" view — the GitHub release body and the Plugin Update
 * Tracker render the raw markdown, so there is no cross-surface double transform.
 */

/** This plugin's GitHub repository, used to build issue links. */
export const REPO_URL = "https://github.com/renatomen/tasknotes-gantt";

/** A parenthesized group of one or more `#N` issue refs, e.g. `(#12, #34)`. */
const ISSUE_GROUP_RE = /\(#\d+(?:\s*,\s*#\d+)*\)/g;

function linkifySegment(segment: string, repoUrl: string): string {
  return segment.replace(ISSUE_GROUP_RE, (group) =>
    group.replace(/#(\d+)/g, (_, n: string) => `[#${n}](${repoUrl}/issues/${n})`),
  );
}

/**
 * Replace parenthesized issue refs with markdown links, preserving the
 * surrounding parentheses. Skips fenced and inline code so `` `(#5)` `` stays
 * literal. Idempotent: an already-linked `([#5](…))` is not re-matched because the
 * `(` is no longer immediately followed by `#`.
 */
export function transformReleaseNoteIssueLinks(markdown: string, repoUrl: string = REPO_URL): string {
  // Capturing split keeps delimiters: even indices are prose, odd are code spans.
  const parts = markdown.split(/(```[\s\S]*?```|`[^`]*`)/);
  return parts.map((part, i) => (i % 2 === 0 ? linkifySegment(part, repoUrl) : part)).join("");
}
