<!-- release-date: UNRELEASED -->
# TaskNotes Gantt - Unreleased

<!--

This is the working draft for the next release. `/tng-release` drafts it from the
PRs merged since the last release tag (and their linked issues); the maintainer
reviews and edits it, then `npm version X.Y.Z` copies it to
`docs/releases/X.Y.Z.md` and bundles it into the plugin.

FORMAT

The FIRST line MUST be an HTML comment carrying the release date, which the
bundle generator (scripts/generate-release-notes-import.mjs) reads:

    <!-- release-date: 2026-06-23 -->

(ISO `YYYY-MM-DD`. While drafting, leave it as `UNRELEASED`; `/tng-release` sets the
real date when cutting the version. The comment is invisible in the rendered
GitHub release body and the in-app "What's New" view.)

NOTE (working draft): the sections below are drafted during implementation; the
maintainer edits/reorders and `/tng-release` finalizes attribution + date.

Then the title heading, then Keep-a-Changelog sections in this order, omitting
any that are empty:

    **Added**      for new features.
    **Changed**    for changes in existing functionality.
    **Deprecated** for soon-to-be removed features.
    **Removed**    for now removed features.
    **Fixed**      for any bug fixes.
    **Security**   in case of vulnerabilities.

STRUCTURE (parent bullet = heading; details + notes as sub-bullets)

Each change is a parent bullet holding ONLY a short bold summary (plus its
`(#N)` reference) — it reads like a heading. Put the explanation, and every
other note (thanks, caveats, links), on its own indented sub-bullet beneath it.
Do NOT continue the details on the parent line.

DO NOT hard-wrap prose. Write each bullet's text as a SINGLE continuous line and
let the renderer wrap it — the in-app "What's New" view turns a mid-sentence
newline in the source into a visible line break, which looks broken. (This file's
own instructional comment wraps for editing convenience; the release bullets must
not.)

ATTRIBUTION (write for users, and thank everyone — not just code authors)

Acknowledge ALL contributors to each change: the person who wrote the code, AND
whoever reported the issue, requested the feature, gave feedback, or tested it.
Do NOT thank the maintainer (@renatomen) for their own changes.

LINKS

Reference related GitHub issues/PRs inline as `(#123)` or `(#12, #34)` (the
in-app view turns these into clickable links). Add relevant doc or website
links where they help the reader.

EXAMPLE (parent = one-line heading; details/thanks as single-line sub-bullets)

    ## Fixed

    - **Grid header sort arrow no longer renders as a blank square.** (#42)
      - The arrow used an icon-font glyph that is invisible when the font is disabled; it now draws with an inline SVG that renders regardless of font settings.
      - Thanks to @someuser for reporting and @anotheruser for confirming the fix.

-->

## Added

- **Weekend day columns are now shaded in the timeline.**
  - Weekend days follow your locale (e.g. Saturday/Sunday, or Friday/Saturday in many Middle East locales) and the shading follows the active light/dark theme. Visible at day and hour zoom levels.
  - Turn it off per view with the new "Highlight weekends" toggle under Appearance — the toggle applies live, keeping your zoom and scroll position.

## Changed

## Fixed
