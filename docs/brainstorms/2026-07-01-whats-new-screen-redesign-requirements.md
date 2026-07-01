---
date: 2026-07-01
topic: whats-new-screen-redesign
---

# What's New Screen Redesign

## Summary

Redesign the plugin's existing "What's New" view to match TaskNotes' version: bordered, collapsible per-release cards showing the version, a human-formatted date, a right-aligned collapse chevron, and a filled "Current" badge — listed newest-first with a short GitHub/star intro on top. Backfill the missing past-beta release notes so there is real history to scroll through.

## Problem Frame

The maintainer recorded TaskNotes' own "What's New" screen as a reference and asked the TaskNotes Gantt screen to match it — "all release notes from all releases … scroll, scroll, scroll … the numbering … the dates … just perfectly formatted."

The plugin already ships a working What's New view ([src/release/ReleaseNotesView.ts](../../src/release/ReleaseNotesView.ts)) built on native `<details>`/`<summary>` sections, so this is a visual-parity and content problem, not a rebuild. Two gaps separate it from the reference:

- **Formatting.** The native disclosure renders a triangle on the *left*, has no card/border treatment (the `tng-release-*` classes have no stylesheet — only inline `margin`/`opacity`), shows the "Current" state as faded text rather than a badge, and prints the raw ISO date. The reference uses bordered cards, a right-aligned chevron, a blue "Current" pill, and a formatted date.
- **History.** The generated bundle contains only `0.1.0-beta.4`, because that is the only file in `docs/releases/`. There is nothing to scroll. Matching the reference requires the earlier betas to exist and be bundled.

## Key Decisions

- **Match the pattern, not the pixels.** Replicate the reference layout (cards, right-aligned chevron, version+date row, "Current" pill) but drive colors and borders from Obsidian theme variables so the view looks native in any theme. This follows the project's theming conventions and avoids the hardcoded-color regressions ("heavy lines") that have bitten this project before.
- **Keep the native `<details>` disclosure.** Restyle it with CSS rather than replacing it with a custom toggle, preserving the keyboard and screen-reader support the current view deliberately chose.
- **Backfill the full beta history.** Author release-notes files for the past betas so the list matches the reference's depth immediately, rather than letting history accrue over future releases.
- **Earliest release is `0.1.0-beta.1`.** No `beta.0` tag exists — "down to beta 0" was the maintainer describing the TaskNotes example. Backfill covers beta.1, beta.2, beta.3 (beta.4 already exists); the historical copy is reconstructed from tags/PRs and is best-effort, not original release notes.
- **Format the date in the view, keep ISO in data.** The bundle continues to store an ISO date; the view formats it for display (`Month D, YYYY`), consistent with the extract-raw / format-for-display convention.

## Requirements

**Presentation & layout**
- R1. Each release renders as a bordered, collapsible card matching the reference: a summary row with the version number displayed prominently, the release date, and a collapse/expand chevron aligned to the right edge of the row.
- R2. The collapsible mechanism stays accessible (keyboard operable, screen-reader friendly) — i.e. built on native disclosure semantics, restyled rather than replaced.
- R3. Card styling (borders, background, chevron, badge) derives from Obsidian theme variables so it remains legible and native-looking across light/dark and community themes; no hardcoded colors that assume a specific theme.
- R4. Exactly one release is marked "Current" and is visually distinguished as a filled badge/pill, not faded text.
- R5. Each card shows its release date, human-formatted (`Month D, YYYY`), rendered in the view from the stored ISO date and tied to the correct version.
- R6. Releases are ordered newest-first (semver-aware). Older releases are collapsed by default; the current release (and the first prior) start expanded.

**History & content**
- R7. The view lists every release present in the bundle, scrollable from newest to earliest. Once history is backfilled, this reaches the earliest beta.
- R8. Release-notes files exist for `0.1.0-beta.1`, `0.1.0-beta.2`, and `0.1.0-beta.3` (beta.4 already exists), authored in the same format the bundle generator consumes, so they appear as cards. Content is reconstructed from git tags/PRs; historical dates use the tag dates.

**Intro & footer**
- R9. A short intro paragraph sits above the cards, inviting feedback and linking to the GitHub repo / issues / star, adapted for TaskNotes Gantt.
- R10. The existing footer ("View all releases on GitHub" + reopen-via-command hint) is retained.

## Acceptance Examples

- AE1. **Covers R4, R6.** Given a bundle whose newest entry is flagged current, when the view opens, that release's card shows the "Current" badge and is expanded, the next-older card is expanded, and all remaining cards are collapsed.
- AE2. **Covers R5.** Given a release with stored date `2026-07-01`, when its card renders, the date reads "July 1, 2026" (not the raw ISO string).
- AE3. **Covers R7, R8.** Given the backfilled bundle, when the user scrolls to the bottom of the list, the earliest card shown is `0.1.0-beta.1`.
- AE4. **Covers R3.** Given the user switches between a light and a dark Obsidian theme, when the view re-renders, card borders, the chevron, and the "Current" badge remain legible in both because they resolve from theme variables.

## Scope Boundaries

- The Gantt chart/view itself is untouched — this is only the "What's New" release-notes view.
- The release/versioning pipeline mechanics are unchanged beyond ensuring the backfilled history files are picked up and bundled.
- Not a pixel-for-pixel clone of TaskNotes' specific colors/spacing (see Key Decisions).
- No `0.1.0-beta.0` — it does not exist.

## Dependencies / Assumptions

- The bundle generator ([scripts/generate-release-notes-import.mjs](../../scripts/generate-release-notes-import.mjs)) builds `RELEASE_NOTES_BUNDLE` from `docs/releases/*.md`; backfilled files must follow the same file shape as the existing `docs/releases/0.1.0-beta.4.md` to be bundled correctly.
- `version`, `date`, and `isCurrent` for each card come from the bundle metadata ([src/releaseNotes.ts](../../src/releaseNotes.ts) `ReleaseNoteVersion`).
- Historical release copy is reconstructed (tags/PRs/commit history); it is documentation-grade, not the verbatim notes that would have shipped at the time.

## Outstanding Questions

### Deferred to Planning

- [Technical] How to right-align the disclosure marker cross-platform in Obsidian's Electron/Chromium (e.g. hiding the default marker and drawing a themed chevron) without breaking keyboard focus.
- [Technical] Where the card CSS lives (dedicated stylesheet vs the plugin's existing style entry) and how `tng-release-*` classes are wired to it.
- [Content] Depth of the backfilled notes per beta — full reconstructed changelog vs a concise summary per release.
- [Testing] Which assertions extend the existing coverage ([test/specs/whats-new.e2e.ts](../../test/specs/whats-new.e2e.ts), `test/unit/releaseNotes*.test.ts`, `whatsNewVersion.test.ts`) to lock the new card structure, badge, date formatting, and multi-release ordering.

## Sources / Research

- Current implementation: [src/release/ReleaseNotesView.ts](../../src/release/ReleaseNotesView.ts), default-expand logic [src/release/releaseNotesExpand.ts](../../src/release/releaseNotesExpand.ts), issue-link transform [src/release/releaseNoteLinks.ts](../../src/release/releaseNoteLinks.ts).
- Bundle + generator: [src/releaseNotes.ts](../../src/releaseNotes.ts) (currently one entry), [scripts/generate-release-notes-import.mjs](../../scripts/generate-release-notes-import.mjs), source files under `docs/releases/`.
- Release history: git tags `0.1.0-beta.1` … `0.1.0-beta.4` (earliest is beta.1).
- Feedback evidence + reference frames: [docs/brainstorms/riffrec-feedback/whats-new-screen-redesign/](riffrec-feedback/whats-new-screen-redesign/) (`analysis.md` transcript; `problem-analysis.md` grounded source mapping; local-only `frames/` show TaskNotes' reference UI — the design target, not our current view).
