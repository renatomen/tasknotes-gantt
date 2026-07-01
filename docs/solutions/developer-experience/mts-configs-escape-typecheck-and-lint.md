---
title: WDIO .mts config files escape typecheck and lint — verify by running
date: 2026-07-01
category: developer-experience
module: e2e / WDIO test harness
problem_type: developer_experience
component: testing_framework
severity: medium
applies_when:
  - Editing any test/wdio/*.mts (wdio.conf.mts, wdio.perf.conf.mts) or adding a new WDIO config or spec
  - A .mts change passes npm run typecheck and npm run lint but the WDIO job has not been run
tags: [wdio, mts, typecheck, eslint, esbuild, e2e, static-analysis]
---

# WDIO .mts config files escape typecheck and lint — verify by running

## Context

`test/wdio/*.mts` files (the WDIO configs — `wdio.conf.mts`, `wdio.perf.conf.mts`,
and any new one) sit **outside both quality gates**:

- `npm run typecheck` (`svelte-check --tsconfig tsconfig.json`) does not include
  `test/wdio/*.mts` in its program, so it never type-checks them.
- `npm run lint` (`eslint . --ext .ts,.svelte`) restricts by extension to `.ts` and
  `.svelte`; `.mts` is not matched, and no flat-config block targets it either.

A parse/syntax bug in a `.mts` config therefore passes **both** gates cleanly and only
fails when WDIO actually loads the file (esbuild/tsx transform at run time). "Green
locally" is not evidence a `.mts` config is correct.

## Guidance

After editing any `test/wdio/*.mts` (or adding a `*.capture.ts` / `*.e2e.ts` a new
config points at), **verify it by running the WDIO job**, not by trusting typecheck +
lint. A quick `wdio run ./test/wdio/<config>.mts` (or `npm run e2e` / `npm run perf:e2e`)
surfaces load-time and runtime failures the static gates structurally cannot see.

## Why This Matters

Two real bugs shipped past both green gates in a single session (2026-07-01), each only
caught by an actual WDIO run:

1. **A glob inside a JSDoc block comment closed the comment early.** `../specs/**/*.e2e.ts`
   contains `*/` (the second `*` of `**` plus the following `/`), which terminates a
   `/* … */` block → esbuild `Unexpected "*"`. Keep globs out of block comments in `.mts`.
2. **`browser.setWindowSize()` is unsupported in the Obsidian/Electron WebDriver**
   (`unknown command: 'Browser.getWindowForTarget'`). None of the specs resize; window
   sizing must be best-effort (try/catch) there.

Both looked correct to `typecheck` and `lint`. Only booting WDIO revealed them.

## When to Apply

- Editing or adding any `test/wdio/*.mts` config.
- Reviewing a PR whose only "green" evidence for a WDIO/config change is typecheck + lint.
- Adding a new WDIO spec type or config the base run excludes.

## Examples

Bug 1 — comment-terminating glob (passes typecheck + lint, fails esbuild on load):

```mts
/**
 * Runs the *.capture.ts specs, which the base config's ../specs/**/*.e2e.ts glob
 * never matches.   <-- the "**/*" here closes the block comment early → parse error
 */
```

Fix: reword so the glob isn't a literal `**/*` inside the comment (e.g. "the base
config's e2e spec glob under `../specs`").

Bug 2 — unsupported WebDriver command (passes both gates, throws at run time):

```mjs
// throws: unknown command 'Browser.getWindowForTarget'
await browser.setWindowSize(1440, 900);

// best-effort instead — the Obsidian WebDriver may not implement window/rect
try { await browser.setWindowSize(1440, 900); } catch { /* keep launched size */ }
```

## Related

- `developer-experience/windows-build-and-e2e-environment-setup.md` — sibling
  "a green build/gate does not mean it runs" lesson; canonical reference for the
  `.mts` configs and how to run the WDIO job.
- `developer-experience/headless-e2e-verification-for-ui-work.md` — same "trust the
  real harness run, not a proxy gate" family.
