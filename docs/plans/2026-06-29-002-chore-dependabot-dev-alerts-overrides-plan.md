---
title: "chore(deps): Resolve PR #181 residual dev-only Dependabot alerts via scoped npm overrides"
type: chore
status: active
date: 2026-06-29
plan_id: 2026-06-29-002
origin: docs/plans/2026-06-28-003-chore-resolve-dependabot-prs-plan.md
---

# chore(deps): Resolve PR #181 residual dev-only Dependabot alerts via scoped npm overrides

## Summary

PR [#181](https://github.com/renatomen/tasknotes-gantt/pull/181) merged the full open-Dependabot-PR sweep and recorded two residual findings. One of them — the `gantt-column-sort` e2e first-mount flake — was **already resolved** by PR #182 (`fix(e2e): close gantt-column-sort first-mount flake via specific-header readiness gate`). This plan addresses the **remaining** residual: the dev-only Dependabot security backlog.

That backlog has since shrunk from the 12 alerts noted in #181 to **3 open alerts**, all **development-scope, transitive** dependencies (production audit `npm audit --omit=dev` remains **0 vulnerabilities**). #181 assumed these were gated behind `--force` **breaking major bumps** of the e2e framework and deferred them. This plan tests a surgical alternative #181 did not attempt: **scoped npm `overrides`** that pin each patched transitive version in place without upgrading its parent — then verifies the full harness still passes. Each override that breaks the toolchain falls back to an explicit, documented hold rather than a force-fix.

---

## Problem Frame

Three Dependabot alerts remain open on `renatomen/tasknotes-gantt`, all in the dev/test toolchain:

| Alert | Package | Severity | Vulnerable | Patched | Reached via |
|-------|---------|----------|-----------|---------|-------------|
| #88 | `js-yaml` | MEDIUM | ≤ 4.1.1 | 4.2.0 | `mocha`→js-yaml@4.1.0; `eslint`→`@eslint/eslintrc`→js-yaml@4.1.0 (deduped); `jest`→…→`@istanbuljs/load-nyc-config`→js-yaml@**3.14.1** |
| #87 | `@babel/core` | LOW | ≤ 7.29.0 | 7.29.6 | jest/babel ecosystem (current 7.28.4, many dedupes) |
| #84 | `serialize-javascript` | MEDIUM | ≥5.0.0 <7.0.5 | 7.0.5 | `@wdio/mocha-framework`→`mocha`→serialize-javascript@6.0.2 |

These are not production-exposed — none ships in `dist/main.js`, and the runtime dependency tree (`@svar-ui/svelte-gantt`) is untouched. But they sit as open alerts in the repo's security tab, and the DoS/file-read advisories are real for the dev toolchain (CI, local test runs). A senior team closes these promptly when a low-risk fix path exists, and documents an explicit hold when it does not — it does not leave them silently open indefinitely.

**Goal:** every one of the 3 alerts reaches a terminal, defensible state — patched via a verified `overrides` pin, or explicitly held/dismissed with a durable written reason — without regressing the build, unit, perf, or e2e harness, and without a `--force` major bump of the e2e framework.

---

## Requirements

- **R1** — Each of the 3 open alerts (#88 js-yaml, #87 @babel/core, #84 serialize-javascript) reaches a terminal state: patched-and-verified, or explicitly held with a documented reason. None left silently open.
- **R2** — No override is merged without the full verification harness passing at CI parity: `npm ci`, lint, typecheck, unit tests, `perf:isolated`, build, bundle hygiene, `npm audit --omit=dev --audit-level=high`, **and** `npm run e2e:local` (the overrides touch the mocha/WDIO e2e path directly, so e2e is a first-class gate here per AGENTS.md).
- **R3** — Production audit posture is preserved: `npm audit --omit=dev` stays at **0 vulnerabilities** and `dist/main.js` content is unchanged (overrides only move dev-tree transitives).
- **R4** — `js-yaml` overrides are **scoped** so the `@istanbuljs/load-nyc-config` consumer (which requires `js-yaml@^3.x` and uses the removed-in-v4 `safeLoad` API) is not force-upgraded into a broken state.
- **R5** — Git conventions honored: branch first (never commit to `main`), conventional commits, squash-merge behind green CI, no AI attribution.
- **R6** — Any override that genuinely breaks the toolchain is **not** force-merged: revert that single override, dismiss/hold the corresponding alert with a written reason (`@dependabot ignore` or a tracked dismissal note), and record it as a residual finding.

---

## Key Technical Decisions

### KTD1 — Fix via scoped `overrides`, not parent major bumps

npm `overrides` (already-supported in this repo's npm 8 / Node 24 toolchain) let us pin a single patched transitive without upgrading its parent. This sidesteps the breaking `@wdio/mocha-framework` ← `mocha` major bump that #181 cited as the blocker. The risk model changes from "does a major framework bump break us" (large, entangled) to "does each parent tolerate one newer transitive" (small, independently testable per package). Each override is added independently so a single incompatible one can be reverted without losing the others.

*Why not just wait for Dependabot's major-version PRs?* Those carry far more blast radius (whole-framework majors), and two of these three advisories are MEDIUM DoS issues worth closing now via the low-risk path.

### KTD2 — `js-yaml` override must be scoped, not global

`js-yaml` resolves to two majors in this tree: **4.1.0** (via `mocha` and `@eslint/eslintrc`) and **3.14.1** (via `jest` → `@istanbuljs/load-nyc-config`). The advisory's vulnerable range `≤ 4.1.1` technically includes the 3.x instance, but the only patched version is `4.2.0` — a different major. `@istanbuljs/load-nyc-config` declares `js-yaml@^3.10.0` and calls `safeLoad`, which was **removed** in js-yaml v4. A global `"js-yaml": "4.2.0"` override would force the 3.x instance up and risk breaking jest's coverage-config loading.

**Decision:** scope the override to the 4.x consumers only — nested overrides such as `"mocha": { "js-yaml": "4.2.0" }` and `"@eslint/eslintrc": { "js-yaml": "4.2.0" }` — leaving the 3.14.1 instance in place. If, after this, alert #88 persists *solely* because of the deduped 3.14.1 instance (js-yaml 3.x is EOL with no in-major fix), that residual is a documented hold under R6, not a force-upgrade of the istanbul loader. Confirm empirically during U1 whether GitHub re-evaluates #88 as resolved once the 4.x instances are patched.

### KTD3 — `serialize-javascript` and `@babel/core` are lower-risk single-target overrides

- **`@babel/core` → `^7.29.6`**: same-major (7.x) bump from 7.28.4; the babel plugin ecosystem is designed for in-major interop, so version skew risk is low. Likely the safest of the three.
- **`serialize-javascript` → `^7.0.5`**: a 6→7 major bump of a leaf utility consumed by `mocha` for its reporter/diff serialization. Single consumer, leaf position. Verify mocha's test-run output is unaffected (the e2e + unit runs exercise it). 7.0.6 is also available if 7.0.5 misbehaves.

### KTD4 — Verify at CI parity, e2e included

Because the overrides land squarely in the test/e2e toolchain (mocha, WDIO, jest, babel), unit tests alone cannot prove safety. Mirror `.github/workflows/ci.yml` locally and additionally run `npm run e2e:local` before opening the PR, then let CI (including the real-Obsidian e2e job) be the gate of record on merge. This matches the #181 posture of treating toolchain-governing changes as first-class e2e gates.

### KTD5 — Lockfile regeneration follows the established resync technique

After editing `overrides`, regenerate `package-lock.json` with `npm install --package-lock-only` (then a clean `npm ci` to confirm install integrity), per the repo's documented Dependabot resync technique. Push as normal commits (no force-push) so the "All Branches" ruleset (`non_fast_forward` block) is respected.

---

## Implementation Units

### U1. Add `js-yaml` scoped override and verify (#88)

- **Goal:** Patch the js-yaml 4.x instances to 4.2.0 without disturbing the 3.14.1 istanbul consumer, and determine whether alert #88 clears.
- **Requirements:** R1, R2, R3, R4.
- **Dependencies:** none.
- **Files:** `package.json` (`overrides`), `package-lock.json` (regenerated), `test/` (existing unit + e2e specs as verification, no new test files expected).
- **Approach:** Add scoped nested overrides pinning js-yaml to `4.2.0` for the `mocha` and `@eslint/eslintrc` consumers only (KTD2). Regenerate the lockfile (`npm install --package-lock-only`), then `npm ci`. Confirm `npm ls js-yaml --all` shows the 4.x instances at 4.2.0 and the istanbul instance still at 3.14.1. Run lint + typecheck + unit tests to confirm eslint and jest still operate. Check whether GitHub marks #88 resolved (or only partially, due to the EOL 3.x instance — see KTD2 / U5).
- **Execution note:** Probe `npm ci` cleanliness first — an ERESOLVE from the scoped override is the fastest failure signal.
- **Patterns to follow:** repo's Dependabot lockfile-resync technique (regenerate, never force-push).
- **Test scenarios:**
  - Happy path: `npm ci` resolves with no ERESOLVE; `npm run lint` and `npm run typecheck` pass (eslint's `@eslint/eslintrc` still loads YAML configs); full unit suite passes (jest coverage-config loading via the untouched 3.14.1 instance still works).
  - Tree assertion: `npm ls js-yaml --all` reports 4.2.0 at the mocha/eslint paths and 3.14.1 unchanged at the istanbul path.
  - Failure path: if the scoped override forces 3.14.1 upward or breaks jest coverage loading, capture the error and treat #88 as a hold candidate (U5).
  - Test expectation: no new test files — existing lint/typecheck/unit/e2e runs are the verification surface.

### U2. Add `@babel/core` override and verify (#87)

- **Goal:** Pin `@babel/core` to a patched 7.29.x and confirm the babel/jest toolchain is unaffected.
- **Requirements:** R1, R2, R3.
- **Dependencies:** none (independent of U1; combine into the same branch).
- **Files:** `package.json` (`overrides`), `package-lock.json` (regenerated).
- **Approach:** Add `"@babel/core": "^7.29.6"` to `overrides`. Same-major bump (KTD3), so risk is low. Regenerate lockfile, `npm ci`, run unit tests (jest uses babel for transform) to confirm no transform/coverage regression.
- **Test scenarios:**
  - Happy path: `npm ci` clean; full jest suite passes with babel transform intact; coverage still generated.
  - Tree assertion: `npm ls @babel/core --all` shows ≥ 7.29.6 at the resolved instance(s).
  - Test expectation: no new test files — jest unit run is the verification surface.

### U3. Add `serialize-javascript` override and verify (#84)

- **Goal:** Pin `serialize-javascript` to `^7.0.5` for the mocha consumer and confirm the WDIO/mocha e2e path is unaffected.
- **Requirements:** R1, R2, R3.
- **Dependencies:** none (independent; same branch).
- **Files:** `package.json` (`overrides`), `package-lock.json` (regenerated).
- **Approach:** Add `"serialize-javascript": "^7.0.5"` to `overrides` (single leaf consumer via mocha, KTD3). Regenerate lockfile, `npm ci`. The decisive verification is the mocha-driven e2e run (U4) — confirm reporter/diff output and the run itself are unaffected. If 7.0.5 misbehaves, try 7.0.6.
- **Test scenarios:**
  - Happy path: `npm ci` clean; `npm ls serialize-javascript --all` shows ≥ 7.0.5; mocha-based e2e run completes with normal reporter output (proven in U4).
  - Failure path: if mocha's serialization breaks under v7, revert this single override and route #84 to a hold (U5).
  - Test expectation: no new test files — the e2e run (U4) is the verification surface.

### U4. Full-harness verification at CI parity (including e2e)

- **Goal:** Prove the combined overrides regress nothing across the full pipeline before opening the PR.
- **Requirements:** R2, R3.
- **Dependencies:** U1, U2, U3 (verify the consolidated override set).
- **Files:** none (verification only); `.github/workflows/ci.yml` is the reference for step order.
- **Approach:** From the consolidated branch, run in CI order: `npm ci` → `npm run lint` → `npm run typecheck` → `npm test` → `npm run perf:isolated` → `npm run build` → `npm audit --omit=dev --audit-level=high` → bundle hygiene (`node scripts/check-bundle-hygiene.mjs`) → `npm run e2e:local`. Confirm `dist/main.js` is byte-stable in shape (single-file bundle, hygiene clean) and the perf virtualization invariant holds. Confirm `npm audit --omit=dev` is still 0.
- **Execution note:** This is the gate that justifies the overrides approach — the toolchain itself is what changed, so the e2e run is mandatory, not optional.
- **Patterns to follow:** mirror `.github/workflows/ci.yml` build + e2e jobs exactly so the local run faithfully previews CI.
- **Test scenarios:**
  - Build integrity: `npm run build` produces single-file `dist/main.js`; bundle hygiene passes (no network/eval/base64).
  - Perf invariant: `npm run perf:isolated` passes (mount+settle ceiling and virtualization window intact).
  - Integration: `npm run e2e:local` renders the Gantt in real Obsidian with no runtime regression and normal mocha reporter output (exercises serialize-javascript v7).
  - Audit posture: `npm audit --omit=dev --audit-level=high` reports 0; dev-tree alerts for the 3 packages no longer resolve to vulnerable versions (modulo the EOL js-yaml 3.x case).
  - Distinguish known e2e flakes (download/leaf-steal, see docs/solutions) from genuine override regressions before concluding a failure.

### U5. Resolve each alert to a terminal state and open the PR

- **Goal:** Land the verified overrides and drive each of the 3 alerts to closed-or-held.
- **Requirements:** R1, R5, R6.
- **Dependencies:** U4.
- **Files:** `package.json`, `package-lock.json` (final consolidated state).
- **Approach:** Branch on per-alert outcome:
  - **Override verified green** → include it in the PR; the alert auto-resolves once merged to `main` and Dependabot re-scans.
  - **Override breaks the toolchain (any of #88/#87/#84)** → revert that single override, and put the alert into an explicit hold: dismiss it in the security tab with reason "tolerable risk / no fix without breaking change" or `@dependabot ignore`, and record it under residual findings. No force-fix (R6).
  - **#88 partially resolved** (4.x patched but 3.14.1 EOL instance keeps the alert open) → document the residual: the istanbul-loader 3.x instance has no in-major fix and upgrading it breaks coverage loading; held as accepted dev-only risk.
  - Open the PR with the conventional title, the per-alert resolution table, and the verification evidence. Squash-merge behind green CI (R5).
- **Verification:** PR open with documented per-alert outcomes; CI green; after merge, `gh api .../dependabot/alerts` shows each of #88/#87/#84 either `fixed` or `dismissed` with a recorded reason — none silently `open`.
- **Test scenarios:** Test expectation: none beyond U4's harness — this unit is the resolution/merge gate, not new behavior.

---

## Scope Boundaries

**In scope:** the 3 currently-open dev-scope Dependabot alerts (#88 js-yaml, #87 @babel/core, #84 serialize-javascript); the minimal scoped `overrides` and lockfile regeneration needed to patch or explicitly hold each.

**Out of scope:**
- The `gantt-column-sort` e2e flake residual from #181 — **already resolved** by PR #182.
- Broad dependency upgrades Dependabot has not flagged.
- `--force` major bumps of `@wdio/mocha-framework` / `mocha` / the e2e framework (KTD1 deliberately avoids these).
- Production-dependency changes (`@svar-ui/svelte-gantt` and the runtime tree are untouched).

### Deferred to Follow-Up Work
- If the js-yaml 3.x istanbul instance keeps #88 open, revisit when `jest`/`babel-plugin-istanbul`/`@istanbuljs/load-nyc-config` ship a js-yaml-4 compatible line, or when Dependabot opens the corresponding major-version PR.
- Re-evaluate any held alert when the upstream framework offers a non-breaking patched line.

---

## Risks & Dependencies

- **Scoped-override miss on js-yaml (most likely partial outcome):** the EOL 3.14.1 instance may keep #88 flagged; mitigated by KTD2's scoping decision and the U5 documented-hold path. Do not force-upgrade the istanbul loader (R4).
- **serialize-javascript 6→7 major behavior change:** a leaf utility, single consumer (mocha); verified by the e2e run (U4). Fallback 7.0.6, else hold (R6).
- **Override resolution / ERESOLVE:** any scoped override can produce a peer conflict; probe `npm ci` first in each unit (fastest fail signal).
- **e2e flakiness:** the WDIO real-Obsidian path has known intermittent download/leaf-steal modes (docs/solutions). Distinguish a known flake from a genuine override regression before concluding U4 failed.
- **Branch protection:** squash-merge behind green CI; push normal commits (no force-push) to respect the `non_fast_forward` ruleset.

---

## Verification Strategy

- Per-override units (U1–U3): `npm ci` cleanliness + targeted toolchain checks (lint/typecheck for js-yaml, jest for babel, e2e for serialize-javascript) + `npm ls` tree assertions.
- Consolidated (U4): full CI-parity harness mirroring `.github/workflows/ci.yml` **plus** `npm run e2e:local`; production audit stays 0; `dist/main.js` shape stable.
- Terminal-state audit (U5): after merge, `gh api repos/renatomen/tasknotes-gantt/dependabot/alerts` shows #88/#87/#84 each `fixed` or `dismissed` with a recorded reason — zero of them silently `open`.
