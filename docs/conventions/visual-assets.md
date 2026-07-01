# Visual Assets

How images and GIFs that illustrate UI changes are captured, stored, and
referenced in PRs and release notes. Assets live **in the repo** — they are never
uploaded to catbox or any other external host.

## Where assets live

- One shared folder: `docs/media/`.
- Named by **feature**, not by version — the same file serves the PR that
  introduces the feature and every release that mentions it. Use a kebab-case
  slug: `docs/media/focus-on-task.gif`.
- When a feature is shown in both light and dark, commit two files with a theme
  suffix: `focus-on-task-dark.gif` and `focus-on-task-light.gif`. Omit the suffix
  for a single-theme asset.
- Assets are binary and accumulate in git history permanently. Keep them small —
  prefer a tight GIF or a single PNG over a long recording.

## How assets are referenced

Reference assets **only** by an absolute `raw.githubusercontent.com` URL, using
markdown image syntax:

    ![alt text](https://raw.githubusercontent.com/renatomen/tasknotes-gantt/<ref>/docs/media/<feature>.gif)

- **Never** use a relative path. Release notes render both on the GitHub release
  page and in the in-app "What's New" view, and neither resolves a relative repo
  path.
- **Never** use raw HTML (`<img>`, `<video>`, `<picture>`). The release-notes
  generator rejects raw HTML and fails the build (`findRawHtml` in
  `scripts/releaseFiles.mjs`). Animated GIFs work as markdown images; there is no
  supported path for `<video>` in release notes.
- Pin the `<ref>`:
  - **PR body** → the branch name or the commit SHA (no release tag exists yet).
  - **Release notes** → the release tag (e.g. `0.1.0`).

## Permanence

- Once a shipped release references an asset, that asset is **permanent**: never
  delete, rename, or move it, and never delete or force-move the release tag its
  URL is pinned to. Old "What's New" entries resolve their images against that tag
  for the life of every install that shipped with them.
- Re-recording a demo updates the file at HEAD for future references; it does not
  touch older releases, which stay pinned to their original tag and bytes.
  Pixel-identical re-records are not guaranteed — re-records are reviewed, not
  diffed.
- This is a **convention guard, not a git guarantee**: tags are technically
  mutable and `raw.githubusercontent` serves whatever the tag currently points at.
  The release-notes validator enforces asset presence and URL form for releases
  still in the notes window only; it cannot verify remote reachability of an
  arbitrary ref.

## Demo director — staging a capture

The agent capturing a demo decides how it should look, applying these defaults
with judgment:

- **Window: maximized** by default — use the plugin's in-Obsidian maximize
  (`.og-fullscreen-toggle` → `.is-maximized`), **not** native browser fullscreen.
  Native fullscreen uses the browser top layer and hides Obsidian popups (modals,
  menus, Notices), so a demo of a modal/menu interaction would capture a blank
  popup. Minimize only when the un-maximized layout is the point of the demo.
- **Side panels: closed** by default. Open a panel only when it is relevant to
  what is being shown.
- **Theme:** choose light or dark by relevance; capture **both** when the feature
  looks materially different across them. Set the base theme via Obsidian's config
  (`obsidian` = dark, `moonstone` = light) and assert `document.body` carries
  `theme-dark` / `theme-light`. Do **not** use `wdio-obsidian-service`'s
  `setTheme()` — it selects a *community* theme, not the light/dark base scheme.
- **Vault:** stage against a disposable in-repo fixture vault (`test/vaults/*`),
  never the live `OBSIDIAN_TEST_VAULT`. Fix the window/viewport size and anchor the
  fixture's task dates so a Gantt (which positions bars relative to "today")
  renders stably.

## Static image vs GIF vs none

Per change, the director records which of these applies:

- **Animated GIF** — motion or interaction (drag, zoom, expand/collapse,
  multi-step flows). Capture by driving Obsidian via WDIO and recording the window
  with an external recorder — WDIO captures stills only.
- **Static image** — a discrete before/after or a new surface. Capture with the
  WDIO helper (`npm run capture:demo`), which stages Obsidian and calls
  `browser.saveScreenshot()`.
- **None** — no observable UI change (internal refactor, config, docs-only).
  Record the decision; no asset is required.

`/release` reuses a feature's committed `docs/media/` asset in the notes, re-pinned
to the release tag, and prompts the maintainer (parking a reminder in
`docs/backlog.md`) when a UI-affecting change shipped without one.
