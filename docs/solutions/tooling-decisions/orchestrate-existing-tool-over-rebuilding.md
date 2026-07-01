---
title: Orchestrate an existing capable tool instead of rebuilding it
date: 2026-07-01
category: tooling-decisions
module: visual-assets / demo pipeline
problem_type: tooling_decision
component: tooling
severity: medium
applies_when:
  - A capable tool already performs the core job (e.g. ce-demo-reel for automated Obsidian demo capture)
  - You are tempted to build a bespoke in-repo implementation of that same capability
tags: [ce-demo-reel, build-vs-adopt, orchestration, scope, demo-capture, visual-assets]
---

# Orchestrate an existing capable tool instead of rebuilding it

## Context

The visual-assets feature needed demo GIFs/screenshots for PR bodies and release
notes, stored in-repo (not catbox). `ce-demo-reel` already **automates** demo capture
— it drives the app (including the Obsidian Electron app) and records GIFs with no
hand-staging. Despite that, the first implementation built a **WDIO static-screenshot
helper** (a dedicated capture config, a spec, a `captureDemo.mjs`, a `capture:demo`
script, an eslint carve-out). It was static-only — a *competing, less-capable*
automation path — and it deferred the animated GIFs that were the actual goal. It was
then removed.

## Guidance

When a capable tool already does the core job, the repo should own the **convention +
a thin landing step + validation** *around* that tool — **not a competing
implementation** of it. Divide it as:

- **Tool** (external, e.g. `ce-demo-reel`): does the hard part (drive the app, record).
- **Convention** (`docs/conventions/…`): where output goes, how it's named/referenced.
- **Landing** (a small script, e.g. `scripts/addVisualAsset.mjs`): deterministic
  bridge from "tool produced a file" to "repo references it correctly."
- **Validation** (build-time): reject non-conforming references so mistakes fail CI.
- **Orchestration** (a skill/command, e.g. `/tng-demo`): judgment + wiring, invoking
  the tool and the landing step.

## Why This Matters

- **Less code doing more.** The end state was strictly *less* code than the WDIO helper
  it replaced, yet delivered the thing actually wanted (animated GIFs) instead of a
  lesser substitute (stills).
- **Two tools for one job is a coherence cost.** Every future "add a demo" moment would
  have had a "which path?" fork, for no gain.
- **Reproducibility you already declined isn't worth rebuilding for.** The bespoke
  helper's only edge was push-button reproducibility — a capability the team had
  already deferred; rebuilding a competitor to regain it was net-negative.
- The dropped WDIO helper is **intentionally gone** — don't resurrect it; generate
  demos via `ce-demo-reel` + `/tng-demo`.

## When to Apply

- Any build-vs-adopt decision where an external tool already covers the capability.
- When you catch yourself scaffolding a second way to do something a tool already does
  — especially if the home-grown version is less capable than the tool.

## Examples

Before → after (same goal: committed demo assets referenced in PR/release notes):

```
Before (rebuild):
  WDIO capture config + spec + captureDemo.mjs + capture:demo script + eslint carve-out
  → static screenshots only; animated GIFs deferred; a second automation path

After (orchestrate around ce-demo-reel):
  docs/conventions/visual-assets.md         (convention)
  scripts/visualAssets.mjs + repoInfo.mjs   (naming/URL rules)
  scripts/addVisualAsset.mjs                (landing: file → docs/media/ + pinned URL)
  scripts/releaseFiles.mjs                  (build-time validation)
  .claude/commands/tng-demo.md              (orchestration: judgment + ce-demo-reel + landing)
  → animated GIFs from the tool you already use; less code; one path
```

## Related

- `tooling-decisions/test-at-the-fastest-level-not-redundant-e2e.md` — same decision
  family: don't build redundant infrastructure when a capable path already exists;
  hard-to-build / less-capable is a design signal.
- `architecture-patterns/obsidian-plugin-fullscreen-maximize-not-native.md` — the
  contrast case: there the standard component *couldn't* meet the requirement, so
  hand-rolling was correct. The test is capability against the requirement, not
  "built-in vs. home-grown" per se.
