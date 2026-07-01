---
date: 2026-07-01
topic: restore-beta3-release-gif
status: active
type: fix
---

# fix: Restore the beta.3 focus GIF to the backfilled release note

## Summary

Recover the beta.3 focus-feature GIF (pruned from HEAD in prior housekeeping, but still present at the `0.1.0-beta.3` tag) and re-add its image line to [docs/releases/0.1.0-beta.3.md](../../docs/releases/0.1.0-beta.3.md), so the note renders complete when the release is shown. Restore the asset at the legacy path the note's tag-pinned URL references (satisfies the build gate + renders from the immutable tag) and also place a canonical copy under `docs/media/`.

---

## Problem Frame

The beta.3 backfill (PR #197) shipped text-only: the original focus GIF was dropped because the asset `docs/releases/assets/0.1.0-beta.3-focus.gif` was deleted from HEAD in later housekeeping, and the generator's `findMissingAssetRefs` gate ([scripts/releaseFiles.mjs](../../scripts/releaseFiles.mjs)) fails the build when a note references a committed asset absent at HEAD. The GIF still exists immutably at the `0.1.0-beta.3` tag, so its tag-pinned raw URL still resolves on GitHub — the gate is HEAD-based and doesn't know that.

**Constraint (established this session):** the note's image URL must (a) be tag/SHA-pinned (`findInvalidImageRef` → `isReleaseRef`, [scripts/visualAssets.mjs](../../scripts/visualAssets.mjs)) and (b) have its parsed repo-path present at HEAD (`findMissingAssetRefs`). No tag serves the GIF at a canonical `docs/media/` path yet, and SHA-pins to a feature-branch commit are fragile under squash-merge. So the only ref that both resolves now and passes the gate is the **`0.1.0-beta.3` tag at the legacy `docs/releases/assets/` path**. On `main` the What's New bundle is empty (manifest `0.0.1`) until a release is cut, so this is forward-looking — it ensures the image is present when the note renders at release time.

---

## Key Technical Decisions

- **Note references the `0.1.0-beta.3`-tag legacy URL.** It's the only URL that renders now (immutable tag) and passes both image gates once the asset is restored at HEAD at the matching legacy path.
- **Restore the asset at the legacy path AND keep a canonical copy.** `docs/releases/assets/0.1.0-beta.3-focus.gif` is required to satisfy the gate for the tag URL; `docs/media/focus-on-task.gif` is added per the visual-assets convention so the asset is canonically available for future/online use (this realizes the user's "copy to canonical, keep the original" intent). The canonical copy is currently unreferenced — that is intentional and acceptable.
- **Recover bytes from the tag, do not regenerate.** `git show 0.1.0-beta.3:docs/releases/assets/0.1.0-beta.3-focus.gif` is the authoritative source (208 KB); byte-identical recovery avoids re-encoding.

---

## Implementation Units

### U1. Recover the GIF asset to both locations

- **Goal:** Bring the pruned GIF back into the working tree at the legacy path (for the gate) and the canonical path (for convention).
- **Dependencies:** none.
- **Files:** `docs/releases/assets/0.1.0-beta.3-focus.gif` (restore), `docs/media/focus-on-task.gif` (new canonical copy).
- **Approach:** Recover the bytes from the tag (`git show 0.1.0-beta.3:docs/releases/assets/0.1.0-beta.3-focus.gif`) and write both files identically. Confirm both are tracked and byte-identical to the tag blob. Do not re-encode.
- **Test scenarios:** `Test expectation: none — binary asset restore.` Presence/validity is enforced by U2's build-gate pass.
- **Verification:** both files exist at HEAD; `git cat-file -s` on the restored legacy file matches the tag blob size (208362 bytes).

### U2. Re-add the image line and keep the build gates green

- **Goal:** Restore the image in the note and confirm the whole release-file pipeline stays green.
- **Dependencies:** U1.
- **Files:** [docs/releases/0.1.0-beta.3.md](../../docs/releases/0.1.0-beta.3.md); regenerated [src/releaseNotes.ts](../../src/releaseNotes.ts) and [docs/releases.md](../../docs/releases.md) (via the scripts, not hand-edited).
- **Approach:** Append the original image markdown after the focus-feature bullets: `![Focus on a task — search for a task, expand its collapsed parent, then zoom, scroll, and highlight it](https://raw.githubusercontent.com/renatomen/tasknotes-gantt/0.1.0-beta.3/docs/releases/assets/0.1.0-beta.3-focus.gif)`. Regenerate the bundle + index with the scripts (bundle stays empty on `main`'s `0.0.1`; the gates still run over the note). Do not change the generator or the gate.
- **Patterns to follow:** the image-line format used by the beta.4 note at its tag — inspect via `git show 0.1.0-beta.4:docs/releases/0.1.0-beta.4.md` (beta.4.md is not in the working tree on this branch); tag-pinned `raw.githubusercontent` URL, feature-named canonical asset per [docs/conventions/visual-assets.md](../../docs/conventions/visual-assets.md).
- **Test scenarios:**
  - The existing `test/unit/releaseNotesBundle.test.ts` "real release notes" test still passes — `readReleaseEntries` over `docs/releases/` raises no gate error (date comment present, no raw HTML, image ref is tag-pinned, asset present at HEAD) and still lists `beta.1–3`.
  - `Covers gate.` A full build (`buildStart` runs the release-file validation) succeeds — the beta.3 image no longer trips `findMissingAssetRefs`.
- **Verification:** `npm test` green; `npx vite build` succeeds (release-file gates pass); the beta.3 note in `docs/releases/0.1.0-beta.3.md` contains the image line pointing at the tag URL.

---

## Scope Boundaries

- **In scope:** restoring the beta.3 GIF (both locations) and its note image line.
- **Out of scope / deferred:** canonicalizing the *online* GitHub Release bodies to point at `docs/media/` links (needs a release tag that serves the canonical path — a release-cut concern); beta.4's image (not on this branch); widening the bundle window. No changes to the generator, the gates, or the view.

---

## Risks & Dependencies

- **Re-adds a pruned asset (low).** Housekeeping removed `docs/releases/assets/`; this reintroduces one file there. Accepted per the user's decision; the note needs the legacy path to render via the tag URL.
- **Gate coupling (low).** The note URL path and the HEAD asset path must match exactly, or `findMissingAssetRefs` fails. Mitigation: restore at the exact `docs/releases/assets/0.1.0-beta.3-focus.gif` path the URL parses to.

---

## Sources & Research

- Gates: [scripts/releaseFiles.mjs](../../scripts/releaseFiles.mjs) (`findMissingAssetRefs`, `findInvalidImageRef`, `readReleaseEntries`), [scripts/visualAssets.mjs](../../scripts/visualAssets.mjs) (`isReleaseRef`, `parseRawAssetUrl`).
- Generator/index: [scripts/generate-release-notes-import.mjs](../../scripts/generate-release-notes-import.mjs), [scripts/update-release-index.mjs](../../scripts/update-release-index.mjs).
- Convention: [docs/conventions/visual-assets.md](../../docs/conventions/visual-assets.md).
- Asset source: git tag `0.1.0-beta.3`, blob `docs/releases/assets/0.1.0-beta.3-focus.gif` (208362 bytes).
