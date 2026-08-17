---
title: "WDIO runtime behavior needs a real run — static gates are necessary, never sufficient"
date: 2026-08-18
category: developer-experience
module: "e2e / WDIO test harness"
problem_type: developer_experience
component: testing_framework
severity: medium
supersedes: mts-configs-escape-typecheck-and-lint.md
applies_when:
  - "editing test/wdio/*.mts configs or harness helpers"
  - "adding or changing WebDriver commands used against the Obsidian/Electron driver"
  - "changing WDIO services, reporters, or hooks"
  - "tempted to call a .mts change done on green typecheck + lint"
tags:
  - wdio
  - e2e
  - mts-configs
  - typecheck
  - lint
  - runtime-verification
  - obsidian-electron
---

# WDIO runtime behavior needs a real run — static gates are necessary, never sufficient

## Context

This doc supersedes `mts-configs-escape-typecheck-and-lint.md` (2026-07-01), whose core claim is now false. That doc said `test/wdio/*.mts` sat outside both quality gates: typecheck didn't include them and eslint was restricted to `.ts`/`.svelte`, so even a parse-level syntax bug only surfaced when WDIO loaded the file.

Both halves of that claim are closed at current main (verified 2026-08-18):

- **Typecheck covers the tree.** `typecheck` runs `svelte-check --tsconfig tsconfig.json && npm run typecheck:test` (package.json:19), and `typecheck:test` includes `tsc -p tsconfig.test-e2e.json` (package.json:20). `tsconfig.test-e2e.json` has `"include": ["test/specs", "test/wdio"]`, so the `.mts` configs are typechecked. The e2e program went green in PR #433 and was wired into `npm run typecheck` in PR #434 (test-tree typecheck gate, 2026-08-17).
- **Lint covers the tree.** `lint` is `eslint . --max-warnings 0` with no extension restriction (package.json:18); eslint.config.mjs:33 targets `**/*.{ts,tsx,mts}` and eslint.config.mjs:148 adds a dedicated `test/**/*.{ts,mts}` block.

Do not re-claim the old escape: a syntax-class bug in a `.mts` config (the historical example was a glob `../specs/**/*.e2e.ts` inside a JSDoc comment terminating the comment early, producing an esbuild `Unexpected "*"` at load) would now fail the typecheck gate before WDIO ever ran.

What survives — and is the point of this successor — is the class of defect static gates cannot see: WDIO's load-time and runtime behavior.

## Guidance

**A change to a `.mts` config or harness file is proven only by running WDIO — through the config the change touches.** Green typecheck and lint are necessary, never sufficient. For `wdio.conf.mts` run `npm run e2e:local` (or a fast targeted spec via `--spec`); for `wdio.perf.conf.mts` run `npm run perf:e2e` — the e2e run never loads the perf config, so it proves nothing about it.

The runtime-only defect classes, each with a real occurrence in this repo:

1. **Unsupported WebDriver commands in the Obsidian/Electron driver.** `browser.setWindowSize()` type-checks and lints perfectly but fails at runtime with `unknown command: 'Browser.getWindowForTarget'` — the Obsidian/Electron WebDriver simply doesn't implement it. Window sizing must be best-effort, wrapped in try/catch.
2. **Launcher-vs-worker config lifecycle.** WDIO evaluates the config in the launcher and again in every worker session, so module-scope side effects run once in the launcher plus once per spec — 40 evaluations for a 39-spec run, not one. On 2026-08-17 (PR #436), a module-scope `fs.rmSync` in `test/wdio/wdio.conf.mts` passed typecheck and lint cleanly while deleting earlier specs' reporter session files at runtime — a 39-spec run silently merged to 1 spec with all gates green. Full detail: [wdio-config-reimport-wipes-cross-session-state.md](../test-failures/wdio-config-reimport-wipes-cross-session-state.md).
3. **Service, reporter, and hook behavior.** How services wire up, when hooks fire, and what the driver actually supports are all runtime contracts invisible to `tsc` and eslint.

## Why This Matters

The type system models the WebDriver *protocol surface*, not what this particular driver implements; it models module shape, not how many times WDIO imports the module or in which process. Both harness bugs above shipped through fully green static gates, and the PR #436 one degraded the e2e denominator itself — the gate that was supposed to catch regressions quietly shrank from 39 specs to 1. Static-green confidence on harness code is exactly the false confidence the old doc warned about, just moved one layer down: from syntax to semantics.

## When to Apply

- Any edit under `test/wdio/` — configs, helpers, services, reporters.
- Introducing a WebDriver/browser command not already used by a passing spec: assume it may be unimplemented in the Obsidian/Electron driver until a run proves otherwise.
- Adding anything at module scope in a WDIO config: reason about per-worker re-import first, then verify with a multi-spec run.
- Before claiming a harness change done: the receipt is a WDIO run, not a green `npm run typecheck && npm run lint`.

## Examples

- **Closed (historical):** comment-terminating glob in a JSDoc block in a `.mts` config — was invisible to all gates in 2026-07, now caught by `tsc -p tsconfig.test-e2e.json`.
- **Still live:** `browser.setWindowSize()` throwing `unknown command: 'Browser.getWindowForTarget'` — keep window sizing best-effort in try/catch.
- **Still live:** module-scope cleanup in `wdio.conf.mts` running per worker session and wiping cross-session reporter state (PR #436).

## Related

- [../test-failures/wdio-config-reimport-wipes-cross-session-state.md](../test-failures/wdio-config-reimport-wipes-cross-session-state.md) — the worker re-import lifecycle failure in full
- [windows-build-and-e2e-environment-setup.md](windows-build-and-e2e-environment-setup.md)
- [headless-e2e-verification-for-ui-work.md](headless-e2e-verification-for-ui-work.md)
