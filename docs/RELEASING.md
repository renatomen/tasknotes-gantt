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

Betas are published **prereleases** (no `manifest-beta.json`):

```bash
/tng-release beta
git add docs/releases/X.Y.Z-beta.N.md
git commit -m "docs(release): X.Y.Z-beta.N notes"
npm version X.Y.Z-beta.N      # manifest only — versions.json stays clean (store map)
git push --follow-tags
# CI opens a draft PRERELEASE; verify provenance, then publish as a prerelease:
gh release edit X.Y.Z-beta.N --draft=false --prerelease
```

Testers receive it via [BRAT](https://github.com/TfTHacker/obsidian42-brat) once
they've added `renatomen/tasknotes-gantt`. Plugin Update Tracker hides prereleases
from non-beta users by default.

### Two things to know about betas

- **manifest-on-`main` invariant.** A `-beta` version in `manifest.json` must never
  land on `main` — it is the store-facing version. Cut betas on a **branch** (or
  otherwise ensure `main`'s `manifest.json` stays a clean `X.Y.Z`); the stable
  `npm version X.Y.Z` is what updates the store-facing manifest. CI enforces this:
  `ci.yml` fails a PR whose `manifest.json` version carries a prerelease suffix.
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
