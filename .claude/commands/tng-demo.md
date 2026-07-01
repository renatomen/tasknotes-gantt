---
description: Generate the visual assets (GIFs/screenshots) a PR or release needs to illustrate UI changes for users — judgment-driven, text-driven, fixtures-only, committed to docs/media/. Uses ce-demo-reel; never catbox.
---

# /tng-demo — illustrate a PR or release with visuals

Produce the images and animations that a PR description or release notes need so
users can *see* what changed. This is the **default visual step** in the pipeline:
`/tng-release` calls it after drafting notes, and the commit/PR flow calls it for
UI-affecting changes. It exercises **judgment** — not every change earns a demo — and
is **text-driven**: the notes decide what visuals go where.

The convention is authoritative: read
[docs/conventions/visual-assets.md](../../docs/conventions/visual-assets.md) for
storage, naming, referencing, permanence, and the demo-director staging checklist.

`$ARGUMENTS` may name the target (a PR number, `release`, or a path to the notes
file). If empty, infer from context: an open PR's description, or the drafted
`docs/releases/<version>.md` / `docs/releases/unreleased.md`.

## Step 1 — Judge whether visuals are warranted

Read the change set and the user-facing text. Decide per case:

- **Warranted** — a new/changed view, control, interaction, or visible layout/theme
  change: something a user would recognize on screen.
- **Not warranted** — docs-only, refactors, config, build/CI, internal logic with no
  observable UI. Record "no visual" and stop; do not manufacture a demo.

Not every PR earns a demo. Say plainly when none is needed.

## Step 2 — Plan the visuals from the text

Work from the **already-drafted** PR description or release notes — the visuals serve
the text, not the other way around. For each user-facing section/item, decide:

- **Animated GIF** — motion or interaction (drag, zoom, expand/collapse, multi-step
  flows). This is the default for "show the feature doing its thing."
- **Static image** — a discrete before/after or a new surface where motion adds
  nothing.
- **None** — the prose already suffices.

Then decide **one combined demo vs. several short ones**: if several items are one
coherent flow, a single clip can cover them; if they're independent, produce a short,
section-scoped asset per item so each release-note section has its own illustration.
Prefer short and relevant over long and comprehensive.

Produce a brief plan: `<section> → <gif|image|none> → <feature-slug>`.

## Step 3 — Generate each asset with ce-demo-reel (fixtures only)

Use **`ce-demo-reel`** as the recording engine — it drives Obsidian and records
automatically. For each planned asset:

- **Target a committed fixture**, never a real vault. Use `test/vaults/*`; **recycle
  the scenario an existing e2e already stages** where one fits (`test/specs/*.e2e.ts` +
  its fixture). This is the privacy guarantee — no real/private data can appear.
- **Apply the house staging** (from the convention): window **maximized** (the plugin's
  in-Obsidian maximize, not native fullscreen), **side panels closed**, sensible theme
  (capture both light and dark only when the feature differs materially between them).
- **Save locally — never catbox / litterbox / R2.** ce-demo-reel's "Save locally"
  destination; the asset gets committed to the repo in the next step.

If exercising the feature requires setup ce-demo-reel can't do headlessly, say so and
fall back to a static image rather than skipping evidence silently.

## Step 4 — Land each asset in the repo

For each produced file, run the landing script:

```bash
node scripts/addVisualAsset.mjs <produced-file> <feature-slug> [--theme dark|light] [--ref <ref>]
```

It copies the file to `docs/media/<feature-slug>[-theme].<ext>` and prints the pinned
markdown `![]()`. Ref defaults to the current branch (PR context); `/tng-release`
passes `--ref <version>` so release notes pin to the tag. Commit the asset(s) with the
change.

## Step 5 — Insert references into the text

Place each printed `![]()` into the **matching section** of the PR description or
release notes — next to the prose it illustrates. Use markdown image syntax only
(never raw HTML); the release-notes generator and the image validator reject anything
else and fail the build.

## Guardrails

- **Fixtures only** — a demo must never open or show a real/private vault.
- **In the repo, not catbox** — every asset lands in `docs/media/` via Step 4.
- **Markdown `![]()` only**, pinned `raw.githubusercontent` URLs (PR → branch/SHA,
  release → tag).
- **Judgment first** — skipping visuals for a non-visual change is the correct outcome,
  not a gap.
