---
date: 2026-07-01
topic: release-visual-assets
---

# Release & PR visual assets — requirements

## Summary

Establish a repo-committed convention for the images and GIFs that illustrate
UI/UX changes in PRs and release notes, and wire `/release` to use it. Assets
live in the repo (proposed: `docs/media/`), are named by feature, and are
referenced by pinned `raw.githubusercontent` URLs — never catbox. A "demo
director" checklist governs how each demo is staged and WDIO drives the capture
against real Obsidian. `/release` reuses a PR's committed asset when one exists
and prompts the maintainer when a UI-affecting PR shipped without one.

## Problem Frame

Release 0.1.0-beta.3 already produced the *right* artifact by hand — a GIF
committed at `docs/releases/assets/0.1.0-beta.3-focus.gif` and referenced by a
tag-pinned raw URL — but nothing about that pattern is documented or encoded,
to the point that its own author couldn't recall where the asset lived. Two
gaps follow: (1) `/release` ([.claude/commands/release.md](.claude/commands/release.md))
says nothing about visuals, so adding them is a manual, easy-to-forget step;
and (2) the PR path relies on `ce-demo-reel`, whose default is to upload to
catbox — an external host with link-rot risk and no provenance, and the wrong
source of truth for images that must render in-app permanently.

The stakes are higher than a normal PR image because release notes render in
**two** places: the GitHub release page and the in-app "What's New" view
([src/release/ReleaseNotesView.ts](src/release/ReleaseNotesView.ts)). That view
is shipped inside the plugin bundle and lives for the life of the install, so
any image it references must remain reachable indefinitely.

## Key Decisions

- **Committed in-repo, pinned by absolute URL — never catbox.** Assets are
  committed to the repo and referenced by `raw.githubusercontent` URLs pinned
  to an immutable ref. This is the only form that renders in *both* the GitHub
  release page and the in-app view; relative paths render in neither.

- **Shared pool, feature-named.** One folder of assets named by feature/slug
  (not by version). The same committed file is referenced by the PR body and by
  every release that mentions that feature — no per-release duplication.

- **Pin PRs to a commit/branch ref, pin releases to the tag.** The PR body
  references the asset at a SHA/branch (no release tag exists yet); the release
  note references the *same* file pinned to the release tag. Tag immutability is
  what keeps a shipped "What's New" entry showing the exact bytes from its
  release forever.

- **Convention + thin orchestration, not a new command or per-demo scripts.**
  A repo-committed convention doc is the source of truth; `/release` and the
  PR/commit flow reference it and reuse `ce-demo-reel` / WDIO for the raw
  capture, redirecting output into the repo. `ce-demo-reel` itself is not
  edited — it lives in the plugin cache and edits there are non-durable.

- **Demo director is judgment-based guidance, executed via WDIO ad-hoc.** The
  convention encodes staging defaults; the capturing agent applies judgment per
  demo and drives real Obsidian through WDIO. No reproducible per-demo script is
  committed.

- **Reuse-first hybrid; fresh capture at release time is a prompt, not an
  automated re-record.** Re-staging a feature that merged weeks ago is expensive
  and error-prone, so `/release` prefers the committed PR asset and asks the
  maintainer when one is missing.

## Requirements

### Storage convention

- R1. A committed convention document (proposed:
  `docs/conventions/visual-assets.md`) is the single source of truth for asset
  location, naming, referencing form, and the demo-director checklist. Both
  `/release` and the PR/commit flow point to it rather than re-describing the
  rules.
- R2. Visual assets are committed to a single shared folder (proposed:
  `docs/media/`), named by feature/slug, not by version
  (e.g. `focus-on-task.gif`).
- R3. When a feature is demonstrated in both light and dark themes, the two
  takes are distinct files under a documented suffix convention
  (e.g. `focus-on-task-dark.gif` / `focus-on-task-light.gif`).
- R4. Assets are referenced only by absolute `raw.githubusercontent` URLs. PR
  references pin to a commit SHA or branch; release-note references pin to the
  release tag. Relative paths are never used.

### Permanence

- R5. Once a shipped release references an asset, that asset (and the ref it is
  pinned to) is permanent: never deleted, renamed, or moved. The in-app "What's
  New" view depends on it remaining reachable for the life of every install
  that shipped with that note.
- R6. Re-recording a feature's demo adds/updates the file at HEAD for future
  references; it does not invalidate older releases, which stay pinned to their
  original tag and bytes.

### Demo director

- R7. The convention defines staging defaults the capturing agent applies with
  judgment: Obsidian window **maximized** by default (minimized only when
  relevant to the demonstration); side panels **closed** by default (open only
  when relevant); theme chosen by relevance, capturing **both** light and dark
  when the difference matters.
- R8. The capture is driven against real Obsidian via WDIO so the director's
  staging choices are actually honored (ce-demo-reel's generic browser/CLI
  tiers cannot stage Obsidian window state, panels, or theme).
- R9. The director decides per change whether the evidence is an animated GIF
  (motion/interaction), a static image (discrete state), or none (no observable
  UI change), and records that choice.

### `/release` orchestration

- R10. When drafting notes, `/release` identifies UI/UX-affecting changes in the
  change set since the last release tag.
- R11. For each UI-affecting change, `/release` reuses the feature's committed
  asset when one exists, embedding it in the notes pinned to the new release
  tag.
- R12. When a UI-affecting change shipped without a committed asset, `/release`
  flags it and prompts the maintainer — offering to direct-and-capture fresh or
  to proceed without — rather than silently omitting a visual or capturing
  unattended.
- R13. `/release` remains draft-only: it never tags, commits, or publishes
  (unchanged from today). Any fresh capture it performs produces files for the
  maintainer to review and commit as part of the normal release procedure.

### PR-time capture path

- R14. The PR/commit flow captures visual evidence for UI-affecting changes into
  the shared repo folder (per R2–R4) instead of uploading to catbox, so the
  asset exists in the repo for later reuse by `/release`.
- R15. The PR body embeds the asset by its commit/branch-pinned raw URL (per R4).

## Key Flows

- F1. **PR-time capture.** A UI-affecting change is built → the agent authors a
  demo-director staging plan → WDIO drives Obsidian and records the artifact →
  the artifact is committed to the shared folder under the naming convention →
  the PR body embeds it by a commit/branch-pinned raw URL.
- F2. **Release drafting — asset present.** `/release` scans changes since the
  last tag → finds a UI-affecting change with a committed asset → embeds it in
  the notes pinned to the new release tag.
- F3. **Release drafting — asset missing.** `/release` finds a UI-affecting
  change with no committed asset → flags it and prompts the maintainer → on
  request, directs and captures fresh (files left for maintainer review) or
  proceeds without a visual.

## Acceptance Examples

- AE1. **Covers R11, R4.** Given a release whose change set includes a feature
  with a committed `docs/media/` asset, the drafted notes embed that asset via a
  URL pinned to the new release tag, and the image renders on both the GitHub
  release page and the in-app view.
- AE2. **Covers R12.** Given a UI-affecting PR that merged without any committed
  asset, `/release` surfaces it to the maintainer with the choice to capture or
  skip — it does not silently produce notes with no visual.
- AE3. **Covers R9.** Given a change with no observable UI effect (e.g.
  internal refactor, config-only), the director records "no visual" and
  `/release` requires none.
- AE4. **Covers R3, R7.** Given a feature whose appearance differs materially
  between light and dark themes, two committed takes exist under the suffix
  convention and the notes/PR reference the relevant one(s).
- AE5. **Covers R5.** Given an asset referenced by a shipped release, an attempt
  to delete or rename it is rejected by the convention — the file remains so
  older "What's New" entries keep rendering.

## Scope Boundaries

Deferred for later:
- Committed, reproducible per-demo director scripts (WDIO demo specs) that
  re-record identically on UI change. Guidance + ad-hoc WDIO is the chosen form;
  a reproducible-spec tier can be revisited if re-recording churn justifies it.

Outside this effort's identity:
- Editing `ce-demo-reel` itself — it is a shared plugin-cache skill; changes
  there are non-durable and overwritten on plugin update. The repo owns only the
  convention and the orchestration that wraps the capture.
- Git LFS or other binary-asset optimization. Feature-named + shared pool
  already minimizes duplication; LFS is over-engineering for a solo plugin.
- Version-named asset folders / per-release asset duplication (the beta.3
  filename shape), superseded by the shared feature-named pool.
- Offline rendering of in-app images. Committed-but-remote assets need network
  access to render in "What's New"; appearing broken offline is an accepted
  tradeoff.

## Dependencies / Assumptions

- The WDIO e2e harness can drive real Obsidian for capture (`npm run e2e:local`
  path is wired and verified on dev machines).
- A demo vault / fixture with representative data is needed to stage realistic
  demos; capturing at PR time keeps that scenario fresh. The exact fixture
  strategy is a planning-level detail.
- `ce-demo-reel` remains available as the generic capture/upload engine, but its
  destination is redirected to the repo rather than catbox for this project.
- Rendering in both targets assumes GitHub and the reader's Obsidian can reach
  `raw.githubusercontent.com`.

## Outstanding Questions

Deferred to planning:
- How `/release` detects "UI/UX-affecting" changes from the change set (PR
  labels, changed-path heuristics, or maintainer confirmation).
- Exact demo-vault / fixture approach for WDIO-driven capture.
- How the PR-time capture path integrates with the existing commit/PR flow
  (which skill or step owns the redirect-to-repo and the pinned-URL embed).

## Sources / Research

- Prior-art asset + reference form:
  commit `57e9ba1`, [docs/releases/0.1.0-beta.3.md](docs/releases/0.1.0-beta.3.md)
  and `docs/releases/assets/0.1.0-beta.3-focus.gif`.
- Current release command: [.claude/commands/release.md](.claude/commands/release.md)
  and the draft template [docs/releases/unreleased.md](docs/releases/unreleased.md).
- Dual render target: [src/release/ReleaseNotesView.ts](src/release/ReleaseNotesView.ts)
  (in-app "What's New" markdown render) and the GitHub release page.
- Capture engine and its catbox default: the `ce-demo-reel` skill
  (compound-engineering plugin) and its `references/upload-and-approval.md`.
- Existing conventions home: [docs/conventions/](docs/conventions/).
