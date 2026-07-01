<analysis>

**Feedback type:** feature/parity request (not a bug). The maintainer is screen-recording TaskNotes' own "What's New" view as the reference design and asking the TaskNotes Gantt "What's New" view to match it.

**Reference in frames:** All frames show TaskNotes' *What's new in TaskNotes 4.11.1* tab, NOT our plugin. Treat the frames as the design target, not as our current UI.

- **Observed facts** (transcript + frames): full verbatim transcript in `analysis.md`. Frame m1 (`frames/m1-6.72s-*.png`) = expanded current release with a bordered card block (version `4.11.1`, blue **Current** pill, formatted date "June 26, 2026", right-aligned collapse chevron), an intro paragraph, and categorized `Added`/`Fixed` bullet lists with PR links. Frame m3 (`frames/m3-33.61s-*.png`) = a scrollable stack of *collapsed* release cards from `4.1.1` down to `4.0.0-beta.0`, each showing version, date, and a right-aligned chevron.
- **Inferences:** The maintainer wants (a) the full release history present and scrollable "down to beta 0", (b) card-style collapsible blocks matching TaskNotes' visual formatting, (c) prominent version numbering, a current-release indicator, and formatted release dates.

## 1. Visual/UI Problems

1. **Collapse affordance is on the wrong side / wrong style.** Our view uses a native `<details>`/`<summary>` (disclosure triangle rendered on the **left**), while the reference (frame m1/m3) uses a **right-aligned chevron** on a bordered card row. Element: `summary.tng-release-summary` in [ReleaseNotesView.ts](src/release/ReleaseNotesView.ts#L60). Frame ref: m1, m3.
2. **No card container / borders.** Reference release blocks are bordered "cards" with padding and separation; our blocks are bare `<details>` with only inline `margin`/`opacity` styles and **no CSS card treatment** (the `tng-release-*` classes are referenced only in [ReleaseNotesView.ts](src/release/ReleaseNotesView.ts) and have no stylesheet). Frame ref: m1, m3.
3. **"Current" indicator is faded text, not a badge.** Reference shows a filled **blue "Current" pill** (frame m1); ours is small low-opacity inline text at [ReleaseNotesView.ts:67-72](src/release/ReleaseNotesView.ts#L67-L72).
4. **Release date is unformatted.** Bundle stores an ISO date (`"2026-07-01"`, see [releaseNotes.ts](src/releaseNotes.ts)) rendered verbatim; the reference shows a human-formatted date ("June 26, 2026", frame m1/m3). "the dates, the release dates, exactly as this, just perfectly formatted."
5. **No intro paragraph.** Reference opens with a feedback/GitHub/star line above the release cards (frame m1); ours has no header copy. (Lower priority.)

## 2. Functional Problems

1. **Only one release is present — no history to scroll.** The generated bundle contains a **single** entry (`0.1.0-beta.4`); see [releaseNotes.ts](src/releaseNotes.ts) `RELEASE_NOTES_BUNDLE`. The transcript explicitly asks for "all release notes from all releases … scroll, scroll, scroll … all the way to beta 0." Root cause is upstream of the view: only `docs/releases/0.1.0-beta.4.md` exists, and [generate-release-notes-import.mjs](scripts/generate-release-notes-import.mjs) bundles from `docs/releases/`. To match the reference, historical release notes (0.1.0-beta.0 … beta.3) must exist and be bundled. **Open product question for brainstorm:** backfill historical notes, or accept a shorter list until history accrues?
2. **Default-expand may not match the reference.** We expand current + first prior ([releaseNotesExpand.ts](src/release/releaseNotesExpand.ts)); the reference frame m3 shows all *older* releases collapsed. This is likely already fine but should be confirmed against the desired behavior.

## 3. Requirements

1. **R (formatting parity):** Render each release as a bordered, collapsible card matching TaskNotes' "What's New" layout — prominent version number, right-aligned collapse chevron, human-formatted release date, and a filled "Current" badge for the active version.
2. **R (full history):** The view must list *all* releases, newest-first, scrollable back to the earliest (beta.0), with older releases collapsed by default. Requires the underlying release-notes bundle to contain the full history.
3. **R (numbering/order):** Version numbers must be displayed and ordered consistently (semver-aware, newest first), per "pay attention to … the numbering here."
4. **R (dates):** Release dates must be shown per release, human-formatted, associated with the correct version.
5. **R (current indicator):** Exactly one release is marked "Current" and visually distinguished.

## 4. Usability/UX Problems

1. **Scannability of history.** The reference's card layout with a fixed version/date/chevron row makes a long history easy to scan and collapse; our current single bare `<details>` block does not establish that pattern at scale. Frame ref: m3.
2. **Discoverability of older notes.** Reference keeps everything in-view and scrollable; our footer instead links out to GitHub releases ([ReleaseNotesView.ts:77-83](src/release/ReleaseNotesView.ts#L77-L83)) — acceptable as a fallback but not a substitute for in-app history once the bundle is complete.

## Source mapping (suspected implementation surfaces — not proven root cause)

| Requirement | Surface | File | Classification | Confidence |
|---|---|---|---|---|
| Card layout, chevron, badge, header copy | View renderer (DOM) | [src/release/ReleaseNotesView.ts](src/release/ReleaseNotesView.ts) | Likely surface | High |
| Card/badge/chevron styling | CSS — **missing**; classes have no stylesheet | (no `tng-release` CSS yet) | Missing surface | High |
| Human-formatted date | Formatting layer (view formats; adapter extracts raw) | ReleaseNotesView.ts:62-66 + bundle `date` | Likely surface | High |
| Full history in the list | Bundle generation from `docs/releases/` | [scripts/generate-release-notes-import.mjs](scripts/generate-release-notes-import.mjs), [src/releaseNotes.ts](src/releaseNotes.ts) | Missing content (only beta.4 exists) | High |
| Default expand behavior | Pure expand logic | [src/release/releaseNotesExpand.ts](src/release/releaseNotesExpand.ts) | Likely surface | High |
| Ordering / current flag | Bundle shape (`version`, `date`, `isCurrent`) | src/releaseNotes.ts interface | Indirect surface | Medium |
| Regression coverage | e2e + unit | [test/specs/whats-new.e2e.ts](test/specs/whats-new.e2e.ts), test/unit/releaseNotes*.test.ts, whatsNewVersion.test.ts | Test surface | High |

**Convention note (AGENTS.md / data-formatting):** dates should be *extracted raw* by the bundle and *formatted for display* in the view — keep the ISO date in `releaseNotes.ts` and format in `ReleaseNotesView.ts`. **SVAR/CSS note:** card styling belongs in the plugin stylesheet, not inline styles; confirm whether the maintainer wants a dedicated `styles.css` block (none exists for `tng-release-*` today).
</analysis>
