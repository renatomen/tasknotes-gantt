---
title: "chore(deps): Resolve all open Dependabot PRs"
type: chore
status: active
date: 2026-06-28
plan_id: 2026-06-28-003
---

# chore(deps): Resolve all open Dependabot PRs

## Summary

Resolve the four open Dependabot pull requests on `renatomen/tasknotes-gantt` autonomously, with verification commensurate to a mature senior development team: every bump is validated against the local test harness (lint, typecheck, unit tests, isolated perf gate, build, dependency audit, bundle hygiene) before merge, and the one major build-tooling bump additionally gets a real WDIO e2e run because it touches the toolchain the e2e harness itself depends on.

The four PRs are **not** equal risk. Three are low-risk patch/security/transitive bumps that only move `package-lock.json` (or a single pinned action SHA). One — **#163** — is a coordinated **major** bump of `vite` (7→8) and `@sveltejs/vite-plugin-svelte` (6→7) that edits `package.json` and directly governs `npm run build`, the Vitest perf gate, and the Svelte compile path. The plan treats them with proportionate rigor: fast-path the safe three, hard-gate the risky one.

---

## Problem Frame

Dependabot has opened four PRs that have accumulated (oldest 2026-06-20, newest 2026-06-27). Left unmerged they (a) leave a **known security fix unapplied** (undici 6.27.0 addresses four CVEs), (b) drift the lockfile away from the latest patched transitive tree, and (c) let the major build-tool bump rot into merge conflicts. A senior team resolves these promptly but does not blind-merge — each is verified, and the major bump is validated end-to-end because a broken build tool would silently poison every downstream PR's CI.

**Goal:** all four PRs reach a terminal, defensible state — merged when green, or explicitly held with a documented reason if a bump genuinely breaks the toolchain and cannot be repaired within scope.

---

## The Four PRs (source of truth)

| PR | Bump | Kind | Files touched | Risk |
|----|------|------|---------------|------|
| #165 | `actions/attest-build-provenance` 4.1.0→4.1.1 | GitHub Actions, patch (pinned SHA) | `.github/workflows/release.yml` | Low |
| #141 | `undici` 6.21.3→6.27.0 | dev/transitive, **security** (4 CVEs) | `package-lock.json` | Low |
| #126 | `tar` 7.5.1→7.5.16 | dev/transitive, patch | `package-lock.json` | Low |
| #163 | `vite` 7→8 **and** `@sveltejs/vite-plugin-svelte` 6→7 | dev, **major** (build tooling) | `package.json`, `package-lock.json` | **High** |

---

## Requirements

- **R1** — Every PR is resolved to a terminal state (merged, or held with a written, durable reason). No PR is left silently open.
- **R2** — No PR is merged without the local verification harness passing on its head state at the level proportionate to its risk (see Key Technical Decisions).
- **R3** — The undici security fix (#141) is applied (it is the highest-value bump).
- **R4** — The major vite/svelte-plugin bump (#163) is validated against the **full** harness including a real WDIO e2e run, because it governs the build and test toolchain itself.
- **R5** — Merges respect the repo's git conventions: squash-merge, behind green CI, branch protection honored, no AI attribution.
- **R6** — If #163 breaks the toolchain, it is either repaired in-scope (e.g., a coordinated peer-dep bump) or held with the failure documented on the PR — never force-merged.

---

## Key Technical Decisions

### KTD1 — Two-tier verification by risk

**Low-risk tier (#165, #141, #126):** lockfile-only or single-SHA changes that cannot alter source behavior. Verification = let GitHub CI run to green on the PR head, plus a confirming local smoke (`npm ci` + `npm run build` + `npm test`) on the consolidated state. These do not individually need a local e2e.

**High-risk tier (#163):** full local harness on the PR branch — `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run perf:isolated`, `npm run build`, `npm audit --omit=dev --audit-level=high`, bundle hygiene, **and** `npm run e2e:local` (real Obsidian via WDIO). Rationale: vite/vite-plugin-svelte are the compile+bundle path; a regression here is invisible to unit tests but fatal to the plugin. This is the one bump where e2e is a first-class gate per AGENTS.md, not optional.

*Rationale:* matches effort to blast radius — the senior-team posture of "verify proportionately, don't blind-merge and don't over-ceremony a SHA pin."

### KTD2 — Merge order: safe-first, risky-last

Merge #165, #141, #126 first (each rebases trivially), then tackle #163 last against an already-updated `main`. This isolates the major bump so that if its CI fails, the failure is unambiguously attributable to vite/svelte-plugin and not entangled with the other three. After each merge, the remaining Dependabot PRs are rebased (`@dependabot rebase` or auto) so each is verified against current `main`.

### KTD3 — #163 peer-dependency conflict is the primary risk to probe

`vite@8` raises its Node floor (Node 20.19+/22.12+) and may not satisfy the peer ranges of `vitest@4.1.9`, `@vitest/browser`, `vitest-browser-svelte`, or `@sveltejs/vite-plugin-svelte@7`. CI installs with `npm ci --ignore-scripts`; a lockfile that resolves locally can still fail `npm ci` on a peer conflict. **First action on #163 is a clean `npm ci` from its lockfile** to surface any `ERESOLVE` before running the rest of the harness. If a conflict exists, the fix is a coordinated bump (e.g., move vitest to a vite-8-compatible line) committed onto the Dependabot branch, or — if that exceeds reasonable scope — hold the PR with the conflict documented (R6).

### KTD4 — Prefer merging Dependabot's own branch over re-authoring

Push fixups onto the existing `dependabot/...` branch only when a coordinated bump is required (KTD3). Otherwise merge as-is. Never `@dependabot recreate` after manual edits (it discards them). CI is the gate of record; local runs are the fast pre-check.

---

## Implementation Units

### U1. Verify and merge #165 (attest-build-provenance SHA patch)

- **Goal:** Land the GitHub Actions patch bump.
- **Requirements:** R1, R2, R5.
- **Dependencies:** none.
- **Files:** `.github/workflows/release.yml` (already changed by the PR).
- **Approach:** This is a pinned-SHA patch of a release-only action; it does not run in PR CI (release.yml triggers on release, not pull_request). Confirm the new SHA `0f67c3f4856b2e3261c31976d6725780e5e4c373` corresponds to the official `v4.1.1` tag, confirm CI (ci.yml) is green on the PR head, then squash-merge.
- **Verification:** PR checks green; new SHA matches the upstream `v4.1.1` tag; PR merged and branch deleted.
- **Test scenarios:** Test expectation: none — CI-config SHA pin, no behavioral source change. Provenance: confirm the SHA resolves to `actions/attest-build-provenance@v4.1.1` upstream before trusting the pin.

### U2. Verify and merge #141 (undici 6.27.0 security fix)

- **Goal:** Apply the undici security bump (4 CVEs).
- **Requirements:** R1, R2, R3, R5.
- **Dependencies:** none (lockfile-only; orthogonal to #165).
- **Files:** `package-lock.json` (already changed by the PR).
- **Approach:** undici is a transitive dev dependency (pulled by the WDIO/obsidian-launcher download path). Lockfile-only change. Let CI run to green, confirm `npm audit --omit=dev` is unaffected (undici is dev-tree), squash-merge. Rebase remaining PRs after.
- **Verification:** PR checks green (including the e2e job, since undici lives in the e2e download path); merged.
- **Test scenarios:** Test expectation: none — transitive lockfile bump. Integration signal: the e2e job's TaskNotes-release download still succeeds (exercises undici), which CI's e2e job proves.

### U3. Verify and merge #126 (tar 7.5.16 patch)

- **Goal:** Land the tar transitive patch bump.
- **Requirements:** R1, R2, R5.
- **Dependencies:** none.
- **Files:** `package-lock.json` (already changed by the PR).
- **Approach:** Lockfile-only transitive patch. Let CI run to green, squash-merge.
- **Verification:** PR checks green; merged.
- **Test scenarios:** Test expectation: none — transitive lockfile patch.

### U4. Full-harness validation of #163 (vite 8 + vite-plugin-svelte 7 major bump)

- **Goal:** Determine whether the major build-tooling bump is safe, and either green-light it or surface the blocker.
- **Requirements:** R2, R4, R6.
- **Dependencies:** U1, U2, U3 (validate against an already-updated `main`; rebase #163 first).
- **Files:** `package.json`, `package-lock.json` (already changed by the PR). Possibly a coordinated devDependency bump if KTD3 surfaces a conflict.
- **Approach:**
  1. Check out the rebased `dependabot/npm_and_yarn/multi-cd7b0543c9` branch locally.
  2. **`npm ci`** from the PR lockfile — surface any `ERESOLVE`/peer conflict first (KTD3).
  3. Run the full harness in CI order: `lint` → `typecheck` → `test` → `perf:isolated` (installs Chromium) → `build` → `npm audit --omit=dev --audit-level=high` → bundle hygiene (`node scripts/check-bundle-hygiene.mjs`).
  4. Run `npm run e2e:local` (real Obsidian via WDIO) — the gate that justifies treating this bump specially.
  5. Confirm `dist/main.js` still builds as a single-file bundle and the perf virtualization invariant still holds.
- **Execution note:** Probe peer-dependency resolution (`npm ci`) **before** spending time on the rest of the harness — it is the fastest fail signal and the most likely failure mode.
- **Patterns to follow:** mirror the exact step sequence in `.github/workflows/ci.yml` (build job + e2e job) so the local run is a faithful preview of CI.
- **Test scenarios:**
  - Happy path: `npm ci` resolves with no `ERESOLVE`; all existing unit tests pass unchanged under the new Vite.
  - Build integrity: `npm run build` produces `dist/main.js`; bundle hygiene passes (no network/eval/base64).
  - Perf invariant: `npm run perf:isolated` passes (mount+settle ceiling and virtualization window intact under vite 8's bundling).
  - Integration: `npm run e2e:local` renders the Gantt in real Obsidian without runtime regression.
  - Failure path: if `npm ci` reports a peer conflict, capture the exact `ERESOLVE` tree for U5's decision.

### U5. Resolve #163 to a terminal state (merge, coordinated-fix, or hold)

- **Goal:** Close out the major bump defensibly based on U4's evidence.
- **Requirements:** R1, R5, R6.
- **Dependencies:** U4.
- **Files:** possibly `package.json` / `package-lock.json` (coordinated bump); otherwise none.
- **Approach:** Branch on U4's outcome:
  - **All green** → squash-merge #163; delete branch.
  - **Peer conflict repairable in-scope** (e.g., bump `vitest`/browser packages to a vite-8-compatible line) → commit the coordinated bump onto the Dependabot branch, re-run U4's harness, then merge when green.
  - **Breaks and not repairable in reasonable scope** → do **not** merge. Comment the concrete failure (peer tree / build error / e2e regression) on the PR, optionally `@dependabot ignore this major version` if the ecosystem isn't ready, and record the hold as a residual finding. This is an acceptable terminal state under R6.
- **Verification:** #163 is either merged behind green CI, or left open with a documented blocker comment and a residual-findings entry. No force-merge.
- **Test scenarios:** Test expectation: none beyond U4's harness — this unit is the decision/merge gate, not new behavior.

---

## Scope Boundaries

**In scope:** the four currently-open Dependabot PRs (#165, #141, #126, #163); coordinated devDependency bumps strictly necessary to make #163's toolchain resolve.

**Out of scope:**
- Broad dependency upgrades Dependabot has not proposed.
- Re-architecting the build or test harness beyond what #163 forces.
- Production-dependency changes (only `@svar-ui/svelte-gantt` is a runtime dep; none of these PRs touch it).

### Deferred to Follow-Up Work
- If #163 is held for ecosystem readiness (vitest/vite-8 peer support), revisit when `vitest@5` or a vite-8-compatible `vitest@4.x` ships.

---

## Risks & Dependencies

- **Peer-dependency conflict on #163 (most likely failure):** `vite@8` vs `vitest@4`/`@vitest/browser`/`vitest-browser-svelte`. Mitigation: probe `npm ci` first (KTD3); coordinated bump or hold (U5).
- **Node floor:** `vite@8` needs Node 20.19+/22.12+. CI's `node-version: '20'` resolves to latest 20.x (satisfies). Local dev is Node 24 (satisfies). Low risk but confirm during U4.
- **Branch protection / merge mechanism:** squash-merge behind green CI; if branch protection blocks programmatic merge, surface rather than bypass.
- **Rebase churn:** merging the safe three first invalidates #163's lockfile base; rebase #163 before U4 so it's validated against current `main`.
- **e2e flake:** the WDIO real-Obsidian path has known intermittent download/leaf-steal modes (see docs/solutions). Distinguish a genuine vite-8 regression from a known flake before holding #163.

---

## Verification Strategy

- Low-risk PRs (U1–U3): GitHub CI green is the gate of record; consolidated local smoke (`npm ci && npm run build && npm test`) confirms the merged state.
- High-risk PR (U4–U5): full local harness mirroring `ci.yml` **plus** `npm run e2e:local`, then CI green on the rebased branch before merge.
- Terminal-state audit: after all units, `gh pr list --author app/dependabot --state open` returns empty, or any remaining entry has a documented hold comment.
