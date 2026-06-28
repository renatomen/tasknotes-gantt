---
title: "Community release pipeline: AI-drafted notes, beta→prod packaging, Update Tracker + in-app"
date: 2026-06-23
status: requirements
related:
  - "TaskNotes reference impl (../tasknotes): .github/workflows/release.yaml, version-bump.mjs, generate-release-notes-import.mjs, scripts/update-release-index.mjs, docs/releases/*.md"
  - .github/workflows/release.yml
  - version-bump.mjs
  - versions.json
  - CONTRIBUTING.md
---

# Community release pipeline

## Summary

Stand up an automated, **review-gated** release process for `tasknotes-gantt` that
mirrors TaskNotes': as PRs merge, a local `/release` skill **auto-drafts**
user-facing release notes (Keep-a-Changelog style, with broad contributor thanks
and inline links) from what changed since the last release; the maintainer
**reviews/edits** the draft; **beta** and **prod** versions are packaged through CI
as **draft** GitHub releases that the maintainer **publishes** as the final
approval. The published notes feed three surfaces from one source: the **GitHub
release body**, the **Obsidian Plugin Update Tracker** community plugin, and an
**in-app "what's new" modal**.

This *extends* what already exists (`.github/workflows/release.yml`,
`version-bump.mjs`, `versions.json`, bare-semver tags, enforced Conventional
Commits) rather than rebuilding it.

## Problem / Context

`tasknotes-gantt` has no community-release process. Today `release.yml` fires on a
bare-semver tag and calls `gh release create --generate-notes` — a raw commit dump,
auto-published, no beta channel, no curated or user-meaningful notes, no
contributor attribution, no in-app surfacing. To release to the community we need
the end-to-end flow TaskNotes already runs, but with **less manual curation**: the
maintainer wants to *review and approve* notes, not write them from scratch.

TaskNotes' process (the reference) is: hand-curated `docs/releases/unreleased.md`
→ per-version `docs/releases/X.Y.Z.md` → `npm version` runs custom scripts
(`version-bump.mjs`, `generate-release-notes-import.mjs` → `src/releaseNotes.ts`
for in-app, `update-release-index.mjs` → `docs/releases.md`) → tag → CI builds and
opens a **draft** GitHub release whose body is the per-version file → maintainer
publishes. The Update Tracker simply reads that GitHub release **body** markdown.
We replicate the shape but replace the hand curation with AI drafting + a review
gate.

## Actors

- **A1 — Maintainer** (release owner): triggers a release, reviews/edits the
  auto-drafted notes, and publishes (the approval gate).
- **A2 — External contributors**: anyone who contributed to a change — code
  authors, issue **reporters**, feature **requesters**, **testers**, feedback
  givers — who should be **credited** in the notes.
- **A3 — Plugin users / beta testers**: read the notes (via the Update Tracker or
  the in-app modal) to decide whether to install/update; beta testers receive
  betas through **BRAT**.

## Goals / success criteria

- **G1** A release's notes are **auto-drafted** (not written from scratch) in
  TaskNotes' style, accurate and user-meaningful, from what merged since the last
  release.
- **G2** Nothing goes live without the maintainer's **explicit approval** as the
  final step.
- **G3** Contributors of all kinds are **credited**, and notes carry **links** to
  related issues/PRs/docs/sites.
- **G4** One reviewed notes source drives **all three** surfaces consistently
  (GitHub body, Update Tracker, in-app modal).
- **G5** Both **beta** (BRAT testers) and **prod** (store + Update Tracker)
  releases flow through the same gate.
- **G6** No regression to the existing build/version machinery; no LLM secret
  required in CI.

## Requirements

- **R1 — Auto-drafted notes.** A local `/release` skill drafts
  `docs/releases/X.Y.Z.md` from the **PRs/commits merged since the last release tag
  AND their linked issues/threads**. Style: Keep-a-Changelog sections (Added /
  Changed / Deprecated / Removed / Fixed / Security), user-meaningful prose.
- **R2 — Broad attribution.** Each entry credits everyone who contributed to that
  change — author, reporter, requester, tester, feedback-giver — e.g. "Thanks to
  @user for the contribution / for reporting / for testing." Sourced from the PR
  and its linked issues, not just commit authorship. The maintainer's own
  changes need no thanks.
- **R3 — Inline links.** Entries embed related links: GitHub issue/PR refs
  (`(#123)`), and relevant docs or external URLs.
- **R4 — Review-and-approve gate (two beats).** The maintainer reviews/edits the
  drafted notes **file** before tagging (the in-app modal bundles notes at build,
  so content must be locked pre-tag); the **publish** of the draft GitHub release
  is the final go-live action. Nothing reaches users before publish.
- **R5 — Single source → three surfaces.** The committed `docs/releases/X.Y.Z.md`
  is the only notes source: it becomes the **GitHub release body** (which the
  **Update Tracker** reads as-is), is bundled into the plugin for the **in-app
  modal**, and is listed in a `docs/releases.md` index.
- **R6 — Beta packaging.** A `X.Y.Z-beta.N` tag produces a reviewed draft that is
  published as a GitHub **prerelease**; **BRAT** testers who added the repo receive
  it. (No `manifest-beta.json` channel — betas are prereleases.)
- **R7 — Prod packaging.** A bare `X.Y.Z` tag produces a reviewed draft that is
  published as a full release; this is what the community store + Update Tracker
  surface. CI attaches the built artifacts (`main.js`, `manifest.json`,
  `styles.css`) and keeps `manifest.json` + `versions.json` in sync.
- **R8 — In-app "what's new" modal.** The plugin bundles the notes and shows the
  current version's notes **once** after an update (tracked in plugin data so it
  doesn't repeat); a user can also re-open them on demand.
- **R9 — Update Tracker compatibility.** The GitHub release body is plain
  Keep-a-Changelog markdown (no special metadata) so the Obsidian Plugin Update
  Tracker renders it for users deciding whether to update.
- **R10 — CI replaces `--generate-notes`.** The release workflow uses the
  committed per-version file as the release body (`body_path`), supports beta tags,
  marks betas as prerelease, and creates releases as **draft** (no auto-publish);
  it verifies the notes file exists before releasing.

## Key flows

- **F1 — Cut a release (happy path).** Maintainer runs `/release` → skill computes
  the next version + the change set since the last tag, drafts
  `docs/releases/X.Y.Z.md` (sections, thanks, links) → maintainer reviews/edits →
  `npm version X.Y.Z` bumps `manifest.json`/`versions.json`, bundles in-app notes,
  rebuilds the index → commit + tag → CI builds + opens a **draft** GitHub release
  with that body + artifacts → maintainer publishes → live on GitHub + Update
  Tracker; updaters see the in-app modal.
- **F2 — Beta for testers.** Same as F1 with a `X.Y.Z-beta.N` tag → CI opens a
  draft **prerelease** → maintainer publishes as prerelease → BRAT testers receive
  it. Promotion to prod = a later bare-semver release (notes can fold in the beta
  entries).
- **F3 — Attribution from a reported issue.** A user files issue #200; a
  contributor's PR closes it. `/release` reads the PR + linked issue, drafts
  "Fixed … (#200). Thanks to @reporter for reporting and @author for the fix." →
  maintainer confirms.
- **F4 — In-app what's new.** User updates the plugin; on next load the modal shows
  this version's notes once; subsequent loads don't re-show until the next version.

## Approach (chosen)

**Local AI-drafting skill + draft-release approval gate** (replicate TaskNotes'
shape; replace hand curation with AI drafting). Chosen over the standard automated
tools because they don't fit the requirements:

- **Changesets / release-please / semantic-release** produce *mechanical* changelogs
  from commit/PR text and can't credit non-author contributors (reporters, testers)
  or weave in narrative thanks + links from issue threads; **semantic-release** also
  auto-publishes, violating R4. Explicitly **not adopted**.
- An LLM *can* read merged PRs **plus their linked issues/threads** to do broad
  attribution (R2), links (R3), and user-meaningful prose (R1), then hand over a
  draft to approve (R4). Running it **locally** (Claude/CE skill) keeps note quality
  high and keeps any LLM secret **out of CI** (G6); CI only builds + opens the
  draft/prerelease.

This is **extend, not rebuild**: reuse `version-bump.mjs`, `versions.json`,
bare-tag `.npmrc`, and the existing `release.yml` skeleton; add the notes-drafting
skill, the per-version files + index + in-app bundle, beta-tag support, and the
draft/body_path/verify steps.

## Scope boundaries

### Deferred to planning (HOW, not WHAT)
- Exact change-set computation (merged-PR/linked-issue retrieval via `gh`), the
  skill's prompt/format, the in-app modal's trigger/storage mechanics, and the CI
  workflow edits (tag regex, draft/prerelease flags, `body_path`, verify step).
- First-release handling when there is no prior tag.
- The bundling-window policy for in-app notes (which past versions ship in-app).

### Out of scope
- **Standard release tools** (changesets, release-please, semantic-release) — see
  Approach.
- **A top-level `CHANGELOG.md`** — per-version files + `docs/releases.md` index
  instead (TaskNotes parity).
- **A `manifest-beta.json` dedicated beta channel** — betas are prereleases via
  BRAT (R6).
- **Auto-publishing** — the manual publish gate stays (R4).
- Changing the Conventional-Commits convention or the existing build/CI for
  non-release concerns.

## Dependencies / assumptions

- **BRAT only sees published (pre)releases**, so a beta's approval == publishing it
  as a prerelease (drafts are invisible to BRAT). *(Verify in planning.)*
- The Obsidian Plugin Update Tracker reads the **GitHub release body** markdown
  with no special metadata contract. *(Matches TaskNotes; verify in planning.)*
- Attribution data (reporter/requester/tester) is discoverable from the PR and its
  **linked issues/threads** via the GitHub API; where it isn't, the maintainer adds
  it during review.
- The in-app modal fires once when the installed version **increases** (tracked in
  plugin `data.json`); first-install behavior is a planning detail.
- No new CI secret is required (generation is local; CI uses the default
  `GITHUB_TOKEN`).

## Open questions
- None blocking. (Direction probes for planning: which past versions to bundle
  in-app; whether beta notes are merged into the prod notes on promotion or kept
  as separate `-beta.N` entries.)

## Sources & research
- TaskNotes reference implementation (local `../tasknotes`): `.github/workflows/
  release.yaml` (tag-triggered build → draft release, `body_path`, attestation),
  `version-bump.mjs`, `generate-release-notes-import.mjs` (→ `src/releaseNotes.ts`
  in-app bundle), `scripts/update-release-index.mjs` (→ `docs/releases.md`),
  `docs/releases/*.md` (per-version notes; `-beta.N` files; "Thanks to @user"
  convention), `.npmrc` (`tag-version-prefix=""`).
- This repo: `.github/workflows/release.yml` (current `--generate-notes`,
  bare-semver-only, no draft), `version-bump.mjs`, `versions.json`,
  `CONTRIBUTING.md` (Conventional Commits).
