# Releasing TaskNotes Gantt

The release process is **review-gated**: release notes are AI-drafted, the
maintainer reviews and edits them, and nothing reaches users until the maintainer
**publishes** the draft GitHub release. One reviewed source —
`docs/releases/<version>.md` — feeds the GitHub release body, the in-app "What's
New" view, and the [`docs/releases.md`](releases.md) index.

There are **two approval beats**:

1. **Edit the notes file** (`docs/releases/<version>.md`) before tagging — this
   content is bundled into the plugin at build time, so it must be locked first.
2. **Publish the draft release** — CI creates the release as a *draft*; publishing
   is the final go-live action.

## Prerequisites

- Node 20 (`fnm`/`nvm`), `npm ci` done.
- The [`gh`](https://cli.github.com/) CLI, authenticated.
- `.npmrc` already sets `tag-version-prefix=""`, so `npm version` produces bare
  tags (no `v`).

## Cut a stable release

A stable `npm version X.Y.Z` sets a **clean** `X.Y.Z` manifest, which *is* allowed on
`main` — so a stable's notes and version bump land on `main` directly (commit below, or
via a PR to `main`). No throwaway branch, and the notes persist on `main` by
construction. Only **betas** need the notes-to-`main`-first split described below.

```bash
# 1. Draft the notes, then review & edit docs/releases/X.Y.Z.md
#    (the /tng-release command writes it; check the date line, thanks, and links).
/tng-release stable

# 2. Commit the reviewed notes file (npm version needs a clean tree).
git add docs/releases/X.Y.Z.md
git commit -m "docs(release): X.Y.Z notes"

# 3. Bump the version. This runs the `version` script, which:
#    - sets manifest.json to X.Y.Z and adds X.Y.Z -> minAppVersion to versions.json
#    - regenerates src/releaseNotes.ts (the in-app bundle) and docs/releases.md
#    - stages those, then npm creates the version commit + the bare tag X.Y.Z
npm version X.Y.Z

# 4. Push the commit and the tag.
git push --follow-tags
```

CI then builds from source, runs the bundle-hygiene check, attests
`main.js` + `styles.css` + `manifest.json`, and opens a **draft** GitHub release
whose body is `docs/releases/X.Y.Z.md`.

```bash
# 5. Verify provenance on the draft's assets, THEN publish (the final gate).
gh release download X.Y.Z --dir /tmp/X.Y.Z          # the draft's attached assets
gh attestation verify /tmp/X.Y.Z/main.js --repo renatomen/tasknotes-gantt
gh release edit X.Y.Z --draft=false                  # publish
```

Publishing makes it available to the community store and the
[Plugin Update Tracker](https://github.com/swar8080/obsidian-plugin-update-tracker);
users who update see the in-app "What's New" view once.

## Cut a beta (for BRAT testers)

Betas are published **prereleases** (no `manifest-beta.json`). A beta is cut in **two
steps**: the **notes land on `main` first** (a normal PR, no version bump), then the
**manifest bump + tag** happen on a throwaway `release/*` branch. This split is the
important part — see [Why notes go to `main` first](#why-notes-go-to-main-first).

**Step 1 — land the notes on `main` (PR, no manifest change).**

```bash
/tng-release beta       # drafts docs/releases/X.Y.Z-beta.N.md (+ /tng-demo assets)
git checkout -b docs/release-X.Y.Z-beta.N-notes origin/main
git add docs/releases/X.Y.Z-beta.N.md docs/media/<assets>
git commit -m "docs(release): X.Y.Z-beta.N notes"
git push -u origin docs/release-X.Y.Z-beta.N-notes
gh pr create --base main --fill      # NO manifest change → the clean-manifest guard passes
# review + squash-merge to main
```

**Step 2 — cut the beta from `main` (manifest bump + tag only).**

```bash
git fetch origin main
git checkout -b release/X.Y.Z-beta.N origin/main   # main now carries the notes
npm version X.Y.Z-beta.N      # manifest only — versions.json stays clean (store map).
                              # Regenerates the in-app bundle from ALL notes now on main;
                              # watch the "bundled: …" line to confirm no version is missing.
git push --follow-tags -u origin release/X.Y.Z-beta.N
# CI opens a draft PRERELEASE; verify provenance, then publish as a prerelease:
gh release download X.Y.Z-beta.N --dir /tmp/X.Y.Z-beta.N
gh attestation verify /tmp/X.Y.Z-beta.N/main.js --repo renatomen/tasknotes-gantt
gh release edit X.Y.Z-beta.N --draft=false --prerelease
```

The `release/*` branch exists only to keep the `-beta` manifest off `main`; it is
**never merged**. Delete it after publishing.

Testers receive it via [BRAT](https://github.com/TfTHacker/obsidian42-brat) once
they've added `renatomen/tasknotes-gantt`. Plugin Update Tracker hides prereleases
from non-beta users by default.

### Why notes go to `main` first

`npm version` regenerates the in-app "What's New" bundle from the `docs/releases/*.md`
files **present on the branch being cut**. If a release's notes live only on that
release's own (never-merged) `release/*` branch, the **next** beta — cut fresh from
`main` — can't see them and silently drops that version from the history. This bit
`0.1.0-beta.5`, which omitted `beta.4` until it was recovered from the tag mid-release.
Landing notes on `main` first makes `main` the single place all history accumulates, so
every regeneration is complete and **no backfill is ever needed**. The one thing that
legitimately must stay off `main` — the `-beta` manifest string — is the *only* thing
the throwaway branch carries. Full rationale:
[docs/solutions/workflow-issues/release-notes-belong-on-main-not-release-branches.md](solutions/workflow-issues/release-notes-belong-on-main-not-release-branches.md).

### Three things to know about betas

- **manifest-on-`main` invariant.** A `-beta` version in `manifest.json` must never
  land on `main` — it is the store-facing version. That is the *whole* reason for the
  Step 2 `release/*` branch; the stable `npm version X.Y.Z` is what updates the
  store-facing manifest. CI enforces this: `ci.yml` fails a PR whose `manifest.json`
  version carries a prerelease suffix.
- **Never branch feature work off a `release/*` branch.** Those branches sit ahead of
  `main` with a `-beta` manifest; a feature based on one inherits that manifest and
  **fails CI's clean-manifest guard** (this is what happened to PR #196 → #197). Always
  branch features from `main`.
- **Beta → stable upgrade gap.** A tester on `X.Y.Z-beta.N` will **not**
  auto-upgrade to the stable `X.Y.Z` (semver-wise `X.Y.Z-beta.N` < `X.Y.Z`, but
  Obsidian's updater won't re-flag it). Tell testers to re-check in BRAT after the
  stable ships, or they'll pick it up on the next patch (`X.Y.Z+1`).

## Notes

- The release workflow rejects malformed tags and **fails fast if the matching
  `docs/releases/<TAG>.md` is missing** — so always commit the notes file before
  tagging.
- Drafts are invisible to BRAT and the store; only **published** (pre)releases are
  distributed. The draft window is your review opportunity.
