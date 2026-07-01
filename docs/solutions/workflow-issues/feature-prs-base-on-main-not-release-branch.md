---
title: Feature PRs must be based on main, not release/* branches
date: 2026-07-01
category: workflow-issues
module: release-pipeline
problem_type: workflow_issue
component: development_workflow
severity: high
applies_when:
  - Starting feature work or choosing a base branch for a new PR
  - A PR fails CI's "Assert manifest is a clean release version" build step
  - Recovering a branch that was mistakenly based on a release/* branch
  - Auditing or deleting leftover release/* branches
tags: [release, branch-model, manifest, ci-guard, non-fast-forward, rebase, force-push]
---

# Feature PRs must be based on main, not release/* branches

## Context

While building a feature (the "What's New" redesign), a branch was cut from `release/0.1.0-beta.4` — on the reasoning that `main` looked dormant and the release branch held the "current" work. The PR's `build` check then failed with:

```
##[error]manifest.json version '0.1.0-beta.4' is not a clean release version (X.Y.Z). A prerelease manifest must not merge to main.
```

`main` was actually the correct base all along. This documents *why* the release branches exist, *why* they diverge from `main`, and *how* to recover if you based on the wrong one.

## Guidance

**Always base feature branches on `main`.** `main`'s `manifest.json` is a clean `X.Y.Z` (e.g. `0.0.1`); `release/X.Y.Z-beta.N` branches carry a **prerelease** manifest by design and are **not** feature-PR targets. All prior feature PRs (#191–#195) targeted `main`.

**Why release branches carry a `-beta` manifest.** Per [docs/RELEASING.md](../../RELEASING.md) ("manifest-on-`main` invariant"), a `-beta` version must never land on `main` because that's the store-facing version. So a beta is cut *on a branch*: `npm version 0.1.0-beta.N` bumps `manifest.json` to the prerelease, regenerates the bundle + release index, and creates a version commit **plus an annotated tag**. CI triggers on the **tag** (not the branch) and opens a draft prerelease. The tag — and the published prerelease/BRAT entry — is the durable artifact; the `release/*` branch is just what briefly held the commit.

**Why they're "ahead of" main.** A release branch is ahead of `main` by exactly its beta-cut commits (the notes commit + the `npm version` bump) — commits *designed never to merge back* (they'd violate the clean-manifest invariant). Meanwhile `main` advances via feature PRs, so the release branch is *also* behind `main`. This is a **permanent, intentional divergence**; the branch was never meant to converge with `main`.

**The CI guard that enforces it.** [.github/workflows/ci.yml](../../../.github/workflows/ci.yml) has an **unconditional** `build` step, "Assert manifest is a clean release version (no prerelease suffix on main)", that fails **any** PR whose branch `manifest.json` doesn't match `^[0-9]+\.[0-9]+\.[0-9]+$`. Its comment says "on main", but there is no `if: github.base_ref == 'main'` — it runs on every PR regardless of base. So a branch that inherited a `-beta` manifest from a release base fails `build` even when the PR targets the release branch.

**Release branches are redundant after tagging.** The annotated tag's commit exactly equals the release-branch tip (`git rev-parse <tag>^{commit}` == `git rev-parse release/<tag>`). So the `release/*` branches are pure redundancy once tagged — safe to delete; the tag preserves the exact commit permanently.

## Why This Matters

Getting the base wrong blocks the merge on a red `build` check and forces a non-trivial recovery — in this case a closed PR (#196) and a fresh one (#197). It is a **repeatable trap**: any future agent that reasons "main is dormant, work on the release branch" will hit the same wall. On `main` the in-app "What's New" bundle is also **empty** (manifest `0.0.1`, betas out of the version window) — that is expected; the redesigned history only renders once a release is cut, so don't "fix" the empty bundle by moving work onto a release branch.

## When to Apply

- Before cutting a feature branch: base it on `origin/main`, not `release/*`.
- When a PR's `build` check fails on the clean-manifest assertion: the branch is carrying a `-beta` manifest — you based on (or merged from) a release branch.
- When auditing branches: `release/*` branches whose tag exists are deletable; the tag is the artifact.

## Examples

**Recovering a branch based on the wrong base.** Rebase the feature commits onto `main`, then reconcile the generated release artifacts to `main`'s manifest:

```bash
# Replay feature commits from the release base onto main
git rebase --onto origin/main <release-branch-HEAD-sha> <feature-branch>
# Resolve the generated-file conflicts by regenerating for main's manifest
node scripts/generate-release-notes-import.mjs   # bundle is empty at 0.0.1
node scripts/update-release-index.mjs
git add src/releaseNotes.ts docs/releases.md && GIT_EDITOR=true git rebase --continue
```

**The force-push wrinkle.** The rebase rewrites history, so it is NOT a fast-forward — and the repo's `non_fast_forward` ruleset rejects force-pushes to any existing branch (`! [remote rejected] ... push declined due to repository rule violations`). This is the *same* ruleset that blocks `@dependabot rebase`; there the fix is merge-main + regenerate + fast-forward push (same branch). Here, because history was rewritten, the fix is different: **push a new branch and open a fresh PR.**

```bash
git branch feat/whats-new-cards HEAD          # new branch at the rebased tip
git push --set-upstream origin feat/whats-new-cards   # brand-new branch = fast-forward, allowed
gh pr create --base main --head feat/whats-new-cards --title "..." --body "..."
gh pr close <old-PR> --comment "Superseded by #<new> (rebased onto main)."
```

Retargeting an existing PR's base (`gh pr edit N --base main`) is allowed but does **not** fix a wrong-base branch — the branch still carries the `-beta` manifest, so `build` still fails. The history must be rewritten (rebase) and re-pushed as a new branch.

**Confirming release branches are safe to delete.**

```bash
[ "$(git rev-parse 0.1.0-beta.4^{commit})" = "$(git rev-parse release/0.1.0-beta.4)" ] \
  && echo "tag preserves the commit — branch is redundant"
```

## Related

- [docs/RELEASING.md](../../RELEASING.md) — the canonical release process and the manifest-on-`main` invariant (the *why*).
- [.github/workflows/ci.yml](../../../.github/workflows/ci.yml) — the "Assert manifest is a clean release version" guard (the mechanical enforcement).
- [docs/solutions/tooling-decisions/build-provenance-attestation-requires-public-repo.md](../tooling-decisions/build-provenance-attestation-requires-public-repo.md) — sibling release-pipeline CI learning.
- PRs #196 (closed, wrong base) → #197 (merged, rebased onto `main`) — the concrete instance.
- The `non_fast_forward` ruleset here is the same one that blocks Dependabot's rebase; the recovery differs (new branch vs. lockfile resync) because rebasing rewrites history while Dependabot needs the same branch fast-forwarded.
