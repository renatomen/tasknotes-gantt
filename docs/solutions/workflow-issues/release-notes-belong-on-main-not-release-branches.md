---
title: "Release notes belong on main; only the -beta manifest bump belongs on a throwaway branch"
date: 2026-07-01
category: workflow-issues
module: release-process
problem_type: workflow_issue
component: release_tooling
severity: high
applies_when:
  - "cutting a -beta prerelease for TaskNotes Gantt"
  - "the in-app What's New bundle is regenerated at npm version time from docs/releases/*.md"
  - "main's manifest.json must stay a clean X.Y.Z (store-facing) and CI fails a -beta suffix on main"
  - "a new beta is cut fresh from main and cannot see notes committed only on a prior beta's branch"
  - "someone is tempted to branch feature work off an existing release/* branch"
tags:
  - release-process
  - release-notes
  - whats-new-bundle
  - beta-releases
  - branching-model
  - solo-maintainer
---

# Release notes belong on main; only the -beta manifest bump belongs on a throwaway branch

## Context

Two consecutive TaskNotes Gantt releases hit confusion, and both traced to **one** root cause.

Since `0.1.0-beta.1`, every beta has been cut with the identical shape: fork a commit on `main`, add
**two** commits — (1) the `docs/releases/X.md` notes file, (2) the `npm version` manifest bump — tag
it, and abandon the branch. Verified across all five betas (`git merge-base --is-ancestor <tag> main`
is false for every one; each is exactly 2 commits ahead of a fork point that *is* on main). So the
releases *were* cut from main — but **nothing ever flows back to main**.

That single fact — release artifacts committed on a branch that is never merged — produced both failures:

1. **A feature branch got based on `release/0.1.0-beta.4`** (the What's New redesign, PR #196). Because
   that branch carries the `-beta` manifest, CI's "manifest must be clean on main" guard failed the PR.
   Fix was to rebase onto `main` and reopen as #197. The dangling, ahead-of-main release branch was a
   trap lying around to be built on.
2. **`beta.4` was silently dropped from `beta.5`'s in-app "What's New" bundle.** `npm version`
   regenerates `src/releaseNotes.ts` from the `docs/releases/*.md` files **present on the branch being
   cut**. `beta.5` forked from `main`, where the notes present were `beta.1/2/3` (manually backfilled by
   #197) but **not** `beta.4` — its notes only ever existed on `beta.4`'s abandoned branch. So the
   history rendered `beta.5 → beta.3`, hiding the full-screen fix. It had to be recovered from the
   `0.1.0-beta.4` tag mid-release (`git checkout 0.1.0-beta.4 -- docs/releases/0.1.0-beta.4.md docs/media/…`)
   before the bundle was whole.

The design error is **conflating two things with opposite destinations into one unmerged branch**: the
`-beta` manifest bump *must not* reach `main` (it is the store-facing version, CI-enforced), but the
release *notes* absolutely *should* reach `main` (they are durable history the next release's bundle
regenerates from). Throwing both onto a dead-end branch throws away the thing that should persist.

## Guidance

**Split the two. Notes go to `main`; only the manifest bump goes to a throwaway branch.**

**1. Land the notes on `main` first, via a normal PR with no manifest change.** Commit
`docs/releases/X.Y.Z-beta.N.md` plus its `docs/media/*` assets to a docs branch and PR it to `main`.
It carries no version bump, so it sails past the clean-manifest guard. Now `main` permanently
accumulates the complete release-notes history, and every future bundle regeneration sees everything —
**no backfill is ever needed again.**

**2. Cut the beta from `main` on a branch that does only the `npm version` bump + tag.** That
`release/*` branch is still never merged (correct — the `-beta` manifest must stay off `main`), but it
now holds *nothing anyone would want to branch from* and *no notes that can go missing*. Delete it
after publishing.

**Stable releases don't have this problem:** `npm version X.Y.Z` sets a *clean* `X.Y.Z` manifest, which
is allowed on `main`, so a stable's notes + bump land on `main` directly. Only betas need the split.

**Never branch feature work off a `release/*` branch.** Features branch from `main` and PR into `main`
(see `docs/conventions/git-workflow.md`). A `release/*` branch is a release artifact, not a base.

## Why it works

The in-app bundle's source of truth is "the `docs/releases/*.md` files on the branch at `npm version`
time." Making `main` the single place all notes accumulate means the source of truth is always
complete when a release is cut from `main`. The only thing that legitimately must stay off `main` is the
prerelease manifest string — and that is the *only* thing the throwaway branch now carries.

## Follow-up (not done here)

A sturdier long-term fix is to have `scripts/generate-release-notes-import.mjs` read notes from the
release **tags** rather than the working tree — the tags are the real immutable source of truth, so the
bundle would be correct regardless of what any branch happens to contain. Larger change; parked in
`docs/backlog.md`.

## See also

- `docs/RELEASING.md` — the two-step beta procedure this learning encodes.
- `.claude/commands/tng-release.md` — drafts the notes destined for `main`.
- The manifest-on-main invariant and the CI guard in `.github/workflows/ci.yml`.
