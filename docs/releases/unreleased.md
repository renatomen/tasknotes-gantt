<!-- release-date: UNRELEASED -->
# TaskNotes Gantt - Unreleased

<!--

This is the working draft for the next release. `/release` drafts it from the
PRs merged since the last release tag (and their linked issues); the maintainer
reviews and edits it, then `npm version X.Y.Z` copies it to
`docs/releases/X.Y.Z.md` and bundles it into the plugin.

FORMAT

The FIRST line MUST be an HTML comment carrying the release date, which the
bundle generator (scripts/generate-release-notes-import.mjs) reads:

    <!-- release-date: 2026-06-23 -->

(ISO `YYYY-MM-DD`. While drafting, leave it as `UNRELEASED`; `/release` sets the
real date when cutting the version. The comment is invisible in the rendered
GitHub release body and the in-app "What's New" view.)

Then the title heading, then Keep-a-Changelog sections in this order, omitting
any that are empty:

    **Added**      for new features.
    **Changed**    for changes in existing functionality.
    **Deprecated** for soon-to-be removed features.
    **Removed**    for now removed features.
    **Fixed**      for any bug fixes.
    **Security**   in case of vulnerabilities.

ATTRIBUTION (write for users, and thank everyone — not just code authors)

Acknowledge ALL contributors to each change: the person who wrote the code, AND
whoever reported the issue, requested the feature, gave feedback, or tested it.
Do NOT thank the maintainer (@renatomen) for their own changes.

LINKS

Reference related GitHub issues/PRs inline as `(#123)` or `(#12, #34)` (the
in-app view turns these into clickable links). Add relevant doc or website
links where they help the reader.

EXAMPLE

    ## Fixed

    - (#42) Fixed the grid header sort arrow rendering as a blank square when the
      icon font is disabled.
      - Thanks to @someuser for reporting and @anotheruser for confirming the fix.

-->
